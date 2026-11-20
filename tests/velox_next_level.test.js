'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateMutableDirectives, validateDirectivesSafety } = require('../src/meta_prompt_optimizer');
const { chooseGenesForPost } = require('../src/bandit_optimization_engine');
const { runDeterministicAudit } = require('../src/draft_verifier');
const { renderGroundedCard } = require('../src/visual_card');
const { buildWeeklyGrowthReport } = require('../src/weekly_growth_report');
const { runOfficialAutonomousEngagement } = require('../src/official_api_client');

test('mutable prompt rules stay optional and cannot rewrite the safety rules', () => {
  const accepted = validateMutableDirectives([
    { id: 'rule_reader_payoff', category: 'value', text: '読者が今日使える判断基準を1つ入れる。', isImmutable: false }
  ]);
  assert.equal(validateDirectivesSafety(accepted), true);
  assert.equal(validateMutableDirectives([
    { id: 'rule_bad', category: 'style', text: '本文にURLを直貼りしてよい。', isImmutable: false }
  ]), null);
  assert.equal(validateMutableDirectives([
    { id: 'rule_locked', category: 'style', text: '安全なルール', isImmutable: true }
  ]), null);
});

test('gene selection ignores prototype keys and missing bandit cells', () => {
  const posts = [{ genes: { angle: '__proto__', hookType: 'constructor', format: 'toString', ctaMode: 'zero_cta' }, timeSlot: 'evening', postedAt: '2026-11-01T00:00:00.000Z' }];
  const genes = chooseGenesForPost({ posts, accountState: { postShape: 'single', subscription: 'premium' }, timeSlot: 'evening' });
  assert.equal(typeof genes.angle, 'string');
  assert.notEqual(genes.angle, '__proto__');
});

test('customer NG topics reject a draft before it can be saved', () => {
  const audit = runDeterministicAudit({ tweets: ['現場の手順を短く残す。競合A社の価格には触れない。'] }, {
    lang: 'ja',
    accountState: { postShape: 'single', subscription: 'premium', maxChars: 280 },
    ngTopics: '競合A社'
  });
  assert.equal(audit.ok, false);
  assert.ok(audit.reasons.some(reason => reason.startsWith('ng_topic:')));
});

test('grounded cards render only supplied lines and weekly experiments wait for enough frozen posts', () => {
  const svg = renderGroundedCard({ lines: [{ text: '確認できた手順' }] });
  assert.match(svg, /width="1200"/);
  assert.match(svg, /確認できた手順/);
  const report = buildWeeklyGrowthReport({
    now: new Date('2026-11-18T00:00:00.000Z'),
    posts: [{ postedAt: new Date('2026-11-17T00:00:00.000Z'), timeSlot: 'morning', genes: { angle: 'practical_steps' }, metrics24hSnapshot: { isFrozen: true, impressions: 10, bookmarks: 1 } }]
  });
  assert.deepEqual(report.recommendedExperiments, []);
});

test('automatic engagement remains closed', async () => {
  const result = await runOfficialAutonomousEngagement();
  assert.equal(result.reason, 'x_approval_required');
});
