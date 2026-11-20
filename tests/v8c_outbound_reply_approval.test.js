'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const practical = '書き出しは前置きを削り、読者が次にできる確認を残すと、後から自分の下書きを読み返せます。短くしても、判断の材料は本文に残ります。今日直す場所はそこだけです。';

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

test('recent search failure returns no tweets and does not throw', async () => {
  const { searchRecentPublicTweets } = require('../src/official_api_client');
  const result = await searchRecentPublicTweets(
    { oauth2AccessToken: 'token' },
    { query: '書き出し lang:ja', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }
  );
  assert.deepEqual(result.tweets, []);
  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 403);
});

test('outbound matching stays on ring 1 and ring 2 and blocks follow pitches', () => {
  const { matchAudienceCard, searchQueryFor, classifyOutboundCritic } = require('../src/outbound_reply_queue');
  const { usableScores } = require('../src/llm_router');
  const knowledge = { schemaVersion: 2, audienceTopics: [card(), { id: 'p', topicRing: 'ring3_product_bridge', topicDomain: '書き出し', topic: '製品' }] };
  assert.equal(matchAudienceCard('今日の書き出しで迷いました', knowledge).id, 'c1');
  assert.equal(matchAudienceCard('相互フォローお願いします', knowledge), null);
  assert.equal(searchQueryFor(card(), 'ja').includes('VELOX'), false);
  assert.equal(classifyOutboundCritic({ id: 'a', score: 80, weakness: '' }).action, 'rescore');
  assert.equal(classifyOutboundCritic({ score: 50, scrollStopHook: 10, saveUtility: 10, strangerClarity: 10, craftAndTruth: 10 }).action, 'discard');
  assert.equal(classifyOutboundCritic({ score: 65, scrollStopHook: 16, saveUtility: 16, strangerClarity: 16, craftAndTruth: 16 }).action, 'repair');
  assert.equal(classifyOutboundCritic({ score: 66, scrollStopHook: 16, saveUtility: 16, strangerClarity: 16, craftAndTruth: 16 }, { repaired: true }).action, 'held');
  assert.equal(usableScores({ scores: [{ id: 'a', score: 81, weakness: 'ok' }] })[0].scrollStopHook, null);
});

test('page-checking replies are rejected and a missing axis is scored once more', async () => {
  const { passesOutboundSafety, buildOutboundCandidate } = require('../src/outbound_reply_queue');
  const user = { brandKnowledge: { productName: 'VELOX AI' }, audienceKnowledge: { schemaVersion: 2, audienceTopics: [card()] }, ngTopics: '' };
  const leak = passesOutboundSafety('登録ページと照らしてから投稿します。', user, 'ja');
  assert.equal(leak.ok, false);
  assert.equal(leak.reasons.includes('lp_meta_leak'), true);
  let criticCalls = 0;
  const candidate = await buildOutboundCandidate({
    user,
    tweet: { id: 't1', text: '今日の書き出しで迷いました', authorId: 'u2', username: 'reader', createdAt: '2026-11-20T00:00:00.000Z' },
    completeWriter: async () => ({ parsed: { text: practical } }),
    completeCritic: async () => {
      criticCalls += 1;
      if (criticCalls === 1) return { parsed: { scores: [{ id: 'a', score: 83, weakness: 'axis missing' }] } };
      return { parsed: { scores: [{ id: 'a', score: 83, scrollStopHook: 18, saveUtility: 22, strangerClarity: 20, craftAndTruth: 23, weakness: '' }] } };
    }
  });
  assert.equal(criticCalls, 2);
  assert.equal(candidate.status, 'pending_approval');
  assert.equal(candidate.draftText.includes('VELOX'), false);
  const low = await buildOutboundCandidate({
    user,
    tweet: { id: 't2', text: '今日の書き出しで迷いました', authorId: 'u3', username: 'reader' },
    completeWriter: async () => ({ parsed: { text: practical } }),
    completeCritic: async () => ({ parsed: { scores: [{ id: 'a', score: 40, scrollStopHook: 8, saveUtility: 8, strangerClarity: 8, craftAndTruth: 8, weakness: 'thin' }] } })
  });
  assert.equal(low, null);
  let writes = 0;
  const held = await buildOutboundCandidate({
    user,
    tweet: { id: 't3', text: '今日の書き出しで迷いました', authorId: 'u4', username: 'reader' },
    completeWriter: async () => { writes += 1; return { parsed: { text: practical } }; },
    completeCritic: async () => ({ parsed: { scores: [{ id: 'a', score: writes === 1 ? 65 : 66, scrollStopHook: 16, saveUtility: 16, strangerClarity: 16, craftAndTruth: 16, weakness: '' }] } })
  });
  assert.equal(writes, 2);
  assert.equal(held.status, 'held');
  assert.equal(held.critic.criticDegraded, true);
});

test('outbound approval stays off the browser sender and the dashboard is bilingual', () => {
  const routes = fs.readFileSync('src/hybrid_saas_routes.js', 'utf8');
  const outbound = routes.slice(routes.indexOf("app.get('/api/autopilot/outbound-replies'"));
  assert.match(outbound, /postOfficialTweet\(creds, text, \[\], req\.params\.tweetId\)/);
  assert.equal(outbound.includes('executeInterleavedOutreachCycle'), false);
  assert.equal(outbound.includes('composeInboundReply'), false);
  assert.equal(fs.readFileSync('src/outbound_reply_queue.js', 'utf8').includes('reply_promo_engine'), false);
  const view = fs.readFileSync('views/dashboard_view.html', 'utf8');
  assert.match(view, /outbound_reply_title: "外向け返信の承認"/);
  assert.match(view, /outbound_reply_title: "Outbound reply approval"/);
  assert.match(view, /function loadOutboundReplies\(\) \{\s*const isEn = checkIsEn\(\);/);
  assert.match(view, /直近の候補検索を実行できませんでした/);
  assert.match(view, /Could not run the latest candidate search/);
  assert.match(view, /discovery === 'invalid_query'/);
  assert.match(view, /直近の候補検索は検索条件が受け付けられませんでした。/);
  assert.match(view, /The latest candidate search query was rejected by X API\./);
  assert.match(routes, /selectDiscoveryCard\(topics/);
  assert.match(routes, /matches=\$\{discovery\.lastMatchCount\} skipped=\$\{gate\.skipped\} noCard=\$\{gate\.noCard\} safety=\$\{gate\.safety\} critic=\$\{gate\.critic\}/);
  const getHandler = routes.slice(routes.indexOf("app.get('/api/autopilot/outbound-replies'"), routes.indexOf('async function loadOutboundCandidate'));
  assert.match(getHandler, /discoveryStatus/);
  assert.equal(getHandler.includes('searchRecentPublicTweets'), false);
});

test('discovery status keeps the user document and stores only the status code', async () => {
  const { discoveryStatusFromSearch, saveOutboundDiscovery } = require('../src/outbound_reply_queue');
  assert.deepEqual(discoveryStatusFromSearch({ reason: 'http_403', httpStatus: 403, tweets: [] }, 0), { lastStatus: 'auth_error', lastHttpStatus: 403, lastMatchCount: null });
  assert.deepEqual(discoveryStatusFromSearch({ reason: 'http_429', httpStatus: 429, tweets: [] }, 0), { lastStatus: 'rate_limited', lastHttpStatus: 429, lastMatchCount: null });
  assert.deepEqual(discoveryStatusFromSearch({ reason: 'http_400', httpStatus: 400, tweets: [] }, 0), { lastStatus: 'invalid_query', lastHttpStatus: 400, lastMatchCount: null });
  assert.deepEqual(discoveryStatusFromSearch({ reason: 'error', httpStatus: null, tweets: [] }, 0), { lastStatus: 'network_error', lastHttpStatus: null, lastMatchCount: null });
  const missed = discoveryStatusFromSearch({ reason: '', httpStatus: 200, tweets: [] }, 0);
  assert.equal(missed.lastStatus, 'no_match');
  assert.equal(missed.lastMatchCount, 0);
  const seen = discoveryStatusFromSearch({ reason: '', httpStatus: 200, tweets: [{}, {}] }, 0);
  assert.equal(seen.lastStatus, 'no_match');
  assert.equal(seen.lastMatchCount, 2);
  assert.equal(discoveryStatusFromSearch({ reason: '', httpStatus: 200, tweets: [{}] }, 1).lastStatus, 'ok');
  const { searchQueryFor, selectDiscoveryCard } = require('../src/outbound_reply_queue');
  const hq = searchQueryFor({ topicDomain: 'Opening lines and hooks for short posts' }, 'en');
  assert.equal(hq, 'Opening lines hooks lang:en -is:retweet -is:reply');
  assert.equal(/\bOR\b/.test(hq), false);
  const hqNext = searchQueryFor({ topicDomain: 'Backing claims with visible evidence' }, 'en');
  assert.equal(hqNext, 'Backing claims visible lang:en -is:retweet -is:reply');
  assert.equal(searchQueryFor({ topicDomain: '投稿の文章設計' }, 'ja'), '投稿 文章設計 lang:ja -is:retweet -is:reply');
  assert.equal(searchQueryFor({ topicDomain: '文体の一貫性' }, 'ja'), '文体 一貫性 lang:ja -is:retweet -is:reply');
  const ring = [
    { topicRing: 'ring1_craft', topicDomain: '投稿の文章設計' },
    { topicRing: 'ring3_product_bridge', topicDomain: '製品' },
    { topicRing: 'ring2_broad_adjacent', topicDomain: '文体の一貫性' }
  ];
  assert.equal(selectDiscoveryCard(ring, 0).card.topicDomain, '投稿の文章設計');
  assert.equal(selectDiscoveryCard(ring, 0).nextCursor, 1);
  assert.equal(selectDiscoveryCard(ring, 1).card.topicDomain, '文体の一貫性');
  assert.equal(selectDiscoveryCard(ring, 1).nextCursor, 0);
  const doc = { planStatus: 'pro', autoReplySettings: { mode: 'approval_queue' } };
  await saveOutboundDiscovery({
    async set(data) { Object.assign(doc, data); }
  }, { lastRunAt: '2026-11-20T12:00:00.000Z', lastStatus: 'auth_error', lastHttpStatus: 403, body: 'secret token' });
  assert.equal(doc.planStatus, 'pro');
  assert.equal(doc.autoReplySettings.mode, 'approval_queue');
  assert.equal(doc.outboundReplyDiscovery.lastHttpStatus, 403);
  assert.equal(JSON.stringify(doc.outboundReplyDiscovery).includes('token'), false);
});

test('short replies reach the critic and function words do not match a card', async () => {
  const { passesOutboundSafety, matchAudienceCard, buildOutboundCandidate, discoverOutboundCandidates } = require('../src/outbound_reply_queue');
  const user = { twitterId: 'self', brandKnowledge: { productName: 'VELOX AI' }, audienceKnowledge: { schemaVersion: 2, audienceTopics: [card()] }, ngTopics: '' };
  const brief = '書き出しは前置きを削り、次の確認だけ残す。';
  assert.equal(brief.length >= 20 && brief.length <= 60, true);
  const safe = passesOutboundSafety(brief, user, 'ja');
  assert.equal(safe.ok, true);
  assert.equal(safe.reasons.includes('too_short'), false);
  assert.equal(passesOutboundSafety('短すぎ', user, 'ja').ok, false);
  assert.equal(passesOutboundSafety('あ'.repeat(281), user, 'ja').ok, false);
  assert.equal(passesOutboundSafety('登録ページを見てから書いてください。', user, 'ja').reasons.includes('lp_meta_leak'), true);
  let criticCalls = 0;
  const candidate = await buildOutboundCandidate({
    user,
    tweet: { id: 'short', text: '今日の書き出しで迷いました', authorId: 'reader' },
    completeWriter: async () => ({ parsed: { text: brief } }),
    completeCritic: async () => {
      criticCalls += 1;
      return { parsed: { scores: [{ id: 'a', score: 80, scrollStopHook: 16, saveUtility: 20, strangerClarity: 18, craftAndTruth: 20, weakness: '' }] } };
    }
  });
  assert.equal(criticCalls, 1);
  assert.equal(candidate.status, 'pending_approval');
  const english = { schemaVersion: 2, audienceTopics: [{ id: 'en', topicRing: 'ring1_craft', topicDomain: 'Opening lines and hooks for short posts', topic: 'Opening lines' }] };
  assert.equal(matchAudienceCard('and for the audience', english), null);
  assert.equal(matchAudienceCard('The hooks were vague', english).id, 'en');
  const stats = { skipped: 0, noCard: 0, safety: 0, critic: 0, attempted: 0 };
  let writes = 0;
  const tweets = [
    { id: 'me', text: '今日の書き出しで迷いました', authorId: 'self' },
    { id: 'none', text: 'and for the audience', authorId: 'r0' },
    ...[1, 2, 3, 4, 5].map(n => ({ id: `w${n}`, text: '今日の書き出しで迷いました', authorId: `r${n}` }))
  ];
  const saved = await discoverOutboundCandidates({
    user,
    tweets,
    stats,
    completeWriter: async () => { writes += 1; return { parsed: { text: 'https://example.com/reply' } }; },
    completeCritic: async () => ({ parsed: { scores: [] } })
  });
  assert.equal(saved.length, 0);
  assert.equal(writes, 3);
  assert.equal(stats.attempted, 3);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.noCard, 1);
  assert.equal(stats.safety, 3);
  assert.equal(stats.critic, 0);
});
