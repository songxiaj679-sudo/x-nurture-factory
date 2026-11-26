'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('writer and critic rules stay industry-neutral inside the existing limits', () => {
  const { systemRules, criticSystemRules } = require('../src/next_post_draft');
  const rules = systemRules(false);
  const critic = criticSystemRules(false);
  assert.match(rules, /英語の直訳のような硬い言い回し/);
  assert.equal(rules.includes('実務家・開発者'), false);
  assert.equal(critic.length < 400, true);
  assert.equal(critic.includes('accountRole'), false);
  assert.equal(critic.includes('トレードオフ'), false);
  assert.match(critic, /1行目の主語が結びまで/);
  assert.match(critic, /保存したくなる具体/);
});

test('before and after follows the topic instead of a wording lesson', () => {
  const { archetypePromptLines } = require('../src/editorial_archetypes');
  const line = archetypePromptLines({ archetype: 'before_after_rewrite', isEn: false });
  assert.match(line, /うまくいきにくいやり方/);
  assert.match(line, /内容に合わせて選ぶ/);
  assert.equal(line.includes('作業文の見本'), false);
  assert.equal(line.includes('よくある言い方がなぜ届かないか'), false);
});

test('polite sole shops stay operators and corporate bios stay official', () => {
  const { detectOfficialBrandAccount } = require('../src/account_voice_profiler');
  const polite = ['肩の張りは、今日の使い方で変わります。', '終わりに深呼吸をひとつ添えます。'];
  assert.equal(detectOfficialBrandAccount({
    user: { xUsername: 'sakura_seitai', displayName: 'さくら整体' },
    bio: '近所の肩と腰をみています',
    texts: polite
  }), false);
  assert.equal(detectOfficialBrandAccount({
    user: { xUsername: 'sakura', targetUrl: 'https://example.com/sakura' },
    bio: '小さなカフェです',
    texts: ['本日のパンを焼きました']
  }), false);
  assert.equal(detectOfficialBrandAccount({
    user: { verifiedType: 'blue' },
    bio: '髪を整えます',
    texts: ['今日の仕上がりをご案内します。']
  }), false);
  assert.equal(detectOfficialBrandAccount({
    user: { verifiedType: 'business' },
    bio: '',
    texts: []
  }), true);
  assert.equal(detectOfficialBrandAccount({
    bio: '文章設計を支える VELOX AI の公式アカウントです',
    texts: polite
  }), true);
});

test('an isolated draft still receives the reader persona and not the product page', () => {
  const source = fs.readFileSync('src/next_post_draft.js', 'utf8');
  const draft = source.slice(source.indexOf('async function draftNextPostWithMeta'), source.indexOf('function attachPromoReply') > -1 ? source.length : source.length);
  assert.match(draft, /audienceKnowledge && audienceKnowledge\.readerPersona/);
  assert.match(draft, /readerLine/);
  assert.match(draft, /isolateLpContext \? null : brandKnowledge/);
  assert.match(source, /function candidatePrompt\([\s\S]*readerLine/);
  assert.match(source, /lightReviewPrompt\(\{ isEn, readerLine/);
  assert.match(source, /repaired: true/);
});
