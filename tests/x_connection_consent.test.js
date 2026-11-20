const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const firestorePath = require.resolve('../src/firestore');
require.cache[firestorePath] = { id: firestorePath, filename: firestorePath, loaded: true, exports: { db: {} } };
const { registerTwitterAuthRoutes } = require('../src/twitter_auth');

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

test('X connection records separate, optional consent for the authenticated account', async () => {
  const previousClientId = process.env.X_CLIENT_ID;
  const previousFetch = global.fetch;
  process.env.X_CLIENT_ID = 'test-client';
  const store = new Map([['owner', { userId: 'owner', sessionToken: 'session-one', autopilotPaused: true }]]);
  const users = {
    doc(id) {
      return {
        id,
        async get() { return { exists: store.has(id), data: () => store.get(id), ref: this }; },
        async set(data, options) { store.set(id, options && options.merge ? { ...store.get(id), ...data } : data); }
      };
    },
    where(field, op, value) {
      return {
        limit() { return this; },
        async get() {
          const found = [...store].filter(([, data]) => data[field] === value)
            .map(([id]) => ({ id, data: () => store.get(id), ref: users.doc(id) }));
          return { empty: found.length === 0, docs: found };
        }
      };
    }
  };
  const db = {
    collection: () => users,
    async runTransaction(fn) {
      return fn({
        get: ref => ref.get(),
        set(ref, data) { store.set(ref.id, { ...store.get(ref.id), ...data }); }
      });
    }
  };
  global.fetch = async url => {
    if (url.includes('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'test-token' }) };
    if (url.includes('/users/me')) return { ok: true, json: async () => ({ data: { id: '12345', username: 'ownerx', name: 'Owner' } }) };
    throw new Error('Unexpected request');
  };
  const app = express();
  registerTwitterAuthRoutes(app, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const start = body => request(server, '/api/auth/twitter/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'xcloud_sess=session-one' },
    body
  });
  const callback = async response => {
    const state = new URL(response.headers.location).searchParams.get('state');
    const cookies = response.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
    return request(server, `/api/auth/twitter/callback?code=test-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `xcloud_sess=session-one; ${cookies}` }
    });
  };
  try {
    const expectedScopes = ['offline.access', 'tweet.read', 'tweet.write', 'users.read'];
    const assertScopes = response => {
      assert.equal(response.status, 302);
      const scopes = new URL(response.headers.location).searchParams.get('scope').split(' ');
      assert.deepEqual(scopes.sort(), expectedScopes);
    };
    assertScopes(await request(server, '/api/auth/twitter'));
    assert.equal((await request(server, '/api/auth/twitter/connect', { method: 'POST' })).status, 400);
    assert.equal((await start('autopost=on')).status, 400);
    const optional = await start('terms=on');
    assertScopes(optional);
    assert.equal((await callback(optional)).status, 200);
    assert.equal(store.get('owner').connectionTermsConsent.version, 1);
    assert.equal(store.get('owner').autopilotConsent, undefined);
    assert.equal(store.get('owner').autopilotPaused, true);

    store.get('owner').sessionToken = 'session-one';
    const accepted = await start('terms=on&autopost=on');
    assert.equal((await callback(accepted)).status, 200);
    assert.equal(store.get('owner').autopilotConsent.account, 'id:12345');
    assert.equal(store.get('owner').autopilotConsent.granted, true);
    assert.equal(store.get('owner').autopilotPaused, true);

    store.get('owner').sessionToken = 'session-one';
    const revoked = await start('terms=on&autopost=on');
    store.get('owner').autopilotConsent = { granted: false, revokedAt: new Date() };
    const revokedResult = await callback(revoked);
    assert.equal(revokedResult.status, 500);
    assert.equal(store.get('owner').autopilotConsent.granted, false);
    assert.equal(store.get('owner').sessionToken, 'session-one');

    store.get('owner').sessionToken = 'session-one';
    const changedSession = await start('terms=on&autopost=on');
    store.get('owner').sessionToken = 'another-session';
    assert.equal((await callback(changedSession)).status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    global.fetch = previousFetch;
    if (previousClientId === undefined) delete process.env.X_CLIENT_ID;
    else process.env.X_CLIENT_ID = previousClientId;
  }
});
