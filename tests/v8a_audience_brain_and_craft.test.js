'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

test('sanitize keeps a mid-sentence closing quote and strips a fully wrapped quote', () => {
  const { sanitizePostOrReplyText } = require('../src/official_api_client');
  assert.equal(
    sanitizePostOrReplyText('「数字や強い言葉を足せば、説得力が出て反応も取れる」とよく言われます。'),
    '「数字や強い言葉を足せば、説得力が出て反応も取れる」とよく言われます。'
  );
  assert.equal(sanitizePostOrReplyText('「全文引用」'), '全文引用');
  assert.equal(sanitizePostOrReplyText('"Wrapped sentence."'), 'Wrapped sentence.');
});

test('xSearchOnly sends one x_search tool on the fast model and radar returns null on abort', async () => {
  const previous = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = 'test-xai-key';
  const originalFetch = global.fetch;
  const sent = [];
  global.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: false, status: 400, async text() { return JSON.stringify({ error: { message: 'bad tool' } }); } };
  };
  delete require.cache[require.resolve('../src/grok_client')];
  try {
    const client = require('../src/grok_client');
    await assert.rejects(() => client.completeText({
      search: true,
      xSearch: true,
      xSearchOnly: true,
      tier: 'fast',
      model: 'grok-4.20-0309-non-reasoning',
      timeoutMs: 1000,
      prompt: 'industry'
    }));
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].tools, [{ type: 'x_search' }]);
    assert.equal(sent[0].model, 'grok-4.20-0309-non-reasoning');
    assert.equal(sent[0].store, false);
    assert.equal(sent.some(body => (body.tools || []).some(tool => tool.type === 'web_search')), false);
  } finally {
    global.fetch = originalFetch;
    if (previous === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previous;
    delete require.cache[require.resolve('../src/grok_client')];
  }

  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText() { throw new Error('This operation was aborted'); }
  });
  delete require.cache[require.resolve('../src/context_radar')];
  try {
    const { fetchSituationalContext, scrubRadarText } = require('../src/context_radar');
    assert.equal(await fetchSituationalContext({ category: '運用', lang: 'ja' }), null);
    assert.equal(scrubRadarText('反応率0.45%の「引用」'), '反応率の引用');
  } finally {
    restore();
    delete require.cache[require.resolve('../src/context_radar')];
  }
});

test('live signals reach the draft prompts', async () => {
  const prompts = [];
  const restoreGrok = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt }) {
      prompts.push(prompt);
      return { modelName: 'stub', text: '{"offer":"確認"}' };
    }
  });
  delete require.cache[require.resolve('../src/next_post_draft')];
  try {
    const { draftNextPostWithMeta } = require('../src/next_post_draft');
    await assert.rejects(() => draftNextPostWithMeta({
      lang: 'ja',
      timeoutMs: 8000,
      archetype: 'live_trend_brief',
      userPrompt: '確認を短く書く',
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true },
      contextSignals: { signals: [{ topic: '公開前の境界', pain: '短い反応だけを見る', angleHint: '先に残す' }] }
    }), /検証を通る投稿案が無かった|投稿文の生成に必要なAI設定がない/);
    assert.match(prompts.join('\n'), /公開前の境界/);
  } finally {
    restoreGrok();
    delete require.cache[require.resolve('../src/next_post_draft')];
  }
});

test('brain 2 keeps illustrative cards, drops leaks, and bills only a successful build', async () => {
  const { ensureAudienceKnowledge, contentHash } = require('../src/audience_knowledge_engine');
  const brandKnowledge = {
    schemaVersion: 3,
    productName: 'VELOX AI',
    category: '運用',
    icpSummary: '公開前に文を確認する担当者',
    oneLineMechanism: '確認場所が固定されると次の判断が積み上がる',
    terminology: ['確認'],
    domainPlaybooks: [{ id: 'pb_1', topic: '確認' }]
  };
  const clean = [
    { id: 'a1', archetype: 'before_after_rewrite', topic: '書き出し', context: '下書きの1文目', weakExample: '便利です。', strongExample: '確認場所が毎回変わると、次の文が積み上がらない。', whyItWorks: '境界が先に見える。' },
    { id: 'a2', archetype: 'actionable_checklist', topic: '公開前', readerPain: '直す場所が分からない', steps: ['見出しと本文の主語を並べる', 'ページに無い効果を消す', '残した文を声に出して読む'], boundaryNote: 'ページに無いことは足さない。' },
    { id: 'a3', archetype: 'failure_autopsy', topic: '説明が長い', commonTrap: '機能名から書き始める', realCause: '読み手の作業が文に無い', practicalFix: '読み手の次の動作から書き直す', boundaryNote: '製品の手順にはしない。' },
    { id: 'a4', archetype: 'contrarian_sharp', topic: '毎日同じ型', lazyBelief: '同じ型を続ければ慣れる', sharpTruth: '慣れる前に読み飛ばされる', concreteCheck: '直近の書き出しが同じ型なら、今日は別の型にする。' },
    { id: 'leak', archetype: 'live_trend_brief', topic: '導入', practitionerStance: 'VELOX AI の導入後にフォロワーが増えた', evaluationCriteria: '売上は3倍' }
  ];
  const writes = [];
  const db = {
    collection() {
      return { doc() { return {
        async get() { return { exists: true, data: () => ({ brandKnowledge, aiMonthlyUsage: null }) }; },
        async set(data) { writes.push(data); }
      }; } };
    }
  };
  const user = { brandKnowledge, aiMonthlyUsage: null };
  const built = await ensureAudienceKnowledge({
    db,
    userId: 'user',
    user,
    brandKnowledge,
    lang: 'ja',
    now: new Date('2026-11-20T00:00:00.000Z'),
    completeWriter: async () => ({ parsed: { readerPersona: '公開前に確認する人', internalToolJargonBlocklist: ['登録ページ', '送信前ゲート'], audienceTopics: clean } })
  });
  assert.equal(built.ok, true);
  assert.equal(built.budgetRecorded, true);
  assert.equal(built.audienceKnowledge.audienceTopics.some(card => card.id === 'leak'), false);
  assert.equal(built.audienceKnowledge.audienceTopics.every(card => card.exampleKind === 'illustrative'), true);
  assert.equal(built.audienceKnowledge.audienceTopics.length, 4);
  assert.equal(built.audienceKnowledge.internalToolJargonBlocklist.includes('VELOX AI'), true);
  assert.equal(user.brandKnowledge.schemaVersion, 3);
  assert.equal(user.brandKnowledge.domainPlaybooks.length, 1);
  assert.equal(writes.some(row => row.brandKnowledge), false);
  assert.equal(writes.filter(row => row.aiMonthlyUsage).length, 1);
  const rejected = await ensureAudienceKnowledge({
    db,
    userId: 'user',
    user,
    brandKnowledge,
    lang: 'ja',
    now: new Date('2026-11-20T00:00:00.000Z'),
    completeWriter: async () => ({ parsed: { audienceTopics: [clean[4]] } })
  });
  assert.equal(rejected.budgetRecorded, false);
  const cached = await ensureAudienceKnowledge({
    db,
    userId: 'user',
    user: { ...user, audienceKnowledge: built.audienceKnowledge },
    brandKnowledge,
    lang: 'ja',
    now: new Date('2026-11-20T00:00:00.000Z'),
    completeWriter: async () => { throw new Error('should not run'); }
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.audienceKnowledge.contentHash, contentHash(brandKnowledge, 'ja'));
});

test('archetype rotation, cliches, jargon, and low-impression bandit weights hold', () => {
  const { selectEditorialArchetype } = require('../src/editorial_archetypes');
  const { runDeterministicAudit } = require('../src/draft_verifier');
  const { selectPlaybookByPerformance } = require('../src/bandit_optimization_engine');
  const plan = selectEditorialArchetype({
    recentJobs: [
      { archetype: 'before_after_rewrite', postedAt: '2026-11-20T02:00:00.000Z' },
      { archetype: 'actionable_checklist', postedAt: '2026-11-20T01:00:00.000Z' }
    ],
    radarAvailable: false,
    random: () => 0
  });
  assert.equal(['before_after_rewrite', 'actionable_checklist', 'live_trend_brief'].includes(plan.archetype), false);
  const state = { lang: 'ja', accountState: { maxChars: 280, postShape: 'single', singleOnly: true } };
  const audience = { schemaVersion: 1, internalToolJargonBlocklist: ['登録ページ', 'VELOX AI'] };
  const body = '確認場所を先に残すと、次の判断が同じ型で続く。入口が変わると手順もその場で選び直される。';
  assert.equal(runDeterministicAudit({ tweets: [`${body}という見方があります。`] }, state).reasons.includes('cliche_opener'), true);
  assert.equal(runDeterministicAudit({ tweets: [`${body}登録ページを開く。`] }, { ...state, audienceKnowledge: audience }).reasons.some(reason => reason.startsWith('internal_jargon:')), true);
  assert.equal(runDeterministicAudit({ tweets: [`${body}登録ページを開く。`] }, { ...state, audienceKnowledge: audience, portfolioPlan: { allowPromoUrl: true, portfolioRole: 'explicit_promo_offer' } }).reasons.some(reason => reason.startsWith('internal_jargon:')), false);
  const chosen = selectPlaybookByPerformance([
    { id: 'pb_low', topic: '低' },
    { id: 'pb_high', topic: '高' }
  ], [
    { focusPlaybookId: 'pb_low', metrics24hSnapshot: { isFrozen: true, impressions: 19, bookmarks: 10, replies: 0, likes: 0 } }
  ], { random: () => 0.2 });
  assert.equal(chosen.sampleCount, 0);
});

test('graduated critic keeps 72, degrades 60 to 71 after repair, and rejects under 60', async () => {
  const { usableScores, criticJsonSchema } = require('../src/llm_router');
  const legacy = usableScores({ scores: [{ id: 'a', score: 81, weakness: 'ok' }] });
  assert.equal(legacy[0].score, 81);
  assert.equal(legacy[0].strangerClarity, null);
  assert.deepEqual(criticJsonSchema.properties.scores.items.required, ['id', 'scrollStopHook', 'saveUtility', 'strangerClarity', 'craftAndTruth', 'score', 'weakness']);
  const { judgeCriticRow } = require('../src/next_post_draft');
  assert.equal(judgeCriticRow({ id: 'a', score: 80, strangerClarity: 10, scrollStopHook: 20 }, { repaired: true }).accept, false);
  assert.equal(judgeCriticRow({ id: 'a', score: 40, weakness: 'thin' }, { repaired: true }).accept, false);
  assert.equal(judgeCriticRow({ id: 'a', score: 68, strangerClarity: 16, scrollStopHook: 14 }, { repaired: true }).degraded, true);
  assert.equal(judgeCriticRow({ id: 'a', score: 68, strangerClarity: 16, scrollStopHook: 14 }, { repaired: false }).accept, false);

  const validA = '確認場所を先に残す。\n\n入口が変わると、次の手順もその場で選び直される。残す文と捨てる文を先に分ける。声に出して一度読み、ページに無い効果は消す。';
  const validB = '境界を先に書く。\n\n反応の前に、ページにあることと無いことを分けて見る。声に出して一度読む。直近と同じ書き出しなら、今日は別の入口から入る。';
  let call = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt }) {
      call += 1;
      if (call === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', underlyingMechanism: '確認場所が固定される', everydayAssumption: 'その場で考えれば足りる' }) };
      if (String(prompt).includes('Score each')) {
        const score = call < 5 ? 66 : 68;
        return { modelName: 'critic', text: JSON.stringify({ scores: [{ id: 'a', score, weakness: 'soft', strangerClarity: 16, scrollStopHook: 14, saveUtility: 12, craftAndTruth: 13 }] }) };
      }
      return { modelName: 'draft', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }, { id: 'b', tweets: [validB] }] }) };
    }
  });
  delete require.cache[require.resolve('../src/next_post_draft')];
  try {
    const { draftNextPostWithMeta } = require('../src/next_post_draft');
    const drafted = await draftNextPostWithMeta({
      lang: 'ja',
      timeoutMs: 30000,
      userPrompt: '確認を短く書く',
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true }
    });
    assert.equal(drafted.criticDegraded, true);
    assert.equal(drafted.finalCriticScore, 68);
    assert.equal(drafted.repairCount, 1);
  } finally {
    restore();
    delete require.cache[require.resolve('../src/next_post_draft')];
  }
});
