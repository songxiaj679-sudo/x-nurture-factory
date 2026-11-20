'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAccountGrowthReport } = require('../src/account_growth_report');

test('growth report aggregates only recent frozen post metrics and makes no outcome estimates', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  const result = buildAccountGrowthReport({
    handle: '@sample',
    hasApi: true,
    now,
    posts: [
      { postedAt: new Date('2026-11-01T00:00:00Z'), metrics24hSnapshot: { isFrozen: true, impressions: 1200, bookmarks: 12 } },
      { postedAt: new Date('2026-10-01T00:00:00Z'), metrics24hSnapshot: { isFrozen: true, impressions: 9000, bookmarks: 900 } },
      { postedAt: new Date('2026-11-02T00:00:00Z'), metrics24hSnapshot: { isFrozen: false, impressions: 5000, bookmarks: 50 } }
    ]
  });

  assert.equal(result.handle, 'sample');
  assert.equal(result.score, null);
  assert.equal(result.telemetry.pastMonthReach, '1,200 imp');
  assert.equal(result.telemetry.observedPosts, '1');
  assert.equal(result.telemetry.bookmarkRate, '1.000%');
  assert.equal(result.telemetry.potentialReach, undefined);
  assert.equal(result.council.algoAuditor.score, null);
});

test('growth report clearly labels missing measurement and supports English', () => {
  const report = buildAccountGrowthReport({
    handle: 'sample',
    hasApi: false,
    posts: [],
    now: new Date('2026-11-15T00:00:00Z'),
    isEn: true
  });
  assert.equal(report.score, null);
  assert.equal(report.grade, 'Not scored');
  assert.equal(report.telemetry.pastMonthReach, 'Not measured');
  assert.equal(report.telemetry.bookmarkRate, 'Not measured');
});
