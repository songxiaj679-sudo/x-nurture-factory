'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function stub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => { if (prev) require.cache[filename] = prev; else delete require.cache[filename]; };
}

test('editorial_split uses a full-bleed white card and larger type', async () => {
  const { planVisualCard, cardMarkup, renderVisualCardPng } = require('../src/visual_card');
  const japanese = planVisualCard({
    portfolioRole: 'utility_save',
    lang: 'ja',
    brandKnowledge: { productName: 'VELOX' },
    focusPlaybook: { id: 'pb_3', topic: '文体と宣伝', commonMistake: '宣伝を先に足す', checkCriteria: '確認を先に残す', boundaryCondition: 'ページ外は使わない' }
  });
  const english = planVisualCard({
    portfolioRole: 'utility_save',
    lang: 'en',
    brandKnowledge: { productName: 'VELOX' },
    focusPlaybook: { id: 'pb_3', topic: 'Voice match', commonMistake: 'A new tone appears', checkCriteria: 'The voice still matches', boundaryCondition: 'Stop when the page is missing' }
  });
  const jaMarkup = JSON.stringify(cardMarkup(japanese));
  const enMarkup = JSON.stringify(cardMarkup(english));
  assert.match(jaMarkup, /#FFFFFF/);
  assert.match(jaMarkup, /#2563EB/);
  assert.equal(jaMarkup.includes('#F5F6F8'), false);
  assert.match(jaMarkup, /"fontSize":32/);
  assert.match(jaMarkup, /"fontSize":24/);
  assert.match(enMarkup, /"fontSize":28/);
  assert.match(enMarkup, /"fontSize":22/);
  for (const plan of [japanese, english]) {
    const png = await renderVisualCardPng(plan);
    assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 675);
  }
});

test('suspension handling pauses once and skips placeholder mail', async () => {
  const { handleSuspendedXAccount } = require('../src/account_suspension_care');
  const docs = new Map();
  const cancelled = [];
  const sent = [];
  function ref(id) {
    return {
      async get() { return { exists: docs.has(id), data: () => docs.get(id) }; },
      async set(data, opts) { docs.set(id, opts && opts.merge ? { ...(docs.get(id) || {}), ...data } : data); }
    };
  }
  const db = { collection() { return { doc(id) { return ref(id); } }; } };
  docs.set('owner', { email: 'owner@example.com', xUsername: 'paused', uiLang: 'en' });
  await handleSuspendedXAccount({
    db, userId: 'owner', reason: 'The user used for authentication is suspended',
    cancelPendingJobsImpl: async (id) => { cancelled.push(id); },
    sendMailImpl: async (mail) => { sent.push(mail.subject); }
  });
  await handleSuspendedXAccount({
    db, userId: 'owner', reason: 'account is suspended',
    cancelPendingJobsImpl: async (id) => { cancelled.push(id); },
    sendMailImpl: async () => { sent.push('again'); }
  });
  const saved = docs.get('owner');
  assert.equal(saved.autopilotPaused, true);
  assert.equal(saved.xLinkHealthStatus, 'suspended');
  assert.equal(saved.suspendedNoticeEmailResult, 'skipped');
  assert.equal(sent.length, 0);
  assert.equal(cancelled.length, 2);
  docs.set('mail', { email: 'owner@veloxpostapp.com', xUsername: 'live', uiLang: 'ja' });
  await handleSuspendedXAccount({
    db, userId: 'mail', reason: 'User has been suspended',
    cancelPendingJobsImpl: async () => {},
    sendMailImpl: async (mail) => { sent.push(mail.subject); }
  });
  await handleSuspendedXAccount({
    db, userId: 'mail', reason: 'User has been suspended',
    cancelPendingJobsImpl: async () => {},
    sendMailImpl: async () => { sent.push('again'); }
  });
  assert.deepEqual(sent, ['Xの凍結を検知したため、VeloxPost Cloudの自動運用を停止しました']);
  assert.ok(docs.get('mail').suspendedNoticeSentAt);
});

test('suspended launch and status stay bilingual and reconnect clears only the freeze', async () => {
  const docs = new Map();
  function docRef(key) {
    return {
      async get() { return { exists: docs.has(key), data: () => docs.get(key) }; },
      async set(data, opts) { docs.set(key, opts && opts.merge ? { ...(docs.get(key) || {}), ...data } : data); },
      async update(data) { docs.set(key, { ...(docs.get(key) || {}), ...data }); }
    };
  }
  function query(name) {
    const api = { where() { return api; }, limit() { return api; }, orderBy() { return api; }, doc(id) { return docRef(`${name}/${id}`); }, async get() { return { docs: [], empty: true }; } };
    return api;
  }
  const restoreDb = stub('../src/firestore', { db: { collection(name) { return query(name); } } });
  const restoreAuth = stub('../src/auth_service', { resolveSessionUser: async (_db, req) => req.sessionUser || null });
  const routesPath = require.resolve('../src/hybrid_saas_routes');
  delete require.cache[routesPath];
  try {
    const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
    const routes = { post: new Map(), get: new Map() };
    registerHybridSaasRoutes({
      post(path, handler) { routes.post.set(path, handler); },
      get(path, handler) { routes.get.set(path, handler); }
    }, { runWorker: false });
    docs.set('saas_users/owner', {
      xLinkHealthStatus: 'suspended',
      autopilotPaused: true,
      xUsername: 'Shahidabano19',
      planId: 'pro',
      planStatus: 'active',
      targetUrl: 'https://keep.example',
      aiTargetLang: 'en',
      scheduleTimeZone: 'Asia/Tokyo'
    });
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.post.get('/api/autopilot/toggle-pause')({
      sessionUser: { userId: 'owner' }, body: { paused: false, uiLang: 'en' }, headers: {}, query: {}
    }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'account_suspended');
    assert.match(res.body.error, /Reconnect/);
    assert.equal(docs.get('saas_users/owner').targetUrl, 'https://keep.example');
    const status = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.get.get('/api/autopilot/status')({ sessionUser: { userId: 'owner' }, headers: {}, query: {} }, status);
    assert.equal(status.body.xLinkHealthStatus, 'suspended');
  } finally {
    restoreAuth();
    restoreDb();
    delete require.cache[routesPath];
  }
  const auth = fs.readFileSync(path.join(__dirname, '../src/twitter_auth.js'), 'utf8');
  const block = auth.slice(auth.indexOf('const userUpdate = {'), auth.indexOf('if (!isSecondaryWorkspace)'));
  assert.match(block, /xLinkHealthStatus: 'ok'/);
  assert.match(block, /suspendedNoticeSentAt: null/);
  assert.equal(block.includes('targetUrl'), false);
  assert.equal(block.includes('aiTargetLang'), false);
  assert.equal(block.includes('scheduleTimeZone'), false);
});

test('writer and critic calls share one monthly counter and roll over', async () => {
  const { recordTenantLlmBreakdown } = require('../src/tenant_ai_budget');
  const docs = new Map([['saas_users/owner', { aiMonthlyUsage: { monthKey: '2026-10', llmCalls: 9, writerCalls: 8, criticCalls: 1, crawlPages: 3 } }]]);
  const db = { collection() { return { doc() { return {
    async get() { return { exists: true, data: () => docs.get('saas_users/owner') }; },
    async set(data, opts) { docs.set('saas_users/owner', opts && opts.merge ? { ...docs.get('saas_users/owner'), ...data } : data); }
  }; } }; } };
  const first = await recordTenantLlmBreakdown({ db, userId: 'owner', writerCalls: 1, criticCalls: 2, now: new Date('2026-11-20T00:00:00Z') });
  assert.equal(first.usage.writerCalls, 1);
  assert.equal(first.usage.criticCalls, 2);
  assert.equal(first.usage.llmCalls, 3);
  assert.equal(first.usage.monthKey, '2026-11');
  const second = await recordTenantLlmBreakdown({ db, userId: 'owner', writerCalls: 1, criticCalls: 1, now: new Date('2026-11-21T00:00:00Z') });
  assert.equal(second.usage.llmCalls, 5);
  assert.equal(second.usage.writerCalls, 2);
  assert.equal(second.usage.criticCalls, 3);
});

test('the suspended banner has both languages', () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  assert.match(html, /id="suspendedAccountBanner"/);
  assert.match(html, /Auto-posting paused because the connected X account is suspended/);
  assert.match(html, /連携中の X アカウントの凍結を検知したため、自動運用を停止しました/);
  assert.match(html, /checkIsEn\(\)/);
  assert.match(html, /Reconnect X account/);
  assert.match(html, /X連携を再設定する/);
});
