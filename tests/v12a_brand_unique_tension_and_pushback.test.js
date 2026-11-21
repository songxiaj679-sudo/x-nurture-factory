'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { abstractAudiencePushbacks, latestAudiencePushback } = require('../src/audience_questions');
const { collectTopicSourceForUser, formatTopicSourceAsDossier } = require('../src/topic_source_vault');
const {
  selectPushbackSeed,
  sanitizeBriefTension,
  briefPrompt,
  candidatePrompt,
  hookAngleForChoice,
  finalizeSelectedHookAngle,
  draftNextPostWithMeta,
  criticSystemRules
} = require('../src/next_post_draft');

const article = '# 入口\n紙の確認は14日ごとに一度で足りる。現場では毎回見れば足りると思われている。';
const ownPage = 'https://customer.example/home';
const articlePage = 'https://trade-journal.example/how-often';

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

test('a raw pushback keeps digits and quotes, and drops a handle, a URL, and an email', () => {
  const long = `本当に効くのか。14%の「確認漏れ」が残る。${'あ'.repeat(180)}`;
  const rows = abstractAudiencePushbacks([
    { text: '@reader https://secret.example/note a@b.com 本当に効くのか。14%の「確認漏れ」が残る。' },
    { text: long },
    { text: 'いいね' }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].includes('@reader'), false);
  assert.equal(rows[0].includes('https://'), false);
  assert.equal(rows[0].includes('a@b.com'), false);
  assert.match(rows[0], /14%/);
  assert.match(rows[0], /「確認漏れ」/);
  assert.equal(Array.from(rows[1]).length, 200);
  assert.equal(latestAudiencePushback(null), '');
  assert.equal(latestAudiencePushback({ pushbacks: rows }), rows[0]);
});

test('an old topic card still works, and commonMyth stays out of the 700 character note', async () => {
  const card = await collectTopicSourceForUser({
    dryRun: true,
    outputLang: 'ja',
    brandKnowledge: { category: '店', domainProblems: ['紙が古い'], icpSummary: '店主', oneLineMechanism: '入口を先に見る', sourceUrl: ownPage },
    completeText: async () => ({ text: JSON.stringify({ items: [{ url: articlePage, sourceName: '現場ノート' }] }) }),
    completeJson: async () => ({ parsed: {
      sourceName: '現場ノート',
      coreFact: '紙の確認は14日ごと。',
      whyItMatters: '閉まる前に気づく。',
      mechanism: '間隔を固定する。',
      actionableTakeaway: '次の確認日だけ書く。',
      commonMyth: '毎回見れば足りる。99%は別。'
    } }),
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify({ success: true, data: { markdown: article } }); } }),
    assertUrl: () => {}
  });
  assert.match(card.commonMyth, /毎回見れば足りる/);
  assert.equal(card.commonMyth.includes('99'), false);
  assert.equal(Array.from(card.commonMyth).length <= 120, true);
  const legacy = { sourceName: '現場ノート', coreFact: '14日ごとに見る。', mechanism: '間隔を固定する。', actionableTakeaway: '日付を書く。' };
  const note = formatTopicSourceAsDossier(legacy, false, 700);
  assert.match(note, /14日/);
  assert.equal(note.includes('commonMyth'), false);
  const fresh = formatTopicSourceAsDossier(card, false, 700);
  assert.equal(fresh.includes('毎回見れば足りる'), false);
  assert.equal(fresh.length <= 700, true);
});

test('a paraphrase, a failed swap, and a same-direction claim are dropped', () => {
  const seed = { source: 'article_myth', text: '毎回見れば足りる' };
  const topicSource = { coreFact: '入口の紙を先に見て予定と現場のずれを直す', actionableTakeaway: '変えた日だけ見る' };
  const kept = sanitizeBriefTension({
    tension: '増やす前に残す一文を決める',
    tensionReversesInput: true,
    passesBrandSwap: true
  }, { seed, topicSource, isEn: false });
  assert.equal(kept.tension, '増やす前に残す一文を決める');
  assert.equal(kept.tensionSource, 'article_myth');
  const paraphrase = sanitizeBriefTension({
    tension: '入口の紙を先に見て予定と現場のずれを直す',
    tensionReversesInput: true,
    passesBrandSwap: true
  }, { seed, topicSource, isEn: false });
  assert.equal(paraphrase.tension, null);
  const swap = sanitizeBriefTension({
    tension: '増やす前に残す一文を決める',
    tensionReversesInput: true,
    passesBrandSwap: false
  }, { seed, topicSource, isEn: false });
  assert.equal(swap.tension, null);
  const sameWay = sanitizeBriefTension({
    tension: '増やす前に残す一文を決める',
    tensionReversesInput: false,
    passesBrandSwap: true
  }, { seed, topicSource, isEn: false });
  assert.equal(sameWay.tension, null);
  const long = sanitizeBriefTension({
    tension: 'あ'.repeat(90),
    tensionReversesInput: true,
    passesBrandSwap: true
  }, { seed, topicSource, isEn: false });
  assert.equal(Array.from(long.tension).length, 70);
  const voiced = { source: 'audience_pushback', text: '本当に毎回見れば足りるのか。14%の確認漏れが残る。' };
  const invented = sanitizeBriefTension({
    tension: '投稿後30分で担当を決める',
    tensionReversesInput: true,
    passesBrandSwap: true
  }, { seed: voiced, topicSource, isEn: false });
  assert.equal(invented.tension, null);
  const keptNumber = sanitizeBriefTension({
    tension: '14%の確認漏れは文面を磨いても残る',
    tensionReversesInput: true,
    passesBrandSwap: true
  }, { seed: voiced, topicSource, isEn: false });
  assert.match(keptNumber.tension, /14%/);
  const fromCard = sanitizeBriefTension({
    tension: '14日ごとに見るほうが毎回見るより残る',
    tensionReversesInput: true,
    passesBrandSwap: true
  }, { seed, topicSource: { ...topicSource, coreFact: '確認は14日ごとだ' }, isEn: false });
  assert.match(fromCard.tension, /14日/);
});

test('the brief names one collision partner and the candidate uses that sentence as its spine', () => {
  const pushback = '本当に毎回見れば足りるのか。14%の確認漏れが残る。';
  const mythSeed = selectPushbackSeed({
    masterPlan: { topicRing: 'ring1_craft', isolateLpContext: true },
    pushback,
    topicSource: { commonMyth: '毎回見れば足りる' },
    brandKnowledge: { editorialStance: { rejectedNorm: '投稿を増やすほど良い' } }
  });
  assert.equal(mythSeed.source, 'audience_pushback');
  const mythOnly = selectPushbackSeed({
    masterPlan: { topicRing: 'ring2_broad_adjacent' },
    topicSource: { commonMyth: '毎回見れば足りる' },
    brandKnowledge: { editorialStance: { rejectedNorm: '投稿を増やすほど良い' } }
  });
  assert.equal(mythOnly.source, 'article_myth');
  const pov = selectPushbackSeed({
    masterPlan: { topicRing: 'ring1_craft' },
    brandKnowledge: { editorialStance: { rejectedNorm: '投稿を増やすほど良い' } }
  });
  assert.equal(pov.source, 'brand_pov');
  assert.equal(selectPushbackSeed({
    masterPlan: { topicRing: 'ring3_product_bridge' },
    pushback
  }), null);
  const brief = briefPrompt({
    isEn: false,
    isolateLpContext: true,
    masterPlan: { topicRing: 'ring1_craft' },
    tensionSeed: mythSeed,
    topicSource: { sourceName: '現場ノート', coreFact: '14日ごとに見る。', mechanism: '間隔を固定する。', actionableTakeaway: '日付を書く。' }
  });
  assert.match(brief, /本当に毎回見れば足りるのか/);
  assert.match(brief, /passesBrandSwap/);
  const spine = '増やす前に残す一文を決める';
  const withSpine = candidatePrompt({
    isEn: false,
    isolateLpContext: true,
    masterPlan: { topicRing: 'ring1_craft' },
    accountState: { maxChars: 280 },
    shape: { count: 1 },
    brief: { tension: spine, tensionSource: 'audience_pushback' },
    sourceDossier: { currentDebate: 'OLDDOSSIER' }
  });
  assert.match(withSpine, /事実の棚/);
  assert.match(withSpine, /増やす前に残す一文を決める/);
  const plain = candidatePrompt({
    isEn: false,
    isolateLpContext: true,
    masterPlan: { topicRing: 'ring1_craft' },
    accountState: { maxChars: 280 },
    shape: { count: 1 },
    brief: { readerPayoff: '日付を見る' },
    sourceDossier: { currentDebate: 'OLDDOSSIER' }
  });
  assert.equal(plain.includes('事実の棚'), false);
  assert.match(plain, /OLDDOSSIER/);
  const promo = fs.readFileSync('src/autonomous_promo_ai.js', 'utf8');
  const draft = fs.readFileSync('src/next_post_draft.js', 'utf8');
  assert.match(promo, /maxDraftCalls: dossierLive \? 4 : 5/);
  assert.match(promo, /selectedHookAngle: drafted\.selectedHookAngle \|\| null/);
  assert.equal(criticSystemRules(false).length < 400, true);
  assert.equal(draft.includes('function criticSystemRules'), true);
});

test('candidate 3 after a hook duel is control, and a different sentence stays null', async () => {
  const hooks = [{ angle: 'blunt_practitioner', text: '開発側は、丁寧な返信を勧めません。' }];
  assert.equal(hookAngleForChoice({ tweets: ['夜の予定表だけを信じて、閉まった扉の前に立つ。'] }, hooks), null);
  assert.equal(finalizeSelectedHookAngle({ id: 'a', tweets: ['夜の予定表だけを信じて、閉まった扉の前に立つ。'] }, hooks, true, [{ id: 'a' }]), null);
  assert.equal(finalizeSelectedHookAngle({ id: 'c', tweets: ['夜の予定表だけを信じて、閉まった扉の前に立つ。'] }, hooks, false, [{ id: 'c' }]), null);
  assert.equal(finalizeSelectedHookAngle({ id: 'c', tweets: ['夜の予定表だけを信じて、閉まった扉の前に立つ。'] }, hooks, true, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 'control');
  const validA = '現場で毎日記録を見直して気づいたのですが、投稿前に読者の悩みと手順を一つだけ絞る方が反応は安定します。遠回りに見えても地道な記録が信頼になります。';
  const validB = '仕組みを作るときに一番効いたのは、最初から完璧な構成を追わずに小さな検証を回すことでした。短い改善を積み重ねると無理なく運用が続いていきます。';
  const validC = '夕方の一覧は、新しい投稿と古い投稿が同じ列に並びます。経過が違う数字を比べると、直し場所を間違えます。同じ経過だけを見て、低いときだけ一文を直します。';
  const calls = [];
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText() {
      calls.push(1);
      if (calls.length === 1) {
        return { modelName: 'brief', text: JSON.stringify({ offer: '確認', tension: '増やす前に残す一文を決める', tensionReversesInput: true, passesBrandSwap: true }) };
      }
      if (calls.length === 2) {
        return { modelName: 'draft', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }, { id: 'b', tweets: [validB] }, { id: 'c', tweets: [validC] }] }) };
      }
      return { modelName: 'critic', text: JSON.stringify({ scores: [
        { id: 'a', score: 40, weakness: 'thin', scrollStopHook: 10, saveUtility: 10, strangerClarity: 10, craftAndTruth: 10 },
        { id: 'c', score: 88, weakness: 'late', scrollStopHook: 22, saveUtility: 22, strangerClarity: 22, craftAndTruth: 22 }
      ] }) };
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
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true },
      masterPlan: { topicRing: 'ring1_craft', isolateLpContext: true },
      topicSource: { coreFact: '入口の紙を先に見る。', mechanism: '間隔を固定する。', actionableTakeaway: '変えた日だけ見る。' },
      contextSignals: { pushback: '本当に毎回見れば足りるのか。14%の確認漏れが残る。' },
      hookPayload: { hooks: [
        { angle: 'blunt_practitioner', text: '開発側は、リプ欄のURLより一文を直す。', verdict: 'keep', reason: 'plain' },
        { angle: 'scene_friction', text: '下書きを開いたまま、送信の前で手が止まる。', verdict: 'keep', reason: 'scene' },
        { angle: 'contrarian_flip', text: '増やす前に、残す一文を決める方が先です。', verdict: 'reject', reason: 'soft' },
        { angle: 'unexpected_analogy', text: '塩を足す前に、火を弱める人がいる。', verdict: 'reject', reason: 'late' }
      ] }
    });
    assert.equal(calls.length, 3);
    assert.equal(drafted.selectedHookAngle, 'control');
    assert.equal(drafted.hookDuelUsed, true);
    assert.equal(drafted.tensionUsed, true);
    assert.equal(drafted.tensionSource, 'audience_pushback');
    assert.equal(drafted.tweets[0].includes(validC.slice(0, 12)), true);
  } finally {
    restore();
    if (prev) require.cache[draftPath] = prev;
    else delete require.cache[draftPath];
  }
});
