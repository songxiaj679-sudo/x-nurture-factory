'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const jobs = new Map([
  ['job-1', { userId: 'owner-1', status: 'pending', text: '元の本文です。', tweets: ['元の本文です。'], accountStateSnapshot: { maxChars: 280 } }]
]);
const fakeDb = {
  async runTransaction(work) {
    return work({
      async get(ref) { return ref.get(); },
      update(ref, data) { return ref.update(data); }
    });
  },
  collection(name) {
    return {
      doc(id) {
        return {
          async get() {
            if (name !== 'autopilot_jobs' || !jobs.has(id)) return { exists: false, data: () => null };
            return { exists: true, data: () => jobs.get(id) };
          },
          update(data) { jobs.set(id, { ...jobs.get(id), ...data }); }
        };
      }
    };
  }
};

let session = { userId: 'owner-1' };
stub('../src/firestore', { db: fakeDb });
stub('../src/auth_service', { resolveSessionUser: async () => session });
stub('../src/official_api_client', { sanitizePostOrReplyText: text => String(text || '').trim(), decryptCredentials: () => ({}), postOfficialTweet: async () => ({ ok: false }) });
stub('../src/autonomous_promo_ai', { isValidTimeZone: () => true });
stub('../src/ai_deliberation_council', {});
stub('../src/wise_payment', {});
stub('../src/collective_intelligence', {});
stub('../src/stripe_billing_helpers', {});

const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
const routes = new Map();
registerHybridSaasRoutes({
  post(path, handler) { routes.set(path, handler); },
  get() {}
}, { runWorker: false });

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
}

test('another user cannot edit a pending draft', async () => {
  session = { userId: 'other-user' };
  const res = response();
  await routes.get('/api/autopilot/jobs/:jobId/edit-draft')({ params: { jobId: 'job-1' }, body: { tweets: ['所有者ではない編集です。'] } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(jobs.get('job-1').isHumanOverride, undefined);
});
