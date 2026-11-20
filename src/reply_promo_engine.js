const { extractTweetIdFromCreateTweetBody } = require('./saas_outreach_worker');
const { generateEmpathyBridgeReply } = require('./ai_campaign_builder');
const { recordBoostActionDone } = require('./hybrid_boost_manager');
const { runOfficialAutonomousEngagement, syncOfficialPostMetricsAndEvolve, syncAllActiveCustomersPostMetrics, sanitizePostOrReplyText } = require('./official_api_client');
const { launchAutopilotCampaign } = require('./autonomous_promo_ai');
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {
  db,
  updateAccountState,
  updateAccountData,
  getAccountsByLifecycleStatuses,
  withAccountLock,
} = require('./firestore');
const {
  getAccountLifecycleStatus,
} = require('./account_state');
const { getResidentialProxyForAccount } = require('./iproyal');
const { readStoredUserAgent } = require('./browser_config');
const { accountAgeDays, isPureFactoryAccount } = require('./search_audit_policy');
const { applyInheritedDeviceAndUa } = require('./v3_post_executor');
const { acquireTokenLock, releaseTokenLock } = require('./token_mutex');

const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const CACHE_DIR = path.join(__dirname, '../.saas_browser_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const DEFAULT_OFFICIAL_USERNAME = 'VeloxSystemsV4';
const OFFICIAL_SUPPORT_USER_IDS = ['WEB-GOOGLE-D12E2479A76266AEA2B4', 'USR-MVUA1GLP-D640'];
const _busyTokensCache = new Map();

// 🎯 見込み客アプローチ用のターゲット検索キーワード群
const PROSPECT_SEARCH_KEYWORDS = [
  'SNS運用 疲れた',
  'SNS運用 効率化',
  'X集客 自動化',
  'アカウント凍結 不安',
  'B2B集客 運用工数',
  'リード獲得 自動化',
  '公式API 自動投稿'
];

let _currentKeywordIndex = 0;

function appendAiReplyTerminalLog(userId, laneNo, msg) {
  try {
    if (!userId) return;
    const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    const lNo = Math.min(3, Math.max(1, parseInt(laneNo || '2', 10)));
    const logFile = '/tmp/xsw_term_' + cleanUid + '_L' + lNo + '.json';
    const jstIso = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
    const ts = jstIso.slice(5, 10).replace('-', '/') + ' ' + jstIso.slice(11, 19);
    const line = '[' + ts + '] [LANE #0' + lNo + '] 🌱 [AI Reply & Outreach] ' + msg;
    let arr = [];
    if (fs.existsSync(logFile)) {
      try { arr = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (e) { arr = []; }
    }
    if (!Array.isArray(arr)) arr = [];
    arr.push(line);
    if (arr.length > 80) arr = arr.slice(arr.length - 80);
    fs.writeFileSync(logFile, JSON.stringify(arr), 'utf8');
  } catch (e) {}
}

function loadRepliedLedger(userId) {
  const cleanUid = String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  const file = `/tmp/xsw_replied_${cleanUid}.json`;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        file,
        tweetIds: new Set(Array.isArray(parsed.tweetIds) ? parsed.tweetIds : []),
        usernames: new Set(Array.isArray(parsed.usernames) ? parsed.usernames : [])
      };
    }
  } catch (e) {}
  return { file, tweetIds: new Set(), usernames: new Set() };
}

function saveRepliedLedger(ledger, tweetId, username) {
  try {
    if (tweetId) ledger.tweetIds.add(String(tweetId));
    if (username) ledger.usernames.add(String(username).toLowerCase());
    const tArr = Array.from(ledger.tweetIds).slice(-600);
    const uArr = Array.from(ledger.usernames).slice(-400);
    fs.writeFileSync(ledger.file, JSON.stringify({ tweetIds: tArr, usernames: uArr }), 'utf8');
  } catch (e) {}
}

// 動画ストリーム (.mp4/.m3u8) のみ安全に遮断し、プロキシ帯域を節約
async function applySafeVideoOnlyBlocker(page) {
  try {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', {
      urls: [
        '*.mp4*', '*.m3u8*', '*.m4s*', '*.webm*', '*.ts*', '*.mov*',
        '*video.twimg.com*', '*pscp.tv*', '*periscope.tv*',
        '*pbs.twimg.com/ext_tw_video_thumb*', '*pbs.twimg.com/amplify_video_thumb*', '*pbs.twimg.com/tweet_video_thumb*',
        '*ciscobinary.openh264.org*', '*filters.adtidy.org*', '*gvt1.com*',
        '*safebrowsing.googleapis.com*', '*clients2.googleusercontent.com*', '*mtalk.google.com*', '*update.googleapis.com*'
      ]
    });
  } catch (e) {}
}

function checkProxyHasBandwidth(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return Promise.resolve(true);
  return new Promise((resolve) => {
    const auth = (proxy.user && proxy.pass) ? 'Basic ' + Buffer.from(proxy.user + ':' + proxy.pass).toString('base64') : '';
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: 'x.com:443',
      headers: auth ? { 'Proxy-Authorization': auth } : {},
      timeout: 7000
    });
    req.on('connect', (res, socket) => {
      try { socket.destroy(); } catch (e) {}
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function getPersistentProfileDir(prefix, token) {
  const tokenHash = crypto.createHash('md5').update(String(token || '').trim()).digest('hex').slice(0, 12);
  const dir = path.join(CACHE_DIR, prefix + '_' + tokenHash);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
    try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
  });
  return dir;
}

function slimBrowserCache(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  ['Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Default/Service Worker', 'ShaderCache', 'Crashpad'].forEach(sub => {
    try { fs.rmSync(path.join(dir, sub), { recursive: true, force: true }); } catch (e) {}
  });
}

async function humanTyping(page, text) {
  const dummyKeys = 'asdfjkl;qwerty';
  const chars = Array.from(String(text || ''));
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (Math.random() < 0.02 && char.length === 1 && char.charCodeAt(0) < 255 && char !== '\n' && char !== ' ') {
      const wrongChar = dummyKeys[Math.floor(Math.random() * dummyKeys.length)];
      await page.keyboard.sendCharacter(wrongChar);
      await new Promise(r => setTimeout(r, 95 + Math.random() * 150));
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, 120 + Math.random() * 180));
    }
    if (char === '\n') await page.keyboard.press('Enter');
    else await page.keyboard.sendCharacter(char);
    await new Promise(r => setTimeout(r, 32 + Math.random() * 75));
    if (Math.random() < 0.015) await new Promise(r => setTimeout(r, 600 + Math.random() * 1100));
  }
}

async function inspectAccountViaInternalApi(page) {
  const cookies = await page.cookies().catch(() => []);
  const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
  if (!ct0) return { apiChecked: false };
  return await page.evaluate(async (bearer, csrf) => {
    try {
      const res = await fetch('https://x.com/i/api/1.1/account/settings.json', {
        credentials: 'include',
        headers: { 'authorization': 'Bearer ' + bearer, 'x-csrf-token': csrf, 'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session' }
      });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.errors)) {
        for (const err of data.errors) {
          if (err.code === 64) return { apiChecked: true, status: 'unavailable', reason: 'frozen(API_64)' };
          if (err.code === 326) return { apiChecked: true, status: 'robot', reason: 'locked(API_326)' };
          if (err.code === 32 || err.code === 89) return { apiChecked: true, status: 'unavailable', reason: 'logged_out' };
        }
      }
      if (data.suspended === true) return { apiChecked: true, status: 'unavailable', reason: 'suspended' };
      return { apiChecked: true, status: 'ok', screenName: data.screen_name || null };
    } catch (e) { return { apiChecked: false }; }
  }, X_WEB_BEARER, ct0).catch(() => ({ apiChecked: false }));
}

async function runNaturalHomeNurturing(page, logFn) {
  logFn('🌱 [育成フェーズ1] ホームタイムラインをスクロールし、自然な閲覧行動を行います...');
  for (let s = 0; s < 2; s++) {
    await page.evaluate(() => window.scrollBy(0, 380 + Math.random() * 380)).catch(() => {});
    await new Promise(r => setTimeout(r, 2200 + Math.random() * 1600));
  }
  const clicked = await page.evaluate(() => {
    const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    if (tweets.length > 2) {
      const target = tweets[1 + Math.floor(Math.random() * Math.min(4, tweets.length - 2))];
      if (target) {
        const timeLnk = target.querySelector('time')?.closest('a');
        if (timeLnk) { timeLnk.click(); return true; }
      }
    }
    return false;
  }).catch(() => false);

  if (clicked) {
    logFn('  👀 [育成フェーズ2] タイムライン上の一般ポストを開いて熟読中 (Dwell Time 育成)...');
    await new Promise(r => setTimeout(r, 4200 + Math.random() * 2800));
    await page.evaluate(() => window.scrollBy(0, 260 + Math.random() * 260)).catch(() => {});
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1800));
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2200 + Math.random() * 1500));
  }
}

const OFFICIAL_SUPPORT_REPLIES_JA = [
  '朝の30分が積み重なると月30時間…数字で見せられるとハッとしますね。すごく参考になりました！見返せるように保存しました。',
  '手作業で疲弊していたのでめちゃくちゃ共感しました。感情論じゃなくて仕組みで解決するの本当に大事ですね。勉強になります！',
  'これ本当に現場のリアルな課題そのものですね…！すごく参考になりました。ブックマークしておきます。',
  '努力の方向性を変えるという視点、深く刺さりました。固定記事もじっくり読ませていただきます！',
  '「熱量任せの手作業は知性を守る解ではない」という言葉にハッとさせられました。とても有益な知見をありがとうございます！'
];

// 一般の見込み客に対して、売り込みを一切せず「めちゃくちゃ分かります」と純粋に共感するテンプレート
const NATURAL_EMPATHY_FALLBACKS = [
  'これめちゃくちゃ分かります…！手作業で回してると本当にリソース削られますよね。同じ悩み抱えてたので思わず共感してしまいました。',
  '分かりみが深すぎます…。現場でやってるとどうしても思考がすり減りますよね。本当にお疲れ様です…！',
  '激しく共感です。自分も試行錯誤してますが、感情論じゃなくて仕組み化していかないと本業が圧迫されるのリアルですよね。',
  'リアルな課題感ですね…！毎日コツコツやろうとするほど時間が溶けていくのすごく分かります。'
];

const { hasXaiKey, completeText } = require('./grok_client');

async function generateNaturalHelpfulReply(postSnippet, author) {
  if (hasXaiKey() && postSnippet) {
    try {
      const prompt = `以下のX投稿に対して、純粋に「すごく参考になった」「ハッとさせられた」と深く共感し保存したことを伝える自然な感想リプライ（全角45〜85文字）を1つだけ出力してください。
【厳守ルール】
・売り込みや宣伝口調、AI臭い敬語羅列は絶対禁止。「現場で悩んでたので刺さりました」「見返せるように保存しました」といった生身の読者目線で書くこと。
・URL、ハッシュタグ、@メンションは入れないこと。
・【最重要・文字数注記の絶対禁止】文章末尾や文頭に「（80文字）」「文字数: 〇」などの文字数カウントや注記、解説は絶対に出力に含めないこと。そのまま投稿される本文のみを出力すること。
投稿内容: ${postSnippet.slice(0, 200)}`;
      let text = (await completeText({ tier: 'quality', prompt })).text.trim();
      text = sanitizePostOrReplyText(text);
      if (text.length >= 15 && text.length <= 110) return text;
    } catch (e) {}
  }
  return OFFICIAL_SUPPORT_REPLIES_JA[Math.floor(Math.random() * OFFICIAL_SUPPORT_REPLIES_JA.length)];
}

async function generatePureEmpathyReply(tweetText, author) {
  if (hasXaiKey() && tweetText) {
    try {
      const prompt = `以下のXユーザーの悩みや苦労ポストに対して、一切の売り込みや商品紹介・宣伝（プロフ誘導含む）を排除し、同じ現場の仲間として「これすごく分かります…！」「お疲れ様です」と心から共感する自然なリプライ（全角40〜75文字）を1つだけ出力してください。
【厳守ルール】
・宣伝、ツール紹介、営業、URL、プロフへの誘導は絶対禁止。純粋な共感のみ。
・相手の投稿内の具体的な言葉に優しく触れること。
・【最重要・文字数注記の絶対禁止】文章末尾や文頭に「（80文字）」「文字数: 〇」などの文字数カウントや注記、解説は絶対に出力に含めないこと。そのまま投稿される本文のみを出力すること。
相手のポスト: ${tweetText.slice(0, 200)}`;
      let text = (await completeText({ tier: 'quality', prompt })).text.trim();
      text = sanitizePostOrReplyText(text);
      if (text.length >= 15 && text.length <= 100) return text;
    } catch (e) {}
  }
  return NATURAL_EMPATHY_FALLBACKS[Math.floor(Math.random() * NATURAL_EMPATHY_FALLBACKS.length)];
}

const OFFICIAL_SUPPORT_REPLIES_EN = [
  'Been testing this cloud browser stack for a few days and the 0.0s shadowban failover on static ISPs is honestly a lifesaver.',
  'Running real headless Chrome with inherited device fingerprints instead of API bots makes so much sense in 2026. Solid setup!',
  'Quick question—does the 3-stream Agency Pro plan let you mix US and UK static residential IPs on the same dashboard?',
  'The human keystroke physics + automatic self-reply link separation is super clean. Saves hours of manual work every day.',
  'Finally an automation stack that bundles dedicated static residential IPs out of the box. Bookmarked this!',
  'Tried the free live browser sandbox on the site earlier and watching it type character-by-character live on X was wild.',
  'Really solid architecture. Managing multi-account affiliate traffic on isolated static IPs with automated burner rotation is the way to go.',
  'The 4-layer stealth setup is top tier. Zero API footprint and clean human typing cadence makes scaling multiple offers so much easier.'
];

/**
 * 🔍 最新の公式ポスト・応援案件を自動解決する
 */
async function resolveLatestOfficialPost() {
  try {
    // 1. boost_campaigns から active かつ targetLikes 未達の最新案件を取得
    const bSnap = await db.collection('boost_campaigns')
      .where('status', '==', 'active')
      .limit(10)
      .get();
    if (!bSnap.empty) {
      const activeCamps = bSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => (c.currentLikes || 0) < (c.targetLikes || 8) && c.tweetUrl)
        .sort((a, b) => {
          const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return tb - ta;
        });
      if (activeCamps.length > 0) {
        const top = activeCamps[0];
        return {
          tweetUrl: top.tweetUrl,
          tweetId: top.tweetId,
          author: top.author || DEFAULT_OFFICIAL_USERNAME,
          campaignId: top.campaignId || top.id,
          snippet: top.textSnippet || ''
        };
      }
    }
  } catch (e) {}

  try {
    // 2. autopilot_jobs から直近 post された公式ポストを取得
    const jSnap = await db.collection('autopilot_jobs')
      .where('status', '==', 'posted')
      .limit(5)
      .get();
    if (!jSnap.empty) {
      const postedJobs = jSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(j => j.tweetUrl)
        .sort((a, b) => {
          const ta = a.postedAt?.toDate ? a.postedAt.toDate().getTime() : (a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0);
          const tb = b.postedAt?.toDate ? b.postedAt.toDate().getTime() : (b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0);
          return tb - ta;
        });
      if (postedJobs.length > 0) {
        const pj = postedJobs[0];
        const authorMatch = pj.tweetUrl ? pj.tweetUrl.match(/x\.com\/([^/]+)/) : null;
        return {
          tweetUrl: pj.tweetUrl,
          tweetId: pj.tweetId,
          author: authorMatch ? authorMatch[1] : DEFAULT_OFFICIAL_USERNAME,
          campaignId: pj.campaignId || null,
          snippet: pj.text || ''
        };
      }
    }
  } catch (e) {}

  return null;
}

async function pickOfficialSupportPost() {
  const jobs = [];
  for (const userId of OFFICIAL_SUPPORT_USER_IDS) {
    const snap = await db.collection('autopilot_jobs')
      .where('userId', '==', userId)
      .where('status', '==', 'posted')
      .limit(5)
      .get();
    jobs.push(...snap.docs.map(doc => doc.data()));
  }
  const posted = jobs
    .filter(job => job.tweetUrl && job.tweetId)
    .sort((a, b) => {
      const time = value => {
        const raw = value?.postedAt || value?.updatedAt;
        const date = raw?.toDate ? raw.toDate() : (raw ? new Date(raw) : null);
        return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
      };
      return time(b) - time(a);
    });
  if (posted.length === 0) return null;
  const job = posted[0];
  const authorMatch = String(job.tweetUrl).match(/x\.com\/([^/]+)/);
  return {
    tweetUrl: job.tweetUrl,
    tweetId: job.tweetId,
    author: authorMatch ? authorMatch[1] : DEFAULT_OFFICIAL_USERNAME,
    campaignId: job.campaignId || null,
    snippet: job.text || job.text_en || ''
  };
}

async function pickSupportAccount() {
  const docs = await getAccountsByLifecycleStatuses(['cleared'], { limit: 200 });
  const now = Date.now();
  const eligible = docs.filter(doc => {
    const data = doc.data() || {};
    const token = String(data.authToken || '').trim();
    if (!token || token.toLowerCase().startsWith('0277b5')) return false;
    if (!readStoredUserAgent(data)) return false;
    if (isPureFactoryAccount(data) && accountAgeDays(data) < 21) return false;
    return (_busyTokensCache.get(token) || 0) <= now;
  });
  if (eligible.length === 0) return null;
  const doc = eligible[Math.floor(Math.random() * eligible.length)];
  const data = doc.data() || {};
  return {
    token: String(data.authToken).trim(),
    docRef: doc.ref,
    docData: { ...data, userAgent: readStoredUserAgent(data) }
  };
}

/**
 * 🌟 A. 公式ポスト初速ブースト＆スレッド議論育成サイクル
 */
async function runNurtureAndOfficialSupportCycle({ token, docRef, docData, officialPost, ownerUid, laneNo }) {
  if (String(token).toLowerCase().startsWith('0277b5')) return { ok: false };
  const shortTok = token.slice(0, 6);
  const logN = (msg) => {
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    console.log('[' + ts + '][Boost:' + shortTok + '] ' + msg);
    if (ownerUid) appendAiReplyTerminalLog(ownerUid, laneNo || 2, msg);
  };

  const proxy = getResidentialProxyForAccount(token, docData);
  const proxyOk = await checkProxyHasBandwidth(proxy);
  if (!proxyOk) {
    logN('⏸️ レジデンシャルプロキシの接続待機中 (スリープ)');
    _busyTokensCache.set(token, Date.now() + 600000);
    return { ok: false };
  }

  const tokLock = await acquireTokenLock(token, 'farming_nurture', 5000);
  if (!tokLock) return { ok: false };
  const userDir = getPersistentProfileDir('farming', token);
  let browser = null;

  try {
    logN(`🚀 [初速ブースト開始] Token: ${shortTok}... / Proxy: ${proxy ? proxy.host : 'Direct'}`);
    const browserArgs = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', '--lang=ja-JP'
    ];
    if (proxy && proxy.host) browserArgs.push('--proxy-server=http://' + proxy.host + ':' + proxy.port);

    browser = await puppeteer.launch({
      headless: 'new',
      args: browserArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      userDataDir: userDir,
      protocolTimeout: 45000
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(40000);
    let capturedSupportReplyId = null;
    page.on('response', async (res) => {
      try {
        if (res.url().includes('CreateTweet') && res.status() === 200) {
          const rawTxt = await res.text().catch(() => '');
          const parsed = extractTweetIdFromCreateTweetBody(rawTxt);
          if (parsed.tweetId) capturedSupportReplyId = parsed.tweetId;
        }
      } catch (e) {}
    });

    await applySafeVideoOnlyBlocker(page);
    await applyInheritedDeviceAndUa(page, token, docData.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });

    if (proxy && proxy.user && proxy.pass) {
      await page.authenticate({ username: proxy.user, password: proxy.pass });
    }

    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    );

    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3800));

    const apiHealth = await inspectAccountViaInternalApi(page);
    if (!apiHealth.apiChecked) {
      logN('⏭️ 通信遅延のため一時待機リストへ');
      _busyTokensCache.set(token, Date.now() + 1800000);
      return { ok: false };
    }
    if (apiHealth.status !== 'ok') {
      logN('⚠️ アカウント制限検知 (' + apiHealth.reason + ')');
      if (docRef) await updateAccountState(docRef.id, apiHealth.status, { errorReason: apiHealth.reason }).catch(() => {});
      _busyTokensCache.set(token, Date.now() + 86400000);
      return { ok: false };
    }

    const screenName = apiHealth.screenName || docData.username || shortTok;
    logN('✅ アカウント @' + screenName + ' 正常確認。ホーム回遊を実行...');
    await runNaturalHomeNurturing(page, logN);

    const finalPostUrl = officialPost ? officialPost.tweetUrl : `https://x.com/${DEFAULT_OFFICIAL_USERNAME}`;
    logN(`🎯 公式ポストへ移動: ${finalPostUrl}`);
    await page.goto(finalPostUrl, { waitUntil: 'domcontentloaded', timeout: 38000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));

    // いいね ＆ ブックマークを実行（Xアルゴリズム初速スコア最高評価）
    const actionsDone = await page.evaluate(() => {
      let liked = false, bookmarked = false;
      const likeBtn = document.querySelector('article[data-testid="tweet"] [data-testid="like"]');
      if (likeBtn) { likeBtn.click(); liked = true; }
      const bmBtn = document.querySelector('article[data-testid="tweet"] [data-testid="bookmark"]');
      if (bmBtn) { bmBtn.click(); bookmarked = true; }
      return { liked, bookmarked };
    }).catch(() => ({ liked: false, bookmarked: false }));

    logN(`  ❤️ いいね (${actionsDone.liked}) ＆ 🔖 ブックマーク (+10.0 Weight: ${actionsDone.bookmarked})`);
    await new Promise(r => setTimeout(r, 2200 + Math.random() * 1500));

    // 🤝 サテライト部隊から公式アカウントへの自然フォロー（未フォロー時）
    let didFollowOfficial = false;
    if (!docData.followedOfficial) {
      didFollowOfficial = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button[data-testid$="-follow"]'));
        for (const btn of btns) {
          const testId = btn.getAttribute('data-testid') || '';
          if (!testId.includes('unfollow')) {
            btn.click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (didFollowOfficial) {
        logN(`  🤝 [公式フォロー完了] @${screenName} が公式アカウント (@${officialPost ? officialPost.author : DEFAULT_OFFICIAL_USERNAME}) を自然にフォローしました！`);
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1200));
      } else {
        try {
          const authorHandle = officialPost ? officialPost.author : DEFAULT_OFFICIAL_USERNAME;
          await page.goto(`https://x.com/${authorHandle}`, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 2200 + Math.random() * 1500));
          didFollowOfficial = await page.evaluate(() => {
            const btn = document.querySelector('button[data-testid$="-follow"]');
            if (btn && !btn.getAttribute('data-testid').includes('unfollow')) {
              btn.click();
              return true;
            }
            return false;
          }).catch(() => false);

          if (didFollowOfficial) {
            logN(`  🤝 [公式プロフィールフォロー完了] @${screenName} が公式プロフィールからフォローしました！`);
            await new Promise(r => setTimeout(r, 1500 + Math.random() * 1200));
          }
          await page.goto(finalPostUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500));
        } catch (eProf) {}
      }
    }

    // 読者目線で「この投稿参考になったよ」「保存しました」と自然に共感するコメントを生成
    let supportReply = null;
    const isEn = officialPost && officialPost.snippet && !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(officialPost.snippet);
    if (isEn) {
      supportReply = OFFICIAL_SUPPORT_REPLIES_EN[Math.floor(Math.random() * OFFICIAL_SUPPORT_REPLIES_EN.length)];
    } else {
      supportReply = await generateNaturalHelpfulReply(officialPost ? officialPost.snippet : '', officialPost ? officialPost.author : DEFAULT_OFFICIAL_USERNAME);
    }

    let didSupportBoost = false;
    const textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 12000 }).catch(() => null);
    if (textbox) {
      await page.evaluate(el => el.focus(), textbox);
      await textbox.click();
      await new Promise(r => setTimeout(r, 900));
      logN(`  ✍️ 人間タイピングでディスカッション返信中: "${supportReply.slice(0, 40)}..."`);
      await humanTyping(page, supportReply);
      await new Promise(r => setTimeout(r, 2000));

      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
        for (const b of btns) {
          if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; }
        }
      });
      await new Promise(r => setTimeout(r, 4500));
      didSupportBoost = true;
    }

    logN('🌿 ホームへ戻り余韻閲覧...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
    await page.evaluate(() => window.scrollBy(0, 320)).catch(() => {});

    if (didSupportBoost) {
      if (officialPost && officialPost.campaignId) {
        await recordBoostActionDone(officialPost.campaignId, screenName, 'like').catch(() => {});
      }
      if (ownerUid) {
        await db.collection('saas_history').add({
          ownerUserId: ownerUid,
          laneIndex: laneNo || 2,
          threadNo: laneNo || 2,
          username: screenName,
          mode: 'ai_reply',
          text: `🌱 [Nurture + Boost -> @${officialPost ? officialPost.author : DEFAULT_OFFICIAL_USERNAME}] ${supportReply.slice(0, 42)}`,
          url: (capturedSupportReplyId && screenName) ? (`https://x.com/${screenName}/status/${capturedSupportReplyId}`) : finalPostUrl,
          deleted: false,
          createdAt: new Date()
        }).catch(() => {});
      }
    }

    if (docRef) {
      const waitHours = 7 + Math.floor(Math.random() * 4);
      const nextActionAt = new Date(Date.now() + waitHours * 3600 * 1000);
      const updateObj = {
        lastReplyPromoAt: new Date(),
        lastActionAt: new Date(),
        nextActionAt, // batch_engine の寝かせタイマーと完全同期
        updatedAt: new Date()
      };
      if (didFollowOfficial) updateObj.followedOfficial = true;
      if (screenName && screenName !== shortTok) updateObj.username = screenName;
      await updateAccountData(docRef.id, updateObj).catch(() => {});
    }

    logN(`✅ @${screenName} の公式初速ブースト完了！`);
    return { ok: didSupportBoost, tweetId: officialPost ? officialPost.tweetId : null };
  } catch (e) {
    logN('❌ 例外: ' + e.message);
    return { ok: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
    slimBrowserCache(userDir);
    releaseTokenLock(tokLock);
  }
}

/**
 * 🎯 B. 外部見込み客キーワード検索 ＆ AI共感リプライ営業サイクル
 */
async function runProspectOutreachCycle({ token, docRef, docData, keyword, ownerUid, laneNo }) {
  if (String(token).toLowerCase().startsWith('0277b5')) return { ok: false };
  const shortTok = token.slice(0, 6);
  const logN = (msg) => {
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    console.log('[' + ts + '][Outreach:' + shortTok + '] ' + msg);
    if (ownerUid) appendAiReplyTerminalLog(ownerUid, laneNo || 2, msg);
  };

  const proxy = getResidentialProxyForAccount(token, docData);
  const proxyOk = await checkProxyHasBandwidth(proxy);
  if (!proxyOk) {
    logN('⏸️ プロキシ待機中');
    _busyTokensCache.set(token, Date.now() + 600000);
    return { ok: false };
  }

  const tokLock = await acquireTokenLock(token, 'farming_outreach', 5000);
  if (!tokLock) return { ok: false };
  const userDir = getPersistentProfileDir('farming', token);
  let browser = null;
  const ledger = loadRepliedLedger(ownerUid);

  try {
    logN(`🔍 [見込み客開拓] キーワード: "${keyword}" / Token: ${shortTok}...`);
    const browserArgs = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', '--lang=ja-JP'
    ];
    if (proxy && proxy.host) browserArgs.push('--proxy-server=http://' + proxy.host + ':' + proxy.port);

    browser = await puppeteer.launch({
      headless: 'new',
      args: browserArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      userDataDir: userDir,
      protocolTimeout: 45000
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(40000);
    let capturedReplyId = null;
    page.on('response', async (res) => {
      try {
        if (res.url().includes('CreateTweet') && res.status() === 200) {
          const rawTxt = await res.text().catch(() => '');
          const parsed = extractTweetIdFromCreateTweetBody(rawTxt);
          if (parsed.tweetId) capturedReplyId = parsed.tweetId;
        }
      } catch (e) {}
    });

    await applySafeVideoOnlyBlocker(page);
    await applyInheritedDeviceAndUa(page, token, docData.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });

    if (proxy && proxy.user && proxy.pass) {
      await page.authenticate({ username: proxy.user, password: proxy.pass });
    }

    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    );

    // 検索URLへ直接ナビゲーション（最新順 & 外部リンクなしの一般投稿）
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(keyword + ' -filter:links')}&f=live`;
    logN(`  🌐 検索画面を開いています: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    await page.evaluate(() => window.scrollBy(0, 350)).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    // 候補ポストをDOMから抽出
    const candidates = await page.evaluate(() => {
      const items = [];
      const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      for (const art of arts) {
        const txtEl = art.querySelector('[data-testid="tweetText"]');
        const linkEl = art.querySelector('time')?.closest('a') || art.querySelector('a[href*="/status/"]');
        if (!txtEl || !linkEl) continue;
        const href = String(linkEl.getAttribute('href') || '');
        const m = href.match(/^\/([^/]+)\/status\/(\d{15,22})/);
        if (!m) continue;
        items.push({
          username: m[1],
          tweetId: m[2],
          text: txtEl.innerText || ''
        });
      }
      return items;
    }).catch(() => []);

    const validTarget = candidates.find(c => {
      if (!c.tweetId || !c.username || !c.text) return false;
      const uLower = c.username.toLowerCase();
      if (uLower === DEFAULT_OFFICIAL_USERNAME.toLowerCase() || uLower === 'veloxpostapp') return false;
      if (ledger.tweetIds.has(c.tweetId) || ledger.usernames.has(uLower)) return false;
      if (c.text.length < 20 || c.text.startsWith('RT @')) return false;
      return true;
    });

    if (!validTarget) {
      logN(`  ℹ️ キーワード "${keyword}" に該当する新規未アプローチの見込み客なし。次回へローテーションします。`);
      return { ok: false };
    }

    logN(`  🎯 見込み客 @${validTarget.username} を捕捉: "${validTarget.text.slice(0, 35)}..."`);
    const targetUrl = `https://x.com/${validTarget.username}/status/${validTarget.tweetId}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // いいね通知を送る
    await page.evaluate(() => {
      const likeBtn = document.querySelector('article[data-testid="tweet"] [data-testid="like"]');
      if (likeBtn) likeBtn.click();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));

    // 露骨な営業や宣伝は完全排除。「めちゃくちゃ共感します」「同じ悩みありました」と生身の仲間目線で寄り添う
    const replyText = await generatePureEmpathyReply(validTarget.text, validTarget.username);

    let sent = false;
    const rBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 12000 }).catch(() => null);
    if (rBox) {
      await page.evaluate(el => el.focus(), rBox);
      await rBox.click();
      await new Promise(r => setTimeout(r, 600));
      logN(`  ✍️ @${validTarget.username} へ知見リプライ入力中: "${replyText.slice(0, 40)}..."`);
      await humanTyping(page, replyText);
      await new Promise(r => setTimeout(r, 1500));

      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
        for (const b of btns) {
          if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; }
        }
      });
      await new Promise(r => setTimeout(r, 4500));
      sent = true;
    }

    if (sent) {
      saveRepliedLedger(ledger, validTarget.tweetId, validTarget.username);
      const cleanUsername = docData.username || shortTok;

      await db.collection('saas_reply_history').add({
        squadAccountToken: shortTok,
        squadScreenName: cleanUsername,
        targetHandle: validTarget.username,
        targetTweetId: validTarget.tweetId,
        queryTag: keyword,
        replyText,
        createdAt: new Date()
      }).catch(() => {});

      if (ownerUid) {
        await db.collection('saas_history').add({
          ownerUserId: ownerUid,
          laneIndex: laneNo || 2,
          threadNo: laneNo || 2,
          username: cleanUsername,
          mode: 'prospect_outreach',
          text: `💬 [AI Outreach -> @${validTarget.username}] ${replyText.slice(0, 42)}`,
          url: capturedReplyId ? `https://x.com/${cleanUsername}/status/${capturedReplyId}` : targetUrl,
          deleted: false,
          createdAt: new Date()
        }).catch(() => {});
      }
      logN(`🎉 @${validTarget.username} への共感リプライ営業が完了しました！`);
    }

    if (docRef) {
      const waitHours = 7 + Math.floor(Math.random() * 4);
      const nextActionAt = new Date(Date.now() + waitHours * 3600 * 1000);
      await updateAccountData(docRef.id, {
        lastReplyPromoAt: new Date(),
        lastActionAt: new Date(),
        nextActionAt, // batch_engine の寝かせタイマーと完全同期
        updatedAt: new Date()
      }).catch(() => {});
    }

    return { ok: sent };
  } catch (e) {
    logN('❌ アウトリーチ例外: ' + e.message);
    return { ok: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
    slimBrowserCache(userDir);
    releaseTokenLock(tokLock);
  }
}

/**
 * 🤖 予約投稿が枯渇した際、AI合議制で有益4段スレッド投稿を自律補充する
 */
async function checkAndAutoReplenishJobsIfNeeded(ownerUid) {
  try {
    const userDoc = await db.collection('saas_users').doc(ownerUid).get();
    if (!userDoc.exists) return;
    const uData = userDoc.data() || {};
    if (uData.autopilotPaused) return;

    const snap = await db.collection('autopilot_jobs')
      .where('userId', '==', ownerUid)
      .where('status', '==', 'pending')
      .get();

    if (snap.size <= 1) {
      console.log(`🤖 [予約投稿の自律補充] 現在の未投稿ジョブが ${snap.size}件のため、AI合議制で4段スレッド＆有益ポストを自動補充します...`);
      const targetUrl = uData.targetUrl || 'https://veloxpostapp.com';
      const scheduleTimeZone = uData.scheduleTimeZone || uData.timezone || 'Asia/Tokyo';
      await launchAutopilotCampaign(ownerUid, targetUrl, {
        userPrompt: '世間のためになる有益ノウハウ提供：最新2026年Xアルゴリズム徹底解説とシャドウバン即時回避・解除完全マニュアル',
        plan: uData.planId || 'pro',
        lang: uData.aiTargetLang || 'ja',
        scheduleTimeZone,
        isReplenish: true,
        batchCount: 3,
        targetLikes: 10,
        targetRetweets: 5,
        targetQuotes: 2
      });
      console.log(`🎉 [予約投稿自律補充完了] 次回枠の有益投稿・4段スレッドをスケジュールに追加しました！`);
    }
  } catch (err) {
    console.warn('Auto replenish check warning:', err.message);
  }
}

// ⏱️ ブラウザ自動操作の遅延に巻き込まれない独立したメトリクス巡回タイマー（10分周期に一本化）
let _metricsSyncInterval = null;
let _isShuttingDown = false;
let _currentActionPromise = null;
let _currentSyncPromise = null;

function startIndependentMetricsSyncTimer(intervalMs = 10 * 60 * 1000) {
  if (_metricsSyncInterval) return _metricsSyncInterval;
  _metricsSyncInterval = setInterval(async () => {
    if (_isShuttingDown) return;
    if (_currentSyncPromise) {
      console.log('⏳ [x-reply-engine] 前回のメトリクス同期バッチが実行中のため、今回のタイマー実行をスキップします');
      return;
    }
    try {
      _currentSyncPromise = syncAllActiveCustomersPostMetrics();
      const result = await _currentSyncPromise;
      if (!result.ok) {
        console.warn(`[Independent Metrics Timer Warning]: ${result.error || `${result.totalFailed} user syncs failed`}`);
      }
    } catch (e) {
      console.warn('[Independent Metrics Timer Warning]:', e.message);
    } finally {
      _currentSyncPromise = null;
    }
  }, intervalMs);
  return _metricsSyncInterval;
}

// 🛡️ PM2グレースフルシャットダウン対応: 実行中ブラウザ操作およびメトリクス同期バッチの完了を待機して安全停止
function setupGracefulShutdown() {
  const onSignal = async (sig) => {
    console.log(`🛑 [x-reply-engine] シャットダウンシグナル(${sig})を受信しました。安全な停止シーケンスを開始します...`);
    _isShuttingDown = true;
    if (_metricsSyncInterval) {
      clearInterval(_metricsSyncInterval);
      _metricsSyncInterval = null;
    }

    const runningTasks = [];
    if (_currentActionPromise) {
      console.log('⏳ [x-reply-engine] 実行中ブラウザ操作の完了を待機しています...');
      runningTasks.push(_currentActionPromise);
    }
    if (_currentSyncPromise) {
      console.log('⏳ [x-reply-engine] 実行中メトリクス同期・自律進化バッチの完了を待機しています...');
      runningTasks.push(_currentSyncPromise);
    }

    if (runningTasks.length > 0) {
      console.log(`⏳ [x-reply-engine] ${runningTasks.length}件の実行中タスクの完了を待機中 (最大30秒)...`);
      try {
        const timeoutPromise = new Promise(r => setTimeout(r, 30000));
        await Promise.race([Promise.allSettled(runningTasks), timeoutPromise]);
      } catch (waitErr) {
        console.warn('Action wait error:', waitErr.message);
      }
    }

    console.log('👋 [x-reply-engine] 全タスクの安全終了を確認しました。プロセスを正常終了します。');
    process.exit(0);
  };

  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
}

/**
 * 🚀 メインエンジンループ：公式初速ブースト ＆ 見込み客AIリプライ営業を交互に自律稼働
 */
async function startReplyPromoEngine() {
  console.log('🚀 [X-Reply-Engine] 自律型AIリプライ営業 ＆ 公式初速ブースト統合エンジン 起動完了');
  const officialUids = ['WEB-GOOGLE-D12E2479A76266AEA2B4', 'USR-MVUA1GLP-D640'];

  setupGracefulShutdown();

  while (!_isShuttingDown) {
    try {
      // 0. 🏛️ 公式アカウント（日本公式＆グローバル公式）の自律エンゲージメント（リプライ返し ＆ フォロー返し）
      for (const uid of officialUids) {
        if (_isShuttingDown) break;
        try {
          const engRes = await runOfficialAutonomousEngagement(uid);
          if (engRes && !engRes.ok) {
            console.warn(`Official engagement stopped for ${uid}: ${engRes.error || engRes.reason}`);
          }
          if (engRes && (engRes.repliedCount > 0 || engRes.followedCount > 0)) {
            const label = uid === 'USR-MVUA1GLP-D640' ? 'Global @VeloxSystemsHQ' : 'Japan @VeloxSystemsV4';
            console.log(`✨ [公式自律エンゲージメント (${label})] 返信完了: ${engRes.repliedCount}件 / フォローバック完了: ${engRes.followedCount}件`);
          }
        } catch (eEngage) {
          console.warn(`Official engagement warning for ${uid}:`, eEngage.message);
        }
      }

      const officialPost = await pickOfficialSupportPost();
      const supportAccount = officialPost ? await pickSupportAccount() : null;
      if (!officialPost || !supportAccount) {
        console.log('応援先の公式投稿、または検索解除済みで保存済みUAを持つアカウントが無いため、この周のブラウザ応援は見送ります。');
      } else {
        await runNurtureAndOfficialSupportCycle({
          token: supportAccount.token,
          docRef: supportAccount.docRef,
          docData: supportAccount.docData,
          officialPost
        });
      }
    } catch (e) {
      console.error('Reply Promo Engine Loop Error:', e.message);
    }

    if (_isShuttingDown) break;

    // 1アクション完了後は12分〜18分待機し、アカウントとプロキシ帯域を安全に保全
    const waitMin = 12 + Math.floor(Math.random() * 6);
    console.log(`💤 次回のアクションまで ${waitMin} 分間待機します...\n`);
    for (let s = 0; s < waitMin * 60; s++) {
      if (_isShuttingDown) break;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// PM2またはCLIから起動
if (require.main === module) {
  startReplyPromoEngine();
}

module.exports = {
  startReplyPromoEngine,
  startIndependentMetricsSyncTimer,
  resolveLatestOfficialPost,
  runNurtureAndOfficialSupportCycle,
  runProspectOutreachCycle
};
