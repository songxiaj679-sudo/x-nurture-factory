'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectTopicSourceForUser, formatTopicSourceAsDossier, keepGroundedNumbers } = require('../src/topic_source_vault');
const { briefPrompt, candidatePrompt } = require('../src/next_post_draft');

const article = '# 入口\n紙の確認は14日ごとに一度で足りる。出典は現場ノート。';
const ownPage = 'https://customer.example/home';
const articlePage = 'https://trade-journal.example/how-often';
const termsPage = 'https://trade-journal.example/terms';

function searchText() {
  return JSON.stringify({ items: [
    { url: 'http://127.0.0.1/secret', sourceName: 'local' },
    { url: termsPage, sourceName: 'terms' },
    { url: ownPage, sourceName: 'own' },
    { url: articlePage, sourceName: '現場ノート' }
  ] });
}

test('a real number and the source name stay, and the 700 character note has no URL', async () => {
  const calls = [];
  const card = await collectTopicSourceForUser({
    dryRun: true,
    outputLang: 'ja',
    brandKnowledge: { category: '店', domainProblems: ['紙が古い'], icpSummary: '店主', oneLineMechanism: '入口を先に見る', sourceUrl: ownPage },
    completeText: async () => ({ text: searchText() }),
    completeJson: async () => ({ parsed: {
      sourceName: '現場ノート',
      title: '確認の間隔',
      coreFact: '紙の確認は14日ごとで、99%は別の話。',
      whyItMatters: '来店前に閉まる店を減らせる。',
      mechanism: '間隔を14日に固定すると見落としが減る。',
      actionableTakeaway: '次の確認日だけ入口に書く。'
    } }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      assert.equal(body.formats[0], 'markdown');
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'limit'), false);
      return { ok: true, async text() { return JSON.stringify({ success: true, data: { markdown: article } }); } };
    },
    assertUrl: () => {}
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, articlePage);
  assert.equal(card.sourceName, '現場ノート');
  assert.match(card.coreFact, /14日/);
  assert.equal(card.coreFact.includes('99'), false);
  assert.equal(card.usedCount, 0);
  const note = formatTopicSourceAsDossier(card, false, 700);
  assert.equal(note.length <= 700, true);
  assert.equal(/https?:\/\//.test(note), false);
  assert.match(note, /現場ノート/);
  assert.match(note, /14日/);
  const saved = [];
  function sourceDoc() {
    return { set: async function (row) { saved.push(row); } };
  }
  function userDoc() {
    return { collection: function () { return { doc: sourceDoc }; } };
  }
  const db = { collection: function () { return { doc: userDoc }; } };
  await collectTopicSourceForUser({
    db,
    userId: 'user-1',
    dryRun: false,
    outputLang: 'ja',
    brandKnowledge: { sourceUrl: ownPage },
    completeText: async () => ({ text: searchText() }),
    completeJson: async () => ({ parsed: { sourceName: '現場ノート', coreFact: '14日ごとに見る。', whyItMatters: '閉まる前に気づく。', mechanism: '14日で固定する。', actionableTakeaway: '日付を書く。' } }),
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify({ success: true, data: { markdown: article } }); } }),
    assertUrl: () => {}
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sourceUrl, articlePage);
});

test('over budget and a private URL do not scrape', async () => {
  let scraped = 0;
  const blocked = await collectTopicSourceForUser({
    db: { collection() { return { doc() { return {}; } }; } },
    userId: 'free-user',
    user: { plan: 'free', aiMonthlyUsage: { monthKey: new Date().toISOString().slice(0, 7), crawlPages: 10 } },
    completeText: async () => ({ text: searchText() }),
    fetchImpl: async () => { scraped += 1; return { ok: false, async text() { return ''; } }; },
    assertUrl: () => {}
  });
  assert.equal(blocked, null);
  assert.equal(scraped, 0);
  const onlyPrivate = await collectTopicSourceForUser({
    dryRun: true,
    completeText: async () => ({ text: JSON.stringify({ items: [{ url: 'http://127.0.0.1/secret', sourceName: 'local' }] }) }),
    fetchImpl: async () => { scraped += 1; return { ok: true, async text() { return '{"success":true,"data":{"markdown":"x"}}'; } }; }
  });
  assert.equal(onlyPrivate, null);
  assert.equal(scraped, 0);
  assert.equal(keepGroundedNumbers('14日と99%', article).includes('99'), false);
});

test('a topic card replaces only the ring 1 external note', () => {
  const card = { sourceName: '現場ノート', coreFact: '14日ごとに見る。', whyItMatters: '閉まる前に気づく。', mechanism: '間隔を固定する。', actionableTakeaway: '日付を書く。', sourceUrl: articlePage };
  const masterPlan = { topicRing: 'ring1_craft', selectedTopicDomain: '店' };
  const withCard = briefPrompt({ isEn: false, isolateLpContext: true, sourceDossier: { currentDebate: 'OLDDOSSIER' }, topicSource: card, masterPlan });
  assert.match(withCard, /現場ノート/);
  assert.equal(withCard.includes('OLDDOSSIER'), false);
  assert.equal(/https?:\/\//.test(withCard), false);
  const plain = candidatePrompt({ isEn: false, isolateLpContext: true, sourceDossier: { currentDebate: 'OLDDOSSIER' }, masterPlan, accountState: { maxChars: 140 }, shape: { count: 1 } });
  assert.match(plain, /OLDDOSSIER/);
  const ring3 = candidatePrompt({ isEn: false, isolateLpContext: true, sourceDossier: { currentDebate: 'OLDDOSSIER' }, topicSource: card, masterPlan: { topicRing: 'ring3_product_bridge' }, accountState: { maxChars: 140 }, shape: { count: 1 } });
  assert.match(ring3, /OLDDOSSIER/);
  assert.equal(ring3.includes('現場ノート'), false);
});
