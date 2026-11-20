'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

const validA = '現場で毎日ログを見直して気づいたのですが、投稿前に読者の悩みと手順を一つだけ絞る方が反応は安定します。遠回りに見えても地道な記録が信頼になります。';
const validB = '仕組みを作るときに一番効いたのは、最初から完璧な構成を追わずに小さな検証を回すことでした。短い改善を積み重ねると無理なく運用が続いていきます。';

test('draft stages report brief, candidates, critic, and repair with shorter budgets', async () => {
  const calls = [];
  const stages = [];
  const restoreGrok = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText(options) {
      calls.push({ tier: options.tier, timeoutMs: options.timeoutMs });
      if (calls.length === 1) {
        return { modelName: 'grok-brief-mock', text: JSON.stringify({ offer: '実務の記録', thisPost: '手順を一つに絞る', hookAngle: '具体確認' }) };
      }
      if (calls.length === 2) {
        return { modelName: 'grok-mock', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }, { id: 'b', tweets: [validB] }] }) };
      }
      if (calls.length === 3) {
        return { modelName: 'grok-critic-mock', text: JSON.stringify({ scores: [{ id: 'a', score: 60, weakness: 'thin' }] }) };
      }
      if (calls.length === 4) {
        return { modelName: 'grok-repair-mock', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }] }) };
      }
      return { modelName: 'grok-repair-critic-mock', text: JSON.stringify({ scores: [{ id: 'a', score: 84, weakness: '' }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  const prev = require.cache[draftPath];
  delete require.cache[draftPath];
  try {
    const { draftNextPostWithMeta } = require('../src/next_post_draft');
    const drafted = await draftNextPostWithMeta({
      lang: 'ja',
      tier: 'quality',
      userPrompt: '実務の運用メモを落ち着いて書く',
      accountState: { maxChars: 140, postShape: 'single', singleOnly: true, lang: 'ja' },
      onStage: stage => stages.push(stage)
    });
    assert.deepEqual(drafted.tweets, [validA]);
    assert.deepEqual(stages, ['draft_brief', 'draft_candidates', 'draft_critic', 'draft_repair']);
    assert.deepEqual(calls.map(call => call.tier), ['quality', 'quality', 'quality', 'quality', 'quality']);
    assert.ok(calls[0].timeoutMs <= 45000);
    assert.ok(calls[1].timeoutMs <= 95000);
    assert.ok(calls[2].timeoutMs <= 45000);
    assert.ok(calls[3].timeoutMs <= 90000);
    assert.ok(calls[4].timeoutMs <= 35000);
  } finally {
    restoreGrok();
    if (prev) require.cache[draftPath] = prev;
    else delete require.cache[draftPath];
  }
});

test('a fast free-experience budget stays on the fast tier', async () => {
  const calls = [];
  const restoreGrok = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText(options) {
      calls.push({ tier: options.tier, timeoutMs: options.timeoutMs });
      if (calls.length === 1) {
        return { modelName: 'grok-brief-mock', text: JSON.stringify({ offer: 'one checkpoint', thisPost: 'keep one note' }) };
      }
      if (calls.length === 2) {
        return { modelName: 'grok-mock', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }, { id: 'b', tweets: [validB] }] }) };
      }
      if (calls.length === 3) {
        return { modelName: 'grok-critic-mock', text: JSON.stringify({ scores: [{ id: 'a', score: 60, weakness: 'thin' }] }) };
      }
      if (calls.length === 4) {
        return { modelName: 'grok-repair-mock', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }] }) };
      }
      return { modelName: 'grok-repair-critic-mock', text: JSON.stringify({ scores: [{ id: 'a', score: 84, weakness: '' }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  const prev = require.cache[draftPath];
  delete require.cache[draftPath];
  try {
    const { draftNextPostWithMeta } = require('../src/next_post_draft');
    await draftNextPostWithMeta({
      lang: 'ja',
      tier: 'fast',
      timeoutMs: 18000,
      userPrompt: '実務の運用メモを落ち着いて書く',
      accountState: { maxChars: 140, postShape: 'single', singleOnly: true, lang: 'ja' }
    });
    assert.deepEqual(calls.map(call => call.tier), ['fast', 'fast', 'fast', 'fast', 'fast']);
    assert.equal(calls.every(call => call.timeoutMs <= 18000), true);
  } finally {
    restoreGrok();
    if (prev) require.cache[draftPath] = prev;
    else delete require.cache[draftPath];
  }
});

test('stage details explain the quality work in both languages', () => {
  const promo = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/autonomous_promo_ai.js'), 'utf8');
  const details = [
    'Writing multiple distinct angles from verified page facts, recent reactions, and your voice (quality model may take 30–90s).',
    'ページの事実・過去反応・文体を照合しながら、切り口の異なる複数案を推論モデルで深く練っています（30〜90秒ほどかかることがあります）。',
    'Scoring originality, causal depth, factual grounding, and fit with recent posts to select the strongest draft.',
    '表面的な一般論や過去投稿との重複がないか、事実の正確さと独自性を1案ずつ審査しています。',
    'Refining the draft logic, structure, and length limits with full quality reasoning before saving.',
    '審査基準を満たすまで、因果の具体性と文字数・規約条件を高精度モデルで磨き直しています。'
  ];
  for (const detail of details) assert.equal(promo.includes(detail), true, detail);
  const stageStart = promo.indexOf("if (stage === 'draft_candidates')");
  const stageEnd = promo.indexOf('const qualityAudit = [];', stageStart);
  const stageBlock = promo.slice(stageStart, stageEnd);
  assert.equal(stageBlock.includes(", '');"), false);
});

test('generateDraft retries a timeout on the fast tier with retryTimeoutMs', async () => {
  const calls = [];
  const restoreGrok = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText(options) {
      calls.push({ tier: options.tier, timeoutMs: options.timeoutMs });
      if (calls.length === 1) {
        const error = new Error('This operation was aborted');
        error.code = 'ABORT_ERR';
        throw error;
      }
      return { modelName: 'grok-fast-mock', text: '{"ok":true}' };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  const prev = require.cache[draftPath];
  delete require.cache[draftPath];
  try {
    const { generateDraft } = require('../src/next_post_draft');
    const text = await generateDraft('{"return":"json"}', { tier: 'quality', timeoutMs: 45000, retryTimeoutMs: 9000 });
    assert.equal(text, '{"ok":true}');
    assert.deepEqual(calls, [
      { tier: 'quality', timeoutMs: 45000 },
      { tier: 'fast', timeoutMs: 9000 }
    ]);
  } finally {
    restoreGrok();
    if (prev) require.cache[draftPath] = prev;
    else delete require.cache[draftPath];
  }
});

test('english UI drops Japanese hypothesis text', () => {
  const { customerFacingReason } = require('../src/autonomous_promo_ai');
  const reason = customerFacingReason({
    hypothesis: {
      who: '到達率が直近の水準から大きく下がった場合',
      why: '同じ確認を続ける',
      proof: 'ページに書いてある手順'
    }
  }, 'en');
  assert.equal(reason, 'Written from verified facts on the registered page and this account state.');
  assert.equal(/[ぁ-んァ-ン一-龯]/.test(reason), false);
  const mixed = customerFacingReason({
    hypothesis: { who: 'operators who check one step', why: '到達率が下がった', proof: 'the registered page names the step' }
  }, 'en');
  assert.match(mixed, /Who: operators who check one step/);
  assert.equal(mixed.includes('到達率'), false);
});

test('launch progress follows uiLang instead of the post language', () => {
  const script = `
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    const users = new Map();
    users.set('WEB-GOOGLE-D12E2479A76266AEA2B4', {
      xOfficialCredentials: { encrypted: 'x', iv: 'y', tag: 'z' },
      xUsername: 'VeloxSystemsV4',
      autopilotConsent: { version: 1, account: 'id:123456', granted: true },
      autopilotPaused: false
    });
    function stub(modulePath, exports) {
      const resolved = require.resolve(modulePath);
      require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
    }
    stub('./src/firestore', { db: { collection() { return { doc(id) { return {
      async get() { return { exists: users.has(id), data: () => users.get(id) }; },
      async set(data, options) { users.set(id, { ...(options && options.merge ? (users.get(id) || {}) : {}), ...data }); }
    }; } }; } } });
    stub('./src/auth_service', { resolveSessionUser: async () => ({ userId: 'WEB-GOOGLE-D12E2479A76266AEA2B4' }) });
    const official = require('./src/official_api_client');
    stub('./src/official_api_client', { ...official, decryptCredentials: () => ({ id: '123456', username: 'VeloxSystemsV4' }) });
    const seen = [];
    stub('./src/autonomous_promo_ai', {
      launchAutopilotCampaign: async () => ({}),
      prepareNextPost: async (_userId, options) => {
        seen.push({ lang: options.lang, uiLang: options.uiLang });
        if (options.onProgress) options.onProgress({ step: 'draft_brief', title: options.uiLang === 'en' ? 'Planning angle and structure' : '切り口と構成方針を整理しています', detail: '' });
        return { jobId: 'job-test', timeSlot: 'evening', customerReason: options.uiLang === 'en' ? 'Written from verified facts on the registered page and this account state.' : '登録ページから書いています。' };
      },
      ensureNextPost: async () => ({}),
      reDeliberateAutopilotJobs: async () => ({}),
      reThinkSingleJob: async () => ({}),
      generateInstantPreviewPosts: async () => ({}),
      fetchUrlSummary: async () => ({}),
      isValidTimeZone: () => true,
      dateAtTimeInZone: () => new Date(),
      harvestTweetMetricsAndEvolveKnowledge: async () => ({}),
      generateWeeklyCouncilReport: async () => ({}),
      cancelOtherPendingJobs: async () => ({})
    });
    const { registerHybridSaasRoutes } = require('./src/hybrid_saas_routes');
    const postRoutes = new Map();
    const getRoutes = new Map();
    registerHybridSaasRoutes({
      post(path, handler) { postRoutes.set(path, handler); },
      get(path, handler) { getRoutes.set(path, handler); }
    }, { runWorker: false });
    const launch = postRoutes.get('/api/autopilot/launch');
    const status = getRoutes.get('/api/autopilot/launch-status');
    const run = async (body) => {
      const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      await launch({ body, headers: {}, query: {} }, res);
      await new Promise(resolve => setImmediate(resolve));
      const view = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      await status({ body: {}, headers: {}, query: {} }, view);
      return { launch: res.body, status: view.body };
    };
    (async () => {
      const jaUi = await run({ lang: 'en', uiLang: 'ja', targetUrl: 'https://example.com', userPrompt: '方針' });
      const enUi = await run({ lang: 'ja', uiLang: 'en', targetUrl: 'https://example.com', userPrompt: '方針' });
      process.stdout.write(JSON.stringify({
        jaMessage: jaUi.launch.message,
        jaTitle: jaUi.status.stepTitle,
        jaLogs: (jaUi.status.logs || []).map(row => row.title),
        enMessage: enUi.launch.message,
        enTitle: enUi.status.stepTitle,
        enLogs: (enUi.status.logs || []).map(row => row.title),
        seen
      }));
    })().catch(err => { console.error(err); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 20000
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.jaMessage, '登録ページとこのアカウントから、次の1投稿を準備しています。');
  assert.equal(result.jaTitle, '次の1投稿を予約しました');
  assert.equal(result.jaLogs.includes('切り口と構成方針を整理しています'), true);
  assert.equal(result.jaLogs.some(title => /[A-Za-z]{4,}/.test(title)), false);
  assert.equal(result.enMessage, 'Preparing one next post from the registered page and this account.');
  assert.equal(result.enTitle, 'The next post is scheduled');
  assert.equal(result.enLogs.includes('Planning angle and structure'), true);
  assert.deepEqual(result.seen, [
    { lang: 'en', uiLang: 'ja' },
    { lang: 'ja', uiLang: 'en' }
  ]);
});
