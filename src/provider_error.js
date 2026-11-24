'use strict';

const COOLDOWN_MS = 12 * 60 * 1000;
const QUALITY_STOP = '検証を通る投稿案が無かったため停止しました。';

let openUntil = 0;
let last = null;

function statusOf(error) {
  const direct = Number(error && error.status);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const message = String(error && error.message || '');
  const match = message.match(/\b([45]\d\d)\b/);
  return match ? Number(match[1]) : 0;
}

function providerName(message, hint) {
  if (hint) return String(hint);
  if (/anthropic/i.test(message)) return 'anthropic';
  if (/openai/i.test(message)) return 'openai';
  if (/grok|\bxai\b|x\.ai/i.test(message)) return 'xai';
  return 'llm';
}

function classifyProviderError(error, providerHint) {
  if (error && error.providerFailure && error.providerFailure.class) return { ...error.providerFailure };
  const message = String(error && error.message || '');
  if (!message && !error) return null;
  const status = statusOf(error);
  const provider = providerName(message, providerHint);
  if (/credit balance is too low|insufficient_quota|billing_hard_limit|exceeded your current quota|payment required/i.test(message) || status === 402) {
    return { class: 'provider_billing_error', provider, status: status || 400 };
  }
  if (status === 401 || status === 403 || /invalid api key|invalid x-api-key|authentication_error|\bunauthorized\b/i.test(message)) {
    return { class: 'provider_auth_error', provider, status: status || 401 };
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return { class: 'provider_rate_limit', provider, status: status || 429 };
  }
  if (status === 529 || status >= 500 || /timeout|aborted|overloaded/i.test(message)) {
    return { class: 'provider_outage', provider, status: status || 503 };
  }
  return null;
}

function customerProviderMessage(lang) {
  return String(lang || '').toLowerCase().startsWith('en')
    ? 'Draft generation is waiting for the language service to recover. It resumes on the next cycle.'
    : '文章の生成サービスが回復するまで、次の新規作成を待っています。回復後の次の周期から自動で再開します。';
}

function noteProviderFailure(classified, now = Date.now()) {
  if (!classified || !classified.class) return null;
  const already = now < openUntil && last && last.class === classified.class && last.provider === classified.provider;
  openUntil = now + COOLDOWN_MS;
  last = {
    class: classified.class,
    provider: classified.provider || 'llm',
    status: Number(classified.status) || 0,
    until: new Date(openUntil).toISOString()
  };
  if (!already) {
    console.error(`[CRITICAL] provider=${last.provider} class=${last.class} http=${last.status} cooldown_until=${last.until}`);
  }
  return { ...last };
}

function providerCooldown(now = Date.now()) {
  if (!last || now >= openUntil) return null;
  return { ...last, remainingMs: openUntil - now };
}

function providerHealth(now = Date.now()) {
  return providerCooldown(now);
}

function clearProviderCooldown() {
  openUntil = 0;
  last = null;
}

function providerStop(error, providerHint, now = Date.now()) {
  if (error && error.providerFailure && String(error.code || '').startsWith('provider_')) return error;
  const failure = classifyProviderError(error, providerHint);
  if (!failure) return null;
  const noted = noteProviderFailure(failure, now);
  const err = new Error(customerProviderMessage('ja'));
  err.code = failure.class;
  err.providerFailure = noted;
  return err;
}

function pauseError(now = Date.now()) {
  const paused = providerCooldown(now);
  if (!paused) return null;
  const err = new Error(customerProviderMessage('ja'));
  err.code = paused.class;
  err.providerFailure = paused;
  return err;
}

function ensureFailureDecision(err, { failures = 0, lang = 'ja' } = {}) {
  const failure = (err && err.providerFailure) || classifyProviderError(err);
  if (failure) {
    noteProviderFailure(failure);
    return {
      lock: false,
      update: {
        lastEnsureNextError: customerProviderMessage(lang),
        lastEnsureNextErrorCode: failure.class,
        lastEnsureNextRejectReasons: []
      }
    };
  }
  return {
    lock: true,
    update: {
      ensureNextPostFailures: (Number(failures) || 0) + 1,
      lastEnsureNextError: String(err && err.message || 'unknown').slice(0, 240),
      lastEnsureNextRejectReasons: Array.isArray(err && err.rejectReasons) ? err.rejectReasons.slice(0, 6) : []
    }
  };
}

module.exports = {
  COOLDOWN_MS,
  QUALITY_STOP,
  classifyProviderError,
  customerProviderMessage,
  noteProviderFailure,
  providerCooldown,
  providerHealth,
  clearProviderCooldown,
  providerStop,
  pauseError,
  ensureFailureDecision
};
