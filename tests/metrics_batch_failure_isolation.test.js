'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

let scenario;
const db = {
  collection(name) {
    if (name === 'saas_users') {
      const query = {
        orderBy() { return query; },
        limit() { return query; },
        async get() {
          const docs = scenario.users.map(id => ({
            id,
            data: () => ({ xOfficialCredentials: 'encrypted', xUsername: 'VeloxSystemsV4', ...scenario.userData?.[id] })
          }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        }
      };
      return query;
    }
    if (name === 'autopilot_jobs') {
      let userId;
      const query = {
        where(field, operator, value) {
          if (field === 'userId') userId = value;
          return query;
        },
        async get() {
          if (userId === scenario.jobFailure) throw new Error('jobs unavailable');
          return {
            docs: (scenario.jobs?.[userId] || []).map((data, i) => ({
              id: `job-${i}`,
              data: () => data
            }))
          };
        }
      };
      return query;
    }
    throw new Error(`Unexpected collection: ${name}`);
  }
};

function stubModule(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule('../src/firestore', { db });
stubModule('../src/autonomous_promo_ai', {
  async harvestTweetMetricsAndEvolveKnowledge(userId) {
    scenario.calls.push(userId);
    if (scenario.onHarvest) scenario.onHarvest(userId);
    return scenario.results[userId];
  }
});

const { syncAllActiveCustomersPostMetrics } = require('../src/official_api_client');

test('reports individual failures while continuing to sync other users', async () => {
  scenario = {
    users: ['job-error', 'sync-error', 'success', 'locked'],
    jobFailure: 'job-error',
    calls: [],
    results: {
      'sync-error': { ok: false, error: 'rate limited' },
      success: { ok: true },
      locked: { ok: true, skipped: true, reason: 'concurrency_locked' }
    }
  };
  const result = await syncAllActiveCustomersPostMetrics();
  assert.deepEqual(result, { ok: false, totalSynced: 1, totalSkipped: 1, totalFailed: 2 });
  assert.deepEqual(scenario.calls, ['sync-error', 'success', 'locked']);
});

test('reports success when all eligible users synchronize', async () => {
  scenario = {
    users: ['success'],
    calls: [],
    results: { success: { ok: true } }
  };
  const result = await syncAllActiveCustomersPostMetrics();
  assert.deepEqual(result, { ok: true, totalSynced: 1, totalSkipped: 0, totalFailed: 0 });
});

test('evaluates each user at the time their turn begins', async t => {
  const now = new Date('2026-11-15T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  scenario = {
    users: ['first', 'later'],
    calls: [],
    userData: { later: { lastMetricsHarvestAt: now } },
    jobs: { later: [{ postedAt: new Date(now.getTime() - 23.79 * 60 * 60 * 1000) }] },
    results: { first: { ok: true }, later: { ok: true } },
    onHarvest(id) { if (id === 'first') t.mock.timers.tick(2 * 60 * 1000); }
  };
  const result = await syncAllActiveCustomersPostMetrics();
  assert.deepEqual(scenario.calls, ['first', 'later']);
  assert.deepEqual(result, { ok: true, totalSynced: 2, totalSkipped: 0, totalFailed: 0 });
});

test('continues to other users when one eligibility timestamp is malformed', async () => {
  scenario = {
    users: ['bad-time', 'success'],
    calls: [],
    jobs: { 'bad-time': [{ postedAt: { toDate() { throw new Error('invalid timestamp'); } } }] },
    results: { success: { ok: true } }
  };
  const result = await syncAllActiveCustomersPostMetrics();
  assert.deepEqual(result, { ok: false, totalSynced: 1, totalSkipped: 0, totalFailed: 1 });
  assert.deepEqual(scenario.calls, ['success']);
});
