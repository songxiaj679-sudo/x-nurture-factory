'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { briefPrompt, systemRules, criticSystemRules } = require('../src/next_post_draft');

function page() {
  return {
    title: '店の案内',
    description: 'あ'.repeat(180),
    headings: ['入口の休み', '席の数'],
    body: `HIDDEN_PAGE_BODY ${'x'.repeat(1500)}`
  };
}

test('ring 3 passes one visible fact and leaves the isolated branch empty', () => {
  const source = fs.readFileSync('src/next_post_draft.js', 'utf8');
  const ring = briefPrompt({
    isEn: false,
    page: page(),
    hypothesisText: 'HIDDEN_PAGE_BODY',
    masterPlan: { topicRing: 'ring3_product_bridge' },
    isolateLpContext: false
  });
  assert.equal(ring.includes('HIDDEN_PAGE_BODY'), false);
  assert.equal(ring.includes('"body"'), false);
  const fact = ring.split('読者が画面で確かめられる事実は1文だけ: ')[1].split('\n')[0];
  assert.equal(fact, 'あ'.repeat(140));
  assert.equal(fact.length <= 140, true);
  const heading = briefPrompt({
    isEn: false,
    page: { description: '  ', headings: ['入口の休み'], body: 'HIDDEN_PAGE_BODY' },
    masterPlan: { topicRing: 'ring3_product_bridge' }
  });
  assert.match(heading, /入口の休み/);
  assert.equal(heading.includes('HIDDEN_PAGE_BODY'), false);
  const isolated = briefPrompt({
    isEn: false,
    page: page(),
    hypothesisText: 'HIDDEN_PAGE_BODY',
    isolateLpContext: true,
    masterPlan: { topicRing: 'ring3_product_bridge' }
  });
  assert.equal(isolated.includes('HIDDEN_PAGE_BODY'), false);
  assert.equal(isolated.includes('読者が画面で確かめられる事実は1文だけ'), false);
  assert.match(source, /isolateLpContext \? null : brandKnowledge/);
});

test('the spoken pair is one industry-neutral example and the locked lines stay', () => {
  const source = fs.readFileSync('src/next_post_draft.js', 'utf8');
  const prompt = source.slice(source.indexOf('function candidatePrompt'), source.indexOf('function attachPromoReply'));
  assert.match(prompt, /同じ話題と同じ文体/);
  assert.equal(prompt.includes('営業時間が最新であること'), false);
  assert.equal(prompt.includes('開いてると思って来たのに閉まってた'), false);
  assert.equal(prompt.includes('Checklist: Hours are current'), false);
  assert.equal(prompt.includes('Nothing wastes a trip faster'), false);
  assert.equal(prompt.includes('OAuth'), false);
  assert.match(prompt, /readerLine/);
  assert.match(prompt, /delivery\) === 'parent_self_reply'/);
  assert.match(prompt, /型が本文で原因まで書く指示より優先する/);
  const ja = systemRules(false);
  const en = systemRules(true);
  assert.match(ja, /英語の直訳のような硬い言い回し/);
  assert.match(ja, /中学生が一度読んだだけで場面が浮かぶ言葉にする/);
  assert.match(ja, /その場で口に出す一文/);
  assert.match(ja, /解説の先生や締めの標語にはしない/);
  assert.match(ja, /詰め寄る質問にはしない/);
  assert.match(ja, /主語はチーム・開発側・プロダクトにする/);
  assert.match(en, /Use words a teenager would say out loud/);
  assert.match(ja, /根拠データに無い日時/);
  assert.match(ja, /個人日記の一人称は禁止/);
  const critic = criticSystemRules(false);
  assert.equal(critic.length < 400, true);
  assert.match(critic, /1行目の主語が結びまで続く/);
  const archetypes = fs.readFileSync('src/editorial_archetypes.js', 'utf8');
  assert.match(archetypes, /内容に合わせて選ぶ/);
  assert.match(archetypes, /矢印は、前の状態が次の状態へ変わるときだけ使う/);
});
