'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { replyPassesSafety } = require('../src/auto_reply_policy');
const { passesOutboundSafety, buildOutboundCandidate } = require('../src/outbound_reply_queue');

const secretTopic = '社外秘の合言葉';
const secretUrl = 'https://secret.example/drop-path';

function card() {
  return { id: 'c1', topicRing: 'ring1_craft', topicDomain: '書き出し', topic: '書き出し' };
}

function user() {
  return { brandKnowledge: { productName: 'VELOX AI' }, audienceKnowledge: { schemaVersion: 2, audienceTopics: [card()] }, ngTopics: secretTopic };
}

async function capture(run) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(item => String(item)).join(' '));
  try {
    return { result: await run(), lines };
  } finally {
    console.log = original;
  }
}

async function dropped(text) {
  const run = await capture(() => buildOutboundCandidate({
    user: user(),
    tweet: { id: 't', text: '今日の書き出しで迷いました', authorId: 'reader-account', username: 'reader-handle' },
    completeWriter: async () => ({ parsed: { text } }),
    completeCritic: async () => ({ parsed: { scores: [] } })
  }));
  assert.equal(run.result, null);
  assert.equal(run.lines.length, 1);
  assert.equal(run.lines[0].includes(secretTopic), false);
  assert.equal(run.lines[0].includes(secretUrl), false);
  if (text) assert.equal(run.lines[0].includes(text), false);
  return run.lines[0];
}

test('reply safety stays boolean and the drop log names one unsafe code', async () => {
  assert.equal(typeof replyPassesSafety('書き出しは前置きを削る。', ''), 'boolean');
  assert.equal(replyPassesSafety('短い', ''), false);
  assert.equal(replyPassesSafety('書き出しは前置きを削る。', ''), true);
  const long = `${'あ'.repeat(281)}${secretUrl}`;
  assert.equal(passesOutboundSafety(long, user(), 'ja').reasons[0], 'unsafe:too_long');
  assert.equal(await dropped(''), '[Outbound Drop] stage=safety reasons=unsafe:empty repaired=0');
  assert.equal(await dropped('短い'), '[Outbound Drop] stage=safety reasons=unsafe:too_short repaired=0');
  assert.equal(await dropped('あ'.repeat(281)), '[Outbound Drop] stage=safety reasons=unsafe:too_long repaired=0');
  assert.equal(await dropped(`書き出しを確認する。 ${secretUrl}`), '[Outbound Drop] stage=safety reasons=unsafe:url repaired=0');
  assert.equal(await dropped('いかがでしたでしょうか。今日の確認はここだけです。'), '[Outbound Drop] stage=safety reasons=unsafe:bait repaired=0');
  assert.equal(await dropped(`書き出しの確認に${secretTopic}を混ぜない。`), '[Outbound Drop] stage=safety reasons=unsafe:ng_topic repaired=0');
});
