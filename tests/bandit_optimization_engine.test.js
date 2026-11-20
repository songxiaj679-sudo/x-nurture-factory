'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTENT_ANGLES,
  deriveAngleBanditState,
  sampleBetaDistribution,
  selectActionViaThompsonSampling,
  updateBanditState
} = require('../src/bandit_optimization_engine');

function seededRandom(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('Beta sampler follows known means and rejects invalid parameters', () => {
  const random = seededRandom();
  const samples = Array.from({ length: 5000 }, () => sampleBetaDistribution(2, 5, random));
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  assert.ok(Math.abs(mean - (2 / 7)) < 0.02);
  assert.ok(samples.every(value => value >= 0 && value <= 1));
  assert.throws(() => sampleBetaDistribution(0, 1), /形状パラメーター/u);
});

test('Thompson sampling favors a measured better arm while retaining exploration', () => {
  const random = seededRandom(42);
  const state = {
    practical_steps: { successes: 80, failures: 20 },
    misconception: { successes: 20, failures: 80 }
  };
  let betterArmSelections = 0;
  for (let i = 0; i < 1000; i++) {
    if (selectActionViaThompsonSampling(state, Object.keys(state), random) === 'practical_steps') {
      betterArmSelections++;
    }
  }
  assert.ok(betterArmSelections > 950);
  assert.equal(selectActionViaThompsonSampling({}, [], random), null);
  assert.ok(Object.keys(CONTENT_ANGLES).includes('tradeoffs'));
});

test('reward updates validate inputs and leave the prior state unchanged', () => {
  const original = { practical_steps: { successes: 2, failures: 1 } };
  const updated = updateBanditState(original, 'practical_steps', 0.9);
  assert.deepEqual(updated, { practical_steps: { successes: 3, failures: 1 } });
  assert.deepEqual(original, { practical_steps: { successes: 2, failures: 1 } });
  assert.throws(() => updateBanditState(original, 'x', NaN), /入力が無効/u);
});

test('angle state uses only frozen same-slot metrics and a per-slot median baseline', () => {
  const posts = [
    { timeSlot: 'morning', contentAngle: 'practical_steps', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 1 } },
    { timeSlot: 'morning', contentAngle: 'tradeoffs', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 2 } },
    { timeSlot: 'morning', contentAngle: 'misconception', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 10 } },
    { timeSlot: 'evening', contentAngle: 'practical_steps', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 100 } },
    { timeSlot: 'morning', contentAngle: 'tradeoffs', metrics24hSnapshot: { isFrozen: false, impressions: 100, bookmarks: 100 } },
    { timeSlot: 'morning', contentAngle: 'misconception', metrics24hSnapshot: { isFrozen: true, impressions: 0, bookmarks: 0 } }
  ];
  const result = deriveAngleBanditState(posts, Object.keys(CONTENT_ANGLES), 'morning');
  assert.equal(result.sampleCount, 3);
  assert.equal(result.baselineRate, 0.02);
  assert.deepEqual(result.state, {
    practical_steps: { successes: 0, failures: 1 },
    tradeoffs: { successes: 0, failures: 1 },
    misconception: { successes: 1, failures: 0 }
  });
  assert.equal(deriveAngleBanditState([], Object.keys(CONTENT_ANGLES), 'noon').baselineRate, null);
});

test('angle-state keys are preserved safely even when they resemble object properties', () => {
  const result = deriveAngleBanditState([
    { timeSlot: 'morning', contentAngle: '__proto__', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 1 } },
    { timeSlot: 'morning', contentAngle: 'constructor', metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 2 } }
  ], ['__proto__', 'constructor'], 'morning');
  assert.equal(Object.hasOwn(result.state, '__proto__'), true);
  assert.equal(Object.hasOwn(result.state, 'constructor'), true);
});

test('fact selection stays inside one account and one time slot', () => {
  const { extractPageFacts, chooseFactForSlot, formatSelectedFact } = require('../src/bandit_optimization_engine');
  const facts = extractPageFacts({
    title: '月額980円の作業記録',
    description: '申込は法人メールが必要です',
    headings: ['手順は三ステップです']
  });
  assert.equal(facts.length, 3);
  const strong = facts[0].id;
  const posts = [{
    timeSlot: 'evening',
    contentAngle: strong,
    metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 20 }
  }];
  for (const fact of [facts[1], facts[2]]) {
    for (let i = 0; i < 4; i++) {
      posts.push({
        timeSlot: 'evening',
        contentAngle: fact.id,
        metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 1 }
      });
    }
  }
  posts.push({
    timeSlot: 'morning',
    contentAngle: facts[1].id,
    metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 90 }
  }, {
    timeSlot: 'evening',
    contentAngle: facts[1].id,
    metrics24hSnapshot: { isFrozen: true, impressions: 0, bookmarks: 0 }
  });
  let chosen = 0;
  for (let i = 0; i < 200; i++) {
    const choice = chooseFactForSlot(posts, facts, 'evening');
    if (choice.fact.id === strong) chosen++;
  }
  assert.ok(chosen > 150);
  assert.match(formatSelectedFact(chooseFactForSlot([], facts, 'evening'), 'en'), /Use only this fact/);
  assert.doesNotMatch(formatSelectedFact(null, 'ja'), /勝ち/);
});

test('hypotheses ignore another page version and zero-impression posts', () => {
  const { extractPageHypotheses, chooseHypothesis, pageVersionHash } = require('../src/bandit_optimization_engine');
  const page = {
    title: '法人向けの作業記録',
    description: '月額980円で申し込めます',
    headings: ['手順は三ステップです'],
    snippet: '対象は法人の担当者です'
  };
  const hypotheses = extractPageHypotheses(page);
  const disclaimerPage = {
    ...page,
    description: 'APIの利用条件やアカウント状態を保証するものではありません。月額980円で申し込めます'
  };
  const withoutDisclaimer = extractPageHypotheses(disclaimerPage);
  assert.ok(withoutDisclaimer.every(item => !/保証するものではありません/.test(item.why)));
  const termsPage = {
    title: '作業記録',
    description: 'APIの利用条件や投稿に適用される規約は変更されることがあり、利用者自身による確認が必要です',
    headings: ['手順は三ステップです'],
    snippet: '月額980円で申し込めます'
  };
  assert.ok(extractPageHypotheses(termsPage).every(item => !/利用条件|規約は変更/.test(`${item.why} ${item.proof}`)));
  const version = pageVersionHash(page);
  const recoveryPage = {
    title: '到達率が下がったときは無理に攻めず回復向けの投稿構成へ自動調整します',
    description: '月額980円で申し込めます',
    headings: ['公開前の確認を残す'],
    snippet: '法人の担当者向けの作業記録です'
  };
  const recovery = extractPageHypotheses(recoveryPage);
  assert.ok(recovery.length >= 1);
  assert.ok(recovery.every(item => !/回復向け/.test(item.who)));
  const pricingPage = {
    title: '👤 CREATOR & SOLO Solo Starter ¥4,980 / 月（税込・$39） 個人・1ブランドの継続発信に',
    description: '（料金・機能・FAQなど主要な案内',
    headings: ['公開前の確認を残す'],
    snippet: '法人の担当者向けの作業記録です'
  };
  const pricing = extractPageHypotheses(pricingPage);
  assert.ok(pricing.length >= 1);
  assert.ok(pricing.every(item => !/CREATOR|Solo Starter|¥|料金・機能/.test(`${item.who} ${item.why}`)));
  const chromePage = {
    title: '作業記録',
    description: '月額980円で申し込めます',
    headings: ['「あなたの声」と信用段階の設計 今の自己紹介と固定ポストを見て、誰向けか・何を出すか'],
    snippet: '解約・更新条件の詳細は特定商取引法に基づく表記をご確認ください'
  };
  const chrome = extractPageHypotheses(chromePage);
  assert.ok(chrome.length >= 1);
  assert.ok(chrome.every(item => !/誰向けか|あなたの声|特定商取引法|解約・更新条件/.test(`${item.who} ${item.why} ${item.proof}`)));
  assert.ok(hypotheses.length >= 1);
  assert.ok(hypotheses.every(item => item.pageVersion === version));
  const strong = hypotheses[0].id;
  const posts = [{
    timeSlot: 'evening',
    pageVersion: version,
    contentAngle: strong,
    metricsEarlySnapshot: { impressions: 100, bookmarks: 20, postAgeHours: 3 }
  }, {
    timeSlot: 'evening',
    pageVersion: 'other-page',
    contentAngle: strong,
    metrics24hSnapshot: { isFrozen: true, impressions: 100, bookmarks: 1 }
  }, {
    timeSlot: 'evening',
    pageVersion: version,
    contentAngle: strong,
    metricsEarlySnapshot: { impressions: 0, bookmarks: 0, postAgeHours: 3 }
  }];
  const choice = chooseHypothesis(posts, hypotheses, 'evening', version);
  assert.equal(choice.hypothesis.pageVersion, version);
  assert.equal(choice.sampleCount, 1);
});
