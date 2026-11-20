require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  db,
  updateAccountState,
  getAccount,
  getAccountsByField,
  getAccountsByLifecycleStatuses,
  updateAccountData,
} = require('./firestore');
const { getResidentialProxyForAccount } = require('./iproyal');
const { readStoredUserAgent } = require('./browser_config');
const { getAccountLifecycleStatus } = require('./account_state');

const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const CACHE_DIR = path.join(__dirname, '../.saas_browser_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function isFakeTokenPrefixUsername(uname, token) {
  if (!uname) return true;
  const cleanU = String(uname).replace(/^@/, '').trim().toLowerCase();
  const cleanT = String(token || '').trim().toLowerCase();
  if (!cleanU || cleanU === '不明' || cleanU === 'user') return true;
  if (cleanT && cleanU === cleanT.slice(0, 6)) return true;
  if (/^[a-f0-9]{6}$/.test(cleanU) && cleanT.startsWith(cleanU)) return true;
  return false;
}

function getPersistentProfileDir(prefix, token) {
  const tokenHash = crypto.createHash('md5').update(String(token || '').trim()).digest('hex').slice(0, 12);
  const dir = path.join(CACHE_DIR, `${prefix}_${tokenHash}`);
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

function obfuscateText(rawText) {
  let resolved = String(rawText || '').replace(/\{([^{}]+)\}/g, (_, group) => {
    const opts = group.split('|');
    return opts[Math.floor(Math.random() * opts.length)];
  }).trim();
  const clean = resolved.replace(/\u200B/g, '');
  const invisiblePalette = ['\u2060', '\u200A', '\u2009', '\u2008', ' ', '\u3000'];
  let sig = '';
  for (let i = 0; i < 8; i++) sig += invisiblePalette[Math.floor(Math.random() * invisiblePalette.length)];
  if (clean.includes('\n')) {
    const idx = clean.indexOf('\n');
    return clean.slice(0, idx) + sig.slice(0, 4) + clean.slice(idx) + sig.slice(4);
  }
  return clean + ' ' + sig;
}

async function applyInheritedDeviceAndUa(page, token, dbUserAgent = null) {
  try {
    let resolvedUa = dbUserAgent;
    if (!resolvedUa && db) {
      const accDoc = await getAccount(String(token).trim().toLowerCase()).catch(() => null);
      if (accDoc && accDoc.exists && accDoc.data().userAgent) {
        resolvedUa = accDoc.data().userAgent;
      }
    }
    const bCfgPath = fs.existsSync(path.join(__dirname, 'browser_config.js'))
      ? './browser_config'
      : (fs.existsSync(path.join(__dirname, '../browser_config.js')) ? '../browser_config' : null);
    if (bCfgPath) {
      const { getDeviceProfile, applyDeviceProfile, readStoredUserAgent: readUa } = require(bCfgPath);
      const locked = (typeof readUa === 'function' ? readUa(resolvedUa) : String(resolvedUa || '').trim());
      const prof = getDeviceProfile(token, locked);
      await applyDeviceProfile(page, token, locked || prof.userAgent);
      return;
    }
    if (resolvedUa) {
      await page.setUserAgent(resolvedUa);
    }
  } catch (e) {}
}

async function humanTyping(page, text) {
  const dummyKeys = 'あいうえおかきくけこ';
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (Math.random() < 0.02 && char.length === 1 && char.charCodeAt(0) < 255 && char !== '\n' && char !== ' ') {
      const wrongChar = dummyKeys[Math.floor(Math.random() * dummyKeys.length)];
      await page.keyboard.sendCharacter(wrongChar);
      await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, 100 + Math.random() * 140));
    }
    if (char === '\n') await page.keyboard.press('Enter');
    else await page.keyboard.sendCharacter(char);
    await new Promise(r => setTimeout(r, 25 + Math.random() * 65));
  }
}

// DOM・初期ステート・左メニュー・アカウントスイッチャーから本物の screen_name を抽出
async function extractTrueScreenNameFromDom(page, token) {
  const found = await page.evaluate(() => {
    const reserved = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'login', 'logout', 'settings', 'compose', 'search', 'tos', 'privacy']);
    // 1) 左ナビのプロフィールリンク
    const pLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (pLink) {
      const href = String(pLink.getAttribute('href') || '').replace(/^\/+/, '').split('/')[0].split('?')[0];
      if (href && /^[A-Za-z0-9_]{3,15}$/.test(href) && !reserved.has(href.toLowerCase())) {
        return href;
      }
    }
    // 2) 左下のアカウントスイッチャー内の @screen_name
    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher) {
      const m = String(switcher.innerText || '').match(/@([A-Za-z0-9_]{3,15})/);
      if (m && m[1] && !reserved.has(m[1].toLowerCase())) return m[1];
    }
    // 3) HTML内の screen_name 定義
    const html = document.documentElement ? document.documentElement.innerHTML : '';
    const mHtml = html.match(/"screen_name"\s*:\s*"([A-Za-z0-9_]{3,15})"/);
    if (mHtml && mHtml[1] && !reserved.has(mHtml[1].toLowerCase())) return mHtml[1];
    return null;
  }).catch(() => null);

  if (found && !isFakeTokenPrefixUsername(found, token)) {
    return found;
  }
  return null;
}

async function inspectAccountViaInternalApi(page, token = '') {
  let ct0 = '';
  for (let w = 0; w < 6; w++) {
    const cookies = await page.cookies('https://x.com').catch(() => []);
    ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
    if (ct0) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!ct0) return { apiChecked: false };

  const apiRes = await page.evaluate(async (bearer, csrf) => {
    try {
      const res = await fetch('https://x.com/i/api/1.1/account/settings.json', {
        credentials: 'include',
        headers: {
          'authorization': `Bearer ${bearer}`,
          'x-csrf-token': csrf,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session'
        }
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

  if (apiRes.apiChecked && apiRes.screenName && !isFakeTokenPrefixUsername(apiRes.screenName, token)) {
    return apiRes;
  }

  const domScreenName = await extractTrueScreenNameFromDom(page, token);
  if (domScreenName) {
    return { apiChecked: true, status: 'ok', screenName: domScreenName, currentBio: apiRes.currentBio || null };
  }
  return apiRes;
}

async function checkReachRestrictedOrLocked(page) {
  try {
    return await page.evaluate(() => {
      const url = window.location.href.toLowerCase();
      if (url.includes('/account/access') || url.includes('/i/flow/login')) return 'ROBOT';
      if (document.querySelector("iframe[src*='arkoselabs.com'], iframe[src*='funcaptcha']")) return 'ROBOT';
      const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
      if (bodyText.includes('account suspended') || bodyText.includes('permanently suspended') || bodyText.includes('アカウントは凍結')) {
        return 'SUSPENDED';
      }
      return 'OK';
    });
  } catch (e) {
    return 'OK';
  }
}

async function runFreeLiveBrowserTestV3({ bioText, postText }) {
  const farmingDocs = await getAccountsByLifecycleStatuses(['nurturing'], { limit: 80 });
  const candidates = [];
  for (const doc of farmingDocs) {
    const d = doc.data() || {};
    if (getAccountLifecycleStatus(d) !== 'nurturing') continue;
    const tok = String(d.authToken || (doc.id.length === 40 ? doc.id : '') || '').trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(tok) || d.errorReason) continue;
    const rawUname = d.username || d.screenName || '';
    const validUname = isFakeTokenPrefixUsername(rawUname, tok) ? '' : String(rawUname).replace(/^@/, '').trim();
    candidates.push({
      docId: doc.id,
      token: tok,
      username: validUname,
      userAgent: d.userAgent || null,
      source: d.source || '',
      originType: d.originType || '',
      signupCountry: d.signupCountry || '',
      country: d.country || '',
      proxy: d.proxy || null,
      lastFreeTestAt: d.lastFreeTestAt && d.lastFreeTestAt.toDate ? d.lastFreeTestAt.toDate().getTime() : 0
    });
  }

  candidates.sort((a, b) => {
    const aHasName = a.username ? 1 : 0;
    const bHasName = b.username ? 1 : 0;
    if (aHasName !== bHasName) return bHasName - aHasName;
    return a.lastFreeTestAt - b.lastFreeTestAt;
  });

  let lastErrorMsg = '利用可能なテストAccount not foundでした';

  for (let idx = 0; idx < Math.min(4, candidates.length); idx++) {
    const cand = candidates[idx];
    const token = cand.token;
    const proxy = getResidentialProxyForAccount(token, cand);
    const userDir = getPersistentProfileDir('diag', token);
    let browser = null;

    try {
      console.log(`[FreeLiveV3] 🚀 試行 ${idx + 1}: Token ${token.slice(0, 6)}... (@${cand.username || '自動取得中'}) をDB固有UA・専用IPで起動中...`);
      await updateAccountData(cand.docId, { lastFreeTestAt: new Date() }).catch(() => {});

      const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--lang=ja-JP'
      ];
      if (proxy && proxy.host) browserArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);

      browser = await puppeteer.launch({
        headless: 'new',
        args: browserArgs,
        ignoreDefaultArgs: ['--enable-automation'],
        userDataDir: userDir,
        protocolTimeout: 55000
      });
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(45000);

      let capturedTweetId = null;
      let capturedScreenName = cand.username || null;

      // ネットワーク通信 (settings.json / Viewer / CreateTweet) から本物の screen_name と rest_id を自動捕捉
      page.on('response', async (res) => {
        try {
          const u = res.url();
          if (res.status() !== 200) return;
          if (u.includes('account/settings.json') || u.includes('Viewer') || u.includes('verify_credentials')) {
            const json = await res.json().catch(() => null);
            const sn = json?.screen_name ||
              json?.data?.viewer?.user_results?.result?.legacy?.screen_name ||
              json?.data?.viewer?.user_results?.result?.core?.screen_name;
            if (sn && !isFakeTokenPrefixUsername(sn, token)) {
              capturedScreenName = String(sn).trim();
            }
          }
          if (u.includes('CreateTweet')) {
            const json = await res.json().catch(() => null);
            const resObj = json?.data?.create_tweet?.tweet_results?.result;
            const restId = resObj?.rest_id || resObj?.tweet?.rest_id;
            if (restId) capturedTweetId = String(restId);
            const authorSn = resObj?.core?.user_results?.result?.legacy?.screen_name ||
              resObj?.core?.user_results?.result?.core?.screen_name ||
              resObj?.tweet?.core?.user_results?.result?.legacy?.screen_name;
            if (authorSn && !isFakeTokenPrefixUsername(authorSn, token)) {
              capturedScreenName = String(authorSn).trim();
            }
          }
        } catch (e) {}
      });

      await applyInheritedDeviceAndUa(page, token, cand.userAgent);
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
      if (proxy && proxy.user && proxy.pass) {
        await page.authenticate({ username: proxy.user, password: proxy.pass });
      }
      await page.setCookie(
        { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
        { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
      );

      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 4500));

      const lockCheck = await checkReachRestrictedOrLocked(page);
      if (lockCheck !== 'OK') {
        lastErrorMsg = `アカウント制限検知 (${lockCheck})`;
        await browser.close().catch(() => {});
        browser = null;
        continue;
      }

      const apiHealth = await inspectAccountViaInternalApi(page, token);
      if (!apiHealth.apiChecked) {
        lastErrorMsg = 'プロキシ応答遅延によりログイン確認タイムアウト';
        await browser.close().catch(() => {});
        browser = null;
        continue;
      }
      if (apiHealth.status !== 'ok') {
        lastErrorMsg = `APIステータス異常 (${apiHealth.reason})`;
        await updateAccountState(cand.docId, apiHealth.status, { errorReason: apiHealth.reason }).catch(() => {});
        await browser.close().catch(() => {});
        browser = null;
        continue;
      }

      if (apiHealth.screenName && !isFakeTokenPrefixUsername(apiHealth.screenName, token)) {
        capturedScreenName = apiHealth.screenName;
      }
      if (!capturedScreenName) {
        capturedScreenName = await extractTrueScreenNameFromDom(page, token);
      }

      // 自然なホーム回遊スクロール
      await page.evaluate(() => window.scrollBy(0, 350 + Math.random() * 250)).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      // BIO更新
      const targetBio = String(bioText || '').trim().slice(0, 155);
      if (targetBio) {
        console.log(`[FreeLiveV3] 📝 @${capturedScreenName || token.slice(0, 6)} のBIOを更新中: "${targetBio}"`);
        const cookies = await page.cookies('https://x.com').catch(() => []);
        const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
        if (ct0) {
          const profUpdateSn = await page.evaluate(async (bearer, csrf, newDesc) => {
            try {
              const body = new URLSearchParams({ description: newDesc }).toString();
              const r = await fetch('https://x.com/i/api/1.1/account/update_profile.json', {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'authorization': `Bearer ${bearer}`,
                  'x-csrf-token': csrf,
                  'x-twitter-active-user': 'yes',
                  'x-twitter-auth-type': 'OAuth2Session',
                  'content-type': 'application/x-www-form-urlencoded'
                },
                body
              });
              const d = await r.json().catch(() => ({}));
              return d.screen_name || null;
            } catch (e) { return null; }
          }, X_WEB_BEARER, ct0, targetBio).catch(() => null);
          if (profUpdateSn && !isFakeTokenPrefixUsername(profUpdateSn, token)) {
            capturedScreenName = profUpdateSn;
          }
        }

        await page.goto('https://x.com/settings/profile', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        if (!capturedScreenName) {
          capturedScreenName = await extractTrueScreenNameFromDom(page, token);
        }
        const bioSelector = 'textarea[name="description"]';
        const bioInput = await page.waitForSelector(bioSelector, { timeout: 10000 }).catch(() => null);
        if (bioInput) {
          await page.evaluate(el => el.focus(), bioInput);
          await bioInput.click();
          await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          await new Promise(r => setTimeout(r, 300));
          await page.type(bioSelector, targetBio, { delay: 30 });
          const saveBtn = await page.$('button[data-testid="Profile_Save_Button"]');
          if (saveBtn) {
            await page.evaluate(b => b.click(), saveBtn);
            await new Promise(r => setTimeout(r, 3500));
          }
        }
      }

      // 投稿画面の展開と人間タイピング投稿
      console.log(`[FreeLiveV3] ✍️ @${capturedScreenName || token.slice(0, 6)} で人間タイピング投稿を実行中...`);
      await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      let textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 }).catch(() => null);
      if (!textbox) {
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        const newTweetBtn = await page.$('[data-testid="SideNav_NewTweet_Button"]');
        if (newTweetBtn) {
          await page.evaluate(b => b.click(), newTweetBtn);
          await new Promise(r => setTimeout(r, 2000));
        }
        textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 }).catch(() => null);
      }

      if (!textbox) {
        lastErrorMsg = '投稿入力ボックスの展開タイムアウト';
        await browser.close().catch(() => {});
        browser = null;
        continue;
      }

      await page.evaluate(el => el.focus(), textbox);
      await textbox.click();
      await new Promise(r => setTimeout(r, 600));

      const finalPostText = obfuscateText(postText);
      await humanTyping(page, finalPostText);
      await new Promise(r => setTimeout(r, 1800));

      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
        for (const b of btns) {
          if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; }
        }
      });

      await new Promise(r => setTimeout(r, 4500));

      // もし CreateTweet レスポンス後でも screen_name が未取得なら、/i/status/ツイートID または左メニューのプロフィールを開いてURLから確定取得
      if (!capturedScreenName && capturedTweetId) {
        await page.goto(`https://x.com/i/status/${capturedTweetId}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        const mUrl = String(page.url() || '').match(/x\.com\/([A-Za-z0-9_]{3,15})\/status\//i);
        if (mUrl && mUrl[1] && !isFakeTokenPrefixUsername(mUrl[1], token)) {
          capturedScreenName = mUrl[1];
        }
      }

      if (capturedScreenName && !capturedTweetId) {
        await page.goto(`https://x.com/${capturedScreenName}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3500));
        capturedTweetId = await page.evaluate((uName) => {
          const links = Array.from(document.querySelectorAll('article[data-testid="tweet"] a[href*="/status/"]'));
          for (const a of links) {
            const href = String(a.getAttribute('href') || '');
            const m = href.match(new RegExp('^/' + uName + '/status/(\\d+)', 'i'));
            if (m) return m[1];
          }
          return null;
        }, capturedScreenName).catch(() => null);
      }

      const finalUsername = capturedScreenName || 'x_user';
      if (capturedScreenName && !isFakeTokenPrefixUsername(capturedScreenName, token)) {
        await updateAccountData(cand.docId, { username: capturedScreenName }).catch(() => {});
      }

      const profileUrl = `https://x.com/${finalUsername}`;
      const postUrl = capturedTweetId
        ? (capturedScreenName ? `https://x.com/${capturedScreenName}/status/${capturedTweetId}` : `https://x.com/i/status/${capturedTweetId}`)
        : profileUrl;

      console.log(`[FreeLiveV3] 🎉 ライブ投稿成功！ User: @${finalUsername} | Profile: ${profileUrl} | Post: ${postUrl}`);
      await browser.close().catch(() => {});
      browser = null;
      slimBrowserCache(userDir);

      return {
        ok: true,
        liveExecuted: true,
        username: finalUsername,
        profileUrl,
        postUrl
      };
    } catch (e) {
      lastErrorMsg = e.message;
      console.log(`[FreeLiveV3] ⚠️ 試行例外 (${token.slice(0, 6)}...): ${e.message}`);
      if (browser) await browser.close().catch(() => {});
      slimBrowserCache(userDir);
    }
  }

  return { ok: false, error: `ライブ実行リトライ上限 (${lastErrorMsg})。もう一度ボタンを押してください。` };
}


// 履歴IDから auth_token と固有UAを特定し、安全にStealthブラウザを起動してX上のポストを削除する
async function executeSafeStealthDeleteTweet(historyId) {
  if (!historyId) return { ok: false, error: 'Missing historyId' };
  const hRef = db.collection('saas_history').doc(String(historyId));
  const hSnap = await hRef.get().catch(() => null);
  if (!hSnap || !hSnap.exists) return { ok: false, error: 'History not found' };
  const h = hSnap.data() || {};
  if (h.deleted) return { ok: true, alreadyDeleted: true };

  const cleanUname = String(h.username || '').replace(/^@/, '').trim();
  const urlMatch = String(h.url || '').match(/status\/(\d+)/);
  const tweetId = h.tweetId || (urlMatch ? urlMatch[1] : '');

  // 1) 履歴自体 -> 2) saas_accounts -> 3) 母艦 accounts の順で auth_token と固有UAを探索
  let token = String(h.authToken || '').trim().toLowerCase();
  let dbUa = h.userAgent || null;
  let customProxy = h.proxy || null;

  if (!/^[a-f0-9]{40}$/.test(token) && cleanUname) {
    const sSnap = await db.collection('saas_accounts').where('username', '==', cleanUname).limit(1).get().catch(() => ({ empty: true }));
    if (!sSnap.empty) {
      const sd = sSnap.docs[0].data() || {};
      token = String(sd.authToken || '').trim().toLowerCase();
      dbUa = sd.userAgent || dbUa;
      customProxy = sd.proxy || customProxy;
    }
  }
  if (!/^[a-f0-9]{40}$/.test(token) && cleanUname) {
    const accountDocs = await getAccountsByField('username', cleanUname, { limit: 1 }).catch(() => []);
    if (accountDocs.length > 0) {
      const ad = accountDocs[0].data() || {};
      token = String(ad.authToken || accountDocs[0].id || '').trim().toLowerCase();
      dbUa = ad.userAgent || dbUa;
    }
  }

  // テスト用ダミー履歴（tweetIdがない、またはアカウントが存在しない古いログ）は即座に削除済みに更新
  if (!tweetId || !/^[a-f0-9]{40}$/.test(token)) {
    await hRef.update({
      deleted: true,
      deleteReq: false,
      deletedAt: new Date(),
      deleteNote: 'Log cleared (no live tweetId/token bound)'
    }).catch(() => {});
    return { ok: true, clearedLogOnly: true };
  }

  const userDir = getPersistentProfileDir('diag', token);
  let browser = null;
  try {
    console.log(`[SafeDeleteV3] 🗑️ @${cleanUname} (TweetID: ${tweetId}) を固有UA・Cookie引き継ぎで安全削除中...`);
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=ja-JP'
    ];
    // カスタム専用固定ISPがある場合は使用し、IPRoyal帯域切れ時は直接接続フォールバックで確実に削除を実行
    if (customProxy && !String(customProxy).includes('geo.iproyal.com')) {
      const pParts = String(customProxy).replace(/^https?:\/\//i, '').split(':');
      if (pParts.length >= 2) browserArgs.push(`--proxy-server=http://${pParts[0]}:${pParts[1]}`);
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args: browserArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      userDataDir: userDir,
      protocolTimeout: 45000
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(35000);

    await applyInheritedDeviceAndUa(page, token, dbUa);
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    );

    await page.goto(`https://x.com/${cleanUname || 'i'}/status/${tweetId}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3500));

    // 方法A: ブラウザ内の認証済みセッションから内部 statuses/destroy.json API で確実削除
    const cookies = await page.cookies('https://x.com').catch(() => []);
    const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
    let apiDeleted = false;
    if (ct0) {
      apiDeleted = await page.evaluate(async (bearer, csrf, tid) => {
        try {
          const res = await fetch('https://x.com/i/api/1.1/statuses/destroy.json', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'authorization': `Bearer ${bearer}`,
              'x-csrf-token': csrf,
              'x-twitter-active-user': 'yes',
              'x-twitter-auth-type': 'OAuth2Session',
              'content-type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ id: tid }).toString()
          });
          return res.status === 200 || res.status === 404;
        } catch (e) { return false; }
      }, X_WEB_BEARER, ct0, tweetId).catch(() => false);
    }

    // 方法B: UI上の「…」メニュー（caret）からも削除をクリック
    if (!apiDeleted) {
      const caret = await page.$('article[data-testid="tweet"] [data-testid="caret"]').catch(() => null);
      if (caret) {
        await page.evaluate(el => el.click(), caret);
        await new Promise(r => setTimeout(r, 1000));
        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
          const delItem = items.find(i => /削除|Delete/i.test(i.innerText || ''));
          if (delItem) delItem.click();
        });
        await new Promise(r => setTimeout(r, 1000));
        const confirmBtn = await page.$('[data-testid="confirmationSheetConfirm"]').catch(() => null);
        if (confirmBtn) {
          await page.evaluate(el => el.click(), confirmBtn);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    await browser.close().catch(() => {});
    browser = null;
    slimBrowserCache(userDir);

    await hRef.update({
      deleted: true,
      deleteReq: false,
      deletedAt: new Date()
    }).catch(() => {});

    console.log(`[SafeDeleteV3] ✅ @${cleanUname} のポスト (ID: ${tweetId}) の削除が完了しました！`);
    return { ok: true, deleted: true, tweetId };
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    slimBrowserCache(userDir);
    // 万が一通信エラーでもキューが永久ロックしないようステータスを更新
    await hRef.update({
      deleted: true,
      deleteReq: false,
      deletedAt: new Date(),
      deleteNote: 'Removed from log (' + e.message.slice(0, 40) + ')'
    }).catch(() => {});
    return { ok: true, deleted: true, fallbackCleared: true };
  }
}


// 個別のバーナーアカウント (saas_accounts) の生存・凍結・ロック・検索/リーチ制限を診断してDBを更新
async function diagnoseBurnerAccountHealthV3(accountId) {
  if (!accountId) return { ok: false, error: 'Missing accountId' };
  const accRef = db.collection('saas_accounts').doc(String(accountId));
  const accSnap = await accRef.get().catch(() => null);
  if (!accSnap || !accSnap.exists) return { ok: false, error: 'Account not found' };
  const acc = accSnap.data() || {};
  const lastDiagMs = acc.lastDiagnosedAt && acc.lastDiagnosedAt.toDate ? acc.lastDiagnosedAt.toDate().getTime() : 0;
  if (Date.now() - lastDiagMs < 60000 && acc.role && acc.role !== '検証中') {
    const waitSec = Math.ceil((60000 - (Date.now() - lastDiagMs)) / 1000);
    return {
      ok: true,
      cached: true,
      role: acc.role,
      username: acc.username || '',
      reason: 'Recently audited (Cooldown active to prevent X login flags: retry in ' + waitSec + 's)'
    };
  }
  await accRef.update({ lastDiagnosedAt: new Date() }).catch(() => {});
  const token = String(acc.authToken || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(token)) {
    await accRef.update({ role: '利用不可', isActive: false, errorReason: 'Invalid 40-char hex auth_token' }).catch(() => {});
    return { ok: true, role: '利用不可', reason: 'Invalid 40-char hex auth_token' };
  }

  // 母艦 accounts 側に既に凍結/シャドウバン記録があるかも照合
  const mainDoc = await getAccount(token).catch(() => null);
  if (mainDoc && mainDoc.exists) {
    const md = mainDoc.data() || {};
    if (md.status === 'suspended' || md.status === 'unavailable') {
      await accRef.update({ role: '利用不可', isActive: false, username: md.username || acc.username || '', errorReason: md.errorReason || '凍結/利用不可' }).catch(() => {});
      return { ok: true, role: '利用不可', username: md.username || acc.username, reason: 'Account suspended or logged out' };
    }
    if (md.status === 'shadowban' || md.reachRestricted === true) {
      await accRef.update({ role: 'シャドウバン', isActive: false, username: md.username || acc.username || '', errorReason: '検索制限/リーチ制限' }).catch(() => {});
      return { ok: true, role: 'シャドウバン', username: md.username || acc.username, reason: 'Search Shadowban / Reach Restriction detected' };
    }
  }

  const userDir = getPersistentProfileDir('diag', token);
  let browser = null;
  try {
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=ja-JP'];
    browser = await puppeteer.launch({ headless: 'new', args: browserArgs, ignoreDefaultArgs: ['--enable-automation'], userDataDir: userDir, protocolTimeout: 40000 });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    const inheritedAccount = (mainDoc && mainDoc.exists && mainDoc.data()) || acc;
    await applyInheritedDeviceAndUa(page, token, readStoredUserAgent(inheritedAccount) || acc.userAgent || null);
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    );
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3500));

    const lockState = await checkReachRestrictedOrLocked(page);
    if (lockState === 'ROBOT') {
      await browser.close().catch(() => {});
      await accRef.update({ role: 'ロボット', isActive: false, errorReason: 'Arkoseロック/認証要求' }).catch(() => {});
      return { ok: true, role: 'ロボット', username: acc.username, reason: 'Arkose Robot Challenge / Lock detected' };
    }
    if (lockState === 'SUSPENDED') {
      await browser.close().catch(() => {});
      await accRef.update({ role: '利用不可', isActive: false, errorReason: 'アカウント凍結' }).catch(() => {});
      return { ok: true, role: '利用不可', username: acc.username, reason: 'Account Suspension detected' };
    }

    const apiHealth = await inspectAccountViaInternalApi(page, token);
    if (apiHealth.apiChecked && apiHealth.status !== 'ok') {
      await browser.close().catch(() => {});
      const mappedRole = apiHealth.status === 'robot' ? 'ロボット' : '利用不可';
      await accRef.update({ role: mappedRole, isActive: false, errorReason: apiHealth.reason || 'API異常' }).catch(() => {});
      return { ok: true, role: mappedRole, username: acc.username, reason: apiHealth.reason || 'アカウント制限' };
    }

    const uName = apiHealth.screenName || acc.username || '';
    // プロフィール画面を開いてリーチ制限バナー（「真正性を評価している間、リーチは制限される可能性があります」等）の有無もチェック
    if (uName) {
      await page.goto('https://x.com/' + uName, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2500));
      const hasLimitBanner = await page.evaluate(() => {
        const txt = (document.body ? document.body.innerText : '').toLowerCase();
        return txt.includes('真正性を評価している間') || txt.includes('リーチは制限される可能性') || txt.includes('reach may be limited') || txt.includes('authenticity');
      }).catch(() => false);
      if (hasLimitBanner) {
        await browser.close().catch(() => {});
        await accRef.update({ username: uName, role: 'シャドウバン', isActive: false, errorReason: 'リーチ制限/シャドウバン検知' }).catch(() => {});
        return { ok: true, role: 'シャドウバン', username: uName, reason: 'Active X Reach-Restriction banner detected on profile' };
      }
    }

    await browser.close().catch(() => {});
    await accRef.update({ username: uName || acc.username || '', role: '最新', isActive: true, errorReason: null, updatedAt: new Date() }).catch(() => {});
    return { ok: true, role: '最新', username: uName || acc.username, reason: 'Healthy & Active (No shadowban or lock detected)' };
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    return { ok: false, error: 'Network timeout during live audit: ' + e.message };
  }
}


const GEO_PROFILES = {
  US: { tz: 'America/New_York', lang: 'en-US,en;q=0.9' },
  JP: { tz: 'Asia/Tokyo',       lang: 'ja,en-US;q=0.9,en;q=0.8' },
  GB: { tz: 'Europe/London',    lang: 'en-GB,en;q=0.9' },
  DE: { tz: 'Europe/Berlin',    lang: 'de-DE,de;q=0.9,en;q=0.8' },
  NL: { tz: 'Europe/Amsterdam', lang: 'nl-NL,nl;q=0.9,en;q=0.8' },
  CA: { tz: 'America/Toronto',  lang: 'en-CA,en;q=0.9' },
  AU: { tz: 'Australia/Sydney', lang: 'en-AU,en;q=0.9' },
  SG: { tz: 'Asia/Singapore',   lang: 'en-SG,en;q=0.9' },
  HK: { tz: 'Asia/Hong_Kong',   lang: 'zh-HK,zh;q=0.9,en;q=0.8' },
  TW: { tz: 'Asia/Taipei',      lang: 'zh-TW,zh;q=0.9,en;q=0.8' }
};

async function applyGeoTimezoneAndLocale(page, countryCode = 'US') {
  try {
    const code = String(countryCode || 'US').trim().toUpperCase();
    const prof = GEO_PROFILES[code] || GEO_PROFILES.US;
    await page.emulateTimezone(prof.tz).catch(() => {});
    await page.setExtraHTTPHeaders({ 'Accept-Language': prof.lang }).catch(() => {});
  } catch (e) {}
}

async function safeCloseBrowser(browser) {
  if (!browser) return;
  const proc = typeof browser.process === 'function' ? browser.process() : null;
  try { await browser.close(); } catch (e) {}
  if (proc && !proc.killed) {
    try { proc.kill('SIGKILL'); } catch (e) {}
  }
}

function sweepOldTmpProfiles() {
  try {
    const tmpDir = '/tmp';
    if (!fs.existsSync(tmpDir)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.startsWith('puppeteer_dev_profile-') || f.startsWith('.org.chromium.Chromium')) {
        const full = path.join(tmpDir, f);
        const st = fs.statSync(full);
        if (now - st.mtimeMs > 3600 * 1000) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      }
    }
  } catch (e) {}
}

module.exports = {
  applyGeoTimezoneAndLocale,
  safeCloseBrowser,
  sweepOldTmpProfiles,
  diagnoseBurnerAccountHealthV3,
  executeSafeStealthDeleteTweet,
  isFakeTokenPrefixUsername,
  applyInheritedDeviceAndUa,
  checkReachRestrictedOrLocked,
  runFreeLiveBrowserTestV3
};
