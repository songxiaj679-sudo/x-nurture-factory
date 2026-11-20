'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function stubModule(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

process.env.NODE_ENV = 'test';
process.env.XAI_API_KEY = 'mock-key';

let job;
let posted = [];
let boostRegistrations = 0;
let postGate = null;
let threadResult = null;
let postedThread = null;
let failJitSave = false;
let failPostedUpdate = false;
let modelOutput = { tweets: ['会議は30時間続いた。'] };
let modelError = null;
let lastModelPrompt;
let modelResponses = [];
let modelCalls = 0;
let modelHang = false;
let abortedCalls = 0;
let corpusItems = [];
let peerItems = [];
let peerRange = null;
let historyItems = [];
let affiliateItems = [];
let pageResult = { ok: true, title: 'Example service', description: 'Useful product', headings: [], snippet: '' };
let pageResults = [];
let pageCalls = 0;
let userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', targetUrl: 'https://example.invalid' };
let userReadError = null;
const jobRef = {
  async get() {
    const snapshot = job && { ...job };
    return { exists: Boolean(snapshot), data: () => snapshot };
  },
  async update(fields) {
    if (failJitSave && fields.isJitGenerated) throw new Error('JIT save failed');
    if (failPostedUpdate && fields.status === 'posted') throw new Error('Post result save failed');
    Object.assign(job, fields);
  },
  async delete() { job = null; }
};
const db = {
  async runTransaction(fn) {
    return fn({
      get: ref => ref.get(),
      update: (ref, fields) => ref.update(fields),
      delete: ref => ref.delete()
    });
  },
  collection(name) {
    if (name === 'autopilot_jobs') {
      const createQuery = (filters = []) => ({
        doc: () => jobRef,
        where: (key, op, value) => createQuery([...filters, [key, op, value]]),
        orderBy: () => createQuery(filters),
        limit: () => createQuery(filters),
        async get() {
          return { docs: historyItems.filter(item => filters.every(([key, op, value]) => {
            if (op === '>=') return item[key] >= value;
            return item[key] === value;
          }))
            .map(item => ({ data: () => item })) };
        }
      });
      return createQuery();
    }
    if (name === 'saas_users') return {
      doc: () => ({
        async get() {
          if (userReadError) throw userReadError;
          const snapshot = userData && { ...userData };
          return { exists: Boolean(snapshot), data: () => snapshot && { ...snapshot } };
        },
        async update(fields) {
          Object.assign(userData, fields);
        },
        collection() {
          return {
            doc: () => ({
              collection: () => ({
                orderBy: () => ({
                  limit: () => ({
                    async get() {
                      return { docs: affiliateItems.map(item => ({ id: item.date, data: () => item })) };
                    }
                  })
                })
              })
            })
          };
        }
      })
    };
    throw new Error(`Unexpected collection: ${name}`);
  }
};

stubModule('../src/firestore', { db });
stubModule('../src/intelligence_harvester', {
  getCorpusPatternSummary: (_limit, options) => {
    if (options?.peerFollowers) {
      peerRange = options.peerFollowers;
      return peerItems;
    }
    return corpusItems;
  },
  analyzeTweetStructure: text => ({ hookType: text.includes('?') ? 'question_hook' : 'general_hook', postFormat: 'single_impact', ctaType: 'none' })
});
async function completeText(options = {}) {
  modelCalls++;
  lastModelPrompt = options.prompt || '';
  if (modelHang) return new Promise(() => {});
  if (modelResponses.length) {
    const next = modelResponses.shift();
    if (next instanceof Error) throw next;
    return { text: JSON.stringify(next), modelName: 'grok-test' };
  }
  if (modelError) throw modelError;
  return { text: typeof modelOutput === 'string' ? modelOutput : JSON.stringify(modelOutput), modelName: 'grok-test' };
}
stubModule('../src/grok_client', {
  hasXaiKey: () => Boolean(process.env.XAI_API_KEY),
  completeText,
  async completeJson(options) {
    const result = await completeText(options);
    return { ...result, parsed: JSON.parse(result.text) };
  },
  _legacy: {
    getGenerativeModel() {
      return {
        async generateContent(prompt) {
          lastModelPrompt = prompt;
        }
      };
    }
  }
});
const realSanitizePostOrReplyText = require('../src/official_api_client').sanitizePostOrReplyText;
stubModule('../src/official_api_client', {
  decryptCredentials: () => ({ username: 'VeloxSystemsV4' }),
  fetchMyAccountState: async () => ({ ok: false }),
  sanitizePostOrReplyText: realSanitizePostOrReplyText,
  async postOfficialTweet(_credentials, text) {
    posted.push(text);
    if (postGate) await postGate;
    return { ok: true, tweetId: 'mock', tweetUrl: 'https://example.com/mock' };
  },
  async postOfficialThread(_credentials, tweets) {
    postedThread = tweets;
    if (!threadResult) throw new Error('Unexpected thread post');
    return threadResult;
  },
  async registerBoostCampaign() { boostRegistrations++; return null; }
});
stubModule('../src/collective_intelligence', {});
stubModule('../src/autonomous_promo_ai', {
  fetchUrlSummary: async () => {
    pageCalls++;
    return pageResults.length ? pageResults.shift() : pageResult;
  },
  fetchMyAccountState: async () => ({ ok: false }),
  cancelOtherPendingJobs: async () => 0,
  ensureNextPost: async () => ({})
});
stubModule('../src/wise_payment', {});
stubModule('../src/auth_service', { resolveSessionUser: async () => ({ userId: 'user' }) });

const council = require('../src/ai_deliberation_council');
const { generateJitPostContent } = council;
let jitOverride = null;
stubModule('../src/ai_deliberation_council', {
  ...council,
  generateJitPostContent: (...args) => jitOverride ? jitOverride(...args) : generateJitPostContent(...args)
});
const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

test('JIT does not replace an ambiguous generated draft with a fallback', async () => {
  modelOutput = { tweets: ['会議は30時間続いた。'] };
  await assert.rejects(generateJitPostContent({ timeSlot: 'morning', pageSummary: pageResult }), {
    code: 'post_constraint_ambiguous'
  });
});

test('JIT fails closed for missing AI settings, failed generation and incomplete threads', async () => {
  const savedKey = process.env.XAI_API_KEY;
  try {
    delete process.env.XAI_API_KEY;
    await assert.rejects(generateJitPostContent({ lang: 'ja' }), { code: 'jit_generation_unavailable' });
    await assert.rejects(generateJitPostContent({ lang: 'en' }), { code: 'jit_generation_unavailable' });
    process.env.XAI_API_KEY = savedKey;
    modelError = new Error('mock AI unavailable');
    await assert.rejects(generateJitPostContent({ pageSummary: pageResult }), { code: 'jit_generation_failed' });
    modelError = null;
    modelOutput = 'invalid JSON';
    await assert.rejects(generateJitPostContent({ pageSummary: pageResult }), { code: 'jit_generation_failed' });
    for (const tweets of [[], ['通常の投稿です。', ''], ['通常の投稿です。', null]]) {
      modelOutput = { tweets };
      await assert.rejects(generateJitPostContent({ pageSummary: pageResult }), { code: 'post_constraint_ambiguous' });
    }
    modelOutput = { tweets: ['通常の投稿です。', '続きの投稿です。'] };
    const result = await generateJitPostContent({ pageSummary: pageResult });
    assert.deepEqual(result.tweets, ['通常の投稿です。', '続きの投稿です。']);
    assert.match(String(lastModelPrompt), /提供されていない体験、実績、数値/);
  } finally {
    process.env.XAI_API_KEY = savedKey;
    modelError = null;
  }
});

test('JIT uses promotion details and observed patterns without copying source posts', async () => {
  const { generateJitPostContent } = council;
  const snapshot = { isFrozen: true, postAgeHours: 25, impressions: 1200, bookmarks: 12 };
  try {
    corpusItems = [
      { genre: 'restaurant', lang: 'ja', hook: 'question_hook', format: 'single_impact',
        cta: 'profile_link', samples: 2, likes: { available: 2, min: 0, median: 0, max: 42 } }
    ];
    peerItems = [{ genre: 'software', samples: 3, hook: 'story_empathy' }];
    historyItems = [
      { userId: 'user', status: 'posted', text: 'DO NOT COPY PERSONAL?', metrics24hSnapshot: snapshot },
      ...[1, 2, 3, 4, 5].map(bookmarks => ({
        userId: 'user', status: 'posted', text: 'Personal example',
        metrics24hSnapshot: { ...snapshot, impressions: 1200 + bookmarks, bookmarks }
      })),
      { userId: 'other', status: 'posted', text: 'OTHER ACCOUNT', metrics24hSnapshot: { ...snapshot, impressions: 99000 } },
      { userId: 'user', status: 'posted', text: 'UNMATURED', metrics24hSnapshot: { ...snapshot, postAgeHours: 23 } }
    ];
    modelOutput = { tweets: ['A valid post.'] };
    await generateJitPostContent({
      userId: 'user', lang: 'en', targetUrl: 'https://example.invalid',
      pageSummary: pageResult, userPrompt: 'Focus on small businesses',
      accountContext: { followers: 42, targetAudience: 'beginner affiliates' },
      affiliateResults: [{ date: '2026-11-14', clicks: 4, conversions: null }]
    });
    const prompt = String(lastModelPrompt);
    assert.match(prompt, /Example service/);
    assert.match(prompt, /Useful product/);
    assert.match(prompt, /Focus on small businesses/);
    assert.match(prompt, /"hook":"question_hook"/);
    assert.match(prompt, /"genre":"restaurant"/);
    assert.match(prompt, /"min":0/);
    assert.match(prompt, /Apply posting structures from other industries/);
    assert.match(prompt, /beginner affiliates/);
    assert.match(prompt, /"hook":"story_empathy"/);
    assert.match(prompt, /"clicks":4,"conversions":null/);
    assert.deepEqual(peerRange, { min: 43, max: 126 });
    assert.match(prompt, /Do not copy another post's wording/);
    assert.doesNotMatch(prompt, /DO NOT COPY|Personal example/);
    assert.doesNotMatch(prompt, /DO NOT COPY|OTHER ACCOUNT|UNMATURED|99000/);
    await assert.rejects(generateJitPostContent({ pageSummary: { ok: true } }), { code: 'jit_context_unavailable' });
  } finally {
    corpusItems = [];
    peerItems = [];
    peerRange = null;
    historyItems = [];
  }
});

test('JIT retries transient Gemini errors but not authentication or long rate limits', async () => {
  const failure = (status, errorDetails) => Object.assign(new Error(`mock HTTP ${status}`), { status, errorDetails });
  const call = () => generateJitPostContent({ pageSummary: pageResult, lang: 'en' });
  try {
    modelCalls = 0;
    modelResponses = [failure(503), { tweets: ['Successful retry.'] }];
    assert.equal((await call()).text, 'Successful retry.');
    assert.equal(modelCalls, 2);

    modelCalls = 0;
    modelResponses = [failure(500), failure(503), failure(503)];
    await assert.rejects(call(), { code: 'jit_generation_failed' });
    assert.equal(modelCalls, 3);

    modelCalls = 0;
    modelResponses = [failure(401)];
    await assert.rejects(call(), { code: 'jit_generation_failed' });
    assert.equal(modelCalls, 1);
    modelCalls = 0;
    modelResponses = [failure(429, [{ retryDelay: '31s' }])];
    await assert.rejects(call(), { code: 'jit_generation_failed' });
    assert.equal(modelCalls, 1);
    modelCalls = 0;
    modelResponses = [failure(429)];
    await assert.rejects(call(), { code: 'jit_generation_failed' });
    assert.equal(modelCalls, 1);
  } finally {
    modelResponses = [];
    modelError = null;
  }
});

test('JIT aborts each Gemini attempt after 30 seconds and stops after three attempts', async t => {
  const originalRandom = Math.random;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    Math.random = () => 0;
    modelHang = true;
    modelCalls = 0;
    abortedCalls = 0;
    const outcome = assert.rejects(generateJitPostContent({ pageSummary: pageResult }), { code: 'jit_generation_timeout' });
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(29999);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(abortedCalls, 0);
    for (const delay of [500, 1000, null]) {
      t.mock.timers.tick(delay === 500 ? 1 : 30000);
      await new Promise(resolve => setImmediate(resolve));
      if (delay !== null) {
        t.mock.timers.tick(delay);
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    await outcome;
    assert.equal(modelCalls, 3);
  } finally {
    modelHang = false;
    Math.random = originalRandom;
    try { t.mock.timers.reset(); } catch (_err) {}
  }
});

test('council writing propagates an ambiguous draft instead of using a fallback', async () => {
  stubModule('../src/map_elites_memory', {
    async sampleFromMapElitesArchive() {
      return { mode: 'explore', angle: { name: 'work' }, audience: { name: 'reader' }, directive: 'work' };
    }
  });
  delete require.cache[require.resolve('../src/autonomous_promo_ai')];
  const { writeCouncilApprovedPosts } = require('../src/autonomous_promo_ai');
  modelOutput = { posts: [{ tweets: ['会議は30時間続いた。'], tweets_en: ['A normal post.'] }] };
  await assert.rejects(writeCouncilApprovedPosts(
    { serviceName: 'Test' }, '', { postPlan: [{ step: 1, timeSlot: 'morning' }] }
  ), { code: 'post_constraint_ambiguous' });
});

test('council writing fails closed when AI output is missing or generation fails', async () => {
  const { writeCouncilApprovedPosts } = require('../src/autonomous_promo_ai');
  const plan = { postPlan: [{ step: 1, timeSlot: 'morning' }] };
  const write = () => writeCouncilApprovedPosts({ serviceName: 'Test' }, '', plan);
  try {
    await assert.rejects(writeCouncilApprovedPosts({}, '', { postPlan: [] }), { code: 'council_plan_invalid' });
    modelError = new Error('mock AI unavailable');
    await assert.rejects(write(), { code: 'council_generation_failed' });
    modelError = null;
    modelOutput = 'invalid JSON';
    await assert.rejects(write(), { code: 'council_generation_failed' });
    for (const posts of [
      [],
      [{ tweets: ['通常の投稿です。'] }],
      [{ tweets_en: ['A normal post.'] }],
      [{ tweets: ['通常の投稿です。'], tweets_en: [] }],
      [{ tweets: ['通常の投稿です。'], tweets_en: 'A normal post.' }]
    ]) {
      modelOutput = { posts };
      await assert.rejects(write(), { code: 'council_draft_incomplete' });
    }
    for (const invalidText of ['  ', 'Post:']) {
      modelOutput = { posts: [{ tweets: ['通常の投稿です。'], tweets_en: [invalidText] }] };
      await assert.rejects(write(), { code: 'post_constraint_ambiguous' });
    }
    modelOutput = { posts: [{ tweets: ['通常の投稿です。'], tweets_en: [null] }] };
    await assert.rejects(write(), { code: 'council_draft_incomplete' });
    modelOutput = { posts: [{ tweets: ['通常の投稿です。'], tweets_en: ['A normal post.'] }] };
    const result = await write();
    assert.deepEqual(result[0].tweets, ['通常の投稿です。']);
    assert.deepEqual(result[0].tweets_en, ['A normal post.']);
  } finally {
    modelError = null;
  }
});

test('market and account strategy failures do not produce invented fallbacks', async () => {
  const { analyzeMarketWithUserPrompt, generateAccountGrowthStrategy } = require('../src/autonomous_promo_ai');
  const page = { url: 'https://example.invalid' };
  const analysis = { serviceName: 'Test', targetAudience: 'Readers', userPainPoints: [], uniqueSellingPoints: [] };
  const market = () => analyzeMarketWithUserPrompt(page, '', {}, null);
  const strategy = () => generateAccountGrowthStrategy(analysis, '', page.url);
  try {
    modelError = new Error('mock AI unavailable');
    await assert.rejects(market(), /市場分析の生成に失敗/);
    await assert.rejects(strategy(), /アカウント戦略の生成に失敗/);
    modelError = null;
    for (const output of ['invalid JSON', {}]) {
      modelOutput = output;
      await assert.rejects(market(), /市場分析の生成に失敗/);
      await assert.rejects(strategy(), /アカウント戦略の生成に失敗/);
    }
    modelOutput = analysis;
    assert.equal((await market()).serviceName, 'Test');
    modelOutput = { optimizedBio: 'Test bio', pinnedPost: {} };
    assert.equal((await strategy()).optimizedBio, 'Test bio');
  } finally {
    modelError = null;
  }
});

test('council plan validates each plan tier and stops on generation failures', async () => {
  const { deliberateCouncilStrategy } = require('../src/autonomous_promo_ai');
  const analysis = { serviceName: 'Test', targetAudience: 'Readers', coreAppealAngle: 'Test' };
  const run = plan => deliberateCouncilStrategy(analysis, {}, '', {}, 'Asia/Tokyo', null, plan);
  try {
    for (const [plan, slots] of [
      ['starter', ['morning']],
      ['pro', ['morning', 'noon', 'evening']],
      ['business', ['morning', 'noon', 'afternoon', 'evening', 'night']]
    ]) {
      modelOutput = { deliberationRounds: {}, postPlan: slots.map((timeSlot, index) => ({
        step: index + 1, timeSlot, format: 'single', angle: 'Test'
      })) };
      const result = await run(plan);
      assert.deepEqual(result.postPlan.map(item => item.timeSlot), slots);
      assert.equal((lastModelPrompt.match(/"timeSlot":/g) || []).length, slots.length);
      assert.doesNotMatch(lastModelPrompt, /[\x00-\x08]/);
      assert.match(lastModelPrompt, /提供されていない実績、体験、数値/);
    }
    modelError = new Error('mock AI unavailable');
    await assert.rejects(run('business'), { code: 'council_plan_generation_failed' });
    modelError = null;
    modelOutput = 'invalid JSON';
    await assert.rejects(run('business'), { code: 'council_plan_generation_failed' });
    modelOutput = {};
    await assert.rejects(run('business'), { code: 'council_plan_invalid' });
  } finally {
    modelError = null;
  }
});

test('campaign startup stops when account settings cannot be read or the saved time zone is invalid', async () => {
  const { launchAutopilotCampaign } = require('../src/autonomous_promo_ai');
  const launch = () => launchAutopilotCampaign('user', 'https://example.invalid');
  try {
    userReadError = new Error('Firestore unavailable');
    await assert.rejects(launch(), /Firestore unavailable/);
    userReadError = null;
    userData = null;
    await assert.rejects(launch(), /ユーザー情報を確認できない/);
    userData = { scheduleTimeZone: 'Invalid/Zone' };
    await assert.rejects(launch(), /保存済み予約タイムゾーンが無効/);
  } finally {
    userReadError = null;
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4' };
  }
});

test('consent requires an explicit confirmation and can be withdrawn', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({
    post(path, handler) { routes.set(path, handler); },
    get() {}
  }, { runWorker: false });
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const grant = routes.get('/api/autopilot/consent');
  const revoke = routes.get('/api/autopilot/consent/revoke');
  userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', autopilotPaused: true };
  try {
    const invalid = response();
    await grant({ body: { accepted: false, version: 1 } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(userData.autopilotConsent, undefined);
    const accepted = response();
    await grant({ body: { accepted: true, version: 1 } }, accepted);
    assert.equal(accepted.body.ok, true);
    assert.equal(userData.autopilotConsent.account, 'username:veloxsystemsv4');
    assert.equal(userData.autopilotConsent.granted, true);
    assert.equal(userData.autopilotPaused, false);
    const withdrawn = response();
    await revoke({}, withdrawn);
    assert.equal(withdrawn.body.ok, true);
    assert.equal(userData.autopilotConsent.granted, false);
    assert.equal(userData.autopilotPaused, true);
  } finally {
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4' };
  }
});

test('posting stops before the X API and preserves explicitly manual posts', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) { routes.set(path, handler); },
    get() {}
  };
  registerHybridSaasRoutes(app, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/post-now');
  const req = { params: { jobId: 'job' } };
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  posted = [];
  job = { userId: 'user', status: 'pending', text: '会議は30時間続いた。', tweets: ['安全な別文'] };
  const blocked = response();
  await handler(req, blocked);
  assert.equal(blocked.statusCode, 500);
  assert.equal(blocked.body.ok, false);
  assert.match(blocked.body.error, /自動投稿を停止/);
  assert.equal(job.status, 'failed');
  assert.deepStrictEqual(posted, []);

  job = { userId: 'user', status: 'pending', text: '今日の確認場所を先に残すと、次の判断が同じ型で続く。見えた事実だけを残す。' };
  const normal = response();
  boostRegistrations = 0;
  await handler(req, normal);
  assert.equal(normal.body.ok, true);
  assert.deepStrictEqual(posted, ['今日の確認場所を先に残すと、次の判断が同じ型で続く。見えた事実だけを残す。']);
  assert.equal(boostRegistrations, 0);
  assert.equal(job.campaignId, '');

  posted = [];
  job = { userId: 'user', status: 'pending', text: '会議は30時間続いた。', isHumanOverride: true };
  const manual = response();
  await handler(req, manual);
  assert.equal(manual.body.ok, true);
  assert.deepStrictEqual(posted, ['会議は30時間続いた。']);

  posted = [];
  jitOverride = async () => { throw new Error('Manual posts must not trigger JIT'); };
  job = { userId: 'user', status: 'pending', text: '会議は30時間続いた。', isHumanOverride: true, isJitContent: true };
  const manualJitFlag = response();
  await handler(req, manualJitFlag);
  assert.equal(manualJitFlag.body.ok, true);
  assert.deepStrictEqual(posted, ['会議は30時間続いた。']);

  posted = [];
  jitOverride = async () => ({ text: '会議は30時間続いた。', tweets: ['会議は30時間続いた。'] });
  job = { userId: 'user', status: 'pending', text: 'placeholder', isJitContent: true };
  const generated = response();
  await handler(req, generated);
  assert.equal(generated.body.ok, false);
  assert.equal(job.status, 'failed');
  assert.deepStrictEqual(posted, []);
  jitOverride = null;

  const savedKey = process.env.XAI_API_KEY;
  try {
    delete process.env.XAI_API_KEY;
    job = { userId: 'user', status: 'pending', text: 'placeholder', isJitContent: true };
    const missingKey = response();
    await handler(req, missingKey);
    assert.equal(missingKey.body.ok, false);
    assert.equal(job.status, 'failed');
    assert.deepStrictEqual(posted, []);
  } finally {
    process.env.XAI_API_KEY = savedKey;
  }
});

test('English autopilot rejects missing or Japanese content while preserving manual posts', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/post-now');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const run = async fields => {
    job = { userId: 'user', status: 'pending', ...fields };
    const res = response();
    await handler({ params: { jobId: 'job' } }, res);
    return res;
  };
  try {
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', aiTargetLang: 'en' };
    posted = [];
    postedThread = null;
    for (const fields of [
      { text: '日本語の本文' },
      { text: '日本語の本文', text_en: 'English 日本語' },
      { text_en: 'First', tweets_en: ['First', '続き'] }
    ]) {
      const res = await run(fields);
      assert.equal(res.body.ok, false);
      assert.equal(job.status, 'failed');
      assert.deepEqual(posted, []);
      assert.equal(postedThread, null);
    }

    jitOverride = async () => ({ text: '日本語です', tweets: ['日本語です'] });
    const badJit = await run({ text: 'placeholder', isJitContent: true });
    assert.equal(badJit.body.ok, false);
    assert.equal(job.isJitGenerated, undefined);
    assert.deepEqual(posted, []);

    jitOverride = async () => {
      userData.aiTargetLang = 'ja';
      return { text: 'English post', tweets: ['English post'] };
    };
    const changed = await run({ text: 'placeholder', isJitContent: true });
    assert.equal(changed.body.ok, false);
    assert.match(changed.body.error, /投稿準備中に投稿言語が変更/);
    assert.deepEqual(posted, []);

    userData.aiTargetLang = 'en';
    const english = await run({ text: '日本語の本文', text_en: 'An English post keeps the next check in one place so the same decision can be repeated.' });
    assert.equal(english.body.ok, true);
    assert.deepEqual(posted, ['An English post keeps the next check in one place so the same decision can be repeated.']);
    const englishPrimary = await run({ lang: 'en', text: 'Another English post keeps one check in place and repeats the same decision tomorrow.' });
    assert.equal(englishPrimary.body.ok, true);
    jitOverride = async () => ({ text: 'Generated English post keeps the next check in one place for the same decision.', tweets: ['Generated English post keeps the next check in one place for the same decision.'] });
    const englishJit = await run({ text: 'placeholder', isJitContent: true });
    assert.equal(englishJit.body.ok, true);
    threadResult = { ok: true, isThread: true, tweetId: 'thread', tweetUrl: 'https://example.com/thread' };
    const englishThread = await run({ text: '日本語', tweets_en: ['English first sentence keeps the next check in one place for tomorrow.', 'English second sentence records the same check without adding a new claim.'] });
    assert.equal(englishThread.body.ok, true);
    assert.deepEqual(postedThread, ['English first sentence keeps the next check in one place for tomorrow.', 'English second sentence records the same check without adding a new claim.']);
    threadResult = null;
    postedThread = null;
    const manual = await run({ text: '手動の日本語', isHumanOverride: true });
    assert.equal(manual.body.ok, true);
    assert.deepEqual(posted, ['An English post keeps the next check in one place so the same decision can be repeated.', 'Another English post keeps one check in place and repeats the same decision tomorrow.', 'Generated English post keeps the next check in one place for the same decision.', '手動の日本語']);
  } finally {
    jitOverride = null;
    threadResult = null;
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4' };
  }
});

test('JIT posting fetches the target page and stops if it or the user instruction changes', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/post-now');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const run = async () => {
    job = { userId: 'user', status: 'pending', text: 'placeholder', isJitContent: true };
    const res = response();
    await handler({ params: { jobId: 'job' } }, res);
    return res;
  };
  try {
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', targetUrl: 'https://example.invalid', userPrompt: 'Use a friendly tone' };
    posted = [];
    let received;
    jitOverride = async input => {
      received = input;
      return { text: '今日の確認場所を先に残すと、次の判断が同じ型で続く。見えた事実だけを残す。', tweets: ['今日の確認場所を先に残すと、次の判断が同じ型で続く。見えた事実だけを残す。'] };
    };
    assert.equal((await run()).body.ok, true);
    assert.equal(received.targetUrl, userData.targetUrl);
    assert.equal(received.pageSummary.title, 'Example service');
    assert.equal(received.userPrompt, 'Use a friendly tone');

    posted = [];
    pageResult = { ok: false, error: 'HTTP 404' };
    pageCalls = 0;
    assert.equal((await run()).body.ok, false);
    assert.deepEqual(posted, []);
    assert.equal(pageCalls, 1);
    pageResult = { ok: true, title: 'Example service', description: 'Useful product', headings: [], snippet: '' };
    pageResults = [{ ok: false, error: 'HTTP 503' }, pageResult];
    pageCalls = 0;
    assert.equal((await run()).body.ok, true);
    assert.equal(pageCalls, 2);
    posted = [];
    jitOverride = async () => {
      userData.userPrompt = 'Changed while generating';
      return { text: '今日の確認場所を先に残すと、次の判断が同じ型で続く。見えた事実だけを残す。', tweets: ['今日の確認場所を先に残すと、次の判断が同じ型で続く。見えた事実だけを残す。'] };
    };
    assert.match((await run()).body.error, /宣伝先または指示が変更/);
    assert.deepEqual(posted, []);
  } finally {
    jitOverride = null;
    pageResults = [];
    pageResult = { ok: true, title: 'Example service', description: 'Useful product', headings: [], snippet: '' };
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', targetUrl: 'https://example.invalid' };
  }
});

test('JIT uses the matching strategy and adds only the configured PR link to promotion posts', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/post-now');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const targetUrl = 'https://example.invalid/offer?ref=123';
  let received;
  try {
    userData = {
      xOfficialCredentials: 'mock', xUsername: 'owner', targetUrl, userPrompt: 'Be helpful',
      latestMarketingStrategy: {
        targetUrl, userPrompt: 'Be helpful',
        accountDiagnosis: { username: 'owner', hasOfficialData: true, followersMeasured: true, followers: 600, stage: 'STAGE_2_AUTHORITY_ENGAGEMENT', stageName: 'early' },
        marketAnalysis: { targetAudience: 'beginners' },
        accountGrowth: { weeklyGrowthRoadmap: [{ phase: 'Week 1', focus: 'Earn trust' }] }
      }
    };
    affiliateItems = [{ date: '2026-11-14', clicks: 4, conversions: 1 }];
    threadResult = { ok: true, tweetId: 'thread', tweetUrl: 'https://example.invalid/thread' };
    jitOverride = async input => {
      received = input;
      return { text: 'Helpful advice stays with the next check so the same decision can be repeated tomorrow.', tweets: ['Helpful advice stays with the next check so the same decision can be repeated tomorrow.'] };
    };
    job = { userId: 'user', status: 'pending', isJitContent: true, isPromotion: true };
    let res = response();
    await handler({ params: { jobId: 'job' } }, res);
    assert.equal(res.body.ok, true);
    assert.equal(received.accountContext.followers, 600);
    assert.equal(received.accountContext.targetAudience, 'beginners');
    assert.deepEqual(received.affiliateResults, affiliateItems);
    assert.deepEqual(postedThread, ['【PR】Helpful advice stays with the next check so the same decision can be repeated tomorrow.', `【PR】詳細はこちら: ${targetUrl}`]);
    assert.deepEqual(job.tweets, postedThread);

    userData.latestMarketingStrategy.targetUrl = 'https://other.invalid';
    job = { userId: 'user', status: 'pending', isJitContent: true, isPromotion: false };
    posted = [];
    res = response();
    await handler({ params: { jobId: 'job' } }, res);
    assert.equal(res.body.ok, true);
    assert.equal(received.accountContext, null);
    assert.deepEqual(posted, ['Helpful advice stays with the next check so the same decision can be repeated tomorrow.']);

    jitOverride = async () => ({ text: 'Visit https://wrong.invalid', tweets: ['Visit https://wrong.invalid'] });
    job = { userId: 'user', status: 'pending', isJitContent: true, isPromotion: true };
    postedThread = null;
    res = response();
    await handler({ params: { jobId: 'job' } }, res);
    assert.equal(res.body.ok, false);
    assert.equal(postedThread, null);

    userData.targetUrl = `${targetUrl},https://second.invalid/offer`;
    userData.latestMarketingStrategy = {
      targetUrl: userData.targetUrl, userPrompt: 'Be helpful',
      accountDiagnosis: { username: 'owner', hasOfficialData: true, followersMeasured: true, followers: 600, stage: 'STAGE_2_AUTHORITY_ENGAGEMENT' },
      marketAnalysis: { targetAudience: 'beginners' }
    };
    jitOverride = async () => ({ text: 'Helpful advice stays with the next check so the same decision can be repeated tomorrow.', tweets: ['Helpful advice stays with the next check so the same decision can be repeated tomorrow.'] });
    job = { userId: 'user', status: 'pending', isJitContent: true, isPromotion: true };
    res = response();
    await handler({ params: { jobId: 'job' } }, res);
    assert.equal(res.body.ok, true);
    assert.equal(postedThread[1], `【PR】詳細はこちら: ${targetUrl}`);

    jitOverride = async () => {
      userData.latestMarketingStrategy.marketAnalysis.targetAudience = 'changed';
      return { text: 'Helpful advice stays with the next check so the same decision can be repeated tomorrow.', tweets: ['Helpful advice stays with the next check so the same decision can be repeated tomorrow.'] };
    };
    job = { userId: 'user', status: 'pending', isJitContent: true, isPromotion: true };
    postedThread = null;
    res = response();
    await handler({ params: { jobId: 'job' } }, res);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /アカウント戦略が変更/);
    assert.equal(postedThread, null);
  } finally {
    affiliateItems = [];
    jitOverride = null;
    threadResult = null;
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', targetUrl: 'https://example.invalid' };
  }
});

test('trust-building and unknown phases never send promotional or URL-bearing automatic posts', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ post: (path, handler) => routes.set(path, handler), get() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/post-now');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    for (const phase of ['trust', 'unknown']) {
      userData = {
        xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', targetUrl: 'https://example.invalid',
        xUsername: 'owner', ...(phase === 'trust' ? { trustBuildingAccounts: ['owner'] } : {})
      };
      let received;
      jitOverride = async input => {
        received = input;
        return { text: 'Helpful advice stays with the next check so the same decision can be repeated tomorrow.', tweets: ['Helpful advice stays with the next check so the same decision can be repeated tomorrow.'] };
      };
      job = { userId: 'user', status: 'pending', isJitContent: true, isPromotion: true };
      posted = [];
      postedThread = null;
      let res = response();
      await handler({ params: { jobId: 'job' } }, res);
      assert.equal(res.body.ok, true);
      assert.equal(received.isPromotion, false);
      assert.equal(received.growthPhase, phase);
      assert.deepEqual(posted, ['Helpful advice stays with the next check so the same decision can be repeated tomorrow.']);
      assert.equal(postedThread, null);
      assert.equal(job.isPromotion, false);

      for (const text of ['Visit https://example.com', 'Visit example.com']) {
        jitOverride = async () => ({ text, tweets: [text] });
        job = { userId: 'user', status: 'pending', isJitContent: true };
        posted = [];
        res = response();
        await handler({ params: { jobId: 'job' } }, res);
        assert.equal(res.body.ok, false);
        assert.deepEqual(posted, []);
      }
      job = { userId: 'user', status: 'pending', isPromotion: true, text: 'A previously prepared promotion.' };
      res = response();
      await handler({ params: { jobId: 'job' } }, res);
      assert.equal(res.body.ok, false);
    }
  } finally {
    jitOverride = null;
    userData = { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', targetUrl: 'https://example.invalid' };
  }
});

test('concurrent manual post and cancellation cannot take a processing job', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({
    post(path, handler) { routes.set(path, handler); },
    get() {}
  }, { runWorker: false });
  const postNow = routes.get('/api/autopilot/jobs/:jobId/post-now');
  const cancel = routes.get('/api/autopilot/jobs/:jobId/cancel');
  const req = { params: { jobId: 'job' } };
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  let releasePost;
  postGate = new Promise(resolve => { releasePost = resolve; });
  posted = [];
  job = { userId: 'user', status: 'pending', text: '今日の確認場所を先に残すと、次の判断が同じ型で続く。見えた事実だけを残す。' };
  const first = response();
  try {
    const firstPost = postNow(req, first);
    for (let spin = 0; spin < 40 && posted.length === 0; spin += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    const second = response();
    const cancellation = response();
    await postNow(req, second);
    await cancel(req, cancellation);
    assert.equal(second.statusCode, 409);
    assert.equal(cancellation.statusCode, 409);
    assert.equal(job.status, 'processing');
    assert.equal(posted.length, 1);
    releasePost();
    await firstPost;
    assert.equal(first.body.ok, true);
    assert.equal(job.status, 'posted');

    job = { userId: 'user', status: 'failed', text: '結果不明の投稿' };
    const failedRetry = response();
    await postNow(req, failedRetry);
    assert.equal(failedRetry.statusCode, 409);
    assert.equal(posted.length, 1);
    const failedCancel = response();
    await cancel(req, failedCancel);
    assert.equal(failedCancel.body.ok, true);
    assert.equal(job, null);
  } finally {
    releasePost();
    postGate = null;
  }
});

test('JIT save failure stops posting and partial thread failure records posted IDs', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({
    post(path, handler) { routes.set(path, handler); },
    get() {}
  }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs/:jobId/post-now');
  const req = { params: { jobId: 'job' } };
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    posted = [];
    failJitSave = true;
    jitOverride = async () => ({ text: '通常の投稿です。', tweets: ['通常の投稿です。'] });
    job = { userId: 'user', status: 'pending', text: 'placeholder', isJitContent: true };
    const jitFailure = response();
    await handler(req, jitFailure);
    assert.equal(jitFailure.body.ok, false);
    assert.equal(job.status, 'failed');
    assert.deepEqual(posted, []);

    failJitSave = false;
    jitOverride = async () => ({ text: '' });
    job = { userId: 'user', status: 'pending', text: 'placeholder', isJitContent: true };
    const emptyJit = response();
    await handler(req, emptyJit);
    assert.equal(emptyJit.body.ok, false);
    assert.match(emptyJit.body.error, /JIT投稿本文/);
    assert.deepEqual(posted, []);

    threadResult = {
      ok: false,
      error: 'second post failed',
      partialResults: [{ tweetId: 'first-post', tweetUrl: 'https://x.com/i/status/first-post' }]
    };
    job = { userId: 'user', status: 'pending', text: 'First', tweets: ['First', 'Second'], isHumanOverride: true };
    const threadFailure = response();
    await handler(req, threadFailure);
    assert.equal(threadFailure.body.ok, false);
    assert.deepEqual(job.partialTweets, [{ tweetId: 'first-post', tweetUrl: 'https://x.com/i/status/first-post' }]);

    threadResult = null;
    failPostedUpdate = true;
    job = { userId: 'user', status: 'pending', text: '通常の投稿です。', isHumanOverride: true };
    const resultSaveFailure = response();
    await handler(req, resultSaveFailure);
    assert.equal(resultSaveFailure.body.ok, false);
    assert.match(resultSaveFailure.body.error, /投稿成功/);
    assert.equal(job.status, 'failed');
    assert.equal(job.tweetId, 'mock');
    assert.equal(job.tweetUrl, 'https://example.com/mock');
    assert.deepEqual(job.postConfirmation, { type: 'single_post_api_success', tweetId: 'mock' });

    threadResult = { ok: true, isThread: true, tweetId: 'thread-root', tweetUrl: 'https://example.com/thread' };
    job = { userId: 'user', status: 'pending', text: 'First', tweets: ['First', 'Second'], isHumanOverride: true };
    const threadSaveFailure = response();
    await handler(req, threadSaveFailure);
    assert.equal(job.status, 'failed');
    assert.equal(job.tweetId, 'thread-root');
    assert.equal(job.postConfirmation, undefined);
  } finally {
    failJitSave = false;
    failPostedUpdate = false;
    jitOverride = null;
    threadResult = null;
  }
});
