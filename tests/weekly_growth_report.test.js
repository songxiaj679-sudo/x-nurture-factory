'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWeeklyGrowthReport } = require('../src/weekly_growth_report');

const now = new Date('2026-07-14T12:00:00.000Z');

test('weekly report compares slots only from recent frozen 24-hour snapshots', () => {
  const report = buildWeeklyGrowthReport({
    now,
    posts: [
      { postedAt: new Date('2026-07-13T12:00:00.000Z'), slotId: 'morning', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 10 } },
      { postedAt: new Date('2026-07-12T12:00:00.000Z'), slotId: 'evening', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 2 } },
      { postedAt: new Date('2026-07-11T12:00:00.000Z'), slotId: 'morning', metrics24hSnapshot: { isFrozen: false, impressions: 100, bookmarks: 50 } },
      { postedAt: new Date('2026-07-01T12:00:00.000Z'), slotId: 'noon', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 80 } }
    ]
  });

  assert.equal(report.totalPosts, 3);
  assert.equal(report.measuredPosts, 2);
  assert.equal(report.impressions, 200);
  assert.equal(report.bookmarks, 12);
  assert.equal(report.bestSlotAnalysis.slotName, 'morning (1件)');
  assert.equal(report.worstSlotAnalysis.slotName, 'evening (1件)');
  assert.match(report.bestSlotAnalysis.reason, /因果効果を示すものではありません/u);
  assert.equal(report.councilScore, null);
});

test('weekly report makes no slot comparison when measured data is unavailable or has one slot', () => {
  const report = buildWeeklyGrowthReport({
    now,
    posts: [
      { postedAt: now, slotId: 'morning', metrics24hSnapshot: { isFrozen: false, impressions: 100, bookmarks: 2 } },
      { postedAt: now, slotId: 'morning', metrics24hSnapshot: { isFrozen: true, impressions: 0, bookmarks: 0 } }
    ]
  });

  assert.equal(report.totalPosts, 2);
  assert.equal(report.measuredPosts, 0);
  assert.equal(report.bestSlotAnalysis, null);
  assert.equal(report.worstSlotAnalysis, null);
  assert.match(report.weekSummary_en, /not measured/u);
  assert.ok(Array.isArray(report.nextWeekDirectives_en));
});

test('timeSlot is used when the older slot fields are absent', () => {
  const report = buildWeeklyGrowthReport({
    now,
    posts: [
      { postedAt: new Date('2026-07-13T12:00:00.000Z'), timeSlot: 'morning', metrics24hSnapshot: { isFrozen: true, impressions: 200, bookmarks: 20 } },
      { postedAt: new Date('2026-07-12T12:00:00.000Z'), timeSlot: 'night', metrics24hSnapshot: { isFrozen: true, impressions: 200, bookmarks: 2 } }
    ]
  });
  assert.equal(report.bestSlotAnalysis.slotName, 'morning (1件)');
  assert.equal(report.worstSlotAnalysis.slotName, 'night (1件)');
});

test('weekly report shows live impressions while slot comparison stays unmeasured', () => {
  const report = buildWeeklyGrowthReport({
    now,
    posts: [
      { postedAt: now, slotId: 'morning', metrics: { impressions: 120, bookmarks: 4 }, metrics24hSnapshot: { isFrozen: false, impressions: 120, bookmarks: 4 } }
    ]
  });
  assert.equal(report.measuredPosts, 0);
  assert.equal(report.bestSlotAnalysis, null);
  assert.equal(report.worstSlotAnalysis, null);
  assert.equal(report.councilScore, null);
  assert.match(report.weekSummary, /累計表示 120件/);
  assert.match(report.weekSummary_en, /120 live impressions/);
  assert.match(report.weekSummary_en, /not measured/u);
});

test('weekly report rejects malformed inputs', () => {
  assert.throws(() => buildWeeklyGrowthReport({ posts: null, now }), TypeError);
  assert.throws(() => buildWeeklyGrowthReport({ posts: [], now: new Date('invalid') }), TypeError);
});
