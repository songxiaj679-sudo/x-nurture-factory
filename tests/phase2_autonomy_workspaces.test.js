'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, evaluateTrialEligibility, trialNotice } = require('../src/trial_abuse_guard');
const { applyAutonomousStrategy, proposeAutonomousStrategy } = require('../src/autonomous_strategy_architect');
const { autoReplyPhase2Allowed, detectOptOut, replyAllowedNow, replySentToday, composeInboundReply } = require('../src/auto_reply_policy');
const { runOfficialAutonomousEngagement } = require('../src/official_api_client');

function claimDb(existing) {
  return {
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              return { exists: Object.prototype.hasOwnProperty.call(existing, id), data: () => existing[id] };
            }
          };
        }
      };
    }
  };
}

test('the same immutable X id cannot start a second trial after a username change', async () => {
  assert.equal(normalizeEmail('u.ser+shop@gmail.com'), 'user@gmail.com');
  const db = claimDb({ x_178291000: { firstUserId: 'old-login', handle: 'oldname' } });
  const decision = await evaluateTrialEligibility({ db, userId: 'new-login', twitterId: '178291000', email: 'fresh@example.com' });
  assert.equal(decision.allowTrial, false);
  assert.match(trialNotice({ handle: 'oldname' }), /学習した/);
  assert.doesNotMatch(decision.notice, /不正|悪用/);
});

test('an explicit strategy lock is not replaced by autonomous setup', () => {
  const proposal = proposeAutonomousStrategy({ bio: '公開プロフィールの説明', lang: 'ja' });
  assert.equal(applyAutonomousStrategy({ strategyLockByUser: true, userPrompt: '' }, proposal), null);
  assert.equal(applyAutonomousStrategy({ isHumanOverride: true }, proposal), null);
  assert.ok(applyAutonomousStrategy({ userPrompt: '' }, proposal).userPrompt);
});

test('phase 2 refuses an unconfirmed label, an opt-out, and a second reply', async () => {
  const user = {
    planStatus: 'active',
    planId: 'pro',
    tierLevel: 2,
    xUsername: 'VeloxSystemsHQ',
    autoReplySettings: { enabled: true, mode: 'auto_mentions', xAutomatedLabelConfirmed: false }
  };
  const creds = { oauth2AccessToken: 'token', username: 'VeloxSystemsHQ' };
  const env = { X_AUTO_REPLY_PHASE2_ENABLED: 'true', OFFICIAL_API_ALLOW_PAID_CUSTOMERS: 'true' };
  assert.equal(autoReplyPhase2Allowed(user, creds, env).reason, 'automated_label_unconfirmed');
  user.autoReplySettings.xAutomatedLabelConfirmed = true;
  assert.equal(autoReplyPhase2Allowed(user, creds, env).allowed, true);
  assert.equal(detectOptOut('返信不要です'), true);
  assert.equal(replyAllowedNow({ authorId: '99', selfTwitterId: '1', lastReplyAt: new Date().toISOString(), sentToday: 0, dailyCap: 3 }).reason, 'cooldown');
  const engagement = await runOfficialAutonomousEngagement();
  assert.equal(engagement.reason, 'x_approval_required');
});

test('a new local date resets the daily auto-reply count and each draft stays distinct', async () => {
  const user = { scheduleTimeZone: 'Asia/Tokyo', autoReplySentDate: '2026-11-18', autoReplySentCount: 5 };
  assert.equal(replySentToday(user, new Date('2026-11-18T02:00:00.000Z')).sentToday, 5);
  const nextDay = replySentToday(user, new Date('2026-11-18T15:00:00.000Z'));
  assert.equal(nextDay.sentDate, '2026-11-19');
  assert.equal(nextDay.sentToday, 0);
  let call = 0;
  const drafts = ['公開ページにある手順だけを短く案内します。', '相手の質問に、確認できた範囲だけで答えます。'];
  const completeText = async () => ({ text: drafts[call++] });
  const first = await composeInboundReply({ user: { brandContextNotes: '手順を公開している' }, mention: { text: '設定はどこですか' }, recentReplies: [], completeText });
  const second = await composeInboundReply({ user: { brandContextNotes: '手順を公開している' }, mention: { text: '別の質問です' }, recentReplies: [first.text], completeText });
  assert.notEqual(first.text, second.text);
  const failed = await composeInboundReply({ completeText: async () => { throw new Error('draft failed'); } });
  assert.equal(failed.reason, 'skipped_draft_error');
});

test('workspaces keep billing and memory on the selected account', async () => {
  const stores = {
    'login_owners/owner-1': { workspaceIds: ['owner-1', 'WS-b'] },
    'saas_users/owner-1': { ownerUid: 'owner-1', planStatus: 'active', planId: 'pro' },
    'saas_users/WS-b': { ownerUid: 'owner-1', planStatus: 'free', planId: 'free' },
    'saas_users/WS-foreign': { ownerUid: 'someone-else', planStatus: 'active' }
  };
  function stub(modulePath, exports) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  const fakeDb = {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() { return { exists: Boolean(stores[key]), data: () => stores[key] }; },
            async set(data) { stores[key] = { ...(stores[key] || {}), ...data }; }
          };
        }
      };
    }
  };
  let session = { userId: 'owner-1', ownerUid: 'owner-1' };
  stub('../src/firestore', { db: fakeDb });
  stub('../src/auth_service', { resolveSessionUser: async () => session });
  stub('../src/official_api_client', {});
  stub('../src/autonomous_promo_ai', {});
  stub('../src/ai_deliberation_council', {});
  stub('../src/wise_payment', {});
  stub('../src/collective_intelligence', {});
  const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
  const routes = new Map();
  registerHybridSaasRoutes({ post(path, handler) { routes.set('POST ' + path, handler); }, get(path, handler) { routes.set('GET ' + path, handler); } }, { runWorker: false });
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, cookie() {} };
  await routes.get('POST /api/workspaces/switch')({ body: { workspaceId: 'WS-foreign' } }, res);
  assert.equal(res.statusCode, 403);
  const ok = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, cookie() {} };
  await routes.get('POST /api/workspaces/switch')({ body: { workspaceId: 'WS-b' } }, ok);
  assert.equal(ok.body.planStatus, 'free');
  assert.equal(stores['saas_users/owner-1'].planStatus, 'active');
});
