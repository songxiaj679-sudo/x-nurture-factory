'use strict';

const CANONICAL_STATUSES = [
  'new',
  'standby',
  'init_pending',
  'initialized',
  'nurturing',
  'healthy',
  'posting_ready',
  'restricted',
  'shadowbanned',
  'sold',
  'retired',
  'unavailable',
];

const STATUS_ALIASES = {
  farming: 'nurturing',
  rehab: 'nurturing',
  cleared: 'healthy',
  active_own: 'healthy',
  reset: 'init_pending',
  shadowban: 'shadowbanned',
  robot: 'restricted',
};

const LEGACY_STATUS = {
  nurturing: 'farming',
  healthy: 'cleared',
  restricted: 'robot',
  init_pending: 'standby',
};

const PERSISTED_BY_LIFECYCLE = {
  nurturing: ['farming', 'nurturing', 'rehab'],
  healthy: ['cleared', 'healthy', 'active_own'],
  posting_ready: ['posting_ready'],
};

const ALLOWED_TRANSITIONS = {
  new: ['standby', 'init_pending'],
  standby: ['init_pending', 'initialized'],
  init_pending: ['initialized', 'nurturing'],
  initialized: ['nurturing'],
  nurturing: ['healthy', 'restricted', 'shadowbanned'],
  healthy: ['posting_ready', 'sold', 'restricted', 'shadowbanned'],
  posting_ready: ['healthy', 'sold'],
  restricted: ['nurturing', 'standby'],
  shadowbanned: ['restricted'],
  sold: ['retired'],
  retired: [],
  unavailable: [],
};

const ACCOUNT_STATUS_SET = new Set(CANONICAL_STATUSES);
const ACCOUNT_STATUS_SEQUENCE = [...CANONICAL_STATUSES];
const ACCOUNT_ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
const ACCOUNT_PERSISTED_STATUS_SET = new Set([
  ...CANONICAL_STATUSES,
  ...Object.keys(STATUS_ALIASES),
  ...Object.values(LEGACY_STATUS),
]);

const ACCOUNT_STATUS_GROUPS = {
  initializationQueue: ['new', 'standby', 'init_pending'],
  nurtureEngineQueue: ['nurturing', 'healthy'],
};

function normalizeAccountStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (ACCOUNT_STATUS_SET.has(value)) return value;
  if (STATUS_ALIASES[value]) return STATUS_ALIASES[value];
  return 'new';
}

function getLegacyAccountStatus(status) {
  const canonical = normalizeAccountStatus(status);
  return LEGACY_STATUS[canonical] || canonical;
}

function getAccountLifecycleStatus(account = {}) {
  if (account.lifecycleStatus) return normalizeAccountStatus(account.lifecycleStatus);
  return normalizeAccountStatus(account.status);
}

function getAccountDisplayStatus(account = {}) {
  const raw = String(account.status || '').trim().toLowerCase();
  if (raw && (ACCOUNT_PERSISTED_STATUS_SET.has(raw) || STATUS_ALIASES[raw])) {
    if (LEGACY_STATUS[normalizeAccountStatus(raw)] || STATUS_ALIASES[raw] || raw === 'reset') {
      if (raw === 'nurturing' || raw === 'healthy' || raw === 'restricted') return getLegacyAccountStatus(raw);
      if (STATUS_ALIASES[raw] || raw === 'reset') return raw === 'reset' ? 'reset' : raw;
    }
  }
  return getLegacyAccountStatus(getAccountLifecycleStatus(account));
}

function getPersistedStatusesForLifecycleStatuses(statuses) {
  const persisted = [];
  for (const status of statuses || []) {
    const canonical = normalizeAccountStatus(status);
    persisted.push(...(PERSISTED_BY_LIFECYCLE[canonical] || [canonical]));
  }
  return [...new Set(persisted)];
}

function isValidStatusTransition(fromStatus, toStatus) {
  const from = normalizeAccountStatus(fromStatus);
  const to = normalizeAccountStatus(toStatus);
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

function assertValidStatusTransition(fromStatus, toStatus, options = {}) {
  if (options.force) return;
  if (!isValidStatusTransition(fromStatus, toStatus)) {
    const from = normalizeAccountStatus(fromStatus);
    const to = normalizeAccountStatus(toStatus);
    throw new Error(`Illegal account status transition from "${from}" to "${to}"`);
  }
}

function buildAccountStatePatch(status, updates = {}, updatedAt = new Date()) {
  const raw = String(status || '').trim().toLowerCase();
  if (!ACCOUNT_PERSISTED_STATUS_SET.has(raw)) {
    throw new Error(`Unsupported account status: ${raw || '(empty)'}`);
  }
  const canonical = normalizeAccountStatus(raw);
  const rest = { ...updates };
  delete rest.status;
  delete rest.lifecycleStatus;
  delete rest.updatedAt;
  return {
    ...rest,
    status: raw,
    lifecycleStatus: canonical,
    updatedAt,
  };
}

function normalizeAccountSource(source) {
  const value = String(source || '').trim().toLowerCase();
  if (value === 'setup_worker' || value === 'imported' || value === 'manual') return value;
  return value || 'unknown';
}

function buildAccountRecord(accountData = {}) {
  const accountId = accountData.accountId || null;
  const status = String(accountData.status || 'standby').trim().toLowerCase();
  return {
    accountId,
    userId: String(accountData.userId || accountData.username || '').replace(/^@/, ''),
    authToken: accountData.authToken || null,
    status,
    lifecycleStatus: normalizeAccountStatus(status),
    source: normalizeAccountSource(accountData.source),
    profileDir: accountData.profileDir || (accountId ? `accounts/${accountId}` : null),
    deviceProfile: accountData.deviceProfile || null,
    riskScore: Number.isFinite(accountData.riskScore) ? accountData.riskScore : 0,
    isActive: accountData.isActive !== false,
  };
}

function getAccountRuntimeContext(account = {}) {
  return {
    accountId: account.accountId || null,
    username: String(account.username || account.userId || '').replace(/^@/, ''),
    status: normalizeAccountStatus(account.lifecycleStatus || account.status),
    browserSessionId: account.accountId || null,
    profileDir: account.profileDir || null,
    proxy: account.proxy || null,
    actionCooldownUntil: 0,
  };
}

function transitionAccountStatus(account, nextStatus, options = {}) {
  assertValidStatusTransition(account && (account.lifecycleStatus || account.status), nextStatus, options);
  const canonical = normalizeAccountStatus(nextStatus);
  return {
    ...account,
    status: canonical,
    lifecycleStatus: canonical,
    updatedAt: new Date(),
  };
}

function getEligibleAccountsForQueue(accounts, queue) {
  const allowed = queue === 'posting'
    ? new Set(['healthy'])
    : new Set(['initialized', 'nurturing', 'healthy', 'standby']);
  return (accounts || []).filter(account => allowed.has(normalizeAccountStatus(account.status)));
}

function getPostingEligibility(account = {}) {
  if (account.postingApproved !== true) return { eligible: false, reason: 'approval_required' };
  if (normalizeAccountStatus(account.lifecycleStatus || account.status) !== 'posting_ready') {
    return { eligible: false, reason: 'lifecycle_not_ready' };
  }
  if (account.isActive === false) return { eligible: false, reason: 'inactive' };
  if (account.reachRestricted) return { eligible: false, reason: 'reach_restricted' };
  if (account.errorReason) return { eligible: false, reason: 'error' };
  return { eligible: true, reason: null };
}

module.exports = {
  ACCOUNT_STATUS_SET,
  ACCOUNT_STATUS_SEQUENCE,
  ACCOUNT_ALLOWED_TRANSITIONS,
  ACCOUNT_PERSISTED_STATUS_SET,
  ACCOUNT_STATUS_GROUPS,
  normalizeAccountStatus,
  getLegacyAccountStatus,
  getAccountLifecycleStatus,
  getAccountDisplayStatus,
  getPersistedStatusesForLifecycleStatuses,
  isValidStatusTransition,
  assertValidStatusTransition,
  buildAccountStatePatch,
  normalizeAccountSource,
  buildAccountRecord,
  getAccountRuntimeContext,
  transitionAccountStatus,
  getEligibleAccountsForQueue,
  getPostingEligibility,
};
