const { test } = require('node:test');
const assert = require('node:assert/strict');

function stub(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let data;
let verifyCalls = 0;
const ref = {
  async get() { return { exists: true, data: () => ({ ...data }) }; },
  async update(update) { Object.assign(data, update); }
};
const db = {
  collection: () => ({ doc: () => ref }),
  async runTransaction(fn) {
    return fn({ get: r => r.get(), update: (r, update) => r.update(update) });
  }
};
stub('../src/firestore', { db });
stub('../src/auth_service', { resolveSessionUser: async () => ({ userId: 'owner', sessionToken: 'session' }) });
stub('../src/official_api_client', {
  encryptCredentials: value => ({ encrypted: 'test', username: value.username }),
  verifyOfficialCredentials: async () => {
    verifyCalls++;
    return { ok: true, user: { id: '12345', username: 'ownerx', name: 'Owner' } };
  }
});
const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

test('manual API connection requires terms and records optional posting consent', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/hybrid/verify-keys');
  const invoke = async body => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
    await handler({ body }, res);
    return res;
  };
  const keys = { apiKey: 'key', apiSecret: 'secret', accessToken: 'token', accessTokenSecret: 'token-secret' };
  data = { sessionToken: 'session', autopilotPaused: true };
  assert.equal((await invoke(keys)).statusCode, 400);
  assert.equal(verifyCalls, 0);
  assert.equal((await invoke({ ...keys, termsAccepted: true })).body.ok, true);
  assert.equal(data.connectionTermsConsent.version, 1);
  assert.equal(data.autopilotConsent, undefined);
  assert.equal((await invoke({ ...keys, termsAccepted: true, autoPostingAccepted: true })).body.ok, true);
  assert.equal(data.autopilotConsent.account, 'id:12345');
  assert.equal(data.autopilotConsent.granted, true);
  assert.equal(data.autopilotPaused, true);
});
