const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');

const { spawn, execSync } = require('child_process');
const { getProfileDirectoryPath } = require('./account_profile');

// アカウント作成(Camoufox :99)のフォーカスを絶対に奪わないよう、初期設定・養殖(Puppeteer)は専用ディスプレイ :98 に完全隔離する
function ensureFarmingDisplay98() {
  process.env.DISPLAY = ':98';
  try {
    execSync('DISPLAY=:98 xdotool getmouselocation >/dev/null 2>&1');
    return ':98';
  } catch (e) {
    try {
      execSync('rm -f /tmp/.X98-lock /tmp/.X11-unix/X98 >/dev/null 2>&1 || true');
      const xvfb = spawn('Xvfb', [':98', '-ac', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], {
        detached: true,
        stdio: 'ignore'
      });
      xvfb.unref();
      execSync('sleep 1.0');
    } catch (err) {}
    return ':98';
  }
}

// 10万アカウント規模でのディスク/inodeパンクを防ぐため、出荷済み(sold)・凍結(unavailable)のプロファイルフォルダを自動パージ
function purgeProfileDirCompletely(token) {
  if (!token) return;
  try {
    const hash = crypto.createHash('md5').update(String(token || '').trim()).digest('hex').slice(0, 12);
    const dir = path.join(PROFILES_BASE_DIR, `prof_${hash}`);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {}
}

// 外部視点検査の30分メモリキャッシュ（同じアカウントへの重複API通信を90%削減）
const externalInspectCache = new Map();


const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const SHARED_HTTP_CACHE = path.join(__dirname, '../.chrome_http_cache');
const PROFILES_BASE_DIR = path.join(__dirname, '../.profiles');
if (!fs.existsSync(SHARED_HTTP_CACHE)) fs.mkdirSync(SHARED_HTTP_CACHE, { recursive: true });
if (!fs.existsSync(PROFILES_BASE_DIR)) fs.mkdirSync(PROFILES_BASE_DIR, { recursive: true });

function getPersistentProfileDir(token) {
  const dir = getProfileDirectoryPath(token);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
    try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
  });
  return ensureProfileHydrated(dir);
}

async function extractKeepCookies(page) {
  const rawCookies = await page.cookies('https://x.com', 'https://twitter.com').catch(() => []);
  const keepNames = new Set([
    'auth_token', 'ct0', 'twid', 'guest_id', 'guest_id_marketing', 'guest_id_ads',
    'kdt', 'lang', 'personalization_id', 'att', '__cuid', '__cf_bm', 'g_state'
  ]);
  const map = new Map();
  for (const c of rawCookies) {
    if (keepNames.has(c.name) && c.value) {
      map.set(`${c.domain || '.x.com'}:${c.name}`, {
        name: c.name,
        value: c.value,
        domain: c.domain || '.x.com',
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly
      });
    }
  }
  return Array.from(map.values());
}

function httpsGetViaProxy(targetUrl, headers, proxy, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const reqHeaders = { ...headers, 'Accept-Encoding': 'identity', 'Connection': 'close' };
    if (!proxy || !proxy.host || !proxy.port) {
      const req = https.request({ hostname: parsedUrl.hostname, port: 443, path: parsedUrl.pathname + parsedUrl.search, method: 'GET', headers: reqHeaders, timeout: timeoutMs }, (res) => {
        let body = '', bytes = 0;
        res.on('data', c => { bytes += c.length; body += c.toString('utf8'); });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body, bytes }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
      return;
    }
    const auth = (proxy.user && proxy.pass) ? 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64') : null;
    const connectReq = http.request({
      host: proxy.host, port: parseInt(proxy.port, 10), method: 'CONNECT', path: `${parsedUrl.hostname}:443`,
      headers: auth ? { 'Proxy-Authorization': auth } : {}, timeout: timeoutMs
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error('Proxy ' + res.statusCode)); }
      const req = https.request({
        hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search, method: 'GET', headers: reqHeaders, agent: false, timeout: timeoutMs,
        createConnection: () => tls.connect({ socket, servername: parsedUrl.hostname, rejectUnauthorized: false })
      }, (res2) => {
        let body = '', bytes = 0;
        res2.on('data', c => { bytes += c.length; body += c.toString('utf8'); });
        res2.on('end', () => resolve({ statusCode: res2.statusCode, headers: res2.headers, body, bytes }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('tls timeout')); });
      req.end();
    });
    connectReq.on('error', reject);
    connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('proxy timeout')); });
    connectReq.end();
  });
}

async function preCheckAccountWithoutBrowser(token, proxy, userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36", savedCookies = []) {
  if (typeof userAgent !== "string" || !userAgent.trim()) {
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36";
  }
  console.log("  ⚡ [事前API監査] 固定プロキシ＆引き継ぎUAで制限・ロック・投稿数を照会中...");
  let totalBytes = 0;
  let ct0 = crypto.randomBytes(16).toString('hex');
  const extraCookieMap = new Map();
  if (Array.isArray(savedCookies)) {
    for (const sc of savedCookies) {
      if (!sc || !sc.name || !sc.value) continue;
      if (sc.name === 'ct0') ct0 = sc.value;
      else if (sc.name !== 'auth_token') extraCookieMap.set(sc.name, sc.value);
    }
  }
  extraCookieMap.set('lang', 'ja');

  const buildHeaders = (csrf) => {
    const extras = Array.from(extraCookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    const cookieStr = `auth_token=${token}; ct0=${csrf}` + (extras ? `; ${extras}` : '');
    return {
      'authorization': `Bearer ${X_WEB_BEARER}`,
      'x-csrf-token': csrf,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'ja',
      'accept': '*/*',
      'origin': 'https://x.com',
      'referer': 'https://x.com/home',
      'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'user-agent': userAgent,
      'cookie': cookieStr
    };
  };

  const updateCookiesFromHeaders = (headers) => {
    for (const sc of (headers['set-cookie'] || [])) {
      const mCt0 = sc.match(/ct0=([a-fA-F0-9]+);/);
      if (mCt0 && mCt0[1]) ct0 = mCt0[1];
      const mGuest = sc.match(/guest_id=([^;]+);/);
      if (mGuest && mGuest[1]) extraCookieMap.set('guest_id', mGuest[1]);
      const mAtt = sc.match(/att=([^;]+);/);
      if (mAtt && mAtt[1]) extraCookieMap.set('att', mAtt[1]);
    }
  };

  try {
    let res = await httpsGetViaProxy('https://x.com/i/api/1.1/account/settings.json', buildHeaders(ct0), proxy);
    totalBytes += (res.bytes || 0);
    updateCookiesFromHeaders(res.headers);

    if (res.statusCode === 403 || res.statusCode === 401 || res.body.includes('"code":353') || res.body.includes('"code":32') || res.body.includes('"code":215')) {
      ct0 = crypto.randomBytes(16).toString('hex');
      res = await httpsGetViaProxy('https://x.com/i/api/1.1/account/settings.json', buildHeaders(ct0), proxy);
      totalBytes += (res.bytes || 0);
      updateCookiesFromHeaders(res.headers);
      if (res.statusCode === 403 && res.body.includes('353')) {
        res = await httpsGetViaProxy('https://x.com/i/api/1.1/account/settings.json', buildHeaders(ct0), proxy);
        totalBytes += (res.bytes || 0);
        updateCookiesFromHeaders(res.headers);
      }
    }

    const data = JSON.parse(res.body || '{}');
    for (const err of (data.errors || [])) {
      if (err.code === 64) return { ok: false, status: 'unavailable', reason: 'frozen(API_64)', bytesUsed: totalBytes };
      if (err.code === 326) return { ok: false, status: 'robot', reason: 'locked(API_326)', bytesUsed: totalBytes };
      if ([32, 89, 215].includes(err.code)) {
        const resVerify = await httpsGetViaProxy('https://x.com/i/api/1.1/account/verify_credentials.json', buildHeaders(ct0), proxy).catch(() => null);
        if (resVerify && resVerify.body) {
          totalBytes += (resVerify.bytes || 0);
          const vData = JSON.parse(resVerify.body || '{}');
          if (vData && vData.screen_name) {
            return {
              ok: true, verifiedByApi: true, status: 'ok', username: vData.screen_name, ct0,
              tweetsCount: typeof vData.statuses_count === 'number' ? vData.statuses_count : null,
              followingCount: typeof vData.friends_count === 'number' ? vData.friends_count : null,
              bytesUsed: totalBytes
            };
          }
          // 2段目の verify_credentials でも明示的に 89(Invalid/expired token) や 64(Suspended) が返った場合はブラウザを開かず即スキップ
          for (const verr of (vData.errors || [])) {
            if (verr.code === 64) return { ok: false, status: 'unavailable', reason: 'frozen(API_64)', bytesUsed: totalBytes };
            if (verr.code === 326) return { ok: false, status: 'robot', reason: 'locked(API_326)', bytesUsed: totalBytes };
            if (verr.code === 89) return { ok: false, status: 'unavailable', reason: 'invalid_token(API_89)', bytesUsed: totalBytes };
          }
        }
        return { ok: true, verifiedByApi: false, status: 'ok', ct0, bytesUsed: totalBytes };
      }
    }

    let screenName = data.screen_name || null;
    let tweetsCount = null, followingCount = null;
    if (!screenName) {
      const resVerifyFallback = await httpsGetViaProxy('https://x.com/i/api/1.1/account/verify_credentials.json', buildHeaders(ct0), proxy).catch(() => null);
      if (resVerifyFallback && resVerifyFallback.body) {
        totalBytes += (resVerifyFallback.bytes || 0);
        const vf = JSON.parse(resVerifyFallback.body || '{}');
        if (vf && vf.screen_name) {
          screenName = vf.screen_name;
          if (typeof vf.statuses_count === 'number') tweetsCount = vf.statuses_count;
          if (typeof vf.friends_count === 'number') followingCount = vf.friends_count;
        } else if (vf && Array.isArray(vf.errors) && vf.errors.length > 0) {
          const ec = vf.errors[0].code;
          if (ec === 64) return { ok: false, status: 'unavailable', reason: 'frozen(API_64)', bytesUsed: totalBytes };
          if (ec === 326) return { ok: false, status: 'robot', reason: 'locked(API_326)', bytesUsed: totalBytes };
          
        }
      }
    }

    if (screenName) {
      const resShow = await httpsGetViaProxy(`https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(screenName)}`, buildHeaders(ct0), proxy).catch(() => null);
      if (resShow && resShow.body) {
        totalBytes += (resShow.bytes || 0);
        const u = JSON.parse(resShow.body || '{}');
        if (u.suspended === true) return { ok: false, status: 'unavailable', reason: 'frozen(USER_SUSPENDED)', username: screenName, bytesUsed: totalBytes };
        if (Array.isArray(u.withheld_in_countries) && u.withheld_in_countries.length > 0) return { ok: false, status: 'unavailable', reason: 'withheld(COUNTRY)', username: screenName, bytesUsed: totalBytes };
        for (const err of (u.errors || [])) {
          if (err.code === 63 || err.code === 64) return { ok: false, status: 'unavailable', reason: `frozen(USER_${err.code})`, username: screenName, bytesUsed: totalBytes };
          if (err.code === 50) return { ok: false, status: 'unavailable', reason: 'not_exist(USER_50)', username: screenName, bytesUsed: totalBytes };
        }
        if (typeof u.statuses_count === 'number') tweetsCount = u.statuses_count;
        if (typeof u.friends_count === 'number') followingCount = u.friends_count;
      }
      return { ok: true, verifiedByApi: true, status: 'ok', username: screenName, ct0, tweetsCount, followingCount, bytesUsed: totalBytes };
    }
  } catch (e) {}
  return { ok: true, verifiedByApi: false, status: 'ok', ct0, bytesUsed: totalBytes };
}

function getUltraSavingBrowserArgs(proxy) {
  const bypass = ['*.googleapis.com', '*.gvt1.com', '*.google.com', '*.gstatic.com', 'abs.twimg.com', 'abs-0.twimg.com', '*.mozilla.net', '*.digicert.com'].join(';');
  const args = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    `--disk-cache-dir=${SHARED_HTTP_CACHE}`, '--disk-cache-size=524288000',
    '--disable-blink-features=AutomationControlled',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--no-first-run',
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--autoplay-policy=document-user-activation-required",
    "--host-resolver-rules=MAP pbs.twimg.com 127.0.0.1,MAP ton.twimg.com 127.0.0.1,MAP abs-0.twimg.com 127.0.0.1,MAP video.twimg.com 127.0.0.1,MAP update.googleapis.com 127.0.0.1,MAP safebrowsing.googleapis.com 127.0.0.1,MAP optimizationguide-pa.googleapis.com 127.0.0.1,MAP clients2.google.com 127.0.0.1,MAP *.gvt1.com 127.0.0.1,MAP play.google.com 127.0.0.1", '--no-default-browser-check', '--disable-sync', '--disable-translate', '--lang=ja-JP'
  ];
  if (proxy && proxy.host && proxy.port) {
    args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`, `--proxy-bypass-list=${bypass}`);
  }
  return args;
}

const SUSP_WORDS = ['account suspended', 'permanently suspended', 'your account is suspended', 'this account is suspended', 'アカウントは\u51cd\u7d50', '\u51cd\u7d50されています', 'アカウントが\u51cd\u7d50', 'cuenta suspendida', 'suspendió tu cuenta', 'conta suspensa', 'compte suspendu', 'konto gesperrt', 'аккаунт заблокирован', 'hesap askıya alındı', 'akun ditangguhkan', 'tài khoản bị đình chỉ'];
const WITH_WORDS = ['legal demand', 'withheld in', 'has been withheld', 'account withheld', '法的な要求', '法的要請', '一部の国でブロック', '表示が制限されているアカウント', '制限されています', 'demanda legal', 'retenida en'];
const APP_LOCK_WORDS = ['スマートフォンでxアプリ', 'open the x app', 'アプリを開いて続行', 'continue on the x app'];
const ROBOT_WORDS = ['人間であることを証明', '認証して続行', 'prove you are human', 'authenticate to continue', 'unusual login activity', '不審なログイン', 'verify your identity', '本人確認'];

async function enableSmartBandwidthSaver(page, blockTimelineImages = true) {
  try {
    const client = await page.target().createCDPSession();
    const urls = [
      '*.mp4*', '*.m3u8*', '*.m4s*', '*.webm*', '*.ts*', '*.mov*',
      '*video.twimg.com*', '*pscp.tv*', '*periscope.tv*',
      '*pbs.twimg.com/ext_tw_video_thumb*', '*pbs.twimg.com/amplify_video_thumb*', '*pbs.twimg.com/tweet_video_thumb*',
      '*ciscobinary.openh264.org*', '*filters.adtidy.org*', '*gvt1.com*',
      '*safebrowsing.googleapis.com*', '*clients2.googleusercontent.com*', '*mtalk.google.com*', '*update.googleapis.com*'
    ];
    await client.send('Network.enable');
    await client.send('Network.setBlockedURLs', { urls });
    return client;
  } catch (e) { return null; }
}

async function allowImagesForProfileUpload(page, cdpClient) {
  try {
    if (cdpClient) {
      await cdpClient.send('Network.setBlockedURLs', {
        urls: [
          '*.mp4*', '*.m3u8*', '*.m4s*', '*.webm*', '*.ts*', '*.mov*',
          '*video.twimg.com*', '*pscp.tv*', '*periscope.tv*',
          '*gvt1.com*', '*safebrowsing.googleapis.com*', '*mtalk.google.com*', '*update.googleapis.com*'
        ]
      });
    }
  } catch (e) {}
}

function attachApiHealthSniffer(page) {
  const state = { status: 'ok', detail: null, detectedUsername: null, tweetsCount: null, followingCount: null };
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.includes('/i/api/') && !url.includes('/graphql/')) return;
      if (!(res.headers()['content-type'] || '').includes('application/json')) return;
      const data = await res.json().catch(() => null);
      if (!data) return;
      if (data.screen_name && typeof data.screen_name === 'string') state.detectedUsername = data.screen_name;
      for (const err of (data.errors || [])) {
        if (err.code === 64) { state.status = 'frozen'; state.detail = 'API_64'; }
        else if (err.code === 326) { state.status = 'robot'; state.detail = 'API_326'; }
        else if ([32, 89, 215].includes(err.code)) { state.status = 'logged_out'; state.detail = 'API_' + err.code; }
      }
      if (url.includes('UserByScreenName') || url.includes('Viewer') || url.includes('verify_credentials')) {
        const raw = JSON.stringify(data);
        if (raw.includes('"__typename":"UserUnavailable"')) {
          if (raw.toLowerCase().includes('suspended')) { state.status = 'frozen'; state.detail = 'GQL_SUSPENDED'; }
          else if (raw.toLowerCase().includes('withheld')) { state.status = 'withheld'; state.detail = 'GQL_WITHHELD'; }
        }
        if (raw.includes('"withheld_in_countries":[') && !raw.includes('"withheld_in_countries":[]')) {
          state.status = 'withheld'; state.detail = 'GQL_WITHHELD_COUNTRY';
        }
        const stM = raw.match(/"statuses_count":(\d+)/);
        if (stM) state.tweetsCount = parseInt(stM[1], 10);
        const frM = raw.match(/"friends_count":(\d+)/);
        if (frM) state.followingCount = parseInt(frM[1], 10);
      }
    } catch (e) {}
  });
  return state;
}

async function tryAutoPassAccessPage(page, snifferState, targetUrl) {
  try {
    const canAutoPass = await page.evaluate((rW) => {
      const hasCaptcha = !!document.querySelector("iframe[src*='arkoselabs.com'], iframe[src*='funcaptcha'], #arkose_iframe");
      const hasInputChallenge = !!document.querySelector("input[type='tel'], input[type='email'], input[name='challenge_response'], input[name='verification_code']");
      if (hasCaptcha || hasInputChallenge) return false;
      const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
      if (rW.some(w => bodyText.includes(w.toLowerCase()))) return false;

      const candidates = Array.from(document.querySelectorAll("input[type='submit'], button[type='submit'], button"));
      for (const btn of candidates) {
        const val = ((btn.value || btn.innerText || '') + '').trim().toLowerCase();
        if (btn.type === 'submit' || ['continue', 'start', '続行', '次へ', '進む', 'xへ進む'].some(k => val.includes(k))) {
          btn.click();
          return true;
        }
      }
      return false;
    }, ROBOT_WORDS).catch(() => false);

    if (canAutoPass) {
      console.log("  🔓 [/account/access 自動通過試行] 一時確認画面の続行ボタンを検出・クリックしました...");
      if (snifferState) { snifferState.status = 'ok'; snifferState.detail = null; }
      await new Promise(r => setTimeout(r, 4500));
      if (page.url().toLowerCase().includes('/account/access')) {
        try { await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (e) {}
        await new Promise(r => setTimeout(r, 2500));
      }
      return !page.url().toLowerCase().includes('/account/access');
    }
  } catch (e) {}
  return false;
}

async function inspectPageDomRestrictions(page) {
  return await page.evaluate((sW, wW, rW, aW) => {
    const url = window.location.href.toLowerCase();
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (clone) clone.querySelectorAll("article, [data-testid='tweet']").forEach(a => a.remove());
    const text = clone ? (clone.innerText || '').toLowerCase() : '';

    if (aW.some(w => text.includes(w.toLowerCase()))) return 'app_lock';
    if (url.includes('/account/access')) return 'robot';
    if (document.querySelector("iframe[src*='arkoselabs.com'], iframe[src*='funcaptcha'], #arkose_iframe")) return 'robot';
    if (rW.some(w => text.includes(w.toLowerCase()))) return 'robot';
    if (sW.some(w => text.includes(w.toLowerCase()))) return 'frozen';
    if (wW.some(w => text.includes(w.toLowerCase()))) return 'withheld';

    // ログイン画面の明示的検出（単にパスが / や空だからといって logged_out にしない！）
    const hasLoggedInDom = !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"], [data-testid="SideNav_NewTweet_Button"]');
    const hasLoginForm = !!document.querySelector('[data-testid="loginButton"], a[href="/login"], input[autocomplete="username"]');
    if (!hasLoggedInDom && (url.includes('/i/flow/login') || url.includes('/login') || url.includes('logout=') || hasLoginForm)) {
      return 'logged_out';
    }
    return 'ok';
  }, SUSP_WORDS, WITH_WORDS, ROBOT_WORDS, APP_LOCK_WORDS).catch(() => 'ok');
}

async function verifyAccountStatusFast(page, currentUsername, snifferState, firstUrl = 'https://x.com/home') {
  let gotoError = null;
  try {
    await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 32000 });
  } catch (e) {
    gotoError = e.message || 'goto_timeout';
  }

  // 住宅用プロキシの遅延でSPAが未描画のまま「AuthToken切れ」と誤判定されるのを防ぐため最大12秒ポーリング待機
  let pageState = 'loading';
  for (let w = 0; w < 6; w++) {
    await new Promise(r => setTimeout(r, 2000));
    pageState = await page.evaluate(() => {
      if (document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
          document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
          document.querySelector('[data-testid="primaryColumn"]')) {
        return 'logged_in';
      }
      if (window.location.href.includes('/account/access')) return 'access';
      if (document.querySelector('[data-testid="loginButton"]') ||
          document.querySelector('input[autocomplete="username"]') ||
          window.location.href.includes('/i/flow/login') ||
          window.location.href.includes('/login')) {
        return 'login_form';
      }
      return 'loading';
    }).catch(() => 'loading');
    if (pageState === 'logged_in' || pageState === 'access') break;
  }

  if (page.url().toLowerCase().includes('/account/access')) {
    await tryAutoPassAccessPage(page, snifferState, firstUrl);
  }

  const domEarly = await inspectPageDomRestrictions(page);
  if (domEarly === 'app_lock') return { ok: false, status: 'app_lock', reason: 'app_lock_required', username: currentUsername };

  let curUrl = page.url().toLowerCase();
  let curPath = '';
  try { curPath = new URL(curUrl).pathname.toLowerCase(); } catch (e) {}

  // プロキシタイムアウトや未描画(about:blank等)の場合、もう一度だけリトライ
  if (gotoError || curPath === '/' || curPath === '' || curUrl === 'about:blank' || pageState === 'loading') {
    if (snifferState) { snifferState.status = 'ok'; snifferState.detail = null; }
    try {
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 25000 });
      gotoError = null;
    } catch (e) {
      gotoError = e.message || 'goto_retry_timeout';
    }
    await new Promise(r => setTimeout(r, 3000));
    curUrl = page.url().toLowerCase();
    try { curPath = new URL(curUrl).pathname.toLowerCase(); } catch (e) {}
  }

  if (curUrl.includes('/account/access')) return { ok: false, status: 'robot', reason: 'locked_access_page', username: currentUsername };

  const domMid = await inspectPageDomRestrictions(page);
  if (domMid !== 'ok') {
    if (domMid === 'app_lock') return { ok: false, status: 'app_lock', reason: 'app_lock_required', username: currentUsername };
    if (domMid === 'robot') return { ok: false, status: 'robot', reason: 'robot_dom_detected', username: currentUsername };
    if (domMid === 'frozen') return { ok: false, status: 'unavailable', reason: 'frozen_dom_detected', username: currentUsername };
    if (domMid === 'withheld') return { ok: false, status: 'unavailable', reason: 'withheld_dom_detected', username: currentUsername };
  }

  const cookies = await page.cookies('https://x.com', 'https://twitter.com').catch(() => []);
  const authTokenCookie = cookies.find(c => c.name === 'auth_token')?.value || '';
  const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
  const twid = cookies.find(c => c.name === 'twid')?.value || '';
  let tweetsCount = snifferState ? snifferState.tweetsCount : null;
  let followingCount = snifferState ? snifferState.followingCount : null;
  let userDescription = null;
  let apiVerified = false;
  let explicitApiInvalidToken = false;

  if (ct0) {
    const chk = await page.evaluate(async (b, c) => {
      try {
        const h = { 'authorization': `Bearer ${b}`, 'x-csrf-token': c, 'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session' };
        const res = await fetch('https://x.com/i/api/1.1/account/verify_credentials.json', { credentials: 'include', headers: h });
        const j = await res.json().catch(() => ({}));
        return { httpStatus: res.status, body: j };
      } catch (e) { return null; }
    }, X_WEB_BEARER, ct0).catch(() => null);

    if (chk && chk.body) {
      const b = chk.body;
      if (typeof b.description === 'string') userDescription = b.description;
      if (b.screen_name) {
        currentUsername = b.screen_name;
        apiVerified = true;
      }
      for (const err of (b.errors || [])) {
        if (err.code === 64) return { ok: false, status: 'unavailable', reason: 'frozen(API_64)', username: currentUsername };
        if (err.code === 326) return { ok: false, status: 'robot', reason: 'locked(API_326)', username: currentUsername };
        if (err.code === 89) {
          explicitApiInvalidToken = true;
          return { ok: false, status: 'unavailable', reason: 'invalid_token(API_89)', username: currentUsername };
        }
      }
      // HTTP 401/403 であっても、明示的な code 89 が無ければ即座に invalid_token と決めつけない（CSRF不一致等の可能性）
      if (b.suspended === true) return { ok: false, status: 'unavailable', reason: 'frozen(VERIFY_SUSPENDED)', username: currentUsername };
      if (Array.isArray(b.withheld_in_countries) && b.withheld_in_countries.length > 0) return { ok: false, status: 'unavailable', reason: 'withheld(VERIFY_COUNTRY)', username: currentUsername };
      if (typeof b.statuses_count === 'number') tweetsCount = b.statuses_count;
      if (typeof b.friends_count === 'number') followingCount = b.friends_count;
    }
  }

  // ログイン済みUI要素の確認
  const hasLoggedInDom = await page.evaluate(() => {
    return !!(
      document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
      document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ||
      document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector('input[name="displayName"]')
    );
  }).catch(() => false);

  const hasExplicitLoginDom = await page.evaluate(() => {
    return !!(
      document.querySelector('[data-testid="loginButton"]') ||
      document.querySelector('input[autocomplete="username"]') ||
      document.querySelector('input[name="text"]') ||
      (window.location.pathname.includes('/login') || window.location.pathname.includes('/i/flow/login'))
    );
  }).catch(() => false);

  // 【厳密判定】
  // 1. 明示的なAPIエラー89（トークン失効確定）
  if (explicitApiInvalidToken) {
    return { ok: false, status: 'unavailable', reason: 'invalid_token(API_89)', username: currentUsername };
  }

  // 2. 明示的なログインフォームが表示され、かつログイン済みDOMがない（明らかな未ログイン画面へのリダイレクト）
  if (hasExplicitLoginDom && !hasLoggedInDom && !apiVerified) {
    return { ok: false, status: 'unavailable', reason: 'invalid_token_login_screen', username: currentUsername };
  }

  // 3. タイムアウト、未描画、about:blankなどセッション未確認の場合
  if (!apiVerified && !hasLoggedInDom && !twid) {
    // ログイン画面すら出ていない（プロキシ遅延やタイムアウトによる未描画）
    // これはトークン失効ではなくプロキシタイムアウトとして扱い、誤隔離を防ぐ
    console.log(`  ⚠️ [プロキシ遅延検知] @${currentUsername || '不明'} ログインDOM/API未確認 (gotoError: ${gotoError || 'none'}, path: ${curPath || 'empty'}) -> proxy_timeout として返却`);
    return { ok: false, status: 'proxy_timeout', reason: `proxy_timeout(${gotoError || 'dom_unrendered'})`, username: currentUsername };
  }

  if (snifferState && snifferState.status !== 'ok') {
    return { ok: false, status: snifferState.status === 'robot' ? 'robot' : 'unavailable', reason: `${snifferState.status}(${snifferState.detail})`, username: snifferState.detectedUsername || currentUsername };
  }

  if (tweetsCount === null || followingCount === null) {
    const domCounts = await page.evaluate((u) => {
      try {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          const txt = s.textContent || '';
          if (txt.includes('statuses_count') && txt.includes('friends_count')) {
            const mTw = txt.match(/"statuses_count"\s*:\s*(\d+)/);
            const mFr = txt.match(/"friends_count"\s*:\s*(\d+)/);
            return {
              tw: mTw ? parseInt(mTw[1], 10) : null,
              fr: mFr ? parseInt(mFr[1], 10) : null
            };
          }
        }
      } catch (e) {}
      return { tw: null, fr: null };
    }, currentUsername).catch(() => ({ tw: null, fr: null }));
    if (tweetsCount === null && domCounts.tw !== null) tweetsCount = domCounts.tw;
    if (followingCount === null && domCounts.fr !== null) followingCount = domCounts.fr;
  }
  console.log(`  ✅ [厳密監査クリア] @${currentUsername || '不明'} (過去ツイ: ${tweetsCount ?? 0}件 / フォロー: ${followingCount ?? 0}件)`);
  return { ok: true, status: 'ok', username: currentUsername, tweetsCount, followingCount, description: userDescription };
}

function slimProfileDir(dir) {
  try { ultraSlimProfileFor100k(dir); } catch (e) {}
  if (!dir || !fs.existsSync(dir)) return;
  const heavyDirs = [
    "Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/Service Worker/CacheStorage", "Default/Service Worker/ScriptCache",
    "Default/DawnCache", "Default/Blob_storage", "ShaderCache", "GrShaderCache", "GraphiteDawnCache", "Crashpad"
  ];
  for (const sub of heavyDirs) {
    try { fs.rmSync(path.join(dir, sub), { recursive: true, force: true }); } catch (e) {}
  }
}


// 検査対象アカウントの auth_token を一切使わず、外部視点（GuestToken & 公開API）から
// 「凍結(Suspended)」「日本国内の表示制限(Withheld in JP)」「消滅(NotExist)」を100%無傷で判定する
let cachedGuestToken = null;
let cachedGuestTokenAt = 0;

async function acquireGuestToken() {
  if (cachedGuestToken && (Date.now() - cachedGuestTokenAt < 15 * 60 * 1000)) {
    return cachedGuestToken;
  }
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.x.com',
      port: 443,
      path: '/1.1/guest/activate.json',
      method: 'POST',
      headers: {
        'authorization': `Bearer ${X_WEB_BEARER}`,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'accept-language': 'ja-JP,ja;q=0.9'
      },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && j.guest_token) {
            cachedGuestToken = j.guest_token;
            cachedGuestTokenAt = Date.now();
            return resolve(cachedGuestToken);
          }
        } catch (e) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function inspectUserFromExternalView(screenName, observerAccount = null, forceFresh = false) {
  const cleanId = String(screenName || '').replace(/^@/, '').trim();
  if (!cleanId || cleanId.startsWith('pending_')) return { ok: true, status: 'unknown' };
  const cacheKey = cleanId.toLowerCase();
  if (!forceFresh && externalInspectCache.has(cacheKey)) {
    const cached = externalInspectCache.get(cacheKey);
    if (Date.now() - cached.ts < 30 * 60 * 1000) {
      return cached.res;
    }
  }

  // 方法A: 外部観測アカウント（observerAccount）またはGuestTokenを用いた GraphQL UserByScreenName 照会
  try {
    const guestToken = await acquireGuestToken();
    const variables = JSON.stringify({ screen_name: cleanId, withSafetyModeUserFields: true });
    const features = JSON.stringify({
      hidden_profile_subscriptions_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true
    });
    const gqlPath = `/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

    const headers = {
      'authorization': `Bearer ${X_WEB_BEARER}`,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'accept-language': 'ja-JP,ja;q=0.9',
      'x-twitter-client-language': 'ja',
      'x-twitter-active-user': 'yes'
    };

    if (observerAccount && observerAccount.authToken && observerAccount.ct0) {
      headers['x-csrf-token'] = observerAccount.ct0;
      headers['x-twitter-auth-type'] = 'OAuth2Session';
      headers['cookie'] = `auth_token=${observerAccount.authToken}; ct0=${observerAccount.ct0}; lang=ja`;
    } else if (guestToken) {
      headers['x-guest-token'] = guestToken;
    }

    const res = await httpsGetViaProxy(`https://x.com${gqlPath}`, headers, null, 9000).catch(() => null);
    if (res && res.body) {
      const data = JSON.parse(res.body || '{}');
      const result = data && data.data && data.data.user && data.data.user.result;
      if (data && data.data && (!data.data.user || !result)) {
        return { ok: false, status: 'unavailable', reason: 'not_exist(EXTERNAL_EMPTY)' };
      }
      if (result) {
        const typename = result.__typename || '';
        const unavailReason = String(result.reason || '').toLowerCase();
        if (typename === 'UserUnavailable') {
          if (unavailReason.includes('suspend')) {
            return { ok: false, status: 'unavailable', reason: 'frozen(EXTERNAL_SUSPENDED)' };
          }
          if (unavailReason.includes('withheld') || unavailReason.includes('country')) {
            return { ok: false, status: 'unavailable', reason: 'withheld_in_jp(表示制限アカウント)' };
          }
          return { ok: false, status: 'unavailable', reason: `unavailable(${result.reason || 'EXTERNAL'})` };
        }
        const legacy = result.legacy || {};
        if (legacy.suspended === true) {
          return { ok: false, status: 'unavailable', reason: 'frozen(EXTERNAL_LEGACY_SUSPENDED)' };
        }
        const withheldArr = legacy.withheld_in_countries || result.withheld_in_countries || [];
        if (Array.isArray(withheldArr) && withheldArr.length > 0) {
          return {
            ok: false,
            status: 'unavailable',
            reason: `withheld_in_jp(国別表示制限:${withheldArr.join(',')})`
          };
        }
        if (legacy.withheld_scope) {
          return { ok: false, status: 'unavailable', reason: 'withheld_in_jp(表示制限スコープ)' };
        }
        return {
          ok: true,
          status: 'ok',
          defaultAvatar: !!legacy.default_profile_image,
          followersCount: legacy.followers_count || 0,
          statusesCount: legacy.statuses_count || 0
        };
      }
    }
  } catch (e) {}

  // 方法B: 観測アカウントがある場合は v1.1 users/show.json でもフォールバック確認
  if (observerAccount && observerAccount.authToken && observerAccount.ct0) {
    try {
      const h1 = {
        'authorization': `Bearer ${X_WEB_BEARER}`,
        'x-csrf-token': observerAccount.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'cookie': `auth_token=${observerAccount.authToken}; ct0=${observerAccount.ct0}; lang=ja`,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      };
      const r1 = await httpsGetViaProxy(`https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(cleanId)}`, h1, null, 8000).catch(() => null);
      if (r1 && r1.body) {
        const u = JSON.parse(r1.body || '{}');
        for (const err of (u.errors || [])) {
          if (err.code === 63 || err.code === 64) return { ok: false, status: 'unavailable', reason: 'frozen(EXTERNAL_API_63)' };
          if (err.code === 50) return { ok: false, status: 'unavailable', reason: 'not_exist(EXTERNAL_API_50)' };
        }
        if (u.suspended === true) return { ok: false, status: 'unavailable', reason: 'frozen(EXTERNAL_SUSPENDED)' };
        if (Array.isArray(u.withheld_in_countries) && u.withheld_in_countries.length > 0) {
          return { ok: false, status: 'unavailable', reason: `withheld_in_jp(国別表示制限:${u.withheld_in_countries.join(',')})` };
        }
      }
    } catch (e) {}
  }

  // 方法C: GraphQL/v1.1がレート制限等で応答しなかった場合の最終CDNフォールバック
  const cdnDead = await new Promise((resolve) => {
    const url = 'https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=' + encodeURIComponent(cleanId);
    const req = https.get(url, { timeout: 6000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (Array.isArray(json) && json.length === 0) return resolve(true);
        } catch (e) {}
        resolve(false);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  if (cdnDead) {
    const deadRes = { ok: false, status: 'unavailable', reason: 'frozen(CDN_SUSPENDED)' };
    externalInspectCache.set(cacheKey, { ts: Date.now(), res: deadRes });
    return deadRes;
  }

  const okRes = { ok: true, status: 'ok' };
  externalInspectCache.set(cacheKey, { ts: Date.now(), res: okRes });
  return okRes;
}


// 10万アカウント規模対応：meta.json と認証状態を守りつつ不要キャッシュ・ロックを完全除去
function ultraSlimProfileFor100k(profDir) {
  if (!profDir || !require('fs').existsSync(profDir)) return;
  const fs = require('fs');
  const path = require('path');
  const heavyDirs = [
    'ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'BrowserMetrics',
    'Crashpad', 'component_crx_cache', 'extensions_crx_cache', 'WidevineCdm',
    'Safe Browsing', 'OptimizationGuidePredictionModels', 'Subresource Filter',
    'Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Default/DawnCache', 'Default/DawnWebGPUCache', 'Default/DawnGraphiteCache', 'CertificateRevocation', 'segmentation_platform', 'Default/Shared Dictionary', 'Default/DataSharing', '.cache',
    'Default/Service Worker', 'Default/CacheStorage', 'Default/ScriptCache',
    'Default/blob_storage', 'Default/File System', 'Default/IndexedDB'
  ];
  for (const rel of heavyDirs) {
    const p = path.join(profDir, rel);
    if (fs.existsSync(p)) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
    }
  }
  for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK']) {
    const lp = path.join(profDir, lockName);
    if (fs.existsSync(lp)) {
      try { fs.unlinkSync(lp); } catch (e) {}
    }
  }
}


// 10万件対応：無劣化コールドアーカイブ(.tar.gz)が存在する場合はブラウザ起動直前に自動解凍(Hydrate)する
function ensureProfileHydrated(profDir) {
  if (!profDir) return profDir;
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  const archivePath = `${profDir}.tar.gz`;
  if (fs.existsSync(archivePath) && !fs.existsSync(profDir)) {
    try {
      fs.mkdirSync(profDir, { recursive: true });
      execFileSync('tar', ['-xzf', archivePath, '-C', profDir]);
      fs.unlinkSync(archivePath);
    } catch (e) {}
  }
  return profDir;
}


// マルチサーバー水平分散対応：別サーバーで作成されたアカウントでもFirestoreの属性からmeta.jsonとプロファイルを即時構築する
function ensureCloudProfileSynced(token, accountObj = null) {
  const profDir = getPersistentProfileDir(token);
  if (!accountObj) return profDir;
  const fs = require('fs');
  const path = require('path');
  try {
    fs.mkdirSync(profDir, { recursive: true });
    const metaPath = path.join(profDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      fs.writeFileSync(metaPath, JSON.stringify({
        userId: accountObj.userId || '',
        authToken: token,
        ct0: accountObj.ct0 || null,
        email: accountObj.email || '',
        proxy: accountObj.proxy || null,
        userAgent: accountObj.userAgent || '',
        cookies: accountObj.savedCookies || [],
        syncedFromCloudAt: new Date().toISOString()
      }, null, 2), 'utf8');
    }
  } catch (e) {}
  return profDir;
}

module.exports = {
  ensureCloudProfileSynced,
  ensureProfileHydrated,
  ultraSlimProfileFor100k,
  ensureFarmingDisplay98,
  purgeProfileDirCompletely,
  inspectUserFromExternalView,
  slimProfileDir,
  X_WEB_BEARER,
  getPersistentProfileDir,
  extractKeepCookies,
  httpsGetViaProxy,
  preCheckAccountWithoutBrowser,
  checkAccountHealth: preCheckAccountWithoutBrowser,
  getUltraSavingBrowserArgs,
  enableSmartBandwidthSaver,
  allowImagesForProfileUpload,
  attachApiHealthSniffer,
  inspectPageDomRestrictions,
  verifyAccountStatusFast
};
