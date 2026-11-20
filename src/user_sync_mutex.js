/**
 * @file src/user_sync_mutex.js
 * @description saas_usersに対するメトリクス同期・自己進化ループの分散排他ロック制御（ハートビート自動延長機構付き）
 */

const { db } = require('./firestore');
const { parseFirestoreTimestampMs } = require('./metrics_harvest_engine');

const DEFAULT_SYNC_LOCK_TTL_MS = 10 * 60 * 1000; // デフォルト10分
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1分ごとにハートビート延長



/**
 * ユーザーのメトリクス同期分散ロックを獲得する
 * 
 * @param {string} userId
 * @param {string} hostId - ロック保持者識別子（例: pid, workerName）
 * @param {number} [ttlMs=600000] - 有効期限（ミリ秒、デフォルト10分）
 * @returns {Promise<boolean>} ロック獲得成否
 */
async function claimUserSyncLock(userId, hostId, ttlMs = DEFAULT_SYNC_LOCK_TTL_MS) {
  if (!userId) return false;
  const userRef = db.collection('saas_users').doc(userId);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const userData = snapshot.exists ? (snapshot.data() || {}) : {};

    const lockUntilMs = parseFirestoreTimestampMs(userData.metricsSyncLockedUntil);

    // ロック有効期間内（lockUntilMs > now）で、かつ別ホストが保持している場合はロック獲得失敗
    if (lockUntilMs > now && userData.metricsSyncLockedBy && userData.metricsSyncLockedBy !== hostId) {
      return false;
    }

    transaction.set(userRef, {
      metricsSyncLockedBy: hostId,
      metricsSyncLockedUntil: new Date(now + ttlMs),
      metricsSyncLockClaimedAt: new Date(now)
    }, { merge: true });
    return true;
  });
}

/**
 * 実行中処理のためにユーザーの同期ロック有効期限を延長する（ハートビート）
 * 失敗時は最大3回リトライを実行
 * 
 * @param {string} userId
 * @param {string} hostId
 * @param {number} [ttlMs=600000]
 * @param {number} [maxRetries=3]
 * @returns {Promise<boolean>}
 */
async function extendUserSyncLock(userId, hostId, ttlMs = DEFAULT_SYNC_LOCK_TTL_MS, maxRetries = 3) {
  if (!userId) return false;
  const userRef = db.collection('saas_users').doc(userId);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const now = Date.now();
      const extended = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(userRef);
        if (!snapshot.exists) return false;
        const userData = snapshot.data() || {};
        const lockUntilMs = parseFirestoreTimestampMs(userData.metricsSyncLockedUntil);

        // 自身が保持しており、かつ既存ロックが有効期限内（期限切れ前）である場合のみ延長
        // すでに有効期限切れしている場合はロック喪失と判定し、他ホストとの二重実行を防止
        if (userData.metricsSyncLockedBy === hostId && lockUntilMs > now) {
          transaction.set(userRef, {
            metricsSyncLockedUntil: new Date(now + ttlMs),
            metricsSyncLockExtendedAt: new Date(now)
          }, { merge: true });
          return true;
        }
        return false;
      });

      if (extended) return true;
    } catch (e) {
      if (attempt === maxRetries) {
        console.warn(`[UserSyncLock Extend Warning] ${userId} attempt ${attempt} failed:`, e.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

/**
 * ユーザーのメトリクス同期分散ロックを解放する
 * 
 * @param {string} userId
 * @param {string} hostId
 * @returns {Promise<boolean>}
 */
async function releaseUserSyncLock(userId, hostId) {
  if (!userId) return false;
  const userRef = db.collection('saas_users').doc(userId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) return true;
    const userData = snapshot.data() || {};

    // 自身が保持している場合、または未ロックの場合は解放
    if (!userData.metricsSyncLockedBy || userData.metricsSyncLockedBy === hostId) {
      transaction.set(userRef, {
        metricsSyncLockedBy: null,
        metricsSyncLockedUntil: null
      }, { merge: true });
      return true;
    }
    return false;
  });
}

/**
 * ユーザーのメトリクス同期を分散ロック下で安全に実行する
 * （処理継続中はハートビートタイマーによりロックが自動延長され、延長失敗時はlockContext.isLockLostを通知して重複実行を遮断）
 * 
 * @param {string} userId
 * @param {string} hostId
 * @param {number} [ttlMs=600000]
 * @param {Function} fn
 * @returns {Promise<{ acquired: boolean, result: any }>}
 */
async function withUserSyncLock(userId, hostId, ttlMs = DEFAULT_SYNC_LOCK_TTL_MS, fn) {
  const acquired = await claimUserSyncLock(userId, hostId, ttlMs);
  if (!acquired) {
    return { acquired: false, result: null };
  }

  const lockContext = {
    userId,
    hostId,
    isLockLost: false
  };

  // 🛡️ 長時間処理の重複実行防止: 1分ごとにロック有効期限を自動延長するハートビート
  const heartbeatTimer = setInterval(async () => {
    const ok = await extendUserSyncLock(userId, hostId, ttlMs);
    if (!ok) {
      lockContext.isLockLost = true;
      console.error(`🚨 [UserSyncLock Lost] ユーザー ${userId} のロック延長に失敗しました。後続書き込みを安全中断します。`);
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const result = await fn(lockContext);
    return { acquired: true, result };
  } finally {
    clearInterval(heartbeatTimer);
    try {
      await releaseUserSyncLock(userId, hostId);
    } catch (e) {
      console.warn(`[UserSyncLock Release Warning] ${userId}:`, e.message);
    }
  }
}

module.exports = {
  DEFAULT_SYNC_LOCK_TTL_MS,
  parseFirestoreTimestampMs,
  claimUserSyncLock,
  extendUserSyncLock,
  releaseUserSyncLock,
  withUserSyncLock
};
