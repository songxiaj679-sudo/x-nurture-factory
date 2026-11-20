/**
 * @file tests/metrics_harvest_engine.test.js
 * @description 実績計測の統一エンジン（正規化・24hスナップショット固定化・欠損除外・厳格ID突合）の単体・境界値テスト
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  normalizeTweetMetrics,
  buildEarlyMetricsSnapshot,
  computePostAgeHours,
  resolve24hMetricsSnapshot,
  filterValidMaturePostsForLearning,
  matchTweetToJob,
  evaluateUserSyncEligibility,
  parseFirestoreTimestampMs
} = require('../src/metrics_harvest_engine');

describe('Metrics Harvest Engine (VELOX 4.0)', () => {
  describe('normalizeTweetMetrics', () => {
    test('normalizes valid positive metrics', () => {
      const raw = {
        impression_count: 1500,
        bookmark_count: 12,
        like_count: 25,
        retweet_count: 3,
        quote_count: 1,
        reply_count: 2
      };
      const res = normalizeTweetMetrics(raw);
      assert.strictEqual(res.isMissing, false);
      assert.strictEqual(res.status, 'valid');
      assert.strictEqual(res.impressions, 1500);
      assert.strictEqual(res.bookmarks, 12);
      assert.strictEqual(res.likes, 25);
    });

    test('distinguishes genuine zero impressions and bookmarks from missing data', () => {
      const zeroMetrics = {
        impression_count: 0,
        bookmark_count: 0,
        like_count: 0
      };
      const res = normalizeTweetMetrics(zeroMetrics);
      assert.strictEqual(res.isMissing, false);
      assert.strictEqual(res.status, 'valid');
      assert.strictEqual(res.impressions, 0);
      assert.strictEqual(res.bookmarks, 0);
    });

    test('identifies missing data when impression_count or bookmark_count is null or undefined without zero-coercion', () => {
      const nullImpMetrics = { impression_count: null, bookmark_count: 2, like_count: 5 };
      const nullBmMetrics = { impression_count: 1000, bookmark_count: null, like_count: 5 };
      const undefImpMetrics = { bookmark_count: 2, like_count: 5 };
      const emptyObject = {};
      const nullInput = null;

      const resNullImp = normalizeTweetMetrics(nullImpMetrics);
      assert.strictEqual(resNullImp.isMissing, true);
      assert.strictEqual(resNullImp.impressions, null);

      const resNullBm = normalizeTweetMetrics(nullBmMetrics);
      assert.strictEqual(resNullBm.isMissing, true);
      assert.strictEqual(resNullBm.bookmarks, null, '欠損したブックマークをゼロに暗黙変換してはならない');

      assert.strictEqual(normalizeTweetMetrics(undefImpMetrics).isMissing, true);
      assert.strictEqual(normalizeTweetMetrics(emptyObject).isMissing, true);
      assert.strictEqual(normalizeTweetMetrics(nullInput).isMissing, true);
    });

    test('rejects invalid counts instead of treating them as zero or valid metrics', () => {
      for (const value of [-1, Infinity, NaN, '', '  ', true, [], 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const result = normalizeTweetMetrics({ impression_count: 100, bookmark_count: value, like_count: 1 });
        assert.strictEqual(result.bookmarks, null);
        assert.strictEqual(result.isMissing, true);
      }
      assert.strictEqual(normalizeTweetMetrics({
        impression_count: '100', bookmark_count: '0', like_count: '1'
      }).isMissing, false);
    });
  });

  describe('computePostAgeHours', () => {
    test('accurately calculates elapsed hours from postedAt to referenceTime', () => {
      const now = new Date('2026-11-15T12:00:00Z');
      const posted24hAgo = new Date('2026-11-14T12:00:00Z');
      const posted12hAgo = new Date('2026-11-15T00:00:00Z');

      assert.strictEqual(computePostAgeHours(posted24hAgo, now), 24);
      assert.strictEqual(computePostAgeHours(posted12hAgo, now), 12);
    });

    test('returns null for invalid or missing timestamps', () => {
      assert.strictEqual(computePostAgeHours(null), null);
      assert.strictEqual(computePostAgeHours('invalid_date_string'), null);
    });
  });

  describe('resolve24hMetricsSnapshot (Boundary & Idempotency)', () => {
    const referenceTime = new Date('2026-11-15T12:00:00Z');

    test('boundary value: returns null when post age is 23.9 hours (< 24h immature)', () => {
      // 23.9時間前
      const postedAt = new Date(referenceTime.getTime() - (23.9 * 60 * 60 * 1000));
      const metrics = normalizeTweetMetrics({ impression_count: 800, bookmark_count: 5, like_count: 10 });

      const snapshot = resolve24hMetricsSnapshot({
        postedAt,
        harvestedAt: referenceTime,
        normalizedMetrics: metrics
      });

      assert.strictEqual(snapshot, null, '24時間未満の投稿は24hスナップショットを確定してはならない');
    });

    test('boundary value: creates frozen snapshot when post age is exactly 24.0 hours', () => {
      // 24.0時間前
      const postedAt = new Date(referenceTime.getTime() - (24.0 * 60 * 60 * 1000));
      const metrics = normalizeTweetMetrics({ impression_count: 950, bookmark_count: 7, like_count: 14 });

      const snapshot = resolve24hMetricsSnapshot({
        postedAt,
        harvestedAt: referenceTime,
        normalizedMetrics: metrics
      });

      assert.ok(snapshot);
      assert.strictEqual(snapshot.isFrozen, true);
      assert.strictEqual(snapshot.impressions, 950);
      assert.strictEqual(snapshot.bookmarks, 7);
      assert.strictEqual(snapshot.postAgeHours, 24);
      assert.strictEqual(snapshot.snapshotVersion, 1);
    });

    test('uses the exact observation time at the 24h, 25h, and 36h boundaries', () => {
      const metrics = normalizeTweetMetrics({ impression_count: 950, bookmark_count: 7, like_count: 14 });
      const snapshotAtAge = ageMs => resolve24hMetricsSnapshot({
        postedAt: new Date(referenceTime.getTime() - ageMs),
        harvestedAt: referenceTime,
        normalizedMetrics: metrics
      });
      const hour = 60 * 60 * 1000;

      assert.strictEqual(snapshotAtAge(24 * hour - 1), null);
      assert.strictEqual(snapshotAtAge(24 * hour).harvestWindowCategory, 'exact_24h');
      assert.strictEqual(snapshotAtAge(25 * hour).harvestWindowCategory, 'exact_24h');
      const after25 = snapshotAtAge(25 * hour + 1);
      assert.strictEqual(after25.harvestWindowCategory, 'extended_24h');
      assert.ok(after25.postAgeHours > 25);
      assert.ok(snapshotAtAge(36 * hour));
      assert.strictEqual(snapshotAtAge(36 * hour + 1), null);
    });

    test('boundary value: returns null when first harvest is late (e.g. 48h > 36h max window)', () => {
      // 48時間前の投稿を初めて取得した場合（24時間スナップショットとして偽造してはならない）
      const postedAt = new Date(referenceTime.getTime() - (48 * 60 * 60 * 1000));
      const metrics = normalizeTweetMetrics({ impression_count: 2500, bookmark_count: 20, like_count: 40 });

      const snapshot = resolve24hMetricsSnapshot({
        postedAt,
        harvestedAt: referenceTime,
        normalizedMetrics: metrics
      });

      assert.strictEqual(snapshot, null, '36時間を超過して初回取得されたメトリクスを24hスナップショットとして保存してはならない');
    });

    test('re-harvest idempotency: preserves initial 24h snapshot when re-harvested at 48 hours', () => {
      const initialHarvestTime = new Date('2026-11-15T12:00:00Z');
      const postedAt = new Date(initialHarvestTime.getTime() - (24 * 60 * 60 * 1000));

      // 1回目の計測（24h時点）
      const initialMetrics = normalizeTweetMetrics({ impression_count: 1000, bookmark_count: 8, like_count: 15 });
      const frozenSnapshot = resolve24hMetricsSnapshot({
        postedAt,
        harvestedAt: initialHarvestTime,
        normalizedMetrics: initialMetrics
      });
      assert.strictEqual(frozenSnapshot.impressions, 1000);

      // 2回目の計測（48h時点：インプとブクマが大きく伸びている）
      const reHarvestTime = new Date('2026-11-16T12:00:00Z');
      const laterMetrics = normalizeTweetMetrics({ impression_count: 3500, bookmark_count: 30, like_count: 55 });

      const resultOnReharvest = resolve24hMetricsSnapshot({
        postedAt,
        harvestedAt: reHarvestTime,
        normalizedMetrics: laterMetrics,
        existingSnapshot: frozenSnapshot
      });

      // 48h後の再計測でも、24hスナップショットの値（1000 / 8）が保持され、上書き破壊されないこと！
      assert.strictEqual(resultOnReharvest.impressions, 1000, '24hスナップショットのインプが維持されること');
      assert.strictEqual(resultOnReharvest.bookmarks, 8, '24hスナップショットのブクマが維持されること');
      assert.strictEqual(resultOnReharvest.isFrozen, true);
    });

    test('excludes missing data from creating 24h snapshot even if post is in 24h window', () => {
      const postedAt = new Date(referenceTime.getTime() - (26 * 60 * 60 * 1000));
      const missingMetrics = normalizeTweetMetrics({ impression_count: null });

      const snapshot = resolve24hMetricsSnapshot({
        postedAt,
        harvestedAt: referenceTime,
        normalizedMetrics: missingMetrics
      });

      assert.strictEqual(snapshot, null, '欠損メトリクスから24hスナップショットを生成してはならない');
    });
  });

  describe('filterValidMaturePostsForLearning', () => {
    test('filters out immature posts (< 24h), missing data, and zero impressions', () => {
      const now = new Date();
      const mockHistory = [
        {
          id: 'post_mature_valid',
          postedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
          impressions: 1200,
          bookmarks: 10,
          isMissing: false,
          metrics24hSnapshot: {
            isFrozen: true,
            impressions: 1200,
            bookmarks: 10,
            postAgeHours: 25.0
          }
        },
        {
          id: 'post_immature',
          postedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6時間前
          impressions: 50,
          bookmarks: 0,
          isMissing: false
        },
        {
          id: 'post_missing_data',
          postedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000), // 48時間前だがデータ欠損
          impressions: null,
          bookmarks: null,
          isMissing: true
        },
        {
          id: 'post_zero_impressions',
          postedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000), // 30時間前だがインプ0
          impressions: 0,
          bookmarks: 0,
          isMissing: false
        }
      ];

      const validPosts = filterValidMaturePostsForLearning(mockHistory, 24);
      assert.strictEqual(validPosts.length, 1);
      assert.strictEqual(validPosts[0].id, 'post_mature_valid');
    });

    test('excludes posts without 24h snapshot by default (learning held in reserve)', () => {
      const now = new Date();
      const mockPosts = [
        {
          id: 'post_25h_no_snapshot',
          postedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
          impressions: 2000,
          bookmarks: 15,
          isMissing: false
        }
      ];

      // スナップショット未保持はデフォルトで除外（学習保留）されること
      const defaultFilter = filterValidMaturePostsForLearning(mockPosts);
      assert.strictEqual(defaultFilter.length, 0, 'スナップショットがない投稿は学習保留とされること');

      // 明示的に requireSnapshotOnly: false を指定した場合のみフォールバック許可
      const legacyFilter = filterValidMaturePostsForLearning(mockPosts, { requireSnapshotOnly: false });
      assert.strictEqual(legacyFilter.length, 1);
      assert.strictEqual(legacyFilter[0].id, 'post_25h_no_snapshot');
    });

    test('prioritizes 24h frozen snapshot values for apples-to-apples comparison', () => {
      const mockPost = {
        id: 'post_with_snapshot',
        postedAt: new Date(Date.now() - 72 * 60 * 60 * 1000), // 3日前
        impressions: 5000, // 最新の累計インプレッション
        bookmarks: 40,
        metrics24hSnapshot: {
          impressions: 800, // 24h時点のインプレッション
          bookmarks: 6,
          isFrozen: true
        }
      };

      const result = filterValidMaturePostsForLearning([mockPost], 24);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].impressions, 800, '比較には24h時点の数値が採用されること');
      assert.strictEqual(result[0].bookmarks, 6, '比較には24h時点のブクマが採用されること');
      assert.strictEqual(result[0].comparisonBasis, '24h_snapshot');
    });

    test('excludes corrupted frozen counts from learning', () => {
      const posts = [Infinity, NaN, -1, 0.5].map(bookmarks => ({
        metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks }
      }));
      assert.deepStrictEqual(filterValidMaturePostsForLearning(posts), []);
    });
  });

  describe('matchTweetToJob', () => {
    const jobDocs = [
      { id: 'job_1', data: () => ({ tweetId: '123456', text: '本番ポストテキストA' }) },
      { id: 'job_2', data: () => ({ tweetId: '789012', text: '本番ポストテキストB' }) }
    ];

    test('matches exact tweetId as strict priority', () => {
      const tweet = { id: '123456', text: '内容が異なっていてもID完全一致が最優先' };
      const { matchedJob, matchType } = matchTweetToJob(jobDocs, tweet);
      assert.ok(matchedJob);
      assert.strictEqual(matchedJob.id, 'job_1');
      assert.strictEqual(matchType, 'exact_id');
    });

    test('returns null and none matchType when tweetId does not match (no fuzzy text fallback)', () => {
      const tweet = { id: '999999', text: '本番ポストテキストAに類似したテキスト' };
      const { matchedJob, matchType } = matchTweetToJob(jobDocs, tweet);
      assert.strictEqual(matchedJob, null);
      assert.strictEqual(matchType, 'none');
    });
  });

  describe('evaluateUserSyncEligibility (Cooldown & 24h Window Priority)', () => {
    const now = new Date('2026-11-15T12:00:00Z');

    test('urgent window priority: bypasses cooldown if post is within 24-25h window with unfrozen snapshot', () => {
      // 30分前に同期済み（本来は60分クールダウン中）
      const lastHarvestAt = new Date(now.getTime() - 30 * 60 * 1000);
      // 24.2時間前の投稿（未確定スナップショット）
      const postedJobs = [
        {
          id: 'job_urgent_24_2h',
          postedAt: new Date(now.getTime() - 24.2 * 60 * 60 * 1000),
          metrics24hSnapshot: null
        }
      ];

      const res = evaluateUserSyncEligibility({
        lastHarvestAt,
        postedJobs,
        now,
        cooldownMinutes: 60
      });

      assert.strictEqual(res.shouldSync, true, '24〜25hの回収窓にある投稿があるため同期を許可すべき');
      assert.strictEqual(res.bypassCooldown, true, 'クールダウンをバイパスすべき');
      assert.strictEqual(res.reason, 'urgent_window_priority');
      assert.strictEqual(res.urgentJobsCount, 1);
    });

    test('urgent window priority: bypasses cooldown if post is within extended 24-36h window (e.g. 28h) with unfrozen snapshot', () => {
      const lastHarvestAt = new Date(now.getTime() - 30 * 60 * 1000); // 30分前
      const postedJobs = [
        {
          id: 'job_urgent_28h',
          postedAt: new Date(now.getTime() - 28.0 * 60 * 60 * 1000),
          metrics24hSnapshot: null
        }
      ];

      const res = evaluateUserSyncEligibility({
        lastHarvestAt,
        postedJobs,
        now,
        cooldownMinutes: 60
      });

      assert.strictEqual(res.shouldSync, true);
      assert.strictEqual(res.bypassCooldown, true);
      assert.strictEqual(res.reason, 'urgent_window_priority');
      assert.strictEqual(res.urgentJobsCount, 1);
    });

    test('cooldown active: suppresses sync when within 60min and no jobs are in the 24h window', () => {
      const lastHarvestAt = new Date(now.getTime() - 30 * 60 * 1000); // 30分前
      // 投稿は20時間前（まだ24h窓に達していない未成熟）
      const postedJobs = [
        {
          id: 'job_immature_20h',
          postedAt: new Date(now.getTime() - 20 * 60 * 60 * 1000),
          metrics24hSnapshot: null
        }
      ];

      const res = evaluateUserSyncEligibility({
        lastHarvestAt,
        postedJobs,
        now,
        cooldownMinutes: 60
      });

      assert.strictEqual(res.shouldSync, false, 'クールダウン中で緊急投稿がないため同期をスキップすべき');
      assert.strictEqual(res.bypassCooldown, false);
      assert.strictEqual(res.reason, 'cooldown_active');
    });

    test('does not consider already frozen snapshots as urgent', () => {
      const lastHarvestAt = new Date(now.getTime() - 30 * 60 * 1000); // 30分前
      // 24.5時間前の投稿だが、すでにスナップショット確定凍結済み
      const postedJobs = [
        {
          id: 'job_frozen_24_5h',
          postedAt: new Date(now.getTime() - 24.5 * 60 * 60 * 1000),
          metrics24hSnapshot: { isFrozen: true, impressions: 1000 }
        }
      ];

      const res = evaluateUserSyncEligibility({
        lastHarvestAt,
        postedJobs,
        now,
        cooldownMinutes: 60
      });

      assert.strictEqual(res.shouldSync, false, '既に凍結済みの投稿は緊急ではないためクールダウンを適用すべき');
      assert.strictEqual(res.reason, 'cooldown_active');
    });

    test('cooldown expired: allows sync when more than 60min have elapsed', () => {
      const lastHarvestAt = new Date(now.getTime() - 65 * 60 * 1000); // 65分前
      const postedJobs = [];

      const res = evaluateUserSyncEligibility({
        lastHarvestAt,
        postedJobs,
        now,
        cooldownMinutes: 60
      });

      assert.strictEqual(res.shouldSync, true, '60分経過しているため同期を許可すべき');
      assert.strictEqual(res.reason, 'cooldown_expired');
      assert.strictEqual(res.bypassCooldown, false);
    });

    test('initial sync: allows sync when user has never synced before (lastHarvestAt is null)', () => {
      const res = evaluateUserSyncEligibility({
        lastHarvestAt: null,
        postedJobs: [],
        now
      });

      assert.strictEqual(res.shouldSync, true);
      assert.strictEqual(res.reason, 'no_previous_sync');
    });
  });

  describe('early learning window', () => {
    test('early snapshot keeps replies and does not treat a missing reply count as a failure', () => {
      const snapshot = buildEarlyMetricsSnapshot({
        impressions: 20,
        bookmarks: 2,
        replies: 3,
        likes: 1
      }, 3, '2026-11-18T00:00:00.000Z');
      assert.strictEqual(snapshot.replies, 3);
      assert.strictEqual(snapshot.likes, 1);
      assert.strictEqual(snapshot.retweets, 0);
      assert.strictEqual(buildEarlyMetricsSnapshot({ impressions: 0, bookmarks: 0 }, 3, 'x'), null);
    });

    test('a 3 hour post without an early snapshot bypasses the harvest cooldown', () => {
      const now = new Date('2026-11-15T12:00:00Z');
      const res = evaluateUserSyncEligibility({
        lastHarvestAt: new Date(now.getTime() - 30 * 60 * 1000),
        postedJobs: [{
          id: 'early',
          postedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000)
        }],
        now,
        cooldownMinutes: 60
      });
      assert.strictEqual(res.shouldSync, true);
      assert.strictEqual(res.reason, 'urgent_window_priority');
    });
  });

  describe('In-Memory Safety & Error Propagation Invariants', () => {
    test('parseFirestoreTimestampMs converts Firestore Timestamp, seconds object, Date, string, and invalid values safely without NaN', () => {
      const tsObj = { toMillis: () => 1794732000000 };
      assert.strictEqual(parseFirestoreTimestampMs(tsObj), 1794732000000);

      const toDateObj = { toDate: () => new Date('2026-11-15T12:00:00Z') };
      assert.strictEqual(parseFirestoreTimestampMs(toDateObj), new Date('2026-11-15T12:00:00Z').getTime());

      const rawSecObj = { _seconds: 1794732000, _nanoseconds: 500000000 };
      assert.strictEqual(parseFirestoreTimestampMs(rawSecObj), 1794732000500);

      const dateInstance = new Date('2026-11-15T10:00:00Z');
      assert.strictEqual(parseFirestoreTimestampMs(dateInstance), dateInstance.getTime());

      const isoStr = '2026-11-15T10:00:00Z';
      assert.strictEqual(parseFirestoreTimestampMs(isoStr), new Date(isoStr).getTime());

      assert.strictEqual(parseFirestoreTimestampMs(null), 0);
      assert.strictEqual(parseFirestoreTimestampMs(undefined), 0);
      assert.strictEqual(parseFirestoreTimestampMs('invalid-date'), 0);
    });
  });
});
