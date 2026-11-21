'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyGeneRewardBatch, chooseGenesForPost, chooseSourceMaterial, GENE_REWARD_KEYS } = require('../src/bandit_optimization_engine');
const { candidatePrompt } = require('../src/next_post_draft');

const visible = { subscription: 'free', searchVisible: true, singleOnly: false, postShape: 'thread', maxChars: 140, lang: 'ja' };

test('new arms decay by 0.94 and old posts skip the missing keys', () => {
  assert.equal(GENE_REWARD_KEYS.length, 8);
  const learned = applyGeneRewardBatch([
    { post: { timeSlot: 'evening', sourceType: 'dossier', segmentCount: 3, genes: { angle: 'field_observation' } }, weight: 1, residual: 1 },
    { post: { timeSlot: 'evening', sourceType: 'topic_source', segmentCount: '2', genes: { angle: 'tradeoffs' } }, weight: 1, residual: 0.5 }
  ], 'evening');
  assert.ok(Math.abs(learned.account.dossier.alpha - 0.94) < 1e-9);
  assert.ok(Math.abs(learned.account.topic_source.alpha - 0.5) < 1e-9);
  assert.ok(Math.abs(learned.account['3'].alpha - 0.94) < 1e-9);
  assert.ok(Math.abs(learned.account['2'].alpha - 0.5) < 1e-9);
  const legacy = applyGeneRewardBatch([
    { post: { timeSlot: 'evening', genes: { angle: 'field_observation' } }, weight: 1, residual: 1 }
  ], 'evening');
  assert.equal(legacy.account.field_observation.alpha, 1);
  assert.equal(legacy.account.topic_source, undefined);
  assert.equal(legacy.account['2'], undefined);
  const chosen = chooseGenesForPost({ posts: [], accountState: visible });
  assert.equal(['topic_source', 'dossier', 'brand_only'].includes(chosen.sourceType), true);
});

test('parent replies learn two or three parts and a hidden account stays at one', () => {
  const hidden = chooseGenesForPost({ accountState: { ...visible, singleOnly: true, postShape: 'single' }, random: () => 0.1 });
  assert.equal(hidden.delivery, 'single');
  assert.equal(hidden.targetSegmentCount, 1);
  const parent = chooseGenesForPost({
    accountState: visible,
    constraints: { lockDelivery: 'parent_self_reply' },
    random: () => 0.2
  });
  assert.equal(parent.delivery, 'parent_self_reply');
  assert.equal([2, 3].includes(parent.targetSegmentCount), true);
  const prompt = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { thread: true, count: 2, maxCount: 3 },
    accountState: { ...visible, delivery: 'parent_self_reply', maxChars: 140 },
    genes: parent
  });
  assert.match(prompt, parent.targetSegmentCount === 3 ? /3段構成を優先/ : /2段構成を優先/);
  assert.match(prompt, /はみ出し分割は禁止/);
});

test('a missing card falls back to the dossier', () => {
  const plan = { isolateLpContext: true, topicRing: 'ring1_craft' };
  const card = { title: '入口' };
  const dossier = { coreFact: '紙が古い' };
  assert.equal(chooseSourceMaterial({ genes: { sourceType: 'topic_source' }, topicSource: card, sourceDossier: dossier, masterPlan: plan }).sourceType, 'topic_source');
  assert.equal(chooseSourceMaterial({ genes: { sourceType: 'topic_source' }, topicSource: null, sourceDossier: dossier, masterPlan: plan }).sourceType, 'dossier');
  assert.equal(chooseSourceMaterial({ genes: { sourceType: 'dossier' }, topicSource: card, sourceDossier: dossier, masterPlan: plan }).topicSource, null);
  assert.equal(chooseSourceMaterial({ genes: { sourceType: 'topic_source' }, topicSource: null, sourceDossier: null, masterPlan: plan }).sourceType, 'brand_only');
});
