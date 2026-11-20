'use strict';

const crypto = require('node:crypto');

function normalizeEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at <= 0) return '';
  let local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  return `${local.split('+')[0]}@${domain}`;
}

function claimId(kind, value) {
  if (kind === 'x') return `x_${String(value || '').replace(/\W/g, '')}`;
  if (kind === 'pm') return `pm_${String(value || '').replace(/\W/g, '')}`;
  return `em_${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function trialNotice({ handle = '', lang = 'ja' } = {}) {
  const name = handle ? `@${String(handle).replace(/^@/, '')}` : 'ご連携いただいた X アカウント';
  if (String(lang).toLowerCase().startsWith('en')) {
    return `${name} has already used the 14-day free trial. A new login starts on the regular plan. Continuing with the earlier login keeps the writing patterns and response history VELOX AI has already learned.`;
  }
  return `ご連携いただいた X アカウント（${name}）では、すでに 14日間の無料トライアルをご利用いただいています。新しいログイン ID のままご利用を始める場合は、初月から通常プランでのスタートとなります。以前のアカウントで続けていただくと、これまで VELOX AI が学習した「読まれやすい切り口・過去の反応データ」をそのまま引き継げるため、元のアカウントでのログインをおすすめします。`;
}

async function readClaim(db, id) {
  if (!db || !id) return null;
  const snap = await db.collection('trial_eligibility_claims').doc(id).get();
  return snap.exists ? (snap.data() || {}) : null;
}

async function evaluateTrialEligibility({ db, userId, twitterId, email, fingerprint }) {
  const keys = [];
  if (/^\d+$/.test(String(twitterId || ''))) keys.push(claimId('x', twitterId));
  const normalized = normalizeEmail(email);
  if (normalized) keys.push(claimId('em', normalized));
  if (fingerprint) keys.push(claimId('pm', fingerprint));
  for (const id of keys) {
    const claim = await readClaim(db, id);
    if (claim && claim.firstUserId && claim.firstUserId !== userId) {
      return { allowTrial: false, claimId: id, firstUserId: claim.firstUserId, notice: trialNotice({ handle: claim.handle || '' }) };
    }
  }
  return { allowTrial: true, notice: '' };
}

async function recordTrialClaim({ db, userId, twitterId, email, fingerprint, handle, stripeCustomerId }) {
  if (!db || !userId) return;
  const payload = { firstUserId: userId, claimedAt: new Date().toISOString(), stripeCustomerId: stripeCustomerId || '', handle: handle || '' };
  const ids = [];
  if (/^\d+$/.test(String(twitterId || ''))) ids.push(claimId('x', twitterId));
  const normalized = normalizeEmail(email);
  if (normalized) ids.push(claimId('em', normalized));
  if (fingerprint) ids.push(claimId('pm', fingerprint));
  for (const id of ids) {
    const ref = db.collection('trial_eligibility_claims').doc(id);
    const prev = await ref.get();
    if (!prev.exists) await ref.set(payload);
  }
}

module.exports = {
  normalizeEmail,
  claimId,
  trialNotice,
  evaluateTrialEligibility,
  recordTrialClaim
};
