'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

let scenario;
const db = {
  collection(name) {
    if (name === 'saas_users') {
      return {
        doc() {
          return {
            async get() {
              return { exists: true, data: () => ({ xOfficialCredentials: 'encrypted' }) };
            },
            async set() {
              scenario.writes++;
            }
          };
        }
      };
    }
    if (name === 'autopilot_jobs') {
      const query = {
        where() { return query; },
        async get() {
          if (scenario.jobError) throw new Error('jobs unavailable');
          return { docs: scenario.jobs || [] };
        }
      };
      return query;
    }
    throw new Error(`Unexpected collection: ${name}`);
  },
  batch() {
    return {
      async commit() { scenario.writes++; }
    };
  },
  async runTransaction() {
    throw new Error('transaction unavailable');
  }
};

function stubModule(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule('../src/firestore', { db });
stubModule('../src/collective_intelligence', {});
stubModule('../src/map_elites_memory', {});
stubModule('../src/ai_deliberation_council', {
  async getUserMarketingKnowledge() { return {}; }
});
stubModule('../src/official_api_client', {
  decryptCredentials() { return { oauth2AccessToken: 'test-token' }; },
  async getUserProfileAndRecentTweets() { return scenario.timeline; },
  async lookupTweetsByIds(credentials, ids) {
    scenario.lookupArguments = { credentials, ids };
    return scenario.lookup;
  }
});

const { harvestTweetMetricsAndEvolveKnowledge } = require('../src/autonomous_promo_ai');

test('timeline failure does not write a successful sync timestamp', async () => {
  scenario = { writes: 0, timeline: { ok: false, error: 'rate limited' } };
  const result = await harvestTweetMetricsAndEvolveKnowledge('user', { skipLock: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'rate limited');
  assert.equal(scenario.writes, 0);
});

test('partial direct lookup failure does not commit or update the sync timestamp', async () => {
  scenario = {
    writes: 0,
    timeline: { ok: true, tweets: [] },
    jobs: [{ data: () => ({ tweetId: '1', postedAt: new Date(), needs24hHarvest: true }) }],
    lookup: { ok: false, error: 'partial errors', tweets: [{ id: '2' }] }
  };
  const result = await harvestTweetMetricsAndEvolveKnowledge('user', { skipLock: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /^direct_lookup_failed:/);
  assert.equal(scenario.lookupArguments.credentials.oauth2AccessToken, 'test-token');
  assert.deepEqual(scenario.lookupArguments.ids, ['1']);
  assert.equal(scenario.writes, 0);
});

test('job retrieval failure does not update the sync timestamp', async () => {
  scenario = { writes: 0, timeline: { ok: true, tweets: [] }, jobError: true };
  const result = await harvestTweetMetricsAndEvolveKnowledge('user', { skipLock: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'jobs unavailable');
  assert.equal(scenario.writes, 0);
});

test('sync timestamp transaction failure is reported as a failure', async () => {
  scenario = { writes: 0, timeline: { ok: true, tweets: [] } };
  const result = await harvestTweetMetricsAndEvolveKnowledge('user', {
    skipLock: true,
    lockHostId: 'test-worker'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /^sync_timestamp_failed:/);
  assert.equal(scenario.writes, 0);
});
