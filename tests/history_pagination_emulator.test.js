'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  describe.skip('History pagination Firestore emulator design checks', () => {
    test('requires a local emulator', () => {});
  });
  return;
}

assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^127\.0\.0\.1:[0-9]{1,5}$/);
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-velox-test' }, 'history-pagination-design-test');
const db = getFirestore(app);
const collection = db.collection(`history_pagination_test_${process.pid}_${Date.now()}`);

after(async () => {
  await deleteApp(app);
});

describe('History pagination Firestore emulator design checks', () => {
  test('numeric order, document ID ties, cursor and missing sort field', async () => {
    const fixtures = [
      ['a', { sortTimeMs: 100 }],
      ['A', { sortTimeMs: 100 }],
      ['zero', { sortTimeMs: 0 }],
      ['negative', { sortTimeMs: -1000 }],
      ['missing', {}]
    ];
    try {
      await Promise.all(fixtures.map(([id, data]) => collection.doc(id).set(data)));
      const query = collection.orderBy('sortTimeMs', 'desc').orderBy(FieldPath.documentId(), 'desc');
      const first = await query.limit(2).get();
      assert.deepEqual(first.docs.map(doc => doc.id), ['a', 'A']);
      const second = await query.startAfter(first.docs[1]).get();
      assert.deepEqual(second.docs.map(doc => doc.id), ['zero', 'negative']);
      assert.equal((await collection.doc('missing').get()).exists, true);
    } finally {
      await Promise.all(fixtures.map(([id]) => collection.doc(id).delete()));
    }
  });

  test('stale update-time precondition rejects an outdated backfill', async () => {
    const ref = collection.doc('concurrent');
    try {
      await ref.set({ status: 'pending', scheduledAt: new Date(1000) });
      const original = await ref.get();
      await ref.update({ status: 'posted', postedAt: new Date(2000) });
      await assert.rejects(
        ref.update({ sortTimeMs: 1000 }, { lastUpdateTime: original.updateTime }),
        error => error.code === 9
      );
      const current = (await ref.get()).data();
      assert.equal(current.status, 'posted');
      assert.equal(current.postedAt.toMillis(), 2000);
      assert.equal(current.sortTimeMs, undefined);
    } finally {
      await ref.delete();
    }
  });

  test('stale batch cleanup cannot delete a job claimed after it was read', async () => {
    const ref = collection.doc('cleanup-race');
    try {
      await ref.set({ status: 'pending' });
      const original = await ref.get();
      await ref.update({ status: 'processing' });
      const batch = db.batch();
      batch.delete(ref, { lastUpdateTime: original.updateTime });
      await assert.rejects(batch.commit(), error => error.code === 9);
      assert.equal((await ref.get()).data().status, 'processing');
    } finally {
      await ref.delete();
    }
  });
});
