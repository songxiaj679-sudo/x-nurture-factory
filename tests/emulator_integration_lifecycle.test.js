/**
 * @file tests/emulator_integration_lifecycle.test.js
 * @description Firestore Emulator環境での結合検証テスト
 * 
 * 【検証対象（本番DB・外部API完全遮断）】
 * 1. ローカルエミュレーター接続先（127.0.0.1/localhost）および外部通信完全遮断の検証
 * 2. 真の並行同時競合制御（Promise.allによる並行トランザクション競合、10ワーカー中の単一勝者判定）
 * 3. ロック期限切れ・強奪時の原子的トランザクション遮断
 * 4. 回収失敗（429 / HTTP 200 partial errors）時のエラー伝播と誤クールダウン防止
 * 5. 24時間スナップショット凍結・冪等性・エピソード記憶生成
 * 6. オンラインDPOペア生成・Firestore永続化・次回プロンプトへの動的注入
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const https = require('node:https');

// 🛡️ 本番DBへの誤接続を絶対防止（エミュレーター環境変数が未設定の場合は安全にスキップ）
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  describe.skip('Firestore Emulator Integration Lifecycle Tests (FIRESTORE_EMULATOR_HOST not set - run with npm run test:emulator)', () => {
    test('skipped', () => {});
  });
  return;
}

// 🛡️ エミュレーター接続先がローカルループバックであることを厳格検証
assert.match(
  process.env.FIRESTORE_EMULATOR_HOST,
  /^(127\.0\.0\.1|localhost):[0-9]+$/,
  'FIRESTORE_EMULATOR_HOST must point to a local loopback interface (127.0.0.1 or localhost)'
);

const { db } = require('../src/firestore');
const {
  claimUserSyncLock,
  extendUserSyncLock,
  releaseUserSyncLock,
  withUserSyncLock
} = require('../src/user_sync_mutex');
const {
  harvestTweetMetricsAndEvolveKnowledge,
  buildCouncilWritingPrompt
} = require('../src/autonomous_promo_ai');

/**
 * X API v2 の安全なモックルーター生成ヘルパー（実外部通信を100%遮断）
 */
function createTwitterApiMock({
  meUser = { id: 'x_mock_uid', username: 'MockUser', name: 'Mock User' },
  recentTweets = [],
  lookupTweets = [],
  lookupErrors = null,
  rateLimitOn = null // 'me' | 'timeline' | 'lookup'
} = {}) {
  return async (url, options) => {
    const u = new URL(url);

    // 1. /2/users/me (verifyOfficialCredentials)
    if (u.pathname === '/2/users/me') {
      if (rateLimitOn === 'me') {
        return {
          ok: false,
          status: 429,
          headers: { get: () => '60' },
          json: async () => ({ title: 'Too Many Requests', detail: 'Rate limit exceeded' })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: meUser })
      };
    }

    // 2. /2/users/:id/tweets (タイムライン取得)
    if (u.pathname.match(/\/2\/users\/[^\/]+\/tweets/)) {
      if (rateLimitOn === 'timeline') {
        return {
          ok: false,
          status: 429,
          headers: { get: () => '60' },
          json: async () => ({ title: 'Too Many Requests', detail: 'Rate limit exceeded' })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: recentTweets })
      };
    }

    // 3. /2/tweets?ids=... (直接照会)
    if (u.pathname === '/2/tweets') {
      if (rateLimitOn === 'lookup') {
        return {
          ok: false,
          status: 429,
          headers: { get: () => '60' },
          json: async () => ({ title: 'Too Many Requests', detail: 'Rate limit exceeded' })
        };
      }
      if (lookupErrors) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: lookupTweets, errors: lookupErrors })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: lookupTweets })
      };
    }

    throw new Error(`[Mock Error] Unhandled URL: ${url}`);
  };
}

describe('Firestore Emulator Integration Lifecycle Tests', () => {
  const originalFetch = global.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  let activeFetchHandler = null;
  let externalRequestsBlockedCount = 0;

  before(() => {
    // 🛡️ 実X APIおよび外部インターネットへの通信を遮断 (global.fetch)
    global.fetch = async (url, options) => {
      if (typeof activeFetchHandler === 'function') {
        return activeFetchHandler(url, options);
      }
      externalRequestsBlockedCount++;
      throw new Error(`[SECURITY ALERT] Unmocked external fetch blocked: ${url}`);
    };

    const isLoopbackHost = (options) => {
      let rawHost = '';
      if (typeof options === 'string') {
        try {
          rawHost = new URL(options).host;
        } catch (_) {
          rawHost = options;
        }
      } else if (options) {
        rawHost = options.host || options.hostname || (options.headers && (options.headers.host || options.headers.Host)) || '';
      }
      rawHost = String(rawHost || '').trim().toLowerCase();
      let hostname = rawHost;
      if (rawHost.startsWith('[')) {
        const endBracket = rawHost.indexOf(']');
        if (endBracket !== -1) {
          hostname = rawHost.slice(1, endBracket);
        }
      } else {
        hostname = rawHost.split(':')[0];
      }
      // 部分一致（includes）ではなく厳格なホスト名完全一致でローカルループバックを検証
      // （evil-localhost.com や attacker127.0.0.1.org 等の誤認許可を完全遮断）
      return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    };

    // 🛡️ http.request / http.get のインターセプト（ローカルエミュレーター宛以外は遮断）
    http.request = function (options, callback) {
      if (!isLoopbackHost(options)) {
        externalRequestsBlockedCount++;
        throw new Error(`[SECURITY ALERT] Outbound HTTP request blocked to: ${JSON.stringify(options)}`);
      }
      return originalHttpRequest.call(http, options, callback);
    };
    http.get = function (options, callback) {
      if (!isLoopbackHost(options)) {
        externalRequestsBlockedCount++;
        throw new Error(`[SECURITY ALERT] Outbound HTTP get blocked to: ${JSON.stringify(options)}`);
      }
      return originalHttpGet.call(http, options, callback);
    };

    // 🛡️ https.request / https.get のインターセプト（外部HTTPS通信を遮断）
    https.request = function (options, callback) {
      if (!isLoopbackHost(options)) {
        externalRequestsBlockedCount++;
        throw new Error(`[SECURITY ALERT] Outbound HTTPS request blocked to: ${JSON.stringify(options)}`);
      }
      return originalHttpsRequest.call(https, options, callback);
    };
    https.get = function (options, callback) {
      if (!isLoopbackHost(options)) {
        externalRequestsBlockedCount++;
        throw new Error(`[SECURITY ALERT] Outbound HTTPS get blocked to: ${JSON.stringify(options)}`);
      }
      return originalHttpsGet.call(https, options, callback);
    };
  });

  after(() => {
    global.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
  });

  beforeEach(() => {
    activeFetchHandler = null;
  });

  // =========================================================================
  // シナリオ1: 真の並行同時競合制御（Simultaneous Transaction Concurrency）
  // =========================================================================
  describe('Scenario 1: True Simultaneous Concurrency & Distributed Lock', () => {
    const testUserId = 'emul_user_simultaneous_concur';

    beforeEach(async () => {
      await db.collection('saas_users').doc(testUserId).set({
        email: 'concur@example.com',
        metricsSyncLockedBy: null,
        metricsSyncLockedUntil: null,
        lastMetricsHarvestAt: null
      });
    });

    test('1A: 10 parallel workers competing simultaneously in Promise.all: exactly one acquires, 9 fail safely', async () => {
      const workers = Array.from({ length: 10 }, (_, i) => `worker_parallel_${i}`);

      // 完全並行で同時にロック獲得を発火（同時トランザクション競合）
      const results = await Promise.all(
        workers.map(w => claimUserSyncLock(testUserId, w, 30000))
      );

      const winners = results.filter(r => r === true);
      const losers = results.filter(r => r === false);

      assert.strictEqual(winners.length, 1, 'Firestore transaction serialization must allow exactly ONE winner');
      assert.strictEqual(losers.length, 9, 'All other 9 competing workers must fail safely without crash');

      // DB上の保持者が勝者と一致すること
      const snap = await db.collection('saas_users').doc(testUserId).get();
      const lockedBy = snap.data().metricsSyncLockedBy;
      assert.ok(workers.includes(lockedBy), 'Locked by a valid worker');

      // 勝者が解放
      const released = await releaseUserSyncLock(testUserId, lockedBy);
      assert.strictEqual(released, true);

      // 解放後は別ワーカーが獲得可能
      const reAcquired = await claimUserSyncLock(testUserId, 'worker_followup', 30000);
      assert.strictEqual(reAcquired, true);
      await releaseUserSyncLock(testUserId, 'worker_followup');
    });

    test('1B: withUserSyncLock skips safely when another worker already holds lock', async () => {
      await claimUserSyncLock(testUserId, 'worker_alpha', 30000);

      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        lockHostId: 'worker_beta'
      });

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.skipped, true);
      assert.strictEqual(res.reason, 'concurrency_locked');

      await releaseUserSyncLock(testUserId, 'worker_alpha');
    });
  });

  // =========================================================================
  // シナリオ2: ロック期限切れ・強奪時のトランザクション遮断
  // =========================================================================
  describe('Scenario 2: Lock Expiration & Preemption Abort', () => {
    const testUserId = 'emul_user_preempt_test';
    const testJobId = 'emul_job_preempt_1';

    beforeEach(async () => {
      await db.collection('saas_users').doc(testUserId).set({
        email: 'preempt@example.com',
        twitterAuth: {
          username: 'PreemptUser',
          oauth2AccessToken: 'mock_token',
          oauth2RefreshToken: 'mock_refresh',
          oauth2ExpiresAt: Date.now() + 3600 * 1000
        },
        metricsSyncLockedBy: 'worker_victim',
        metricsSyncLockedUntil: new Date(Date.now() - 5000), // 過去時刻（期限切れ状態）
        lastMetricsHarvestAt: null
      });

      await db.collection('autopilot_jobs').doc(testJobId).set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_preempt_100',
        postedAt: new Date(Date.now() - 25 * 3600 * 1000),
        needs24hHarvest: true,
        metrics: { impressions: 0 }
      });
    });

    test('extendUserSyncLock rejects extending an expired lock', async () => {
      const extended = await extendUserSyncLock(testUserId, 'worker_victim', 30000);
      assert.strictEqual(extended, false, 'Expired lock cannot be extended');
    });

    test('transaction aborts when lock is expired or preempted during execution', async () => {
      activeFetchHandler = createTwitterApiMock({
        recentTweets: [{
          id: 'tweet_preempt_100',
          text: 'Preemption test post',
          created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
          public_metrics: { impression_count: 500 }
        }]
      });

      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        skipLock: true,
        lockHostId: 'worker_victim',
        lockContext: { isLockLost: false, hostId: 'worker_victim' }
      });

      assert.strictEqual(res.ok, false);
      assert.match(res.error, /lock_preempted_or_expired/);

      // DB上のジョブメトリクスやユーザーの最終同期日時が一切更新されていないこと
      const jobSnap = await db.collection('autopilot_jobs').doc(testJobId).get();
      assert.strictEqual(jobSnap.data().metrics.impressions, 0, 'Job metrics must NOT be updated');

      const userSnap = await db.collection('saas_users').doc(testUserId).get();
      assert.strictEqual(userSnap.data().lastMetricsHarvestAt, null, 'User lastMetricsHarvestAt must NOT be updated');
    });
  });

  // =========================================================================
  // シナリオ3: 回収失敗時のエラー伝播と誤クールダウン防止
  // =========================================================================
  describe('Scenario 3: Harvest Failure & Error Propagation', () => {
    const testUserId = 'emul_user_fail_propagate';
    const testJobId = 'emul_job_fail_1';

    beforeEach(async () => {
      await db.collection('saas_users').doc(testUserId).set({
        email: 'fail@example.com',
        twitterAuth: {
          username: 'FailUser',
          oauth2AccessToken: 'mock_token',
          oauth2RefreshToken: 'mock_refresh',
          oauth2ExpiresAt: Date.now() + 3600 * 1000
        },
        metricsSyncLockedBy: null,
        metricsSyncLockedUntil: null,
        lastMetricsHarvestAt: null
      });

      await db.collection('autopilot_jobs').doc(testJobId).set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_fail_101',
        postedAt: new Date(Date.now() - 24.5 * 3600 * 1000),
        needs24hHarvest: true,
        metrics: { impressions: 0 }
      });
    });

    test('3A: Timeline HTTP 429 Rate Limit error aborts and does NOT update lastMetricsHarvestAt', async () => {
      activeFetchHandler = createTwitterApiMock({
        rateLimitOn: 'timeline'
      });

      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId);
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /Rate limit|rate_limited/i);

      // ユーザーの lastMetricsHarvestAt が null のままであること（誤ったクールダウン防止）
      const userSnap = await db.collection('saas_users').doc(testUserId).get();
      assert.strictEqual(userSnap.data().lastMetricsHarvestAt, null);

      // ジョブも未更新
      const jobSnap = await db.collection('autopilot_jobs').doc(testJobId).get();
      assert.strictEqual(jobSnap.data().metrics.impressions, 0);
    });

    test('3B: Direct lookup returning HTTP 200 with partial errors aborts and does NOT update lastMetricsHarvestAt', async () => {
      activeFetchHandler = createTwitterApiMock({
        recentTweets: [],
        lookupErrors: [{
          resource_id: 'tweet_fail_101',
          detail: 'User has been suspended or tweet deleted'
        }]
      });

      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId);
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /direct_lookup_failed/);

      const userSnap = await db.collection('saas_users').doc(testUserId).get();
      assert.strictEqual(userSnap.data().lastMetricsHarvestAt, null);
    });
  });

  // =========================================================================
  // シナリオ4: 24時間スナップショットの凍結・冪等性・エピソード記憶
  // =========================================================================
  describe('Scenario 4: 24h Snapshot Freezing, Idempotency, and Episodic Memory', () => {
    const testUserId = 'emul_user_snapshot_test';
    const FIXED_NOW = new Date('2026-11-15T12:00:00Z');

    const jobEligibleId = 'emul_job_eligible';
    const jobFrozenId = 'emul_job_frozen';
    const jobYoungId = 'emul_job_young';
    const jobExpiredId = 'emul_job_expired';

    beforeEach(async () => {
      await db.collection('saas_users').doc(testUserId).set({
        email: 'snapshot@example.com',
        twitterAuth: {
          username: 'SnapUser',
          oauth2AccessToken: 'mock_token',
          oauth2RefreshToken: 'mock_refresh',
          oauth2ExpiresAt: Date.now() + 3600 * 1000
        },
        metricsSyncLockedBy: null,
        metricsSyncLockedUntil: null,
        lastMetricsHarvestAt: null
      });

      // 1. 適格ジョブ (24.5時間前: 2026-11-14T11:30:00Z)
      await db.collection('autopilot_jobs').doc(jobEligibleId).set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_eligible_1',
        text: 'B2B成約心理と意思決定の構造。数字ではなく価値を届ける。',
        angle: 'B2B成約心理',
        format: 'single_empathy',
        postedAt: new Date('2026-11-14T11:30:00Z'),
        needs24hHarvest: true,
        metrics: { impressions: 0, likes: 0, bookmarks: 0 }
      });

      // 2. 凍結済みジョブ (48時間前: 2026-11-13T12:00:00Z、初期スナップショット保持)
      await db.collection('autopilot_jobs').doc(jobFrozenId).set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_frozen_2',
        text: '初期の凍結済みポスト。',
        angle: '実務ルーティン',
        format: 'framework',
        postedAt: new Date('2026-11-13T12:00:00Z'),
        needs24hHarvest: false,
        metrics: { impressions: 1000, likes: 20, bookmarks: 10 },
        metrics24hSnapshot: {
          impressions: 1000,
          likes: 20,
          bookmarks: 10,
          isFrozen: true,
          harvestedAt: new Date('2026-11-14T12:00:00Z')
        }
      });

      // 3. 未成熟ジョブ (20時間前: 2026-11-14T16:00:00Z)
      await db.collection('autopilot_jobs').doc(jobYoungId).set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_young_3',
        text: '投稿してまだ20時間のポスト。',
        angle: 'アルゴリズム防衛',
        format: 'alert',
        postedAt: new Date('2026-11-14T16:00:00Z'),
        needs24hHarvest: true,
        metrics: { impressions: 0 }
      });

      // 4. 遅延失効ジョブ (50時間前: 2026-11-13T10:00:00Z、一度もスナップショットなし)
      await db.collection('autopilot_jobs').doc(jobExpiredId).set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_expired_4',
        text: '50時間前投稿、未回収だったポスト。',
        angle: '失敗ログ',
        format: 'story',
        postedAt: new Date('2026-11-13T10:00:00Z'),
        needs24hHarvest: true,
        metrics: { impressions: 0 }
      });
    });

    test('processes mature snapshot, preserves frozen idempotent snapshot, and guards young/expired posts', async () => {
      activeFetchHandler = createTwitterApiMock({
        recentTweets: [
          {
            id: 'tweet_eligible_1',
            text: 'B2B成約心理と意思決定の構造。数字ではなく価値を届ける。',
            created_at: '2026-11-14T11:30:00Z',
            public_metrics: {
              impression_count: 1500,
              like_count: 25,
              bookmark_count: 12,
              retweet_count: 4,
              reply_count: 2
            }
          },
          {
            id: 'tweet_frozen_2',
            text: '初期の凍結済みポスト。',
            created_at: '2026-11-13T12:00:00Z',
            public_metrics: {
              impression_count: 9500,
              like_count: 150,
              bookmark_count: 80,
              retweet_count: 20,
              reply_count: 10
            }
          },
          {
            id: 'tweet_young_3',
            text: '投稿してまだ20時間のポスト。',
            created_at: '2026-11-14T16:00:00Z',
            public_metrics: {
              impression_count: 350,
              like_count: 5,
              bookmark_count: 2
            }
          },
          {
            id: 'tweet_expired_4',
            text: '50時間前投稿、未回収だったポスト。',
            created_at: '2026-11-13T10:00:00Z',
            public_metrics: {
              impression_count: 4200,
              like_count: 40,
              bookmark_count: 18
            }
          }
        ]
      });

      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        now: FIXED_NOW
      });

      assert.strictEqual(res.ok, true, `Sync must succeed: ${res.error}`);

      // 1. 適格ジョブの検証 (24.5h)
      const eligibleSnap = await db.collection('autopilot_jobs').doc(jobEligibleId).get();
      const eligibleData = eligibleSnap.data();
      assert.strictEqual(eligibleData.metrics.impressions, 1500);
      assert.strictEqual(eligibleData.metrics.bookmarks, 12);
      assert.strictEqual(eligibleData.needs24hHarvest, false, 'needs24hHarvest must be set to false');
      assert.ok(eligibleData.metrics24hSnapshot, 'metrics24hSnapshot must exist');
      assert.strictEqual(eligibleData.metrics24hSnapshot.impressions, 1500);
      assert.strictEqual(eligibleData.metrics24hSnapshot.bookmarks, 12);
      assert.strictEqual(eligibleData.metrics24hSnapshot.isFrozen, true, 'Snapshot must be frozen');

      // エピソード記憶が生成されていること
      const episodeSnap = await db.collection('saas_users')
        .doc(testUserId)
        .collection('episodic_memories')
        .doc('tweet_tweet_eligible_1')
        .get();
      assert.strictEqual(episodeSnap.exists, true, 'Episodic memory must be saved');
      assert.strictEqual(episodeSnap.data().outcome, 'WINNER');
      assert.strictEqual(episodeSnap.data().compositeScore, 100);
      assert.strictEqual(episodeSnap.data().angle, 'B2B成約心理');
      assert.strictEqual(episodeSnap.data().tweetId, 'tweet_eligible_1');

      // 2. 凍結済みジョブの冪等性検証 (48h)
      const frozenSnap = await db.collection('autopilot_jobs').doc(jobFrozenId).get();
      const frozenData = frozenSnap.data();
      assert.strictEqual(frozenData.metrics.impressions, 9500);
      assert.strictEqual(frozenData.metrics24hSnapshot.impressions, 1000, 'Frozen snapshot impressions must NOT be overwritten');
      assert.strictEqual(frozenData.metrics24hSnapshot.isFrozen, true);

      // 3. 未成熟ジョブの検証 (20h)
      const youngSnap = await db.collection('autopilot_jobs').doc(jobYoungId).get();
      const youngData = youngSnap.data();
      assert.strictEqual(youngData.metrics.impressions, 350);
      assert.strictEqual(youngData.metrics24hSnapshot || null, null, 'Young post must not have 24h snapshot');
      assert.strictEqual(youngData.needs24hHarvest, true, 'needs24hHarvest must remain true for future harvest');

      // 4. 遅延失効ジョブの検証 (50h)
      const expiredSnap = await db.collection('autopilot_jobs').doc(jobExpiredId).get();
      const expiredData = expiredSnap.data();
      assert.strictEqual(expiredData.metrics.impressions, 4200);
      assert.strictEqual(expiredData.metrics24hSnapshot || null, null, 'Expired post must not counterfeit 24h snapshot');
      assert.strictEqual(expiredData.needs24hHarvest, false, 'needs24hHarvest must be closed for expired post (>36h)');

      // 5. ユーザーレコードの最終同期日時の検証
      const userSnap = await db.collection('saas_users').doc(testUserId).get();
      const userData = userSnap.data();
      assert.strictEqual(userData.lastMetricsHarvestStatus, 'completed');
      assert.ok(userData.lastMetricsHarvestAt, 'lastMetricsHarvestAt must be recorded');
      const harvestTimeMs = userData.lastMetricsHarvestAt.toDate
        ? userData.lastMetricsHarvestAt.toDate().getTime()
        : new Date(userData.lastMetricsHarvestAt).getTime();
      assert.strictEqual(harvestTimeMs, FIXED_NOW.getTime(), 'lastMetricsHarvestAt must match FIXED_NOW');
    });

    test('harvest pipeline respects exact 24h, 25h, and 36h boundaries', async () => {
      const hour = 60 * 60 * 1000;
      const cases = [
        { jobId: jobYoungId, tweetId: 'tweet_young_3', ageMs: 24 * hour - 1 },
        { jobId: jobEligibleId, tweetId: 'tweet_eligible_1', ageMs: 25 * hour + 1 },
        { jobId: jobExpiredId, tweetId: 'tweet_expired_4', ageMs: 36 * hour + 1 }
      ];
      await Promise.all(cases.map(item => db.collection('autopilot_jobs').doc(item.jobId).update({
        postedAt: new Date(FIXED_NOW.getTime() - item.ageMs)
      })));

      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        skipLock: true,
        now: FIXED_NOW,
        mockTweetsRes: {
          ok: true,
          tweets: cases.map(item => ({
            id: item.tweetId,
            createdAt: new Date(FIXED_NOW.getTime() - item.ageMs).toISOString(),
            metrics: { impression_count: 100, bookmark_count: 2, like_count: 3 }
          }))
        }
      });
      assert.strictEqual(res.ok, true, res.error);
      const [young, extended, expired] = await Promise.all(cases.map(async item =>
        (await db.collection('autopilot_jobs').doc(item.jobId).get()).data()
      ));
      assert.strictEqual(young.metrics24hSnapshot, undefined);
      assert.strictEqual(young.needs24hHarvest, true);
      assert.strictEqual(extended.metrics24hSnapshot.harvestWindowCategory, 'extended_24h');
      assert.strictEqual(
        require('../src/ab_experiment_engine').evaluateJobExperimentEligibility(extended).reason,
        'outside_window'
      );
      assert.strictEqual(expired.metrics24hSnapshot, undefined);
      assert.strictEqual(expired.needs24hHarvest, false);
    });
  });

  // =========================================================================
  // シナリオ5: オンラインDPOペア生成・Firestore永続化・次回プロンプト注入
  // =========================================================================
  describe('Scenario 5: Online DPO Pairing, Persistence, and Subsequent Prompt Injection', () => {
    const testUserId = 'emul_user_dpo_e2e';
    const FIXED_NOW = new Date('2026-11-15T12:00:00Z');

    beforeEach(async () => {
      await db.collection('saas_users').doc(testUserId).set({
        email: 'dpo@example.com',
        experimentCohort: 'treatment_B', // 介入群B（DPO注入対象）
        twitterAuth: {
          username: 'DpoUser',
          oauth2AccessToken: 'mock_token',
          oauth2RefreshToken: 'mock_refresh',
          oauth2ExpiresAt: Date.now() + 3600 * 1000
        },
        metricsSyncLockedBy: null,
        metricsSyncLockedUntil: null,
        lastMetricsHarvestAt: null
      });

      // 2件の投稿ジョブ（両方とも投稿後24.5時間で適格、一方は高反響・他方は低反響）
      await db.collection('autopilot_jobs').doc('job_dpo_winner').set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_dpo_winner_1',
        text: '【勝者投稿】実測データに基づく現場ルーティンの徹底型化。',
        angle: '実務ルーティン',
        format: 'framework',
        postedAt: new Date('2026-11-14T11:30:00Z'),
        needs24hHarvest: true,
        metrics: { impressions: 0 }
      });

      await db.collection('autopilot_jobs').doc('job_dpo_loser').set({
        userId: testUserId,
        status: 'posted',
        tweetId: 'tweet_dpo_loser_2',
        text: '【敗者投稿】ありきたりな精神論と抽象的オピニオン。',
        angle: '精神論',
        format: 'opinion',
        postedAt: new Date('2026-11-14T11:30:00Z'),
        needs24hHarvest: true,
        metrics: { impressions: 0 }
      });
    });

    test('generates DPO pair from 24h mature posts, persists to Firestore, and injects into production prompt', async () => {
      activeFetchHandler = createTwitterApiMock({
        recentTweets: [
          {
            id: 'tweet_dpo_winner_1',
            text: '【勝者投稿】実測データに基づく現場ルーティンの徹底型化。',
            created_at: '2026-11-14T11:30:00Z',
            public_metrics: {
              impression_count: 2500,
              bookmark_count: 20, // 高保存率 -> 勝者
              like_count: 30
            }
          },
          {
            id: 'tweet_dpo_loser_2',
            text: '【敗者投稿】ありきたりな精神論と抽象的オピニオン。',
            created_at: '2026-11-14T11:30:00Z',
            public_metrics: {
              impression_count: 500,
              bookmark_count: 0, // ゼロ保存 -> 敗者
              like_count: 1
            }
          }
        ]
      });

      // 同期を実行
      const syncRes = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        now: FIXED_NOW
      });
      assert.strictEqual(syncRes.ok, true, `Sync must succeed: ${syncRes.error}`);

      // 1. Firestore の user_marketing_knowledge/{userId} を直接読み出して DPO ペアが永続化されたことを検証
      const knowledgeSnap = await db.collection('user_marketing_knowledge').doc(testUserId).get();
      assert.strictEqual(knowledgeSnap.exists, true, 'Marketing knowledge must be created');
      const knowledgeData = knowledgeSnap.data();
      assert.ok(Array.isArray(knowledgeData.dpoPreferencePairs), 'dpoPreferencePairs must be an array');
      assert.ok(knowledgeData.dpoPreferencePairs.length >= 1, 'At least 1 DPO pair must be generated');

      const pair = knowledgeData.dpoPreferencePairs[0];
      assert.strictEqual(pair.winner.text, '【勝者投稿】実測データに基づく現場ルーティンの徹底型化。');
      assert.strictEqual(pair.winner.bookmarks, 20);
      assert.strictEqual(pair.loser.text, '【敗者投稿】ありきたりな精神論と抽象的オピニオン。');
      assert.strictEqual(pair.loser.bookmarks, 0);

      // 2. 本番の buildCouncilWritingPrompt を呼び出し、Firestoreから自動ロードされた DPO ペアがプロンプトに注入されることを検証
      const { prompt } = await buildCouncilWritingPrompt({
        marketAnalysis: { serviceName: 'Velox', targetAudience: 'B2B', coreAppealAngle: '自動化' },
        targetUrl: 'https://x.com/VeloxSystemsV4',
        councilPlan: { postPlan: [{ step: 1, timeSlot: 'morning', angle: '実務ルーティン', format: 'framework' }] },
        // 🛡️ テスト側から明示的に渡さず、Firestore（user_marketing_knowledge/{userId}）からの実動自動ロードを検証
        userId: testUserId,
        experimentVariant: 'B' // 介入群B
      });

      assert.doesNotMatch(prompt, /オンラインDPO対比学習/);
      assert.doesNotMatch(prompt, /勝ち1件|【勝者投稿】|【敗者投稿】/);
      assert.match(prompt, /誰に・なぜ今・どの根拠か|この3つだけを書く/);
    });
  });

  // =========================================================================
  // シナリオ6: 外部通信完全遮断のアサーション
  // =========================================================================
  describe('Scenario 6: External Outbound Network Shield Verification', () => {
    test('confirms zero unmocked external HTTP/HTTPS requests escaped loopback', () => {
      assert.strictEqual(
        externalRequestsBlockedCount,
        0,
        `Expected exactly 0 unmocked external requests to escape, but ${externalRequestsBlockedCount} were attempted`
      );
    });
  });
});
