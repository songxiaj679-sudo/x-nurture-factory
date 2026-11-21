'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { composeOutboundReply, passesOutboundSafety } = require('../src/outbound_reply_queue');

const card = { topic: '休み', topicDomain: '店', steps: [], weakExample: '', strongExample: '', practicalFix: '' };

test('both reply languages ask for 180 characters and one long draft is shortened once', async () => {
  const prompts = [];
  const text = await composeOutboundReply({
    sourceText: '休みの紙が古い',
    card,
    lang: 'ja',
    completeWriter: async (options) => {
      prompts.push(options.prompt);
      return { parsed: { text: prompts.length === 1 ? 'あ'.repeat(281) : '入口の紙だけ先に見ます。' } };
    }
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /180字以内で書く/);
  assert.match(prompts[1], /180字以内に書き直す/);
  assert.equal(text, '入口の紙だけ先に見ます。');
  const english = [];
  await composeOutboundReply({
    sourceText: 'The posted hours were old',
    card,
    lang: 'en',
    completeWriter: async (options) => {
      english.push(options.prompt);
      return { parsed: { text: 'Check the door once.' } };
    }
  });
  assert.equal(english.length, 1);
  assert.match(english[0], /within 180 characters/);
});

test('a second overlong reply still drops as too long', async () => {
  let calls = 0;
  const text = await composeOutboundReply({
    sourceText: '休みの紙が古い',
    card,
    lang: 'ja',
    completeWriter: async () => {
      calls += 1;
      return { parsed: { text: 'あ'.repeat(281) } };
    }
  });
  assert.equal(calls, 2);
  assert.equal(passesOutboundSafety(text, { ngTopics: '' }, 'ja').reasons[0], 'unsafe:too_long');
});
