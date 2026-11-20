'use strict';

const {
  ACCOUNT_PERSISTED_STATUS_SET,
  assertValidStatusTransition,
  buildAccountRecord,
  buildAccountStatePatch,
  getAccountLifecycleStatus,
  getLegacyAccountStatus,
  getPersistedStatusesForLifecycleStatuses,
  normalizeAccountStatus,
} = require('./account_state');
const { getProfileDirectoryPath } = require('./account_profile');

function createAccountRepository(db, {
  resolveProxy = () => null,
  resolveDeviceProfile = () => null,
} = {}) {
  const collection = () => db.collection('accounts');

  function getAccountRef(documentId) {
    return collection().doc(documentId);
  }

  async function getAccount(documentId) {
    return getAccountRef(documentId).get();
  }

  async function getAccountsByField(field, value, { limit = 100 } = {}) {
    let query = collection().where(field, '==', value);
    if (Number.isFinite(limit) && limit > 0) query = query.limit(Math.floor(limit));
    const snapshot = await query.get();
    return snapshot.docs;
  }

  async function getAllAccounts() {
    const snapshot = await collection().get();
    return snapshot.docs;
  }

  async function getAccountsByLifecycleStatuses(statuses, { limit = Infinity, pageSize = 500 } = {}) {
    const lifecycleStatuses = new Set(statuses.map(normalizeAccountStatus));
    const persistedStatuses = getPersistedStatusesForLifecycleStatuses(statuses);
    if (persistedStatuses.length === 0) return [];

    const maxResults = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 500;
    const queryBranches = [
      collection().where('status', 'in', persistedStatuses),
      collection().where('lifecycleStatus', 'in', Array.from(lifecycleStatuses)),
    ];
    const matchingDocs = new Map();

    for (const query of queryBranches) {
      let cursor = null;
      while (true) {
        let pageQuery = query.limit(safePageSize);
        if (cursor) pageQuery = pageQuery.startAfter(cursor);
        const snapshot = await pageQuery.get();
        for (const doc of snapshot.docs) {
          if (lifecycleStatuses.has(getAccountLifecycleStatus(doc.data() || {}))) {
            matchingDocs.set(doc.id, doc);
            if (matchingDocs.size >= maxResults) {
              return Array.from(matchingDocs.values()).slice(0, maxResults);
            }
          }
        }
        if (snapshot.docs.length < safePageSize) break;
        cursor = snapshot.docs[snapshot.docs.length - 1];
      }
    }
    return Array.from(matchingDocs.values());
  }

  function buildAccountPersistenceRecord(accountData = {}, defaultStatus = 'standby') {
    const rawStatus = String(accountData.status || accountData.lifecycleStatus || accountData.accountStatus || defaultStatus)
      .trim().toLowerCase();
    if (!ACCOUNT_PERSISTED_STATUS_SET.has(rawStatus)) {
      throw new TypeError(`Unsupported account status: ${rawStatus || '(empty)'}`);
    }

    const authToken = String(accountData.authToken || '').trim();
    const userId = String(accountData.userId || accountData.username || '').replace(/^@/, '').trim();
    const documentId = authToken || userId || collection().doc().id;
    const baseRecord = buildAccountRecord({
      ...accountData,
      accountId: accountData.accountId || documentId,
      userId,
      status: rawStatus,
    });
    const proxy = accountData.proxy || (baseRecord.authToken ? resolveProxy(baseRecord.authToken) : null);
    const deviceProfile = accountData.deviceProfile ||
      (baseRecord.authToken ? resolveDeviceProfile(baseRecord.authToken, accountData.userAgent || '') : null);
    const userAgent = (deviceProfile && deviceProfile.userAgent) || accountData.userAgent || null;
    const profileDir = accountData.profileDir ||
      (baseRecord.authToken ? getProfileDirectoryPath(baseRecord.authToken) : baseRecord.profileDir);

    return {
      documentId,
      record: {
        ...accountData,
        ...baseRecord,
        profileDir,
        ...buildAccountStatePatch(rawStatus),
        proxyIp: accountData.proxyIp || null,
        ...(proxy ? { proxy } : {}),
        ...(deviceProfile ? { deviceProfile } : {}),
        ...(userAgent ? { userAgent } : {}),
      },
    };
  }

  function pinExistingUserAgent(record, existingUa) {
    if (!existingUa) return record;
    const pinned = { ...record, userAgent: existingUa };
    if (pinned.deviceProfile && typeof pinned.deviceProfile === 'object') {
      pinned.deviceProfile = { ...pinned.deviceProfile, userAgent: existingUa };
    }
    return pinned;
  }

  async function readExistingUserAgent(documentId) {
    try {
      const snap = await getAccountRef(documentId).get();
      if (snap.exists && snap.data() && snap.data().userAgent) return String(snap.data().userAgent);
    } catch (e) {}
    return '';
  }

  async function saveAccount(accountData, { defaultStatus = 'standby', merge = true, allowUserAgentReplace = false } = {}) {
    const { documentId, record } = buildAccountPersistenceRecord(accountData, defaultStatus);
    const existingUa = allowUserAgentReplace ? '' : await readExistingUserAgent(documentId);
    await getAccountRef(documentId).set(pinExistingUserAgent(record, existingUa), { merge });
    return documentId;
  }

  async function saveAccounts(accountDataList, { defaultStatus = 'standby', chunkSize = 400 } = {}) {
    for (let i = 0; i < accountDataList.length; i += chunkSize) {
      const batch = db.batch();
      const chunk = accountDataList.slice(i, i + chunkSize);
      for (const accountData of chunk) {
        const { documentId, record } = buildAccountPersistenceRecord(accountData, defaultStatus);
        const existingUa = await readExistingUserAgent(documentId);
        batch.set(getAccountRef(documentId), pinExistingUserAgent(record, existingUa), { merge: true });
      }
      await batch.commit();
    }
  }

  let FieldValue = null;
  try {
    FieldValue = require('firebase-admin/firestore').FieldValue;
  } catch (e) {}

  async function updateAccountData(documentId, updates = {}, { force = false, currentStatus = null, allowUserAgentReplace = false } = {}) {
    const safeUpdates = { ...(updates || {}) };
    if (!allowUserAgentReplace && (safeUpdates.userAgent || safeUpdates.deviceProfile)) {
      const existingUa = await readExistingUserAgent(documentId);
      if (existingUa) {
        if (Object.prototype.hasOwnProperty.call(safeUpdates, 'userAgent')) safeUpdates.userAgent = existingUa;
        if (safeUpdates.deviceProfile && typeof safeUpdates.deviceProfile === 'object') {
          safeUpdates.deviceProfile = { ...safeUpdates.deviceProfile, userAgent: existingUa };
        }
      }
    }
    const hasStatus = Object.prototype.hasOwnProperty.call(safeUpdates, 'status');
    const hasLifecycleStatus = Object.prototype.hasOwnProperty.call(safeUpdates, 'lifecycleStatus');
    if (!hasStatus && !hasLifecycleStatus) {
      await getAccountRef(documentId).update(safeUpdates);
      return;
    }

    const requestedStatus = hasStatus
      ? safeUpdates.status
      : getLegacyAccountStatus(safeUpdates.lifecycleStatus);
    const targetLifecycle = normalizeAccountStatus(requestedStatus);

    if (currentStatus) {
      assertValidStatusTransition(currentStatus, targetLifecycle, { force });
    }

    const updatedAt = safeUpdates.updatedAt || new Date();
    const patch = buildAccountStatePatch(requestedStatus, safeUpdates, updatedAt);
    const updatePayload = { ...patch };

    if (FieldValue && FieldValue.arrayUnion) {
      const historyEntry = {
        to: targetLifecycle,
        rawStatus: requestedStatus,
        at: updatedAt,
        ...(safeUpdates.errorReason ? { reason: String(safeUpdates.errorReason).slice(0, 100) } : {}),
      };
      if (currentStatus) {
        historyEntry.from = normalizeAccountStatus(currentStatus);
      }
      updatePayload.statusHistory = FieldValue.arrayUnion(historyEntry);
    }

    await getAccountRef(documentId).update(updatePayload);
  }

  async function updateAccountState(documentId, status, updates = {}, options = {}) {
    await updateAccountData(documentId, { ...updates, status }, options);
  }

  async function recordNurtureCycleSuccess(documentId, { cyclesToAdd = 1, nextActionMinutes = 180 } = {}) {
    const nextActionAt = new Date(Date.now() + nextActionMinutes * 60 * 1000);
    const updates = {
      lastActionAt: new Date(),
      lastFarmedAt: new Date(),
      nextActionAt,
    };
    if (FieldValue && FieldValue.increment) {
      updates.farmingCycles = FieldValue.increment(cyclesToAdd);
    }
    await getAccountRef(documentId).update(updates);
  }

  async function recordHealthCheckResult(documentId, { isHealthy, status, reason = null, flags = [] } = {}) {
    const targetStatus = status || (isHealthy ? 'healthy' : 'unavailable');
    const updates = {
      lastHealthCheckAt: new Date(),
      errorReason: reason,
      healthFlags: Array.isArray(flags) ? flags : [],
    };
    await updateAccountState(documentId, targetStatus, updates);
  }

  async function markAccountRestricted(documentId, reason = 'Verification required') {
    await updateAccountState(documentId, 'restricted', {
      errorReason: reason,
      reachRestricted: true,
      lastRestrictedAt: new Date(),
    });
  }

  function stageAccountUpdate(batch, documentRef, updates = {}) {
    const safeUpdates = { ...(updates || {}) };
    const hasStatus = Object.prototype.hasOwnProperty.call(safeUpdates, 'status');
    const hasLifecycleStatus = Object.prototype.hasOwnProperty.call(safeUpdates, 'lifecycleStatus');
    if (!hasStatus && !hasLifecycleStatus) {
      batch.update(documentRef, safeUpdates);
      return;
    }

    const requestedStatus = hasStatus
      ? safeUpdates.status
      : getLegacyAccountStatus(safeUpdates.lifecycleStatus);
    const updatedAt = safeUpdates.updatedAt || new Date();
    batch.update(documentRef, buildAccountStatePatch(requestedStatus, safeUpdates, updatedAt));
  }

  function stageAccountStateUpdate(batch, documentRef, status, updates = {}, now = new Date()) {
    batch.update(documentRef, buildAccountStatePatch(status, updates, now));
  }

  async function deleteAccounts(documentIds) {
    const chunkSize = 400;
    for (let i = 0; i < documentIds.length; i += chunkSize) {
      const batch = db.batch();
      for (const documentId of documentIds.slice(i, i + chunkSize)) {
        batch.delete(getAccountRef(documentId));
      }
      await batch.commit();
    }
  }

  async function claimAccountLock(documentId, hostId, ttlMs) {
    const ref = getAccountRef(documentId);
    const now = Date.now();
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const account = snapshot.data() || {};
      const lockUntil = account.lockedUntil && account.lockedUntil.toDate
        ? account.lockedUntil.toDate().getTime()
        : (account.lockedUntil ? new Date(account.lockedUntil).getTime() : 0);
      if (lockUntil > now && account.lockedByHost && account.lockedByHost !== hostId) return false;
      transaction.update(ref, {
        lockedByHost: hostId,
        lockedUntil: new Date(now + ttlMs),
      });
      return true;
    });
  }

  async function releaseAccountLock(documentId, hostId) {
    const ref = getAccountRef(documentId);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const account = snapshot.data() || {};
      // 自身が保持しているロック、または期限切れのロックであれば解除
      if (!account.lockedByHost || account.lockedByHost === hostId) {
        transaction.update(ref, {
          lockedByHost: null,
          lockedUntil: null,
        });
        return true;
      }
      return false;
    });
  }

  async function withAccountLock(documentId, hostId, ttlMs, fn) {
    const acquired = await claimAccountLock(documentId, hostId, ttlMs);
    if (!acquired) {
      return { acquired: false, result: null };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await releaseAccountLock(documentId, hostId).catch(() => {});
    }
  }

  return {
    getAccountRef,
    getAccount,
    getAccountsByField,
    getAllAccounts,
    getAccountsByLifecycleStatuses,
    buildAccountPersistenceRecord,
    saveAccount,
    saveAccounts,
    updateAccountData,
    updateAccountState,
    stageAccountUpdate,
    stageAccountStateUpdate,
    deleteAccounts,
    claimAccountLock,
    releaseAccountLock,
    withAccountLock,
  };
}

module.exports = { createAccountRepository };
