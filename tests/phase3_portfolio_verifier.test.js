'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planSlotPortfolio } = require('../src/slot_portfolio_planner');
const { runDeterministicAudit, verifyNumericGrounding } = require('../src/draft_verifier');
const { fitsAccountState } = require('../src/customer_post_state');
const { attachPromoReply } = require('../src/next_post_draft');

const free = {
  subscription: 'free',
  singleOnly: false,
  postShape: 'thread',
  maxChars: 140,
  followers: 25,
  following: 4
};

test('a trust-building account never gets a promo link', () => {
  const plan = planSlotPortfolio({
    growthPhase: 'trust',
    timeSlot: 'evening',
    dayOfWeek: 2,
    recentPostedJobs: [],
    userPrompt: 'リード獲得',
    accountState: free
  });
  assert.equal(plan.allowPromoUrl, false);
  assert.notEqual(plan.portfolioRole, 'explicit_promo_offer');
});

test('an advanced account can use one promo slot when none of the last four were promos', () => {
  const plan = planSlotPortfolio({
    growthPhase: 'advanced',
    timeSlot: 'noon',
    dayOfWeek: 2,
    recentPostedJobs: [{ portfolioRole: 'utility_save' }],
    userPrompt: '案内を増やす',
    accountState: { singleOnly: false },
    plan: 'pro'
  });
  assert.equal(plan.portfolioRole, 'explicit_promo_offer');
  assert.equal(plan.allowPromoUrl, true);
  assert.equal(plan.requireDisclosure, true);
});

test('the next role does not repeat the previous post', () => {
  const plan = planSlotPortfolio({
    growthPhase: 'trust',
    timeSlot: 'morning',
    dayOfWeek: 1,
    recentPostedJobs: [{ portfolioRole: 'utility_save' }],
    accountState: free
  });
  assert.notEqual(plan.portfolioRole, 'utility_save');
});

test('a paid account may add one promo reply only when that option is explicit', () => {
  const paid = { subscription: 'premium', singleOnly: false, postShape: 'single', maxChars: 900 };
  assert.equal(fitsAccountState(['本文', '【PR】詳細はこちら: https://example.com'], paid), false);
  assert.equal(fitsAccountState(['本文', '【PR】詳細はこちら: https://example.com'], paid, { allowPromoReply: true }), true);
  assert.equal(fitsAccountState(['本文', '続き'], { ...paid, singleOnly: true }, { allowPromoReply: true }), false);
});

test('a draft with an invented percentage or a copied opening is rejected', () => {
  const recent = '画面の前で手順が止まったとき、最初に見る場所を一つだけ残す。';
  const invented = runDeterministicAudit({
    tweets: ['画面の前で手順が止まったとき、成果が80%伸びる場所を一つだけ残す。', 'ページにある確認手順を一度だけ出す。']
  }, { lang: 'ja', accountState: free, recentTexts: [], brandKnowledge: { verifiedPricing: [], verifiedClaims: [] } });
  assert.equal(invented.ok, false);
  assert.equal(invented.reasons.some(reason => reason.startsWith('ungrounded_number')), true);

  const copied = runDeterministicAudit({
    tweets: [recent, 'その続きで、ページに書いてある確認だけを出す。']
  }, { lang: 'ja', accountState: free, recentTexts: [recent], brandKnowledge: { verifiedPricing: [], verifiedClaims: [] } });
  assert.equal(copied.ok, false);
  assert.equal(copied.reasons.includes('too_similar_to_recent') || copied.reasons.includes('hook_too_similar'), true);
});

test('a promo body is accepted before the disclosure and rejected if the disclosure is required too early', () => {
  const paid = { subscription: 'premium', singleOnly: false, postShape: 'single', maxChars: 900, followers: 40, following: 10 };
  const body = '画面の前で手順が止まったとき、最初に確認する場所を一つだけ残して、その場で直せる範囲を一文で書く。次に見る順番も同じ文の中に残す。最後に戻る場所も書く。';
  const context = {
    lang: 'ja',
    accountState: paid,
    portfolioPlan: { allowPromoUrl: true },
    recentTexts: [],
    brandKnowledge: { verifiedClaims: [], verifiedPricing: [] }
  };
  assert.equal(runDeterministicAudit({ tweets: [body] }, { ...context, auditBodyOnly: true }).ok, true);
  assert.equal(runDeterministicAudit({ tweets: [body] }, context).reasons.includes('compliance:promotion_disclosure_missing'), true);
  const attached = attachPromoReply([body], 'ja', 'https://example.com/pricing');
  const after = runDeterministicAudit({ tweets: attached }, context);
  assert.equal(after.ok, true);
  assert.match(attached[0], /^【PR】/);
  assert.match(attached[1], /https:\/\/example.com\/pricing/);
});

test('a short free-account promo body uses the same length floor before and after the disclosure', () => {
  const body = '画面の前で手順が止まったとき、最初に確認する場所を一つだけ残す。';
  const context = {
    lang: 'ja',
    accountState: free,
    portfolioPlan: { allowPromoUrl: true },
    recentTexts: [],
    brandKnowledge: { verifiedClaims: [], verifiedPricing: [] }
  };
  const early = runDeterministicAudit({ tweets: [body] }, { ...context, auditBodyOnly: true });
  assert.equal(early.reasons.includes('too_short'), true);
  const longEnough = '画面の前で手順が止まったとき、最初に確認する場所を一つだけ残して、その場で直せる範囲を一文で書く。次に見る順番も同じ文の中に残し、最後に戻る場所も書く。';
  assert.equal(runDeterministicAudit({ tweets: [longEnough] }, { ...context, auditBodyOnly: true }).reasons.includes('too_short'), false);
});

test('a promo body keeps room for the disclosure inside the character limit', () => {
  const tight = 'あ'.repeat(138);
  const context = {
    lang: 'ja',
    accountState: free,
    portfolioPlan: { allowPromoUrl: true },
    recentTexts: [],
    brandKnowledge: { verifiedClaims: [], verifiedPricing: [] }
  };
  const early = runDeterministicAudit({ tweets: [tight] }, { ...context, auditBodyOnly: true });
  assert.equal(early.reasons.includes('too_long_for_disclosure'), true);
  const fitted = 'あ'.repeat(135);
  assert.equal(runDeterministicAudit({ tweets: [fitted] }, { ...context, auditBodyOnly: true }).reasons.includes('too_long_for_disclosure'), false);
  const attached = attachPromoReply([fitted], 'ja', 'https://example.com/pricing');
  assert.equal(attached[0].length <= free.maxChars, true);
});

test('an allowed price does not permit an unrelated digit', () => {
  const bad = verifyNumericGrounding('残りは4件です。', {
    brandKnowledge: { verifiedPricing: ['4,980円'], verifiedClaims: [] },
    accountState: {}
  });
  assert.deepEqual(bad, ['4件']);
  const kept = verifyNumericGrounding('料金は4,980円です。', {
    brandKnowledge: { verifiedPricing: ['4,980円'], verifiedClaims: [] },
    accountState: {}
  });
  assert.deepEqual(kept, []);
});

test('a plain two-part draft with no new number passes the gate', () => {
  const result = runDeterministicAudit({
    tweets: ['画面の前で手順が止まったとき、最初に見る場所を一つだけ残す。', 'その続きで、ページに書いてある確認だけを出す。']
  }, { lang: 'ja', accountState: free, recentTexts: ['別の日の別の話を残す。'], brandKnowledge: { verifiedPricing: [], verifiedClaims: [] } });
  assert.deepEqual(result.reasons, []);
});
