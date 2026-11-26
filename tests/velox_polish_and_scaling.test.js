'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('draftNextPostText rejects a critic score below 72 when repair returns no usable draft', async () => {
  const validA = '現場で毎日ログを見直して気づいたのですが、投稿前に読者の悩みと手順を一つだけ絞る方が反応は安定します。遠回りに見えても地道な記録が信頼になります。';
  const validB = '仕組みを作るときに一番効いたのは、最初から完璧な構成を追わずに小さな検証を回すことでした。短い改善を積み重ねると無理なく運用が続いていきます。';
  let callCount = 0;
  const restoreGrok = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText() {
      callCount += 1;
      if (callCount === 1) {
        return {
          modelName: 'grok-brief-mock',
          text: JSON.stringify({
            offer: '実務の記録を残す運用',
            reader: 'SNS担当者',
            scene: '日々の投稿作成前',
            voice: '落ち着いた実務家',
            thisPost: '手順を一つに絞る大切さ',
            doNot: '誇張しない'
          })
        };
      }
      if (callCount === 2) {
        return {
          modelName: 'grok-mock',
          text: JSON.stringify({
            candidates: [
              { id: 'a', angle: 'observation', tweets: [validA] },
              { id: 'b', angle: 'lesson', tweets: [validB] }
            ]
          })
        };
      }
      if (callCount === 3) {
        return {
          modelName: 'grok-critic-mock',
          text: JSON.stringify({ scores: [{ id: 'a', score: 62 }, { id: 'b', score: 58 }] })
        };
      }
      return { modelName: 'grok-repair-mock', text: '{}' };
    }
  });
  const nextPostDraftPath = require.resolve('../src/next_post_draft');
  const prevNextPostDraft = require.cache[nextPostDraftPath];
  delete require.cache[nextPostDraftPath];
  try {
    const { draftNextPostText } = require('../src/next_post_draft');
    await assert.rejects(() => draftNextPostText({
      lang: 'ja',
      userPrompt: '実務の運用メモを落ち着いて書く',
      accountState: { maxChars: 140, postShape: 'single', singleOnly: true }
    }), /検証を通る投稿案が無かった/);
    assert.equal(callCount, 4);
  } finally {
    restoreGrok();
    if (prevNextPostDraft) require.cache[nextPostDraftPath] = prevNextPostDraft;
    else delete require.cache[nextPostDraftPath];
  }
});

test('english draft repairs japanese_in_english into an english-only post', async () => {
  const japanese = '手順を一つに絞ると投稿前の確認が安定します。読者が次に見る場所を一つ残すと、次の投稿も同じ型で書けます。確認場所を先に残すほうが現場では続きやすいです。';
  const english = 'A useful checkpoint is to keep one concrete workflow note before you publish. A short record of the next step is easier to reuse than a long feature list.';
  const prompts = [];
  let callCount = 0;
  const restoreGrok = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt, systemPrompt }) {
      callCount += 1;
      prompts.push(`${systemPrompt || ''}\n${prompt}`);
      if (callCount === 1) {
        return { modelName: 'grok-brief-mock', text: JSON.stringify({ offer: 'one checkpoint', reader: 'operator', thisPost: 'keep one note' }) };
      }
      if (callCount === 2) {
        return { modelName: 'grok-mock', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [japanese] }, { id: 'b', tweets: [`「${japanese}」`] }] }) };
      }
      if (String(prompt || '').includes('light_review')) {
        return { modelName: 'grok-repair-critic-mock', text: JSON.stringify({ scores: [{ id: 'a', score: 84, weakness: 'the checkpoint is still generic', scrollStopHook: 20, saveUtility: 21, strangerClarity: 22, craftAndTruth: 21 }] }) };
      }
      return { modelName: 'grok-repair-mock', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [english] }] }) };
    }
  });
  const nextPostDraftPath = require.resolve('../src/next_post_draft');
  const prevNextPostDraft = require.cache[nextPostDraftPath];
  delete require.cache[nextPostDraftPath];
  try {
    const { draftNextPostText } = require('../src/next_post_draft');
    const tweets = await draftNextPostText({
      lang: 'en',
      userPrompt: '日本語の運用方針です。手順を一つに絞って英語で書いてください。',
      recentPosts: ['過去の日本語投稿', 'An older English note about keeping the page URL visible in the bio.'],
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true }
    });
    assert.deepEqual(tweets, [english]);
    assert.equal(callCount, 4);
    assert.match(prompts[1], /hiragana, katakana, kanji/);
    assert.match(prompts[2], /CRITICAL: Previous output contained Japanese characters/);
    assert.match(prompts[0], /日本語の運用方針です/);
    assert.doesNotMatch(prompts[0], /過去の日本語投稿/);
  } finally {
    restoreGrok();
    if (prevNextPostDraft) require.cache[nextPostDraftPath] = prevNextPostDraft;
    else delete require.cache[nextPostDraftPath];
  }
});

test('Top page hero cancel assurance, dashboard plan modal, instant cancel banner, and preparing queue state', () => {
  const funnel = fs.readFileSync(path.join(__dirname, '../views/funnel_index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  const shop = fs.readFileSync(path.join(__dirname, '../src/shop.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/hybrid_saas_routes.js'), 'utf8');

  const assuranceMatches = funnel.match(/hero_cancel_assurance/g) || [];
  assert.ok(assuranceMatches.length >= 3, `Expected hero_cancel_assurance in HTML + JA + EN, found ${assuranceMatches.length}`);
  assert.match(funnel, /管理画面のボタン1つでいつでも解約できます/);

  assert.match(dashboard, /@media \(max-width: 640px\)/);
  assert.match(dashboard, /const notice = document\.getElementById\('secPlansCurrentNotice'\);/);
  assert.match(dashboard, /button\.style\.display = paid \? '' : 'none';/);
  assert.match(dashboard, /期間中に管理画面のボタン1つで解約すれば料金は一切かかりません/);
  assert.match(dashboard, /id="trialBannerCard"|trialBannerCard/);
  assert.match(dashboard, /まで無料でお使いいただけます/);
  assert.match(dashboard, /ただいま次の投稿を作成しています\.\.\./);
  assert.equal(dashboard.includes("ad.username || 'user'"), false);

  assert.match(shop, /parseBillingInstantMs/);
  assert.match(shop, /まで無料でお使いいただけます/);
  assert.match(shop, /id="trialBannerCard"/);
  assert.match(shop, /\{\{TRIAL_END_DATE_JA\}\}/);
  assert.match(routes, /accountDiagnosis\.username = live\?\.username \|\| uData\.xUsername \|\| uData\.screenName;/);
});

test('Autopilot worker scales to 12 jobs/tick in concurrent chunks and replenishes up to 16 active paid accounts skipping paused/unpaid', async () => {
  const jobs = new Map();
  const users = new Map();
  const posted = [];
  const replenished = [];
  const consent = { version: 1, account: 'username:mock', granted: true };

  for (let i = 0; i < 15; i++) {
    const id = `job-${String(i).padStart(3, '0')}`;
    const userId = `u-${String(i).padStart(3, '0')}`;
    users.set(userId, { xOfficialCredentials: 'mock', xUsername: 'VeloxSystemsV4', planId: 'pro', planStatus: 'active', autopilotConsent: consent });
    jobs.set(id, {
      userId,
      status: 'pending',
      text: `scaled-post-${i}`,
      isHumanOverride: true,
      scheduledAt: new Date('2020-01-01T00:00:00Z')
    });
  }
  for (let i = 0; i < 25; i++) {
    const id = `cust-${String(i).padStart(3, '0')}`;
    if (i < 5) users.set(id, { planId: 'free', planStatus: 'free', xUsername: 'UnpaidUser' });
    else if (i < 7) users.set(id, { planId: 'pro', planStatus: 'active', autopilotPaused: true });
    else users.set(id, { planId: 'pro', planStatus: 'active', autopilotPaused: false });
  }

  function makeQuery(collectionMap, after = null, pageSize = 50, onlyPending = false) {
    return {
      where() { return this; },
      orderBy() { return this; },
      limit(n) { return makeQuery(collectionMap, after, n, onlyPending); },
      startAfter(doc) { return makeQuery(collectionMap, doc.id, pageSize, onlyPending); },
      async get() {
        const docs = [...collectionMap.entries()]
          .filter(([id, data]) => (!onlyPending || data.status === 'pending') && (after === null || id > after))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, pageSize)
          .map(([id, data]) => ({ id, data: () => ({ ...data }) }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
  }

  const fakeDb = {
    collection(name) {
      if (name === 'autopilot_jobs') {
        return {
          ...makeQuery(jobs, null, 50, true),
          doc(id) {
            return {
              id,
              async get() {
                const data = jobs.get(id);
                return { exists: Boolean(data), data: () => ({ ...data }) };
              },
              async update(fields) {
                Object.assign(jobs.get(id), fields);
              }
            };
          }
        };
      }
      if (name === 'saas_users') {
        return {
          ...makeQuery(users, null, 100, false),
          doc(id) {
            return {
              id,
              async get() {
                const data = users.get(id);
                return { exists: Boolean(data), data: () => ({ ...data }) };
              },
              async update(fields) {
                Object.assign(users.get(id), fields);
              }
            };
          }
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
    async runTransaction(fn) {
      return fn({
        get: ref => ref.get(),
        update: (ref, fields) => ref.update(fields)
      });
    }
  };

  const routesPath = require.resolve('../src/hybrid_saas_routes');
  const prevRoutes = require.cache[routesPath];
  delete require.cache[routesPath];
  const restores = [
    withStub('../src/firestore', { db: fakeDb }),
    withStub('../src/official_api_client', {
      decryptCredentials: () => ({ username: 'mock' }),
      async postOfficialTweet(_c, text) {
        posted.push(text);
        return { ok: true, tweetId: String(posted.length), tweetUrl: 'https://example.invalid/post' };
      },
      async registerBoostCampaign() { return null; },
      async syncAllActiveCustomersPostMetrics() { return { synced: 0 }; }
    }),
    withStub('../src/collective_intelligence', {}),
    withStub('../src/autonomous_promo_ai', {
      async ensureNextPost(userId) {
        replenished.push(userId);
        return { jobId: `new-${userId}` };
      }
    }),
    withStub('../src/ai_deliberation_council', {}),
    withStub('../src/wise_payment', {}),
    withStub('../src/auth_service', {})
  ];

  const origJobsPerTick = process.env.AUTOPILOT_JOBS_PER_TICK;
  const origConcurrency = process.env.AUTOPILOT_JOB_CONCURRENCY;
  const origInterval = global.setInterval;
  const origTimeout = global.setTimeout;
  const origLog = console.log;
  let runnerTick = null;
  let replenishTick = null;
  try {
    process.env.AUTOPILOT_JOBS_PER_TICK = '12';
    process.env.AUTOPILOT_JOB_CONCURRENCY = '4';
    global.setInterval = (cb, delay) => {
      if (delay === 60 * 1000) runnerTick = cb;
      if (delay === 2 * 60 * 1000) replenishTick = cb;
      return {};
    };
    global.setTimeout = () => ({});
    console.log = () => {};

    const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
    registerHybridSaasRoutes({ post() {}, get() {} });
    assert.equal(typeof runnerTick, 'function');
    assert.equal(typeof replenishTick, 'function');

    await runnerTick();
    assert.equal(posted.length, 12);

    replenished.length = 0;
    await replenishTick();
    assert.equal(replenished.length, 16);
    assert.ok(replenished.every(id => id.startsWith('cust-') && Number(id.slice(5)) >= 7));
  } finally {
    if (origJobsPerTick === undefined) delete process.env.AUTOPILOT_JOBS_PER_TICK;
    else process.env.AUTOPILOT_JOBS_PER_TICK = origJobsPerTick;
    if (origConcurrency === undefined) delete process.env.AUTOPILOT_JOB_CONCURRENCY;
    else process.env.AUTOPILOT_JOB_CONCURRENCY = origConcurrency;
    global.setInterval = origInterval;
    global.setTimeout = origTimeout;
    console.log = origLog;
    restores.reverse().forEach(r => r());
    if (prevRoutes) require.cache[routesPath] = prevRoutes;
    else delete require.cache[routesPath];
  }
});

test('Auto-reply cooldown protects app key on 429/226 and blocks repeated openings', async () => {
  const { shouldTripAutoReplyCooldown, composeInboundReply } = require('../src/auto_reply_policy');
  assert.equal(shouldTripAutoReplyCooldown('HTTP 429 Too Many Requests'), true);
  assert.equal(shouldTripAutoReplyCooldown('Error 226: this request looks automated'), true);
  assert.equal(shouldTripAutoReplyCooldown('The user used for authentication is suspended'), false);

  const dup = await composeInboundReply({
    user: { brandContextNotes: '公式ページの手順を公開しています。' },
    mention: { text: '使い方を教えてください' },
    recentReplies: ['お問い合わせありがとうございます。公式の手順をご確認ください。'],
    completeText: async () => ({ text: 'お問い合わせありがとうございます。別のご質問ですね。' })
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'skipped_draft_error');
});

test('Secondary workspace preserves userId and owner sessionToken cleanly', async () => {
  const { resolveSessionUser } = require('../src/auth_service');
  const docs = {
    'owner-1': { userId: 'owner-1', sessionToken: 'tok-owner', email: 'a@example.com' },
    'WS-sub-1': { ownerUid: 'owner-1', workspaceLabel: 'Sub X', planId: 'free', planStatus: 'free' }
  };
  const mockDb = {
    collection(name) {
      assert.equal(name, 'saas_users');
      return {
        where(field, _op, val) {
          assert.equal(field, 'sessionToken');
          return {
            limit() { return this; },
            async get() {
              const found = Object.entries(docs)
                .filter(([, d]) => d.sessionToken === val)
                .map(([id, d]) => ({ id, data: () => d }));
              return { empty: found.length === 0, docs: found };
            }
          };
        },
        doc(id) {
          return {
            async get() {
              return { exists: Boolean(docs[id]), id, data: () => docs[id] };
            }
          };
        }
      };
    }
  };
  const resolved = await resolveSessionUser(mockDb, {
    headers: { cookie: 'xcloud_sess=tok-owner; velox_ws=WS-sub-1' }
  });
  assert.equal(resolved.userId, 'WS-sub-1');
  assert.equal(resolved.ownerUid, 'owner-1');
  assert.equal(resolved.sessionToken, 'tok-owner');

  const shopSrc = fs.readFileSync(path.join(__dirname, '../src/shop.js'), 'utf8');
  assert.match(shopSrc, /userId: uData\.userId \|\| userSnap\.id/);

  const funnel = fs.readFileSync(path.join(__dirname, '../views/funnel_index.html'), 'utf8');
  assert.ok((funnel.match(/hero_telem3_value/g) || []).length >= 3);

  const dashboard = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  assert.match(dashboard, /"＋ X追加": "＋ Add X"/);
  assert.match(dashboard, /"✨ おまかせ自動設定": "✨ Auto-Setup"/);
  assert.match(dashboard, /"💬 読者からの返信・メンション": "💬 Reader Replies & Mentions"/);
  assert.match(dashboard, /uiLang='\s*\+\s*encodeURIComponent/);

  const { trustGoalStatus } = require('../src/growth_phase');
  const enUi = trustGoalStatus({ aiTargetLang: 'ja', uiLang: 'en' });
  assert.match(enUi.situation, /This account currently has/);

  assert.equal(shopSrc.includes('btnToggleAutopilotPause'), false);
  assert.equal(dashboard.includes('btnToggleAutopilotPause'), false);
  assert.equal(dashboard.includes('{{CONFIGURED_BRAND_CONTEXT_NOTES}}'), true);
  assert.equal(dashboard.includes('{{CONFIGURED_NG_TOPICS}}'), true);
  assert.equal(dashboard.includes('{{AUTO_REPLY_ENABLED}}'), true);
  assert.equal(dashboard.includes('id="usageGuideOverlay"'), true);
  assert.equal(dashboard.includes('id="editDraftModalOverlay"'), true);
  assert.match(dashboard, /<details id="advancedSettingsDetails" class="mb-6">/);
  assert.ok(dashboard.indexOf('id="advancedSettingsDetails"') < dashboard.indexOf('id="secMentions"'));
  assert.equal(dashboard.includes('id="autopilotNextSlotSummary"'), true);
  assert.equal(funnel.includes('https://developer.x.com/exhibit/veloxpostcloud'), true);
  assert.ok((funnel.match(/official_exhibit_btn/g) || []).length >= 3);

  const { runDeterministicAudit } = require('../src/draft_verifier');
  const notesAudit = runDeterministicAudit({
    tweets: ['公式APIによるOAuth連携で安全に運用を続けられます。最初の無料期間14日間の中で実務メモや投稿例を確認しながら、無理のない範囲で日々の手順を整えていくことが大切です。']
  }, {
    lang: 'ja',
    accountState: { postShape: 'single', subscription: 'premium', maxChars: 280 },
    brandContextNotes: '14日間テスト期間あり',
    recentTexts: ['別の話題について整理しました。']
  });
  assert.deepEqual(notesAudit.reasons, []);
});
