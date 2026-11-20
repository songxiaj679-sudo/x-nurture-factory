'use strict';

const { isPaidAccount } = require('./plan_post_budget');

const OPERATED_HANDLES = new Set(['veloxsystemsv4', 'veloxsystemshq']);
const OPERATED_USER_IDS = new Set([
  'WEB-GOOGLE-D12E2479A76266AEA2B4',
  'USR-MVUA1GLP-D640'
]);

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function extraAllowedHandles(env = process.env) {
  return new Set(String(env.OFFICIAL_API_EXTRA_HANDLES || '')
    .split(',')
    .map(normalizeHandle)
    .filter(Boolean));
}

function accountHandles(user = {}, credentials = null) {
  return [
    user.xUsername,
    user.twitterAuth && user.twitterAuth.username,
    credentials && credentials.username
  ].map(normalizeHandle).filter(Boolean);
}

function isOperatedOfficialAccount(user = {}, credentials = null) {
  if (OPERATED_USER_IDS.has(String(user.userId || user.id || ''))) return true;
  return accountHandles(user, credentials).some(handle => OPERATED_HANDLES.has(handle));
}

function hasOfficialCredentials(user = {}, credentials = null) {
  if (credentials && (credentials.oauth2AccessToken || (
    credentials.apiKey && credentials.apiSecret && credentials.accessToken && (credentials.accessTokenSecret || credentials.accessSecret)
  ))) return true;
  return Boolean(user.xOfficialCredentials);
}

function officialApiOperationAllowed(user = {}, credentials = null, env = process.env) {
  const emulator = env.FIRESTORE_EMULATOR_HOST || '';
  if (/^127\.0\.0\.1:\d+$/.test(emulator)) return true;
  if (isOperatedOfficialAccount(user, credentials)) return true;
  const handles = accountHandles(user, credentials);
  if (handles.some(handle => extraAllowedHandles(env).has(handle)) && hasOfficialCredentials(user, credentials)) return true;
  const paidOpen = String(env.OFFICIAL_API_ALLOW_PAID_CUSTOMERS || '').toLowerCase() === 'true';
  if (paidOpen && user.originType !== 'imported' &&
      isPaidAccount(user) &&
      hasOfficialCredentials(user, credentials)) return true;
  return false;
}

module.exports = {
  OPERATED_HANDLES,
  isOperatedOfficialAccount,
  officialApiOperationAllowed,
  extraAllowedHandles,
  hasOfficialCredentials
};
