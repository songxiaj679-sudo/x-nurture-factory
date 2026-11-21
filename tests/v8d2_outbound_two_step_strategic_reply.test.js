'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { buildOutboundCandidate, deliverOutboundReply } = require('../src/outbound_reply_queue');

const passing = { id: 'a', score: 80, scrollStopHook: 18, saveUtility: 20, strangerClarity: 18, craftAndTruth: 20, weakness: '' };
const user = {
  accountSubscription: 'free',
  ngTopics: '',
  audienceKnowledge: { schemaVersion: 2, audienceTopics: [{ id: 'door', topic: '入口', topicDomain: '入口', topicRing: 'ring1_craft' }] }
};
const tweet = { id: 'tweet-1', authorId: 'author-1', username: 'shop', text: '入口の紙が古い', createdAt: '2026-11-21T00:00:00.000Z' };

test('a free account can keep two independent parts and premium stays one', async () => {
  const free = await buildOutboundCandidate({
    user,
    tweet,
    completeCritic: async () => ({ parsed: { scores: [passing] } }),
    completeWriter: async () => ({ parsed: { text: '入口の紙だけ先に見ます。', tweets: ['入口の紙だけ先に見ます。', '休みを変えた日だけもう一度見ます。'], replySegments: 2, replyTactic: 'add_one' } })
  });
  assert.equal(free.replySegments, 2);
  assert.equal(free.draftTweets.length, 2);
  assert.equal(free.draftText, free.draftTweets[0]);
  assert.equal(free.draftTweets[0].length <= 140, true);
  assert.equal(free.draftTweets[1].length <= 140, true);
  const premium = await buildOutboundCandidate({
    user: { ...user, accountSubscription: 'premium' },
    tweet,
    completeCritic: async () => ({ parsed: { scores: [passing] } }),
    completeWriter: async () => ({ parsed: { text: '入口の紙だけ先に見ます。', tweets: ['入口の紙だけ先に見ます。', '二段目は出しません。'], replySegments: 2, replyTactic: 'add_one' } })
  });
  assert.equal(premium.replySegments, 1);
  assert.deepEqual(premium.draftTweets, ['入口の紙だけ先に見ます。']);
});

test('an overlong second part is shortened once and then dropped', async () => {
  let calls = 0;
  const candidate = await buildOutboundCandidate({
    user,
    tweet,
    completeCritic: async () => ({ parsed: { scores: [passing] } }),
    completeWriter: async () => {
      calls += 1;
      return { parsed: { text: '入口の紙だけ先に見ます。', tweets: ['入口の紙だけ先に見ます。', '補'.repeat(150)], replySegments: 2, replyTactic: 'gentle_angle' } };
    }
  });
  assert.equal(calls, 2);
  assert.equal(candidate, null);
});

test('two parts are refused before the first send when only one slot remains', async () => {
  const calls = [];
  const result = await deliverOutboundReply({
    candidate: { draftText: '入口の紙だけ先に見ます。', draftTweets: ['入口の紙だけ先に見ます。', '休みを変えた日だけ見ます。'], replyLang: 'ja', accountSubscription: 'free', maxChars: 140, authorId: 'author-1', sourceText: '入口' },
    user: { planId: 'business', autoReplySettings: { maxRepliesPerDay: 1 }, autoReplySentCount: 0 },
    tweetId: 'source-1',
    authorId: 'author-1',
    selfTwitterId: 'self-1',
    postTweet: async (text, inReplyTo) => {
      calls.push({ text, inReplyTo });
      return { ok: true, tweetId: 'sent' };
    }
  });
  assert.equal(result.http, 429);
  assert.equal(result.body.code, 'daily_slots');
  assert.equal(calls.length, 0);
});

test('two open slots send the reply and then a self-reply', async () => {
  const calls = [];
  const result = await deliverOutboundReply({
    candidate: { draftText: '入口の紙だけ先に見ます。', draftTweets: ['入口の紙だけ先に見ます。', '休みを変えた日だけ見ます。'], replyLang: 'ja', accountSubscription: 'free', maxChars: 140, authorId: 'author-1', sourceText: '入口' },
    user: { planId: 'business', tierLevel: 3, autoReplySettings: { maxRepliesPerDay: 5 } },
    tweetId: 'source-1',
    authorId: 'author-1',
    selfTwitterId: 'self-1',
    postTweet: async (text, inReplyTo) => {
      calls.push(inReplyTo);
      return { ok: true, tweetId: calls.length === 1 ? 'id-1' : 'id-2' };
    }
  });
  assert.deepEqual(calls, ['source-1', 'id-1']);
  assert.equal(result.userPatch.autoReplySentCount, 2);
  assert.deepEqual(result.candidatePatch.sentTweetIds, ['id-1', 'id-2']);
  assert.equal(Boolean(result.userPatch.repliedAt), true);
});

test('a failed follow-up keeps the first send and blocks another approval', async () => {
  const result = await deliverOutboundReply({
    candidate: { draftText: '入口の紙だけ先に見ます。', draftTweets: ['入口の紙だけ先に見ます。', '休みを変えた日だけ見ます。'], replyLang: 'ja', accountSubscription: 'free', maxChars: 140, authorId: 'author-1', sourceText: '入口', status: 'pending_approval' },
    user: { planId: 'business', tierLevel: 3, autoReplySettings: { maxRepliesPerDay: 5 } },
    tweetId: 'source-1',
    authorId: 'author-1',
    selfTwitterId: 'self-1',
    postTweet: async (_text, inReplyTo) => inReplyTo === 'source-1' ? { ok: true, tweetId: 'id-1' } : { ok: false }
  });
  assert.equal(result.body.status, 'partial_sent');
  assert.equal(result.userPatch.autoReplySentCount, 1);
  assert.deepEqual(result.candidatePatch.sentTweetIds, ['id-1']);
  const again = await deliverOutboundReply({
    candidate: { ...result.candidatePatch, draftText: '入口の紙だけ先に見ます。', replyLang: 'ja', accountSubscription: 'free', maxChars: 140, authorId: 'author-1', sourceText: '入口' },
    user: { planId: 'business', tierLevel: 3, autoReplySettings: { maxRepliesPerDay: 5 }, autoReplyLastByAuthor: { 'author-1': result.userPatch.repliedAt } },
    tweetId: 'source-1',
    authorId: 'author-1',
    selfTwitterId: 'self-1',
    postTweet: async () => { throw new Error('should not send'); }
  });
  assert.equal(again.body.code, 'cooldown');
});

test('the dashboard names both parts in Japanese and English', () => {
  const html = fs.readFileSync('views/dashboard_view.html', 'utf8');
  assert.match(html, /1段目（返信）/);
  assert.match(html, /2段目（補足リプライ）/);
  assert.match(html, /2段リプライ（日次2枠）/);
  assert.match(html, /Part 1 \(Reply\)/);
  assert.match(html, /Part 2 \(Follow-up\)/);
  assert.match(html, /2-part reply \(uses 2 daily slots\)/);
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let count = 0;
  let match;
  while ((match = re.exec(html))) {
    new vm.Script(match[1], { filename: 'dashboard#' + (++count) });
  }
  assert.equal(count, 1);
});
