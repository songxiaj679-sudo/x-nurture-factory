/**
 * @file tests/ab_experiment_engine.test.js
 * @description VELOX AI 4.0 自律進化A/B実験エンジンの単体テスト
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  assignExperimentVariant,
  resolveUserExperimentCohort,
  evaluateJobExperimentEligibility,
  calculateWilsonScoreInterval,
  analyzeAbExperimentResults,
  filterPromptDirectivesForVariant,
  EXPERIMENT_WINDOW_MIN_HOURS,
  EXPERIMENT_WINDOW_MAX_HOURS
} = require('../src/ab_experiment_engine');

describe('A/B Experiment Engine (VELOX 4.0)', () => {
  describe('assignExperimentVariant', () => {
    test('assigns variant A or B with matching prompt version', () => {
      const assignment = assignExperimentVariant();
      assert.ok(['A', 'B'].includes(assignment.variant));
      assert.strictEqual(
        assignment.promptVersion,
        assignment.variant === 'A' ? 'v4.3-control-base' : 'v4.3-treatment-dpo-episodic'
      );
      assert.ok(assignment.assignedAt instanceof Date);
    });

    test('supports forced variant for deterministic tests', () => {
      const a = assignExperimentVariant({ forcedVariant: 'A' });
      assert.strictEqual(a.variant, 'A');
      assert.strictEqual(a.promptVersion, 'v4.3-control-base');

      const b = assignExperimentVariant({ forcedVariant: 'B' });
      assert.strictEqual(b.variant, 'B');
      assert.strictEqual(b.promptVersion, 'v4.3-treatment-dpo-episodic');
    });
  });

  describe('resolveUserExperimentCohort (User-Level Cohort Persistence & Isolation)', () => {
    test('preserves existing assigned cohort for user', () => {
      const existing = resolveUserExperimentCohort('user_123', { experimentCohort: 'control_A' });
      assert.strictEqual(existing.cohort, 'control_A');
      assert.strictEqual(existing.variant, 'A');
      assert.strictEqual(existing.isNewAssignment, false);
    });

    test('deterministically assigns new user to control_A or treatment_B', () => {
      const res = resolveUserExperimentCohort('user_new_456', {});
      assert.ok(['control_A', 'treatment_B'].includes(res.cohort));
      assert.strictEqual(res.variant, res.cohort === 'control_A' ? 'A' : 'B');
      assert.strictEqual(res.isNewAssignment, true);
    });
  });

  describe('evaluateJobExperimentEligibility (Strict 24.0h - 25.0h Window)', () => {
    test('marks job as eligible only if age is strictly between 24.0 and 25.0 hours with frozen snapshot', () => {
      const eligibleJob = {
        metricsHarvestStatus: 'valid',
        metrics: { impressions: 1500, bookmarks: 12 },
        metrics24hSnapshot: {
          isFrozen: true,
          impressions: 1500,
          bookmarks: 12,
          postAgeHours: 24.5
        }
      };
      const res = evaluateJobExperimentEligibility(eligibleJob);
      assert.strictEqual(res.isEligible, true);
      assert.strictEqual(res.reason, 'eligible');
      assert.strictEqual(res.postAgeHours, 24.5);
    });

    test('rejects immature post (< 24.0 hours)', () => {
      const immatureJob = {
        metricsHarvestStatus: 'valid',
        metrics: { impressions: 200, bookmarks: 0 },
        metrics24hSnapshot: {
          isFrozen: true,
          impressions: 200,
          bookmarks: 0,
          postAgeHours: 23.8
        }
      };
      const res = evaluateJobExperimentEligibility(immatureJob);
      assert.strictEqual(res.isEligible, false);
      assert.strictEqual(res.reason, 'immature');
    });

    test('rejects outside-window post (> 25.0 hours)', () => {
      const lateJob = {
        metricsHarvestStatus: 'valid',
        metrics: { impressions: 3000, bookmarks: 25 },
        metrics24hSnapshot: {
          isFrozen: true,
          impressions: 3000,
          bookmarks: 25,
          postAgeHours: 26.2
        }
      };
      const res = evaluateJobExperimentEligibility(lateJob);
      assert.strictEqual(res.isEligible, false);
      assert.strictEqual(res.reason, 'outside_window');
    });

    test('rejects missing metrics or unfrozen snapshot', () => {
      const missingJob = {
        metricsHarvestStatus: 'missing',
        metrics: { impressions: null, bookmarks: null }
      };
      const res = evaluateJobExperimentEligibility(missingJob);
      assert.strictEqual(res.isEligible, false);
      assert.strictEqual(res.reason, 'missing_metrics');
    });

    test('rejects invalid snapshot counts and non-finite observation times', () => {
      const job = {
        metricsHarvestStatus: 'valid',
        metrics: { impressions: 100, bookmarks: 1 },
        metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 1, postAgeHours: 24 }
      };
      for (const [field, values] of [
        ['impressions', [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]],
        ['bookmarks', [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]],
        ['postAgeHours', [NaN, Infinity, -Infinity]]
      ]) {
        for (const value of values) {
          const snapshot = { ...job.metrics24hSnapshot, [field]: value };
          assert.strictEqual(evaluateJobExperimentEligibility({ ...job, metrics24hSnapshot: snapshot }).isEligible, false);
        }
      }
      assert.strictEqual(evaluateJobExperimentEligibility({
        ...job, metrics24hSnapshot: { ...job.metrics24hSnapshot, postAgeHours: 25 + 1 / 3600000 }
      }).reason, 'outside_window');
    });
  });

  describe('calculateWilsonScoreInterval', () => {
    test('computes valid 95% Wilson interval', () => {
      const interval = calculateWilsonScoreInterval(10, 1000);
      assert.strictEqual(interval.center, 0.01);
      assert.ok(interval.lower < interval.center);
      assert.ok(interval.upper > interval.center);
      assert.ok(interval.lower >= 0);
      assert.ok(interval.upper <= 1);
    });

    test('handles zero trials safely', () => {
      const interval = calculateWilsonScoreInterval(0, 0);
      assert.deepStrictEqual(interval, { lower: 0, upper: 0, center: 0 });
    });
  });

  describe('analyzeAbExperimentResults', () => {
    test('withholds decision (INSUFFICIENT_DATA) when sample size is under threshold', () => {
      const mockJobs = [
        {
          variant: 'A',
          metricsHarvestStatus: 'valid',
          metrics: { impressions: 1000, bookmarks: 5 },
          metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 5, postAgeHours: 24.2 }
        },
        {
          variant: 'B',
          metricsHarvestStatus: 'valid',
          metrics: { impressions: 1200, bookmarks: 15 },
          metrics24hSnapshot: { isFrozen: true, impressions: 1200, bookmarks: 15, postAgeHours: 24.3 }
        }
      ];

      const report = analyzeAbExperimentResults(mockJobs, { minSampleSize: 10 });
      assert.strictEqual(report.status, 'INSUFFICIENT_DATA');
      assert.strictEqual(report.winner, 'UNDECIDED');
      assert.ok(report.recommendation.includes('データ不足のため勝敗判定を保留します'));
      assert.strictEqual(report.variants.A.metrics.eligibleStrict24hCount, 1);
      assert.strictEqual(report.variants.B.metrics.eligibleStrict24hCount, 1);
    });

    test('tracks omission reasons and harvest rate accurately', () => {
      const mockJobs = [
        // A群: 有格1件、窓外2件、欠損1件
        { variant: 'A', metricsHarvestStatus: 'valid', metrics: { impressions: 1000, bookmarks: 5 }, metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 5, postAgeHours: 24.1 } },
        { variant: 'A', metricsHarvestStatus: 'valid', metrics: { impressions: 1000, bookmarks: 5 }, metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 5, postAgeHours: 26.5 } },
        { variant: 'A', metricsHarvestStatus: 'valid', metrics: { impressions: 1000, bookmarks: 5 }, metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 5, postAgeHours: 28.0 } },
        { variant: 'A', metricsHarvestStatus: 'missing', metrics: { impressions: null } }
      ];

      const report = analyzeAbExperimentResults(mockJobs, { minSampleSize: 10 });
      const aMetrics = report.variants.A.metrics;
      assert.strictEqual(aMetrics.totalAssigned, 4);
      assert.strictEqual(aMetrics.eligibleStrict24hCount, 1);
      assert.strictEqual(aMetrics.harvestRate, 0.25);
      assert.strictEqual(aMetrics.omissionReasons.outside_window, 2);
      assert.strictEqual(aMetrics.omissionReasons.missing_metrics, 1);
    });

    test('evaluates significant winner when sample size is sufficient and intervals do not overlap', () => {
      // 各群10件のダミーデータを作成
      const mockJobs = [];
      // A群: ブクマ率 0.5% (5ブクマ / 1000インプ) × 10件 = 50 / 10000
      for (let i = 0; i < 10; i++) {
        mockJobs.push({
          variant: 'A',
          metricsHarvestStatus: 'valid',
          metrics: { impressions: 1000, bookmarks: 5 },
          metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 5, postAgeHours: 24.2 }
        });
      }
      // B群: ブクマ率 3.5% (35ブクマ / 1000インプ) × 10件 = 350 / 10000
      for (let i = 0; i < 10; i++) {
        mockJobs.push({
          variant: 'B',
          metricsHarvestStatus: 'valid',
          metrics: { impressions: 1000, bookmarks: 35 },
          metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 35, postAgeHours: 24.3 }
        });
      }

      const report = analyzeAbExperimentResults(mockJobs, { minSampleSize: 10 });
      assert.strictEqual(report.status, 'EVALUATED');
      assert.strictEqual(report.winner, 'B');
      assert.ok(report.recommendation.includes('B群（DPO+エピソード記憶注入）の有意な勝利'));
    });
  });

  describe('filterPromptDirectivesForVariant (Variant Directive Isolation)', () => {
    test('variant A strictly excludes DPO pairs and episodic memories while variant B preserves them', () => {
      const mockDpo = [{ winner: { text: '勝者構文' }, loser: { text: '敗者構文' } }];
      const mockEpisodes = [{ id: 'ep_1', text: '過去の反省エピソード' }];

      const resA = filterPromptDirectivesForVariant({
        variant: 'A',
        dpoPreferencePairs: mockDpo,
        episodes: mockEpisodes
      });

      assert.strictEqual(resA.excludedByControlGroup, true);
      assert.strictEqual(resA.dpoPreferencePairs.length, 0, 'A群ではDPOペアが完全除外されること');
      assert.strictEqual(resA.episodes.length, 0, 'A群ではエピソード記憶が完全除外されること');

      const resB = filterPromptDirectivesForVariant({
        variant: 'B',
        dpoPreferencePairs: mockDpo,
        episodes: mockEpisodes
      });

      assert.strictEqual(resB.excludedByControlGroup, false);
      assert.strictEqual(resB.dpoPreferencePairs.length, 1, 'B群ではDPOペアが注入対象となること');
      assert.strictEqual(resB.episodes.length, 1, 'B群ではエピソード記憶が注入対象となること');
    });
  });

  describe('Dashboard Experiment Stats API Payload Compatibility', () => {
    test('produces structured payload compatible with /api/autopilot/experiment-stats', () => {
      const mockJobs = [
        {
          variant: 'A',
          metricsHarvestStatus: 'valid',
          metrics: { impressions: 1000, bookmarks: 10 },
          metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 10, postAgeHours: 24.5 }
        },
        {
          variant: 'B',
          metricsHarvestStatus: 'valid',
          metrics: { impressions: 1000, bookmarks: 30 },
          metrics24hSnapshot: { isFrozen: true, impressions: 1000, bookmarks: 30, postAgeHours: 24.2 }
        }
      ];

      const stats = analyzeAbExperimentResults(mockJobs, { minSampleSize: 10 });

      // UI連携に必要な必須キーの構造検証
      assert.ok(stats.variants.A);
      assert.ok(stats.variants.B);
      assert.strictEqual(typeof stats.variants.A.metrics.bookmarkRate, 'number');
      assert.strictEqual(typeof stats.variants.B.metrics.bookmarkRate, 'number');
      assert.ok(stats.variants.A.metrics.confidenceInterval95);
      assert.ok(stats.variants.B.metrics.confidenceInterval95);
      assert.strictEqual(typeof stats.variants.A.metrics.omissionRate, 'number');
      assert.strictEqual(typeof stats.variants.B.metrics.omissionRate, 'number');
      assert.strictEqual(stats.status, 'INSUFFICIENT_DATA', 'N < 10 では保留ステータスであること');
      assert.ok(stats.primaryMetricName.includes('bookmarkRate24h'));
    });
  });
});
