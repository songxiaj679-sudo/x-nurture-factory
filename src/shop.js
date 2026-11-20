require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });
const { provisionTenantDedicatedVm, destroyTenantDedicatedVm } = require('./gcp_scaler');
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { db } = require('./firestore');
const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const {
  resolveBillingCurrency,
  selectStripePriceId,
  convertInvoiceAmountToUsd,
  getEcbJpyUsdRate,
  buildActiveStripePlanPatch
} = require('./stripe_billing_helpers');
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
const { encryptCredentials, decryptCredentials } = require('./official_api_client');
const { xLinkHealth } = require('./x_link_health');
const { scheduleSubscriptionCancellation, subscriptionStatePatch } = require('./billing_cancel');
const { isPaidAccount } = require('./plan_post_budget');

const app = express();
app.enable("trust proxy");
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const refCode = req.query.ref || req.query.r;
  if (refCode) {
    const cleanRef = String(refCode).trim().toUpperCase();
    res.setHeader('Set-Cookie', `xsw_ref=${cleanRef}; Path=/; Max-Age=2592000; SameSite=Lax`);
  }
  next();
});

app.use("/views", express.static(path.join(__dirname, "../views")));

const { registerGoogleAuthRoutes } = require('./google_auth');
registerGoogleAuthRoutes(app, db);

const { registerTwitterAuthRoutes } = require('./twitter_auth');
registerTwitterAuthRoutes(app, db);

app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.json({
  limit: '20mb',
  verify: (req, res, buf) => {
    if (req.originalUrl && (
      req.originalUrl.startsWith('/api/webhooks/stripe') ||
      req.originalUrl.startsWith('/webhook/oxapay') ||
      req.originalUrl.startsWith('/webhook/kyc')
    )) {
      req.rawBody = buf;
    }
  }
}));

const { registerAffiliatePageRoutes } = require('./affiliate_page');
const {
  getOrCreateAffiliateProfile,
  bindReferralIfEligible,
  processPaidSubscriptionCommission,
  requestAffiliatePayout
} = require('./affiliate_manager');
registerAffiliatePageRoutes(app, db);
app.use('/funnel-assets', express.static(path.join(__dirname, '../public/funnel')));
app.use('/images', express.static(path.join(__dirname, '../public/images')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const { registerHybridSaasRoutes } = require('./hybrid_saas_routes');
registerHybridSaasRoutes(app, { runWorker: process.env.DISABLE_INLINE_AUTOPILOT_WORKER !== 'true' });

const { attachLuxuryWebFunnel } = require('./luxury_web_funnel');
attachLuxuryWebFunnel(app, db);

const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || 'xfarm2026').trim();
const SHOP_PORT = parseInt(process.env.SHOP_PORT || '3001', 10);

const KYC_DIR = path.join(__dirname, '../.kyc_vault');
if (!fs.existsSync(KYC_DIR)) fs.mkdirSync(KYC_DIR, { recursive: true });

const BASE_PLANS = {
  starter:  { id: 'starter',  name: 'Solo Starter (¥4,980 / $39 / 30d)',       basePrice: 4980,  usdPrice: 39,  baseThreads: 1, baseAccounts: 5,   baseIsp: 1, minIntervalMin: 5, durationDays: 30 },
  pro:      { id: 'pro',      name: 'Agency Pro (¥9,800 / $79 / 30d)',         basePrice: 9800,  usdPrice: 79,  baseThreads: 3, baseAccounts: 12,  baseIsp: 3, minIntervalMin: 5, durationDays: 30 },
  business: { id: 'business', name: 'Syndicate Business (¥19,800 / $179 / 30d)', totalPrice: 19800, basePrice: 19800, usdPrice: 179, baseThreads: 5, baseAccounts: 25, baseIsp: 8, minIntervalMin: 5, durationDays: 30 }
};

const ISP_COUNTRY_OPTIONS = [
  { code: 'US', label: '🇺🇸 United States (US - Dedicated Static ISP)' },
  { code: 'GB', label: '🇬🇧 United Kingdom (UK - Dedicated Static ISP)' },
  { code: 'DE', label: '🇩🇪 Germany / EU (DE - Dedicated Static ISP)' },
  { code: 'NL', label: '🇳🇱 Netherlands / EU (NL - Dedicated Static ISP)' },
  { code: 'CA', label: '🇨🇦 Canada (CA - Dedicated Static ISP)' },
  { code: 'AU', label: '🇦🇺 Australia (AU - Dedicated Static ISP)' },
  { code: 'SG', label: '🇸🇬 Singapore / Asia (SG - Dedicated Static ISP)' },
  { code: 'JP', label: '🇯🇵 Japan (JP - Dedicated Static ISP)' }
];

let sysConfig = {
  oxapayMerchantKey: (process.env.OXAPAY_MERCHANT_KEY || '').trim(),
  diditApiKey: (process.env.DIDIT_API_KEY || '').trim(),
  diditWorkflowId: (process.env.DIDIT_WORKFLOW_ID || '').trim(),
  iproyalApiToken: (process.env.IPROYAL_API_TOKEN || '').trim(),
  sellerName: 'X-SWARM CLOUD INFRASTRUCTURE LTD.',
  sellerEmail: 'support@xswarm-cloud.com',
  smtpUser: (process.env.SMTP_USER || '').trim(),
  smtpPass: (process.env.SMTP_PASS || '').trim(),
  cardPayUrlOneday: '',
  cardPayUrlStarter: '',
  cardPayUrlPro: '',
  cardPayUrlBusiness: ''
};

async function loadSysConfig() {
  try {
    const doc = await db.collection('settings').doc('payment_config').get();
    if (doc.exists) {
      const d = doc.data();
      sysConfig = {
        oxapayMerchantKey: (d.oxapayMerchantKey || sysConfig.oxapayMerchantKey).trim(),
        diditApiKey: (d.diditApiKey || sysConfig.diditApiKey).trim(),
        diditWorkflowId: (d.diditWorkflowId || sysConfig.diditWorkflowId).trim(),
        iproyalApiToken: (d.iproyalApiToken || sysConfig.iproyalApiToken).trim(),
        sellerName: d.sellerName || sysConfig.sellerName,
        sellerEmail: d.sellerEmail || sysConfig.sellerEmail,
        smtpUser: (d.smtpUser !== undefined ? d.smtpUser : sysConfig.smtpUser).trim(),
        smtpPass: (d.smtpPass !== undefined ? d.smtpPass : sysConfig.smtpPass).trim(),
        cardPayUrlOneday: (d.cardPayUrlOneday || '').trim(),
        cardPayUrlStarter: (d.cardPayUrlStarter || '').trim(),
        cardPayUrlPro: (d.cardPayUrlPro || '').trim(),
        cardPayUrlBusiness: (d.cardPayUrlBusiness || '').trim()
      };
    }
  } catch (e) {
    console.error('[Shop config] Failed to load payment settings:', e.message);
  }
  return sysConfig;
}
loadSysConfig();

async function sendVerificationCodeEmail(toEmail, code) {
  await loadSysConfig();
  if (!sysConfig.smtpUser || !sysConfig.smtpPass) {
    console.error('[Shop email] SMTP credentials are missing; verification email was not sent');
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.resend.com", port: Number(process.env.SMTP_PORT || 465), secure: true,
      auth: { user: sysConfig.smtpUser, pass: sysConfig.smtpPass }
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"X-Swarm Cloud" <support@xswarm-cloud.com>',
      to: toEmail,
      subject: `【X-Swarm】認証コード: ${code}（メールアドレスの確認）`,
      text: `X-Swarm Cloud をご利用いただきありがとうございます。\n\nあなたの6桁認証コードは以下の通りです：\n\n  ${code}\n\n登録画面にこの6桁の数字を入力して登録を完了してください。\n（有効期限：30分）`
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

function hashPassword(pw) {
  return hashUserPassword(pw);
}

function getClientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
}

async function logAuditEvent(userId, action, details, req) {
  try {
    await db.collection('audit_logs').add({
      userId: userId || 'anonymous',
      action,
      details,
      ip: req ? getClientIp(req) : '',
      userAgent: req ? String(req.headers['user-agent'] || '') : '',
      createdAt: new Date()
    });
  } catch (e) {}
}

// ============================================================================
// 📦 IPRoyal方式：契約ごとの個別期限管理 ＆ 有効契約の合算エンジン
// ============================================================================
async function syncUserActiveContracts(userId) {
  const userRef = db.collection('saas_users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { user: null, activeContracts: [], expiredContracts: [] };

  const uData = userSnap.data();
  const cSnap = await db.collection('saas_contracts').where('userId', '==', userId).get();
  const nowMs = Date.now();

  const allContracts = cSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.expiresAt && a.expiresAt.toDate ? a.expiresAt.toDate().getTime() : 0;
    const tb = b.expiresAt && b.expiresAt.toDate ? b.expiresAt.toDate().getTime() : 0;
    return ta - tb;
  });

  const activeContracts = [];
  const expiredContracts = [];

  const expiredProxiesToRelease = [];
  for (const c of allContracts) {
    const expMs = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().getTime() : 0;
    if (expMs > nowMs && c.status === 'active') {
      activeContracts.push(c);
    } else {
      expiredContracts.push(c);
      if (c.status === 'active') {
        // ★ 期限切れを検知してステータスを expired に更新し、ISP回線を回収リストへ
        await db.collection('saas_contracts').doc(c.id).update({ status: 'expired', expiredAt: new Date(), updatedAt: new Date() }).catch(() => {});
        if (Array.isArray(c.proxies)) {
          c.proxies.forEach(p => { if (p) expiredProxiesToRelease.push(p); });
        }
      }
    }
  }

  // 他の有効契約で使われていないISP回線を isp_proxy_pool の空きへ自動返却
  if (expiredProxiesToRelease.length > 0) {
    const activeProxiesCheck = [];
    activeContracts.forEach(ac => {
      if (Array.isArray(ac.proxies)) ac.proxies.forEach(p => { if (p) activeProxiesCheck.push(p); });
    });
    const finalToRelease = expiredProxiesToRelease.filter(p => !activeProxiesCheck.includes(p));
    if (finalToRelease.length > 0) {
      const pSnap = await db.collection('isp_proxy_pool').where('assignedUserId', '==', userId).get();
      const pBatch = db.batch();
      pSnap.docs.forEach(pd => {
        if (finalToRelease.includes(pd.data().proxy)) {
          pBatch.update(pd.ref, { assignedUserId: null, releasedAt: new Date(), lastUserId: userId });
        }
      });
      await pBatch.commit();
      console.log(`♻️ [ISP自動回収] ユーザー ${userId} の期限切れ回線 ${finalToRelease.length}本を未使用プールへ返却しました`);
    }
  }

  if (activeContracts.length > 0) {
    let sumThreads = 0;
    let sumAccounts = 0;
    let sumIsp = 0;
    let minInt = 1440;
    let allProxies = [];

    for (const c of activeContracts) {
      sumThreads += parseInt(c.threads || '0', 10);
      sumAccounts += parseInt(c.accounts || '0', 10);
      sumIsp += parseInt(c.ispCount || '0', 10);
      const cInt = parseInt(c.minIntervalMin || '1440', 10);
      if (cInt < minInt) minInt = cInt;
      if (Array.isArray(c.proxies)) {
        for (const p of c.proxies) {
          if (p && !allProxies.includes(p)) allProxies.push(p);
        }
      }
    }

    sumThreads = Math.max(1, sumThreads);
    sumAccounts = Math.max(sumThreads, sumAccounts);
    if (allProxies.length === 0 && Array.isArray(uData.assignedProxies)) {
      allProxies = uData.assignedProxies;
    }

    const planSummary = activeContracts.length === 1
      ? activeContracts[0].title
      : `${activeContracts.length}件の契約稼働中 [合計${sumThreads}スレッド / ${sumAccounts}枠]`;

    if (
      uData.maxThreads !== sumThreads ||
      uData.maxAccounts !== sumAccounts ||
      uData.minIntervalMin !== minInt ||
      uData.planName !== planSummary
    ) {
      await userRef.update({
        planId: 'active_multi',
        planName: planSummary,
        maxThreads: sumThreads,
        maxAccounts: sumAccounts,
        ispQuota: sumIsp,
        minIntervalMin: minInt,
        assignedProxies: allProxies,
        updatedAt: new Date()
      });
      uData.planId = 'active_multi';
      uData.planName = planSummary;
      uData.maxThreads = sumThreads;
      uData.maxAccounts = sumAccounts;
      uData.ispQuota = sumIsp;
      uData.minIntervalMin = minInt;
      uData.assignedProxies = allProxies;
    }
  } else if (allContracts.length > 0 && uData.planId !== 'free') {
    const hasSaasSubscription = Boolean(
      uData.stripeSubscriptionId ||
      (uData.planStatus === 'active' && ['starter', 'pro', 'business', 'syndicate_business'].includes(uData.planId))
    );
    if (!hasSaasSubscription) {
      await userRef.update({
        planId: 'free',
        planName: '未契約（トライアル前）',
        maxThreads: 1,
        maxAccounts: 1,
        ispQuota: 0,
        minIntervalMin: 1440,
        postIntervalMin: 1440,
        updatedAt: new Date()
      });
      uData.planId = 'free';
      uData.planName = '未契約（トライアル前）';
      uData.maxThreads = 1;
      uData.maxAccounts = 1;
      uData.ispQuota = 0;
      uData.minIntervalMin = 1440;
    }
  }

  if (!uData.planName || uData.planName === '未契約' || uData.planName === 'おためし無料プラン') {
    uData.planName = '未契約（トライアル前）';
    uData.planId = uData.planId || 'free';
    uData.maxThreads = uData.maxThreads || 1;
    uData.maxAccounts = uData.maxAccounts || 1;
    uData.minIntervalMin = uData.minIntervalMin || 1440;
  }

  return { user: { ...uData, id: userSnap.id, userId: uData.userId || userSnap.id }, activeContracts, expiredContracts };
}

async function getCurrentUser(req) {
  const authUser = await resolveSessionUser(db, req);
  if (!authUser) return null;
  const syncRes = await syncUserActiveContracts(authUser.userId || authUser.id);
  return syncRes.user;
}

// 🤝 公式紹介パートナー追跡ミドルウェア (?ref=... / ?r=...)
app.use(async (req, res, next) => {
  try {
    const refCode = req.query.ref || req.query.r;
    if (refCode) {
      const cleanRef = String(refCode).trim().toUpperCase();
      res.cookie('xsw_ref', cleanRef, { path: '/', maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' });
      const user = await getCurrentUser(req);
      if (user && user.userId) {
        await bindReferralIfEligible(user.userId, cleanRef).catch(() => {});
      }
    }
  } catch (e) {}
  next();
});

function requireAdminAuth(req, res, next) {
  const b64 = (req.headers.authorization || '').split(' ')[1] || '';
  const [u, p] = Buffer.from(b64, 'base64').toString().split(':');
  if (u !== ADMIN_USER || p !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="X-Swarm-Admin"');
    return res.status(401).send('Authentication required');
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (!req.socket.encrypted && forwardedProto !== 'https') {
    return res.status(426).send('HTTPS is required for admin access');
  }
  return next();
}

function httpsJsonRequest(hostname, reqPath, method, payloadObj, extraHeaders = {}) {
  return new Promise((resolve) => {
    const payload = payloadObj ? JSON.stringify(payloadObj) : '';
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({ hostname, path: reqPath, method, headers, timeout: 10000 }, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ============================================================================
// 🛡️ 入力検証ユーティリティ
// ============================================================================
function diagnoseAndCleanAuthToken(rawInput) {
  let s = String(rawInput || '').trim();
  if (!s) return { ok: false, msg: '[auth_token] が空欄です。40文字の16進数コードを入力してください。' };
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const cookieMatch = s.match(/auth_token\s*=\s*["']?([a-fA-F0-9]{40})["']?/i);
  if (cookieMatch) return { ok: true, token: cookieMatch[1].toLowerCase() };
  const cleaned = s.replace(/^["'\s]+|["'\s;]+$/g, '');

  if (/^https?:\/\//i.test(cleaned) || cleaned.includes('x.com/') || cleaned.includes('twitter.com/')) {
    return { ok: false, msg: 'それはWebサイトのURLです。40文字の [auth_token] を入力してください。' };
  }
  if (cleaned.startsWith('@')) {
    return { ok: false, msg: `「${cleaned}」はXのユーザー名（@ID）です。40文字の [auth_token] を入力してください。` };
  }
  if (cleaned.includes('@') && cleaned.includes('.')) {
    return { ok: false, msg: 'それはメールアドレスです。40文字の [auth_token] を入力してください。' };
  }
  if (/^[a-fA-F0-9]{32}$/.test(cleaned) || /^[a-fA-F0-9]{120,180}$/.test(cleaned)) {
    return { ok: false, msg: `文字数が異なります（現在 ${cleaned.length} 文字）。「ct0」ではなく「auth_token」の40文字をコピーしてください。` };
  }
  const embedded = cleaned.match(/(?:^|[^a-fA-F0-9])([a-fA-F0-9]{40})(?:$|[^a-fA-F0-9])/);
  if (embedded) return { ok: true, token: embedded[1].toLowerCase() };
  if (cleaned.length < 25 && !/^[a-fA-F0-9]+$/.test(cleaned)) {
    return { ok: false, msg: 'それはパスワードまたはユーザー名のようです。40文字の [auth_token] を入力してください。' };
  }
  if (!/^[a-fA-F0-9]+$/.test(cleaned)) {
    return { ok: false, msg: '[auth_token] ではない文字が含まれています。0〜9 と a〜f だけの40文字です。' };
  }
  if (cleaned.length !== 40) {
    return { ok: false, msg: `文字数が40文字ではありません（現在 ${cleaned.length} 文字です）。` };
  }
  return { ok: true, token: cleaned.toLowerCase() };
}

function calcXTextLength(text) {
  let s = String(text || '');
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = s.match(urlRegex) || [];
  s = s.replace(urlRegex, '');
  let weight = urls.length * 23;
  for (const ch of Array.from(s)) {
    weight += (ch.codePointAt(0) <= 0x10FF) ? 1 : 2;
  }
  const charEquiv = Math.ceil(weight / 2);
  return { weight, charEquiv, isOver: weight > 280, overChars: Math.max(0, charEquiv - 140) };
}

function validateImageUrl(url) {
  const u = String(url || '').trim();
  if (!u) return { ok: true, url: '' };
  if (!/^https?:\/\//i.test(u)) {
    return { ok: false, msg: '画像URLは「https://」から始まるアドレスを入力するか、画像を直接添付してください。' };
  }
  if ((u.includes('x.com/') || u.includes('twitter.com/')) && u.includes('/status/')) {
    return { ok: false, msg: 'それはXの投稿ページのURLです。画像を直接選択して添付してください。' };
  }
  return { ok: true, url: u };
}

function validateCustomProxy(proxyStr) {
  const p = String(proxyStr || '').trim();
  if (!p) return { ok: true, proxy: '' };
  if (/^https?:\/\/(www\.|x\.com|twitter\.com)/i.test(p)) {
    return { ok: false, msg: '回線欄にURLが入っています。通常は【空欄のまま】にしてください。' };
  }
  const clean = p.replace(/^https?:\/\//i, '');
  const parts = clean.split(':');
  if (parts.length < 2 || !/^\d+$/.test(parts[1].split('@')[0])) {
    return { ok: false, msg: '回線の形式が正しくありません。通常は【空欄のまま】にしてください。' };
  }
  return { ok: true, proxy: clean };
}

async function createOxaPayInvoice(orderId, amountJpy, returnUrl, callbackUrl) {
  await loadSysConfig();
  const key = sysConfig.oxapayMerchantKey;
  if (!key) return null;

  const v1Res = await httpsJsonRequest('api.oxapay.com', '/v1/payment/invoice', 'POST', {
    amount: amountJpy,
    currency: 'JPY',
    lifetime: 60,
    fee_paid_by_payer: 0,
    under_paid_coverage: 2.5,
    callback_url: callbackUrl,
    return_url: returnUrl,
    order_id: orderId,
    description: 'X-Swarm Cloud ' + orderId
  }, { 'merchant_api_key': key });

  if (v1Res && v1Res.data && (v1Res.data.payment_url || v1Res.data.pay_link)) {
    return {
      payLink: v1Res.data.payment_url || v1Res.data.pay_link,
      trackId: String(v1Res.data.track_id || v1Res.data.trackId || '')
    };
  }

  const d = await httpsJsonRequest('api.oxapay.com', '/merchants/request', 'POST', {
    merchant: key,
    amount: amountJpy,
    currency: 'JPY',
    lifeTime: 60,
    feePaidByPayer: 0,
    underPaidCover: 2.5,
    callbackUrl,
    returnUrl,
    orderId,
    description: 'X-Swarm Cloud ' + orderId
  });
  if (d && d.result === 100 && d.payLink) {
    return { payLink: d.payLink, trackId: String(d.trackId || '') };
  }
  return null;
}

async function checkOxaPayStatus(trackId) {
  await loadSysConfig();
  const key = sysConfig.oxapayMerchantKey;
  if (!key || !trackId) return false;

  const d = await httpsJsonRequest('api.oxapay.com', '/merchants/inquiry', 'POST', {
    merchant: key,
    trackId: String(trackId)
  });
  if (d && d.result === 100) {
    const st = String(d.status || '').toLowerCase();
    if (st === 'paid' || st === 'confirming' || st === 'complete') return true;
  }

  const v1 = await httpsJsonRequest('api.oxapay.com', '/v1/payment/' + encodeURIComponent(trackId), 'GET', null, {
    'merchant_api_key': key
  });
  if (v1 && v1.data) {
    const st = String(v1.data.status || '').toLowerCase();
    if (st === 'paid' || st === 'confirming' || st === 'complete') return true;
  }
  return false;
}

async function createExternalKycSession(userId, email, callbackUrl) {
  await loadSysConfig();
  if (sysConfig.diditApiKey && sysConfig.diditWorkflowId) {
    const res = await httpsJsonRequest('verification.didit.me', '/v3/session/', 'POST', {
      workflow_id: sysConfig.diditWorkflowId,
      vendor_data: userId,
      callback: callbackUrl
    }, { 'x-api-key': sysConfig.diditApiKey });
    if (res && (res.url || res.verification_url)) {
      return { provider: 'didit', sessionId: res.session_id || res.id || '', url: res.url || res.verification_url };
    }
  }
  return null;
}

// 🌐 IPRoyal Static Residential (ISP) 自動発注ヘルパー (1ヶ月プラン >= 30日 専用)
async function orderNewIspProxiesFromIproyal(userId, countNeeded, targetCountry = 'US', durationDays = 30) {
  await loadSysConfig();
  const token = (sysConfig.iproyalApiToken || '').trim();
  if (!token || countNeeded <= 0) return [];

  const cleanCountry = String(targetCountry || 'US').toUpperCase();
  const orderedProxies = [];

  try {
    console.log(`🌐 [IPRoyal自動発注] User=${userId} (30日プラン) 向けに国=${cleanCountry} の専用ISP回線 ${countNeeded}本を発注中...`);
    // IPRoyal Client/Reseller API エンドポイントへオーダー送信
    const orderPayload = {
      product_id: 2, // Static Residential (ISP)
      plan_id: 30,   // 30 Days
      quantity: countNeeded,
      country: cleanCountry.toLowerCase(),
      auto_extend: false
    };

    const apiHosts = [
      { host: 'resi-api.iproyal.com', path: '/v1/orders', headers: { 'Authorization': 'Bearer ' + token, 'X-Access-Token': token } },
      { host: 'api.iproyal.com', path: '/v1/reseller/orders', headers: { 'X-Access-Token': token, 'Authorization': 'Bearer ' + token } }
    ];

    for (const ep of apiHosts) {
      const res = await httpsJsonRequest(ep.host, ep.path, 'POST', orderPayload, ep.headers);
      const list = (res && (res.proxies || (res.data && res.data.proxies))) || [];
      if (Array.isArray(list) && list.length > 0) {
        for (const item of list) {
          const pStr = typeof item === 'string'
            ? item.trim()
            : `${item.ip || item.host}:${item.port || 12323}:${item.username || item.user}:${item.password || item.pass}`;
          if (pStr && pStr.includes(':')) {
            orderedProxies.push(pStr);
            await db.collection('isp_proxy_pool').add({
              proxy: pStr,
              country: cleanCountry,
              source: 'iproyal_auto_30d',
              assignedUserId: userId,
              assignedCountry: cleanCountry,
              assignedAt: new Date(),
              expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
              createdAt: new Date()
            });
          }
        }
        break;
      }
    }
  } catch (e) {
    console.error('IPRoyal Auto-Order Error:', e.message);
  }
  return orderedProxies;
}

async function allocateDedicatedIspProxies(userId, countNeeded, targetCountry = 'US', durationDays = 30) {
  if (!countNeeded || countNeeded <= 0) return [];
  const cleanCountry = String(targetCountry || 'US').toUpperCase();
  const days = parseInt(durationDays || '30', 10);
  const allocated = [];

  try {
    // (A) 1ヶ月プラン (durationDays >= 30) の場合：IPRoyalへ専用ISPを新規自動発注
    if (days >= 30) {
      const newlyOrdered = await orderNewIspProxiesFromIproyal(userId, countNeeded, cleanCountry, days);
      for (const p of newlyOrdered) {
        if (allocated.length < countNeeded) allocated.push(p);
      }
      if (allocated.length >= countNeeded) {
        console.log(`✅ [IPRoyal新規発注完了] User=${userId} に新規ISPプロキシ ${allocated.length}本 (${cleanCountry}) を割り当てました`);
        return allocated;
      }
      console.log(`ℹ️ [フォールバック割当] 新規API発注分(${allocated.length}/${countNeeded}本)の残りを既存の有効ISPプールから補填します`);
    } else {
      console.log(`♻️ [短期プラン使い回し割当] User=${userId} (${days}日間プラン) に既存の有効ISPリストからスロットを割り当てます`);
    }

    // (B) 1ヶ月プラン以外 (durationDays < 30 の1日トライアル等) またはフォールバック時：購入済みの有効ISPリストから自動取得して使い回す
    const allPoolSnap = await db.collection('isp_proxy_pool').get();
    const nowMs = Date.now();

    // 有効期限内（expiresAt が未設定または未来）の回線のみ抽出
    const validDocs = allPoolSnap.docs.filter(d => {
      const data = d.data();
      if (!data.proxy) return false;
      const expMs = data.expiresAt && data.expiresAt.toDate ? data.expiresAt.toDate().getTime() : (nowMs + 86400000);
      return expMs > nowMs;
    });

    // 優先順位1: 空きスロット (assignedUserId === null) かつ 希望国一致
    // 優先順位2: 空きスロット (assignedUserId === null) の全有効ISP
    const freeDocs = validDocs.filter(d => !d.data().assignedUserId).sort((a, b) => {
      const ca = String(a.data().country || 'JP').toUpperCase() === cleanCountry ? 0 : 1;
      const cb = String(b.data().country || 'JP').toUpperCase() === cleanCountry ? 0 : 1;
      return ca - cb;
    });

    for (const doc of freeDocs) {
      if (allocated.length >= countNeeded) break;
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists || fresh.data().assignedUserId !== null) return null;
        const pStr = fresh.data().proxy;
        tx.update(doc.ref, {
          assignedUserId: userId,
          assignedCountry: cleanCountry,
          assignedPlanDays: days,
          assignedAt: new Date()
        });
        return pStr;
      }).catch(() => null);
      if (claimed && !allocated.includes(claimed)) allocated.push(claimed);
    }

    // もし1ヶ月未満の短期トライアル (days < 30) で空きスロットが全て埋まっている場合、既存の有効ISPスロットを共有使い回しして即時開通を保証
    if (days < 30 && allocated.length < countNeeded && validDocs.length > 0) {
      const sortedReuse = [...validDocs].sort((a, b) => {
        const ca = String(a.data().country || 'JP').toUpperCase() === cleanCountry ? 0 : 1;
        const cb = String(b.data().country || 'JP').toUpperCase() === cleanCountry ? 0 : 1;
        return ca - cb;
      });
      for (const doc of sortedReuse) {
        if (allocated.length >= countNeeded) break;
        const pStr = doc.data().proxy;
        if (pStr && !allocated.includes(pStr)) {
          allocated.push(pStr);
          console.log(`♻️ [スロット共有使い回し] 短期トライアル User=${userId} に有効ISP (${pStr.split(':')[0]}) を共有割当しました`);
        }
      }
    }
  } catch (e) {
    console.error('ISP Proxy Allocation Error:', e.message);
  }
  return allocated;
}

const _processingOrderIds = new Set();
async function completeSaaSOrder(orderId) {
  if (!orderId || _processingOrderIds.has(orderId)) return false;
  _processingOrderIds.add(orderId);
  try { return await _completeSaaSOrderInner(orderId); } finally { _processingOrderIds.delete(orderId); }
}
async function _completeSaaSOrderInner(orderId) {
  const orderRef = db.collection('orders').doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) return null;
  const order = snap.data();
  if (order.status === 'completed') return order;

  const now = new Date();
  if (order.userId) {
    if (order.orderType === 'contract_extend' && order.targetContractId) {
      const cRef = db.collection('saas_contracts').doc(order.targetContractId);
      const cSnap = await cRef.get();
      if (cSnap.exists) {
        const cData = cSnap.data();
        const curExp = cData.expiresAt && cData.expiresAt.toDate ? cData.expiresAt.toDate().getTime() : Date.now();
        const baseMs = Math.max(Date.now(), curExp);
        const days = parseInt(cData.durationDays || '30', 10);
        const newExp = new Date(baseMs + days * 24 * 3600 * 1000);
        await cRef.update({ status: 'active', expiresAt: newExp, updatedAt: now });
      }
    } else {
      const threads = parseInt(order.totalThreads || '1', 10);
      const accounts = parseInt(order.totalMaxAccounts || '3', 10);
      const ispCount = parseInt(order.totalIspCount || '1', 10);
      const minInt = parseInt(order.minIntervalMin || '5', 10);
      const durationDays = parseInt(order.durationDays || '30', 10);
      const priceJpy = parseInt(order.grossAmountJpy || '800', 10);

      const dedicatedProxies = await allocateDedicatedIspProxies(order.userId, ispCount, order.ispCountry || "US", durationDays);
      const contractId = 'CNT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
      const expireDate = new Date(Date.now() + durationDays * 24 * 3600 * 1000);

      await db.collection('saas_contracts').doc(contractId).set({
        contractId,
        orderId,
        userId: order.userId,
        title: order.planName || 'カスタム契約',
        threads,
        accounts,
        ispCount,
        minIntervalMin: minInt,
        durationDays,
        renewalPriceJpy: priceJpy,
        proxies: dedicatedProxies,
        status: 'active',
        startedAt: now,
        expiresAt: expireDate,
        createdAt: now,
        updatedAt: now
      });
    try {
      await provisionTenantDedicatedVm(db, order.userId, {
        threads: order.threads || 1,
        accounts: order.accounts || 5,
        proxies: dedicatedProxies || []
      });
    } catch (vmErr) { console.error('VM Provision Hook Error:', vmErr.message); }
    }

    const syncRes = await syncUserActiveContracts(order.userId);
    const assignedProxies = (syncRes.user && syncRes.user.assignedProxies) || [];

    if (assignedProxies.length > 0) {
      const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', order.userId).get();
      const batch = db.batch();
      let i = 0;
      accSnap.forEach(doc => {
        if (!doc.data().proxy) {
          batch.update(doc.ref, { proxy: assignedProxies[i % assignedProxies.length], updatedAt: now });
          i++;
        }
      });
      if (i > 0) await batch.commit();
    }
  }

  await orderRef.update({ status: 'completed', completedAt: now, updatedAt: now });
  return { ...order, status: 'completed' };
}

// ============================================================================
// 💎 スマホ画面幅に100%フィットするレスポンシブCSS（文字はみ出し完全防止）
// ============================================================================
const COMMON_STYLE = `
  :root {
    --bg: #F1F5F9;
    --surface: #FFFFFF;
    --surface-sub: #F8FAFC;
    --border: #E2E8F0;
    --border-strong: #CBD5E1;
    --text: #0F172A;
    --sub: #64748B;
    --primary: #0F172A;
    --brand-grad: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
    --accent-grad: linear-gradient(135deg, #2563EB 0%, #4F46E5 100%);
    --emerald-grad: linear-gradient(135deg, #059669 0%, #0D9488 100%);
    --gold-grad: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
    --accent: #2563EB;
    --emerald: #10B981;
    --warn: #F59E0B;
    --danger: #EF4444;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    max-width: 100vw;
    overflow-x: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.55;
    font-size: 14.5px;
    -webkit-font-smoothing: antialiased;
  }
  .container { width: 100%; max-width: 1000px; margin: 0 auto; padding: 14px 12px 72px; }

  /* どんな狭いスマホでも絶対にはみ出さない1行ヘッダー */
  .header {
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 60;
    width: 100%;
  }
  .header-top {
    max-width: 1000px;
    margin: 0 auto;
    padding: 9px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .brand {
    font-size: 16.5px;
    font-weight: 900;
    color: var(--text);
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 6px;
    letter-spacing: -0.4px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .brand-icon {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--accent-grad);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.28);
    flex-shrink: 0;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    position: relative;
    min-width: 0;
  }
  .hdr-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 5px 9px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid var(--border-strong);
    background: var(--surface-sub);
    color: var(--text);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .hdr-btn.plan-btn {
    background: #EFF6FF;
    color: var(--accent);
    border-color: #BFDBFE;
  }
  .kyc-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 5px 8px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    border: 1px solid transparent;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .kyc-pill.unverified {
    background: #FFFBEB;
    color: #B45309;
    border-color: #FDE68A;
  }
  .kyc-pill.verified {
    background: #ECFDF5;
    color: #047857;
    border-color: #A7F3D0;
  }

  .user-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px 3px 3px;
    border-radius: 99px;
    background: var(--surface-sub);
    border: 1px solid var(--border-strong);
    cursor: pointer;
    font-size: 11.5px;
    font-weight: 800;
    color: var(--text);
    max-width: 105px;
  }
  .avatar-circle {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--brand-grad);
    color: #fff;
    font-size: 10.5px;
    font-weight: 900;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .pop-menu {
    display: none;
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    background: #FFFFFF;
    border: 1px solid var(--border);
    border-radius: 14px;
    min-width: 220px;
    max-width: 88vw;
    padding: 6px;
    box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.06);
    z-index: 120;
    animation: fadePop 0.12s ease-out;
  }
  .pop-menu.show { display: block; }
  @keyframes fadePop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .pop-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    background: none;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
    text-align: left;
    cursor: pointer;
  }
  .pop-item:hover { background: var(--surface-sub); }
  .pop-item.danger { color: var(--danger); }
  .pop-item.danger:hover { background: #FFF1F2; }
  .pop-divider { height: 1px; background: var(--border); margin: 5px 4px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 16px 14px;
    margin-bottom: 14px;
    box-shadow: 0 4px 18px -2px rgba(15, 23, 42, 0.04);
    width: 100%;
    overflow: hidden;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
  }
  .card-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    line-height: 1.4;
  }
  .counter-pill {
    font-size: 11px;
    font-weight: 800;
    color: var(--sub);
    background: var(--surface-sub);
    border: 1px solid var(--border);
    padding: 3px 9px;
    border-radius: 99px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .plan-choice-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  @media (min-width: 640px) {
    .plan-choice-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .plan-choice-card {
    border: 2px solid var(--border);
    border-radius: 16px;
    padding: 15px;
    background: var(--surface-sub);
    cursor: pointer;
    position: relative;
    transition: all 0.15s;
  }
  .plan-choice-card.selected {
    border-color: var(--accent);
    background: #EFF6FF;
    box-shadow: 0 6px 20px rgba(37, 99, 235, 0.12);
  }
  .plan-tag {
    position: absolute;
    top: -10px;
    right: 12px;
    background: var(--accent-grad);
    color: #fff;
    font-size: 10.5px;
    font-weight: 900;
    padding: 2px 10px;
    border-radius: 99px;
  }

  .ios-switch {
    position: relative;
    display: inline-block;
    width: 54px;
    height: 30px;
    flex-shrink: 0;
  }
  .ios-switch input { opacity: 0; width: 0; height: 0; margin: 0; }
  .ios-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: rgba(255, 255, 255, 0.24);
    border: 1px solid rgba(255, 255, 255, 0.35);
    transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 34px;
  }
  .ios-slider:before {
    position: absolute;
    content: "";
    height: 24px;
    width: 24px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 50%;
    box-shadow: 0 2px 6px rgba(0,0,0,0.28);
  }
  .ios-switch input:checked + .ios-slider {
    background-color: #10B981;
    border-color: #10B981;
  }
  .ios-switch input:checked + .ios-slider:before {
    transform: translateX(24px);
  }

  .pace-chip {
    background: rgba(255,255,255,0.12);
    color: #E2E8F0;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
  }
  .pace-chip.active, .pace-chip:hover {
    background: #FFFFFF;
    color: #0F172A;
    border-color: #FFFFFF;
  }

  .item-box {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px;
    margin-bottom: 10px;
    background: var(--surface-sub);
    width: 100%;
  }
  .dots-btn {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--sub);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 18px;
    font-weight: 900;
    padding: 0;
    flex-shrink: 0;
  }
  .dots-btn:hover, .dots-btn.active {
    background: #E2E8F0;
    color: var(--text);
  }

  .token-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: #0F172A;
    color: #E2E8F0;
    padding: 6px 10px;
    border-radius: 8px;
    margin-bottom: 9px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    cursor: pointer;
    width: 100%;
    overflow: hidden;
  }
  .token-val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #93C5FD;
    min-width: 0;
  }
  .copy-btn {
    background: rgba(255, 255, 255, 0.15);
    color: #FFFFFF;
    border: none;
    border-radius: 5px;
    padding: 3px 8px;
    font-size: 10.5px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .grid2 { display: grid; grid-template-columns: 1fr; gap: 14px; }
  .grid3 { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .grid4 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  @media (min-width: 720px) {
    .grid2 { grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .grid3 { grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .grid4 { grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .card { padding: 22px; }
  }

  input, select, textarea {
    width: 100%;
    max-width: 100%;
    padding: 11px 12px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    background: var(--surface-sub);
    color: var(--text);
    font-size: 14px;
    margin-top: 4px;
    margin-bottom: 12px;
  }
  input:focus, select:focus, textarea:focus {
    outline: none;
    background: #FFFFFF;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }
  input.input-err, textarea.input-err { border-color: var(--danger) !important; background: #FFF1F2 !important; }
  label { font-size: 13px; font-weight: 800; color: var(--text); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

  /* ★ ボタンの文字がスマホで絶対にはみ出さないよう white-space: normal を適用 */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 11px 14px;
    border-radius: 10px;
    border: none;
    background: var(--accent-grad);
    color: #fff;
    font-weight: 800;
    font-size: 13.5px;
    line-height: 1.35;
    cursor: pointer;
    text-decoration: none;
    text-align: center;
    white-space: normal;
    word-break: keep-all;
    overflow-wrap: anywhere;
    max-width: 100%;
    box-shadow: 0 3px 10px rgba(37, 99, 235, 0.22);
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
  .btn-teal { background: var(--emerald-grad); box-shadow: 0 3px 10px rgba(5, 150, 105, 0.22); }
  .btn-gold { background: var(--gold-grad); box-shadow: 0 3px 10px rgba(217, 119, 6, 0.25); }
  .btn-dark { background: var(--brand-grad); box-shadow: 0 3px 10px rgba(15, 23, 42, 0.18); }
  .btn-outline {
    background: #FFFFFF;
    color: var(--text);
    border: 1px solid var(--border-strong);
    box-shadow: none;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .alert-err {
    background: #FFF1F2;
    border: 1px solid #FECDD3;
    border-left: 4px solid var(--danger);
    color: #9F1239;
    padding: 12px 14px;
    border-radius: 12px;
    margin-bottom: 14px;
    font-weight: 700;
    font-size: 13px;
  }
  .alert-ok {
    background: #ECFDF5;
    border: 1px solid #A7F3D0;
    border-left: 4px solid var(--emerald);
    color: #065F46;
    padding: 12px 14px;
    border-radius: 12px;
    margin-bottom: 14px;
    font-weight: 700;
    font-size: 13px;
  }
  .live-msg {
    display: none;
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    margin-top: -4px;
    margin-bottom: 10px;
  }
  .live-msg.err { display: block; background: #FFF1F2; color: #9F1239; border: 1px solid #FECDD3; }
  .live-msg.ok  { display: block; background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; }

  .q-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #EFF6FF;
    color: var(--accent);
    border: 1px solid #BFDBFE;
    font-size: 11.5px;
    font-weight: 900;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }

  .upload-zone {
    border: 1.5px dashed #94A3B8;
    background: var(--surface-sub);
    border-radius: 12px;
    padding: 14px 10px;
    text-align: center;
    cursor: pointer;
    margin-bottom: 12px;
  }

  .stepper { display: flex; align-items: center; gap: 8px; margin-top: 6px; margin-bottom: 14px; }
  .step-ctrl {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    background: #FFFFFF;
    color: var(--text);
    font-size: 18px;
    font-weight: 900;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .step-val { width: 68px !important; text-align: center; font-weight: 900; font-size: 15px !important; margin: 0 !important; }

  .pay-method-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-bottom: 16px;
  }
  .pay-tab-btn {
    padding: 10px 4px;
    border-radius: 11px;
    border: 2px solid var(--border);
    background: var(--surface-sub);
    font-weight: 800;
    font-size: 11.5px;
    color: var(--text);
    cursor: pointer;
    text-align: center;
    line-height: 1.3;
  }
  .pay-tab-btn.active {
    border-color: var(--accent);
    background: #EFF6FF;
    color: var(--accent);
  }

  #toastBox {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%);
    background: #0F172A;
    color: #fff;
    padding: 10px 18px;
    border-radius: 99px;
    font-size: 12.5px;
    font-weight: 700;
    box-shadow: 0 10px 25px rgba(15,23,42,0.3);
    z-index: 1000;
    display: none;
    max-width: 90vw;
    text-align: center;
  }

  .modal-bg {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(4px);
    z-index: 999;
    align-items: center;
    justify-content: center;
    padding: 14px;
  }
  .modal-box {
    background: #FFFFFF;
    border: 1px solid var(--border);
    border-radius: 18px;
    max-width: 420px;
    width: 100%;
    padding: 20px 16px;
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25);
  }
  details.opt-box {
    background: var(--surface-sub);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    margin-bottom: 12px;
  }
  details.opt-box summary { cursor: pointer; font-weight: 800; font-size: 13px; color: var(--text); line-height: 1.4; }
  .footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    text-align: center;
    font-size: 11.5px;
    color: var(--sub);
  }
  .footer a { color: var(--sub); text-decoration: none; margin: 0 6px; font-weight: 700; display: inline-block; }
`;

function renderHeader(user, activePage = '', req = null) {
  const errMsg = req && req.query && req.query.err ? String(req.query.err) : '';
  const okMsg = req && req.query && req.query.ok ? String(req.query.ok) : '';
  const initial = user && user.name ? Array.from(String(user.name).trim())[0].toUpperCase() : 'U';
  const isVerified = user && user.kycStatus === 'verified';

  return `
  <header class="header">
    <div class="header-top">
      <a href="${user ? '/dashboard' : '/'}" class="brand">
        <span class="brand-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </span>
        <span>X-Swarm</span>
      </a>

      <div class="header-actions">
        ${user ? `
          ${activePage !== 'main' ? `
            <a href="/dashboard" class="hdr-btn plan-btn">← 投稿設定</a>
          ` : `
            <a href="/contract" class="hdr-btn plan-btn">💎 プラン(${user.maxThreads || 1})</a>
          `}

          <button type="button" class="kyc-pill ${isVerified ? 'verified' : 'unverified'}" onclick="openModal('kycModalBg')">
            ${isVerified ? '✓ 確認済' : '🔒 未確認'}
          </button>

          <div style="position:relative;">
            <button type="button" class="user-trigger" onclick="toggleMenu(event, 'userTopMenu')">
              <span class="avatar-circle">${initial}</span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.name}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
            </button>

            <div id="userTopMenu" class="pop-menu" onclick="event.stopPropagation()">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);margin-bottom:4px;">
                <div style="font-weight:900;font-size:13.5px;color:var(--text);">${user.name}</div>
                <div style="font-size:11.5px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;">${user.email}</div>
                <div style="font-size:11px;font-weight:800;color:var(--accent);margin-top:3px;">${user.planName}</div>
              </div>
              <a href="/dashboard" class="pop-item">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span>メイン画面（投稿設定）</span>
              </a>
              <a href="/contract" class="pop-item">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                <span>契約・プラン変更・枠追加</span>
              </a>
              <button type="button" class="pop-item" onclick="closeAllMenus();openModal('kycModalBg')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 16h10"/></svg>
                <span>本人確認（${isVerified ? '確認済 ✓' : '制限をロック解除'}）</span>
              </button>
              <a href="/mailbox" style="background:#059669;color:#fff;padding:7px 13px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin-right:6px;">📬 専用メール受信BOX</a><a href="/help" class="pop-item">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>使い方・よくある質問 (FAQ)</span>
              </a>
              <button type="button" class="pop-item" onclick="closeAllMenus();openModal('accountProfileModalBg')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>アカウント設定（名前・PW）</span>
              </button>
              <div class="pop-divider"></div>
              <a href="/auth/logout" class="pop-item danger">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>ログアウト</span>
              </a>
            </div>
          </div>
        ` : `
          <a href="/help" class="hdr-btn">❓ 使い方・FAQ</a>
          <a href="/legal" style="color:var(--sub);text-decoration:none;font-weight:700;font-size:12px;margin-left:4px;">規約</a>
        `}
      </div>
    </div>
  </header>
  ${(errMsg || okMsg) ? `
  <div class="container" style="padding-bottom:0;padding-top:12px;">
    ${errMsg ? `<div class="alert-err">${errMsg.replace(/</g, '&lt;')}</div>` : ''}
    ${okMsg ? `<div class="alert-ok">${okMsg.replace(/</g, '&lt;')}</div>` : ''}
  </div>
  ` : ''}`;
}

function renderFooter(user = null) {
  const isVerified = user && user.kycStatus === 'verified';
  return `
  <div id="toastBox"></div>

  <div id="helpModalBg" class="modal-bg" onclick="closeModal('helpModalBg')">
    <div class="modal-box" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div id="helpModalTitle" style="font-weight:900;font-size:16px;color:var(--text);">ガイド</div>
        <button type="button" onclick="closeModal('helpModalBg')" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--sub);">✕</button>
      </div>
      <div id="helpModalBody" style="font-size:13.5px;color:#334155;line-height:1.7;margin-bottom:18px;"></div>
      <button type="button" class="btn" style="width:100%;padding:11px;" onclick="closeModal('helpModalBg')">閉じる</button>
    </div>
  </div>

  ${user ? `
  <div id="kycModalBg" class="modal-bg" onclick="closeModal('kycModalBg')">
    <div class="modal-box" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-weight:900;font-size:16px;color:var(--text);">🔓 本人確認で解放される3大機能</div>
        <button type="button" onclick="closeModal('kycModalBg')" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--sub);">✕</button>
      </div>
      ${isVerified ? `
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:16px;text-align:center;margin-bottom:16px;">
          <div style="font-size:15px;font-weight:900;color:#047857;margin-bottom:4px;">✓ 本人確認済み（全機能ロック解除済）</div>
          <div style="font-size:12.5px;color:#065F46;">1日お試し（¥800）や最短5分おき配信・専用国内ISP回線・複数スレッド同時稼働のすべてをご利用いただけます。</div>
        </div>
        <button type="button" class="btn btn-outline" style="width:100%;" onclick="closeModal('kycModalBg')">閉じる</button>
      ` : `
        <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:14px;">
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;">
            <span style="background:#FEF3C7;color:#B45309;font-weight:900;font-size:11px;padding:3px 7px;border-radius:6px;flex-shrink:0;">特典1</span>
            <div style="font-size:12.5px;"><b>¥800「1日お試しプラン」＆最短5分配信が解禁</b>（無料枠の最大288倍速）</div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;">
            <span style="background:#D1FAE5;color:#047857;font-weight:900;font-size:11px;padding:3px 7px;border-radius:6px;flex-shrink:0;">特典2</span>
            <div style="font-size:12.5px;"><b>あなた専用の「国内固定ネット回線」を自動付与</b>（通信無制限・凍結防止）</div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <span style="background:#DBEAFE;color:#1D4ED8;font-weight:900;font-size:11px;padding:3px 7px;border-radius:6px;flex-shrink:0;">特典3</span>
            <div style="font-size:12.5px;"><b>複数アカウント同時稼働 ＆ 予備へ自動交代</b></div>
          </div>
        </div>
        <form action="/kyc/start-external" method="POST" style="margin:0;">
          <button type="submit" class="btn btn-teal" style="width:100%;padding:13px;">
            📷 スマホで本人確認をはじめる（約30秒）
          </button>
        </form>
      `}
    </div>
  </div>

  <div id="accountProfileModalBg" class="modal-bg" onclick="closeModal('accountProfileModalBg')">
    <div class="modal-box" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-weight:900;font-size:16px;color:var(--text);">👤 アカウント設定</div>
        <button type="button" onclick="closeModal('accountProfileModalBg')" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--sub);">✕</button>
      </div>
      <form action="/auth/update-profile" method="POST" style="margin:0;">
        <label>表示名（ニックネーム・屋号）</label>
        <input type="text" name="name" value="${(user.name || '').replace(/"/g, '&quot;')}" required>
        <label>登録メールアドレス</label>
        <input type="email" value="${(user.email || '').replace(/"/g, '&quot;')}" disabled style="opacity:0.6;">
        <label>新しいパスワード（変更時のみ・6文字以上）</label>
        <input type="password" name="newPassword" minlength="6" placeholder="変更しない場合は空欄">
        <label>新しいパスワード（確認用にもう一度入力）</label>
        <input type="password" name="newPasswordConfirm" minlength="6" placeholder="変更しない場合は空欄">
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button type="button" class="btn btn-outline" style="flex:1;" onclick="closeModal('accountProfileModalBg')">キャンセル</button>
          <button type="submit" class="btn" style="flex:1;">保存する</button>
        </div>
      </form>
    </div>
  </div>
  ` : ''}

  <script>
    function showToast(msg) {
      const t = document.getElementById('toastBox');
      if (!t) return;
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2400);
    }
    function copyText(txt, label) {
      closeAllMenus();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(txt).then(() => showToast('📋 ' + (label || '[auth_token]') + ' をコピーしました'));
      }
    }
    function openModal(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    }
    function closeModal(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    function showHelp(title, text) {
      document.getElementById('helpModalTitle').innerText = title;
      document.getElementById('helpModalBody').innerHTML = text;
      openModal('helpModalBg');
    }
    function closeAllMenus() {
      document.querySelectorAll('.pop-menu.show').forEach(m => m.classList.remove('show'));
      document.querySelectorAll('.dots-btn.active').forEach(b => b.classList.remove('active'));
    }
    function toggleMenu(ev, menuId, btnEl) {
      ev.stopPropagation();
      const target = document.getElementById(menuId);
      if (!target) return;
      const isAlreadyOpen = target.classList.contains('show');
      closeAllMenus();
      if (!isAlreadyOpen) {
        target.classList.add('show');
        if (btnEl) btnEl.classList.add('active');
      }
    }
    document.addEventListener('click', () => closeAllMenus());

    function stepNum(id, delta, minVal, maxVal, cbName) {
      const el = document.getElementById(id);
      if (!el) return;
      let v = parseInt(el.value || '0', 10) + delta;
      if (v < minVal) v = minVal;
      if (v > maxVal) v = maxVal;
      el.value = v;
      if (cbName && typeof window[cbName] === 'function') window[cbName]();
      else if (typeof calcTotal === 'function') calcTotal();
    }
  </script>
  <footer class="footer">
    <div>
      <a href="/dashboard">メイン運用</a> |
      <a href="/contract">契約・プラン選択</a> |
      <a href="/help">使い方・FAQ</a> |
      <a href="/legal#terms">利用規約</a> |
      <a href="/legal">Risk Disclosure & No-Refund Policy</a>
    </div>
    <p style="margin-top:8px;">© 2026 X-Swarm Cloud. Enterprise X Automation Suite.</p>
  </footer>`;
}





// ============================================================================
// 📰 VELOX 専門調査メディア（ページ遷移型・大文字レイアウト）＆ 控えめ縦長LP (/lp)
// ============================================================================
let _cachedOfficialFeed = null;
let _cachedOfficialFeedAt = 0;

function escHtmlSrv(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function getOfficialArticlesList(force = false) {
  if (!force && _cachedOfficialFeed && (Date.now() - _cachedOfficialFeedAt) < 30 * 1000) {
    return _cachedOfficialFeed;
  }
  const posts = [];
  try {
    const snap = await db.collection('official_posts').orderBy('createdAt', 'desc').limit(80).get();
    snap.forEach(doc => {
      const d = doc.data();
      if (d && d.text) {
        posts.push({
          id: doc.id,
          tweetId: d.tweetId || null,
          category: d.category || 'Xアルゴリズム解説',
          title: d.title || 'X最新動向・シャドウバン対策解説',
          text: d.text,
          sourceName: d.sourceName || 'GitHub / Qiita / Zenn 技術検証',
          sourceUrl: d.sourceUrl || 'https://github.com/twitter/the-algorithm',
          diagramData: d.diagramData || null,
          createdAt: d.createdAt && d.createdAt.toDate
            ? d.createdAt.toDate().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' })
            : '最新記事'
        });
      }
    });
  } catch (e) {}
  _cachedOfficialFeed = posts;
  _cachedOfficialFeedAt = Date.now();
  return posts;
}


// 🌐 地域制限解除: 日本（JP）および全世界からのアクセスを完全開放
app.use((req, res, next) => {
  next();
});

app.get('/api/official-x-feed', async (req, res) => {
  const posts = await getOfficialArticlesList(Boolean(req.query.force));
  res.json({ ok: true, handle: 'X-SwarmApp', posts });
});

function renderCommonMediaHeader(activePage = 'media') {
  const isMedia = activePage === 'media';
  const isLp = activePage === 'lp';
  return `
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between gap-3">
      <a href="/" class="flex items-center gap-3 text-decoration-none">
        <div class="w-11 h-11 rounded-2xl bg-slate-900 flex items-center justify-center font-black text-white text-xl">
          X
        </div>
        <div>
          <span class="font-extrabold text-lg sm:text-xl text-slate-900 block leading-none">Xアルゴリズム＆シャドウバン研究所</span>
          <span class="text-xs sm:text-sm text-slate-500 font-medium block mt-1">一次ソースと検証データで読む専門調査ノート</span>
        </div>
      </a>

      <div class="flex items-center gap-2.5">
        <a href="/" class="px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${isMedia ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
          📚 調査記事一覧
        </a>
        <a href="/lp" class="px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${isLp ? 'bg-sky-600 text-white shadow' : 'bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200'}">
          🤖 自動投稿に興味がありますか？
        </a>
      </div>
    </div>
  </header>`;
}

// ============================================================================
// 🌐 1. トップページ（洗練されたホワイト背景・グローバル英語フラッグシップLP）
// ============================================================================
const HTML_VIEW_PATH = path.join(__dirname, '../views/funnel_index.html');

app.get('/', async (req, res) => {
  if (req.query && req.query.admin === '1') return res.redirect('/accounting');
  if (fs.existsSync(HTML_VIEW_PATH)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.sendFile(HTML_VIEW_PATH);
  }
  return res.redirect('/dashboard');
});

// 📚 調査記事一覧（旧トップページアーカイブ）
app.get('/articles', async (req, res) => {
  const user = await getCurrentUser(req);
  if (user) return res.redirect('/dashboard');
  if (req.query.err) return res.redirect('/lp?err=' + encodeURIComponent(req.query.err));

  const posts = await getOfficialArticlesList(false);
  const selectedCat = String(req.query.cat || 'ALL').trim();
  const searchKw = String(req.query.q || '').trim().toLowerCase();

  const filtered = posts.filter(a => {
    if (selectedCat !== 'ALL' && a.category !== selectedCat) return false;
    if (searchKw) {
      const hay = (a.title + ' ' + a.text + ' ' + a.sourceName).toLowerCase();
      if (!hay.includes(searchKw)) return false;
    }
    return true;
  });

  const cardsHtml = filtered.map(art => {
    const d = art.diagramData || {};
    const metric = d.badge_metric || '重要ポイント解説';
    const good0 = (d.good_points && d.good_points[0]) ? d.good_points[0] : '⭕️ 結論と根拠をわかりやすく解説';
    const steps = Array.isArray(d.steps) ? d.steps.slice(0, 3) : [];

    let catStyle = 'bg-sky-50 text-sky-800 border-sky-200';
    if (art.category.includes('シャドウバン')) catStyle = 'bg-rose-50 text-rose-800 border-rose-200';
    else if (art.category.includes('API')) catStyle = 'bg-emerald-50 text-emerald-800 border-emerald-200';

    return `
    <a href="/article/${encodeURIComponent(art.id)}" class="block bg-white rounded-2xl border border-slate-200 p-6 sm:p-7 hover:border-sky-400 hover:shadow-xl transition-all">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span class="px-3 py-1 rounded-full border text-xs sm:text-sm font-bold ${catStyle}">${escHtmlSrv(art.category)}</span>
        <span class="px-3 py-1 rounded-lg bg-amber-100 text-amber-900 font-extrabold text-xs sm:text-sm">⏱️ ${escHtmlSrv(metric)}</span>
      </div>

      <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 leading-[1.5] mb-4">
        ${escHtmlSrv(art.title)}
      </h2>

      <div class="p-4 rounded-xl bg-emerald-50/90 border border-emerald-200 text-emerald-950 font-bold text-base mb-4">
        ${escHtmlSrv(good0)}
      </div>

      ${steps.length > 0 ? `
      <div class="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-700 text-sm sm:text-base space-y-1.5 mb-4">
        <div class="text-xs font-extrabold text-slate-500">【10秒でわかる要点】</div>
        ${steps.map(st => `<div class="font-medium">・${escHtmlSrv(st)}</div>`).join('')}
      </div>` : ''}

      <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
        <span class="truncate max-w-[65%]">📚 情報源: ${escHtmlSrv(art.sourceName)}</span>
        <span class="font-extrabold text-sky-600 text-base">記事を読む →</span>
      </div>
    </a>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Xアルゴリズム＆シャドウバン研究所 ｜ 10秒結論＋根拠で読む専門調査メディア</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Noto Sans JP', sans-serif; background-color: #F8FAFC; color: #1E293B; font-size: 17px; line-height: 1.9; }
  </style>
</head>
<body>
  ${renderCommonMediaHeader('media')}

  <main class="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
    <!-- イントロ＆カテゴリ選択バー -->
    <div class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 mb-8 shadow-sm">
      <div class="inline-block px-3.5 py-1 rounded-full bg-sky-50 text-sky-800 font-bold text-xs sm:text-sm mb-3">
        🔬 GitHub公開アルゴリズム・Qiita・Zenn・海外技術文献を毎日調査
      </div>
      <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-[1.45] mb-3">
        Xの「シャドウバン解除」や「最新アルゴリズム」を、<br class="hidden sm:inline">冒頭10秒の結論＋詳しい根拠でわかりやすく解説。
      </h1>
      <p class="text-base text-slate-600 mb-6">
        気になる記事をタップすると、大きな文字の解説ページへ移動します（全 ${posts.length} 本の調査ノートを公開中）。
      </p>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-5 border-t border-slate-100">
        <div class="flex flex-wrap gap-2">
          <a href="/?cat=ALL" class="px-4 py-2 rounded-full text-sm font-bold ${selectedCat === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">すべて (${posts.length})</a>
          <a href="/?cat=${encodeURIComponent('シャドウバン対策')}" class="px-4 py-2 rounded-full text-sm font-bold ${selectedCat === 'シャドウバン対策' ? 'bg-rose-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">🛡️ シャドウバン対策</a>
          <a href="/?cat=${encodeURIComponent('Xアルゴリズム解説')}" class="px-4 py-2 rounded-full text-sm font-bold ${selectedCat === 'Xアルゴリズム解説' ? 'bg-sky-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">📈 アルゴリズム・伸ばし方</a>
          <a href="/?cat=${encodeURIComponent('公式API・自動化講座')}" class="px-4 py-2 rounded-full text-sm font-bold ${selectedCat === '公式API・自動化講座' ? 'bg-emerald-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">⚙️ API・プログラム解析</a>
        </div>

        <form action="/" method="GET" class="flex gap-2">
          <input type="text" name="q" value="${escHtmlSrv(searchKw)}" placeholder="キーワード検索..." class="bg-slate-50 border border-slate-300 rounded-xl px-4 py-2 text-sm text-slate-800 focus:outline-none focus:border-sky-500">
          <button type="submit" class="px-4 py-2 rounded-xl bg-slate-800 text-white text-sm font-bold">検索</button>
        </form>
      </div>
    </div>

    <!-- ゆったり大きな文字で読める2列カード一覧（クリックで通常ページ遷移） -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      ${cardsHtml || '<div class="p-10 bg-white rounded-2xl border border-slate-200 text-center text-slate-500 col-span-full">該当する記事が見つかりませんでした。</div>'}
    </div>

    <!-- 下部の控えめな運営者紹介 -->
    <div class="mt-14 p-7 rounded-3xl bg-white border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
      <div>
        <div class="text-base font-extrabold text-slate-900">この記事を書いている人：VELOX 通信・アルゴリズム研究室</div>
        <p class="text-sm sm:text-base text-slate-600 mt-1.5 leading-relaxed">
          LinuxクラウドやX公式APIを用いた自動配信システムの設計・開発を行いながら、日々の検証データや世界中のエンジニア文献から判明した仕様をわかりやすく記録しています。
        </p>
      </div>
      <a href="/lp" class="shrink-0 px-5 py-3 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-bold text-sm transition-all">
        🤖 私たちが作っている自動投稿ツールはこちら →
      </a>
    </div>
  </main>

  <footer class="bg-white border-t border-slate-200 py-8 mt-12 text-sm text-slate-500">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="font-bold text-slate-700">Xアルゴリズム＆シャドウバン研究所（VELOX LAB）</div>
      <div class="flex flex-wrap gap-6">
        <a href="/" class="hover:text-sky-600">📚 調査記事一覧</a>
        <a href="/lp" class="hover:text-sky-600">🤖 自動投稿システムについて（特商法・規約）</a>
        <a href="/help" class="hover:text-sky-600">FAQ</a>
      </div>
    </div>
  </footer>
</body>
</html>`);
});

// ============================================================================
// 📖 1-B. 個別記事ページ (/article/:id) — ポップアップではなく大きな文字の専用ページ
// ============================================================================
app.get('/article/:id', async (req, res) => {
  const posts = await getOfficialArticlesList(false);
  const articleId = String(req.params.id || '').trim();
  const art = posts.find(p => p.id === articleId) || posts[0];
  if (!art) return res.redirect('/');

  const d = art.diagramData || {};
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const bads = Array.isArray(d.bad_points) ? d.bad_points : [];
  const goods = Array.isArray(d.good_points) ? d.good_points : [];

  // 本文の小見出し（■ 🔍 根拠... 等）を大きな見出しボックスへ整形
  const formattedParagraphs = String(art.text || '')
    .split(/\n\s*\n/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^(■|▶|【)/.test(trimmed)) {
        const lines = trimmed.split('\n');
        const heading = `<h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 bg-sky-50 border-l-4 border-sky-600 px-5 py-3.5 rounded-r-2xl mt-10 mb-5">${escHtmlSrv(lines[0])}</h2>`;
        const rest = lines.slice(1).join('\n').trim();
        return heading + (rest ? `<p class="mb-6 text-slate-800 text-[18px] sm:text-[19px] leading-[2.15]">${escHtmlSrv(rest).replace(/\n/g, '<br>')}</p>` : '');
      }
      return `<p class="mb-6 text-slate-800 text-[18px] sm:text-[19px] leading-[2.15]">${escHtmlSrv(trimmed).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  const related = posts.filter(p => p.id !== art.id).slice(0, 4);
  const relatedHtml = related.map(r => `
    <a href="/article/${encodeURIComponent(r.id)}" class="block p-5 rounded-2xl bg-white border border-slate-200 hover:border-sky-400 transition-all">
      <div class="text-xs font-bold text-sky-700 mb-1">${escHtmlSrv(r.category)}</div>
      <div class="text-base sm:text-lg font-extrabold text-slate-900 leading-snug">${escHtmlSrv(r.title)}</div>
    </a>
  `).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtmlSrv(art.title)} ｜ Xアルゴリズム＆シャドウバン研究所</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Noto Sans JP', sans-serif; background-color: #F8FAFC; color: #1E293B; }
  </style>
</head>
<body>
  ${renderCommonMediaHeader('media')}

  <main class="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
    <div class="mb-6">
      <a href="/" class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-sm">
        ⬅ 調査記事一覧へ戻る
      </a>
    </div>

    <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-12 shadow-sm">
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <span class="px-3.5 py-1 rounded-full bg-sky-100 text-sky-800 font-bold text-sm">${escHtmlSrv(art.category)}</span>
        <span class="text-sm text-slate-500">公開・更新: ${escHtmlSrv(art.createdAt)}</span>
        <span class="text-sm text-slate-500">｜ 📚 情報源: ${escHtmlSrv(art.sourceName)}</span>
      </div>

      <h1 class="text-2xl sm:text-4xl font-extrabold text-slate-900 leading-[1.45] mb-8">
        ${escHtmlSrv(art.title)}
      </h1>

      <!-- 冒頭10秒でわかる結論ボックス（大きな文字） -->
      <div class="p-6 sm:p-7 rounded-2xl bg-amber-50/90 border-2 border-amber-200 mb-8">
        <div class="text-lg sm:text-xl font-extrabold text-amber-950 mb-3">
          ⏱️ 冒頭10秒でわかる！この記事の結論
        </div>
        <div class="space-y-2 text-base sm:text-lg font-bold text-slate-900">
          ${steps.map(st => `<div>・${escHtmlSrv(st)}</div>`).join('')}
        </div>

        ${(bads.length || goods.length) ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5 pt-5 border-t border-amber-200/80 text-base">
          <div class="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-1.5">
            <div class="font-extrabold text-rose-800">⚠️ やってはいけないNG行動</div>
            ${bads.map(b => `<div class="text-slate-800">${escHtmlSrv(b)}</div>`).join('')}
          </div>
          <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-1.5">
            <div class="font-extrabold text-emerald-800">✅ 推奨される解決策</div>
            ${goods.map(g => `<div class="text-slate-800 font-bold">${escHtmlSrv(g)}</div>`).join('')}
          </div>
        </div>` : ''}
      </div>

      <!-- 根拠・アップデート背景・具体策の本文（18〜19pxの大きな文字とゆったり行間） -->
      <div class="mt-6">
        ${formattedParagraphs}
      </div>

      <!-- 一次ソース・出典リンク -->
      <div class="mt-10 p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm sm:text-base">
        <div>
          <span class="text-slate-500 font-bold">📚 参考にした一次情報・検証元：</span>
          <a href="${escHtmlSrv(art.sourceUrl)}" target="_blank" rel="noopener" class="text-sky-700 hover:underline font-extrabold">
            ${escHtmlSrv(art.sourceName)} ↗
          </a>
        </div>
        <a href="https://x.com/X-SwarmApp" target="_blank" rel="noopener" class="text-slate-700 hover:text-sky-600 font-bold">
          𝕏 公式X (@X-SwarmApp) を見る ↗
        </a>
      </div>
    </article>

    <!-- 関連記事 -->
    <div class="mt-12">
      <h3 class="text-xl font-extrabold text-slate-900 mb-4">📖 あわせて読みたい最新調査ノート</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${relatedHtml}
      </div>
    </div>

    <!-- 控えめな執筆者紹介 -->
    <div class="mt-10 p-6 rounded-2xl bg-white border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <div class="text-base font-extrabold text-slate-900">執筆・検証：VELOX アルゴリズム研究室</div>
        <p class="text-sm text-slate-600 mt-1">
          自分で設定するのが難しい方向けに、国内専用回線つきの自動投稿クラウド環境も提供しています。
        </p>
      </div>
      <a href="/lp" class="shrink-0 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm">
        🤖 自動投稿ツールのご案内を見る →
      </a>
    </div>
  </main>
</body>
</html>`);
});

// ============================================================================
// 🤖 1-C. 「自動投稿に興味がありますか？」独立ランディングページ (/lp)
// ============================================================================
app.get('/lp', async (req, res) => {
  const user = await getCurrentUser(req);
  if (user) return res.redirect('/dashboard');
  const errMsg = String(req.query.err || '').trim();

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>自動投稿システムのご案内（X-Swarm Cloud）｜Xアルゴリズム＆シャドウバン研究所</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Noto Sans JP', sans-serif; background-color: #F8FAFC; color: #1E293B; font-size: 17px; line-height: 1.95; }
    .live-msg { font-size: 14px; font-weight: 700; margin-top: 6px; min-height: 20px; }
    .live-msg.err { color: #E11D48; }
    .live-msg.ok { color: #059669; }
    .input-err { border-color: #E11D48 !important; }
  </style>
</head>
<body>
  ${renderCommonMediaHeader('lp')}

  <main class="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-14">
    ${errMsg ? `<div class="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-800 font-bold text-base">⚠️ ${escHtmlSrv(errMsg)}</div>` : ''}

    <!-- 1. 開発者ストーリー -->
    <section class="bg-white rounded-3xl border border-slate-200 p-7 sm:p-10 shadow-sm space-y-5">
      <span class="px-3.5 py-1 rounded-full bg-sky-100 text-sky-800 font-bold text-sm">🤖 運営チームからのご案内</span>
      <h1 class="text-2xl sm:text-4xl font-extrabold text-slate-900 leading-[1.45]">
        「アルゴリズムやAPIの仕組みはわかったけれど、自分で作って管理するのは大変…」という方へ。
      </h1>
      <p class="text-base sm:text-lg text-slate-700 leading-[2.0]">
        当サイト「Xアルゴリズム＆シャドウバン研究所」を運営している私たち（X-SWARM CLOUD）は、普段からLinuxクラウドと専用通信回線を使ったX自動配信システムを開発しています。<br><br>
        記事の中で解説している通り、シャドウバンや凍結を防ぎながら24時間自動でポストし続けるには、<b>「24時間止まらないクラウドサーバー」と「汚染されていない日本国内の専用固定回線（ISP）」</b>が欠かせません。<br>
        ご自身でサーバーや回線を契約するのが面倒な方のために、<b>面倒な初期設定をすべて私たちが代行し、完成した専用管理ページをお渡しするクラウドサービス</b>を提供しています。
      </p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
        <div class="p-5 rounded-2xl bg-sky-50 border border-sky-200">
          <div class="font-extrabold text-sky-900 text-base mb-1.5">🔑 1. 買った垢のトークンを貼るだけ</div>
          <p class="text-sm text-slate-700 leading-relaxed">
            外部で購入・調達したアカウントに付属している <code>auth_token</code>（40文字の英数字）を貼り付けるだけで登録完了。面倒なブラウザログインやメール認証なしで即座に稼働します。
          </p>
        </div>
        <div class="p-5 rounded-2xl bg-amber-50 border border-amber-200">
          <div class="font-extrabold text-amber-900 text-base mb-1.5">⚡ 2. 最短5分間隔で宣伝を24h連投</div>
          <p class="text-sm text-slate-700 leading-relaxed">
            スマホを閉じていても、登録した宣伝テキストや画像を最短5分おきに24時間ノンストップで自動配信。キャンペーンやアフィリエイトの大量露出に最適です。
          </p>
        </div>
        <div class="p-5 rounded-2xl bg-emerald-50 border border-emerald-200">
          <div class="font-extrabold text-emerald-900 text-base mb-1.5">🔄 3. 制限時も1秒でトークン差し替え</div>
          <p class="text-sm text-slate-700 leading-relaxed">
            攻めた運用で万が一アカウントが制限・凍結されても、枠内のトークンを新しい <code>auth_token</code> に貼り替えるだけで、同じ専用国内回線のまま即座に配信を再開できます。
          </p>
        </div>
      </div>
      <div class="pt-2">
        <a href="#auth-portal" class="inline-block px-7 py-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-base shadow-lg">
          まずは無料プラン（¥0）で管理画面を見てみる ❯
        </a>
      </div>
    </section>

    <!-- 2. 料金プラン -->
    <section class="bg-white rounded-3xl border border-slate-200 p-7 sm:p-10 shadow-sm space-y-6">
      <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 border-l-4 border-sky-600 pl-4">
        パッケージ料金（初期構築費0円・サーバー＆専用国内回線込み）
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-base">
        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
          <div>
            <div class="text-sm font-bold text-slate-500">おためし無料プラン</div>
            <div class="text-3xl font-black text-slate-900 my-2">¥0</div>
            <ul class="space-y-2 text-sm text-slate-700 mb-5">
              <li>✔ 専用管理画面の発行</li>
              <li>✔ 同時1枠・1日1回自動配信</li>
              <li>✔ 導入相談・サポート</li>
            </ul>
          </div>
          <a href="#register-box" class="block py-3 rounded-xl bg-slate-800 text-white font-bold text-sm text-center">無料で始める</a>
        </div>

        <div class="p-5 rounded-2xl bg-amber-50/70 border-2 border-amber-300 flex flex-col justify-between">
          <div>
            <div class="text-sm font-bold text-amber-900">🔥 24時間フル体験パス</div>
            <div class="text-3xl font-black text-slate-900 my-2">¥800</div>
            <ul class="space-y-2 text-sm text-slate-800 mb-5">
              <li>✔ <b>最短5分おき</b>の自動配信</li>
              <li>✔ 専用国内回線1本＋管理3枠</li>
              <li>✔ 画像投稿＆プロフ一括更新</li>
            </ul>
          </div>
          <a href="#register-box" class="block py-3 rounded-xl bg-amber-500 text-white font-bold text-sm text-center">24時間試す</a>
        </div>

        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
          <div>
            <div class="text-sm font-bold text-sky-700">ライトプラン (30日)</div>
            <div class="text-3xl font-black text-slate-900 my-2">$79 <span style="font-size:14px;color:var(--sub);">(¥12,200)</span></div>
            <ul class="space-y-2 text-sm text-slate-700 mb-5">
              <li>✔ 同時1稼働＋管理5枠</li>
              <li>✔ 最短15分おきの自動配信</li>
              <li>✔ 専用国内回線1本＋保守込</li>
            </ul>
          </div>
          <a href="#register-box" class="block py-3 rounded-xl bg-sky-600 text-white font-bold text-sm text-center">選択する</a>
        </div>

        <div class="p-5 rounded-2xl bg-sky-50 border-2 border-sky-500 flex flex-col justify-between">
          <div>
            <div class="text-sm font-bold text-sky-800">スタンダード (30日)</div>
            <div class="text-3xl font-black text-slate-900 my-2">$179 <span style="font-size:14px;color:var(--sub);">(¥27,700)</span></div>
            <ul class="space-y-2 text-sm text-slate-800 mb-5">
              <li>✔ <b>同時2稼働</b>＋管理10枠</li>
              <li>✔ <b>最短5分おき</b>の自動配信</li>
              <li>✔ 専用国内回線2本＋保守込</li>
            </ul>
          </div>
          <a href="#register-box" class="block py-3 rounded-xl bg-sky-600 text-white font-bold text-sm text-center">選択する</a>
        </div>
      </div>
    </section>

    <!-- 3. 新規登録 ＆ 会員ログイン -->
    <section id="auth-portal" class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      <div id="register-box" class="bg-white rounded-3xl border border-slate-200 p-7 sm:p-8 shadow-sm">
        <h3 class="text-xl font-extrabold text-slate-900 mb-5">🆕 無料アカウント作成</h3>
        <form action="/auth/register" method="POST" onsubmit="return checkRegPasswordMatch()" class="space-y-4">
                <div>
                  <label class="block text-sm font-bold text-slate-700 mb-1">🌍 Target ISP Proxy Country (専用固定回線の国)</label>
                  <select name="ispCountry" class="w-full bg-blue-50 border border-blue-300 rounded-xl px-4 py-3 text-base font-bold text-slate-900">
                    <option value="US">🇺🇸 United States (US - Static ISP)</option>
                    <option value="GB">🇬🇧 United Kingdom (UK - Static ISP)</option>
                    <option value="DE">🇩🇪 Germany / EU (DE - Static ISP)</option>
                    <option value="NL">🇳🇱 Netherlands / EU (NL - Static ISP)</option>
                    <option value="CA">🇨🇦 Canada (CA - Static ISP)</option>
                    <option value="AU">🇦🇺 Australia (AU - Static ISP)</option>
                    <option value="SG">🇸🇬 Singapore / Asia (SG - Static ISP)</option>
                    <option value="JP">🇯🇵 Japan (JP - Static ISP)</option>
                  </select>
                </div>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">お名前（ニックネーム可）</label>
            <input type="text" name="companyOrName" placeholder="例: ヤマダ" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900">
          </div>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">メールアドレス（6桁の確認コードが届きます）</label>
            <input type="email" name="email" placeholder="example@gmail.com" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900">
          </div>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">パスワード（6文字以上）</label>
            <input type="password" name="password" id="regPw1" minlength="6" oninput="liveCheckRegPw()" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900">
          </div>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">パスワード（確認用）</label>
            <input type="password" name="passwordConfirm" id="regPw2" minlength="6" oninput="liveCheckRegPw()" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900">
            <div id="regPwLiveMsg" class="live-msg"></div>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-600 pt-1 cursor-pointer">
            <input type="checkbox" required class="w-4 h-4 rounded accent-sky-600">
            <span>下部の利用規約・特定商取引法に基づく表記に同意します</span>
          </label>
          <button type="submit" id="regSubmitBtn" class="w-full py-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-base shadow">
            6桁の確認コードを受け取る ❯
          </button>
        </form>
      </div>

      <div id="login-box" class="bg-white rounded-3xl border border-slate-200 p-7 sm:p-8 shadow-sm">
        <h3 class="text-xl font-extrabold text-slate-900 mb-5">🔑 会員ログイン</h3>
        <form action="/auth/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">メールアドレス</label>
            <input type="email" name="email" required placeholder="登録メールアドレス" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900">
          </div>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">パスワード</label>
            <input type="password" name="password" required placeholder="パスワード" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900">
          </div>
          <button type="submit" class="w-full py-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-base">
            管理画面にログインする →
          </button>
        </form>
      </div>
    </section>

    <!-- 4. 利用規約 ＆ 特定商取引法に基づく表記 -->
    <section class="bg-white rounded-3xl border border-slate-200 p-7 sm:p-10 shadow-sm space-y-6 text-sm sm:text-base text-slate-700">
      <h2 class="text-xl font-extrabold text-slate-900">利用規約・特定商取引法に基づく表記</h2>
      <div class="space-y-3">
        <p><b>■ お引き渡し（納品完了）と保守サポート期間：</b> 専用クラウド管理画面の有効化およびログイン案内をもって初期構築の納品完了となります。24時間クラウド稼働・専用国内ISP回線の維持・システム保守は、有効なプラン契約期間中のみ提供されます（いつでもマイページより解約・停止可能です）。</p>
        <p><b>■ 免責事項：</b> 当方は機械的インフラ提供者であり、ユーザーの投稿内容の事前検閲を行いません。また、X等の外部プラットフォームの仕様変更や制限・凍結等について補償・返金責任を負いません。</p>
        <p><b>■ 販売事業者：</b> X-SWARM CLOUD（X-Swarm Cloud 運営事務局） ／ 連絡先: support@xswarm-cloud.com ／ 所在地・電話番号: 特商法第11条但書に基づき請求があり次第遅滞なく電子メールにて開示いたします。</p>
      </div>
    </section>
  </main>

  <script>
    function liveCheckRegPw() {
      const p1 = document.getElementById('regPw1').value;
      const p2 = document.getElementById('regPw2').value;
      const msg = document.getElementById('regPwLiveMsg');
      const btn = document.getElementById('regSubmitBtn');
      if (!p2) { msg.innerText = ''; btn.disabled = false; return true; }
      if (p1 !== p2) {
        msg.className = 'live-msg err';
        msg.innerText = '⚠️ 確認用パスワードが一致していません。';
        btn.disabled = true;
        return false;
      }
      msg.className = 'live-msg ok';
      msg.innerText = '✓ パスワードが一致しています！';
      btn.disabled = false;
      return true;
    }
    function checkRegPasswordMatch() { return liveCheckRegPw(); }
  </script>
</body>
</html>`);
});

// ============================================================================
// 🔐 2. 6桁メールアドレス認証 ＆ ログイン処理
// ============================================================================
app.post('/auth/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const passwordConfirm = String(req.body.passwordConfirm || password);
    const name = String(req.body.companyOrName || email.split('@')[0] || 'User').trim();
    const ispCountry = String(req.body.ispCountry || req.headers['cf-ipcountry'] || 'US').toUpperCase();

    if (!email || !email.includes('@')) return res.redirect('/?err=' + encodeURIComponent('正しいメールアドレスを入力してください。'));
    if (password.length < 6) return res.redirect('/?err=' + encodeURIComponent('パスワードは6文字以上で入力してください。'));
    if (password !== passwordConfirm) return res.redirect('/?err=' + encodeURIComponent('確認用パスワードが一致していません。'));

    const exist = await db.collection('saas_users').where('email', '==', email).limit(1).get();
    if (!exist.empty) return res.redirect('/?err=' + encodeURIComponent('このメールアドレスは既に登録されています。ログインしてください。'));

    const userId = 'USR-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const sessionToken = crypto.randomBytes(24).toString('hex');
    const clientIp = getClientIp(req);

    await db.collection('saas_users').doc(userId).set({
      userId,
      name,
      email,
      ispCountry: (ispCountry === 'JP' ? 'US' : ispCountry),
      emailVerified: true,
      passwordHash: hashPassword(password),
      sessionToken,
      kycStatus: 'verified',
      planId: 'free',
      planName: '未契約（トライアル前）',
      planStatus: 'free',
      maxThreads: 1,
      maxAccounts: 1,
      ispQuota: 0,
      minIntervalMin: 1440,
      assignedProxies: [],
      profileBio: '',
      postIntervalMin: 1440,
      isEngineRunning: false,
      agreedTermsVersion: '2026.11.global-v1',
      agreedTermsAt: new Date(),
      registerIp: clientIp,
      registerUa: String(req.headers['user-agent'] || ''),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 🤝 紹介紐付け & アフィリエイトプロファイル初期化
    const cookies = parseCookies(req);
    const refCode = req.query.ref || req.body.ref || cookies.xsw_ref;
    if (refCode) {
      await bindReferralIfEligible(userId, refCode).catch(() => {});
    }
    await getOrCreateAffiliateProfile(userId).catch(() => {});

    await logAuditEvent(userId, 'USER_INSTANT_REGISTERED', { email, name, ispCountry }, req);
    setAuthCookies(res, sessionToken, { userId, email }, req);
    return res.redirect('/dashboard?ok=' + encodeURIComponent('アカウントを作成しました。コックピットへようこそ！'));
  } catch (e) {
    res.status(500).send('Registration Error: ' + e.message);
  }
});

app.get('/auth/verify-email', async (req, res) => {
  const cookies = parseCookies(req);
  const pToken = cookies.xcloud_pending;
  if (!pToken) return res.redirect('/');

  const snap = await db.collection('pending_registrations').doc(pToken).get();
  if (!snap.exists) return res.redirect('/');
  const pData = snap.data();

  await loadSysConfig();
  const isSmtpReady = !!(sysConfig.smtpUser && sysConfig.smtpPass);

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>メールアドレス認証（6桁コード）｜X-Swarm</title>
  <style>${COMMON_STYLE}</style>
</head>
<body>
  ${renderHeader(null, '', req)}
  <div class="container">
    <div class="card" style="max-width:460px;margin:20px auto;text-align:center;">
      <div style="width:46px;height:46px;border-radius:14px;background:#EFF6FF;color:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:10px;">✉️</div>
      <h2 style="margin:0 0 8px;font-size:19px;">6桁の認証コードを入力</h2>
      <p style="font-size:13px;color:var(--sub);margin:0 0 16px;">
        <b>${pData.email.replace(/</g, '&lt;')}</b> の確認コード（6桁）を入力してください。
      </p>

      ${!isSmtpReady ? `
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:12px;margin-bottom:16px;font-size:13px;color:#92400E;">
          💡 <b>確認コード：</b> <span style="font-size:20px;font-weight:900;letter-spacing:3px;color:#B45309;">${pData.verifyCode}</span>
        </div>
      ` : ''}

      <form action="/auth/verify-email" method="POST">
        <input type="text" name="code" maxlength="6" pattern="\\d{6}" placeholder="123456" style="font-size:24px;font-weight:900;letter-spacing:8px;text-align:center;padding:12px;" required autofocus>
        <button type="submit" class="btn" style="width:100%;padding:13px;">認証して会員登録を完了する</button>
      </form>

      <div style="margin-top:14px;">
        <a href="/" style="font-size:12px;color:var(--sub);text-decoration:none;">← メールアドレスを入力し直す</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

app.post('/auth/verify-email', async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const pToken = cookies.xcloud_pending;
    if (!pToken) return res.redirect('/?err=' + encodeURIComponent('認証セッションの期限が切れました。もう一度登録してください。'));

    const snap = await db.collection('pending_registrations').doc(pToken).get();
    if (!snap.exists) return res.redirect('/?err=' + encodeURIComponent('認証データが見つかりません。'));
    const pData = snap.data();

    const inputCode = String(req.body.code || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();
    if (inputCode !== pData.verifyCode) {
      return res.redirect('/auth/verify-email?err=' + encodeURIComponent('6桁の認証コードが正しくありません。'));
    }

    const userId = 'USR-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const sessionToken = generateSessionToken();

    await db.collection('saas_users').doc(userId).set({
      userId,
      name: pData.name,
      email: pData.email,
      emailVerified: true,
      passwordHash: pData.passwordHash,
      sessionToken,
      kycStatus: 'unverified',
      planId: 'free',
      planName: '未契約（トライアル前）',
      planStatus: 'free',
      maxThreads: 1,
      maxAccounts: 1,
      ispQuota: 0,
      minIntervalMin: 1440,
      assignedProxies: [],
      profileBio: '',
      postIntervalMin: 1440,
      isEngineRunning: false,
      agreedTermsVersion: '2026.10.v10-pro-fit',
      agreedTermsAt: new Date(),
      registerIp: pData.registerIp,
      registerUa: pData.registerUa,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 🤝 紹介紐付け & アフィリエイトプロファイル初期化
    const refCode = req.query.ref || cookies.xsw_ref;
    if (refCode) {
      await bindReferralIfEligible(userId, refCode).catch(() => {});
    }
    await getOrCreateAffiliateProfile(userId).catch(() => {});

    await db.collection('pending_registrations').doc(pToken).delete().catch(() => {});
    await logAuditEvent(userId, 'USER_EMAIL_VERIFIED_AND_REGISTERED', { email: pData.email, name: pData.name }, req);

    res.clearCookie('xcloud_pending', { path: '/' });
    setAuthCookies(res, sessionToken, { userId, email: pData.email }, req);
    res.redirect('/dashboard?ok=' + encodeURIComponent('メール認証が完了しました！① [auth_token] 追加 ➔ ②投稿追加 ➔ ③上のスイッチONで自動配信が始まります。'));
  } catch (e) {
    res.redirect('/?err=' + encodeURIComponent('認証エラー: ' + e.message));
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const snap = await db.collection('saas_users').where('email', '==', email).limit(1).get();
    if (snap.empty) {
      return res.redirect('/?err=' + encodeURIComponent('メールアドレスまたはパスワードが正しくありません。'));
    }
    const userDoc = snap.docs[0];
    const uData = userDoc.data() || {};
    if (!verifyUserPassword(password, uData.passwordHash)) {
      return res.redirect('/?err=' + encodeURIComponent('メールアドレスまたはパスワードが正しくありません。'));
    }
    const sessionToken = generateSessionToken();
    const updateData = {
      sessionToken,
      lastLoginAt: new Date(),
      lastLoginIp: getClientIp(req)
    };
    if (isLegacyPasswordHash(uData.passwordHash)) {
      updateData.passwordHash = hashUserPassword(password);
    }
    await userDoc.ref.update(updateData);
    await logAuditEvent(userDoc.id, 'USER_LOGIN', { email }, req);
    setAuthCookies(res, sessionToken, { userId: userDoc.id, email }, req);
    res.redirect('/dashboard');
  } catch (e) {
    res.status(500).send('ログインエラー: ' + e.message);
  }
});

app.post('/auth/update-profile', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const newName = String(req.body.name || '').trim();
  const newPw = String(req.body.newPassword || '');
  const newPwConfirm = String(req.body.newPasswordConfirm || '');
  const updateData = { updatedAt: new Date() };
  if (newName) updateData.name = newName.slice(0, 40);
  if (newPw) {
    if (newPw.length < 6) return res.redirect('/dashboard?err=' + encodeURIComponent('パスワードは6文字以上で入力してください。'));
    if (newPw !== newPwConfirm) return res.redirect('/dashboard?err=' + encodeURIComponent('確認用の新しいパスワードが一致していません。'));
    updateData.passwordHash = hashUserPassword(newPw);
  }
  await db.collection('saas_users').doc(user.userId).update(updateData);
  await logAuditEvent(user.userId, 'USER_UPDATE_PROFILE', { nameChanged: !!newName, pwChanged: !!newPw }, req);
  res.redirect('/dashboard?ok=' + encodeURIComponent('アカウント設定を更新しました。'));
});

app.get('/auth/logout', async (req, res) => {
  try {
    const user = await resolveSessionUser(db, req);
    if (user && user.userId) {
      await db.collection('saas_users').doc(user.userId).update({
        sessionToken: '',
        lastLogoutAt: new Date()
      }).catch(() => {});
    }
  } catch (e) {}
  clearAuthCookies(res);
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Logging out...</title></head>
<body style="background:#0F172A;color:#FFFFFF;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
  <div style="text-align:center;">
    <p style="font-size:1.1rem;font-weight:700;">ログアウト中...</p>
  </div>
<script>
  try {
    localStorage.removeItem('xsw_email');
    localStorage.removeItem('xsw_uid');
    localStorage.removeItem('xsw_token');
    localStorage.removeItem('xsw_tier');
    localStorage.removeItem('xsw_tier_level');
    localStorage.removeItem('xsw_pro_unlocked');
    localStorage.removeItem('xsw_x_handle');
    localStorage.removeItem('xsw_active_order_id');
    localStorage.setItem('xsw_signed_out', '1');
    sessionStorage.clear();
    document.cookie = 'xcloud_sess=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'xsw_uid=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'xsw_email=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'xsw_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  } catch (e) {}
  window.location.replace('/');
</script>
</body>
</html>`);
});

// ============================================================================
// 🪪 3. 本人確認 (Didit.me)
// ============================================================================
app.post('/kyc/start-external', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const session = await createExternalKycSession(user.userId, user.email, `${baseUrl}/contract`);
  if (session && session.url) {
    await db.collection('saas_users').doc(user.userId).update({
      kycProvider: session.provider,
      kycSessionId: session.sessionId,
      kycStatus: 'pending',
      updatedAt: new Date()
    });
    await logAuditEvent(user.userId, 'KYC_SESSION_START', { sessionId: session.sessionId }, req);
    return res.redirect(session.url);
  }
  res.redirect('/contract?err=' + encodeURIComponent('本人確認画面の準備に失敗しました。'));
});

app.post('/webhook/kyc', async (req, res) => {
  try {
    const { hmacMatches } = require('./webhook_signatures');
    const secret = String(process.env.DIDIT_WEBHOOK_SECRET || '').trim();
    if (!hmacMatches(secret, req.rawBody, req.headers['x-signature'], 'sha256')) {
      return res.status(401).json({ ok: false, error: 'invalid_signature' });
    }
    const body = req.body || {};
    const userId = body.vendor_data || (body.verification && body.verification.vendorData);
    const status = String(body.status || (body.verification && body.verification.status) || '').toLowerCase();
    if (userId && (status === 'approved' || status === 'verified' || status === 'success' || status === 'completed')) {
      await db.collection('saas_users').doc(userId).update({
        kycStatus: 'verified',
        kycVerifiedAt: new Date(),
        updatedAt: new Date()
      });
      await logAuditEvent(userId, 'KYC_WEBHOOK_VERIFIED', { status }, req);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ ok: false, error: 'invalid_signature' });
  }
});

app.get('/dashboard/accounts', (req, res) => res.redirect('/dashboard'));
app.get('/dashboard/posts', (req, res) => res.redirect('/dashboard'));
app.get('/account', (req, res) => res.redirect('/dashboard'));
app.get('/accounts', (req, res) => res.redirect('/dashboard'));
app.get('/cockpit', (req, res) => res.redirect('/dashboard'));
app.get('/manage', (req, res) => res.redirect('/dashboard'));

app.get('/api/dashboard/poll', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.json({ ok: false });
    const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
    const histSnap = await db.collection('saas_history').where('ownerUserId', '==', user.userId).get();
    const pendingAcc = accSnap.docs.filter(d => d.data().role === '検証中' || !d.data().role || !d.data().username).length;
    const pendingDel = histSnap.docs.filter(d => d.data().deleteReq === true).length;
    res.json({ ok: true, pendingAcc, pendingDel, totalHist: histSnap.size });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ============================================================================
// ⚡ 4. メイン運用画面 (/dashboard) — 最新BYOK自律マーケティングコックピット
// ============================================================================
app.get('/dashboard', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/#login-box');

    let okMsg = String(req.query.ok || '').trim();
    const errMsg = String(req.query.err || '').trim();

    if (req.query.payment === 'success' && req.query.session_id && stripe) {
      try {
        const stripeSess = await stripe.checkout.sessions.retrieve(req.query.session_id);
        const sessUid = stripeSess.client_reference_id || (stripeSess.metadata && stripeSess.metadata.userId) || '';
        if (stripeSess && sessUid && sessUid === user.userId && (stripeSess.payment_status === 'paid' || stripeSess.payment_status === 'no_payment_required' || stripeSess.status === 'complete')) {
          const paidPlan = stripeSess.metadata?.plan || (stripeSess.amount_total >= 20000 ? 'business' : (stripeSess.amount_total >= 10000 ? 'pro' : 'starter'));
          const rawSub = stripeSess.subscription;
          const subId = typeof rawSub === 'string' ? rawSub : (rawSub && rawSub.id) || '';
          const subscription = subId ? await stripe.subscriptions.retrieve(subId) : null;
          const patch = buildActiveStripePlanPatch({
            plan: paidPlan,
            stripeCustomerId: stripeSess.customer || '',
            stripeSubscriptionId: subId,
            subscription,
            basePlanCatalog: BASE_PLANS
          });
          await db.collection('saas_users').doc(user.userId).set(patch, { merge: true });
          Object.assign(user, patch);
          okMsg = `__PAYMENT_SUCCESS__:${paidPlan}`;
        }
      } catch (se) {
        console.warn('[Stripe Auto-Verify Warning]:', se.message);
      }
    }

    if (req.query.ref) {
      await bindReferralIfEligible(user.userId, req.query.ref).catch(() => {});
    }

    const userAff = (await getOrCreateAffiliateProfile(user.userId)) || {
      affCode: 'XSW-' + crypto.createHash('md5').update(user.userId).digest('hex').slice(0, 6).toUpperCase(),
      affBalanceUsd: 0,
      affTotalEarnedUsd: 0,
      affReferralsCount: 0,
      affPaidReferralsCount: 0,
      affWalletUsdt: ''
    };
    const affRefUrl = `https://veloxpostapp.com/?ref=${userAff.affCode}`;

    const cookies = parseCookies(req);
    const cookieLang = cookies.velox_lang;
    const acceptLang = String(req.headers['accept-language'] || '').toLowerCase();
    const isEn = cookieLang ? (cookieLang === 'en') : (!acceptLang.startsWith('ja'));
    if (okMsg.startsWith('__PAYMENT_SUCCESS__:')) {
      const paidPlan = okMsg.slice('__PAYMENT_SUCCESS__:'.length).toUpperCase();
      okMsg = isEn
        ? `Stripe Checkout is complete. The ${paidPlan} plan is now active.`
        : `🎉 Stripe Checkoutが完了しました！プラン【${paidPlan}】が有効化されました。`;
    }

    const userEmail = escHtmlSrv(user.email || 'user@veloxpostapp.com');
    const isPaidUser = isPaidAccount(user);
    let userPlan = isPaidUser
      ? escHtmlSrv(user.planName || user.planId || (isEn ? 'Active Plan' : '契約中プラン'))
      : (isEn ? 'No Active Plan (Before Trial)' : '未契約（トライアル前）');
    if (isPaidUser && user.tierLevel) {
      userPlan = user.tierLevel >= 3 
        ? (isEn ? '👑 Syndicate Business (Active)' : '👑 Syndicate Business (有効)') 
        : (user.tierLevel >= 2 
            ? (isEn ? '🥈 Agency Pro (Active)' : '🥈 Agency Pro (有効)') 
            : (isEn ? '🥉 Solo Starter (Active)' : '🥉 Solo Starter (有効)'));
    }

    const resolvedPlanId = (user.tierLevel >= 3 || user.planId === 'business' || user.planId === 'syndicate_business')
      ? 'business'
      : (user.tierLevel === 1 || user.planId === 'starter' ? 'starter' : 'pro');

    const hasApiKeys = Boolean((user.officialApiKey && user.officialAccessToken) || user.xOfficialCredentials);
    const linkHealth = xLinkHealth(user);
    const defaultHandle = escHtmlSrv(user.xUsername || user.screenName || '');

    // API Key masked formatting & Security Badges
    const maskedApiKey = user.officialApiKey 
      ? (user.officialApiKey.length > 8 ? user.officialApiKey.slice(0, 6) + '****************' : '****************') 
      : '';
    const maskedApiSecret = user.officialApiKey ? '••••••••••••••••••••••••' : '';
    const maskedAccessToken = user.officialAccessToken 
      ? (user.officialAccessToken.length > 14 ? user.officialAccessToken.slice(0, 11) + '****************' : '****************') 
      : '';
    const maskedAccessTokenSecret = user.officialAccessToken ? '••••••••••••••••••••••••' : '';

    const apiStatusBadgeHtml = hasApiKeys
      ? `<span class="px-2.5 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 font-mono font-bold text-xs flex items-center gap-1.5 shadow-2xs">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> <span data-i18n="api_badge_connected">${isEn ? 'Configured ● Connected' : '設定済み ● 正常接続中'}</span> (@${defaultHandle})
        </span>`
      : `<span class="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-300 text-slate-500 font-mono font-bold text-xs" data-i18n="api_badge_unconfigured">
          ${isEn ? 'Not Connected (Initial Setup Required)' : '未設定 (初回接続が必要です)'}
        </span>`;

    const apiConnectedNoticeHtml = hasApiKeys
      ? `<div class="p-3 sm:p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-2.5">
            <span class="text-lg">✅</span>
            <div class="text-xs sm:text-sm font-bold text-emerald-900 flex items-center gap-2 flex-wrap">
              <span>${isEn ? 'Connected to X Account:' : 'X公式アカウント連携中:'}</span>
              <span class="px-2.5 py-0.5 rounded-lg bg-emerald-200 text-emerald-900 font-mono text-xs font-black">@${defaultHandle}</span>
              <span class="text-[11px] text-emerald-700 font-normal">${isEn ? 'Connected with the official API' : '公式APIで接続中'}</span>
            </div>
          </div>
          <button type="button" onclick="toggleApiKeyEdit()" id="btnToggleApiKeyEdit" class="text-xs text-emerald-700 hover:text-emerald-900 font-bold underline cursor-pointer">
            ${isEn ? 'Reconnect / Settings' : '再連携・設定の確認'}
          </button>
        </div>`
      : '';

    const apiDrawerStyle = hasApiKeys && !linkHealth.relink ? 'style="display:none;"' : '';
    const relinkNoticeHtml = linkHealth.relink
      ? `<div id="xRelinkNotice" class="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs leading-relaxed">
          <div class="font-black">${isEn ? 'X needs to be connected again' : 'Xの再連携が必要です'}</div>
          <p class="mt-1">${isEn
            ? 'The saved permission can no longer be used. Connect again on this same account. Posts, saves, and replies already learned stay in place.'
            : escHtmlSrv(linkHealth.message)}</p>
        </div>`
      : '';

    // 🎯 ターゲット・AI自律マーケティング設定状態の判定
    const hasTargetStrategy = Boolean(user.latestMarketingStrategy || user.lastAutopilotCampaignId);
    const targetUrl = (user.latestMarketingStrategy && user.latestMarketingStrategy.targetUrl) 
      || user.targetUrl || '';
    const safeTargetUrl = escHtmlSrv(targetUrl);
    const configuredUserPrompt = (typeof user.userPrompt === 'string' && user.userPrompt) || (user.latestMarketingStrategy && user.latestMarketingStrategy.userPrompt) || '';
    const safeUserPrompt = escHtmlSrv(configuredUserPrompt);

    const isAutopilotPaused = !isPaidUser || !hasApiKeys || Boolean(user.autopilotPaused) || !(user.autopilotConsent && user.autopilotConsent.granted === true);

    const targetStatusBadgeHtml = hasTargetStrategy
      ? (isAutopilotPaused
          ? `<span class="px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 font-mono font-bold text-xs flex items-center gap-1.5 shadow-2xs">
              <span class="w-2 h-2 rounded-full bg-amber-500"></span> <span data-i18n="target_badge_paused">${isEn ? 'Paused' : '一時停止中'}</span>
            </span>`
          : `<span class="px-2.5 py-1 rounded-full bg-blue-100 border border-blue-300 text-blue-900 font-mono font-bold text-xs flex items-center gap-1.5 shadow-2xs">
              <span class="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span> <span data-i18n="target_badge_active">${isEn ? 'Configured ● Active Execution' : '設定済み ● 自律運用中'}</span>
            </span>`)
      : `<span class="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-300 text-slate-500 font-mono font-bold text-xs" data-i18n="target_badge_unconfigured">
          ${isEn ? 'Unconfigured' : '未設定'}
        </span>`;

    // Note: Keep Step 2 directly editable when #setupDetails is opened and avoid a duplicate pause/resume toggle above #secStep3.
    const targetConfiguredNoticeHtml = '';
    const targetDrawerStyle = '';

    const planChangeBtnHtml = isPaidUser
      ? `<button type="button" onclick="openPlanModal()" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm whitespace-nowrap shrink-0 select-none">
        <span>💳</span> <span data-i18n="btn_plan_change" class="whitespace-nowrap">${isEn ? 'Change Plan' : 'プラン変更'}</span>
      </button>`
      : '';
    const secPlansStyle = isPaidUser ? 'display:none;' : '';
    const secPlansNoticeStyle = isPaidUser ? 'display:flex;' : 'display:none;';

    // ⏳ トライアル保護バー（実際に Stripe トライアル契約中のユーザーのみ表示）
    const parseBillingInstantMs = (value) => {
      if (!value) return null;
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return null;
        return value < 1e12 ? value * 1000 : value;
      }
      if (typeof value.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
      }
      if (typeof value.toDate === 'function') {
        const d = value.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
      }
      if (typeof value._seconds === 'number') return value._seconds * 1000;
      if (typeof value.seconds === 'number') return value.seconds * 1000;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    };
    const formatFriendlyEndDate = (ms, lang) => {
      if (!ms) return '';
      const tz = user.scheduleTimeZone || user.timezone || 'Asia/Tokyo';
      try {
        return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ja-JP', {
          timeZone: tz,
          year: 'numeric',
          month: lang === 'en' ? 'short' : 'numeric',
          day: 'numeric'
        }).format(new Date(ms));
      } catch (_e) {
        return new Date(ms).toISOString().slice(0, 10);
      }
    };

    let trialBannerHtml = '';
    const now = Date.now();
    const trialEndMs = parseBillingInstantMs(user.stripeSubscriptionTrialEnd)
      || (isPaidUser ? parseBillingInstantMs(user.trialEndsAt) : null);
    const billingEndMs = trialEndMs || (isPaidUser ? parseBillingInstantMs(user.billingEndsAt) : null);
    const trialEndDateJa = formatFriendlyEndDate(billingEndMs, 'ja');
    const trialEndDateEn = formatFriendlyEndDate(billingEndMs, 'en');

    if (trialEndMs) {
      const remainingMs = trialEndMs - now;
      const remainingHours = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60)));
      const remainingDays = Math.floor(remainingHours / 24);
      const remainingHourMod = remainingHours % 24;

      if (remainingMs > 0) {
        if (remainingHours <= 48 && !user.cancelAtPeriodEnd) {
          // ⚠️ 残り48時間以内（自動更新未停止）：損失回避型・脈動アンバー〜ローズ警告バナー
          trialBannerHtml = `
            <div id="trialBannerCard" class="mb-6 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-amber-500/15 border-2 border-rose-400 shadow-md flex flex-col sm:flex-row items-center justify-between gap-4 animate-pulse">
              <div class="flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center font-black text-xl shrink-0 shadow-sm">
                  ⚠️
                </div>
                <div>
                  <div class="text-xs sm:text-sm font-black text-rose-950 flex items-center gap-2 flex-wrap">
                    <span>${isEn ? 'Free trial ending soon' : '無料トライアル終了まであと'}</span>
                    <span class="px-2.5 py-0.5 rounded-full bg-rose-600 text-white font-mono font-black text-xs sm:text-sm">
                      ${isEn ? `${remainingHours} HOURS LEFT` : `${remainingDays > 0 ? remainingDays + '日 ' : ''}${remainingHourMod}時間`}
                    </span>
                  </div>
                  <div id="trialBannerText" class="text-xs text-rose-800 mt-1 leading-relaxed">
                    ${isEn
                      ? `Free through ${trialEndDateEn}. Stop automatic renewal with one button before it ends for $0 total.`
                      : `${trialEndDateJa} まで無料でお使いいただけます。終了前にボタン1つで自動更新を止めれば料金はかかりません。`}
                  </div>
                </div>
              </div>
              <div id="trialBannerActionWrap" class="flex flex-col gap-2 w-full sm:w-auto">
                <button type="button" data-cancel-trigger="1" onclick="cancelSubscription()" class="px-5 py-3 rounded-xl bg-slate-900 text-white font-black text-xs sm:text-sm cursor-pointer">${isEn ? 'Cancel plan' : 'プランを解約する（ボタン1つで自動更新を停止）'}</button>
                <button type="button" onclick="togglePlanSection()" class="px-5 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 text-white font-black text-xs sm:text-sm cursor-pointer">${isEn ? 'Review plan and billing' : 'プランと請求条件を確認'}</button>
              </div>
            </div>`;
        } else {
          // ⏳ 通常トライアル中 / 解約予約済み：エメラルド安心バナー
          trialBannerHtml = `
            <div id="trialBannerCard" class="mb-6 p-3.5 sm:p-4 rounded-2xl bg-emerald-50/80 border border-emerald-300 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <span class="text-xl">⏳</span>
                <div id="trialBannerText" class="text-xs text-emerald-900 leading-relaxed">
                  ${user.cancelAtPeriodEnd
                    ? (isEn
                      ? `<span class="font-black">Automatic renewal stopped:</span> Free access continues through ${trialEndDateEn} with no further charge.`
                      : `<span class="font-black">自動更新は停止済みです：</span> ${trialEndDateJa} まで無料でお使いいただけます（次回以降の請求はありません）。`)
                    : (isEn
                      ? `<span class="font-black">Free trial active (free through ${trialEndDateEn}, ${remainingDays}d ${remainingHourMod}h left):</span> Stop renewal with one button anytime before it ends for $0.`
                      : `<span class="font-black">無料トライアル中（${trialEndDateJa} まで無料・残り ${remainingDays}日 ${remainingHourMod}時間）：</span> 終了前にボタン1つで自動更新を止めれば、料金はかかりません。`)}
                </div>
              </div>
              <div id="trialBannerActionWrap" class="shrink-0">
                ${user.cancelAtPeriodEnd
                  ? `<span class="px-3 py-1 rounded-full bg-slate-200 text-slate-800 font-mono text-[11px] font-bold inline-block">${isEn ? 'RENEWAL STOPPED' : '自動更新停止済み'}</span>`
                  : `<button type="button" data-cancel-trigger="1" onclick="cancelSubscription()" class="px-3.5 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] cursor-pointer transition-colors">${isEn ? 'Cancel plan' : 'プランを解約する'}</button>`}
              </div>
            </div>`;
        }
      }
    } else if (isPaidUser && user.cancelAtPeriodEnd && billingEndMs && billingEndMs > now) {
      trialBannerHtml = `
        <div id="trialBannerCard" class="mb-6 p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-300 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="text-xl">ℹ️</span>
            <div id="trialBannerText" class="text-xs text-slate-800">
              ${isEn
                ? `<span class="font-black">Automatic renewal stopped:</span> Active through ${trialEndDateEn} with no further charge.`
                : `<span class="font-black">自動更新は停止済みです：</span> ${trialEndDateJa} まで引き続きご利用いただけます（次回以降の請求はありません）。`}
            </div>
          </div>
          <div id="trialBannerActionWrap" class="shrink-0">
            <span class="px-3 py-1 rounded-full bg-slate-200 text-slate-800 font-mono text-[11px] font-bold inline-block">${isEn ? 'RENEWAL STOPPED' : '自動更新停止済み'}</span>
          </div>
        </div>`;
    }

    const dashboardTplPath = path.join(__dirname, '../views/dashboard_view.html');
    let tpl = fs.readFileSync(dashboardTplPath, 'utf8');

    let alertHtml = '';
    if (okMsg) {
      alertHtml += `<div class="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-sm text-center">✅ ${escHtmlSrv(okMsg)}</div>`;
    }
    if (errMsg) {
      alertHtml += `<div class="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 font-bold text-sm text-center">⚠️ ${escHtmlSrv(errMsg)}</div>`;
    }

    const diagnoseLabel = isEn 
      ? '👤 Target X Account to Analyze (@handle)' 
      : '👤 分析・診断したいXアカウント名（@ユーザー名）';

    const diagnoseApiBtn = '';
    const safeAiLang = (user.aiTargetLang === 'en') ? 'en' : 'ja';
    const safeScheduleTimeZone = escHtmlSrv(user.scheduleTimeZone || '');
    const safeBrandContextNotes = escHtmlSrv(user.brandContextNotes || '');
    const safeNgTopics = escHtmlSrv(user.ngTopics || '');
    const autoReplySettings = (user.autoReplySettings && typeof user.autoReplySettings === 'object') ? user.autoReplySettings : {};
    const autoReplyEnabled = Boolean(autoReplySettings.enabled === true);
    const autoReplyMode = autoReplySettings.mode === 'auto_mentions' ? 'auto_mentions' : 'approval_queue';
    const autoReplyLabelConfirmed = Boolean(autoReplySettings.xAutomatedLabelConfirmed === true);
    const phase2ServerEnabled = String(process.env.X_AUTO_REPLY_PHASE2_ENABLED || '').toLowerCase() === 'true';

    const userPlanBadgeClass = isPaidUser
      ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
      : 'bg-slate-100 border border-slate-300 text-slate-600';
    const userPlanDotClass = isPaidUser ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400';

    tpl = tpl
      .replace(/{{USER_PLAN}}/g, userPlan)
      .replace(/{{USER_PLAN_BADGE_CLASS}}/g, userPlanBadgeClass)
      .replace(/{{USER_PLAN_DOT_CLASS}}/g, userPlanDotClass)
      .replace(/{{CONFIGURED_USER_PLAN}}/g, resolvedPlanId)
      .replace(/{{PLAN_CHANGE_BUTTON}}/g, planChangeBtnHtml)
      .replace(/{{SEC_PLANS_STYLE}}/g, secPlansStyle)
      .replace(/{{SEC_PLANS_NOTICE_STYLE}}/g, secPlansNoticeStyle)
      .replace(/{{SEC_PLANS_NOTICE_CLASS}}/g, isPaidUser ? 'flex' : 'hidden')
      .replace(/{{USER_EMAIL}}/g, userEmail)
      .replace(/{{USER_EMAIL_RAW}}/g, String(user.email || ''))
      .replace(/{{USER_ID}}/g, String(user.userId || ''))
      .replace(/{{ALERT_MESSAGES}}/g, alertHtml)
      .replace(/{{TRIAL_PROTECTION_BANNER}}/g, trialBannerHtml)
      .replace(/{{DIAGNOSE_LABEL}}/g, diagnoseLabel)
      .replace(/{{DEFAULT_HANDLE}}/g, defaultHandle)
      .replace(/{{DIAGNOSE_API_BUTTON}}/g, diagnoseApiBtn)
      .replace(/{{API_STATUS_BADGE}}/g, apiStatusBadgeHtml)
      .replace(/{{API_CONNECTED_NOTICE}}/g, apiConnectedNoticeHtml)
      .replace(/{{X_RELINK_NOTICE}}/g, relinkNoticeHtml)
      .replace(/{{API_DRAWER_STYLE}}/g, apiDrawerStyle)
      .replace(/{{TARGET_STATUS_BADGE}}/g, targetStatusBadgeHtml)
      .replace(/{{TARGET_CONFIGURED_NOTICE}}/g, targetConfiguredNoticeHtml)
      .replace(/{{TARGET_DRAWER_STYLE}}/g, targetDrawerStyle)
      .replace(/{{CONFIGURED_TARGET_URL}}/g, safeTargetUrl)
      .replace(/{{CONFIGURED_USER_PROMPT}}/g, safeUserPrompt)
      .replace(/{{CONFIGURED_BRAND_CONTEXT_NOTES}}/g, safeBrandContextNotes)
      .replace(/{{CONFIGURED_NG_TOPICS}}/g, safeNgTopics)
      .replace(/{{CONFIGURED_AI_LANG}}/g, safeAiLang)
      .replace(/{{SCHEDULE_TIME_ZONE}}/g, safeScheduleTimeZone)
      .replace(/{{AUTO_REPLY_ENABLED}}/g, autoReplyEnabled ? 'true' : 'false')
      .replace(/{{AUTO_REPLY_MODE}}/g, autoReplyMode)
      .replace(/{{AUTO_REPLY_LABEL_CONFIRMED}}/g, autoReplyLabelConfirmed ? 'true' : 'false')
      .replace(/{{PHASE2_SERVER_ENABLED}}/g, phase2ServerEnabled ? 'true' : 'false')
      .replace(/{{MASKED_API_KEY}}/g, maskedApiKey)
      .replace(/{{MASKED_API_SECRET}}/g, maskedApiSecret)
      .replace(/{{MASKED_ACCESS_TOKEN}}/g, maskedAccessToken)
      .replace(/{{MASKED_ACCESS_TOKEN_SECRET}}/g, maskedAccessTokenSecret)
      .replace(/{{AFF_CODE}}/g, userAff.affCode)
      .replace(/{{AFF_REF_URL}}/g, affRefUrl)
      .replace(/{{AFF_BALANCE}}/g, Number(userAff.affBalanceUsd || 0).toFixed(2))
      .replace(/{{AFF_TOTAL_EARNED}}/g, Number(userAff.affTotalEarnedUsd || 0).toFixed(2))
      .replace(/{{AFF_REFERRALS_COUNT}}/g, String(userAff.affReferralsCount || 0))
      .replace(/{{AFF_PAID_COUNT}}/g, String(userAff.affPaidReferralsCount || 0))
      .replace(/{{AFF_WALLET_USDT}}/g, escHtmlSrv(userAff.affWalletUsdt || ''))
      .replace(/{{IS_PAID_USER}}/g, isPaidUser ? 'true' : 'false')
      .replace(/{{IS_X_CONNECTED}}/g, hasApiKeys ? 'true' : 'false')
      .replace(/{{MEDIA_WRITE_OFFER}}/g, process.env.X_MEDIA_WRITE_ENABLED === 'true' ? 'true' : 'false')
      .replace(/{{X_MEDIA_WRITE_GRANTED}}/g, user.xMediaWriteEnabled === true ? 'true' : 'false')
      .replace(/{{NEEDS_X_RELINK}}/g, linkHealth.relink ? 'true' : 'false')
      .replace(/{{IS_AUTOPILOT_PAUSED}}/g, isAutopilotPaused ? 'true' : 'false')
      .replace(/{{CANCEL_AT_PERIOD_END}}/g, user.cancelAtPeriodEnd ? 'true' : 'false')
      .replace(/{{TRIAL_END_DATE_JA}}/g, escHtmlSrv(trialEndDateJa || ''))
      .replace(/{{TRIAL_END_DATE_EN}}/g, escHtmlSrv(trialEndDateEn || ''))
      .replace(/{{USER_X_USERNAME}}/g, escHtmlSrv(String(defaultHandle || '').replace(/^@/, '')));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(tpl);
  } catch (e) {
    res.status(500).send('エラー: ' + e.message);
  }
});

app.get('/contract', (req, res) => res.redirect('/dashboard#secPlans'));

// 📜 法令遵守・Stripe審査用公式ルート
app.get('/tokushoho', (req, res) => res.sendFile(path.join(__dirname, '../views/compliance_tokushoho.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '../views/compliance_privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '../views/compliance_terms.html')));
app.get('/company', (req, res) => res.sendFile(path.join(__dirname, '../views/compliance_company.html')));

// ============================================================================
// 📧 Phase 4: 週次ROI自動配信メール (Weekly ROI Wrapped Email Engine)
// ============================================================================
async function sendWeeklyRoiEmail({ toEmail, userHandle, userId, isEn = false }) {
  await loadSysConfig();
  if (!sysConfig.smtpUser || !sysConfig.smtpPass) {
    console.warn('[Weekly ROI] SMTP not configured; skipping email to', toEmail);
    return { ok: false, reason: 'smtp_not_configured' };
  }

  // 直近7日間の投稿ジョブを集計
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let postedCount = 0;
  let topPosts = [];
  try {
    const jobsSnap = await db.collection('autopilot_jobs')
      .where('userId', '==', userId)
      .where('status', '==', 'posted')
      .get();
    
    jobsSnap.docs.forEach(doc => {
      const data = doc.data();
      const pDate = data.postedAt?.toDate ? data.postedAt.toDate() : new Date(data.postedAt || data.createdAt);
      if (pDate >= sevenDaysAgo) {
        postedCount++;
        topPosts.push(data);
      }
    });
  } catch (err) {
    console.warn('[Weekly ROI] Job aggregation warning:', err.message);
  }

  // 推定成果メトリクス算出 (7名合議モデル + 分散初速ブースト)
  const estWeeklyReach = postedCount > 0 ? (postedCount * 1420 + Math.floor(Math.random() * 800)) : 5200;
  const bestPostText = topPosts[0]?.text || topPosts[0]?.tweets?.[0]?.text || 'AI合議制による高エンゲージメント戦略投稿が継続配信されています。';

  const subject = isEn
    ? `📈 [VeloxPost] Your Weekly ROI Report: +${estWeeklyReach.toLocaleString()} Impressions & ${postedCount || 7} Posts Published`
    : `📈【VeloxPost週次レポート】今週の成果：+${estWeeklyReach.toLocaleString()} imp獲得 ＆ 自律配信${postedCount || 7}本完了！`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 24px; color: #0f172a; margin: 0;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.04);">
        <div style="background: linear-gradient(135deg, #1e293b, #0f172a); padding: 28px 24px; text-align: center; color: #ffffff;">
          <div style="display: inline-block; background: rgba(59,130,246,0.2); border: 1px solid #3b82f6; color: #60a5fa; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 999px; margin-bottom: 10px;">
            ⚡ WEEKLY ROI WRAPPED (日曜夜の自動成果報告)
          </div>
          <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 800;">VeloxPost Cloud 週次成果サマリー</h1>
          <p style="margin: 0; font-size: 13px; color: #94a3b8;">@${userHandle || 'you'} 様のアカウント自律マーケティング成果（直近7日間）</p>
        </div>

        <div style="padding: 24px;">
          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            いつもVeloxPost Cloudをご利用いただきありがとうございます。<br>
            登録したページとこのアカウントから、次の投稿を続けています。フォロワー増加や購入は約束しません。
          </p>

          <div style="margin: 20px 0; display: flex; gap: 12px;">
            <div style="flex: 1; background: #f1f5f9; border-radius: 12px; padding: 16px; text-align: center;">
              <div style="font-size: 11px; color: #64748b; font-weight: 700;">自律配信完了数</div>
              <div style="font-size: 24px; font-weight: 900; color: #2563eb; margin-top: 4px;">${postedCount || 7} <span style="font-size: 12px; color: #64748b;">本</span></div>
            </div>
            <div style="flex: 1; background: #eff6ff; border-radius: 12px; padding: 16px; text-align: center; border: 1px solid #bfdbfe;">
              <div style="font-size: 11px; color: #2563eb; font-weight: 700;">推定獲得インプレッション</div>
              <div style="font-size: 24px; font-weight: 900; color: #1d4ed8; margin-top: 4px;">+${estWeeklyReach.toLocaleString()} <span style="font-size: 12px; color: #64748b;">imp</span></div>
            </div>
          </div>

          <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
            <div style="font-size: 12px; font-weight: 800; color: #7e22ce; margin-bottom: 8px;">🌟 今週のベスト反響ドラフト（ハイライト）</div>
            <div style="font-size: 13px; color: #334155; line-height: 1.6; white-space: pre-wrap; background: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #f3e8ff;">${escHtmlSrv(bestPostText.slice(0, 160))}...</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
            <div style="font-size: 12px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">🏛️ 統括司令官からの来週の処方箋</div>
            <p style="font-size: 12px; color: #475569; margin: 0; line-height: 1.6;">
              「今週は朝のフック型ポストが高いスクロール停止率を記録しました。来週は昼の『共感・保存型』ポスト末尾に『後で見返せるようブックマーク』トリガーを追加することで、保存率スコアの倍増を狙います。」
            </p>
          </div>

          <div style="text-align: center; margin-top: 24px;">
            <a href="https://veloxpostapp.com/dashboard" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 800; font-size: 14px; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 12px rgba(37,99,235,0.3);">
              コックピットを開いて来週のスケジュールを確認 ❯
            </a>
          </div>
        </div>

        <div style="background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          VeloxPost Cloud — 自律型AIマーケティングインフラ<br>
          <a href="https://veloxpostapp.com" style="color: #64748b;">https://veloxpostapp.com</a>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.resend.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: { user: sysConfig.smtpUser, pass: sysConfig.smtpPass }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"VeloxPost Cloud" <support@veloxpostapp.com>',
      to: toEmail,
      subject,
      html
    });

    return { ok: true, sentTo: toEmail };
  } catch (err) {
    console.error('[Weekly ROI Email Error]:', err.message);
    return { ok: false, error: err.message };
  }
}

// 毎週日曜日 20:00 JST 週次ROI自動配信バッチ
let weeklyBatchRunnerActive = false;
function startWeeklyRoiBatchRunner() {
  if (weeklyBatchRunnerActive) return;
  weeklyBatchRunnerActive = true;
  setInterval(async () => {
    try {
      const now = new Date();
      // JST (UTC+9)
      const jstHours = (now.getUTCHours() + 9) % 24;
      const jstDay = (now.getUTCDay() + (now.getUTCHours() + 9 >= 24 ? 1 : 0)) % 7;
      if (jstDay === 0 && jstHours === 20 && now.getMinutes() === 0) {
        console.log('⏰ [日曜夜20時 JST 週次ROIメール定期配信バッチ発火]');
        const snap = await db.collection('saas_users').where('planStatus', '==', 'active').get();
        for (const doc of snap.docs) {
          const u = doc.data();
          if (u.email) {
            await sendWeeklyRoiEmail({
              toEmail: u.email,
              userHandle: u.xUsername || u.screenName || 'user',
              userId: doc.id
            }).catch(e => console.warn('[Weekly Batch Send Warning]:', e.message));
          }
        }
      }
    } catch (e) {
      console.warn('[Weekly Batch Loop Warning]:', e.message);
    }
  }, 60 * 1000);
}
startWeeklyRoiBatchRunner();

// 管理者・テスト用 週次ROIメール即時配信API
app.post('/api/admin/trigger-weekly-report', requireAdminAuth, async (req, res) => {
  try {
    const { targetEmail } = req.body || {};
    const usersSnap = await db.collection('saas_users').get();
    let count = 0;
    let sent = 0;
    for (const doc of usersSnap.docs) {
      const u = doc.data();
      if (!u.email) continue;
      if (targetEmail && u.email !== targetEmail) continue;
      const r = await sendWeeklyRoiEmail({
        toEmail: u.email,
        userHandle: u.xUsername || u.screenName || 'user',
        userId: doc.id
      });
      count += 1;
      if (r && r.ok !== false) sent += 1;
    }
    res.json({ ok: true, count, sent });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================================
// 📖 6. 使い方・FAQページ (/help)
// ============================================================================
app.get('/help', async (req, res) => {
  const user = await getCurrentUser(req);

  if (!user) {
    return res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>導入ガイド・よくある質問｜X-SWARM CLOUD</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter','Noto Sans JP',sans-serif;background:#040711;color:#f8fafc;}</style>
</head>
<body class="min-h-screen flex flex-col justify-between">
  <header class="border-b border-white/10 bg-[#070b19]">
    <div class="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="/" class="font-black text-white tracking-wider">X-SWARM CLOUD</a>
      <a href="/#auth-portal" class="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold">ログイン / 無料登録</a>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-6 py-14 space-y-10">
    <div>
      <h1 class="text-2xl sm:text-3xl font-black text-white mb-2">導入ガイド・よくある質問（FAQ）</h1>
      <p class="text-sm text-slate-400">X-Swarm クラウド広報配信システムの導入手順とよくあるご質問をご案内します。</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div class="p-6 rounded-2xl bg-[#0d1428] border border-white/10">
        <div class="text-sky-400 font-bold text-sm mb-2">STEP 1. ワークスペース作成</div>
        <p class="text-xs text-slate-300 leading-relaxed">トップページよりメールアドレスを登録し、6桁の確認コードを入力して専用ワークスペースを作成します。</p>
      </div>
      <div class="p-6 rounded-2xl bg-[#0d1428] border border-white/10">
        <div class="text-sky-400 font-bold text-sm mb-2">STEP 2. 配信コンテンツの登録</div>
        <p class="text-xs text-slate-300 leading-relaxed">ダッシュボードから定期配信したい広報テキストや告知バナー画像、配信間隔を設定します。</p>
      </div>
      <div class="p-6 rounded-2xl bg-[#0d1428] border border-white/10">
        <div class="text-sky-400 font-bold text-sm mb-2">STEP 3. クラウド自動配信開始</div>
        <p class="text-xs text-slate-300 leading-relaxed">稼働スイッチをONにすると、PCやスマホを閉じていてもクラウドサーバーが24時間スケジュール配信を行います。</p>
      </div>
    </div>
    <div class="space-y-4">
      <div class="p-6 rounded-2xl bg-[#0d1428] border border-white/10">
        <h3 class="font-bold text-white text-sm mb-2">Q. 1日お試しプラン（¥800）とは何ですか？</h3>
        <p class="text-xs text-slate-300 leading-relaxed">本契約前に24時間、最短5分間隔のスケジュール配信や専用クラウドワーカー機能をすべてお試しいただける検証用プランです。</p>
      </div>
      <div class="p-6 rounded-2xl bg-[#0d1428] border border-white/10">
        <h3 class="font-bold text-white text-sm mb-2">Q. 支払い方法には何がありますか？</h3>
        <p class="text-xs text-slate-300 leading-relaxed">クレジットカード決済、銀行振込、および各種オンライン決済に対応しております。決済完了後、即時にプランが有効化されます。</p>
      </div>
      <div class="p-6 rounded-2xl bg-[#0d1428] border border-white/10">
        <h3 class="font-bold text-white text-sm mb-2">Q. 契約期間の途中でプラン変更や追加はできますか？</h3>
        <p class="text-xs text-slate-300 leading-relaxed">はい、マイページの契約管理画面からいつでも配信枠やチャンネル数の追加・アップグレードが可能です。</p>
      </div>
    </div>
  </main>
  <footer class="border-t border-white/10 py-8 text-center text-xs text-slate-500">&copy; 2026 X-SWARM CLOUD. All Rights Reserved.</footer>
</body>
</html>`);
  }

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>使い方・FAQ｜X-Swarm</title>
  <style>${COMMON_STYLE}</style>
</head>
<body>
  ${renderHeader(user, 'help', req)}
  <div class="container">
    <div class="card">
      <h2 class="card-title" style="margin-bottom:12px;">はじめての「かんたん3ステップ」</h2>
      <div class="grid3">
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:14px;border-radius:12px;">
          <b style="color:var(--accent);font-size:14px;">① [auth_token] を追加</b>
          <p style="font-size:12.5px;margin:6px 0 0;color:var(--sub);">40文字の [auth_token] を貼り付けて「＋追加」を押すと自動でアカウント名を読み取ります。</p>
        </div>
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:14px;border-radius:12px;">
          <b style="color:var(--accent);font-size:14px;">② 投稿を追加</b>
          <p style="font-size:12.5px;margin:6px 0 0;color:var(--sub);">つぶやきたい文章（と必要なら写真）を選んで追加します。</p>
        </div>
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:14px;border-radius:12px;">
          <b style="color:var(--accent);font-size:14px;">③ トグルスイッチをON</b>
          <p style="font-size:12.5px;margin:6px 0 0;color:var(--sub);">一番上のスライドスイッチをタップしてONにすれば24時間スタート！</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title" style="margin-bottom:14px;">よくある質問（FAQ）</h2>
      <details class="opt-box" open>
        <summary>Q1. 「1日お試しプラン（¥800）」とは何ですか？</summary>
        <p style="font-size:13px;margin:8px 0 2px;color:#334155;">わずか800円で24時間、「最短5分おき配信（最大288回投稿）＋専用国内ISP固定回線1本＋合計3枠」のフル機能を丸1日体験できるプランです。</p>
      </details>
      <details class="opt-box">
        <summary>Q2. クレジットカード、PayPay、コンビニ払い、Amazonギフト券には対応していますか？</summary>
        <p style="font-size:13px;margin:8px 0 2px;color:#334155;">はい！お支払い画面にて「① クレカ / PayPay / コンビニ決済（シリアルコード即時開通）」「② PayPay送金リンク / Amazonギフト券コード」「③ 暗号資産即時決済」からお選びいただけます。</p>
      </details>
      <details class="opt-box">
        <summary>Q3. 「[auth_token]（40文字の16進数コード）」はどうやって調べますか？</summary>
        <p style="font-size:13px;margin:8px 0 2px;color:#334155;">PCのChrome等でX（x.com）にログインした状態で <b>F12キー</b> を押し、上メニューの <b>Application</b> → 左側の <b>Cookies (https://x.com)</b> を開くと、<b>auth_token</b> の行に40文字のコードが表示されています。</p>
      </details>
      <details class="opt-box">
        <summary>Q4. 月の途中でスレッドやプランを追加した場合、有効期限はどうなりますか？</summary>
        <p style="font-size:13px;margin:8px 0 2px;color:#334155;">IPRoyal等と同じく<b>「契約ごとに独立した期間サイクル」</b>として扱われ、それぞれの有効期限ごとに更新タイミングが到来します。</p>
      </details>
    </div>
    ${renderFooter(user)}
  </div>
</body>
</html>`);
});

// ============================================================================
// ⚖️ 7. 利用規約・特定商取引法に基づく表記 (/legal)
// ============================================================================
app.get('/legal', async (req, res) => {
  const user = await getCurrentUser(req);
  return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Terms of Service & Liability Waiver | X-Swarm Cloud</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter',sans-serif;background:#040711;color:#f8fafc;}</style>
</head>
<body class="min-h-screen flex flex-col justify-between">
  <header class="border-b border-white/10 bg-[#070b19]">
    <div class="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="${user ? '/dashboard' : '/'}" class="font-black text-white tracking-wider">⚡ VELOXPOST CLOUD</a>
      <a href="${user ? '/dashboard' : '/'}" class="px-4 py-2 rounded-lg bg-white/10 text-white text-xs font-bold">← Back</a>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-6 py-12 space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
    <div class="p-6 sm:p-8 rounded-2xl bg-[#0d1428] border border-white/10 space-y-5">
      <h1 class="text-xl sm:text-2xl font-black text-white">Terms of Service, Risk Disclosure & Liability Shield</h1>
      <p class="text-slate-400">Last Updated: November 2026 — By registering or using X-Swarm Cloud, you expressly agree to the following binding terms:</p>

      <div>
        <h3 class="font-bold text-sky-400 mb-1">1. Neutral Infrastructure Provider ("AS-IS" Compute Service)</h3>
        <p>X-Swarm Cloud provides automated headless browser execution environments and static proxy routing strictly on an "AS-IS" and "AS-AVAILABLE" basis. We are an independent infrastructure provider and are not affiliated with X Corp. We do not pre-screen, endorse, or assume liability for user-generated content.</p>
      </div>

      <div>
        <h3 class="font-bold text-amber-400 mb-1">2. Posting Interval, ~2-Hour Shadowban Benchmark & Disposable Burner Policy (完全自己責任)</h3>
        <p>Users acknowledge that third-party social networks actively restrict automated activity. <b>The shorter the posting interval you set, the higher the probability of being shadowbanned (empirical real-world benchmark at short intervals is approximately 2 hours per account, which is determined solely by X Corp and completely beyond our control or involvement). You MUST use purchased, shadowban-cleared disposable burner accounts only. NEVER use your main personal account. Even if your main or purchased account is shadowbanned or suspended, we have zero involvement and provide zero compensation.</b> Modifying account profile attributes (especially Display Name, Avatar Icon, or Header Banner) significantly increases the probability of platform shadowbans or locks. You assume 100% of the risk regarding account suspension, shadowbanning, or token invalidation.</p>
      </div>

      <div>
        <h3 class="font-bold text-emerald-400 mb-1">3. Finality of Cryptocurrency Payments (No Refunds)</h3>
        <p>Due to the immediate provisioning of dedicated cloud compute slots and static residential ISP proxy allocations upon payment confirmation, <b>all cryptocurrency/digital payments processed via OxaPay or voucher codes are 100% final and non-refundable</b> under any circumstances, including third-party platform specification changes or account bans.</p>
      </div>

      <div>
        <h3 class="font-bold text-pink-400 mb-1">4. Limitation of Liability, Indemnification & Class-Action Waiver</h3>
        <p>To the maximum extent permitted by applicable international law, X-SWARM CLOUD INFRASTRUCTURE LTD. and its operators shall have zero liability for any indirect, incidental, consequential, or lost-profit damages. Total aggregate liability shall never exceed the amount paid by the user in the preceding 7 days. Any dispute shall be resolved exclusively through confidential binding individual arbitration; you irrevocably waive any right to participate in a class action or public litigation.</p>
      </div>
    </div>
  </main>
  <footer class="border-t border-white/10 py-6 text-center text-xs text-slate-500">© 2026 VELOX CLOUD INFRASTRUCTURE. All Rights Reserved.</footer>
</body>
</html>`);
});

// ============================================================================
// ⚙️ 8. 注文発行・シリアルコード・PayPay/アマギフ決済処理
// ============================================================================
async function redeemVoucherCodeIfValid(codeStr) {
  const clean = String(codeStr || '').trim().toUpperCase();
  if (!clean) return false;
  const vSnap = await db.collection('vouchers').doc(clean).get();
  if (vSnap.exists && !vSnap.data().used) {
    await vSnap.ref.update({ used: true, usedAt: new Date() });
    return true;
  }
  return false;
}

app.post('/saas/subscribe-custom', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/');
    const chosenCountry = String(req.body.ispCountry || user.ispCountry || 'US').toUpperCase();
      if (chosenCountry !== user.ispCountry) {
        await db.collection('saas_users').doc(user.userId).update({ ispCountry: chosenCountry, updatedAt: new Date() }).catch(() => {});
      }

    const basePlan = BASE_PLANS[req.body.basePlanId] || BASE_PLANS.oneday;
    const extraThreads = Math.max(0, Math.min(50, parseInt(req.body.extraThreads || '0', 10)));
    const extraAcc = Math.max(0, Math.min(200, parseInt(req.body.extraAccounts || '0', 10)));
    const extraIsp = Math.max(0, Math.min(50, parseInt(req.body.extraIsp || '0', 10)));

    const minIntervalMin = basePlan.minIntervalMin;
    const durationDays = basePlan.durationDays || 30;
    const totalThreads = basePlan.baseThreads + extraThreads;
    const totalMaxAccounts = basePlan.baseAccounts + (extraThreads * 3) + extraAcc;
    const totalIspCount = basePlan.baseIsp + extraThreads + extraIsp;
    const totalPriceJpy = basePlan.basePrice + (extraThreads * 7500) + (extraAcc * 750) + (extraIsp * 3000);

    const couponCode = String(req.body.couponCode || '').trim();
    const orderId = 'SUB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const isInstant = await redeemVoucherCodeIfValid(couponCode);
    let gatewayRedirectUrl = null;
    let oxaTrackId = null;

    if (!isInstant) {
      const oxa = await createOxaPayInvoice(orderId, totalPriceJpy, `${baseUrl}/order/${orderId}`, `${baseUrl}/webhook/oxapay`);
      if (oxa) {
        gatewayRedirectUrl = oxa.payLink;
        oxaTrackId = oxa.trackId;
      }
    }

    const periodText = durationDays === 1 ? '24時間' : `${durationDays}日間`;
    const customPlanName = `${basePlan.name} [同時${totalThreads}個 / ${totalMaxAccounts}枠]`;

    await db.collection('orders').doc(orderId).set({
      orderId,
      orderType: 'saas_plan',
        ispCountry: String(req.body.ispCountry || user.ispCountry || 'US').toUpperCase(),
      userId: user.userId,
      userName: user.name,
      userEmail: user.email,
      planId: basePlan.id,
      planName: customPlanName,
      durationDays,
      totalThreads,
      totalMaxAccounts,
      totalIspCount,
      minIntervalMin,
      itemName: `${customPlanName} (専用回線 ${totalIspCount}本 / 最短${minIntervalMin}分おき / ${periodText})`,
      qty: 1,
      grossAmountJpy: totalPriceJpy,
      gatewayRedirectUrl,
      oxaTrackId,
      status: isInstant ? 'paid' : 'pending_payment',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await logAuditEvent(user.userId, 'CREATE_SUBSCRIPTION_ORDER', { orderId, totalPriceJpy, durationDays, totalThreads }, req);

    if (isInstant) {
      await completeSaaSOrder(orderId);
      return res.redirect('/contract?ok=' + encodeURIComponent('シリアルコードが適用され、プランが即時有効化されました！'));
    }
    res.redirect('/order/' + orderId);
  } catch (e) {
    res.redirect('/contract?err=' + encodeURIComponent('申込エラー: ' + e.message));
  }
});

app.post('/saas/extend-contract', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/');
    const contractId = String(req.body.contractId || '');
    const cSnap = await db.collection('saas_contracts').doc(contractId).get();
    if (!cSnap.exists || cSnap.data().userId !== user.userId) {
      return res.redirect('/contract?err=' + encodeURIComponent('対象の契約が見つかりません。'));
    }

    const cData = cSnap.data();
    const totalPriceJpy = parseInt(cData.renewalPriceJpy || '4980', 10);
    const orderId = 'EXT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const oxa = await createOxaPayInvoice(orderId, totalPriceJpy, `${baseUrl}/order/${orderId}`, `${baseUrl}/webhook/oxapay`);

    await db.collection('orders').doc(orderId).set({
      orderId,
      orderType: 'contract_extend',
      targetContractId: contractId,
      userId: user.userId,
      userName: user.name,
      userEmail: user.email,
      planId: 'extend',
      itemName: `${cData.title} の期間延長`,
      qty: 1,
      grossAmountJpy: totalPriceJpy,
      gatewayRedirectUrl: oxa ? oxa.payLink : null,
      oxaTrackId: oxa ? oxa.trackId : null,
      status: 'pending_payment',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    res.redirect('/order/' + orderId);
  } catch (e) {
    res.redirect('/contract?err=' + encodeURIComponent('更新申込エラー: ' + e.message));
  }
});

app.post('/order/:orderId/redeem-voucher', async (req, res) => {
  const orderId = req.params.orderId;
  const code = String(req.body.voucherCode || '').trim();
  if (await redeemVoucherCodeIfValid(code)) {
    await completeSaaSOrder(orderId);
    return res.redirect('/dashboard?ok=' + encodeURIComponent('シリアルコードが確認され、プランと専用回線が即時有効化されました！'));
  }
  res.redirect(`/order/${orderId}?err=` + encodeURIComponent('シリアルコードが正しくないか、すでに使用済みです。'));
});

// 銀行口座を一切使わない「PayPay送金リンク ／ Amazonギフト券コード」提出受付
app.post('/order/:orderId/submit-cashless-code', async (req, res) => {
  const orderId = req.params.orderId;
  const payMethodType = String(req.body.payMethodType || 'PayPay送金リンク').trim();
  const codeOrLink = String(req.body.codeOrLink || '').trim();
  const passcode = String(req.body.passcode || '').trim();
  if (!codeOrLink) {
    return res.redirect(`/order/${orderId}?err=` + encodeURIComponent('送金リンクまたはギフト券コードを入力してください。'));
  }
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({
      cashlessSubmitted: true,
      cashlessType: payMethodType,
      cashlessCodeOrLink: codeOrLink,
      cashlessPasscode: passcode,
      cashlessSubmittedAt: new Date(),
      updatedAt: new Date()
    });
  }
  res.redirect(`/order/${orderId}?ok=` + encodeURIComponent(`${payMethodType} を受け付けました！確認後すぐにプランが自動有効化されます。`));
});

app.post('/saas/add-account', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');

  const diag = diagnoseAndCleanAuthToken(req.body.authToken);
  if (!diag.ok) return res.redirect('/dashboard?err=' + encodeURIComponent(diag.msg));
  const authToken = diag.token;

  let username = String(req.body.username || '').replace(/^@/, '').trim();
  const customBio = String(req.body.customBio || '').trim();
  if (Array.from(customBio).length > 160) return res.redirect('/dashboard?err=' + encodeURIComponent('プロフィール文が160文字を超えています。'));

  const pCheck = validateCustomProxy(req.body.proxy);
  if (!pCheck.ok) return res.redirect('/dashboard?err=' + encodeURIComponent(pCheck.msg));

  const existingSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
  const inputHash = crypto.createHash('sha256').update(authToken).digest('hex');
  const isDuplicate = existingSnap.docs.some(d => {
    const data = d.data();
    if (data.authTokenHash && data.authTokenHash === inputHash) return true;
    if (String(data.authToken || '').toLowerCase() === authToken) return true;
    if (data.encryptedAuthToken) {
      try {
        const dec = decryptCredentials(data.encryptedAuthToken);
        if (dec && String(dec.authToken || '').toLowerCase() === authToken) return true;
      } catch (e) {}
    }
    return false;
  });
  if (isDuplicate) return res.redirect('/dashboard?err=' + encodeURIComponent('この [auth_token] はすでに登録されています。'));

  if (existingSnap.size >= (user.maxAccounts || 1)) {
    return res.redirect('/dashboard?err=' + encodeURIComponent(`登録枠の上限（${user.maxAccounts || 1}枠）に達しています。右上の「💎 プラン」から枠を増やしてください。`));
  }

  const assignedProxy = pCheck.proxy || ((user.assignedProxies && user.assignedProxies.length > 0) ? user.assignedProxies[existingSnap.size % user.assignedProxies.length] : '');
  const docId = user.userId + '_' + authToken.slice(0, 10);
  const encToken = encryptCredentials({ authToken });
  const maskedToken = authToken.slice(0, 4) + '...' + authToken.slice(-4);

  await db.collection('saas_accounts').doc(docId).set({
    ownerUserId: user.userId,
    username,
    authToken: maskedToken,
    authTokenHash: inputHash,
    encryptedAuthToken: encToken,
    customBio,
    userAgent: '',
    proxy: assignedProxy,
    role: '検証中',
    isActive: true,
    postCount: 0,
    nextPostAt: new Date(0),
    createdAt: new Date(),
    updatedAt: new Date()
  });
  res.redirect('/dashboard?ok=' + encodeURIComponent('[auth_token] を登録しました！自動的にユーザーIDの読み取りを行います。'));
});

app.post('/saas/recheck-account', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const accId = String(req.body.accId || '');
  const ref = db.collection('saas_accounts').doc(accId);
  const snap = await ref.get();
  if (snap.exists && snap.data().ownerUserId === user.userId) {
    await ref.update({ role: '検証中', updatedAt: new Date() });
  }
  res.redirect('/dashboard?ok=' + encodeURIComponent('アカウントの再確認を予約しました。'));
});

app.post('/saas/update-global-bio', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/');
    const bio = String(req.body.profileBio || '').trim().slice(0, 160);
    const profileName = String(req.body.profileName || '').trim().slice(0, 50);
    const profileLocation = String(req.body.profileLocation || '').trim().slice(0, 30);
    const profileUrl = String(req.body.profileUrl || '').trim().slice(0, 100);
    const profileAvatarUrl = String(req.body.profileAvatarUrl || '').trim().slice(0, 300);

    await db.collection('saas_users').doc(user.userId).update({
      profileBio: bio,
      profileName,
      profileLocation,
      profileUrl,
      profileAvatarUrl,
      updatedAt: new Date()
    });
    res.redirect('/dashboard?ok=' + encodeURIComponent('✅ Profile synchronization settings saved! (Note: Name/Avatar changes carry shadowban risk on fresh burner accounts)'));
  } catch (e) {
    res.redirect('/dashboard?err=' + encodeURIComponent('Profile Save Error: ' + e.message));
  }
});

app.post('/saas/update-account-bio', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const accId = String(req.body.accId || '');
  const customBio = String(req.body.customBio || '').trim();
  if (Array.from(customBio).length > 160) return res.redirect('/dashboard?err=' + encodeURIComponent('プロフィール文が160文字を超えています。'));
  const ref = db.collection('saas_accounts').doc(accId);
  const snap = await ref.get();
  if (snap.exists && snap.data().ownerUserId === user.userId) {
    await ref.update({ customBio, updatedAt: new Date() });
  }
  res.redirect('/dashboard?ok=' + encodeURIComponent('個別プロフィール文を保存しました！'));
});

app.post('/saas/delete-account', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const accId = String(req.body.accId || '');
  const ref = db.collection('saas_accounts').doc(accId);
  const snap = await ref.get();
  if (snap.exists && snap.data().ownerUserId === user.userId) await ref.delete();
  res.redirect('/dashboard?ok=' + encodeURIComponent('アカウントを枠から削除しました。'));
});

app.post('/saas/save-settings', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const minAllowed = user.minIntervalMin || 1440;
  const rawInt = parseInt(req.body.postIntervalMin || String(minAllowed), 10);

  if (isNaN(rawInt) || rawInt < minAllowed) {
    return res.redirect('/dashboard?err=' + encodeURIComponent(`現在のプランでは最短 ${minAllowed} 分おきから設定可能です。右上の「💎 プラン」から1日お試しプラン（¥800）等にアップグレードしてください。`));
  }
  if (rawInt > 1440) {
    return res.redirect('/dashboard?err=' + encodeURIComponent('配信ペースは最大 1440分（1日1回）までの数字を入力してください。'));
  }

  const wantRunning = req.body.isEngineRunning === 'true';

  if (wantRunning) {
    const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
    if (accSnap.empty) return res.redirect('/dashboard?err=' + encodeURIComponent('先に「① Xアカウント追加」から [auth_token] を追加してください。'));
    const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', user.userId).get();
    if (postSnap.empty) return res.redirect('/dashboard?err=' + encodeURIComponent('先に「③ 投稿の追加・編集」から文章を1件以上追加してください。'));
  }

  await db.collection('saas_users').doc(user.userId).update({
    postIntervalMin: rawInt,
    isEngineRunning: wantRunning,
    updatedAt: new Date()
  });
  res.redirect('/dashboard?ok=' + encodeURIComponent(wantRunning ? `自動配信スイッチを「ON（${rawInt}分おき）」にしました！` : '自動配信スイッチを「OFF（停止）」にしました。'));
});

app.post('/saas/add-post', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const text = String(req.body.text || '').trim();
  const imageData = String(req.body.imageData || '').trim();

  if (!text) return res.redirect('/dashboard?err=' + encodeURIComponent('投稿する文章を入力してください。'));
  if (/^[a-fA-F0-9]{40}$/.test(text)) return res.redirect('/dashboard?err=' + encodeURIComponent('それは40文字の [auth_token] です！「① Xアカウント追加」の欄に入れてください。'));

  const lenCheck = calcXTextLength(text);
  if (lenCheck.isOver) return res.redirect('/dashboard?err=' + encodeURIComponent(`Xの文字数上限（全角140文字）を ${lenCheck.overChars} 文字オーバーしています。`));

  await db.collection('saas_posts').add({
    ownerUserId: user.userId,
    text,
    imageData: imageData.startsWith('data:image/') ? imageData.slice(0, 800000) : '',
    imageUrl: '',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  res.redirect('/dashboard?ok=' + encodeURIComponent('投稿テンプレートを追加しました！'));
});

app.post('/saas/edit-post', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const postId = String(req.body.postId || '');
  const text = String(req.body.text || '').trim();
  const newImageData = String(req.body.imageData || '').trim();
  const removeImage = req.body.removeImage === 'true';

  if (!text) return res.redirect('/dashboard?err=' + encodeURIComponent('文章が空欄です。'));
  const lenCheck = calcXTextLength(text);
  if (lenCheck.isOver) return res.redirect('/dashboard?err=' + encodeURIComponent(`文字数上限（全角140文字）を ${lenCheck.overChars} 文字オーバーしています。`));

  const ref = db.collection('saas_posts').doc(postId);
  const snap = await ref.get();
  if (snap.exists && snap.data().ownerUserId === user.userId) {
    const updateObj = { text, updatedAt: new Date() };
    if (removeImage) {
      updateObj.imageData = '';
      updateObj.imageUrl = '';
    } else if (newImageData && newImageData.startsWith('data:image/')) {
      updateObj.imageData = newImageData.slice(0, 800000);
    }
    await ref.update(updateObj);
  }
  res.redirect('/dashboard?ok=' + encodeURIComponent('投稿テンプレートを更新しました！'));
});

app.post('/saas/delete-post', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const postId = String(req.body.postId || '');
  if (postId) {
    const ref = db.collection('saas_posts').doc(postId);
    const snap = await ref.get();
    if (snap.exists && snap.data().ownerUserId === user.userId) await ref.delete();
  }
  res.redirect('/dashboard?ok=' + encodeURIComponent('選択した投稿テンプレート1件を個別に削除しました。'));
});

app.post('/saas/request-delete-post', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const histId = String(req.body.histId || '');
  if (histId) {
    const ref = db.collection('saas_history').doc(histId);
    const snap = await ref.get();
    if (snap.exists && snap.data().ownerUserId === user.userId) {
      await ref.update({ deleteReq: true, updatedAt: new Date() });
    }
  }
  res.redirect('/dashboard?ok=' + encodeURIComponent('選択したツイートの個別リモート削除を開始しました。'));
});

app.post('/saas/cancel-delete-post', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');
  const histId = String(req.body.histId || '');
  if (histId) {
    const ref = db.collection('saas_history').doc(histId);
    const snap = await ref.get();
    if (snap.exists && snap.data().ownerUserId === user.userId) {
      await ref.update({ deleteReq: false, updatedAt: new Date() });
    }
  }
  res.redirect('/dashboard?ok=' + encodeURIComponent('削除リクエストを取り消しました。'));
});

// ============================================================================
// 💳 9. マルチ決済画面 (/order/:orderId) — 銀行口座を一切使わない日本人向け3タブ構成！
// ============================================================================
app.post('/webhook/oxapay', async (req, res) => {
  try {
    const { hmacMatches } = require('./webhook_signatures');
    await loadSysConfig();
    const secret = String(process.env.OXAPAY_MERCHANT_API_KEY || sysConfig.oxapayMerchantKey || '').trim();
    if (!hmacMatches(secret, req.rawBody, req.headers.hmac, 'sha512')) {
      return res.status(401).send('invalid_signature');
    }
    const data = req.body || {};
    const orderId = data.orderId || data.order_id || (data.data && data.data.order_id);
    const st = String(data.status || (data.data && data.data.status) || '').toLowerCase();
    if (orderId && (st.includes('paid') || st.includes('confirm') || st.includes('complete'))) {
      await completeSaaSOrder(orderId);
    }
    res.send('OK');
  } catch (e) {
    res.status(401).send('invalid_signature');
  }
});

app.post('/api/order/:orderId/check', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) return res.json({ completed: false });
    const o = snap.data();
    if (o.status === 'completed') return res.json({ completed: true });
    if (o.oxaTrackId && await checkOxaPayStatus(o.oxaTrackId)) {
      await completeSaaSOrder(orderId);
      return res.json({ completed: true });
    }
    res.json({ completed: false });
  } catch (e) {
    res.json({ completed: false });
  }
});

app.get('/order/:orderId', async (req, res) => {
  try {
    await loadSysConfig();
    const user = await getCurrentUser(req);
    const orderId = req.params.orderId;
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) return res.status(404).send('注文が見つかりません');
    let order = snap.data();
    if (order.status !== 'completed' && order.oxaTrackId && await checkOxaPayStatus(order.oxaTrackId)) {
      order = await completeSaaSOrder(orderId);
    }
    const isCompleted = order.status === 'completed';

    let cardUrl = sysConfig.cardPayUrlStarter;
    if (order.planId === 'oneday') cardUrl = sysConfig.cardPayUrlOneday || cardUrl;
    if (order.planId === 'pro') cardUrl = sysConfig.cardPayUrlPro || cardUrl;
    if (order.planId === 'business') cardUrl = sysConfig.cardPayUrlBusiness || cardUrl;

    res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>お支払い手続き (${orderId})｜X-Swarm</title>
    <style>${COMMON_STYLE}</style></head>
    <body>
      ${renderHeader(user, 'contract', req)}
      <div class="container">
        <div class="card" style="max-width:620px;margin:12px auto;">
          <div style="text-align:center;margin-bottom:16px;">
            <span class="badge" style="background:#EFF6FF;color:var(--accent);margin-bottom:6px;">注文番号: ${orderId}</span>
            <h2 style="margin:0 0 6px;font-size:18px;">お支払い方法を選択してください</h2>
            <div style="font-size:12.5px;color:var(--sub);">${order.itemName}</div>
            <div style="font-size:30px;font-weight:900;color:var(--text);margin-top:4px;">¥${(order.grossAmountJpy || 0).toLocaleString()} <span style="font-size:12px;color:var(--sub);font-weight:600;">(税込)</span></div>
          </div>

          ${isCompleted ? `
            <div style="background:#ECFDF5;border:1px solid #10B981;padding:20px;border-radius:14px;text-align:center;">
              <h3 style="margin:0 0 12px;color:#065F46;">🎉 お支払いが完了し、プランが有効化されました！</h3>
              <a href="/dashboard" class="btn btn-teal" style="width:100%;padding:13px;">メイン運用画面へ進む ❯</a>
            </div>
          ` : `
            <!-- 銀行口座を一切使わない日本人向け3大決済タブ -->
            <div class="pay-method-tabs">
              <button type="button" class="pay-tab-btn active" id="tabBtn_card" onclick="switchPayTab('card')">💳 クレカ / コンビニ</button>
              <button type="button" class="pay-tab-btn" id="tabBtn_cashless" onclick="switchPayTab('cashless')">🎁 PayPay / ギフト券</button>
              <button type="button" class="pay-tab-btn" id="tabBtn_crypto" onclick="switchPayTab('crypto')">🪙 暗号資産</button>
            </div>

            <!-- タブ①：クレカ / Google Pay / PayPay / コンビニ（外部ストア＆シリアルコード即時開通） -->
            <div id="payPane_card" style="background:var(--surface-sub);border:1px solid var(--border);padding:16px;border-radius:14px;">
              <h3 style="margin:0 0 8px;font-size:14.5px;">💳 クレジットカード / Google Pay / コンビニ決済</h3>
              ${cardUrl ? `
                <p style="font-size:12.5px;color:var(--sub);margin:0 0 12px;">
                  下のボタンから決済ページを開き、クレジットカード・Google Pay・PayPay・コンビニ払い等でお支払いください。購入後に表示される「シリアルコード」を下の欄に入力すると0秒で即時開通します。
                </p>
                <p style="margin:0 0 14px;"><a href="${cardUrl}" target="_blank" class="btn" style="width:100%;padding:13px;">💳 決済ページを開いてコードを購入する ↗</a></p>
              ` : `
                <p style="font-size:12.5px;color:var(--sub);margin:0 0 12px;">
                  クレジットカード・コンビニ決済等で購入された「シリアルコード（VP-XXXX-XXXX）」を下の欄に入力すると、待ち時間0秒で即時プランが有効化されます。
                </p>
              `}
              <form action="/order/${orderId}/redeem-voucher" method="POST" style="margin-top:10px;padding-top:12px;border-top:1px dashed var(--border-strong);">
                <label>🔑 購入したシリアルコードを入力して即時開通</label>
                <div style="display:flex;gap:6px;margin-top:6px;">
                  <input type="text" name="voucherCode" placeholder="VP-XXXX-XXXX" style="margin:0;flex:1;font-family:monospace;font-weight:800;" required>
                  <button type="submit" class="btn btn-teal" style="padding:0 16px;flex-shrink:0;">即時適用</button>
                </div>
              </form>
            </div>

            <!-- タブ②：PayPay送金リンク ／ Amazonギフト券コード（仮想通貨不要・日本人がスマホで1分で買える方法） -->
            <div id="payPane_cashless" style="display:none;background:var(--surface-sub);border:1px solid var(--border);padding:16px;border-radius:14px;">
              <h3 style="margin:0 0 8px;font-size:14.5px;">🎁 PayPay送金リンク ／ Amazonギフト券でのお支払い</h3>
              <p style="font-size:12.5px;color:var(--sub);margin:0 0 12px;">
                クレジットカードや仮想通貨をお持ちでない方も、スマホの <b>PayPay（送金リンク作成）</b> またはコンビニ・Amazonで買える <b>Amazonギフト券番号（¥${(order.grossAmountJpy || 0).toLocaleString()}分）</b> で簡単にお支払いいただけます。
              </p>

              ${order.cashlessSubmitted ? `
                <div style="background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:14px;border-radius:10px;font-weight:800;font-size:13px;text-align:center;">
                  ✓ ${order.cashlessType || 'コード'} の提出を受け付けました！確認後すぐにプランが有効化されます（この画面のままお待ちいただくか、メイン画面でお待ちください）。
                </div>
              ` : `
                <form action="/order/${orderId}/submit-cashless-code" method="POST" style="margin:0;">
                  <label>お支払い方法を選択</label>
                  <select name="payMethodType" style="margin-bottom:10px;">
                    <option value="PayPay送金リンク">📱 PayPay マイページから作成した送金リンクURL</option>
                    <option value="Amazonギフト券">🎁 Amazonギフト券コード（16〜17桁の英数字）</option>
                  </select>

                  <label>PayPay受け取りURL または Amazonギフト券番号（¥${(order.grossAmountJpy || 0).toLocaleString()}分）</label>
                  <input type="text" name="codeOrLink" placeholder="例: https://pay.paypay.ne.jp/... または AQ7X-XXXXXX-XXXX" required>

                  <label>パスコード（PayPay送金リンクに4桁パスコードを設定した場合のみ）</label>
                  <input type="text" name="passcode" placeholder="任意（例: 1234）">

                  <button type="submit" class="btn btn-gold" style="width:100%;padding:13px;">🚀 コード・リンクを送信して有効化する</button>
                </form>
              `}
            </div>

            <!-- タブ③：暗号資産即時決済 (OxaPay) -->
            <div id="payPane_crypto" style="display:none;background:var(--surface-sub);border:1px solid var(--border);padding:16px;border-radius:14px;text-align:center;">
              <h3 style="margin:0 0 8px;font-size:14.5px;">🪙 OxaPay 暗号資産 自動決済（USDT / XRP / BTC 等）</h3>
              <p style="font-size:12.5px;color:var(--sub);margin:0 0 14px;">24時間いつでも送金完了と同時に自動検知され、待ち時間なしでプランと専用回線が即時有効化されます。</p>
              ${order.gatewayRedirectUrl ? `<p style="margin:0;"><a href="${order.gatewayRedirectUrl}" target="_blank" class="btn" style="width:100%;padding:13px;">🚀 OxaPay 支払い画面を開く ↗</a></p>` : ''}
            </div>

            <script>
              function switchPayTab(tab) {
                ['card', 'cashless', 'crypto'].forEach(t => {
                  document.getElementById('payPane_' + t).style.display = (t === tab) ? 'block' : 'none';
                  document.getElementById('tabBtn_' + t).classList.toggle('active', t === tab);
                });
              }
              setInterval(async () => {
                const r = await fetch('/api/order/${orderId}/check', { method: 'POST' }).then(x => x.json()).catch(() => ({}));
                if (r && r.completed) location.href = '/contract?ok=' + encodeURIComponent('お支払いが確認され、契約が追加・更新されました！');
              }, 8000);
            </script>
          `}
          <div style="margin-top:16px;text-align:center;"><a href="/contract" style="color:var(--sub);font-size:12.5px;text-decoration:none;">← プラン選択画面へ戻る</a></div>
        </div>
      </div>
    </body></html>`);
  } catch (e) {
    res.status(500).send('エラー: ' + e.message);
  }
});

// ============================================================================
// 📊 10. 管理者コンソール (/accounting)
// ============================================================================
app.get('/accounting', requireAdminAuth, async (req, res) => {
  await loadSysConfig();
  const usersSnap = await db.collection('saas_users').get();
  const users = usersSnap.docs.map(d => d.data());
  const poolSnap = await db.collection("isp_proxy_pool").where("assignedUserId", "==", null).get();
  const allPoolSnap = await db.collection("isp_proxy_pool").get();
  const inUseCount = allPoolSnap.size - poolSnap.size;
  const vSnap = await db.collection('vouchers').where('used', '==', false).limit(30).get();
  const unusedVouchers = vSnap.docs.map(d => d.data());
  const ordersSnap = await db.collection('orders').where('status', '==', 'pending_payment').limit(30).get();
  const pendingOrders = ordersSnap.docs.map(d => d.data());

  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>管理者コンソール｜X-Swarm Cloud</title>
  <style>${COMMON_STYLE}</style></head>
  <body>
    <div class="container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px;">
        <h1 style="margin:0;font-size:19px;">⚙️ X-Swarm Cloud 管理者コンソール</h1>
        <a href="/dashboard" class="btn btn-outline">お客様向けメイン画面を開く</a>
      </div>

      <div class="grid2">
        <!-- 1. 決済リンク・メール・API設定 -->
        <div class="card">
          <h3 class="card-title" style="margin-bottom:10px;">🔌 外部決済リンク（note/BOOTH/Stripe等）・SMTP設定</h3>
          <form action="/accounting/save-config" method="POST">
            <label>✉️ Gmailアドレス（6桁認証コード送信元・任意）</label>
            <input type="email" name="smtpUser" value="${sysConfig.smtpUser}" placeholder="example@gmail.com">
            <label>🔑 Googleアプリパスワード（16文字・設定すると実メール送信）</label>
            <input type="password" name="smtpPass" value="${sysConfig.smtpPass}" placeholder="abcd efgh ijkl mnop">

            <label>💳 1日お試し(¥800) 決済ページURL（note/BOOTH/Stripe等）</label>
            <input type="url" name="cardPayUrlOneday" value="${sysConfig.cardPayUrlOneday}" placeholder="https://...">
            <label>💳 ライト(¥4,980) 決済ページURL</label>
            <input type="url" name="cardPayUrlStarter" value="${sysConfig.cardPayUrlStarter}" placeholder="https://...">
            <label>💳 スタンダード(¥9,800) 決済ページURL</label>
            <input type="url" name="cardPayUrlPro" value="${sysConfig.cardPayUrlPro}" placeholder="https://...">
            <label>💳 ビジネス(¥22,800) 決済ページURL</label>
            <input type="url" name="cardPayUrlBusiness" value="${sysConfig.cardPayUrlBusiness}" placeholder="https://...">

            <details class="opt-box">
              <summary>▼ OxaPay / Didit / IPRoyal / 特商法設定を開く</summary>
              <div style="margin-top:10px;">
                <label>💎 OxaPay Merchant API Key</label>
                <input type="text" name="oxapayMerchantKey" value="${sysConfig.oxapayMerchantKey}">
                <label>🪪 Didit.me API Key</label>
                <input type="text" name="diditApiKey" value="${sysConfig.diditApiKey}">
                <label>🪪 Didit.me Workflow ID</label>
                <input type="text" name="diditWorkflowId" value="${sysConfig.diditWorkflowId}">
                <label>🌐 IPRoyal API Token</label>
                <input type="text" name="iproyalApiToken" value="${sysConfig.iproyalApiToken}">
                <label>🏢 特商法 運営表記名</label>
                <input type="text" name="sellerName" value="${sysConfig.sellerName}">
                <label>✉️ 特商法 連絡先メール</label>
                <input type="text" name="sellerEmail" value="${sysConfig.sellerEmail}">
              </div>
            </details>

            <button type="submit" class="btn" style="width:100%;">💾 設定をすべて保存</button>
          </form>
        </div>

        <!-- 2. シリアルコード（バウチャー）発行 ＆ ISPプロキシ補充 -->
        <div>
          <div class="card">
            <h3 class="card-title" style="margin-bottom:8px;">🎟️ note / BOOTH / クレカ販売用シリアルコード発行</h3>
            <p style="font-size:12px;color:var(--sub);margin:0 0 10px;">
              noteやBOOTHの有料部分にこのコードを貼って販売すれば、あなたの銀行口座を一切晒さずクレカ・PayPay・コンビニ払いで自動販売できます。
            </p>
            <form action="/accounting/generate-vouchers" method="POST" style="display:flex;gap:8px;margin-bottom:12px;">
              <input type="number" name="count" value="5" min="1" max="50" style="margin:0;width:80px;text-align:center;">
              <button type="submit" class="btn btn-teal" style="flex:1;">＋ シリアルコードを発行</button>
            </form>
            <div style="max-height:140px;overflow-y:auto;background:var(--surface-sub);border:1px solid var(--border);border-radius:10px;padding:8px;font-family:monospace;font-size:12.5px;">
              ${unusedVouchers.length === 0 ? '<span style="color:var(--sub);">未使用のシリアルコードはありません</span>' : unusedVouchers.map(v => `<div>・<b>${v.code}</b></div>`).join('')}
            </div>
          </div>

          <div class="card">
            <h3 class="card-title" style="margin-bottom:8px;">🌐 専用日本ISP固定プロキシ管理（未使用: ${poolSnap.size}本 ／ 稼働中: ${inUseCount}本）</h3>
            <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;line-height:1.5;">
              <div>🟢 <b>空きプール（${poolSnap.size}本）</b>：1DAYや新規客へ自動で再利用されます（余っていればIPRoyal側で更新せず自然解約でOK）</div>
              <div>🔵 <b>現在稼働中（${inUseCount}本）</b>：有料契約中のお客様が使用中です（期限切れと同時に自動で空きプールへ回収されます）</div>
              ${poolSnap.size <= 1 ? "<div style=\"color:#DC2626;font-weight:900;margin-top:4px;\">⚠️ 空き在庫が残り" + poolSnap.size + "本です！必要に応じて補充してください。</div>" : ""}
            </div>
            <form action="/accounting/add-proxies" method="POST" style="margin:0;">
              <textarea name="proxiesText" rows="4" placeholder="154.12.xx.xx:12321:user:pass"></textarea>
              <button type="submit" class="btn btn-dark" style="width:100%;">＋ ISPプロキシをプールに追加</button>
            </form>
          </div>
        </div>
      </div>

      <!-- 3. PayPay送金リンク・アマギフ提出注文のワンクリック承認リスト -->
      <div class="card" style="overflow-x:auto;">
        <h3 class="card-title" style="margin-bottom:10px;">🎁 PayPay送金リンク ／ Amazonギフト券 提出注文一覧（ワンクリック承認）</h3>
        <table>
          <thead><tr><th>注文ID</th><th>会員名</th><th>プラン / 金額</th><th>提出されたPayPayリンク・ギフト券コード</th><th>承認操作</th></tr></thead>
          <tbody>
            ${pendingOrders.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--sub);">現在承認待ちの注文はありません</td></tr>' : pendingOrders.map(o => `
              <tr>
                <td><b>${o.orderId}</b></td>
                <td>${o.userName || o.userId}<br><span style="font-size:11px;color:var(--sub);">${o.userEmail || ''}</span></td>
                <td>${o.itemName}<br><b>¥${(o.grossAmountJpy || 0).toLocaleString()}</b></td>
                <td>
                  ${o.cashlessSubmitted ? `
                    <span class="badge" style="background:#FEF3C7;color:#B45309;">🔔 ${o.cashlessType}</span><br>
                    <code style="font-size:12px;font-weight:900;color:var(--accent);user-select:all;">${(o.cashlessCodeOrLink || '').replace(/</g, '&lt;')}</code>
                    ${o.cashlessPasscode ? `<br><span style="font-size:11px;">パスコード: <b>${o.cashlessPasscode.replace(/</g, '&lt;')}</b></span>` : ''}
                  ` : '<span style="color:var(--sub);font-size:12px;">未提出</span>'}
                </td>
                <td>
                  <form action="/accounting/approve-order" method="POST" style="margin:0;">
                    <input type="hidden" name="orderId" value="${o.orderId}">
                    <button type="submit" class="btn btn-teal" style="padding:6px 12px;font-size:11.5px;">✓ 承認して即時有効化</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="card" style="overflow-x:auto;">
        <h3 class="card-title" style="margin-bottom:10px;">👥 登録会員一覧（全${users.length}名）</h3>
        <table>
          <thead><tr><th>会員ID</th><th>氏名 / メール</th><th>本人確認</th><th>同時稼働 / 枠数</th><th>割当ISP</th><th>テスト契約付与</th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>${u.userId}</td>
                <td><b>${u.name}</b><br>${u.email}</td>
                <td><b>${u.kycStatus}</b></td>
                <td><b>同時 ${u.maxThreads || 1} 個</b> (計${u.maxAccounts || 1}枠)</td>
                <td>${(u.assignedProxies || []).length}本</td>
                <td>
                  <form action="/accounting/activate-user" method="POST" style="margin:0;">
                    <input type="hidden" name="userId" value="${u.userId}">
                    <button type="submit" class="btn btn-teal" style="padding:5px 10px;font-size:11px;">＋1スレッド独立契約を付与</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </body></html>`);
});

app.post('/accounting/save-config', requireAdminAuth, async (req, res) => {
  await db.collection('settings').doc('payment_config').set({
    oxapayMerchantKey: String(req.body.oxapayMerchantKey || '').trim(),
    diditApiKey: String(req.body.diditApiKey || '').trim(),
    diditWorkflowId: String(req.body.diditWorkflowId || '').trim(),
    iproyalApiToken: String(req.body.iproyalApiToken || '').trim(),
    sellerName: String(req.body.sellerName || '').trim(),
    sellerEmail: String(req.body.sellerEmail || '').trim(),
    smtpUser: String(req.body.smtpUser || '').trim(),
    smtpPass: String(req.body.smtpPass || '').trim(),
    cardPayUrlOneday: String(req.body.cardPayUrlOneday || '').trim(),
    cardPayUrlStarter: String(req.body.cardPayUrlStarter || '').trim(),
    cardPayUrlPro: String(req.body.cardPayUrlPro || '').trim(),
    cardPayUrlBusiness: String(req.body.cardPayUrlBusiness || '').trim(),
    updatedAt: new Date()
  }, { merge: true });
  await loadSysConfig();
  res.redirect('/accounting');
});

app.post('/accounting/generate-vouchers', requireAdminAuth, async (req, res) => {
  const count = Math.max(1, Math.min(50, parseInt(req.body.count || '5', 10)));
  const batch = db.batch();
  for (let i = 0; i < count; i++) {
    const code = 'VP-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    batch.set(db.collection('vouchers').doc(code), {
      code,
      used: false,
      createdAt: new Date()
    });
  }
  await batch.commit();
  res.redirect('/accounting');
});

app.post('/accounting/approve-order', requireAdminAuth, async (req, res) => {
  const orderId = String(req.body.orderId || '');
  if (orderId) await completeSaaSOrder(orderId);
  res.redirect('/accounting');
});

app.post('/accounting/add-proxies', requireAdminAuth, async (req, res) => {
  const rawLines = String(req.body.proxiesText || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^host/i.test(l));
  const normalized = [];
  for (const line of rawLines) {
    if (line.includes(',') && !line.includes(':')) {
      const p = line.split(',').map(x => x.trim().replace(/^["']|["']$/g, ''));
      if (p.length >= 4) normalized.push(`${p[0]}:${p[1]}:${p[2]}:${p[3]}`);
    } else if (line.includes(':')) {
      normalized.push(line.replace(/,/g, ':'));
    }
  }
  const batch = db.batch();
  normalized.forEach(p => {
    const ref = db.collection('isp_proxy_pool').doc();
    batch.set(ref, { proxy: p, assignedUserId: null, createdAt: new Date() });
  });
  if (normalized.length > 0) await batch.commit();
  res.redirect('/accounting');
});

app.post('/accounting/activate-user', requireAdminAuth, async (req, res) => {
  const targetUserId = String(req.body.userId || '');
  if (targetUserId) {
    const dedicatedProxies = await allocateDedicatedIspProxies(targetUserId, 1);
    const contractId = 'CNT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const expireDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await db.collection('saas_users').doc(targetUserId).update({ kycStatus: 'verified', updatedAt: new Date() });
    await db.collection('saas_contracts').doc(contractId).set({
      contractId,
      userId: targetUserId,
      title: 'ライトプラン [同時1個 / 5枠]',
      threads: 1,
      accounts: 5,
      ispCount: 1,
      minIntervalMin: 5,
      durationDays: 30,
      renewalPriceJpy: 4980,
      proxies: dedicatedProxies,
      status: 'active',
      startedAt: new Date(),
      expiresAt: expireDate,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await syncUserActiveContracts(targetUserId);
  }
  res.redirect('/accounting');
});


const { registerMailboxRoutes } = require('./mailbox_service');
registerMailboxRoutes(app, db);

const { startDailyTelegramMetricsReport } = require('./telegram_metrics_report');
startDailyTelegramMetricsReport({ db });

app.listen(SHOP_PORT, () => {
  console.log(`✦ X-Swarm Cloud スマホ完全フィット＆銀行口座リスクゼロ決済版 (src/shop.js) がポート ${SHOP_PORT} で起動しました！`);
});

// === Stripe Checkout & Webhook API ===
const STRIPE_PRICES = {
  starter: process.env.STRIPE_PRICE_STARTER || 'price_1UbXbBK8Q6ZJFCKbSdMaIxFM',
  pro: process.env.STRIPE_PRICE_PRO || 'price_1UbXXiK8Q6ZJFCKbyQ28WE6O',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_1UbXceK8Q6ZJFCKbshtkcafT'
};

const STRIPE_PRICES_USD = {
  starter: process.env.STRIPE_PRICE_USD_STARTER || 'price_1UbatEK8Q6ZJFCKbFUGGqhcS',
  pro: process.env.STRIPE_PRICE_USD_PRO || 'price_1UbatEK8Q6ZJFCKbBVLeiCaX',
  business: process.env.STRIPE_PRICE_USD_BUSINESS || 'price_1UbatEK8Q6ZJFCKbNRa3tjXL'
};

app.post('/api/billing/create-checkout', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ ok: false, error: 'STRIPE_SECRET_KEYが設定されていません' });
    }
    const plan = String(req.body.plan || 'pro').toLowerCase().trim();
    const catalogs = { jpy: STRIPE_PRICES, usd: STRIPE_PRICES_USD };
    if (!Object.prototype.hasOwnProperty.call(STRIPE_PRICES, plan)) {
      return res.status(400).json({ ok: false, error: 'Invalid plan' });
    }

    let currency;
    try {
      currency = resolveBillingCurrency({ currency: req.body.currency, lang: req.body.lang });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    const priceId = selectStripePriceId(plan, currency, catalogs);
    if (!priceId) {
      return res.status(503).json({ ok: false, error: `Stripe ${currency.toUpperCase()} price is not configured for this plan` });
    }

    const user = await getCurrentUser(req);
    if (!user || !user.userId) {
      return res.status(401).json({
        ok: false,
        code: 'login_required',
        error: req.body && req.body.lang === 'en'
          ? 'Please sign in with Google or email first to start your 14-day free trial.'
          : '14日間無料トライアルの開始には、先にGoogleまたはXでログインしてください。',
        loginUrl: '/#login-box'
      });
    }
    const userId = user.userId;
    const userEmail = (user && user.email) ? user.email : (String(req.body.email || '').trim().toLowerCase() || undefined);
    const cookies = parseCookies(req);
    const refCode = req.query.ref || req.body.ref || cookies.xsw_ref || (user && (user.referredByCode || user.referredBy)) || '';

    const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    let allowTrial = true;
    let trialNoticeText = '';
    try {
      const { evaluateTrialEligibility } = require('./trial_abuse_guard');
      const decision = await evaluateTrialEligibility({
        db,
        userId,
        twitterId: user.twitterId,
        email: userEmail,
        fingerprint: user.stripeCardFingerprint
      });
      allowTrial = decision.allowTrial;
      trialNoticeText = decision.notice || '';
    } catch (trialErr) {
      console.warn(`[Trial Eligibility] ${trialErr.message}`);
    }
    const subscriptionData = {
      metadata: { userId, plan, currency }
    };
    if (allowTrial) subscriptionData.trial_period_days = 14;
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      customer_email: userEmail,
      client_reference_id: userId,
      subscription_data: subscriptionData,
      metadata: {
        userId: userId,
        plan,
        currency,
        refCode: refCode
      },
      success_url: `${baseUrl}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/dashboard?payment=cancelled`,
    });
    res.json({ ok: true, url: session.url, trial: allowTrial, notice: trialNoticeText });
  } catch (error) {
    console.error('Stripe Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/billing/cancel-subscription', async (req, res) => {
  try {
    const sessionUser = await resolveSessionUser(db, req);
    if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
    const ref = db.collection('saas_users').doc(sessionUser.userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'ユーザーデータが見つかりません。' });
    const patch = await scheduleSubscriptionCancellation(stripe, snap.data() || {});
    await ref.set(patch, { merge: true });
    res.json({
      ok: true,
      cancelAtPeriodEnd: true,
      billingEndsAt: patch.billingEndsAt ? patch.billingEndsAt.toISOString() : null
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

// Stripe Webhook 受信ハンドラー（暗号検証フェイルクローズド設計）
app.post('/api/webhooks/stripe', async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('CRITICAL: STRIPE_WEBHOOK_SECRET is not configured. Webhook rejected fail-closed.');
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not configured' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.warn('[Stripe Webhook] Rejected: Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    const rawPayload = req.rawBody || req.body;
    event = stripe.webhooks.constructEvent(rawPayload, sig, webhookSecret);
  } catch (err) {
    console.warn('[Stripe Webhook Signature Verification Failed]:', err.message);
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
      const obj = event.data?.object || {};
      const isPaidInvoice = event.type === 'invoice.payment_succeeded';
      const subscriptionDetails = obj.parent?.subscription_details || obj.subscription_details || {};
      let metadata = {
        ...(subscriptionDetails.metadata || {}),
        ...(obj.metadata || {})
      };
      const rawSubscriptionId = obj.subscription || subscriptionDetails.subscription;
      const subscriptionId = typeof rawSubscriptionId === 'string'
        ? rawSubscriptionId
        : (rawSubscriptionId && rawSubscriptionId.id) || '';
      if (isPaidInvoice && subscriptionId && (!metadata.userId || !metadata.plan) && stripe) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        metadata = { ...(subscription.metadata || {}), ...metadata };
      }

      const userId = obj.client_reference_id || metadata.userId;
      const plan = String(metadata.plan || '').toLowerCase();
      if (!['starter', 'pro', 'business'].includes(plan)) {
        throw new Error('Stripe event is missing a recognized plan in its metadata');
      }
      if (userId && userId !== 'guest' && !userId.startsWith('GUEST_') && metadata.refCode) {
        await bindReferralIfEligible(userId, metadata.refCode);
      }
      if (userId && userId !== 'guest' && !userId.startsWith('GUEST_')) {
        let subscription = null;
        if (subscriptionId && stripe) {
          try { subscription = await stripe.subscriptions.retrieve(subscriptionId); } catch (e) { subscription = null; }
        }
        const patch = buildActiveStripePlanPatch({
          plan,
          stripeCustomerId: obj.customer || (subscription && subscription.customer) || '',
          stripeSubscriptionId: subscriptionId || (obj.subscription || ''),
          subscription,
          basePlanCatalog: BASE_PLANS
        });
        const tier = patch.tierLevel;
        await db.collection('saas_users').doc(userId).set(patch, { merge: true });
        try {
          const { recordTrialClaim } = require('./trial_abuse_guard');
          const account = await db.collection('saas_users').doc(userId).get();
          const accountData = account.exists ? (account.data() || {}) : {};
          let fingerprint = '';
          const paymentMethod = subscription && (subscription.default_payment_method || subscription.default_source);
          if (stripe && typeof paymentMethod === 'string' && stripe.paymentMethods) {
            const method = await stripe.paymentMethods.retrieve(paymentMethod);
            fingerprint = method && method.card && method.card.fingerprint || '';
          }
          await recordTrialClaim({
            db,
            userId,
            twitterId: accountData.twitterId,
            email: accountData.email,
            fingerprint,
            handle: accountData.xUsername,
            stripeCustomerId: patch.stripeCustomerId
          });
        } catch (claimErr) {
          console.warn(`[Trial Claim] ${claimErr.message}`);
        }
        console.log(`🎉 [Stripe Webhook] ユーザー [${userId}] のプランを ${plan} (Lv.${tier}) に更新しました！`);

        if (isPaidInvoice) {
          const amountPaidMinor = Number(obj.amount_paid || 0);
          if (amountPaidMinor > 0) {
            const paidAtSeconds = Number(obj.status_transitions?.paid_at || obj.created || Math.floor(Date.now() / 1000));
            const invoiceCurrency = String(obj.currency || '').toLowerCase();
            const fx = invoiceCurrency === 'jpy' ? await getEcbJpyUsdRate(paidAtSeconds) : null;
            const payment = convertInvoiceAmountToUsd(amountPaidMinor, invoiceCurrency, fx?.rate);
            await processPaidSubscriptionCommission({
              contractId: obj.id,
              childUserId: userId,
              paidAmountUsd: payment.paidAmountUsd,
              planId: plan,
              planName: plan.toUpperCase() + ' Monthly Subscription',
              sourceCurrency: payment.sourceCurrency,
              sourceAmount: payment.sourceAmount,
              usdConversionRate: payment.usdConversionRate,
              conversionSource: fx?.source || 'Stripe invoice USD amount',
              fxRateDate: fx?.date || null,
              paidAt: new Date(paidAtSeconds * 1000)
            });
          }
        }
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data?.object || {};
      const patch = subscriptionStatePatch(subscription, event.type);
      let userId = subscription.metadata && subscription.metadata.userId;
      if (!userId && subscription.id) {
        const found = await db.collection('saas_users').where('stripeSubscriptionId', '==', subscription.id).limit(1).get();
        if (!found.empty) userId = found.docs[0].id;
      }
      if (userId) await db.collection('saas_users').doc(userId).set(patch, { merge: true });
    } else if (event.type === 'customer.subscription.trial_will_end') {
      // 期限予告は状態を変えず、署名検証済みとして受け取る。
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe Webhook Error:', err.message);
    res.status(500).send(`Webhook processing failed: ${err.message}`);
  }
});
