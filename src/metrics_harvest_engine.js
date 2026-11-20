/**
 * @file src/metrics_harvest_engine.js
 * @description X投稿実績の厳密メトリクス正規化、24時間スナップショット固定化、学習対象フィルタリング
 */

const DEFAULT_24H_MIN_HOURS = 24;
const DEFAULT_24H_MAX_HOURS = 36; // 24時間付近の観測ウィンドウ上限（36時間を超えた初回取得は24hスナップショットとして偽造しない）

/**
 * X APIの生のメトリクスオブジェクトを正規化し、未取得・欠損を数値0と厳密に区別する
 * 
 * @param {Object} rawMetrics
 * @returns {{
 *   impressions: number|null,
 *   bookmarks: number|null,
 *   likes: number|null,
 *   retweets: number|null,
 *   quotes: number|null,
 *   replies: number|null,
 *   isMissing: boolean,
 *   status: 'valid' | 'missing'
 * }}
 */
function normalizeTweetMetrics(rawMetrics) {
  if (!rawMetrics || typeof rawMetrics !== 'object') {
    return {
      impressions: null,
      bookmarks: null,
      likes: null,
      retweets: null,
      quotes: null,
      replies: null,
      isMissing: true,
      status: 'missing'
    };
  }

  const parseField = (val) => {
    if (typeof val !== 'number' && (typeof val !== 'string' || val.trim() === '')) return null;
    const num = Number(val);
    return Number.isSafeInteger(num) && num >= 0 ? num : null;
  };

  const impressions = parseField(rawMetrics.impression_count !== undefined ? rawMetrics.impression_count : rawMetrics.impressions);
  const bookmarks = parseField(rawMetrics.bookmark_count !== undefined ? rawMetrics.bookmark_count : rawMetrics.bookmarks);
  const likes = parseField(rawMetrics.like_count !== undefined ? rawMetrics.like_count : rawMetrics.likes);
  const retweets = parseField(rawMetrics.retweet_count !== undefined ? rawMetrics.retweet_count : rawMetrics.retweets);
  const quotes = parseField(rawMetrics.quote_count !== undefined ? rawMetrics.quote_count : rawMetrics.quotes);
  const replies = parseField(rawMetrics.reply_count !== undefined ? rawMetrics.reply_count : rawMetrics.replies);

  // 重要指標（impressions または bookmarks または likes）が欠損している場合は isMissing = true
  const isMissing = impressions === null || bookmarks === null || likes === null;

  return {
    impressions,
    bookmarks,
    likes,
    retweets,
    quotes,
    replies,
    isMissing,
    status: isMissing ? 'missing' : 'valid'
  };
}

/**
 * 投稿日時からの経過時間（時間）を算出する
 * 
 * @param {Date|string|number} postedAt
 * @param {Date|string|number} [referenceTime=new Date()]
 * @returns {number|null} 経過時間（時間）。無効日時はnull
 */
function buildEarlyMetricsSnapshot(metrics, ageHours, capturedAt) {
  if (ageHours === null || ageHours < 2 || ageHours > 6) return null;
  if (!Number.isSafeInteger(metrics?.impressions) || metrics.impressions <= 0) return null;
  if (!Number.isSafeInteger(metrics?.bookmarks) || metrics.bookmarks < 0 || metrics.bookmarks > metrics.impressions) return null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return {
    impressions: metrics.impressions,
    bookmarks: metrics.bookmarks,
    replies: count(metrics.replies),
    likes: count(metrics.likes),
    retweets: count(metrics.retweets),
    quotes: count(metrics.quotes),
    postAgeHours: ageHours,
    capturedAt
  };
}

function computePostAgeHours(postedAt, referenceTime = new Date()) {
  const pTime = postedAt ? new Date(postedAt).getTime() : NaN;
  const rTime = referenceTime ? new Date(referenceTime).getTime() : NaN;
  if (Number.isNaN(pTime) || Number.isNaN(rTime)) return null;
  const diffMs = rTime - pTime;
  if (diffMs < 0) return 0;
  return diffMs / (60 * 60 * 1000);
}

/**
 * 24時間付近スナップショットの解決（24〜36時間ウィンドウ内の初回取得時のみ凍結、再取得時も上書き破壊しない）
 * 
 * @param {Object} params
 * @param {Date|string|number} params.postedAt - 投稿日時
 * @param {Date|string|number} [params.harvestedAt=new Date()] - 計測日時
 * @param {Object} params.normalizedMetrics - normalizeTweetMetricsの返却値
 * @param {Object|null} [params.existingSnapshot=null] - 既に保存済みの24hスナップショット
 * @param {number} [params.minAgeHours=24] - 24時間スナップショットとして確定する最小経過時間
 * @param {number} [params.maxAgeHours=36] - 24時間スナップショットとして確定する最大経過時間
 * @returns {Object|null} 24時間スナップショットオブジェクト（未成熟、ウィンドウ超過、欠損時はnull）
 */
function resolve24hMetricsSnapshot({
  postedAt,
  harvestedAt = new Date(),
  normalizedMetrics,
  existingSnapshot = null,
  minAgeHours = DEFAULT_24H_MIN_HOURS,
  maxAgeHours = DEFAULT_24H_MAX_HOURS
}) {
  // 1. 既にスナップショットが存在する場合は既存の値をそのまま維持（再取得による上書き破壊を防止）
  if (existingSnapshot && typeof existingSnapshot === 'object' && existingSnapshot.isFrozen) {
    return existingSnapshot;
  }

  // 2. メトリクスが欠損（取得失敗）している場合はスナップショットを作成しない
  if (!normalizedMetrics || normalizedMetrics.isMissing) {
    return null;
  }

  // 3. 経過時間を算出
  const ageHours = computePostAgeHours(postedAt, harvestedAt);
  if (ageHours === null || ageHours < minAgeHours) {
    // 24時間未満の未成熟投稿はスナップショット確定しない
    return null;
  }

  if (ageHours > maxAgeHours) {
    // 36時間を超過して初回取得された場合、24時間スナップショットとしては扱わない（計測時点の歪みを防止）
    return null;
  }

  // 4. 24時間〜36時間ウィンドウ内で初回取得された正当な24hスナップショットを凍結（frozen）保存
  return {
    impressions: normalizedMetrics.impressions,
    bookmarks: normalizedMetrics.bookmarks,
    likes: normalizedMetrics.likes,
    retweets: normalizedMetrics.retweets,
    quotes: normalizedMetrics.quotes,
    replies: normalizedMetrics.replies,
    harvestedAt: new Date(harvestedAt),
    postAgeHours: ageHours,
    harvestWindowCategory: (ageHours <= 25.0) ? 'exact_24h' : 'extended_24h',
    isFrozen: true,
    snapshotVersion: 1
  };
}

/**
 * 学習（DPOペア選定・メタプロンプト分析・エピソード記憶生成・ナレッジ更新）に使用可能な成熟投稿のみを厳密フィルタリング
 * 
 * 🛡️ 全学習経路の厳格統一:
 * 異なる計測時点のデータの混在を防ぐため、デフォルトで24h凍結スナップショットを必須（requireSnapshotOnly: true）とし、
 * スナップショット未保持の投稿はすべて「学習保留（reserve）」として除外する。
 * 
 * @param {Array<Object>} historyItems
 * @param {number|Object} [options={ requireSnapshotOnly: true }]
 * @returns {Array<Object>} 学習対象として妥当な24hスナップショット確定投稿一覧
 */
function filterValidMaturePostsForLearning(historyItems, options = {}) {
  const minAgeHours = typeof options === 'number' ? options : (options?.minAgeHours || 24);
  // 明示的に requireSnapshotOnly: false が指定された場合を除き、デフォルトで24hスナップショット必須
  const requireSnapshotOnly = (typeof options === 'object' && options?.requireSnapshotOnly === false)
    ? false
    : true;

  if (!Array.isArray(historyItems)) return [];

  return historyItems.filter(item => {
    // 欠損チェック
    if (!item || item.isMissing) return false;

    // 24hスナップショットがある場合はそれを最優先採用（インプレッションとブクマが正常数値であること）
    if (item.metrics24hSnapshot && item.metrics24hSnapshot.isFrozen) {
      return Number.isSafeInteger(item.metrics24hSnapshot.impressions) &&
             item.metrics24hSnapshot.impressions > 0 &&
             Number.isSafeInteger(item.metrics24hSnapshot.bookmarks) &&
             item.metrics24hSnapshot.bookmarks >= 0;
    }

    // スナップショット必須モードの場合は、24hスナップショットのない投稿を除外
    if (requireSnapshotOnly) return false;

    // スナップショットがない場合は最新メトリクスと経過時間で判定（24時間以上かつ数値存在）
    const ageHours = item.postAgeHours !== undefined ? item.postAgeHours : computePostAgeHours(item.postedAt);
    if (ageHours === null || ageHours < minAgeHours) {
      return false; // 24時間未満の未成熟
    }

    return Number.isSafeInteger(item.impressions) &&
           item.impressions > 0 &&
           Number.isSafeInteger(item.bookmarks) &&
           item.bookmarks >= 0;
  }).map(item => {
    // 比較用に24hスナップショットの値があれば優先マッピング
    if (item.metrics24hSnapshot && item.metrics24hSnapshot.isFrozen) {
      const snap = item.metrics24hSnapshot;
      return {
        ...item,
        impressions: snap.impressions,
        bookmarks: snap.bookmarks,
        likes: snap.likes,
        retweets: snap.retweets,
        quotes: snap.quotes,
        replies: snap.replies,
        comparisonBasis: '24h_snapshot'
      };
    }
    return {
      ...item,
      comparisonBasis: 'live_mature'
    };
  });
}

/**
 * 投稿済みジョブリストと取得したTweetをID完全一致で厳格突合
 * 
 * @param {Array<Object>} postedJobDocs - Firestore doc または data
 * @param {Object} tweet - APIから取得したTweet
 * @returns {{ matchedJob: Object|null, matchType: 'exact_id' | 'none' }}
 */
function matchTweetToJob(postedJobDocs, tweet) {
  if (!Array.isArray(postedJobDocs) || !tweet || !tweet.id) {
    return { matchedJob: null, matchType: 'none' };
  }

  // 厳格な tweetId 完全一致のみ（曖昧なテキスト前方一致による誤突合を完全排除）
  const exactMatch = postedJobDocs.find(doc => {
    const data = typeof doc.data === 'function' ? doc.data() : doc;
    return data && String(data.tweetId) === String(tweet.id);
  });

  if (exactMatch) {
    return { matchedJob: exactMatch, matchType: 'exact_id' };
  }

  return { matchedJob: null, matchType: 'none' };
}

/**
 * ユーザーのメトリクス自動回収の実行要否を判定する
 * 
 * 🛡️ クールダウンと回収窓優先の両立:
 * 通常は不要なX API呼び出しを抑制するため60分のクールダウンを適用するが、
 * 未確定の投稿が24〜25時間の厳格回収窓（または窓突入直前 23.8h〜25.5h）に位置する場合は、
 * クールダウンをバイパスして即座に同期を実行する（取りこぼし防止）。
 * 
 * @param {Object} params
 * @param {Date|string|number|null} [params.lastHarvestAt=null] - 前回の回収日時
 * @param {Array<Object>} [params.postedJobs=[]] - ユーザーの投稿済みジョブリスト
 * @param {Date|string|number} [params.now=new Date()] - 現在日時
 * @param {number} [params.cooldownMinutes=60] - 通常クールダウン分数
 * @param {number} [params.urgentWindowMinHours=23.8] - 回収窓優先を開始する経過時間（下限）
 * @param {number} [params.urgentWindowMaxHours=36.0] - 回収窓優先を終了する経過時間（上限: 24hスナップショット最大観測窓）
 * @returns {{
 *   shouldSync: boolean,
 *   reason: 'urgent_window_priority' | 'cooldown_expired' | 'no_previous_sync' | 'cooldown_active',
 *   bypassCooldown: boolean,
 *   urgentJobsCount: number
 * }}
 */
function evaluateUserSyncEligibility({
  lastHarvestAt = null,
  postedJobs = [],
  now = new Date(),
  cooldownMinutes = 60,
  urgentWindowMinHours = 23.8,
  urgentWindowMaxHours = 36.0
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();

  // 1. 投稿ジョブの中に、24hスナップショット未確定かつ回収窓（23.8h〜25.5h）に位置する投稿が存在するか検査
  const urgentJobs = (Array.isArray(postedJobs) ? postedJobs : []).filter(job => {
    const jobData = typeof job.data === 'function' ? job.data() : job;
    if (!jobData) return false;
    
    // 既にスナップショット確定（凍結）済みの投稿は緊急ではない
    if (jobData.metrics24hSnapshot && jobData.metrics24hSnapshot.isFrozen) {
      return false;
    }

    const rawPostedAt = jobData.postedAt || jobData.createdAt;
    if (!rawPostedAt) return false;
    const pDate = rawPostedAt.toDate ? rawPostedAt.toDate() : new Date(rawPostedAt);
    const ageHours = computePostAgeHours(pDate, nowDate);
    if (ageHours === null) return false;

    const inFrozenWindow = ageHours >= urgentWindowMinHours && ageHours <= urgentWindowMaxHours;
    const inEarlyWindow = ageHours >= 2 && ageHours <= 6 && !jobData.metricsEarlySnapshot;
    return inFrozenWindow || inEarlyWindow;
  });

  if (urgentJobs.length > 0) {
    return {
      shouldSync: true,
      reason: 'urgent_window_priority',
      bypassCooldown: true,
      urgentJobsCount: urgentJobs.length
    };
  }

  // 2. 前回の回収日時の確認
  if (!lastHarvestAt) {
    return {
      shouldSync: true,
      reason: 'no_previous_sync',
      bypassCooldown: false,
      urgentJobsCount: 0
    };
  }

  const lastHarvestDate = lastHarvestAt.toDate ? lastHarvestAt.toDate() : new Date(lastHarvestAt);
  const lastHarvestMs = lastHarvestDate.getTime();
  if (Number.isNaN(lastHarvestMs)) {
    return {
      shouldSync: true,
      reason: 'no_previous_sync',
      bypassCooldown: false,
      urgentJobsCount: 0
    };
  }

  const elapsedMinutes = (nowMs - lastHarvestMs) / (60 * 1000);
  if (elapsedMinutes >= cooldownMinutes) {
    return {
      shouldSync: true,
      reason: 'cooldown_expired',
      bypassCooldown: false,
      urgentJobsCount: 0
    };
  }

  return {
    shouldSync: false,
    reason: 'cooldown_active',
    bypassCooldown: false,
    urgentJobsCount: 0
  };
}

/**
 * FirestoreのTimestampオブジェクト、シリアライズ秒オブジェクト、Date、ISO文字列等を安全にUnix Epochミリ秒(数値)にパースする
 * NaN や不正値を物理的に排除し、確実な大小比較を保証する純粋関数
 * 
 * @param {any} val
 * @returns {number} Unix Epochミリ秒 (失敗時は0)
 */
function parseFirestoreTimestampMs(val) {
  if (!val) return 0;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') {
    const d = val.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
  }
  if (typeof val._seconds === 'number') {
    return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1000000);
  }
  if (typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
  }
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? 0 : val.getTime();
  }
  if (typeof val === 'number') {
    return Number.isNaN(val) ? 0 : val;
  }
  if (typeof val === 'string') {
    const parsed = new Date(val).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function countMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function compositeEngagementScore(metrics = {}) {
  const impressions = Number.isSafeInteger(metrics.impressions) && metrics.impressions > 0 ? metrics.impressions : 0;
  const score = 4 * countMetric(metrics.bookmarks)
    + 3.5 * countMetric(metrics.replies)
    + 3 * countMetric(metrics.quotes)
    + 2 * countMetric(metrics.retweets)
    + 0.5 * countMetric(metrics.likes);
  return { score, rate: score / Math.max(impressions, 1), impressions };
}

function confidenceWeight(impressions, baselineImpressions, snapshotWeight) {
  const shown = Number.isSafeInteger(impressions) && impressions > 0 ? impressions : 0;
  const baseline = Math.max(20, Number(baselineImpressions) || 50);
  return shown / (shown + Math.max(50, 0.25 * baseline)) * snapshotWeight;
}

function reachSurprise(impressions, baselineImpressions) {
  const shown = Number.isSafeInteger(impressions) && impressions > 0 ? impressions : 0;
  const baseline = Math.max(20, Number(baselineImpressions) || 50);
  const value = Math.log2(1 + shown / baseline);
  return Math.min(1.8, Math.max(0.3, value));
}

function observationForReward(post) {
  const frozen = post && post.metrics24hSnapshot;
  if (frozen && frozen.isFrozen === true && Number.isSafeInteger(frozen.impressions) && frozen.impressions > 0) {
    return { metrics: frozen, snapshotWeight: 1 };
  }
  const early = post && post.metricsEarlySnapshot;
  if (early && Number.isSafeInteger(early.impressions) && early.impressions >= 20 && Number(early.postAgeHours) >= 2) {
    return { metrics: early, snapshotWeight: 0.45 };
  }
  return null;
}

function computeResidualRewards(posts) {
  const rows = (Array.isArray(posts) ? posts : []).map(post => {
    const observation = observationForReward(post);
    if (!observation) return null;
    const engagement = compositeEngagementScore(observation.metrics);
    return { post, ...engagement, snapshotWeight: observation.snapshotWeight };
  }).filter(Boolean);
  const overall = median(rows.map(row => row.impressions)) || 50;
  const scored = rows.map((row, index) => {
    const earlier = rows.slice(0, index).map(item => item.impressions);
    const baseline = Math.max(20, earlier.length ? median(earlier) : overall);
    const rawWeight = confidenceWeight(row.impressions, baseline, row.snapshotWeight);
    const weight = row.snapshotWeight < 1 ? Math.min(rawWeight, 0.35) : rawWeight;
    const surprise = reachSurprise(row.impressions, baseline);
    return { ...row, baselineImpressions: baseline, weight, surprise, adjusted: row.rate * surprise };
  });
  return scored.map((row, index) => {
    const earlier = scored.slice(0, index).map(item => item.adjusted);
    const center = earlier.length ? median(earlier) : row.adjusted;
    const deviation = earlier.length ? median(earlier.map(value => Math.abs(value - center))) : 0;
    const scale = Math.max(deviation || 0, 0.005);
    const residual = 1 / (1 + Math.exp(-1.5 * (row.adjusted - center) / scale));
    return { ...row, residual, evidence: row.weight * row.adjusted };
  });
}

function decideEarlyAction(history, latest) {
  if (!latest || !Number.isSafeInteger(latest.impressions) || latest.impressions <= 0) return 'keep';
  const rate = snapshot => (countMetric(snapshot.bookmarks) + countMetric(snapshot.replies)) / snapshot.impressions;
  const others = (Array.isArray(history) ? history : []).filter(snapshot => snapshot && snapshot !== latest && snapshot.impressions > 0);
  const rates = others.map(rate);
  const mean = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : rate(latest);
  const variance = rates.length ? rates.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rates.length : 0;
  const deviation = Math.sqrt(variance);
  const z = deviation > 0 ? (rate(latest) - mean) / deviation : 0;
  if (z >= 1 && latest.impressions >= 100) return 'deepen_winner';
  if (z <= -0.8 || (Number(latest.postAgeHours) >= 4 && latest.impressions < 30 && countMetric(latest.bookmarks) === 0)) return 'pivot_angle';
  return 'keep';
}

module.exports = {
  DEFAULT_24H_MIN_HOURS,
  DEFAULT_24H_MAX_HOURS,
  normalizeTweetMetrics,
  buildEarlyMetricsSnapshot,
  computePostAgeHours,
  resolve24hMetricsSnapshot,
  filterValidMaturePostsForLearning,
  matchTweetToJob,
  evaluateUserSyncEligibility,
  parseFirestoreTimestampMs,
  compositeEngagementScore,
  confidenceWeight,
  reachSurprise,
  computeResidualRewards,
  decideEarlyAction
};
