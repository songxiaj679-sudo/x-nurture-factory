const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.HYBRID_KEY_SECRET = process.env.HYBRID_KEY_SECRET || 'oauth-continuity-test-key';
process.env.X_CLIENT_ID = process.env.X_CLIENT_ID || 'oauth-continuity-client';

const store = new Map();
function users() {
  return {
    doc(id) {
      return {
        id,
        async get() {
          return { exists: store.has(id), id, data: () => store.get(id), ref: this };
        },
        async set(data, options) {
          store.set(id, options && options.merge ? { ...(store.get(id) || {}), ...data } : data);
        }
      };
    },
    where(field, op, value) {
      return {
        limit() { return this; },
        async get() {
          const docs = [...store.entries()]
            .filter(([, data]) => data && data[field] === value)
            .map(([id]) => ({ id, data: () => store.get(id), ref: users().doc(id) }));
          return { empty: docs.length === 0, docs };
        }
      };
    }
  };
}
const db = { collection: () => users() };
const firestorePath = require.resolve('../src/firestore');
const clientPath = require.resolve('../src/official_api_client');
require.cache[firestorePath] = { id: firestorePath, filename: firestorePath, loaded: true, exports: { db } };
delete require.cache[clientPath];
const { encryptCredentials, decryptCredentials, refreshOAuth2TokenIfNeeded, fetchMyAccountState } = require('../src/official_api_client');
const { findOrCreateTwitterUser } = require('../src/twitter_auth');

test('same twitterId keeps the Google document on the new OAuth2 token', async () => {
  store.clear();
  store.set('WEB-GOOGLE-ABC', {
    userId: 'WEB-GOOGLE-ABC',
    twitterId: '99',
    googleSub: 'sub',
    twitterRefreshToken: 'old-refresh',
    xLinkStatus: 'connected',
    xOfficialCredentials: encryptCredentials({
      authType: 'oauth2', oauth2AccessToken: 'old-access', oauth2RefreshToken: 'old-refresh',
      username: 'ownerx', userId: '99', saasUserId: 'WEB-GOOGLE-ABC'
    })
  });
  store.set('WEB-X-99', {
    userId: 'WEB-X-99',
    twitterId: '99',
    twitterRefreshToken: 'old-refresh',
    xLinkStatus: 'connected'
  });
  const user = await findOrCreateTwitterUser(db, { id: '99', username: 'ownerx', name: 'Owner' }, {
    access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 7200
  });
  assert.equal(user.userId, 'WEB-GOOGLE-ABC');
  assert.equal(store.get('WEB-GOOGLE-ABC').twitterRefreshToken, 'refresh-new');
  assert.equal(store.get('WEB-X-99').twitterRefreshToken, 'refresh-new');
  assert.equal(decryptCredentials(store.get('WEB-GOOGLE-ABC').xOfficialCredentials).oauth2RefreshToken, 'refresh-new');
  assert.notEqual(store.get('WEB-GOOGLE-ABC').xLinkStatus, 'relink_required');
});

test('parallel refresh calls the token endpoint once and does not mark relink_required', async () => {
  store.clear();
  const uid = 'WEB-GOOGLE-RACE';
  store.set(uid, {
    userId: uid,
    twitterId: '424242',
    xLinkStatus: 'connected',
    xOfficialCredentials: encryptCredentials({
      authType: 'oauth2', oauth2AccessToken: 'old-access', oauth2RefreshToken: 'old-refresh',
      oauth2ExpiresAt: new Date(Date.now() - 1000).toISOString(),
      username: 'ownerx', userId: '424242', saasUserId: uid
    })
  });
  let tokenHits = 0;
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/oauth2/token')) {
      tokenHits += 1;
      if (tokenHits > 1) return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
      return { ok: true, status: 200, json: async () => ({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 7200 }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const creds = decryptCredentials(store.get(uid).xOfficialCredentials);
    await Promise.all([
      refreshOAuth2TokenIfNeeded(creds, true, uid),
      refreshOAuth2TokenIfNeeded({ ...creds }, true, uid)
    ]);
  } finally {
    global.fetch = original;
  }
  assert.equal(tokenHits, 1);
  assert.equal(store.get(uid).xLinkStatus, 'connected');
  assert.equal(store.get(uid).twitterRefreshToken, 'refresh-new');
});

test('fetchMyAccountState recovers from HTTP 401 and saves through creds.userId', async () => {
  store.clear();
  const uid = 'WEB-GOOGLE-SAVE';
  let meHits = 0;
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 7200 }) };
    }
    if (String(url).includes('/users/me')) {
      meHits += 1;
      if (meHits === 1) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: { id: '7', username: 'ownerx', public_metrics: { followers_count: 1, following_count: 1, tweet_count: 1 } } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const live = await fetchMyAccountState({
      userId: uid,
      username: 'ownerx',
      oauth2AccessToken: 'old-access',
      oauth2RefreshToken: 'old-refresh',
      oauth2ExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    assert.equal(live.ok, true);
  } finally {
    global.fetch = original;
  }
  assert.equal(meHits, 2);
  assert.equal(store.get(uid).twitterRefreshToken, 'refresh-new');
  assert.equal(decryptCredentials(store.get(uid).xOfficialCredentials).oauth2RefreshToken, 'refresh-new');
});

test('dashboard setup stays open when X must be connected again', () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  assert.match(html, /needsXRelink/);
  assert.match(html, /xRelinkNotice/);
  assert.match(html, /if \(setup && connected && ready && !needsRelink\) setup\.open = false/);
});
