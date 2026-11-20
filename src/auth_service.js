// src/auth_service.js
// 🛡️ VeloxPost Unified Authentication & Session Authority Service
const crypto = require('crypto');

function parseCookies(req) {
  const raw = (req && req.headers && req.headers.cookie) || '';
  const out = {};
  if (!raw) return out;
  raw.split(';').forEach(p => {
    const idx = p.indexOf('=');
    if (idx > 0) {
      const key = p.slice(0, idx).trim();
      const val = p.slice(idx + 1).trim();
      let decoded = val;
      try {
        decoded = decodeURIComponent(val);
      } catch (e) {}
      if (decoded || !out[key]) out[key] = decoded;
    }
  });
  return out;
}

function hashUserPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), useSalt, 10000, 32, 'sha256').toString('hex');
  return useSalt + ':' + hash;
}

function verifyUserPassword(inputPassword, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const pw = String(inputPassword || '');

  // 1. Salted PBKDF2 (salt:hash)
  if (storedHash.includes(':')) {
    const [salt, expectedHash] = storedHash.split(':');
    if (!salt || !expectedHash) return false;
    const computed = crypto.pbkdf2Sync(pw, salt, 10000, 32, 'sha256').toString('hex');
    return computed === expectedHash;
  }

  // 2. Legacy fixed-salt SHA-256 (from shop.js: 'xcloud_salt_' + pw)
  const legacyHash = crypto.createHash('sha256').update('xcloud_salt_' + pw).digest('hex');
  if (legacyHash === storedHash) return true;

  // 3. Plain SHA-256 fallback
  const plainHash = crypto.createHash('sha256').update(pw).digest('hex');
  if (plainHash === storedHash) return true;

  return false;
}

function isLegacyPasswordHash(storedHash) {
  return typeof storedHash === 'string' && !storedHash.includes(':');
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requestIsHttps(req) {
  if (!req) return false;
  if (req.secure) return true;
  const forwarded = String(req.headers && req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwarded === 'https';
}

function setAuthCookies(res, sessionToken, user, req) {
  const isHttps = requestIsHttps(req);
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  const uid = String((user && (user.userId || user.id)) || '').trim();
  const email = String((user && user.email) || '').trim().toLowerCase();

  // Primary authoritative HTTP-only session cookie
  res.cookie('xcloud_sess', sessionToken, {
    path: '/',
    maxAge: maxAgeMs,
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps
  });

  // Client-readable companion cookies for UI hydration
  if (uid) {
    res.cookie('xsw_uid', uid, {
      path: '/',
      maxAge: maxAgeMs,
      httpOnly: false,
      sameSite: 'Lax',
      secure: isHttps
    });
  }
  if (email) {
    res.cookie('xsw_email', encodeURIComponent(email), {
      path: '/',
      maxAge: maxAgeMs,
      httpOnly: false,
      sameSite: 'Lax',
      secure: isHttps
    });
  }
}

function clearAuthCookies(res) {
  const expiredDate = new Date(0);
  const cookieOpts = { path: '/', maxAge: 0, expires: expiredDate };
  res.clearCookie('xcloud_sess', cookieOpts);
  res.clearCookie('xsw_uid', cookieOpts);
  res.clearCookie('xsw_email', cookieOpts);
  res.clearCookie('xsw_token', cookieOpts);
  res.clearCookie('xsw_tier', cookieOpts);
  res.clearCookie('xsw_x_handle', cookieOpts);
  res.setHeader('Set-Cookie', [
    'xcloud_sess=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
    'xsw_uid=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax',
    'xsw_email=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax',
    'xsw_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'
  ]);
}

async function resolveSessionUser(db, req) {
  if (!db || !req) return null;
  const cookies = parseCookies(req);
  const authHeader = (req.headers && req.headers.authorization) || '';
  const customHeader = (req.headers && req.headers['x-session-token']) || '';
  const token = cookies.xcloud_sess ||
                (req.query && req.query.token) ||
                customHeader ||
                (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');

  if (!token || typeof token !== 'string') return null;

  try {
    const snap = await db.collection('saas_users').where('sessionToken', '==', token.trim()).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data() || {};
    const ownerUid = data.ownerUid || doc.id;
    let activeId = doc.id;
    const requested = cookies.velox_ws || '';
    if (requested && requested !== doc.id) {
      try {
        const ws = await db.collection('saas_users').doc(requested).get();
        const wsData = ws.exists ? (ws.data() || {}) : null;
        if (wsData && (requested === ownerUid || wsData.ownerUid === ownerUid)) {
          return { ...wsData, userId: wsData.userId || requested, id: requested, ownerUid, sessionToken: wsData.sessionToken || data.sessionToken };
        }
      } catch (workspaceErr) {
        console.warn('[resolveSessionUser Workspace]:', workspaceErr.message);
      }
    }
    return {
      userId: activeId,
      id: activeId,
      ownerUid,
      ...data
    };
  } catch (e) {
    console.warn('[resolveSessionUser Warning]:', e.message);
    return null;
  }
}

module.exports = {
  parseCookies,
  hashUserPassword,
  verifyUserPassword,
  isLegacyPasswordHash,
  generateSessionToken,
  setAuthCookies,
  clearAuthCookies,
  resolveSessionUser
};
