const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const docs = new Map();
function ref(collection, id) {
  const key = `${collection}/${id}`;
  return {
    async get() { return { exists: docs.has(key), data: () => docs.get(key) }; },
    async set(data, options) {
      const prev = options && options.merge ? (docs.get(key) || {}) : {};
      docs.set(key, { ...prev, ...data });
    }
  };
}
stub('../src/firestore', { db: { collection(name) { return { doc(id) { return ref(name, id); } }; } } });
stub('../src/auth_service', { resolveSessionUser: async (_db, req) => req.sessionUser || null });
stub('../src/official_api_client', { decryptCredentials: () => ({ id: '1' }), sanitizePostOrReplyText: text => text });
stub('../src/operated_accounts', { officialApiOperationAllowed: () => true });
stub('../src/visual_card', { renderVisualCardPng: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
stub('../src/autonomous_promo_ai', {
  isValidTimeZone: () => true,
  launchAutopilotCampaign: async () => ({}),
  prepareNextPost: async () => ({}),
  ensureNextPost: async () => ({}),
  reDeliberateAutopilotJobs: async () => ({}),
  reThinkSingleJob: async () => ({}),
  generateInstantPreviewPosts: async () => ({}),
  fetchUrlSummary: async () => ({}),
  dateAtTimeInZone: () => new Date(),
  harvestTweetMetricsAndEvolveKnowledge: async () => ({}),
  generateWeeklyCouncilReport: async () => ({}),
  cancelOtherPendingJobs: async () => ({}),
  cancelNonManualPendingJobs: async () => ({})
});

const { registerHybridSaasRoutes, visualCardUploadPlan } = require('../src/hybrid_saas_routes');
const { selectPlaybookByPerformance } = require('../src/bandit_optimization_engine');
const routes = { get: new Map(), post: new Map() };
registerHybridSaasRoutes({
  get(pathName, handler) { routes.get.set(pathName, handler); },
  post(pathName, handler) { routes.post.set(pathName, handler); }
}, { runWorker: false });

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; }
  };
}

const card = {
  eligible: true,
  title: '文体と宣伝の混ぜ方',
  badge: 'VELOX AI',
  leftText: '反応が安定する前の宣伝',
  rightText: '口調と理由が合うか'
};

test('visual card preview requires the owner and returns a png', async () => {
  docs.set('autopilot_jobs/job-a', { userId: 'owner', status: 'pending', visualCard: card, updatedAt: { seconds: 5 } });
  const png = routes.get.get('/api/autopilot/jobs/:jobId/visual-card.png');
  const anon = response();
  await png({ params: { jobId: 'job-a' }, sessionUser: null }, anon);
  assert.equal(anon.statusCode, 401);
  const stranger = response();
  await png({ params: { jobId: 'job-a' }, sessionUser: { userId: 'other' } }, stranger);
  assert.equal(stranger.statusCode, 403);
  const owner = response();
  await png({ params: { jobId: 'job-a' }, sessionUser: { userId: 'owner' } }, owner);
  assert.equal(owner.statusCode, 200);
  assert.equal(owner.headers['content-type'], 'image/png');
  assert.equal(owner.headers['cache-control'], 'private, max-age=300');
  assert.equal(Buffer.from(owner.body).slice(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('visual card toggle keeps the card and a disabled card is not uploaded', async () => {
  docs.set('autopilot_jobs/job-b', { userId: 'owner', status: 'pending', visualCard: { ...card } });
  const toggle = routes.post.get('/api/autopilot/jobs/:jobId/visual-card');
  const res = response();
  await toggle({ params: { jobId: 'job-b' }, sessionUser: { userId: 'owner' }, body: { enabled: false } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.visualCard.userDisabled, true);
  assert.equal(res.body.visualCard.reason, 'disabled_by_user');
  assert.equal(res.body.visualCard.title, '文体と宣伝の混ぜ方');
  const again = response();
  await toggle({ params: { jobId: 'job-b' }, sessionUser: { userId: 'owner' }, body: { enabled: true } }, again);
  assert.equal(again.body.visualCard.userDisabled, false);
  assert.equal(again.body.visualCard.title, '文体と宣伝の混ぜ方');
  assert.equal(again.body.visualCard.leftText, '反応が安定する前の宣伝');
  const previous = process.env.X_MEDIA_WRITE_ENABLED;
  process.env.X_MEDIA_WRITE_ENABLED = 'true';
  const plan = visualCardUploadPlan({ visualCard: res.body.visualCard });
  process.env.X_MEDIA_WRITE_ENABLED = previous;
  assert.equal(plan.upload, false);
  assert.equal(plan.visualCardAttached, false);
  const source = fs.readFileSync(path.join(__dirname, '../src/hybrid_saas_routes.js'), 'utf8');
  assert.match(source, /const cardPlan = visualCardUploadPlan\(job\);/);
  assert.match(source, /visualCardAttached/);
  assert.match(source, /generation_traces/);
});

test('24h bookmark rate selects the stronger playbook unless it was just used', () => {
  const playbooks = [{ id: 'pb_saved', topic: '保存される確認' }, { id: 'pb_flat', topic: '反応のない説明' }, { id: 'pb_fresh', topic: 'まだ試していない確認' }];
  const frozen = (id, bookmarks, postedAt) => ({
    focusPlaybookId: id,
    postedAt,
    metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks, replies: 0, likes: 0 }
  });
  const strong = selectPlaybookByPerformance(playbooks.slice(0, 2), [
    frozen('pb_flat', 0, '2026-11-19T00:00:00.000Z'),
    frozen('pb_saved', 12, '2026-11-18T00:00:00.000Z')
  ], { random: () => 0.5 });
  assert.equal(strong.id, 'pb_saved');
  assert.equal(strong.reason, 'exploit_24h');
  assert.equal(JSON.stringify(strong).includes('exploit_24h'), false);
  const recent = selectPlaybookByPerformance(playbooks, [
    frozen('pb_saved', 12, '2026-11-19T00:00:00.000Z'),
    frozen('pb_flat', 0, '2026-11-18T00:00:00.000Z')
  ], { random: () => 0.5 });
  assert.notEqual(recent.id, 'pb_saved');
});

test('dashboard visual card copy stays separated by language', () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  assert.match(html, /図解カードプレビュー（1200×675）/);
  assert.match(html, /Visual card preview \(1200×675\)/);
  assert.match(html, /図解を外す/);
  assert.match(html, /Remove card/);
  assert.match(html, /図解を付ける/);
  assert.match(html, /Attach card/);
  assert.match(html, /図解カード付/);
  assert.match(html, /With visual card/);
  assert.match(html, /Xを再連携すると、この図解カードが投稿時に自動添付されます。/);
  assert.match(html, /Reconnect X once to automatically attach this visual card when posting\./);
  const preview = html.slice(html.indexOf('function renderPendingVisualCard'), html.indexOf('function renderJobCard'));
  assert.equal(preview.includes("isEn ? '図解"), false);
  assert.equal(preview.includes("? 'Visual card preview"), true);
});
