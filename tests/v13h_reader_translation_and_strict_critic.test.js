'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { briefPrompt, candidatePrompt, criticSystemRules } = require('../src/next_post_draft');
const { selectReusableTopicCard, audienceFitForCard } = require('../src/topic_source_vault');

const card = {
  coreFact: '反応が多くフォロワーも多い投稿は、低信頼性のリンクを含んでも表示が増える。',
  mechanism: '推薦は中身の正しさより、先に付いた反応を増幅する。',
  plainTranslation: '正しい投稿より、すでに目立つ投稿が先に広がる。'
};

test('a source brief translates the finding into the reader’s work', () => {
  const brief = briefPrompt({
    isEn: false,
    accountState: { maxChars: 900, delivery: 'single', lang: 'ja' },
    shape: { count: 1, maxCount: 1 },
    masterPlan: { topicRing: 'ring1_craft', isolateLpContext: true },
    topicSource: card,
    domainSlot: true,
    readerHint: 'Xを事業に使う人',
    decision: { endingMove: 'verdict_cut' }
  });
  assert.match(brief, /原典の主題を投稿のテーマにしない/);
  assert.match(brief, /読者はXを事業に使う人/);
  assert.match(brief, /実務の判断基準を一つ/);
  assert.equal(brief.includes('見分け方、小さな工夫、確認、よくある思い違い'), false);
  const prompt = candidatePrompt({
    isEn: false,
    accountState: { maxChars: 900, delivery: 'single', lang: 'ja' },
    shape: { count: 1, maxCount: 1 },
    masterPlan: { topicRing: 'ring1_craft', isolateLpContext: true },
    topicSource: card,
    domainSlot: true,
    readerHint: 'Xを事業に使う人',
    decision: { endingMove: 'verdict_cut' },
    brief: { readerPayoff: '何を先に見るか' }
  });
  assert.match(prompt, /原典の主題はテーマにしない/);
  assert.match(prompt, /出口は実務の判断を一つ/);
});

test('the critic fails a polished source summary that never reaches the reader', () => {
  const critic = criticSystemRules(false);
  assert.equal(critic.length < 400, true);
  assert.match(critic, /scrollStopHookは10以下、合計は60未満/);
  assert.match(critic, /手順不足は減点理由にしない/);
  assert.match(critic, /保存したくなる具体/);
  assert.match(critic, /1行目の主語が結びまで続く/);
  const source = fs.readFileSync('src/next_post_draft.js', 'utf8');
  const score = source.slice(source.indexOf('function lightReviewPrompt'), source.indexOf('function localDraftGate'));
  assert.match(score, /factual/);
  assert.match(score, /natural/);
  assert.match(score, /complete/);
  const repair = source.slice(source.indexOf('const repairHint'), source.indexOf('repairedCandidates = readCandidates'));
  assert.match(repair, /Rebuild the entrance as the reader belief/);
  assert.match(repair, /one practical priority/);
});

test('a social-problem card stays out of selection, and a pricing card stays in', () => {
  const operator = { icpSummary: 'Xを事業の集客に使う人' };
  const rumor = {
    outputLang: 'ja',
    coreFact: '低信頼性の投稿は反応が多いほど表示が増える。',
    mechanism: '推薦が反応を増幅する。',
    plainTranslation: 'デマっぽい投稿が先に広がる。',
    usedCount: 0,
    fetchedAt: '2026-11-24T04:25:21.052Z'
  };
  const pricing = {
    outputLang: 'ja',
    coreFact: 'APIの有料化のあと研究利用は減った。',
    mechanism: '入口の料金が変わると取れる量が変わる。',
    plainTranslation: '安く取れたデータは条件が変わると取れない。',
    usedCount: 0,
    fetchedAt: '2026-11-22T07:26:28.057Z'
  };
  assert.equal(audienceFitForCard(rumor, operator), 'mismatch');
  assert.equal(audienceFitForCard(pricing, operator), 'fit');
  assert.equal(audienceFitForCard(rumor, { icpSummary: '誤情報の広がりを調べる人' }), 'fit');
  assert.equal(audienceFitForCard(rumor, { icpSummary: '公衆衛生の情報を届ける人' }), 'mismatch');
  const picked = selectReusableTopicCard([rumor, pricing], 'ja', operator);
  assert.equal(picked.coreFact, pricing.coreFact);
  assert.equal(selectReusableTopicCard([{ ...rumor, audienceFit: 'mismatch', excludedReason: 'reader_practice_gap' }], 'ja', operator), null);
});
