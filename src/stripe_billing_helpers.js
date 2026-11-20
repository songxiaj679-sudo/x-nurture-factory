const SUPPORTED_CURRENCIES = new Set(['jpy', 'usd']);
const SUPPORTED_PLANS = new Set(['starter', 'pro', 'business']);
const jpyUsdRateCache = new Map();

function resolveBillingCurrency({ currency, lang } = {}) {
  const requestedCurrency = String(currency || '').trim().toLowerCase();
  if (requestedCurrency) {
    if (!SUPPORTED_CURRENCIES.has(requestedCurrency)) {
      throw new TypeError('Unsupported billing currency');
    }
    return requestedCurrency;
  }

  return String(lang || '').trim().toLowerCase().startsWith('en') ? 'usd' : 'jpy';
}

function selectStripePriceId(plan, currency, catalogs) {
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  const normalizedCurrency = String(currency || '').trim().toLowerCase();
  if (!SUPPORTED_PLANS.has(normalizedPlan) || !SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
    return null;
  }

  return catalogs?.[normalizedCurrency]?.[normalizedPlan] || null;
}

function convertInvoiceAmountToUsd(amountPaidMinor, currency, jpyToUsdRate) {
  const normalizedCurrency = String(currency || '').trim().toLowerCase();
  const amountMinor = Number(amountPaidMinor);
  if (!Number.isFinite(amountMinor) || amountMinor < 0) {
    throw new TypeError('Invalid invoice amount_paid');
  }
  if (!SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
    throw new TypeError('Unsupported invoice currency');
  }

  const sourceAmount = normalizedCurrency === 'usd' ? amountMinor / 100 : amountMinor;
  if (sourceAmount === 0) {
    return {
      sourceAmount: 0,
      sourceCurrency: normalizedCurrency,
      paidAmountUsd: 0,
      usdConversionRate: null
    };
  }

  const rate = normalizedCurrency === 'usd' ? 1 : Number(jpyToUsdRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new TypeError('A valid JPY-to-USD exchange rate is required');
  }

  return {
    sourceAmount,
    sourceCurrency: normalizedCurrency,
    paidAmountUsd: Math.round(sourceAmount * rate * 100) / 100,
    usdConversionRate: rate
  };
}

async function getEcbJpyUsdRate(paidAtSeconds, fetchImpl = globalThis.fetch) {
  const timestamp = Number(paidAtSeconds);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new TypeError('Invalid payment timestamp for FX lookup');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is unavailable for FX lookup');
  }

  const requestedDate = new Date(timestamp * 1000).toISOString().slice(0, 10);
  if (jpyUsdRateCache.has(requestedDate)) return jpyUsdRateCache.get(requestedDate);

  const url = `https://api.frankfurter.dev/v1/${requestedDate}?base=JPY&symbols=USD`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(`FX rate lookup failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const rate = Number(body?.rates?.USD);
  const rateDate = String(body?.date || '');
  if (body?.base !== 'JPY' || !/^\d{4}-\d{2}-\d{2}$/.test(rateDate) ||
      !Number.isFinite(rate) || rate <= 0) {
    throw new Error('FX rate service returned an invalid JPY/USD rate');
  }

  const result = {
    rate,
    date: rateDate,
    source: 'ECB reference rate via Frankfurter'
  };
  if (jpyUsdRateCache.size > 30) jpyUsdRateCache.clear();
  jpyUsdRateCache.set(requestedDate, result);
  return result;
}

function buildActiveStripePlanPatch({ plan, stripeCustomerId, stripeSubscriptionId, subscription, basePlanCatalog, now = new Date() } = {}) {
  const normalized = String(plan || '').trim().toLowerCase();
  const catalog = basePlanCatalog && basePlanCatalog[normalized] ? basePlanCatalog[normalized] : {};
  const trialEnd = subscription && subscription.trial_end ? new Date(Number(subscription.trial_end) * 1000) : null;
  const periodEnd = subscription && subscription.current_period_end ? new Date(Number(subscription.current_period_end) * 1000) : null;
  return {
    planId: normalized,
    planStatus: 'active',
    tierLevel: normalized === 'business' ? 4 : (normalized === 'pro' ? 2 : 1),
    maxThreads: catalog.baseThreads,
    maxAccounts: catalog.baseAccounts,
    aiReplyUnlocked: normalized === 'business',
    stripeCustomerId: stripeCustomerId || '',
    stripeSubscriptionId: stripeSubscriptionId || '',
    stripeSubscriptionStatus: (subscription && subscription.status) || 'active',
    stripeSubscriptionTrialEnd: trialEnd,
    cancelAtPeriodEnd: Boolean(subscription && subscription.cancel_at_period_end),
    billingEndsAt: periodEnd,
    updatedAt: now
  };
}

module.exports = {
  resolveBillingCurrency,
  selectStripePriceId,
  convertInvoiceAmountToUsd,
  getEcbJpyUsdRate,
  buildActiveStripePlanPatch
};
