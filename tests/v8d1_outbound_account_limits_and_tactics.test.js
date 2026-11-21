'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { replyPassesSafety } = require('../src/auto_reply_policy');
const {
  composeOutboundReply,
  passesOutboundSafety,
  buildOutboundCandidate,
  outboundReplyBudget,
  savedOutboundBudget,
  outboundAuditAccount
} = require('../src/outbound_reply_queue');

const card = { id: 'c1', topicRing: 'ring1_craft', topic: '書き出し', topicDomain: '書き出し', steps: [], weakExample: '', strongExample: '', practicalFix: '' };

function chars(count) {
  return 'あ'.repeat(count);
}

function spoken(count) {
  const line = '入口の紙を先に見て、古い時刻だけその場で直す。';
  let text = line;
  let n = 0;
  while (text.length < count) {
    text += `次は棚の紙を直す${'あいうえおかきくけこ'.slice(n % 10, (n % 10) + 1)}。`;
    n += 1;
  }
  return text.slice(0, count);
}

test('reply safety keeps 280 unless a caller passes another limit', () => {
  assert.equal(typeof replyPassesSafety(chars(40), ''), 'boolean');
  assert.equal(replyPassesSafety(chars(280), ''), true);
  assert.equal(replyPassesSafety(chars(281), ''), false);
  assert.equal(replyPassesSafety(chars(140), '', 140), true);
  assert.equal(replyPassesSafety(chars(141), '', 140), false);
  assert.equal(replyPassesSafety(chars(270), '', 270), true);
  assert.equal(replyPassesSafety(chars(271), '', 270), false);
  assert.equal(replyPassesSafety(chars(420), '', 420), true);
  assert.equal(replyPassesSafety(chars(421), '', 420), false);
  assert.equal(replyPassesSafety(chars(550), '', 550), true);
  assert.equal(replyPassesSafety(chars(551), '', 550), false);
});

test('free and unknown japanese shorten past 140 and do not keep a 160 character draft', async () => {
  for (const accountSubscription of ['free', 'unknown']) {
    const prompts = [];
    await composeOutboundReply({
      sourceText: '休みの紙が古い',
      card,
      lang: 'ja',
      accountSubscription,
      completeWriter: async (options) => {
        prompts.push(options.prompt);
        return { parsed: { text: prompts.length === 1 ? chars(160) : '入口の紙だけ先に見ます。' } };
      }
    });
    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /120字以内で書く/);
    assert.match(prompts[0], /Add-One/);
    assert.match(prompts[0], /Gentle Angle/);
    assert.match(prompts[0], /Peer Check/);
    assert.equal(outboundReplyBudget(accountSubscription, 'ja').maxChars, 140);
  }
  const safety = passesOutboundSafety(chars(160), { ngTopics: '', accountSubscription: 'free' }, 'ja');
  assert.equal(safety.ok, false);
  assert.equal(safety.reasons[0], 'unsafe:too_long');
});

test('premium japanese allows 281 to 420 characters and shortens 421 once', async () => {
  const body = spoken(300);
  assert.equal(body.length, 300);
  const safety = passesOutboundSafety(body, { ngTopics: '', accountSubscription: 'premium' }, 'ja');
  assert.equal(safety.ok, true);
  assert.equal(passesOutboundSafety(spoken(420), { ngTopics: '', accountSubscription: 'premium' }, 'ja').ok, true);
  const prompts = [];
  await composeOutboundReply({
    sourceText: '休みの紙が古い',
    card,
    lang: 'ja',
    accountSubscription: 'premium',
    completeWriter: async (options) => {
      prompts.push(options.prompt);
      return { parsed: { text: prompts.length === 1 ? chars(421) : spoken(300) } };
    }
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /320字以内で書く/);
  assert.match(prompts[1], /320字以内に書き直す/);
  const english = [];
  await composeOutboundReply({
    sourceText: 'The posted hours were old',
    card,
    lang: 'en',
    accountSubscription: 'premium',
    completeWriter: async (options) => {
      english.push(options.prompt);
      return { parsed: { text: 'Check the door once.' } };
    }
  });
  assert.match(english[0], /Add-One/);
  assert.match(english[0], /Gentle Angle/);
  assert.match(english[0], /Peer Check/);
  assert.match(english[0], /within 420 characters/);
});

test('a candidate stores the account limit and approval uses that limit', async () => {
  const candidate = await buildOutboundCandidate({
    user: {
      accountSubscription: 'premium',
      brandKnowledge: { productName: 'VELOX AI' },
      audienceKnowledge: { schemaVersion: 2, audienceTopics: [card] },
      ngTopics: ''
    },
    tweet: { id: 't1', text: '今日の書き出しで迷いました', authorId: 'reader' },
    completeWriter: async () => ({ parsed: { text: spoken(300) } }),
    completeCritic: async () => ({ parsed: { scores: [{ id: 'a', score: 80, scrollStopHook: 16, saveUtility: 20, strangerClarity: 18, craftAndTruth: 20, weakness: '' }] } })
  });
  assert.equal(candidate.accountSubscription, 'premium');
  assert.equal(candidate.maxChars, 420);
  assert.equal(candidate.draftText.length, 300);
  const saved = savedOutboundBudget(candidate, 'ja');
  assert.deepEqual(outboundAuditAccount({ accountSubscription: saved.accountSubscription, outboundMaxChars: saved.maxChars }, 'ja'), {
    postShape: 'single',
    subscription: 'premium',
    maxChars: 420
  });
  assert.deepEqual(savedOutboundBudget({}, 'ja'), { accountSubscription: 'unknown', targetChars: 120, maxChars: 140 });
  const approve = fs.readFileSync(path.join(__dirname, '../src/hybrid_saas_routes.js'), 'utf8');
  const start = approve.indexOf("app.post('/api/autopilot/outbound-replies/:tweetId/approve'");
  const end = approve.indexOf("app.get('/api/autopilot/jobs/:jobId/visual-card.png'");
  const handler = approve.slice(start, end);
  assert.equal(handler.includes('passesOutboundSafety'), true);
  assert.equal(handler.includes('savedOutboundBudget'), true);
  assert.equal(handler.includes("subscription: 'premium'"), false);
  assert.equal(handler.includes('maxChars: 280'), false);
  const inbound = approve.slice(0, start);
  assert.equal(inbound.includes('replyPassesSafety(draft, user.ngTopics)'), true);
  assert.equal(inbound.includes('replyPassesSafety(text, user.ngTopics)'), true);
});
