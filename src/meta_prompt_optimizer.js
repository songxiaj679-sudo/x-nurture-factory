/**
 * @file meta_prompt_optimizer.js
 * @description VELOX AI 4.0 - 自己進化メタプロンプト最適化エンジン (OPRO Inspired Prompt Optimizer)
 * 
 * 過去の投稿実績（インプレッション・エンゲージメント・ブックマーク等）を分析し、
 * 執筆プロンプトの指示書（Directives）を自律的に改善・進化させる機構。
 * 
 * 【安全性とBest-effort保証】
 * - 必須制約（本文直リンクゼロ規約、背伸び禁止等）が削除・改ざんされないようバリデーションを実施
 * - API未設定時やエラー時は既存の指示書を維持（破壊的変更を行わない）
 * - バージョン管理と更新理由（changelog）を記録
 */

'use strict';

const { hasXaiKey, completeJson } = require('./grok_client');

/**
 * プロンプト指示書で必ず保持・維持されなければならない必須安全制約
 */
const MANDATORY_SAFETY_RULES = [
  '本文内URL直貼り禁止',
  '背伸び・誇大広告の禁止',
  '1行目でのスクロール停止'
];

/**
 * デフォルトのベースライン執筆指示書
 */
const BASELINE_PROMPT_DIRECTIVES = [
  {
    id: 'rule_zero_url',
    category: 'safety',
    text: '本文内URL直貼り禁止: 外部リンクはアルゴリズム減衰を避けるため本文に入れず、2段目リプライまたはプロフィールへ誘導する。',
    isImmutable: true
  },
  {
    id: 'rule_honest_position',
    category: 'voice',
    text: '背伸び・誇大広告の禁止: アカウントの現在地（ステージ）に見合った等身大の実績・一次情報を基点に語る。',
    isImmutable: true
  },
  {
    id: 'rule_punchy_first_line',
    category: 'hook',
    text: '1行目でのスクロール停止: 冒頭1行目は25文字以内で意外性、具体的数字、または感情を動かすフックを配置する。',
    isImmutable: true
  },
  {
    id: 'rule_actionable_takeaway',
    category: 'value',
    text: '読後アクションの明示: 読者が読んですぐに実践できる具体的な気付きやチェックリストを提供する。',
    isImmutable: false
  }
];

/**
 * @typedef {Object} PostMetricItem
 * @property {string} text - 投稿テキスト
 * @property {string} [angle] - 投稿アングル
 * @property {number} impressions - インプレッション数
 * @property {number} likes - いいね数
 * @property {number} bookmarks - ブックマーク数
 * @property {number} replies - 返信数
 */

/**
 * @typedef {Object} ClusterAnalysisResult
 * @property {PostMetricItem[]} highPerformers - 上位実績グループ
 * @property {PostMetricItem[]} lowPerformers - 下位実績グループ
 * @property {string[]} observedSuccessPatterns - 抽出された成功傾向
 * @property {string[]} observedFailurePatterns - 抽出された失敗傾向
 */

/**
 * 投稿実績リストを上位・下位にクラスタリングし、構文的傾向を分析する
 * 
 * @param {PostMetricItem[]} posts - 分析対象の実績付き投稿配列
 * @returns {ClusterAnalysisResult} クラスタ分析結果
 */
function analyzePerformanceClusters(posts) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return {
      highPerformers: [],
      lowPerformers: [],
      observedSuccessPatterns: [],
      observedFailurePatterns: []
    };
  }

  // 複合スコアを計算: ブックマーク(重み3) + リプライ(重み2) + いいね(重み1) + (Imp / 100)
  const scoredPosts = posts.map(p => {
    const imp = p.impressions || 0;
    const likes = p.likes || 0;
    const bms = p.bookmarks || 0;
    const reps = p.replies || 0;
    const compositeScore = (bms * 3) + (reps * 2) + likes + (imp / 100);
    return { ...p, compositeScore };
  });

  // スコア降順ソート
  scoredPosts.sort((a, b) => b.compositeScore - a.compositeScore);

  const half = Math.max(1, Math.floor(scoredPosts.length / 2));
  const highPerformers = scoredPosts.slice(0, half);
  const lowPerformers = scoredPosts.length > 1 ? scoredPosts.slice(half) : [];

  const observedSuccessPatterns = [];
  const observedFailurePatterns = [];

  // 成功パターンの抽出ヒューリスティック
  const highWithNumbers = highPerformers.filter(p => /\d+/.test(p.text || ''));
  if (highWithNumbers.length > highPerformers.length * 0.5) {
    observedSuccessPatterns.push('具体的数値を含む投稿が高いエンゲージメントを記録');
  }

  const highShortFirstLine = highPerformers.filter(p => {
    const firstLine = (p.text || '').split('\n')[0] || '';
    return firstLine.length > 5 && firstLine.length <= 30;
  });
  if (highShortFirstLine.length > highPerformers.length * 0.5) {
    observedSuccessPatterns.push('冒頭1行目が30文字以内の簡潔な投稿でスクロール停止率が良好');
  }

  // 失敗パターンの抽出ヒューリスティック
  const lowLongFirstLine = lowPerformers.filter(p => {
    const firstLine = (p.text || '').split('\n')[0] || '';
    return firstLine.length > 40;
  });
  if (lowLongFirstLine.length > 0) {
    observedFailurePatterns.push('冒頭1行目が長文（40文字超）の投稿でエンゲージメント低下の傾向');
  }

  const lowWithUrls = lowPerformers.filter(p => /https?:\/\//.test(p.text || ''));
  if (lowWithUrls.length > 0) {
    observedFailurePatterns.push('本文内URLが存在する投稿で表示数が低迷');
  }

  const questionEnding = text => /[?？]\s*$|か。\s*$/.test(String(text || '').trim());
  const questionRate = rows => rows.length ? rows.filter(row => questionEnding(row.text)).length / rows.length : 0;
  if (lowPerformers.length && questionRate(lowPerformers) > questionRate(highPerformers)) {
    observedFailurePatterns.push('低反応群は疑問文で締める比率が高い');
  }
  const angleCounts = new Map();
  highPerformers.forEach(row => {
    const angle = row.genes && row.genes.angle || row.angle || row.portfolioRole || '';
    if (angle) angleCounts.set(angle, (angleCounts.get(angle) || 0) + 1);
  });
  [...angleCounts.entries()].forEach(([angle, count]) => {
    if (count > highPerformers.length * 0.5) observedSuccessPatterns.push(`上位投稿は切り口 ${angle} に偏っている`);
  });

  return {
    highPerformers,
    lowPerformers,
    observedSuccessPatterns,
    observedFailurePatterns
  };
}

/**
 * 提案された新しい指示書リストが必須安全ルールを満たしているか検証する
 * 
 * @param {Array<{id: string, text: string, category: string, isImmutable?: boolean}>} proposedDirectives
 * @returns {boolean} 安全性チェック合格判定
 */
function validateDirectivesSafety(proposedDirectives) {
  if (!Array.isArray(proposedDirectives) || proposedDirectives.length === 0) {
    return false;
  }

  const ids = new Set();
  for (const directive of proposedDirectives) {
    if (!directive || typeof directive.id !== 'string' || typeof directive.text !== 'string' || ids.has(directive.id)) {
      return false;
    }
    ids.add(directive.id);
  }

  for (const mandatoryRule of MANDATORY_SAFETY_RULES) {
    const baseline = BASELINE_PROMPT_DIRECTIVES.find(d => d.isImmutable && d.text.includes(mandatoryRule));
    const actual = baseline && proposedDirectives.find(d => d.id === baseline.id);
    if (!baseline || !actual || actual.isImmutable !== true || actual.category !== baseline.category || actual.text !== baseline.text) {
      return false;
    }
  }

  return true;
}

function validateMutableDirectives(mutableList) {
  if (!Array.isArray(mutableList) || mutableList.length > 4) return null;
  const unsafe = /URL.*直貼り|リンク.*本文|誇張|保証する表現|本文にURL|必ず貼/;
  const clean = [];
  for (const item of mutableList) {
    if (!item || item.isImmutable !== false || typeof item.id !== 'string' || typeof item.text !== 'string') return null;
    if (unsafe.test(item.text) || item.text.length > 240) return null;
    clean.push({
      id: item.id.slice(0, 80),
      category: typeof item.category === 'string' ? item.category.slice(0, 40) : 'style',
      text: item.text,
      isImmutable: false
    });
  }
  const assembled = restoreMandatoryDirectives(clean);
  return validateDirectivesSafety(assembled) ? assembled : null;
}

function restoreMandatoryDirectives(directives) {
  const immutableIds = new Set(
    BASELINE_PROMPT_DIRECTIVES.filter(d => d.isImmutable).map(d => d.id)
  );
  const retained = (Array.isArray(directives) ? directives : [])
    .filter(d => d && typeof d.id === 'string' && typeof d.text === 'string' && !immutableIds.has(d.id));

  return [
    ...BASELINE_PROMPT_DIRECTIVES.filter(d => d.isImmutable).map(d => ({ ...d })),
    ...retained
  ];
}

/**
 * 現在のプロンプト指示書と実績分析から、改善された新しい指示書セットを生成する
 * 
 * @param {Array<Object>} currentDirectives - 現在の指示書セット
 * @param {ClusterAnalysisResult} clusterAnalysis - 実績クラスタ分析結果
 * @param {Object} [context={}] - オプション
 * @param {boolean} [context.forceFallback=false] - 外部APIを使わずヒューリスティックで進化
 * @returns {Promise<{updatedDirectives: Array<Object>, changeLog: string[], isUpdated: boolean}>}
 */
async function optimizePromptDirectives(currentDirectives, clusterAnalysis, context = {}) {
  const directives = restoreMandatoryDirectives(currentDirectives);

  const changeLog = [];

  // 実績データが不足している場合は更新を行わず維持（Best-effort）
  if (!clusterAnalysis || !Array.isArray(clusterAnalysis.highPerformers) || clusterAnalysis.highPerformers.length === 0) {
    return {
      updatedDirectives: directives,
      changeLog: ['実績データが不十分なため、現在の指示書を維持しました。'],
      isUpdated: false
    };
  }
  const normalizedAnalysis = {
    ...clusterAnalysis,
    observedSuccessPatterns: Array.isArray(clusterAnalysis.observedSuccessPatterns) ? clusterAnalysis.observedSuccessPatterns : [],
    observedFailurePatterns: Array.isArray(clusterAnalysis.observedFailurePatterns) ? clusterAnalysis.observedFailurePatterns : []
  };

  const forceFallback = Boolean(context.forceFallback);

  if (forceFallback || !hasXaiKey()) {
    return runHeuristicOptimization(directives, normalizedAnalysis);
  }

  // Gemini APIを用いたLLMメタプロンプト推論
  try {
    const prompt = `あなたはプロンプト最適化エンジニア（OPRO）です。
過去のX投稿実績データを分析し、執筆プロンプトの指示書（Directives）を改善してください。

【現在の指示書】:
${directives.map(d => `- [${d.id}] (${d.category}): ${d.text}`).join('\n')}

【分析された成功傾向】:
${normalizedAnalysis.observedSuccessPatterns.join('\n') || '特になし'}

【分析された失敗傾向】:
${normalizedAnalysis.observedFailurePatterns.join('\n') || '特になし'}

【必須要件】:
1. 不変の安全ルールは出力しないでください。可変ルールだけを最大4件返してください。
2. 各ルールの isImmutable は false です。URL直貼り、本文リンク、誇張、保証する表現は入れないでください。
3. 成功傾向を取り入れた実践ルールを1〜2件にしてください。
4. 文字数だけでなく、保存数や返信率の高い投稿がどの構造の噛み砕き方・因果の鋭さ・視点の対比で反応を得たかも抽出し、AIテンプレ化を防ぐ可変ルールへ反映してください。出力言語の目安は ${context.lang === 'en' ? 'English' : 'Japanese'} です。
5. ${context.lang === 'en' ? 'Write every mutable rule in English.' : '可変ルールの本文は日本語で書いてください。'}${context.domainLexicon ? ` アカウント辞書: ${JSON.stringify({ retiredPhrases: context.domainLexicon.retiredPhrases || [], winningExpressions: context.domainLexicon.winningExpressions || [] }).slice(0, 500)}` : ''}

以下のJSONだけを出力してください:
{
  "mutableDirectives": [
    { "id": "rule_id", "category": "hook|value|style", "text": "ルール本文", "isImmutable": false }
  ],
  "changeLog": ["変更理由の説明"]
}`;

    const parsed = (await completeJson({ tier: 'quality', prompt, temperature: 0.2 })).parsed;
    const assembled = validateMutableDirectives(parsed && (parsed.mutableDirectives || parsed.updatedDirectives));

    if (assembled) {
      return {
        updatedDirectives: assembled,
        changeLog: Array.isArray(parsed.changeLog) ? parsed.changeLog : ['LLMによる可変ルールの自己進化を適用'],
        isUpdated: true
      };
    } else {
      console.warn('[MetaPromptOptimizer] LLM提案が安全制約チェックに不合格のためフォールバック実行');
      return runHeuristicOptimization(directives, normalizedAnalysis);
    }
  } catch (err) {
    console.warn(`[MetaPromptOptimizer] 最適化推論エラー (${err.message}): フォールバックを適用`);
    return runHeuristicOptimization(directives, normalizedAnalysis);
  }
}

/**
 * ルールベースによる安全な指示書追加（ヒューリスティック最適化）
 * @private
 */
function runHeuristicOptimization(directives, clusterAnalysis) {
  const updated = [...directives];
  const changeLog = [];

  // 成功パターンに基づく動的ルールの追加
  if (clusterAnalysis.observedSuccessPatterns.some(p => p.includes('具体的数値'))) {
    const existing = updated.find(d => d.id === 'rule_dynamic_concrete_numbers');
    if (!existing) {
      updated.push({
        id: 'rule_dynamic_concrete_numbers',
        category: 'hook',
        text: '具体的数値の積極配置: 実績データに基づき、冒頭や本文に具体的な数値・時間・割合を記載して説得力を高める。',
        isImmutable: false
      });
      changeLog.push('実績分析に基づき「具体的数値の積極配置」ルールを指示書に追加');
    }
  }

  // 失敗パターンに基づく動的ルールの追加
  if (clusterAnalysis.observedFailurePatterns.some(p => p.includes('長文（40文字超）'))) {
    const existing = updated.find(d => d.id === 'rule_avoid_long_intro');
    if (!existing) {
      updated.push({
        id: 'rule_avoid_long_intro',
        category: 'style',
        text: '冒頭長文の抑止: 冒頭1行目が冗長になると読者が離脱するため、最初の1行は改行で独立させて視線誘導を徹底する。',
        isImmutable: false
      });
      changeLog.push('実績分析に基づき「冒頭長文の抑止」ルールを指示書に追加');
    }
  }

  return {
    updatedDirectives: updated,
    changeLog: changeLog.length > 0 ? changeLog : ['分析結果に基づき現在の指示書を検証・維持しました。'],
    isUpdated: changeLog.length > 0
  };
}

module.exports = {
  MANDATORY_SAFETY_RULES,
  BASELINE_PROMPT_DIRECTIVES,
  analyzePerformanceClusters,
  validateDirectivesSafety,
  validateMutableDirectives,
  restoreMandatoryDirectives,
  optimizePromptDirectives
};
