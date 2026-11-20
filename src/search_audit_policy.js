'use strict';

function accountAgeDays(account) {
  const base = account && (account.createdAt || account.initializedAt);
  if (!base) return 0;
  const ms = base.toDate ? base.toDate().getTime() : new Date(base).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, (Date.now() - ms) / 86400000);
}

function isPureFactoryAccount(account) {
  return !!(account && (account.isNewborn || account.originType === 'pure_jp' || account.originType === 'pure_en'));
}

// 純正は作成または初期化から504時間（21日）後だけ。外部取り込みはサイクル待ちをしない。
function canAuditSearchIndex(account) {
  if (isPureFactoryAccount(account)) return accountAgeDays(account) >= 21;
  return true;
}

function isNewAccountHold(account) {
  return isPureFactoryAccount(account) && !canAuditSearchIndex(account);
}

function searchLangForAccount(account) {
  const origin = String(account && account.originType || '');
  const locale = String(account && (account.signupLocale || account.language) || '').trim().toLowerCase();
  const lang = locale.split('-')[0];
  if (origin === 'pure_en') return lang && lang !== 'ja' ? lang : 'en';
  if (lang) return lang;
  return 'ja';
}

function fromSearchClearsAccount(account) {
  return String(account && account.originType || '') === 'pure_en' || searchLangForAccount(account) !== 'ja';
}

// 解除後に farming へ戻すのは、from: が2回続けて空のときだけ。
function nextClearedAuditDecision(account, audit) {
  if (audit && audit.cleared) {
    return { demote: false, fromMissStreak: 0, searchIndexLevel: audit.level || 'cleared' };
  }
  if (audit && audit.level === 'from_miss') {
    const streak = (Number(account && account.fromMissStreak) || 0) + 1;
    return { demote: streak >= 2, fromMissStreak: streak, searchIndexLevel: 'from_miss' };
  }
  return {
    demote: false,
    fromMissStreak: Number(account && account.fromMissStreak) || 0,
    searchIndexLevel: (audit && audit.level) || 'warming',
  };
}

module.exports = {
  accountAgeDays,
  isPureFactoryAccount,
  canAuditSearchIndex,
  isNewAccountHold,
  searchLangForAccount,
  fromSearchClearsAccount,
  nextClearedAuditDecision,
};
