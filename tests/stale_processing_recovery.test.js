const test = require('node:test');
const assert = require('node:assert/strict');

const jobs = new Map();
const users = new Map();
function collection(name) {
  const store = name === 'autopilot_jobs' ? jobs : users;
  return {
    doc(id) {
      return {
        id,
        async get() { return { exists: store.has(id), data: () => store.get(id) }; },
        async set(data, options) { store.set(id, options && options.merge ? { ...(store.get(id) || {}), ...data } : data); }
      };
    },
    where() {
      return {
        limit() { return this; },
        async get() {
          const docs = [...store.entries()].map(([id, data]) => ({
            id,
            data: () => data,
            ref: collection(name).doc(id)
          }));
          return { docs };
        }
      };
    }
  };
}
const db = { collection };
const firestorePath = require.resolve('../src/firestore');
require.cache[firestorePath] = { id: firestorePath, filename: firestorePath, loaded: true, exports: { db } };
const { recoverStaleProcessingJobs } = require('../src/hybrid_saas_routes');

test('a processing job interrupted before submit returns to pending and releases the lock', async () => {
  jobs.clear();
  users.clear();
  const old = new Date(Date.now() - 10 * 60 * 1000);
  jobs.set('job-stale', { status: 'processing', userId: 'user-1', claimedAt: old, postAttemptStatus: 'queued' });
  jobs.set('job-sent', { status: 'processing', userId: 'user-1', claimedAt: old, postAttemptStatus: 'submitting' });
  users.set('user-1', { autopilotPostLock: { jobId: 'job-stale', leaseUntil: new Date(Date.now() + 60000) } });
  const result = await recoverStaleProcessingJobs(db, Date.now());
  assert.equal(result.recovered, 1);
  assert.equal(jobs.get('job-stale').status, 'pending');
  assert.equal(jobs.get('job-sent').status, 'processing');
  assert.equal(users.get('user-1').autopilotPostLock, null);
});
