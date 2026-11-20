'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { systemRules, criticSystemRules } = require('../src/next_post_draft');

test('the writer asks for one visible scene and keeps the pacing rule', () => {
  const ja = systemRules(false);
  const en = systemRules(true);
  assert.match(ja, /中学生が一度読んだだけで場面が浮かぶ言葉にする/);
  assert.match(ja, /写してよいのは間の取り方だけ/);
  assert.match(en, /Use words a teenager would say out loud/);
  const source = fs.readFileSync('src/next_post_draft.js', 'utf8');
  assert.equal(source.includes('具体的な判断や失敗の場面で書く'), false);
});

test('the critic lowers stacked hard words and stays under 400 Japanese characters', () => {
  const ja = criticSystemRules(false);
  const en = criticSystemRules(true);
  assert.equal(ja.length < 400, true);
  assert.equal(ja.includes('accountRole'), false);
  assert.match(ja, /一度で場面が浮かぶ平易な言葉か/);
  assert.match(ja, /熟語が続くときは下げる/);
  assert.match(ja, /1行目の主語が結びまで続く/);
  assert.match(en, /abstract nouns pile up/);
  assert.match(en, /a teenager would not see the scene/);
});
