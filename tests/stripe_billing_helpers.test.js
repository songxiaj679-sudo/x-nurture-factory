const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveBillingCurrency,
  selectStripePriceId,
  convertInvoiceAmountToUsd,
  getEcbJpyUsdRate,
  buildActiveStripePlanPatch
} = require('../src/stripe_billing_helpers');

test('explicit checkout currency takes precedence over UI language', () => {
  assert.equal(resolveBillingCurrency({ currency: 'jpy', lang: 'en' }), 'jpy');
  assert.equal(resolveBillingCurrency({ currency: 'usd', lang: 'ja' }), 'usd');
  assert.equal(resolveBillingCurrency({ lang: 'en-US' }), 'usd');
  assert.equal(resolveBillingCurrency({ lang: 'ja-JP' }), 'jpy');
  assert.throws(() => resolveBillingCurrency({ currency: 'eur', lang: 'en' }), /Unsupported/);
});

test('Stripe price selection uses the requested plan and currency catalog only', () => {
  const catalogs = {
    jpy: { starter: 'price_jpy_starter', pro: 'price_jpy_pro', business: 'price_jpy_business' },
    usd: { starter: 'price_usd_starter', pro: 'price_usd_pro', business: 'price_usd_business' }
  };

  assert.equal(selectStripePriceId('pro', 'usd', catalogs), 'price_usd_pro');
  assert.equal(selectStripePriceId('starter', 'jpy', catalogs), 'price_jpy_starter');
  assert.equal(selectStripePriceId('unknown', 'usd', catalogs), null);
  assert.equal(selectStripePriceId('business', 'eur', catalogs), null);
});

test('invoice paid amount converts using currency minor units and an explicit JPY FX rate', () => {
  assert.deepEqual(convertInvoiceAmountToUsd(7900, 'usd'), {
    sourceAmount: 79,
    sourceCurrency: 'usd',
    paidAmountUsd: 79,
    usdConversionRate: 1
  });
  assert.deepEqual(convertInvoiceAmountToUsd(4980, 'jpy', 0.00625), {
    sourceAmount: 4980,
    sourceCurrency: 'jpy',
    paidAmountUsd: 31.13,
    usdConversionRate: 0.00625
  });
  assert.equal(convertInvoiceAmountToUsd(0, 'usd').paidAmountUsd, 0);
  assert.throws(() => convertInvoiceAmountToUsd(4980, 'jpy'), /exchange rate/);
});

test('JPY FX lookup uses the payment date and validates the ECB reference response', async () => {
  const requestedAt = Date.UTC(2026, 10, 14, 12) / 1000;
  let requestedUrl = '';
  const rate = await getEcbJpyUsdRate(requestedAt, async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({
        base: 'JPY',
        date: '2026-11-13',
        rates: { USD: 0.00625 }
      })
    };
  });

  assert.equal(requestedUrl, 'https://api.frankfurter.dev/v1/2026-11-14?base=JPY&symbols=USD');
  assert.deepEqual(rate, {
    rate: 0.00625,
    date: '2026-11-13',
    source: 'ECB reference rate via Frankfurter'
  });
  await assert.rejects(
    getEcbJpyUsdRate(Date.UTC(2020, 0, 1) / 1000, async () => ({
      ok: true,
      json: async () => ({ base: 'JPY', date: '2020-01-01', rates: {} })
    })),
    /invalid JPY\/USD rate/
  );
});

test('an active Stripe plan patch keeps the 14 day trial end and cancellation state', () => {
  const patch = buildActiveStripePlanPatch({
    plan: 'pro',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    subscription: { status: 'trialing', trial_end: 1_800_000_400, cancel_at_period_end: true, current_period_end: 1_800_000_500 },
    basePlanCatalog: { pro: { tierLevel: 2, dailyPostCap: 3, maxAccounts: 12 } },
    now: new Date('2026-11-18T00:00:00.000Z')
  });
  assert.equal(patch.planStatus, 'active');
  assert.equal(patch.stripeSubscriptionStatus, 'trialing');
  assert.equal(patch.cancelAtPeriodEnd, true);
  assert.equal(patch.stripeSubscriptionTrialEnd.toISOString(), new Date(1_800_000_400 * 1000).toISOString());
  assert.equal(patch.billingEndsAt.toISOString(), new Date(1_800_000_500 * 1000).toISOString());
});
