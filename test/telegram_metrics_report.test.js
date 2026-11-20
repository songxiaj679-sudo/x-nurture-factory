const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getJstDayWindow,
  getNextJstNineAt,
  summarizeYesterdayTweets,
  formatXApiFailure,
  countWebSignupsAndPaidUsers,
  buildDailyReportMessage
} = require('../src/telegram_metrics_report');

test('daily report windows use the previous Japan calendar day', () => {
  const now = new Date('2026-11-14T01:00:00.000Z');
  const window = getJstDayWindow(now);

  assert.equal(window.todayKey, '2026-11-14');
  assert.equal(window.yesterdayKey, '2026-11-13');
  assert.equal(window.yesterdayStart.toISOString(), '2026-11-12T15:00:00.000Z');
  assert.equal(window.todayStart.toISOString(), '2026-11-13T15:00:00.000Z');
  assert.equal(getNextJstNineAt(now).toISOString(), '2026-11-15T00:00:00.000Z');
});

test('tweet metrics include only yesterday posts in the JST window', () => {
  const window = getJstDayWindow(new Date('2026-11-14T01:00:00.000Z'));
  const summary = summarizeYesterdayTweets([
    {
      createdAt: '2026-11-13T14:59:59.000Z',
      metrics: { like_count: 2, reply_count: 1, retweet_count: 3, bookmark_count: 1 }
    },
    {
      createdAt: '2026-11-13T15:00:00.000Z',
      metrics: { like_count: 20, reply_count: 0, retweet_count: 0, bookmark_count: 0 }
    }
  ], window);

  assert.deepEqual(summary, { postCount: 1, likes: 2, replies: 1, reposts: 3, bookmarks: 1 });
});

test('X API failures are reported as actionable safe categories', () => {
  assert.equal(
    formatXApiFailure('公式API検証失敗: HTTP_401', 'brand'),
    '@brand: 認証エラー（401）。X公式APIを再接続してください。'
  );
  assert.match(formatXApiFailure('HTTP_403'), /権限エラー（403）/);
  assert.doesNotMatch(formatXApiFailure('unclassified sensitive detail'), /sensitive detail/);
});

test('business totals exclude Telegram-only accounts and report missing impressions honestly', () => {
  const window = getJstDayWindow(new Date('2026-11-14T01:00:00.000Z'));
  const signupDate = new Date('2026-11-13T02:00:00.000Z');
  const stats = countWebSignupsAndPaidUsers([
    { id: 'WEB-1', data: () => ({ email: 'one@example.com', createdAt: signupDate, planId: 'pro', planStatus: 'active' }) },
    { id: 'TG-1', data: () => ({ email: 'tg-1@telegram.local', createdAt: signupDate, planId: 'pro', planStatus: 'active' }) },
    { id: 'WEB-GOOGLE-D12E2479A76266AEA2B4', data: () => ({ email: 'internal@example.com', createdAt: signupDate, planId: 'business', planStatus: 'active' }) }
  ], window);
  const message = buildDailyReportMessage({
    window,
    ...stats,
    clicksYesterday: 4,
    xReport: { ok: true, username: 'brand', followers: 12, postCount: 1, likes: 3, replies: 1, reposts: 2, bookmarks: 0 }
  });

  assert.deepEqual(stats, { signupsYesterday: 1, activePaidUsers: 1 });
  assert.match(message, /新規登録（アカウント作成）: 1件/);
  assert.match(message, /決済済み人数ではありません/);
  assert.match(message, /自社の追跡リンク経由クリック: 4件/);
  assert.match(message, /インプレッション: 現在のAPI取得項目では未取得/);
});
