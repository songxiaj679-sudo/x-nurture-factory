const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanPlaybook } = require('../src/lp_knowledge_extractor');

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

test('english playbook fields stay complete past the old 80 character clip', () => {
  const situation = 'Check the registered page before adding a claim, and keep the next decision tied to a source you can open.';
  const mistake = 'Filling the gap with a stronger phrase before the page gives you a source you can show.';
  const tradeoff = 'Waiting for a source slows the first draft, and it keeps the claim tied to something the reader can open.';
  const check = 'The sentence still matches the registered page, and it does not add a result the page never states.';
  const boundary = 'Skip this check when the reader already asked for the page and the wording stays inside that page.';
  assert.ok(situation.length > 80 && situation.length <= 180);
  const card = cleanPlaybook({
    topic: 'Keep the claim on the page.',
    readerSituation: situation,
    commonMistake: mistake,
    concreteTradeoff: tradeoff,
    checkCriteria: check,
    boundaryCondition: boundary
  }, 0, `${situation} ${mistake} ${tradeoff} ${check} ${boundary}`);
  assert.equal(card.readerSituation, situation);
  assert.equal(card.commonMistake, mistake);
  assert.equal(card.checkCriteria, check);
  assert.equal(card.readerSituation.endsWith('.'), true);
});

const writerCalls = [];
let profileDrafts = 0;
stub('../src/llm_router', {
  completeWriter: async (options) => {
    writerCalls.push(options.schemaName);
    if (options.schemaName === 'profile_checklist') {
      const input = JSON.parse(options.prompt);
      profileDrafts += 1;
      if (profileDrafts > 1) {
        return { parsed: { displayName: '名前', bio: `確認メモ ${input.targetUrl}`, pin: '95%の人が保存します。出典のない比率です。', currentBioReview: 'Review in English only.', pinNote: 'Paste it yourself.' } };
      }
      return {
        parsed: {
          displayName: 'VELOX｜確認メモ',
          bio: `登録ページの範囲で、今日の確認を短く残します。 ${input.targetUrl}`,
          pin: '登録ページで確認できる手順だけを残します。\n\n出典を開けない数字は入れません。',
          currentBioReview: 'The current bio can be shortened before it is pasted.',
          pinNote: 'Paste this on X yourself. Nothing is pinned automatically.'
        }
      };
    }
    return {
      parsed: {
        replies: [
          'Thanks for asking. Keep the next decision tied to the section you can open, and leave out any result the page does not state.',
          'Which part of the registered page are you checking before you decide the next step?'
        ]
      }
    };
  }
});

const { buildAiProfileChecklist } = require('../src/profile_checklist');

test('profile checklist follows the strongest saved playbook and blocks invented numbers', async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  const playbooks = [
    { id: 'pb_low', topic: '弱い確認', readerSituation: '急いで決める人', commonMistake: '先に宣伝を入れる', checkCriteria: '出典を開けるか見る', boundaryCondition: '条件が違う日は使わない。' },
    { id: 'pb_high', topic: '保存される確認', readerSituation: '残しておきたい人', commonMistake: '数字で穴を埋める', checkCriteria: 'その場で開ける根拠だけ見る', boundaryCondition: 'ページに無い数字は使わない。' }
  ];
  const jobs = [
    { focusPlaybookId: 'pb_low', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 0, replies: 0, likes: 1 } },
    { focusPlaybookId: 'pb_high', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 9, replies: 1, likes: 2 } }
  ];
  const user = { aiTargetLang: 'ja', targetUrl: 'https://veloxpostapp.com', brandKnowledge: { productName: 'VELOX AI', domainPlaybooks: playbooks } };
  const checklist = await buildAiProfileChecklist(user, 'en', { brandKnowledge: user.brandKnowledge, recentPostedJobs: jobs });
  assert.equal(writerCalls.includes('profile_checklist'), true);
  assert.equal(checklist.focusPlaybookId, 'pb_high');
  assert.equal(checklist.pinVisualCard.template, 'editorial_split');
  assert.equal(checklist.pinVisualCard.focusPlaybookId, 'pb_high');
  assert.equal(/[\u3040-\u30ff\u4e00-\u9fff]/.test(checklist.pin), true);
  assert.equal(/[\u3040-\u30ff\u4e00-\u9fff]/.test(checklist.currentBioReview), false);
  const blocked = await buildAiProfileChecklist(user, 'en', {
    brandKnowledge: user.brandKnowledge,
    recentPostedJobs: jobs
  });
  assert.equal(/95%/.test(blocked.pin), false);
});

const docs = new Map();
const posted = [];
function docRef(key) {
  return {
    async get() { return { exists: docs.has(key), data: () => docs.get(key) }; },
    async set(data, options) {
      const prev = options && options.merge ? (docs.get(key) || {}) : {};
      docs.set(key, { ...prev, ...data });
    },
    collection(name) {
      return {
        doc(id) { return docRef(`${key}/${name}/${id}`); }
      };
    }
  };
}
stub('../src/firestore', { db: { collection(name) { return { doc(id) { return docRef(`${name}/${id}`); }, where() { return this; }, limit() { return this; }, async get() { return { docs: [], empty: true }; } }; } } });
stub('../src/auth_service', { resolveSessionUser: async (_db, req) => req.sessionUser || null });
stub('../src/official_api_client', {
  decryptCredentials: () => ({ id: '111', userId: '111' }),
  sanitizePostOrReplyText: text => String(text || '').trim(),
  postOfficialTweet: async (_creds, text) => { posted.push(text); return { ok: true, tweetId: 'reply-1' }; }
});
stub('../src/operated_accounts', { officialApiOperationAllowed: () => true });
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
const realVisual = require('../src/visual_card');
stub('../src/visual_card', { ...realVisual, renderVisualCardPng: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) });

const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
const routes = { post: new Map() };
registerHybridSaasRoutes({ post(path, handler) { routes.post.set(path, handler); }, get() {} }, { runWorker: false });

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, send(payload) { this.body = payload; return this; } };
}

const safeReply = '今日の確認場所を先に残すと、次の判断が同じ型で続きます。見えた事実だけを残し、ページに無い体験は足しません。';

test('draft replies follow the mention language and name the playbook', async () => {
  docs.set('saas_users/owner', {
    aiTargetLang: 'en',
    planId: 'pro',
    brandKnowledge: { domainPlaybooks: [{ id: 'pb_en', topic: 'Source check', readerSituation: 'A reader is choosing the next step.', commonMistake: 'A claim is added before the page is open.', checkCriteria: 'The sentence still matches the page.', boundaryCondition: 'Skip it when the page was already requested.' }] }
  });
  docs.set('saas_users/owner/inbound_mentions/mention-en', { text: 'Where should I check this before posting?', authorId: '222' });
  const res = response();
  await routes.post.get('/api/autopilot/mentions/:tweetId/draft-replies')({
    params: { tweetId: 'mention-en' },
    sessionUser: { userId: 'owner' },
    body: { uiLang: 'en' },
    headers: {}
  }, res);
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.equal(res.body.lang, 'en');
  assert.equal(res.body.focusPlaybookId, 'pb_en');
  assert.equal(res.body.replies.length, 2);
});

test('approved replies still pass opt-out, self, cooldown, cap, and safety checks', async () => {
  const send = routes.post.get('/api/autopilot/mentions/:tweetId/send-reply');
  const baseUser = { planId: 'pro', twitterId: '111', xOfficialCredentials: 'stored', autoReplySettings: { maxRepliesPerDay: 2, cooldownHoursPerAuthor: 24 } };
  async function call(tweetId, mention, user, text, uiLang) {
    docs.set('saas_users/owner', { ...baseUser, ...user });
    docs.set(`saas_users/owner/inbound_mentions/${tweetId}`, mention);
    const res = response();
    await send({ params: { tweetId }, sessionUser: { userId: 'owner' }, body: { text, uiLang }, headers: {} }, res);
    return res;
  }
  const self = await call('self', { text: '自分の確認です', authorId: '111' }, {}, safeReply, 'ja');
  assert.equal(self.statusCode, 409);
  const opted = await call('stop', { text: 'please stop', authorId: '222' }, {}, safeReply, 'en');
  assert.equal(opted.statusCode, 403);
  assert.equal(opted.body.code, 'opt_out');
  docs.set('saas_users/owner/blocked_reply_authors/333', { authorId: '333' });
  const blocked = await call('blocked', { text: '別の質問です', authorId: '333' }, {}, safeReply, 'ja');
  assert.equal(blocked.statusCode, 403);
  const cooled = await call('cool', { text: '別の質問です', authorId: '444' }, { autoReplyLastByAuthor: { '444': new Date().toISOString() } }, safeReply, 'ja');
  assert.equal(cooled.statusCode, 429);
  assert.equal(cooled.body.code, 'cooldown');
  const capped = await call('cap', { text: '別の質問です', authorId: '555' }, { autoReplySentDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date()), autoReplySentCount: 2 }, safeReply, 'en');
  assert.equal(capped.statusCode, 429);
  assert.equal(capped.body.code, 'daily_cap');
  const unsafe = await call('url', { text: '別の質問です', authorId: '666' }, {}, '詳細は https://example.com を見てください。今日の確認場所を先に残すと、次の判断が同じ型で続きます。', 'ja');
  assert.equal(unsafe.statusCode, 400);
  assert.equal(posted.length, 0);
});
