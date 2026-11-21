'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compositeEngagementScore, computeResidualRewards } = require('../src/metrics_harvest_engine');
const { buildFrozenOutcome, classifyTraceCalibration, summarizeCriticCalibration } = require('../src/critic_calibration');
const { rememberFrozenOutcome } = require('../src/autonomous_promo_ai');

function snap(impressions, bookmarks, extra = {}) {
  return { isFrozen: true, impressions, bookmarks, replies: 0, quotes: 1, retweets: 2, likes: 3, ...extra };
}

function axes(score, hook) {
  return { scrollStopHook: hook, saveUtility: 15, strangerClarity: 15, craftAndTruth: 15, score, weakness: '' };
}

test('a frozen outcome stores the same composite as the bandit and a centered residual', () => {
  const older = { jobId: 'old', postedAt: '2026-11-01T00:00:00.000Z', metrics24hSnapshot: snap(1000, 1) };
  const currentSnap = snap(1000, 40);
  const current = { jobId: 'new', postedAt: '2026-11-02T00:00:00.000Z', metrics24hSnapshot: currentSnap };
  const outcome = buildFrozenOutcome(currentSnap, [current, older], 'new');
  const rewards = computeResidualRewards([older, current]);
  assert.equal(outcome.quotes, 1);
  assert.equal(outcome.retweets, 2);
  assert.equal(outcome.compositeReward, compositeEngagementScore(currentSnap).rate);
  assert.equal(outcome.residualReward, rewards[1].residual - 0.5);
  assert.equal(buildFrozenOutcome(currentSnap, [current], 'new').residualReward, null);
});

test('calibration classifies the four verdicts and skips a missing score', async () => {
  const saved = [];
  const database = {
    collection() {
      return { doc() { return {
        async get() {
          return { exists: true, data: () => ({ criticDegraded: false, criticAxes: axes(85, 20) }) };
        },
        set(payload) { saved.push(payload); return Promise.resolve(); }
      }; } };
    }
  };
  const posts = [
    { jobId: 'old', postedAt: '2026-11-01T00:00:00.000Z', metrics24hSnapshot: snap(1000, 40) },
    { jobId: 'new', postedAt: '2026-11-02T00:00:00.000Z', metrics24hSnapshot: snap(1000, 1) }
  ];
  const payload = await rememberFrozenOutcome('new', posts[1].metrics24hSnapshot, { db: database, posts });
  assert.equal(payload.calibration.verdict, 'false_positive_honors');
  assert.equal(payload.outcome24h.quotes, 1);
  assert.equal(classifyTraceCalibration({ criticDegraded: false, criticAxes: axes(70, 10) }, 0.2).verdict, 'hidden_gem');
  assert.equal(classifyTraceCalibration({ criticDegraded: false, criticAxes: axes(85, 10) }, 0.2).verdict, 'aligned_win');
  assert.equal(classifyTraceCalibration({ criticDegraded: false, criticAxes: axes(70, 10) }, -0.2).verdict, 'aligned_loss');
  assert.equal(classifyTraceCalibration({ criticDegraded: false, criticAxes: null }, 0.2), null);
  assert.equal(classifyTraceCalibration({ criticDegraded: true, criticAxes: axes(85, 10) }, -0.2), null);
  assert.equal(classifyTraceCalibration({ criticDegraded: false, criticAxes: axes(85, 10) }, null), null);
  assert.equal(saved.length, 1);
});

test('calibration summary waits for five traces and then names the inverted axis', () => {
  const residuals = [-0.4, -0.2, 0, 0.2, 0.4];
  const traces = residuals.map((residual, index) => ({
    criticDegraded: false,
    criticAxes: {
      scrollStopHook: 25 - index,
      saveUtility: 10 + index * 2,
      strangerClarity: 15,
      craftAndTruth: 15,
      score: 85
    },
    outcome24h: { residualReward: residual }
  }));
  assert.equal(summarizeCriticCalibration(traces.slice(0, 4)).status, 'insufficient_data');
  assert.equal(summarizeCriticCalibration(traces.slice(0, 4)).sampleCount, 4);
  const summary = summarizeCriticCalibration(traces.concat([{ criticDegraded: true, criticAxes: axes(90, 1), outcome24h: { residualReward: -1 } }]));
  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.overratedAxis, 'scrollStopHook');
  assert.equal(summary.predictiveAxis, 'saveUtility');
  assert.equal(summary.axisCorrelations.strangerClarity, 0);
  assert.equal(summary.falsePositiveRate, 0.4);
  assert.equal(summary.counts.false_positive_honors, 2);
  assert.equal(summary.counts.aligned_win, 3);
});
