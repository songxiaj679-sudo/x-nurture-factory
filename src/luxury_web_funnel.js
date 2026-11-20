const { registerPhase4FunnelRoutes, ensureLaneTrackingLink } = require('./funnel_click_tracker');
const { generateAiCampaignAngles, generateAiCampaignPayload } = require('./ai_campaign_builder');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  resolveSessionUser,
  hashUserPassword,
  verifyUserPassword,
  isLegacyPasswordHash,
  generateSessionToken,
  setAuthCookies,
  clearAuthCookies,
  parseCookies
} = require('./auth_service');
const { getWiseConfig, buildWiseOrderSpec, checkWiseOrderPaidViaApi } = require('./wise_payment');
const {
  PLAN_CATALOG,
  normalizeCountryList,
  reconcileAndRecycleIspPool,
  checkOneDayUpgradeCredit,
  activateOrderAndProvisionResources
} = require('./isp_pool_manager');
const { createOxaPayUsdInvoice } = require('./telegram_bot');
const { runFreeLiveBrowserTestV3, executeSafeStealthDeleteTweet, diagnoseBurnerAccountHealthV3 } = require('./v3_post_executor');
const { registerGoogleAuthRoutes } = require('./google_auth');
const { registerTwitterAuthRoutes } = require('./twitter_auth');
const { fetchUrlSummary } = require('./autonomous_promo_ai');
const { extractBrandKnowledge } = require('./lp_knowledge_extractor');
const { resolveAccountVoiceProfile } = require('./account_voice_profiler');
const { draftNextPostText } = require('./next_post_draft');
const { runDeterministicAudit } = require('./draft_verifier');
const { describeAccountState, writingShape } = require('./customer_post_state');
const { getUserProfileAndRecentTweets, lookupAnyUserProfileAndTweets, decryptCredentials, encryptCredentials } = require('./official_api_client');
const { hasXaiKey, completeText } = require('./grok_client');

const WEB_PLANS = PLAN_CATALOG;
const HTML_VIEW_PATH = path.join(__dirname, '../views/funnel_index.html');

function renderUnifiedStoreAndCockpitHtml() {
  return fs.readFileSync(HTML_VIEW_PATH, 'utf8');
}

function attachLuxuryWebFunnel(app, db) {
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ ok: false, error: 'Image payload exceeds the 20MB limit. Please choose a smaller image.' });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ ok: false, error: 'Invalid request payload format. Please reload the page and try again.' });
    }
    next(err);
  });
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  app.use('/funnel-assets', express.static(path.join(__dirname, '../public/funnel')));
  // static404Guard: 存在しない画像等で後続のBasic認証ミドルウェアが発火するのを防ぐ
  app.use('/uploads', (req, res) => res.status(404).end());
  app.use('/funnel-assets', (req, res) => res.status(404).end());
  registerGoogleAuthRoutes(app, db);
  registerTwitterAuthRoutes(app, db);

  function hashPassword(password, salt) {
    return hashUserPassword(password, salt);
  }

  function verifyPassword(password, storedHash) {
    return verifyUserPassword(password, storedHash);
  }

  app.get('/', (req, res, next) => {
    if (req.query && req.query.admin === '1') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(renderUnifiedStoreAndCockpitHtml());
  });

  app.get(/^\/studio(?:\/.*)?$/, async (req, res) => {
    try {
      const authUser = await resolveSessionUser(db, req);
      if (authUser) return res.redirect('/dashboard');
    } catch (_) {}
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(renderUnifiedStoreAndCockpitHtml());
  });

  registerPhase4FunnelRoutes(app, { db, resolveUserId: async (req, res) => {
    try {
      const authUser = await resolveSessionUser(db, req);
      if (!authUser) {
        if (!res.headersSent) {
          res.status(401).json({ ok: false, error: 'Authentication required. Please sign in.', requireLogin: true });
        }
        return null;
      }
      return authUser.userId || authUser.id;
    } catch (_authErr) {
      if (!res.headersSent) {
        res.status(401).json({ ok: false, error: 'Authentication failed.' });
      }
      return null;
    }
  } });

  function funnelUiEn(req) {
    const bodyLang = req.body && req.body.lang;
    if (bodyLang === 'en' || bodyLang === 'ja') return bodyLang === 'en';
    const cookies = parseCookies(req);
    return cookies.velox_lang === 'en';
  }

  app.post('/api/funnel/register', async (req, res) => {
    try {
      const isEn = funnelUiEn(req);
      const say = (ja, en) => (isEn ? en : ja);
      const { email, password, passwordConfirm, currentUserId, refCode } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.json({ ok: false, error: say('有効なメールアドレスを入力してください。', 'Please enter a valid email address.') });
      }
      if (!password || String(password).length < 8) {
        return res.json({ ok: false, error: say('パスワードは8文字以上にしてください。', 'Password must be at least 8 characters long.') });
      }
      if (password !== passwordConfirm) {
        return res.json({ ok: false, error: say('確認用パスワードが一致しません。', 'Password confirmation does not match.') });
      }

      const existingSnap = await db.collection('saas_users').where('email', '==', cleanEmail).limit(1).get();
      if (!existingSnap.empty) {
        return res.json({ ok: false, error: say('このメールアドレスは登録済みです。ログインタブから入ってください。', 'This email is already registered. Please use the Sign In tab.') });
      }

      const userId = (currentUserId && String(currentUserId).startsWith('WEB-'))
        ? String(currentUserId)
        : ('WEB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase());

      const passwordHash = hashUserPassword(password);
      const sessionToken = generateSessionToken();
      const now = new Date();

      await db.collection('saas_users').doc(userId).set({
        userId,
        email: cleanEmail,
        passwordHash,
        sessionToken,
        planId: cleanEmail === 'hank3jones@gmail.com' ? 'business' : 'free',
        planStatus: cleanEmail === 'hank3jones@gmail.com' ? 'active' : 'free',
        tierLevel: cleanEmail === 'hank3jones@gmail.com' ? 4 : 0,
        maxThreads: cleanEmail === 'hank3jones@gmail.com' ? 3 : 1,
        maxAccounts: cleanEmail === 'hank3jones@gmail.com' ? 50 : 1,
        aiReplyUnlocked: cleanEmail === 'hank3jones@gmail.com',
        myRefCode: cleanEmail === 'hank3jones@gmail.com' ? 'XSW-B334EF' : ('XSW-' + crypto.createHash('md5').update(cleanEmail).digest('hex').slice(0, 6).toUpperCase()),
        referredBy: String(refCode || 'XSW-B334EF').trim().toUpperCase(),
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
      }, { merge: true });

      setAuthCookies(res, sessionToken, { userId, email: cleanEmail }, req);

      return res.json({
        ok: true,
        userId,
        email: cleanEmail,
        sessionToken,
        tierLevel: cleanEmail === 'hank3jones@gmail.com' ? 4 : 0,
        planId: cleanEmail === 'hank3jones@gmail.com' ? 'business' : 'free'
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/funnel/login', async (req, res) => {
    try {
      const isEn = funnelUiEn(req);
      const say = (ja, en) => (isEn ? en : ja);
      const { email, password } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !password) {
        return res.json({ ok: false, error: say('メールアドレスとパスワードを入力してください。', 'Please enter both email and password.') });
      }

      const snap = await db.collection('saas_users').where('email', '==', cleanEmail).limit(1).get();
      if (snap.empty) {
        return res.json({ ok: false, error: say('アカウントが見つかりません。新規登録してください。', 'Account not found. Please create a new account.') });
      }

      const uDoc = snap.docs[0];
      const u = uDoc.data() || {};
      if (!verifyUserPassword(password, u.passwordHash)) {
        return res.json({ ok: false, error: say('パスワードが正しくありません。', 'Incorrect password.') });
      }

      const sessionToken = generateSessionToken();
      const updateData = {
        sessionToken,
        lastLoginAt: new Date(),
        updatedAt: new Date()
      };
      if (isLegacyPasswordHash(u.passwordHash)) {
        updateData.passwordHash = hashUserPassword(password);
      }
      await uDoc.ref.update(updateData);

      setAuthCookies(res, sessionToken, { userId: u.userId || uDoc.id, email: cleanEmail }, req);

      return res.json({
        ok: true,
        userId: u.userId || uDoc.id,
        email: cleanEmail,
        sessionToken,
        tierLevel: cleanEmail === 'hank3jones@gmail.com' ? 4 : ((u.planStatus === 'active' && u.tierLevel) ? u.tierLevel : 0),
        planId: u.planId || 'free'
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  // 👤 Server Session Authority Endpoint: verifies session validity from xcloud_sess cookie
  app.get('/api/funnel/me', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const user = await resolveSessionUser(db, req);
      if (!user) {
        return res.json({ ok: true, loggedIn: false });
      }
      const isPriv = (user.email === 'hank3jones@gmail.com' || user.email === 'songxiaj679@gmail.com');
      return res.json({
        ok: true,
        loggedIn: true,
        user: {
          userId: user.userId || user.id,
          email: user.email,
          tierLevel: isPriv ? 4 : ((user.planStatus === 'active' && user.tierLevel) ? user.tierLevel : 0),
          planId: isPriv ? 'business' : (user.planId || 'free'),
          planStatus: isPriv ? 'active' : (user.planStatus || 'free')
        }
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  const freePreviewRateMap = new Map();
  const freePreviewProfileCache = new Map();

  async function lookupPublicXAccountForPreview(username) {
    const cleanHandle = String(username || '').trim().replace(/^@/, '');
    if (!cleanHandle) return null;
    const key = cleanHandle.toLowerCase();
    const cached = freePreviewProfileCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;

    let creds = process.env.X_BEARER_TOKEN ? { oauth2AccessToken: process.env.X_BEARER_TOKEN.trim() } : null;
    if (!creds) {
      try {
        const snap = await db.collection('saas_users').where('planStatus', '==', 'active').limit(5).get();
        for (const doc of snap.docs) {
          const row = doc.data();
          if (row && row.xOfficialCredentials) {
            creds = decryptCredentials(row.xOfficialCredentials);
            break;
          }
        }
      } catch (_e) {}
    }
    if (!creds) return null;

    let lookup = await lookupAnyUserProfileAndTweets(creds, cleanHandle, 10, { excludeRepliesRetweets: true, allowPartialProfile: true });
    if (lookup && lookup.ok && (!Array.isArray(lookup.tweets) || lookup.tweets.length === 0) && !lookup.tweetsError) {
      const unfiltered = await lookupAnyUserProfileAndTweets(creds, cleanHandle, 10, { allowPartialProfile: true });
      if (unfiltered && unfiltered.ok) lookup = unfiltered;
    }
    if (lookup && lookup.ok) {
      if (freePreviewProfileCache.size >= 150) {
        freePreviewProfileCache.delete(freePreviewProfileCache.keys().next().value);
      }
      freePreviewProfileCache.set(key, { at: Date.now(), data: lookup });
      return lookup;
    }
    return null;
  }

  const SHOWCASE_TTL_MS = 6 * 60 * 60 * 1000;
  const showcaseCache = new Map();
  const SHOWCASE_ACCOUNTS = {
    ja: { userId: 'WEB-GOOGLE-D12E2479A76266AEA2B4', handle: 'VeloxSystemsV4' },
    en: { userId: 'USR-MVUA1GLP-D640', handle: 'VeloxSystemsHQ' }
  };

  async function loadCachedShowcase(lang) {
    const key = lang === 'en' ? 'en' : 'ja';
    const hit = showcaseCache.get(key);
    if (hit && Date.now() - hit.at < SHOWCASE_TTL_MS) return hit.sample;
    const account = SHOWCASE_ACCOUNTS[key];
    const { db: liveDb } = require('./firestore');
    const userSnap = await liveDb.collection('saas_users').doc(account.userId).get();
    const user = userSnap && userSnap.exists ? (userSnap.data() || {}) : {};
    const knowledge = user.brandKnowledge && user.brandKnowledge.schemaVersion >= 2 ? user.brandKnowledge : {};
    let selected = null;
    try {
      const jobs = await liveDb.collection('autopilot_jobs').where('userId', '==', account.userId).get();
      selected = selectShowcaseJob((jobs.docs || []).map(doc => doc.data() || {}), key);
    } catch (_jobErr) {
      selected = null;
    }
    const job = selected && selected.row;
    const books = Array.isArray(knowledge.domainPlaybooks) ? knowledge.domainPlaybooks : [];
    const book = books.find(item => item && item.id === (job && job.focusPlaybookId)) || books[0] || null;
    const fallbackTweet = key === 'en'
      ? 'A saved page states the claim. The next post repeats only that claim and names the check before sending.'
      : '登録ページに書いてある確認場所だけを、次の1本に残します。ページに無い数値や体験は足しません。';
    const tweets = selected && selected.tweets ? selected.tweets : [fallbackTweet];
    const { planVisualCard, renderVisualCardPng } = require('./visual_card');
    const cardBook = book && (key === 'en' ? !showcaseHasCjk([book.topic, book.checkCriteria, book.commonMistake, book.boundaryCondition].join(' ')) : true) ? book : null;
    const jobCard = job && job.visualCard && job.visualCard.eligible === true && showcaseCardMatchesLang(job.visualCard, key) ? job.visualCard : null;
    const visualCard = jobCard || planVisualCard({
      portfolioRole: 'utility_save',
      focusPlaybook: cardBook,
      brandKnowledge: key === 'en' ? showcaseEnglishKnowledge(knowledge) : knowledge,
      lang: key
    });
    let png = null;
    if (visualCard && visualCard.eligible !== false) {
      try { png = await renderVisualCardPng(visualCard); } catch (_pngErr) { png = null; }
    }
    const sample = {
      ok: true,
      cachedSample: true,
      generatedAt: new Date().toISOString(),
      png,
      preview: {
        account: { handle: account.handle, measured: false },
        facts: filterShowcaseFacts(previewFactsFromClaims(knowledge.verifiedClaims), key),
        pricing: filterShowcaseLines(knowledge.verifiedPricing, key).slice(0, 4),
        constraints: filterShowcaseLines(knowledge.verifiedConstraints, key).slice(0, 4),
        shapeReason: key === 'en' ? 'Cached production sample. Your own URL is analyzed after free sign-up.' : '本番エンジンの完成見本です。自社URLの分析は無料登録後に行います。',
        focusPlaybookId: book && book.id || '',
        focusPlaybookTopic: filterShowcaseText(book && book.topic, key),
        tweets,
        visualCardUrl: `/api/funnel/sample-card.png?lang=${key}`
      }
    };
    showcaseCache.set(key, { at: Date.now(), sample });
    return sample;
  }

  app.get('/api/funnel/sample-showcase', async (req, res) => {
    try {
      const sample = await loadCachedShowcase(req.query && req.query.lang);
      return res.json({ ok: true, cachedSample: true, generatedAt: sample.generatedAt, preview: sample.preview });
    } catch (err) {
      return res.status(502).json({ ok: false, error: 'sample_unavailable' });
    }
  });

  app.get('/api/funnel/sample-card.png', async (req, res) => {
    try {
      const sample = await loadCachedShowcase(req.query && req.query.lang);
      if (!sample.png) return res.status(404).end();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(sample.png);
    } catch (_err) {
      return res.status(404).end();
    }
  });

  app.post('/api/funnel/free-experience', async (req, res) => {
    const isEn = req.body && req.body.lang === 'en';
    try {
      const sample = await loadCachedShowcase(isEn ? 'en' : 'ja');
      return res.json({ ok: true, saved: false, cachedSample: true, generatedAt: sample.generatedAt, preview: sample.preview });
    } catch (err) {
      return res.status(502).json({ ok: false, error: isEn ? 'The cached sample is unavailable.' : '完成見本を表示できませんでした。' });
    }
  });

  app.post('/api/funnel/create-order', async (req, res) => {
    try {
      const { planId, country, aiKeywords, userId: rawUid, refCode } = req.body || {};
      const plan = PLAN_CATALOG[planId] || PLAN_CATALOG.starter;
      const cleanRef = String(refCode || 'XSW-B334EF').trim().toUpperCase();
      const userId = rawUid && String(rawUid).startsWith('WEB-')
        ? String(rawUid)
        : ('WEB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase());
      const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

      const normCountries = normalizeCountryList(country || 'US', plan.ispCount || 1, plan.onlyUsJp);
      const cleanCountry = normCountries.join(',');

      const upgCredit = await checkOneDayUpgradeCredit(userId, plan.id);
      const finalUsd = upgCredit.eligible ? Math.max(1, plan.usd - upgCredit.discountUsd) : plan.usd;

      const wiseCfg = await getWiseConfig(plan.id);
      const wiseSpec = buildWiseOrderSpec(orderId, finalUsd);
      const oxa = await createOxaPayUsdInvoice(orderId, finalUsd).catch(() => null);

      await db.collection('orders').doc(orderId).set({
        orderId,
        orderType: plan.orderType || 'saas_plan',
        userId,
        planId: plan.id,
        planName: plan.name,
        tierLevel: plan.tierLevel || 1,
        durationDays: plan.days,
        totalThreads: plan.threads,
        totalMaxAccounts: plan.accounts,
        totalIspCount: plan.ispCount,
        aiReplyUnlocked: !!plan.aiReply,
        aiKeywords: String(aiKeywords || ''),
        minIntervalMin: plan.minIntervalMin || 5,
        ispCountry: cleanCountry,
        ispCountries: normCountries,
        referredBy: cleanRef,
        originalAmountUsd: plan.usd,
        upgradeDiscountUsd: upgCredit.discountUsd || 0,
        oneDayContractId: upgCredit.oneDayContractId || null,
        grossAmountUsd: finalUsd,
        grossAmountJpy: plan.jpy,
        wiseRef: wiseSpec.wiseRef,
        wiseExactUsd: wiseSpec.exactUsd,
        wisePayUrl: wiseCfg.quickPayUrl,
        gatewayRedirectUrl: oxa ? oxa.payLink : null,
        oxaTrackId: oxa ? oxa.trackId : null,
        status: 'pending_payment',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return res.json({
        ok: true,
        orderId,
        userId,
        planId: plan.id,
        finalUsd,
        upgradeDiscountApplied: upgCredit.eligible,
        wiseRef: wiseSpec.wiseRef,
        wiseUrl: wiseCfg.quickPayUrl,
        cryptoUrl: (oxa && oxa.payLink) ? oxa.payLink : wiseCfg.quickPayUrl
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/funnel/check-order', async (req, res) => {
    try {
      const orderId = String(req.query.orderId || '').trim();
      if (!orderId) return res.json({ paid: false });
      const oDoc = await db.collection('orders').doc(orderId).get();
      if (!oDoc.exists) return res.json({ paid: false });
      const o = oDoc.data();
      if (o.status === 'completed') {
        const prov = await activateOrderAndProvisionResources(orderId, o);
        return res.json({
          paid: true,
          country: o.ispCountry || 'USA',
          planId: prov.planId || o.planId,
          tierLevel: prov.tierLevel || 1,
          proxies: prov.proxies || [],
          aiReplyUnlocked: !!prov.aiReplyUnlocked
        });
      }
      const wisePaid = await checkWiseOrderPaidViaApi(o, orderId);
      if (wisePaid) {
        const prov = await activateOrderAndProvisionResources(orderId, o);
        return res.json({
          paid: true,
          country: o.ispCountry || 'USA',
          planId: prov.planId || o.planId,
          tierLevel: prov.tierLevel || 1,
          proxies: prov.proxies || [],
          aiReplyUnlocked: !!prov.aiReplyUnlocked
        });
      }
      return res.json({ paid: false });
    } catch (e) {
      return res.json({ paid: false });
    }
  });

  
  app.get('/api/funnel/lane-logs', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      const userId = sessionUser ? (sessionUser.userId || sessionUser.id) : null;
      if (!userId) return res.json({ ok: true, logs: { 1: [], 2: [], 3: [] } });
      const readLane = (lNo) => {
        const f = '/tmp/xsw_term_' + userId + '_L' + lNo + '.json';
        if (!fs.existsSync(f)) {
          return ['[SYSTEM] [LANE #0' + lNo + '] Terminal ready. Standing by for next scheduled execution cycle...'];
        }
        try {
          const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
          return Array.isArray(arr) && arr.length > 0 ? arr : ['[SYSTEM] [LANE #0' + lNo + '] Standing by...'];
        } catch (e) {
          return ['[SYSTEM] [LANE #0' + lNo + '] Standing by...'];
        }
      };
      return res.json({
        ok: true,
        logs: {
          1: readLane(1),
          2: readLane(2),
          3: readLane(3)
        }
      });
    } catch (e) {
      return res.json({ ok: false, logs: { 1: [], 2: [], 3: [] } });
    }
  });

  app.post('/api/funnel/clear-lane-logs', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      const userId = sessionUser ? (sessionUser.userId || sessionUser.id) : null;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });
      const lNo = Math.min(3, Math.max(1, parseInt((req.body && req.body.laneIndex) || '1', 10)));
      const f = '/tmp/xsw_term_' + userId + '_L' + lNo + '.json';
      const ts = new Date().toISOString().slice(11, 19);
      fs.writeFileSync(f, JSON.stringify(['[' + ts + '] [LANE #0' + lNo + '] Terminal cleared by operator.']), 'utf8');
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false });
    }
  });

  app.get('/api/funnel/user-state', async (req, res) => {
    try {
      const poolSummary = await reconcileAndRecycleIspPool();
      const sessionUser = await resolveSessionUser(db, req);

      if (!sessionUser) {
        return res.json({
          ok: true,
          guest: true,
          tierLevel: 0,
          planId: 'free',
          poolSummary,
          lanes: {
            '1': { laneIndex: 1, profileBio: '', autoPostMode: false, aiReplyMode: false, postIntervalMin: 15, isLaneRunning: false },
            '2': { laneIndex: 2, profileBio: '', autoPostMode: false, aiReplyMode: false, postIntervalMin: 15, isLaneRunning: false },
            '3': { laneIndex: 3, profileBio: '', autoPostMode: false, aiReplyMode: false, postIntervalMin: 15, isLaneRunning: false }
          },
          accounts: [],
          posts: [],
          history: []
        });
      }

      const userId = sessionUser.userId || sessionUser.id;
      const u = sessionUser;
      const cSnap = await db.collection('saas_contracts').where('userId', '==', userId).get();
      const contracts = cSnap.docs.map(d => d.data());
      const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      const accounts = aSnap.docs.map(d => {
        const ad = d.data() || {};
        return {
          id: d.id,
          ...ad,
          laneIndex: parseInt(ad.laneIndex || '1', 10),
          nextPostAtMs: ad.nextPostAt && ad.nextPostAt.toDate ? ad.nextPostAt.toDate().getTime() : 0,
          lastPostedAtMs: ad.lastPostedAt && ad.lastPostedAt.toDate ? ad.lastPostedAt.toDate().getTime() : 0,
          errorReason: ad.errorReason || '',
          rawTokenPrefix: String(ad.authToken || '').slice(0, 10).toLowerCase(),
          authToken: String(ad.authToken || '').slice(0, 8) + '...'
        };
      });
      const pSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).limit(300).get();
      const posts = pSnap.docs.map(d => {
        const pd = d.data() || {};
        return {
          id: d.id,
          ...pd,
          laneIndex: parseInt(pd.laneIndex || '1', 10)
        };
      }).sort((a, b) => {
        const sa = typeof a.sortOrder === 'number' ? a.sortOrder : (a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0);
        const sb = typeof b.sortOrder === 'number' ? b.sortOrder : (b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0);
        return sa - sb;
      });
      const hSnap = await db.collection('saas_history').where('ownerUserId', '==', userId).get();
      const history = hSnap.docs.map(d => {
        const hd = d.data() || {};
        const cMs = hd.createdAt && hd.createdAt.toDate ? hd.createdAt.toDate().getTime() : 0;
        return {
          id: d.id,
          ...hd,
          createdAtMs: cMs,
          laneIndex: parseInt(hd.laneIndex || '1', 10)
        };
      }).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)).slice(0, 50);

      // レーン1〜3の独立設定を構築 (既存データがある場合はLane 1にフォールバック継承)
      const savedLanes = u.lanes || {};
      const defaultLaneCfg = (idx) => {
        const l = savedLanes[String(idx)] || {};
        return {
          laneIndex: idx,
          profileBio: typeof l.profileBio === 'string' ? l.profileBio : '',
          aiProductDesc: typeof l.aiProductDesc === 'string' ? l.aiProductDesc : '',
          aiAffiliateUrl: typeof l.aiAffiliateUrl === 'string' ? l.aiAffiliateUrl : '',
          aiFunnelStyle: typeof l.aiFunnelStyle === 'string' ? l.aiFunnelStyle : 'empathy_bridge',
          aiTargetLang: typeof l.aiTargetLang === 'string' ? l.aiTargetLang : 'ja',
          aiReplyPersona: typeof l.aiReplyPersona === 'string' ? l.aiReplyPersona : '',
          postIntervalMin: l.postIntervalMin || (idx === 1 ? (u.postIntervalMin || 15) : 15),
          postSelectionMode: l.postSelectionMode || (idx === 1 ? (u.postSelectionMode || 'loop') : 'loop'),
          autoPostMode: typeof l.autoPostMode === 'boolean' ? l.autoPostMode : (u.autoPostMode !== false),
          aiReplyMode: typeof l.aiReplyMode === 'boolean' ? l.aiReplyMode : !!u.aiReplyMode,
          aiKeywords: typeof l.aiKeywords === 'string' ? l.aiKeywords : '',
          isEngineRunning: typeof l.isEngineRunning === 'boolean' ? l.isEngineRunning : (u.isEngineRunning !== false)
        };
      };
      const lanes = {
        1: defaultLaneCfg(1),
        2: defaultLaneCfg(2),
        3: defaultLaneCfg(3)
      };

      return res.json({
        ok: true,
        userId,
        planId: u.planId || 'free',
        planName: u.planName || 'Free Experience',
        tierLevel: u.email === 'hank3jones@gmail.com' ? 4 : ((u.planStatus === 'active' && u.tierLevel) ? u.tierLevel : 0),
        planStatus: u.planStatus || 'free',
        maxThreads: u.email === 'hank3jones@gmail.com' ? 3 : (u.maxThreads || 1),
        maxAccounts: u.email === 'hank3jones@gmail.com' ? 50 : (u.maxAccounts || 1),
        ispQuota: u.ispQuota || 0,
        ispCountry: u.ispCountry || 'US,JP,GB',
        assignedProxies: u.assignedProxies || [],
        aiReplyUnlocked: u.email === 'hank3jones@gmail.com' ? true : !!u.aiReplyUnlocked,
        lanes,
        myRefCode: u.myRefCode || (u.email === 'hank3jones@gmail.com' ? 'XSW-B334EF' : ('XSW-' + crypto.createHash('md5').update(String(userId)).digest('hex').slice(0, 6).toUpperCase())),
        accounts,
        posts,
        history,
        poolSummary
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  
  
  
  app.post('/api/funnel/ai-propose-angles', async (req, res) => {
    try {
      const { productDesc, affiliateUrl, targetLang, battleMode } = req.body || {};
      const cleanProd = String(productDesc || '').trim();
      if (!cleanProd) {
        return res.json({ ok: false, error: '宣伝したい商品・ジャンルを入力してください（例：FXのアフィ、Xの自動投稿ツールなど）。' });
      }
      const proposed = await generateAiCampaignAngles({
        productDesc: cleanProd,
        affiliateUrl: String(affiliateUrl || '').trim(),
        targetLang: String(targetLang || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en',
        battleMode: battleMode || 'aggressive'
      });
      return res.json({
        ok: true,
        aiGreeting: proposed.aiGreeting,
        angles: proposed.angles,
        battleMode: proposed.battleMode || battleMode || 'aggressive',
        recommendedIntervalMin: proposed.recommendedIntervalMin || 15,
        recommendedAiReply: typeof proposed.recommendedAiReply === 'boolean' ? proposed.recommendedAiReply : true,
        modelUsed: proposed.modelUsed
      });
    } catch (e) {
      return res.json({ ok: false, error: 'AI angle proposal failed: ' + e.message });
    }
  });

  
  app.post('/api/funnel/ai-launch-wizard', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser) {
        return res.status(401).json({ ok: false, error: 'セッションが無効です。ログインしてください。', requireLogin: true });
      }
      const userId = sessionUser.userId || sessionUser.id;
      const { laneIndex, postIntervalMin, aiReplyMode, profileBio } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);
      const interval = Math.max(5, parseInt(postIntervalMin || '15', 10));
      const enableReply = aiReplyMode === true;

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};

      // AIリプライ営業をONにする場合は、他のレーンの aiReplyMode を false にしてこのレーンに専属割当（1アカウント最大効率保護）
      if (enableReply) {
        for (const k of ['1', '2', '3']) {
          if (lanes[k]) lanes[k].aiReplyMode = false;
        }
      }

      lanes[lKey] = {
        ...(lanes[lKey] || {}),
        laneIndex: numLane,
        postIntervalMin: interval,
        autoPostMode: true,
        aiReplyMode: enableReply,
        isEngineRunning: true,
        updatedAt: new Date()
      };
      if (typeof profileBio === 'string' && profileBio.trim() !== '') {
        lanes[lKey].profileBio = profileBio.trim().slice(0, 155);
        lanes[lKey].bioSyncPending = true;
        if (typeof req.body.aiKeywords === 'string' && req.body.aiKeywords.trim()) {
          lanes[lKey].aiKeywords = req.body.aiKeywords.trim();
        }
        if (lanes[lKey].pinnedPost) {
          lanes[lKey].pinSyncPending = true;
        }
        lanes[lKey].bioUpdatedAtMs = Date.now();
      }

      const anyAiReplyOn = ['1', '2', '3'].some(k => lanes[k] && lanes[k].aiReplyMode === true);
      const activeAiLaneKey = ['1', '2', '3'].find(k => lanes[k] && lanes[k].aiReplyMode === true) || lKey;
      const activeLaneObj = lanes[activeAiLaneKey] || lanes[lKey] || {};
      await uRef.set({
        isEngineRunning: true,
        postIntervalMin: interval,
        aiReplyMode: anyAiReplyOn,
        aiReplyActiveLane: anyAiReplyOn ? parseInt(activeAiLaneKey, 10) : 0,
        aiKeywords: activeLaneObj.aiKeywords || uData.aiKeywords || '',
        profileBio: activeLaneObj.profileBio || uData.profileBio || '',
        lanes,
        updatedAt: new Date()
      }, { merge: true });

      try {
        const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
        const logFile = '/tmp/xsw_term_' + cleanUid + '_L' + numLane + '.json';
        const ts = new Date().toISOString().slice(11, 19);
        let arr = [];
        if (fs.existsSync(logFile)) { try { arr = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (e) {} }
        arr.push('[' + ts + '] [LANE #0' + numLane + '] 🚀 [AI Autopilot Launched] Interval: Every ' + interval + 'm | Autonomous AI Prospecting Replies: ' + (enableReply ? 'ON (ACTIVE)' : 'OFF (Timeline Only)'));
        fs.writeFileSync(logFile, JSON.stringify(arr.slice(-80)), 'utf8');
      } catch (e) {}

      const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      for (const accDoc of aSnap.docs) {
        const ad = accDoc.data() || {};
        const banned = (ad.role === 'シャドウバン' || ad.role === 'ロボット' || ad.role === '利用不可' || ad.isActive === false);
        if (parseInt(ad.laneIndex || '1', 10) === numLane && !banned) {
          await accDoc.ref.update({ nextPostAt: new Date(0), nextOutreachAt: new Date(0), updatedAt: new Date() }).catch(() => {});
        }
      }
      return res.json({
        ok: true,
        laneIndex: numLane,
        postIntervalMin: interval,
        aiReplyMode: enableReply
      });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/funnel/ai-generate-campaign', async (req, res) => {
    try {
      const { userId, laneIndex, productDesc, affiliateUrl, funnelStyle, targetLang, replaceExisting, selectedAngle, userFeedback, battleMode } = req.body || {};
      if (!userId) return res.json({ ok: false, error: 'Authentication required. Please sign in.' });
      const cleanProd = String(productDesc || '').trim();
      const cleanUrl = String(affiliateUrl || '').trim();
      if (!cleanProd) {
        return res.json({ ok: false, error: 'Please describe what product, offer, or niche you want to promote.' });
      }

      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const generated = await generateAiCampaignPayload({
        productDesc: cleanProd,
        affiliateUrl: cleanUrl,
        funnelStyle: funnelStyle || 'empathy_bridge',
        targetLang: String(targetLang || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en',
        selectedAngle: selectedAngle || null,
        userFeedback: userFeedback || '',
        battleMode: battleMode || 'aggressive'
      });

      const safeBio = String(generated.profileBio || '').trim().slice(0, 155);
      const safeKeywords = String(generated.aiKeywords || '').trim().slice(0, 350);
      const safePersona = String(generated.aiReplyPersona || '').trim().slice(0, 700);
      const rawPosts = Array.isArray(generated.posts) ? generated.posts : [];

      const uRef = db.collection('saas_users').doc(String(userId));
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const isOwnerUser = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(String(userId)) || uData.email === 'hank3jones@gmail.com';
      if (!isOwnerUser && (!uData.planId || uData.planId === 'free')) {
        return res.json({ ok: false, error: 'Please unlock a plan ($7 Trial or Monthly Plan) to use the Grok AI Campaign Builder.' });
      }
      const curGenCount = parseInt(uData.aiGenCount || '0', 10);
      if (!isOwnerUser && uData.planId === 'oneday' && curGenCount >= 3) {
        return res.json({ ok: false, error: '1-Day Trial includes up to 3 AI Campaign generations. Upgrade to a 30-Day Plan for unlimited AI generations!' });
      }
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      lanes[lKey] = {
        ...(lanes[lKey] || {}),
        laneIndex: numLane,
        profileBio: safeBio,
        aiKeywords: safeKeywords,
        aiProductDesc: cleanProd,
        aiAffiliateUrl: cleanUrl,
        aiFunnelStyle: String(funnelStyle || 'empathy_bridge'),
        aiTargetLang: String(targetLang || generated.targetLang || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en',
        aiTargetSegment: String(generated.targetSegment || 'b2c_consumer'),
        pinnedPost: generated.pinnedPost || null,
        pinSyncPending: Boolean(generated.pinnedPost),
        aiLastRefreshedAtMs: Date.now(),
        useClickTracker: typeof lanes[lKey]?.useClickTracker === 'boolean'
          ? lanes[lKey].useClickTracker
          : !String(affiliateUrl || '').toLowerCase().includes('appflowsystem.com'),
        aiBattleMode: String(battleMode || generated.battleMode || 'aggressive'),
        postIntervalMin: generated.recommendedIntervalMin || 15,
        aiReplyPersona: safePersona,
        updatedAt: new Date()
      };
      await uRef.set({ lanes, aiGenCount: curGenCount + 1, updatedAt: new Date() }, { merge: true });

      const existingSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
      const laneDocs = existingSnap.docs.filter(d => parseInt(d.data().laneIndex || '1', 10) === numLane);
      if (replaceExisting === true && laneDocs.length > 0) {
        for (const d of laneDocs) {
          await d.ref.delete().catch(() => {});
        }
      }

      const currentCount = replaceExisting === true ? 0 : laneDocs.length;
      const quotaLeft = Math.max(0, 100 - currentCount);
      const toInsert = rawPosts.slice(0, Math.min(25, quotaLeft));

      let baseOrder = Date.now();
      let addedCount = 0;
      for (const p of toInsert) {
        const mTxt = String(p.mainText || p.post || '').trim().slice(0, 260);
        const sRep = String(p.selfReplyText || cleanUrl || '').trim().slice(0, 260);
        if (!mTxt) continue;
        baseOrder += 10;
        await db.collection('saas_posts').add({
          ownerUserId: userId,
          laneIndex: numLane,
          text: mTxt,
          selfReplyText: sRep,
          funnelType: p.funnelType || (sRep ? 'self_reply_url' : 'pinned_bridge'),
          imageUrl: (lanes[lKey] && lanes[lKey].defaultPromoImageUrl) ? lanes[lKey].defaultPromoImageUrl : '',
          isEnabled: true,
          sortOrder: baseOrder,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        addedCount++;
      }

      try {
        const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
        const logFile = '/tmp/xsw_term_' + cleanUid + '_L' + numLane + '.json';
        const ts = new Date().toISOString().slice(11, 19);
        let arr = [];
        if (fs.existsSync(logFile)) { try { arr = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (e) {} }
        arr.push('[' + ts + '] [LANE #0' + numLane + '] 🪄 [Grok AI Autopilot] Generated & synced BIO, ' + addedCount + ' Spintax Post Patterns, 8 Buyer Keywords & Empathy Bridge Persona!');
        fs.writeFileSync(logFile, JSON.stringify(arr.slice(-80)), 'utf8');
      } catch (e) {}

      return res.json({
        ok: true,
        laneIndex: numLane,
        modelUsed: generated.modelUsed || 'grok',
        aiClosingMessage: generated.aiClosingMessage || '',
        profileBio: safeBio,
        aiKeywords: safeKeywords,
        aiReplyPersona: safePersona,
        generatedPosts: toInsert,
        battleMode: generated.battleMode || battleMode || 'aggressive',
        recommendedIntervalMin: generated.recommendedIntervalMin || 15,
        recommendedAiReply: typeof generated.recommendedAiReply === 'boolean' ? generated.recommendedAiReply : true,
        addedCount
      });
    } catch (e) {
      return res.json({ ok: false, error: 'AI Campaign generation failed: ' + e.message });
    }
  });

  app.post('/api/funnel/save-lane-bio', async (req, res) => {
    try {
      const { userId, laneIndex, bio } = req.body || {};
      if (!userId) return res.json({ ok: false, error: 'Authentication required. Please sign in.' });
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);
      const cleanBio = String(bio || '').trim().slice(0, 160);

      const uRef = db.collection('saas_users').doc(String(userId));
      const uSnap = await uRef.get();
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      lanes[lKey] = {
        ...(lanes[lKey] || {}),
        laneIndex: numLane,
        profileBio: cleanBio,
        bioSyncPending: Boolean(cleanBio),
        bioUpdatedAtMs: Date.now(),
        aiProductDesc: typeof req.body.aiProductDesc === 'string' ? req.body.aiProductDesc.trim().slice(0, 300) : ((lanes[lKey] && lanes[lKey].aiProductDesc) || ''),
        aiAffiliateUrl: typeof req.body.aiAffiliateUrl === 'string' ? req.body.aiAffiliateUrl.trim().slice(0, 300) : ((lanes[lKey] && lanes[lKey].aiAffiliateUrl) || ''),
        aiFunnelStyle: typeof req.body.aiFunnelStyle === 'string' ? req.body.aiFunnelStyle.trim() : ((lanes[lKey] && lanes[lKey].aiFunnelStyle) || 'empathy_bridge'),
        aiTargetLang: typeof req.body.aiTargetLang === 'string' ? req.body.aiTargetLang.trim() : ((lanes[lKey] && lanes[lKey].aiTargetLang) || 'ja'),
        aiReplyPersona: typeof req.body.aiReplyPersona === 'string' ? req.body.aiReplyPersona.trim().slice(0, 700) : ((lanes[lKey] && lanes[lKey].aiReplyPersona) || ''),
        updatedAt: new Date()
      };
      if (affiliateUrl && /^https?:\/\//i.test(String(affiliateUrl).trim())) {
        const trLink = await ensureLaneTrackingLink({
          db,
          userId,
          laneIndex: numLane,
          destinationUrl: String(affiliateUrl).trim(),
          title: String(productDesc || '').slice(0, 80),
          description: generated.profileBio || '',
          imageUrl: (lanes[lKey] && lanes[lKey].defaultPromoImageUrl) ? lanes[lKey].defaultPromoImageUrl : '',
          req
        });
        if (trLink) lanes[lKey].trackingShortUrl = trLink.shortUrl;
      }
      await uRef.set({ lanes, updatedAt: new Date() }, { merge: true });
      try {
        const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
        const logFile = '/tmp/xsw_term_' + cleanUid + '_L' + numLane + '.json';
        const ts = new Date().toISOString().slice(11, 19);
        let arr = [];
        if (fs.existsSync(logFile)) { try { arr = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (e) {} }
        arr.push('[' + ts + '] [LANE #0' + numLane + '] ⚡ Queued immediate Profile BIO sync & lock (applying to X within ~3-8s)...');
        fs.writeFileSync(logFile, JSON.stringify(arr.slice(-80)), 'utf8');
      } catch (e) {}
      return res.json({ ok: true, laneIndex: numLane, profileBio: cleanBio });
    } catch (e) {
      return res.json({ ok: false, error: 'BIO保存エラー: ' + e.message });
    }
  });

  app.post('/api/funnel/update-dual-mode', async (req, res) => {
    try {
      const { userId, laneIndex, autoPostMode, aiReplyMode, aiKeywords } = req.body || {};
      if (aiReplyMode === true && userId) {
        const chkSnap = await db.collection('saas_users').doc(String(userId)).get();
        const chkData = chkSnap.exists ? (chkSnap.data() || {}) : {};
        const isOwnerAcc = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(String(userId)) || chkData.email === 'hank3jones@gmail.com';
        const addonExpMs = chkData.aiRadarAddonExpiresAt && chkData.aiRadarAddonExpiresAt.toDate ? chkData.aiRadarAddonExpiresAt.toDate().getTime() : 0;
        const hasValidAddon = chkData.hasAiRadarAddon === true && (!addonExpMs || addonExpMs > Date.now());
        if (!isOwnerAcc && (chkData.planId !== 'enterprise' && chkData.planId !== 'business') && !hasValidAddon) {
          return res.json({
            ok: false,
            code: 'AI_RADAR_ADDON_REQUIRED',
            error: 'AI Empathy Direct-Sales Radar requires the +$49 Add-On or Enterprise Plan.'
          });
        }
      }
      if (!userId) return res.json({ ok: false, error: 'Session expired. Please sign in again.' });
      const lIdx = String(Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10))));
      const uRef = db.collection('saas_users').doc(String(userId));
      const uSnap = await uRef.get();
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      const curLane = lanes[lIdx] || {};
      if (typeof autoPostMode === 'boolean') curLane.autoPostMode = autoPostMode;
      if (typeof aiReplyMode === 'boolean') curLane.aiReplyMode = aiReplyMode;
      if (typeof aiKeywords === 'string') curLane.aiKeywords = aiKeywords.slice(0, 300);
      lanes[lIdx] = curLane;

      // AIリプライモードは1スレッド専有：ONにした場合は他レーン(1..3)のaiReplyModeを自動OFFにする
      const autoTurnedOffLanes = [];
      if (aiReplyMode === true) {
        for (const k of ['1', '2', '3']) {
          if (k !== lIdx && lanes[k] && lanes[k].aiReplyMode === true) {
            lanes[k].aiReplyMode = false;
            autoTurnedOffLanes.push(parseInt(k, 10));
          }
        }
      }

      const anyAiOn = ['1', '2', '3'].some(k => lanes[k] && lanes[k].aiReplyMode === true);
      await uRef.set({
        lanes,
        aiReplyMode: anyAiOn,
        aiReplyActiveLane: aiReplyMode ? parseInt(lIdx, 10) : (anyAiOn ? undefined : 0),
        updatedAt: new Date()
      }, { merge: true });

      return res.json({
        ok: true,
        laneIndex: parseInt(lIdx, 10),
        autoTurnedOffLanes
      });
    } catch (e) {
      return res.json({ ok: false, error: 'モード保存エラー: ' + e.message });
    }
  });

  
  app.post('/api/funnel/quick-add-tokens', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser) {
        return res.status(401).json({ ok: false, error: 'セッションが無効です。ログインしてください。', requireLogin: true });
      }
      const userId = sessionUser.userId || sessionUser.id;
      const { laneIndex, tokens } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const extracted = String(tokens || '').match(/\b[a-fA-F0-9]{40}\b/g) || [];
      if (extracted.length === 0) {
        return res.json({ ok: false, error: '有効な40文字の16進数 auth_token が見つかりませんでした。' });
      }

      const existingAccSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      const existingTokenMap = new Map();
      for (const ed of existingAccSnap.docs) {
        const edData = ed.data() || {};
        const lane = parseInt(edData.laneIndex || '1', 10);
        if (edData.authTokenHash) existingTokenMap.set(edData.authTokenHash, lane);
        if (edData.authToken && !edData.authToken.includes('...')) {
          existingTokenMap.set(String(edData.authToken).trim().toLowerCase(), lane);
        }
        if (edData.encryptedAuthToken) {
          try {
            const dec = decryptCredentials(edData.encryptedAuthToken);
            if (dec && dec.authToken) existingTokenMap.set(String(dec.authToken).trim().toLowerCase(), lane);
          } catch (e) {}
        }
      }

      let addedTokensCount = 0;
      let skippedCrossLaneCount = 0;
      const crossLaneWarnings = [];

      for (const rawTok of extracted) {
        const cleanToken = rawTok.toLowerCase();
        const tokHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
        if (existingTokenMap.has(tokHash) || existingTokenMap.has(cleanToken)) {
          const boundLane = existingTokenMap.get(tokHash) || existingTokenMap.get(cleanToken);
          if (boundLane !== numLane) {
            skippedCrossLaneCount++;
            crossLaneWarnings.push(cleanToken.slice(0, 6) + '... (既に Lane #0' + boundLane + ' に登録済み)');
            continue;
          }
        }
        existingTokenMap.set(tokHash, numLane);
        existingTokenMap.set(cleanToken, numLane);

        const encToken = encryptCredentials({ authToken: cleanToken });
        const maskedToken = cleanToken.slice(0, 4) + '...' + cleanToken.slice(-4);

        await db.collection('saas_accounts').doc(userId + '_L' + numLane + '_' + cleanToken.slice(0, 10)).set({
          ownerUserId: userId,
          laneIndex: numLane,
          authToken: maskedToken,
          authTokenHash: tokHash,
          encryptedAuthToken: encToken,
          username: '',
          role: '検証中',
          isActive: true,
          nextPostAt: new Date(0),
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        addedTokensCount++;
      }

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      lanes[lKey] = {
        ...(lanes[lKey] || {}),
        laneIndex: numLane,
        isEngineRunning: true,
        autoPostMode: true,
        updatedAt: new Date()
      };
      await uRef.set({ isEngineRunning: true, lanes, updatedAt: new Date() }, { merge: true });

      try {
        const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
        const logFile = '/tmp/xsw_term_' + cleanUid + '_L' + numLane + '.json';
        const ts = new Date().toISOString().slice(11, 19);
        let arr = [];
        if (fs.existsSync(logFile)) { try { arr = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (e) {} }
        arr.push('[' + ts + '] [LANE #0' + numLane + '] 🔑 Registered ' + addedTokensCount + ' burner token(s). Starting background browser verification...');
        fs.writeFileSync(logFile, JSON.stringify(arr.slice(-80)), 'utf8');
      } catch (e) {}

      return res.json({
        ok: true,
        laneIndex: numLane,
        addedTokens: addedTokensCount,
        skippedCrossLaneCount,
        crossLaneWarnings
      });
    } catch (e) {
      return res.json({ ok: false, error: 'トークン追加エラー: ' + e.message });
    }
  });

  app.post('/api/funnel/start-pro', async (req, res) => {
    try {
      const { userId, laneIndex, tokens, bio, post, selfReplyText, intervalMin, aiKeywords, autoPostMode, aiReplyMode, imageBase64, imageUrl } = req.body || {};
      if (!userId) return res.json({ ok: false, error: 'User ID not found. Please sign in again.' });
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      let finalImgUrl = String(imageUrl || '').trim();
      if (imageBase64 && String(imageBase64).startsWith('data:image/')) {
        const m = String(imageBase64).match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (!m) {
          return res.json({ ok: false, error: 'Unsupported image format (only PNG, JPG, WEBP, and GIF are supported).' });
        }
        const ext = m[1] === 'png' ? 'png' : (m[1] === 'webp' ? 'webp' : (m[1] === 'gif' ? 'gif' : 'jpg'));
        const fname = 'media_' + userId + '_L' + numLane + '_' + Date.now() + '.' + ext;
        const mediaDir = path.join(__dirname, '../uploads/tenant_media');
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
        fs.writeFileSync(path.join(mediaDir, fname), Buffer.from(m[2], 'base64'));
        finalImgUrl = '/uploads/tenant_media/' + fname;
      }

      const uRef = db.collection('saas_users').doc(String(userId));
      const uSnap = await uRef.get();
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      lanes[lKey] = {
        ...(lanes[lKey] || {}),
        laneIndex: numLane,
        profileBio: String(bio || '').slice(0, 160),
        bioSyncPending: Boolean(bio && String(bio).trim()),
        postIntervalMin: Math.max(5, parseInt(intervalMin || '15', 10)),
        aiKeywords: String(aiKeywords || '').slice(0, 300),
        autoPostMode: autoPostMode !== false,
        aiReplyMode: !!aiReplyMode,
        isEngineRunning: true,
        updatedAt: new Date()
      };

      await uRef.set({
        userId,
        lanes,
        profileBio: numLane === 1 ? String(bio || '').slice(0, 160) : (uSnap.exists ? uSnap.data().profileBio : ''),
        isEngineRunning: true,
        updatedAt: new Date()
      }, { merge: true });

      if (post) {
        await db.collection('saas_posts').add({
          ownerUserId: userId,
          laneIndex: numLane,
          text: String(post).slice(0, 280),
          selfReplyText: String(selfReplyText || '').trim().slice(0, 280),
          imageUrl: finalImgUrl,
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      const extracted = String(tokens || '').match(/\b[a-fA-F0-9]{40}\b/g) || [];
      const existingAccSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      const existingTokenMap = new Map();
      for (const ed of existingAccSnap.docs) {
        const edData = ed.data() || {};
        const lane = parseInt(edData.laneIndex || '1', 10);
        if (edData.authTokenHash) existingTokenMap.set(edData.authTokenHash, lane);
        if (edData.authToken && !edData.authToken.includes('...')) {
          existingTokenMap.set(String(edData.authToken).trim().toLowerCase(), lane);
        }
        if (edData.encryptedAuthToken) {
          try {
            const dec = decryptCredentials(edData.encryptedAuthToken);
            if (dec && dec.authToken) existingTokenMap.set(String(dec.authToken).trim().toLowerCase(), lane);
          } catch (e) {}
        }
      }

      let addedTokensCount = 0;
      let skippedCrossLaneCount = 0;
      const crossLaneWarnings = [];

      for (const rawTok of extracted) {
        const cleanToken = rawTok.toLowerCase();
        const tokHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
        if (existingTokenMap.has(tokHash) || existingTokenMap.has(cleanToken)) {
          const boundLane = existingTokenMap.get(tokHash) || existingTokenMap.get(cleanToken);
          if (boundLane !== numLane) {
            skippedCrossLaneCount++;
            crossLaneWarnings.push(cleanToken.slice(0, 6) + '... (既に Lane #0' + boundLane + ' に登録済み)');
            continue;
          }
        }
        existingTokenMap.set(tokHash, numLane);
        existingTokenMap.set(cleanToken, numLane);

        const encToken = encryptCredentials({ authToken: cleanToken });
        const maskedToken = cleanToken.slice(0, 4) + '...' + cleanToken.slice(-4);

        await db.collection('saas_accounts').doc(userId + '_L' + numLane + '_' + cleanToken.slice(0, 10)).set({
          ownerUserId: userId,
          laneIndex: numLane,
          authToken: maskedToken,
          authTokenHash: tokHash,
          encryptedAuthToken: encToken,
          username: '',
          role: '検証中',
          isActive: true,
          nextPostAt: new Date(0),
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        addedTokensCount++;
      }
      return res.json({
        ok: true,
        laneIndex: numLane,
        addedTokens: addedTokensCount,
        skippedCrossLaneCount,
        crossLaneWarnings
      });
    } catch (e) {
      return res.json({ ok: false, error: '設定保存中にエラーが発生しました: ' + e.message });
    }
  });

  
  app.post('/api/funnel/diagnose-account', async (req, res) => {
    try {
      const { userId, accountId } = req.body || {};
      if (!userId || !accountId) return res.json({ ok: false, error: 'Missing required parameters.' });
      const result = await diagnoseBurnerAccountHealthV3(String(accountId));
      return res.json(result);
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/funnel/promote-account', async (req, res) => {
    try {
      const { userId, accountId } = req.body || {};
      if (!userId || !accountId) return res.json({ ok: false });
      const doc = await db.collection('saas_accounts').doc(String(accountId)).get();
      if (doc.exists && doc.data().ownerUserId === userId) {
        await doc.ref.update({
          role: '最新',
          isActive: true,
          promotedAt: new Date(),
          nextPostAt: new Date(0),
          updatedAt: new Date()
        });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false });
    }
  });

  app.post('/api/funnel/delete-account', async (req, res) => {
    try {
      const { userId, accountId } = req.body || {};
      if (!userId || !accountId) return res.json({ ok: false, error: '削除対象のアカウントIDが指定されていません。' });
      const doc = await db.collection('saas_accounts').doc(String(accountId)).get();
      if (doc.exists && doc.data().ownerUserId === userId) {
        await doc.ref.delete();
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false, error: 'アカウント削除エラー: ' + e.message });
    }
  });

  app.post('/api/funnel/delete-post-template', async (req, res) => {
    try {
      const { userId, postId } = req.body || {};
      if (!userId || !postId) return res.json({ ok: false, error: '削除対象のテンプレートIDが指定されていません。' });
      const doc = await db.collection('saas_posts').doc(String(postId)).get();
      if (doc.exists && doc.data().ownerUserId === userId) {
        await doc.ref.delete();
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false, error: 'テンプレート削除エラー: ' + e.message });
    }
  });

  app.post('/api/funnel/edit-post-template', async (req, res) => {
    try {
      const { userId, postId, post, selfReplyText, imageBase64, imageUrl } = req.body || {};
      if (!userId || !postId || !post) return res.json({ ok: false, error: 'Missing post text or template ID.' });
      const doc = await db.collection('saas_posts').doc(String(postId)).get();
      if (!doc.exists || doc.data().ownerUserId !== userId) {
        return res.json({ ok: false, error: 'Target post template not found.' });
      }
      let finalImgUrl = typeof imageUrl === 'string' ? imageUrl.trim() : (doc.data().imageUrl || '');
      if (imageBase64 && String(imageBase64).startsWith('data:image/')) {
        const m = String(imageBase64).match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (!m) {
          return res.json({ ok: false, error: 'Unsupported image format (only PNG, JPG, WEBP, and GIF are supported).' });
        }
        const ext = m[1] === 'png' ? 'png' : (m[1] === 'webp' ? 'webp' : (m[1] === 'gif' ? 'gif' : 'jpg'));
        const fname = 'media_' + userId + '_' + Date.now() + '.' + ext;
        const mediaDir = path.join(__dirname, '../uploads/tenant_media');
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
        fs.writeFileSync(path.join(mediaDir, fname), Buffer.from(m[2], 'base64'));
        finalImgUrl = '/uploads/tenant_media/' + fname;
      }
      await doc.ref.update({
        text: String(post).slice(0, 280),
        selfReplyText: String(selfReplyText || '').trim().slice(0, 280),
        imageUrl: finalImgUrl,
        updatedAt: new Date()
      });
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false, error: 'テンプレート編集エラー: ' + e.message });
    }
  });

  app.post('/api/funnel/bulk-toggle-posts', async (req, res) => {
    try {
      const { userId, laneIndex, isEnabled } = req.body || {};
      if (!userId) return res.json({ ok: false, error: 'Authentication required. Please sign in.' });
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const snap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
      for (const d of snap.docs) {
        const docLane = parseInt(d.data().laneIndex || '1', 10);
        if (docLane === numLane) {
          await d.ref.update({ isEnabled: !!isEnabled, updatedAt: new Date() });
        }
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false, error: '一括切替エラー: ' + e.message });
    }
  });

  app.post('/api/funnel/toggle-engine-running', async (req, res) => {
    try {
      const { userId, laneIndex, isRunning } = req.body || {};
      if (!userId) return res.json({ ok: false, error: 'Authentication required. Please sign in.' });
      const lKey = String(Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10))));
      const uRef = db.collection('saas_users').doc(String(userId));
      const uSnap = await uRef.get();
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      lanes[lKey] = { ...(lanes[lKey] || {}), isEngineRunning: !!isRunning };
      await uRef.set({
        lanes,
        isEngineRunning: !!isRunning,
        updatedAt: new Date()
      }, { merge: true });
      return res.json({ ok: true, isEngineRunning: !!isRunning });
    } catch (e) {
      return res.json({ ok: false, error: '稼働状態切替エラー: ' + e.message });
    }
  });

  
  app.post('/api/funnel/trigger-lane-now', async (req, res) => {
    try {
      const { userId, laneIndex } = req.body || {};
      if (!userId) return res.json({ ok: false, error: 'Authentication required. Please sign in.' });
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));

      const pSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
      const activePosts = pSnap.docs.filter(d => {
        const pd = d.data() || {};
        return pd.isEnabled !== false && parseInt(pd.laneIndex || '1', 10) === numLane;
      });
      if (activePosts.length === 0) {
        return res.json({ ok: false, error: 'Stream Lane #0' + numLane + ' has no enabled post templates. Please add and enable at least 1 template first.' });
      }

      const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      const healthyAccs = aSnap.docs.filter(d => {
        const ad = d.data() || {};
        const banned = (ad.role === 'シャドウバン' || ad.role === 'ロボット' || ad.role === '利用不可' || ad.isActive === false);
        return parseInt(ad.laneIndex || '1', 10) === numLane && !banned;
      });
      if (healthyAccs.length === 0) {
        return res.json({ ok: false, error: 'Stream Lane #0' + numLane + ' has no healthy burner accounts. Please add a valid 40-char auth_token first.' });
      }

      // レーン内の全正常アカウントの nextPostAt を現在時刻(0)にリセットして即座にエンジンに拾わせる
      for (const accDoc of healthyAccs) {
        await accDoc.ref.update({ nextPostAt: new Date(0), updatedAt: new Date() });
      }

      const uRef = db.collection('saas_users').doc(String(userId));
      const uSnap = await uRef.get();
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      const lKey = String(numLane);
      lanes[lKey] = { ...(lanes[lKey] || {}), isEngineRunning: true, autoPostMode: true };
      await uRef.set({ lanes, isEngineRunning: true, updatedAt: new Date() }, { merge: true });
      try {
        const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
        const logFile = '/tmp/xsw_term_' + cleanUid + '_L' + numLane + '.json';
        const ts = new Date().toISOString().slice(11, 19);
        let arr = [];
        if (fs.existsSync(logFile)) { try { arr = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (e) {} }
        arr.push('[' + ts + '] [LANE #0' + numLane + '] ⚡ Manual immediate post triggered by operator. Queuing Stealth Chrome...');
        fs.writeFileSync(logFile, JSON.stringify(arr.slice(-80)), 'utf8');
      } catch (e) {}

      return res.json({
        ok: true,
        laneIndex: numLane,
        targetUsername: healthyAccs[0].data().username || healthyAccs[0].data().authToken.slice(0, 8)
      });
    } catch (e) {
      return res.json({ ok: false, error: '即時投稿トリガーエラー: ' + e.message });
    }
  });

  app.post('/api/funnel/reorder-post-template', async (req, res) => {
    try {
      const { userId, laneIndex, postId, direction } = req.body || {};
      if (!userId || !postId) return res.json({ ok: false });
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const pSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
      const laneDocs = pSnap.docs
        .filter(d => parseInt(d.data().laneIndex || '1', 10) === numLane)
        .map(d => {
          const pd = d.data() || {};
          const orderVal = typeof pd.sortOrder === 'number' ? pd.sortOrder : (pd.createdAt && pd.createdAt.toDate ? pd.createdAt.toDate().getTime() : 0);
          return { ref: d.ref, id: d.id, orderVal };
        })
        .sort((a, b) => a.orderVal - b.orderVal);

      // 連番の sortOrder (10, 20, 30...) を正規化割り当て
      for (let i = 0; i < laneDocs.length; i++) {
        laneDocs[i].normOrder = (i + 1) * 10;
      }
      const idx = laneDocs.findIndex(x => x.id === postId);
      if (idx === -1) return res.json({ ok: false });
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= laneDocs.length) return res.json({ ok: true });

      const tmp = laneDocs[idx].normOrder;
      laneDocs[idx].normOrder = laneDocs[swapIdx].normOrder;
      laneDocs[swapIdx].normOrder = tmp;

      await Promise.all(laneDocs.map(item => item.ref.update({ sortOrder: item.normOrder, updatedAt: new Date() })));
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/funnel/bulk-add-templates', async (req, res) => {
    try {
      const { userId, laneIndex, items } = req.body || {};
      if (!userId || !Array.isArray(items) || items.length === 0) {
        return res.json({ ok: false, error: 'Please enter at least one post line to import.' });
      }
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const existingSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
      const lanePosts = existingSnap.docs.filter(d => parseInt(d.data().laneIndex || '1', 10) === numLane);
      const remainingQuota = Math.max(0, 100 - lanePosts.length);
      if (remainingQuota === 0) {
        return res.json({ ok: false, error: 'このレーン（Lane #0' + numLane + '）は既に上限100件に達しています。' });
      }

      const toInsert = items.slice(0, remainingQuota);
      let baseOrder = Date.now();
      let addedCount = 0;
      for (const it of toInsert) {
        const txt = String(it.post || '').trim().slice(0, 280);
        const sRep = String(it.selfReplyText || '').trim().slice(0, 280);
        if (!txt) continue;
        baseOrder += 10;
        await db.collection('saas_posts').add({
          ownerUserId: userId,
          laneIndex: numLane,
          text: txt,
          selfReplyText: sRep,
          imageUrl: '',
          isEnabled: true,
          sortOrder: baseOrder,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        addedCount++;
      }
      return res.json({ ok: true, addedCount, totalInLane: lanePosts.length + addedCount });
    } catch (e) {
      return res.json({ ok: false, error: '一括登録エラー: ' + e.message });
    }
  });

  app.post('/api/funnel/add-post-template', async (req, res) => {
    try {
      const { userId, laneIndex, post, selfReplyText, imageBase64, imageUrl } = req.body || {};
      if (!userId) return res.json({ ok: false, error: 'Session expired. Please sign in again.' });
      if (!post) return res.json({ ok: false, error: 'Post text cannot be empty.' });
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));

      const existingSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
      const lanePosts = existingSnap.docs.filter(d => parseInt(d.data().laneIndex || '1', 10) === numLane);
      if (lanePosts.length >= 100) {
        return res.json({ ok: false, error: 'このレーン（Lane #0' + numLane + '）の保存上限（100パターン）に達しています。不要なテンプレートを削除してください。' });
      }

      let finalImgUrl = String(imageUrl || '').trim();
      if (imageBase64 && String(imageBase64).startsWith('data:image/')) {
        const m = String(imageBase64).match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (!m) {
          return res.json({ ok: false, error: 'Unsupported image format (only PNG, JPG, WEBP, and GIF are allowed).' });
        }
        const ext = m[1] === 'png' ? 'png' : (m[1] === 'webp' ? 'webp' : (m[1] === 'gif' ? 'gif' : 'jpg'));
        const fname = 'media_' + userId + '_L' + numLane + '_' + Date.now() + '.' + ext;
        const mediaDir = path.join(__dirname, '../uploads/tenant_media');
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
        fs.writeFileSync(path.join(mediaDir, fname), Buffer.from(m[2], 'base64'));
        finalImgUrl = '/uploads/tenant_media/' + fname;
      }

      await db.collection('saas_posts').add({
        ownerUserId: userId,
        laneIndex: numLane,
        text: String(post).slice(0, 280),
        selfReplyText: String(selfReplyText || '').trim().slice(0, 280),
        imageUrl: finalImgUrl,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return res.json({ ok: true, laneIndex: numLane, totalCount: lanePosts.length + 1 });
    } catch (e) {
      return res.json({ ok: false, error: 'テンプレート保存中にサーバーエラーが発生しました: ' + e.message });
    }
  });

  app.post('/api/funnel/toggle-post-template', async (req, res) => {
    try {
      const { userId, postId, isEnabled } = req.body || {};
      if (!userId || !postId) return res.json({ ok: false });
      const doc = await db.collection('saas_posts').doc(String(postId)).get();
      if (doc.exists && doc.data().ownerUserId === userId) {
        await doc.ref.update({ isEnabled: !!isEnabled, updatedAt: new Date() });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false });
    }
  });

  app.post('/api/funnel/update-post-mode', async (req, res) => {
    try {
      const { userId, laneIndex, postSelectionMode } = req.body || {};
      if (!userId) return res.json({ ok: false });
      const lKey = String(Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10))));
      const mode = postSelectionMode === 'random' ? 'random' : 'loop';
      const uRef = db.collection('saas_users').doc(String(userId));
      const uSnap = await uRef.get();
      const lanes = (uSnap.exists && uSnap.data().lanes) ? uSnap.data().lanes : {};
      lanes[lKey] = { ...(lanes[lKey] || {}), postSelectionMode: mode };
      await uRef.set({ lanes, postSelectionMode: mode, updatedAt: new Date() }, { merge: true });
      return res.json({ ok: true, postSelectionMode: mode });
    } catch (e) {
      return res.json({ ok: false });
    }
  });

  app.post('/api/funnel/request-delete-post', async (req, res) => {
    try {
      const { historyId } = req.body || {};
      if (!historyId) return res.json({ ok: false });
      await db.collection('saas_history').doc(String(historyId)).update({
        deleteReq: true,
        updatedAt: new Date()
      }).catch(() => {});
      const delRes = await executeSafeStealthDeleteTweet(String(historyId));
      return res.json({ ok: true, deleted: !!(delRes && delRes.deleted) });
    } catch (e) {
      return res.json({ ok: false });
    }
  });
}

function previewFactsFromClaims(claims) {
  return (Array.isArray(claims) ? claims : []).slice(0, 4).map(item => {
    const claim = [item && item.painScene, item && item.mechanism, item && item.proofQuote].filter(Boolean).join(' — ');
    return {
      claim,
      audience: item && item.audience ? String(item.audience) : ''
    };
  }).filter(item => item.claim);
}

const SHOWCASE_CJK = /[\u3040-\u30ff\u4e00-\u9fff]/;
const SHOWCASE_BANNED = /9割|月100時間|3\.2倍|3\.4倍|保存して後で見返|シャドウバン|7名|合議|凍結リスクゼロ|98\.4%|バズ保証/;

function showcaseHasCjk(value) {
  return SHOWCASE_CJK.test(String(value || ''));
}

function showcaseJobTime(row) {
  const raw = row && (row.scheduledAt || row.createdAt);
  const date = raw && raw.toDate ? raw.toDate() : new Date(raw || 0);
  const ms = date instanceof Date ? date.getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function showcaseTweetList(value) {
  const rows = Array.isArray(value) ? value : (value ? [value] : []);
  return rows.map(item => String(item || '').trim()).filter(Boolean);
}

function extractShowcaseTweets(row, key) {
  if (!row) return null;
  const groups = key === 'en'
    ? [row.tweets_en, row.tweets, [row.text_en], [row.text]]
    : [row.tweets, [row.text], [row.text_ja]];
  for (const group of groups) {
    const tweets = showcaseTweetList(group);
    if (!tweets.length || tweets.join('').length < 80) continue;
    if (tweets.some(text => SHOWCASE_BANNED.test(text))) continue;
    if (key === 'en' && tweets.some(text => SHOWCASE_CJK.test(text))) continue;
    if (key === 'ja' && !tweets.some(text => SHOWCASE_CJK.test(text))) continue;
    return tweets;
  }
  return null;
}

function selectShowcaseJob(rows, key) {
  const live = (Array.isArray(rows) ? rows : [])
    .filter(row => row && (row.status === 'pending' || row.status === 'posted'))
    .sort((a, b) => showcaseJobTime(b) - showcaseJobTime(a));
  const valid = live.map(row => ({ row, tweets: extractShowcaseTweets(row, key) })).filter(item => item.tweets);
  return valid.find(item => item.row.visualCard && item.row.visualCard.eligible === true) || valid[0] || null;
}

function showcaseCardMatchesLang(card, key) {
  const text = [card.title, card.leftText, card.rightText, card.footerCheck, card.badge, card.leftLabel, card.rightLabel].join('\n');
  if (SHOWCASE_BANNED.test(text)) return false;
  return key === 'en' ? !SHOWCASE_CJK.test(text) : SHOWCASE_CJK.test(text);
}

function filterShowcaseText(value, key) {
  const text = String(value || '').trim();
  if (!text || SHOWCASE_BANNED.test(text)) return '';
  if (key === 'en' && SHOWCASE_CJK.test(text)) return '';
  return text;
}

function filterShowcaseLines(values, key) {
  return (Array.isArray(values) ? values : []).map(item => filterShowcaseText(item, key)).filter(Boolean);
}

function filterShowcaseFacts(facts, key) {
  return (Array.isArray(facts) ? facts : []).map(item => ({
    claim: filterShowcaseText(item && item.claim, key),
    audience: filterShowcaseText(item && item.audience, key)
  })).filter(item => item.claim);
}

function showcaseEnglishKnowledge(knowledge) {
  const source = knowledge || {};
  return {
    ...source,
    productName: filterShowcaseText(source.productName, 'en'),
    oneLineMechanism: filterShowcaseText(source.oneLineMechanism, 'en')
  };
}

module.exports = {
  attachLuxuryWebFunnel,
  extractShowcaseTweets,
  selectShowcaseJob,
  previewFactsFromClaims,
  renderTopAppealPageHtml: renderUnifiedStoreAndCockpitHtml,
  renderStudioPageHtml: renderUnifiedStoreAndCockpitHtml
};
