'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeResidualRewards, decideEarlyAction } = require('../src/metrics_harvest_engine');
const { chooseGenesForPost } = require('../src/bandit_optimization_engine');
const { buildWeeklyGrowthReport } = require('../src/weekly_growth_report');

test('three impressions and one save do not outweigh five thousand impressions', () => {
  const rewards = computeResidualRewards([
    { metrics24hSnapshot: { isFrozen: true, impressions: 3, bookmarks: 1, replies: 0, quotes: 0, retweets: 0, likes: 0 } },
    { metrics24hSnapshot: { isFrozen: true, impressions: 5000, bookmarks: 100, replies: 0, quotes: 0, retweets: 0, likes: 0 } }
  ]);
  assert.equal(rewards.length, 2);
  assert.ok(rewards[0].evidence < rewards[1].evidence);
});

test('learning keeps an angle after the page version changes', () => {
  const rewards = computeResidualRewards([
    {
      pageVersion: 'old',
      timeSlot: 'morning',
      genes: { angle: 'practical_steps' },
      metrics24hSnapshot: { isFrozen: true, impressions: 200, bookmarks: 20, replies: 4, quotes: 0, retweets: 0, likes: 10 }
    },
    {
      pageVersion: 'new',
      timeSlot: 'morning',
      genes: { angle: 'practical_steps' },
      metrics24hSnapshot: { isFrozen: true, impressions: 180, bookmarks: 16, replies: 3, quotes: 0, retweets: 0, likes: 8 }
    }
  ]);
  assert.equal(rewards.length, 2);
  assert.equal(rewards[1].post.pageVersion, 'new');
});

test('a stalled early result asks for a different angle and a strong one keeps the claim', () => {
  assert.equal(decideEarlyAction([], { impressions: 12, bookmarks: 0, replies: 0, postAgeHours: 5 }), 'pivot_angle');
  const ordinary = { impressions: 100, bookmarks: 2, replies: 0, postAgeHours: 3 };
  const another = { impressions: 100, bookmarks: 3, replies: 0, postAgeHours: 3 };
  const strong = { impressions: 400, bookmarks: 40, replies: 10, postAgeHours: 3 };
  assert.equal(decideEarlyAction([ordinary, another, strong], strong), 'deepen_winner');
  const genes = chooseGenesForPost({
    posts: [],
    constraints: { lockClaim: 'claim_a', avoid: { angle: 'practical_steps', hookType: 'scene_trigger' } },
    random: () => 0.4
  });
  assert.equal(genes.claimSemanticKey, 'claim_a');
  assert.notEqual(genes.angle, 'practical_steps');
  assert.notEqual(genes.hookType, 'scene_trigger');
});

test('the weekly report lists gene counts without calling them a cause', () => {
  const now = new Date('2026-11-18T00:00:00Z');
  const report = buildWeeklyGrowthReport({
    now,
    posts: [{
      postedAt: '2026-11-17T00:00:00Z',
      genes: { angle: 'practical_steps' },
      metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 5 }
    }]
  });
  assert.equal(report.geneSummary[0].angle, 'practical_steps');
  assert.match(report.geneSummary[0].note, /因果を示すものではありません/);
});
