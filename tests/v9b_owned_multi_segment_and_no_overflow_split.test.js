'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { describeAccountState, writingShape } = require('../src/customer_post_state');
const { chooseGenesForPost } = require('../src/bandit_optimization_engine');
const { detectOverflowSplit } = require('../src/next_post_draft');

const visibleFree = { subscription: 'free', searchVisible: true, singleOnly: false, postShape: 'thread', maxChars: 140, lang: 'ja' };
const hidden = { ...visibleFree, singleOnly: true, searchVisible: false, postShape: 'single' };
const premium = { subscription: 'premium', singleOnly: false, postShape: 'single', maxChars: 900, lang: 'ja' };

test('indexed non-premium can post one part or two to three, with the short cap', () => {
  assert.deepEqual(writingShape(visibleFree, { delivery: 'single' }), { thread: false, count: 1, minCount: 1, maxCount: 1 });
  assert.deepEqual(writingShape({ ...visibleFree, delivery: 'parent_self_reply' }), { thread: true, count: 2, minCount: 2, maxCount: 3 });
  assert.equal(visibleFree.maxChars, 140);
  const english = describeAccountState({ ok: true, username: 'a', followers: 2, following: 1, subscriptionType: 'None' }, { aiTargetLang: 'en', searchIndexLevel: 'cleared' });
  assert.equal(english.maxChars, 270);
  assert.equal(english.singleOnly, false);
  assert.equal(hidden.maxChars, 140);
  assert.deepEqual(writingShape(hidden), { thread: false, count: 1, minCount: 1, maxCount: 1 });
  assert.deepEqual(writingShape(premium, { delivery: 'single' }), { thread: false, count: 1, minCount: 1, maxCount: 1 });
  assert.equal(writingShape({ ...premium, delivery: 'parent_self_reply' }).maxCount, 3);
  const one = chooseGenesForPost({ accountState: visibleFree, random: () => 0.9 });
  const series = chooseGenesForPost({ accountState: visibleFree, random: () => 0.1 });
  const unseen = chooseGenesForPost({ accountState: hidden, random: () => 0.1 });
  assert.equal(one.delivery, 'single');
  assert.equal(series.delivery, 'parent_self_reply');
  assert.equal(unseen.delivery, 'single');
});

test('overflow splits are rejected and finished parts pass', () => {
  assert.equal(detectOverflowSplit(['入口の紙が古いので', '先に見ます。'], false), true);
  assert.equal(detectOverflowSplit(['The hours were old,', 'so check the door.'], true), true);
  assert.equal(detectOverflowSplit(['入口の紙が古い。', '先に見る。', '見る。'], false), true);
  assert.equal(detectOverflowSplit(['入口の紙が古い。', '変えた日だけ先に見る。'], false), false);
  assert.equal(detectOverflowSplit(['入口の紙が古い。', '予定と紙がずれる。', '変えた日は、入口の前に立って紙の日付を一度だけ見る。'], false), false);
  assert.equal(detectOverflowSplit(['入口の紙が古い。'], false), false);
});

test('saved jobs and traces keep segment count and delivery', () => {
  const draft = fs.readFileSync('src/next_post_draft.js', 'utf8');
  const promo = fs.readFileSync('src/autonomous_promo_ai.js', 'utf8');
  assert.match(draft, /segmentCount: guarded\.tweets\.length/);
  assert.match(draft, /delivery: accountState && accountState\.delivery === 'parent_self_reply'/);
  assert.equal(promo.includes('segmentCount: drafted.segmentCount'), true);
  assert.equal(promo.includes("delivery: drafted.delivery || (genes && genes.delivery) || 'single'"), true);
  assert.match(promo, /generation_traces/);
});
