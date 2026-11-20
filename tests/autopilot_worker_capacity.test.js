'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

function stubModule(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

test('worker throughput and due-time checks across long-running jobs', async () => {
  const jobs = new Map();
  const users = new Map();
  const submitted = [];
  let onPost = null;
  let onUserRead = null;
  const consent = { version: 1, account: 'username:mock', granted: true };
  for (let i = 0; i < 1000; i++) {
    const id = String(i).padStart(4, '0');
    const userId = `user-${id}`;
    users.set(userId, { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', autopilotConsent: consent });
    jobs.set(`job-${id}`, {
      userId, status: 'pending', text: `post-${id}`, isHumanOverride: true,
      scheduledAt: new Date('2020-01-01T00:00:00Z')
    });
  }

  function jobRef(id) {
    return {
      id,
      async get() {
        const data = jobs.get(id);
        return { exists: Boolean(data), data: () => ({ ...data }) };
      },
      async update(fields) {
        Object.assign(jobs.get(id), fields);
      }
    };
  }
  function pendingQuery(after = null, pageSize = 20) {
    return {
      where() { return this; },
      orderBy() { return this; },
      limit(limit) { return pendingQuery(after, limit); },
      startAfter(doc) { return pendingQuery(doc.id, pageSize); },
      async get() {
        const docs = [...jobs.entries()]
          .filter(([id, data]) => data.status === 'pending' && (after === null || id > after))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, pageSize)
          .map(([id, data]) => ({ id, data: () => ({ ...data }) }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
  }
  const db = {
    collection(name) {
      if (name === 'autopilot_jobs') {
        return { ...pendingQuery(), doc: jobRef };
      }
      if (name === 'saas_users') {
        return { doc: id => ({
          async get() {
            if (onUserRead) onUserRead(id);
            const data = users.get(id);
            return { exists: Boolean(data), data: () => ({ ...data }) };
          },
          async update(fields) {
            Object.assign(users.get(id), fields);
          }
        }) };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
    async runTransaction(fn) {
      return fn({
        get: ref => ref.get(),
        update: (ref, fields) => ref.update(fields)
      });
    }
  };
  stubModule('../src/firestore', { db });
  stubModule('../src/official_api_client', {
    decryptCredentials: () => ({ username: 'mock' }),
    async postOfficialTweet(_credentials, text) {
      submitted.push(text);
      if (onPost) onPost(text);
      return { ok: true, tweetId: String(submitted.length), tweetUrl: 'https://example.invalid/mock' };
    },
    async registerBoostCampaign() { return null; }
  });
  stubModule('../src/collective_intelligence', {});
  stubModule('../src/autonomous_promo_ai', { ensureNextPost: async () => ({}) });
  stubModule('../src/ai_deliberation_council', {});
  stubModule('../src/wise_payment', {});
  stubModule('../src/auth_service', {});
  const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

  const originalInterval = global.setInterval;
  const originalTimeout = global.setTimeout;
  const originalLog = console.log;
  const OriginalDate = global.Date;
  let tick;
  try {
    global.setInterval = (callback, delay) => {
      if (delay === 60000) tick = callback;
      return {};
    };
    global.setTimeout = () => ({});
    console.log = () => {};
    registerHybridSaasRoutes({ post() {}, get() {} });
    global.setInterval = originalInterval;
    global.setTimeout = originalTimeout;
    assert.equal(typeof tick, 'function');

    for (let cycle = 0; cycle < 334; cycle++) {
      const before = submitted.length;
      await tick();
      assert.equal(submitted.length - before, cycle === 333 ? 1 : 3);
    }
    assert.equal(submitted.length, 1000);
    assert.equal(new Set(submitted).size, 1000);
    assert.equal([...jobs.values()].filter(job => job.status === 'posted').length, 1000);

    let clock = OriginalDate.parse('2026-01-01T00:00:00Z');
    global.Date = class extends OriginalDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(clock);
      }
      static now() { return clock; }
    };
    users.set('long-user-1', { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', autopilotConsent: consent });
    users.set('long-user-2', { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', autopilotConsent: consent });
    jobs.set('job-z1', {
      userId: 'long-user-1', status: 'pending', text: 'long-first',
      isHumanOverride: true, scheduledAt: new OriginalDate(clock)
    });
    jobs.set('job-z2', {
      userId: 'long-user-2', status: 'pending', text: 'later-due',
      isHumanOverride: true, scheduledAt: new OriginalDate(clock + 60000)
    });
    onPost = text => { if (text === 'long-first') clock += 120000; };
    await tick();
    assert.equal(jobs.get('job-z1').status, 'posted');
    assert.equal(jobs.get('job-z2').status, 'posted');

    users.set('unconsented', { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4' });
    users.set('revoked', { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', autopilotConsent: consent });
    jobs.set('job-zz1', {
      userId: 'unconsented', status: 'pending', text: 'not-consented',
      isHumanOverride: true, scheduledAt: new OriginalDate(clock)
    });
    jobs.set('job-zz2', {
      userId: 'revoked', status: 'pending', text: 'revoked-during-preparation',
      isHumanOverride: true, scheduledAt: new OriginalDate(clock)
    });
    let revokedReads = 0;
    onUserRead = id => {
      if (id === 'revoked' && ++revokedReads === 2) {
        users.get(id).autopilotConsent = { version: 1, granted: false };
      }
    };
    await tick();
    assert.equal(jobs.get('job-zz1').status, 'pending');
    assert.equal(jobs.get('job-zz1').error, 'consent_required');
    assert.equal(jobs.get('job-zz2').status, 'pending');
    assert.equal(jobs.get('job-zz2').error, 'paused_or_consent_changed');
    assert.ok(!submitted.includes('not-consented'));
    assert.ok(!submitted.includes('revoked-during-preparation'));
  } finally {
    global.setInterval = originalInterval;
    global.setTimeout = originalTimeout;
    global.Date = OriginalDate;
    console.log = originalLog;
  }
});
