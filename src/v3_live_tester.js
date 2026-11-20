/**
 * src/v3_live_tester.js
 * 公式ページ (/studio) 操作パネルからのライブ実演モジュール (auto_post_v3.js 完全準拠)
 * - 操作パネルで入力された BIO 編集 (https://x.com/settings/profile) と画像・テキスト投稿を一気通貫で実行
 */
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, getAccount } = require('./firestore');
const { getResidentialProxy, getResidentialProxyForAccount } = require('./iproyal');
const { readStoredUserAgent } = require('./browser_config');

const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const CACHE_DIR = path.join(__dirname, '../.saas_browser_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const SAAS_MAX_CONCURRENT_BROWSERS = Math.max(1, parseInt(process.env.SAAS_MAX_CONCURRENT_BROWSERS || '4', 10));

async function acquireTesterChromeSlot(holderName) {
  const start = Date.now();
  while (Date.now() - start < 90000) {
    for (let slot = 1; slot <= SAAS_MAX_CONCURRENT_BROWSERS; slot++) {
      const slotFile = `/tmp/x_autopost_slot_${slot}.lock`;
      try {
        if (fs.existsSync(slotFile)) {
          const stat = fs.statSync(slotFile);
          if (Date.now() - stat.mtimeMs > 180000) {
            try { fs.unlinkSync(slotFile); } catch (e) {}
          } else {
            continue;
          }
        }
        fs.writeFileSync(slotFile, `${process.pid}:${holderName}:${Date.now()}`, { flag: 'wx' });
        return slotFile;
      } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
  }
  return null;
}

function releaseTesterChromeSlot(slotFile) {
  try {
    if (slotFile && fs.existsSync(slotFile)) fs.unlinkSync(slotFile);
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

function obfuscateTextV3(rawText) {
  let resolved = String(rawText || '').replace(/\{([^{}]+)\}/g, (_, group) => {
    const opts = group.split('|');
    return opts[Math.floor(Math.random() * opts.length)];
  }).trim();
  const clean = resolved.replace(/\u200B/g, '');
  const invisiblePalette = ['\u2060', '\u200A', '\u2009', '\u2008', ' ', '\u3000'];
  let sig = '';
  for (let i = 0; i < 8; i++) {
    sig += invisiblePalette[Math.floor(Math.random() * invisiblePalette.length)];
  }
  if (clean.includes('\n')) {
    const idx = clean.indexOf('\n');
    return clean.slice(0, idx) + sig.slice(0, 4) + clean.slice(idx) + sig.slice(4);
  }
  return clean + ' ' + sig;
}

async function resolveFixedProxyForToken(token) {
  try {
    const farmDoc = await getAccount(token).catch(() => null);
    if (farmDoc && farmDoc.exists) {
      return getResidentialProxyForAccount(token, farmDoc.data() || {});
    }
    const snap = await db.collection('saas_accounts').where('authToken', '==', token).limit(1).get();
    if (!snap.empty && snap.docs[0].data().proxy) {
      const raw = String(snap.docs[0].data().proxy).trim().replace(/^https?:\/\//i, '');
      const parts = raw.split(':');
      if (parts.length >= 4) return { host: parts[0], port: parts[1], user: parts[2], pass: parts.slice(3).join(':') };
    }
  } catch (e) {}
  return getResidentialProxy(token);
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

async function checkActionBlock(page) {
  await new Promise(r => setTimeout(r, 2000));
  return await page.evaluate(() => {
    const text = (document.body ? document.body.innerText : '').toLowerCase();
    const badPhrases = ["something went wrong, but don't fret", "not be allowed to perform this action", "やりなおしてください", "許可されていない可能性"];
    return badPhrases.some(phrase => text.includes(phrase));
  }).catch(() => false);
}

async function humanTyping(page, text) {
  const dummyKeys = 'あいうえおかきくけこ';
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (Math.random() < 0.02 && char.length === 1 && char.charCodeAt(0) < 255 && char !== '\n' && char !== ' ') {
      const wrongChar = dummyKeys[Math.floor(Math.random() * dummyKeys.length)];
      await page.keyboard.sendCharacter(wrongChar);
      await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, 150 + Math.random() * 250));
    }
    if (char === '\n') await page.keyboard.press('Enter');
    else await page.keyboard.sendCharacter(char);
    await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
  }
}

async function executeInstantFreeTestPost(authToken, customBio, rawPostText, imagePath, cMeta) {
  const token = String(authToken || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(token)) {
    return { ok: false, error: 'Invalid 40-char auth_token' };
  }

  const proxy = await resolveFixedProxyForToken(token);
  const userDir = getPersistentProfileDir('main', token);
  const heldSlot = await acquireTesterChromeSlot('studio_test');
  let browser = null;
  let tempImagePath = null;

  try {
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
      protocolTimeout: 45000
    });
    const page = await browser.newPage();
    await _applySafeMediaAndUpdateBlocker(page);
    page.setDefaultNavigationTimeout(35000);

    let capturedTweetId = null;
    page.on('response', async (res) => {
      try {
        if (res.url().includes('CreateTweet') && res.status() === 200) {
          const json = await res.json().catch(() => null);
          const resObj = json?.data?.create_tweet?.tweet_results?.result;
          const restId = resObj?.rest_id || resObj?.tweet?.rest_id;
          if (restId) capturedTweetId = restId;
        }
      } catch (e) {}
    });

    let accountForUa = {};
    try {
      const fDoc = await getAccount(token).catch(() => null);
      if (fDoc && fDoc.exists) accountForUa = fDoc.data() || {};
    } catch (e) {}
    const { applyDeviceProfile } = require('./browser_config');
    const lockedUa = readStoredUserAgent(accountForUa);
    await applyDeviceProfile(page, token, lockedUa || null, accountForUa);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
    if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    );

    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));

    // 1. 内部API (settings.json) または プロフィールリンクから本物の @screen_name を取得
    const cookies = await page.cookies().catch(() => []);
    const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
    let cleanUsername = '';
    if (ct0) {
      const apiData = await page.evaluate(async (bearer, csrf) => {
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
          return await res.json().catch(() => ({}));
        } catch (e) { return {}; }
      }, X_WEB_BEARER, ct0).catch(() => ({}));
      if (apiData && apiData.screen_name) cleanUsername = apiData.screen_name;
    }

    if (!cleanUsername) {
      cleanUsername = await page.evaluate(async () => {
        for (let k = 0; k < 5; k++) {
          const a = document.querySelector("a[data-testid='AppTabBar_Profile_Link']");
          if (a) {
            const href = a.getAttribute('href');
            if (href && href !== '/home' && href !== '/') return href.split('/').pop().split('?')[0];
          }
          await new Promise(r => setTimeout(r, 800));
        }
        return '';
      }).catch(() => '');
    }
    if (!cleanUsername) cleanUsername = 'LauraLcbc';

    // 2. auto_post_v3.js 準拠の自然なホーム画面スクロール＆熟読回遊（いいねは押さない）
    try {
      for (let s = 0; s < 2; s++) {
        await page.evaluate(() => window.scrollBy(0, 400 + Math.random() * 400));
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
      }
    } catch (e) {}

    // 3. 操作パネルで入力されたプロフィールBIOを https://x.com/settings/profile のDOM画面操作で編集・保存
    if (customBio && String(customBio).trim() !== '') {
      const targetBio = String(customBio).trim().slice(0, 160);
      await page.goto('https://x.com/settings/profile', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 4000));
      const bioSelector = 'textarea[name="description"]';
      await page.waitForSelector(bioSelector, { timeout: 20000 }).catch(() => {});
      const bioInput = await page.$(bioSelector);
      if (bioInput) {
        const currentDomBio = await page.evaluate(el => el.value || el.innerText || '', bioInput).catch(() => '');
        if (currentDomBio.trim() !== targetBio) {
          await page.evaluate(el => el.focus(), bioInput);
          await bioInput.click();
          await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          await new Promise(r => setTimeout(r, 500));
          await page.type(bioSelector, targetBio, { delay: 45 });
          await new Promise(r => setTimeout(r, 600));
          const saveBtn = await page.$('button[data-testid="Profile_Save_Button"]');
          if (saveBtn) {
            await page.evaluate(b => b.click(), saveBtn);
            await new Promise(r => setTimeout(r, 4500));
          }
        }
      }
    }

    // 4. 投稿画面展開 ＋ sharp による明度微調整画像の添付 ＋ 人間タイピング投稿
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));

    if (imagePath && fs.existsSync(imagePath)) {
      try {
        const buffer = fs.readFileSync(imagePath);
        tempImagePath = path.join(CACHE_DIR, `upload_${Date.now()}.jpg`);
        await require('sharp')(buffer).modulate({ brightness: 1.0 + (Math.random() * 0.02 - 0.01) }).toFile(tempImagePath);
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(tempImagePath);
          await new Promise(r => setTimeout(r, 6000));
        }
      } catch (e) {}
    }

    const fullText = obfuscateTextV3(rawPostText || 'Live cloud browser test from X-Swarm Cloud Studio! https://appflowsystem.com');
    const textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 15000 }).catch(() => null);
    if (!textbox) throw new Error('Compose box not found');

    await page.evaluate(el => el.focus(), textbox);
    await textbox.click();
    await new Promise(r => setTimeout(r, 1000));

    await humanTyping(page, fullText);
    await new Promise(r => setTimeout(r, 2500));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
      for (const b of btns) {
        if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; }
      }
    });

    if (await checkActionBlock(page)) throw new Error('ACTION_BLOCKED');
    for (let w = 0; w < 8; w++) {
      if (capturedTweetId) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 2000));

    let postedUrl = '';
    if (capturedTweetId && cleanUsername) {
      postedUrl = `https://x.com/${cleanUsername}/status/${capturedTweetId}`;
    }
    if (!postedUrl) {
      try {
        const toastLink = await page.waitForSelector('div[data-testid="toast"] a[href*="/status/"]', { timeout: 4000 }).catch(() => null);
        if (toastLink) postedUrl = await page.evaluate(el => el.href, toastLink);
      } catch (e) {}
    }
    // トーストでも取れなかった場合はプロフィール画面へ移動して先頭ツイートの /status/ URLを取得
    if (!postedUrl && cleanUsername) {
      try {
        await page.goto(`https://x.com/${cleanUsername}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3500));
        postedUrl = await page.evaluate((u) => {
          const links = Array.from(document.querySelectorAll('article[data-testid="tweet"] a[href*="/status/"]'));
          for (const a of links) {
            const h = a.getAttribute('href') || '';
            if (h.toLowerCase().includes('/' + u.toLowerCase() + '/status/')) {
              return 'https://x.com' + h.split('?')[0];
            }
          }
          return '';
        }, cleanUsername).catch(() => '');
      } catch (e) {}
    }
    // それでも取得できない場合はプロフィールURLへフォールバック（from:検索URLにはしない）
    if (!postedUrl) {
      postedUrl = `https://x.com/${cleanUsername}`;
    }

    return { ok: true, screenName: cleanUsername, postedUrl, profileUrl: `https://x.com/${cleanUsername}` };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      try { fs.unlinkSync(tempImagePath); } catch (e) {}
    }
    slimBrowserCache(userDir);
    releaseTesterChromeSlot(heldSlot);
  }
}

module.exports = { executeInstantFreeTestPost };
