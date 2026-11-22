'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topicVaultEligibility, selectReusableTopicCard, isPrimarySource, safeArticleUrl, selectArticleUrls, collectTopicSourceForUser, runTopicSourceVaultSweep } = require('../src/topic_source_vault');
const { chooseSourceMaterial } = require('../src/bandit_optimization_engine');

const now = new Date('2026-11-22T06:50:00.000Z');
const hour = 60 * 60 * 1000;

function user() {
  return {
    planId: 'business',
    targetUrl: 'https://customer.example/home',
    brandKnowledge: { icpSummary: '店主', domainProblems: ['紙が古い'] }
  };
}

test('an empty V13 stock collects after three hours when the weekly cap still has room', () => {
  const usedLegacy = [{ fetchedAt: new Date(now.getTime() - 26 * hour).toISOString(), usedCount: 2 }];
  const open = topicVaultEligibility({ user: user(), cards: usedLegacy, now });
  assert.equal(open.ok, true);
  assert.equal(open.reason, 'ready');
  const recent = [{ fetchedAt: new Date(now.getTime() - hour).toISOString(), usedCount: 2 }];
  assert.equal(topicVaultEligibility({ user: user(), cards: recent, now }).reason, 'interval');
  const waiting = [{
    fetchedAt: new Date(now.getTime() - 26 * hour).toISOString(),
    usedCount: 0,
    plainTranslation: '入口の紙は予定と別に替わる。'
  }];
  assert.equal(topicVaultEligibility({ user: user(), cards: waiting, now }).reason, 'interval');
  const full = [1, 2, 3].map(index => ({
    fetchedAt: new Date(now.getTime() - index * hour).toISOString(),
    usedCount: 1
  }));
  assert.equal(topicVaultEligibility({ user: user(), cards: full, now }).reason, 'weekly_cap');
});

test('a live primary card beats dossier, and a used legacy card is not picked again', () => {
  const plan = { isolateLpContext: true, topicRing: 'ring1_craft' };
  const card = { coreFact: '直下の返信が印象を引っ張る。', plainTranslation: '返信が先に目に入る。' };
  const dossier = { coreFact: 'メモを整える。' };
  const chosen = chooseSourceMaterial({
    genes: { sourceType: 'dossier' },
    topicSource: card,
    sourceDossier: dossier,
    masterPlan: plan
  });
  assert.equal(chosen.sourceType, 'topic_source');
  assert.equal(chosen.topicSource, card);
  assert.equal(chooseSourceMaterial({
    genes: { sourceType: 'topic_source' },
    topicSource: null,
    sourceDossier: dossier,
    masterPlan: plan
  }).sourceType, 'dossier');
  const picked = selectReusableTopicCard([
    { outputLang: 'ja', coreFact: '手順', mechanism: '一覧', usedCount: 2 },
    { outputLang: 'ja', coreFact: '発見', mechanism: '理由', plainTranslation: '返信が先に目に入る。', usedCount: 1 }
  ], 'ja');
  assert.equal(picked.coreFact, '発見');
  assert.equal(selectReusableTopicCard([
    { outputLang: 'ja', coreFact: '手順', mechanism: '一覧', usedCount: 2 }
  ], 'ja'), null);
});

test('a safe primary source stays without a title keyword, and roundups still drop', async () => {
  assert.equal(isPrimarySource({ url: 'https://lab.example.com/findings', sourceName: 'Field note' }), true);
  assert.equal(isPrimarySource({ url: 'https://dept.example.edu/notes', sourceName: '観測' }), true);
  assert.equal(isPrimarySource({ url: 'https://journal.example.org/item', sourceName: '論文' }), false);
  assert.equal(isPrimarySource({ url: 'https://blog.example/seven', sourceName: 'コツ7選' }), false);
  assert.equal(isPrimarySource({ url: 'https://blog.example/guide', sourceName: '初心者向け完全ガイド' }), false);
  assert.equal(safeArticleUrl('https://x.com/someone/status/1', [], null), '');
  const chosen = await selectArticleUrls({
    outputLang: 'ja',
    ownUrls: [],
    completeText: async () => ({ text: JSON.stringify({ items: [
      { url: 'https://lab.example.com/findings', sourceName: 'Field note' },
      { url: 'https://notes.example.org/hours', sourceName: '観測' },
      { url: 'https://archive.example.net/table', sourceName: '集計' },
      { url: 'https://blog.example/seven', sourceName: 'コツ7選' }
    ] }) }),
    assertUrl: () => {}
  });
  assert.equal(chosen.rawCount, 4);
  assert.equal(chosen.length, 3);
});

test('a null collect names the branch and the sweep prints it without a url', async () => {
  process.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'placeholder';
  const trace = {};
  const card = await collectTopicSourceForUser({
    dryRun: true,
    outputLang: 'ja',
    brandKnowledge: { icpSummary: '店主', domainProblems: ['紙が古い'] },
    trace,
    completeText: async () => ({ text: JSON.stringify({ items: [
      { url: 'https://lab.example.com/findings', sourceName: 'Field note' },
      { url: 'https://notes.example.org/hours', sourceName: '観測' }
    ] }) }),
    fetchImpl: async () => ({ ok: false, status: 403, async text() { return '{"success":false}'; } }),
    assertUrl: () => {}
  });
  assert.equal(card, null);
  assert.equal(trace.reason, 'scrape_empty');
  assert.equal(trace.raw, 2);
  assert.equal(trace.kept, 2);
  assert.deepEqual(trace.statuses, [403, 403]);
  const empty = {};
  await collectTopicSourceForUser({
    dryRun: true,
    trace: empty,
    completeText: async () => ({ text: JSON.stringify({ items: [{ url: 'https://blog.example/seven', sourceName: 'コツ7選' }] }) }),
    assertUrl: () => {}
  });
  assert.equal(empty.reason, 'no_candidates');
  const built = {};
  const missing = await collectTopicSourceForUser({
    dryRun: true,
    trace: built,
    completeText: async () => ({ text: JSON.stringify({ items: [{ url: 'https://lab.example.com/findings', sourceName: 'Field note' }] }) }),
    completeJson: async () => ({ parsed: {} }),
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ success: true, data: { markdown: '観測は別の日に入れ替わる。' } }); } }),
    assertUrl: () => {}
  });
  assert.equal(missing, null);
  assert.equal(built.reason, 'card_null');
  assert.deepEqual(built.statuses, [200]);
  const broken = {};
  await collectTopicSourceForUser({
    dryRun: true,
    trace: broken,
    completeText: async () => { throw new Error('search down'); },
    assertUrl: () => {}
  });
  assert.equal(broken.reason, 'search_error');
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await runTopicSourceVaultSweep(null, {
      now,
      listUsers: async () => ({ docs: [{ id: 'a', data: () => user() }] }),
      loadCards: async () => [],
      budgetAllowed: async () => true,
      collect: async ({ trace: row }) => {
        row.reason = 'scrape_empty';
        row.raw = 4;
        row.kept = 2;
        row.statuses = [403, 403];
        return null;
      }
    });
  } finally {
    console.log = original;
  }
  assert.equal(lines.includes('[Topic Vault Skip] reason=scrape_empty raw=4 kept=2 statuses=403,403'), true);
  assert.equal(lines.some(line => /https?:\/\//.test(line)), false);
});
