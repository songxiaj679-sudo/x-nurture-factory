/**
 * 🧠 Intelligence Harvester & Buzz Knowledge Extractor (X Official API v2 Compliant)
 * 
 * X公式API v2に100%準拠し、高反響ツイート・競合アカウント・業界トレンドから
 * 「冒頭0.2秒フック構造」「保存率（ブックマーク率）」「リンク誘導設計」を
 * 科学的に分析・抽出して自社AI評議会の学習・推敲知識（Corpus）として蓄積するモジュール。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./firestore');
const {
  lookupAnyUserProfileAndTweets,
  generateOAuth1Header,
  decryptCredentials,
  refreshOAuth2TokenIfNeeded
} = require('./official_api_client');

const CORPUS_DIR = path.resolve(__dirname, '../data/intelligence');
const CORPUS_JSONL_FILE = path.join(CORPUS_DIR, 'buzz_knowledge_corpus.jsonl');

function isApiCorpusRecord(item) {
  return ['x_api_user_timeline', 'x_api_recent_search'].includes(item?.source);
}

function preferApiCorpusRecords(items) {
  const unique = new Map();
  for (const item of items) {
    const id = item?.tweet_id ? String(item.tweet_id) : Symbol();
    const existing = unique.get(id);
    if (!existing || (!isApiCorpusRecord(existing) && isApiCorpusRecord(item))) unique.set(id, item);
  }
  return [...unique.values()];
}

function selectCorpusRecordsToAppend(existingItems, items) {
  const known = new Map();
  for (const item of existingItems) {
    if (!item?.tweet_id) continue;
    const id = String(item.tweet_id);
    known.set(id, Boolean(known.get(id) || isApiCorpusRecord(item)));
  }
  const selected = [];
  for (const item of items) {
    if (!item?.tweet_id) continue;
    const id = String(item.tweet_id);
    const verified = isApiCorpusRecord(item);
    if (known.has(id) && (known.get(id) || !verified)) continue;
    selected.push(item);
    known.set(id, verified);
  }
  return selected;
}

function getMetricAvailability(metrics = {}) {
  const keys = {
    likes: ['like_count', 'likes'],
    retweets: ['retweet_count', 'retweets'],
    bookmarks: ['bookmark_count', 'bookmarks'],
    impressions: ['impression_count', 'impressions']
  };
  return Object.fromEntries(Object.entries(keys).map(([name, aliases]) => {
    const value = aliases.map(key => metrics?.[key]).find(value => value !== undefined && value !== null);
    return [name, Number.isSafeInteger(value) && value >= 0];
  }));
}

function summarizeCorpusPatterns(items, limit = 32, options = {}) {
  const groups = new Map();
  const hooks = new Set(['numeric_contrast', 'loss_aversion', 'question_hook', 'curated_list', 'story_empathy', 'general_hook']);
  const ctas = new Set(['none', 'reply_thread', 'profile_link', 'save_bookmark']);
  for (const item of preferApiCorpusRecords(items)) {
    if (!/^\d+$/.test(String(item?.tweet_id || ''))) continue;
    if (options.peerFollowers && (!Number.isSafeInteger(item?.author_followers) ||
        item.author_followers < options.peerFollowers.min || item.author_followers > options.peerFollowers.max)) continue;
    const genre = typeof item.genre === 'string' && item.genre.trim()
      ? item.genre.trim().slice(0, 64) : 'unknown';
    const lang = ['ja', 'en'].includes(item.lang) ? item.lang : 'unknown';
    const hook = hooks.has(item.hookType) ? item.hookType : 'unknown';
    const cta = ctas.has(item.ctaType) ? item.ctaType : 'unknown';
    const format = item.postFormat === 'split_thread' ? 'split_thread' : 'single_impact';
    const source = isApiCorpusRecord(item) ? 'api_collected' : 'unverified';
    const key = JSON.stringify([genre, lang, hook, cta, format, source]);
    if (!groups.has(key)) groups.set(key, { genre, lang, hook, cta, format, source, samples: 0, likes: [], impressions: [], bookmarks: [], retweets: [] });
    const group = groups.get(key);
    group.samples++;
    for (const metric of ['likes', 'impressions', 'bookmarks', 'retweets']) {
      const value = item.metrics?.[metric];
      if (Number.isSafeInteger(value) && value >= 0 &&
          (item.metricAvailability?.[metric] === true || (!item.metricAvailability && value > 0))) {
        group[metric].push(value);
      }
    }
  }
  const median = values => {
    values.sort((a, b) => a - b);
    return values.length ? values[Math.floor((values.length - 1) / 2)] : null;
  };
  const ranked = [...groups.values()].map(group => ({
    genre: group.genre, lang: group.lang, hook: group.hook, cta: group.cta, format: group.format,
    source: group.source, samples: group.samples,
    ...Object.fromEntries(['likes', 'impressions', 'bookmarks', 'retweets'].map(metric => {
      const values = group[metric];
      return [metric, { available: values.length, median: median(values),
        min: values.length ? values[0] : null, max: values.length ? values[values.length - 1] : null }];
    }))
  })).sort((a, b) => b.samples - a.samples || a.genre.localeCompare(b.genre));
  const selected = [];
  const representedGenres = new Set();
  for (const group of ranked) {
    if (selected.length >= limit) break;
    if (!representedGenres.has(group.genre)) {
      representedGenres.add(group.genre);
      selected.push(group);
    }
  }
  for (const group of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(group)) selected.push(group);
  }
  return selected;
}

function getCorpusPatternSummary(limit = 32, options = {}) {
  if (!fs.existsSync(CORPUS_JSONL_FILE)) {
    console.warn('[JIT Corpus Read Warning]: コーパスファイルがありません。');
    return [];
  }
  const lines = fs.readFileSync(CORPUS_JSONL_FILE, 'utf8').split('\n');
  const items = [];
  let invalid = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line));
    } catch (err) {
      invalid++;
    }
  }
  if (invalid) console.warn(`[JIT Corpus Read Warning]: ${invalid}件の不正なレコードを除外しました。`);
  return summarizeCorpusPatterns(items, limit, options);
}

/**
 * 冒頭フック・本文構造・CTA・反響指標・分割長文（スレッド）・下剋上バズ（フォロワー対比）を多角分析
 * @param {string} text ツイート本文
 * @param {object} metrics public_metrics
 * @param {object} extra 追加コンテキスト (authorFollowers, isThread, threadTweets等)
 * @returns {object} 構造化解析結果
 */
function analyzeTweetStructure(text = '', metrics = {}, extra = {}) {
  const clean = String(text || '').trim();
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. 冒頭フック (最初の1〜2行)
  const openingHook = lines.slice(0, 2).join(' ');

  // 2. フックタイプの自動判定 (JA & EN 多ジャンル対応)
  let hookType = 'general_hook';
  const hasNumbers = (clean.match(/[0-9０-９]+/g) || []).length >= 2;
  const isContrast = /(?:だった|から|が|より|以前|昔|→|⇒|▶).*(?:に|へ|現在|いま|改善|倍|分|時間)/.test(clean) || 
    clean.includes('→') || 
    (/(?:from|scale|jumped|increased|dropped|cut|to|\$|%)/i.test(clean) && /(?:to|into|down to|up to)/i.test(clean));
  const isLossAversion = /(?:損|失敗|危険|後悔|NG|やめ|手動|消耗|無駄|落ち|削|ミス|落とし穴|致命的)/.test(openingHook) ||
    /(?:kill|mistake|waste|stop|burn|don't|fail|lose|worst|trap|myth|deadly|costing|ruining)/i.test(openingHook);
  const isQuestion = /(?:か？|ですか|でしょうか|知って|ませんか|どう|なぜ|本当)/.test(openingHook) ||
    /(?:\?|why|how to|what if|are you|did you|ever wonder|is it)/i.test(openingHook);
  const isCurated = /(?:選|まとめ|保存版|永久保存|手順|ロードマップ|ステップ|型|コツ|理由|教科書|大全|リスト|神|鉄則)/.test(openingHook) ||
    /(?:guide|playbook|framework|rules|steps|checklist|roadmap|cheat sheet|tools|resources|blueprint|lessons|principles)/i.test(openingHook);
  const isStory = /(?:昔|当時|実は|私も|最初は|創業|失敗談|振り返る|実話|体験談)/.test(openingHook) ||
    /(?:years ago|when i started|i spent|my journey|story|confession|in 202\d|back in|i used to)/i.test(openingHook);

  if (hasNumbers && isContrast) {
    hookType = 'numeric_contrast';
  } else if (isLossAversion) {
    hookType = 'loss_aversion';
  } else if (isQuestion) {
    hookType = 'question_hook';
  } else if (isCurated) {
    hookType = 'curated_list';
  } else if (isStory) {
    hookType = 'story_empathy';
  }

  // 3. リンク減衰チェック (本文に直リンクがあるか)
  const hasInBodyUrl = /https?:\/\/[^\s]+|t\.co\/[a-zA-Z0-9]+/.test(clean);

  // 4. CTA (行動喚起) タイプ (JA & EN 双対応)
  let ctaType = 'none';
  if (/(?:リプ欄|スレッド|ツリー|2段目|続きは|下に)/.test(clean) || /(?:reply|thread|read below|part 2|continued in)/i.test(clean)) {
    ctaType = 'reply_thread';
  } else if (/(?:プロフ|固定|固ツイ|BIO|リンク)/.test(clean) || /(?:profile|bio|link in|pinned|check out)/i.test(clean)) {
    ctaType = 'profile_link';
  } else if (/(?:保存|ブクマ|見返す|ストック)/.test(clean) || /(?:bookmark|save this|save for later|repost|retweet)/i.test(clean)) {
    ctaType = 'save_bookmark';
  }

  // 5. 分割長文・ツリー判定 (Single vs Split Thread: リプライに続きを書く長文構造)
  const hasThreadCue = /(?:🧵|[1１][\/／][0-9０-９n]|【(?:1|１)\/|1通目|ツリー|スレッド|続きはリプ|リプ欄に続き|thread|continued below|part 1)/i.test(clean);
  const isSplitThread = Boolean(extra.isThread || (Array.isArray(extra.threadTweets) && extra.threadTweets.length > 1) || hasThreadCue);
  const postFormat = isSplitThread ? 'split_thread' : 'single_impact';
  const threadLength = Array.isArray(extra.threadTweets) ? extra.threadTweets.length : (isSplitThread ? 2 : 1);

  // 6. エンゲージメント指標算出
  const likes = Number(metrics.like_count || metrics.likes || 0);
  const retweets = Number(metrics.retweet_count || metrics.retweets || 0);
  const replies = Number(metrics.reply_count || metrics.replies || 0);
  const quotes = Number(metrics.quote_count || metrics.quotes || 0);
  const bookmarks = Number(metrics.bookmark_count || metrics.bookmarks || 0);
  const impressions = Number(metrics.impression_count || metrics.impressions || 0);

  // 保存率 (高反響・永久保存版の判定基準)
  const bookmarkRate = likes > 0 ? Number((bookmarks / likes).toFixed(2)) : (metrics.bookmarkRate || 0);
  // 総合反響度スコア (純粋エンゲージメント)
  const viralityScore = metrics.viralityScore !== undefined 
    ? metrics.viralityScore 
    : Math.round((retweets * 2.5 + bookmarks * 3.0 + replies * 1.5 + likes * 0.5));

  // 7. 弱小アカウント下剋上バズ（フォロワー対比エンゲージメント率・異常値検知）
  // 大手アカウントが大きい数字を出すのは当たり前。フォロワーが少ないのにバズった投稿こそ「純粋なフック力」の証明。
  const authorFollowers = Number(extra.authorFollowers || metrics.authorFollowers || metrics.author_followers_count || 0);
  let outlierMultiplier = 0;
  let cloutAdjustedScore = viralityScore;
  let isUnderdogBuzz = false;

  if (authorFollowers > 0) {
    const totalEngagement = (likes * 1.0 + retweets * 2.5 + bookmarks * 3.0);
    outlierMultiplier = Number((totalEngagement / Math.max(authorFollowers, 50)).toFixed(2));

    // フォロワー規模が小さいアカウントほど、同じバズでもフック・内容の質が高いため重み付け
    const scaleFactor = Math.min(8.0, Math.max(0.6, (1200 / Math.max(authorFollowers, 100)) ** 0.5));
    cloutAdjustedScore = Math.round(viralityScore * scaleFactor);

    // 弱小アカウントなのにバズった異常値（フォロワー5000人未満で高倍率、またはフォロワー1000人未満で40+いいね/保存、またはフォロワー2.5万人未満で異常倍率）
    if ((authorFollowers < 5000 && outlierMultiplier >= 0.15) ||
        (authorFollowers < 1000 && (likes >= 40 || bookmarks >= 15)) ||
        (authorFollowers < 25000 && outlierMultiplier >= 0.40)) {
      isUnderdogBuzz = true;
    }
  }

  return {
    openingHook,
    hookType,
    postFormat,
    isSplitThread,
    threadLength,
    threadTweets: extra.threadTweets || null,
    hasInBodyUrl,
    ctaType,
    charLength: clean.length,
    lineCount: lines.length,
    isUnderdogBuzz,
    authorFollowers,
    outlierMultiplier,
    metrics: {
      likes,
      retweets,
      replies,
      quotes,
      bookmarks,
      impressions,
      bookmarkRate,
      viralityScore,
      cloutAdjustedScore,
      outlierMultiplier,
      isUnderdogBuzz,
      authorFollowers
    }
  };
}

/**
 * 収集したツイートを永続化（JSONLinesファイル ＆ Firestore）
 * @param {object} param0
 */
async function persistIntelligenceKnowledge({ items = [], saveJsonl = true, saveFirestore = true, ownerUid = null }) {
  if (!Array.isArray(items) || items.length === 0) return { savedCount: 0 };

  let savedCount = 0;

  // 1. JSONLines ファイルへの追記
  if (saveJsonl) {
    if (!fs.existsSync(CORPUS_DIR)) {
      fs.mkdirSync(CORPUS_DIR, { recursive: true });
    }

    const existingItems = [];
    if (fs.existsSync(CORPUS_JSONL_FILE)) {
      const content = fs.readFileSync(CORPUS_JSONL_FILE, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          existingItems.push(JSON.parse(line));
        } catch (e) {}
      }
    }

    let appendPayload = '';
    for (const item of selectCorpusRecordsToAppend(existingItems, items)) {
      appendPayload += JSON.stringify(item) + '\n';
      savedCount++;
    }

    if (appendPayload) {
      fs.appendFileSync(CORPUS_JSONL_FILE, appendPayload, 'utf8');
    }
  }

  // 2. Firestore への保存 (AI合議制がリアルタイムでクエリ可能にする)
  if (saveFirestore && db) {
    const batch = db.batch();
    let bCount = 0;

    for (const item of items) {
      const docRef = db.collection('ai_buzz_corpus').doc(String(item.tweet_id));
      batch.set(docRef, {
        ...item,
        ownerUid: ownerUid || 'system',
        updatedAt: new Date()
      }, { merge: true });
      bCount++;
      if (bCount >= 400) break; // Firestore batch 上限考慮
    }

    if (bCount > 0) {
      await batch.commit().catch(e => {
        console.warn('[Firestore Corpus Save Warning]:', e.message);
      });
    }
  }

  return { savedCount };
}

/**
 * 特定のベンチマークアカウント（@handle）からツイートを公式API経由で収集・構造化
 * @param {object} param0
 */
async function harvestUserTweets({ credentials, targetUsername, genre = 'general', lang = 'ja', maxResults = 10, ownerUid = null }) {
  const cleanHandle = String(targetUsername || '').trim().replace(/^@/, '');
  if (!cleanHandle) return { ok: false, error: 'targetUsername_missing' };

  const fetchRes = await lookupAnyUserProfileAndTweets(credentials, cleanHandle, maxResults);
  if (!fetchRes.ok || !fetchRes.user) {
    return { ok: false, error: fetchRes.error || 'failed_to_fetch_user' };
  }

  const authorFollowers = fetchRes.user?.public_metrics?.followers_count || 0;
  const rawTweets = fetchRes.tweets || [];
  const processedItems = [];

  // スレッド（同一conversation_id または連続返信）の検出
  const convMap = new Map();
  for (const tw of rawTweets) {
    const cId = tw.conversation_id || tw.id;
    if (!convMap.has(cId)) convMap.set(cId, []);
    convMap.get(cId).push(tw);
  }

  for (const tw of rawTweets) {
    const cId = tw.conversation_id || tw.id;
    const related = convMap.get(cId) || [];
    const isThread = related.length > 1;
    const threadTexts = isThread ? related.map(r => r.text) : null;

    const analysis = analyzeTweetStructure(tw.text, tw.metrics || {}, {
      authorFollowers,
      isThread,
      threadTweets: threadTexts
    });
    processedItems.push({
      tweet_id: tw.id,
      source: 'x_api_user_timeline',
      metricAvailability: getMetricAvailability(tw.metricsAvailable === false ? {} : tw.metrics),
      author_username: cleanHandle,
      author_name: fetchRes.user.name,
      author_followers: authorFollowers,
      text: tw.text,
      created_at: tw.createdAt || new Date().toISOString(),
      genre,
      lang,
      ...analysis,
      harvested_at: new Date().toISOString()
    });
  }

  // 永続化
  const persistRes = await persistIntelligenceKnowledge({
    items: processedItems,
    saveJsonl: true,
    saveFirestore: Boolean(db),
    ownerUid
  });

  return {
    ok: true,
    targetHandle: cleanHandle,
    totalFetched: rawTweets.length,
    savedCount: persistRes.savedCount,
    items: processedItems
  };
}

/**
 * 公式API v2 GET /2/tweets/search/recent によるキーワード検索＆収集 (多ジャンル・言語タグ・フォロワー数・スレッド対応)
 * @param {object} param0
 */
async function harvestSearchTweets({ credentials, query, genre = 'general', lang = 'ja', maxResults = 10, ownerUid = null }) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'query_missing' };

  const { apiKey, apiSecret, accessToken, accessTokenSecret, oauth2AccessToken } = credentials;
  const count = Math.min(50, Math.max(10, maxResults));

  // リツイートを除外し、日本語または指定言語をターゲット
  const finalQuery = `${q} -is:retweet`;
  const searchUrl = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(finalQuery)}&max_results=${count}&tweet.fields=created_at,public_metrics,text,entities,author_id,conversation_id,in_reply_to_user_id&expansions=author_id&user.fields=public_metrics,username,name`;

  let authHeader = '';
  if (oauth2AccessToken) {
    authHeader = `Bearer ${oauth2AccessToken.trim()}`;
  } else if (apiKey && apiSecret && accessToken && accessTokenSecret) {
    const oauthParams = {
      oauth_consumer_key: apiKey.trim(),
      oauth_token: accessToken.trim(),
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: '1.0'
    };
    const queryParams = {
      'query': finalQuery,
      'max_results': String(count),
      'tweet.fields': 'created_at,public_metrics,text,entities,author_id,conversation_id,in_reply_to_user_id',
      'expansions': 'author_id',
      'user.fields': 'public_metrics,username,name'
    };
    authHeader = generateOAuth1Header('GET', searchUrl, oauthParams, apiSecret.trim(), accessTokenSecret.trim(), queryParams);
  } else {
    return { ok: false, error: 'credentials_missing' };
  }

  try {
    const res = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'HybridSaaSClient/1.0'
      }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data.errors && data.errors[0]?.message) || `Search API failed (HTTP ${res.status})` };
    }

    if (!data.data || data.data.length === 0) {
      return { ok: true, query: q, genre, lang, totalFetched: 0, savedCount: 0, items: [] };
    }

    const userMap = new Map();
    if (data.includes && Array.isArray(data.includes.users)) {
      for (const u of data.includes.users) {
        userMap.set(u.id, u);
      }
    }

    const processedItems = [];
    for (const tw of data.data) {
      const authorUser = userMap.get(tw.author_id) || {};
      const authorFollowers = authorUser.public_metrics?.followers_count || 0;
      const isThread = Boolean(tw.conversation_id && tw.in_reply_to_user_id);
      const analysis = analyzeTweetStructure(tw.text, tw.public_metrics || {}, {
        authorFollowers,
        isThread
      });
      processedItems.push({
        tweet_id: tw.id,
        source: 'x_api_recent_search',
        metricAvailability: getMetricAvailability(tw.public_metrics),
        author_id: tw.author_id,
        author_username: authorUser.username || 'search_result',
        author_name: authorUser.name || 'search_result',
        author_followers: authorFollowers,
        text: tw.text,
        created_at: tw.created_at || new Date().toISOString(),
        search_query: q,
        genre,
        lang,
        ...analysis,
        harvested_at: new Date().toISOString()
      });
    }

    const persistRes = await persistIntelligenceKnowledge({
      items: processedItems,
      saveJsonl: true,
      saveFirestore: Boolean(db),
      ownerUid
    });

    return {
      ok: true,
      query: q,
      genre,
      lang,
      totalFetched: processedItems.length,
      savedCount: persistRes.savedCount,
      items: processedItems
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 蓄積されたコーパスから高反響フック・勝ちパターンを取得（AIプロンプト注入用、多ジャンル・言語別・下剋上バズ・分割長文フィルタ対応）
 * 「TOP10の同質化・偏りを防ぎ、他ジャンル（異業種）や弱小アカウント下剋上バズ、分割長文を含めて総合判断する」
 * @param {string|object} optionsOrHookType 絞り込みタイプまたはオプションオブジェクト
 * @param {number} limitParam 取得件数
 * @returns {Array} 高反響フック一覧
 */
function getTopPerformingHooks(optionsOrHookType = null, limitParam = 6) {
  if (!fs.existsSync(CORPUS_JSONL_FILE)) return [];

  let hookType = null;
  let genre = null;
  let lang = null;
  let limit = limitParam;
  let diversified = true;
  let includeCrossGenre = true;
  let includeUnderdogBuzz = true;
  let includeSplitThreads = true;
  let filterUnderdog = false;
  let preferFormat = null; // 'split_thread' | 'single_impact' | null

  if (typeof optionsOrHookType === 'string') {
    hookType = optionsOrHookType;
    diversified = false; // 明示的な単一フック指定時は従来互換（単一タイプ完全一致）
  } else if (typeof optionsOrHookType === 'object' && optionsOrHookType !== null) {
    hookType = optionsOrHookType.hookType || null;
    genre = optionsOrHookType.genre || null;
    lang = optionsOrHookType.lang || null;
    limit = optionsOrHookType.limit || limitParam;
    filterUnderdog = Boolean(optionsOrHookType.filterUnderdog);
    if (optionsOrHookType.diversified !== undefined) {
      diversified = Boolean(optionsOrHookType.diversified);
    }
    if (optionsOrHookType.includeCrossGenre !== undefined) {
      includeCrossGenre = Boolean(optionsOrHookType.includeCrossGenre);
    }
    if (optionsOrHookType.includeUnderdogBuzz !== undefined) {
      includeUnderdogBuzz = Boolean(optionsOrHookType.includeUnderdogBuzz);
    }
    if (optionsOrHookType.includeSplitThreads !== undefined) {
      includeSplitThreads = Boolean(optionsOrHookType.includeSplitThreads);
    }
    preferFormat = optionsOrHookType.preferFormat || null;
  }

  const raw = fs.readFileSync(CORPUS_JSONL_FILE, 'utf8');
  const lines = raw.split('\n');
  const parsedItems = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      parsedItems.push(JSON.parse(line));
    } catch (e) {}
  }
  const allItems = [];
  for (const j of preferApiCorpusRecords(parsedItems)) {
    if (!j || typeof j !== 'object') continue;
    if (lang && j.lang && j.lang !== lang) continue;
    if (hookType && j.hookType !== hookType) continue;
    if (filterUnderdog && !j.isUnderdogBuzz && !j.metrics?.isUnderdogBuzz) continue;
    const itemFormat = j.postFormat || (j.isSplitThread || (j.threadLength > 1) ? 'split_thread' : 'single_impact');
    if (preferFormat && itemFormat !== preferFormat) continue;
    allItems.push({ ...j, postFormat: itemFormat });
  }

  // 1. 非多様化（単純ソート：指定フック単一クエリやテスト互換）
  if (!diversified || allItems.length <= limit) {
    if (genre) {
      const genreItems = allItems.filter(i => i.genre === genre);
      if (genreItems.length >= limit) {
        genreItems.sort((a, b) => (b.metrics?.cloutAdjustedScore || b.metrics?.viralityScore || 0) - (a.metrics?.cloutAdjustedScore || a.metrics?.viralityScore || 0));
        return genreItems.slice(0, limit);
      }
    }
    allItems.sort((a, b) => (b.metrics?.cloutAdjustedScore || b.metrics?.viralityScore || 0) - (a.metrics?.cloutAdjustedScore || a.metrics?.viralityScore || 0));
    return allItems.slice(0, limit);
  }

  // 2. 総合判断・多ジャンル＆下剋上＆分割長文バランシングサンプリング
  // 「大手アカウントの当たり前な数字に惑わされず、弱小アカウント下剋上バズや他ジャンルの勝ちパターンをブレンド」
  const selectedIds = new Set();
  const result = [];

  // プールA: 弱小アカウント下剋上バズ (フォロワー対比で異常値を叩き出した純粋な勝ちパターン)
  const underdogPool = allItems.filter(i => (i.isUnderdogBuzz || i.metrics?.isUnderdogBuzz || (i.metrics?.outlierMultiplier >= 0.2)))
    .sort((a, b) => (b.metrics?.outlierMultiplier || 0) - (a.metrics?.outlierMultiplier || 0));

  // プールB: 分割長文・ツリー投稿 (リプライに続きを書く長文スレッド)
  const threadPool = allItems.filter(i => (i.postFormat === 'split_thread' || i.isSplitThread || (i.threadLength > 1)))
    .sort((a, b) => (b.metrics?.viralityScore || 0) - (a.metrics?.viralityScore || 0));

  // プールC: 対象ジャンル上位 (同業種の定石)
  const targetGenrePool = genre ? allItems.filter(i => i.genre === genre)
    .sort((a, b) => (b.metrics?.cloutAdjustedScore || b.metrics?.viralityScore || 0) - (a.metrics?.cloutAdjustedScore || a.metrics?.viralityScore || 0)) : [];

  // プールD: 他ジャンル（異業種）上位 (異業種転用・アナロジー思考用)
  const crossGenrePool = (genre && includeCrossGenre) 
    ? allItems.filter(i => i.genre && i.genre !== genre)
        .sort((a, b) => (b.metrics?.cloutAdjustedScore || b.metrics?.viralityScore || 0) - (a.metrics?.cloutAdjustedScore || a.metrics?.viralityScore || 0))
    : allItems.slice().sort((a, b) => (b.metrics?.cloutAdjustedScore || b.metrics?.viralityScore || 0) - (a.metrics?.cloutAdjustedScore || a.metrics?.viralityScore || 0));

  function addFromPool(pool, count) {
    let added = 0;
    for (const item of pool) {
      if (added >= count) break;
      const key = item.tweet_id || item.text;
      if (!selectedIds.has(key)) {
        selectedIds.add(key);
        result.push(item);
        added++;
        if (result.length >= limit) break;
      }
    }
  }

  // 1. 対象ジャンル (最大40%)
  if (targetGenrePool.length > 0) {
    addFromPool(targetGenrePool, Math.ceil(limit * 0.4));
  }
  // 2. 弱小アカウント下剋上バズ (約30%)
  if (includeUnderdogBuzz && underdogPool.length > 0 && result.length < limit) {
    addFromPool(underdogPool, Math.ceil(limit * 0.3));
  }
  // 3. 他ジャンル上位（異業種転用） (約25%)
  if (includeCrossGenre && crossGenrePool.length > 0 && result.length < limit) {
    addFromPool(crossGenrePool, Math.ceil(limit * 0.25));
  }
  // 4. 分割長文・ツリー投稿 (約20%)
  if (includeSplitThreads && threadPool.length > 0 && result.length < limit) {
    addFromPool(threadPool, Math.ceil(limit * 0.2));
  }

  // 残り枠を全体の上位（Clout Adjusted Score順）で埋める
  if (result.length < limit) {
    const remaining = allItems.slice().sort((a, b) => (b.metrics?.cloutAdjustedScore || b.metrics?.viralityScore || 0) - (a.metrics?.cloutAdjustedScore || a.metrics?.viralityScore || 0));
    addFromPool(remaining, limit - result.length);
  }

  return result.slice(0, limit);
}

module.exports = {
  analyzeTweetStructure,
  persistIntelligenceKnowledge,
  harvestUserTweets,
  harvestSearchTweets,
  getTopPerformingHooks,
  getMetricAvailability,
  selectCorpusRecordsToAppend,
  summarizeCorpusPatterns,
  getCorpusPatternSummary,
  CORPUS_JSONL_FILE
};
