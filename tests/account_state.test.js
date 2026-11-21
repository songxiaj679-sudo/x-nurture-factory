'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeAccountState, formatAccountState, fitsAccountState, writingShape } = require('../src/customer_post_state');

test('missing official metrics stay unknown instead of zero', () => {
  const state = describeAccountState({ ok: false }, { aiTargetLang: 'ja', twitterMetrics: { followers_count: 0, following_count: 12 } });
  assert.equal(state.measured, false);
  assert.equal(state.followers, null);
  assert.equal(state.following, null);
  assert.match(formatAccountState(state, 'ja'), /フォロワー: 不明/);
});

test('premium can be longer and a hidden search result stays one short post', () => {
  const paid = describeAccountState({
    ok: true, username: 'velox', followers: 40, following: 10, subscriptionType: 'Premium'
  }, { aiTargetLang: 'en' });
  assert.equal(paid.subscription, 'premium');
  assert.equal(paid.maxChars, 1500);
  assert.equal(fitsAccountState(['x'.repeat(800)], paid), true);
  const hidden = describeAccountState({
    ok: true, username: 'velox', followers: 40, following: 10, subscriptionType: 'None'
  }, { searchIndexLevel: 'from_miss' });
  assert.equal(hidden.singleOnly, true);
  assert.equal(fitsAccountState(['短い投稿', '続き'], hidden), false);
  assert.equal(fitsAccountState(['短い投稿'], hidden), true);
  assert.deepEqual(writingShape(paid), { thread: false, count: 1, minCount: 1, maxCount: 1 });
  assert.deepEqual(writingShape(hidden), { thread: false, count: 1, minCount: 1, maxCount: 1 });
  const free = describeAccountState({
    ok: true, username: 'velox', followers: 10, following: 4, subscriptionType: 'None'
  }, { aiTargetLang: 'ja' });
  assert.deepEqual(writingShape(free), { thread: true, count: 2, minCount: 2, maxCount: 3 });
  assert.deepEqual(writingShape(free, { delivery: 'single' }), { thread: false, count: 1, minCount: 1, maxCount: 1 });
  assert.deepEqual(writingShape({ ...free, delivery: 'parent_self_reply' }), { thread: true, count: 2, minCount: 2, maxCount: 3 });
  assert.equal(fitsAccountState(['場面の話', '続きで提供を一度出す'], free), true);
  assert.equal(fitsAccountState(['長い1本'.repeat(40), '二本目'], paid), false);
});
