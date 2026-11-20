const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { parseCookies, setAuthCookies, resolveSessionUser } = require('../src/auth_service');

function cookieLines(headers) {
  const value = headers['set-cookie'] || [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function assertLiveSession(lines) {
  const session = lines.filter(line => /^xcloud_sess=/.test(line));
  assert.ok(session.some(line => /^xcloud_sess=[^;]/.test(line) && !/^xcloud_sess=;/.test(line)));
  assert.equal(session.some(line => /^xcloud_sess=;/.test(line) || /Max-Age=0/i.test(line)), false);
}

function request(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

function memoryDb() {
  const store = new Map();
  const users = {
    doc(id) {
      const ref = {
        id,
        async get() { return { exists: store.has(id), id, data: () => store.get(id), ref }; },
        async set(data, options) {
          store.set(id, options && options.merge ? { ...(store.get(id) || {}), ...data } : data);
        }
      };
      return ref;
    },
    where(field, op, value) {
      return {
        limit() { return this; },
        async get() {
          const docs = [...store.entries()]
            .filter(([, data]) => data && data[field] === value)
            .map(([id]) => ({ id, data: () => store.get(id), ref: users.doc(id) }));
          return { empty: docs.length === 0, docs };
        }
      };
    }
  };
  return {
    store,
    db: {
      collection: () => users,
      async runTransaction(fn) {
        return fn({
          get: ref => ref.get(),
          set(ref, data) { store.set(ref.id, { ...(store.get(ref.id) || {}), ...data }); }
        });
      }
    }
  };
}

test('proxy https and a blank duplicate cookie do not erase the session', async () => {
  const headers = [];
  setAuthCookies({
    cookie(name, value, options) { headers.push({ name, value, options }); }
  }, 'session-token', { userId: 'user-1', email: 'owner@example.com' }, {
    secure: false,
    headers: { 'x-forwarded-proto': 'https, http' }
  });
  assert.equal(headers.find(item => item.name === 'xcloud_sess').options.secure, true);
  assert.equal(parseCookies({ headers: { cookie: 'xcloud_sess=session-token; xcloud_sess=' } }).xcloud_sess, 'session-token');

  const seen = [];
  const db = {
    collection: () => ({
      where(field, op, value) {
        seen.push(value);
        return { limit() { return this; }, async get() { return { empty: true, docs: [] }; } };
      }
    })
  };
  await resolveSessionUser(db, { headers: { cookie: 'xcloud_sess=; xcloud_sess=kept-token' } });
  assert.deepEqual(seen, ['kept-token']);
});

test('Google and X callbacks keep the session cookie behind https', async () => {
  const previous = {
    googleId: process.env.GOOGLE_CLIENT_ID,
    googleSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirect: process.env.GOOGLE_REDIRECT_URI,
    xId: process.env.X_CLIENT_ID,
    fetch: global.fetch
  };
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://veloxpostapp.com/api/auth/google/callback';
  process.env.X_CLIENT_ID = 'x-client';
  const firestorePath = require.resolve('../src/firestore');
  require.cache[firestorePath] = { id: firestorePath, filename: firestorePath, loaded: true, exports: { db: {} } };
  const { registerGoogleAuthRoutes } = require('../src/google_auth');
  const { registerTwitterAuthRoutes } = require('../src/twitter_auth');
  const { db } = memoryDb();
  global.fetch = async url => {
    const target = String(url);
    if (target.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'google-token' }) };
    if (target.includes('openidconnect.googleapis.com')) return { ok: true, json: async () => ({ sub: 'google-sub', email: 'owner@example.com', email_verified: true }) };
    if (target.includes('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'x-token' }) };
    if (target.includes('/users/me')) return { ok: true, json: async () => ({ data: { id: '12345', username: 'ownerx', name: 'Owner' } }) };
    throw new Error('Unexpected request ' + target);
  };
  const app = express();
  registerGoogleAuthRoutes(app, db);
  registerTwitterAuthRoutes(app, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const httpsHeaders = { 'x-forwarded-proto': 'https' };
  try {
    const googleStart = await request(server, '/api/auth/google', { headers: httpsHeaders });
    const googleState = new URL(googleStart.headers.location).searchParams.get('state');
    const googleCookie = cookieLines(googleStart.headers).map(line => line.split(';')[0]).join('; ');
    const googleCallback = await request(server, `/api/auth/google/callback?code=google-code&state=${encodeURIComponent(googleState)}`, {
      headers: { ...httpsHeaders, cookie: googleCookie }
    });
    assert.equal(googleCallback.status, 200);
    assertLiveSession(cookieLines(googleCallback.headers));

    const xStart = await request(server, '/api/auth/twitter', { headers: httpsHeaders });
    const xState = new URL(xStart.headers.location).searchParams.get('state');
    const xCookie = cookieLines(xStart.headers).map(line => line.split(';')[0]).join('; ');
    const xCallback = await request(server, `/api/auth/twitter/callback?code=x-code&state=${encodeURIComponent(xState)}`, {
      headers: { ...httpsHeaders, cookie: xCookie }
    });
    assert.equal(xCallback.status, 200);
    assertLiveSession(cookieLines(xCallback.headers));

    const session = cookieLines(xCallback.headers).find(line => /^xcloud_sess=[^;]/.test(line)).split(';')[0];
    const connect = await request(server, '/api/auth/twitter/connect', {
      method: 'POST',
      headers: { ...httpsHeaders, 'content-type': 'application/x-www-form-urlencoded', cookie: session },
      body: 'terms=on'
    });
    assert.equal(connect.status, 302);
    const connectState = new URL(connect.headers.location).searchParams.get('state');
    const connectCookies = [session].concat(cookieLines(connect.headers).map(line => line.split(';')[0])).join('; ');
    const relink = await request(server, `/api/auth/twitter/callback?code=x-code&state=${encodeURIComponent(connectState)}`, {
      headers: { ...httpsHeaders, cookie: connectCookies }
    });
    assert.equal(relink.status, 200);
    assertLiveSession(cookieLines(relink.headers));
  } finally {
    server.close();
    global.fetch = previous.fetch;
    process.env.GOOGLE_CLIENT_ID = previous.googleId;
    process.env.GOOGLE_CLIENT_SECRET = previous.googleSecret;
    process.env.GOOGLE_REDIRECT_URI = previous.googleRedirect;
    process.env.X_CLIENT_ID = previous.xId;
  }
});
