const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const REPORT_STATE_ID = 'daily_business_metrics_report';
const DEFAULT_REPORT_OWNER_USER_ID = 'TG-8401260325';
const DEFAULT_X_OWNER_USER_ID = 'WEB-GOOGLE-D12E2479A76266AEA2B4';
const INTERNAL_ACCOUNT_IDS = new Set([
  DEFAULT_REPORT_OWNER_USER_ID,
  DEFAULT_X_OWNER_USER_ID,
  'USR-MVUA1GLP-D640'
]);

function getJstDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function getJstDateKey(date) {
  const { year, month, day } = getJstDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getJstDayWindow(now = new Date()) {
  const { year, month, day } = getJstDateParts(now);
  const todayStartMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  const yesterdayStartMs = todayStartMs - DAY_MS;
  return {
    todayKey: getJstDateKey(now),
    yesterdayKey: getJstDateKey(new Date(yesterdayStartMs + JST_OFFSET_MS)),
    yesterdayStart: new Date(yesterdayStartMs),
    todayStart: new Date(todayStartMs)
  };
}

function getNextJstNineAt(now = new Date()) {
  const { year, month, day } = getJstDateParts(now);
  let nextRunMs = Date.UTC(year, month - 1, day, 9) - JST_OFFSET_MS;
  if (nextRunMs <= now.getTime()) nextRunMs += DAY_MS;
  return new Date(nextRunMs);
}

function toMillis(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function summarizeYesterdayTweets(tweets, window) {
  const startMs = window.yesterdayStart.getTime();
  const endMs = window.todayStart.getTime();
  const matchingTweets = (Array.isArray(tweets) ? tweets : []).filter((tweet) => {
    const createdAt = toMillis(tweet.createdAt);
    return createdAt >= startMs && createdAt < endMs;
  });
  const sumMetric = (name) => matchingTweets.reduce((total, tweet) => {
    const value = Number(tweet.metrics && tweet.metrics[name]);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

  return {
    postCount: matchingTweets.length,
    likes: sumMetric('like_count'),
    replies: sumMetric('reply_count'),
    reposts: sumMetric('retweet_count'),
    bookmarks: sumMetric('bookmark_count')
  };
}

function formatXApiFailure(error, username = '') {
  const raw = String(error || '');
  const account = username ? `@${username}: ` : '';
  if (/401|unauthorized|認証失敗/i.test(raw)) {
    return `${account}認証エラー（401）。X公式APIを再接続してください。`;
  }
  if (/403|forbidden|権限不足/i.test(raw)) {
    return `${account}権限エラー（403）。X APIアプリの権限と利用プランを確認してください。`;
  }
  if (/429|rate.?limit/i.test(raw)) {
    return `${account}API利用上限（429）。時間をおいて再試行します。`;
  }
  if (/通信エラー|fetch failed|network/i.test(raw)) {
    return `${account}通信エラー。サーバーからX APIへ接続できませんでした。`;
  }
  if (/OAuth 1\.0/i.test(raw)) {
    return `${account}API資格情報が不足しています。OAuth 1.0の4項目を確認してください。`;
  }
  return `${account}API応答を検証できませんでした。サーバーログを確認してください。`;
}

function countWebSignupsAndPaidUsers(userDocs, window) {
  let signupsYesterday = 0;
  let activePaidUsers = 0;
  const startMs = window.yesterdayStart.getTime();
  const endMs = window.todayStart.getTime();

  for (const doc of userDocs) {
    if (doc.id.startsWith('TG-')) continue;
    const user = doc.data() || {};
    const email = String(user.email || '').trim().toLowerCase();
    if (
      INTERNAL_ACCOUNT_IDS.has(doc.id) ||
      user.isAdmin === true ||
      user.isOwner === true ||
      email.endsWith('@telegram.local')
    ) continue;

    const createdAt = toMillis(user.createdAt);
    if (createdAt >= startMs && createdAt < endMs) signupsYesterday++;

    if (user.planStatus === 'active' && user.planId && user.planId !== 'free') {
      activePaidUsers++;
    }
  }

  return { signupsYesterday, activePaidUsers };
}

function buildDailyReportMessage({
  window,
  signupsYesterday,
  activePaidUsers,
  clicksYesterday,
  xReport,
  previousFollowerCount
}) {
  const lines = [
    `📊 事業計測レポート（${window.yesterdayKey} JST）`,
    '',
    '【集客・利用】',
    `新規登録（アカウント作成）: ${signupsYesterday}件`,
    `有料プラン設定中: ${activePaidUsers}件（無料期間を含む。決済済み人数ではありません）`,
    `自社の追跡リンク経由クリック: ${clicksYesterday}件`
  ];

  if (!xReport || !xReport.ok) {
    lines.push('', `【X公式アカウント】${xReport && xReport.error ? xReport.error : '指標を取得できませんでした。'}`);
    return lines.join('\n');
  }

  const followerCount = xReport.followers == null ? NaN : Number(xReport.followers);
  const followerChange = Number.isFinite(previousFollowerCount) && Number.isFinite(followerCount)
    ? `（前回比 ${followerCount - previousFollowerCount >= 0 ? '+' : ''}${followerCount - previousFollowerCount}）`
    : '（比較用の初回記録）';

  lines.push(
    '',
    `【X公式アカウント @${xReport.username || 'unknown'}】`,
    `フォロワー: ${Number.isFinite(followerCount) ? followerCount : '未取得'}${followerChange}`,
    `昨日の投稿（取得できた直近20件）: ${xReport.postCount}件`,
    `昨日投稿分の現時点反応累計: いいね ${xReport.likes} / 返信 ${xReport.replies} / リポスト ${xReport.reposts} / ブックマーク ${xReport.bookmarks}`,
    'インプレッション: 現在のAPI取得項目では未取得'
  );
  return lines.join('\n');
}

async function sendDailyTelegramMetricsReport({ db, now = new Date() }) {
  const { tgApi } = require('./telegram_bot');
  const { decryptCredentials, getUserProfileAndRecentTweets } = require('./official_api_client');
  const { getClickStatsForUser } = require('./funnel_click_tracker');

  const window = getJstDayWindow(now);
  const stateRef = db.collection('settings').doc(REPORT_STATE_ID);
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
  if (state.lastSentDate === window.todayKey) return false;

  const ownerId = process.env.TELEGRAM_REPORT_OWNER_USER_ID || DEFAULT_REPORT_OWNER_USER_ID;
  const xOwnerId = process.env.TELEGRAM_REPORT_X_USER_ID || DEFAULT_X_OWNER_USER_ID;
  const ownerSnap = await db.collection('saas_users').doc(ownerId).get();
  const chatId = ownerSnap.exists ? ownerSnap.data().tgChatId : null;
  if (!chatId) throw new Error('Private Telegram report chat is not configured for the report owner.');

  const usersSnap = await db.collection('saas_users').get();
  const businessStats = countWebSignupsAndPaidUsers(usersSnap.docs, window);

  let xReport = { ok: false, error: 'X公式APIアカウントの設定が見つかりません。' };
  let followerCount = null;
  const xOwnerSnap = await db.collection('saas_users').doc(xOwnerId).get();
  const xOwner = xOwnerSnap.exists ? (xOwnerSnap.data() || {}) : {};
  const clickStats = getClickStatsForUser(xOwnerId, xOwner.lanes || {}, xOwner.clicksByDayJst || {});
  if (xOwner.xOfficialCredentials) {
    try {
      const credentials = decryptCredentials(xOwner.xOfficialCredentials);
      const result = await getUserProfileAndRecentTweets(credentials, 20);
      if (result && result.ok) {
        const xWindow = summarizeYesterdayTweets(result.tweets, window);
        const rawFollowerCount = result.user && result.user.metrics && result.user.metrics.followers_count;
        followerCount = rawFollowerCount == null ? null : Number(rawFollowerCount);
        xReport = {
          ok: true,
          username: (result.user && result.user.username) || credentials.username || '',
          followers: followerCount,
          ...xWindow
        };
      } else {
        xReport = {
          ok: false,
          error: formatXApiFailure(result && result.error, credentials.username)
        };
        console.error('[Telegram Daily Metrics Report] X API lookup failed:', result && result.error);
      }
    } catch (error) {
      xReport = { ok: false, error: formatXApiFailure(error.message) };
      console.error('[Telegram Daily Metrics Report] X metrics failed:', error.message);
    }
  }

  const message = buildDailyReportMessage({
    window,
    ...businessStats,
    clicksYesterday: clickStats.clicksYesterday || 0,
    xReport,
    previousFollowerCount: state.previousFollowerCount
  });
  const response = await tgApi('sendMessage', {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true
  });
  if (!response || response.ok !== true) {
    throw new Error('Telegram rejected the daily metrics report.');
  }

  await stateRef.set({
    lastSentDate: window.todayKey,
    previousFollowerCount: xReport.ok && Number.isFinite(followerCount) ? followerCount : null,
    updatedAt: new Date()
  }, { merge: true });
  return true;
}

function startDailyTelegramMetricsReport({ db }) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram Daily Metrics Report] TELEGRAM_BOT_TOKEN is missing; scheduler was not started.');
    return () => {};
  }

  let timer = null;
  let stopped = false;
  const schedule = (delayMs) => {
    if (stopped) return;
    timer = setTimeout(run, Math.max(1000, delayMs));
  };
  const run = async () => {
    try {
      await sendDailyTelegramMetricsReport({ db });
      schedule(getNextJstNineAt().getTime() - Date.now());
    } catch (error) {
      console.error('[Telegram Daily Metrics Report] Send failed:', error.message);
      schedule(15 * 60 * 1000);
    }
  };

  schedule(getNextJstNineAt().getTime() - Date.now());
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = {
  getJstDayWindow,
  getNextJstNineAt,
  summarizeYesterdayTweets,
  formatXApiFailure,
  countWebSignupsAndPaidUsers,
  buildDailyReportMessage,
  sendDailyTelegramMetricsReport,
  startDailyTelegramMetricsReport
};
