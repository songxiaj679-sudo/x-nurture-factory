'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const practical = '書き出しは前置きを削り、読者が次にできる確認を残すと、後から自分の下書きを読み返せます。短くしても、判断の材料は本文に残ります。今日直す場所はそこだけです。';
const claim = '成果を保証すると、確認は12%だけ残します。今日直す場所はそこだけで、書き出しの前置きは入れません。';
const secretUrl = 'https://secret.example/drop-path';

function card() {
  return {
    id: 'c1',
    archetype: 'actionable_checklist',
    topicRing: 'ring1_craft',
    topicDomain: '書き出し',
    topic: '書き出し',
    steps: ['前置きを削る', '確認を一文にする', '声に出して読む']
  };
}

function user() {
  return { brandKnowledge: { productName: 'VELOX AI' }, audienceKnowledge: { schemaVersion: 2, audienceTopics: [card()] }, ngTopics: '' };
}

function tweet(id) {
  return { id, text: '今日の書き出しで迷いました', authorId: 'reader-account', username: 'reader-handle' };
}

function axes(score) {
  return { id: 'a', score, scrollStopHook: 16, saveUtility: 16, strangerClarity: 16, craftAndTruth: 16, weakness: 'weakness-secret-marker' };
}

async function capture(run) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(item => String(item)).join(' '));
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.log = original;
  }
}

function assertPrivate(line) {
  assert.equal(line.includes(practical), false);
  assert.equal(line.includes(claim), false);
  assert.equal(line.includes('12%'), false);
  assert.equal(line.includes('12'), false);
  assert.equal(line.includes(secretUrl), false);
  assert.equal(line.includes('weakness-secret-marker'), false);
  assert.equal(line.includes('reader-handle'), false);
  assert.equal(line.includes('reader-account'), false);
  assert.equal(line.includes('VELOX'), false);
}

test('safety drops log compliance codes without the reply text', async () => {
  const { buildOutboundCandidate } = require('../src/outbound_reply_queue');
  const first = await capture(() => buildOutboundCandidate({
    user: user(),
    tweet: tweet('safety-first'),
    completeWriter: async () => ({ parsed: { text: claim } }),
    completeCritic: async () => ({ parsed: { scores: [axes(80)] } })
  }));
  assert.equal(first.result, null);
  assert.equal(first.lines.length, 1);
  assert.match(first.lines[0], /^\[Outbound Drop\] stage=safety reasons=\S*claim_needs_evidence\S* repaired=0$/);
  assert.match(first.lines[0], /reasons=(?:compliance,|[^ ]*?,compliance(?:,| ))/);
  assertPrivate(first.lines[0]);

  let writes = 0;
  const second = await capture(() => buildOutboundCandidate({
    user: user(),
    tweet: tweet('safety-repair'),
    completeWriter: async () => {
      writes += 1;
      return { parsed: { text: writes === 1 ? practical : claim } };
    },
    completeCritic: async () => ({ parsed: { scores: [axes(65)] } })
  }));
  assert.equal(second.result, null);
  assert.equal(writes, 2);
  assert.equal(second.lines.length, 1);
  assert.match(second.lines[0], /^\[Outbound Drop\] stage=safety reasons=\S*claim_needs_evidence\S* repaired=1$/);
  assertPrivate(second.lines[0]);

  const linked = await capture(() => buildOutboundCandidate({
    user: user(),
    tweet: tweet('safety-url'),
    completeWriter: async () => ({ parsed: { text: `${practical} ${secretUrl}` } }),
    completeCritic: async () => ({ parsed: { scores: [axes(80)] } })
  }));
  assert.equal(linked.result, null);
  assert.equal(linked.lines.length, 1);
  assert.equal(linked.lines[0], '[Outbound Drop] stage=safety reasons=unsafe:url repaired=0');
  assertPrivate(linked.lines[0]);
});

test('critic drops log axes and a missing score stays na', async () => {
  const { buildOutboundCandidate, classifyOutboundCritic } = require('../src/outbound_reply_queue');
  const stats = { skipped: 0, noCard: 0, safety: 0, critic: 0, attempted: 0 };
  const discarded = await capture(() => buildOutboundCandidate({
    user: user(),
    tweet: tweet('critic-discard'),
    stats,
    completeWriter: async () => ({ parsed: { text: practical } }),
    completeCritic: async () => ({ parsed: { scores: [{ ...axes(40), scrollStopHook: 8, saveUtility: 9, strangerClarity: 10, craftAndTruth: 11 }] } })
  }));
  assert.equal(discarded.result, null);
  assert.equal(stats.critic, 1);
  assert.equal(stats.safety, 0);
  assert.equal(discarded.lines.length, 1);
  assert.equal(discarded.lines[0], '[Outbound Drop] stage=critic action=discard score=40 hook=8 save=9 clear=10 craft=11 degraded=0 repaired=0');
  assertPrivate(discarded.lines[0]);

  const missing = await capture(() => buildOutboundCandidate({
    user: user(),
    tweet: tweet('critic-missing'),
    completeWriter: async () => ({ parsed: { text: practical } }),
    completeCritic: async () => ({ parsed: { scores: [{ id: 'a', score: 80, weakness: 'weakness-secret-marker' }] } })
  }));
  assert.equal(missing.result, null);
  assert.equal(missing.lines.length, 1);
  assert.equal(missing.lines[0], '[Outbound Drop] stage=critic action=rescore score=na hook=na save=na clear=na craft=na degraded=0 repaired=0');
  assertPrivate(missing.lines[0]);

  const kept = await capture(() => buildOutboundCandidate({
    user: user(),
    tweet: tweet('critic-keep'),
    completeWriter: async () => ({ parsed: { text: practical } }),
    completeCritic: async () => ({ parsed: { scores: [axes(80)] } })
  }));
  assert.equal(kept.result.status, 'pending_approval');
  assert.equal(kept.lines.length, 0);
  assert.equal(classifyOutboundCritic(axes(65)).action, 'repair');
  assert.equal(classifyOutboundCritic(axes(66), { repaired: true }).action, 'held');
});
