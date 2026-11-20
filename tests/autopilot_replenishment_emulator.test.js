'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('replenishment requires a local Firestore emulator', { skip: true }, () => {});
  return;
}

assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^127\.0\.0\.1:[0-9]{1,5}$/);
process.env.NODE_ENV = 'test';
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-velox-test' }, 'replenishment-safety-test');
const db = getFirestore(app);
const suffix = `${process.pid}_${Date.now()}`;
const prefix = `replenish_${suffix}_`;
const targetId = `${prefix}zz_target`;
const badId = `${prefix}zz_bad`;
const pausedId = `${prefix}zzz_paused`;

function stub(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub('../src/firestore', { db });
stub('../src/auth_service', { resolveSessionUser: async (_db, req) => ({ userId: req.testUserId }) });
stub('../src/official_api_client', {});
stub('../src/collective_intelligence', {});
stub('../src/autonomous_promo_ai', {
  dateAtTimeInZone(base, _tz, hour, minute, dayOffset = 0) {
    if (_tz === 'invalid-zone') throw new Error('invalid test timezone');
    const date = new Date(base);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset, hour, minute));
  }
});
stub('../src/ai_deliberation_council', {});
stub('../src/wise_payment', {});

function createWorker() {
  const modulePath = require.resolve('../src/hybrid_saas_routes');
  delete require.cache[modulePath];
  const { registerHybridSaasRoutes } = require(modulePath);
  const originalInterval = global.setInterval;
  const originalTimeout = global.setTimeout;
  let tick;
  try {
    global.setInterval = (callback, delay) => {
      if (delay === 5 * 60 * 1000) tick = callback;
      return {};
    };
    global.setTimeout = () => ({});
    registerHybridSaasRoutes({ post() {}, get() {} });
  } finally {
    global.setInterval = originalInterval;
    global.setTimeout = originalTimeout;
  }
  assert.equal(typeof tick, 'function');
  return tick;
}

function blockTwoCommits() {
  const originalBatch = db.batch;
  let ready;
  let release;
  const bothReady = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let count = 0;
  db.batch = function (...args) {
    const batch = originalBatch.apply(this, args);
    const commit = batch.commit.bind(batch);
    batch.commit = async () => {
      count++;
      if (count === 2) ready();
      await gate;
      return commit();
    };
    return batch;
  };
  return {
    bothReady,
    count: () => count,
    release,
    restore() { db.batch = originalBatch; }
  };
}

after(async () => {
  await deleteApp(app);
});

test('replenishment reaches users beyond 1000 and protects concurrent changes', { timeout: 60000 }, async () => {
  const users = db.collection('saas_users');
  const jobs = db.collection('autopilot_jobs');
  const userRefs = [];
  const batches = [];
  let batch = db.batch();
  for (let i = 0; i < 1000; i++) {
    const ref = users.doc(`${prefix}${String(i).padStart(4, '0')}`);
    userRefs.push(ref);
    batch.create(ref, { targetUrl: 'https://example.invalid' });
    if ((i + 1) % 400 === 0) {
      batches.push(batch);
      batch = db.batch();
    }
  }
  const targetRef = users.doc(targetId);
  const badRef = users.doc(badId);
  const pausedRef = users.doc(pausedId);
  userRefs.push(targetRef, badRef, pausedRef);
  batch.create(targetRef, { targetUrl: 'https://example.invalid', xOfficialCredentials: 'mock', planId: 'pro' });
  batch.create(badRef, { targetUrl: 'https://example.invalid', xOfficialCredentials: 'mock', scheduleTimeZone: 'invalid-zone' });
  batch.create(pausedRef, { targetUrl: 'https://example.invalid', xOfficialCredentials: 'mock', autopilotPaused: true });
  batches.push(batch);

  let gate;
  let runs = [];
  try {
    for (const writes of batches) await writes.commit();
    const first = createWorker();
    const second = createWorker();
    for (let i = 0; i < 4; i++) await Promise.all([first(), second()]);
    assert.equal((await jobs.where('userId', '==', targetId).get()).size, 0);

    gate = blockTwoCommits();
    runs = [first(), second()];
    await gate.bothReady;
    await first();
    assert.equal(gate.count(), 2);
    await targetRef.update({ autopilotPaused: true });
    gate.release();
    await Promise.all(runs);
    gate.restore();
    gate = null;
    assert.equal((await targetRef.get()).data().autopilotPaused, true);
    assert.equal((await jobs.where('userId', '==', targetId).get()).size, 0);

    await targetRef.update({ autopilotPaused: false });
    for (let i = 0; i < 4; i++) await Promise.all([first(), second()]);
    const earliest = Date.now() + 8 * 60 * 60 * 1000;
    gate = blockTwoCommits();
    runs = [first(), second()];
    await gate.bothReady;
    gate.release();
    await Promise.all(runs);
    gate.restore();
    gate = null;

    const targetJobs = await jobs.where('userId', '==', targetId).get();
    assert.equal(targetJobs.size, 3);
    targetJobs.docs.forEach(doc => assert.ok(doc.data().scheduledAt.toMillis() > earliest));
    assert.equal((await jobs.where('userId', '==', pausedId).get()).size, 0);
    assert.equal((await jobs.where('userId', '==', badId).get()).size, 0);
    assert.equal((await pausedRef.get()).data().autopilotPaused, true);

    for (const doc of targetJobs.docs) await doc.ref.delete();
    for (let i = 0; i < 4; i++) await first();
    const routes = new Map();
    require('../src/hybrid_saas_routes').registerHybridSaasRoutes({
      post: (path, handler) => routes.set(path, handler), get() {}
    }, { runWorker: false });
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    gate = blockTwoCommits();
    runs = [
      first(),
      routes.get('/api/autopilot/schedule-jit-slots')({ testUserId: targetId, body: { days: 1 } }, response)
    ];
    await gate.bothReady;
    gate.release();
    await Promise.all(runs);
    gate.restore();
    gate = null;
    assert.equal((await jobs.where('userId', '==', targetId).get()).size, 3);
    if (!response.body.ok) {
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.code, 'reservation_conflict');
    }

    const remaining = await jobs.where('userId', '==', targetId).get();
    for (const doc of remaining.docs) await doc.ref.delete();
    const conflictResponses = Array.from({ length: 2 }, () => ({
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    }));
    gate = blockTwoCommits();
    runs = conflictResponses.map(res => routes.get('/api/autopilot/schedule-jit-slots')({
      testUserId: targetId, body: { days: 1 }
    }, res));
    await gate.bothReady;
    await targetRef.update({ updatedAt: new Date() });
    gate.release();
    await Promise.all(runs);
    gate.restore();
    gate = null;
    assert.equal((await jobs.where('userId', '==', targetId).get()).size, 0);
    for (const res of conflictResponses) {
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, 'reservation_conflict');
    }
  } finally {
    if (gate) {
      gate.release();
      await Promise.allSettled(runs);
      gate.restore();
    }
    const targetJobs = await jobs.where('userId', '==', targetId).get();
    const badJobs = await jobs.where('userId', '==', badId).get();
    const pausedJobs = await jobs.where('userId', '==', pausedId).get();
    for (const doc of [...targetJobs.docs, ...badJobs.docs, ...pausedJobs.docs]) await doc.ref.delete();
    for (let i = 0; i < userRefs.length; i += 400) {
      const cleanup = db.batch();
      userRefs.slice(i, i + 400).forEach(ref => cleanup.delete(ref));
      await cleanup.commit();
    }
  }
});
