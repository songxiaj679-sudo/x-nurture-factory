require('dotenv').config();
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hasXaiKey, completeText } = require('./grok_client');
const { db } = require('./firestore');

const X_API_KEY = (process.env.OFFICIAL_X_API_KEY || '').trim();
const X_API_SECRET = (process.env.OFFICIAL_X_API_SECRET || '').trim();
const X_ACCESS_TOKEN = (process.env.OFFICIAL_X_ACCESS_TOKEN || '').trim();
const X_ACCESS_SECRET = (process.env.OFFICIAL_X_ACCESS_SECRET || '').trim();
const AI_FOOTER = '\n\n※この記事はAIで書かれており自動的に投稿されたものです';
const STATE_FILE = path.join(__dirname, '../.official_bot_state.json');
const CONFIG_FILE = path.join(__dirname, '../config/official_bot_sources.json');
const MEDIA_DIR = path.join(__dirname, '../tmp_official_media');
const PROTO = 'https' + '://';

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

function cleanUrl(u) {
  let s = String(u || '').trim();
  const m = s.match(/\(([a-z]+:\/\/[^)]+)\)/i);
  if (m) return m[1];
  return s.replace(/^\[|\]$/g, '');
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {}
  return { usedTitles: [], postHistoryCount: 0, lastMentionId: null, repliedTweetIds: [], repliedConversationIds: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function loadBotConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {}
  return { custom_rss_feeds: [], custom_json_apis: [], custom_angles: [], priority_topics: [] };
}

function rfc3986Encode(str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildOAuth1Header(method, rawUrlStr, extraParams = {}) {
  const fullUrlStr = cleanUrl(rawUrlStr);
  const urlObj = new URL(fullUrlStr);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  const oauthParams = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: '1.0'
  };
  const allParams = { ...oauthParams, ...extraParams };
  for (const [k, v] of urlObj.searchParams.entries()) allParams[k] = v;

  const paramString = Object.keys(allParams).sort().map(k => `${rfc3986Encode(k)}=${rfc3986Encode(allParams[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${rfc3986Encode(baseUrl)}&${rfc3986Encode(paramString)}`;
  const signingKey = `${rfc3986Encode(X_API_SECRET)}&${rfc3986Encode(X_ACCESS_SECRET)}`;
  oauthParams.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  return 'OAuth ' + Object.keys(oauthParams).sort().map(k => `${rfc3986Encode(k)}="${rfc3986Encode(oauthParams[k])}"`).join(', ');
}

function requestXApi(method, rawEndpoint, payloadObj = null, formParams = null) {
  const endpoint = cleanUrl(rawEndpoint);
  return new Promise((resolve, reject) => {
    let bodyStr = '';
    const headers = { 'User-Agent': 'VeloxSystemsOfficialMediaBot/6.4', 'Accept': 'application/json' };
    if (formParams) {
      headers['Authorization'] = buildOAuth1Header(method, endpoint, formParams);
      bodyStr = Object.keys(formParams).map(k => `${rfc3986Encode(k)}=${rfc3986Encode(formParams[k])}`).join('&');
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    } else {
      headers['Authorization'] = buildOAuth1Header(method, endpoint);
      if (payloadObj) {
        bodyStr = JSON.stringify(payloadObj);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }
    }
    const req = https.request(endpoint, { method, headers, timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed || data, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request Timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function fetchBufferFollowRedirects(rawTargetUrl, maxRedirects = 5) {
  const targetUrl = cleanUrl(rawTargetUrl);
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    const req = https.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 VeloxMediaAggregator/6.4', 'Accept': '*/*' },
      timeout: 12000
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        return resolve(fetchBufferFollowRedirects(nextUrl, maxRedirects - 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchAllExternalSources() {
  const config = loadBotConfig();
  const collected = [];
  const tasks = [];

  for (const feed of (config.custom_rss_feeds || [])) {
    tasks.push(async () => {
      const buf = await fetchBufferFollowRedirects(feed.url);
      const xml = buf.toString('utf8');
      const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
      for (const item of items.slice(0, feed.limit || 3)) {
        const t = ((item.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')
          .replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        let link = ((item.match(/<link[^>]*>([^<]+)<\/link>/i) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        if (!link) {
          link = ((item.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1] || '').trim();
        }
        const mediaMatch = item.match(/(?:<media:content|<enclosure)[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i)
          || item.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
        const imageUrl = mediaMatch ? mediaMatch[1] : null;
        if (t) collected.push({ source: feed.name, title: t, url: link || feed.url, imageUrl });
      }
    });
  }

  for (const api of (config.custom_json_apis || [])) {
    tasks.push(async () => {
      const buf = await fetchBufferFollowRedirects(api.url);
      const json = JSON.parse(buf.toString('utf8'));
      if (api.type === 'hn') {
        for (const h of (json.hits || [])) {
          if (h.title) collected.push({ source: api.name, title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, imageUrl: null });
        }
      } else if (api.type === 'qiita' && Array.isArray(json)) {
        for (const item of json.slice(0, 6)) {
          if (item.title) collected.push({ source: 'Qiita', title: item.title, url: item.url || 'https://qiita.com', imageUrl: null });
        }
      } else if (api.type === 'zenn') {
        for (const a of (json.articles || []).slice(0, 6)) {
          if (a.title) collected.push({ source: 'Zenn', title: a.title, url: a.path ? `https://zenn.dev${a.path}` : 'https://zenn.dev', imageUrl: null });
        }
      } else if (api.type === 'github') {
        for (const repo of (json.items || []).slice(0, 6)) {
          if (repo.full_name) {
            const desc = repo.description ? ` - ${repo.description.slice(0, 80)}` : '';
            collected.push({ source: 'GitHub', title: `[GitHub] ${repo.full_name}${desc}`, url: repo.html_url || 'https://github.com', imageUrl: null });
          }
        }
      } else if (api.type === 'devto' && Array.isArray(json)) {
        for (const art of json.slice(0, 5)) {
          if (art.title) collected.push({ source: 'DEV Community', title: art.title, url: art.url || 'https://dev.to', imageUrl: art.cover_image || null });
        }
      } else if (Array.isArray(json)) {
        for (const item of json.slice(0, 5)) {
          if (item.title) collected.push({ source: api.name, title: item.title, url: item.url || '', imageUrl: null });
        }
      }
    });
  }

  await Promise.allSettled(tasks.map(fn => fn()));
  return collected;
}

async function verifyCredentialsOfficialV2() {
  for (const domain of ['api.x.com', 'api.twitter.com']) {
    const host = `${PROTO}${domain}`;
    const res = await requestXApi('GET', `${host}/2/users/me`);
    if (res.statusCode === 200 && res.body?.data) {
      return { host, userId: String(res.body.data.id), username: res.body.data.username, name: res.body.data.name };
    }
  }
  throw new Error('OAuth 1.0a 認証に失敗しました。');
}

async function postTweetOfficialV2(apiHost, text, replyToTweetId = null, mediaIds = []) {
  const payloadObj = { text };
  if (replyToTweetId) payloadObj.reply = { in_reply_to_tweet_id: String(replyToTweetId) };
  if (mediaIds && mediaIds.length > 0) payloadObj.media = { media_ids: mediaIds.map(String) };
  const res = await requestXApi('POST', `${apiHost}/2/tweets`, payloadObj);
  if (res.statusCode >= 200 && res.statusCode < 300 && res.body?.data?.id) return res.body.data;
  throw new Error(`HTTP ${res.statusCode}: ${res.raw}`);
}

function calcXWeight(str) {
  let len = 0;
  for (const ch of String(str || '')) len += (ch.codePointAt(0) <= 0x10FF) ? 1 : 2;
  return len;
}

function stripExternalLinks(str) {
  return String(str || '').replace(/[a-z]+:\/\/[^\s]+/gi, '').replace(/\b[a-z0-9.-]+\.(com|jp|net|org|io|ai|co)\b/gi, '').trim();
}

function smartTrimToWeight(body, maxWeight) {
  let s = String(body || '').trim();
  if (calcXWeight(s) <= maxWeight) return s;
  const sentences = s.match(/[^。！？\n]+[。！？\n]?/g) || [s];
  let acc = '';
  for (const sent of sentences) {
    if (calcXWeight(acc + sent) <= maxWeight) acc += sent; else break;
  }
  if (acc.trim().length >= 35) return acc.trim();
  let trimmed = s;
  while (calcXWeight(trimmed + '。') > maxWeight && trimmed.length > 0) trimmed = trimmed.slice(0, -1);
  trimmed = trimmed.replace(/[、，・\s]+$/, '');
  return /[。！？]$/.test(trimmed) ? trimmed : trimmed + '。';
}

async function callGeminiWithSearch(promptText) {
  if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');
  const plain = await completeText({ tier: 'quality', prompt: promptText, timeoutMs: 90000 });
  return plain.text.trim();
}

async function checkAndAutoReplyMentions() {
  const state = loadState();
  if (!Array.isArray(state.repliedTweetIds)) state.repliedTweetIds = [];
  if (!Array.isArray(state.repliedConversationIds)) state.repliedConversationIds = [];

  const auth = await verifyCredentialsOfficialV2();
  const params = new URLSearchParams({
    max_results: '10',
    'tweet.fields': 'author_id,conversation_id,created_at,in_reply_to_user_id,text',
    expansions: 'author_id',
    'user.fields': 'name,username'
  });
  if (state.lastMentionId && state.lastMentionId !== 'INIT_DONE') {
    params.set('since_id', String(state.lastMentionId));
  }

  const endpoint = `${auth.host}/2/users/${auth.userId}/mentions?${params.toString()}`;
  const res = await requestXApi('GET', endpoint);
  if (res.statusCode !== 200) return;

  const mentions = res.body?.data || [];
  if (!state.lastMentionId) {
    state.lastMentionId = mentions.length > 0 ? String(mentions[0].id) : 'INIT_DONE';
    saveState(state);
    return;
  }
  if (mentions.length === 0) return;

  const usersMap = {};
  for (const u of (res.body?.includes?.users || [])) usersMap[String(u.id)] = u;

  const chronological = [...mentions].reverse();
  let repliedCount = 0;

  for (const m of chronological) {
    const mId = String(m.id);
    const authorId = String(m.author_id || '');
    const convId = String(m.conversation_id || mId);
    state.lastMentionId = mId;

    if (authorId === auth.userId) continue;
    if (state.repliedTweetIds.includes(mId)) continue;
    if (state.repliedConversationIds.includes(`${convId}_${authorId}`)) continue;
    if (repliedCount >= 2) break;

    const sender = usersMap[authorId] || { username: 'user', name: '読者さん' };
    const judgePrompt = `読者（${sender.name}）から以下のリプライが届きました。スパムでなければ70〜120文字の親しみやすい口語で返信を作成しJSONで出力してください。\n内容: ${m.text}\n{"should_reply":true,"reply_text":"返信文"}`;

    try {
      if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');
      let rawRes = (await completeText({ tier: 'quality', prompt: judgePrompt, json: true })).text.trim();
      const jsonMatch = rawRes.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const decision = JSON.parse(jsonMatch[0]);
      state.repliedTweetIds.push(mId);
      if (!decision.should_reply || !decision.reply_text) {
        saveState(state);
        continue;
      }
      const cleanReply = smartTrimToWeight(stripExternalLinks(decision.reply_text), 260);
      await new Promise(r => setTimeout(r, 8000));
      await postTweetOfficialV2(auth.host, cleanReply, mId);
      state.repliedConversationIds.push(`${convId}_${authorId}`);
      saveState(state);
      repliedCount++;
    } catch (e) {}
  }
  saveState(state);
}

async function saveOfficialArticleToFirestore(topic, contentText, tweetId, username, extraMeta = {}) {
  try {
    let category = extraMeta.category || 'Xアルゴリズム解説';
    if (/シャドウバン|バン|制限|凍結|ロック/.test(topic + contentText)) category = 'シャドウバン対策';
    else if (/API|自動化|プログラム|開発|GitHub|Qiita|Zenn/i.test(topic + contentText)) category = '公式API・自動化講座';
    const docId = tweetId ? String(tweetId) : ('art_' + Date.now());
    await db.collection('official_posts').doc(docId).set({
      tweetId: tweetId ? String(tweetId) : null,
      username: username || 'VeloxPostApp',
      category,
      title: String(topic || 'X最新アルゴリズム＆プログラム解説').trim().slice(0, 90),
      text: String(contentText || '').trim().slice(0, 3200),
      sourceName: String(extraMeta.sourceName || 'Qiita / Zenn / GitHub / Global Tech').slice(0, 80),
      sourceUrl: String(extraMeta.sourceUrl || 'https://github.com/twitter/the-algorithm').slice(0, 300),
      imageUrl: extraMeta.imageUrl ? String(extraMeta.imageUrl).slice(0, 300) : null,
      diagramData: extraMeta.diagramData || null,
      createdAt: new Date()
    }, { merge: true });
    console.log(`  💾 [Webメディア同期完了] 公式サイトDB (official_posts/${docId}) に自動掲載しました！`);

    const allSnap = await db.collection('official_posts').orderBy('createdAt', 'desc').get();
    if (allSnap.size > 300) {
      const batch = db.batch();
      allSnap.docs.slice(300).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn(`  ⚠️ Firestore記事保存スキップ: ${e.message}`);
  }
}

async function generatePremiumLongPostContent() {
  const config = loadBotConfig();
  console.log('🌐 設定ファイルから世界中の最新ニュース・技術記事(Qiita/Zenn/GitHub/海外RSS)を収集中...');
  const liveTrends = await fetchAllExternalSources();
  console.log(`  📡 外部ソースから計 ${liveTrends.length} 件のリアルタイムトピックを取得しました！`);

  const state = loadState();
  if (!Array.isArray(state.usedTitles)) state.usedTitles = [];

  const freshTrends = liveTrends.filter(item => !state.usedTitles.includes(item.title));
  const targetPool = freshTrends.length > 0 ? freshTrends : liveTrends;
  const trendListText = targetPool.slice(0, 18).map((t, i) => `${i + 1}. [${t.source}] ${t.title} (URL: ${t.url || 'なし'})`).join('\n');
  const todayStr = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const anglesPool = (config.custom_angles?.length > 0) ? config.custom_angles : ['Xの最新トレンドとシャドウバン対策解説'];
  const currentAngle = anglesPool[(state.postHistoryCount || 0) % anglesPool.length];

  const prompt = `あなたはX（旧Twitter）のアルゴリズム・シャドウバン対策・関連プログラムを徹底研究している人間の専門アナリストです。
本日（${todayStr}）外部API（Qiita / Zenn / GitHub / 海外テックメディア）から収集した最新トピックとGoogle検索の最新情報を掛け合わせて、「冒頭10秒で結論がわかり、本文ではその根拠やアップデート背景を親しみやすい口語でしっかり掘り下げた解説記事（1,000〜1,500文字）」を作成してください。

【外部APIからリアルタイム収集した最新トピック】
${trendListText || 'Xの最新アルゴリズム、滞在時間重視アップデート、シャドウバン解除検証、公式API自動化'}

【今回の解説テーマ・切り口】
${currentAngle}

【絶対遵守ルール】
1. 読者に語りかけるような親しみやすい口語表現（「実はこれ、〜というアップデートが入ったからなんです」「この記事やGitHubの公開コードでこう解説されているんですよね」など）で書くこと。
2. 抽象的な薄い話は厳禁！必ず以下の【3部構成の見出し】を使って、根拠と背景を深く具体的に書くこと：
■ 🔍 根拠と最新動向：どこでどう解説・アップデートされた？
（参考にしたQiita/Zenn/GitHubや海外メディアの記事で何が報告されたか、Xのどの仕様・アルゴリズムがどう変わったのかを具体的に紹介する）

■ ⚙️ 裏側の仕組み：なぜそうなるのか？（具体的な数字と理由）
（なぜその現象が起きるのか、内部スコアの倍率や秒数・回数のボーダーライン、❌ダメな例と⭕️良い例の比較を交えてわかりやすく噛み砕く）

■ 💡 今日からできる実践アクション
（初心者でも今日すぐ試せる具体的な設定確認や運用のコツをステップ形式でまとめる）

3. long_post には生のURL文字列（http〜）は含めず、代わりに "source_name" と "source_url" に情報元のメディア名・記事名を正確に入れること。また記事本文中に「AIが書いた」等の文言は一切入れないこと。

【出力JSONフォーマット】
{
  "selected_topic": "記事の魅力的な見出しタイトル（32〜52文字）",
  "source_name": "具体的な情報源（例: Qiita 技術検証レポート / GitHub the-algorithm / Search Engine Journal 等）",
  "source_url": "参考にした元記事URL（なければ https://github.com/twitter/the-algorithm ）",
  "diagram_data": {
    "badge_metric": "注目指標（例: 検索表示率 +240% / 滞在時間 2.5倍 / 凍結リスク -90% など18文字以内）",
    "bad_points": ["❌ NG行動1（24文字以内）", "❌ NG行動2（24文字以内）"],
    "good_points": ["⭕️ 改善策1（24文字以内）", "⭕️ 改善策2（24文字以内）"],
    "steps": ["1. 結論ポイント1（24文字以内）", "2. 結論ポイント2（24文字以内）", "3. 結論ポイント3（24文字以内）"]
  },
  "long_post": "ここに【■ 🔍 根拠と最新動向】【■ ⚙️ 裏側の仕組み】【■ 💡 今日からできる実践アクション】の3部構成で1,000〜1,500文字の濃厚な口語解説本文を入れる",
  "fallback_thread": ["予備1(90〜105字)", "予備2(90〜105字)", "予備3(90〜105字)", "予備4(60〜70字)"]
}`;

  const rawText = await callGeminiWithSearch(prompt);
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON抽出失敗');
  const parsed = JSON.parse(jsonMatch[0]);
  const cleanLongPost = stripExternalLinks(parsed.long_post || '');
  const cleanFallback = (parsed.fallback_thread || []).slice(0, 4).map(p => stripExternalLinks(p));

  let matchedUrl = parsed.source_url || '';
  for (const item of targetPool) {
    if (!matchedUrl && item.url) matchedUrl = item.url;
  }

  if (parsed.selected_topic) {
    state.usedTitles.push(parsed.selected_topic);
    if (state.usedTitles.length > 80) state.usedTitles = state.usedTitles.slice(-80);
  }
  state.postHistoryCount = (state.postHistoryCount || 0) + 1;
  saveState(state);

  return {
    topic: parsed.selected_topic || 'X最新アルゴリズム＆シャドウバン対策解説',
    longPost: cleanLongPost,
    fallbackThread: cleanFallback,
    extraMeta: {
      sourceName: parsed.source_name || 'Qiita / Zenn / GitHub 技術解析',
      sourceUrl: matchedUrl || 'https://github.com/twitter/the-algorithm',
      diagramData: parsed.diagram_data || null
    }
  };
}

async function publishOfficialContent(webOnly = false) {
  console.log('\n============================================================');
  console.log(`📡 【VELOX自動調査メディア生成開始 (${webOnly ? 'HP記事追加' : 'HP記事＋X同時配信'})】 ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

  const { topic, longPost, fallbackThread, extraMeta } = await generatePremiumLongPostContent();
  console.log(`🎯 生成タイトル: ${topic}`);
  await saveOfficialArticleToFirestore(topic, longPost, null, 'VeloxPostApp', extraMeta);

  if (webOnly) {
    console.log('✅ [HP自動更新完了] ホームページへの新着記事掲載が完了しました！');
    return true;
  }

  try {
    const auth = await verifyCredentialsOfficialV2();
    const fullLongText = `${longPost}${AI_FOOTER}`;
    try {
      const resData = await postTweetOfficialV2(auth.host, fullLongText, null, []);
      console.log(`  🎉 X長文ポスト送信成功！ Tweet ID: ${resData.id}`);
      await saveOfficialArticleToFirestore(topic, longPost, resData.id, auth.username, extraMeta);
      return true;
    } catch (e) {
      console.warn(`  ⚠️ 長文送信制限 (${e.message}) -> スレッドへ切替`);
    }

    let parentTweetId = null;
    for (let i = 0; i < fallbackThread.length; i++) {
      const pageTag = `【${i + 1}/${fallbackThread.length}】\n`;
      const suffix = (i === fallbackThread.length - 1) ? AI_FOOTER : '';
      const text = `${pageTag}${smartTrimToWeight(fallbackThread[i], 276 - calcXWeight(pageTag) - calcXWeight(suffix))}${suffix}`;
      const resData = await postTweetOfficialV2(auth.host, text, parentTweetId, []);
      parentTweetId = resData.id;
      if (i < fallbackThread.length - 1) await new Promise(r => setTimeout(r, 15000));
    }
    return true;
  } catch (xErr) {
    console.warn(`  ℹ️ X投稿はスキップされましたが、ホームページの記事更新は完了しています (${xErr.message})`);
    return true;
  }
}

(async () => {
  if (process.argv.includes('--web-only')) {
    await publishOfficialContent(true).catch(e => console.error('❌ HP記事生成エラー:', e.message));
    process.exit(0);
  }
  if (process.argv.includes('--now')) {
    await publishOfficialContent(false).catch(e => console.error('❌ 配信エラー:', e.message));
    process.exit(0);
  }
  if (process.argv.includes('--check-replies')) {
    await checkAndAutoReplyMentions().catch(e => console.error('❌ リプライ巡回エラー:', e.message));
    process.exit(0);
  }

  console.log('🕰️ VELOX全自動メディアエンジン待機開始 [1日6回 (01/05/09/13/17/21時 JST) 自動でHP記事を追加します]');
  await checkAndAutoReplyMentions().catch(() => {});

  let lastReplyCheckMin = -1;
  setInterval(async () => {
    const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
    const dateStr = nowJst.toISOString().slice(0, 10);
    const hour = nowJst.getUTCHours();
    const min = nowJst.getUTCMinutes();

    if ([1, 5, 9, 13, 17, 21].includes(hour) && min === 0) {
      const slotKey = `${dateStr}_${hour}`;
      const state = loadState();
      if (state.lastExecutedSlot !== slotKey) {
        state.lastExecutedSlot = slotKey;
        saveState(state);
        const isWebOnlySlot = [1, 5, 17].includes(hour);
        await new Promise(r => setTimeout(r, 5000 + Math.floor(Math.random() * 15000)));
        await publishOfficialContent(isWebOnlySlot).catch(e => console.error('❌ 自動メディア更新エラー:', e.message));
      }
    }

    if ((min % 15 === 5) && min !== lastReplyCheckMin) {
      lastReplyCheckMin = min;
      await checkAndAutoReplyMentions().catch(() => {});
    }
  }, 25000);
})();
