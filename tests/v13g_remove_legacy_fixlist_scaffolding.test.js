'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { briefPrompt, candidatePrompt, criticSystemRules, systemRules } = require('../src/next_post_draft');
const { decideEditorialPlan } = require('../src/editorial_lexicon_engine');
const { archetypePromptLines } = require('../src/editorial_archetypes');

const card = {
  coreFact: '反応が多くフォロワーも多い投稿は、低信頼性のリンクを含んでも表示が増える。',
  mechanism: '推薦は中身の正しさより、先に付いた反応を増幅する。',
  plainTranslation: '正しい投稿より、すでに目立つ投稿が先に広がる。'
};
const plan = { topicRing: 'ring1_craft', isolateLpContext: true, selectedTopicDomain: '配信' };
const state = { maxChars: 900, subscription: 'premium', delivery: 'parent_self_reply', lang: 'ja' };

test('a primary source brief keeps the finding and does not order a review ritual', () => {
  const brief = briefPrompt({
    isEn: false,
    accountState: state,
    shape: { thread: true, maxCount: 3 },
    masterPlan: plan,
    topicSource: card,
    domainSlot: true,
    decision: { endingMove: 'verdict_cut' }
  });
  assert.match(brief, /原典の主題を投稿のテーマにしない/);
  assert.equal(brief.includes('見分け方、小さな工夫、確認、よくある思い違い'), false);
  const plain = briefPrompt({
    isEn: false,
    accountState: state,
    shape: { thread: true, maxCount: 3 },
    masterPlan: { topicRing: 'ring3_product_bridge' },
    decision: { endingMove: 'verdict_cut' }
  });
  assert.match(plain, /見分け方、小さな工夫、確認/);
});

test('a two-part source post is not forced into a check or a caveat', () => {
  const decision = decideEditorialPlan({
    accountState: state,
    shape: { thread: true, maxCount: 3 },
    topicSource: card,
    recentPosts: []
  });
  assert.notEqual(decision.endingMove, 'condition_edge');
  assert.match(decision.threadSecondMove, /一次事実/);
  assert.equal(decision.threadSecondMove.includes('確認手順のどれか'), false);
  const prompt = candidatePrompt({
    isEn: false,
    accountState: state,
    shape: { thread: true, count: 2, maxCount: 3 },
    masterPlan: plan,
    topicSource: card,
    genes: { delivery: 'parent_self_reply', targetSegmentCount: 2 },
    decision,
    domainSlot: true,
    brief: { readerPayoff: '目立つ投稿が先に広がる仕組み' }
  });
  assert.match(prompt, /取って付けた1手は禁止/);
  assert.equal(prompt.includes('2段目が原因と1手'), false);
  const sharp = archetypePromptLines({ archetype: 'contrarian_sharp', isEn: false, delivery: 'parent_self_reply' });
  assert.match(sharp, /仕組みの核心で締める/);
  assert.equal(sharp.includes('具体的な確認を短く書く'), false);
  assert.equal(criticSystemRules(false).length < 400, true);
  assert.equal(systemRules(false).includes('その場で口に出す一文'), true);
});
