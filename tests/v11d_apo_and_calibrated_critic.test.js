'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCalibratedAxisWeights } = require('../src/critic_calibration');
const { judgeCriticRow, candidatePrompt, hookAngleForChoice, criticSystemRules } = require('../src/next_post_draft');
const { evaluatePromptEvolution, sanitizeEvolutionText, chooseEvolutionAssignment } = require('../src/prompt_evolution');

const weights = {
  scrollStopHook: 1.1,
  saveUtility: 1.1,
  strangerClarity: 0.9,
  craftAndTruth: 0.9
};

function trace(residual, extra = {}) {
  return {
    lang: 'ja',
    outcome24h: { residualReward: residual },
    calibration: { verdict: residual > 0 ? 'aligned_win' : 'aligned_loss' },
    selectedHookAngle: residual > 0 ? 'scene_friction' : 'contrarian_flip',
    sourceType: 'dossier',
    segmentCount: 1,
    ...extra
  };
}

const summary = {
  status: 'ok',
  sampleCount: 5,
  predictiveAxis: 'scrollStopHook',
  overratedAxis: 'craftAndTruth',
  axisCorrelations: { scrollStopHook: 1, saveUtility: 0.2, strangerClarity: -0.2, craftAndTruth: -1 }
};

test('axis weights stay neutral below five traces and rebalance after that', () => {
  assert.equal(computeCalibratedAxisWeights({ status: 'insufficient_data', sampleCount: 4, axisCorrelations: summary.axisCorrelations }), null);
  assert.equal(computeCalibratedAxisWeights({ status: 'ok', sampleCount: 5, axisCorrelations: { scrollStopHook: 0, saveUtility: 0, strangerClarity: 0, craftAndTruth: 0 } }), null);
  const scaled = computeCalibratedAxisWeights(summary);
  const values = Object.values(scaled);
  assert.equal(Math.round(values.reduce((sum, value) => sum + value, 0) * 1000) / 1000, 4);
  assert.equal(values.every(value => value >= 0.75 && value <= 1.25), true);
  assert.equal(scaled.scrollStopHook > scaled.craftAndTruth, true);
});

test('critic judgment stays unchanged unless weights are supplied', () => {
  const row = { id: 'a', score: 70, scrollStopHook: 18, saveUtility: 18, strangerClarity: 18, craftAndTruth: 18, weakness: '具体が弱い' };
  const plain = judgeCriticRow(row);
  assert.equal(plain.accept, false);
  assert.equal(plain.row.calibratedScore, undefined);
  const lifted = judgeCriticRow(row, { axisWeights: weights });
  assert.equal(lifted.row.calibratedScore >= 72, true);
  assert.equal(lifted.accept, true);
  const floor = judgeCriticRow({ ...row, score: 90, strangerClarity: 13 }, { axisWeights: weights });
  assert.equal(floor.accept, false);
  assert.equal(criticSystemRules(false).length, 353);
});

test('a challenger is promoted only after three wins and rolled back after three losses', () => {
  const few = [trace(0.2), trace(0.1), trace(-0.1), trace(0.3)];
  assert.equal(evaluatePromptEvolution(few, null, summary).changed, false);
  const first = evaluatePromptEvolution([trace(0.2), trace(0.1), trace(0.3), trace(-0.2), trace(0.4, { selectedHookAngle: 'https://example.com/hook' })], null, summary);
  assert.equal(first.changed, true);
  assert.equal(first.promptEvolution.challenger.version, 'evo_1');
  assert.equal(`${first.promptEvolution.challenger.doMore}${first.promptEvolution.challenger.avoidMore}`.includes('http'), false);
  assert.equal(Array.from(first.promptEvolution.challenger.doMore).length <= 90, true);
  assert.equal(Array.from(`${first.promptEvolution.challenger.doMore}${first.promptEvolution.challenger.avoidMore}`).length <= 180, true);
  assert.equal(sanitizeEvolutionText('詳細は https://example.com/a と a@b.co と凍結リスクゼロ', 90).includes('http'), false);
  const pending = { ...first.promptEvolution, active: { version: 'evo_0', doMore: '基準', avoidMore: '前置き', promotedAt: '2026-11-01T00:00:00.000Z' } };
  const holding = evaluatePromptEvolution([
    trace(0.2, { evolutionVersion: 'evo_1' }),
    trace(0.1, { evolutionVersion: 'evo_1' })
  ].concat([trace(0.2), trace(0.2), trace(0.2)]), pending, summary);
  assert.equal(holding.changed, false);
  const promoted = evaluatePromptEvolution([
    trace(0.2, { evolutionVersion: 'evo_1' }),
    trace(0.3, { evolutionVersion: 'evo_1' }),
    trace(0.4, { evolutionVersion: 'evo_1' }),
    trace(0.1, { evolutionVersion: 'evo_0' }),
    trace(0.1, { evolutionVersion: 'evo_0' })
  ], pending, summary);
  assert.equal(promoted.promptEvolution.active.version, 'evo_1');
  assert.equal(promoted.promptEvolution.challenger, null);
  const rolled = evaluatePromptEvolution([
    trace(-0.2, { evolutionVersion: 'evo_1' }),
    trace(-0.3, { evolutionVersion: 'evo_1' }),
    trace(-0.1, { evolutionVersion: 'evo_1' }),
    trace(0.2, { evolutionVersion: 'evo_0' }),
    trace(0.2, { evolutionVersion: 'evo_0' })
  ], pending, summary);
  assert.equal(rolled.promptEvolution.challenger, null);
  assert.equal(rolled.promptEvolution.active.version, 'evo_0');
  const evolution = { active: { version: 'evo_0' }, challenger: { version: 'evo_1' } };
  assert.equal(chooseEvolutionAssignment({ evolution, jobs: [{ evolutionVersion: 'evo_0' }], topicRing: 'ring1_craft', isWildcard: false }), 'evo_1');
  assert.equal(chooseEvolutionAssignment({ evolution, jobs: [{ evolutionVersion: 'evo_1' }], topicRing: 'ring1_craft', isWildcard: false }), 'evo_0');
  assert.equal(chooseEvolutionAssignment({ evolution, jobs: [], topicRing: 'ring3_product_bridge', isWildcard: false }), 'evo_0');
});

test('a polite ending still keeps the hook angle, and a different sentence does not', () => {
  const hooks = [{ angle: 'blunt_practitioner', text: '開発側は、丁寧な返信を勧めない。' }];
  assert.equal(hookAngleForChoice({ tweets: ['開発側は、丁寧な返信を勧めません。\n\n次に一行を見る。'] }, hooks), 'blunt_practitioner');
  assert.equal(hookAngleForChoice({ tweets: ['夜の予定表だけを信じて、閉まった扉の前に立つ。'] }, hooks), null);
  const prompt = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { count: 1, maxCount: 1 },
    accountState: { maxChars: 900, delivery: 'single' },
    genes: { delivery: 'single' },
    masterPlan: { topicRing: 'ring1_craft' },
    winningHooks: hooks,
    evolutionPatch: { doMore: '具体の一動作を先に置く。', avoidMore: '前置きで結論を遅らせない。' }
  });
  assert.match(prompt, /言い換えずにそのまま置く/);
  assert.match(prompt, /具体の一動作を先に置く/);
});
