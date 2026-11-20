'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('posting concurrency requires a local Firestore emulator', { skip: true }, () => {});
  return;
}

assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^127\.0\.0\.1:[0-9]{1,5}$/);
process.env.NODE_ENV = 'test';
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-velox-test' }, 'autopilot-posting-safety-test');
const db = getFirestore(app);
const suffix = `${process.pid}_${Date.now()}`;
const userId = `posting_test_user_${suffix}`;
const jobId = `posting_test_job_${suffix}`;
let enteredPost;
let releasePost;
const started = new Promise(resolve => { enteredPost = resolve; });
const postGate = new Promise(resolve => { releasePost = resolve; });
let calls = 0;
let workerPostGate = null;
let lookupResult = null;
let lookupHook = null;
let lookupCalls = 0;
let useRealLookup = false;
let launchError = null;
let postedThread = null;

function stub(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub('../src/firestore', { db });
const realOfficialApi = require('../src/official_api_client');
stub('../src/auth_service', { resolveSessionUser: async (_db, req) =>
  req.testUserId === null ? null : ({ userId: req.testUserId || userId }) });
stub('../src/official_api_client', {
  decryptCredentials: payload => payload === 'mock'
    ? { username: 'test', oauth2RefreshToken: 'do-not-refresh' }
    : realOfficialApi.decryptCredentials(payload),
  async postOfficialTweet() {
    calls++;
    enteredPost();
    await postGate;
    if (workerPostGate) {
      workerPostGate.started();
      await workerPostGate.wait;
    }
    return { ok: true, tweetId: 'mock-tweet', tweetUrl: 'https://example.invalid/mock' };
  },
  async postOfficialThread(_credentials, tweets) {
    postedThread = tweets;
    return { ok: true, tweetId: 'mock-thread', tweetUrl: 'https://example.invalid/thread' };
  },
  async registerBoostCampaign() { return null; },
  async getUserProfileAndRecentTweets(credentials, maxResults) {
    assert.equal(credentials.oauth2RefreshToken, undefined);
    lookupCalls++;
    if (useRealLookup) return realOfficialApi.getUserProfileAndRecentTweets(credentials, maxResults);
    if (lookupHook) await lookupHook();
    return lookupResult;
  }
});
stub('../src/collective_intelligence', {});
stub('../src/wise_payment', {});
let jitPrompt = '';
async function completeText(options = {}) {
  jitPrompt = options.prompt || '';
  return { text: JSON.stringify({ tweets: ['An original English post.'] }), modelName: 'grok-test' };
}
stub('../src/grok_client', {
  hasXaiKey: () => Boolean(process.env.XAI_API_KEY),
  completeText,
  async completeJson(options = {}) {
    const result = await completeText(options);
    return { ...result, parsed: JSON.parse(result.text) };
  }
});
const realPromoAi = require('../src/autonomous_promo_ai');
const { dateAtTimeInZone } = realPromoAi;
const { getUserMarketingKnowledge, generateJitPostContent } = require('../src/ai_deliberation_council');
const { sampleFromMapElitesArchive, registerPostPerformanceAndReflect } = require('../src/map_elites_memory');
stub('../src/autonomous_promo_ai', {
  dateAtTimeInZone,
  fetchUrlSummary: async () => ({ ok: true, title: 'Test service', description: 'Useful service' }),
  launchAutopilotCampaign: async () => {
    if (launchError) throw launchError;
    return {};
  },
  prepareNextPost: async () => {
    if (launchError) throw launchError;
    return { ok: true, jobId: 'next', tweets: ['one post'] };
  }
});
const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

after(async () => {
  await deleteApp(app);
});

test('explicit consent and withdrawal gate scheduled posting', { timeout: 15000 }, async () => {
  const ownerId = `consent_${suffix}`;
  const userRef = db.collection('saas_users').doc(ownerId);
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    await userRef.set({ xOfficialCredentials: 'mock', xUsername: 'test', planId: 'starter' });
    const request = { testUserId: ownerId, body: { targetUrl: 'https://example.invalid' } };
    const denied = response();
    await routes.get('/api/autopilot/launch')(request, denied);
    assert.equal(denied.statusCode, 403);
    const grant = response();
    await routes.get('/api/autopilot/consent')({
      testUserId: ownerId, body: { accepted: true, version: 1 }
    }, grant);
    assert.equal(grant.body.ok, true);
    const saved = (await userRef.get()).data();
    assert.equal(saved.autopilotConsent.account, 'username:test');
    assert.equal(saved.autopilotConsent.granted, true);
    const revoke = response();
    await routes.get('/api/autopilot/consent/revoke')({ testUserId: ownerId }, revoke);
    assert.equal(revoke.body.ok, true);
    const withdrawn = (await userRef.get()).data();
    assert.equal(withdrawn.autopilotPaused, true);
    assert.equal(withdrawn.autopilotConsent.granted, false);
    const resume = response();
    await routes.get('/api/autopilot/toggle-pause')({ testUserId: ownerId, body: {} }, resume);
    assert.equal(resume.statusCode, 403);
  } finally {
    await userRef.delete();
  }
});

test('failed next-post preparation is reported and does not arm extra slots', { timeout: 15000 }, async () => {
  const ownerId = `strategy_failure_${suffix}`;
  const userRef = db.collection('saas_users').doc(ownerId);
  const routes = new Map();
  registerHybridSaasRoutes({
    post: (path, handler) => routes.set(`POST ${path}`, handler),
    get: (path, handler) => routes.set(`GET ${path}`, handler)
  }, { runWorker: false });
  const response = () => ({
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    await userRef.set({
      planId: 'starter', xOfficialCredentials: 'mock',
      autopilotConsent: { version: 1, account: 'username:test', granted: true }
    });
    launchError = new Error('test strategy failure');
    const launchRes = response();
    await routes.get('POST /api/autopilot/launch')({
      testUserId: ownerId, body: { targetUrl: 'https://example.invalid', plan: 'starter' }
    }, launchRes);
    assert.equal(launchRes.body.ok, true);
    await new Promise(resolve => setImmediate(resolve));
    const statusRes = response();
    await routes.get('GET /api/autopilot/launch-status')({ testUserId: ownerId }, statusRes);
    assert.equal(statusRes.body.status, 'error');
    assert.equal(statusRes.body.error, 'test strategy failure');
    const jobs = await db.collection('autopilot_jobs').where('userId', '==', ownerId).get();
    assert.equal(jobs.size, 0);
  } finally {
    launchError = null;
    const jobs = await db.collection('autopilot_jobs').where('userId', '==', ownerId).get();
    await Promise.all(jobs.docs.map(doc => doc.ref.delete()));
    await userRef.delete();
  }
});

test('only confirmed single posts can be reconciled without reposting', { timeout: 15000 }, async () => {
  const ownerId = `recovery_owner_${suffix}`;
  const jobRef = db.collection('autopilot_jobs').doc(`recovery_job_${suffix}`);
  const userRef = db.collection('saas_users').doc(ownerId);
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/reconcile');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const request = id => ({ testUserId: id, params: { jobId: jobRef.id } });
  const confirmed = {
    userId: ownerId, status: 'failed', tweetId: '123456789',
    postConfirmation: { type: 'single_post_api_success', tweetId: '123456789' }
  };
  const publishedAt = '2026-01-02T03:04:05.000Z';
  const callsBefore = calls;
  try {
    await userRef.set({ xOfficialCredentials: 'mock' });
    await jobRef.set(confirmed);
    lookupCalls = 0;
    let res = response();
    await handler(request(`other_${suffix}`), res);
    assert.equal(res.statusCode, 403);
    assert.equal(lookupCalls, 0);

    for (const changes of [
      { status: 'processing' },
      { postConfirmation: null },
      { postConfirmation: { type: 'single_post_api_success', tweetId: '999' } }
    ]) {
      await jobRef.set({ ...confirmed, ...changes });
      res = response();
      await handler(request(ownerId), res);
      assert.equal(res.body.code, 'recovery_not_eligible');
      assert.equal(lookupCalls, 0);
    }

    await jobRef.set(confirmed);
    lookupResult = { ok: false, error: 'unavailable' };
    res = response();
    await handler(request(ownerId), res);
    assert.equal(res.body.code, 'recovery_lookup_failed');
    assert.equal((await jobRef.get()).data().status, 'failed');

    for (const tweets of [[], [{ id: '123456789', createdAt: 'invalid' }], [{ id: '987654321', createdAt: publishedAt }]]) {
      lookupResult = { ok: true, user: { id: '1010101' }, tweets };
      res = response();
      await handler(request(ownerId), res);
      assert.equal(res.body.code, 'recovery_not_verified');
      assert.equal((await jobRef.get()).data().status, 'failed');
    }

    lookupResult = { ok: true, user: { id: '1010101' }, tweets: [{ id: '123456789', createdAt: publishedAt }] };
    lookupHook = async () => { await jobRef.update({ changedDuringLookup: true }); };
    res = response();
    await handler(request(ownerId), res);
    assert.equal(res.body.code, 'recovery_conflict');
    assert.equal((await jobRef.get()).data().status, 'failed');
    lookupHook = null;

    lookupHook = async () => { await userRef.update({ xOfficialCredentials: 'reconnected' }); };
    res = response();
    await handler(request(ownerId), res);
    assert.equal(res.body.code, 'recovery_conflict');
    assert.equal((await jobRef.get()).data().status, 'failed');
    lookupHook = null;
    await userRef.update({ xOfficialCredentials: 'mock' });

    res = response();
    await handler(request(ownerId), res);
    assert.equal(res.body.ok, true);
    const restored = (await jobRef.get()).data();
    assert.equal(restored.status, 'posted');
    assert.equal(restored.postedAt.toDate().toISOString(), publishedAt);
    assert.equal(restored.tweetUrl, 'https://x.com/i/status/123456789');
    assert.equal(restored.recoveryMethod, 'verified_recent_timeline');
    assert.equal(restored.recoveredBy, ownerId);
    assert.equal(restored.recoveryXUserId, '1010101');
    assert.equal(restored.needs24hHarvest, true);
    res = response();
    await handler(request(ownerId), res);
    assert.equal(res.body.code, 'recovery_not_eligible');
    assert.equal(calls, callsBefore);
  } finally {
    lookupHook = null;
    lookupResult = null;
    await jobRef.delete();
    await userRef.delete();
  }
});

test('reconciliation uses the real X client with mocked HTTP for both OAuth methods', { timeout: 15000 }, async () => {
  const ownerId = `recovery_client_owner_${suffix}`;
  const jobRef = db.collection('autopilot_jobs').doc(`recovery_client_job_${suffix}`);
  const userRef = db.collection('saas_users').doc(ownerId);
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/reconcile');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const job = {
    userId: ownerId, status: 'failed', tweetId: '123456789',
    postConfirmation: { type: 'single_post_api_success', tweetId: '123456789' }
  };
  const request = { testUserId: ownerId, params: { jobId: jobRef.id } };
  const publishedAt = '2026-01-02T03:04:05.000Z';
  const originalFetch = global.fetch;
  const originalClientId = process.env.X_CLIENT_ID;
  let fetchCalls = [];
  let failure = null;
  global.fetch = async (url, options) => {
    const parsed = new URL(url);
    fetchCalls.push({ parsed, options });
    if (options.method !== 'GET' || parsed.origin !== 'https://api.twitter.com') {
      throw new Error('Unexpected non-GET or non-X request');
    }
    if (parsed.pathname === '/2/users/me') {
      if (failure === 'auth') return { ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) };
      return { ok: true, status: 200, json: async () => ({ data: { id: '1010101', username: 'mockuser' } }) };
    }
    if (parsed.pathname === '/2/users/1010101/tweets') {
      if (failure === 'rate') return { ok: false, status: 429, json: async () => ({ detail: 'Rate limited' }) };
      return { ok: true, status: 200, json: async () => ({
        data: [{ id: '123456789', text: 'mock post', created_at: publishedAt }]
      }) };
    }
    throw new Error('Unexpected endpoint');
  };
  process.env.X_CLIENT_ID = 'mock-client';
  useRealLookup = true;
  try {
    for (const [credentials, authorization] of [
      [{ oauth2AccessToken: 'mock-access', oauth2RefreshToken: 'mock-refresh', oauth2ExpiresAt: '2000-01-01T00:00:00Z' }, /^Bearer mock-access$/],
      [{ apiKey: 'mock-key', apiSecret: 'mock-secret', accessToken: 'mock-token', accessTokenSecret: 'mock-token-secret' }, /^OAuth /]
    ]) {
      const encrypted = realOfficialApi.encryptCredentials(credentials);
      await userRef.set({ xOfficialCredentials: encrypted });
      await jobRef.set(job);
      fetchCalls = [];
      failure = null;
      const res = response();
      await handler(request, res);
      assert.equal(res.body.ok, true);
      assert.equal(fetchCalls.length, 2);
      assert.equal(fetchCalls[0].parsed.pathname, '/2/users/me');
      assert.equal(fetchCalls[1].parsed.pathname, '/2/users/1010101/tweets');
      assert.equal(fetchCalls[1].parsed.searchParams.get('max_results'), '100');
      assert.match(fetchCalls[1].parsed.searchParams.get('tweet.fields'), /created_at/);
      for (const call of fetchCalls) assert.match(call.options.headers.Authorization, authorization);
      assert.deepEqual((await userRef.get()).data().xOfficialCredentials, encrypted);
      const restored = (await jobRef.get()).data();
      assert.equal(restored.status, 'posted');
      assert.equal(restored.postedAt.toDate().toISOString(), publishedAt);
      assert.equal(restored.recoveryXUserId, '1010101');

      for (failure of ['auth', 'rate']) {
        await jobRef.set(job);
        fetchCalls = [];
        const failed = response();
        await handler(request, failed);
        assert.equal(failed.body.code, 'recovery_lookup_failed');
        assert.equal((await jobRef.get()).data().status, 'failed');
        assert.equal(fetchCalls.length, failure === 'auth' ? 1 : 2);
      }
    }
  } finally {
    useRealLookup = false;
    global.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.X_CLIENT_ID;
    else process.env.X_CLIENT_ID = originalClientId;
    await jobRef.delete();
    await userRef.delete();
  }
});

test('new accounts use hypotheses and saved evidence, not synthetic performance examples', { timeout: 15000 }, async () => {
  const ownerId = `learning_owner_${suffix}`;
  const userRef = db.collection('saas_users').doc(ownerId);
  const knowledgeRef = db.collection('user_marketing_knowledge').doc(ownerId);
  const archiveRef = db.collection('collective_intelligence').doc(`map_elites_${ownerId}`);
  const legacyCase = {
    title: '具体的数字・Before/After対比型',
    hookSnippet: '残業月40時間→定時退社で売上2倍。私が実践した“仕組み化の3大原則”がこれ',
    whyItSucceeded: '具体的な数字がタイムラインでのスクロールを止め、ブックマーク率が急上昇した。',
    format: 'two_tier_reply_link', impressions: 2400
  };
  try {
    await userRef.set({});
    await knowledgeRef.set({ successfulCases: [legacyCase], failedCases: [] });
    const knowledge = await getUserMarketingKnowledge(ownerId);
    assert.deepEqual(knowledge.successfulCases, []);
    assert.deepEqual((await knowledgeRef.get()).data().successfulCases, [legacyCase]);
    const { prompt } = await realPromoAi.buildCouncilWritingPrompt({
      userId: ownerId, userKnowledge: knowledge,
      councilPlan: { postPlan: [{ timeSlot: 'morning' }] }
    });
    assert.match(prompt, /誰に・なぜ今・どの根拠か/);
    assert.doesNotMatch(prompt, /過去30日間で120社のアカウントを精査/);
    assert.doesNotMatch(prompt, /残業月40時間→定時退社で売上2倍。私が実践した/);
    assert.doesNotMatch(prompt, /【🏆 自社実測勝ちパターン/);

    const cellId = 'contrarian:logical_thread:b2b_executive';
    await registerPostPerformanceAndReflect({
      userId: ownerId, cellId, postText: 'Actual measured post',
      metrics: { impressions: 100, bookmarks: 0, likes: 0 }
    });
    const stored = (await archiveRef.get()).data().grid[cellId];
    assert.equal(stored.fullSample, 'Actual measured post');
    const sample = await sampleFromMapElitesArchive(ownerId, { allowMutation: false });
    assert.equal(sample.referenceHook, 'Actual measured post');
    assert.match(sample.directive, /因果関係は未検証/);
  } finally {
    await archiveRef.delete();
    await knowledgeRef.delete();
    await userRef.delete();
  }
});

test('JIT uses only this account’s valid frozen metrics in its prompt', { timeout: 15000 }, async () => {
  const ownerId = `jit_owner_${suffix}`;
  const refs = ['valid', 'unfrozen', 'invalid', 'late', 'other'].map(id =>
    db.collection('autopilot_jobs').doc(`jit_${id}_${suffix}`));
  const snapshot = { isFrozen: true, postAgeHours: 25, impressions: 1200, bookmarks: 12, likes: 1 };
  const originalKey = process.env.XAI_API_KEY;
  try {
    await Promise.all([
      refs[0].set({ userId: ownerId, status: 'posted', text_en: 'Original owner text', metrics24hSnapshot: snapshot }),
      refs[1].set({ userId: ownerId, status: 'posted', metrics24hSnapshot: { ...snapshot, isFrozen: false, impressions: 2200 } }),
      refs[2].set({ userId: ownerId, status: 'posted', metrics24hSnapshot: { ...snapshot, impressions: -3300 } }),
      refs[3].set({ userId: ownerId, status: 'posted', metrics24hSnapshot: { ...snapshot, postAgeHours: 37, impressions: 4400 } }),
      refs[4].set({ userId: `other_${suffix}`, status: 'posted', text_en: 'Other private text', metrics24hSnapshot: { ...snapshot, impressions: 5500 } })
    ]);
    process.env.XAI_API_KEY = 'mock-key';
    await generateJitPostContent({
      userId: ownerId, lang: 'en', targetUrl: 'https://example.invalid',
      pageSummary: { ok: true, title: 'Service', description: 'Helpful service' }
    });
    assert.match(jitPrompt, /Write only these three from the current page/);
    assert.match(jitPrompt, /Helpful service/);
    assert.doesNotMatch(jitPrompt, /Original owner text|Other private text|勝ち1件/);
  } finally {
    if (originalKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = originalKey;
    await Promise.all(refs.map(ref => ref.delete()));
  }
});

test('council commit checks ownership and atomically rejects conflicting changes', { timeout: 15000 }, async () => {
  const ownerId = `council_owner_${suffix}`;
  const sessionId = `council_session_${suffix}`;
  const sessionRef = db.collection('ai_council_sessions').doc(sessionId);
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/council/commit');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const request = id => ({
    testUserId: id,
    body: { deliberationId: sessionId, overrideTweets: ['Manual test post'] }
  });
  const originalBatch = db.batch;
  let release;
  let runs = [];
  try {
    await sessionRef.set({
      userId: ownerId,
      status: 'draft',
      recommendedSchedule: { scheduledAt: new Date('2027-01-01T10:00:00Z') },
      proposedPost: {}
    });
    const forbidden = response();
    await handler(request(`other_${suffix}`), forbidden);
    assert.equal(forbidden.statusCode, 403);
    assert.equal((await db.collection('autopilot_jobs').where('deliberationId', '==', sessionId).get()).size, 0);
    assert.equal((await sessionRef.get()).data().status, 'draft');

    db.batch = function (...args) {
      const batch = originalBatch.apply(this, args);
      const commit = batch.commit.bind(batch);
      batch.commit = async () => {
        await sessionRef.update({ changedByTest: true });
        return commit();
      };
      return batch;
    };
    const stale = response();
    await handler(request(ownerId), stale);
    db.batch = originalBatch;
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.code, 'council_conflict');
    assert.equal((await db.collection('autopilot_jobs').where('deliberationId', '==', sessionId).get()).size, 0);
    assert.equal((await sessionRef.get()).data().changedByTest, true);

    let ready;
    const bothReady = new Promise(resolve => { ready = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let count = 0;
    db.batch = function (...args) {
      const batch = originalBatch.apply(this, args);
      const commit = batch.commit.bind(batch);
      batch.commit = async () => {
        if (++count === 2) ready();
        await gate;
        return commit();
      };
      return batch;
    };
    const responses = [response(), response()];
    runs = responses.map(res => handler(request(ownerId), res));
    await bothReady;
    release();
    await Promise.all(runs);
    db.batch = originalBatch;

    assert.deepEqual(responses.map(res => res.statusCode).sort(), [200, 409]);
    assert.equal(responses.find(res => res.statusCode === 409).body.code, 'council_conflict');
    const jobs = await db.collection('autopilot_jobs').where('deliberationId', '==', sessionId).get();
    assert.equal(jobs.size, 1);
    const session = (await sessionRef.get()).data();
    assert.equal(session.status, 'approved');
    assert.equal(session.jobId, jobs.docs[0].id);

    for (const tweets of [['Manual test post'], ['Different post']]) {
      const retry = request(ownerId);
      retry.body.overrideTweets = tweets;
      const res = response();
      await handler(retry, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, 'council_already_approved');
    }
    assert.equal((await db.collection('autopilot_jobs').where('deliberationId', '==', sessionId).get()).size, 1);
    await jobs.docs[0].ref.delete();
    const afterDeletion = response();
    await handler(request(ownerId), afterDeletion);
    assert.equal(afterDeletion.statusCode, 409);
    assert.equal(afterDeletion.body.code, 'council_already_approved');
    assert.equal((await db.collection('autopilot_jobs').where('deliberationId', '==', sessionId).get()).size, 0);
  } finally {
    if (release) release();
    await Promise.allSettled(runs);
    db.batch = originalBatch;
    const jobs = await db.collection('autopilot_jobs').where('deliberationId', '==', sessionId).get();
    await Promise.all(jobs.docs.map(doc => doc.ref.delete()));
    await sessionRef.delete();
  }
});

test('JIT sends the selected promotion URL', { timeout: 15000 }, async () => {
    const ownerId = `jit_growth_${suffix}`;
    const target = 'https://example.invalid/offer?ref=123';
    const userRef = db.collection('saas_users').doc(ownerId);
    const jobRef = db.collection('autopilot_jobs').doc(`jit_growth_job_${suffix}`);
    const originalKey = process.env.XAI_API_KEY;
    const routes = new Map();
    registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
    const response = () => ({
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    });
    try {
      process.env.XAI_API_KEY = 'mock-key';
      await userRef.set({
        xOfficialCredentials: 'mock', targetUrl: target, aiTargetLang: 'en', xUsername: 'test',
        latestMarketingStrategy: {
          targetUrl: target, userPrompt: null,
          accountDiagnosis: { username: 'test', hasOfficialData: true, followersMeasured: true, followers: 600, stage: 'STAGE_2_AUTHORITY_ENGAGEMENT' },
          marketAnalysis: { targetAudience_en: 'New affiliates' }
        }
      });
      await jobRef.set({ userId: ownerId, status: 'pending', isJitContent: true, isPromotion: true });
      postedThread = null;
      const res = response();
      await routes.get('/api/autopilot/jobs/:jobId/post-now')({ testUserId: ownerId, params: { jobId: jobRef.id } }, res);
      assert.equal(res.body.ok, true);
      assert.deepEqual(postedThread, ['[Ad] An original English post.', `[Ad] Details: ${target}`]);
      assert.match(jitPrompt, /"targetAudienceEn":"New affiliates"/);
      const saved = (await jobRef.get()).data();
      assert.equal(saved.status, 'posted');
      assert.deepEqual(saved.tweets_en, postedThread);
    } finally {
      if (originalKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = originalKey;
      await Promise.all([jobRef.delete(), userRef.delete()]);
    }
  });

test('Firestore claim prevents simultaneous manual posts and processing deletion', { timeout: 15000 }, async () => {
  const jobRef = db.collection('autopilot_jobs').doc(jobId);
  const userRef = db.collection('saas_users').doc(userId);
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const req = { params: { jobId } };
  let submissions = [];
  try {
    await userRef.set({ xOfficialCredentials: 'mock' });
    await jobRef.set({ userId, status: 'pending', text: 'Isolated test', isHumanOverride: true });
    const first = response();
    const second = response();
    const postNow = routes.get('/api/autopilot/jobs/:jobId/post-now');
    submissions = [postNow(req, first), postNow(req, second)];
    await started;
    await Promise.race(submissions);
    assert.equal([first, second].filter(res => res.statusCode === 409).length, 1);
    const cancelled = response();
    await routes.get('/api/autopilot/jobs/:jobId/cancel')(req, cancelled);
    assert.equal(cancelled.statusCode, 409);
    assert.equal((await jobRef.get()).data().status, 'processing');
    assert.equal(calls, 1);
    releasePost();
    await Promise.all(submissions);
    assert.equal([first, second].filter(res => res.body?.ok).length, 1);
    assert.equal((await jobRef.get()).data().status, 'posted');
  } finally {
    releasePost();
    await Promise.allSettled(submissions);
    await Promise.all([jobRef.delete(), userRef.delete()]);
  }
});

test('same-account posts are serialized and exact duplicates are rejected before X submission', { timeout: 15000 }, async () => {
  const ownerId = `dedupe_owner_${suffix}`;
  const firstJobRef = db.collection('autopilot_jobs').doc(`dedupe_first_${suffix}`);
  const secondJobRef = db.collection('autopilot_jobs').doc(`dedupe_second_${suffix}`);
  const userRef = db.collection('saas_users').doc(ownerId);
  const routes = new Map();
  registerHybridSaasRoutes({
    post: (path, handler) => routes.set(path, handler),
    get() {}
  }, { runWorker: false });
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  let releaseFirstPost;
  let firstPostStarted;
  const firstPostWait = new Promise(resolve => { releaseFirstPost = resolve; });
  const firstPostStart = new Promise(resolve => { firstPostStarted = resolve; });
  const callsBefore = calls;

  releasePost();
  workerPostGate = { started: firstPostStarted, wait: firstPostWait };
  try {
    await userRef.set({ xOfficialCredentials: 'mock' });
    await firstJobRef.set({
      userId: ownerId, status: 'pending', isHumanOverride: true,
      text: 'Same post content.'
    });
    await secondJobRef.set({
      userId: ownerId, status: 'pending', isHumanOverride: true,
      text: '  SAME   post content. '
    });

    const postNow = routes.get('/api/autopilot/jobs/:jobId/post-now');
    const firstResponse = response();
    const firstRequest = postNow({
      testUserId: ownerId, params: { jobId: firstJobRef.id }
    }, firstResponse);
    await firstPostStart;

    const concurrentResponse = response();
    await postNow({
      testUserId: ownerId, params: { jobId: secondJobRef.id }
    }, concurrentResponse);
    assert.equal(concurrentResponse.statusCode, 409);
    assert.equal(concurrentResponse.body.code, 'account_post_in_progress');
    assert.equal((await secondJobRef.get()).data().status, 'pending');

    releaseFirstPost();
    await firstRequest;
    assert.equal(firstResponse.body.ok, true);

    const retryResponse = response();
    await postNow({
      testUserId: ownerId, params: { jobId: secondJobRef.id }
    }, retryResponse);
    assert.equal(retryResponse.statusCode, 409);
    assert.equal(retryResponse.body.code, 'duplicate_content');
    assert.equal((await secondJobRef.get()).data().duplicateOfJobId, firstJobRef.id);
    assert.equal(calls, callsBefore + 1);
  } finally {
    releaseFirstPost();
    workerPostGate = null;
    await Promise.all([
      firstJobRef.delete(),
      secondJobRef.delete(),
      userRef.delete()
    ]);
  }
});

test('accounts scheduling in the same millisecond keep separate jobs', { timeout: 15000 }, async () => {
  const users = [`schedule_a_${suffix}_same`, `schedule_b_${suffix}_same`];
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const response = () => ({
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  const originalNow = Date.now;
  const originalRandom = Math.random;
  try {
    const zones = ['Asia/Tokyo', 'America/New_York'];
    await Promise.all(users.map((id, i) => db.collection('saas_users').doc(id).set({
      xOfficialCredentials: 'mock', targetUrl: 'https://example.invalid', scheduleTimeZone: zones[i],
      autopilotConsent: { version: 1, account: 'username:test', granted: true }
    })));
    const fixedNow = originalNow();
    Date.now = () => fixedNow;
    Math.random = () => 0.5;

    for (const id of users) {
      const res = response();
      await routes.get('/api/autopilot/launch')({
        testUserId: id, body: { targetUrl: 'https://example.invalid' }
      }, res);
      assert.equal(res.body.ok, true, res.body.error);
    }

    for (const [i, id] of users.entries()) {
      const res = response();
      await routes.get('/api/autopilot/schedule-jit-slots')({ testUserId: id, body: {} }, res);
      assert.equal(res.body.ok, true, res.body.error);
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: zones[i], hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      });
      assert.deepEqual(res.body.jobs.map(job => formatter.format(job.scheduledAt)), ['08:30', '12:30', '20:00']);
    }

    const snapshots = await Promise.all(users.map(id => db.collection('autopilot_jobs')
      .where('userId', '==', id).get()));
    assert.deepEqual(snapshots.map(snap => snap.size), [6, 6]);
    const ids = snapshots.flatMap(snap => snap.docs.map(doc => doc.id));
    assert.equal(new Set(ids).size, 12);
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
    for (const id of users) {
      const snap = await db.collection('autopilot_jobs').where('userId', '==', id).get();
      await Promise.all(snap.docs.map(doc => doc.ref.delete()));
      await db.collection('saas_users').doc(id).delete();
    }
  }
});

test('manual JIT reservations assign promotion slots for each plan', { timeout: 15000 }, async () => {
  const plans = ['starter', 'pro', 'business'];
  const users = plans.map(plan => `promotion_${plan}_${suffix}`);
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const response = () => ({
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    for (const [index, plan] of plans.entries()) {
      const id = users[index];
      await db.collection('saas_users').doc(id).set({
        planId: plan, xOfficialCredentials: 'mock',
        autopilotConsent: { version: 1, account: 'username:test', granted: true },
        targetUrl: 'https://example.invalid', scheduleTimeZone: 'Asia/Tokyo', xUsername: 'test',
        latestMarketingStrategy: { accountDiagnosis: {
          username: 'test', hasOfficialData: true, followersMeasured: true, followers: 600, stage: 'STAGE_2_AUTHORITY_ENGAGEMENT'
        } }
      });
      const launch = response();
      await routes.get('/api/autopilot/launch')({
        testUserId: id, body: { targetUrl: 'https://example.invalid', plan }
      }, launch);
      assert.equal(launch.body.ok, true, launch.body.error);
      const initialJobs = await db.collection('autopilot_jobs').where('userId', '==', id).get();
      for (const doc of initialJobs.docs) {
        const job = doc.data();
        const date = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(job.scheduledAt.toDate());
        const evenDay = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) % 2 === 0;
        const expected = plan === 'starter' ? job.timeSlot === 'morning' && evenDay
          : job.timeSlot === (plan === 'business' ? 'late_night' : 'evening');
        assert.equal(job.isPromotion, expected, `launch ${plan} ${job.timeSlot} ${date}`);
      }
      const res = response();
      await routes.get('/api/autopilot/schedule-jit-slots')({ testUserId: id, body: { days: 2 } }, res);
      assert.equal(res.body.ok, true, res.body.error);
      for (const job of res.body.jobs) {
        const date = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(job.scheduledAt);
        const evenDay = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) % 2 === 0;
        const expected = plan === 'starter' ? job.timeSlot === 'morning' && evenDay : job.timeSlot === 'evening';
        assert.equal(job.isPromotion, expected, `${plan} ${job.timeSlot} ${date}`);
      }
    }
  } finally {
    for (const id of users) {
      const snap = await db.collection('autopilot_jobs').where('userId', '==', id).get();
      await Promise.all(snap.docs.map(doc => doc.ref.delete()));
      await db.collection('saas_users').doc(id).delete();
    }
  }
});

test('worker scans past 1000 future jobs and rechecks the schedule before claiming', { timeout: 60000 }, async () => {
  releasePost();
  const workerUser = `worker_user_${suffix}`;
  const prefix = `worker_job_${suffix}_`;
  const jobs = db.collection('autopilot_jobs');
  const future = new Date(Date.now() + 86400000);
  const due = new Date(Date.now() - 60000);
  const refs = [];
  const batches = [];
  let batch = db.batch();
  for (let i = 0; i < 1004; i++) {
    const ref = jobs.doc(`${prefix}${String(i).padStart(4, '0')}`);
    refs.push(ref);
    batch.create(ref, { userId: workerUser, status: 'pending', scheduledAt: future });
    if ((i + 1) % 400 === 0) {
      batches.push(batch);
      batch = db.batch();
    }
  }
  const dueRefs = ['a', 'b', 'c', 'd'].map(name => jobs.doc(`${prefix}due_${name}`));
  refs.push(...dueRefs);
  dueRefs.forEach((ref, i) => {
    const data = { userId: workerUser, status: 'pending', text: 'Isolated test', isHumanOverride: true };
    if (i !== 1) data.scheduledAt = due;
    batch.create(ref, data);
  });
  batch.create(db.collection('saas_users').doc(workerUser), { xOfficialCredentials: 'mock' });
  batches.push(batch);

  const originalInterval = global.setInterval;
  const originalTimeout = global.setTimeout;
  const originalTransaction = db.runTransaction;
  let tick;
  let unblockPost;
  try {
    for (const writes of batches) await writes.commit();
    global.setInterval = (callback, delay) => {
      if (delay === 60000) tick = callback;
      return {};
    };
    global.setTimeout = () => ({});
    registerHybridSaasRoutes({ post() {}, get() {} });
    global.setInterval = originalInterval;
    global.setTimeout = originalTimeout;
    assert.equal(typeof tick, 'function');

    const initialCalls = calls;
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(calls, initialCalls);
    assert.equal((await dueRefs[0].get()).data().status, 'pending');

    let notifyStarted;
    const postStarted = new Promise(resolve => { notifyStarted = resolve; });
    workerPostGate = {
      started: notifyStarted,
      wait: new Promise(resolve => { unblockPost = resolve; })
    };
    let transactions = 0;
    db.runTransaction = async function (...args) {
      transactions++;
      if (transactions === 3) await dueRefs[2].update({ scheduledAt: future });
      return originalTransaction.apply(this, args);
    };
    const runningTick = tick();
    await postStarted;
    await tick();
    assert.equal(calls, initialCalls + 1);
    assert.equal((await dueRefs[1].get()).data().status, 'pending');
    unblockPost();
    await runningTick;
    workerPostGate = null;

    assert.equal(calls, initialCalls + 2);
    assert.equal((await dueRefs[0].get()).data().status, 'posted');
    assert.equal((await dueRefs[1].get()).data().status, 'posted');
    assert.equal((await dueRefs[2].get()).data().status, 'pending');
    assert.equal((await dueRefs[3].get()).data().status, 'pending');

    await tick();
    assert.equal(calls, initialCalls + 3);
    assert.equal((await dueRefs[3].get()).data().status, 'posted');
  } finally {
    if (unblockPost) unblockPost();
    workerPostGate = null;
    global.setInterval = originalInterval;
    global.setTimeout = originalTimeout;
    db.runTransaction = originalTransaction;
    for (let i = 0; i < refs.length; i += 400) {
      const cleanup = db.batch();
      refs.slice(i, i + 400).forEach(ref => cleanup.delete(ref));
      await cleanup.commit();
    }
    await db.collection('saas_users').doc(workerUser).delete();
  }
});
