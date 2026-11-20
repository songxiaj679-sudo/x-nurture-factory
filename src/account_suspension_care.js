'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_EMAIL = /@(?:example\.com|test\.local)$/i;
const SUSPENDED_RE = /The user used for authentication is suspended|User has been suspended|account is suspended|permanently suspended|\bcode\s*(?:63|64)\b/i;

function isSuspendedXError(text) {
  return SUSPENDED_RE.test(String(text || ''));
}

function buildSuspendedNoticeCopy({ handle = '', uiLang = 'ja' } = {}) {
  const en = String(uiLang || '').toLowerCase().startsWith('en');
  const name = handle ? `@${String(handle).replace(/^@/, '')}` : (en ? 'the connected account' : '連携中のアカウント');
  if (en) {
    return {
      subject: 'VeloxPost Cloud paused posting because X reported a suspension',
      text: `X reported ${name} as suspended. VeloxPost Cloud paused scheduled posting and cancelled queued auto-posts so it would not keep calling the X API. Check the notice or appeal in X, then reconnect the recovered account or another active account from the dashboard.`,
      bannerTitle: '⚠️ Auto-posting paused because the connected X account is suspended',
      bannerBody: `X reported ${name} as suspended. To protect your workspace, VeloxPost Cloud paused scheduled posting, cancelled queued auto-posts, and stopped background syncing. Check your notice or appeal on X, then reconnect below once recovered or switch to another X account.`,
      actionLabel: 'Reconnect X account'
    };
  }
  return {
    subject: 'Xの凍結を検知したため、VeloxPost Cloudの自動運用を停止しました',
    text: `X側から ${name} の凍結状態が返されました。VeloxPost Cloudは保護のため予約投稿を止め、待機中の自動予約をキャンセルして、これ以上X APIへ接続しないようにしました。Xの公式通知か異議申し立てを確認し、回復後または別の有効なアカウントをダッシュボードから再連携してください。`,
    bannerTitle: '⚠️ 連携中の X アカウントの凍結を検知したため、自動運用を停止しました',
    bannerBody: `X（旧Twitter）側で ${name} の凍結状態が返されたため、保護のため予約投稿・自動巡回を自動で停止し、待機中の自動予約をキャンセルしました。X 側の通知・異議申し立てをご確認いただくか、回復後または別アカウントで下の「1. X公式アカウントを連携」から再連携してください。`,
    actionLabel: 'X連携を再設定する'
  };
}

function emailIsDeliverable(email) {
  const value = String(email || '').trim();
  return EMAIL_RE.test(value) && !PLACEHOLDER_EMAIL.test(value);
}

async function sendSuspendedNoticeEmail({ email, handle, uiLang, sendMailImpl } = {}) {
  if (!emailIsDeliverable(email)) return { ok: false, result: 'skipped' };
  const copy = buildSuspendedNoticeCopy({ handle, uiLang });
  try {
    if (typeof sendMailImpl === 'function') {
      await sendMailImpl({ to: email, subject: copy.subject, text: copy.text });
      return { ok: true, result: 'sent' };
    }
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return { ok: false, result: 'skipped' };
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'VeloxPost Cloud <support@veloxpostapp.com>',
      to: email,
      subject: copy.subject,
      text: copy.text
    });
    return { ok: true, result: 'sent' };
  } catch (_error) {
    return { ok: false, result: 'failed' };
  }
}

async function handleSuspendedXAccount({ db, userId, reason = '', cancelPendingJobsImpl, sendMailImpl, now = new Date() } = {}) {
  if (!db || !userId) return { ok: false, reason: 'missing_user' };
  const ref = db.collection('saas_users').doc(userId);
  const snap = await ref.get();
  const user = snap && snap.exists ? (snap.data() || {}) : {};
  const stamp = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const update = {
    autopilotPaused: true,
    xLinkHealthStatus: 'suspended',
    relinkRequired: true,
    xSuspendedAt: user.xSuspendedAt || stamp,
    xSuspendedReason: String(reason || '').slice(0, 240),
    updatedAt: now
  };
  let emailResult = user.suspendedNoticeEmailResult || '';
  if (!user.suspendedNoticeSentAt) {
    const uiLang = String(user.uiLang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
    const mailed = await sendSuspendedNoticeEmail({
      email: user.email,
      handle: user.xUsername || '',
      uiLang,
      sendMailImpl
    });
    emailResult = mailed.result;
    update.suspendedNoticeSentAt = stamp;
    update.suspendedNoticeEmailResult = emailResult;
  }
  await ref.set(update, { merge: true });
  try {
    if (typeof cancelPendingJobsImpl === 'function') await cancelPendingJobsImpl(userId, 'account_suspended');
    else {
      const { cancelNonManualPendingJobs } = require('./autonomous_promo_ai');
      await cancelNonManualPendingJobs(userId, 'account_suspended');
    }
  } catch (_cancelErr) {}
  return { ok: true, emailResult, alreadyNotified: Boolean(user.suspendedNoticeSentAt) };
}

module.exports = {
  isSuspendedXError,
  buildSuspendedNoticeCopy,
  sendSuspendedNoticeEmail,
  handleSuspendedXAccount,
  emailIsDeliverable
};
