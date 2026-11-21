'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criticSystemRules, judgeCriticRow, candidatePrompt, briefPrompt, draftNextPostWithMeta, hookDuelPrompt } = require('../src/next_post_draft');
const { formatTopicSourceAsDossier } = require('../src/topic_source_vault');

test('the Japanese critic stays under 400 characters and names a flaw instead of praise', () => {
  const ja = criticSystemRules(false);
  assert.equal(ja.length < 400, true);
  assert.equal(ja.includes('accountRole'), false);
  assert.equal(ja.includes('トレードオフ'), false);
  assert.match(ja, /1行目の主語が結びまで続く/);
  assert.match(ja, /自然な口語/);
  assert.match(ja, /空行がなく文字が詰まる/);
  assert.match(ja, /一度で場面が浮かぶ平易な言葉か/);
  assert.match(ja, /熟語が続くときは下げる/);
  assert.match(ja, /保存したくなる具体/);
  assert.match(ja, /同業でも言える一般メモは綺麗でも72未満/);
  assert.match(ja, /weakness は褒め言葉を書かず、削る弱点を1点だけ書く/);
  const row = judgeCriticRow({ id: 'a', score: 80, strangerClarity: 16, scrollStopHook: 14, saveUtility: 18, craftAndTruth: 18 });
  assert.equal(row.accept, true);
  const low = judgeCriticRow({ id: 'a', score: 71, strangerClarity: 16, scrollStopHook: 14, saveUtility: 18, craftAndTruth: 18 });
  assert.equal(low.accept, false);
});

test('the English critic lowers brand-swappable advice and forbids praise in weakness', () => {
  const en = criticSystemRules(true);
  assert.match(en, /abstract nouns pile up/);
  assert.match(en, /a teenager would not see the scene/);
  assert.match(en, /Brand-swappable generic advice that still works under another company name scores below 72/);
  assert.match(en, /weakness must name one concrete flaw or one generic line, never praise/);
});

test('a winning hook removes the brief opening, and a catalog note keeps one fact', () => {
  const brief = briefPrompt({ isEn: false, isolateLpContext: true, masterPlan: { topicRing: 'ring1_craft' } });
  assert.match(brief, /入力に無い時間帯や経過時間/);
  const scene = '夕方、投稿してから30分が過ぎた画面';
  const point = '14%の確認漏れは文面を磨いても残る';
  const withHook = candidatePrompt({
    isEn: false,
    accountState: { maxChars: 280 },
    shape: { count: 1 },
    brief: { scene, thisPost: '冒頭は夕方の画面', tension: point, readerPayoff: '直す場所を1つにする' },
    winningHooks: [{ text: '定型文の返信は、開く前に読み飛ばされます。' }]
  });
  assert.equal(withHook.includes(scene), false);
  assert.equal(withHook.includes('冒頭は夕方の画面'), false);
  assert.match(withHook, /14%の確認漏れは文面を磨いても残る/);
  const note = formatTopicSourceAsDossier({
    sourceName: '現場ノート',
    coreFact: '確認は14日ごとに1度で、目的、ターゲット、投稿内容、投稿頻度、返信、数値、運用期間を全部見る。',
    whyItMatters: '関係の説明。',
    mechanism: '仕組みの説明。',
    actionableTakeaway: '次の確認日だけ入口に書く。'
  }, false, 700);
  assert.match(note, /14日/);
  assert.match(note, /仕組みの説明/);
  assert.equal(note.includes('一手'), false);
  assert.equal(note.includes('ターゲット'), false);
});

test('the candidate prompt drops the repeated knowledge block and the hook duel bans invented times', () => {
  const prompt = candidatePrompt({
    isEn: false,
    accountState: { maxChars: 280 },
    shape: { count: 1 },
    brief: { readerPayoff: '直す場所を1つにする', scene: '夕方の画面', thisPost: '冒頭は夕方' },
    brandKnowledge: { oneLineMechanism: 'KNOWLEDGEJSON99', productName: 'Velox' },
    learnedDirectives: [{ text: 'LEARNEDMEMO99', isImmutable: false }],
    genes: { format: 'narrative_insight' },
    decision: { cognitiveMove: 'contrast', endingMove: 'boundary', registerLock: 'plain_ja', registerInstruction: '常体で終える。' }
  });
  assert.match(prompt, /同じ話題と同じ文体/);
  assert.equal(prompt.includes('営業時間が最新であること'), false);
  assert.equal(prompt.includes('入口の前から一度だけ見る'), false);
  assert.match(prompt, /持ち帰りはこれだけ: 直す場所を1つにする/);
  assert.match(prompt, /編集判断/);
  assert.equal(prompt.includes('KNOWLEDGEJSON99'), false);
  assert.equal(prompt.includes('LEARNEDMEMO99'), false);
  assert.equal(prompt.includes('110字を超える投稿は'), false);
  assert.equal((prompt.match(/持ち帰りはこれだけ/g) || []).length, 1);
  assert.equal((prompt.match(/編集判断/g) || []).length, 1);
  const duel = hookDuelPrompt({ isEn: false, stance: null, recentTexts: [] });
  assert.match(duel, /入力に無い時間帯（朝、夕方、夜など）や経過時間は作らない/);
  assert.match(hookDuelPrompt({ isEn: true, stance: null, recentTexts: [] }), /Do not invent a time of day/);
});

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

test('a repair after three audit failures still receives a numeric critic score', async () => {
  const dense = '確認場所を先に残して、入口が変わったときは次の手順もその場で選び直します。残す文と捨てる文を先に分けて、声に出して一度読み、ページに無い効果は消します。直近と同じ書き出しなら今日は別の入口から入り、同じ結論を二度書きません。';
  const repaired = '確認場所を先に残します。\n\n入口が変わると、次の手順もその場で選び直されます。残す文と捨てる文を先に分けます。\n\n声に出して一度読み、ページに無い効果は消します。';
  const calls = [];
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText(options) {
      calls.push(String(options.prompt || ''));
      if (calls.length === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', readerPayoff: '直す場所を1つにする' }) };
      if (String(options.prompt || '').includes('Score each')) {
        return { modelName: 'critic', text: JSON.stringify({ scores: [{ id: 'a', score: 84, weakness: '同業でも言える点検の並びが残っている', scrollStopHook: 20, saveUtility: 21, strangerClarity: 22, craftAndTruth: 21 }] }) };
      }
      if (calls.length === 2) return { modelName: 'draft', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [dense] }, { id: 'b', tweets: [dense] }, { id: 'c', tweets: [dense] }] }) };
      return { modelName: 'repair', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [repaired] }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  const prev = require.cache[draftPath];
  delete require.cache[draftPath];
  try {
    const fresh = require('../src/next_post_draft');
    const drafted = await fresh.draftNextPostWithMeta({
      lang: 'ja',
      timeoutMs: 30000,
      maxDraftCalls: 5,
      userPrompt: '確認を短く書く',
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true }
    });
    assert.equal(calls.some(prompt => prompt.includes('Score each repaired candidate')), true);
    assert.equal(drafted.repairCount >= 1, true);
    assert.equal(drafted.finalCriticScore, 84);
    assert.equal(drafted.criticAxes.weakness.includes('同業でも言える'), true);
    assert.equal(drafted.criticDegraded, false);
  } finally {
    restore();
    if (prev) require.cache[draftPath] = prev;
    else delete require.cache[draftPath];
  }
});
