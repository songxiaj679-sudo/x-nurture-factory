const crypto = require('crypto');
const { setAuthCookies } = require('./auth_service');

const STATE_COOKIE = 'google_oauth_state';
const DEFAULT_REFERRAL_CODE = 'XSW-B334EF';
const PRIVILEGED_EMAILS = ['hank3jones@gmail.com', 'songxiaj679@gmail.com'];

function isPrivilegedEmail(email) {
  return PRIVILEGED_EMAILS.includes(String(email || '').trim().toLowerCase());
}

function getGoogleOAuthConfig(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = String(env.GOOGLE_REDIRECT_URI || '').trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required');
  }

  let redirectUrl;
  try {
    redirectUrl = new URL(redirectUri);
  } catch (error) {
    throw new Error('GOOGLE_REDIRECT_URI must be an absolute URL');
  }
  if (redirectUrl.protocol !== 'https:' &&
      !(redirectUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirectUrl.hostname))) {
    throw new Error('GOOGLE_REDIRECT_URI must use HTTPS outside localhost');
  }

  return { clientId, clientSecret, redirectUri, secureCookie: redirectUrl.protocol === 'https:' };
}

function buildGoogleAuthorizationUrl(config, state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

function matchesOAuthState(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  return expectedBuffer.length > 0 &&
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function readCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function setStateCookie(res, state, secure) {
  const secureAttribute = secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureAttribute}`);
}

function clearStateCookie(res, secure) {
  const secureAttribute = secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function sendErrorPage(res, status, message) {
  res.status(status);
  res.setHeader('Cache-Control', 'no-store');
  return res.type('html').send(`<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Googleログインエラー</title>
<body style="font-family: sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; color: #1e293b">
  <h1>Googleログインを完了できませんでした</h1>
  <p>${escapeHtml(message)}</p>
  <p><a href="/">ホームに戻る</a></p>
</body>
</html>`);
}

function safeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function exchangeAuthorizationCode(config, code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Google token endpoint returned HTTP ${response.status}`);

  const tokenData = await response.json();
  if (!tokenData || typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
    throw new Error('Google token response did not contain an access token');
  }
  return tokenData.access_token;
}

async function getVerifiedGoogleProfile(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Google user-info endpoint returned HTTP ${response.status}`);

  const profile = await response.json();
  const email = String(profile && profile.email || '').trim().toLowerCase();
  if (!profile || typeof profile.sub !== 'string' || !profile.sub ||
      profile.email_verified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Google did not return a verified email address');
  }
  return { sub: profile.sub, email };
}

async function findOrCreateGoogleUser(db, profile) {
  const users = db.collection('saas_users');
  const subSnapshot = await users.where('googleSub', '==', profile.sub).limit(1).get();
  let userDoc = subSnapshot.empty ? null : subSnapshot.docs[0];
  if (!userDoc) {
    const emailSnapshot = await users.where('email', '==', profile.email).limit(1).get();
    userDoc = emailSnapshot.empty ? null : emailSnapshot.docs[0];
  }

  const now = new Date();
  if (userDoc) {
    const user = userDoc.data() || {};
    const authProviders = Array.isArray(user.authProviders) ? [...user.authProviders] : [];
    if (user.passwordHash && !authProviders.includes('password')) authProviders.push('password');
    if (!authProviders.includes('google')) authProviders.push('google');
    const sessionToken = crypto.randomBytes(24).toString('hex');
    await userDoc.ref.set({
      email: profile.email,
      googleSub: profile.sub,
      sessionToken,
      emailVerified: true,
      authProviders,
      lastLoginAt: now,
      updatedAt: now
    }, { merge: true });

    return {
      userId: user.userId || userDoc.id,
      email: profile.email,
      sessionToken,
      tierLevel: isPrivilegedEmail(profile.email) ? 4 :
        (user.planStatus === 'active' && user.tierLevel ? user.tierLevel : 0),
      planId: isPrivilegedEmail(profile.email) ? 'business' : (user.planId || 'free')
    };
  }

  const isPrivilegedAccount = isPrivilegedEmail(profile.email);
  const userId = 'WEB-GOOGLE-' + crypto.createHash('sha256').update(profile.sub).digest('hex').slice(0, 20).toUpperCase();
  const sessionToken = crypto.randomBytes(24).toString('hex');
  await users.doc(userId).set({
    userId,
    email: profile.email,
    googleSub: profile.sub,
    sessionToken,
    emailVerified: true,
    authProviders: ['google'],
    planId: isPrivilegedAccount ? 'business' : 'free',
    planStatus: isPrivilegedAccount ? 'active' : 'free',
    tierLevel: isPrivilegedAccount ? 4 : 0,
    maxThreads: isPrivilegedAccount ? 3 : 1,
    maxAccounts: isPrivilegedAccount ? 50 : 1,
    aiReplyUnlocked: isPrivilegedAccount,
    myRefCode: 'XSW-' + crypto.createHash('md5').update(profile.email).digest('hex').slice(0, 6).toUpperCase(),
    referredBy: DEFAULT_REFERRAL_CODE,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  });

  return {
    userId,
    email: profile.email,
    sessionToken,
    tierLevel: isPrivilegedAccount ? 4 : 0,
    planId: isPrivilegedAccount ? 'business' : 'free'
  };
}

function registerGoogleAuthRoutes(app, db) {
  app.get('/api/auth/google', (req, res) => {
    let config;
    try {
      config = getGoogleOAuthConfig();
    } catch (error) {
      return sendErrorPage(res, 503, 'Googleログインの設定が未完了です。管理者にOAuth環境変数の設定を依頼してください。');
    }

    const state = crypto.randomBytes(32).toString('hex');
    setStateCookie(res, state, config.secureCookie);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, buildGoogleAuthorizationUrl(config, state));
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    let config;
    try {
      config = getGoogleOAuthConfig();
    } catch (error) {
      clearStateCookie(res, true);
      return sendErrorPage(res, 503, 'Googleログインの設定が未完了です。管理者にOAuth環境変数の設定を依頼してください。');
    }

    const expectedState = readCookie(req, STATE_COOKIE);
    const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
    clearStateCookie(res, config.secureCookie);
    if (!matchesOAuthState(expectedState, returnedState)) {
      return sendErrorPage(res, 400, '認証の確認に失敗しました。ホームに戻って、もう一度お試しください。');
    }
    if (typeof req.query.error === 'string') {
      return sendErrorPage(res, 401, 'Googleログインがキャンセルされたか、承認されませんでした。');
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return sendErrorPage(res, 400, 'Googleから認証コードを受け取れませんでした。もう一度お試しください。');

    try {
      const accessToken = await exchangeAuthorizationCode(config, code);
      const profile = await getVerifiedGoogleProfile(accessToken);
      const user = await findOrCreateGoogleUser(db, profile);
      const callbackData = safeScriptJson({
        ...user,
        token: user.sessionToken || `${user.userId}_token`
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      setAuthCookies(res, user.sessionToken, user, req);
      return res.type('html').send(`<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ログイン中</title>
<body style="font-family: sans-serif; text-align: center; padding: 4rem 1rem">
  <p>ログインを完了しています...</p>
  <script>
    const googleUser = ${callbackData};
    localStorage.setItem('xsw_email', googleUser.email);
    localStorage.setItem('xsw_uid', googleUser.userId);
    localStorage.setItem('xsw_token', googleUser.sessionToken || googleUser.token);
    localStorage.setItem('xsw_tier', String(googleUser.tierLevel));
    localStorage.removeItem('xsw_signed_out');
    window.location.replace('/dashboard');
  </script>
</body>
</html>`);
    } catch (error) {
      console.error('[Google OAuth] Callback failed:', error.message);
      return sendErrorPage(res, 500, 'Googleログインの処理中にエラーが発生しました。時間をおいて再度お試しください。');
    }
  });
}

module.exports = {
  buildGoogleAuthorizationUrl,
  findOrCreateGoogleUser,
  getGoogleOAuthConfig,
  matchesOAuthState,
  registerGoogleAuthRoutes
};
