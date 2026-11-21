'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { systemRules, criticSystemRules } = require('../src/next_post_draft');
const { archetypePromptLines } = require('../src/editorial_archetypes');

test('spoken voice replaces the lecturer close and leaves the critic rules unchanged', () => {
  const ja = systemRules(false);
  const en = systemRules(true);
  const critic = criticSystemRules(false);
  assert.match(ja, /その場で口に出す一文/);
  assert.match(ja, /解説の先生や締めの標語にはしない/);
  assert.match(ja, /詰め寄る質問にはしない/);
  assert.match(ja, /英語の直訳のような硬い言い回し/);
  assert.match(ja, /中学生が一度読んだだけで場面が浮かぶ言葉にする/);
  assert.match(ja, /主語はチーム・開発側・プロダクトにする/);
  assert.equal(ja.includes('問いかけは最後の1文だけ'), false);
  assert.match(en, /sentence you would say out loud/);
  assert.match(en, /Do not close with an exam question/);
  assert.match(en, /Use words a teenager would say out loud/);
  assert.equal(critic.length < 400, true);
  assert.match(critic, /1行目の主語が結びまで続く/);
});

test('parent plus self-reply outranks the autopsy cause line, and a single post does not', () => {
  const split = archetypePromptLines({ archetype: 'failure_autopsy', isEn: false, delivery: 'parent_self_reply' });
  const single = archetypePromptLines({ archetype: 'failure_autopsy', isEn: false, delivery: 'single' });
  const english = archetypePromptLines({ archetype: 'failure_autopsy', isEn: true, delivery: 'parent_self_reply' });
  assert.match(split, /内容に合わせて選ぶ/);
  assert.match(split, /矢印は、前の状態が次の状態へ変わるときだけ使う/);
  assert.match(split, /平易な原因と今日できる確認/);
  assert.match(split, /型が本文で原因まで書く指示より優先する/);
  assert.match(split, /1本目は違和感や場面で止める/);
  assert.equal(single.includes('型が本文で原因まで書く指示より優先する'), false);
  assert.match(single, /平易な原因と今日できる確認/);
  assert.match(english, /honest two-tweet thread|This split wins over any archetype line/);
  const source = fs.readFileSync('src/next_post_draft.js', 'utf8');
  const prompt = source.slice(source.indexOf('function candidatePrompt'), source.indexOf('function attachPromoReply'));
  assert.match(prompt, /delivery\) === 'parent_self_reply'/);
  assert.match(prompt, /型が本文で原因まで書く指示より優先する/);
  assert.equal(prompt.includes("delivery) === 'single'"), false);
});
