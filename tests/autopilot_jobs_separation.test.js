'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function stubModule(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

process.env.NODE_ENV = 'test';

let mockJobs = [];
let mockLanguage = 'ja';
let failingStatus = null;

function createMockQuery(filters = [], orderBys = [], limitCount = Infinity) {
  return {
    filters,
    orderBys,
    limitCount,
    where(field, op, val) {
      return createMockQuery([...this.filters, { field, op, val }], this.orderBys, this.limitCount);
    },
    orderBy(field, dir = 'asc') {
      return createMockQuery(this.filters, [...this.orderBys, { field, dir }], this.limitCount);
    },
    limit(n) {
      return createMockQuery(this.filters, this.orderBys, n);
    },
    async get() {
      if (failingStatus && this.filters.some(f => f.field === 'status' && f.val === failingStatus)) {
        throw new Error('mock query failure');
      }
      let filtered = mockJobs.filter(j => {
        return this.filters.every(f => {
          if (f.field === 'userId') {
            return !j.userId || j.userId === f.val;
          }
          if (f.op === '==') return j[f.field] === f.val;
          return true;
        });
      });
      // 🛡️ Firestore公式仕様の忠実な再現:
      // 「orderBy() 句は、指定されたフィールドが存在するドキュメントのみをフィルタリングして返します」
      // フィールドが存在しない（undefined）文書は結果から自動除外される
      if (this.orderBys.length > 0) {
        filtered = filtered.filter(j => {
          return this.orderBys.every(ob => j[ob.field] !== undefined);
        });
      }
      for (const ob of this.orderBys) {
        filtered.sort((a, b) => {
          const va = a[ob.field] instanceof Date ? a[ob.field].getTime() : (a[ob.field] || 0);
          const vb = b[ob.field] instanceof Date ? b[ob.field].getTime() : (b[ob.field] || 0);
          return ob.dir === 'desc' ? vb - va : va - vb;
        });
      }
      if (Number.isFinite(this.limitCount)) {
        filtered = filtered.slice(0, this.limitCount);
      }
      const toDoc = ({ _mockDocId, ...data }) => ({
        id: _mockDocId === undefined ? data.id : _mockDocId,
        data: () => ({ ...data })
      });
      return {
        docs: filtered.map(toDoc),
        forEach(cb) {
          filtered.forEach((j, idx) => cb(toDoc(j), idx));
        }
      };
    }
  };
}

const db = {
  collection(name) {
    if (name === 'autopilot_jobs') return createMockQuery();
    if (name === 'saas_users') return {
      doc: () => ({
        async get() {
          return { exists: true, data: () => ({ latestMarketingStrategy: null }) };
        }
      })
    };
    throw new Error(`Unexpected collection: ${name}`);
  }
};

stubModule('../src/firestore', { db });
stubModule('../src/auth_service', {
  resolveSessionUser: async () => ({ userId: 'test_user_separation', aiTargetLang: mockLanguage })
});
stubModule('../src/official_api_client', {
  decryptCredentials: () => ({}),
  sanitizePostOrReplyText: t => t
});
stubModule('../src/collective_intelligence', {});
stubModule('../src/autonomous_promo_ai', {});
stubModule('../src/wise_payment', {});

const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

test('job list and dashboard show the selected language and complete scheduled thread', async () => {
  mockLanguage = 'en';
  mockJobs = [
    {
      id: 'english', status: 'pending', lang: 'ja', text: '日本語の本文',
      tweets: ['日本語の本文', '日本語のリプライ'],
      text_en: 'English text', tweets_en: ['English first', 'English second', 'English third'],
      draftReplyText: 'unsaved fallback reply'
    },
    {
      id: 'single', status: 'pending', text: 'actual single text',
      tweets: ['different array value'], draftReplyText: 'unsaved fallback reply'
    },
    {
      id: 'jit', status: 'pending', isHumanOverride: true, isJitContent: true,
      text: 'stored placeholder'
    },
    {
      id: 'english-only', status: 'pending', text_en: 'English-only post'
    },
    {
      id: 'bad-english', status: 'pending', text_en: 'English post',
      tweets_en: ['English post', '日本語のリプライ']
    },
    {
      id: 'english-jit', status: 'pending', text: '通常の日本語 <保存データ>',
      text_en: 'Just-In-Time AI Post', timeSlot: 'morning',
      scheduledAt: new Date('2026-11-16T08:35:00+09:00'), scheduleTimeZone: 'Asia/Tokyo'
    },
    { id: 'running-job', status: 'processing', text: 'Processing <draft>' },
    {
      id: 'failed-job', status: 'failed', text: 'Failed <draft>', tweetId: '987654321',
      postConfirmation: { type: 'single_post_api_success', tweetId: '987654321' },
      partialTweets: [{ tweetId: '123456789' }, { tweetId: 'javascript:alert(1)' }]
    }
  ];
  for (let i = 0; i < 51; i++) {
    mockJobs.push({ id: `posted-${i}`, status: 'posted', text: `Posted ${i}`, postedAt: new Date(i * 1000) });
  }
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const res = { json(body) { this.body = body; return this; } };
  await routes.get('/api/autopilot/jobs')({ headers: {}, query: {} }, res);

  const english = res.body.jobs.find(job => job.id === 'english');
  const single = res.body.jobs.find(job => job.id === 'single');
  const jit = res.body.jobs.find(job => job.id === 'jit');
  const englishOnly = res.body.jobs.find(job => job.id === 'english-only');
  const englishJit = res.body.jobs.find(job => job.id === 'english-jit');
  assert.equal(english.scheduledLanguage, 'en');
  assert.deepEqual(english.scheduledTweets, ['English first', 'English second', 'English third']);
  assert.deepEqual(single.scheduledTweets, []);
  assert.equal(single.languageContentMissing, true);
  assert.equal(res.body.jobs.find(job => job.id === 'bad-english').languageContentInvalid, true);
  assert.equal(jit.contentClassification, 'human_override');
  assert.equal(jit.referencePreview, null);
  assert.equal(englishOnly.contentClassification, 'stored_ai_draft');
  assert.deepEqual(englishOnly.scheduledTweets, ['English-only post']);
  assert.equal(englishJit.contentClassification, 'jit_dynamic_pending');
  assert.equal(englishJit.referencePreview.isSampleOnly, true);
  assert.equal(res.body.counts.pending, 6);
  assert.equal(res.body.counts.processing, 1);
  assert.equal(res.body.counts.posted, 51);
  assert.equal(res.body.hasMorePosted, true);

  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const start = html.indexOf('    let jobsHistoryCursors = [null];');
  const end = html.indexOf('\n    // 🤖 次回枠', start);
  assert.ok(start >= 0 && end > start);
  const container = { innerHTML: '' };
  const context = {
    AbortController, setTimeout, clearTimeout, console,
    document: { getElementById: id => id === 'jobsContainer' ? container : null },
    checkIsEn: () => false,
    escHtml: value => String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]),
    fetch: async () => ({ ok: true, json: async () => res.body })
  };
  vm.createContext(context);
  await vm.runInContext(`${html.slice(start, end)}\nloadJobs()`, context);
  assert.match(container.innerHTML, /English first/);
  assert.match(container.innerHTML, /English second/);
  assert.match(container.innerHTML, /English third/);
  assert.match(container.innerHTML, /投稿言語: 英語/);
  assert.match(container.innerHTML, /英語本文が保存されていません/);
  assert.match(container.innerHTML, /日本語などの文字が含まれる/);
  assert.doesNotMatch(container.innerHTML, /unsaved fallback reply/);
  assert.match(container.innerHTML, /参考プレビュー案/);
  assert.match(container.innerHTML, /投稿本文はまだ確定していません/);
  assert.doesNotMatch(container.innerHTML, /保存済み下書きを確認（この予約では投稿されません）/);
  assert.doesNotMatch(container.innerHTML, /通常の日本語 &lt;保存データ&gt;/);
  assert.doesNotMatch(container.innerHTML, /Firestore 実保存データ|RAW DB/);
  assert.doesNotMatch(container.innerHTML, /朝枠 \(08:30 JST\)/);
  assert.match(container.innerHTML, /2026\/11\/16 8:35:00 \(Asia\/Tokyo\)/);
  assert.doesNotMatch(container.innerHTML, /<details class="p-3 rounded-xl bg-slate-50/);
  assert.match(container.innerHTML, /<details class="p-3\.5 rounded-xl bg-amber-50/);
  assert.match(container.innerHTML, /stored placeholder/);
  assert.match(container.innerHTML, /処理中として記録されています。 \(running-job\)/);
  assert.match(container.innerHTML, /保存された本文は投稿完了の証明ではありません/);
  assert.match(container.innerHTML, /Processing &lt;draft&gt;/);
  assert.match(container.innerHTML, /Failed &lt;draft&gt;/);
  assert.match(container.innerHTML, /https:\/\/x\.com\/i\/status\/987654321/);
  assert.match(container.innerHTML, /https:\/\/x\.com\/i\/status\/123456789/);
  assert.match(container.innerHTML, /Xで確認して履歴に反映/);
  assert.doesNotMatch(container.innerHTML, /javascript:alert/);
  assert.match(container.innerHTML, /過去の投稿の一部は表示されていません。/);
  context.checkIsEn = () => true;
  await vm.runInContext('loadJobs()', context);
  assert.match(container.innerHTML, /No English text is saved/);
  assert.match(container.innerHTML, /contains Japanese or other East Asian characters/);
  assert.match(container.innerHTML, /The final post has not been generated yet/);
  assert.match(container.innerHTML, /View reference sample \(not the scheduled post\)/);
  assert.doesNotMatch(container.innerHTML, /View saved drafts \(not used for this post\)/);
  assert.match(container.innerHTML, /Stored text is not proof of publication/);
  assert.match(container.innerHTML, /Check X and restore history/);
  mockLanguage = 'ja';
});

test('reconciliation prompts before lookup and reports results in the selected language', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const start = html.indexOf('    async function reconcileAutopilotJob(');
  const end = html.indexOf('    // 🚀 今すぐ投稿', start);
  assert.ok(start >= 0 && end > start);
  let allowed = false;
  let english = false;
  let result = { ok: true };
  let calls = [];
  let alerts = [];
  let loads = 0;
  const context = {
    checkIsEn: () => english,
    confirm: () => allowed,
    alert: message => alerts.push(message),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { json: async () => result };
    },
    loadJobs: async () => { loads++; }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  await context.reconcileAutopilotJob('job%27id');
  assert.equal(calls.length, 0);

  allowed = true;
  await context.reconcileAutopilotJob('job%27id');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/autopilot/jobs/job%27id/reconcile');
  assert.equal(calls[0].options.method, 'POST');
  assert.match(alerts.at(-1), /履歴に反映/);
  assert.equal(loads, 1);

  english = true;
  result = { ok: false, code: 'recovery_conflict' };
  await context.reconcileAutopilotJob('job');
  assert.match(alerts.at(-1), /job or account changed/);
  assert.equal(loads, 2);

  english = false;
  context.fetch = async () => { throw new Error('offline'); };
  await context.reconcileAutopilotJob('job');
  assert.match(alerts.at(-1), /通信エラー: offline/);
  assert.equal(loads, 2);
});

test('post-now explains a missing history index without exposing the Firebase console URL', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const start = html.indexOf('    async function executePostNow(');
  const end = html.indexOf('\n    // 初回ロード', start);
  assert.ok(start >= 0 && end > start);

  const alerts = [];
  const confirmations = [];
  const button = { disabled: false, innerHTML: 'Publish now' };
  const card = { dataset: { postLanguage: 'en', dynamicSlot: 'true' } };
  const context = {
    checkIsEn: () => false,
    confirm: message => { confirmations.push(message); return true; },
    alert: message => alerts.push(message),
    document: {
      getElementById(id) {
        if (id === 'jobCard_job-1') return card;
        if (id === 'btnPostNow_job-1') return button;
        return null;
      }
    },
    fetch: async () => ({
      json: async () => ({
        ok: false,
        code: 'post_history_index_missing',
        error: '9 FAILED_PRECONDITION: The query requires an index. https://console.firebase.google.com/create_composite=secret'
      })
    })
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  await context.executePostNow('job-1');

  assert.match(confirmations[0], /英語の投稿/);
  assert.match(confirmations[0], /これはテストではなく実際に公開されます/);
  assert.match(confirmations[0], /参考プレビューは投稿されません/);
  assert.match(alerts[0], /今回はXへ送信していません/);
  assert.doesNotMatch(alerts[0], /FAILED_PRECONDITION|create_composite|console\.firebase/);
  assert.equal(button.disabled, false);
});

test('GET /api/autopilot/jobs clearly separates raw stored data from reference previews without in-memory overwrite', async () => {
  mockLanguage = 'ja';
  const routes = new Map();
  const app = {
    get(path, handler) { routes.set(path, handler); },
    post() {}
  };
  registerHybridSaasRoutes(app, { runWorker: false });

  const getJobsHandler = routes.get('/api/autopilot/jobs');
  assert.ok(getJobsHandler, 'GET /api/autopilot/jobs route must be registered');

  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  const now = Date.now();
  mockJobs = [
    // 1. 手動指定投稿 (human_override)
    {
      id: 'job_human_1',
      userId: 'test_user_separation',
      status: 'pending',
      timeSlot: 'noon',
      isHumanOverride: true,
      text: '手動で入力した確定投稿文です。',
      tweets: ['手動で入力した確定投稿文です。', 'https://example.com/manual'],
      scheduledAt: new Date(now + 3600000)
    },
    // 2. AI合議策定・確定済み投稿 (stored_ai_draft)
    {
      id: 'job_council_1',
      userId: 'test_user_separation',
      status: 'pending',
      timeSlot: 'evening',
      deliberationId: 'council_abc',
      isHumanOverride: false,
      isJitContent: false,
      text: 'AI評議会が承認した保存済み投稿文です。',
      tweets: ['AI評議会が承認した保存済み投稿文です。', 'https://example.com/council'],
      scheduledAt: new Date(now + 7200000)
    },
    // 3. JIT動的生成枠（本文未確定） (jit_dynamic_pending)
    {
      id: 'job_jit_1',
      userId: 'test_user_separation',
      status: 'pending',
      timeSlot: 'morning',
      isJitContent: true,
      text: '【投稿直前AI動的生成枠】',
      tweets: ['【投稿直前AI動的生成枠】'],
      scheduledAt: new Date(now + 1800000)
    }
  ];

  const res = response();
  await getJobsHandler({ headers: {}, query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(Array.isArray(res.body.jobs), true);
  assert.equal(res.body.jobs.length, 3);

  // 時系列順にソートされていること (morning -> noon -> evening)
  assert.equal(res.body.jobs[0].id, 'job_jit_1');
  assert.equal(res.body.jobs[1].id, 'job_human_1');
  assert.equal(res.body.jobs[2].id, 'job_council_1');

  // 1. JIT動的枠の検証
  const jitJob = res.body.jobs[0];
  assert.equal(jitJob.contentClassification, 'jit_dynamic_pending');
  assert.equal(jitJob.storedText, '【投稿直前AI動的生成枠】');
  // 🛡️ raw.text が勝手に generateBestPracticeDraft で上書きされていないことを厳格検証
  assert.equal(jitJob.text, '【投稿直前AI動的生成枠】');
  assert.deepStrictEqual(jitJob.storedTweets, ['【投稿直前AI動的生成枠】']);
  assert.ok(jitJob.referencePreview, 'JIT slot must provide referencePreview');
  assert.equal(jitJob.referencePreview.isSampleOnly, true);
  assert.match(jitJob.referencePreview.notice, /参考/);
  assert.ok(typeof jitJob.referencePreview.postText === 'string');
  assert.ok(typeof jitJob.referencePreview.replyText === 'string');
  // 禁止語句（100時間）が参考案に含まれていないこと
  assert.equal(jitJob.referencePreview.postText.includes('100時間'), false);

  // 2. 手動指定投稿の検証
  const humanJob = res.body.jobs[1];
  assert.equal(humanJob.contentClassification, 'human_override');
  assert.equal(humanJob.isHumanOverride, true);
  assert.equal(humanJob.storedText, '手動で入力した確定投稿文です。');
  assert.equal(humanJob.text, '手動で入力した確定投稿文です。');
  assert.deepStrictEqual(humanJob.storedTweets, ['手動で入力した確定投稿文です。', 'https://example.com/manual']);
  assert.equal(humanJob.referencePreview, null, 'Human override must not have referencePreview');

  // 3. AI合議策定・保存済み投稿の検証
  const councilJob = res.body.jobs[2];
  assert.equal(councilJob.contentClassification, 'stored_ai_draft');
  assert.equal(councilJob.storedText, 'AI評議会が承認した保存済み投稿文です。');
  assert.equal(councilJob.text, 'AI評議会が承認した保存済み投稿文です。');
  assert.deepStrictEqual(councilJob.storedTweets, ['AI評議会が承認した保存済み投稿文です。', 'https://example.com/council']);
  assert.equal(councilJob.referencePreview, null, 'Stored AI draft must not have referencePreview');
});

test('50件を超える投稿履歴が存在しても待機予約および失敗ジョブが一切欠落せず共存し、postedAt等で決定論的ソートされること', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const getJobsHandler = routes.get('/api/autopilot/jobs');

  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  const baseTime = 1700000000000;
  mockLanguage = 'ja';
  mockJobs = [];

  // 1. 60件の過去投稿完了ジョブ (status: 'posted')
  // postedAt を 1時間刻みで設定
  for (let i = 1; i <= 60; i++) {
    mockJobs.push({
      id: `posted_job_${String(i).padStart(3, '0')}`,
      userId: 'test_user_separation',
      status: 'posted',
      postedAt: new Date(baseTime + i * 3600000),
      text: `過去の投稿内容 #${i}`,
      tweets: [`過去の投稿内容 #${i}`]
    });
  }

  // 欠損データのテスト用ジョブを追加
  // A. postedAt 欠損、scheduledAt のみ保持
  mockJobs.push({
    id: 'posted_missing_postedAt_with_scheduledAt',
    userId: 'test_user_separation',
    status: 'posted',
    scheduledAt: new Date(baseTime + 55 * 3600000),
    text: 'postedAt欠損・scheduledAt保持'
  });
  // B. postedAt と scheduledAt 欠損、updatedAt のみ保持
  mockJobs.push({
    id: 'posted_missing_all_except_updatedAt',
    userId: 'test_user_separation',
    status: 'posted',
    updatedAt: new Date(baseTime + 10 * 3600000),
    text: 'updatedAtのみ保持'
  });
  // C. 全日時欠損ジョブ (Epoch 0 として末尾に並ぶ)
  mockJobs.push({
    id: 'posted_missing_all_timestamps',
    userId: 'test_user_separation',
    status: 'posted',
    text: '全日時欠損'
  });

  // 2. 15件の未来待機予約ジョブ (status: 'pending')
  for (let i = 1; i <= 15; i++) {
    mockJobs.push({
      id: `pending_job_${String(i).padStart(2, '0')}`,
      userId: 'test_user_separation',
      status: 'pending',
      scheduledAt: new Date(baseTime + 100000000 + i * 3600000),
      timeSlot: 'morning',
      text: `予約枠 #${i}`,
      tweets: [`予約枠 #${i}`]
    });
  }

  // 3. 3件の配信失敗ジョブ (status: 'failed')
  for (let i = 1; i <= 3; i++) {
    mockJobs.push({
      id: `failed_job_${i}`,
      userId: 'test_user_separation',
      status: 'failed',
      error: `API Rate Limit #${i}`,
      updatedAt: new Date(baseTime + 200000000 + i * 3600000)
    });
  }

  // 全体取得 (クエリパラメータなし: デフォルト50件limit)
  const res = response();
  await getJobsHandler({ headers: {}, query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);

  const pendingReturned = res.body.jobs.filter(j => j.status === 'pending');
  const failedReturned = res.body.jobs.filter(j => j.status === 'failed');
  const postedReturned = res.body.jobs.filter(j => j.status === 'posted');

  // 🛡️ 過去履歴が60件以上あっても、15件の待機予約が一切欠落（押し出し）していないこと
  assert.equal(pendingReturned.length, 15, 'All 15 pending reservations must be returned without being crowded out');
  // 🛡️ 3件の失敗ジョブがすべて維持されていること
  assert.equal(failedReturned.length, 3, 'All 3 failed jobs must be returned');
  // 🛡️ 投稿完了履歴はデフォルト上限50件に制限されていること
  assert.equal(postedReturned.length, 50, 'Posted history must respect the 50-item limit');

  // 🛡️ 待機予約は scheduledAt の昇順（直近が先頭）
  assert.equal(pendingReturned[0].id, 'pending_job_01');
  assert.equal(pendingReturned[14].id, 'pending_job_15');

  // 🛡️ 投稿完了履歴は postedAt の降順（最新投稿が先頭）
  assert.equal(postedReturned[0].id, 'posted_job_060');

  // 🛡️ 全日時欠損のジョブが末尾に配置されていることの検証
  const resAllPosted = response();
  await getJobsHandler({ headers: {}, query: { status: 'posted', limit: '100' } }, resAllPosted);
  const allPosted = resAllPosted.body.jobs;
  assert.equal(allPosted[allPosted.length - 1].id, 'posted_missing_all_timestamps', 'Job with missing timestamps must sort to the end (Epoch 0)');

  // 🛡️ 同一日時の決定論的タイブレーク (id降順)
  mockJobs = [
    { id: 'job_tie_aaa', userId: 'test_user_separation', status: 'posted', postedAt: new Date(baseTime) },
    { id: 'job_tie_zzz', userId: 'test_user_separation', status: 'posted', postedAt: new Date(baseTime) }
  ];
  const resTie = response();
  await getJobsHandler({ headers: {}, query: { status: 'posted' } }, resTie);
  assert.equal(resTie.body.jobs[0].id, 'job_tie_zzz');
  assert.equal(resTie.body.jobs[1].id, 'job_tie_aaa');
});

test('クエリパラメータのバリデーション (statusフィルタ・limit境界・上限200件)', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const getJobsHandler = routes.get('/api/autopilot/jobs');

  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  mockJobs = [];
  for (let i = 1; i <= 250; i++) {
    mockJobs.push({
      id: `job_${i}`,
      userId: 'test_user_separation',
      status: i <= 100 ? 'pending' : 'posted',
      scheduledAt: new Date(1700000000000 + i * 1000),
      postedAt: new Date(1700000000000 + i * 1000)
    });
  }

  // 1. 不正な limit (負数・文字列・NaN) -> デフォルト50件
  const resInvalid = response();
  await getJobsHandler({ headers: {}, query: { limit: 'invalid_string' } }, resInvalid);
  const postedCount1 = resInvalid.body.jobs.filter(j => j.status === 'posted').length;
  assert.equal(postedCount1, 50);

  const resNegative = response();
  await getJobsHandler({ headers: {}, query: { limit: '-10' } }, resNegative);
  const postedCount2 = resNegative.body.jobs.filter(j => j.status === 'posted').length;
  assert.equal(postedCount2, 50);

  // 2. 超過 limit (>200) -> 安全上限 200件でクリップ
  const resOver = response();
  await getJobsHandler({ headers: {}, query: { status: 'posted', limit: '99999' } }, resOver);
  assert.equal(resOver.body.jobs.length, 150); // 投稿済み全150件 (<= 200)

  // 3. status フィルタ指定
  const resPendingOnly = response();
  await getJobsHandler({ headers: {}, query: { status: 'pending', limit: '20' } }, resPendingOnly);
  assert.equal(resPendingOnly.body.jobs.length, 20);
  assert.ok(resPendingOnly.body.jobs.every(j => j.status === 'pending'));

  const resPostedOnly = response();
  await getJobsHandler({ headers: {}, query: { status: 'posted', limit: '30' } }, resPostedOnly);
  assert.equal(resPostedOnly.body.jobs.length, 30);
  assert.ok(resPostedOnly.body.jobs.every(j => j.status === 'posted'));
});

test('Firestoreの orderBy によるフィールド欠損文書除外仕様の検証と、APIクエリにおける orderBy 撤廃による欠損文書救済の証明', async () => {
  mockJobs = [
    { id: 'job_with_postedAt', userId: 'test_user_separation', status: 'posted', postedAt: new Date(1700000000000) },
    { id: 'job_missing_postedAt', userId: 'test_user_separation', status: 'posted', scheduledAt: new Date(1700000000000) }
  ];

  // 1. 直のクエリで orderBy('postedAt') を指定した場合:
  // Firestore公式仕様通り、postedAt がない文書 (job_missing_postedAt) は結果から除外されることを実証
  const queryWithOrderBy = db.collection('autopilot_jobs')
    .where('userId', '==', 'test_user_separation')
    .where('status', '==', 'posted')
    .orderBy('postedAt', 'desc');
  const snapWithOrderBy = await queryWithOrderBy.get();
  assert.equal(snapWithOrderBy.docs.length, 1, 'Firestore orderBy must exclude documents missing the ordered field');
  assert.equal(snapWithOrderBy.docs[0].id, 'job_with_postedAt');

  // 2. GET /api/autopilot/jobs の検証:
  // DBクエリから orderBy を完全撤廃しているため、postedAt が欠損した文書も Firestore クエリ層で除外されず取得され、
  // メモリ内のフォールバックソート（postedAt -> scheduledAt -> updatedAt -> 0）によって安全に救済・返却される
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const getJobsHandler = routes.get('/api/autopilot/jobs');

  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await getJobsHandler({ headers: {}, query: { status: 'posted' } }, res);

  assert.equal(res.body.ok, true);
  assert.equal(res.body.jobs.length, 2, 'Both documents must be returned when DB query does not use orderBy');
  const ids = res.body.jobs.map(j => j.id);
  assert.ok(ids.includes('job_with_postedAt'));
  assert.ok(ids.includes('job_missing_postedAt'));
});

test('待機中ジョブ200件超および失敗ジョブ50件超の完全取得と全件点検保証 (打ち切り撤廃の検証)', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const getJobsHandler = routes.get('/api/autopilot/jobs');

  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  mockJobs = [];
  // 1. 210件の待機予約ジョブ (従来の200件上限を超える)
  for (let i = 1; i <= 210; i++) {
    mockJobs.push({
      id: `pending_${String(i).padStart(3, '0')}`,
      userId: 'test_user_separation',
      status: 'pending',
      scheduledAt: new Date(1700000000000 + i * 60000)
    });
  }

  // 2. 55件の失敗ジョブ (従来の50件上限を超える)
  for (let i = 1; i <= 55; i++) {
    mockJobs.push({
      id: `failed_${String(i).padStart(2, '0')}`,
      userId: 'test_user_separation',
      status: 'failed',
      failedAt: new Date(1700000000000 + i * 60000)
    });
  }

  // 3. 60件の投稿完了ジョブ
  for (let i = 1; i <= 60; i++) {
    mockJobs.push({
      id: `posted_${String(i).padStart(2, '0')}`,
      userId: 'test_user_separation',
      status: 'posted',
      postedAt: new Date(1700000000000 + i * 60000)
    });
  }

  // A. ダッシュボードのデフォルト取得 (status/limit パラメータなし)
  const resDefault = response();
  await getJobsHandler({ headers: {}, query: {} }, resDefault);

  assert.equal(resDefault.body.ok, true);
  // counts の検証
  assert.deepEqual(resDefault.body.counts, {
    pending: 210,
    processing: 0,
    failed: 55,
    posted: 60
  });

  // 待機中ジョブは200件で打ち切られず、全210件が返却されること
  const returnedPending = resDefault.body.jobs.filter(j => j.status === 'pending');
  assert.equal(returnedPending.length, 210, 'All 210 pending reservations must be returned without 200-item cutoff');

  // 失敗ジョブは50件で打ち切られず、全55件が返却されること
  const returnedFailed = resDefault.body.jobs.filter(j => j.status === 'failed');
  assert.equal(returnedFailed.length, 55, 'All 55 failed jobs must be returned without 50-item cutoff');

  // 投稿完了履歴はデフォルト上限50件に制限され、hasMorePosted が true になること
  const returnedPosted = resDefault.body.jobs.filter(j => j.status === 'posted');
  assert.equal(returnedPosted.length, 50);
  assert.equal(resDefault.body.hasMorePosted, true);

  // 合計返却件数 = 210 + 55 + 50 = 315 件
  assert.equal(resDefault.body.jobs.length, 315);

  // B. status=pending の単独取得（limitなし -> 全210件）
  const resPendingAll = response();
  await getJobsHandler({ headers: {}, query: { status: 'pending' } }, resPendingAll);
  assert.equal(resPendingAll.body.jobs.length, 210);
  assert.equal(resPendingAll.body.hasMorePending, false);

  // C. status=pending の明示的 limit=25
  const resPendingLimit = response();
  await getJobsHandler({ headers: {}, query: { status: 'pending', limit: '25' } }, resPendingLimit);
  assert.equal(resPendingLimit.body.jobs.length, 25);
  assert.equal(resPendingLimit.body.hasMorePending, true);

  // D. status=failed の単独取得（limitなし -> 全55件）
  const resFailedAll = response();
  await getJobsHandler({ headers: {}, query: { status: 'failed' } }, resFailedAll);
  assert.equal(resFailedAll.body.jobs.length, 55);
  assert.equal(resFailedAll.body.hasMoreFailed, false);

  // E. status=failed の明示的 limit=10
  const resFailedLimit = response();
  await getJobsHandler({ headers: {}, query: { status: 'failed', limit: '10' } }, resFailedLimit);
  assert.equal(resFailedLimit.body.jobs.length, 10);
  assert.equal(resFailedLimit.body.hasMoreFailed, true);
});

test('processing query errors are reported rather than returning an incomplete list', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const res = { json(body) { this.body = body; return this; } };
  failingStatus = 'processing';
  try {
    await routes.get('/api/autopilot/jobs')({ headers: {}, query: {} }, res);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /mock query failure/);
  } finally {
    failingStatus = null;
  }
});

test('posted history cursors use exact IDs, including numeric IDs and missing timestamps', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const getPage = async cursor => {
    const res = response();
    await handler({ headers: {}, query: { status: 'posted', limit: '2', ...(cursor !== undefined ? { cursor } : {}) } }, res);
    return res;
  };
  mockJobs = [
    { id: 'first', userId: 'test_user_separation', status: 'posted', postedAt: new Date(4000) },
    { id: '1', userId: 'test_user_separation', status: 'posted', postedAt: new Date(3000) },
    { id: 'third', userId: 'test_user_separation', status: 'posted', scheduledAt: new Date(2000) },
    { id: 'fourth', userId: 'test_user_separation', status: 'posted', scheduledAt: new Date(2000) },
    { id: 'missing-date', userId: 'test_user_separation', status: 'posted' },
    { id: 'other-user', userId: 'other', status: 'posted', postedAt: new Date(5000) }
  ];

  const first = await getPage();
  assert.deepEqual(first.body.jobs.map(job => job.id), ['first', '1']);
  assert.equal(first.body.nextCursor, '1');
  const second = await getPage(first.body.nextCursor);
  assert.deepEqual(second.body.jobs.map(job => job.id), ['third', 'fourth']);
  const third = await getPage(second.body.nextCursor);
  assert.deepEqual(third.body.jobs.map(job => job.id), ['missing-date']);
  assert.equal(third.body.nextCursor, null);
  assert.equal(third.body.hasMorePosted, false);

  const foreignCursor = await getPage('other-user');
  assert.equal(foreignCursor.statusCode, 400);
  assert.equal(foreignCursor.body.ok, false);
  mockJobs = mockJobs.filter(job => job.id !== '1');
  const deletedCursor = await getPage('1');
  assert.equal(deletedCursor.statusCode, 400);
  assert.equal(deletedCursor.body.ok, false);
  const invalidCursor = await getPage(['first', 'third']);
  assert.equal(invalidCursor.statusCode, 400);
});

test('stored id cannot replace the document ID in history cursors', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  const handler = routes.get('/api/autopilot/jobs');
  mockJobs = [
    { _mockDocId: 'actual-id', id: 'stored-id', userId: 'test_user_separation', status: 'posted', postedAt: new Date(2000) },
    { id: 'older-id', userId: 'test_user_separation', status: 'posted', postedAt: new Date(1000) }
  ];
  const getPage = async cursor => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await handler({ headers: {}, query: { status: 'posted', limit: '1', ...(cursor ? { cursor } : {}) } }, res);
    return res;
  };
  const first = await getPage();
  assert.equal(first.body.jobs[0].id, 'actual-id');
  assert.equal(first.body.nextCursor, 'actual-id');
  const second = await getPage(first.body.nextCursor);
  assert.equal(second.body.jobs[0].id, 'older-id');
  assert.equal((await getPage('stored-id')).statusCode, 400);
});

test('dashboard explains reservation conflicts in the selected language', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const start = html.indexOf('    async function scheduleJitSlotsManually()');
  const end = html.indexOf('\n    // 🗑️ 予約投稿', start);
  assert.ok(start >= 0 && end > start);
  for (const isEn of [false, true]) {
    let message;
    const context = {
      checkIsEn: () => isEn,
      document: { getElementById: () => null },
      fetch: async () => ({ json: async () => ({ ok: false, code: 'reservation_conflict' }) }),
      alert: value => { message = value; }
    };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    await vm.runInContext('scheduleJitSlotsManually()', context);
    assert.match(message, isEn ? /Reservations or settings changed/ : /予約または設定が変更されました/);
  }
});

test('dashboard navigates history pages and reports an expired cursor', async () => {
  const routes = new Map();
  registerHybridSaasRoutes({ get: (route, handler) => routes.set(route, handler), post() {} }, { runWorker: false });
  mockLanguage = 'ja';
  mockJobs = [
    { id: 'pending', userId: 'test_user_separation', status: 'pending', text: 'Pending item' },
    { id: 'failed', userId: 'test_user_separation', status: 'failed', error: 'Failure item' }
  ];
  for (let i = 1; i <= 101; i++) {
    mockJobs.push({
      id: i === 52 ? 'posted &?' : `posted-${String(i).padStart(3, '0')}`,
      userId: 'test_user_separation',
      status: 'posted',
      text: `History item ${i}`,
      ...(i === 1 ? {} : { postedAt: new Date(i * 1000) })
    });
  }
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const start = html.indexOf('    let jobsHistoryCursors = [null];');
  const end = html.indexOf('\n    // 🤖 次回枠', start);
  assert.ok(start >= 0 && end > start);
  const container = { innerHTML: '' };
  const requests = [];
  const context = {
    AbortController, setTimeout, clearTimeout, console,
    document: { getElementById: id => id === 'jobsContainer' ? container : null },
    checkIsEn: () => false,
    escHtml: value => String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]),
    fetch: async url => {
      const parsed = new URL(url, 'http://localhost');
      requests.push(parsed);
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };
      await routes.get('/api/autopilot/jobs')({
        headers: {}, query: Object.fromEntries(parsed.searchParams)
      }, res);
      return { status: res.statusCode, ok: res.statusCode < 400, json: async () => res.body };
    }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  await vm.runInContext('loadJobs()', context);
  assert.match(container.innerHTML, /History item 101/);
  assert.match(container.innerHTML, /Pending item/);
  assert.match(container.innerHTML, /Failure item/);
  assert.match(container.innerHTML, /moveJobsHistory\(1\)/);
  assert.doesNotMatch(container.innerHTML, /moveJobsHistory\(-1\)/);

  await vm.runInContext('moveJobsHistory(1)', context);
  assert.equal(requests[1].searchParams.get('cursor'), 'posted &?');
  assert.match(container.innerHTML, /History item 51/);
  assert.doesNotMatch(container.innerHTML, /History item 101/);
  assert.match(container.innerHTML, /Pending item/);
  assert.match(container.innerHTML, /Failure item/);
  assert.match(container.innerHTML, /moveJobsHistory\(-1\)/);

  const lastCursor = vm.runInContext('jobsHistoryNextCursor', context);
  const removed = mockJobs.find(job => job.id === lastCursor);
  mockJobs = mockJobs.filter(job => job.id !== lastCursor);
  await vm.runInContext('moveJobsHistory(1)', context);
  assert.match(container.innerHTML, /履歴が変更されたため/);
  assert.match(container.innerHTML, /History item 51/);

  mockJobs.push(removed);
  await vm.runInContext('moveJobsHistory(1)', context);
  assert.match(container.innerHTML, /History item 1/);
  assert.doesNotMatch(container.innerHTML, /moveJobsHistory\(1\)/);
  await vm.runInContext('moveJobsHistory(-1)', context);
  assert.match(container.innerHTML, /History item 51/);
});

test('japanese dashboard shows english posted text and a retry stop card', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const start = html.indexOf('    let jobsHistoryCursors = [null];');
  const end = html.indexOf('\n    // 🤖 次回枠', start);
  const container = { innerHTML: '' };
  const payload = {
    ok: true,
    jobs: [{
      id: 'posted-en',
      status: 'posted',
      tweets: [],
      text: null,
      tweets_en: ['First', 'Second'],
      text_en: 'First',
      postedAt: '2026-11-19T00:00:00.000Z'
    }],
    counts: { pending: 0, processing: 0, failed: 0, posted: 1 },
    nextPostState: { retryLimitReached: false, failuresToday: 0, lastError: null, rejectReasons: [] }
  };
  const context = {
    AbortController, setTimeout, clearTimeout, console,
    autopilotIsPaused: true,
    window: { __DASHBOARD_CONFIG__: { isPaid: true } },
    document: { getElementById: id => id === 'jobsContainer' ? container : null },
    checkIsEn: () => false,
    escHtml: value => String(value == null ? '' : value),
    fetch: async () => ({ ok: true, status: 200, json: async () => payload })
  };
  vm.createContext(context);
  await vm.runInContext(`${html.slice(start, end)}\nloadJobs()`, context);
  assert.match(container.innerHTML, /First/);
  assert.match(container.innerHTML, /Second/);
  assert.doesNotMatch(container.innerHTML, /30〜60秒ほどでこの欄に予約時刻と本文が自動で表示されます/);

  context.autopilotIsPaused = false;
  payload.jobs = [];
  payload.counts.posted = 0;
  payload.nextPostState = {
    retryLimitReached: true,
    failuresToday: 3,
    lastError: '検証を通る投稿案が無かったため停止しました。',
    rejectReasons: ['too_short']
  };
  await vm.runInContext('loadJobs()', context);
  assert.match(container.innerHTML, /次の1本の自動作成を3回連続で保留しました/);
  assert.match(container.innerHTML, /検証を通る投稿案が無かったため停止しました。/);
  assert.match(container.innerHTML, /btnRetryNextPost/);
  assert.match(container.innerHTML, /次の1本を今すぐ再作成する/);
  assert.doesNotMatch(container.innerHTML, /30〜60秒ほどでこの欄に予約時刻と本文が自動で表示されます/);
});

test('replenish button shows a readable error for an html timeout page', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const start = html.indexOf('    async function replenishJobsManually()');
  const end = html.indexOf('    async function scheduleJitSlotsManually()', start);
  assert.ok(start >= 0 && end > start);
  const alerts = [];
  let loaded = 0;
  let during = '';
  const btn = { disabled: false, innerHTML: 'retry' };
  const context = {
    checkIsEn: () => false,
    document: { getElementById: id => (id === 'btnRetryNextPost' ? btn : null) },
    fetch: async () => {
      during = `${btn.disabled}:${btn.innerHTML}`;
      return { ok: false, status: 524, text: async () => '<!DOCTYPE html>524 error' };
    },
    alert: message => alerts.push(String(message)),
    loadJobs: async () => { loaded += 1; }
  };
  vm.createContext(context);
  await vm.runInContext(`${html.slice(start, end)}\nreplenishJobsManually()`, context);
  assert.equal(loaded, 1);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /サーバー処理が混み合っています。少し待ってから画面を更新してください。/);
  assert.doesNotMatch(alerts[0], /Unexpected token/);
  assert.equal(btn.disabled, false);
  assert.match(during, /^true:.*⏳/);

  context.checkIsEn = () => true;
  alerts.length = 0;
  await vm.runInContext('replenishJobsManually()', context);
  assert.match(alerts[0], /The server is busy processing this request\. Please refresh shortly\./);
  assert.doesNotMatch(alerts[0], /Unexpected token/);
});
