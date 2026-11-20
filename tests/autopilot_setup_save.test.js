'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const storedUsers = new Map();
const fakeDb = {
  collection(name) {
    assert.equal(name, 'saas_users');
    return {
      doc(id) {
        return {
          async set(data, options) {
            const prev = options && options.merge ? (storedUsers.get(id) || {}) : {};
            storedUsers.set(id, { ...prev, ...data });
          },
          async get() {
            return { exists: storedUsers.has(id), data: () => storedUsers.get(id) };
          }
        };
      }
    };
  }
};

let currentSession = { userId: 'wiz-user-1' };
stub('../src/firestore', { db: fakeDb });
stub('../src/auth_service', { resolveSessionUser: async () => currentSession });
stub('../src/stripe_billing_helpers', {});
stub('../src/ai_deliberation_council', {});
stub('../src/wise_payment', {});
stub('../src/official_api_client', {});
stub('../src/collective_intelligence', {});
stub('../src/autonomous_promo_ai', {
  isValidTimeZone: tz => tz === 'Asia/Tokyo' || tz === 'America/New_York'
});

const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('POST /api/autopilot/save-setup validates session, inputs, and persists setup state', async () => {
  const postRoutes = new Map();
  registerHybridSaasRoutes({
    post(path, handler) { postRoutes.set(path, handler); },
    get() {}
  }, { runWorker: false });

  const handler = postRoutes.get('/api/autopilot/save-setup');
  assert.equal(typeof handler, 'function');

  currentSession = null;
  let res = createRes();
  await handler({ body: { targetUrl: 'https://example.com' } }, res);
  assert.equal(res.statusCode, 401);

  currentSession = { userId: 'wiz-user-1' };
  res = createRes();
  await handler({ body: { targetUrl: 'javascript:alert(1)', userPrompt: '' } }, res);
  assert.equal(res.statusCode, 400);

  res = createRes();
  await handler({ body: { targetUrl: '', userPrompt: '' } }, res);
  assert.equal(res.statusCode, 400);

  res = createRes();
  await handler({
    body: {
      targetUrl: '',
      userPrompt: '実務ログを誠実に発信する',
      lang: 'ja',
      timeZone: 'Asia/Tokyo',
      country: 'JP'
    }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(storedUsers.get('wiz-user-1').userPrompt, '実務ログを誠実に発信する');
  assert.equal(storedUsers.get('wiz-user-1').aiTargetLang, 'ja');
  assert.equal(storedUsers.get('wiz-user-1').scheduleTimeZone, 'Asia/Tokyo');
  assert.equal(storedUsers.get('wiz-user-1').targetCountry, 'JP');
});

test('modals stay open on outside click and 5-step onboarding wizard renders all steps cleanly', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dashboard = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const funnel = fs.readFileSync(path.join(__dirname, '../views/funnel_index.html'), 'utf8');

  assert.equal(funnel.includes('onclick="if(event.target===this)closeAuthModal()"'), false);
  assert.equal(funnel.includes('onclick="if(event.target===this)closeUnlockModal()"'), false);
  assert.equal(dashboard.includes('onclick="handlePlanModalBackdrop(event)"'), false);
  assert.equal(dashboard.includes('e.target.id === \'planModalOverlay\''), false);
  assert.equal(dashboard.includes('id="onboardingWizardOverlay"'), true);
  for (let i = 1; i <= 5; i++) {
    assert.equal(dashboard.includes(`id="wizStep_${i}"`), true, `wizStep_${i}`);
  }
  const wizStatePos = dashboard.indexOf('var wizState =');
  const setLangCallPos = dashboard.indexOf('setLanguage(currentLang);');
  assert.ok(wizStatePos > 0 && setLangCallPos > wizStatePos);
  assert.equal(dashboard.includes('id="trialActivationBanner"'), true);
  assert.equal(dashboard.includes('id="cockpitLockedBody"'), true);
  assert.equal(dashboard.includes('id="wizSuggestionsBox"'), true);
  assert.equal(dashboard.includes('id="wizPrimaryCtaBtn"'), true);
  assert.equal(dashboard.includes('h-[100dvh] sm:w-[600px] sm:h-[680px]'), true);
  assert.equal(dashboard.includes('id="btnOpenOnboardingWizard"'), false);
  assert.equal(dashboard.includes('id="cockpitLockBar"'), false);
  assert.match(dashboard, /14日間の無料トライアルで始めましょう/);
  assert.match(dashboard, /管理画面からいつでも変更できます/);
  assert.match(dashboard, /投稿スケジュール・履歴/);
});

test('suggestAccountPersonas extracts site & account attributes and POST /api/autopilot/suggest-personas responds cleanly', async () => {
  const { suggestAccountPersonas } = require('../src/persona_suggestion_helper');
  const resSuggested = await suggestAccountPersonas({
    targetUrl: 'https://example.com',
    userData: { xUsername: 'acme_official', name: 'Acme Official' },
    liveAccount: { ok: true, username: 'acme_official', name: 'Acme Official', followers: 42 },
    lang: 'ja',
    canUseAi: () => false,
    extractBrand: async () => ({
      ok: true,
      pageSummary: { title: 'Acme Cloud', description: '勤怠と給与をまとめるクラウド' },
      brandKnowledge: {
        productName: 'Acme Cloud',
        category: '労務SaaS',
        oneLineMechanism: '勤怠と給与を自動連携',
        icpSummary: '中小企業のバックオフィス担当',
        verifiedClaims: [{ painScene: '毎月の締め作業に時間がかかる', mechanism: 'CSV手入力をなくす' }]
      }
    })
  });
  assert.equal(resSuggested.ok, true);
  assert.equal(resSuggested.analyzedSite.productName, 'Acme Cloud');
  assert.equal(resSuggested.accountProfile.handle, 'acme_official');
  assert.equal(resSuggested.suggestions.length, 4);
  assert.ok(resSuggested.suggestions.some(s => s.promptText.includes('Acme Cloud')));

  const postRoutes = new Map();
  registerHybridSaasRoutes({
    post(path, handler) { postRoutes.set(path, handler); },
    get() {}
  }, { runWorker: false });
  const handler = postRoutes.get('/api/autopilot/suggest-personas');
  assert.equal(typeof handler, 'function');

  currentSession = null;
  let res = createRes();
  await handler({ body: { targetUrl: 'https://example.com' } }, res);
  assert.equal(res.statusCode, 401);

  currentSession = { userId: 'wiz-user-1' };
  res = createRes();
  await handler({ body: { targetUrl: 'ftp://bad.example' } }, res);
  assert.equal(res.statusCode, 400);
});

test('POST /api/autopilot/save-setup preserves existing targetUrl when autonomousMode=true and preserveUrl=true', async () => {
  storedUsers.set('wiz-user-auto', {
    userId: 'wiz-user-auto',
    targetUrl: 'https://keep-me.example.com',
    xBio: '実務の運用メモを公開するエンジニア',
    isHumanOverride: true
  });
  const postRoutes = new Map();
  registerHybridSaasRoutes({
    post(path, handler) { postRoutes.set(path, handler); },
    get() {}
  }, { runWorker: false });
  const handler = postRoutes.get('/api/autopilot/save-setup');
  currentSession = { userId: 'wiz-user-auto' };
  const res = createRes();
  await handler({ body: { autonomousMode: true, preserveUrl: true, targetUrl: '', userPrompt: '' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.targetUrl, 'https://keep-me.example.com');
  assert.equal(storedUsers.get('wiz-user-auto').targetUrl, 'https://keep-me.example.com');
  assert.ok(res.body.userPrompt);
});
