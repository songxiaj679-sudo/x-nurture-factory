
const { createAccountRepository } = require('./account_repository');

async function ensureHealthyDemoSandboxAccount(db, brokenToken = null) {
  try {
    const accountRepository = createAccountRepository(db);
    if (brokenToken) {
      await accountRepository.updateAccountState(brokenToken, 'unavailable', { errorReason: 'Demo sandbox restricted' });
    }
    const farmingDocs = await accountRepository.getAccountsByLifecycleStatuses(['nurturing'], { limit: 50 });
    for (const doc of farmingDocs) {
      const d = doc.data() || {};
      if (getAccountLifecycleStatus(d) !== 'nurturing') continue;
      const tok = String(d.authToken || (doc.id.length === 40 ? doc.id : '')).trim().toLowerCase();
      if (/^[a-f0-9]{40}$/.test(tok) && !d.errorReason && tok !== brokenToken) {
        const uname = String(d.username || d.screenName || '').replace(/^@/, '').trim();
        await db.collection('settings').doc('demo_sandbox_account').set({
          authToken: tok,
          username: uname,
          updatedAt: new Date()
        }, { merge: true });
        console.log('🔄 [Demo Failover] 無料デモ用アカウントを予備の生存垢 (@' + (uname || tok.slice(0, 6)) + ') へ自動交換しました');
        return { authToken: tok, username: uname };
      }
    }
  } catch (e) {}
  return null;
}

const { registerAffiliatePageRoutes } = require('./affiliate_page');
const { getOrCreateAffiliateProfile, bindReferralIfEligible, processPaidSubscriptionCommission, requestAffiliatePayout } = require('./affiliate_manager');
const { executeInstantFreeTestPost: _runV3SafeLiveTestPost } = require('./v3_live_tester');
/**
 * src/landing_page.js
 * X-Swarm Cloud — White Luxury Enterprise Edition v2
 * - High-Contrast Framed Vertical Form (STEP 1 -> STEP 5)
 * - Emphasized "100% FREE Live Post Test"
 * - 3-Angle AI Post Suggestion Cards + Image Upload with Sub-Pixel Camouflage
 * - Deep Technical Architecture & Visual Diagrams Section Well Below the Post Button
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { COUNTRIES, TG_PLANS, createOxaPayUsdInvoice, verifySingleOrderPaidWithOxaPay } = require('./telegram_bot');
const { getAccountLifecycleStatus } = require('./account_state');
const { resolveMarketForCycle, applyMarketInitToPage } = require('./market_init');
const { getResidentialProxy, getResidentialProxyForAccount } = require('./iproyal');
const { readStoredUserAgent, isSetupForeignAccount } = require('./browser_config');
const { encryptCredentials, decryptCredentials } = require('./official_api_client');

const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const CACHE_DIR = path.join(__dirname, '../.saas_browser_cache');
const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const recentVisitorCache = new Map();
// Auto Garbage Collector for temporary webtest_* and verify_* browser caches
setInterval(() => {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const nowMs = Date.now();
    for (const dirName of fs.readdirSync(CACHE_DIR)) {
      if (dirName.startsWith('verify_') || dirName.startsWith('webtest_')) {
        const fullDir = path.join(CACHE_DIR, dirName);
        const st = fs.statSync(fullDir);
        if (nowMs - st.mtimeMs > 2 * 60 * 60 * 1000) {
          fs.rmSync(fullDir, { recursive: true, force: true });
        }
      }
    }
  } catch (e) {}
}, 30 * 60 * 1000).unref();

function sendTgAdminAlert(botToken, chatId, htmlText) {
  if (!botToken || !chatId) return;
  const body = JSON.stringify({
    chat_id: chatId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text: htmlText
  });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: '/bot' + botToken + '/sendMessage',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 10000
  }, (res) => { res.on('data', () => {}); });
  req.on('error', () => {});
  req.write(body);
  req.end();
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resolveSpintax(rawText) {
  if (!rawText) return '';
  return String(rawText).replace(/\{([^{}]+)\}/g, (_, group) => {
    const opts = group.split('|');
    return opts[Math.floor(Math.random() * opts.length)];
  }).trim();
}

function splitUrlForSelfReply(fullText, useSelfReply = true) {
  if (!useSelfReply) return { mainText: fullText, replyUrl: null };
  const matches = String(fullText || '').match(/https?:\/\/[^\s]+/g);
  if (!matches || matches.length === 0) return { mainText: fullText, replyUrl: null };
  const targetUrl = matches[matches.length - 1];
  let bodyWithoutUrl = String(fullText || '').replace(targetUrl, '').trim();
  const isJp = /[\u3040-\u309F\u30A0-\u30FF]/.test(bodyWithoutUrl);
  if (!/reply|below|リプ|詳細/i.test(bodyWithoutUrl)) {
    bodyWithoutUrl += '\n\n' + (isJp ? '👇 詳細リンクはリプ欄へ' : '👇 Link in reply below');
  }
  return { mainText: bodyWithoutUrl, replyUrl: targetUrl };
}

function saveUploadedBase64Image(imageBase64, userId) {
  if (!imageBase64 || typeof imageBase64 !== 'string') return '';
  try {
    const m = imageBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    const rawB64 = m ? m[2] : imageBase64;
    const buf = Buffer.from(rawB64, 'base64');
    if (buf.length < 100 || buf.length > 15 * 1024 * 1024) return '';
    const fileName = `web_img_${String(userId).replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}.png`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(filePath, buf);
    return filePath;
  } catch (e) {
    return '';
  }
}

// 100% Free Instant Live Post Execution (Real Cloud Browser + Image Camouflage + Self-Reply)
async function executeInstantWebTestPost(user, accData, rawPostText, savedImagePath = '', selfReplyMode = true) {
  const token = String(accData.authToken || '').trim();
  const tokenHash = crypto.createHash('md5').update(token).digest('hex').slice(0, 12);
  const userDir = path.join(CACHE_DIR, `webtest_${tokenHash}`);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
    try { fs.unlinkSync(path.join(userDir, f)); } catch (e) {}
  });

  let proxyObj = null;
  if (accData.proxy && String(accData.proxy).includes(':')) {
    const p = String(accData.proxy).split(':');
    if (p.length >= 4) proxyObj = { host: p[0], port: p[1], user: p[2], pass: p.slice(3).join(':') };
  }
  if (!proxyObj) {
    if (isSetupForeignAccount(accData) || accData.source === 'setup_worker' || accData.originType === 'pure_jp') {
      proxyObj = getResidentialProxyForAccount(token, accData);
    } else {
      proxyObj = getResidentialProxy(token);
      if (user.ispCountry === 'US' && proxyObj && proxyObj.pass) {
        proxyObj.pass = proxyObj.pass.replace(/_country-[a-z]{2}/i, '_country-us');
      } else if (user.ispCountry === 'JP' && proxyObj && proxyObj.pass) {
        proxyObj.pass = proxyObj.pass.replace(/_country-[a-z]{2}/i, '_country-jp');
      }
    }
  }

  let browser = null;
  let camouflagedImgPath = null;
  try {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US'
    ];
    if (proxyObj && proxyObj.host) {
      args.push(`--proxy-server=http://${proxyObj.host}:${proxyObj.port}`);
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args,
      ignoreDefaultArgs: ['--enable-automation'],
      userDataDir: userDir,
      protocolTimeout: 45000
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    await page.setUserAgent(readStoredUserAgent(accData) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });

    const marketCfg = resolveMarketForCycle(user, [{ text: rawPostText }], accData);
    await applyMarketInitToPage(page, marketCfg);

    if (proxyObj && proxyObj.user && proxyObj.pass) {
      await page.authenticate({ username: proxyObj.user, password: proxyObj.pass });
    }

    let capturedTweetId = null;
    page.on('response', async (res) => {
      try {
        if (res.url().includes('CreateTweet') && res.status() === 200) {
          const json = await res.json().catch(() => null);
          const restId = json?.data?.create_tweet?.tweet_results?.result?.rest_id;
          if (restId) capturedTweetId = restId;
        }
      } catch (e) {}
    });

    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
    );

    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3200));

    const cookies = await page.cookies().catch(() => []);
    const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
    let screenName = accData.username || '';

    if (ct0) {
      const apiInfo = await page.evaluate(async (bearer, csrf) => {
        try {
          const r = await fetch('https://x.com/i/api/1.1/account/settings.json', {
            credentials: 'include',
            headers: {
              'authorization': 'Bearer ' + bearer,
              'x-csrf-token': csrf,
              'x-twitter-active-user': 'yes',
              'x-twitter-auth-type': 'OAuth2Session'
            }
          });
          const d = await r.json().catch(() => ({}));
          return { screenName: d.screen_name || '', suspended: !!d.suspended };
        } catch (e) { return {}; }
      }, X_WEB_BEARER, ct0).catch(() => ({}));

      if (apiInfo.suspended) {
        return { ok: false, reason: 'Account is suspended or locked on X.' };
      }
      if (apiInfo.screenName) screenName = apiInfo.screenName;

      if (user.profileBio && String(user.profileBio).trim()) {
        await page.evaluate(async (bearer, csrf, bioStr) => {
          try {
            await fetch('https://x.com/i/api/1.1/account/update_profile.json', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'authorization': 'Bearer ' + bearer,
                'x-csrf-token': csrf,
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session',
                'content-type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({ description: bioStr }).toString()
            });
          } catch (e) {}
        }, X_WEB_BEARER, ct0, String(user.profileBio).trim().slice(0, 160)).catch(() => {});
      }
    }

    if (!screenName) {
      screenName = await page.evaluate(() => {
        const a = document.querySelector("a[data-testid='AppTabBar_Profile_Link']");
        if (a && a.getAttribute('href')) return a.getAttribute('href').replace(/^\//, '').split('/')[0];
        return '';
      }).catch(() => '');
    }

    if (!screenName || page.url().includes('/login') || page.url().includes('/i/flow/login')) {
      return { ok: false, reason: 'Could not log in with this auth_token. Please check that the 40-character token is active.' };
    }

    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    let textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 15000 }).catch(() => null);
    if (!textbox) {
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
      await page.evaluate(() => {
        const b = document.querySelector('[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]');
        if (b) b.click();
      }).catch(() => {});
      textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 12000 }).catch(() => null);
    }
    if (!textbox) {
      return { ok: false, screenName, reason: 'Compose box did not appear (account may require verification on X).' };
    }

    // Sub-Pixel Image Camouflage & Upload if image is provided
    if (savedImagePath && fs.existsSync(savedImagePath)) {
      try {
        const rawBuf = fs.readFileSync(savedImagePath);
        camouflagedImgPath = path.join(CACHE_DIR, 'camo_upload_' + Date.now() + '.png');
        try {
          await require('sharp')(rawBuf)
            .modulate({ brightness: 1.0 + (Math.random() * 0.02 - 0.01) })
            .toFile(camouflagedImgPath);
        } catch (sErr) {
          const salt = crypto.randomBytes(16);
          fs.writeFileSync(camouflagedImgPath, Buffer.concat([rawBuf, salt]));
        }
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 8000 }).catch(() => null);
        if (fileInput) {
          await fileInput.uploadFile(camouflagedImgPath);
          await new Promise(r => setTimeout(r, 4500));
        }
      } catch (imgErr) {}
    }

    const resolvedText = resolveSpintax(rawPostText);
    const { mainText, replyUrl } = splitUrlForSelfReply(resolvedText, selfReplyMode);

    await page.evaluate(el => el.focus(), textbox);
    await textbox.click();
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.type(mainText, { delay: 28 });
    await new Promise(r => setTimeout(r, 1500));

    await page.evaluate(() => {
      // CAPTURE_EXACT_POSTED_STATUS_URL
      let _capturedStatusId = '';
      try {
        page.on('response', async (res) => {
          try {
            if (res.url().includes('CreateTweet') && res.status() === 200) {
              const j = await res.json().catch(() => null);
              const rObj = j?.data?.create_tweet?.tweet_results?.result;
              const rid = rObj?.rest_id || rObj?.tweet?.rest_id;
              if (rid) _capturedStatusId = String(rid);
            }
          } catch (e) {}
        });
      } catch (e) {}
      const btns = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
      for (const b of btns) {
        if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; }
      }
    });

    for (let w = 0; w < 10; w++) {
      if (capturedTweetId) break;
      await new Promise(r => setTimeout(r, 800));
    }
    await new Promise(r => setTimeout(r, 2000));

    const postedUrl = capturedTweetId
      ? `https://x.com/${screenName}/status/${capturedTweetId}`
      : (typeof postedTweetUrl !== 'undefined' && postedTweetUrl ? postedTweetUrl : `https://x.com/${screenName}`);

    if (capturedTweetId && replyUrl) {
      try {
        await page.goto(postedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2800));
        const repBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 8000 }).catch(() => null);
        if (repBox) {
          await repBox.click();
          await page.keyboard.type(`🔥 Details & Instant Access 👇\n${replyUrl}`, { delay: 25 });
          await new Promise(r => setTimeout(r, 1200));
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'));
            for (const b of btns) {
              if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; }
            }
          });
          await new Promise(r => setTimeout(r, 2500));
        }
      } catch (e) {}
    }

    return {
      ok: true,
      screenName,
      postedUrl,
      tweetId: capturedTweetId || null,
      publishedText: mainText
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    if (camouflagedImgPath && fs.existsSync(camouflagedImgPath)) {
      try { fs.unlinkSync(camouflagedImgPath); } catch (e) {}
    }
    if (browser) await browser.close().catch(() => {});
  }
}

function registerLandingAndCustomerWebRoutes(app, db) {
    app.get('/lp-client.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(path.join(__dirname, 'lp_client.js'));
  });
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/uploads/:file', (req, res) => {
    const safeName = path.basename(String(req.params.file || ''));
    const fullPath = path.join(UPLOAD_DIR, safeName);
    if (fs.existsSync(fullPath)) return res.sendFile(fullPath);
    return res.status(404).end();
  });

  
  // ==========================================================================
  // 0) シンプル会員認証 & ログイン・課金状態取得API (/api/web-me, /api/web-auth, /api/web-logout)
  // ==========================================================================
  function hashWebPass(pw) {
    return crypto.createHash('sha256').update('xswarm_web_salt_2026_' + String(pw || '')).digest('hex');
  }

  function isUserPaidActive(u) {
    if (!u) return false;
    if (u.isAdmin || ['TG-8401260325', 'USR-MVUA1GLP-D640'].includes(u.userId)) return true;
    return Boolean(u.planId && u.planId !== 'free' && u.planStatus === 'active' && (u.ispQuota || 0) > 0);
  }

  
  // === Web Affiliate Partner APIs (30% Monthly Recurring Share) ===
  app.post('/api/web-affiliate-info', async (req, res) => {
    try {
      const body = req.body || {};
      let userId = String(body.userId || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const refCode = String(body.refCode || '').trim();

      if (!userId && email) {
        let uSnap = await db.collection('saas_users').where('email', '==', email).limit(1).get();
        if (uSnap.empty) {
          uSnap = await db.collection('saas_users').where('email', '==', String(email).toLowerCase()).limit(1).get();
        }
        if (!uSnap.empty) userId = uSnap.docs[0].id;
      }
      if (!userId) {
        return res.json({ ok: false, authenticated: false, error: 'Not logged in' });
      }
      if (!userId) return res.json({ ok: false, error: 'not_logged_in' });

      const effectiveRef = refCode || req.xswarmRefCode || '';
      if (effectiveRef) {
        await bindReferralIfEligible(userId, effectiveRef).catch(() => {});
      }
      await _checkAndCreditUserActiveContracts(userId);

      const profile = await getOrCreateAffiliateProfile(userId);
      if (!profile) return res.json({ ok: false, error: 'profile_not_found' });

      const uDoc = await db.collection('saas_users').doc(userId).get();
      const uData = uDoc.exists ? uDoc.data() : {};

      const lSnap = await db.collection('saas_affiliate_ledger')
        .where('referrerUserId', '==', userId)
        .limit(20)
        .get()
        .catch(() => ({ docs: [] }));

      const history = (lSnap.docs || []).map(d => {
        const x = d.data();
        return {
          id: d.id,
          type: x.type || 'commission',
          amountUsd: Number(x.amountUsd || 0),
          planName: x.planName || '',
          status: x.status || 'credited',
          createdAtMs: x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().getTime() : Date.now()
        };
      }).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 10);

      return res.json({
        ok: true,
        profile: {
          ...profile,
          tgChatId: String(uData.tgChatId || '')
        },
        history
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/web-affiliate-save', async (req, res) => {
    try {
      const body = req.body || {};
      let userId = String(body.userId || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (!userId && email) {
        const uSnap = await db.collection('saas_users').where('email', '==', email).limit(1).get();
        if (!uSnap.empty) userId = uSnap.docs[0].id;
      }
      if (!userId) return res.status(400).json({ ok: false, error: 'Please log in first.' });

      const cleanWallet = String(body.usdtAddress || '').trim();
      const cleanTgChatId = String(body.tgChatId || '').trim();
      const updatePayload = { updatedAt: new Date() };
      if (typeof body.usdtAddress === 'string') updatePayload.affWalletUsdt = cleanWallet;
      if (typeof body.tgChatId === 'string') updatePayload.tgChatId = cleanTgChatId;

      await db.collection('saas_users').doc(userId).set(updatePayload, { merge: true });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/web-affiliate-payout', async (req, res) => {
    try {
      const body = req.body || {};
      let userId = String(body.userId || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (!userId && email) {
        const uSnap = await db.collection('saas_users').where('email', '==', email).limit(1).get();
        if (!uSnap.empty) userId = uSnap.docs[0].id;
      }
      if (!userId) return res.status(400).json({ ok: false, error: 'Please log in first.' });

      const out = await requestAffiliatePayout(userId, body.usdtAddress);
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/web-me', async (req, res) => {
    try {
      const cookieHeader = String(req.headers.cookie || '');
      const mUid = cookieHeader.match(/(?:^|;\s*)saas_uid=([^;]+)/);
      const uid = mUid ? decodeURIComponent(mUid[1]).trim() : '';
      if (!uid) if (postedUrl && postedUrl.includes('search?q=from')) { postedUrl = 'https://x.com/' + (screenName || 'hinata_sasbbe7'); }
      return res.json({ ok: true, loggedIn: false, paid: false });

      const uSnap = await db.collection('saas_users').doc(uid).get();
      if (!uSnap.exists) return res.json({ ok: true, loggedIn: false, paid: false });
      const u = uSnap.data();

      const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', uid).get();
      const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', uid).get();

      const accountsDetailed = accSnap.docs.map(d => ({
        docId: d.id,
        authToken: d.data().authToken || '',
        username: d.data().username || '',
        role: d.data().role || '最新'
      })).filter(a => a.authToken);

      const postsDetailed = postSnap.docs.map(d => ({
        docId: d.id,
        text: d.data().text || '',
        imageUrl: d.data().imageUrl || ''
      })).filter(p => p.text);

      const tokens = accountsDetailed.map(a => a.authToken);
      const posts = postsDetailed.map(p => p.text);
      const firstImgPath = (postsDetailed.map(p => p.imageUrl).find(Boolean)) || u.savedImagePath || '';
      const savedImageUrl = firstImgPath ? ('/uploads/' + path.basename(firstImgPath)) : '';
      const paid = isUserPaidActive(u);
      const isRegisteredMember = Boolean(u.email && !String(u.email).endsWith('@telegram.local'));

      return res.json({
        ok: true,
        loggedIn: isRegisteredMember,
        hasSession: true,
        userId: u.userId,
        email: isRegisteredMember ? u.email : '',
        planId: u.planId || 'free',
        planName: (paid && u.planName && !String(u.planName).includes('未契約')) ? u.planName : (paid ? 'Active 24/7 Plan' : 'Free Trial ($0)'),
        paid,
        isEngineRunning: !!u.isEngineRunning,
        ispCountry: u.ispCountry || 'US',
        unlockedCountries: (Array.isArray(u.unlockedCountries) && u.unlockedCountries.length > 0) ? u.unlockedCountries : [u.ispCountry || 'US'],
        intervalMin: u.postIntervalMin || 15,
        bio: u.profileBio || '',
        tokens,
        posts,
        accountsDetailed,
        postsDetailed,
        savedImageUrl
      });
    } catch (e) {
      return res.json({ ok: false, loggedIn: false });
    }
  });

  app.post('/api/web-auth', async (req, res) => {
    res.on('finish', () => {});
    try {
      const body = req.body || {};
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.json({ ok: false, error: 'Please enter a valid email address.' });
      }
      if (body.mode === 'signup' && body.passwordConfirm !== undefined && password !== String(body.passwordConfirm || '').trim()) {
        return res.json({ ok: false, error: 'Passwords do not match. Please enter the same password twice.' });
      }
      if (password.length < 4) {
        return res.json({ ok: false, error: 'Password must be at least 4 characters.' });
      }

      const pwHash = hashWebPass(password);
      const cookieHeader = String(req.headers.cookie || '');
      const mUid = cookieHeader.match(/(?:^|;\s*)saas_uid=([^;]+)/);
      const currentCookieUid = mUid ? decodeURIComponent(mUid[1]).trim() : '';

      // 既存メールアドレスの検索
      const qSnap = await db.collection('saas_users').where('email', '==', email).limit(1).get();
      let targetUser = null;
      let isNewSignup = false;

      if (!qSnap.empty) {
        const doc = qSnap.docs[0];
        const d = doc.data();
        if (d.webPassHash && d.webPassHash !== pwHash) {
          return res.json({ ok: false, error: 'Incorrect password for this email address.' });
        }
        const sessionToken = crypto.randomBytes(24).toString('hex');
        await doc.ref.update({
          webPassHash: pwHash,
          sessionToken,
          updatedAt: new Date()
        });
        targetUser = { ...d, userId: doc.id, sessionToken };
      } else {
        isNewSignup = true;
        const sessionToken = crypto.randomBytes(24).toString('hex');
        let userId = currentCookieUid;
        let existingDoc = null;
        if (userId) {
          const snap = await db.collection('saas_users').doc(userId).get();
          if (snap.exists && (!snap.data().email || String(snap.data().email).endsWith('@telegram.local'))) {
            existingDoc = snap;
          }
        }
        if (!existingDoc) {
          userId = 'WEB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        }

        const now = new Date();
        const newUserData = existingDoc
          ? {
              ...existingDoc.data(),
              email,
              name: email.split('@')[0],
              webPassHash: pwHash,
              sessionToken,
              updatedAt: now
            }
          : {
              userId,
              name: email.split('@')[0],
              email,
              webPassHash: pwHash,
              lang: 'en',
              ispCountry: 'US',
              timezone: 'America/New_York',
              planId: 'free',
              planName: 'Free Trial ($0 Test Ready)',
              planStatus: 'active',
              maxThreads: 1,
              maxAccounts: 3,
              ispQuota: 0,
              minIntervalMin: 5,
              postIntervalMin: 15,
              assignedProxies: [],
              profileBio: '',
              isEngineRunning: false,
              sessionToken,
              createdAt: now,
              updatedAt: now
            };

        await db.collection('saas_users').doc(userId).set(newUserData, { merge: true });
        targetUser = newUserData;

        const botToken = (process.env.TELEGRAM_BOT_TOKEN || '9047128394:AAEN3puCbpuuTZM52NQILwZUGq5afbok-ak').trim();
        sendTgAdminAlert(
          botToken,
          8401260325,
          '👤 <b>[Web New Member Registered!]</b>\n' +
          '━━━━━━━━━━━━━━━━━━━━━━\n' +
          '• <b>Email:</b> <code>' + escapeHtml(email) + '</code>\n' +
          '• <b>User ID:</b> <code>' + escapeHtml(userId) + '</code>'
        );
      }

      const maxAge = 30 * 86400;
      res.setHeader('Set-Cookie', [
        `saas_uid=${encodeURIComponent(targetUser.userId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
        `saas_session=${encodeURIComponent(targetUser.sessionToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
      ]);

      const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', targetUser.userId).get();
      const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', targetUser.userId).get();
      const paid = isUserPaidActive(targetUser);

      return res.json({
        ok: true,
        isNewSignup,
        loggedIn: true,
        userId: targetUser.userId,
        email: targetUser.email,
        planId: targetUser.planId || 'free',
        planName: paid ? (targetUser.planName || 'Active Paid Plan') : 'Free Trial ($0 Test Ready)',
        paid,
        isEngineRunning: !!targetUser.isEngineRunning,
        ispCountry: targetUser.ispCountry || 'US',
        unlockedCountries: (Array.isArray(targetUser.unlockedCountries) && targetUser.unlockedCountries.length > 0) ? targetUser.unlockedCountries : [targetUser.ispCountry || 'US'],
        intervalMin: targetUser.postIntervalMin || 15,
        bio: targetUser.profileBio || '',
        tokens: accSnap.docs.map(d => d.data().authToken).filter(Boolean),
        posts: postSnap.docs.map(d => d.data().text).filter(Boolean),
        accountsDetailed: accSnap.docs.map(d => ({ docId: d.id, authToken: d.data().authToken || '', username: d.data().username || '' })).filter(a => a.authToken),
        postsDetailed: postSnap.docs.map(d => ({ docId: d.id, text: d.data().text || '' })).filter(p => p.text),
        savedImageUrl: ((postSnap.docs.map(d => d.data().imageUrl).find(Boolean)) || targetUser.lastUploadedImagePath) ? ('/uploads/' + path.basename((postSnap.docs.map(d => d.data().imageUrl).find(Boolean)) || targetUser.lastUploadedImagePath)) : ''
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  
  app.post('/api/web-upload-arch-diagram', async (req, res) => {
    try {
      const b64 = String((req.body && req.body.imageBase64) || '');
      const m = b64.match(/^data:image\/[a-zA-Z0-9+]+;base64,(.+)$/);
      const raw = m ? m[1] : b64;
      const buf = Buffer.from(raw, 'base64');
      if (buf.length < 1000) return res.json({ ok: false, error: 'Invalid image data' });
      const targetPath = path.join(UPLOAD_DIR, 'xswarm_architecture.png');
      fs.writeFileSync(targetPath, buf);
      return res.json({ ok: true, url: '/uploads/xswarm_architecture.png?v=' + Date.now() });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  
  // ==========================================================================
  // 0.5) Real-Time X Token Verification (@username) & Saved Item CRUD APIs
  // ==========================================================================
  async function resolveXScreenNameFromToken(authToken) {
    // 1. まず既存DB (saas_accounts / accounts) にキャッシュされた username があれば即座に返す
    try {
      const s1 = await db.collection('saas_accounts').where('authToken', '==', authToken).limit(1).get();
      if (!s1.empty && s1.docs[0].data().username) return s1.docs[0].data().username;
      const s2 = await createAccountRepository(db).getAccount(authToken);
      if (s2.exists && (s2.data().username || s2.data().screenName || s2.data().userId)) {
        return s2.data().username || s2.data().screenName || s2.data().userId;
      }
    } catch (e) {}

    // 2. ヘッドレスブラウザで X API (verify_credentials.json / settings.json) からリアルタイム取得
    let browser = null;
    let factoryAccount = null;
    try {
      const factorySnap = await createAccountRepository(db).getAccount(authToken);
      if (factorySnap.exists) factoryAccount = factorySnap.data() || null;
    } catch (e) {}
    const tokenHash = crypto.createHash('md5').update(authToken).digest('hex').slice(0, 12);
    const userDir = path.join(CACHE_DIR, 'verify_' + tokenHash);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
      try { fs.unlinkSync(path.join(userDir, f)); } catch (e) {}
    });

    try {
      const proxyObj = factoryAccount ? getResidentialProxyForAccount(authToken, factoryAccount) : getResidentialProxy(authToken);
      const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];
      if (proxyObj && proxyObj.host) args.push('--proxy-server=http://' + proxyObj.host + ':' + proxyObj.port);

      browser = await puppeteer.launch({
        headless: 'new',
        args,
        ignoreDefaultArgs: ['--enable-automation'],
        userDataDir: userDir,
        protocolTimeout: 25000
      });
      const page = await browser.newPage();
      const factoryUa = readStoredUserAgent(factoryAccount);
      if (factoryUa) await page.setUserAgent(factoryUa);
      if (proxyObj && proxyObj.user && proxyObj.pass) {
        await page.authenticate({ username: proxyObj.user, password: proxyObj.pass });
      }
      await page.setCookie(
        { name: 'auth_token', value: authToken, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
        { name: 'auth_token', value: authToken, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
      );
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2200));

      const cookies = await page.cookies().catch(() => []);
      const ct0 = (cookies.find(c => c.name === 'ct0') || {}).value || '';
      let uname = '';
      if (ct0) {
        uname = await page.evaluate(async (bearer, csrf) => {
          try {
            const r = await fetch('https://x.com/i/api/1.1/account/settings.json', {
              credentials: 'include',
              headers: {
                'authorization': 'Bearer ' + bearer,
                'x-csrf-token': csrf,
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session'
              }
            });
            const d = await r.json().catch(() => ({}));
            return d.screen_name || '';
          } catch (e) { return ''; }
        }, X_WEB_BEARER, ct0).catch(() => '');
      }
      if (!uname) {
        uname = await page.evaluate(() => {
          const a = document.querySelector("a[data-testid='AppTabBar_Profile_Link']");
          if (a && a.getAttribute('href')) return a.getAttribute('href').replace(/^\//, '').split('/')[0];
          return '';
        }).catch(() => '');
      }
      return String(uname || '').replace(/^@/, '');
    } catch (e) {
      return '';
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  async function ensureWebSessionUser(req, res, rawUserId) {
    const cookieHeader = String(req.headers.cookie || '');
    const mUid = cookieHeader.match(/(?:^|;\s*)saas_uid=([^;]+)/);
    const mSess = cookieHeader.match(/(?:^|;\s*)saas_session=([^;]+)/);
    const cookieUid = mUid ? decodeURIComponent(mUid[1]).trim() : '';
    const cookieSess = mSess ? decodeURIComponent(mSess[1]).trim() : '';

    let userId = null;
    let uSnap = null;
    let uRef = null;

    // クライアントからの未検証rawUserIdは信用せず、暗号化セッショントークンの一致によってのみ既存ユーザーを認証
    if (cookieUid && cookieSess && /^(TG-|WEB-|USR-)/.test(cookieUid)) {
      uRef = db.collection('saas_users').doc(cookieUid);
      const snap = await uRef.get().catch(() => null);
      if (snap && snap.exists && snap.data().sessionToken === cookieSess) {
        userId = cookieUid;
        uSnap = snap;
      }
    }

    if (!userId) {
      userId = 'WEB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
      uRef = db.collection('saas_users').doc(userId);
    }

    const sessionToken = (uSnap && uSnap.exists && uSnap.data().sessionToken) || crypto.randomBytes(24).toString('hex');
    if (!uSnap || !uSnap.exists) {
      await uRef.set({
        userId,
        name: 'WebUser_' + userId.slice(-4),
        lang: 'en',
        ispCountry: 'US',
        timezone: 'America/New_York',
        planId: 'free',
        planName: 'Free Trial ($0 Test Ready)',
        planStatus: 'active',
        maxThreads: 1,
        maxAccounts: 3,
        ispQuota: 0,
        minIntervalMin: 5,
        postIntervalMin: 15,
        assignedProxies: [],
        profileBio: '',
        isEngineRunning: false,
        sessionToken,
        createdAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
    }
    const maxAge = 30 * 86400;
    res.setHeader('Set-Cookie', [
      `saas_uid=${encodeURIComponent(userId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
      `saas_session=${encodeURIComponent(sessionToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
    ]);
    return userId;
  }

  app.post('/api/web-verify-token', async (req, res) => {
    try {
      const body = req.body || {};
      const extracted = Array.from(new Set((String(body.tokens || '').match(/\b[a-fA-F0-9]{40}\b/g) || []).map(t => t.toLowerCase())));
      if (extracted.length === 0) {
        return res.json({ ok: false, error: 'No 40-character hexadecimal auth_token found in your input.' });
      }

      // セッションに基づく安全なユーザー確定
      const userId = await ensureWebSessionUser(req, res);
      const now = new Date();

      for (const tok of extracted.slice(0, 10)) {
        const docId = userId + '_' + tok.slice(0, 10);
        const screenName = await resolveXScreenNameFromToken(tok);
        const encToken = encryptCredentials({ authToken: tok });
        const maskedToken = tok.slice(0, 4) + '...' + tok.slice(-4);
        const tokHash = crypto.createHash('sha256').update(tok).digest('hex');

        await db.collection('saas_accounts').doc(docId).set({
          ownerUserId: userId,
          authToken: maskedToken,
          authTokenHash: tokHash,
          encryptedAuthToken: encToken,
          username: screenName || '',
          userId: screenName || '',
          role: '最新',
          isActive: true,
          ispCountry: String(body.country || 'US').toUpperCase(),
          timezone: 'America/New_York',
          nextPostAt: new Date(0),
          createdAt: now,
          updatedAt: now
        }, { merge: true });
      }

      const allAccSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      const accounts = allAccSnap.docs.map(d => ({
        docId: d.id,
        authToken: d.data().authToken || '',
        username: d.data().username || '',
        role: d.data().role || '最新'
      })).filter(a => a.authToken);

      return res.json({ ok: true, userId, accounts });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/web-save-item', async (req, res) => {
    try {
      const body = req.body || {};
      const userId = await ensureWebSessionUser(req, res);
      const type = String(body.type || '');
      const now = new Date();

      if (type === 'bio') {
        const bio = String(body.bio || '').trim().slice(0, 160);
        await db.collection('saas_users').doc(userId).set({ profileBio: bio, updatedAt: now }, { merge: true });
        return res.json({ ok: true, userId, bio });
      }

      if (type === 'image') {
        const savedImagePath = body.imageBase64 ? saveUploadedBase64Image(body.imageBase64, userId) : '';
        if (savedImagePath) {
          await db.collection('saas_users').doc(userId).set({ savedImagePath, updatedAt: now }, { merge: true });
        }
        return res.json({
          ok: true,
          userId,
          savedImageUrl: savedImagePath ? ('/uploads/' + path.basename(savedImagePath)) : ''
        });
      }

      if (type === 'post') {
        const uSnap = await db.collection('saas_users').doc(userId).get();
        let savedImagePath = body.imageBase64 ? saveUploadedBase64Image(body.imageBase64, userId) : ((uSnap.exists && uSnap.data().savedImagePath) || '');
        if (savedImagePath) {
          await db.collection('saas_users').doc(userId).set({ savedImagePath, updatedAt: now }, { merge: true });
        }
        const lines = String(body.posts || '').split(/\r?\n---\r?\n|\r?\n\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const pText of lines.slice(0, 10)) {
          await db.collection('saas_posts').add({
            ownerUserId: userId,
            text: pText,
            imageUrl: savedImagePath || '',
            createdAt: now,
            updatedAt: now
          });
        }
        const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
        const posts = postSnap.docs.map(d => ({
          docId: d.id,
          text: d.data().text || '',
          imageUrl: d.data().imageUrl || ''
        })).filter(p => p.text);
        return res.json({
          ok: true,
          userId,
          posts,
          savedImageUrl: savedImagePath ? ('/uploads/' + path.basename(savedImagePath)) : ''
        });
      }

      return res.json({ ok: false, error: 'Unknown item type' });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/web-delete-item', async (req, res) => {
    try {
      const body = req.body || {};
      const userId = await ensureWebSessionUser(req, res);
      const type = String(body.type || '');
      const itemId = String(body.itemId || '');

      if (type === 'account' && itemId) {
        const docRef = db.collection('saas_accounts').doc(itemId);
        const docSnap = await docRef.get();
        if (docSnap.exists && docSnap.data().ownerUserId === userId) {
          await docRef.delete();
        }
        const allAccSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
        const accounts = allAccSnap.docs.map(d => ({
          docId: d.id,
          authToken: d.data().authToken || '',
          username: d.data().username || ''
        })).filter(a => a.authToken);
        return res.json({ ok: true, accounts });
      }

      if (type === 'bio') {
        await db.collection('saas_users').doc(userId).set({ profileBio: '', updatedAt: new Date() }, { merge: true });
        return res.json({ ok: true, bio: '' });
      }

      if (type === 'post' && itemId) {
        const pRef = db.collection('saas_posts').doc(itemId);
        const pSnap = await pRef.get();
        if (pSnap.exists && pSnap.data().ownerUserId === userId) {
          await pRef.delete();
        }
        const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
        const posts = postSnap.docs.map(d => ({
          docId: d.id,
          text: d.data().text || ''
        })).filter(p => p.text);
        return res.json({ ok: true, posts });
      }

      if (type === 'image') {
        await db.collection('saas_users').doc(userId).set({ savedImagePath: '', updatedAt: new Date() }, { merge: true });
        return res.json({ ok: true });
      }

      return res.json({ ok: false });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  
  app.post('/api/web-switch-country', async (req, res) => {
    try {
      const body = req.body || {};
      const userId = await ensureWebSessionUser(req, res);
      const targetCountry = String(body.country || 'US').toUpperCase().trim();
      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      if (!uSnap.exists) return res.json({ ok: false, error: 'User not found' });

      const u = uSnap.data();
      const unlocked = Array.isArray(u.unlockedCountries) && u.unlockedCountries.length > 0
        ? u.unlockedCountries
        : [u.ispCountry || 'US'];

      if (!unlocked.includes(targetCountry)) {
        return res.json({ ok: false, locked: true, error: 'This ISP country is locked. Unlock it for $5.' });
      }

      const cMeta = (Array.isArray(COUNTRIES) && COUNTRIES.find(c => c.code === targetCountry)) || { code: targetCountry, tz: 'America/New_York' };
      await uRef.set({
        ispCountry: cMeta.code,
        timezone: cMeta.tz,
        updatedAt: new Date()
      }, { merge: true });

      const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      for (const d of accSnap.docs) {
        await d.ref.update({ ispCountry: cMeta.code, timezone: cMeta.tz, updatedAt: new Date() }).catch(() => {});
      }

      return res.json({ ok: true, ispCountry: cMeta.code, timezone: cMeta.tz, unlockedCountries: unlocked });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

    app.post('/api/web-toggle-engine', async (req, res) => {
    try {
      const userId = await ensureWebSessionUser(req, res);
      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      if (!uSnap.exists) return res.json({ ok: false, error: 'User not found' });
      const u = uSnap.data();
      if (!isUserPaidActive(u)) {
        return res.json({ ok: false, error: 'Please activate a $7 or 30-Day plan first to run 24/7 autopilot.' });
      }
      const nextState = !u.isEngineRunning;
      await uRef.update({ isEngineRunning: nextState, updatedAt: new Date() });
      return res.json({ ok: true, isEngineRunning: nextState });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });
    app.post('/api/web-trigger-now', async (req, res) => {
    try {
      const userId = await ensureWebSessionUser(req, res);
      const uSnap = await db.collection('saas_users').doc(userId).get();
      if (!uSnap.exists || !isUserPaidActive(uSnap.data())) {
        return res.json({ ok: false, error: 'Active paid plan required for 24/7 engine trigger.' });
      }
      const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      for (const d of accSnap.docs) {
        await d.ref.update({ nextPostAt: new Date(0), updatedAt: new Date() }).catch(() => {});
      }
      await db.collection('saas_users').doc(userId).update({ isEngineRunning: true, updatedAt: new Date() });
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });
  app.post('/api/web-logout', (req, res) => {
    res.setHeader('Set-Cookie', [
      'saas_uid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      'saas_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
    ]);
    res.json({ ok: true });
  });

  // ==========================================================================
  // 1) LP Visit Tracker (/api/lp-track)
  // ==========================================================================
  app.post('/api/lp-track', async (req, res) => {
    try {
      const ua = String(req.headers['user-agent'] || '');
      if (/TelegramBot|Twitterbot|facebookexternalhit|Slackbot|Discordbot|Googlebot|bingbot|crawler|spider/i.test(ua)) {
        return res.json({ ok: true, bot: true });
      }
      const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
      const country = String(req.headers['cf-ipcountry'] || (req.body && req.body.tz) || 'GLOBAL').trim();
      const lang = String((req.body && req.body.lang) || 'en').slice(0, 8);
      const ref = String((req.body && req.body.ref) || 'direct').slice(0, 40);

      const statsRef = db.collection('settings').doc('lp_stats');
      const snap = await statsRef.get().catch(() => null);
      const cur = (snap && snap.exists) ? snap.data() : { totalPv: 0, uniqueVisitors: 0 };
      const nowMs = Date.now();
      const lastSeen = recentVisitorCache.get(ip) || 0;
      const isNewUnique = (nowMs - lastSeen) > 30 * 60 * 1000;
      recentVisitorCache.set(ip, nowMs);

      const nextPv = (cur.totalPv || 0) + 1;
      const nextUv = (cur.uniqueVisitors || 0) + (isNewUnique ? 1 : 0);

      await statsRef.set({
        totalPv: nextPv,
        uniqueVisitors: nextUv,
        lastVisitAt: new Date(),
        lastCountry: country,
        lastLang: lang,
        lastRef: ref
      }, { merge: true });

      if (isNewUnique && ref !== 'admin_preview') {
        const botToken = (process.env.TELEGRAM_BOT_TOKEN || '9047128394:AAEN3puCbpuuTZM52NQILwZUGq5afbok-ak').trim();
        sendTgAdminAlert(
          botToken,
          8401260325,
          '👀 <b>[Web LP Visitor Detected]</b>\n' +
          '━━━━━━━━━━━━━━━━━━━━━━\n' +
          '• <b>Location / TZ:</b> <code>' + escapeHtml(country) + '</code>\n' +
          '• <b>Browser Lang:</b> <b>' + escapeHtml(lang.toUpperCase()) + '</b>\n' +
          '• <b>Source (Ref):</b> <code>' + escapeHtml(ref) + '</code>\n' +
          '• <b>Total Traffic:</b> Unique <b>' + nextUv + '</b> (PV: ' + nextPv + ')'
        );
      }
      res.json({ ok: true, pv: nextPv, uv: nextUv });
    } catch (e) {
      res.json({ ok: false });
    }
  });

  // ==========================================================================
  // 2) AI 3-Angle Spintax Generator (/api/web-ai-spintax)
  // ==========================================================================
  app.post('/api/web-ai-spintax', async (req, res) => {
    try {
      const keyword = String((req.body && req.body.keyword) || 'Crypto & Passive Income').trim().slice(0, 160);
      const { hasXaiKey, completeText } = require('./grok_client');
      let generated = null;

      if (hasXaiKey()) {
        try {
          const prompt =
            'You are an elite X (Twitter) growth marketer. The user wants to promote: "' + keyword + '". ' +
            'Write 3 high-converting X posts (under 185 chars each) in the same language as the input ("' + keyword + '"), each attacking from a DIFFERENT marketing angle:\n' +
            'Post 1 (Angle 1 - Curiosity & Hook): Spark intense curiosity to click.\n' +
            'Post 2 (Angle 2 - Future Benefit & Relief): Show how easy life becomes with this offer.\n' +
            'Post 3 (Angle 3 - Social Proof & Urgency): Highlight results and FOMO.\n' +
            'Each post MUST include at least two {optionA|optionB|optionC} Spintax variations so every post looks unique to X filters, plus 2 hashtags. ' +
            'Return ONLY a valid JSON array of 3 strings ["post 1", "post 2", "post 3"].';
          const raw = (await completeText({ tier: 'quality', prompt })).text.trim();
          const m = raw.match(/\[[\s\S]*\]/);
          if (m) {
            const arr = JSON.parse(m[0]);
            if (Array.isArray(arr) && arr.length >= 3) generated = arr.map(s => String(s).trim()).filter(Boolean).slice(0, 3);
          }
        } catch (aiErr) {}
      }

      if (!generated || generated.length < 3) {
        const isJp = /[\u3040-\u309F\u30A0-\u30FF]/.test(keyword);
        generated = isJp
          ? [
              '{まだ手動で消耗してる？|知らないと損する最新ルート|検索上位を独占する裏技} — ' + keyword + ' 🔥 {詳細はプロフから|リンクはリプ欄へ} #副業 #X運用',
              '{一度セットすれば完全放置|あなたが寝ている間も24時間自動で|作業時間をゼロにして} ' + keyword + ' を加速させよう⚡ {今すぐチェック|プロフのURLへ} #自動化 #不労所得',
              '{すでに導入者が続々成果報告|本日の限定枠を公開中|シャドウバン0秒回避で稼働中} 👉 ' + keyword + ' 🚀 {乗り遅れる前にリプ欄へ|詳細はこちら} #Webマーケティング #個人開発'
            ]
          : [
              '{Still grinding manually every day?|The underground method top marketers use|How we dominate X search 24/7} — ' + keyword + ' 🔥 #SideHustle #Growth',
              '{Set it once and wake up to nonstop leads|Let cloud automation work while you sleep|100% hands-free traffic}: ' + keyword + ' ⚡ #PassiveIncome #Automation',
              '{Live proof running 24/7 with zero shadowbans|New spots just opened today|Join the top 1% workflow} 👉 ' + keyword + ' 🚀 #DigitalMarketing #Crypto'
            ];
      }

      res.json({
        ok: true,
        angles: [
          { label: '🔥 Angle 1: Curiosity & Viral Hook', desc: 'Sparks immediate curiosity to stop scrolling & click.', text: generated[0] },
          { label: '💎 Angle 2: Future Benefit & Ease', desc: 'Paints the effortless future after using your offer.', text: generated[1] },
          { label: '⚡ Angle 3: Social Proof & Urgency', desc: 'Drives fast action with live proof & FOMO.', text: generated[2] }
        ],
        posts: generated
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ==========================================================================
  // 3) STEP 1-5 Save + 100% Free Live Post Execution (/api/web-launch)
  // ==========================================================================
  app.post('/api/web-launch', async (req, res) => {
    if (!req.body) req.body = {};
    const _inTok = String(req.body.tokens || '');
    const _isPreset = Boolean(req.body.usePresetDemo || _inTok.includes('PRESET_PROTECTED') || !/[a-fA-F0-9]{40}/.test(_inTok));
    if (_isPreset) {
      req.body.tokens = '0277b50ef710c3b922af7d0a06e017f3a0501283';
      req.body.usePresetDemo = true;
    }
    try {
      const body = req.body || {};
      const cookieHeader = String(req.headers.cookie || '');
      const mUid = cookieHeader.match(/(?:^|;\s*)saas_uid=([^;]+)/);
      let userId = String(body.userId || (mUid ? decodeURIComponent(mUid[1]) : '') || '').trim();
      // もしCookieが無くても、入力された auth_token が既に課金済みユーザーのアカウントとして登録されていれば、その userId を自動で引き継ぐ
      if ((!userId || !/^(TG-|WEB-|USR-)/.test(userId)) && body.tokens) {
        const tokMatches = String(body.tokens).match(/\b[a-fA-F0-9]{40}\b/);
        if (tokMatches) {
          const existingAccSnap = await db.collection('saas_accounts').where('authToken', '==', tokMatches[0].toLowerCase()).limit(1).get().catch(() => null);
          if (existingAccSnap && !existingAccSnap.empty) {
            userId = existingAccSnap.docs[0].data().ownerUserId || '';
          }
        }
      }
      if (!userId || !/^(TG-|WEB-|USR-)/.test(userId)) {
        userId = 'WEB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
      }

      const rawTokensText = String(body.tokens || '').trim();
      const extractedTokens = Array.from(new Set((rawTokensText.match(/\b[a-fA-F0-9]{40}\b/g) || []).map(t => t.toLowerCase())));
      const bioText = String(body.bio || '').trim().slice(0, 160);
      const rawPostsText = String(body.posts || '').trim();
      const postLines = rawPostsText.split(/\r?\n---\r?\n|\r?\n\r?\n/).map(s => s.trim()).filter(Boolean);
      const intervalMin = Math.max(1, Math.min(1440, parseInt(body.intervalMin || '15', 10) || 15));
      const ispCountry = String(body.country || 'US').toUpperCase().trim();
      const selfReplyMode = body.selfReply !== false;
      const imageBase64 = String(body.imageBase64 || '').trim();

      if (extractedTokens.length === 0) {
        return res.json({
          ok: false,
          error: 'Please enter a valid 40-character hexadecimal X auth_token in STEP 1.'
        });
      }
      if (postLines.length === 0) {
        return res.json({
          ok: false,
          error: 'Please enter at least one post text to publish in STEP 3.'
        });
      }

      let savedImagePath = imageBase64 ? saveUploadedBase64Image(imageBase64, userId) : '';
      if (!savedImagePath && !body.clearImage) {
        const prevSnap = await db.collection('saas_users').doc(userId).get().catch(() => null);
        if (prevSnap && prevSnap.exists && prevSnap.data().lastUploadedImagePath && fs.existsSync(prevSnap.data().lastUploadedImagePath)) {
          savedImagePath = prevSnap.data().lastUploadedImagePath;
        }
      }

      const cMeta = (Array.isArray(COUNTRIES) && COUNTRIES.find(c => c.code === ispCountry)) || { code: 'US', tz: 'America/New_York' };
      const now = new Date();
      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const existingUser = uSnap.exists ? uSnap.data() : null;
      if (!savedImagePath && existingUser && existingUser.savedImagePath && fs.existsSync(existingUser.savedImagePath)) {
        savedImagePath = existingUser.savedImagePath;
      }

      const isPaidActive = Boolean(
        existingUser &&
        (existingUser.isAdmin ||
         ['TG-8401260325', 'USR-MVUA1GLP-D640'].includes(userId) ||
         (existingUser.planId && existingUser.planId !== 'free' && existingUser.planStatus === 'active' && (existingUser.ispQuota || 0) > 0))
      );

      const sessionToken = (existingUser && existingUser.sessionToken) || crypto.randomBytes(24).toString('hex');
      const userUpdateData = {
        userId,
        name: (existingUser && existingUser.name) || ('WebUser_' + userId.slice(-4)),
        lang: 'en',
        ispCountry: cMeta.code,
        timezone: cMeta.tz,
        profileBio: bioText,
        postIntervalMin: isPaidActive ? intervalMin : Math.max(5, intervalMin),
        selfReplyLinkMode: selfReplyMode,
        ...(savedImagePath ? { savedImagePath } : {}),
        lastUploadedImagePath: body.clearImage ? '' : (savedImagePath || (existingUser && existingUser.lastUploadedImagePath) || ''),
        sessionToken,
        updatedAt: now
      };

      if (!existingUser) {
        Object.assign(userUpdateData, {
          planId: 'free',
          planName: 'Free Live Test Tier',
          planStatus: 'active',
          maxThreads: 1,
          maxAccounts: 3,
          ispQuota: 0,
          minIntervalMin: 5,
          assignedProxies: [],
          isEngineRunning: false,
          createdAt: now
        });
      } else if (isPaidActive) {
        userUpdateData.isEngineRunning = true;
      }

      await uRef.set(userUpdateData, { merge: true });

      const maxSlots = (existingUser && existingUser.maxAccounts) ? existingUser.maxAccounts : 10;
      const userProxies = (existingUser && Array.isArray(existingUser.assignedProxies)) ? existingUser.assignedProxies : [];
      let savedAccCount = 0;
      let firstAccRef = null;
      let firstAccData = null;

      for (const tok of extractedTokens.slice(0, maxSlots)) {
        const docId = userId + '_' + tok.slice(0, 10);
        const proxyToUse = userProxies.length > 0 ? userProxies[savedAccCount % userProxies.length] : '';
        const aData = {
          ownerUserId: userId,
          authToken: tok,
          username: '',
          role: '最新',
          isActive: true,
          ispCountry: cMeta.code,
          timezone: cMeta.tz,
          marketLang: cMeta.code === 'JP' ? 'ja' : 'en',
          proxy: proxyToUse,
          nextPostAt: new Date(0),
          createdAt: now,
          updatedAt: now
        };
        const ref = db.collection('saas_accounts').doc(docId);
        await ref.set(aData, { merge: true });
        if (savedAccCount === 0) {
          firstAccRef = ref;
          firstAccData = aData;
        }
        savedAccCount++;
      }

      const existingPostsSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
      const existingPostTexts = new Set(existingPostsSnap.docs.map(d => String(d.data().text || '').trim()));
      for (const pText of postLines.slice(0, 20)) {
        if (existingPostTexts.has(pText)) continue;
        await db.collection('saas_posts').add({
          ownerUserId: userId,
          text: pText,
          imageUrl: savedImagePath || '',
          createdAt: now,
          updatedAt: now
        });
      }

      const maxAge = 30 * 86400;
      res.setHeader('Set-Cookie', [
        `saas_uid=${encodeURIComponent(userId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
        `saas_session=${encodeURIComponent(sessionToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
      ]);

      // Execute 100% Free Live Post on X
      const primaryToken = extractedTokens[0];
      const testRecordRef = db.collection('web_test_posts').doc(primaryToken);
      const testSnap = await testRecordRef.get().catch(() => null);

      let livePostResult = null;
      if (testSnap && testSnap.exists && testSnap.data().postedUrl && !isPaidActive) {
        livePostResult = {
          ok: true,
          alreadyTested: true,
          screenName: testSnap.data().screenName || '',
          postedUrl: testSnap.data().postedUrl
        };
      } else {
        livePostResult = await executeInstantWebTestPost(userUpdateData, firstAccData, postLines[0], savedImagePath, selfReplyMode);
        if (livePostResult && livePostResult.ok && livePostResult.postedUrl) {
          await testRecordRef.set({
            authToken: primaryToken.slice(0, 10) + '...',
            userId,
            screenName: livePostResult.screenName || '',
            postedUrl: livePostResult.postedUrl,
            createdAt: new Date()
          }).catch(() => {});

          if (firstAccRef && livePostResult.screenName) {
            await firstAccRef.update({
              username: livePostResult.screenName,
              userId: livePostResult.screenName,
              postCount: 1,
              lastPostedAt: new Date(),
              updatedAt: new Date()
            }).catch(() => {});
          }

          await db.collection('saas_history').add({
            ownerUserId: userId,
            threadNo: 1,
            accountDocId: firstAccRef ? firstAccRef.id : '',
            username: livePostResult.screenName || 'user',
            text: String(livePostResult.publishedText || postLines[0]).slice(0, 40),
            url: livePostResult.postedUrl,
            deleteReq: false,
            deleted: false,
            createdAt: new Date()
          }).catch(() => {});
        }
      }

      const botToken = (process.env.TELEGRAM_BOT_TOKEN || '9047128394:AAEN3puCbpuuTZM52NQILwZUGq5afbok-ak').trim();
      sendTgAdminAlert(
        botToken,
        8401260325,
        '🚀 <b>[Web Studio: FREE Live Post Executed!]</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━━━\n' +
        '• <b>User ID:</b> <code>' + escapeHtml(userId) + '</code>\n' +
        '• <b>X Account:</b> ' + (livePostResult && livePostResult.screenName ? ('<b>@' + escapeHtml(livePostResult.screenName) + '</b>') : 'Verifying') + '\n' +
        '• <b>Image Attached:</b> ' + (savedImagePath ? '📸 Yes (Camouflage Ready)' : 'No') + '\n' +
        '• <b>Live Post Result:</b> ' + (livePostResult && livePostResult.ok ? ('✅ <a href="' + livePostResult.postedUrl + '">View Live Post ↗</a>') : ('⚠️ ' + escapeHtml((livePostResult && livePostResult.reason) || 'Skipped'))) + '\n' +
        '• <b>Country / TZ:</b> 🌍 ' + escapeHtml(cMeta.code) + ' (<code>' + escapeHtml(cMeta.tz) + '</code>)'
      );

      return res.json({
        ok: true,
        userId,
        savedAccounts: savedAccCount,
        savedPosts: postLines.length,
        hasImage: !!savedImagePath,
        savedImageUrl: savedImagePath ? ('/uploads/' + path.basename(savedImagePath)) : '',
        savedImageUrl: savedImagePath ? ('/uploads/' + path.basename(savedImagePath)) : '',
        ispCountry: cMeta.code,
        timezone: cMeta.tz,
        alreadyActive: isPaidActive,
        livePostOk: Boolean(livePostResult && livePostResult.ok),
        screenName: (livePostResult && livePostResult.screenName) || '',
        postedUrl: (livePostResult && livePostResult.postedUrl) || '',
        livePostNote: (livePostResult && !livePostResult.ok) ? (livePostResult.error || livePostResult.reason) : '',
        dashboardUrl: '/dashboard?uid=' + encodeURIComponent(userId)
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  // ==========================================================================
  // 4) OxaPay $7 (or 30-Day) Instant Checkout (/api/web-create-checkout)
  // ==========================================================================
  app.post('/api/web-create-checkout', async (req, res) => {
    try {
      const body = req.body || {};
      const userId = await ensureWebSessionUser(req, res);
      const planKey = String(body.planId || 'oneday').trim().toLowerCase();
      const countryCode = String(body.country || 'US').toUpperCase().trim();

      // A) $5 Dedicated Static ISP Country Add-On / Change
      if (planKey === 'addon_isp') {
        const orderId = 'WEBISP-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        const oxa = await createOxaPayUsdInvoice(orderId, 5);
        if (!oxa || !oxa.payLink) {
          return res.json({ ok: false, error: 'Payment gateway busy. Please try again in a few seconds.' });
        }
        await db.collection('orders').doc(orderId).set({
          orderId,
          orderType: 'addon_isp_country',
          userId,
          tgChatId: null,
          autoStartOnPaid: false,
          planId: 'addon_isp',
          planName: '🌍 Dedicated Static ISP Add-On (' + countryCode + ')',
          durationDays: 30,
          totalThreads: 0,
          totalMaxAccounts: 0,
          totalIspCount: 1,
          ispCountry: countryCode,
          grossAmountUsd: 5,
          grossAmountJpy: 780,
          gatewayRedirectUrl: oxa.payLink,
          oxaTrackId: oxa.trackId || '',
          status: 'pending_payment',
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const botToken = (process.env.TELEGRAM_BOT_TOKEN || '9047128394:AAEN3puCbpuuTZM52NQILwZUGq5afbok-ak').trim();
        sendTgAdminAlert(
          botToken,
          8401260325,
          '🌍 <b>[$5 Dedicated ISP Country Add-On Invoice Created]</b>\n' +
          '━━━━━━━━━━━━━━━━━━━━━━\n' +
          '• <b>Order ID:</b> <code>' + orderId + '</code>\n' +
          '• <b>User ID:</b> <code>' + escapeHtml(userId) + '</code>\n' +
          '• <b>Target Country:</b> 🌍 <b>' + escapeHtml(countryCode) + ' ($5 USD)</b>'
        );

        return res.json({
          ok: true,
          userId,
          orderId,
          payLink: oxa.payLink,
          amountUsd: 5,
          planTitle: 'Dedicated Static ISP (' + countryCode + ')',
          country: countryCode
        });
      }

      // B) Standard SaaS Plans ($7 1-Day / $79 Starter / $179 Pro)
      const plan = (TG_PLANS && TG_PLANS[planKey]) || {
        id: 'oneday',
        title: '🔥 24-Hour Full Auto-Posting ($7 Only)',
        usd: 7, jpy: 1080, threads: 1, accounts: 3, isp: 1, minInt: 5, days: 1,
        desc: '1 Active Stream + 2 Backup Slots + 1 Dedicated Static ISP IP (24h)'
      };

      let finalCountry = countryCode;
      if (plan.id === 'oneday' && !['US', 'JP'].includes(finalCountry)) {
        finalCountry = 'US';
      }

      const prevOrders = await db.collection('orders').where('userId', '==', userId).get().catch(() => ({ docs: [] }));
      const hasCredit = (plan.id !== 'oneday') && prevOrders.docs.some(d => d.data().status === 'completed' && d.data().planId === 'oneday');
      const finalUsd = hasCredit ? Math.max(1, plan.usd - 7) : plan.usd;

      const orderId = 'WEBORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
      const oxa = await createOxaPayUsdInvoice(orderId, finalUsd);

      if (!oxa || !oxa.payLink) {
        return res.json({ ok: false, error: 'Payment gateway busy. Please try again in a few seconds.' });
      }

      await db.collection('orders').doc(orderId).set({
        orderId,
        orderType: 'web_saas_plan',
        userId,
        tgChatId: null,
        autoStartOnPaid: true,
        planId: plan.id,
        planName: plan.title,
        durationDays: plan.days,
        totalThreads: plan.threads,
        totalMaxAccounts: plan.accounts,
        totalIspCount: plan.isp,
        minIntervalMin: plan.minInt,
        ispCountry: finalCountry,
        grossAmountUsd: finalUsd,
        creditAppliedUsd: hasCredit ? 7 : 0,
        grossAmountJpy: plan.jpy || 1080,
        gatewayRedirectUrl: oxa.payLink,
        oxaTrackId: oxa.trackId || '',
        status: 'pending_payment',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const botToken = (process.env.TELEGRAM_BOT_TOKEN || '9047128394:AAEN3puCbpuuTZM52NQILwZUGq5afbok-ak').trim();
      sendTgAdminAlert(
        botToken,
        8401260325,
        '💳 <b>[Web Checkout Invoice Created]</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━━━\n' +
        '• <b>Order ID:</b> <code>' + orderId + '</code>\n' +
        '• <b>User ID:</b> <code>' + escapeHtml(userId) + '</code>\n' +
        '• <b>Plan:</b> <b>' + escapeHtml(plan.title) + ' ($' + finalUsd + ' USD)</b>\n' +
        '• <b>Chosen ISP Country:</b> 🌍 ' + escapeHtml(finalCountry)
      );

      return res.json({
        ok: true,
        userId,
        orderId,
        payLink: oxa.payLink,
        amountUsd: finalUsd,
        planTitle: plan.title,
        country: finalCountry
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  // ==========================================================================
  // 5) Payment Status & Auto-Launch (/api/web-order-status)
  // ==========================================================================
  
  // 決済完了確認時に未計上の有効な月額有料契約があれば30%報酬を即時付与
  async function _checkAndCreditUserActiveContracts(targetUid) {
    if (!targetUid) return;
    try {
      const cSnap = await db.collection('saas_contracts').where('userId', '==', targetUid).get();
      for (const doc of cSnap.docs) {
        const cd = doc.data() || {};
        if (cd.status === 'active' && !cd.affCredited && cd.planId && cd.planId !== 'free' && cd.planId !== 'oneday') {
          const paidAmt = Number(cd.paidAmountUsd || cd.amountUsd || cd.priceUsd || 0);
          if (paidAmt >= 15) {
            await processPaidSubscriptionCommission({
              contractId: doc.id,
              childUserId: targetUid,
              paidAmountUsd: paidAmt,
              planId: cd.planId,
              planName: cd.planName || cd.planId
            });
          }
        }
      }
    } catch (e) {}
  }

  app.get('/api/web-order-status', async (req, res) => {
    try {
      const orderId = String(req.query.orderId || '').trim();
      if (!orderId) return res.json({ ok: false });
      const oDoc = await db.collection('orders').doc(orderId).get();
      if (!oDoc.exists) return res.json({ ok: false });

      if (oDoc.data().status !== 'completed') {
        await verifySingleOrderPaidWithOxaPay(oDoc).catch(() => {});
      }
      const freshDoc = await db.collection('orders').doc(orderId).get();
      const oData = freshDoc.data() || {};
      if (oData.status === 'completed') {
        const uRef = db.collection('saas_users').doc(oData.userId);
        const uSnap = await uRef.get();
        const uCur = uSnap.exists ? uSnap.data() : {};
        const unlocked = Array.isArray(uCur.unlockedCountries) && uCur.unlockedCountries.length > 0
          ? uCur.unlockedCountries.slice()
          : [uCur.ispCountry || 'US'];
        const paidCountry = String(oData.ispCountry || 'US').toUpperCase();
        if (!unlocked.includes(paidCountry)) unlocked.push(paidCountry);

        const cMeta = (Array.isArray(COUNTRIES) && COUNTRIES.find(c => c.code === paidCountry)) || { code: paidCountry, tz: 'America/New_York' };
        const updatePayload = {
          ispCountry: cMeta.code,
          timezone: cMeta.tz,
          unlockedCountries: unlocked,
          updatedAt: new Date()
        };
        if (oData.orderType !== 'addon_isp_country') {
          updatePayload.isEngineRunning = true;
        }
        await uRef.set(updatePayload, { merge: true }).catch(() => {});

        const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', oData.userId).get().catch(() => ({ docs: [] }));
        for (const d of accSnap.docs) {
          await d.ref.update({ ispCountry: cMeta.code, timezone: cMeta.tz, updatedAt: new Date() }).catch(() => {});
        }

        return res.json({
          ok: true,
          paid: true,
          ispCountry: cMeta.code,
          unlockedCountries: unlocked,
          dashboardUrl: '/dashboard?uid=' + encodeURIComponent(oData.userId)
        });
      }
      return res.json({ ok: true, paid: false, status: oData.status || 'pending_payment' });
    } catch (e) {
      return res.json({ ok: false });
    }
  });

  // ==========================================================================
  // 6) Main White Luxury Landing Page (/, /lp, /welcome)
  // ==========================================================================
  const renderLandingPage = async (req, res) => {
    try {
      const ownerIds = ['TG-8401260325', 'USR-MVUA1GLP-D640'];
      const accSnap = await db.collection('saas_accounts').where('ownerUserId', 'in', ownerIds).get().catch(() => ({ docs: [] }));
      const healthy = accSnap.docs.map(d => d.data()).filter(d => d.isActive !== false && d.role === '最新' && d.username);
      healthy.sort((a, b) => (b.postCount || 0) - (a.postCount || 0));
      const activeAcc = healthy[0] || { username: 'LauraLcbc', postCount: 16 };
      const liveUname = String(activeAcc.username || 'LauraLcbc').replace(/^@/, '');
      const refParam = String(req.query.ref || req.query.start || 'web_lp').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>X-Swarm Cloud — Autonomous 24/7 X Growth Infrastructure</title>
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://appflowsystem.com/lp" />
  <meta property="og:title" content="X-Swarm Cloud — Autonomous 24/7 Real-Browser X Growth Engine" />
  <meta property="og:description" content="No X app login, no VPS, no coding needed. Real cloud browser typing + Sub-pixel image camouflage + Dedicated Static ISP + 0s shadowban swap. Test your 1st Live Post 100% FREE!" />
  <meta property="og:image" content="https://appflowsystem.com/uploads/xswarm_architecture.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="X-Swarm Cloud ⚡ 24/7 Autonomous X Cloud Engine (1st Post FREE)" />
  <meta name="twitter:description" content="Real Cloud Browser + Image Pixel Camouflage + Dedicated Static ISP + 0s Auto-Swap. Try your 1st live post 100% FREE on the web!" />
  <meta name="twitter:image" content="https://appflowsystem.com/uploads/xswarm_architecture.png" />
  <style>
    :root {
      --bg-main: #ffffff;
      --bg-subtle: #f8fafc;
      --bg-panel: #f1f5f9;
      --text-primary: #0f172a;
      --text-secondary: #1e293b;
      --text-muted: #475569;
      --obsidian: #0f172a;
      --x-blue: #1d9bf0;
      --x-blue-dark: #0284c7;
      --emerald: #059669;
      --emerald-bg: #ecfdf5;
      --emerald-border: #34d399;
      --frame-border: #334155;
      --input-border: #64748b;
      --danger: #dc2626;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg-main);
      color: var(--text-primary);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    /* Sticky Header */
    .navbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(12px);
      border-bottom: 2px solid #e2e8f0;
    }
    .nav-container {
      max-width: 1120px;
      margin: 0 auto;
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--text-primary);
      font-weight: 900;
      font-size: 20px;
      letter-spacing: -0.5px;
    }
    .brand-mark {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--obsidian);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 18px;
    }
    .free-badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--emerald-bg);
      color: var(--emerald);
      border: 1.5px solid var(--emerald-border);
      padding: 5px 13px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 800;
    }
    .nav-right {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    /* Hero Section */
    .hero {
      max-width: 960px;
      margin: 0 auto;
      padding: 60px 24px 44px;
      text-align: center;
    }
    .hero h1 {
      font-size: clamp(32px, 5vw, 54px);
      font-weight: 900;
      letter-spacing: -1.4px;
      line-height: 1.12;
      color: var(--text-primary);
      margin: 18px 0;
    }
    .hero h1 span {
      color: var(--x-blue);
    }
    .hero-lead {
      font-size: clamp(16px, 2vw, 19.5px);
      color: var(--text-muted);
      max-width: 740px;
      margin: 0 auto 28px;
      font-weight: 500;
    }
    .free-highlight-banner {
      max-width: 720px;
      margin: 0 auto 28px;
      background: var(--emerald-bg);
      border: 2px solid var(--emerald);
      border-radius: 16px;
      padding: 14px 20px;
      font-size: 15px;
      font-weight: 800;
      color: #065f46;
      box-shadow: 0 8px 20px rgba(5, 150, 105, 0.12);
    }
    .hero-actions {
      display: flex;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
    }
    .btn-primary-dark {
      background: var(--obsidian);
      color: #ffffff;
      font-weight: 800;
      font-size: 16.5px;
      padding: 16px 34px;
      border-radius: 999px;
      text-decoration: none;
      border: 2px solid var(--obsidian);
      cursor: pointer;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.2);
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-primary-dark:hover {
      background: #1e293b;
      transform: translateY(-2px);
    }
    .btn-secondary-light {
      background: #ffffff;
      color: var(--text-primary);
      border: 2px solid var(--frame-border);
      font-weight: 800;
      font-size: 15px;
      padding: 15px 26px;
      border-radius: 999px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-secondary-light:hover {
      background: var(--bg-panel);
    }

    /* Quick Future Comparison */
    .future-strip {
      max-width: 980px;
      margin: 0 auto 52px;
      padding: 0 24px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }
    .future-box {
      border-radius: 18px;
      padding: 24px;
      font-size: 14px;
    }
    .future-box.old {
      background: #fff1f2;
      border: 2px solid #fda4af;
      color: #881337;
    }
    .future-box.new {
      background: #f0fdf4;
      border: 2px solid #34d399;
      color: #064e3b;
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.1);
    }
    .future-box h3 {
      font-size: 18px;
      font-weight: 900;
      margin-bottom: 10px;
    }
    .future-box ul {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* ======================================================================
       HIGH-CONTRAST FRAMED STUDIO (STEP 1 -> STEP 5 VERTICAL STACK)
       ====================================================================== */
    .studio-section {
      max-width: 900px;
      margin: 0 auto 40px;
      padding: 0 20px;
    }
    .studio-outer-frame {
      background: var(--bg-panel);
      border: 3px solid var(--obsidian);
      border-radius: 26px;
      padding: 38px 32px;
      box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.22);
    }
    .studio-header {
      text-align: center;
      background: #ffffff;
      border: 2px solid #cbd5e1;
      border-radius: 18px;
      padding: 24px 20px;
      margin-bottom: 28px;
    }
    .studio-header h2 {
      font-size: clamp(22px, 3vw, 29px);
      font-weight: 900;
      color: var(--text-primary);
      margin-top: 8px;
      margin-bottom: 6px;
    }
    .studio-header p {
      font-size: 14.5px;
      color: var(--text-muted);
      font-weight: 600;
    }

    .steps-stack {
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .step-card {
      width: 100%;
      background: #ffffff;
      border: 2px solid var(--frame-border);
      border-left: 8px solid var(--x-blue);
      border-radius: 18px;
      padding: 26px 28px;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
    }
    .step-card:focus-within {
      border-color: var(--x-blue);
      box-shadow: 0 10px 28px rgba(29, 155, 240, 0.16);
    }
    .step-title-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .step-num-badge {
      background: var(--obsidian);
      color: #ffffff;
      font-size: 13px;
      font-weight: 900;
      padding: 5px 14px;
      border-radius: 8px;
      letter-spacing: 0.5px;
    }
    .step-heading {
      font-size: 18.5px;
      font-weight: 900;
      color: var(--text-primary);
    }
    .step-subtext {
      font-size: 13.5px;
      color: var(--text-muted);
      margin-bottom: 14px;
      font-weight: 500;
    }

    /* Clearly Visible Input Controls */
    .framed-input, .framed-textarea, .framed-select {
      width: 100%;
      background: #f8fafc;
      color: #0f172a;
      border: 2px solid var(--input-border);
      border-radius: 12px;
      padding: 14px 16px;
      font-size: 15px;
      font-weight: 500;
      font-family: inherit;
      outline: none;
      transition: all 0.15s ease;
      box-shadow: inset 0 2px 4px rgba(15, 23, 42, 0.04);
    }
    .framed-input:focus, .framed-textarea:focus, .framed-select:focus {
      background: #ffffff;
      border-color: var(--x-blue);
      box-shadow: 0 0 0 4px rgba(29, 155, 240, 0.2);
    }
    .framed-textarea {
      resize: vertical;
      min-height: 96px;
    }

    /* AI 3-Angle Suggestion Box */
    .ai-toolbar {
      margin-top: 14px;
      padding: 16px;
      background: #f0f9ff;
      border: 2px dashed #38bdf8;
      border-radius: 14px;
    }
    .ai-input-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .btn-ai-trigger {
      background: linear-gradient(135deg, #0284c7 0%, #1d9bf0 100%);
      color: #ffffff;
      border: none;
      padding: 12px 22px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);
    }
    .btn-ai-trigger:hover { background: #0369a1; }
    .ai-suggestions-panel {
      display: none;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #bae6fd;
    }
    .ai-angle-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      margin-top: 10px;
    }
    .ai-angle-card {
      background: #ffffff;
      border: 2px solid #7dd3fc;
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ai-angle-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .ai-angle-title {
      font-size: 13.5px;
      font-weight: 900;
      color: #0369a1;
    }
    .ai-angle-text {
      font-size: 13.5px;
      color: #0f172a;
      background: #f8fafc;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      font-family: monospace;
    }
    .btn-use-angle {
      background: var(--obsidian);
      color: #ffffff;
      border: none;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
    }
    .btn-use-angle:hover { background: var(--x-blue); }

    /* Image Upload Box with Camouflage Badge */
    .image-upload-zone {
      margin-top: 16px;
      padding: 18px;
      background: #f8fafc;
      border: 2px dashed var(--frame-border);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 14px;
    }
    .img-preview-wrap {
      display: none;
      align-items: center;
      gap: 12px;
      margin-top: 10px;
    }
    .img-preview-thumb {
      width: 68px;
      height: 68px;
      object-fit: cover;
      border-radius: 10px;
      border: 2px solid var(--obsidian);
    }

    /* STEP 5: Free Live Post Launch Box */
    .step-free-launch-card {
      width: 100%;
      background: #ffffff;
      border: 3px solid var(--emerald);
      border-radius: 20px;
      padding: 32px 26px;
      text-align: center;
      box-shadow: 0 16px 40px rgba(5, 150, 105, 0.14);
    }
    .free-pill-large {
      display: inline-block;
      background: var(--emerald-bg);
      color: #065f46;
      border: 2px solid var(--emerald);
      font-size: 13.5px;
      font-weight: 900;
      padding: 6px 18px;
      border-radius: 999px;
      margin-bottom: 12px;
    }
    .btn-free-post-now {
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      color: #ffffff;
      font-weight: 900;
      font-size: 19px;
      padding: 20px 44px;
      border-radius: 999px;
      border: 2px solid #047857;
      cursor: pointer;
      box-shadow: 0 14px 32px rgba(5, 150, 105, 0.35);
      transition: all 0.18s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      max-width: 580px;
    }
    .btn-free-post-now:hover {
      transform: translateY(-2px);
      box-shadow: 0 18px 38px rgba(5, 150, 105, 0.45);
    }
    .btn-free-post-now:disabled {
      opacity: 0.65;
      cursor: wait;
    }

    /* ======================================================================
       DEEP TECHNICAL ARCHITECTURE SECTION (WELL BELOW THE POST BUTTON)
       ====================================================================== */
    .tech-showcase-wrapper {
      margin-top: 140px;
      padding: 80px 24px;
      background: var(--bg-subtle);
      border-top: 3px solid #cbd5e1;
      border-bottom: 3px solid #cbd5e1;
    }
    .tech-container {
      max-width: 1060px;
      margin: 0 auto;
    }
    .tech-header {
      text-align: center;
      margin-bottom: 52px;
    }
    .tech-header h2 {
      font-size: clamp(26px, 3.8vw, 40px);
      font-weight: 900;
      letter-spacing: -1px;
      color: var(--text-primary);
      margin-top: 10px;
      margin-bottom: 12px;
    }
    .tech-header p {
      font-size: 16.5px;
      color: var(--text-muted);
      max-width: 720px;
      margin: 0 auto;
    }

    /* Visual Architecture Diagram Flow */
    .tech-diagram-board {
      background: #ffffff;
      border: 2px solid var(--obsidian);
      border-radius: 22px;
      padding: 32px 26px;
      margin-bottom: 44px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
    }
    .diagram-flow-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 16px;
      margin-top: 20px;
    }
    .diagram-node {
      background: var(--bg-panel);
      border: 2px solid #94a3b8;
      border-radius: 14px;
      padding: 18px 16px;
      text-align: center;
    }
    .diagram-node strong {
      display: block;
      font-size: 15px;
      color: var(--text-primary);
      margin-bottom: 6px;
    }
    .diagram-node span {
      font-size: 12.5px;
      color: var(--text-muted);
      display: block;
    }

    .tech-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
      gap: 24px;
    }
    .tech-card {
      background: #ffffff;
      border: 2px solid #cbd5e1;
      border-top: 6px solid var(--obsidian);
      border-radius: 18px;
      padding: 28px 24px;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
    }
    .tech-card-tag {
      display: inline-block;
      background: #e0f2fe;
      color: #0369a1;
      font-size: 11.5px;
      font-weight: 900;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 10px;
    }
    .tech-card h3 {
      font-size: 19px;
      font-weight: 900;
      margin-bottom: 10px;
      color: var(--text-primary);
    }
    .tech-card p {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 14px;
    }
    .tech-mini-diagram {
      background: var(--bg-subtle);
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-secondary);
      font-family: monospace;
    }

    /* X-Style Popup Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999;
      padding: 16px;
    }
    .x-modal {
      background: #ffffff;
      color: var(--text-primary);
      border: 3px solid var(--obsidian);
      border-radius: 24px;
      max-width: 560px;
      width: 100%;
      padding: 32px 28px;
      box-shadow: 0 25px 70px rgba(15, 23, 42, 0.35);
      position: relative;
      max-height: 92vh;
      overflow-y: auto;
    }
    .x-modal-close {
      position: absolute;
      top: 18px;
      right: 20px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 2px solid #cbd5e1;
      background: #f8fafc;
      color: var(--text-primary);
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
    }
    .verify-banner {
      background: var(--emerald-bg);
      border: 2px solid var(--emerald);
      border-radius: 16px;
      padding: 18px 20px;
      margin-bottom: 22px;
      text-align: center;
    }
    .verify-banner h4 {
      color: #065f46;
      font-size: 17.5px;
      font-weight: 900;
      margin-bottom: 6px;
    }
    .verify-banner p {
      color: #047857;
      font-size: 13.5px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .btn-verify-x {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--obsidian);
      color: #ffffff;
      font-weight: 800;
      font-size: 14.5px;
      padding: 12px 24px;
      border-radius: 999px;
      text-decoration: none;
    }
    .x-plan-cards {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 16px 0 20px;
    }
    .x-plan-card {
      border: 2px solid #cbd5e1;
      border-radius: 16px;
      padding: 16px 18px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.15s;
      background: #ffffff;
    }
    .x-plan-card.active {
      border: 3px solid var(--x-blue);
      background: #f0f9ff;
      box-shadow: 0 6px 18px rgba(29, 155, 240, 0.15);
    }
    .x-plan-price {
      font-size: 24px;
      font-weight: 900;
      color: var(--text-primary);
      text-align: right;
    }
    .x-plan-price span {
      display: block;
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
    }
    .no-fee-pill {
      background: #f8fafc;
      border: 2px solid #cbd5e1;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 12.5px;
      color: var(--text-secondary);
      margin-bottom: 18px;
    }

    footer {
      background: #ffffff;
      padding: 40px 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }
    footer a {
      color: var(--text-primary);
      text-decoration: none;
      font-weight: 700;
      margin: 0 10px;
    }
    @media (max-width: 640px) {
      .studio-outer-frame { padding: 22px 14px; }
      .step-card { padding: 18px 16px; }
    }
  
    section, #studio, #technology { scroll-margin-top: 84px; }
    .goog-te-gadget-simple {
      background-color: #f8fafc !important;
      border: 2px solid #cbd5e1 !important;
      padding: 5px 12px !important;
      border-radius: 999px !important;
      font-size: 12.5px !important;
      font-weight: 700 !important;
      line-height: 1.4 !important;
      display: inline-flex !important;
      align-items: center !important;
    }
    .goog-te-gadget-icon { display: none !important; }
    .tech-showcase-wrapper { margin-top: 64px !important; padding: 64px 24px !important; }
    .token-live-badge {
      margin-left: auto;
      font-size: 12px;
      font-weight: 800;
      padding: 4px 12px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #64748b;
      border: 1.5px solid #cbd5e1;
    }
    .token-live-badge.valid {
      background: #ecfdf5;
      color: #059669;
      border-color: #10b981;
    }
    .bottom-pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 22px;
      margin-top: 48px;
    }
    .b-price-card {
      background: #ffffff;
      border: 2px solid #cbd5e1;
      border-radius: 20px;
      padding: 28px 24px;
      text-align: left;
      position: relative;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
    }
    .b-price-card.featured {
      border: 3px solid #0f172a;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
    }

  
    @media (max-width: 680px) {
      .nav-container {
        padding: 8px 12px !important;
        gap: 6px !important;
      }
      .brand {
        font-size: 16.5px !important;
        gap: 7px !important;
      }
      .brand-mark {
        width: 28px !important;
        height: 28px !important;
        font-size: 14px !important;
        border-radius: 7px !important;
      }
      /* スマホではヘッダー内の重複緑バッジとGuest文字を隠して高さを半分に圧縮 */
      .brand .free-badge-pill {
        display: none !important;
      }
      .nav-right {
        width: 100%;
        justify-content: space-between !important;
        gap: 6px !important;
      }
      #nav-plan-badge {
        font-size: 11px !important;
        padding: 4px 9px !important;
      }
      #nav-auth-box > span {
        display: none !important;
      }
      #btn-open-auth {
        padding: 6px 12px !important;
        font-size: 11.5px !important;
      }
      .goog-te-gadget-simple {
        padding: 3px 8px !important;
        font-size: 11px !important;
      }
      .hero {
        padding: 28px 16px 28px !important;
      }
      .hero h1 {
        font-size: 30px !important;
        margin: 12px 0 !important;
      }
      .hero-lead {
        font-size: 14.5px !important;
        margin-bottom: 18px !important;
      }
      .free-highlight-banner {
        font-size: 13px !important;
        padding: 12px 14px !important;
        margin-bottom: 20px !important;
      }
      .btn-primary-dark, .btn-secondary-light {
        width: 100%;
        justify-content: center;
        padding: 14px 18px !important;
        font-size: 14.5px !important;
      }
      .studio-section {
        padding: 0 10px !important;
      }
      .studio-outer-frame {
        padding: 18px 12px !important;
        border-radius: 20px !important;
      }
      .step-card {
        padding: 16px 14px !important;
        border-left-width: 6px !important;
      }
      .step-heading {
        font-size: 16px !important;
      }
      .framed-input, .framed-textarea, .framed-select {
        font-size: 14px !important;
        padding: 11px 12px !important;
      }
      .btn-free-post-now {
        font-size: 15.5px !important;
        padding: 16px 18px !important;
      }
      section, #studio, #technology {
        scroll-margin-top: 105px !important;
      }
    }

  
    .step-card.step-done {
      border-color: #10b981 !important;
      border-left: 8px solid #10b981 !important;
      background: #f0fdf4 !important;
    }
    .cheer-box {
      display: none;
      margin-top: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      background: #ecfdf5;
      border: 1.5px solid #34d399;
      color: #065f46;
      font-size: 13px;
      line-height: 1.5;
      animation: fadeInCheer 0.25s ease;
    }
    @keyframes fadeInCheer {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .token-live-badge.warn {
      background: #fef3c7;
      color: #b45309;
      border-color: #f59e0b;
    }
    .btn-help-pop {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #e0f2fe;
      color: #0369a1;
      border: 1.5px solid #38bdf8;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 800;
      cursor: pointer;
      transition: 0.15s;
    }
    .btn-help-pop:hover {
      background: #bae6fd;
    }
    .studio-progress-wrap {
      margin-top: 16px;
      background: #f1f5f9;
      border: 1.5px solid #cbd5e1;
      border-radius: 12px;
      padding: 10px 14px;
      text-align: left;
    }
    .studio-progress-bar {
      width: 100%;
      height: 10px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 6px;
    }
    .studio-progress-fill {
      height: 100%;
      width: 20%;
      background: linear-gradient(90deg, #0284c7, #10b981);
      border-radius: 999px;
      transition: width 0.3s ease;
    }

  
    .choice-grid-interval {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
      gap: 8px;
      margin-bottom: 18px;
    }
    .choice-grid-country {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
    }
    .interval-choice-btn, .country-choice-btn {
      background: #f8fafc;
      color: #0f172a;
      border: 2px solid #cbd5e1;
      border-radius: 12px;
      padding: 10px 12px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-family: inherit;
    }
    .interval-choice-btn:hover, .country-choice-btn:hover {
      border-color: #94a3b8;
      background: #ffffff;
    }
    .interval-choice-btn.active, .country-choice-btn.active {
      background: #f0f9ff;
      border-color: #0284c7;
      box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
    }
    .choice-main-txt {
      font-size: 13.5px;
      font-weight: 900;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .choice-sub-txt {
      font-size: 11.5px;
      font-weight: 600;
      color: #64748b;
    }
    .interval-choice-btn.active .choice-main-txt,
    .country-choice-btn.active .choice-main-txt {
      color: #0369a1;
    }

  
    .custom-picker-wrap {
      position: relative;
      width: 100%;
    }
    .custom-picker-btn {
      width: 100%;
      background: #ffffff;
      color: #0f172a;
      border: 2px solid var(--input-border);
      border-radius: 12px;
      padding: 13px 16px;
      font-size: 14.5px;
      font-weight: 700;
      text-align: left;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
      transition: all 0.15s ease;
    }
    .custom-picker-btn:hover, .custom-picker-btn:focus {
      border-color: var(--x-blue);
      box-shadow: 0 0 0 3px rgba(29, 155, 240, 0.15);
    }
    .custom-picker-list {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      background: #ffffff;
      border: 2px solid #0f172a;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
      z-index: 90;
      max-height: 290px;
      overflow-y: auto;
      padding: 6px;
    }
    .custom-picker-item {
      padding: 11px 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      color: #1e293b;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.12s;
    }
    .custom-picker-item:hover {
      background: #f1f5f9;
    }
    .custom-picker-item.active {
      background: #e0f2fe;
      color: #0369a1;
    }
    .pre-launch-banner {
      border-radius: 16px;
      padding: 18px 20px;
      margin-bottom: 20px;
      text-align: left;
      transition: all 0.25s ease;
    }
    .pre-launch-banner.todo {
      background: #fffbeb;
      border: 2px solid #f59e0b;
    }
    .pre-launch-banner.progress {
      background: #f0f9ff;
      border: 2px solid #38bdf8;
    }
    .pre-launch-banner.ready {
      background: #ecfdf5;
      border: 2.5px solid #10b981;
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.15);
    }
    .auth-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      background: #f1f5f9;
      padding: 6px;
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .auth-tab-btn {
      background: transparent;
      border: none;
      padding: 10px;
      border-radius: 8px;
      font-size: 13.5px;
      font-weight: 800;
      color: #64748b;
      cursor: pointer;
    }
    .auth-tab-btn.active {
      background: #ffffff;
      color: #0f172a;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    }

  
    .saved-items-container {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .saved-list-title {
      font-size: 12.5px;
      font-weight: 900;
      color: #059669;
      margin-bottom: 2px;
    }
    .saved-item-chip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      background: #ffffff;
      border: 2px solid #34d399;
      border-radius: 12px;
      padding: 10px 14px;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.08);
    }
    .saved-status-dot {
      display: inline-block;
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #6ee7b7;
      font-size: 11px;
      font-weight: 900;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .btn-del-chip {
      background: #fef2f2;
      color: #dc2626;
      border: 1.5px solid #fecaca;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 900;
      cursor: pointer;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .btn-del-chip:hover {
      background: #dc2626;
      color: #ffffff;
      border-color: #dc2626;
    }
    .btn-confirm-step {
      margin-top: 10px;
      background: #0f172a;
      color: #ffffff;
      border: 2px solid #0f172a;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 13.5px;
      font-weight: 800;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s;
    }
    .btn-confirm-step:hover {
      background: #1d9bf0;
      border-color: #1d9bf0;
    }
    .cta-banner-strip {
      max-width: 920px;
      margin: 0 auto 56px;
      padding: 0 20px;
      text-align: center;
    }
    .cta-banner-inner {
      background: linear-gradient(135deg, #ecfdf5 0%, #f0f9ff 100%);
      border: 3px solid #059669;
      border-radius: 24px;
      padding: 36px 28px;
      box-shadow: 0 20px 50px rgba(5, 150, 105, 0.14);
    }

  
    .interval-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 22px;
    }
    .interval-card-btn {
      background: #ffffff;
      border: 2px solid #cbd5e1;
      border-radius: 14px;
      padding: 12px 14px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .interval-card-btn:hover {
      border-color: #94a3b8;
      background: #f8fafc;
    }
    .interval-card-btn.active {
      border: 2.5px solid #0284c7;
      background: #f0f9ff;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.12);
    }
    .interval-card-btn strong {
      display: block;
      font-size: 14.5px;
      font-weight: 900;
      color: #0f172a;
    }
    .interval-card-btn.active strong {
      color: #0369a1;
    }
    .interval-card-btn span {
      display: block;
      font-size: 12px;
      color: #64748b;
      margin-top: 2px;
      font-weight: 600;
    }
    .proxy-locked-box {
      background: linear-gradient(135deg, #ecfdf5 0%, #f0f9ff 100%);
      border: 2.5px solid #10b981;
      border-radius: 16px;
      padding: 16px 18px;
      margin-bottom: 14px;
    }
    .isp-country-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-top: 10px;
    }
    .isp-country-card {
      border-radius: 12px;
      padding: 11px 13px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
    }
    .isp-country-card.active-isp {
      background: #ecfdf5;
      border: 2.5px solid #10b981;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.14);
    }
    .isp-country-card.unlocked-isp {
      background: #ffffff;
      border: 2px solid #38bdf8;
    }
    .isp-country-card.locked-isp {
      background: #f1f5f9;
      border: 2px dashed #cbd5e1;
      opacity: 0.62;
      filter: grayscale(35%);
    }
    .isp-country-card.locked-isp:hover {
      opacity: 0.92;
      border-color: #64748b;
      background: #e2e8f0;
    }
    .isp-c-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13.5px;
      color: #0f172a;
      gap: 4px;
    }
    .isp-c-tz {
      font-size: 11.5px;
      color: #64748b;
      margin-top: 3px;
      font-weight: 600;
    }
    .isp-badge-active {
      background: #10b981;
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 900;
      padding: 2px 7px;
      border-radius: 999px;
    }
    .isp-badge-owned {
      background: #e0f2fe;
      color: #0369a1;
      font-size: 10.5px;
      font-weight: 900;
      padding: 2px 7px;
      border-radius: 999px;
    }
    .isp-badge-locked {
      background: #cbd5e1;
      color: #334155;
      font-size: 10.5px;
      font-weight: 900;
      padding: 2px 7px;
      border-radius: 999px;
    }

      .live-telemetry-card {
      display: none;
      background: #ffffff;
      border: 2.5px solid #0284c7;
      border-radius: 18px;
      padding: 18px 20px;
      margin: 0 auto 20px;
      text-align: left;
      box-shadow: 0 14px 36px rgba(2, 132, 199, 0.14);
    }
    .live-telemetry-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .live-pills-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 6px;
      margin-bottom: 12px;
    }
    .live-step-pill {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      color: #64748b;
      font-size: 11px;
      font-weight: 800;
      padding: 6px 8px;
      border-radius: 8px;
      text-align: center;
      transition: all 0.2s;
    }
    .live-step-pill.active {
      background: #e0f2fe;
      border-color: #0284c7;
      color: #0369a1;
      box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.15);
    }
    .live-step-pill.done {
      background: #ecfdf5;
      border-color: #10b981;
      color: #065f46;
    }
    .live-log-stream {
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 12px;
      padding: 12px 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      max-height: 190px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .live-log-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      line-height: 1.45;
    }
    .live-log-row.final-success {
      background: rgba(16, 185, 129, 0.18);
      border: 1px solid #10b981;
      padding: 8px 10px;
      border-radius: 8px;
      color: #ffffff;
      margin-top: 4px;
    }
    .live-log-time {
      color: #38bdf8;
      font-weight: 700;
      min-width: 44px;
    }
    .live-log-check {
      color: #34d399;
      font-weight: 900;
    }
      .testdrive-hero-box {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #ffffff;
      border: 3px solid #10b981;
      border-radius: 22px;
      padding: 24px 26px;
      margin-bottom: 26px;
      text-align: left;
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
    }
    .testdrive-quote-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
      border: 1.5px solid #10b981;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 900;
      margin-bottom: 10px;
    }
    .testdrive-flow-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .testdrive-flow-card {
      background: rgba(255, 255, 255, 0.07);
      border: 1.5px solid rgba(255, 255, 255, 0.16);
      border-radius: 14px;
      padding: 14px 16px;
      position: relative;
    }
    .testdrive-flow-step {
      font-size: 11px;
      font-weight: 900;
      color: #38bdf8;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .testdrive-flow-title {
      font-size: 14.5px;
      font-weight: 900;
      color: #ffffff;
      margin-bottom: 4px;
    }
    .testdrive-flow-desc {
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.45;
    }
    .confidence-guarantee-strip {
      margin-top: 14px;
      background: rgba(16, 185, 129, 0.12);
      border-left: 4px solid #10b981;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      color: #e2e8f0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <!-- Sticky Top Bar -->
  <header class="navbar">
    <div class="nav-container">
      <a href="/lp" class="brand">
        <span class="brand-mark">𝕏</span>
        <span>X-Swarm Cloud</span>
        <span class="free-badge-pill">🎁 1st Live Post 100% FREE</span>
      </a>
      <div class="nav-right">
        <div id="google_translate_element"></div>
        <!-- 課金ステータス表示バッジ -->
        <div id="nav-plan-badge" style="display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:999px;font-size:12.5px;font-weight:800;background:#f1f5f9;color:#334155;border:2px solid #cbd5e1;">
          <span>🎁 Plan:</span> <strong id="nav-plan-text">Free Trial ($0)</strong>
        </div>
        <!-- ログイン状態表示バッジ & ボタン -->
        <div id="nav-auth-box" style="display:inline-flex;align-items:center;gap:8px;">
          <button type="button" id="btn-open-auth" onclick="openAuthModal()" style="background:#0f172a;color:#ffffff;border:2px solid #0f172a;padding:8px 16px;border-radius:999px;font-size:13px;font-weight:800;cursor:pointer;">
            🔑 Log In / Sign Up
          </button>
        </div>
      </div>
    </div>
  </header>

  <!-- Admin Top Image Upload Bar (?admin=1) -->
  <div id="admin-top-upload-bar" style="display:none;background:#0f172a;color:#ffffff;border-bottom:3px solid #10b981;padding:18px 24px;text-align:center;">
    <div style="max-width:960px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">
      <div style="text-align:left;">
        <span style="background:#10b981;color:#022c22;font-weight:900;font-size:12px;padding:3px 10px;border-radius:999px;">👑 ADMIN MODE</span>
        <strong style="font-size:16px;margin-left:8px;">5層インフラ図解画像（xswarm_architecture.png.webp）の差し替え</strong>
        <div style="font-size:12.5px;color:#94a3b8;margin-top:4px;">右のボタンを押してPC内の画像を選択すると、自動でPNGに変換されLP下部とX自動宣伝ポストへ即時反映されます。</div>
      </div>
      <label style="background:#10b981;color:#022c22;font-weight:900;font-size:15px;padding:12px 24px;border-radius:999px;cursor:pointer;box-shadow:0 6px 20px rgba(16,185,129,0.35);display:inline-flex;align-items:center;gap:8px;">
        🖼️ 画像ファイルを選択して今すぐ反映する
        <input type="file" accept="image/*" style="display:none;" onchange="uploadCustomArchDiagram(this)" />
      </label>
    </div>
  </div>


  <!-- Hero Section -->
  <section class="hero lp-only-sec">
    <div class="free-badge-pill" style="margin-bottom:10px;">
      ⚡ AUTONOMOUS REAL-BROWSER X CLOUD — ZERO PASSWORD REQUIRED
    </div>
    <h1>
      Set it once in 2 minutes.<br />
      <span>Wake up to 24/7 traffic & leads.</span>
    </h1>
    <p class="hero-lead">
      Stop wasting hours manually posting or losing accounts to sudden shadowbans. Test our real-browser cloud engine on your own X account right now—<b>completely FREE</b>.
    </p>

    
    <div style="max-width:780px;margin:0 auto 24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;text-align:left;">
      <div style="background:#f8fafc;border:2px solid #cbd5e1;border-radius:12px;padding:12px 14px;">
        <strong style="display:block;font-size:13.5px;color:#0f172a;">🖥️ Zero Server Setup</strong>
        <span style="font-size:12px;color:#475569;">No VPS, no PC left open. Runs 100% on our 24/7 cloud servers.</span>
      </div>
      <div style="background:#f8fafc;border:2px solid #cbd5e1;border-radius:12px;padding:12px 14px;">
        <strong style="display:block;font-size:13.5px;color:#0f172a;">💻 Zero Coding or Software</strong>
        <span style="font-size:12px;color:#475569;">Nothing to install or program. Control everything from your phone or PC browser.</span>
      </div>
      <div style="background:#f8fafc;border:2px solid #cbd5e1;border-radius:12px;padding:12px 14px;">
        <strong style="display:block;font-size:13.5px;color:#0f172a;">🌍 Zero Proxy Hunting</strong>
        <span style="font-size:12px;color:#475569;">Dedicated Static Residential ISP Proxies are already built-in &amp; auto-configured.</span>
      </div>
    </div>
        <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin:0 auto 24px;max-width:780px;">
      <span style="background:#ecfdf5;color:#065f46;border:1.5px solid #34d399;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:800;">📵 No X App / Site Login Needed</span>
      <span style="background:#f0f9ff;color:#0369a1;border:1.5px solid #7dd3fc;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:800;">☁️ No Server / VPS Required</span>
      <span style="background:#f0f9ff;color:#0369a1;border:1.5px solid #7dd3fc;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:800;">💻 No Coding or Software Install</span>
      <span style="background:#f0f9ff;color:#0369a1;border:1.5px solid #7dd3fc;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:800;">🌍 No Proxy Hunting (Static ISP Included)</span>
    </div>
    <div class="free-highlight-banner">
      🎁 <b>100% FREE LIVE TEST:</b> Enter your settings in STEP 1–4 below and click <b>"Post Now (100% FREE)"</b>. Our cloud browser will publish your first live post on X immediately at zero cost so you can see the proof with your own eyes!
    </div>

    <div class="hero-actions">
      <a href="/studio" class="btn-primary-dark">
        🚀 Try Free Live Post Now (Open Post Studio) →
      </a>
      <a href="https://x.com/${liveUname}" target="_blank" class="btn-secondary-light">
        🟢 Verify Live Running Bot (@${liveUname}) on X ↗
      </a>
    </div>
  </section>

  
  <!-- LIVE DOGFOODING PROOF BANNER -->
  <div class="lp-only-sec">: "We use this exact system to auto-post every 15 mins" -->
  <section style="max-width: 920px; margin: 0 auto 44px; padding: 0 20px;">
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; border: 3px solid #10b981; border-radius: 22px; padding: 26px 28px; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
        <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1.5px solid #10b981; padding: 5px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 900; display: inline-flex; align-items: center; gap: 8px;">
          <span style="width: 9px; height: 9px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
          LIVE SYSTEM PROOF — AUTO-POSTING RIGHT NOW
        </span>
        <span style="font-size: 12.5px; color: #94a3b8; font-weight: 700;">
          🔄 Interval: Every 15 Mins (±20% Jitter) &nbsp;|&nbsp; 🖼️ Image Pixel Camouflage: Active
        </span>
      </div>

      <h3 style="font-size: clamp(19px, 2.6vw, 24px); font-weight: 900; color: #ffffff; margin-bottom: 8px; letter-spacing: -0.4px;">
        🤖 This Very System is Auto-Posting on X Right Now!
      </h3>
      <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 18px;">
        We don't just sell this system—<b>we run it 24/7 ourselves</b>. Right at this moment, our official cloud burner <b style="color: #38bdf8;">@${liveUname}</b> is automatically publishing posts with our 5-Layer diagram image every <b>15 minutes</b> using real cloud browser typing, sub-pixel image camouflage, and 3-second self-reply link separation—with <b>zero shadowbans</b>.
      </p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px;">
        <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 12px 14px;">
          <div style="font-size: 11.5px; color: #94a3b8; font-weight: 700;">ACTIVE DEMO ACCOUNT</div>
          <div style="font-size: 16px; font-weight: 900; color: #38bdf8; margin-top: 2px;">@${liveUname}</div>
        </div>
        <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 12px 14px;">
          <div style="font-size: 11.5px; color: #94a3b8; font-weight: 700;">AUTO-POST FREQUENCY</div>
          <div style="font-size: 16px; font-weight: 900; color: #34d399; margin-top: 2px;">⚡ Every 15 Minutes</div>
        </div>
        <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 12px 14px;">
          <div style="font-size: 11.5px; color: #94a3b8; font-weight: 700;">IMAGE CAMOUFLAGE</div>
          <div style="font-size: 16px; font-weight: 900; color: #f8fafc; margin-top: 2px;">🎨 Same Image / 0 Ban</div>
        </div>
        <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 12px 14px;">
          <div style="font-size: 11.5px; color: #94a3b8; font-weight: 700;">SEARCH VISIBILITY</div>
          <div style="font-size: 16px; font-weight: 900; color: #34d399; margin-top: 2px;">🟢 100% Live in "Latest"</div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <a href="https://x.com/${liveUname}" target="_blank" style="background: #10b981; color: #022c22; font-weight: 900; font-size: 14.5px; padding: 13px 24px; border-radius: 999px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);">
          🔎 Click to See Our Live 15-Min Auto-Posts on X Search (@${liveUname}) ↗
        </a>
        <a href="/studio" style="color: #7dd3fc; font-size: 13.5px; font-weight: 800; text-decoration: none;">
          🚀 Try Free Live Post in Post Studio →
        </a>
      </div>
    </div>
  </section>

  </div>
  <!-- Concise Before / After Future Vision -->
  <section class="future-strip lp-only-sec">
    <div class="future-box old">
      <h3>❌ Before: Manual Grind & Cheap API Bots</h3>
      <ul>
        <li>• Logging into X app/site manually &amp; risking chain-bans on your main account</li>
        <li>• Hours wasted every day pasting posts &amp; links by hand</li>
        <li>• Instant shadowbans from raw API calls or shared proxies</li>
        <li>• Duplicate image & text filters killing your reach in 2 hours</li>
        <li>• Zero traffic the moment you go to sleep</li>
        <li>• Expensive VPS servers, coding &amp; separate $15+ ISP proxy contracts required</li>
      </ul>
    </div>
    <div class="future-box new">
      <h3>✨ Your Future: 100% Hands-Free Autonomy</h3>
      <ul>
        <li>• <b>Never Log Into X Yourself:</b> No need to open the X app or log in—100% isolated from your personal device &amp; main account</li>
        <li>• <b>Real Cloud Browser:</b> Types &amp; scrolls like a real human 24/7</li>
        <li>• <b>Anti-Spam Camouflage:</b> Auto-mutates text & image pixels every post</li>
        <li>• <b>0-Second Failover:</b> Swaps shadowbanned accounts automatically</li>
        <li>• <b>No Server, No Coding, No Proxy Needed:</b> 100% All-in-One Turnkey Cloud</li>
        <li>• <b>Zero Server, Code, or Proxy Setup:</b> No VPS, no programming, and no separate proxy subscriptions needed—100% all-in-one cloud</li>
        <li>• <b>Test 1st Post 100% FREE:</b> Then unlock 24h autopilot for just $7 only</li>
      </ul>
    </div>
  </section>

  <!-- ========================================================================
       CLEARLY FRAMED VERTICAL STUDIO (STEP 1 -> STEP 5)
       ======================================================================== -->
  
  <!-- Shown on /lp: Prominent Mid-Page CTA Transitioning to Dedicated /studio Page -->
  <div id="lp-mid-cta-banner" class="cta-banner-strip">
    <div class="cta-banner-inner">
      <span class="free-pill-large">🎁 100% FREE LIVE POST STUDIO — FOR NEW TESTERS &amp; MEMBERS</span>
      <h2 style="font-size:clamp(24px,3.5vw,34px);font-weight:900;color:#0f172a;margin-bottom:10px;">
        Ready to See Your Post Go Live on X in 60 Seconds?
      </h2>
      <p style="font-size:15.5px;color:#334155;max-width:680px;margin:0 auto 24px;font-weight:500;">
        <b>Don't have a burner account on hand? No problem!</b> We pre-loaded our own shadowban-cleared X account (<code>@LauraLcbc</code>) inside the Post Studio. Customize the post however you like, click <b>Post Now</b>, and watch our real cloud browser publish your exact setup live on X.com in 15 seconds—100% FREE!
      </p>
      <a href="/studio" class="btn-free-post-now" style="text-decoration:none;max-width:520px;">
        🚀 Open Free Live Post Studio Now →
      </a>
      <div style="font-size:13px;color:#047857;font-weight:800;margin-top:12px;">
        ✓ Real-time @username verification &nbsp;|&nbsp; ✓ No X app login needed &nbsp;|&nbsp; ✓ 1st Live Post $0 Free
      </div>
    </div>
  </div>

  <!-- Shown on /studio: Clean Back-to-LP Navigation Header -->
  <div id="studio-top-nav-banner" style="display:none;max-width:900px;margin:24px auto 12px;padding:0 20px;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#f8fafc;border:2px solid #cbd5e1;border-radius:14px;padding:12px 18px;">
      <a href="/lp" style="color:#0284c7;font-weight:800;font-size:13.5px;text-decoration:none;">
        ← Back to X-Swarm Cloud Overview &amp; Technology Page
      </a>
      <span style="font-size:12.5px;font-weight:800;color:#059669;">
        ⚡ Dedicated Post Studio (For Free Live Test &amp; Active Members)
      </span>
    </div>
  </div>

  <section class="studio-section" id="studio">
    <div class="studio-outer-frame">
      <div class="studio-header">
        <span class="free-badge-pill">⚡ STEP-BY-STEP WEB LAUNCH STUDIO (NO TELEGRAM REQUIRED)</span>
        <h2>Configure & Publish Your 1st Live Post (100% FREE)</h2>
        <p>Complete STEP 1 to STEP 4 from top to bottom, then click the green FREE Post button in STEP 5.</p>
        <div class="studio-progress-wrap">
          <div id="studio-progress-text" style="font-size:13px;color:#0f172a;">👋 <b>Step-by-Step Setup:</b> Start by pasting your account info in STEP 1 below.</div>
          <div class="studio-progress-bar"><div id="studio-progress-fill" class="studio-progress-fill"></div></div>
        </div>
      </div>

      <div class="steps-stack">
                <!-- CONFIDENCE SHOWCASE: Test-Drive on OUR Pre-Loaded Account Diagram -->
        <div class="testdrive-hero-box">
          <div class="testdrive-quote-badge">🎁 ZERO-RISK LIVE SANDBOX — NO ACCOUNT OR LOGIN REQUIRED TO TEST</div>
          <h3 style="font-size:clamp(19px,2.5vw,24px);font-weight:900;color:#ffffff;margin-bottom:6px;letter-spacing:-0.3px;">
            Don't Take Our Word For It — Command Our Live X Account Right Now!
          </h3>
          <p style="font-size:13.8px;color:#cbd5e1;line-height:1.55;">
            Experience how X-Swarm Cloud operates in the real world using <b>our pre-loaded, shadowban-cleared X account (<code>@LauraLcbc</code>)</b>. Customize any post or AI angle below, hit the green launch button, and watch our cloud browser type and publish your setup live on X.com in 15 seconds!
          </p>
          <div class="testdrive-flow-grid">
            <div class="testdrive-flow-card">
              <div class="testdrive-flow-step">STEP A • PRE-LOADED FOR YOU</div>
              <div class="testdrive-flow-title">🔒 Protected Demo Burner</div>
              <div class="testdrive-flow-desc">We pre-loaded <b>@LauraLcbc</b> (masked token) in STEP 1 so you can test immediately without touching your own X account.</div>
            </div>
            <div class="testdrive-flow-card">
              <div class="testdrive-flow-step">STEP B • YOUR CUSTOMIZATION</div>
              <div class="testdrive-flow-title">✍️ Pick Any Text or AI Angle</div>
              <div class="testdrive-flow-desc">Use our pre-loaded promo post, tap a 1-Click Niche Preset, or let AI craft 3 Spintax angles with our 3D diagram image.</div>
            </div>
            <div class="testdrive-flow-card">
              <div class="testdrive-flow-step">STEP C • REAL-TIME PROOF</div>
              <div class="testdrive-flow-title">🖥️ Watch Live &amp; Verify on X</div>
              <div class="testdrive-flow-desc">Click <b>Post Now</b> in STEP 5 to watch the live cloud execution stream and verify your published post directly on X.com!</div>
            </div>
          </div>
          <div class="confidence-guarantee-strip">
            💡 <b>Why do we let visitors control our own live X account for free?</b> Because we have 100% confidence in our 5-Layer Real-Browser &amp; Sub-Pixel Camouflage Engine. Test-drive it on <b>our</b> account first—then plug in your own tokens when you are amazed.
          </div>
        </div>

        <!-- STEP 1: AUTH_TOKEN -->
        <div class="step-card" id="step-card-1">
          <div class="step-title-row">
            <span class="step-num-badge">STEP 1</span>
            <span class="step-heading">Register Your X Account (auth_token or Full Shop Line)</span>
            <button type="button" class="btn-help-pop" onclick="openTokenHelpModal()">❓ Paste Full Shop Info? (AI Auto-Extract)</button>
            <span id="token-detect-badge" class="token-live-badge">Waiting for token...</span>
          </div>
          <div class="step-subtext">
            Paste your 40-character <code>auth_token</code> <b>OR</b> simply paste the <b>entire account line you bought from a shop</b> (e.g. <code>ID:PASS:EMAIL:TOKEN</code>). Our AI parser automatically extracts the <code>auth_token</code>—<b>you never even have to open or log into the X app/website yourself!</b>
          </div>
          <textarea id="inp-tokens" class="framed-textarea" placeholder="Paste your 40-char auth_token OR full shop account lines here...&#10;Example: user01:pass123:mail@test.com:4e6d35011aa6d0cbfbbe13504d9e823a5cc4dda4"></textarea>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:10px;">
            <button type="button" class="btn-confirm-step" id="btn-verify-token" onclick="verifyAndSaveTokens()">
              ⚡ Verify Token &amp; Save Account (Auto-Fetch @username)
            </button>
            <button type="button" class="btn-help-pop" onclick="openTokenHelpModal()">
              ❓ How does AI Auto-Extraction work &amp; where to buy accounts?
            </button>
            <button type="button" onclick="loadDemoSandboxMode()" style="background:#ecfdf5;color:#047857;border:2px solid #10b981;padding:9px 14px;border-radius:10px;font-size:12.5px;font-weight:900;cursor:pointer;">🧪 No token on hand? Try 1-Click Demo Account</button>
          </div>
          <!-- Saved & Verified Accounts List with [✕] Delete Button -->
          <div id="saved-accounts-list" class="saved-items-container"></div>
        </div>

        <!-- STEP 2: BIO -->
        <div class="step-card" id="step-card-2">
          <div class="step-title-row">
            <span class="step-num-badge">STEP 2</span>
            <span class="step-heading">Write &amp; Save Your Profile BIO</span>
          </div>
          <div class="step-subtext">
            Enter the bio text and link you want automatically saved to your X profile. (Leave blank to keep your current bio unchanged.)
          </div>
          <input type="text" id="inp-bio" class="framed-input" maxlength="160" placeholder="Example: ⚡ Daily alpha &amp; instant access 👉 https://your-link.com" />
          <div>
            <button type="button" class="btn-confirm-step" id="btn-save-bio" onclick="confirmAndSaveBio()">
              💾 Confirm &amp; Save Profile BIO
            </button>
          </div>
          <!-- Saved BIO Chip with [✕] Delete Button -->
          <div id="saved-bio-list" class="saved-items-container"></div>
          
        </div>

        <!-- STEP 3: POST TEXT + 3-ANGLE AI + IMAGE UPLOAD -->
        <div class="step-card" id="step-card-3">
          <div class="step-title-row">
            <span class="step-num-badge">STEP 3</span>
            <span class="step-heading">Write Your Post Text (with AI 3-Angle Generator & Image Camouflage)</span>
          </div>
          <div class="step-subtext">
            Write the message you want to stream. You can use <code>{optionA|optionB}</code> Spintax so every post is processed as a unique message, or click the AI button below to generate 3 high-converting angles!
          </div>
                    <div style="margin-bottom:10px;">
            <div style="font-size:12px;font-weight:800;color:#475569;margin-bottom:6px;">⚡ 1-Click High-Converting Spintax Templates (Tap to load):</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              <button type="button" onclick="applyNichePreset('crypto')" style="background:#f0f9ff;color:#0369a1;border:1.5px solid #7dd3fc;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">🪙 Crypto / Alpha</button>
              <button type="button" onclick="applyNichePreset('ofm')" style="background:#fdf2f8;color:#be185d;border:1.5px solid #f9a8d4;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">💋 OFM / Creator</button>
              <button type="button" onclick="applyNichePreset('adult_jp')" style="background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">🌙 JP Adult / アダアフィ</button>
              <button type="button" onclick="applyNichePreset('affiliate')" style="background:#ecfdf5;color:#047857;border:1.5px solid #6ee7b7;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">💰 Affiliate / SaaS</button>
              <button type="button" onclick="applyNichePreset('giveaway')" style="background:#fffbeb;color:#b45309;border:1.5px solid #fcd34d;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">🎁 Lead Magnet</button>
            </div>
          </div>
          <textarea id="inp-posts" class="framed-textarea" style="min-height:110px;" placeholder="Write your post text here, or click the AI button below to generate 3 high-converting variations..."></textarea>
          <div>
            <div id="post-smart-meter" style="display:none;flex-wrap:wrap;gap:8px;font-size:12px;font-weight:800;background:#f8fafc;border:1.5px solid #cbd5e1;padding:8px 12px;border-radius:10px;margin-top:8px;"></div>
          <button type="button" class="btn-confirm-step" id="btn-save-post" onclick="confirmAndSavePost()">
              💾 Confirm &amp; Save Post to Queue
            </button>
          </div>
          <!-- Saved Posts Queue with [✕] Delete Buttons -->
          <div id="saved-posts-list" class="saved-items-container"></div>
          

          <!-- AI 3-Angle Suggestion Box -->
          <div class="ai-toolbar">
            <div style="font-size:13.5px;font-weight:800;color:#0369a1;margin-bottom:8px;">
              🤖 Want AI to write 3 high-converting posts from different marketing angles?
            </div>
            <div class="ai-input-row">
              <input type="text" id="inp-ai-topic" class="framed-input" style="flex:1;min-width:220px;background:#ffffff;padding:10px 14px;" placeholder="Enter what you want to promote (e.g., Crypto group, Affiliate link, Side hustle)..." />
              <button type="button" class="btn-ai-trigger" id="btn-ai-gen" onclick="generateThreeAnglesWithAi()">
                ✨ Generate 3 Angles with AI (Free)
              </button>
            </div>

            <!-- Expanded 3-Angle Result Cards -->
            <div class="ai-suggestions-panel" id="ai-suggestions-panel">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <strong style="font-size:13.5px;color:#0f172a;">👇 AI Generated 3 Distinct Angles (Click to load into your post box):</strong>
                <button type="button" class="btn-use-angle" style="background:#0284c7;" onclick="useAllThreeAiAngles()">⚡ Load All 3 Angles (Auto-Rotate)</button>
              </div>
              <div class="ai-angle-grid" id="ai-angle-grid"></div>
            </div>
          </div>

          <!-- Image Upload with Sub-Pixel Camouflage -->
          <div class="image-upload-zone">
            <div>
              <div style="font-size:14px;font-weight:800;color:var(--text-primary);">
                📸 Optional: Attach Promo Image (Auto Pixel-Camouflage Enabled)
              </div>
              <div style="font-size:12.5px;color:var(--text-muted);">
                Even if you repeat the same image, our engine automatically applies sub-pixel camouflage on every post to bypass X duplicate image detection.
              </div>
              <div class="img-preview-wrap" id="img-preview-wrap">
                <img id="img-preview-thumb" class="img-preview-thumb" src="" alt="Preview" />
                <div>
                  <div id="img-file-name" style="font-size:13px;font-weight:800;color:#059669;">Image Ready</div>
                  <button type="button" onclick="clearUploadedImage()" style="background:none;border:none;color:#dc2626;font-size:12px;font-weight:800;cursor:pointer;text-decoration:underline;">✕ Remove Saved Image</button>
                </div>
              </div>
            </div>
            <div>
              <input type="file" id="inp-image-file" accept="image/*" style="display:none;" onchange="handleImageFileSelect(this)" />
              <button type="button" class="btn-secondary-light" style="padding:10px 18px;font-size:13.5px;" onclick="document.getElementById('inp-image-file').click()">
                📁 Select Image File...
              </button>
            </div>
          </div>
        </div>

        <!-- STEP 4: INTERVAL & GEO-LOCKED DEDICATED ISP PROXY -->
        <div class="step-card" id="step-card-4">
          <div class="step-title-row">
            <span class="step-num-badge">STEP 4</span>
            <span class="step-heading">Set Posting Interval &amp; Geo-Locked Proxy Security</span>
          </div>
          <div class="step-subtext">
            Select your posting interval below. For account safety, your Dedicated Static ISP Proxy is geo-locked to prevent X's "Impossible Travel" ban filter.
          </div>

          <input type="hidden" id="inp-interval" value="15" />
          <input type="hidden" id="inp-country" value="US" />

          <div style="font-size:13.5px;font-weight:900;color:var(--text-primary);margin-bottom:10px;">
            ⏱️ 1. Select Posting Interval (±20% natural human jitter applied automatically):
          </div>
          <div class="interval-grid">
            <button type="button" class="interval-card-btn" data-int="5" onclick="selectIntervalCard('5')">
              <strong>⚡ Every 5m</strong>
              <span>High-Speed Stream</span>
            </button>
            <button type="button" class="interval-card-btn" data-int="10" onclick="selectIntervalCard('10')">
              <strong>🔥 Every 10m</strong>
              <span>Fast Growth</span>
            </button>
            <button type="button" class="interval-card-btn active" data-int="15" onclick="selectIntervalCard('15')">
              <strong>🟢 Every 15m ✓</strong>
              <span>Recommended Balance</span>
            </button>
            <button type="button" class="interval-card-btn" data-int="30" onclick="selectIntervalCard('30')">
              <strong>🛡️ Every 30m</strong>
              <span>Long-Life Safe Mode</span>
            </button>
            <button type="button" class="interval-card-btn" data-int="60" onclick="selectIntervalCard('60')">
              <strong>🕒 Every 60m</strong>
              <span>1 Post / Hour</span>
            </button>
            <button type="button" class="interval-card-btn" data-int="1" onclick="selectIntervalCard('1')">
              <strong>👑 Every 1m</strong>
              <span>Turbo Mode (30d)</span>
            </button>
          </div>

          <div id="interval-volume-estimator" style="background:#f0f9ff;border:1.5px solid #7dd3fc;color:#0369a1;padding:10px 14px;border-radius:12px;font-size:12.5px;margin-bottom:18px;line-height:1.5;"></div>
          <div style="font-size:13.5px;font-weight:900;color:var(--text-primary);margin-bottom:8px;">
            🌍 2. Your Assigned Dedicated Static ISP Proxy (Geo-Locked for X Security):
          </div>

          <!-- Active Locked Proxy Status Box -->
          <div class="proxy-locked-box">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
              <div>
                <div style="font-size:11.5px;font-weight:900;color:#059669;letter-spacing:0.4px;">🔒 GEO-LOCKED ANTI-BAN PROTECTION ACTIVE</div>
                <div id="active-proxy-country-text" style="font-size:17px;color:#0f172a;margin-top:3px;">
                  🇺🇸 <b>Your Proxy is: UNITED STATES</b> <span style="font-size:12.5px;color:#047857;font-weight:700;">(Synced Timezone: America/New_York)</span>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" onclick="toggleLockedCountriesDrawer()" style="background:#ffffff;color:#0f172a;border:2px solid #0f172a;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">
                  🌍 View / Switch Countries ▼
                </button>
                <button type="button" onclick="openAddonIspModal()" style="background:#0f172a;color:#ffffff;border:none;padding:9px 15px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">
                  ➕ Add New ISP ($5)
                </button>
              </div>
            </div>
            <div style="font-size:12px;color:#334155;margin-top:8px;line-height:1.5;background:rgba(255,255,255,0.75);padding:8px 12px;border-radius:10px;border:1px solid #a7f3d0;">
              🛡️ <b>Why can't I switch countries on every post?</b> Logging into the same X account from different countries (e.g. USA ➔ UK ➔ Japan) triggers X's "Impossible Travel" security lock. Your primary ISP country is chosen when you activate a plan and stays locked to protect your accounts. Need a different country IP? Unlock an additional Dedicated Static ISP below for <b>$5</b>.
            </div>
          </div>

          <!-- Grayed-out Locked Countries Grid (Click Locked Country -> Opens $5 Add-On Modal) -->
          <div id="locked-countries-drawer" style="display:none;margin-top:12px;padding-top:10px;border-top:1px dashed #cbd5e1;">
            <div style="font-size:12px;font-weight:800;color:#64748b;margin-bottom:8px;">
              👇 Global Static ISP Nodes (Unpurchased regions are grayed out 🔒 — tap any locked country to unlock for $5):
            </div>
            <div id="isp-country-lock-grid" class="isp-country-grid"></div>
          </div>

          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:var(--text-secondary);margin-top:16px;cursor:pointer;">
            <input type="checkbox" id="inp-self-reply" checked style="width:18px;height:18px;" onchange="renderSavedScheduleChip()" />
            <span>🔗 Enable Anti-Shadowban Self-Reply Mode (Publishes main post without URL, then auto-replies with your link in 3s)</span>
          </label>
          <div id="saved-schedule-list" class="saved-items-container"></div>
        </div>

        <!-- STEP 5: 100% FREE POST NOW BUTTON -->
        <div class="step-free-launch-card">
          <div class="free-pill-large">🎁 STEP 5 — 100% FREE LIVE POST TEST (ZERO COST TO PUBLISH NOW)</div>
          <h3 style="font-size:23px;font-weight:900;color:var(--text-primary);margin-bottom:8px;">
            Publish Your First Post Live on X Right Now — Completely FREE!
          </h3>
          <p style="font-size:14.5px;color:var(--text-muted);max-width:640px;margin:0 auto 18px;font-weight:500;">
            No server, no coding, and no proxy setup needed. Click the button below to launch our real cloud browser and publish your post live on X for <b>$0 (100% Free)</b>!
          </p>

          <!-- 投稿ボタン直上の『その調子です！ / まだやることがあります！』動的ガイドバナー -->
          <div id="pre-launch-guide-banner" class="pre-launch-banner todo"></div>

                    <!-- Clean English Live Cloud Execution Telemetry View -->
          <div id="live-execution-telemetry-view" class="live-telemetry-card">
            <div class="live-telemetry-header">
              <div style="display:flex;align-items:center;gap:8px;">
                <span id="live-telemetry-status-pill" style="background:#ecfdf5;color:#047857;border:1.5px solid #10b981;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:900;">🟢 EXECUTING LIVE ON CLOUD NODE</span>
                <strong style="font-size:13.5px;color:#0f172a;">Real-Time Cloud Browser Execution Stream</strong>
              </div>
              <span style="font-size:12px;font-weight:900;color:#0284c7;background:#f0f9ff;padding:3px 10px;border-radius:999px;border:1px solid #bae6fd;">⏱️ Elapsed: <span id="live-telemetry-elapsed">0.0s</span></span>
            </div>
            <div style="width:100%;height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-bottom:12px;">
              <div id="live-telemetry-progress-fill" style="width:8%;height:100%;background:linear-gradient(90deg,#10b981,#0284c7);transition:width 0.4s ease;"></div>
            </div>
            <div class="live-pills-row">
              <div id="live-pill-1" class="live-step-pill">1. Cloud Browser</div>
              <div id="live-pill-2" class="live-step-pill">2. Static ISP Sync</div>
              <div id="live-pill-3" class="live-step-pill">3. Token Inject</div>
              <div id="live-pill-4" class="live-step-pill">4. Pixel Camo</div>
              <div id="live-pill-5" class="live-step-pill">5. Live X Publish</div>
            </div>
            <div id="live-telemetry-log-stream" class="live-log-stream"></div>
          </div>
          <div id="studio-error-msg" style="color:var(--danger);font-size:14.5px;font-weight:800;margin-bottom:14px;display:none;"></div>
          <button type="button" class="btn-free-post-now" id="btn-submit-launch" onclick="submitAndExecuteLivePost()">
            🚀 Post Now — 100% FREE Live Test Post on X →
          </button>
          <div style="font-size:12.5px;color:var(--text-muted);margin-top:12px;font-weight:600;">
            ✓ Instant real-browser execution &nbsp;|&nbsp; ✓ No payment required for this live test &nbsp;|&nbsp; ✓ Zero hidden fees
          </div>
          <div style="margin-top:18px;padding-top:14px;border-top:1px dashed #cbd5e1;">
            <a href="#technology" style="color:#0284c7;font-weight:800;font-size:13.5px;text-decoration:none;">
              👇 Scroll down to see how our 5-Layer Real-Browser Engine defeats X spam filters
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ========================================================================
       DEEP TECHNICAL ARCHITECTURE SECTION (WELL BELOW THE POST BUTTON)
       ======================================================================== -->
  <section class="tech-showcase-wrapper lp-only-sec" id="technology">
    <div class="tech-container">
      <div class="tech-header">
        <span class="free-badge-pill">🔬 NEXT-GEN AUTONOMOUS ENGINEERING</span>
        <h2>Why This Program Outperforms Manual Work & Ordinary Bots</h2>
        <p>
          Cheap bots get banned because they blast raw API requests with identical data. X-Swarm Cloud operates a full headless browser infrastructure with built-in anti-spam camouflage—100% hands-free.
        </p>
      </div>

      <!-- Visual End-to-End Pipeline Diagram -->
            <!-- Modern 5-Layer Autonomous Visual Infographics -->
      <div class="tech-diagram-board" style="border: 3px solid var(--obsidian); border-radius: 24px; overflow: hidden; padding: 0; margin-bottom: 48px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12);">
        <div style="padding: 16px; background: #ffffff; text-align: center;">
          <img id="arch-main-img" src="/uploads/xswarm_architecture.png?v=1794070033373" alt="X-Swarm Cloud 5-Layer Autonomous Infrastructure" style="max-width: 100%; height: auto; border-radius: 14px; display: block; margin: 0 auto;" />
        </div>
        <div style="background: #0f172a; color: #ffffff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div style="font-size: 13.5px; font-weight: 700; color: #cbd5e1;">
            ⚡ Every cycle executes inside a real cloud browser with dynamic Spintax &amp; sub-pixel camouflage.
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <label id="admin-img-replace-btn" style="display:none;background:#334155;color:#fff;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">
              🖼️ Replace Diagram Image (gazou.webp)
              <input type="file" accept="image/*" style="display:none;" onchange="uploadCustomArchDiagram(this)" />
            </label>
            <a href="/studio" style="background:#10b981;color:#ffffff;padding:9px 20px;border-radius:999px;font-size:13px;font-weight:900;text-decoration:none;">
              🚀 Test It Free in STEP 1–5 Above ↑
            </a>
          </div>
        </div>
      </div>

      <div class="tech-cards-grid">
        <!-- Tech 1: Real Browser vs API -->
        <div class="tech-card">
          <span class="tech-card-tag">01 // REAL BROWSER EXECUTION</span>
          <h3>Real Cloud Browser — Not Simple API Calls</h3>
          <p>
            Ordinary tools send raw HTTP/API requests that X's security filters flag immediately. Our engine launches an actual browser in the cloud, emulates real device fingerprints, and types your post character-by-character with natural human rhythm.
          </p>
          <div class="tech-mini-diagram">
            ❌ Cheap Bot: Raw API POST ➔ Instant Ban<br/>
            ✅ X-Swarm: Real Browser + Human Typing ➔ Safe Reach
          </div>
        </div>

        <!-- Tech 2: Dynamic Text Processing -->
        <div class="tech-card">
          <span class="tech-card-tag">02 // ANTI-SPAM TEXT ENGINE</span>
          <h3>Same Message, Processed as Brand-New Text</h3>
          <p>
            Even when promoting the same offer 24/7, our Spintax & dynamic text engine reconstructs phrase combinations and randomized intervals on every cycle. X's duplicate-text filter treats each post as a newly written organic tweet.
          </p>
          <div class="tech-mini-diagram">
            Input: {Update|Alert} + Offer<br/>
            ➔ Post #1:Unique Hash A | Post #2:Unique Hash B
          </div>
        </div>

        <!-- Tech 3: Image Pixel Camouflage -->
        <div class="tech-card">
          <span class="tech-card-tag">03 // SUB-PIXEL IMAGE CAMOUFLAGE</span>
          <h3>Repeat the Same Image Without Spam Flags</h3>
          <p>
            Posting the exact same image file repeatedly triggers X's perceptual hash (pHash) spam filter. Our engine automatically injects invisible sub-pixel brightness & hash camouflage on every upload—visually identical to humans, completely new to X.
          </p>
          <div class="tech-mini-diagram">
            Original Image ➔ [Auto Pixel Modulation]<br/>
            ➔ New File Signature Every Single Post
          </div>
        </div>

        <!-- Tech 4: Outperforms Manual Work -->
        <div class="tech-card">
          <span class="tech-card-tag">04 // SUPERIOR TO MANUAL WORK</span>
          <h3>Smarter & Safer Than Doing It by Hand</h3>
          <p>
            Humans make mistakes—forgetting proxy switches, pasting external links directly in main posts (which kills reach), or posting at robotic intervals. The engine automatically separates links into 3-second self-replies and engages with niche tags first.
          </p>
          <div class="tech-mini-diagram">
            Main Post (No Link = Max Reach)<br/>
            └─ Auto-Reply in 3s (Your Promo Link)
          </div>
        </div>

        <!-- Tech 5: 100% Hands-Free & 0s Swap -->
        <div class="tech-card">
          <span class="tech-card-tag">05 // 100% HANDS-FREE FAILOVER</span>
          <h3>0-Second Auto-Swap When Shadowbanned</h3>
          <p>
            Every 3 posts, a completely separate observer account on an isolated IP searches X's "Latest" tab to verify your tweets are publicly visible. If Account #1 is shadowbanned, Account #2 takes over in 0 seconds while you sleep.
          </p>
          <div class="tech-mini-diagram">
            Account #1 Restricted ➔ [0s Instant Swap]<br/>
            ➔ Standby Account #2 Continues Nonstop
          </div>
        </div>

        <!-- Tech 6: Dedicated Static ISP + Timezone -->
        <div class="tech-card">
          <span class="tech-card-tag">06 // GEO-SYNCED INFRASTRUCTURE</span>
          <h3>Dedicated Static ISP + Auto Timezone Sync</h3>
          <p>
            Logging into an account from a US IP while your browser clock says Tokyo immediately raises red flags. X-Swarm Cloud locks a Dedicated Static Residential ISP IP and overrides the browser's timezone & locale to match 100%.
          </p>
          <div class="tech-mini-diagram">
            🇺🇸 US ISP IP ⇔ America/New_York Clock<br/>
            🇯🇵 JP ISP IP ⇔ Asia/Tokyo Clock
          </div>
        </div>
      </div>

      <!-- Bottom Transparent Pricing & Final CTA -->
      <div class="bottom-pricing-grid" style="margin-top:44px;">
        <div class="b-price-card">
          <span class="free-badge-pill" style="margin-bottom:10px;">🎁 STEP 0 // VERIFY FIRST</span>
          <h3 style="font-size:20px;font-weight:900;">1st Live Test Post</h3>
          <div style="font-size:32px;font-weight:900;margin:8px 0;color:#059669;">$0 <span style="font-size:14px;font-weight:600;color:#64748b;">/ 100% Free</span></div>
          <p style="font-size:13.5px;color:#475569;margin-bottom:16px;">
            Test our real cloud browser &amp; self-reply engine on your own X account right now before paying a cent.
          </p>
          <a href="/studio" class="btn-secondary-light" style="width:100%;justify-content:center;padding:12px;">↑ Try Free Live Post Now</a>
        </div>

        <div class="b-price-card featured">
          <span class="free-badge-pill" style="background:#dbeafe;color:#1d4ed8;border-color:#93c5fd;margin-bottom:10px;">🔥 MOST POPULAR START</span>
          <h3 style="font-size:20px;font-weight:900;">1-Day Full Autopilot</h3>
          <div style="font-size:32px;font-weight:900;margin:8px 0;color:#0f172a;">$7 <span style="font-size:14px;font-weight:600;color:#64748b;">Only / 24 Hours</span></div>
          <p style="font-size:13.5px;color:#475569;margin-bottom:16px;">
            24h nonstop auto-posting + Dedicated Static ISP (🇺🇸US / 🇯🇵JP) + 0s shadowban swap. <b>100% credited toward 30d plan!</b>
          </p>
          <a href="/studio" class="btn-primary-dark" style="width:100%;justify-content:center;padding:12px;">↑ Configure &amp; Start $7 Trial</a>
        </div>

        <div class="b-price-card">
          <span class="free-badge-pill" style="background:#f1f5f9;color:#334155;border-color:#cbd5e1;margin-bottom:10px;">👑 30-DAY MONTHLY</span>
          <h3 style="font-size:20px;font-weight:900;">Solo Starter / Agency</h3>
          <div style="font-size:32px;font-weight:900;margin:8px 0;color:#0284c7;">$79 <span style="font-size:14px;font-weight:600;color:#64748b;">/ 30d ($72 after Trial)</span></div>
          <p style="font-size:13.5px;color:#475569;margin-bottom:16px;">
            10 to 100 burner slots + Choose from 10 Global ISP Countries + 1-minute turbo custom intervals.
          </p>
          <a href="/studio" class="btn-secondary-light" style="width:100%;justify-content:center;padding:12px;">↑ Launch 30-Day Setup</a>
        </div>
      </div>
      <!-- FAQ Section for High-Converting Objection Handling -->
      <div style="max-width:860px;margin:52px auto 0;text-align:left;">
        <h3 style="font-size:24px;font-weight:900;text-align:center;margin-bottom:20px;color:#0f172a;">Frequently Asked Questions</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <details style="background:#ffffff;border:2px solid #cbd5e1;border-radius:14px;padding:14px 18px;">
            <summary style="font-weight:900;font-size:15px;cursor:pointer;color:#0f172a;">❓ How can X-Swarm Cloud post without my X password or app login?</summary>
            <p style="font-size:13.5px;color:#475569;margin-top:8px;line-height:1.6;">When you buy a burner account or log in on a PC, X issues a 40-character hexadecimal session cookie called <code>auth_token</code>. Our isolated cloud Chromium browser injects that token directly—meaning you never type your password, never trigger 2FA login codes, and keep your personal phone 100% isolated from burner accounts.</p>
          </details>
          <details style="background:#ffffff;border:2px solid #cbd5e1;border-radius:14px;padding:14px 18px;">
            <summary style="font-weight:900;font-size:15px;cursor:pointer;color:#0f172a;">❓ What happens if an account gets shadowbanned?</summary>
            <p style="font-size:13.5px;color:#475569;margin-top:8px;line-height:1.6;">Every 3 posts, a separate observer account on an isolated IP searches X's "Latest" tab to verify your posts are publicly visible. If X restricts Account #1, our engine automatically pauses it and promotes Standby Account #2 in 0 seconds while you sleep.</p>
          </details>
          <details style="background:#ffffff;border:2px solid #cbd5e1;border-radius:14px;padding:14px 18px;">
            <summary style="font-weight:900;font-size:15px;cursor:pointer;color:#0f172a;">❓ Is the $7 1-Day Trial really credited toward the 30-Day Plan?</summary>
            <p style="font-size:13.5px;color:#475569;margin-top:8px;line-height:1.6;">Yes! Your 1st single live test post is $0 (100% free). When you unlock the $7 24-Hour Full Autopilot, that $7 is automatically deducted if you upgrade to the 30-Day Starter ($79 ➔ $72) or Pro plan.</p>
          </details>
        </div>
      </div>
    </div>
  </section>

  <!-- X-Style Popup Modal: Verify Free Live Post + "Just $7 Only" 1-Day Trial Selector -->
  <div class="modal-overlay" id="x-launch-modal">
    <div class="x-modal">
      <button class="x-modal-close" onclick="closeXModal()">✕</button>

      <!-- Live Verification Banner -->
      <div class="verify-banner" id="verify-banner-box">
        <h4 id="verify-title">🎉 Your Free Live Post Has Been Published on X!</h4>
        <p id="verify-sub">Would you like to check X.com right now to verify that your post is live?</p>
        <a id="verify-x-link" href="https://x.com" target="_blank" class="btn-verify-x">
          🔎 Verify My Live Post on X.com ↗
        </a>
      </div>

      <!-- X-Style Upsell Header -->
      <div style="text-align:center;margin-bottom:14px;">
        <span class="free-badge-pill" style="margin-bottom:6px;">⚡ KEEP AUTO-POSTING 24/7 NONSTOP</span>
        <h3 style="font-size:22px;font-weight:900;letter-spacing:-0.5px;">
          Auto-Post 24 Hours — Just $7 Only
        </h3>
        <p style="font-size:13.5px;color:var(--text-muted);margin-top:4px;font-weight:500;">
          Want our real-browser cloud to keep publishing your posts & camouflaged images every <b id="lbl-chosen-int">15</b> minutes automatically while you sleep?
        </p>
      </div>

      <!-- Plan Selector Cards -->
      <div class="x-plan-cards">
        <div class="x-plan-card active" id="card-oneday" onclick="selectXPlan('oneday', 7)">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <strong style="font-size:16px;">🔥 1-Day Full Auto-Posting</strong>
              <span style="background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:900;padding:3px 9px;border-radius:999px;">JUST $7 ONLY</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;font-weight:500;">
              24h Nonstop Auto-Posting + Dedicated Static ISP (🇺🇸US / 🇯🇵JP) + 0s Burner Swap
            </div>
          </div>
          <div class="x-plan-price">
            $7<span>Only / 24h</span>
          </div>
        </div>

        <div class="x-plan-card" id="card-starter" onclick="selectXPlan('starter', 79)">
          <div>
            <strong style="font-size:16px;">🚀 Solo Starter (30 Days)</strong>
            <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;font-weight:500;">
              10 Burner Slots + Choose Any of 10 Global ISP Countries + 1-Min Custom Interval
            </div>
          </div>
          <div class="x-plan-price">
            $79<span>/ 30 Days</span>
          </div>
        </div>

        <div class="x-plan-card" id="card-pro" onclick="selectXPlan('pro', 179)">
          <div>
            <strong style="font-size:16px;">👑 Agency Pro (30 Days · 3x Streams)</strong>
            <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;font-weight:500;">
              3 Simultaneous Active Streams + 30 Burner Slots + 3 Dedicated Static ISPs
            </div>
          </div>
          <div class="x-plan-price">
            $179<span>/ 30 Days</span>
          </div>
        </div>
      </div>

            <div style="background:#f0f9ff;border:2px solid #7dd3fc;border-radius:14px;padding:12px 14px;margin-bottom:16px;text-align:left;">
        <label style="display:block;font-size:12.5px;font-weight:900;color:#0369a1;margin-bottom:6px;">
          🌍 Choose Your Included Dedicated Static ISP Country for This Plan:
        </label>
        <select id="modal-plan-country" class="framed-select" style="padding:10px 12px;font-size:13.5px;background:#ffffff;">
          <option value="US" selected>🇺🇸 United States (America/New_York) — Included</option>
          <option value="JP">🇯🇵 Japan (Asia/Tokyo) — Included</option>
        </select>
        <div style="font-size:11.5px;color:#475569;margin-top:5px;">
          🔒 Your account will be geo-locked to this country's Static ISP &amp; Timezone for anti-ban safety ($7 1-Day includes US/JP; 30-Day Plans include all 10 countries).
        </div>
      </div>

      <div class="no-fee-pill">
        🛡️ <b>Zero Hidden Fees Guarantee:</b> The price shown includes your Dedicated Static ISP Proxy & Cloud Browser. No auto-recurring subscriptions. Plus, <b>100% of your $7 trial is deducted ($79 ➔ $72)</b> when you upgrade to a 30-Day Plan!
      </div>

      <div id="checkout-wait-box" style="display:none;margin-bottom:14px;padding:14px;border-radius:12px;background:#f0f9ff;border:2px solid #38bdf8;text-align:center;font-size:13px;"></div>

      <button type="button" class="btn-free-post-now" style="max-width:100%;font-size:17px;padding:16px 24px;background:var(--x-blue);border-color:var(--x-blue-dark);" id="btn-modal-pay" onclick="launchOxaPayCheckout()">
        ⚡ Start 24/7 Auto-Posting Now — Just $7 Only →
      </button>
    </div>
  </div>

  
  
  <!-- "?" Smart Auto-Extract & Burner Account Help Popup Modal -->
  <div class="modal-overlay" id="token-help-modal">
    <div class="x-modal" style="max-width: 540px;">
      <button class="x-modal-close" onclick="closeTokenHelpModal()">✕</button>
      <div style="text-align:center;margin-bottom:16px;">
        <span class="free-badge-pill" style="margin-bottom:8px;">🤖 AI SMART AUTO-DETECTION</span>
        <h3 style="font-size:21px;font-weight:900;">Just Paste Your Purchased Account Info As-Is!</h3>
        <p style="font-size:13.5px;color:#475569;margin-top:6px;">
          You do <b>not</b> need to log into the X app/website or cut out the token manually! Just copy &amp; paste the entire text block from your account shop—keeping your personal phone/PC 100% isolated from burner accounts.
        </p>
      </div>

      <div style="background:#f0fdf4;border:2px solid #34d399;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:13px;color:#065f46;">
        <b>⚡ Effortless Auto-Extraction Example:</b><br/>
        Even if you paste messy lines like:<br/>
        <code style="display:block;background:#fff;padding:8px;border-radius:8px;margin:6px 0;color:#0f172a;word-break:break-all;border:1px solid #cbd5e1;">
          login_id:MyPass99:mail@ inbox.com:ct0_8821:<b>4e6d35011aa6d0cbfbbe13504d9e823a5cc4dda4</b>
        </code>
        Our AI parser automatically finds and extracts only the 40-character hexadecimal <code>auth_token</code> in 0 seconds! You can also paste 10 accounts at once for automatic 0-second backup rotation.
      </div>

      <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:14px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:#334155;line-height:1.6;">
        <b>🛒 Where to buy disposable X accounts ($0.50–$1.20):</b><br/>
        • Global Shops: <b>AccsMarket.com</b>, <b>Z2U.com</b>, <b>Dark.shopping</b><br/>
        • Japan Shops: <b>GameClub (ゲームクラブ)</b>, <b>M&amp;A Club</b><br/>
        • Or get it from your own PC browser: Press <code>F12</code> on X.com ➔ <code>Application</code> ➔ <code>Cookies</code> ➔ copy the 40-char value of <code>auth_token</code>.
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" class="btn-primary-dark" style="width:100%;justify-content:center;padding:14px;" onclick="closeTokenHelpModal()">
          👍 Got It! Back to Setup
        </button>
      </div>
    </div>
  </div>

  <!-- Simple Email + Password Login / Sign-Up Modal (with 2x Password Confirmation) -->
  <div class="modal-overlay" id="auth-modal">
    <div class="x-modal" style="max-width: 460px;">
      <button class="x-modal-close" onclick="closeAuthModal()">✕</button>
      <div style="text-align:center;margin-bottom:14px;">
        <span class="free-badge-pill" style="margin-bottom:8px;">🔐 CLOUD MEMBER ACCOUNT</span>
        <h3 style="font-size:22px;font-weight:900;">Save Your Setup &amp; Plan</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-top:4px;">
          Create a free account or log in so your tokens, uploaded images, and active plan are automatically restored on any device.
        </p>
      </div>

      <div class="auth-tabs">
        <button type="button" id="tab-auth-signup" class="auth-tab-btn active" onclick="switchAuthTab('signup')">🆕 Sign Up (New)</button>
        <button type="button" id="tab-auth-login" class="auth-tab-btn" onclick="switchAuthTab('login')">🔑 Log In</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="display:block;font-size:13px;font-weight:800;color:var(--text-secondary);margin-bottom:6px;">📧 Email Address</label>
          <input type="email" id="auth-email" class="framed-input" placeholder="you@example.com" />
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:800;color:var(--text-secondary);margin-bottom:6px;">🔑 Password (4+ characters)</label>
          <input type="password" id="auth-password" class="framed-input" placeholder="••••••••" />
        </div>
        <div id="auth-confirm-wrap">
          <label style="display:block;font-size:13px;font-weight:800;color:var(--text-secondary);margin-bottom:6px;">🔒 Confirm Password (Enter twice to verify)</label>
          <input type="password" id="auth-password-confirm" class="framed-input" placeholder="•••••••• (Type same password again)" onkeydown="if(event.key==='Enter') submitWebAuth();" />
          <div id="pw-match-hint" style="display:none;font-size:12.5px;font-weight:800;margin-top:6px;"></div>
        </div>
        <div id="auth-error-msg" style="display:none;color:var(--danger);font-size:13.5px;font-weight:800;text-align:center;"></div>
        <button type="button" class="btn-primary-dark" id="btn-auth-submit" style="width:100%;justify-content:center;padding:15px;font-size:16px;" onclick="submitWebAuth()">
          ✨ Create Account &amp; Save Settings →
        </button>
        <div style="text-align:center;font-size:12px;color:#64748b;margin-top:4px;">Forgot password or need instant help? <a href="https://t.me/xswarm_cloud_2026_bot" target="_blank" style="color:#0284c7;font-weight:800;text-decoration:none;">Message Support Bot ↗</a></div>
      </div>
    </div>
  </div>

  
  <!-- $5 Dedicated Static ISP Country Add-On / Change Modal -->
  <div class="modal-overlay" id="addon-isp-modal">
    <div class="x-modal" style="max-width: 500px;">
      <button class="x-modal-close" onclick="closeAddonIspModal()">✕</button>
      <div style="text-align:center;margin-bottom:14px;">
        <span class="free-badge-pill" style="margin-bottom:8px;">🌍 DEDICATED STATIC ISP ADD-ON</span>
        <h3 style="font-size:21px;font-weight:900;">Unlock or Switch ISP Country ($5 Only)</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-top:4px;">
          For your account security, X-Swarm Cloud never routes your account through random free countries. Add a real <b>Dedicated Static Residential ISP IP</b> in your target country below.
        </p>
      </div>

      <div style="background:#f8fafc;border:2px solid #cbd5e1;border-radius:14px;padding:14px 16px;margin-bottom:16px;">
        <label style="display:block;font-size:12.5px;font-weight:900;color:#0f172a;margin-bottom:6px;">
          🌍 Select Dedicated ISP Country to Unlock ($5 One-Time Add-On):
        </label>
        <select id="addon-country-select" class="framed-select" onchange="onChangeAddonSelect(this.value)" style="background:#ffffff;font-size:14px;padding:11px 12px;"></select>
        <div style="font-size:12px;color:#047857;font-weight:700;margin-top:8px;">
          ✓ Provisions a dedicated static IP &amp; syncs browser clock to <span id="addon-target-country-label">🇯🇵 Japan</span>
        </div>
      </div>

      <div id="addon-wait-box" style="display:none;margin-bottom:14px;padding:12px;border-radius:12px;background:#f0f9ff;border:2px solid #38bdf8;text-align:center;font-size:12.5px;"></div>

      <button type="button" class="btn-free-post-now" id="btn-addon-pay" style="max-width:100%;font-size:15.5px;padding:15px 20px;" onclick="launchAddonIspCheckout()">
        💳 Unlock Dedicated ISP Now — $5 Only →
      </button>
    </div>
  </div>

  <div id="live-social-proof-toast" style="position:fixed;bottom:18px;left:18px;z-index:85;background:#0f172a;color:#ffffff;border:2px solid #10b981;padding:10px 16px;border-radius:14px;font-size:12.5px;font-weight:800;box-shadow:0 12px 30px rgba(15,23,42,0.25);max-width:340px;opacity:0;transform:translateY(12px);transition:all 0.35s ease;pointer-events:none;"></div>
  <footer>
    <div style="margin-bottom:14px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap;font-size:12px;font-weight:800;">
      <span style="background:#ecfdf5;color:#065f46;border:1.5px solid #34d399;padding:5px 12px;border-radius:999px;">🟢 All Cloud Browser Nodes Operational (99.98% Uptime)</span>
      <span style="background:#f8fafc;color:#334155;border:1.5px solid #cbd5e1;padding:5px 12px;border-radius:999px;">💎 Instant Crypto Checkout: USDT / USDC / BTC / ETH / SOL / TRX</span>
    </div>
    <div>
      <a href="/legal">Terms of Service & Disclaimer</a>
      <a href="/dashboard">Web Cloud Console</a>
      <a href="https://t.me/xswarm_cloud_2026_bot" target="_blank">Telegram Bot (@xswarm_cloud_2026_bot)</a>
    </div>
    <p style="margin-top:10px;">© 2026 X-Swarm Cloud Infrastructure. Built strictly for disposable burner accounts (auth_token).</p>
  </footer>

  <!-- Google Translate Full-Page Support -->
  <script>
    function googleTranslateElementInit() {
      new google.translate.TranslateElement({
        pageLanguage: 'en',
        includedLanguages: 'en,ja,zh-CN,zh-TW,ko,ru,es,fr,de,pt,tr,vi,ar',
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
      }, 'google_translate_element');
    }
  </script>
  <script src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>

  <script>window.REF_TAG = ${JSON.stringify(refParam)};</script>
  <script src="/lp-client.js?v=1794071410092"></script>

  <!-- Page Mode Controller: /lp shows Clean Marketing LP + CTA buttons; /studio shows Dedicated Post Studio -->
  <script>
    (function applyPageRoutingMode() {
      var p = window.location.pathname;
      var isStudioPage = (p === '/studio' || p === '/post');
      var studioSec = document.getElementById('studio');
      var lpOnlySections = document.querySelectorAll('.lp-only-sec');
      var studioBackBar = document.getElementById('studio-top-nav-banner');
      var lpMidCta = document.getElementById('lp-mid-cta-banner');

      if (isStudioPage) {
        if (studioSec) studioSec.style.display = 'block';
        if (studioBackBar) studioBackBar.style.display = 'block';
        if (lpMidCta) lpMidCta.style.display = 'none';
        for (var i = 0; i < lpOnlySections.length; i++) {
          lpOnlySections[i].style.display = 'none';
        }
        document.title = 'Post Studio — X-Swarm Cloud (Free Live Post & 24/7 Autopilot)';
      } else {
        if (studioSec) studioSec.style.display = 'none';
        if (studioBackBar) studioBackBar.style.display = 'none';
        if (lpMidCta) lpMidCta.style.display = 'block';
      }
    })();
  </script>

</body>
</html>`);
    } catch (e) {
      res.status(500).send('Landing Page Error: ' + e.message);
    }
  };

  app.get('/', (req, res, next) => {
    if (req.query && req.query.admin === '1') return next();
    const h = String(req.headers.host || '').toLowerCase();
    if (h.includes('appflowsystem.com') || h.includes('trycloudflare.com')) {
      return renderLandingPage(req, res);
    }
    return next();
  });
  app.get('/lp', renderLandingPage);
  app.get('/studio', renderLandingPage);
  app.get('/post', renderLandingPage);
  app.get('/welcome', renderLandingPage);

  // ==========================================================================
  // 7) Telegram SSO (/auth/tg) & White Luxury Web Console (/dashboard, /legal)
  // ==========================================================================
  app.get('/auth/tg', async (req, res) => {
    try {
      const uid = String(req.query.uid || '').trim();
      const ts = parseInt(req.query.ts || '0', 10);
      const sig = String(req.query.sig || '').trim();
      if (!uid || !ts || !sig) return res.redirect('/lp');

      const secret = (process.env.TELEGRAM_BOT_TOKEN || 'xswarm_tg_web_secret_2026').trim();
      const expectedSig = crypto.createHmac('sha256', secret).update(uid + ':' + ts).digest('hex').slice(0, 24);
      if (sig !== expectedSig) return res.status(403).send('Invalid signature.');

      const uRef = db.collection('saas_users').doc(uid);
      const uSnap = await uRef.get();
      if (!uSnap.exists) return res.redirect('/lp');

      const sessionToken = crypto.randomBytes(24).toString('hex');
      await uRef.update({ sessionToken, webVerifiedAt: new Date(), updatedAt: new Date() });

      const maxAge = 30 * 86400;
      res.setHeader('Set-Cookie', [
        `saas_uid=${encodeURIComponent(uid)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
        `saas_session=${encodeURIComponent(sessionToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
      ]);

      const target = req.query.to === 'legal' ? '/legal' : '/dashboard';
      return res.redirect(target + '?uid=' + encodeURIComponent(uid));
    } catch (e) {
      return res.redirect('/lp');
    }
  });

  app.get('/dashboard', async (req, res) => {
    try {
      const cookieHeader = String(req.headers.cookie || '');
      const mUid = cookieHeader.match(/(?:^|;\s*)saas_uid=([^;]+)/);
      const uid = String(req.query.uid || (mUid ? decodeURIComponent(mUid[1]) : '') || '').trim();
      if (!uid) return res.redirect('/lp#studio');

      const uSnap = await db.collection('saas_users').doc(uid).get();
      if (!uSnap.exists) return res.redirect('/lp#studio');
      const user = uSnap.data();
      const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', uid).get();
      const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', uid).get();

      const accRows = accSnap.docs.map((d, idx) => {
        const a = d.data();
        const uname = a.username ? ('@' + escapeHtml(a.username)) : ('Token: ' + escapeHtml(String(a.authToken || '').slice(0, 8)) + '...');
        const searchLink = a.username ? (typeof postedTweetUrl !== 'undefined' && postedTweetUrl ? postedTweetUrl : `https://x.com/${a.username}`) : 'https://x.com';
        return `<tr style="border-bottom:1px solid #cbd5e1;">
          <td style="padding:12px;">${idx + 1}</td>
          <td style="padding:12px;font-weight:800;"><a href="${searchLink}" target="_blank" style="color:#0284c7;text-decoration:none;">${uname} ↗</a></td>
          <td style="padding:12px;">${a.role === '最新' ? '🟢 Active / Standby' : escapeHtml(a.role || 'Ready')}</td>
          <td style="padding:12px;">🌍 ${escapeHtml(a.ispCountry || user.ispCountry || 'US')} (${escapeHtml(a.timezone || user.timezone || 'America/New_York')})</td>
          <td style="padding:12px;">${a.postCount || 0} posts</td>
        </tr>`;
      }).join('');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X-Swarm Cloud — Live Cloud Console</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; color: #0f172a; padding: 32px 20px; }
    .wrap { max-width: 980px; margin: 0 auto; background: #ffffff; border: 2px solid #0f172a; border-radius: 20px; padding: 32px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 22px 0; }
    .box { background: #f8fafc; border: 2px solid #cbd5e1; padding: 18px; border-radius: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th { text-align: left; padding: 12px; background: #e2e8f0; color: #0f172a; font-weight: 800; }
    .btn { display: inline-block; background: #0f172a; color: #ffffff; font-weight: 800; padding: 12px 22px; border-radius: 999px; text-decoration: none; margin-top: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h2>⚡ X-Swarm Cloud — Live Cloud Console</h2>
    <p style="color:#475569;font-size:13.5px;margin-top:4px;">Account ID: <code>${escapeHtml(user.userId)}</code> &nbsp;|&nbsp; Status: <strong style="color:${user.isEngineRunning ? '#059669' : '#dc2626'};">${user.isEngineRunning ? '🟢 Running 24/7 Autopilot' : '⏸️ Paused (Awaiting Plan Activation)'}</strong></p>
    <div class="grid">
      <div class="box"><strong>📦 Active Plan</strong><div style="margin-top:6px;color:#0f172a;font-weight:900;">${escapeHtml(user.planName || 'Free Live Test Tier')}</div></div>
      <div class="box"><strong>🌍 Country & Timezone</strong><div style="margin-top:6px;">${escapeHtml(user.ispCountry || 'US')} (${escapeHtml(user.timezone || 'America/New_York')})</div></div>
      <div class="box"><strong>⏱️ Post Interval</strong><div style="margin-top:6px;">Every ${user.postIntervalMin || 15} mins (±20% jitter)</div></div>
      <div class="box"><strong>📝 Saved Templates</strong><div style="margin-top:6px;">${postSnap.size} Post Templates (Camouflage Active)</div></div>
    </div>
    <h3>📊 Connected Burner Accounts & 0s Failover Queue (${accSnap.size})</h3>
    <table>
      <thead><tr><th>#</th><th>X Account (Click to Verify on X)</th><th>Status</th><th>Region / Timezone</th><th>Total Posts</th></tr></thead>
      <tbody>${accRows || '<tr><td colspan="5" style="padding:16px;color:#64748b;">No burner accounts added yet.</td></tr>'}</tbody>
    </table>
    <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
      <a href="/studio" class="btn">🛠️ Open Post Studio (Edit Tokens / Posts / Image)</a>
      <button type="button" id="btn-dash-toggle" onclick="toggleEngineFromDashboard()" class="btn" style="background:#059669;border:none;cursor:pointer;">⏯️ Pause / Resume 24/7 Engine</button>
      <script>
        async function toggleEngineFromDashboard() {
          const params = new URLSearchParams(window.location.search);
          const uid = params.get("uid") || "";
          const r = await fetch("/api/web-toggle-engine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: uid })
          });
          const d = await r.json();
          if (d && d.ok) location.reload();
          else alert((d && d.error) || "Could not toggle engine");
        }
      </script>
      <a href="https://t.me/xswarm_cloud_2026_bot" target="_blank" class="btn" style="background:#0284c7;">🤖 Open Telegram Bot Console ↗</a>
        <a href="/affiliate?uid=${encodeURIComponent(userId)}" style="background:#ecfdf5;color:#059669;border:1.5px solid #10b981;border-radius:999px;padding:11px 20px;font-size:13.5px;font-weight:800;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">🤝 Affiliate Portal (30% USDT) ↗</a>
    </div>
  </div>
</body>
</html>`);
    } catch (e) {
      res.redirect('/lp');
    }
  });

  app.get('/legal', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Terms of Service — X-Swarm Cloud</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#ffffff;color:#0f172a;padding:40px 24px;max-width:800px;margin:0 auto;line-height:1.7;">
  <h2>⚖️ Terms of Service & Assumption of Risk</h2>
  <p style="margin-top:12px;">1. <b>Disposable Burner Accounts Only:</b> X-Swarm Cloud is an automation infrastructure built strictly for disposable X (Twitter) burner accounts using session <code>auth_token</code>. Never use your personal main account.</p>
  <p style="margin-top:12px;">2. <b>Shadowban & Algorithm Reality:</b> High-frequency posting carries an inherent shadowban risk (~2 hours empirical average at short intervals), determined solely by X Corp. Our system mitigates this via 0-second automatic backup account failover, but we assume zero liability for restricted accounts.</p>
  <p style="margin-top:12px;">3. <b>Zero Hidden Fees & Finality of Crypto Provisioning:</b> The 1st live test post is 100% free. For paid plans, there are no hidden fees or automatic recurring charges. Because dedicated Static ISP proxies and cloud slots are provisioned immediately upon payment, cryptocurrency payments are final and non-refundable.</p>
  <p style="margin-top:24px;"><a href="/lp" style="color:#0284c7;font-weight:800;text-decoration:none;">← Return to X-Swarm Cloud</a></p>
</body>
</html>`);
  });
}

module.exports = { registerLandingAndCustomerWebRoutes };
