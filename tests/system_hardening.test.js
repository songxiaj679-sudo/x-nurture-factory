'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hmacMatches } = require('../src/webhook_signatures');
const { runDeterministicAudit } = require('../src/draft_verifier');
const { bindOfficialCreds, customerFacingReason } = require('../src/autonomous_promo_ai');

const shop = fs.readFileSync(path.join(__dirname, '../src/shop.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../src/hybrid_saas_routes.js'), 'utf8');

test('weekly report route requires admin auth and webhooks fail closed', () => {
  assert.match(shop, /app\.post\('\/api\/admin\/trigger-weekly-report', requireAdminAuth,/);
  assert.doesNotMatch(shop, /host\.startsWith\('localhost'\)/);
  assert.doesNotMatch(shop, /ADMIN_PASS\.toUpperCase\(\)/);
  assert.match(shop, /hmacMatches\(secret, req\.rawBody, req\.headers\.hmac, 'sha512'\)/);
  assert.match(shop, /hmacMatches\(secret, req\.rawBody, req\.headers\['x-signature'\], 'sha256'\)/);
  assert.equal(hmacMatches('', Buffer.from('{}'), 'abc', 'sha512'), false);
  assert.equal(hmacMatches('secret', Buffer.from('{}'), '', 'sha512'), false);
  const body = Buffer.from('{"status":"paid"}');
  const good = crypto.createHmac('sha512', 'secret').update(body).digest('hex');
  assert.equal(hmacMatches('secret', body, good, 'sha512'), true);
  assert.equal(hmacMatches('secret', body, good.replace(/a/g, 'b'), 'sha512'), false);
  const kyc = crypto.createHmac('sha256', 'didit').update(body).digest('hex');
  assert.equal(hmacMatches('didit', body, kyc, 'sha256'), true);
  assert.equal(hmacMatches('didit', body, 'deadbeef', 'sha256'), false);
});

test('stored drafts are audited before publish and paused AI jobs leave pending', () => {
  assert.match(routes, /pre_publish_audit_failed:/);
  assert.match(routes, /status: 'cancelled', error: 'paused', cancelReason: 'autopilot_paused'/);
  assert.match(routes, /!job\.isHumanOverride[\s\S]{0,180}consent_required/);
  const broken = runDeterministicAudit({
    tweets: ['The rule is input the URL.', 'Feed one URL and let it create schedule for the account after the page is saved.']
  }, {
    lang: 'en',
    accountState: { maxChars: 270, postShape: 'thread', singleOnly: false, subscription: 'free' },
    recentTexts: [],
    brandKnowledge: { verifiedPricing: [], verifiedClaims: [] }
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.reasons.includes('too_short'), true);
  assert.equal(broken.reasons.includes('ai_slop'), true);
  const paraphrase = runDeterministicAudit({
    tweets: ['確認場所を先に残すと、次の判断が同じ型で続く。これが核心です。一般論の前置きは足さない。']
  }, { lang: 'ja', accountState: { maxChars: 280, postShape: 'single', singleOnly: true } });
  assert.equal(paraphrase.reasons.includes('ai_slop'), true);
});

test('official credentials keep the numeric X id and customer reason follows uiLang', () => {
  const creds = bindOfficialCreds({ userId: 'saas-user', token: 'x' }, 'saas-user', { twitterId: '1234567890' });
  assert.equal(creds.userId, '1234567890');
  assert.equal(creds.saasUserId, 'saas-user');
  assert.equal(creds.id, 'saas-user');
  const numeric = bindOfficialCreds({ userId: '99887766' }, 'saas-user', { twitterId: '111' });
  assert.equal(numeric.userId, '99887766');
  const reason = customerFacingReason({
    hypothesis: { who: '法人の担当者', why: '今月の確認', proof: 'ページの手順' }
  }, 'en');
  assert.match(reason, /Written from verified facts|did not state/);
  assert.doesNotMatch(reason, /誰に:/);
  const promo = fs.readFileSync(path.join(__dirname, '../src/autonomous_promo_ai.js'), 'utf8');
  assert.match(promo, /customerFacingReason\(choice, String\(user\.uiLang \|\| accountState\.lang \|\| 'ja'\)/);
});
