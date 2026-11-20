const test = require('node:test');
const assert = require('node:assert/strict');

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const users = new Map();
stub('../src/firestore', {
  db: {
    collection() {
      return {
        doc(id) {
          return {
            async get() { return { exists: users.has(id), data: () => users.get(id) }; },
            async set(data, options) {
              const prev = options && options.merge ? (users.get(id) || {}) : {};
              users.set(id, { ...prev, ...data });
            }
          };
        }
      };
    }
  }
});
stub('../src/auth_service', { resolveSessionUser: async (_db, req) => ({ userId: req.testUserId }) });
stub('../src/official_api_client', { decryptCredentials: () => ({ id: '1', username: 'VeloxSystemsV4' }) });
stub('../src/operated_accounts', { officialApiOperationAllowed: () => true });
stub('../src/autonomous_promo_ai', {
  isValidTimeZone: () => true,
  launchAutopilotCampaign: async () => ({ ok: true, jobId: 'job-test' }),
  prepareNextPost: async () => ({}),
  ensureNextPost: async () => ({}),
  reDeliberateAutopilotJobs: async () => ({}),
  reThinkSingleJob: async () => ({}),
  generateInstantPreviewPosts: async () => ({}),
  fetchUrlSummary: async () => ({}),
  dateAtTimeInZone: () => new Date(),
  harvestTweetMetricsAndEvolveKnowledge: async () => ({}),
  generateWeeklyCouncilReport: async () => ({}),
  cancelOtherPendingJobs: async () => ({}),
  cancelNonManualPendingJobs: async () => ({})
});

const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
const postRoutes = new Map();
registerHybridSaasRoutes({ post(path, handler) { postRoutes.set(path, handler); }, get() {} }, { runWorker: false });

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
}

test('save-setup does not erase a stored URL when the field is omitted', async () => {
  users.set('en-user', {
    userId: 'en-user',
    targetUrl: 'https://keep.example',
    aiTargetLang: 'en',
    scheduleTimeZone: 'America/New_York',
    userPrompt: 'Keep the English account voice'
  });
  const res = response();
  await postRoutes.get('/api/autopilot/save-setup')({
    testUserId: 'en-user',
    body: { userPrompt: 'Keep the English account voice', lang: 'en', timeZone: 'America/New_York', country: 'US' }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(users.get('en-user').targetUrl, 'https://keep.example');
  assert.equal(users.get('en-user').aiTargetLang, 'en');
  assert.equal(users.get('en-user').scheduleTimeZone, 'America/New_York');
});

test('launch keeps an existing English account when lang and URL are omitted', async () => {
  users.set('WEB-GOOGLE-D12E2479A76266AEA2B4', {
    userId: 'WEB-GOOGLE-D12E2479A76266AEA2B4',
    targetUrl: 'https://veloxpostapp.com',
    aiTargetLang: 'en',
    scheduleTimeZone: 'America/New_York',
    userPrompt: 'English voice',
    xOfficialCredentials: 'stored',
    autopilotConsent: { version: 1, account: 'id:1', granted: true }
  });
  const res = response();
  await postRoutes.get('/api/autopilot/launch')({
    testUserId: 'WEB-GOOGLE-D12E2479A76266AEA2B4',
    body: {},
    headers: {},
    query: {}
  }, res);
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  const saved = users.get('WEB-GOOGLE-D12E2479A76266AEA2B4');
  assert.equal(saved.aiTargetLang, 'en');
  assert.equal(saved.targetUrl, 'https://veloxpostapp.com');
  assert.equal(saved.scheduleTimeZone, 'America/New_York');
  assert.equal(saved.userPrompt, 'English voice');
});
