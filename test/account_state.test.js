const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACCOUNT_STATUS_SEQUENCE,
  ACCOUNT_STATUS_SET,
  ACCOUNT_ALLOWED_TRANSITIONS,
  isValidStatusTransition,
  assertValidStatusTransition,
  buildAccountStatePatch,
  getAccountLifecycleStatus,
  getAccountDisplayStatus,
  getPersistedStatusesForLifecycleStatuses,
  normalizeAccountStatus,
  getAccountRuntimeContext,
  getLegacyAccountStatus,
  buildAccountRecord,
  transitionAccountStatus,
  getEligibleAccountsForQueue,
  getPostingEligibility,
} = require('../src/account_state');
const { createAccountRepository } = require('../src/account_repository');

test('ACCOUNT_STATUS_SET includes required lifecycle states', () => {
  assert.ok(ACCOUNT_STATUS_SET.has('new'));
  assert.ok(ACCOUNT_STATUS_SET.has('initialized'));
  assert.ok(ACCOUNT_STATUS_SET.has('healthy'));
  assert.ok(ACCOUNT_STATUS_SET.has('shadowbanned'));
  assert.ok(ACCOUNT_STATUS_SET.has('retired'));
});

test('normalizeAccountStatus accepts aliases and preserves canonical values', () => {
  assert.equal(normalizeAccountStatus('standby'), 'standby');
  assert.equal(normalizeAccountStatus('farming'), 'nurturing');
  assert.equal(normalizeAccountStatus('cleared'), 'healthy');
  assert.equal(normalizeAccountStatus('reset'), 'init_pending');
  assert.equal(normalizeAccountStatus('init_pending'), 'init_pending');
  assert.equal(normalizeAccountStatus('posting_ready'), 'posting_ready');
  assert.equal(normalizeAccountStatus('shadowban'), 'shadowbanned');
  assert.equal(normalizeAccountStatus('retired '), 'retired');
  assert.equal(normalizeAccountStatus('unknown'), 'new');
});

test('getLegacyAccountStatus keeps existing UI and query status values consistent', () => {
  assert.equal(getLegacyAccountStatus('nurturing'), 'farming');
  assert.equal(getLegacyAccountStatus('healthy'), 'cleared');
  assert.equal(getLegacyAccountStatus('restricted'), 'robot');
  assert.equal(getLegacyAccountStatus('reset'), 'standby');
});

test('account state reads prefer lifecycleStatus and preserve legacy UI states', () => {
  assert.equal(getAccountLifecycleStatus({ status: 'farming' }), 'nurturing');
  assert.equal(getAccountLifecycleStatus({ status: 'cleared', lifecycleStatus: 'nurturing' }), 'nurturing');
  assert.equal(getAccountDisplayStatus({ status: 'nurturing' }), 'farming');
  assert.equal(getAccountDisplayStatus({ status: 'reset', lifecycleStatus: 'init_pending' }), 'reset');
  assert.equal(getAccountDisplayStatus({ status: 'healthy' }), 'cleared');
});

test('state queries include legacy and canonical persisted status values', () => {
  const statuses = getPersistedStatusesForLifecycleStatuses(['nurturing', 'healthy', 'posting_ready']);
  assert.deepEqual(new Set(statuses), new Set([
    'farming', 'nurturing', 'rehab', 'cleared', 'healthy', 'active_own', 'posting_ready',
  ]));
});

test('getAccountsByLifecycleStatuses filters query results by canonical lifecycle state', async () => {
  let queriedStatuses;
  const legacyDoc = { id: 'legacy', data: () => ({ status: 'farming' }) };
  const canonicalDoc = { id: 'canonical', data: () => ({ status: 'stale', lifecycleStatus: 'nurturing' }) };
  const mismatchDoc = { id: 'mismatch', data: () => ({ status: 'cleared', lifecycleStatus: 'restricted' }) };
  const db = {
    collection: () => ({
      where: (field, _operator, values) => {
        if (field === 'status') queriedStatuses = values;
        const docs = field === 'status'
          ? [legacyDoc, mismatchDoc]
          : [canonicalDoc];
        return {
          limit: () => ({ get: async () => ({ docs }) }),
        };
      },
    }),
  };

  const result = await createAccountRepository(db).getAccountsByLifecycleStatuses(['nurturing']);
  assert.ok(queriedStatuses.includes('farming'));
  assert.ok(queriedStatuses.includes('nurturing'));
  assert.deepEqual(result.map(doc => doc.id), ['legacy', 'canonical']);
});

test('account repository prepares a consistent account record and preserves supplied profile data', () => {
  const db = {
    collection: () => ({
      doc: (id) => ({ id }),
    }),
  };
  const repository = createAccountRepository(db, {
    resolveProxy: () => ({ host: 'proxy.example', port: '1234' }),
    resolveDeviceProfile: () => ({
      userAgent: 'normalized-agent',
      platform: 'Win32',
    }),
  });
  const { documentId, record } = repository.buildAccountPersistenceRecord({
    authToken: 'token-abc',
    userId: '@demo',
    status: 'standby',
    userAgent: 'legacy-agent',
  });

  assert.equal(documentId, 'token-abc');
  assert.equal(record.userId, 'demo');
  assert.equal(record.userAgent, 'normalized-agent');
  assert.equal(record.deviceProfile.userAgent, record.userAgent);
  assert.deepEqual(record.proxy, { host: 'proxy.example', port: '1234' });
  assert.match(record.profileDir, /\.profiles[\\/]prof_/);
  assert.equal(record.status, 'standby');
  assert.equal(record.lifecycleStatus, 'standby');
});

test('getAccountsByLifecycleStatuses paginates without dropping later matching accounts', async () => {
  const firstPage = [
    { id: 'first', data: () => ({ status: 'farming' }) },
    { id: 'second', data: () => ({ status: 'cleared' }) },
  ];
  const secondPage = [{ id: 'third', data: () => ({ status: 'farming' }) }];
  let cursor = null;
  const query = {
    limit: () => ({
      startAfter: (lastDoc) => {
        cursor = lastDoc;
        return { get: async () => ({ docs: secondPage }) };
      },
      get: async () => ({ docs: firstPage }),
    }),
  };
  const db = { collection: () => ({ where: () => query }) };

  const result = await createAccountRepository(db).getAccountsByLifecycleStatuses(['nurturing'], { pageSize: 2 });
  assert.equal(cursor, firstPage[1]);
  assert.deepEqual(result.map(doc => doc.id), ['first', 'third']);
});

test('stageAccountStateUpdate delegates validated state patches to the batch', () => {
  let staged;
  const batch = { update: (ref, patch) => { staged = { ref, patch }; } };
  const ref = { id: 'account-1' };
  createAccountRepository({}).stageAccountStateUpdate(batch, ref, 'nurturing', { farmingCycles: 2 });
  assert.equal(staged.ref, ref);
  assert.equal(staged.patch.status, 'nurturing');
  assert.equal(staged.patch.lifecycleStatus, 'nurturing');
  assert.equal(staged.patch.farmingCycles, 2);
  assert.ok(staged.patch.updatedAt instanceof Date);
});

test('buildAccountStatePatch keeps the legacy status and writes its canonical lifecycle status', () => {
  const updatedAt = new Date('2026-01-01T00:00:00Z');
  const patch = buildAccountStatePatch('farming', {
    status: 'cleared',
    lifecycleStatus: 'posting_ready',
    errorReason: null,
  }, updatedAt);

  assert.deepEqual(patch, {
    errorReason: null,
    status: 'farming',
    lifecycleStatus: 'nurturing',
    updatedAt,
  });
});

test('buildAccountStatePatch rejects statuses outside the shared state list', () => {
  assert.throws(() => buildAccountStatePatch('unrecognized-state'), /Unsupported account status/);
});

test('buildAccountRecord includes account lifecycle metadata', () => {
  const record = buildAccountRecord({
    accountId: 'acc-123',
    username: '@demo',
    authToken: 'token-abc',
    source: 'setup_worker',
    status: 'standby',
    deviceProfile: { platform: 'Win32' },
  });

  assert.equal(record.accountId, 'acc-123');
  assert.equal(record.status, 'standby');
  assert.equal(record.source, 'setup_worker');
  assert.equal(record.profileDir, 'accounts/acc-123');
  assert.deepEqual(record.deviceProfile, { platform: 'Win32' });
  assert.equal(record.riskScore, 0);
  assert.equal(record.isActive, true);
});

test('getPostingEligibility fails closed until an account is ready and explicitly approved', () => {
  assert.deepEqual(getPostingEligibility({ status: 'healthy' }), {
    eligible: false,
    reason: 'approval_required',
  });
  assert.deepEqual(getPostingEligibility({ status: 'nurturing', postingApproved: true }), {
    eligible: false,
    reason: 'lifecycle_not_ready',
  });
  assert.deepEqual(getPostingEligibility({ status: 'posting_ready', postingApproved: true }), {
    eligible: true,
    reason: null,
  });
});

test('getPostingEligibility blocks inactive and restricted accounts', () => {
  assert.equal(getPostingEligibility({ status: 'healthy', postingApproved: true, isActive: false }).eligible, false);
  assert.equal(getPostingEligibility({ status: 'healthy', postingApproved: true, reachRestricted: true }).eligible, false);
  assert.equal(getPostingEligibility({ status: 'healthy', postingApproved: true, errorReason: 'locked' }).eligible, false);
});

test('getAccountRuntimeContext creates a per-account runtime view', () => {
  const context = getAccountRuntimeContext({
    accountId: 'acc-123',
    username: '@demo',
    authToken: 'token-abc',
    status: 'nurturing',
    profileDir: 'accounts/acc-123',
    proxy: { host: '127.0.0.1', port: 8080 },
  });

  assert.equal(context.accountId, 'acc-123');
  assert.equal(context.status, 'nurturing');
  assert.equal(context.browserSessionId, 'acc-123');
  assert.equal(context.profileDir, 'accounts/acc-123');
  assert.equal(context.actionCooldownUntil, 0);
});

test('transitionAccountStatus keeps lifecycle safety and updates timestamps', () => {
  const updated = transitionAccountStatus({
    accountId: 'acc-999',
    status: 'initialized',
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  }, 'nurturing');

  assert.equal(updated.status, 'nurturing');
  assert.ok(updated.updatedAt instanceof Date);
  assert.notEqual(updated.updatedAt.getTime(), new Date('2024-01-01T00:00:00Z').getTime());
});

test('getEligibleAccountsForQueue filters only valid account states for the requested queue', () => {
  const accounts = [
    { accountId: 'a1', status: 'initialized' },
    { accountId: 'a2', status: 'nurturing' },
    { accountId: 'a3', status: 'healthy' },
    { accountId: 'a4', status: 'shadowbanned' },
    { accountId: 'a5', status: 'standby' },
  ];

  const nurtured = getEligibleAccountsForQueue(accounts, 'nurture');
  const posting = getEligibleAccountsForQueue(accounts, 'posting');

  assert.deepEqual(nurtured.map(a => a.accountId), ['a1', 'a2', 'a3', 'a5']);
  assert.deepEqual(posting.map(a => a.accountId), ['a3']);
});

test('state machine validates legal and blocks illegal status transitions', () => {
  // 正当な遷移
  assert.equal(isValidStatusTransition('standby', 'init_pending'), true);
  assert.equal(isValidStatusTransition('init_pending', 'nurturing'), true);
  assert.equal(isValidStatusTransition('farming', 'cleared'), true); // エイリアス含む
  assert.equal(isValidStatusTransition('healthy', 'posting_ready'), true);
  assert.equal(isValidStatusTransition('healthy', 'sold'), true);
  assert.equal(isValidStatusTransition('nurturing', 'restricted'), true);
  assert.equal(isValidStatusTransition('nurturing', 'nurturing'), true); // 同一ステータス更新は常に許可

  // 不正な遷移（出荷済みからの自動育成戻し、凍結からの健全化など）
  assert.equal(isValidStatusTransition('sold', 'farming'), false);
  assert.equal(isValidStatusTransition('sold', 'healthy'), false);
  assert.equal(isValidStatusTransition('unavailable', 'healthy'), false);
  assert.equal(isValidStatusTransition('new', 'posting_ready'), false);

  // assertValidStatusTransition の例外検証
  assert.doesNotThrow(() => assertValidStatusTransition('nurturing', 'healthy'));
  assert.throws(
    () => assertValidStatusTransition('sold', 'nurturing'),
    /Illegal account status transition from "sold" to "nurturing"/
  );

  // force: true であれば強制上書き可能
  assert.doesNotThrow(() => assertValidStatusTransition('sold', 'nurturing', { force: true }));
});

test('transitionAccountStatus enforces state transition safety unless forced', () => {
  const soldAccount = { accountId: 'acc-sold', status: 'sold' };
  
  // 不正な遷移はエラーになる
  assert.throws(
    () => transitionAccountStatus(soldAccount, 'nurturing'),
    /Illegal account status transition from "sold" to "nurturing"/
  );

  // force: true なら遷移可能
  const forced = transitionAccountStatus(soldAccount, 'nurturing', { force: true });
  assert.equal(forced.status, 'nurturing');
  assert.equal(forced.lifecycleStatus, 'nurturing');
});

test('claimAccountLock and releaseAccountLock manage distributed locks correctly', async () => {
  let docData = { lockedByHost: null, lockedUntil: null };
  const mockDb = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => docData }),
      }),
    }),
    runTransaction: async (updateFn) => {
      const transaction = {
        get: async () => ({ exists: true, data: () => docData }),
        update: (_ref, patch) => {
          docData = { ...docData, ...patch };
        },
      };
      return updateFn(transaction);
    },
  };
  const repo = createAccountRepository(mockDb);

  // Host A がロック取得に成功
  const claimedA = await repo.claimAccountLock('acc-1', 'host-A', 5000);
  assert.equal(claimedA, true);
  assert.equal(docData.lockedByHost, 'host-A');

  // Host B が同時にロックを取得しようとすると拒否される
  const claimedB = await repo.claimAccountLock('acc-1', 'host-B', 5000);
  assert.equal(claimedB, false);
  assert.equal(docData.lockedByHost, 'host-A');

  // Host A が解放
  const released = await repo.releaseAccountLock('acc-1', 'host-A');
  assert.equal(released, true);
  assert.equal(docData.lockedByHost, null);
  assert.equal(docData.lockedUntil, null);

  // 解放後は Host B が取得できる
  const claimedB2 = await repo.claimAccountLock('acc-1', 'host-B', 5000);
  assert.equal(claimedB2, true);
  assert.equal(docData.lockedByHost, 'host-B');
});

test('withAccountLock automatically claims and releases locks around workload', async () => {
  let docData = { lockedByHost: null, lockedUntil: null };
  const mockDb = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => docData }),
      }),
    }),
    runTransaction: async (updateFn) => {
      const transaction = {
        get: async () => ({ exists: true, data: () => docData }),
        update: (_ref, patch) => {
          docData = { ...docData, ...patch };
        },
      };
      return updateFn(transaction);
    },
  };
  const repo = createAccountRepository(mockDb);

  let executed = false;
  const res = await repo.withAccountLock('acc-1', 'host-worker', 10000, async () => {
    assert.equal(docData.lockedByHost, 'host-worker');
    executed = true;
    return 'work-done';
  });

  assert.equal(executed, true);
  assert.equal(res.acquired, true);
  assert.equal(res.result, 'work-done');
  // 処理完了後は確実に解放されている
  assert.equal(docData.lockedByHost, null);
  assert.equal(docData.lockedUntil, null);
});
