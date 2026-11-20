const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  ACCOUNT_STATUS_SET,
  ACCOUNT_STATUS_SEQUENCE,
  ACCOUNT_ALLOWED_TRANSITIONS,
  isValidStatusTransition,
  assertValidStatusTransition,
  normalizeAccountStatus,
  getLegacyAccountStatus,
  normalizeAccountSource,
  buildAccountStatePatch,
  buildAccountRecord,
  getAccountRuntimeContext,
} = require('./account_state');
const { createAccountRepository } = require('./account_repository');
const { getDeviceProfile } = require('./browser_config');
const { getResidentialProxy } = require('./iproyal');

const configuredServiceAccountPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
if (!configuredServiceAccountPath) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS must point to a service-account JSON file');
}
const serviceAccountPath = path.resolve(configuredServiceAccountPath);
if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(`Google service-account file does not exist: ${serviceAccountPath}`);
}
const serviceAccount = require(serviceAccountPath);
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}
const rawDb = getFirestore();

// 🛡️ [Fail-Closed Shield] テスト実行時の本番Firestoreへの誤アクセス・接続先設定抜けを包括的に遮断
const isTestEnv = process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  (process.argv && process.argv.some(a => a.includes('test') || a.includes('--test'))) ||
  (process.execArgv && process.execArgv.some(a => a.includes('test') || a.includes('--test')));

const isLoopbackEmulator = (host) => {
  if (!host || typeof host !== 'string') return false;
  const clean = host.trim().toLowerCase();
  return clean.startsWith('127.0.0.1:') ||
         clean.startsWith('localhost:') ||
         clean.startsWith('[::1]:');
};

// SDK初期化時点のホスト設定を記録・検証（SDK初期化後の環境変数後付け変更による本番誤接続を恒久遮断）
const initialEmulatorHost = String(process.env.FIRESTORE_EMULATOR_HOST || '').trim();
const initializedWithLoopback = isLoopbackEmulator(initialEmulatorHost);

let db = rawDb;
if (isTestEnv) {
  // すべてのFirestore操作（読み取り・書き込み・クエリ）を包括的に遮断するProxyガード
  const BLOCKED_FIRESTORE_METHODS = new Set([
    'collection',
    'collectionGroup',
    'doc',
    'runTransaction',
    'batch',
    'getAll',
    'listCollections',
    'bundle',
    'runQuery',
    'bulkWriter',
    'recursiveDelete'
  ]);

  db = new Proxy(rawDb, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BLOCKED_FIRESTORE_METHODS.has(prop)) {
        return (...args) => {
          // 1. SDK初期化時点でローカルエミュレーター宛に接続されていたかを検証
          // （初期化後に process.env.FIRESTORE_EMULATOR_HOST を設定しても既存SDKの接続先設定は本番のまま変わらないため）
          const isTargetLoopback = Boolean(target._settings && (
            target._settings.servicePath === '127.0.0.1' ||
            target._settings.servicePath === 'localhost' ||
            target._settings.servicePath === '::1'
          ));

          // 2. 現在の環境変数もローカルエミュレーター宛であることを検証
          const isCurrentEnvLoopback = isLoopbackEmulator(process.env.FIRESTORE_EMULATOR_HOST);

          if (!initializedWithLoopback || !isTargetLoopback || !isCurrentEnvLoopback) {
            throw new Error(
              `[Fail-Closed Shield] Production Firestore.${prop}() is strictly forbidden during tests. ` +
              `The Firestore SDK must be initialized with a local loopback FIRESTORE_EMULATOR_HOST prior to module loading. ` +
              `(initializedWithLoopback=${initializedWithLoopback}, isTargetLoopback=${isTargetLoopback}, isCurrentEnvLoopback=${isCurrentEnvLoopback})`
            );
          }
          return Reflect.get(target, prop, receiver).apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

const accountRepository = createAccountRepository(db, {
  resolveProxy: getResidentialProxy,
  resolveDeviceProfile: getDeviceProfile,
});

// ▼ アカウントを追加・更新する関数
async function saveAccount(accountData) {
  await accountRepository.saveAccount(accountData);
  const record = buildAccountRecord(accountData);
  console.log(`💾 アカウント [${record.userId}] のデータを保存/更新しました（判別基準: ${record.authToken ? 'AuthToken' : 'UserID'}）`);
}

async function updateAccountState(documentId, status, updates = {}) {
  await accountRepository.updateAccountState(documentId, status, updates);
}

module.exports = {
  db,
  ...accountRepository,
  saveAccount,
  updateAccountState,
  buildAccountStatePatch,
  ACCOUNT_STATUS_SET,
  ACCOUNT_STATUS_SEQUENCE,
  ACCOUNT_ALLOWED_TRANSITIONS,
  isValidStatusTransition,
  assertValidStatusTransition,
  normalizeAccountStatus,
  getLegacyAccountStatus,
  normalizeAccountSource,
  buildAccountRecord,
  getAccountRuntimeContext,
};
