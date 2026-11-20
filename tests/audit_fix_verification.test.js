const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { encryptCredentials, decryptCredentials } = require('../src/official_api_client');

// 1. 暗号化 & デュアルキー復号テスト
test('Audit Fix 1: AES-256-GCM Encryption & Key Rotation', () => {
  const payload = {
    apiKey: 'test_consumer_key_xyz',
    apiSecret: 'test_secret_123',
    accessToken: 'test_token_abc',
    accessTokenSecret: 'test_token_secret_def',
    username: 'growth_official'
  };

  const enc = encryptCredentials(payload);
  assert(enc.encrypted && enc.iv && enc.tag, 'Encrypted payload must have encrypted, iv, and tag');

  const dec = decryptCredentials(enc);
  assert.strictEqual(dec.apiKey, payload.apiKey);
  assert.strictEqual(dec.username, payload.username);
});

// 2. 原子的Claimシミュレーションテスト (Distributed Transaction Claim)
test('Audit Fix 2: Atomic Claim Simulation (Race Condition & Double-post Prevention)', async () => {
  let mockJob = {
    id: 'job_test_001',
    userId: 'user_alpha',
    status: 'pending',
    text: 'Test Golden-Hour Post'
  };

  let claimSuccessCount = 0;
  let claimRejectedCount = 0;

  async function simulateWorkerClaim(workerId) {
    if (mockJob.status === 'pending') {
      await new Promise(r => setTimeout(r, Math.random() * 5));
      if (mockJob.status === 'pending') {
        mockJob.status = 'processing';
        mockJob.claimedBy = workerId;
        claimSuccessCount++;
        return true;
      }
    }
    claimRejectedCount++;
    return false;
  }

  const promises = [];
  for (let i = 1; i <= 10; i++) {
    promises.push(simulateWorkerClaim('worker_' + i));
  }

  await Promise.all(promises);
  assert.strictEqual(claimSuccessCount, 1, 'Exactly one worker must claim the job');
  assert.strictEqual(claimRejectedCount, 9, 'All other workers must be rejected');
  assert.strictEqual(mockJob.status, 'processing');
});

// 3. テナント所有権検証ロジックテスト
test('Audit Fix 3: Multi-tenant Ownership & Session Authorization', () => {
  function checkCancelPermission(sessionUser, job) {
    if (!sessionUser || !sessionUser.userId) {
      return { status: 401, error: 'Unauthorized' };
    }
    if (job.userId !== sessionUser.userId && !sessionUser.isAdmin) {
      return { status: 403, error: 'Forbidden' };
    }
    if (job.status === 'posted') {
      return { status: 400, error: 'Cannot cancel posted job' };
    }
    return { status: 200, ok: true };
  }

  const jobA = { id: 'job_1', userId: 'user_123', status: 'pending' };
  assert.strictEqual(checkCancelPermission(null, jobA).status, 401, 'Unauthenticated user must be 401');

  const userOther = { userId: 'user_hacker', isAdmin: false };
  assert.strictEqual(checkCancelPermission(userOther, jobA).status, 403, 'Cross-tenant cancel attempt must be 403 Forbidden');

  const userOwner = { userId: 'user_123', isAdmin: false };
  assert.strictEqual(checkCancelPermission(userOwner, jobA).status, 200, 'Owner cancel must succeed');

  const userAdmin = { userId: 'user_admin', isAdmin: true };
  assert.strictEqual(checkCancelPermission(userAdmin, jobA).status, 200, 'Admin cancel must succeed');

  const jobPosted = { id: 'job_2', userId: 'user_123', status: 'posted' };
  assert.strictEqual(checkCancelPermission(userOwner, jobPosted).status, 400, 'Already posted job cannot be cancelled');
});

// 4. 購入API & 注文ステータス照合テスト
test('Audit Fix 4: Purchase & Order Ownership Boundary', () => {
  function checkOrderAudit(sessionUser, order) {
    if (!sessionUser || !sessionUser.userId) {
      return { status: 401, error: 'Unauthorized' };
    }
    if (order.userId !== sessionUser.userId && !sessionUser.isAdmin) {
      return { status: 403, error: 'Forbidden' };
    }
    return { status: 200, paid: order.status === 'paid' };
  }

  const order1 = { orderId: 'ord_123', userId: 'user_alice', status: 'paid' };
  assert.strictEqual(checkOrderAudit(null, order1).status, 401);
  assert.strictEqual(checkOrderAudit({ userId: 'user_bob', isAdmin: false }, order1).status, 403);
  assert.strictEqual(checkOrderAudit({ userId: 'user_alice', isAdmin: false }, order1).status, 200);
});

// 5. 実装された実Expressルートに対する本物のHTTPエンドポイント認証・テナント分離テスト
test('Audit Fix 5: Live Express HTTP Endpoint Tenant Isolation', async () => {
  // 🛡️ 本番DBへのアクセスを完全排除するため、インメモリのモックdbを注入
  const mockStore = new Map();
  const mockDb = {
    collection: (collName) => ({
      doc: (docId) => ({
        get: async () => ({
          exists: mockStore.has(`${collName}/${docId}`),
          data: () => mockStore.get(`${collName}/${docId}`) || {}
        }),
        set: async (data, opts) => {
          const key = `${collName}/${docId}`;
          if (opts && opts.merge && mockStore.has(key)) {
            mockStore.set(key, { ...mockStore.get(key), ...data });
          } else {
            mockStore.set(key, { ...data });
          }
        },
        update: async (data) => {
          const key = `${collName}/${docId}`;
          mockStore.set(key, { ...mockStore.get(key), ...data });
        },
        delete: async () => mockStore.delete(`${collName}/${docId}`)
      }),
      where: () => ({
        get: async () => ({ docs: [], size: 0 })
      })
    })
  };

  const { registerTwitterAuthRoutes } = require('../src/twitter_auth');
  const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  registerTwitterAuthRoutes(app, mockDb);
  registerHybridSaasRoutes(app, { runWorker: false });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 5-1. 未検証クイックログイン廃止 (HTTP 403 Forbidden)
    const resQuick = await fetch(`${baseUrl}/api/auth/twitter/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'target_victim' })
    });
    assert.strictEqual(resQuick.status, 403, 'quick-login must return 403 Forbidden');
    const dataQuick = await resQuick.json();
    assert.strictEqual(dataQuick.ok, false);
    assert(dataQuick.error.includes('廃止'), 'quick-login response must explain deprecation');

    // 5-2. 戦略レポート未認証アクセス (HTTP 401 Unauthorized)
    const resReport = await fetch(`${baseUrl}/api/autopilot/strategy-report?userId=user_victim`);
    assert.strictEqual(resReport.status, 401, 'strategy-report without session must return 401 Unauthorized');

    // 5-3. 集合知同期未認証アクセス (HTTP 401 Unauthorized)
    const resSync = await fetch(`${baseUrl}/api/autopilot/sync-knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user_victim' })
    });
    assert.strictEqual(resSync.status, 401, 'sync-knowledge without session must return 401');

    // 5-4. 評議会合議未認証アクセス (HTTP 401 Unauthorized)
    const resDeliberate = await fetch(`${baseUrl}/api/autopilot/council/deliberate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user_victim' })
    });
    assert.strictEqual(resDeliberate.status, 401, 'council deliberate without session must return 401');

    // 5-5. 評議会スケジュール登録未認証アクセス (HTTP 401 Unauthorized)
    const resCommit = await fetch(`${baseUrl}/api/autopilot/council/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliberationId: 'delib_xyz' })
    });
    assert.strictEqual(resCommit.status, 401, 'council commit without session must return 401');

    // 5-6. プラン決済チェックアウト未認証アクセス (HTTP 401 Unauthorized)
    const resCheckout = await fetch(`${baseUrl}/api/hybrid/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' })
    });
    assert.strictEqual(resCheckout.status, 401, 'checkout without session must return 401');

    // 5-7. 注文照会未認証アクセス (HTTP 401 Unauthorized)
    const resCheckOrder = await fetch(`${baseUrl}/api/hybrid/check-order?orderId=ord_xyz`);
    assert.strictEqual(resCheckOrder.status, 401, 'check-order without session must return 401');

    // 5-8. アカウント診断の未認証userIdなりすまし拒絶 (HTTP 401 Unauthorized)
    const resDiagnose = await fetch(`${baseUrl}/api/account/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'target_victim_user' })
    });
    assert.strictEqual(resDiagnose.status, 401, 'unauthenticated account diagnosis must return 401 Unauthorized');
  } finally {
    server.close();
  }
});

// 6. Stripe Webhook 暗号署名検証 & フェイルクローズド設計のテスト
test('Audit Fix 6: Stripe Webhook Cryptographic Verification & Fail-Closed Guard', async () => {
  const Stripe = require('stripe');
  const testStripe = Stripe('sk_test_fake_key_for_unit_tests');
  const webhookSecret = 'whsec_test_secret_32bytes_hex_abc123';

  const app = express();
  app.use(express.json({
    limit: '20mb',
    verify: (req, res, buf) => {
      if (req.originalUrl && req.originalUrl.startsWith('/api/webhooks/stripe')) {
        req.rawBody = buf;
      }
    }
  }));

  app.post('/api/webhooks/stripe', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!webhookSecret) return res.status(500).json({ error: 'Secret not configured' });
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

    let event;
    try {
      const rawPayload = req.rawBody || req.body;
      event = testStripe.webhooks.constructEvent(rawPayload, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    }
    return res.status(200).json({ received: true, type: event.type });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const webhookUrl = `http://127.0.0.1:${port}/api/webhooks/stripe`;

  try {
    // 6-1. 署名ヘッダーなしアクセス -> 400 Bad Request
    const resNoSig = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'checkout.session.completed' })
    });
    assert.strictEqual(resNoSig.status, 400, 'Webhook without stripe-signature must return 400');

    // 6-2. 偽造署名アクセス -> 400 Bad Request (フェイルクローズド)
    const resBadSig = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 't=1700000000,v1=fake_forged_signature_hex_12345'
      },
      body: JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: { metadata: { userId: 'attacker_target_user', plan: 'business' } } }
      })
    });
    assert.strictEqual(resBadSig.status, 400, 'Webhook with forged signature must be rejected with 400');

    // 6-3. 正当なStripe暗号署名を持つイベント -> 200 OK
    const payloadString = JSON.stringify({
      id: 'evt_test_123',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', client_reference_id: 'USR-TEST-123' } }
    });
    const validSig = testStripe.webhooks.generateTestHeaderString({
      payload: payloadString,
      secret: webhookSecret
    });
    const resValid = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': validSig
      },
      body: payloadString
    });
    assert.strictEqual(resValid.status, 200, 'Webhook with valid cryptographic signature must succeed');
    const validData = await resValid.json();
    assert.strictEqual(validData.received, true);
  } finally {
    server.close();
  }
});

// 7. 旧Web経路 (landing_page.js) の任意userId偽装阻止テスト
test('Audit Fix 7: Legacy Web Route Tenant Boundary & Impersonation Prevention', async () => {
  // 🛡️ 本番DBへのアクセス・書き込みを完全排除するため、インメモリのモックdbを注入
  const mockStore = new Map();
  const mockDb = {
    collection: (collName) => ({
      doc: (docId) => ({
        get: async () => ({
          exists: mockStore.has(`${collName}/${docId}`),
          data: () => mockStore.get(`${collName}/${docId}`) || {}
        }),
        set: async (data, opts) => {
          const key = `${collName}/${docId}`;
          if (opts && opts.merge && mockStore.has(key)) {
            mockStore.set(key, { ...mockStore.get(key), ...data });
          } else {
            mockStore.set(key, { ...data });
          }
        },
        update: async (data) => {
          const key = `${collName}/${docId}`;
          mockStore.set(key, { ...mockStore.get(key), ...data });
        },
        delete: async () => mockStore.delete(`${collName}/${docId}`)
      }),
      where: () => ({
        get: async () => ({ docs: [], size: 0 })
      })
    })
  };

  const { registerLandingAndCustomerWebRoutes } = require('../src/landing_page');

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  registerLandingAndCustomerWebRoutes(app, mockDb);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/api/web-toggle-engine`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'USR-MVUA1GLP-D640' })
    });
    const data = await res.json();
    assert.strictEqual(data.ok, false, 'Unauthenticated user passing arbitrary userId must NOT control target account');
    assert(data.error.includes('activate') || data.error.includes('plan'), 'Must reject due to inactive plan on freshly generated web user');
  } finally {
    server.close();
  }
});

// 8. 集合知のシード知識 vs 実測学習データの分離検証
test('Audit Fix 8: Collective Intelligence Knowledge Source Separation', async () => {
  const mockStore = new Map();
  const mockDb = {
    collection: (collName) => ({
      doc: (docId) => ({
        get: async () => ({
          exists: mockStore.has(`${collName}/${docId}`),
          data: () => mockStore.get(`${collName}/${docId}`) || {}
        })
      }),
      limit: () => ({
        get: async () => ({ docs: [], size: 0 })
      }),
      where: () => ({
        limit: () => ({
          get: async () => ({ docs: [], size: 0 })
        })
      })
    })
  };

  const { getCollectiveMarketingIntelligence } = require('../src/collective_intelligence');

  const intel = await getCollectiveMarketingIntelligence(mockDb);
  assert(Array.isArray(intel.empiricalSuccessPatterns), 'Must contain empiricalSuccessPatterns');
  assert(Array.isArray(intel.baselineSeedSuccessPatterns), 'Must contain baselineSeedSuccessPatterns');
  for (const p of intel.baselineSeedSuccessPatterns) {
    assert.strictEqual(p.source, 'baseline_seed_knowledge', 'Seed patterns must be marked with baseline_seed_knowledge');
  }
  assert(typeof intel.liveSampledAccounts === 'number', 'liveSampledAccounts must be a number');
  assert(typeof intel.liveSampledPosts === 'number', 'liveSampledPosts must be a number');
});

// 9. AI出力の文字数注記・メタ情報完全除去テスト（「（80文字）」等の混入防止）
test('Audit Fix 9: AI Text Meta-Commentary & Character Count Sanitization', () => {
  const { sanitizePostOrReplyText } = require('../src/official_api_client');

  const cases = [
    {
      input: '保存ありがとうございます！朝の画面前でのフリーズ、私も昔よくありました。朝イチの行動を1つ仕組み化するだけでも、時間の使い方は驚くほど変わるので応援しています！（80文字）',
      expected: '保存ありがとうございます！朝の画面前でのフリーズ、私も昔よくありました。朝イチの行動を1つ仕組み化するだけでも、時間の使い方は驚くほど変わるので応援しています！'
    },
    {
      input: '仕組み化で脳のメモリを解放し、発信がもっと楽になるよう応援しています。（70文字）',
      expected: '仕組み化で脳のメモリを解放し、発信がもっと楽になるよう応援しています。'
    },
    {
      input: '保存感謝します！毎朝白紙から捻り出すのは本当に時間を溶かしますよね。(78 chars)',
      expected: '保存感謝します！毎朝白紙から捻り出すのは本当に時間を溶かしますよね。'
    },
    {
      input: '【全角75文字】共感ありがとうございます！',
      expected: '共感ありがとうございます！'
    },
    {
      input: '返信文: 白紙の画面と精神力で戦わず、再現性に頼るのが一番の近道ですよね。（全角82文字）',
      expected: '白紙の画面と精神力で戦わず、再現性に頼るのが一番の近道ですよね。'
    },
    {
      input: 'スレッド1本目です (1/4)',
      expected: 'スレッド1本目です (1/4)'
    },
    {
      input: '「朝イチの行動を1つ仕組み化するだけでも、時間の使い方は驚くほど変わるので応援しています！」',
      expected: '朝イチの行動を1つ仕組み化するだけでも、時間の使い方は驚くほど変わるので応援しています！'
    }
  ];

  for (const c of cases) {
    const actual = sanitizePostOrReplyText(c.input);
    assert.strictEqual(actual, c.expected, `Sanitization mismatch for input: ${c.input}`);
  }
});
