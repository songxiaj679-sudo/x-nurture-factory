'use strict';

const { db } = require('./firestore');
const { startAutopilotJobRunner } = require('./hybrid_saas_routes');

async function holdWorkerLock() {
  const ref = db.collection('system_locks').doc('x-saas-worker');
  const now = Date.now();
  const snap = await ref.get();
  const current = snap.exists ? (snap.data() || {}) : {};
  if (current.expiresAt && current.expiresAt > now && current.pid !== process.pid) {
    throw new Error('x-saas-worker lock is already held');
  }
  await ref.set({ pid: process.pid, expiresAt: now + 60 * 1000, updatedAt: new Date() });
  setInterval(() => {
    ref.set({ pid: process.pid, expiresAt: Date.now() + 60 * 1000, updatedAt: new Date() }, { merge: true }).catch(() => {});
  }, 30000).unref();
}

holdWorkerLock()
  .then(() => startAutopilotJobRunner())
  .catch(err => {
    console.error(`[x-saas-worker] ${err.message}`);
    process.exit(1);
  });
