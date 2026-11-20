'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function stub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

function memoryDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (key) => ({
    async get() {
      return { exists: docs.has(key), data: () => docs.get(key) };
    },
    async set(data, opts) {
      docs.set(key, opts && opts.merge ? { ...(docs.get(key) || {}), ...data } : data);
    }
  });
  return {
    docs,
    collection(name) {
      return {
        doc(id) { return ref(`${name}/${id}`); },
        where() { return this; },
        limit() { return this; },
        async get() { return { docs: [], empty: true }; }
      };
    }
  };
}

test('completeWriter floors Anthropic max_tokens at 3200', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const seen = [];
  const { completeWriter } = require('../src/llm_router');
  const fetchImpl = async (_url, options) => {
    seen.push(JSON.parse(options.body).max_tokens);
    return { ok: true, text: async () => JSON.stringify({ content: [{ type: 'tool_use', input: { ok: true } }] }) };
  };
  try {
    await completeWriter({ maxTokens: 600, fetchImpl, timeoutMs: 5000 });
    await completeWriter({ maxTokens: 1600, fetchImpl, timeoutMs: 5000 });
    assert.deepEqual(seen, [3200, 3200]);
  } finally {
    if (previous) process.env.ANTHROPIC_API_KEY = previous;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('a pin that drops the registered URL falls back to the paid playbook sentence', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const restore = stub('../src/llm_router', {
    async completeWriter() {
      return {
        ok: true,
        provider: 'anthropic',
        parsed: {
          currentBioReview: '固定文に住所がありません。',
          displayName: '確認メモ',
          bio: '確認手順を残します。 https://veloxpostapp.com',
          pin: 'ページを先に開く、という説明だけで終えています。',
          pinNote: 'モデル案は住所が落ちたので使いません。'
        }
      };
    }
  });
  const profilePath = require.resolve('../src/profile_checklist');
  delete require.cache[profilePath];
  try {
    const { buildAiProfileChecklist } = require('../src/profile_checklist');
    const criteria = '登録したページの住所が文末まで残っているかを送信前に見ます'.repeat(12);
    const checklist = await buildAiProfileChecklist({
      planId: 'pro',
      planStatus: 'active',
      aiTargetLang: 'ja',
      targetUrl: 'https://veloxpostapp.com',
      brandKnowledge: {
        domainPlaybooks: [{
          id: 'pb_url',
          topic: 'URLの残し方',
          readerSituation: 'ページがあるのに固定文から住所が落ちる。',
          commonMistake: '説明だけで終える。',
          concreteTradeoff: '短い文は読みやすいが住所が消える。',
          checkCriteria: criteria,
          boundaryCondition: 'ページが無いときは住所を足さない。'
        }]
      }
    }, 'ja', {});
    assert.equal(checklist.pin.includes('https://veloxpostapp.com'), true);
    assert.equal(checklist.focusPlaybookId, 'pb_url');
    assert.ok(checklist.pin.length > 280);
  } finally {
    restore();
    delete require.cache[profilePath];
    if (previous) process.env.ANTHROPIC_API_KEY = previous;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('one monthly counter rolls over and degrades instead of throwing', async () => {
  const { checkTenantAiBudget, recordTenantAiUsage, degradedPostText } = require('../src/tenant_ai_budget');
  const db = memoryDb({
    'saas_users/owner': {
      planId: 'starter',
      planStatus: 'active',
      aiMonthlyUsage: { monthKey: '2026-10', llmCalls: 999, writerCalls: 10, criticCalls: 1, crawlPages: 40 }
    }
  });
  const rolled = await checkTenantAiBudget({ db, userId: 'owner', kind: 'llm', now: new Date('2026-11-20T00:00:00Z') });
  assert.equal(rolled.allowed, true);
  assert.equal(rolled.used, 0);
  await recordTenantAiUsage({ db, userId: 'owner', kind: 'llm', role: 'writer', count: 1, now: new Date('2026-11-20T00:00:00Z') });
  await recordTenantAiUsage({ db, userId: 'owner', kind: 'crawl', count: 2, now: new Date('2026-11-20T00:00:00Z') });
  const stored = db.docs.get('saas_users/owner').aiMonthlyUsage;
  assert.equal(stored.llmCalls, 1);
  assert.equal(stored.crawlPages, 2);
  assert.equal(stored.monthKey, '2026-11');
  const exhausted = await checkTenantAiBudget({
    db,
    userId: 'owner',
    user: { planId: 'free', aiMonthlyUsage: { monthKey: '2026-11', llmCalls: 20, crawlPages: 0 } },
    kind: 'llm',
    now: new Date('2026-11-20T00:00:00Z')
  });
  assert.equal(exhausted.degraded, true);
  const text = degradedPostText({ readerSituation: '確認場所が先に要る。', checkCriteria: 'ページの文と照合する。', boundaryCondition: 'ページが無ければ足さない。' });
  assert.equal(text.includes('確認場所'), true);
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let called = 0;
  const restore = stub('../src/llm_router', { async completeWriter() { called += 1; return { parsed: null, text: '{}' }; } });
  const profilePath = require.resolve('../src/profile_checklist');
  delete require.cache[profilePath];
  try {
    const { buildAiProfileChecklist } = require('../src/profile_checklist');
    const checklist = await buildAiProfileChecklist({
      aiTargetLang: 'ja',
      targetUrl: 'https://veloxpostapp.com',
      brandKnowledge: { domainPlaybooks: [{ id: 'pb_1', topic: '確認', checkCriteria: 'ページの文と照合する。' }] }
    }, 'ja', { budgetDegraded: true });
    assert.equal(checklist.budgetDegraded, true);
    assert.equal(called, 0);
    assert.equal(checklist.pin.includes('https://veloxpostapp.com'), true);
  } finally {
    restore();
    delete require.cache[profilePath];
    if (previous) process.env.ANTHROPIC_API_KEY = previous;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('manual draft replies return 429 in Japanese and English when the month is full', async () => {
  const docs = new Map();
  function docRef(key) {
    return {
      async get() { return { exists: docs.has(key), data: () => docs.get(key) }; },
      async set(data, opts) { docs.set(key, opts && opts.merge ? { ...(docs.get(key) || {}), ...data } : data); },
      collection(name) { return { doc(id) { return docRef(`${key}/${name}/${id}`); } }; }
    };
  }
  stub('../src/firestore', { db: { collection(name) { return { doc(id) { return docRef(`${name}/${id}`); } }; } } });
  stub('../src/auth_service', { resolveSessionUser: async (_db, req) => req.sessionUser || null });
  const routesPath = require.resolve('../src/hybrid_saas_routes');
  delete require.cache[routesPath];
  const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
  const routes = { post: new Map(), get: new Map() };
  registerHybridSaasRoutes({
    post(path, handler) { routes.post.set(path, handler); },
    get(path, handler) { routes.get.set(path, handler); }
  }, { runWorker: false });
  docs.set('saas_users/owner', { aiMonthlyUsage: { monthKey: new Date().toISOString().slice(0, 7), llmCalls: 20, crawlPages: 0 } });
  docs.set('saas_users/owner/inbound_mentions/m1', { text: 'Where should I check this?', authorId: '222' });
  async function call(uiLang) {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.post.get('/api/autopilot/mentions/:tweetId/draft-replies')({
      params: { tweetId: 'm1' },
      sessionUser: { userId: 'owner' },
      body: { uiLang },
      headers: {},
      query: {}
    }, res);
    return res;
  }
  const en = await call('en');
  const ja = await call('ja');
  assert.equal(en.statusCode, 429);
  assert.match(en.body.error, /next month/);
  assert.equal(ja.statusCode, 429);
  assert.match(ja.body.error, /来月/);
});

test('homepage showcase serves cached samples and a PNG without a live model call', async () => {
  let reads = 0;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  stub('../src/firestore', {
    db: {
      collection(name) {
        return {
          doc() {
            return { async get() { reads += 1; return { exists: true, data: () => ({ brandKnowledge: { schemaVersion: 3, outputLang: 'ja', verifiedClaims: [], verifiedPricing: ['¥9,800 / month'], verifiedConstraints: ['14-day trial'], domainPlaybooks: [{ topic: '確認', checkCriteria: 'ページの文と照合する。' }] } }) }; } };
          },
          where() { return this; },
          limit() { return this; },
          async get() { return { docs: [{ data: () => ({ text: '登録ページの確認場所だけを残します。', visualCard: { eligible: true, template: 'editorial_split', title: '確認' } }) }] }; }
        };
      }
    }
  });
  let liveCalls = 0;
  stub('../src/lp_knowledge_extractor', { extractBrandKnowledge() { liveCalls += 1; throw new Error('live extract'); } });
  stub('../src/next_post_draft', { draftNextPostText() { liveCalls += 1; throw new Error('live draft'); } });
  stub('../src/visual_card', { planVisualCard: () => ({ eligible: true, template: 'editorial_split' }), renderVisualCardPng: async () => png });
  const funnelPath = require.resolve('../src/luxury_web_funnel');
  delete require.cache[funnelPath];
  const { attachLuxuryWebFunnel } = require('../src/luxury_web_funnel');
  const routes = { get: new Map(), post: new Map() };
  const app = {
    use() {},
    all() {},
    get(path, handler) { if (typeof handler === 'function') routes.get.set(path, handler); },
    post(path, handler) { routes.post.set(path, handler); }
  };
  attachLuxuryWebFunnel(app, {});
  const showcase = routes.get.get('/api/funnel/sample-showcase');
  const card = routes.get.get('/api/funnel/sample-card.png');
  const legacy = routes.post.get('/api/funnel/free-experience');
  const res = { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; }, send(body) { this.body = body; return this; }, end() { return this; } };
  await showcase({ query: { lang: 'ja' } }, res);
  assert.equal(res.body.cachedSample, true);
  assert.equal(res.body.preview.visualCardUrl, '/api/funnel/sample-card.png?lang=ja');
  const again = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await legacy({ body: { lang: 'en' } }, again);
  assert.equal(again.body.cachedSample, true);
  assert.equal(liveCalls, 0);
  const image = { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, send(body) { this.body = body; return this; }, end() { return this; } };
  await card({ query: { lang: 'ja' } }, image);
  assert.equal(image.statusCode, 200);
  assert.equal(image.headers['Content-Type'], 'image/png');
  assert.equal(image.body[0], 0x89);
  assert.ok(reads >= 1);
});
