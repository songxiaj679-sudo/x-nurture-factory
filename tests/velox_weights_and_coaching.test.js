'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  computeGuidanceWeights,
  decideEditorialPlan,
  recordSharedOutcomeSignals
} = require('../src/editorial_lexicon_engine');
const { buildOperatingSummary, buildAdvisoryCoaching, summarizePostedMeasurements } = require('../src/growth_phase');

const sharedLexicon = {
  cognitiveMoves: {
    mechanism_translation: { winScore: 3, sampleCount: 20 },
    inversion_contrast: { winScore: 0.2, sampleCount: 20 },
    constraint_boundary: { winScore: 0.2, sampleCount: 1 },
    practitioner_rule: { winScore: 0.2, sampleCount: 1 },
    micro_observation: { winScore: 0.2, sampleCount: 1 }
  },
  endingMoves: {
    verdict_cut: { winScore: 1, sampleCount: 1 },
    condition_edge: { winScore: 1, sampleCount: 1 },
    concrete_check: { winScore: 1, sampleCount: 1 },
    genuine_tension: { winScore: 1, sampleCount: 1 }
  },
  styleAntiPatterns: []
};

test('guidance weights move from observation to a locked lead', () => {
  assert.deepEqual(computeGuidanceWeights({ matureCount: 0 }), { phase: 'observe', userWeight: 80, veloxWeight: 20 });
  assert.deepEqual(computeGuidanceWeights({ matureCount: 5 }), { phase: 'calibrate', userWeight: 60, veloxWeight: 40 });
  assert.deepEqual(computeGuidanceWeights({ matureCount: 15 }), { phase: 'lead', userWeight: 35, veloxWeight: 65 });
  assert.deepEqual(computeGuidanceWeights({ matureCount: 15, strategyLocked: true }), { phase: 'lead_locked', userWeight: 50, veloxWeight: 50 });
});

test('editorial plan follows shared scores before the account has its own sample', () => {
  const base = {
    accountState: { lang: 'ja' },
    recentPosts: [],
    genes: {},
    portfolioPlan: {},
    domainLexicon: { moveScores: { inversion_contrast: 10, mechanism_translation: 0 } },
    sharedLexicon
  };
  assert.equal(decideEditorialPlan({ ...base, matureCount: 0 }).cognitiveMove, 'mechanism_translation');
  const mature = decideEditorialPlan({ ...base, matureCount: 15 });
  assert.equal(mature.cognitiveMove, 'inversion_contrast');
  assert.equal(mature.weights.veloxWeight, 65);
  assert.equal(mature.guidanceMode, 'lead');
});

test('shared outcome signals keep only anonymous counts and dedupe keys', async () => {
  const docs = new Map();
  const targetDb = {
    collection(name) {
      assert.equal(name, 'collective_intelligence');
      return {
        doc(id) {
          return {
            async get() {
              return { exists: docs.has(id), data: () => docs.get(id) };
            },
            async set(data, options) {
              const prev = options && options.merge ? (docs.get(id) || {}) : {};
              docs.set(id, { ...prev, ...data });
            }
          };
        }
      };
    }
  };
  const outcome = {
    signalKey: 'abc123def456',
    cognitiveMove: 'mechanism_translation',
    endingMove: 'verdict_cut',
    lang: 'ja',
    beatBaseline: true,
    text: '秘密の本文 https://secret.example/@handle',
    userId: 'WEB-GOOGLE-RAW'
  };
  const first = await recordSharedOutcomeSignals({ outcomes: [outcome, outcome], userIdHash: 'abc123def4567890' }, targetDb);
  const second = await recordSharedOutcomeSignals({ outcomes: [outcome], userIdHash: 'abc123def4567890' }, targetDb);
  const stored = docs.get('editorial_lexicon_v1');
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.equal(stored.cognitiveMoves.mechanism_translation.sampleCount, 1);
  assert.equal(stored.totalOutcomeSamples, 1);
  assert.deepEqual(stored.accountHashes, ['abc123def4567890']);
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes('秘密の本文'), false);
  assert.equal(serialized.includes('secret.example'), false);
  assert.equal(serialized.includes('@handle'), false);
  assert.equal(serialized.includes('WEB-GOOGLE-RAW'), false);
});

test('coaching stays in customer language and keeps the operating summary contract', () => {
  const ja = buildAdvisoryCoaching({
    user: { userPrompt: '現場で繰り返す確認を1行で書く', targetUrl: '', brandContextNotes: '' },
    matureCount: 0,
    nextJob: { draftBriefSummary: { cognitiveMove: 'mechanism_translation', endingMove: 'verdict_cut' } },
    sharedLexicon: { totalOutcomeSamples: 4 },
    uiLang: 'ja'
  });
  assert.equal(ja.suggestedPromptAddition, '');
  assert.equal(ja.guidanceBalance.includes('.'), false);
  assert.equal(ja.guidanceBalance.includes('運用バランス'), false);
  assert.equal(JSON.stringify(ja).includes('mechanism_translation'), false);
  assert.equal(ja.guidanceBalance, '立ち上げ観測期（お客様の方針 80% ／ VELOX基本設計 20%）');
  assert.equal(ja.nextMovePreview, '次回は「仕組みを日常のイメージに落とす型」と「核心を言い切る締め」で検証します');
  assert.equal(/型の型|締めの締め/.test(ja.nextMovePreview), false);
  assert.match(ja.advisoryNote, /現場メモが未入力のため/);
  assert.equal(ja.advisoryNote.includes('空なら'), false);
  const en = buildAdvisoryCoaching({
    user: { userPrompt: '別の方針', targetUrl: 'https://example.com', brandContextNotes: '現場メモ' },
    matureCount: 15,
    domainLexicon: { winningExpressions: ['確認場所を先に残す'], retiredPhrases: ['言い換え'] },
    dpoPairs: [{ winner: { whyWon: '保存が残った対比' } }],
    uiLang: 'en'
  });
  assert.equal(en.guidanceBalance, 'Leading phase (Your direction 35% / VELOX baseline 65%)');
  assert.equal(en.guidanceBalance.includes('Control balance'), false);
  assert.equal(en.suggestedPromptAddition, 'Keep the next post on the measured contrast');
  assert.equal(en.advisoryNote.includes('Next, steer'), false);
  assert.match(en.advisoryNote, /VELOX AI automatically leans into "保存が残った対比"/);
  assert.match(en.advisoryNote, /avoiding "言い換え"/);
  const matureJa = buildAdvisoryCoaching({
    user: { userPrompt: '別の方針', targetUrl: 'https://example.com', brandContextNotes: '現場メモ' },
    matureCount: 15,
    domainLexicon: { winningExpressions: ['確認場所を先に残す'], retiredPhrases: ['言い換え'] },
    dpoPairs: [{ winner: { whyWon: '保存が残った対比' } }],
    uiLang: 'ja'
  });
  assert.equal(matureJa.suggestedPromptAddition, '実測で残った対比を次の1本の軸にする');
  assert.equal(matureJa.advisoryNote.includes('次はこう舵を切ります'), false);
  assert.match(matureJa.advisoryNote, /VELOX AIが自動学習として「保存が残った対比」を次回に活かし/);
  assert.match(matureJa.advisoryNote, /「言い換え」は自動で避けて作成します/);
  const summary = buildOperatingSummary({
    officialFollowerCount: 49,
    recentAvgImpressions: 40,
    recentBookmarkRate: 0.02,
    uiLang: 'ja',
    xSubscription: 'None'
  }, { uiLang: 'ja', subscription: 'None', matureCount: 0 });
  assert.doesNotMatch(summary.situation, /\./);
  assert.doesNotMatch(summary.insights.replace(/\d\.\d/g, ''), /\./);
  assert.doesNotMatch(`${summary.situation} ${summary.insights}`, /story_observation|utility_save|mechanism_translation/);
  assert.match(summary.situation, /通常プラン/);
  assert.match(summary.guidanceBalance, /立ち上げ観測期/);
  assert.equal(summary.guidanceBalance.includes('運用バランス'), false);
});

test('measured post history fills average, peak, and bookmark rate', () => {
  const frozenFirst = summarizePostedMeasurements([
    { impressions: 100, bookmarks: 4, metrics24hSnapshot: { isFrozen: true, impressions: 80, bookmarks: 2 } },
    { impressions: 999, bookmarks: 50, metrics24hSnapshot: { isFrozen: false, impressions: 999, bookmarks: 50 } },
    { impressions: 0, bookmarks: 0, metrics24hSnapshot: { isFrozen: true, impressions: 0, bookmarks: 0 } }
  ], 12);
  assert.equal(frozenFirst.avgImpressions, 80);
  assert.equal(frozenFirst.maxImpressions, 80);
  assert.equal(frozenFirst.bookmarkRate, 0.025);
  assert.equal(frozenFirst.followers, 12);
  const fromRecent = summarizePostedMeasurements([
    { impressions: 30, bookmarks: 3 },
    { impressions: 10, bookmarks: 1 },
    { impressions: 0, bookmarks: 0 }
  ], null);
  assert.equal(fromRecent.avgImpressions, 20);
  assert.equal(fromRecent.maxImpressions, 30);
  assert.equal(fromRecent.bookmarkRate, 0.1);
  const summary = buildOperatingSummary({
    officialFollowerCount: 12,
    uiLang: 'ja',
    xSubscription: 'none'
  }, { uiLang: 'ja', subscription: 'none', sample: frozenFirst, matureCount: 1 });
  assert.match(summary.situation, /平均およそ80回/);
  assert.match(summary.situation, /最大80回/);
  assert.match(summary.insights, /80回/);
  assert.match(summary.insights, /2\.5%/);
  assert.equal(summary.situation.includes('まだ測れていません'), false);
  assert.equal(summary.insights.includes('まだ測れていません'), false);
});

test('apply-advice rejects a missing session and does not duplicate an existing direction', () => {
  const script = `
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    const assert = require('node:assert/strict');
    const stored = new Map();
    function stub(modulePath, exports) {
      const resolved = require.resolve(modulePath);
      require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
    }
    stub('./src/firestore', { db: { collection() { return { doc(id) { return {
      async get() { return { exists: stored.has(id), data: () => stored.get(id) }; },
      async set(data, options) { stored.set(id, { ...(options && options.merge ? (stored.get(id) || {}) : {}), ...data }); }
    }; } }; } } });
    let session = null;
    stub('./src/auth_service', { resolveSessionUser: async () => session });
    const { registerHybridSaasRoutes } = require('./src/hybrid_saas_routes');
    const routes = new Map();
    registerHybridSaasRoutes({ post(path, handler) { routes.set(path, handler); }, get() {} }, { runWorker: false });
    const handler = routes.get('/api/autopilot/apply-advice');
    const run = async (body) => {
      const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      await handler({ body, headers: {} }, res);
      return res;
    };
    (async () => {
      const denied = await run({ adviceText: '現場で繰り返す確認を1行で書く', uiLang: 'ja' });
      const deniedEn = await run({ adviceText: 'Add one concrete field note', uiLang: 'en' });
      session = { userId: 'coach-user' };
      stored.set('coach-user', { userPrompt: '既存の方針' });
      const added = await run({ adviceText: '現場で繰り返す確認を1行で書く', uiLang: 'ja' });
      const duplicate = await run({ adviceText: '現場で繰り返す確認を1行で書く', uiLang: 'ja' });
      const result = {
        denied: denied.statusCode,
        deniedError: denied.body.error,
        deniedEn: deniedEn.statusCode,
        deniedEnError: deniedEn.body.error,
        added: added.statusCode,
        prompt: stored.get('coach-user').userPrompt,
        locked: stored.get('coach-user').strategyLockByUser,
        message: added.body.message,
        duplicatePrompt: duplicate.body.userPrompt
      };
      process.stdout.write(JSON.stringify(result));
    })().catch(err => { console.error(err); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 20000
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.denied, 401);
  assert.equal(result.deniedError, 'ログインセッションが無効です。');
  assert.equal(result.deniedEn, 401);
  assert.equal(result.deniedEnError, 'Your login session is invalid.');
  assert.equal(result.added, 200);
  assert.equal(result.prompt, '既存の方針\n現場で繰り返す確認を1行で書く');
  assert.equal(result.locked, true);
  assert.equal(result.message, '助言を方針へ反映しました。');
  assert.equal(result.duplicatePrompt, result.prompt);
});
