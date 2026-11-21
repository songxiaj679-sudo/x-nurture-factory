'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveEditorialStance } = require('../src/lp_knowledge_extractor');
const { runDeterministicAudit } = require('../src/draft_verifier');
const {
  criticStanceLine,
  candidatePrompt,
  briefPrompt,
  systemRules,
  sanitizeBriefTension,
  mergeOwnerSparks,
  pickOwnerSpark,
  markOwnerSparkUsed,
  resolveSourceType
} = require('../src/next_post_draft');

test('a sourced number passes, and an article note stays out when a first-hand note is present', () => {
  const longEnough = '先月チームで見直した予約投稿50件のうち、文面を丁寧に直したのに反応がゼロだった7件は、すべて1行目が説明調だった。整えたつもりでも、相手が分からない文は残る。';
  const base = {
    lang: 'ja',
    accountState: { maxChars: 280, postShape: 'single', singleOnly: true },
    genes: { format: 'narrative_insight' },
    enforceReadability: false
  };
  const kept = runDeterministicAudit({ tweets: [longEnough] }, {
    ...base,
    ownerSpark: { text: '予約投稿50件のうち反応がゼロだった7件は、1行目が説明調だった。' }
  });
  assert.equal(kept.reasons.includes('ungrounded_number:50件'), false);
  assert.equal(kept.reasons.some(reason => reason.startsWith('ungrounded_number')), false);
  const invented = runDeterministicAudit({ tweets: ['同じ見直しで99%は別の原因だった。文面を直す前に、1行目の相手を先に残す。'] }, base);
  assert.equal(invented.reasons.some(reason => reason.startsWith('ungrounded_number')), true);
  const spark = { text: '予約投稿50件のうち7件は1行目が説明調だった。' };
  const card = { sourceName: '外部記事', coreFact: 'ARTICLEFACT99を全部見る。', mechanism: '仕組み', actionableTakeaway: '次の確認' };
  const plan = { topicRing: 'ring1_craft' };
  const withSpark = candidatePrompt({
    isEn: false, isolateLpContext: true, ownerSpark: spark, topicSource: card,
    sourceDossier: { currentDebate: 'OLDDOSSIER' }, masterPlan: plan,
    accountState: { maxChars: 280 }, shape: { count: 1 }
  });
  const brief = briefPrompt({
    isEn: false, isolateLpContext: true, ownerSpark: spark, topicSource: card,
    sourceDossier: { currentDebate: 'OLDDOSSIER' }, masterPlan: plan
  });
  assert.equal(withSpark.includes('ARTICLEFACT99'), false);
  assert.equal(withSpark.includes('OLDDOSSIER'), false);
  assert.equal(brief.includes('ARTICLEFACT99'), false);
  assert.equal(brief.includes('OLDDOSSIER'), false);
  assert.match(withSpark, /1つの気づきをまっすぐ語る/);
  assert.match(withSpark, /同じ話題と同じ文体/);
  assert.equal(withSpark.includes('入口の前から一度だけ見る'), false);
  assert.equal(withSpark.includes('言い換えずにそのまま置く'), false);
  const rules = systemRules(false);
  assert.match(rules, /英語の直訳のような硬い言い回し/);
  assert.equal(rules.includes('挽き目'), false);
  assert.equal(rules.includes('切り戻し'), false);
  const quoted = '先月チームで見直した予約投稿50本のうち、反応がゼロだった7本は、すべて1行目が「〜について解説します」調だった。読む人は1行目だけで自分の話かどうかを決める。';
  const withQuote = runDeterministicAudit({ tweets: [quoted] }, {
    ...base,
    ownerSpark: { text: '予約投稿50本のうち7本は、1行目が「〜について解説します」調だった。' }
  });
  assert.equal(withQuote.reasons.includes('ai_slop'), false);
  const otherSlop = runDeterministicAudit({ tweets: [`${quoted}これはゲームチェンジャーです。`] }, {
    ...base,
    ownerSpark: { text: '予約投稿50本のうち7本は、1行目が「〜について解説します」調だった。' }
  });
  assert.equal(otherSlop.reasons.includes('ai_slop'), true);
});

test('the critic sees a short stance only when the account has one', () => {
  const blank = criticStanceLine({});
  assert.equal(blank, '');
  const line = criticStanceLine({
    brandKnowledge: { editorialStance: { rejectedNorm: '投稿を増やすほど良い', coreBelief: '残す一文を先に決める' } },
    ownerSpark: { text: '自社の送信前確認で14%が押し戻された' }
  });
  const facts = line.split('\n')[0];
  assert.equal(Array.from(facts).length <= 180, true);
  assert.match(facts, /投稿を増やすほど良い/);
  assert.match(facts, /14%/);
  assert.match(line, /同業他社名へ入れ替えてもそのまま成立する一般論なら72未満/);
  const prompt = candidatePrompt({
    isEn: false,
    accountState: { maxChars: 280 },
    shape: { count: 1 },
    brief: {},
    ownerSpark: { text: '自社検証の失敗'.repeat(40) }
  });
  const spark = prompt.slice(prompt.indexOf('このアカウント固有の一次体験'));
  assert.equal(Array.from(spark.slice(0, spark.indexOf('\n'))).length <= 250, true);
});

test('an override beats the stored stance and the fallback', () => {
  const override = resolveEditorialStance({
    editorialStance: { rejectedNorm: '保存済みの常識', coreBelief: '保存済みの基準' },
    domainProblems: ['フォールバックの課題です'],
    oneLineMechanism: 'フォールバックの仕組みです'
  }, {
    editorialStanceOverride: { rejectedNorm: 'オーナーが否定する常識', coreBelief: 'オーナーの譲れない基準' }
  });
  assert.equal(override.source, 'override');
  assert.match(override.rejectedNorm, /オーナーが否定する常識/);
  const fallback = resolveEditorialStance({
    domainProblems: ['入口の紙が古いと来た人は閉まる'],
    oneLineMechanism: '休みの変更は入口の紙で先に確認する'
  });
  assert.equal(fallback.source, 'fallback');
});

test('a first-hand number stays grounded, and a used note is not picked again', () => {
  const kept = sanitizeBriefTension({
    tension: '自社検証では14%の差が残った',
    tensionReversesInput: true,
    passesBrandSwap: true
  }, {
    seed: { source: 'audience_pushback', text: '本当に文面だけで足りるのか' },
    topicSource: { coreFact: '確認は入口で一度見る', actionableTakeaway: '日付を書く' },
    ownerSpark: { text: '自社の送信前確認で14%の押し戻しが残った' },
    isEn: false
  });
  assert.match(kept.tension, /14%/);
  const dropped = sanitizeBriefTension({
    tension: '自社検証では14%の差が残った',
    tensionReversesInput: true,
    passesBrandSwap: true
  }, {
    seed: { source: 'audience_pushback', text: '本当に文面だけで足りるのか' },
    topicSource: { coreFact: '確認は入口で一度見る', actionableTakeaway: '日付を書く' },
    isEn: false
  });
  assert.equal(dropped.tension, null);
  const stripped = mergeOwnerSparks([], '詳細は https://example.com/hidden を見て14%が残った', new Date('2026-11-21T00:00:00.000Z'));
  assert.equal(stripped[0].text.includes('http'), false);
  assert.match(stripped[0].text, /14%/);
  const first = mergeOwnerSparks([], '自社の送信前確認で14%が残った\n自社の送信前確認で14%が残った', new Date('2026-11-21T00:00:00.000Z'));
  assert.equal(first.length, 1);
  const used = markOwnerSparkUsed(first, first[0].id, new Date('2026-11-21T01:00:00.000Z'));
  assert.equal(pickOwnerSpark(used, { topicRing: 'ring1_craft' }), null);
  assert.equal(pickOwnerSpark(first, { topicRing: 'ring3_product_bridge' }), null);
  assert.equal(pickOwnerSpark(first, { topicRing: 'ring1_craft' }).id, first[0].id);
  const filled = [];
  for (let index = 0; index < 10; index += 1) {
    filled.push({ id: `old_${index}`, text: `使用済みの体験 ${index}`, createdAt: '2026-11-01T00:00:00.000Z', usedAt: `2026-11-0${index % 9}T00:00:00.000Z` });
  }
  const trimmed = mergeOwnerSparks(filled, '新しい未使用の一次体験です', new Date('2026-11-21T02:00:00.000Z'));
  assert.equal(trimmed.length, 10);
  assert.equal(trimmed.some(item => item.text === '新しい未使用の一次体験です' && !item.usedAt), true);
  assert.equal(['topic_source', 'dossier', 'brand_only'].includes(resolveSourceType(null, null, { topicRing: 'ring3_product_bridge' })), true);
  const promo = fs.readFileSync('src/autonomous_promo_ai.js', 'utf8');
  assert.match(promo, /sourceType: drafted\.sourceType \|\| 'brand_only'/);
  assert.match(promo, /ownerSparkUsed: drafted\.ownerSparkUsed === true/);
  const route = fs.readFileSync('src/hybrid_saas_routes.js', 'utf8');
  const saveStart = route.indexOf("app.post('/api/autopilot/save-setup'");
  const saveBody = route.slice(saveStart, route.indexOf("app.post('/api/autopilot/suggest-personas'"));
  assert.match(saveBody, /mergeOwnerSparks/);
  assert.equal(saveBody.includes('crawlSite'), false);
  assert.equal(saveBody.includes('extractBrandKnowledge'), false);
});

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

test('save-setup stores a spark and a stance without crawling', async () => {
  const storedUsers = new Map();
  stub('../src/firestore', {
    db: {
      collection() {
        return { doc(id) {
          return {
            async set(data, options) {
              const prev = options && options.merge ? (storedUsers.get(id) || {}) : {};
              storedUsers.set(id, { ...prev, ...data });
            },
            async get() {
              return { exists: storedUsers.has(id), data: () => storedUsers.get(id) };
            }
          };
        } };
      }
    }
  });
  stub('../src/auth_service', { resolveSessionUser: async () => ({ userId: 'spark-user' }) });
  stub('../src/stripe_billing_helpers', {});
  stub('../src/ai_deliberation_council', {});
  stub('../src/wise_payment', {});
  stub('../src/official_api_client', {});
  stub('../src/collective_intelligence', {});
  stub('../src/autonomous_promo_ai', { isValidTimeZone: () => true });
  const routePath = require.resolve('../src/hybrid_saas_routes');
  delete require.cache[routePath];
  const { registerHybridSaasRoutes } = require('../src/hybrid_saas_routes');
  const postRoutes = new Map();
  registerHybridSaasRoutes({
    post(path, handler) { postRoutes.set(path, handler); },
    get() {}
  }, { runWorker: false });
  const handler = postRoutes.get('/api/autopilot/save-setup');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({
    body: {
      targetUrl: '',
      userPrompt: '現場の確認を残す',
      ownerSparkInput: '詳細は https://example.com/a を参照。自社で14%が押し戻された',
      editorialStanceOverride: { rejectedNorm: '投稿を増やすほど良い', coreBelief: '残す一文を先に決める' }
    }
  }, res);
  assert.equal(res.statusCode, 200);
  const saved = storedUsers.get('spark-user');
  assert.equal(saved.ownerSparks.length, 1);
  assert.equal(saved.ownerSparks[0].text.includes('http'), false);
  assert.match(saved.ownerSparks[0].text, /14%/);
  assert.equal(saved.ownerSparks[0].usedAt, null);
  assert.match(saved.editorialStanceOverride.rejectedNorm, /投稿を増やすほど良い/);
  assert.equal(res.body.ownerSparkUnused, 1);
});
