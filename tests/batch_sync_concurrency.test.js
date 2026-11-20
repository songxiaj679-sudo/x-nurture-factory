/**
 * @file tests/batch_sync_concurrency.test.js
 * @description 同時実行時の分散ロック（User Sync Lock）およびFirestoreトランザクション競合保護の結合検証テスト
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

// 🛡️ 本番DBへの誤接続を絶対防止（FIRESTORE_EMULATOR_HOST未設定時は安全にスキップ）
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  describe.skip('Batch Sync & Concurrency Protection (Skipped: FIRESTORE_EMULATOR_HOST not set)', () => {
    test('skipped when emulator host is not set', () => {});
  });
  return;
}

const { db } = require('../src/firestore');
const { claimUserSyncLock, releaseUserSyncLock, withUserSyncLock } = require('../src/user_sync_mutex');
const { resolve24hMetricsSnapshot, normalizeTweetMetrics } = require('../src/metrics_harvest_engine');
const { harvestTweetMetricsAndEvolveKnowledge } = require('../src/autonomous_promo_ai');

describe('Batch Sync & Concurrency Protection (VELOX 4.0)', () => {
  const testUserId = `test_concurrency_user_${Date.now()}`;
  const testJobId = `job_concurrency_${Date.now()}`;

  before(async () => {
    // テスト用ユーザー作成
    await db.collection('saas_users').doc(testUserId).set({
      targetUrl: 'https://example.com/test',
      planId: 'pro',
      experimentCohort: 'treatment_B',
      createdAt: new Date()
    });

    // テスト用投稿ジョブ作成（24時間経過・未凍結）
    const postedAt = new Date(Date.now() - 24.1 * 60 * 60 * 1000);
    await db.collection('autopilot_jobs').doc(testJobId).set({
      userId: testUserId,
      tweetId: 'tweet_concurrent_123',
      text: '同時実行テスト用の投稿テキスト',
      angle: 'pain_point',
      format: 'punchline',
      status: 'posted',
      postedAt,
      metrics24hSnapshot: null
    });
  });

  after(async () => {
    // テストデータのクリーンアップ
    try {
      await db.collection('saas_users').doc(testUserId).delete();
      await db.collection('autopilot_jobs').doc(testJobId).delete();
      await db.collection('user_marketing_knowledge').doc(testUserId).delete();
    } catch (e) {}
  });

  describe('User-Level Sync Lock (withUserSyncLock)', () => {
    test('strictly prevents concurrent syncs for the same user', async () => {
      let worker1ExecutionStarted = false;
      let worker1CanFinish = false;

      // ワーカー1: 1秒間ロックを保持して処理を模倣
      const worker1Promise = withUserSyncLock(testUserId, 'worker_1', 10000, async () => {
        worker1ExecutionStarted = true;
        while (!worker1CanFinish) {
          await new Promise(r => setTimeout(r, 50));
        }
        return { worker: 1, success: true };
      });

      // ワーカー1がロックを握るまで少し待機
      while (!worker1ExecutionStarted) {
        await new Promise(r => setTimeout(r, 10));
      }

      // ワーカー2: 同一ユーザーに対して同時にロック獲得を試みる
      const worker2Result = await withUserSyncLock(testUserId, 'worker_2', 10000, async () => {
        return { worker: 2, success: true };
      });

      // ワーカー2は競合により即座に拒否（acquired: false）されること
      assert.strictEqual(worker2Result.acquired, false, 'ワーカー2はロック獲得に失敗しスキップされるべき');
      assert.strictEqual(worker2Result.result, null);

      // ワーカー1を完了させる
      worker1CanFinish = true;
      const worker1Result = await worker1Promise;
      assert.strictEqual(worker1Result.acquired, true);
      assert.strictEqual(worker1Result.result.worker, 1);

      // ワーカー1終了後は、次のリクエストが正常にロックを獲得できること
      const worker3Result = await withUserSyncLock(testUserId, 'worker_3', 10000, async () => {
        return { worker: 3, success: true };
      });
      assert.strictEqual(worker3Result.acquired, true, '先行処理の終了後は再獲得可能であること');
      assert.strictEqual(worker3Result.result.worker, 3);
    });

    test('harvestTweetMetricsAndEvolveKnowledge safely skips when locked by another process', async () => {
      // 外部プロセスがロックを保持している状態をシミュレート
      const lockAcquired = await claimUserSyncLock(testUserId, 'external_cron_host', 60000);
      assert.strictEqual(lockAcquired, true);

      try {
        // harvestTweetMetricsAndEvolveKnowledge を実行
        const harvestRes = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
          lockHostId: 'api_worker_manual_call',
          mockTweetsRes: { ok: true, tweets: [] }
        });

        // 競合時は安全にスキップ（ok: true, skipped: true）されること
        assert.strictEqual(harvestRes.ok, true);
        assert.strictEqual(harvestRes.skipped, true);
        assert.strictEqual(harvestRes.reason, 'concurrency_locked');
      } finally {
        await releaseUserSyncLock(testUserId, 'external_cron_host');
      }
    });
  });

  describe('Atomic Transaction Snapshot Race Protection', () => {
    test('transaction prevents race conditions when writing 24h snapshot', async () => {
      const jobRef = db.collection('autopilot_jobs').doc(testJobId);
      const postedAt = new Date(Date.now() - 24.1 * 60 * 60 * 1000);
      const now = new Date();

      // 初期状態をスナップショット未凍結（null）にリセット
      await jobRef.update({ metrics24hSnapshot: null });

      // 2つの並行トランザクションが同時に同一ジョブへのスナップショット確定を試みる
      const candidateA = normalizeTweetMetrics({ impression_count: 1200, bookmark_count: 15, like_count: 30 });
      const candidateB = normalizeTweetMetrics({ impression_count: 9999, bookmark_count: 99, like_count: 99 });

      // トランザクション書き込み処理の定義
      const executeAtomicSnapshotUpdate = async (normalized) => {
        return await db.runTransaction(async (transaction) => {
          const freshSnap = await transaction.get(jobRef);
          const freshData = freshSnap.data() || {};
          const alreadyFrozen = freshData.metrics24hSnapshot && freshData.metrics24hSnapshot.isFrozen
            ? freshData.metrics24hSnapshot
            : null;

          const resolved = resolve24hMetricsSnapshot({
            postedAt,
            harvestedAt: now,
            normalizedMetrics: normalized,
            existingSnapshot: alreadyFrozen
          });

          const updatePayload = {
            'metrics.impressions': normalized.impressions,
            'metrics.bookmarks': normalized.bookmarks,
            updatedAt: now
          };

          if (resolved && !alreadyFrozen) {
            updatePayload.metrics24hSnapshot = resolved;
          }

          transaction.update(jobRef, updatePayload);
          return { alreadyFrozen: !!alreadyFrozen, appliedSnapshot: resolved };
        });
      };

      // ほぼ同時に2つの更新を実行
      const [resA, resB] = await Promise.all([
        executeAtomicSnapshotUpdate(candidateA),
        executeAtomicSnapshotUpdate(candidateB)
      ]);

      // 最終的なDB状態を検証
      const finalDoc = await jobRef.get();
      const finalSnapshot = finalDoc.data()?.metrics24hSnapshot;

      assert.ok(finalSnapshot);
      assert.strictEqual(finalSnapshot.isFrozen, true);

      // どちらか一方のみが初期スナップショットとして凍結され、もう一方は上書きされずブロックされていること
      const isA = finalSnapshot.impressions === 1200 && finalSnapshot.bookmarks === 15;
      const isB = finalSnapshot.impressions === 9999 && finalSnapshot.bookmarks === 99;
      assert.ok(isA || isB, 'スナップショットはAまたはBのいずれかで確定すること');

      // 2つのトランザクションのうち、一方は alreadyFrozen: false（新規作成）、他方は alreadyFrozen: true（既存検出）であること
      const oneCreatedOneBlocked = (resA.alreadyFrozen !== resB.alreadyFrozen);
      assert.ok(oneCreatedOneBlocked, 'トランザクションにより一方がスナップショットを凍結し、他方は上書きを回避したこと');
    });

    test('aborts execution when lock is lost or preempted mid-flight', async () => {
      // ロック喪失状態 (isLockLost: true) を渡して同期を実行
      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        skipLock: true,
        lockContext: { userId: testUserId, hostId: 'test_worker', isLockLost: true },
        mockTweetsRes: {
          ok: true,
          tweets: [{ id: 'tweet_lock_lost_test', text: 'Lock lost test', metrics: { impression_count: 100 } }]
        }
      });

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'lock_lost_during_execution');
    });
  });

  describe('Graceful Shutdown & Process Timeout Protection', () => {
    test('ecosystem.config.js configures kill_timeout >= 30000ms for background engines', () => {
      const ecosystem = require('../ecosystem.config.js');
      const replyEngine = ecosystem.apps.find(a => a.name === 'x-reply-engine');
      const batchEngine = ecosystem.apps.find(a => a.name === 'x-batch-engine');

      assert.ok(replyEngine, 'x-reply-engine app config should exist');
      assert.ok(replyEngine.kill_timeout >= 30000, `x-reply-engine kill_timeout (${replyEngine.kill_timeout}) must be >= 30000ms`);

      assert.ok(batchEngine, 'x-batch-engine app config should exist');
      assert.ok(batchEngine.kill_timeout >= 30000, `x-batch-engine kill_timeout (${batchEngine.kill_timeout}) must be >= 30000ms`);
    });
  });

  describe('A/B Experiment Eligibility Strict Window Verification', () => {
    test('evaluateJobExperimentEligibility strictly enforces 24.0h - 25.0h window for myStats eligibleJobs', () => {
      const { evaluateJobExperimentEligibility } = require('../src/ab_experiment_engine');

      const matureEligibleJob = {
        metricsHarvestStatus: 'ok',
        metrics: { impressions: 1000, bookmarks: 12 },
        metrics24hSnapshot: { isFrozen: true, postAgeHours: 24.3, impressions: 1000, bookmarks: 12 }
      };
      assert.strictEqual(evaluateJobExperimentEligibility(matureEligibleJob).isEligible, true);

      const immatureJob = {
        metricsHarvestStatus: 'ok',
        metrics: { impressions: 1000, bookmarks: 12 },
        metrics24hSnapshot: { isFrozen: true, postAgeHours: 23.5, impressions: 1000, bookmarks: 12 }
      };
      assert.strictEqual(evaluateJobExperimentEligibility(immatureJob).isEligible, false);
      assert.strictEqual(evaluateJobExperimentEligibility(immatureJob).reason, 'immature');

      const lateJob = {
        metricsHarvestStatus: 'ok',
        metrics: { impressions: 1000, bookmarks: 12 },
        metrics24hSnapshot: { isFrozen: true, postAgeHours: 26.2, impressions: 1000, bookmarks: 12 }
      };
      assert.strictEqual(evaluateJobExperimentEligibility(lateJob).isEligible, false);
      assert.strictEqual(evaluateJobExperimentEligibility(lateJob).reason, 'outside_window');
    });
  });

  describe('Firestore Lock Timestamp Parsing & Expiration Robustness', () => {
    test('parseFirestoreTimestampMs safely handles Timestamp, seconds object, Date, string, and invalid values without NaN', () => {
      const { parseFirestoreTimestampMs } = require('../src/user_sync_mutex');

      // 1. Timestamp-like object with toMillis
      const tsObj = { toMillis: () => 1794732000000 };
      assert.strictEqual(parseFirestoreTimestampMs(tsObj), 1794732000000);

      // 2. Timestamp-like object with toDate
      const toDateObj = { toDate: () => new Date('2026-11-15T12:00:00Z') };
      assert.strictEqual(parseFirestoreTimestampMs(toDateObj), new Date('2026-11-15T12:00:00Z').getTime());

      // 3. Serialized Firestore timestamp { _seconds, _nanoseconds }
      const rawSecObj = { _seconds: 1794732000, _nanoseconds: 500000000 };
      assert.strictEqual(parseFirestoreTimestampMs(rawSecObj), 1794732000500);

      // 4. Standard Date instance
      const dateInstance = new Date('2026-11-15T10:00:00Z');
      assert.strictEqual(parseFirestoreTimestampMs(dateInstance), dateInstance.getTime());

      // 5. ISO String
      const isoStr = '2026-11-15T10:00:00Z';
      assert.strictEqual(parseFirestoreTimestampMs(isoStr), new Date(isoStr).getTime());

      // 6. Number ms
      assert.strictEqual(parseFirestoreTimestampMs(1794732000000), 1794732000000);

      // 7. Null / Undefined / Invalid
      assert.strictEqual(parseFirestoreTimestampMs(null), 0);
      assert.strictEqual(parseFirestoreTimestampMs(undefined), 0);
      assert.strictEqual(parseFirestoreTimestampMs('invalid-date'), 0);
      assert.strictEqual(parseFirestoreTimestampMs({}), 0);
    });

    test('extendUserSyncLock strictly refuses to extend an already expired lock', async () => {
      const { extendUserSyncLock } = require('../src/user_sync_mutex');

      // ロック有効期限を過去（5分前）に直接設定
      const pastLockUntil = new Date(Date.now() - 5 * 60 * 1000);
      await db.collection('saas_users').doc(testUserId).set({
        metricsSyncLockedBy: 'expired_host',
        metricsSyncLockedUntil: pastLockUntil
      }, { merge: true });

      // 期限切れロックの延長を試行
      const extended = await extendUserSyncLock(testUserId, 'expired_host', 60000, 1);
      assert.strictEqual(extended, false, '既に期限切れしたロックは延長を拒絶してロック喪失と判定すべき');
    });

    test('harvestTweetMetricsAndEvolveKnowledge aborts cleanly without recording false cooldown when tweet fetch fails', async () => {
      // ユーザーの前回の同期時刻をリセット
      const originalTime = new Date('2026-11-15T00:00:00Z');
      await db.collection('saas_users').doc(testUserId).set({
        lastMetricsHarvestAt: originalTime
      }, { merge: true });

      // APIエラー（HTTP 429 Rate Limit等）をシミュレート
      const res = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        mockTweetsRes: { ok: false, error: 'Rate limit exceeded (HTTP 429)' }
      });

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'Rate limit exceeded (HTTP 429)');

      // 失敗時に lastMetricsHarvestAt が更新されておらず、誤ったクールダウンに入っていないことを検証
      const userSnap = await db.collection('saas_users').doc(testUserId).get();
      const userData = userSnap.data() || {};
      const { parseFirestoreTimestampMs } = require('../src/user_sync_mutex');
      assert.strictEqual(parseFirestoreTimestampMs(userData.lastMetricsHarvestAt), originalTime.getTime());
    });
  });

  describe('ID Lookup Chunking & Error Propagation Robustness', () => {
    test('lookupTweetsByIds chunks 150 IDs into 100 + 50 requests and merges all 150 tweets', async () => {
      const { lookupTweetsByIds } = require('../src/official_api_client');
      const mockIds = Array.from({ length: 150 }, (_, i) => `tweet_id_${i + 1}`);
      const fetchCalls = [];

      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        fetchCalls.push(url);
        const urlObj = new URL(url);
        const ids = (urlObj.searchParams.get('ids') || '').split(',').filter(Boolean);
        const mockData = ids.map(id => ({ id, text: `Text ${id}`, created_at: '2026-11-15T00:00:00Z' }));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: mockData })
        };
      };

      try {
        const res = await lookupTweetsByIds({ oauth2AccessToken: 'mock_test_token' }, mockIds);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(fetchCalls.length, 2, '150件のIDは100件と50件の2回に分割リクエストされること');
        assert.strictEqual(res.tweets.length, 150, '150件全件が切り捨てられず返却されること');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('lookupTweetsByIds handles mid-flight failure on 2nd chunk (HTTP 429) cleanly with error propagation', async () => {
      const { lookupTweetsByIds } = require('../src/official_api_client');
      const mockIds = Array.from({ length: 150 }, (_, i) => `tweet_id_${i + 1}`);
      let callCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        callCount++;
        if (callCount === 1) {
          const ids = new URL(url).searchParams.get('ids').split(',');
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: ids.map(id => ({ id, text: `Text ${id}` })) })
          };
        }
        return {
          ok: false,
          status: 429,
          json: async () => ({ errors: [{ message: 'Too Many Requests' }] })
        };
      };

      try {
        const res = await lookupTweetsByIds({ oauth2AccessToken: 'mock_test_token' }, mockIds);
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.status, 429);
        assert.ok(res.error.includes('Too Many Requests'));
        assert.strictEqual(res.tweets.length, 100, '第1チャンクの部分結果が保持されること');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('getUserProfileAndRecentTweets returns error instead of ok:true when credentials are missing', async () => {
      const { getUserProfileAndRecentTweets } = require('../src/official_api_client');
      const res = await getUserProfileAndRecentTweets({ apiKey: 'mock' });
      assert.strictEqual(res.ok, false);
      assert.ok(res.error, '認証情報不足エラーが返却されること');
    });
  });
});
