'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function stub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

test('showcase picks the newest language-valid post and its playbook', () => {
  const { selectShowcaseJob, extractShowcaseTweets } = require('../src/luxury_web_funnel');
  const ancientJa = { status: 'posted', scheduledAt: '2026-11-13T00:00:00Z', text: 'VELOX AIX投稿の企画・作成・予約を、ひとつに。', focusPlaybookId: 'pb_old' };
  const currentJa = {
    status: 'pending',
    scheduledAt: '2026-11-20T03:34:00Z',
    focusPlaybookId: 'pb_3',
    text: '毎回少しずつ宣伝を混ぜれば、読者は慣れていく。その前に、宣伝と確認を同じ文へ重ねていないかを見ます。ページに無い数値は残しません。登録ページの案内と照合してから予約へ入れます。',
    visualCard: { eligible: true, title: '文体と宣伝', leftLabel: '前提', leftText: '宣伝を先に足す', rightLabel: '確認', rightText: '確認を先に残す', footerCheck: 'ページ外は使わない', badge: 'VELOX' }
  };
  const selectedJa = selectShowcaseJob([ancientJa, currentJa], 'ja');
  assert.equal(selectedJa.row.focusPlaybookId, 'pb_3');
  assert.ok(selectedJa.tweets.join('').length >= 80);
  assert.equal(extractShowcaseTweets(ancientJa, 'ja'), null);

  const japaneseEnglishField = { status: 'posted', scheduledAt: '2026-11-19T00:00:00Z', text_en: '朝の投稿準備で止まる問題を解消するX運用の仕組みです。登録ページの確認を先に残します。', focusPlaybookId: 'pb_1' };
  const currentEn = {
    status: 'pending',
    scheduledAt: '2026-11-20T03:31:00Z',
    focusPlaybookId: 'pb_3',
    text_en: 'The safest automation boundary is whose account the action lands on. Keep the next post on the account the owner already connected, and leave other accounts untouched.',
    visualCard: { eligible: true, title: 'Account boundary', leftLabel: 'Assumption', leftText: 'Any connected account', rightLabel: 'Check', rightText: 'Only the owner account', footerCheck: 'Stop when the account is unclear', badge: 'VELOX' }
  };
  const selectedEn = selectShowcaseJob([japaneseEnglishField, currentEn], 'en');
  assert.equal(selectedEn.row.focusPlaybookId, 'pb_3');
  assert.equal(/[\u3040-\u30ff\u4e00-\u9fff]/.test(selectedEn.tweets.join('')), false);
  assert.ok(selectedEn.tweets.join('').length >= 80);
});

test('a failed profile checklist call does not spend monthly allowance', async () => {
  const docs = new Map();
  function docRef(key) {
    return {
      async get() { return { exists: docs.has(key), data: () => docs.get(key) }; },
      async set(data, opts) { docs.set(key, opts && opts.merge ? { ...(docs.get(key) || {}), ...data } : data); },
      collection() { return query(); }
    };
  }
  function query(name) {
    const api = {
      where() { return api; },
      limit() { return api; },
      doc(id) { return docRef(`${name}/${id}`); },
      async get() { return { docs: [], empty: true }; }
    };
    return api;
  }
  const restoreDb = stub('../src/firestore', { db: { collection(name) { return query(name); } } });
  const restoreAuth = stub('../src/auth_service', { resolveSessionUser: async (_db, req) => req.sessionUser || null });
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const restoreRouter = stub('../src/llm_router', { async completeWriter() { throw new Error('writer_down'); } });
  const restoreGrok = stub('../src/grok_client', { hasXaiKey: () => false, async completeJson() { throw new Error('no_grok'); } });
  const routesPath = require.resolve('../src/hybrid_saas_routes');
  delete require.cache[routesPath];
  const profilePath = require.resolve('../src/profile_checklist');
  delete require.cache[profilePath];
  try {
    const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
    const routes = { post: new Map(), get: new Map() };
    registerHybridSaasRoutes({
      post(path, handler) { routes.post.set(path, handler); },
      get(path, handler) { routes.get.set(path, handler); }
    }, { runWorker: false });
    docs.set('saas_users/owner', {
      aiMonthlyUsage: { monthKey: new Date().toISOString().slice(0, 7), llmCalls: 4, writerCalls: 4, criticCalls: 0, crawlPages: 0 },
      brandKnowledge: { schemaVersion: 3, domainPlaybooks: [] },
      targetUrl: 'https://veloxpostapp.com'
    });
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.post.get('/api/autopilot/profile-checklist')({
      sessionUser: { userId: 'owner' },
      body: { uiLang: 'ja' },
      headers: {},
      query: {}
    }, res);
    assert.equal(res.body.ok, true);
    assert.equal(docs.get('saas_users/owner').aiMonthlyUsage.llmCalls, 4);
  } finally {
    restoreGrok();
    restoreRouter();
    restoreAuth();
    restoreDb();
    delete require.cache[routesPath];
    delete require.cache[profilePath];
    if (previous) process.env.ANTHROPIC_API_KEY = previous;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('a degraded draft must pass audit before it can replace a pending job', () => {
  const { degradedPostText, reviewDegradedDraft } = require('../src/tenant_ai_budget');
  const text = degradedPostText({
    topic: '登録ページとの照合',
    readerSituation: '投稿案を予約へ入れる直前で、ページに無い体験を足したくなります。',
    checkCriteria: '各文が登録ページの案内と同じかを見ます。',
    boundaryCondition: 'ページに無い数値は残しません。'
  }, { lang: 'ja', maxChars: 280 });
  const review = reviewDegradedDraft(text, {
    lang: 'ja',
    accountState: { postShape: 'single', singleOnly: true, maxChars: 280, lang: 'ja' }
  });
  assert.equal(review.ok, true, (review.reasons || []).join(','));
  const rejected = reviewDegradedDraft('短い', {
    lang: 'ja',
    accountState: { postShape: 'single', singleOnly: true, maxChars: 280, lang: 'ja' }
  });
  assert.equal(rejected.ok, false);
  const promo = fs.readFileSync(path.join(__dirname, '../src/autonomous_promo_ai.js'), 'utf8');
  const gate = promo.indexOf('budget_degraded_audit_failed');
  const write = promo.indexOf('pending[0].ref.update');
  assert.ok(gate > 0 && gate < write);
});

test('showcase pills and the allowance line exist in both languages', () => {
  const funnel = fs.readFileSync(path.join(__dirname, '../views/funnel_index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  assert.match(funnel, /id="samplePillJa"[^>]*data-i18n="demo_pill_ja"/);
  assert.match(funnel, /id="samplePillEn"[^>]*data-i18n="demo_pill_en"/);
  assert.equal((funnel.match(/demo_pill_ja:/g) || []).length, 2);
  assert.equal((funnel.match(/demo_pill_en:/g) || []).length, 2);
  assert.match(funnel, /Japanese Sample \(@VeloxSystemsV4\)/);
  assert.match(funnel, /英語見本 \(@VeloxSystemsHQ\)/);
  assert.match(dashboard, /id="aiMonthlyUsageLine"/);
  assert.match(dashboard, /Monthly AI allowance:/);
  assert.match(dashboard, /今月のAI利用枠:/);
  assert.match(dashboard, /checkIsEn\(\)/);
});
