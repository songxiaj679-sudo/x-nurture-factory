'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRows, toCsv } = require('../scripts/export_own_account_metrics');

const user = {
  id: 'saas-1',
  data: { xUsername: 'alice', twitterId: '123', xOfficialCredentials: 'encrypted' }
};

test('集計は公式IDと投稿IDが一致する直近投稿だけを使い、欠損と0を区別する', async () => {
  const rows = await buildRows([{ username: '@Alice' }, { username: 'other' }], [user], async () => ({
    ok: true,
    user: { id: '123', username: 'Alice', metrics: { followers_count: 0 } },
    postedTweetIds: ['one', 'not-in-sample'],
    tweets: [
      { id: 'one', metrics: { like_count: 0, retweet_count: 2, reply_count: 1 } },
      { id: 'manual', metrics: { like_count: 100 } }
    ]
  }), () => new Date('2026-01-01T00:00:00Z'));
  assert.deepEqual(rows[0], ['alice', '取得済み（直近100件以内）', '2026-01-01T00:00:00.000Z',
    0, 2, 1, null, 0, 2, 1, null]);
  assert.equal(rows[1][1], '公式連携未確認');
  assert.equal(rows[1][3], '');
});

test('API失敗、照合不一致、連携候補重複では実績を出さない', async () => {
  const failed = await buildRows([{ username: 'alice' }], [user], async () => ({ ok: false, status: 429 }));
  assert.equal(failed[0][1], '公式API取得失敗 (HTTP 429)');
  assert.equal(failed[0][4], '');
  const wrong = await buildRows([{ username: 'alice' }], [user], async () => ({
    ok: true, user: { id: '999', username: 'alice' }, tweets: [], postedTweetIds: []
  }));
  assert.equal(wrong[0][1], '公式アカウント照合失敗');
  const duplicate = await buildRows([{ username: 'alice' }], [user, user], async () => {
    throw new Error('must not fetch ambiguous account');
  });
  assert.equal(duplicate[0][1], '連携候補が重複');
});

test('CSVは表計算の数式を無効化し、引用符をエスケープする', () => {
  const csv = toCsv([['=1+1', 'a,"b"', null]]);
  assert.match(csv, /"'=1\+1","a,""b""",\r\n/);
});
