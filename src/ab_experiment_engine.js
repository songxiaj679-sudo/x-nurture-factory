/**
 * @file src/ab_experiment_engine.js
 * @description VELOX AI 4.0 自律進化A/B実験エンジン
 * 
 * 【実験設計基準（Copilot レビュー指針準拠）】
 * 1. 計測時刻の厳格統一: 24.0h〜25.0hの厳格ウィンドウに初回収集できたデータのみを主分析対象とする。
 * 2. 介入差分の単一化: 群A（ベースライン: DPO・エピソード記憶なし）vs 群B（介入群: DPO・エピソード記憶注入）。
 * 3. 判定基準の事前定義: サンプルサイズ（各群最小10件）、保存率（ブックマーク/インプレッション）、95%信頼区間、データ不足時の判定保留。
 */

const crypto = require('crypto');

// 実験の主分析対象ウィンドウ（24時間から25時間以内の初回取得データに限定）
const EXPERIMENT_WINDOW_MIN_HOURS = 24.0;
const EXPERIMENT_WINDOW_MAX_HOURS = 25.0;
const MIN_SAMPLE_SIZE_PER_VARIANT = 10;

/**
 * 投稿ジョブに対してA/B実験のバリアントをランダムに割り当てる
 * 
 * @param {Object} [options={}]
 * @param {string} [options.forcedVariant] - テスト用強制指定 ('A' | 'B')
 * @returns {{
 *   variant: 'A' | 'B',
 *   promptVersion: string,
 *   assignedAt: Date
 * }}
 */
function assignExperimentVariant(options = {}) {
  if (options.forcedVariant === 'A' || options.forcedVariant === 'B') {
    return {
      variant: options.forcedVariant,
      promptVersion: options.forcedVariant === 'A' ? 'v4.3-control-base' : 'v4.3-treatment-dpo-episodic',
      assignedAt: new Date()
    };
  }

  // 暗号学的乱数で真に均等（50/50）に配分
  const randomByte = crypto.randomBytes(1)[0];
  const variant = randomByte % 2 === 0 ? 'A' : 'B';

  return {
    variant,
    promptVersion: variant === 'A' ? 'v4.3-control-base' : 'v4.3-treatment-dpo-episodic',
    assignedAt: new Date()
  };
}

/**
 * ユーザー単位でA/B実験コホート（群）を固定解決する
 * 
 * 🛡️ 群間データ混在の防止:
 * 実験中は同一ユーザーが常に同じ群（control_A または treatment_B）にとどまり、
 * 群間で学習データやDPOペアが混ざらないようユーザー単位で永続化する。
 * 
 * @param {string} userId
 * @param {Object} [userData={}]
 * @returns {{
 *   cohort: 'control_A' | 'treatment_B',
 *   variant: 'A' | 'B',
 *   isNewAssignment: boolean
 * }}
 */
function resolveUserExperimentCohort(userId, userData = {}) {
  const existing = userData.experimentCohort;
  if (existing === 'control_A' || existing === 'treatment_B') {
    return {
      cohort: existing,
      variant: existing === 'control_A' ? 'A' : 'B',
      isNewAssignment: false
    };
  }

  // ユーザーIDのハッシュで決定論的かつ50/50均等に配分
  const hash = crypto.createHash('sha256').update(String(userId || 'user')).digest('hex');
  const lastHexDigit = parseInt(hash.slice(-1), 16);
  const cohort = lastHexDigit % 2 === 0 ? 'control_A' : 'treatment_B';

  return {
    cohort,
    variant: cohort === 'control_A' ? 'A' : 'B',
    isNewAssignment: true
  };
}

/**
 * 実験用ポストの適格性を判定し、除外理由を特定する
 * 
 * @param {Object} job - autopilot_jobs ドキュメント
 * @returns {{
 *   isEligible: boolean,
 *   reason: 'eligible' | 'immature' | 'missing_metrics' | 'outside_window' | 'no_snapshot',
 *   postAgeHours: number|null
 * }}
 */
function evaluateJobExperimentEligibility(job) {
  if (!job) {
    return { isEligible: false, reason: 'missing_metrics', postAgeHours: null };
  }

  // メトリクス欠損チェック
  if (job.metricsHarvestStatus === 'missing' || !job.metrics) {
    return { isEligible: false, reason: 'missing_metrics', postAgeHours: job.postAgeHoursAtHarvest || null };
  }

  const snap = job.metrics24hSnapshot;
  if (!snap || !snap.isFrozen) {
    return { isEligible: false, reason: 'no_snapshot', postAgeHours: job.postAgeHoursAtHarvest || null };
  }

  const age = typeof snap.postAgeHours === 'number' ? snap.postAgeHours : (job.postAgeHoursAtHarvest || null);
  if (!Number.isFinite(age) || age < EXPERIMENT_WINDOW_MIN_HOURS) {
    return { isEligible: false, reason: 'immature', postAgeHours: age };
  }

  // 24.0h〜25.0h の厳格ウィンドウ判定
  if (age > EXPERIMENT_WINDOW_MAX_HOURS) {
    return { isEligible: false, reason: 'outside_window', postAgeHours: age };
  }

  if (!Number.isSafeInteger(snap.impressions) || snap.impressions <= 0 ||
      !Number.isSafeInteger(snap.bookmarks) || snap.bookmarks < 0) {
    return { isEligible: false, reason: 'missing_metrics', postAgeHours: age };
  }

  return { isEligible: true, reason: 'eligible', postAgeHours: age };
}

/**
 * Wilson スコア区間による95%信頼区間（二項比率）の計算
 * 
 * @param {number} successes - 成功数（ブックマーク数）
 * @param {number} trials - 試行数（インプレッション数）
 * @param {number} [confidence=1.96] - 95%信頼係数 (z = 1.96)
 * @returns {{ lower: number, upper: number, center: number }}
 */
function calculateWilsonScoreInterval(successes, trials, confidence = 1.96) {
  if (trials <= 0 || successes < 0) {
    return { lower: 0, upper: 0, center: 0 };
  }

  const p = Math.min(1, Math.max(0, successes / trials));
  const z = confidence;
  const z2 = z * z;

  const denominator = 1 + z2 / trials;
  const centerAdjusted = (p + z2 / (2 * trials)) / denominator;
  const standardError = Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials) / denominator;

  const lower = Math.max(0, centerAdjusted - z * standardError);
  const upper = Math.min(1, centerAdjusted + z * standardError);

  return {
    lower: Number(lower.toFixed(6)),
    upper: Number(upper.toFixed(6)),
    center: Number(p.toFixed(6))
  };
}

/**
 * A/B実験の集計・評価・勝敗判定を実行
 * 
 * @param {Array<Object>} allJobs - 対象期間の autopilot_jobs ドキュメント一覧
 * @param {Object} [options={}]
 * @param {number} [options.minSampleSize=10] - 判定に必要な最小適格件数
 * @returns {Object} 実験分析レポート
 */
function analyzeAbExperimentResults(allJobs, options = {}) {
  const minSample = options.minSampleSize || MIN_SAMPLE_SIZE_PER_VARIANT;

  const stats = {
    A: { totalJobs: 0, eligibleJobs: 0, totalImpressions: 0, totalBookmarks: 0, totalLikes: 0, omissionReasons: {} },
    B: { totalJobs: 0, eligibleJobs: 0, totalImpressions: 0, totalBookmarks: 0, totalLikes: 0, omissionReasons: {} }
  };

  if (!Array.isArray(allJobs)) allJobs = [];

  for (const job of allJobs) {
    const variant = job.experimentVariant || job.variant;
    if (variant !== 'A' && variant !== 'B') continue;

    stats[variant].totalJobs++;

    const eligibility = evaluateJobExperimentEligibility(job);
    if (!eligibility.isEligible) {
      stats[variant].omissionReasons[eligibility.reason] = (stats[variant].omissionReasons[eligibility.reason] || 0) + 1;
      continue;
    }

    const snap = job.metrics24hSnapshot;
    stats[variant].eligibleJobs++;
    stats[variant].totalImpressions += snap.impressions;
    stats[variant].totalBookmarks += snap.bookmarks;
    stats[variant].totalLikes += (snap.likes || 0);
  }

  // 指標算出
  const calcVariantMetrics = (v) => {
    const s = stats[v];
    const harvestRate = s.totalJobs > 0 ? Number((s.eligibleJobs / s.totalJobs).toFixed(4)) : 0;
    const omissionRate = s.totalJobs > 0 ? Number(((s.totalJobs - s.eligibleJobs) / s.totalJobs).toFixed(4)) : 0;
    const avgImpressions = s.eligibleJobs > 0 ? Math.round(s.totalImpressions / s.eligibleJobs) : 0;
    const avgBookmarks = s.eligibleJobs > 0 ? Number((s.totalBookmarks / s.eligibleJobs).toFixed(2)) : 0;
    const bookmarkRate = s.totalImpressions > 0 ? s.totalBookmarks / s.totalImpressions : 0;
    const ci = calculateWilsonScoreInterval(s.totalBookmarks, s.totalImpressions);

    return {
      totalAssigned: s.totalJobs,
      eligibleStrict24hCount: s.eligibleJobs,
      omissionRate,
      harvestRate,
      bookmarkRate: Number(bookmarkRate.toFixed(6)),
      confidenceInterval95: ci,
      primaryMetric: {
        name: '24h時点の保存数／表示回数',
        value: Number(bookmarkRate.toFixed(6)),
        totalBookmarks: s.totalBookmarks,
        totalImpressions: s.totalImpressions,
        confidenceInterval95: ci
      },
      totalImpressions: s.totalImpressions,
      avgImpressions,
      totalBookmarks: s.totalBookmarks,
      avgBookmarks,
      omissionReasons: s.omissionReasons
    };
  };

  const metricsA = calcVariantMetrics('A');
  const metricsB = calcVariantMetrics('B');

  // 勝敗・判定ステータス
  let status = 'INSUFFICIENT_DATA';
  let recommendation = `データ不足のため勝敗判定を保留します（各群${minSample}件以上の24.0〜25.0h適格ポストが必要。現在: A群${metricsA.eligibleStrict24hCount}件 / B群${metricsB.eligibleStrict24hCount}件）。`;
  let winner = 'UNDECIDED';

  if (metricsA.eligibleStrict24hCount >= minSample && metricsB.eligibleStrict24hCount >= minSample) {
    status = 'EVALUATED';
    
    // 信頼区間の重複チェック（統計的有意差の厳格判定）
    if (metricsB.confidenceInterval95.lower > metricsA.confidenceInterval95.upper) {
      winner = 'B';
      recommendation = '【B群（DPO+エピソード記憶注入）の有意な勝利】95%信頼区間に重複がなく、介入群の保存率が対照群を上回っています。';
    } else if (metricsA.confidenceInterval95.lower > metricsB.confidenceInterval95.upper) {
      winner = 'A';
      recommendation = '【A群（対照群）の有意な勝利】介入群の保存率が対照群を下回っています。DPOペア・プロンプト注入のロールバックを推奨します。';
    } else {
      winner = 'DRAW_OR_INCONCLUSIVE';
      recommendation = '【有意差なし（差分保留）】両群の95%信頼区間が重複しており、統計的に確実な差は検出されていません。運用継続とデータ追加蓄積を推奨します。';
    }
  }

  return {
    status,
    winner,
    recommendation,
    primaryMetricName: '24h時点の保存数／表示回数 (bookmarkRate24h)',
    measurementWindow: {
      minHours: EXPERIMENT_WINDOW_MIN_HOURS,
      maxHours: EXPERIMENT_WINDOW_MAX_HOURS
    },
    variants: {
      A: {
        description: '対照群（DPOペアおよびエピソード記憶なしのベースラインプロンプト）',
        metrics: metricsA
      },
      B: {
        description: '介入群（実測DPOペアおよびエピソード記憶を注入した進化プロンプト）',
        metrics: metricsB
      }
    },
    analyzedAt: new Date().toISOString()
  };
}

/**
 * 実験バリアント（A: 対照群 / B: 介入群）に応じて、プロンプトへ注入する学習要素（DPOペア・エピソード記憶）を厳格に分離フィルタリングする純粋関数
 * A群（対照群）ではDPOペアおよびエピソード記憶を物理的に空配列に排除し、介入差分を単一化する
 * 
 * @param {Object} params
 * @param {'A' | 'B'} params.variant - 実験バリアント
 * @param {Array} [params.dpoPreferencePairs=[]] - 実測DPOペア
 * @param {Array} [params.episodes=[]] - エピソード記憶
 * @returns {{
 *   dpoPreferencePairs: Array,
 *   episodes: Array,
 *   excludedByControlGroup: boolean
 * }}
 */
function filterPromptDirectivesForVariant({ variant, dpoPreferencePairs = [], episodes = [] }) {
  if (variant === 'A') {
    return {
      dpoPreferencePairs: [],
      episodes: [],
      excludedByControlGroup: true
    };
  }
  return {
    dpoPreferencePairs: Array.isArray(dpoPreferencePairs) ? dpoPreferencePairs : [],
    episodes: Array.isArray(episodes) ? episodes : [],
    excludedByControlGroup: false
  };
}

module.exports = {
  EXPERIMENT_WINDOW_MIN_HOURS,
  EXPERIMENT_WINDOW_MAX_HOURS,
  MIN_SAMPLE_SIZE_PER_VARIANT,
  assignExperimentVariant,
  resolveUserExperimentCohort,
  evaluateJobExperimentEligibility,
  calculateWilsonScoreInterval,
  analyzeAbExperimentResults,
  filterPromptDirectivesForVariant
};
