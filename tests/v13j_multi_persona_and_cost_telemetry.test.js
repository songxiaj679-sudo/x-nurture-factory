'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decideNextPostMission } = require('../src/velox_master_core');
const { slotsForPlan, nextPlanSlot } = require('../src/plan_post_budget');
const { xWeightedLength, fitsAccountState } = require('../src/customer_post_state');
const { runDeterministicAudit } = require('../src/draft_verifier');
const {
  topicVaultEligibility,
  audienceFitForCard,
  pickTopicSourceForPost,
  runTopicSourceVaultSweep
} = require('../src/topic_source_vault');
const { estimateLlmCostUsd } = require('../src/tenant_ai_budget');
const { simpleSystemPrompt, simpleWritePrompt, lightReviewPrompt, localDraftGate, voiceIsPolite, draftNextPostWithMeta } = require('../src/next_post_draft');
const { summarizeAccount, formatMarkdownTable } = require('../scripts/report_experiment_6accounts');

test('decideNextPostMission disables product_bridge when hasTargetUrl is false', () => {
  for (let i = 0; i < 10; i += 1) {
    const plan = decideNextPostMission({
      accountState: { followers: 0 },
      hasTargetUrl: false,
      portfolioPlan: { allowPromoUrl: true, portfolioRole: 'explicit_promo_offer' },
      random: () => 0.01
    });
    assert.equal(plan.mission, 'trust_value_external');
    assert.equal(plan.isolateLpContext, true);
    assert.notEqual(plan.topicRing, 'ring3_product_bridge');
  }
});

test('maxPostsPerDay caps slotsForPlan and nextPlanSlot for slow-start accounts', () => {
  assert.deepEqual(slotsForPlan('business', { maxPostsPerDay: 1 }), ['morning']);
  assert.deepEqual(slotsForPlan('pro', { maxPostsPerDay: 2 }), ['morning', 'noon']);
  assert.deepEqual(slotsForPlan('pro'), ['morning', 'noon', 'evening']);
  const slotAt = (slot, offset) => new Date(Date.UTC(2026, 10, 25 + offset, slot === 'morning' ? 23 : 12, 0));
  const blocked = nextPlanSlot({
    plan: 'pro',
    takenSlots: ['morning'],
    maxPostsPerDay: 1,
    now: new Date(Date.UTC(2026, 10, 25, 0, 0)),
    slotAt
  });
  assert.equal(blocked, null);
});

test('xWeightedLength enforces X 280 weight on free/unknown accounts without breaking 140-char Japanese posts', () => {
  const ja140 = 'あ'.repeat(140);
  assert.equal(xWeightedLength(ja140), 280);
  assert.equal(fitsAccountState([ja140], { subscription: 'free', singleOnly: true, maxChars: 140, lang: 'ja' }), true);

  const ja141 = 'あ'.repeat(141);
  assert.equal(xWeightedLength(ja141), 282);
  assert.equal(fitsAccountState([ja141], { subscription: 'free', singleOnly: true, maxChars: 200, lang: 'ja' }), false);

  const withUrl = `${'あ'.repeat(130)} https://example.com/a`;
  assert.equal(xWeightedLength(withUrl), 130 * 2 + 1 + 23);
  assert.equal(fitsAccountState([withUrl], { subscription: 'free', singleOnly: true, maxChars: 200, lang: 'ja' }), false);

  const audit = runDeterministicAudit({ tweets: [ja141] }, {
    lang: 'ja',
    accountState: { subscription: 'free', singleOnly: true, maxChars: 200, postShape: 'single' }
  });
  assert.equal(audit.ok, false);
  assert.equal(audit.reasons.includes('x_weight_exceeded'), true);
});

test('topic_source_vault handles vaultEnabled=false, URL-less brandKnowledge, news contentMode, and fair WS-* sweep', async () => {
  const now = new Date('2026-11-25T12:00:00Z');
  assert.equal(
    topicVaultEligibility({
      user: { planStatus: 'active', planId: 'pro', vaultEnabled: false, brandKnowledge: { icpSummary: '日常' } },
      cards: [],
      now
    }).reason,
    'vault_disabled'
  );

  assert.equal(
    topicVaultEligibility({
      user: { planStatus: 'active', planId: 'pro', targetUrl: '', brandKnowledge: { icpSummary: 'AI実務担当者向けの最新解説' } },
      cards: [],
      now
    }).ok,
    true
  );

  const newsCard = { title: '選挙とSNS情報の見分け方', coreFact: '公的発表とSNS投稿を照合する' };
  const saasBrand = { icpSummary: 'SaaS運用者', domainProblems: ['投稿のネタ切れ'] };
  assert.equal(audienceFitForCard(newsCard, saasBrand), 'mismatch');
  assert.equal(audienceFitForCard(newsCard, saasBrand, { contentMode: 'news' }), 'fit');

  const fakeDb = {
    collection() {
      return {
        doc() {
          return {
            async get() { return { exists: true, data: () => ({ vaultEnabled: false }) }; },
            collection() {
              return { limit() { return { async get() { throw new Error('should_not_query_cards'); } }; } };
            }
          };
        }
      };
    }
  };
  const skippedPick = await pickTopicSourceForPost(fakeDb, 'WS-YUI');
  assert.equal(skippedPick, null);

  const collectedIds = [];
  const fakeSweepDb = {
    collection() {
      return {
        limit() {
          return {
            async get() {
              return {
                docs: [
                  { id: 'AAA-OLD', data: () => ({ planStatus: 'active', planId: 'pro', lastVaultSweepAt: '2026-11-25T11:00:00Z', brandKnowledge: { icpSummary: 'A' } }) },
                  { id: 'WS-NEW', data: () => ({ planStatus: 'active', planId: 'pro', brandKnowledge: { icpSummary: 'B' } }) }
                ]
              };
            }
          };
        },
        doc() { return { async set() {} }; }
      };
    }
  };
  await runTopicSourceVaultSweep(fakeSweepDb, {
    customerCap: 1,
    now,
    loadCards: async () => [],
    budgetAllowed: async () => true,
    collect: async ({ userId }) => {
      collectedIds.push(userId);
      return { sourceId: 's1' };
    }
  });
  assert.deepEqual(collectedIds, ['WS-NEW']);
});

test('lifestyle contentMode relaxes localDraftGate & prompts while keeping business strict', () => {
  assert.equal(voiceIsPolite({}, [], false, 'plain'), false);
  assert.equal(voiceIsPolite({}, [], false, 'polite'), true);

  const casualTweet = '今日のコーヒーが思ったより美味しくて、なんだか朝からちょっと気分がいいなと思って外に出た';
  assert.equal(casualTweet.length >= 40, true);
  assert.equal(localDraftGate([casualTweet], false, { contentMode: 'business' }).ok, false);
  assert.equal(localDraftGate([casualTweet], false, { contentMode: 'lifestyle' }).ok, true);
  assert.equal(localDraftGate(['今日の帰り道に駅前のコンビニへ寄って温かいブラックコーヒーを買おうとしていたところで'], false, { contentMode: 'lifestyle' }).reasons.includes('cut_off'), true);

  assert.match(simpleSystemPrompt(false, 'lifestyle'), /日常・共感/);
  assert.match(simpleSystemPrompt(false, 'business'), /実務家/);
  assert.match(simpleWritePrompt({ isEn: false, brief: { thisPost: '散歩' }, shape: { count: 1 }, contentMode: 'lifestyle', voiceRegister: 'plain' }), /60〜140字目安/);
  assert.match(lightReviewPrompt({ isEn: false, fact: '散歩', candidates: [], contentMode: 'lifestyle' }), /日常・共感/);
});

test('estimateLlmCostUsd and experiment report CLI summarize token cost and 24h performance cleanly', () => {
  const usd = estimateLlmCostUsd({
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 2000
  });
  assert.ok(usd > 0 && usd < 0.05);

  const row = summarizeAccount({
    userId: 'WS-REN',
    user: { xUsername: 'ren_x', contentMode: 'business', ensureNextPostFailures: 1 },
    traces: [
      {
        totalCostUsd: 0.012,
        finalCriticScore: null,
        repairCount: 0,
        evolutionVersion: 'v2',
        qualityAudit: [{ role: 'writer', ok: true }, { role: 'critic', ok: true }]
      },
      {
        totalCostUsd: 0.018,
        finalCriticScore: null,
        repairCount: 1,
        evolutionVersion: 'v2',
        qualityAudit: [{ role: 'writer', ok: true }, { role: 'critic', ok: false }, { role: 'writer', ok: true }, { role: 'critic', ok: true }]
      }
    ],
    jobs: [
      { metrics24hSnapshot: { isFrozen: true, impressions: 240, bookmarks: 6 } }
    ]
  });
  assert.equal(row.traceCount, 2);
  assert.equal(row.avgLlmCalls, 3);
  assert.equal(row.reviewPassRatePct, 100);
  assert.equal(row.repairRatePct, 50);
  assert.equal(row.avgScore, null);
  assert.equal(row.avgBookmarks24h, 6);
  const md = formatMarkdownTable([row]);
  assert.match(md, /@ren_x/);
  assert.match(md, /\$0\.0150/);
  assert.match(md, /¥2\.3[23]/);
  assert.match(md, /100%/);
});

test('URL-less isolated post never falls back to LP placeholder and preserves persona context', async () => {
  const prompts = [];
  const grokPath = require.resolve('../src/grok_client');
  const prevGrok = require.cache[grokPath];
  require.cache[grokPath] = {
    id: grokPath,
    filename: grokPath,
    loaded: true,
    exports: {
      hasXaiKey: () => true,
      async completeText({ prompt }) {
        prompts.push(String(prompt || ''));
        if (prompts.length === 1) return { modelName: 'mock', text: JSON.stringify({ fact: '', reader: '', whyNow: '', evidence: '' }) };
        if (prompts.length === 2) {
          return {
            modelName: 'mock',
            text: JSON.stringify({
              candidates: [{
                id: 'a',
                tweets: ['公的制度の申請は期限の一週間前に必要書類を確認するのが基本です。\n\n窓口が混む月末や連休前を避けて早めに提出するだけで、差し戻しや再提出の手間を減らせます。']
              }]
            })
          };
        }
        return { modelName: 'mock', text: JSON.stringify({ scores: [{ id: 'a', factual: 'pass', natural: 'pass', complete: 'pass', reason: '' }] }) };
      }
    }
  };
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostWithMeta: runDraft } = require('../src/next_post_draft');
    const out = await runDraft({
      lang: 'ja',
      targetUrl: '',
      pageSummary: { ok: true, pageVersion: 'persona-only', title: '', text: '', headings: [] },
      brandKnowledge: {
        category: 'savings',
        icpSummary: '公的制度や家計の節約を知りたい会社員',
        domainProblems: ['公的制度の申請期限や必要書類の見落とし']
      },
      userPrompt: '公的制度と家計の節約ハックをわかりやすく伝える',
      masterPlan: { isolateLpContext: true, mission: 'trust_value_external', topicRing: 'ring1_craft' },
      sourceDossier: null,
      topicSource: null,
      accountState: { maxChars: 140, postShape: 'single', singleOnly: true, subscription: 'free', lang: 'ja' }
    });
    assert.equal(out.tweets.length, 1);
    assert.equal(prompts.some(p => p.includes('ページに書いてある提供')), false);
    assert.match(prompts[0], /公的制度/);
    assert.match(prompts[1], /公的制度/);

    await assert.rejects(() => runDraft({
      lang: 'ja',
      targetUrl: '',
      pageSummary: { ok: true, pageVersion: 'persona-only', title: '', text: '', headings: [] },
      brandKnowledge: null,
      userPrompt: '',
      masterPlan: { isolateLpContext: true, mission: 'trust_value_external', topicRing: 'ring1_craft' },
      sourceDossier: null,
      topicSource: null,
      accountState: { maxChars: 140, postShape: 'single', singleOnly: true, subscription: 'free', lang: 'ja' }
    }), err => err && err.name === 'PostConstraintError' && Array.isArray(err.rejectReasons) && err.rejectReasons.includes('missing_fact_and_persona'));
  } finally {
    if (prevGrok) require.cache[grokPath] = prevGrok;
    else delete require.cache[grokPath];
    delete require.cache[draftPath];
  }
});
