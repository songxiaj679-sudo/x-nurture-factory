'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GENE_SPACES, chooseGenesForPost, applyGeneRewardBatch } = require('../src/bandit_optimization_engine');
const { selectWeeklyWildcard, evaluateWildcardPromotions, recipeLine } = require('../src/wildcard_evolution');
const { detectOverflowSplit, candidatePrompt } = require('../src/next_post_draft');
const { runDeterministicAudit } = require('../src/draft_verifier');

const visible = { searchVisible: true, singleOnly: false, postShape: 'thread', subscription: 'free', maxChars: 140, lang: 'ja' };
const plan = { topicRing: 'ring1_craft', isolateLpContext: true };
const now = new Date('2026-11-21T08:00:00.000Z');

function posted(daysAgo, extra = {}) {
  return { status: 'posted', postedAt: new Date(now.getTime() - daysAgo * 86400000).toISOString(), metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 1 }, ...extra };
}

test('a wildcard opens once a week and stays off the unsafe cases', () => {
  const ready = selectWeeklyWildcard({ accountState: visible, masterPlan: plan, jobs: [posted(3), posted(2)], now });
  assert.equal(typeof ready.id, 'string');
  assert.equal(selectWeeklyWildcard({ accountState: visible, masterPlan: plan, jobs: [posted(1, { isWildcard: true })], now }), null);
  assert.equal(selectWeeklyWildcard({ accountState: visible, masterPlan: { topicRing: 'ring3_product_bridge' }, jobs: [posted(2), posted(1)], now }), null);
  assert.equal(selectWeeklyWildcard({ accountState: { ...visible, singleOnly: true, searchVisible: false }, masterPlan: plan, jobs: [posted(2), posted(1)], now }), null);
  assert.equal(selectWeeklyWildcard({ accountState: visible, masterPlan: plan, jobs: [{ status: 'posted', postedAt: now.toISOString() }], now }), null);
});

test('two wins promote a recipe, three recent losses retire it, and four is the cap', () => {
  const win = (id, residual, stamp) => ({ wildcardRecipe: id, createdAt: stamp, outcome24h: { residualReward: residual } });
  assert.deepEqual(evaluateWildcardPromotions([win('wc_failure_autopsy', 0.2, '2026-11-01')], []), []);
  assert.deepEqual(evaluateWildcardPromotions([
    win('wc_failure_autopsy', 0.2, '2026-11-01'),
    win('wc_failure_autopsy', 0.1, '2026-11-02')
  ], []), ['wc_failure_autopsy']);
  const retired = evaluateWildcardPromotions([
    win('wc_failure_autopsy', 0.4, '2026-11-01'),
    win('wc_failure_autopsy', -0.2, '2026-11-02'),
    win('wc_failure_autopsy', -0.3, '2026-11-03'),
    win('wc_failure_autopsy', -0.4, '2026-11-04')
  ], ['wc_failure_autopsy']);
  assert.deepEqual(retired, []);
  const many = ['wc_cross_domain_analogy', 'wc_sacred_cow_inversion', 'wc_failure_autopsy', 'wc_reverse_metric_lens']
    .flatMap(id => [win(id, 0.3, '2026-11-01'), win(id, 0.2, '2026-11-02')]);
  assert.equal(evaluateWildcardPromotions(many, []).length, 4);
});

test('promoted recipes join the live choices without rewriting the constant list', () => {
  const before = GENE_SPACES.angle.slice();
  const chosen = chooseGenesForPost({
    accountState: visible,
    constraints: { promotedDynamicArms: ['wc_cross_domain_analogy', 'not_a_recipe'] },
    random: () => 0.99
  });
  assert.deepEqual(GENE_SPACES.angle, before);
  assert.equal(before.includes(chosen.angle) || chosen.angle === 'wc_cross_domain_analogy', true);
  const learned = applyGeneRewardBatch([
    { post: { timeSlot: 'evening', genes: { angle: 'wc_cross_domain_analogy' } }, weight: 1, residual: 1 }
  ], 'evening');
  assert.equal(learned.account.wc_cross_domain_analogy.alpha, 1);
  const prompt = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { count: 1, maxCount: 1, thread: false },
    accountState: { ...visible, delivery: 'single', maxChars: 140 },
    genes: { angle: 'wc_cross_domain_analogy', wildcardRecipe: 'wc_cross_domain_analogy', isWildcard: true, delivery: 'single' }
  });
  assert.equal(prompt.includes(recipeLine('wc_cross_domain_analogy', false)), true);
});

test('a wildcard still fails a split and a copy of a recent post', () => {
  assert.equal(detectOverflowSplit(['入口の紙が古いので', '先に見ます。'], false), true);
  const recent = '入口の紙が古い。変えた日だけ先に見る。';
  const audit = runDeterministicAudit({ tweets: [recent] }, {
    lang: 'ja',
    recentTexts: [recent],
    genes: { angle: 'wc_sacred_cow_inversion', isWildcard: true },
    accountState: { postShape: 'single', subscription: 'premium', maxChars: 900, singleOnly: false }
  });
  assert.equal(audit.reasons.includes('too_similar_to_recent'), true);
});
