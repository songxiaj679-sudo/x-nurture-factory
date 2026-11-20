const crypto = require('crypto');
const express = require('express');
const { resolveSessionUser, setAuthCookies } = require('./auth_service');

const STATE_COOKIE = 'x_oauth_state';
const VERIFIER_COOKIE = 'x_oauth_verifier';
const DEFAULT_REFERRAL_CODE = 'XSW-B334EF';
const PRIVILEGED_HANDLES = ['VeloxSystemsV4', 'songxiaj679'];

function isPrivilegedHandle(handle) {
  return PRIVILEGED_HANDLES.map(h => h.toLowerCase()).includes(String(handle || '').replace(/^@/, '').trim().toLowerCase());
}

function getTwitterOAuthConfig(env = process.env) {
  const clientId = String(env.X_CLIENT_ID || env.TWITTER_CLIENT_ID || '').trim();
  const clientSecret = String(env.X_CLIENT_SECRET || env.TWITTER_CLIENT_SECRET || '').trim();
  const redirectUri = String(env.X_REDIRECT_URI || env.TWITTER_REDIRECT_URI || 'https://veloxpostapp.com/api/auth/twitter/callback').trim();

  return {
    clientId,
    clientSecret,
    redirectUri,
    isConfigured: !!clientId
  };
}

function buildTwitterAuthorizationUrl(config, state, codeChallenge) {
  const url = new URL('https://twitter.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  const scope = process.env.X_MEDIA_WRITE_ENABLED === 'true'
    ? 'tweet.read tweet.write offline.access users.read media.write'
    : 'tweet.read tweet.write offline.access users.read';
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
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

function matchesOAuthState(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  return expectedBuffer.length > 0 &&
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function exchangeTwitterCode(config, code, codeVerifier) {
  const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'VeloxPostCloud/1.0'
  };

  if (config.clientSecret) {
    const creds = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${creds}`;
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: params.toString()
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const errDetail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`X OAuth2 トークン取得失敗: ${errDetail}`);
  }

  return data;
}

async function getTwitterProfile(accessToken) {
  const userUrl = 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,public_metrics';
  const res = await fetch(userUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'VeloxPostCloud/1.0'
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data || !data.data.username) {
    throw new Error('X ユーザープロフィールの取得に失敗しました');
  }

  return {
    id: data.data.id,
    name: data.data.name,
    username: data.data.username,
    profileImageUrl: data.data.profile_image_url || null,
    description: data.data.description || ''
  };
}

function accountLinkScore(doc, preferredId) {
  const data = doc.data() || {};
  const id = String(data.userId || doc.id || '');
  let score = 0;
  if (preferredId && id === preferredId) score += 100;
  if (id.startsWith('WEB-GOOGLE-') || data.googleSub || (Array.isArray(data.authProviders) && data.authProviders.includes('google'))) score += 40;
  if (data.planStatus === 'active') score += 20;
  return score;
}

async function syncSiblingXCredentials(docs, primaryId, patch) {
  for (const doc of docs) {
    if (!doc || doc.id === primaryId || !doc.ref || !doc.ref.set) continue;
    await doc.ref.set(patch, { merge: true });
  }
}

async function findOrCreateTwitterUser(db, profile, tokenData = {}, existingUid = null, connectionIntent = null) {
  const users = db.collection('saas_users');
  const cleanHandle = String(profile.username || '').replace(/^@/, '').trim();
  const twitterEmail = `${cleanHandle.toLowerCase()}@x.com`;

  let userDoc = null;

  // 0. ログイン済みユーザーからの「X連携」の場合は、既存アカウントへ直接紐付け
  if (existingUid) {
    const eDoc = await users.doc(existingUid).get();
    if (eDoc.exists) {
      userDoc = eDoc;
    }
  }
  if (connectionIntent && !userDoc) throw new Error('連携先のユーザーが見つかりません。');

  const twitterDocs = profile.id ? await users.where('twitterId', '==', profile.id).get() : { empty: true, docs: [] };
  const sameXAccounts = twitterDocs.empty ? [] : twitterDocs.docs;
  if (!userDoc && sameXAccounts.length) {
    const preferredId = existingUid || '';
    userDoc = sameXAccounts.slice().sort((a, b) => accountLinkScore(b, preferredId) - accountLinkScore(a, preferredId))[0];
  }

  // 2. Search by xUsername
  if (!userDoc) {
    const uSnapshot = await users.where('xUsername', '==', cleanHandle).limit(1).get();
    userDoc = uSnapshot.empty ? null : uSnapshot.docs[0];
  }

  // 3. Search by fallback email
  if (!userDoc) {
    const eSnapshot = await users.where('email', '==', twitterEmail).limit(1).get();
    userDoc = eSnapshot.empty ? null : eSnapshot.docs[0];
  }

  const now = new Date();
  const sessionToken = connectionIntent && connectionIntent.sessionToken
    ? connectionIntent.sessionToken
    : crypto.randomBytes(24).toString('hex');
  const isPrivileged = isPrivilegedHandle(cleanHandle);
  const saasUserId = userDoc ? (userDoc.data().userId || userDoc.id) : ('WEB-X-' + profile.id);
  let keptRefreshToken = '';
  if (userDoc) {
    const stored = userDoc.data() || {};
    keptRefreshToken = stored.twitterRefreshToken || '';
    if (!keptRefreshToken && stored.xOfficialCredentials) {
      try {
        const { decryptCredentials } = require('./official_api_client');
        keptRefreshToken = decryptCredentials(stored.xOfficialCredentials).oauth2RefreshToken || '';
      } catch (e) {}
    }
  }

  // 🔑 Xでログイン時に自動で自律投稿用の公式APIトークンを暗号化保存（手動設定を完全不要化）
  let autoOfficialCreds = {};
  if (tokenData.access_token) {
    try {
      const { encryptCredentials } = require('./official_api_client');
      const oauth2Payload = {
        authType: 'oauth2',
        oauth2AccessToken: tokenData.access_token,
        oauth2RefreshToken: tokenData.refresh_token || keptRefreshToken,
        oauth2ExpiresAt: new Date(Date.now() + (tokenData.expires_in || 7200) * 1000).toISOString(),
        username: cleanHandle,
        userId: profile.id,
        saasUserId,
        oauth2Scope: String(tokenData.scope || '').trim()
      };
      autoOfficialCreds = {
        xOfficialCredentials: encryptCredentials(oauth2Payload),
        officialApiKey: true,
        officialAccessToken: true,
        twitterAuth: oauth2Payload,
        twitterRefreshToken: tokenData.refresh_token || keptRefreshToken || '',
        xMediaWriteEnabled: /\bmedia\.write\b/.test(String(tokenData.scope || ''))
      };
    } catch (encErr) {
      console.error('[TwitterAuth] Failed to auto-encrypt official credentials:', encErr.message);
    }
  }

  if (userDoc) {
    const user = userDoc.data() || {};
    const authProviders = Array.isArray(user.authProviders) ? [...user.authProviders] : [];
    if (!authProviders.includes('twitter')) authProviders.push('twitter');

    const isSecondaryWorkspace = Boolean(user.ownerUid && user.ownerUid !== userDoc.id);
    const userUpdate = {
      userId: user.userId || userDoc.id,
      twitterId: profile.id,
      xUsername: cleanHandle,
      xName: profile.name,
      xProfileImageUrl: profile.profileImageUrl,
      authProviders,
      lastLoginAt: now,
      updatedAt: now,
      xLinkStatus: 'connected',
      xLinkMessage: '',
      xLastLinkedAt: now,
      xFirstLinkedAt: user.xFirstLinkedAt || now,
      xLinkHealthStatus: 'ok',
      relinkRequired: false,
      xSuspendedAt: null,
      xSuspendedReason: null,
      suspendedNoticeSentAt: null,
      xAccountIds: Array.from(new Set([...(Array.isArray(user.xAccountIds) ? user.xAccountIds : []), user.twitterId, profile.id].filter(Boolean))),
      ...autoOfficialCreds
    };
    if (!isSecondaryWorkspace) userUpdate.sessionToken = sessionToken;
    if (connectionIntent) {
      if (!profile.id || !autoOfficialCreds.xOfficialCredentials) {
        throw new Error('Xアカウントの認証情報を保存できません。');
      }
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(userDoc.ref);
        const snapData = snapshot.exists ? (snapshot.data() || {}) : {};
        let expectedSessionToken = snapData.sessionToken;
        if (!expectedSessionToken && snapData.ownerUid && snapData.ownerUid !== userDoc.id) {
          const ownerSnap = await tx.get(users.doc(snapData.ownerUid));
          expectedSessionToken = ownerSnap.exists ? (ownerSnap.data() || {}).sessionToken : '';
        }
        if (!snapshot.exists || expectedSessionToken !== connectionIntent.sessionToken) {
          throw new Error('ログイン状態が変わりました。もう一度お試しください。');
        }
        const data = snapData;
        const revokedAt = data.autopilotConsent && data.autopilotConsent.revokedAt;
        const revokedMs = revokedAt && (revokedAt.toDate ? revokedAt.toDate().getTime() : new Date(revokedAt).getTime());
        if (connectionIntent.autoPostingAccepted && revokedMs && revokedMs >= connectionIntent.startedAt) {
          throw new Error('連携中に自動投稿の同意が撤回されました。必要なら改めて同意してください。');
        }
        userUpdate.connectionTermsConsent = { version: 1, acceptedAt: new Date() };
        if (connectionIntent.autoPostingAccepted) {
          userUpdate.autopilotConsent = { version: 1, account: `id:${profile.id}`, granted: true, grantedAt: new Date() };
        }
        tx.set(userDoc.ref, userUpdate, { merge: true });
      });
    } else {
      await userDoc.ref.set(userUpdate, { merge: true });
    }
    await syncSiblingXCredentials(sameXAccounts, userDoc.id, {
      twitterId: profile.id,
      xUsername: cleanHandle,
      xName: profile.name,
      xProfileImageUrl: profile.profileImageUrl,
      xLinkStatus: 'connected',
      xLinkMessage: '',
      xLastLinkedAt: now,
      updatedAt: now,
      ...autoOfficialCreds
    });

    return {
      userId: user.userId || userDoc.id,
      email: user.email || twitterEmail,
      xUsername: cleanHandle,
      xName: profile.name,
      xProfileImageUrl: profile.profileImageUrl,
      sessionToken,
      tierLevel: isPrivileged ? 4 : (user.planStatus === 'active' && user.tierLevel ? user.tierLevel : 0),
      planId: isPrivileged ? 'business' : (user.planId || 'free')
    };
  }

  // Create new user
  const userId = 'WEB-X-' + profile.id;
  await users.doc(userId).set({
    userId,
    email: twitterEmail,
    twitterId: profile.id,
    xUsername: cleanHandle,
    xName: profile.name,
    xProfileImageUrl: profile.profileImageUrl,
    sessionToken,
    emailVerified: true,
    authProviders: ['twitter'],
    planId: isPrivileged ? 'business' : 'free',
    planStatus: isPrivileged ? 'active' : 'free',
    tierLevel: isPrivileged ? 4 : 0,
    maxThreads: isPrivileged ? 3 : 1,
    maxAccounts: isPrivileged ? 50 : 1,
    aiReplyUnlocked: isPrivileged,
    myRefCode: 'XSW-' + crypto.createHash('md5').update(cleanHandle).digest('hex').slice(0, 6).toUpperCase(),
    referredBy: DEFAULT_REFERRAL_CODE,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    xLinkStatus: autoOfficialCreds.xOfficialCredentials ? 'connected' : '',
    xLinkMessage: '',
    xFirstLinkedAt: autoOfficialCreds.xOfficialCredentials ? now : null,
    xLastLinkedAt: autoOfficialCreds.xOfficialCredentials ? now : null,
    xAccountIds: profile.id ? [profile.id] : [],
    ...autoOfficialCreds
  });

  return {
    userId,
    email: twitterEmail,
    xUsername: cleanHandle,
    xName: profile.name,
    xProfileImageUrl: profile.profileImageUrl,
    sessionToken,
    tierLevel: isPrivileged ? 4 : 0,
    planId: isPrivileged ? 'business' : 'free'
  };
}

function registerTwitterAuthRoutes(app, db) {
  app.post('/api/auth/twitter/connect', express.urlencoded({ extended: false }), async (req, res) => {
    if (!req.body || req.body.terms !== 'on') {
      return res.status(400).send('X連携には利用規約とプライバシーポリシーへの同意が必要です。');
    }
    const user = await resolveSessionUser(db, req);
    if (!user || !user.sessionToken) return res.status(401).send('ログインし直してからXを連携してください。');
    const config = getTwitterOAuthConfig();
    if (!config.isConfigured) return res.status(503).send('X公式OAuth連携が設定されていません。');

    const nonce = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();
    const binding = crypto.createHash('sha256').update(`${nonce}:${user.sessionToken}`).digest('hex');
    const state = `${nonce}.connect1.${req.body.autopost === 'on' ? '1' : '0'}.${timestamp}.${binding}`;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    res.cookie(STATE_COOKIE, state, { httpOnly: true, maxAge: 600000, sameSite: 'lax', secure: true });
    res.cookie(VERIFIER_COOKIE, verifier, { httpOnly: true, maxAge: 600000, sameSite: 'lax', secure: true });
    return res.redirect(302, buildTwitterAuthorizationUrl(config, state, challenge));
  });

  // 1. Initiate X OAuth 2.0 Login
  app.get('/api/auth/twitter', (req, res) => {
    const config = getTwitterOAuthConfig();

    // If OAuth2 Client ID is not yet entered in .env, render setup / instant handle entry page
    if (!config.isConfigured) {
      return res.type('html').send(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>X (Twitter) ログイン設定 ｜ VeloxPost Cloud</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen p-4 font-sans">
  <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-10 h-10 rounded-xl bg-black border border-slate-700 flex items-center justify-center">
        <svg class="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </div>
      <div>
        <h2 class="text-lg font-bold">X (Twitter) ログイン</h2>
        <p class="text-xs text-slate-400">OAuth 2.0 / クイック連携</p>
      </div>
    </div>

    <!-- X OAuth2 Gateway -->
    <div class="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4 mb-4">
      <h3 class="text-sm font-bold text-sky-400 mb-1">🔒 X (Twitter) 公式OAuth 2.0認証</h3>
      <p class="text-xs text-slate-400 mb-3">X公式認証画面を通じて、安全・確実にログインまたは新規登録を行います。</p>
      <a href="/api/auth/twitter?force_oauth=1" class="block w-full text-center bg-sky-500 hover:bg-sky-600 font-bold py-2.5 px-4 rounded-lg text-sm text-white transition-all shadow-lg shadow-sky-500/20">
        X公式で安全にログインする →
      </a>
    </div>

    <!-- Developer Portal OAuth2 Setup Guide -->
    <div class="border-t border-slate-800 pt-4 text-xs text-slate-400 space-y-2">
      <div class="font-bold text-slate-300">🛠️ 公式OAuth 2.0連携の設定状況：</div>
      <p>Twitter Developer Portalの「User authentication settings」で以下のCallback URLが登録されている必要があります：</p>
      <code class="block bg-black p-2 rounded border border-slate-800 text-[11px] text-emerald-400 break-all select-all">${config.redirectUri}</code>
    </div>

    <div class="mt-4 text-center">
      <a href="/" class="text-xs text-slate-500 hover:text-slate-400 underline">← トップページへ戻る</a>
    </div>
  </div>
</body>
</html>`);
    }

    const state = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    res.cookie(STATE_COOKIE, state, { httpOnly: true, maxAge: 600000, sameSite: 'lax', secure: true });
    res.cookie(VERIFIER_COOKIE, verifier, { httpOnly: true, maxAge: 600000, sameSite: 'lax', secure: true });

    return res.redirect(302, buildTwitterAuthorizationUrl(config, state, challenge));
  });

  // 2. Quick Handle Login (本番セキュリティポリシーにより完全無効化)
  app.all('/api/auth/twitter/quick-login', (req, res) => {
    return res.status(403).json({
      ok: false,
      error: 'セキュリティ保護のため、未検証の簡易ログイン機能は廃止されました。X公式OAuth 2.0またはメールアドレス認証をご利用ください。'
    });
  });

  // 3. X OAuth 2.0 Callback
  app.get('/api/auth/twitter/callback', async (req, res) => {
    const config = getTwitterOAuthConfig();
    const expectedState = readCookie(req, STATE_COOKIE);
    const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
    const verifier = readCookie(req, VERIFIER_COOKIE);

    res.clearCookie(STATE_COOKIE);
    res.clearCookie(VERIFIER_COOKIE);

    if (!matchesOAuthState(expectedState, returnedState)) {
      return res.status(400).send('認証ステータスの確認に失敗しました。最初からやり直してください。');
    }

    if (req.query.error) {
      return res.status(401).send(`X認証がキャンセルされました: ${req.query.error_description || req.query.error}`);
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || !verifier) {
      return res.status(400).send('認証コードまたは検証キーを受け取れませんでした。');
    }

    try {
      const connect = returnedState.match(/^([a-f0-9]{64})\.connect1\.([01])\.(\d+)\.([a-f0-9]{64})$/);
      let connectingUser = null;
      if (connect) {
        connectingUser = await resolveSessionUser(db, req);
        const binding = connectingUser && connectingUser.sessionToken
          ? crypto.createHash('sha256').update(`${connect[1]}:${connectingUser.sessionToken}`).digest('hex') : '';
        const age = Date.now() - Number(connect[3]);
        if (!connectingUser || !matchesOAuthState(binding, connect[4]) || age < 0 || age > 600000) {
          return res.status(401).send('ログイン状態が変わったか、X連携の有効期限が切れました。もう一度お試しください。');
        }
      }
      const tokenData = await exchangeTwitterCode(config, code, verifier);
      const profile = await getTwitterProfile(tokenData.access_token);
      if (connect && !profile.id) throw new Error('Xアカウントの識別子を確認できません。');
      const activeSession = connect ? connectingUser : await resolveSessionUser(db, req);
      const existingUid = activeSession && activeSession.userId ? activeSession.userId : null;
      const user = await findOrCreateTwitterUser(db, profile, tokenData, existingUid, connect ? {
        sessionToken: connectingUser.sessionToken,
        startedAt: Number(connect[3]),
        autoPostingAccepted: connect[2] === '1'
      } : null);

      try {
        const { evaluateTrialEligibility } = require('./trial_abuse_guard');
        const decision = await evaluateTrialEligibility({ db, userId: user.userId, twitterId: profile.id, email: user.email });
        if (!decision.allowTrial) {
          await db.collection('saas_users').doc(user.userId).set({ trialAlreadyClaimedByXId: true }, { merge: true });
        }
      } catch (trialErr) {
        console.warn(`[Trial Eligibility] ${trialErr.message}`);
      }
      try {
        const { maybeAutofillStrategy } = require('./autonomous_strategy_architect');
        const saved = await db.collection('saas_users').doc(user.userId).get();
        const full = saved.exists ? (saved.data() || {}) : {};
        await maybeAutofillStrategy(db, { ...full, userId: user.userId, xUsername: user.xUsername || full.xUsername });
      } catch (strategyErr) {
        console.warn(`[Autonomous Strategy] ${strategyErr.message}`);
      }

      setAuthCookies(res, user.sessionToken, user, req);

      return res.type('html').send(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Xアカウント認証完了</title>
</head>
<body style="font-family:sans-serif;text-align:center;padding:4rem 1rem;background:#020617;color:#f8fafc;">
  <p>X認証が完了しました。管理画面へ移動します...</p>
  <script>
    localStorage.setItem('xsw_email', ${JSON.stringify(user.email)});
    localStorage.setItem('xsw_uid', ${JSON.stringify(user.userId)});
    localStorage.setItem('xsw_token', ${JSON.stringify(user.sessionToken)});
    localStorage.setItem('xsw_tier', ${JSON.stringify(String(user.tierLevel))});
    localStorage.setItem('xsw_x_handle', ${JSON.stringify(user.xUsername)});
    localStorage.removeItem('xsw_signed_out');
    window.location.replace('/dashboard');
  </script>
</body>
</html>`);
    } catch (e) {
      console.error('[X OAuth2] Error:', e.message);
      return res.status(500).send(`X認証処理中にエラーが発生しました: ${e.message}`);
    }
  });
}

function cleanHandle(h) {
  return String(h || '').replace(/^@/, '').trim();
}

module.exports = {
  getTwitterOAuthConfig,
  buildTwitterAuthorizationUrl,
  findOrCreateTwitterUser,
  registerTwitterAuthRoutes
};
