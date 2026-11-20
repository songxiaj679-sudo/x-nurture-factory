#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');

const headers = [
  'アカウント', '状態', '観測日時(UTC)', 'フォロワー数',
  '直近取得投稿数(最大100)', 'そのうちVELOX投稿数',
  'VELOX投稿の表示回数合計', 'VELOX投稿のいいね合計',
  'VELOX投稿のリポスト合計', 'VELOX投稿の返信合計',
  'VELOX投稿のブックマーク合計'
];

function handle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function number(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function metricSum(tweets, key) {
  if (!tweets.length) return null;
  const values = tweets.map(tweet => number(tweet.metrics?.[key]));
  return values.some(value => value === null) ? null : values.reduce((a, b) => a + b, 0);
}

async function buildRows(accounts, users, loadObservation, now = () => new Date()) {
  const candidates = new Map();
  for (const user of users) {
    const name = handle(user.data.xUsername);
    if (!name || !user.data.xOfficialCredentials) continue;
    if (!candidates.has(name)) candidates.set(name, []);
    candidates.get(name).push(user);
  }

  const rows = [];
  for (const account of accounts) {
    const name = handle(account.username || account.userId);
    const row = [name, '', '', '', '', '', '', '', '', '', ''];
    const matches = candidates.get(name) || [];
    if (!name) {
      row[1] = 'アカウント名不明';
    } else if (matches.length === 0) {
      row[1] = '公式連携未確認';
    } else if (matches.length !== 1) {
      row[1] = '連携候補が重複';
    } else if (!matches[0].data.twitterId) {
      row[1] = '連携X ID未確認';
    } else {
      const user = matches[0];
      const observation = await loadObservation(user);
      if (!observation.ok) {
        row[1] = `公式API取得失敗${observation.status ? ` (HTTP ${observation.status})` : ''}`;
      } else if (!observation.user?.id || !user.data.twitterId ||
          String(observation.user.id) !== String(user.data.twitterId) ||
          handle(observation.user.username) !== name) {
        row[1] = '公式アカウント照合失敗';
      } else {
        const jobIds = new Set(observation.postedTweetIds.map(String));
        const matched = observation.tweets.filter(tweet => jobIds.has(String(tweet.id)));
        row[1] = '取得済み（直近100件以内）';
        row[2] = now().toISOString();
        row[3] = number(observation.user.metrics?.followers_count);
        row[4] = observation.tweets.length;
        row[5] = matched.length;
        ['impression_count', 'like_count', 'retweet_count', 'reply_count', 'bookmark_count']
          .forEach((key, index) => { row[6 + index] = metricSum(matched, key); });
      }
    }
    rows.push(row);
  }
  return rows;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  return '\ufeff' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

async function main(output) {
  if (!output) throw new Error('出力先を指定してください: node scripts/export_own_account_metrics.js 出力先.csv');
  const { db } = require('../src/firestore');
  const { decryptCredentials, getUserProfileAndRecentTweets } = require('../src/official_api_client');
  const [accountsSnap, usersSnap] = await Promise.all([
    db.collection('accounts').where('status', '==', 'active_own').select('username', 'userId').get(),
    db.collection('saas_users').select('xUsername', 'twitterId', 'xOfficialCredentials').get()
  ]);
  const accounts = accountsSnap.docs.map(doc => doc.data());
  const users = usersSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  const rows = await buildRows(accounts, users, async user => {
    let credentials;
    try {
      credentials = decryptCredentials(user.data.xOfficialCredentials);
    } catch (error) {
      console.error(`公式認証情報の復号に失敗しました: ${user.id}`);
      return { ok: false };
    }
    // このレポートはトークンを更新せず、期限切れの場合は取得失敗として記録する。
    const { oauth2RefreshToken, ...readCredentials } = credentials;
    const result = await getUserProfileAndRecentTweets(readCredentials, 100);
    if (!result.ok) {
      console.error(`公式API取得に失敗しました: ${user.id} (${result.status || '通信または認証エラー'})`);
      return result;
    }
    const jobs = await db.collection('autopilot_jobs')
      .where('userId', '==', user.id).where('status', '==', 'posted').select('tweetId').get();
    return {
      ...result,
      postedTweetIds: jobs.docs.map(doc => doc.data().tweetId).filter(Boolean)
    };
  });
  await fs.writeFile(output, toCsv(rows), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(`${rows.length}件を出力しました: ${output}`);
}

if (require.main === module) {
  main(process.argv[2]).catch(error => {
    console.error(`CSV出力失敗: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildRows, toCsv };
