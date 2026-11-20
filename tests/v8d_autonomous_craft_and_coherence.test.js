'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('archetype prompts choose a layout and do not force the old marks', () => {
  const { archetypePromptLines } = require('../src/editorial_archetypes');
  const japanese = archetypePromptLines({
    archetype: 'before_after_rewrite',
    isEn: false,
    recentTexts: ['弱い例を同じ行に置く']
  });
  assert.match(japanese, /内容に合わせて選ぶ/);
  assert.match(japanese, /直近の投稿と同じ見た目/);
  assert.match(japanese, /同じ形を繰り返さない/);
  assert.equal(japanese.includes('なぜ後者が持つか'), false);
  assert.equal(japanese.includes('×'), false);
  assert.equal(japanese.includes('①'), false);
  const english = archetypePromptLines({ archetype: 'actionable_checklist', isEn: true });
  assert.match(english, /Choose the layout/);
  assert.equal(english.includes('Before:'), false);
  assert.equal(english.includes('1. '), false);
});

test('critic scoring asks for coherence and does not name fixed marks', () => {
  const source = fs.readFileSync('src/next_post_draft.js', 'utf8');
  const critic = source.slice(source.indexOf('function criticSystemRules'), source.indexOf('function criticScoreShape'));
  const scoreCall = source.slice(source.indexOf('Score each candidate from 0 to 100'), source.indexOf('role: \'critic\''));
  assert.match(critic, /1行目の主語が結びまで/);
  assert.match(scoreCall, /subject opened on line 1/);
  assert.match(scoreCall, /unexplained product rule/);
  assert.match(scoreCall, /closing sentence contradicts the example/);
  assert.equal(scoreCall.includes('×/○'), false);
  assert.equal(scoreCall.includes('①②③'), false);
  assert.match(scoreCall, /strangerClarity below 14 or scrollStopHook below 12/);
});

test('retarget isolation uses the mission result without editing the mission function', () => {
  const routes = fs.readFileSync('src/autonomous_promo_ai.js', 'utf8');
  const fn = routes.slice(routes.indexOf('async function retargetNextPendingJob'), routes.indexOf('async function fetchUrlSummary'));
  const mission = fs.readFileSync('src/velox_master_core.js', 'utf8');
  assert.match(fn, /decideNextPostMission\(\{/);
  assert.match(fn, /focusPlaybook: isolated \? null : rewritePlaybook/);
  assert.match(fn, /isolateLpContext: masterPlan\.isolateLpContext === true/);
  assert.match(fn, /topicRing: masterPlan\.topicRing/);
  assert.match(fn, /masterMission: masterPlan\.mission/);
  assert.match(fn, /masterPhase: masterPlan\.phase/);
  assert.match(fn, /selectedTopicDomain: masterPlan\.selectedTopicDomain/);
  assert.match(fn, /earlyBodyRewriteAt/);
  assert.match(mission, /function decideNextPostMission/);
  assert.equal(fn.includes('function decideNextPostMission'), false);
});

test('long micro punches keep the blank-line gate and short ones stay open', () => {
  const { auditReadability } = require('../src/readability_formatter');
  const shortJa = '確認は一文だけ残す。';
  const longJa = '確認場所を先に残すと次の判断が同じ型で続く。入口が変わるたびに手順も選び直され、現場の確認がその場でぶれる。先に残した一点だけを次の作業へ渡すと翌日も同じ型で見直せる。声に出して一度読み、足りない一点だけを足す。今日直す場所はそこだけです。';
  assert.equal(auditReadability([shortJa], { lang: 'ja', formatName: 'micro_punch' }).ok, true);
  assert.equal(auditReadability([longJa], { lang: 'ja', formatName: 'micro_punch' }).reasons.includes('missing_hook_break'), true);
  const shortEn = 'Keep one check in the line.';
  const longEn = `${'Keep the same check in view. '.repeat(12)}The next pass should still find that one check.`;
  assert.equal(shortEn.length < 180, true);
  assert.equal(longEn.length >= 180, true);
  assert.equal(auditReadability([shortEn], { lang: 'en', formatName: 'micro_punch' }).ok, true);
  assert.equal(auditReadability([longEn], { lang: 'en', formatName: 'micro_punch' }).reasons.includes('missing_hook_break'), true);
});
