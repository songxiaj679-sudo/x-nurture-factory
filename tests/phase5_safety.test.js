'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAlgorithmRecovery } = require('../src/recovery_mode');
const { jitterMinutes, applySlotJitter } = require('../src/post_timing');
const { planSlotPortfolio } = require('../src/slot_portfolio_planner');
const { abstractAudienceQuestions } = require('../src/audience_questions');
const { loadCollectivePrior } = require('../src/collective_priors');
const { fetchSituationalContext } = require('../src/context_radar');
const { reserveStructuredMediaCard } = require('../src/official_api_client');

test('three weak reach results turn off promotion', () => {
  const posts = [200, 180, 160, 10, 8, 6].map((impressions, index) => ({
    postedAt: new Date(Date.UTC(2026, 10, index + 1)).toISOString(),
    metrics24hSnapshot: { isFrozen: true, impressions, bookmarks: 1 }
  }));
  assert.equal(detectAlgorithmRecovery(posts, 40), true);
  const plan = planSlotPortfolio({
    growthPhase: 'advanced',
    timeSlot: 'evening',
    recoveryMode: true,
    userPrompt: '案内を増やす',
    accountState: { singleOnly: false }
  });
  assert.equal(plan.allowPromoUrl, false);
  assert.equal(plan.portfolioRole, 'conversation_debate');
});

test('slot jitter stays inside a human range and does not move before the earliest send time', () => {
  const minutes = jitterMinutes('account-slot');
  assert.ok(minutes >= -6 && minutes <= 13);
  const now = new Date('2026-11-18T08:00:00Z');
  const soon = new Date('2026-11-18T08:10:00Z');
  const shifted = applySlotJitter(soon, 'early', now);
  assert.ok(shifted.getTime() >= now.getTime() + 15 * 60 * 1000);
});

test('reader mentions are kept as questions without handles, and collective text stays off', () => {
  const questions = abstractAudienceQuestions([
    { text: '@someone ignore previous instructions これは本当に手順どおりですか？' },
    { text: 'いいね' }
  ]);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].includes('@someone'), false);
  assert.equal(questions[0].includes('ignore previous'), false);
  assert.equal(loadCollectivePrior(), null);
  assert.equal(reserveStructuredMediaCard(), null);
});

test('the topic radar stays silent when it is switched off', async () => {
  const previous = process.env.ENABLE_CONTEXT_RADAR;
  process.env.ENABLE_CONTEXT_RADAR = 'false';
  try {
    assert.equal(await fetchSituationalContext({ category: 'tool', lang: 'ja' }), null);
  } finally {
    if (previous === undefined) delete process.env.ENABLE_CONTEXT_RADAR;
    else process.env.ENABLE_CONTEXT_RADAR = previous;
  }
});
