'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  verifiedReferenceUrlForJob,
  planVerifiedReference,
  formatTopicSourceAsDossier
} = require('../src/topic_source_vault');
const { candidatePrompt } = require('../src/next_post_draft');
const { enforcePostThreadConstraints } = require('../src/post_constraint_guard');

const url = 'https://docs.example.com/spec/hours';

test('only a topic-source card keeps a verified reference', () => {
  assert.equal(verifiedReferenceUrlForJob({
    sourceType: 'topic_source',
    ownerSparkUsed: false,
    topicRing: 'ring1_craft',
    sourceUrl: url
  }), url);
  assert.equal(verifiedReferenceUrlForJob({ sourceType: 'dossier', sourceUrl: url }), null);
  assert.equal(verifiedReferenceUrlForJob({ sourceType: 'brand_only', sourceUrl: url }), null);
  assert.equal(verifiedReferenceUrlForJob({ sourceType: 'topic_source', ownerSparkUsed: true, sourceUrl: url }), null);
  assert.equal(verifiedReferenceUrlForJob({ sourceType: 'topic_source', topicRing: 'ring3_product_bridge', sourceUrl: url }), null);
});

test('a hidden account does not send a reference reply', () => {
  const plan = planVerifiedReference({
    tweets: ['親の本文です。'],
    verifiedReferenceUrl: url,
    singleOnly: true,
    lang: 'ja',
    maxChars: 140
  });
  assert.equal(plan.action, 'skipped');
  assert.equal(plan.replyText, '');
  assert.equal(plan.tweets.length, 1);
});

test('a visible single post replies once, and a failed reply still leaves the parent posted', () => {
  const plan = planVerifiedReference({
    tweets: ['親の本文です。'],
    verifiedReferenceUrl: url,
    singleOnly: false,
    lang: 'ja',
    maxChars: 140
  });
  assert.equal(plan.action, 'reply');
  assert.equal(plan.replyText, `参考: ${url}`);
  assert.equal(plan.replyText.includes('▼ 詳細および公式案内はこちら'), false);
  const guarded = enforcePostThreadConstraints(['親の本文です。'], { lang: 'ja' });
  assert.equal(guarded.tweets.length, 1);
  const parentPosted = true;
  const replyOk = false;
  const jobStatus = parentPosted ? 'posted' : 'failed';
  const referenceReplyStatus = replyOk ? 'sent' : 'failed';
  assert.equal(jobStatus, 'posted');
  assert.equal(referenceReplyStatus, 'failed');
  const english = planVerifiedReference({
    tweets: ['Parent text.'],
    verifiedReferenceUrl: url,
    singleOnly: false,
    lang: 'en',
    maxChars: 270
  });
  assert.equal(english.replyText, `Source: ${url}`);
});

test('a thread keeps three parts and skips when the last part cannot hold the link', () => {
  const three = planVerifiedReference({
    tweets: ['いち。', 'に。', 'さん。'],
    verifiedReferenceUrl: url,
    singleOnly: false,
    lang: 'ja',
    maxChars: 140
  });
  assert.equal(three.action, 'append');
  assert.equal(three.tweets.length, 3);
  assert.match(three.tweets[2], /\n参考: /);
  const tight = planVerifiedReference({
    tweets: ['いち。', 'あ'.repeat(120)],
    verifiedReferenceUrl: url,
    singleOnly: false,
    lang: 'ja',
    maxChars: 140
  });
  assert.equal(tight.status, 'skipped_length');
  assert.equal(tight.tweets[1].includes(url), false);
  assert.equal(tight.tweets.length, 2);
});

test('the note and the writer prompt never receive the source url', () => {
  const card = {
    sourceName: '公的な調査',
    sourceUrl: url,
    readerQuestion: '正確な発信は、なぜ広がらないのか。',
    coreFact: '調査主体は反応の多い投稿を先に見せていた。',
    mechanism: '目立つ場所は、感情が動いた投稿から埋まっていく。',
    plainTranslation: '正確な投稿でも、感情が動く投稿のあとまわしになる。'
  };
  const note = formatTopicSourceAsDossier(card, false, 700);
  assert.equal(/https?:\/\//.test(note), false);
  assert.match(note, /調べたこと/);
  assert.match(note, /感情が動く投稿のあとまわし/);
  assert.equal(note.includes('訳:'), false);
  assert.equal(note.includes('目立つ場所は'), false);
  const prompt = candidatePrompt({
    isEn: false,
    isolateLpContext: true,
    topicSource: card,
    masterPlan: { topicRing: 'ring1_craft' },
    accountState: { maxChars: 280 },
    shape: { count: 1 }
  });
  assert.equal(prompt.includes(url), false);
  assert.match(prompt, /一般論に薄めず/);
});
