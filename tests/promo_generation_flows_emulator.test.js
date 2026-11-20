'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('preview and re-deliberation require a local Firestore emulator', { skip: true }, () => {});
  return;
}

assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^127\.0\.0\.1:[0-9]{1,5}$/);
process.env.NODE_ENV = 'test';
process.env.XAI_API_KEY = 'mock-key';

const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-velox-test' }, 'promo-flow-test');
const db = getFirestore(app);
const ownerId = `promo_flow_${process.pid}_${Date.now()}`;
const userRef = db.collection('saas_users').doc(ownerId);
const jobs = ['first', 'second'].map(id => db.collection('autopilot_jobs').doc(`${ownerId}_${id}`));

function stub(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let prompts = [];
let modelHook = null;
let failPage = false;
const responses = [
  { serviceName: 'Test', targetAudience: 'Readers', userPainPoints: [], uniqueSellingPoints: [] },
  { optimizedBio: 'Test', pinnedPost: {} },
  { deliberationRounds: {}, postPlan: ['morning', 'noon', 'evening'].map((timeSlot, index) => ({
    step: index + 1, timeSlot, format: 'single', angle: 'Test'
  })) },
  { posts: [1, 2, 3].map(() => ({ tweets: ['通常の投稿です。'], tweets_en: ['A normal post.'] })) },
  { refinedPosts: [] }
];
let responseIndex = 0;
stub('../src/firestore', { db });
stub('../src/collective_intelligence', { getCollectiveMarketingIntelligence: async () => ({}) });
stub('../src/ai_deliberation_council', {
  BASELINE_NEGATIVE_LIST: [],
  getUserMarketingKnowledge: async () => ({ negativeList: [], successfulCases: [], failedCases: [] })
});
stub('../src/map_elites_memory', {
  sampleFromMapElitesArchive: async () => ({
    mode: 'exploration', cellId: 'test', angle: { name: 'Test' },
    audience: { name: 'Readers' }, directive: 'Test'
  })
});
stub('../src/audience_simulation_engine', { evaluatePostWithAudience: async () => {} });
let sessionUser = { userId: ownerId };
stub('../src/auth_service', { resolveSessionUser: async () => sessionUser });
stub('../src/wise_payment', {});
async function completeText(options = {}) {
  const prompt = options.prompt || '';
  prompts.push(prompt);
  if (modelHook) await modelHook(responseIndex);
  const output = responses[responseIndex++];
  if (!output) throw new Error('Unexpected model request');
  return { text: typeof output === 'string' ? output : JSON.stringify(output), modelName: 'grok-test' };
}
stub('../src/grok_client', {
  hasXaiKey: () => Boolean(process.env.XAI_API_KEY),
  completeText,
  async completeJson(options = {}) {
    const result = await completeText(options);
    return { ...result, parsed: JSON.parse(result.text) };
  }
});
const originalFetch = global.fetch;
global.fetch = async () => failPage
  ? { ok: false, status: 503, statusText: 'Unavailable' }
  : { ok: true, text: async () => '<title>Test</title><p>Test website content</p>' };

const promo = require('../src/autonomous_promo_ai');
const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

function resetModel() {
  responseIndex = 0;
  prompts = [];
  modelHook = null;
  failPage = false;
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

after(async () => {
  global.fetch = originalFetch;
  await Promise.all([...jobs.map(ref => ref.delete()), userRef.delete()]);
  await deleteApp(app);
});

test('preview generates posts without an account diagnosis', async () => {
  resetModel();
  const result = await promo.generateInstantPreviewPosts('https://example.invalid', 'Preview instruction');
  assert.equal(result.ok, true);
  assert.equal(result.posts[0].tweets[0], '通常の投稿です。');
  assert.match(prompts[0], /Preview instruction/);
  assert.match(prompts[2], /提供されていない実績、体験、数値/);
  assert.match(prompts[3], /未確認の数値・体験・実績/);
});

test('invalid council plans stop generation without a fixed fallback', async () => {
  const validPlan = responses[2];
  try {
    const invalidPlans = [
      {},
      { deliberationRounds: {}, postPlan: [] },
      { deliberationRounds: {}, postPlan: validPlan.postPlan.slice(0, 1) },
      { deliberationRounds: {}, postPlan: validPlan.postPlan.map(item => ({ ...item, timeSlot: 'morning' })) },
      { deliberationRounds: {}, postPlan: validPlan.postPlan.map((item, index) => index ? item : { ...item, angle: '' }) },
      { deliberationRounds: {}, postPlan: validPlan.postPlan.map((item, index) => index ? item : { ...item, step: 2 }) }
    ];
    for (const plan of invalidPlans) {
      resetModel();
      responses[2] = plan;
      await assert.rejects(promo.generateInstantPreviewPosts('https://example.invalid'), { code: 'council_plan_invalid' });
      assert.equal(responseIndex, 3);
    }
    resetModel();
    responses[2] = 'invalid JSON';
    await assert.rejects(promo.generateInstantPreviewPosts('https://example.invalid'), { code: 'council_plan_generation_failed' });
    assert.equal(responseIndex, 3);
  } finally {
    responses[2] = validPlan;
    resetModel();
  }
});

test('post language settings require authentication and preserve reservations', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/post-language');
  await userRef.set({ aiTargetLang: 'ja', marker: 'keep' });
  await jobs[0].set({ userId: ownerId, status: 'pending', text: '予約本文' });
  try {
    sessionUser = null;
    let res = response();
    await handler({ body: { lang: 'en' } }, res);
    assert.equal(res.statusCode, 401);
    sessionUser = { userId: ownerId };
    for (const lang of ['english', '', {}, null]) {
      res = response();
      await handler({ body: { lang } }, res);
      assert.equal(res.statusCode, 400);
    }
    res = response();
    await handler({ body: { lang: 'en', userId: 'another-user' } }, res);
    assert.equal(res.body.ok, true);
    assert.equal((await userRef.get()).data().aiTargetLang, 'en');
    assert.equal((await userRef.get()).data().marker, 'keep');
    assert.deepEqual((await jobs[0].get()).data(), { userId: ownerId, status: 'pending', text: '予約本文' });
  } finally {
    sessionUser = { userId: ownerId };
  }
});

test('re-deliberation forwards instructions and rejects concurrent job changes atomically', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/re-deliberate');
  const request = { body: { userPrompt: 'Use this instruction', lang: 'en' } };
  await userRef.set({ marker: 'unchanged' });
  for (const ref of jobs) {
    await ref.set({ userId: ownerId, status: 'pending', targetUrl: 'https://example.invalid', text: 'Old draft' });
  }

  for (const failedStage of [0, 1, 2]) {
    resetModel();
    modelHook = async index => {
      if (index === failedStage) throw new Error('test AI failure');
    };
    const failed = response();
    await handler(request, failed);
    assert.equal(failed.body.ok, false);
    assert.equal((await jobs[0].get()).data().text, 'Old draft');
    assert.equal((await userRef.get()).data().latestMarketingStrategy, undefined);
  }

  resetModel();
  modelHook = async index => {
    if (index === 3) await jobs[0].update({ status: 'processing' });
  };
  let res = response();
  await handler(request, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'redeliberation_conflict');
  assert.match(prompts[0], /Use this instruction/);
  assert.doesNotMatch(prompts[0], /\[object Object\]/);
  assert.equal((await jobs[0].get()).data().status, 'processing');
  assert.equal((await jobs[1].get()).data().text, 'Old draft');
  assert.equal((await userRef.get()).data().latestMarketingStrategy, undefined);

  await jobs[0].update({ status: 'pending' });
  resetModel();
  modelHook = async index => {
    if (index === 3) await userRef.update({ marker: 'changed concurrently' });
  };
  res = response();
  await handler(request, res);
  assert.equal(res.statusCode, 409);
  assert.equal((await jobs[0].get()).data().text, 'Old draft');
  assert.equal((await userRef.get()).data().marker, 'changed concurrently');

  await userRef.update({
    xUsername: 'owner',
    latestMarketingStrategy: { accountDiagnosis: {
      username: 'owner', hasOfficialData: true, followersMeasured: true, followers: 42,
      stage: 'STAGE_1_TRUST_BUILDING'
    } }
  });
  resetModel();
  res = response();
  await handler(request, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.updatedJobsCount, 2);
  assert.equal((await jobs[0].get()).data().text, '通常の投稿です。');
  assert.equal((await userRef.get()).data().latestMarketingStrategy.userPrompt, 'Use this instruction');
  assert.deepEqual((await userRef.get()).data().trustBuildingAccounts, ['owner']);

  await jobs[1].update({ targetUrl: 'https://other.invalid' });
  resetModel();
  res = response();
  await handler(request, res);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /対象URLが不足しているか一致しない/);
  assert.equal(prompts.length, 0);
  await jobs[1].update({ targetUrl: 'https://example.invalid' });

  resetModel();
  failPage = true;
  res = response();
  await handler(request, res);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /URLの読み込みに失敗/);
  assert.equal(prompts.length, 0);

  res = response();
  await handler({ body: { userPrompt: {} } }, res);
  assert.equal(res.statusCode, 400);
});
