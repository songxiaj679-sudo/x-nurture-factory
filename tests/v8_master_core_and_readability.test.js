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

test('trust building stays external, blocks back to back product posts, and rotates rings', () => {
  const { decideNextPostMission } = require('../src/velox_master_core');
  const audienceKnowledge = {
    schemaVersion: 2,
    audienceTopics: [
      { exampleKind: 'illustrative', topicRing: 'ring1_craft', topicDomain: '1行目のフック', archetype: 'before_after_rewrite', id: 'r1' },
      { exampleKind: 'illustrative', topicRing: 'ring2_broad_adjacent', topicDomain: '時間がない経営者の発信', archetype: 'live_trend_brief', id: 'r2' }
    ]
  };
  const external = decideNextPostMission({
    accountState: { followers: 40 },
    brandKnowledge: { productName: 'VELOX AI' },
    audienceKnowledge,
    recentJobs: [],
    random: () => 0.99
  });
  assert.equal(external.phase, 'trust_building');
  assert.equal(external.mission, 'trust_value_external');
  assert.equal(external.isolateLpContext, true);
  assert.equal(external.topicRing, 'ring1_craft');
  assert.equal(external.sourceQuery.includes('VELOX AI'), false);
  assert.equal(external.maxApiCalls, 5);
  const bridged = decideNextPostMission({
    accountState: { followers: 40 },
    audienceKnowledge,
    recentJobs: [],
    random: () => 0.1
  });
  assert.equal(bridged.mission, 'product_bridge');
  assert.equal(bridged.isolateLpContext, false);
  const blocked = decideNextPostMission({
    accountState: { followers: 40 },
    audienceKnowledge,
    recentJobs: [{ masterMission: 'product_bridge', archetype: 'before_after_rewrite', topicRing: 'ring3_product_bridge', postedAt: '2026-11-20T01:00:00.000Z' }],
    random: () => 0.1
  });
  assert.equal(blocked.mission, 'trust_value_external');
  assert.equal(blocked.topicRing, 'ring1_craft');
  const rotated = decideNextPostMission({
    accountState: { followers: 40 },
    audienceKnowledge,
    recentJobs: [
      { masterMission: 'trust_value_external', archetype: 'before_after_rewrite', topicRing: 'ring1_craft', selectedTopicDomain: '1行目のフック', postedAt: '2026-11-20T03:00:00.000Z' },
      { masterMission: 'trust_value_external', archetype: 'actionable_checklist', topicRing: 'ring1_craft', selectedTopicDomain: '1行目のフック', postedAt: '2026-11-20T02:00:00.000Z' }
    ],
    random: () => 0.99
  });
  assert.equal(rotated.topicRing, 'ring2_broad_adjacent');
  assert.equal(['before_after_rewrite', 'actionable_checklist'].includes(rotated.archetype), false);
});

test('isolated drafts omit the page and playbook, keep persona facts when no card exists, and one survivor still reaches the critic', async () => {
  const prompts = [];
  const text = '確認場所を先に残す。\n\n入口が変わると、次の手順もその場で選び直される。残す文と捨てる文を先に分ける。声に出して一度読み、足りない一点だけを足す。';
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt }) {
      prompts.push(prompt);
      if (prompts.length === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', thisPost: '入口' }) };
      if (String(prompt).includes('light_review')) {
        return { modelName: 'critic', text: JSON.stringify({ scores: [{ id: 'a', score: 80, weakness: '', strangerClarity: 18, scrollStopHook: 16, saveUtility: 18, craftAndTruth: 18 }] }) };
      }
      return { modelName: 'draft', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [text] }] }) };
    }
  });
  delete require.cache[require.resolve('../src/next_post_draft')];
  try {
    const { draftNextPostWithMeta } = require('../src/next_post_draft');
    const drafted = await draftNextPostWithMeta({
      lang: 'ja',
      timeoutMs: 20000,
      masterPlan: { isolateLpContext: true, topicRing: 'ring2_broad_adjacent', selectedTopicDomain: '時間がない経営者の発信', archetype: 'before_after_rewrite' },
      archetype: 'before_after_rewrite',
      pageSummary: { title: 'UNIQUE_PAGE_TOKEN', snippet: 'UNIQUE_PAGE_BODY', headings: ['UNIQUE_PAGE_HEAD'] },
      hypothesisText: 'UNIQUE_PAGE_NOTE',
      brandKnowledge: { productName: 'VELOX AI', oneLineMechanism: 'UNIQUE_MECHANISM', verifiedClaims: [{ mechanism: 'UNIQUE_CLAIM_TOKEN' }], verifiedConstraints: ['UNIQUE_CONSTRAINT'] },
      focusPlaybook: { id: 'pb_1', topic: 'UNIQUE_PLAYBOOK', checkCriteria: 'UNIQUE_PLAYBOOK_RULE' },
      userPrompt: '読み手の作業を短く書く',
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true }
    });
    const writerPrompts = prompts.filter(prompt => !prompt.includes('light_review')).join('\n');
    assert.equal(writerPrompts.includes('UNIQUE_PAGE_BODY'), false);
    assert.equal(writerPrompts.includes('UNIQUE_PAGE_HEAD'), false);
    assert.equal(writerPrompts.includes('UNIQUE_CLAIM_TOKEN'), true);
    assert.equal(writerPrompts.includes('UNIQUE_MECHANISM'), true);
    assert.equal(writerPrompts.includes('UNIQUE_PLAYBOOK'), false);
    assert.equal(prompts.some(prompt => prompt.includes('light_review')), true);
    assert.equal(drafted.finalCriticScore, 80);
  } finally {
    restore();
    delete require.cache[require.resolve('../src/next_post_draft')];
  }
});

test('source dossier uses one fast search, scrubs stats, caches, and stops on abort', async () => {
  const previous = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = 'test-xai-key';
  const calls = [];
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText(options) {
      calls.push(options);
      if (options.prompt.includes('ABORT_TOPIC')) throw new Error('This operation was aborted');
      return { modelName: options.model, text: JSON.stringify({ currentDebate: '反応率0.45%の「引用」を避ける', concreteAngles: ['先に境界を書く'], specialistInsight: 'VELOX AI の画面ではなく読み手の一文を見る', avoidCliches: ['毎日投稿すれば伸びる'] }) };
    }
  });
  delete require.cache[require.resolve('../src/source_dossier_engine')];
  const writes = [];
  const db = { collection() { return { doc() { return {
    async get() { return { exists: writes.length > 0, data: () => ({ entries: writes }) }; },
    async set(data) { if (Array.isArray(data.entries)) writes.splice(0, writes.length, ...data.entries); }
  }; } }; } };
  try {
    const { fetchSourceDossier } = require('../src/source_dossier_engine');
    const first = await fetchSourceDossier({ topicDomain: '時間がない経営者の発信', topicRing: 'ring1_craft', lang: 'ja', productName: 'VELOX AI', db, userId: 'user', now: new Date('2026-11-20T00:00:00.000Z') });
    assert.equal(calls[0].model, 'grok-4.20-0309-non-reasoning');
    assert.equal(calls[0].xSearchOnly, true);
    assert.equal(calls[0].timeoutMs, 18000);
    assert.equal(String(first.currentDebate).includes('0.45'), false);
    assert.equal(String(first.specialistInsight).includes('VELOX AI'), false);
    const second = await fetchSourceDossier({ topicDomain: '時間がない経営者の発信', lang: 'ja', db, now: new Date('2026-11-20T01:00:00.000Z') });
    assert.equal(second.cached, true);
    assert.equal(calls.length, 1);
    const aborted = await fetchSourceDossier({ topicDomain: 'ABORT_TOPIC', lang: 'en', db, now: new Date('2026-11-20T02:00:00.000Z') });
    assert.equal(aborted, null);
    assert.equal(calls.length, 2);
  } finally {
    restore();
    if (previous === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previous;
    delete require.cache[require.resolve('../src/source_dossier_engine')];
  }
});

test('readability and LP meta gates reject walls and page-checking lines', () => {
  const { auditReadability } = require('../src/readability_formatter');
  const { runDeterministicAudit } = require('../src/draft_verifier');
  const wall = '確認場所を先に残すと次の判断が同じ型で続く。入口が変わるたびに手順も選び直され、現場の確認がその場でぶれる。先に残した一点だけを次の作業へ渡すと翌日も同じ型で見直せる。記録はその一点に限る。それ以外の手順は次の確認まで持たない。声に出して一度読み、ページ外の効果は足さない。';
  const airy = '入口を一文で置く。\n\n次の判断は、その一文が残っているかにかかる。残っていなければ、手順は毎回選び直しになる。\n\n今日見るのは、その一文だけにする。';
  assert.equal(auditReadability([wall], { lang: 'ja' }).reasons.includes('missing_hook_break'), true);
  assert.equal(auditReadability([airy], { lang: 'ja' }).ok, true);
  const dense = runDeterministicAudit({ tweets: [wall] }, { lang: 'ja', enforceReadability: true, accountState: { maxChars: 400, postShape: 'single', singleOnly: true } });
  assert.equal(dense.reasons.includes('dense_wall_of_text') || dense.reasons.includes('missing_hook_break'), true);
  const leak = runDeterministicAudit({ tweets: ['確認場所を先に残す。\n\n登録ページと突き合わせてから予約する。\n\n残った一文だけを次の判断に使う。'] }, {
    lang: 'ja',
    isolateLpContext: true,
    accountState: { maxChars: 280, postShape: 'single', singleOnly: true }
  });
  assert.equal(leak.reasons.includes('lp_meta_leak'), true);
});

test('schema 2 keeps both rings and drops generic jargon', async () => {
  const { ensureAudienceKnowledge, genericJargon } = require('../src/audience_knowledge_engine');
  assert.equal(genericJargon('次の1本'), true);
  assert.equal(genericJargon('draft'), true);
  assert.equal(genericJargon('送信前ゲート'), false);
  const card = (id, ring, domain, archetype) => ({
    id,
    archetype,
    topicRing: ring,
    topicDomain: domain,
    topic: domain,
    context: '下書きの入口',
    weakExample: '便利です。',
    strongExample: '入口が毎回変わると次の文が積み上がらない。',
    whyItWorks: '境界が先に見える。',
    readerPain: '直す場所が分からない',
    steps: ['主語を並べる', 'ページ外の効果を消す', '声に出して読む'],
    boundaryNote: '製品の手順にはしない。',
    commonTrap: '機能名から書く',
    realCause: '読み手の作業が無い',
    practicalFix: '次の動作から書く',
    lazyBelief: '同じ型を続ければ慣れる',
    sharpTruth: '慣れる前に読み飛ばされる',
    concreteCheck: '書き出しが同じなら別の入口にする。',
    practitionerStance: '短い一文から入る',
    evaluationCriteria: '知らない人が次の動作を想像できるか'
  });
  const built = await ensureAudienceKnowledge({
    user: {},
    brandKnowledge: { productName: 'VELOX AI', category: '発信', icpSummary: '時間がない経営者' },
    lang: 'ja',
    now: new Date('2026-11-20T00:00:00.000Z'),
    completeWriter: async () => ({
      parsed: {
        readerPersona: '時間がない経営者',
        broadTopicDomains: { ring1_craft: ['1行目のフック'], ring2_broad_adjacent: ['時間がない経営者の発信'] },
        internalToolJargonBlocklist: ['VELOX AI', '次の1本', 'draft', '送信前ゲート'],
        audienceTopics: [
          card('a', 'ring1_craft', '1行目のフック', 'before_after_rewrite'),
          card('b', 'ring1_craft', '余白の作り方', 'actionable_checklist'),
          card('c', 'ring2_broad_adjacent', '時間がない経営者の発信', 'failure_autopsy'),
          card('d', 'ring2_broad_adjacent', '生成AI時代の発信習慣', 'contrarian_sharp')
        ]
      }
    })
  });
  assert.equal(built.audienceKnowledge.schemaVersion, 2);
  assert.equal(built.audienceKnowledge.broadTopicDomains.ring1_craft.includes('1行目のフック'), true);
  assert.equal(built.audienceKnowledge.broadTopicDomains.ring2_broad_adjacent.includes('時間がない経営者の発信'), true);
  assert.equal(built.audienceKnowledge.audienceTopics.some(topic => topic.topicRing === 'ring1_craft'), true);
  assert.equal(built.audienceKnowledge.audienceTopics.some(topic => topic.topicRing === 'ring2_broad_adjacent'), true);
  assert.equal(built.audienceKnowledge.internalToolJargonBlocklist.includes('次の1本'), false);
  assert.equal(built.audienceKnowledge.internalToolJargonBlocklist.includes('draft'), false);
  assert.equal(built.audienceKnowledge.internalToolJargonBlocklist.includes('送信前ゲート'), true);
});
