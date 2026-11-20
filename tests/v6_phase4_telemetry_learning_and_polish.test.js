const test = require('node:test');
const assert = require('node:assert/strict');
const { groundKnowledge } = require('../src/lp_knowledge_extractor');
const { planVisualCard, renderVisualCardPng } = require('../src/visual_card');
const { alignmentCheck, buildIngestionBatch, emitGenerationTrace } = require('../src/telemetry_tracer');
const { decideEditorialPlan, editorialDirective } = require('../src/editorial_lexicon_engine');
const { postIsLearnable } = require('../src/autonomous_promo_ai');
const { computeResidualRewards } = require('../src/metrics_harvest_engine');
const { categorySlug, scrubBenchmarkPatterns, scheduleNicheBenchmark, refreshNicheBenchmark } = require('../src/x_benchmark_radar');

test('qualitative playbooks survive and fabricated thresholds do not', () => {
  const corpus = '確認の入口を先に固定する';
  const kept = groundKnowledge({
    domainPlaybooks: [{
      topic: '確認の順番',
      readerSituation: '次の確認場所が毎回変わる',
      commonMistake: '直した1つだけを次の判断にする',
      concreteTradeoff: '速さは残っても説明が残らない',
      checkCriteria: 'その場で元資料を開けるか見る',
      boundaryCondition: '資料が無い日は数字を外す'
    }]
  }, corpus, corpus);
  assert.equal(kept.domainPlaybooks.length, 1);
  assert.match(kept.domainPlaybooks[0].commonMistake, /1つ/);
  const blocked = groundKnowledge({
    domainPlaybooks: [{
      topic: '手動編集',
      readerSituation: '直した投稿を見ている',
      commonMistake: '3回連続で編集するまで止めない',
      concreteTradeoff: '95%の反応を待つ',
      checkCriteria: '直した方向が次の1本に残るか見る',
      boundaryCondition: '条件が違う日は使わない'
    }]
  }, corpus, corpus);
  assert.equal(blocked.domainPlaybooks.length, 0);
});

test('the visual card keeps a symmetric inner frame', async () => {
  const plan = planVisualCard({
    portfolioRole: 'utility_save',
    lang: 'ja',
    focusPlaybook: {
      id: 'pb_1',
      topic: '確認の順番',
      commonMistake: '直した一点だけを次の判断にする',
      checkCriteria: 'その場で元資料を開けるか見る',
      boundaryCondition: '資料が無い日はこの基準を使わない'
    }
  });
  const png = await renderVisualCardPng(plan);
  assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.length < 5 * 1024 * 1024);
});

test('langfuse ingestion is optional and does not throw', async () => {
  const trace = { jobId: 'job_1', userId: 'user_1', qualityAudit: [{ role: 'writer', provider: 'anthropic', model: 'claude', ms: 10, ok: true }] };
  const batch = buildIngestionBatch(trace);
  assert.equal(batch.batch[0].type, 'trace-create');
  assert.equal(batch.batch[0].body.name, 'velox_next_post');
  assert.equal(batch.batch[1].type, 'generation-create');
  const skipped = await emitGenerationTrace(trace);
  assert.equal(skipped.skipped, true);
  const previous = {
    base: process.env.LANGFUSE_BASE_URL,
    pk: process.env.LANGFUSE_PUBLIC_KEY,
    sk: process.env.LANGFUSE_SECRET_KEY
  };
  process.env.LANGFUSE_BASE_URL = 'https://jp.cloud.langfuse.com';
  process.env.LANGFUSE_PUBLIC_KEY = 'pk_test';
  process.env.LANGFUSE_SECRET_KEY = 'sk_test';
  try {
    let auth = '';
    const failed = await emitGenerationTrace(trace, {
      fetchImpl: async (_url, options) => {
        auth = options.headers.Authorization;
        return { ok: false, status: 500 };
      }
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.status, 500);
    assert.match(auth, /^Basic /);
    const thrown = await emitGenerationTrace(trace, { fetchImpl: async () => { throw new Error('timeout'); } });
    assert.equal(thrown.ok, false);
  } finally {
    for (const [key, value] of [['LANGFUSE_BASE_URL', previous.base], ['LANGFUSE_PUBLIC_KEY', previous.pk], ['LANGFUSE_SECRET_KEY', previous.sk]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('ending moves rotate and contaminated drafts stay out of learning', () => {
  const first = decideEditorialPlan({ recentPosts: [], accountState: { lang: 'ja' } });
  const second = decideEditorialPlan({ recentPosts: ['短い文章です'], accountState: { lang: 'ja' } });
  assert.notEqual(first.endingMove, 'verdict_cut');
  assert.notEqual(first.endingMove, second.endingMove);
  assert.equal(postIsLearnable({ textSnippet: 'シャドウバンを避ける書き方' }), false);
  assert.equal(postIsLearnable({ textSnippet: 'その場で元資料を開けるかを見てから公開する。' }), true);
  const mismatch = alignmentCheck({
    domainSlot: true,
    focusPlaybookId: 'pb_2',
    hypothesisPlaybookId: 'pb_1',
    customerReason: 'なぜ今: 別の理由。根拠: 別の基準',
    playbook: { readerSituation: '別の理由', checkCriteria: '別の基準' },
    visualCard: { eligible: true, focusPlaybookId: 'pb_1' }
  });
  assert.equal(mismatch.alignmentOk, false);
});

test('early snapshots stay soft and niche patterns drop brands and numbers', async () => {
  const rewards = computeResidualRewards([{
    metricsEarlySnapshot: { impressions: 5000, bookmarks: 20, replies: 2, quotes: 0, retweets: 0, likes: 10, postAgeHours: 4 }
  }]);
  assert.ok(rewards[0].weight <= 0.35);
  assert.equal(categorySlug('VeloxPost.com', 'ja').includes('velox'), false);
  const clean = scrubBenchmarkPatterns([
    { hookPattern: '通説を一文で置く', cadence: '空行のあと対比を一文', whyBookmarked: '翌日の確認に使える' },
    { hookPattern: 'Veloxは9割伸びる', cadence: '月100時間', whyBookmarked: '3.2倍' }
  ], ['Velox']);
  assert.equal(clean.length, 1);
  const started = Date.now();
  const scheduled = scheduleNicheBenchmark({
    category: 'b2b saas',
    lang: 'ja',
    completeTextImpl: async () => ({ text: '{"patterns":[{"hookPattern":"対比","cadence":"境界","whyBookmarked":"確認"}]}' })
  });
  assert.ok(Date.now() - started < 50);
  assert.equal(scheduled.refreshing, true);
  const row = await refreshNicheBenchmark({
    category: 'b2b saas',
    lang: 'en',
    completeTextImpl: async () => ({ text: '{"patterns":[{"hookPattern":"contrast 95","cadence":"two beats","whyBookmarked":"usable next day"}]}' })
  });
  assert.equal(JSON.stringify(row.patterns).includes('95'), false);
  const directive = editorialDirective(
    { cognitiveMove: 'constraint_boundary', endingMove: 'condition_edge', registerLock: 'plain_ja', registerInstruction: '常体', autoRetiredFromRecent: [] },
    { matureCount: 1, nicheHint: '空行のあと対比を置く' },
    false
  );
  assert.match(directive, /業種の構造メモ/);
});
