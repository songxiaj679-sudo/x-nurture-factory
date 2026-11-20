require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const { db, getAccountsByLifecycleStatuses } = require('./firestore');
const {
  safeCloseBrowser,
  sweepOldTmpProfiles,
  applyInheritedDeviceAndUa,
  checkReachRestrictedOrLocked
} = require('./v3_post_executor');
const { getResidentialProxy, getResidentialProxyForAccount } = require('./iproyal');
const {
  getPostingEligibility,
  getAccountLifecycleStatus,
} = require('./account_state');
const {
  resolveHealthyProxy,
  markProxyUnhealthy,
  installCreateTweetInterceptor,
  resetCapturedTweetsInPage,
  getSelfUserIdFromCookies,
  captureConfirmedTweetId,
  dismissXOverlays,
  openComposerOnHomeOrFallback,
  openReplyComposerReliable
} = require('./x_browser_helpers');
const {
  extractTweetIdFromCreateTweetBody,
  executeAutoPinBillboardPost,
  executeInterleavedOutreachCycle
} = require('./saas_outreach_worker');
const { applyTrackingUrlToReplyText } = require('./funnel_click_tracker');
const {
  canExecuteAutomatedAction,
  recordTokenAction,
  shouldDeferFailedPin,
  markPinAttemptResult,
  shouldDeferBioSync,
  markBioSyncAttempt,
  maybeRefreshLaneTemplates24h
} = require('./saas_rate_and_rotation');
const {
  CACHE_DIR,
  acquireTokenLock,
  releaseTokenLock,
  prepareLockedProfileDir,
  slimBrowserCache
} = require('./token_mutex');
const { decryptCredentials } = require('./official_api_client');

function resolveAccountAuthToken(accData) {
  if (!accData) return '';
  if (accData.encryptedAuthToken) {
    try {
      const dec = decryptCredentials(accData.encryptedAuthToken);
      if (dec && dec.authToken) return String(dec.authToken).trim();
    } catch (e) {}
  }
  return String(accData.authToken || '').trim();
}

const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const GLOBAL_LOCK_FILE = '/tmp/x_autopost_chrome.lock';
const SAAS_MAX_CONCURRENT_BROWSERS = Math.max(1, parseInt(process.env.SAAS_MAX_CONCURRENT_BROWSERS || '16', 10));

const _heldSlotFiles = [];
const _runningAccountIds = new Set();
const _runningLaneKeys = new Set();
const _stickyLanePrimaryDocId = new Map();
const _pendingAsyncAudits = new Set();

function appendLaneTerminalLog(userId, laneNo, msg) {
  try {
    if (!userId) return;
    const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    const lNo = Math.min(3, Math.max(1, parseInt(laneNo || '1', 10)));
    const logFile = `/tmp/xsw_term_${cleanUid}_L${lNo}.json`;
    const jstIso = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
    const ts = jstIso.slice(5, 10).replace('-', '/') + ' ' + jstIso.slice(11, 19);
    const line = `[${ts}] [LANE #0${lNo}] ${msg}`;
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

function logSaaS(tenantTag, msg, fullUserId = null, laneNo = 1) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}][SaaS:${tenantTag}] ${msg}`);
  if (fullUserId) {
    appendLaneTerminalLog(fullUserId, laneNo, msg);
  }
}

function sendTgMessageFromEngine(chatId, htmlText, replyMarkup = null) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '9047128394:AAEN3puCbpuuTZM52NQILwZUGq5afbok-ak').trim();
  if (!chatId || !botToken) return Promise.resolve(null);
  return new Promise((resolve) => {
    const payloadObj = { chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true, text: htmlText };
    if (replyMarkup) payloadObj.reply_markup = replyMarkup;
    const data = JSON.stringify(payloadObj);
    const req = require('https').request({
      hostname: 'api.telegram.org',
      path: '/bot' + botToken + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000
    }, (res) => { res.on('data', () => {}); res.on('end', () => resolve(true)); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}

async function notifyTenantAutoSwap(tenantUser, brokenAccData, roleLabel, remainingHealthyDocs) {
  try {
    const brokenName = brokenAccData.username ? ('@' + String(brokenAccData.username).replace(/^@/, '')) : ('Token:' + String(brokenAccData.authToken || '').slice(0, 6) + '...');
    const nextAcc = remainingHealthyDocs.length > 0 ? remainingHealthyDocs[0].data() : null;
    const nextName = nextAcc ? (nextAcc.username ? ('@' + String(nextAcc.username).replace(/^@/, '')) : ('Token:' + String(nextAcc.authToken || '').slice(0, 6) + '...')) : null;
    const standbyLeft = remainingHealthyDocs.length;
    const reasonEn = (roleLabel === 'シャドウバン' || roleLabel === 'SHADOWBAN')
      ? 'Search Shadowban Detected'
      : ((roleLabel === 'ロボット' || roleLabel === 'LOCKED') ? 'Robot Lock Detected' : 'Account Suspended/Restricted');
    let targetChatId = tenantUser.tgChatId || null;
    if (!targetChatId && ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(tenantUser.userId)) {
      const cfgDoc = await db.collection('settings').doc('payment_config').get().catch(() => null);
      if (cfgDoc && cfgDoc.exists && cfgDoc.data().adminTgChatId) targetChatId = cfgDoc.data().adminTgChatId;
    }
    if (!targetChatId) return;
    const nl = String.fromCharCode(10);
    const msgHtml = '⚡ <b>[0.0s AUTO-SWAP FAILOVER TRIGGERED]</b>' + nl + '━━━━━━━━━━━━━━━━━━━━━━' + nl +
      '• Flagged Account: <b>' + brokenName + '</b> (' + reasonEn + ')' + nl +
      '• Action Taken: ✅ <b>Isolated & swapped in 0.0s to ' + (nextName || '(No standby left)') + '</b>' + nl +
      '• Standby Burners Left: <b>' + standbyLeft + '</b>';
    await sendTgMessageFromEngine(targetChatId, msgHtml);
  } catch (e) {}
}

async function acquireGlobalChromeLock(holderName) {
  const start = Date.now();
  while (Date.now() - start < 180000) {
    for (let slot = 1; slot <= SAAS_MAX_CONCURRENT_BROWSERS; slot++) {
      const slotFile = `/tmp/x_autopost_slot_${slot}.lock`;
      try {
        if (fs.existsSync(slotFile)) {
          const stat = fs.statSync(slotFile);
          if (Date.now() - stat.mtimeMs > 180000) {
            try { fs.unlinkSync(slotFile); } catch (e) {}
          } else { continue; }
        }
        fs.writeFileSync(slotFile, `${process.pid}:${holderName}:${Date.now()}`, { flag: 'wx' });
        _heldSlotFiles.push(slotFile);
        return slotFile;
      } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
  }
  return null;
}

function releaseGlobalChromeLock(specificSlotFile = null) {
  try {
    if (specificSlotFile) {
      const idx = _heldSlotFiles.indexOf(specificSlotFile);
      if (idx !== -1) _heldSlotFiles.splice(idx, 1);
      if (fs.existsSync(specificSlotFile)) fs.unlinkSync(specificSlotFile);
      return;
    }
    const target = _heldSlotFiles.shift() || GLOBAL_LOCK_FILE;
    if (target && fs.existsSync(target)) fs.unlinkSync(target);
  } catch (e) {}
}

function getFixedUserAgent(token) {
  const uas = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
  ];
  if (!token) return uas[1];
  let hash = 0;
  for (let i = 0; i < token.length; i++) { hash = (hash << 5) - hash + token.charCodeAt(i); hash |= 0; }
  return uas[Math.abs(hash) % uas.length];
}

function getFixedViewport(token) {
  let hash = 0;
  const s = String(token || 'default');
  for (let i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; }
  const vps = [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 }
  ];
  return vps[Math.abs(hash) % vps.length];
}

function obfuscateText(rawText) {
  let resolved = String(rawText || '').replace(/\{([^{}]+)\}/g, (_, group) => {
    const opts = group.split('|');
    return opts[Math.floor(Math.random() * opts.length)];
  }).trim();
  const clean = resolved.replace(/\u200B/g, '');
  const invisiblePalette = ['\u2060', '\u200A', '\u2009', '\u2008', ' '];
  let sig = '';
  const padLen = clean.length > 130 ? 2 : 5;
  for (let i = 0; i < padLen; i++) sig += invisiblePalette[Math.floor(Math.random() * invisiblePalette.length)];
  if (clean.includes('\n')) {
    const idx = clean.indexOf('\n');
    return clean.slice(0, idx) + sig.slice(0, 2) + clean.slice(idx) + sig.slice(2);
  }
  return clean + ' ' + sig;
}

function parseProxyString(proxyStr, userProxies = [], token = '', isOwner = false) {
  let raw = String(proxyStr || '').trim();
  if ((!raw || raw.includes('geo.iproyal.com')) && Array.isArray(userProxies) && userProxies.length > 0) {
    const validIspList = userProxies.map(p => String(p || '').trim()).filter(p => p && !p.includes('geo.iproyal.com'));
    if (validIspList.length > 0) {
      let hash = 0;
      const s = String(token || 'default');
      for (let i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; }
      raw = validIspList[Math.abs(hash) % validIspList.length];
    }
  }
  if (isOwner && (!raw || raw.includes('geo.iproyal.com'))) {
    try {
      const csvCandidates = [
        path.join(__dirname, '../iproyal-proxies.csv'),
        path.join(__dirname, 'iproyal-proxies.csv')
      ];
      for (const csvPath of csvCandidates) {
        if (fs.existsSync(csvPath)) {
          const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.toLowerCase().startsWith('host'));
          if (lines.length > 0) {
            let hash = 0;
            const s = String(token || 'default');
            for (let i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; }
            const chosenLine = lines[Math.abs(hash) % lines.length];
            const p = chosenLine.includes(',') ? chosenLine.split(',') : chosenLine.split(':');
            if (p.length >= 4) {
              raw = p[0].trim() + ':' + p[1].trim() + ':' + p[2].trim() + ':' + p.slice(3).join(':').trim();
              break;
            }
          }
        }
      }
    } catch (e) {}
  }
  if (raw && !raw.includes('geo.iproyal.com')) {
    const clean = raw.replace(/^https?:\/\//i, '');
    const parts = clean.split(':');
    if (parts.length >= 4) return { host: parts[0], port: parts[1], user: parts[2], pass: parts.slice(3).join(':') };
    if (parts.length === 2) return { host: parts[0], port: parts[1], user: '', pass: '' };
  }
  if (isOwner && typeof getResidentialProxy === 'function') {
    return getResidentialProxy(token);
  }
  return null;
}

async function checkActionBlock(page) {
  await new Promise(r => setTimeout(r, 1500));
  return await page.evaluate(() => {
    const text = (document.body ? document.body.innerText : '').toLowerCase();
    const badPhrases = ["something went wrong, but don't fret", "not be allowed to perform this action", "やりなおしてください", "許可されていない可能性"];
    return badPhrases.some(phrase => text.includes(phrase));
  }).catch(() => false);
}

// 英語レーン時にひらがな誤字を出さない言語別リアルタイピング
async function humanTyping(page, text, isEnLane = true) {
  const hasCjk = /[\u3040-\u30ff\u4e00-\u9faf]/.test(String(text || ''));
  const dummyKeys = (!isEnLane && hasCjk) ? 'あいうえおかきくけこ' : 'asdfghjklqwertyuiop';
  const chars = Array.from(String(text || ''));
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (Math.random() < 0.018 && char.length === 1 && char.charCodeAt(0) < 255 && char !== '\n' && char !== ' ') {
      const wrongChar = dummyKeys[Math.floor(Math.random() * dummyKeys.length)];
      await page.keyboard.sendCharacter(wrongChar);
      await new Promise(r => setTimeout(r, 85 + Math.random() * 130));
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, 110 + Math.random() * 150));
    }
    if (char === '\n') await page.keyboard.press('Enter');
    else await page.keyboard.sendCharacter(char);
    await new Promise(r => setTimeout(r, 25 + Math.random() * 65));
    if (Math.random() < 0.01) await new Promise(r => setTimeout(r, 500 + Math.random() * 900));
  }
}

async function checkRobotOrLocked(page) {
  try {
    return await page.evaluate(() => {
      const url = window.location.href.toLowerCase();
      if (url.includes('/account/access')) return true;
      if (document.querySelector("iframe[src*='arkoselabs.com'], iframe[src*='funcaptcha']")) return true;
      if (url.includes('/i/flow/login') || url.includes('/login')) {
        if (document.querySelector("input[autocomplete='username'], input[name='text']")) return true;
      }
      const bodyClone = document.body.cloneNode(true);
      bodyClone.querySelectorAll("article, [data-testid='tweet']").forEach(a => a.remove());
      const text = (bodyClone.innerText || '').toLowerCase();
      const kws = ['人間であることを証明', 'prove you are human', 'authenticate to continue', '認証して続行', 'スマートフォンでxアプリ', 'open the x app'];
      return kws.some(kw => text.includes(kw));
    });
  } catch (e) { return false; }
}

function isValidXUsername(name) {
  if (!name) return false;
  const clean = String(name).replace(/^@/, '').trim();
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(clean)) return false;
  const reserved = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'login', 'logout', 'compose', 'intent', 'tos', 'privacy']);
  return !reserved.has(clean.toLowerCase());
}

async function inspectAccountViaInternalApi(page) {
  const cookies = await page.cookies().catch(() => []);
  const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
  if (!ct0) return { apiChecked: false };

  return await page.evaluate(async (bearer, csrf) => {
    try {
      const headers = {
        'authorization': `Bearer ${bearer}`,
        'x-csrf-token': csrf,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session'
      };
      const res = await fetch('https://x.com/i/api/1.1/account/settings.json', {
        credentials: 'include',
        headers
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
      if (Array.isArray(data.withheld_in_countries) && data.withheld_in_countries.length > 0) {
        return { apiChecked: true, status: 'unavailable', reason: 'withheld_in_countries' };
      }
      return {
        apiChecked: true,
        status: 'ok',
        screenName: data.screen_name || null,
        currentBio: typeof data.description === 'string' ? data.description : null
      };
    } catch (e) {
      return { apiChecked: false };
    }
  }, X_WEB_BEARER, ct0).catch(() => ({ apiChecked: false }));
}

async function runAdvancedNurturing(page, tenantTag, fullUid = null, laneNo = 1) {
  logSaaS(tenantTag, `🌱 [Warmup] Scrolling home timeline to simulate natural human browsing...`, fullUid, laneNo);
  try {
    for (let s = 0; s < 2; s++) {
      if (await checkRobotOrLocked(page)) return 'ROBOT';
      await page.evaluate(() => window.scrollBy(0, 400 + Math.random() * 400));
      await new Promise(r => setTimeout(r, 1800 + Math.random() * 1200));
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
    });
    if (clicked) {
      logSaaS(tenantTag, `  👀 [Warmup] Opened peer post details for natural reading dwell-time...`, fullUid, laneNo);
      await new Promise(r => setTimeout(r, 3200 + Math.random() * 2000));
      await page.evaluate(() => window.scrollBy(0, 280 + Math.random() * 250));
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1200));
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1200));
    }
  } catch (e) {}
  return 'OK';
}

async function checkAccountRestrictedFallback(page, cleanUsername, tenantTag, fullUid = null, laneNo = 1) {
  logSaaS(tenantTag, `👀 Auditing @${cleanUsername} profile status...`, fullUid, laneNo);
  await page.goto(`https://x.com/${cleanUsername}`, { waitUntil: 'domcontentloaded', timeout: 50000 }).catch(() => {});
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const isRestricted = await page.evaluate(() => {
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) return false;
      clone.querySelectorAll("article, [data-testid='tweet']").forEach(a => a.remove());
      const text = (clone.innerText || '').toLowerCase();
      const kws = ['account suspended', 'permanently suspended', 'アカウントは凍結', "doesn't exist", '存在しません', '真正性を評価している間', 'リーチは制限される可能性', 'reach may be limited'];
      return kws.some(kw => text.includes(kw));
    }).catch(() => false);
    if (isRestricted) return true;
  }
  return false;
}

// ⚡ 高速内部API同期 ＋ UIフォールバックによる即時BIO・ペルソナ外装反映＆固定
async function syncProfileFastAndLock(page, profileSpec, currentBioFromApi, tenantTag, fullUid = null, laneNo = 1) {
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, laneNo);
  try {
    const targetBio = typeof profileSpec.bio === 'string' ? profileSpec.bio.trim() : '';
    const targetName = typeof profileSpec.name === 'string' ? profileSpec.name.trim() : '';
    const targetLocation = typeof profileSpec.location === 'string' ? profileSpec.location.trim() : '';
    const avatarUrl = typeof profileSpec.avatarUrl === 'string' ? profileSpec.avatarUrl.trim() : '';

    if (!targetBio && !targetName && !targetLocation && !avatarUrl) return false;

    const normalizeBio = (s) => String(s || '').normalize('NFKC').replace(/[\s\u200B-\u200D\u2060\uFE0E\uFEFF]/g, '').toLowerCase().replace(/https?:\/\//g, '');
    if (targetBio && !targetName && !targetLocation && !avatarUrl && typeof currentBioFromApi === 'string') {
      if (normalizeBio(currentBioFromApi) === normalizeBio(targetBio)) {
        _log('  🔒 Profile BIO already matches target (locked & skipping settings navigation).');
        return true;
      }
    }

    const cookies = await page.cookies().catch(() => []);
    const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';

    // 1. 同一セッション上の update_profile.json API で 1秒以内に即時反映を試行（Website欄は変更せずスコア保護）
    if (ct0 && (targetBio || targetName || targetLocation)) {
      const apiSync = await page.evaluate(async (bearer, csrf, spec) => {
        try {
          const params = {};
          if (spec.bio) params.description = spec.bio;
          if (spec.name) params.name = spec.name;
          if (spec.location) params.location = spec.location;
          const res = await fetch('https://x.com/i/api/1.1/account/update_profile.json', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'authorization': 'Bearer ' + bearer,
              'x-csrf-token': csrf,
              'x-twitter-active-user': 'yes',
              'x-twitter-auth-type': 'OAuth2Session',
              'content-type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams(params).toString()
          });
          const data = await res.json().catch(() => ({}));
          return { status: res.status, updatedDesc: data.description || '' };
        } catch (e) {
          return { status: 0, err: e.message };
        }
      }, X_WEB_BEARER, ct0, { bio: targetBio, name: targetName, location: targetLocation }).catch(() => ({ status: 0 }));

      if (apiSync && apiSync.status === 200) {
        // アイコン画像指定がある場合は同時にアップロード
        if (avatarUrl) {
          try {
            const localImg = avatarUrl.startsWith('/uploads/') ? path.join(__dirname, '..', avatarUrl) : avatarUrl;
            if (localImg.startsWith('/') && fs.existsSync(localImg)) {
              const b64 = fs.readFileSync(localImg).toString('base64');
              await page.evaluate(async (bearer, csrf, imgB64) => {
                await fetch('https://x.com/i/api/1.1/account/update_profile_image.json', {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'authorization': 'Bearer ' + bearer,
                    'x-csrf-token': csrf,
                    'x-twitter-active-user': 'yes',
                    'x-twitter-auth-type': 'OAuth2Session',
                    'content-type': 'application/x-www-form-urlencoded'
                  },
                  body: new URLSearchParams({ image: imgB64, skip_status: 'true' }).toString()
                });
              }, X_WEB_BEARER, ct0, b64).catch(() => {});
            }
          } catch (e) {}
        }
        _log(`  ⚡ [Instant BIO Sync] Applied & locked Profile BIO via session API: "${targetBio.slice(0, 42)}..."`);
        return true;
      }
    }

    // 2. APIが非200だった場合のみ /settings/profile のUIから確実に保存
    if (targetBio) {
      _log('📝 Navigating to /settings/profile to apply & lock BIO...');
      await page.goto('https://x.com/settings/profile', { waitUntil: 'domcontentloaded', timeout: 50000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3200));
      const bioSelector = 'textarea[name="description"]';
      const bioInput = await page.waitForSelector(bioSelector, { timeout: 20000 }).catch(() => null);
      if (bioInput) {
        await page.evaluate((sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return;
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, bioSelector, targetBio);
        await new Promise(r => setTimeout(r, 600));
        const saveBtn = await page.$('button[data-testid="Profile_Save_Button"]');
        if (saveBtn) {
          await page.evaluate(b => { if (!b.disabled) b.click(); }, saveBtn);
          if (await checkActionBlock(page)) throw new Error('ACTION_BLOCKED');
          await new Promise(r => setTimeout(r, 3500));
          _log('  💾 Profile BIO saved & locked via UI.');
          return true;
        }
      }
    }
  } catch (e) {
    if (e.message === 'ACTION_BLOCKED') throw e;
  }
  return false;
}

// 投稿スケジュールとは無関係に、BIO変更を検知した瞬間に単独でXプロフィールへ即時反映させる専用ワーカー
async function executeStandaloneInstantBioSync({ tenantUser, targetDoc, accData, laneNo, laneCfg, userProxies }) {
  const docId = targetDoc.id;
  const fullUid = tenantUser.userId;
  const laneLockKey = `${fullUid}_L${laneNo}`;
  if (_runningAccountIds.has(docId) || _runningLaneKeys.has(laneLockKey)) return;

  _runningAccountIds.add(docId);
  _runningLaneKeys.add(laneLockKey);
  markBioSyncAttempt(docId);

  const token = resolveAccountAuthToken(accData);
  const tenantTag = `${fullUid.slice(0, 8)}:L${laneNo}`;
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, laneNo);
  const isOwnerAcc = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(fullUid) || tenantUser.email === 'hank3jones@gmail.com';
  let tokLock = null;
  const proxy = await resolveHealthyProxy({ rawProxyStr: accData.proxy, userProxies, token, isOwner: isOwnerAcc, getResidentialProxy, account: accData, logFn: _log });
  let heldLock = null;
  let browser = null;
  let userDir = null;

  try {
    if (!proxy || !proxy.host) return;
    tokLock = await acquireTokenLock(token, `biosync_${tenantTag}`, 10000);
    if (!tokLock) return;
    heldLock = await acquireGlobalChromeLock(`biosync_${tenantTag}`);
    if (!heldLock) return;

    userDir = prepareLockedProfileDir('main', token);
    const isEnLane = String(laneCfg.aiTargetLang || 'ja').toLowerCase().startsWith('en');
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', isEnLane ? '--lang=en-US' : '--lang=ja-JP'];
    if (proxy && proxy.host) browserArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);

    _log(`⚡ [Instant BIO Sync] Connecting to @${accData.username || token.slice(0, 6)} to apply & lock BIO immediately...`);
    browser = await puppeteer.launch({ headless: 'new', args: browserArgs, ignoreDefaultArgs: ['--enable-automation'], userDataDir: userDir, protocolTimeout: 45000 });
    const page = await browser.newPage();
    await _applySafeMediaAndUpdateBlocker(page);
    await page.setUserAgent(getFixedUserAgent(token));
    await page.setViewport(getFixedViewport(token));
    await applyInheritedDeviceAndUa(page, token, accData.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': isEnLane ? 'en-US,en;q=0.9' : 'ja,en-US;q=0.9,en;q=0.8' });
    if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'lang', value: isEnLane ? 'en' : 'ja', domain: '.x.com', path: '/' }
    );

    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    const apiHealth = await inspectAccountViaInternalApi(page);
    const cleanName = isValidXUsername(apiHealth.screenName) ? apiHealth.screenName : (accData.username || '');
    const targetBio = String(laneCfg.profileBio || '').trim();

    const synced = await syncProfileFastAndLock(
      page,
      {
        bio: targetBio,
        name: laneCfg.personaName || '',
        location: laneCfg.personaLocation || '',
        avatarUrl: laneCfg.personaAvatarUrl || ''
      },
      apiHealth.currentBio,
      tenantTag,
      fullUid,
      laneNo
    );

    if (synced) {
      const upd = { lastSyncedBio: targetBio, lastActionAt: new Date(), updatedAt: new Date() };
      if (isValidXUsername(cleanName)) upd.username = cleanName;
      await targetDoc.ref.update(upd).catch(() => {});
    }

    // レーン側の bioSyncPending フラグを解除
    const uRef = db.collection('saas_users').doc(fullUid);
    const uSnap = await uRef.get().catch(() => null);
    if (uSnap && uSnap.exists) {
      const lanes = uSnap.data().lanes || {};
      const lKey = String(laneNo);
      if (lanes[lKey]) {
        lanes[lKey].bioSyncPending = false;
        await uRef.set({ lanes, updatedAt: new Date() }, { merge: true }).catch(() => {});
      }
    }
  } catch (e) {
    _log(`⚠️ Instant BIO sync warning: ${e.message}`);
  } finally {
    if (browser) await safeCloseBrowser(browser);
    if (userDir) slimBrowserCache(userDir);
    if (heldLock) releaseGlobalChromeLock(heldLock);
    if (tokLock) releaseTokenLock(tokLock);
    _runningAccountIds.delete(docId);
    _runningLaneKeys.delete(laneLockKey);
  }
}

let stickyCheckerIndex = 0;
const _sessionExcludedCheckers = new Set();
async function getHealthyCheckerAccountsForSaaS(mainToken, brokenTokenToExclude = null) {
  if (brokenTokenToExclude) {
    _sessionExcludedCheckers.add(String(brokenTokenToExclude).trim().toLowerCase());
    if (_sessionExcludedCheckers.size > 80) _sessionExcludedCheckers.clear();
  }
  let list = [];
  try {
    const farmingDocs = await getAccountsByLifecycleStatuses(['nurturing'], { limit: 120 });
    for (const doc of farmingDocs) {
      const d = doc.data() || {};
      if (getAccountLifecycleStatus(d) !== 'nurturing') continue;
      const tok = String(d.authToken || (doc.id.length === 40 ? doc.id : '') || '').trim().toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(tok) || tok === mainToken || _sessionExcludedCheckers.has(tok) || d.errorReason || d.reachRestricted) continue;
      list.push({
        token: tok,
        userAgent: d.userAgent || null,
        source: d.source || '',
        originType: d.originType || '',
        signupCountry: d.signupCountry || '',
        country: d.country || '',
        proxy: d.proxy || null,
      });
    }
  } catch (e) {}

  if (list.length === 0) {
    try {
      const chkFiles = [path.join(__dirname, '../checkers.txt'), path.join(__dirname, 'checkers.txt')];
      for (const chkFile of chkFiles) {
        if (fs.existsSync(chkFile)) {
          const lines = fs.readFileSync(chkFile, 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => /^[a-f0-9]{40}$/.test(s) && s !== mainToken && !_sessionExcludedCheckers.has(s));
          if (lines.length > 0) {
            list = lines.map(t => ({ token: t, userAgent: null }));
            break;
          }
        }
      }
    } catch (e) {}
  }

  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function _performCheckerPostSearchNurtureSafe(cPage, logLabel = '', fullUid = null, laneNo = 1) {
  if (!cPage) return;
  const timeoutGuard = new Promise(resolve => setTimeout(resolve, 25000));
  const nurtureTask = (async () => {
    try {
      if (typeof cPage.isClosed === 'function' && cPage.isClosed()) return;
      const curUrl = String(cPage.url() || '').toLowerCase();
      if (curUrl.includes('/account/access') || curUrl.includes('/login') || curUrl.includes('/i/flow/')) return;
      await cPage.evaluate(() => window.scrollBy(0, 280 + Math.random() * 250)).catch(() => {});
      await new Promise(r => setTimeout(r, 1800 + Math.random() * 1200));
      await cPage.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 22000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2200 + Math.random() * 1200));
      await cPage.evaluate(() => window.scrollBy(0, 350 + Math.random() * 350)).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {}
  })();
  await Promise.race([nurtureTask, timeoutGuard]).catch(() => {});
}

async function _waitForSearchDomOrNetwork(cPage, cleanUsername, networkState, maxWaitMs = 22000) {
  const start = Date.now();
  const unameLower = String(cleanUsername || '').replace(/^@/, '').toLowerCase();
  while (Date.now() - start < maxWaitMs) {
    if (networkState.foundTweet) return 'HAS_TWEETS';
    const domState = await cPage.evaluate((uLower) => {
      if (document.readyState !== 'complete') return 'LOADING_DOC';
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      if (articles.length > 0) return 'HAS_TWEETS';
      if (uLower) {
        const statusLinks = Array.from(document.querySelectorAll('a[href*="/status/"]'));
        if (statusLinks.some(a => String(a.getAttribute('href') || '').toLowerCase().includes('/' + uLower + '/status/'))) {
          return 'HAS_TWEETS';
        }
      }
      const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\s+/g, '').toLowerCase();
      if (bodyText.includes('やりなおしてください') || bodyText.includes('問題が発生しました') || bodyText.includes('somethingwentwrong')) {
        return 'RETRY';
      }
      const spinners = document.querySelectorAll('[role="progressbar"]');
      if (spinners && spinners.length > 0) return 'LOADING_SPINNER';
      if (document.querySelector('[data-testid="emptyState"]') || bodyText.includes('検索結果はありません') || bodyText.includes('noresultsfor')) {
        return 'NO_RESULT';
      }
      return 'WAIT';
    }, unameLower).catch(() => 'EVAL_ERROR');

    if (domState === 'HAS_TWEETS' || domState === 'NO_RESULT' || domState === 'RETRY' || domState === 'EVAL_ERROR') {
      return domState;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return networkState.foundTweet ? 'HAS_TWEETS' : 'WAIT';
}

async function runIsolatedCheckerSearch(cleanUsername, proxy, mainToken, tenantTag = 'V3', fullUid = null, laneNo = 1) {
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, laneNo);
  if (!isValidXUsername(cleanUsername)) return 'CHECKER_ERROR';

  let rawList = await getHealthyCheckerAccountsForSaaS(mainToken).catch(() => []);
  const checkers = (rawList || []).map(item => (typeof item === 'string' ? { token: item, userAgent: null } : item)).filter(x => x && x.token);
  if (checkers.length === 0) return 'SUCCESS';

  _log(`⏳ [Async Checker] Waiting 35s in background for @${cleanUsername}'s post to index...`);
  await new Promise(r => setTimeout(r, 35000));

  let confirmedEmptyCheckers = 0;

  for (let tryCount = 0; tryCount < Math.min(3, checkers.length); tryCount++) {
    const chkObj = checkers[stickyCheckerIndex % checkers.length];
    const CHECKER_AUTH_TOKEN = chkObj.token;

    let chkTokLock = null;
    let chkLock = null;
    let cBrowser = null;
    let cPage = null;
    let checkerDir = null;
    try {
      chkTokLock = await acquireTokenLock(CHECKER_AUTH_TOKEN, `chk_${tenantTag}`, 5000);
      if (!chkTokLock) { stickyCheckerIndex++; continue; }

      chkLock = await acquireGlobalChromeLock(`chk_${tenantTag}`);
      if (!chkLock) continue;

      checkerDir = prepareLockedProfileDir('checker', CHECKER_AUTH_TOKEN);
      _log(`🔍 [Async Checker] Auditing search visibility for @${cleanUsername} (Checker: ${CHECKER_AUTH_TOKEN.substring(0, 6)}...)...`);

      const isolatedCheckerProxy = getResidentialProxyForAccount(CHECKER_AUTH_TOKEN, chkObj) || proxy;
      const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=ja-JP'];
      if (isolatedCheckerProxy && isolatedCheckerProxy.host) browserArgs.push(`--proxy-server=http://${isolatedCheckerProxy.host}:${isolatedCheckerProxy.port}`);

      cBrowser = await puppeteer.launch({
        headless: 'new',
        args: browserArgs,
        ignoreDefaultArgs: ['--enable-automation'],
        userDataDir: checkerDir,
        protocolTimeout: 55000
      });
      cPage = await cBrowser.newPage();
      await _applySafeMediaAndUpdateBlocker(cPage);
      await cPage.setUserAgent(getFixedUserAgent(CHECKER_AUTH_TOKEN));
      await cPage.setViewport(getFixedViewport(CHECKER_AUTH_TOKEN));
      await applyInheritedDeviceAndUa(cPage, CHECKER_AUTH_TOKEN, chkObj.userAgent);

      if (isolatedCheckerProxy && isolatedCheckerProxy.user && isolatedCheckerProxy.pass) {
        await cPage.authenticate({ username: isolatedCheckerProxy.user, password: isolatedCheckerProxy.pass });
      }

      await cPage.setCookie(
        { name: 'auth_token', value: CHECKER_AUTH_TOKEN, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
        { name: 'auth_token', value: CHECKER_AUTH_TOKEN, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
      );

      await cPage.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 38000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      const homeCookies = await cPage.cookies('https://x.com').catch(() => []);
      const isCheckerLoggedIn = homeCookies.some(c => c.name === 'ct0') && homeCookies.some(c => c.name === 'twid');
      if (!isCheckerLoggedIn || (await checkRobotOrLocked(cPage))) {
        await getHealthyCheckerAccountsForSaaS(mainToken, CHECKER_AUTH_TOKEN);
        stickyCheckerIndex++;
        continue;
      }

      const networkState = { foundTweet: false };
      const unameCleanLower = String(cleanUsername || '').replace(/^@/, '').toLowerCase();
      cPage.on('response', async (res) => {
        try {
          const u = res.url();
          if ((u.includes('SearchTimeline') || u.includes('adaptive.json')) && res.status() === 200) {
            const txt = await res.text().catch(() => '');
            if (txt && txt.toLowerCase().includes(unameCleanLower) && (txt.includes('"tweet_results"') || txt.includes('"full_text"'))) {
              networkState.foundTweet = true;
            }
          }
        } catch (e) {}
      });

      const targetUrl = `https://x.com/search?q=from%3A${encodeURIComponent(cleanUsername)}&f=live`;
      await cPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 42000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2800));

      if (await checkRobotOrLocked(cPage)) {
        stickyCheckerIndex++;
        continue;
      }

      let sawExplicitEmpty = false;
      let foundTweet = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const evalResult = await _waitForSearchDomOrNetwork(cPage, cleanUsername, networkState, 20000);
        if (evalResult === 'HAS_TWEETS') { foundTweet = true; break; }
        if (evalResult === 'NO_RESULT') {
          sawExplicitEmpty = true;
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 8000));
            await cPage.reload({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          break;
        }
        break;
      }

      if (foundTweet) return 'FOUND';
      if (sawExplicitEmpty) {
        confirmedEmptyCheckers++;
        stickyCheckerIndex++;
        if (confirmedEmptyCheckers >= 2) return 'NOT_FOUND';
        continue;
      }
      stickyCheckerIndex++;
    } catch (e) {
      stickyCheckerIndex++;
    } finally {
      if (cBrowser) {
        try { if (cPage) await _performCheckerPostSearchNurtureSafe(cPage, tenantTag, fullUid, laneNo); } catch (_e) {}
        await safeCloseBrowser(cBrowser);
      }
      if (checkerDir) slimBrowserCache(checkerDir);
      if (chkLock) releaseGlobalChromeLock(chkLock);
      if (chkTokLock) releaseTokenLock(chkTokLock);
    }
  }
  return 'CHECKER_ERROR';
}

// バックグラウンド非同期チェッカー（メインの投稿ループを一切ブロックせず、シャドウバン検知時のみ即座に0.0sスワップを発動）
function enqueueAsyncCheckerAudit({ tenantUser, targetDoc, accData, cleanUsername, proxy, token, accLaneNo }) {
  const docId = targetDoc.id;
  if (_pendingAsyncAudits.has(docId)) return;
  _pendingAsyncAudits.add(docId);

  const fullUid = tenantUser.userId;
  const laneLockKey = `${fullUid}_L${accLaneNo}`;
  const tenantTag = `${fullUid.slice(0, 8)}:L${accLaneNo}`;
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, accLaneNo);

  setImmediate(async () => {
    try {
      const checkRes = await runIsolatedCheckerSearch(cleanUsername, proxy, token, tenantTag, fullUid, accLaneNo);
      if (checkRes === 'FOUND' || checkRes === 'SUCCESS' || checkRes === 'CHECKER_ERROR') {
        _log(`🟢 [Async Checker] Search visibility verified for @${cleanUsername}!`);
        await targetDoc.ref.update({ shadowbanStrikes: 0 }).catch(() => {});
        return;
      }

      // NOT_FOUND (2台の独立チェッカーが検索除外を確認)
      const freshSnap = await targetDoc.ref.get().catch(() => null);
      const freshData = (freshSnap && freshSnap.exists) ? freshSnap.data() : accData;
      const strikes = parseInt(freshData.shadowbanStrikes || '0', 10) + 1;

      if (strikes < 2) {
        _log(`🔎 [Async Checker] Search index delay on @${cleanUsername} (Strike 1/2). Will re-verify on next post.`);
        await targetDoc.ref.update({ shadowbanStrikes: strikes, updatedAt: new Date() }).catch(() => {});
      } else {
        const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', fullUid).get();
        const remaining = aSnap.docs.filter(d => {
          const da = d.data() || {};
          return d.id !== docId && parseInt(da.laneIndex || '1', 10) === accLaneNo && da.isActive !== false && (da.role === '最新' || da.role === 'ACTIVE');
        });
        const now = new Date();
        if (remaining.length > 0) {
          _stickyLanePrimaryDocId.set(laneLockKey, remaining[0].id);
          await remaining[0].ref.update({ promotedAt: now, nextPostAt: new Date(0), updatedAt: now }).catch(() => {});
        } else {
          _stickyLanePrimaryDocId.delete(laneLockKey);
        }
        await targetDoc.ref.update({ role: 'シャドウバン', isActive: false, updatedAt: now }).catch(() => {});
        _log(`🚨 [Async Checker] Confirmed Search Shadowban on @${cleanUsername}! Executed 0.0s Auto-Swap to next standby burner.`);
        await notifyTenantAutoSwap(tenantUser, freshData, 'SHADOWBAN', remaining);
      }
    } catch (e) {
      _log(`⚠️ Async checker error: ${e.message}`);
    } finally {
      _pendingAsyncAudits.delete(docId);
    }
  });
}

// ============================================================================
// 🏆 Phase 1 刷新版: 排他ロック + ゴミ検証ポスト廃止 + 即時BIO固定 + 3段階TweetID取得 + 非同期チェッカー間引き
// ============================================================================
async function runTenantPostCycle(tenantUser, accDocRef, accData, postsList, threadNo = 1) {
  const token = resolveAccountAuthToken(accData);
  const fullUid = tenantUser.userId;
  const accLaneNo = Math.min(3, Math.max(1, parseInt(accData.laneIndex || threadNo || '1', 10)));
  const laneCfg = (tenantUser.lanes && tenantUser.lanes[String(accLaneNo)]) ? tenantUser.lanes[String(accLaneNo)] : {};
  const isVerification = (accData.role === '検証中' || accData.role === 'VERIFYING' || !accData.role);
  let cleanUsername = isValidXUsername(accData.username) ? accData.username.replace(/^@/, '').trim() : '';
  const tenantTag = `${fullUid.slice(0, 8)}:L${accLaneNo}`;
  const isOwnerAcc = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(fullUid) || tenantUser.email === 'hank3jones@gmail.com';
  let tokLock = null;
  let heldLock = null;
  let browser = null;
  let userDir = null;
  let proxy = null;

  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, accLaneNo);

  if (!isVerification) {
    const postingEligibility = getPostingEligibility(accData);
    if (!postingEligibility.eligible) {
      _log(`⛔ Publishing blocked for @${cleanUsername || token.slice(0, 6)}: ${postingEligibility.reason}`);
      return 'not_eligible';
    }
  }

  try {
    proxy = await resolveHealthyProxy({
      rawProxyStr: accData.proxy,
      userProxies: tenantUser.assignedProxies,
      token,
      isOwner: isOwnerAcc,
      getResidentialProxy,
      account: accData,
      logFn: _log
    });

    if (!proxy || !proxy.host) {
      _log('⚠️ No healthy proxy available for this lane right now. Retrying shortly...');
      return 'system_error';
    }

    tokLock = await acquireTokenLock(token, `post_${tenantTag}`, 15000);
    if (!tokLock) {
      _log('⏳ Burner token is currently busy with another action. Deferring briefly...');
      return 'system_error';
    }

    heldLock = await acquireGlobalChromeLock(`post_${tenantTag}`);
    if (!heldLock) {
      _log('⏳ All browser worker slots are busy. Deferring cycle...');
      return 'system_error';
    }

    userDir = prepareLockedProfileDir('main', token);
    _log(`🚀 [Start ${isVerification ? 'Fast Health Check' : 'Auto-Post'}] Burner: @${cleanUsername || 'resolving...'} (Token: ${token.substring(0, 6)}... / Proxy: ${proxy.host})`);

    const isEnLane = String(laneCfg.aiTargetLang || 'ja').toLowerCase().startsWith('en');
    const browserLangArg = isEnLane ? '--lang=en-US' : '--lang=ja-JP';
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', browserLangArg];
    if (proxy && proxy.host) browserArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);

    browser = await puppeteer.launch({ headless: 'new', args: browserArgs, ignoreDefaultArgs: ['--enable-automation'], userDataDir: userDir, protocolTimeout: 45000 });
    const page = await browser.newPage();
    await _applySafeMediaAndUpdateBlocker(page);
    await installCreateTweetInterceptor(page);
    page.setDefaultNavigationTimeout(32000);

    await page.setUserAgent(getFixedUserAgent(token));
    await page.setViewport(getFixedViewport(token));
    await applyInheritedDeviceAndUa(page, token, accData.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': isEnLane ? 'en-US,en;q=0.9' : 'ja,en-US;q=0.9,en;q=0.8' });
    if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'lang', value: isEnLane ? 'en' : 'ja', domain: '.x.com', path: '/' }
    );

    let homeNavErr = null;
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 32000 }).catch(e => { homeNavErr = e; });
    await new Promise(r => setTimeout(r, 3000));

    const landedUrl = String(page.url() || '').toLowerCase();
    if (landedUrl.startsWith('chrome-error://') || landedUrl === 'about:blank' || !landedUrl.includes('x.com')) {
      markProxyUnhealthy(proxy);
      _log(`⚠️ Proxy ${proxy.host} stalled loading /home (${homeNavErr ? homeNavErr.message : landedUrl}). Switching proxy on retry...`);
      return 'system_error';
    }

    if (await checkRobotOrLocked(page)) {
      _log(`🚨 Robot challenge / account lock detected on @${cleanUsername || token.slice(0, 6)}. Isolating...`);
      return 'robot';
    }

    const homeCookies = await page.cookies('https://x.com').catch(() => []);
    const hasTwid = homeCookies.some(c => c.name === 'twid');
    const selfUserId = await getSelfUserIdFromCookies(page);
    const isLoggedOutLanding = /^https:\/\/(www\.)?(x|twitter)\.com\/?(\?.*)?$/.test(landedUrl) || landedUrl.includes('/login') || landedUrl.includes('/i/flow/login');
    if (!hasTwid || isLoggedOutLanding) {
      _log(`🚨 Token (${token.slice(0, 6)}...) is logged out or expired. Triggering 0.0s Auto-Swap!`);
      return 'unavailable';
    }

    // X のメインUIカラムが描画されるまで最大8秒待機（未描画のまま進むのを防止）
    const appShellReady = await page.waitForSelector('[data-testid="primaryColumn"], [data-testid="SideNav_NewTweet_Button"], [data-testid="AppTabBar_Profile_Link"]', { timeout: 9000 }).catch(() => null);
    const apiHealth = await inspectAccountViaInternalApi(page);

    if (!appShellReady && !apiHealth.apiChecked) {
      markProxyUnhealthy(proxy);
      _log(`⚠️ X app shell failed to render over proxy ${proxy.host}. Marked proxy unhealthy & retrying...`);
      return 'system_error';
    }

    if (apiHealth.apiChecked) {
      if (apiHealth.status === 'unavailable') return 'unavailable';
      if (apiHealth.status === 'robot') return 'robot';
      if (isValidXUsername(apiHealth.screenName)) {
        cleanUsername = apiHealth.screenName;
        accData.username = cleanUsername;
        await accDocRef.update({ username: cleanUsername, userId: cleanUsername, updatedAt: new Date() }).catch(() => {});
      }
      _log(`✅ Account health verified on /home: @${cleanUsername}`);
    }

    if (!isValidXUsername(cleanUsername)) {
      const handle = await page.evaluate(async () => {
        for (let k = 0; k < 4; k++) {
          const a = document.querySelector("a[data-testid='AppTabBar_Profile_Link']");
          if (a) {
            const href = a.getAttribute('href');
            if (href && href !== '/home' && href !== '/') return href.split('/').pop().split('?')[0];
          }
          await new Promise(r => setTimeout(r, 800));
        }
        return null;
      }).catch(() => null);

      if (isValidXUsername(handle)) {
        cleanUsername = handle;
        accData.username = handle;
        await accDocRef.update({ username: cleanUsername, userId: cleanUsername, updatedAt: new Date() }).catch(() => {});
      } else {
        return 'system_error';
      }
      if (await checkAccountRestrictedFallback(page, cleanUsername, tenantTag, fullUid, accLaneNo)) {
        return 'unavailable';
      }
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 32000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2500));
    }

    await dismissXOverlays(page);
    const reachCheck = await checkReachRestrictedOrLocked(page);
    if (reachCheck === 'REACH_RESTRICTED') {
      _log(`🚨 @${cleanUsername} has an active reach-restriction banner. Isolating...`);
      return 'shadowban';
    }

    const rawTargetBio = typeof laneCfg.profileBio === 'string' ? laneCfg.profileBio.trim() : '';
    const needsBioSync = rawTargetBio && (laneCfg.bioSyncPending === true || accData.lastSyncedBio !== rawTargetBio);
    if (needsBioSync) {
      const bioDone = await syncProfileFastAndLock(
        page,
        {
          bio: rawTargetBio,
          name: laneCfg.personaName || '',
          location: laneCfg.personaLocation || '',
          avatarUrl: laneCfg.personaAvatarUrl || ''
        },
        apiHealth.currentBio,
        tenantTag,
        fullUid,
        accLaneNo
      );
      if (bioDone) {
        await accDocRef.update({ lastSyncedBio: rawTargetBio, updatedAt: new Date() }).catch(() => {});
        if (!String(page.url() || '').includes('/home')) {
          await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 2200));
        }
      }
    }

    if (isVerification) {
      await page.evaluate(() => window.scrollBy(0, 350 + Math.random() * 250)).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      _log(`🎉 Fast health verification passed for @${cleanUsername} (zero spam test post)!`);
      return 'verified';
    }

    const lanePosts = (postsList || []).filter(p => p.isEnabled !== false && parseInt(p.laneIndex || '1', 10) === accLaneNo);
    if (lanePosts.length === 0) {
      _log(`⚠️ [Lane #0${accLaneNo}] No enabled post templates in this lane.`);
      return 'system_error';
    }

    const nurtureRes = await runAdvancedNurturing(page, tenantTag, fullUid, accLaneNo);
    if (nurtureRes === 'ROBOT') return 'robot';

    lanePosts.sort((a, b) => {
      const sa = typeof a.sortOrder === 'number' ? a.sortOrder : (a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0);
      const sb = typeof b.sortOrder === 'number' ? b.sortOrder : (b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0);
      return sa - sb;
    });
    const selMode = laneCfg.postSelectionMode || tenantUser.postSelectionMode || 'loop';
    let selectedPost = null;
    if (selMode === 'random') {
      selectedPost = lanePosts[Math.floor(Math.random() * lanePosts.length)];
    } else {
      const nextIdx = (parseInt(accData.lastPostIdx || '0', 10)) % lanePosts.length;
      selectedPost = lanePosts[nextIdx];
      await accDocRef.update({ lastPostIdx: nextIdx + 1 }).catch(() => {});
    }
    const fullText = obfuscateText(selectedPost.text || selectedPost.content || '');

    _log(`👤 Opening SPA post composer for @${cleanUsername}...`);
    const { textbox, scopeSelector } = await openComposerOnHomeOrFallback(page, _log);
    if (!textbox) {
      if (await checkRobotOrLocked(page)) return 'robot';
      const curU = String(page.url() || '').toLowerCase();
      if (/^https:\/\/(www\.)?(x|twitter)\.com\/?(\?.*)?$/.test(curU) || curU.includes('/login')) return 'unavailable';
      markProxyUnhealthy(proxy, 5 * 60 * 1000);
      throw new Error('Composer textbox not found (URL: ' + curU.slice(0, 45) + ')');
    }

    let tempImagePath = null;
    const rawImgUrl = (selectedPost && selectedPost.imageUrl) ? String(selectedPost.imageUrl).trim() : (laneCfg.defaultPromoImageUrl || '');

    if (rawImgUrl !== '') {
      try {
        _log('📸 Attaching promo image (sharp brightness & flatten modulation)...');
        let localTarget = rawImgUrl.startsWith('/uploads/') ? path.join(__dirname, '..', rawImgUrl) : rawImgUrl;
        let buffer = null;
        if (localTarget.startsWith('/') && fs.existsSync(localTarget)) {
          buffer = fs.readFileSync(localTarget);
        } else if (rawImgUrl.startsWith('http')) {
          const fetchNode = (await import('node-fetch')).default;
          const imgRes = await fetchNode(rawImgUrl);
          buffer = await imgRes.buffer();
        }
        if (buffer) {
          tempImagePath = path.join(CACHE_DIR, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
          await require('sharp')(buffer)
            .flatten({ background: '#ffffff' })
            .modulate({ brightness: 1.0 + (Math.random() * 0.02 - 0.01) })
            .jpeg({ quality: 92 })
            .toFile(tempImagePath);
          const fileInput = (scopeSelector ? await page.$(scopeSelector + 'input[type="file"]') : null) || await page.$('input[type="file"]');
          if (fileInput) {
            await fileInput.uploadFile(tempImagePath);
            await new Promise(r => setTimeout(r, 3000));
            for (let w = 0; w < 12; w++) {
              const uploading = await page.evaluate(() => !!document.querySelector('[data-testid="attachments"] [role="progressbar"]')).catch(() => false);
              if (!uploading) break;
              await new Promise(r => setTimeout(r, 1000));
            }
            await new Promise(r => setTimeout(r, 1200));
          }
        }
      } catch (err) {
        _log('⚠️ Image attachment skipped.');
      }
    }

    await page.evaluate(el => el.focus(), textbox);
    await textbox.click();
    await new Promise(r => setTimeout(r, 600));

    _log(`✍️ Typing post on @${cleanUsername} (${isEnLane ? 'EN' : 'JA'} keystroke profile)...`);
    await humanTyping(page, fullText, isEnLane);
    await new Promise(r => setTimeout(r, 1600));

    await resetCapturedTweetsInPage(page);
    const clickedSubmit = await page.evaluate((scope) => {
      const sel = (scope ? scope + '[data-testid="tweetButton"], ' + scope + '[data-testid="tweetButtonInline"], ' : '') +
        '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
      const btns = Array.from(document.querySelectorAll(sel));
      for (const b of btns) {
        if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') {
          b.click();
          return true;
        }
      }
      return false;
    }, scopeSelector);
    if (!clickedSubmit) throw new Error('Submit button was disabled');

    const postCapture = await captureConfirmedTweetId(page, {
      cleanUsername,
      selfUserId,
      isReply: false,
      excludeIds: [accData.pinnedPostTweetId],
      timeoutMs: 10500
    });

    if (await checkActionBlock(page)) throw new Error('ACTION_BLOCKED');

    if (tempImagePath && fs.existsSync(tempImagePath)) {
      try { fs.unlinkSync(tempImagePath); } catch (e) {}
    }

    const capturedTweetId = postCapture.tweetId;
    if (!capturedTweetId) {
      throw new Error('Post Tweet ID unconfirmed (' + (postCapture.errorMsg || 'no_id') + ')');
    }

    const postedUrl = `https://x.com/${cleanUsername}/status/${capturedTweetId}`;
    _log(`✅ Published live post on @${cleanUsername} -> ${postedUrl}`);

    const rawTplReply = (selectedPost && selectedPost.selfReplyText) ? String(selectedPost.selfReplyText).trim() : '';
    const selfReplyRaw = applyTrackingUrlToReplyText(rawTplReply, laneCfg, 'p' + (parseInt(accData.postCount || '0', 10) + 1));
    if (selfReplyRaw && capturedTweetId) {
      try {
        const waitBeforeReplyMs = 6000 + Math.floor(Math.random() * 4000);
        _log(`⏳ Waiting ${(waitBeforeReplyMs / 1000).toFixed(1)}s before attaching self-reply URL...`);
        await new Promise(r => setTimeout(r, waitBeforeReplyMs));
        const replyPayload = obfuscateText(selfReplyRaw);
        await page.goto(postedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2600));
        const { textbox: replyBox, scopeSelector: repScope } = await openReplyComposerReliable(page);
        if (replyBox) {
          await page.evaluate(el => el.focus(), replyBox);
          await replyBox.click();
          await new Promise(r => setTimeout(r, 450));
          await humanTyping(page, replyPayload, isEnLane);
          await new Promise(r => setTimeout(r, 1000));
          await resetCapturedTweetsInPage(page);
          await page.evaluate((scope) => {
            const sel = (scope ? scope + '[data-testid="tweetButton"], ' + scope + '[data-testid="tweetButtonInline"], ' : '') +
              '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';
            const btns = Array.from(document.querySelectorAll(sel));
            for (const b of btns) { if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return true; } }
            return false;
          }, repScope);
          const srCap = await captureConfirmedTweetId(page, {
            cleanUsername,
            selfUserId,
            isReply: true,
            excludeIds: [capturedTweetId, accData.pinnedPostTweetId],
            timeoutMs: 8500
          });
          _log(`💬 Attached self-reply tree URL to @${cleanUsername}'s post${srCap.tweetId ? ' (Reply ID: ' + srCap.tweetId + ')' : ''}!`);
        }
      } catch (e) {}
    }

    await db.collection('saas_history').add({
      ownerUserId: tenantUser.userId,
      laneIndex: accLaneNo,
      threadNo: accLaneNo,
      accountDocId: accDocRef.id,
      authToken: token,
      username: cleanUsername,
      tweetId: capturedTweetId,
      mode: 'auto_post',
      text: fullText.substring(0, 60),
      url: postedUrl,
      deleteReq: false,
      deleted: false,
      createdAt: new Date()
    }).catch(() => {});

    // ブラウザとロックを即座に解放してから、バックグラウンドで間引きチェッカーをキュー投入
    await safeCloseBrowser(browser);
    browser = null;
    slimBrowserCache(userDir);
    releaseGlobalChromeLock(heldLock);
    heldLock = null;
    releaseTokenLock(tokLock);
    tokLock = null;

    recordTokenAction(token, 'post');
    const newPostCount = parseInt(accData.postCount || '0', 10) + 1;
    await accDocRef.update({ postCount: newPostCount, lastActionAt: new Date() }).catch(() => {});

    if (newPostCount === 1 || newPostCount % 4 === 0) {
      enqueueAsyncCheckerAudit({
        tenantUser,
        targetDoc: { id: accDocRef.id, ref: accDocRef },
        accData,
        cleanUsername,
        proxy,
        token,
        accLaneNo
      });
    } else {
      _log(`⚡ [Fast Cycle] Post #${newPostCount} complete (next search audit scheduled on post #${Math.ceil(newPostCount / 4) * 4}).`);
    }

    return 'success';
  } catch (e) {
    _log(`❌ Post cycle error: ${e.message}`);
    if (e && e.message && e.message.includes('ACTION_BLOCKED')) return 'unavailable';
    return 'system_error';
  } finally {
    if (browser) await safeCloseBrowser(browser);
    if (userDir) slimBrowserCache(userDir);
    if (heldLock) releaseGlobalChromeLock(heldLock);
    if (tokLock) releaseTokenLock(tokLock);
  }
}

let _lastGcAt = 0;
function runPeriodicGarbageCollection() {
  if (Date.now() - _lastGcAt < 600000) return;
  _lastGcAt = Date.now();
  try {
    sweepOldTmpProfiles();
    const now = Date.now();
    if (fs.existsSync(CACHE_DIR)) {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (/^(upload_|camo_|webtest_camo_|outbound_camo_)/i.test(f)) {
          const full = path.join(CACHE_DIR, f);
          try { if (now - fs.statSync(full).mtimeMs > 1800000) fs.unlinkSync(full); } catch (e) {}
        }
      }
    }
    for (let slot = 1; slot <= SAAS_MAX_CONCURRENT_BROWSERS; slot++) {
      const sf = `/tmp/x_autopost_slot_${slot}.lock`;
      if (fs.existsSync(sf)) {
        try { if (now - fs.statSync(sf).mtimeMs > 180000) fs.unlinkSync(sf); } catch (e) {}
      }
    }
  } catch (e) {}
}

async function executeTenantRemoteDelete(tenantUser, accDocId, accData, historyDocs) {
  if (_runningAccountIds.has(accDocId)) return;
  _runningAccountIds.add(accDocId);

  const token = resolveAccountAuthToken(accData);
  const fullUid = tenantUser.userId;
  const accLaneNo = Math.min(3, Math.max(1, parseInt(accData.laneIndex || '1', 10)));
  const isOwnerAcc = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(fullUid) || tenantUser.email === 'hank3jones@gmail.com';
  const tenantTag = `${fullUid.slice(0, 8)}:L${accLaneNo}`;
  const cleanUsername = String(accData.username || '').replace(/^@/, '').trim();
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, accLaneNo);

  let tokLock = null;
  let heldLock = null;
  let browser = null;
  let userDir = null;
  try {
    // del_healthy_proxy
    const proxy = await resolveHealthyProxy({ rawProxyStr: accData.proxy, userProxies: tenantUser.assignedProxies, token, isOwner: isOwnerAcc, getResidentialProxy, account: accData, logFn: _log });
    if (!proxy || !proxy.host) return;
    tokLock = await acquireTokenLock(token, `del_${tenantTag}`, 15000);
    if (!tokLock) return;
    heldLock = await acquireGlobalChromeLock(`del_${tenantTag}`);
    if (!heldLock) return;

    userDir = prepareLockedProfileDir('del', token);
    _log(`🗑️ Starting remote deletion of ${historyDocs.length} post(s) on @${cleanUsername || 'user'}...`);
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=ja-JP'];
    if (proxy && proxy.host) browserArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);

    browser = await puppeteer.launch({ headless: 'new', args: browserArgs, ignoreDefaultArgs: ['--enable-automation'], userDataDir: userDir, protocolTimeout: 45000 });
    const page = await browser.newPage();
    await _applySafeMediaAndUpdateBlocker(page);
    await page.setUserAgent(getFixedUserAgent(token));
    await page.setViewport(getFixedViewport(token));
    await applyInheritedDeviceAndUa(page, token, accData.userAgent);
    if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    );

    for (const hDoc of historyDocs) {
      const url = hDoc.data().url;
      if (!url || !url.includes('/status/')) {
        await hDoc.ref.update({ deleted: true, deleteReq: false, deletedAt: new Date() });
        continue;
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 22000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const caretClicked = await page.evaluate((targetUrl) => {
        const match = targetUrl.match(/status\/(\d+)/);
        const tweetId = match ? match[1] : null;
        const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        let targetCaret = null;
        for (const article of articles) {
          if (tweetId && (article.innerHTML || '').includes(tweetId)) {
            targetCaret = article.querySelector('[data-testid="caret"]');
            if (targetCaret) break;
          }
        }
        if (!targetCaret) targetCaret = document.querySelector('article[data-testid="tweet"] [data-testid="caret"]');
        if (!targetCaret) return false;
        targetCaret.click();
        return true;
      }, url).catch(() => false);

      if (caretClicked) {
        await new Promise(r => setTimeout(r, 1000));
        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
          const delItem = items.find(el => /削除|delete/i.test(el.innerText || '')) || items[0];
          if (delItem) delItem.click();
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
        await page.evaluate(() => {
          const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          if (confirmBtn) confirmBtn.click();
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 2500));
        _log('  -> ✅ Post deleted from X.');
      }
      await hDoc.ref.update({ deleted: true, deleteReq: false, deletedAt: new Date() }).catch(() => {});
    }
  } catch (e) {
    _log(`❌ Remote delete error: ${e.message}`);
  } finally {
    if (browser) await safeCloseBrowser(browser);
    if (userDir) slimBrowserCache(userDir);
    if (heldLock) releaseGlobalChromeLock(heldLock);
    if (tokLock) releaseTokenLock(tokLock);
    _runningAccountIds.delete(accDocId);
  }
}

async function auditTenantContractsAndProxies(userId, tenantUser) {
  try {
    if (['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(userId) || tenantUser.email === 'hank3jones@gmail.com') {
      return tenantUser;
    }
    const cSnap = await db.collection('saas_contracts').where('userId', '==', userId).get();
    if (cSnap.empty) return tenantUser;
    let activeSum = 0;
    let activeAccLimit = 0;
    let activeIspTotal = 0;
    let minIntAllowed = 1440;
    const activeProxies = [];
    const expiredProxies = [];
    const nowMs = Date.now();
    let hasNewlyExpired = false;

    for (const cd of cSnap.docs) {
      const c = cd.data();
      const expMs = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().getTime() : 0;
      if (c.status === 'active' && expMs > nowMs) {
        activeSum += parseInt(c.threads || '0', 10);
        activeAccLimit += parseInt(c.accounts || '0', 10);
        activeIspTotal += parseInt(c.ispCount || '0', 10);
        const cMin = parseInt(c.minIntervalMin || '1440', 10);
        if (cMin < minIntAllowed) minIntAllowed = cMin;
        if (Array.isArray(c.proxies)) {
          c.proxies.forEach(p => { if (p && !activeProxies.includes(p)) activeProxies.push(p); });
        }
      } else if (c.status === 'active' && expMs <= nowMs) {
        hasNewlyExpired = true;
        await cd.ref.update({ status: 'expired', expiredAt: new Date(), updatedAt: new Date() });
        if (Array.isArray(c.proxies)) {
          c.proxies.forEach(p => { if (p) expiredProxies.push(p); });
        }
      }
    }

    if (hasNewlyExpired) {
      const toRelease = expiredProxies.filter(p => !activeProxies.includes(p));
      if (toRelease.length > 0) {
        const pSnap = await db.collection('isp_proxy_pool').where('assignedUserId', '==', userId).get();
        const batch = db.batch();
        pSnap.docs.forEach(pd => {
          if (toRelease.includes(pd.data().proxy)) {
            batch.update(pd.ref, { assignedUserId: null, releasedAt: new Date(), lastUserId: userId });
          }
        });
        await batch.commit();
      }
      await db.collection('saas_users').doc(userId).update({
        planId: activeSum > 0 ? tenantUser.planId : 'free',
        planStatus: activeSum > 0 ? 'active' : 'expired',
        maxThreads: activeSum > 0 ? activeSum : 1,
        maxAccounts: activeAccLimit > 0 ? activeAccLimit : 1,
        ispQuota: activeIspTotal,
        minIntervalMin: minIntAllowed,
        assignedProxies: activeProxies,
        updatedAt: new Date()
      });
      tenantUser.planId = activeSum > 0 ? tenantUser.planId : 'free';
      tenantUser.planStatus = activeSum > 0 ? 'active' : 'expired';
      tenantUser.assignedProxies = activeProxies;
    }
  } catch (e) {}
  return tenantUser;
}

function getEngineSharedHelpers() {
  return {
    logSaaS,
    parseProxyString,
    getResidentialProxy,
    acquireGlobalChromeLock,
    releaseGlobalChromeLock,
    getFixedUserAgent,
    getFixedViewport,
    humanTyping,
    obfuscateText,
    checkRobotOrLocked,
    checkActionBlock,
    inspectAccountViaInternalApi,
    syncProfileFastAndLock,
    _applySafeMediaAndUpdateBlocker
  };
}

async function dispatchAutoPinTask({ tenantUser, targetDoc, accData, laneNo, laneCfg, healthyDocs, userProxies }) {
  const docId = targetDoc.id;
  const fullUid = tenantUser.userId;
  const laneLockKey = `${fullUid}_L${laneNo}`;
  if (_runningAccountIds.has(docId) || _runningLaneKeys.has(laneLockKey)) return;
  _runningAccountIds.add(docId);
  _runningLaneKeys.add(laneLockKey);

  try {
    const tenantTag = `${fullUid.slice(0, 8)}:L${laneNo}`;
    const res = await executeAutoPinBillboardPost({
      tenantUser,
      targetDoc,
      accData,
      laneNo,
      laneCfg,
      userProxies,
      helpers: getEngineSharedHelpers()
    });
    await markPinAttemptResult({
      docId,
      success: res === 'success',
      userId: fullUid,
      laneNo,
      expectedStamp: String(laneCfg.aiLastRefreshedAtMs || ''),
      db,
      accDocRef: targetDoc.ref,
      logSaaS,
      tenantTag
    });
    if (['shadowban', 'robot', 'unavailable'].includes(res)) {
      const now = new Date();
      const remaining = (healthyDocs || []).filter(d => d.id !== docId);
      if (remaining.length > 0) {
        _stickyLanePrimaryDocId.set(laneLockKey, remaining[0].id);
        await remaining[0].ref.update({ promotedAt: now, nextPostAt: new Date(0) }).catch(() => {});
      } else {
        _stickyLanePrimaryDocId.delete(laneLockKey);
      }
      const roleLabel = res === 'shadowban' ? 'シャドウバン' : (res === 'robot' ? 'ロボット' : '利用不可');
      await targetDoc.ref.update({ role: roleLabel, isActive: false, updatedAt: now }).catch(() => {});
      await notifyTenantAutoSwap(tenantUser, accData, res.toUpperCase(), remaining);
    }
  } finally {
    _runningAccountIds.delete(docId);
    _runningLaneKeys.delete(laneLockKey);
  }
}

async function dispatchOutreachTask({ tenantUser, targetDoc, accData, laneNo, laneCfg, healthyDocs, userProxies }) {
  const docId = targetDoc.id;
  const fullUid = tenantUser.userId;
  const laneLockKey = `${fullUid}_L${laneNo}`;
  if (_runningAccountIds.has(docId) || _runningLaneKeys.has(laneLockKey)) return;
  _runningAccountIds.add(docId);
  _runningLaneKeys.add(laneLockKey);

  try {
    const res = await executeInterleavedOutreachCycle({
      tenantUser,
      targetDoc,
      accData,
      laneNo,
      laneCfg,
      userProxies,
      helpers: getEngineSharedHelpers()
    });
    const now = new Date();
    const bMode = String(laneCfg.aiBattleMode || 'aggressive').toLowerCase();
    const baseOutreachMin = bMode === 'aggressive' ? 8 : (bMode === 'sniper' ? 12 : 22);
    const waitMs = (res === 'no_target' || res === 'system_error')
      ? (3 * 60 * 1000)
      : Math.floor((baseOutreachMin * 60 * 1000) * (0.9 + Math.random() * 0.2));

    if (['shadowban', 'robot', 'unavailable'].includes(res)) {
      const remaining = (healthyDocs || []).filter(d => d.id !== docId);
      if (remaining.length > 0) {
        _stickyLanePrimaryDocId.set(laneLockKey, remaining[0].id);
        await remaining[0].ref.update({ promotedAt: now, nextPostAt: new Date(0), nextOutreachAt: new Date(0) }).catch(() => {});
      } else {
        _stickyLanePrimaryDocId.delete(laneLockKey);
      }
      const roleLabel = res === 'shadowban' ? 'シャドウバン' : (res === 'robot' ? 'ロボット' : '利用不可');
      await targetDoc.ref.update({ role: roleLabel, isActive: false, updatedAt: now }).catch(() => {});
      await notifyTenantAutoSwap(tenantUser, accData, res.toUpperCase(), remaining);
    } else {
      await targetDoc.ref.update({
        nextOutreachAt: new Date(Date.now() + waitMs),
        updatedAt: now
      }).catch(() => {});
    }
  } finally {
    _runningAccountIds.delete(docId);
    _runningLaneKeys.delete(laneLockKey);
  }
}

async function dispatchSingleAccountTask(task) {
  const { tenantUser, targetDoc, accData, threadNo, isPendingVerification, healthyDocs, userProxies } = task;
  let { postsList } = task;
  const docId = targetDoc.id;
  const fullUid = tenantUser.userId;
  const accLaneNo = Math.min(3, Math.max(1, parseInt(accData.laneIndex || threadNo || '1', 10)));
  const laneLockKey = `${fullUid}_L${accLaneNo}`;

  if (_runningAccountIds.has(docId) || _runningLaneKeys.has(laneLockKey)) return;
  _runningAccountIds.add(docId);
  _runningLaneKeys.add(laneLockKey);

  const tenantTag = `${fullUid.slice(0, 8)}:L${accLaneNo}`;
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, accLaneNo);
  const cycleStartMs = Date.now();

  try {
    if (!accData.proxy && userProxies.length > 0) {
      const assignedP = userProxies[(accLaneNo - 1) % userProxies.length];
      accData.proxy = assignedP;
      await targetDoc.ref.update({ proxy: assignedP }).catch(() => {});
    }

    if (!isPendingVerification && (!Array.isArray(postsList) || postsList.length === 0)) {
      const postsSnap = await db.collection('saas_posts').where('ownerUserId', '==', fullUid).get();
      postsList = postsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const status = await runTenantPostCycle(tenantUser, targetDoc.ref, accData, postsList || [], accLaneNo);
    const now = new Date();

    const laneCfgObj = (tenantUser.lanes && tenantUser.lanes[String(accLaneNo)]) ? tenantUser.lanes[String(accLaneNo)] : {};
    const intervalMins = Math.max(5, parseInt(laneCfgObj.postIntervalMin || tenantUser.postIntervalMin || '15', 10));
    const baseSec = intervalMins * 60;
    const jitter = Math.floor(baseSec * 0.08); // ±8%の引き締まった人間ゆらぎでテンポ維持
    const waitSec = Math.max(240, baseSec + Math.floor(Math.random() * (jitter * 2 + 1)) - jitter);
    // サイクル開始時刻基準で計算し、ブラウザ処理時間による後ろズレを解消
    const nextDate = new Date(Math.max(Date.now() + 60000, cycleStartMs + waitSec * 1000));

    if (isPendingVerification) {
      if (status === 'verified' || status === 'success') {
        const hasExistingPrimary = Array.isArray(healthyDocs) && healthyDocs.length > 0;
        if (hasExistingPrimary) {
          await targetDoc.ref.update({
            role: '最新',
            isActive: true,
            shadowbanStrikes: 0,
            nextPostAt: new Date(0),
            updatedAt: now
          }).catch(() => {});
          const primaryName = healthyDocs[0].data().username || 'primary';
          _log(`🎉 Standby burner @${accData.username || ''} verified & ready behind primary @${primaryName}.`);
        } else {
          // 1番手昇格時は45秒待たず即座に new Date(0) で1本目の宣伝投稿を発射させる
          _stickyLanePrimaryDocId.set(laneLockKey, docId);
          await targetDoc.ref.update({
            role: '最新',
            isActive: true,
            shadowbanStrikes: 0,
            promotedAt: now,
            nextPostAt: new Date(0),
            updatedAt: now
          }).catch(() => {});
          _log(`🎉 Promoted @${accData.username || ''} to ACTIVE (#1)! Firing 1st live campaign post immediately...`);
        }
      } else if (['shadowban', 'robot', 'unavailable'].includes(status)) {
        const roleLabel = status === 'shadowban' ? 'シャドウバン' : (status === 'robot' ? 'ロボット' : '利用不可');
        const roleEn = status === 'shadowban' ? 'SHADOWBANNED' : (status === 'robot' ? 'LOCKED' : 'SUSPENDED');
        await targetDoc.ref.update({ role: roleLabel, isActive: false, updatedAt: now }).catch(() => {});
        _log(`🚨 Initial check flagged @${accData.username || ''} as ${roleEn}. Isolated & moving to next burner.`);
      }
      return;
    }

    if (status === 'success') {
      _stickyLanePrimaryDocId.set(laneLockKey, docId);
      await targetDoc.ref.update({ lastPostedAt: now, lastActionAt: now, nextPostAt: nextDate, updatedAt: now }).catch(() => {});
      const minsLeft = ((nextDate.getTime() - Date.now()) / 60000).toFixed(1);
      _log(`⏳ Cycle complete! Next post for @${accData.username || 'burner'} in ~${minsLeft} mins (Target interval: ${intervalMins}m).`);
    } else if (status === 'system_error') {
      const retryCoolDate = new Date(Date.now() + 20 * 1000);
      await targetDoc.ref.update({ nextPostAt: retryCoolDate, updatedAt: now }).catch(() => {});
    } else if (['shadowban', 'robot', 'unavailable'].includes(status)) {
      const remaining = healthyDocs.filter(d => d.id !== docId);
      if (remaining.length > 0) {
        _stickyLanePrimaryDocId.set(laneLockKey, remaining[0].id);
        await remaining[0].ref.update({ promotedAt: now, nextPostAt: new Date(0) }).catch(() => {});
      } else {
        _stickyLanePrimaryDocId.delete(laneLockKey);
      }
      const roleLabel = status === 'shadowban' ? 'シャドウバン' : (status === 'robot' ? 'ロボット' : '利用不可');
      const roleEn = status === 'shadowban' ? 'SHADOWBANNED' : (status === 'robot' ? 'LOCKED' : 'SUSPENDED');
      await targetDoc.ref.update({ role: roleLabel, isActive: false, updatedAt: now }).catch(() => {});
      _log(`🚨 Restriction (${roleEn}) detected on @${accData.username || ''}. Executed 0.0s Auto-Swap!`);
      await notifyTenantAutoSwap(tenantUser, accData, roleEn, remaining);
    }
  } catch (e) {
    _log(`❌ Worker exception: ${e.message}`);
  } finally {
    _runningAccountIds.delete(docId);
    _runningLaneKeys.delete(laneLockKey);
  }
}

async function processAllTenantsOnce() {
  runPeriodicGarbageCollection();
  const targetOnlyTenant = (process.env.TARGET_TENANT_USER_ID || '').trim();
  const usersSnap = targetOnlyTenant
    ? await db.collection('saas_users').where('userId', '==', targetOnlyTenant).limit(1).get()
    : await db.collection('saas_users').get();
  if (usersSnap.empty) return;

  const readyTasks = [];

  for (const userDoc of usersSnap.docs) {
    const tenantUser = userDoc.data();
    const userId = tenantUser.userId;
    if (!userId) continue;

    await auditTenantContractsAndProxies(userId, tenantUser);
    const isOwnerPromoTenant = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(userId);
    const hasPaidPlan = isOwnerPromoTenant || (tenantUser.planId && tenantUser.planId !== 'free' && tenantUser.planStatus === 'active');
    if (!hasPaidPlan) continue;

    if (tenantUser.email !== 'hank3jones@gmail.com' && tenantUser.expiresAt && tenantUser.expiresAt.toDate) {
      if (Date.now() > tenantUser.expiresAt.toDate().getTime()) {
        await userDoc.ref.update({ planStatus: 'expired', isEngineRunning: false, updatedAt: new Date() }).catch(() => {});
        continue;
      }
    }

    const userProxies = Array.isArray(tenantUser.assignedProxies) ? tenantUser.assignedProxies : [];
    const delSnap = await db.collection('saas_history').where('ownerUserId', '==', userId).where('deleteReq', '==', true).get().catch(() => ({ empty: true, docs: [] }));
    if (!delSnap.empty) {
      const byAcc = {};
      delSnap.docs.forEach(d => {
        const aid = d.data().accountDocId;
        if (aid) {
          if (!byAcc[aid]) byAcc[aid] = [];
          byAcc[aid].push(d);
        }
      });
      for (const aid of Object.keys(byAcc)) {
        if (_runningAccountIds.has(aid)) continue;
        const aDoc = await db.collection('saas_accounts').doc(aid).get().catch(() => null);
        if (aDoc && aDoc.exists) {
          executeTenantRemoteDelete(tenantUser, aDoc.id, aDoc.data(), byAcc[aid]).catch(() => {});
        }
      }
    }

    const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
    const allDocs = accSnap.docs.filter(d => d.data().isActive !== false && (d.data().authToken || d.data().encryptedAuthToken));
    if (allDocs.length === 0) continue;

    const maxStreams = isOwnerPromoTenant ? 3 : Math.min(3, Math.max(1, parseInt(tenantUser.maxThreads || '1', 10)));

    for (let laneNo = 1; laneNo <= maxStreams; laneNo++) {
      const laneLockKey = `${userId}_L${laneNo}`;
      if (_runningLaneKeys.has(laneLockKey)) continue;

      const laneCfg = (tenantUser.lanes && tenantUser.lanes[String(laneNo)]) ? tenantUser.lanes[String(laneNo)] : {};
      const laneDocs = allDocs.filter(doc => parseInt(doc.data().laneIndex || '1', 10) === laneNo);
      if (laneDocs.length === 0) continue;

      const laneHealthyDocs = laneDocs.filter(d => (d.data().role === '最新' || d.data().role === 'ACTIVE') && isValidXUsername(d.data().username));
      const lanePendingDocs = laneDocs.filter(d => d.data().role === '検証中' || d.data().role === 'VERIFYING' || !d.data().role || !isValidXUsername(d.data().username));

      const stickyDocId = _stickyLanePrimaryDocId.get(laneLockKey) || null;
      laneHealthyDocs.sort((a, b) => {
        const da = a.data();
        const dbData = b.data();
        const pa = da.promotedAt && da.promotedAt.toDate ? da.promotedAt.toDate().getTime() : 0;
        const pb = dbData.promotedAt && dbData.promotedAt.toDate ? dbData.promotedAt.toDate().getTime() : 0;
        if (pa !== pb) return pb - pa;
        if (stickyDocId) {
          if (a.id === stickyDocId && b.id !== stickyDocId) return -1;
          if (b.id === stickyDocId && a.id !== stickyDocId) return 1;
        }
        const pDiff = (parseInt(dbData.postCount || '0', 10)) - (parseInt(da.postCount || '0', 10));
        if (pDiff !== 0) return pDiff;
        const ca = da.createdAt && da.createdAt.toDate ? da.createdAt.toDate().getTime() : 0;
        const cb = dbData.createdAt && dbData.createdAt.toDate ? dbData.createdAt.toDate().getTime() : 0;
        return ca - cb;
      });

      if (laneHealthyDocs.length > 0 && !stickyDocId) {
        _stickyLanePrimaryDocId.set(laneLockKey, laneHealthyDocs[0].id);
      }

      // ⚡ 最優先0: 投稿スケジュールや一時停止状態に関わらず、BIOの未反映(bioSyncPending または不一致)があれば3秒以内に即時反映＆固定！
      if (laneHealthyDocs.length > 0) {
        const primaryDoc = laneHealthyDocs[0];
        const pData = primaryDoc.data();
        const desiredBio = typeof laneCfg.profileBio === 'string' ? laneCfg.profileBio.trim() : '';
        const laneActiveNow = Boolean(tenantUser.isEngineRunning && laneCfg.isEngineRunning !== false && (laneCfg.autoPostMode !== false || laneCfg.aiReplyMode === true));
        const wantsInstantBio = laneCfg.bioSyncPending === true || (laneActiveNow && desiredBio !== '' && pData.lastSyncedBio !== desiredBio);
        const nextPostMs = pData.nextPostAt && pData.nextPostAt.toDate ? pData.nextPostAt.toDate().getTime() : 0;
        const postDueRightNow = tenantUser.isEngineRunning && laneCfg.isEngineRunning !== false && laneCfg.autoPostMode !== false && Date.now() >= nextPostMs;

        if (wantsInstantBio && !shouldDeferBioSync(primaryDoc.id) && !postDueRightNow && !_runningAccountIds.has(primaryDoc.id)) {
          executeStandaloneInstantBioSync({
            tenantUser,
            targetDoc: primaryDoc,
            accData: pData,
            laneNo,
            laneCfg,
            userProxies
          }).catch(() => {});
          continue;
        }
      }

      if (!tenantUser.isEngineRunning || laneCfg.isEngineRunning === false) continue;

      // 📌 最優先1: 看板ポスト（pinnedPost）が設定されており、現在の1番手アカウントでまだピン留めされていない場合は即座に投稿＆ピン留め！
      if (laneHealthyDocs.length > 0 && laneCfg.pinnedPost && laneCfg.pinnedPost.mainText) {
        const primaryDoc = laneHealthyDocs[0];
        const pData = primaryDoc.data();
        const expectedStamp = String(laneCfg.aiLastRefreshedAtMs || '');
        const needsPin = laneCfg.pinSyncPending === true || (expectedStamp && pData.pinnedCampaignStamp !== expectedStamp);
        if (needsPin && !shouldDeferFailedPin(primaryDoc.id) && !_runningAccountIds.has(primaryDoc.id)) {
          dispatchAutoPinTask({
            tenantUser,
            targetDoc: primaryDoc,
            accData: pData,
            laneNo,
            laneCfg,
            healthyDocs: laneHealthyDocs,
            userProxies
          }).catch(() => {});
          continue;
        }
      }

      maybeRefreshLaneTemplates24h({ db, tenantUser, laneNo, laneCfg, logSaaS });

      if (laneHealthyDocs.length === 0 && lanePendingDocs.length > 0) {
        const pDoc = lanePendingDocs[0];
        if (!_runningAccountIds.has(pDoc.id)) {
          readyTasks.push({
            tenantUser,
            targetDoc: pDoc,
            accData: pDoc.data(),
            postsList: null,
            threadNo: laneNo,
            isPendingVerification: true,
            healthyDocs: [],
            userProxies
          });
        }
        continue;
      }

      if (laneHealthyDocs.length > 0) {
        const primaryDoc = laneHealthyDocs[0];
        const aData = primaryDoc.data();
        const nowMs = Date.now();
        const nextPostMs = aData.nextPostAt && aData.nextPostAt.toDate ? aData.nextPostAt.toDate().getTime() : 0;
        const lastActMs = aData.lastActionAt && aData.lastActionAt.toDate ? aData.lastActionAt.toDate().getTime() : 0;

        const rawTokenForAction = resolveAccountAuthToken(aData);
        // (B-1) タイムライン通常投稿（autoPostMode !== false の場合 + 1時間レート制限ガード）
        if (laneCfg.autoPostMode !== false && nowMs >= nextPostMs && !_runningAccountIds.has(primaryDoc.id)) {
          const postRate = canExecuteAutomatedAction(rawTokenForAction, 'post', laneCfg.aiBattleMode, laneCfg.manualForcePostAtMs);
          if (!postRate.allowed) {
            await primaryDoc.ref.update({ nextPostAt: new Date(postRate.nextAllowedAtMs) }).catch(() => {});
            if (postRate.shouldLog) logSaaS(`${userId.slice(0, 8)}:L${laneNo}`, `🛡️ [Velocity Guard] ${postRate.reason}`, userId, laneNo);
            continue;
          }
          readyTasks.push({
            tenantUser,
            targetDoc: primaryDoc,
            accData: aData,
            postsList: null,
            threadNo: laneNo,
            isPendingVerification: false,
            healthyDocs: laneHealthyDocs,
            userProxies
          });
          continue;
        }

        // (B-2) 合間の高速オートリプライ営業 ＆ 引用RT相乗り（aiReplyMode === true の場合、前回アクションから65秒以上空けて交互実行）
        if (laneCfg.aiReplyMode === true && !_runningAccountIds.has(primaryDoc.id)) {
          const nextOutMs = aData.nextOutreachAt && aData.nextOutreachAt.toDate ? aData.nextOutreachAt.toDate().getTime() : 0;
          const postComingVerySoon = (laneCfg.autoPostMode !== false) && (nextPostMs > 0) && (nextPostMs - nowMs < 45000);
          const cooledSinceLastAction = (nowMs - lastActMs) >= 65000;
          if (nowMs >= nextOutMs && cooledSinceLastAction && !postComingVerySoon) {
            const outKind = ((parseInt(aData.outreachCount || '0', 10) + 1) % 4 === 0) ? 'quote_rt' : 'reply';
            const outRate = canExecuteAutomatedAction(rawTokenForAction, outKind, laneCfg.aiBattleMode, laneCfg.manualForceOutreachAtMs);
            if (!outRate.allowed) {
              await primaryDoc.ref.update({ nextOutreachAt: new Date(outRate.nextAllowedAtMs) }).catch(() => {});
              if (outRate.shouldLog) logSaaS(`${userId.slice(0, 8)}:L${laneNo}`, `🛡️ [Velocity Guard] ${outRate.reason}`, userId, laneNo);
              continue;
            }
            dispatchOutreachTask({
              tenantUser,
              targetDoc: primaryDoc,
              accData: aData,
              laneNo,
              laneCfg,
              healthyDocs: laneHealthyDocs,
              userProxies
            }).catch(() => {});
            continue;
          }
        }
      }

      if (lanePendingDocs.length > 0) {
        const pDoc = lanePendingDocs[0];
        if (!_runningAccountIds.has(pDoc.id)) {
          readyTasks.push({
            tenantUser,
            targetDoc: pDoc,
            accData: pDoc.data(),
            postsList: null,
            threadNo: laneNo,
            isPendingVerification: true,
            healthyDocs: laneHealthyDocs,
            userProxies
          });
        }
      }
    }
  }

  for (const task of readyTasks) {
    if (_runningAccountIds.size >= SAAS_MAX_CONCURRENT_BROWSERS * 2) break;
    dispatchSingleAccountTask(task);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function _applySafeMediaAndUpdateBlocker(page) {
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

async function startSaaSEngine() {
  console.log('🚀 X-Swarm Cloud Autopilot Engine (Phase 1: Instant BIO Sync + Token Mutex + Fast Async Checker) Online');
  while (true) {
    try { await processAllTenantsOnce(); } catch (e) { console.error('Loop Error:', e.message); }
    await new Promise(r => setTimeout(r, 3000));
  }
}
if (require.main === module) {
  startSaaSEngine();
}
module.exports = { startSaaSEngine };
