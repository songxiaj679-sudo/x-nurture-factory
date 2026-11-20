'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { modelForTier } = require('../src/grok_client');
const { verifyNumericGrounding } = require('../src/draft_verifier');
const { detectOfficialBrandAccount } = require('../src/account_voice_profiler');
const { consentGranted } = require('../src/autonomous_promo_ai');
const { lookupAnyUserProfileAndTweets } = require('../src/official_api_client');

function loadWithMockedFirestore(fakeDb) {
  const firestorePath = require.resolve('../src/firestore');
  const routesPath = require.resolve('../src/hybrid_saas_routes');
  const prevFirestore = require.cache[firestorePath];
  const prevRoutes = require.cache[routesPath];
  delete require.cache[routesPath];
  require.cache[firestorePath] = {
    id: firestorePath,
    filename: firestorePath,
    loaded: true,
    exports: { db: fakeDb }
  };
  const mod = require('../src/hybrid_saas_routes');
  return {
    mod,
    restore() {
      if (prevFirestore) require.cache[firestorePath] = prevFirestore;
      else delete require.cache[firestorePath];
      if (prevRoutes) require.cache[routesPath] = prevRoutes;
      else delete require.cache[routesPath];
    }
  };
}

test('loadRecentPostHistory runs only equality queries without orderBy or range filters and sorts newest first', async () => {
  const now = Date.now();
  const docsByStatus = {
    posted: [
      { id: 'old_post', data: () => ({ status: 'posted', postedAt: new Date(now - 40 * 86400000), text: 'old' }) },
      { id: 'recent_b', data: () => ({ status: 'posted', postedAt: new Date(now - 2 * 3600000), text: 'recent_b' }) },
      { id: 'recent_a', data: () => ({ status: 'posted', postedAt: new Date(now - 1 * 3600000), text: 'recent_a' }) }
    ],
    processing: [
      { id: 'proc_1', data: () => ({ status: 'processing', updatedAt: new Date(now - 10 * 60000), text: 'proc' }) }
    ],
    failed: []
  };
  const fakeDb = {
    collection(name) {
      assert.equal(name, 'autopilot_jobs');
      const eq = {};
      const query = {
        where(field, op, val) {
          assert.equal(op, '==', `Unexpected range/composite operator "${op}" on field "${field}"`);
          eq[field] = val;
          return query;
        },
        orderBy() {
          throw new Error('loadRecentPostHistory must not call orderBy (would require Firestore composite index)');
        },
        limit() {
          return query;
        },
        async get() {
          return { docs: docsByStatus[eq.status] || [] };
        }
      };
      return query;
    }
  };

  const { mod, restore } = loadWithMockedFirestore(fakeDb);
  try {
    const history = await mod.loadRecentPostHistory('USR-123');
    assert.deepEqual(history.map(item => item.id), ['recent_a', 'recent_b', 'proc_1']);
  } finally {
    restore();
  }
});

test('consentGranted matches X twitterId even when creds.userId holds SaaS doc ID', () => {
  const user = {
    xUsername: 'VeloxSystemsV4',
    twitterId: '1751939638065876993',
    autopilotConsent: { version: 1, account: 'id:1751939638065876993', granted: true }
  };
  assert.equal(consentGranted(user, { id: '1751939638065876993', userId: 'WEB-GOOGLE-123' }, 'WEB-GOOGLE-123'), true);
  assert.equal(consentGranted(user, { userId: 'WEB-GOOGLE-123' }, 'WEB-GOOGLE-123'), true);
  assert.equal(consentGranted({ ...user, autopilotConsent: { version: 1, granted: false } }, { id: '1751939638065876993' }, 'WEB-GOOGLE-123'), false);
});

test('verifyNumericGrounding rejects ungrounded ratios/durations like 3割 while permitting numbers inside grounded ranges', () => {
  const rejected = verifyNumericGrounding('通常の3割程度しかリーチせず、5分かけて確認しました。', {
    brandKnowledge: { verifiedPricing: ['2〜6時間'], verifiedClaims: [] },
    accountState: {}
  });
  assert.deepEqual(rejected, ['3割', '5分']);

  const kept = verifyNumericGrounding('公開後2〜6時間と24〜36時間に計2回回収します。', {
    brandKnowledge: {
      verifiedPricing: [],
      verifiedClaims: [{ verifiedNumbers: ['2〜6時間', '24〜36時間'] }]
    },
    accountState: {}
  });
  assert.deepEqual(kept, []);
});

test('detectOfficialBrandAccount flags corporate and product brand accounts', () => {
  assert.equal(detectOfficialBrandAccount({
    user: { xUsername: 'freee_jp', verifiedType: 'blue', bio: 'クラウド会計ソフト freee 公式アカウント' },
    texts: ['確定申告のご案内です。', 'freee会計の最新機能をお知らせします。']
  }), true);
  assert.equal(detectOfficialBrandAccount({
    user: { xUsername: 'solo_dev_note', verifiedType: '', bio: '個人開発の学び' },
    texts: ['今日作った画面メモ', 'バグ一個直した'],
    accountState: { followers: 40 }
  }), false);
});

test('modelForTier fast resolves non-reasoning model cleanly', () => {
  assert.equal(modelForTier('fast'), process.env.XAI_MODEL_FAST || 'grok-4.20-0309-non-reasoning');
});

test('chooseGenesForPost ignores historical posts without genes without crashing', () => {
  const { chooseGenesForPost } = require('../src/bandit_optimization_engine');
  const chosen = chooseGenesForPost({
    posts: [{
      id: 'legacy_1',
      status: 'posted',
      postedAt: new Date(Date.now() - 36 * 3600000).toISOString(),
      timeSlot: 'night',
      metrics: { impression_count: 120, bookmark_count: 2, like_count: 5, reply_count: 1, retweet_count: 0 }
    }],
    brandKnowledge: { verifiedClaims: [{ semanticKey: 'k1' }] },
    accountState: { postShape: 'thread', subscription: 'free' },
    timeSlot: 'night',
    random: () => 0.5
  });
  assert.equal(typeof chosen.angle, 'string');
  assert.equal(typeof chosen.format, 'string');
});

test('lookupAnyUserProfileAndTweets preserves user profile when timeline endpoint returns 429 and allowPartialProfile is true', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async (url) => {
    call += 1;
    if (String(url).includes('/2/users/by/username/')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              id: '42',
              name: 'kintone',
              username: 'kintone_jp',
              verified_type: 'business',
              public_metrics: { followers_count: 25000, following_count: 100, tweet_count: 5000 }
            }
          };
        }
      };
    }
    return {
      ok: false,
      status: 429,
      async json() { return { detail: 'Too Many Requests' }; }
    };
  };
  try {
    const partial = await lookupAnyUserProfileAndTweets({ oauth2AccessToken: 'bearer-test' }, 'kintone_jp', 10, { allowPartialProfile: true });
    assert.equal(partial.ok, true);
    assert.equal(partial.user.subscription_type, 'premium');
    assert.equal(partial.user.metrics.followers_count, 25000);
    assert.deepEqual(partial.tweets, []);

    const strict = await lookupAnyUserProfileAndTweets({ oauth2AccessToken: 'bearer-test' }, 'kintone_jp', 10);
    assert.equal(strict.ok, false);
    assert.equal(call >= 4, true);
  } finally {
    global.fetch = originalFetch;
  }
});
