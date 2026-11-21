'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { systemRules, criticSystemRules, candidatePrompt, resolveSourceType } = require('../src/next_post_draft');

test('search instructions aim at a reader problem and skip competing tool manuals', () => {
  const source = fs.readFileSync('src/topic_source_vault.js', 'utf8');
  assert.match(source, /読者課題/);
  assert.match(source, /専門的な仕組み/);
  assert.match(source, /同業のツール比較/);
  assert.match(source, /競合ツールの操作マニュアル/);
  assert.match(source, /料金比較/);
  assert.match(source, /ツールの使い方や料金比較ではなく/);
});

test('the Japanese writer rules are slimmer and still keep the safety floor', () => {
  const ja = systemRules(false);
  assert.equal(ja.length < 1204, true);
  assert.equal(ja.includes('この現象の裏には'), false);
  assert.equal(ja.includes('設計上のトレードオフがあります'), false);
  assert.match(ja, /根拠データに無い日時/);
  assert.match(ja, /URLは作らない/);
  assert.match(ja, /個人日記の一人称は禁止/);
  assert.match(ja, /敬体と常体を混ぜない/);
  assert.match(ja, /写してよいのは間の取り方だけ/);
  assert.match(systemRules(true), /Use words a teenager would say out loud/);
});

test('a sourced draft asks for a spoken explainer and phone spacing', () => {
  const card = { sourceName: '現場ノート', coreFact: '入口の紙を先に見る。', mechanism: '予定と現場がずれる。', actionableTakeaway: '変えた日だけ見る。' };
  const prompt = candidatePrompt({
    isEn: false,
    isolateLpContext: true,
    topicSource: card,
    masterPlan: { topicRing: 'ring1_craft' },
    accountState: { maxChars: 140 },
    shape: { count: 1 }
  });
  assert.match(prompt, /要約ではなくわかりやすい専門解説/);
  assert.match(prompt, /自然な口語/);
  assert.match(prompt, /適度な空行/);
  assert.match(prompt, /控えめな装飾/);
  assert.equal(prompt.includes('この現象の裏には'), false);
});

test('source type follows the card, the dossier, or the brand alone', () => {
  const plan = { topicRing: 'ring2_broad_adjacent' };
  assert.equal(resolveSourceType({ coreFact: 'a' }, { currentDebate: 'old' }, plan), 'topic_source');
  assert.equal(resolveSourceType(null, { currentDebate: 'old' }, plan), 'dossier');
  assert.equal(resolveSourceType({ coreFact: 'a' }, null, { topicRing: 'ring3_product_bridge' }), 'brand_only');
  assert.equal(resolveSourceType(null, {}, plan), 'brand_only');
});

test('the Japanese critic stays under 400 characters and keeps the subject line', () => {
  const critic = criticSystemRules(false);
  assert.equal(critic.length < 400, true);
  assert.match(critic, /1行目の主語が結びまで続く/);
  assert.match(critic, /自然な口語/);
  assert.match(critic, /空行がなく文字が詰まる/);
});
