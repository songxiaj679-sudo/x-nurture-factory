'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { groundKnowledge, extractBrandKnowledge, resolveEditorialStance } = require('../src/lp_knowledge_extractor');
const { recipeLine } = require('../src/wildcard_evolution');
const { generateAdversarialHooks, planHookBudget, candidatePrompt, hookAngleForChoice, criticSystemRules } = require('../src/next_post_draft');

const pageUrl = 'https://example.com/shop-door';

test('a stored page without a stance does not crawl, and a grounded stance is saved', async () => {
  let calls = 0;
  const cached = {
    schemaVersion: 3,
    outputLang: 'ja',
    sourceUrl: pageUrl,
    extractedAt: new Date().toISOString(),
    oneLineMechanism: '休みの変更は入口の紙で先に確認する。',
    domainProblems: ['入口の紙が古いと、来た人は閉まった店に当たる。'],
    pageTitle: '店の入口',
    pageDescription: '休みの紙を先に見る。',
    pageHeadings: ['入口']
  };
  const result = await extractBrandKnowledge(pageUrl, {
    cachedKnowledge: cached,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, async text() { return '{"success":true}'; } };
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.fromCache, true);
  const fallback = resolveEditorialStance(result.brandKnowledge);
  assert.equal(fallback.source, 'fallback');
  assert.match(fallback.rejectedNorm, /入口の紙/);
  const saved = groundKnowledge({
    oneLineMechanism: '休みの変更は入口の紙で先に確認する。',
    domainProblems: ['入口の紙が古いと、来た人は閉まった店に当たる。'],
    editorialStance: {
      rejectedNorm: '入口の紙が古い習慣を、そのままで良いと思い込む。',
      coreBelief: '休みの変更は入口の紙で先に確認する。',
      neverSays: '他社の入口を詐欺だと決めつける。'
    }
  }, '入口の紙が古いと、来た人は閉まった店に当たる。休みの変更は入口の紙で先に確認する。', '');
  assert.match(saved.editorialStance.rejectedNorm, /入口の紙/);
  assert.equal(saved.editorialStance.coreBelief.includes('入口の紙'), true);
  assert.equal(saved.editorialStance.neverSays, '');
});

test('analogy recipes land by the second sentence in both languages', () => {
  assert.match(recipeLine('wc_cross_domain_analogy', false), /2文目までに必ず現場の一動作へ戻し/);
  assert.match(recipeLine('wc_cross_domain_analogy', true), /Land the analogy back onto one concrete practitioner action by sentence 2/);
  assert.equal(criticSystemRules(false).length, 353);
});

test('the hook duel keeps two fresh lines and skips when the call budget is tight', async () => {
  const recent = '入口の紙が古いと先に閉まる店がある。変えた日だけ見る。';
  const blunt = '紙が古い日は、店に着く前に一度見る。';
  const flip = '良い習慣の紙ほど、古いことに気づきにくい。';
  const scene = '閉まった扉の前で、予定表だけを信じている。';
  const copied = recent.slice(0, 24);
  assert.equal(Array.from(blunt).length >= 15 && Array.from(blunt).length <= 38, true);
  const duel = await generateAdversarialHooks({
    recentTexts: [recent],
    isEn: false,
    payload: {
      hooks: [
        { angle: 'blunt_practitioner', text: blunt, verdict: 'keep', reason: '現場が先に見える' },
        { angle: 'contrarian_flip', text: flip, verdict: 'keep', reason: '常識を一行で返す' },
        { angle: 'scene_friction', text: copied, verdict: 'keep', reason: '直近と似ている' },
        { angle: 'unexpected_analogy', text: '一般的に重要な確認項目です', verdict: 'reject', reason: '優等生メモ調' }
      ]
    }
  });
  assert.deepEqual(duel.hooks.map(hook => hook.angle), ['blunt_practitioner', 'contrarian_flip']);
  assert.equal(duel.rejected[0].text, '一般的に重要な確認項目です');
  assert.equal(duel.hookDuelUsed, true);
  let called = false;
  const skipped = await generateAdversarialHooks({
    allowed: planHookBudget(1, 4),
    complete: async () => { called = true; return '{}'; }
  });
  assert.equal(called, false);
  assert.equal(skipped.skipped, true);
  let calls = 1;
  await generateAdversarialHooks({
    allowed: planHookBudget(calls, 5),
    complete: async () => {
      calls += 1;
      return JSON.stringify({ hooks: [{ angle: 'scene_friction', text: scene, verdict: 'keep', reason: '場面が先' }] });
    }
  });
  calls += 2;
  assert.equal(calls <= 5, true);
  const chosen = hookAngleForChoice({ tweets: [`${blunt}\n\n次に入口を見る。`] }, duel.hooks);
  assert.equal(chosen, 'blunt_practitioner');
  const ring1 = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { count: 1, maxCount: 1 },
    accountState: { maxChars: 140, delivery: 'single' },
    brandKnowledge: { domainProblems: ['入口の紙が古いと、来た人は閉まった店に当たる。'], oneLineMechanism: '休みの変更は入口の紙で先に確認する。' },
    genes: { delivery: 'single' },
    masterPlan: { topicRing: 'ring1_craft' },
    winningHooks: duel.hooks
  });
  assert.match(ring1, /疑う思い込み/);
  assert.match(ring1, /紙が古い日は/);
  const ring3 = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { count: 1, maxCount: 1 },
    accountState: { maxChars: 140, delivery: 'single' },
    brandKnowledge: { domainProblems: ['入口の紙が古いと、来た人は閉まった店に当たる。'], oneLineMechanism: '休みの変更は入口の紙で先に確認する。' },
    genes: { delivery: 'single' },
    masterPlan: { topicRing: 'ring3_product_bridge' }
  });
  assert.equal(ring3.includes('疑う思い込み'), false);
  const promo = fs.readFileSync('src/autonomous_promo_ai.js', 'utf8');
  assert.equal(promo.includes('selectedHookAngle: drafted.selectedHookAngle || null'), true);
  assert.equal(promo.includes('hookDuelUsed: drafted.hookDuelUsed === true'), true);
});
