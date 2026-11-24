'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topicVaultEligibility, WEEKLY_ARTICLE_CAP } = require('../src/topic_source_vault');
const { briefPrompt, candidatePrompt, systemRules, criticSystemRules } = require('../src/next_post_draft');

const now = new Date('2026-11-24T10:20:00.000Z');
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const seasonLine = '一次原典に無い季節行事や年中行事（年末、お正月、連休など）は足さない。';

function user(extra = {}) {
  return {
    planId: 'business',
    targetUrl: 'https://customer.example/home',
    brandKnowledge: { icpSummary: 'Xを事業の集客に使う人', domainProblems: ['投稿の順番'] },
    ...extra
  };
}

function fit(hoursAgo, extra = {}) {
  return {
    fetchedAt: new Date(now.getTime() - hoursAgo * hour).toISOString(),
    usedCount: 1,
    plainTranslation: '安く取れたデータは条件が変わると取れない。',
    ...extra
  };
}

test('a mismatch card and a legacy card do not fill the weekly cap', () => {
  const cards = [
    fit(6, { audienceFit: 'mismatch', excludedReason: 'reader_practice_gap', plainTranslation: 'デマっぽい投稿が先に広がる。', coreFact: '低信頼性の投稿は先に広がる。' }),
    { fetchedAt: new Date(now.getTime() - 78 * hour).toISOString(), usedCount: 2 },
    fit(51)
  ];
  const decision = topicVaultEligibility({ user: user(), cards, now });
  assert.equal(WEEKLY_ARTICLE_CAP.business, 7);
  assert.equal(decision.weeklyCount, 1);
  assert.equal(decision.ok, true);
  assert.equal(decision.reason, 'ready');
});

test('business weekly cap trips at seven fit cards and stays open at six', () => {
  const six = [1, 2, 3, 4, 5, 6].map(index => fit(index * 24));
  const open = topicVaultEligibility({ user: user(), cards: six, now });
  assert.equal(open.weeklyCount, 6);
  assert.equal(open.reason, 'ready');
  const seven = [1, 2, 3, 4, 5, 6, 7].map(index => fit(index * 24));
  const closed = topicVaultEligibility({ user: user(), cards: seven, now });
  assert.equal(closed.weeklyCount, 7);
  assert.equal(closed.ok, false);
  assert.equal(closed.reason, 'weekly_cap');
  assert.equal(topicVaultEligibility({ user: user({ planId: 'pro' }), cards: six.slice(0, 3), now }).reason, 'weekly_cap');
  assert.equal(topicVaultEligibility({ user: user({ planId: 'starter' }), cards: six.slice(0, 2), now }).reason, 'weekly_cap');
  assert.equal(topicVaultEligibility({ user: user({ planId: 'free' }), cards: six.slice(0, 1), now }).reason, 'weekly_cap');
});

test('an hour-old fetch still waits out the empty-stock gap', () => {
  const recent = [{ fetchedAt: new Date(now.getTime() - hour).toISOString(), usedCount: 2 }];
  const decision = topicVaultEligibility({ user: user(), cards: recent, now });
  assert.equal(decision.weeklyCount, 0);
  assert.equal(decision.reason, 'interval');
  assert.equal(decision.minGapMs, 3 * hour);
});

test('a topic source prompt refuses a seasonal event that the source does not state', () => {
  const card = { coreFact: 'APIの有料化のあと研究利用は減った。', plainTranslation: '安く取れたデータは条件が変わると取れない。' };
  const shared = {
    isEn: false,
    accountState: { maxChars: 900, delivery: 'single', lang: 'ja' },
    shape: { count: 2, maxCount: 2 },
    masterPlan: { topicRing: 'ring1_craft', isolateLpContext: true },
    topicSource: card,
    domainSlot: true,
    decision: { endingMove: 'verdict_cut' }
  };
  const brief = briefPrompt(shared);
  const prompt = candidatePrompt({ ...shared, brief: { readerPayoff: '何を先に見るか' } });
  assert.match(brief, new RegExp(seasonLine));
  assert.match(prompt, new RegExp(seasonLine));
  const dossier = briefPrompt({ ...shared, topicSource: null });
  assert.equal(dossier.includes(seasonLine), false);
  assert.equal(criticSystemRules(false).length < 400, true);
  assert.equal(systemRules(false).length > 0, true);
  assert.equal(prompt.length > brief.length, true);
});
