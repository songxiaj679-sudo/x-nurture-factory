'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { systemRules, criticSystemRules, candidatePrompt, briefPrompt, readerVisibleFact } = require('../src/next_post_draft');
const { decideEditorialPlan } = require('../src/editorial_lexicon_engine');

test('the writer drops the stiff constraints and keeps the locked lines', () => {
  const ja = systemRules(false);
  assert.equal(ja.includes('短い言い切り'), false);
  assert.equal(ja.includes('熟語で名前を付けない'), false);
  assert.match(ja, /中学生が一度読んだだけで場面が浮かぶ言葉にする/);
  assert.match(ja, /写してよいのは間の取り方だけ/);
  assert.match(ja, /その場で口に出す一文/);
  assert.match(ja, /解説の先生や締めの標語にはしない/);
  assert.match(ja, /詰め寄る質問にはしない/);
  assert.match(ja, /主語はチーム・開発側・プロダクトにする/);
  assert.match(systemRules(true), /Use words a teenager would say out loud/);
  const critic = criticSystemRules(false);
  assert.equal(critic.length < 400, true);
  assert.match(critic, /1行目の主語が結びまで続く/);
});

test('polite and plain registers each receive one finished example', () => {
  const base = { isEn: false, accountState: { maxChars: 280 }, shape: { count: 1 }, brief: {} };
  const polite = candidatePrompt({ ...base, decision: { registerLock: 'polite_ja' } });
  const plain = candidatePrompt({ ...base, decision: { registerLock: 'plain_ja' } });
  assert.match(polite, /見ておくと安心です/);
  assert.equal(polite.includes('営業時間が最新であること'), false);
  assert.match(plain, /入口の前から一度だけ見る/);
  assert.match(plain, /営業時間が最新であること/);
});

test('an empty page falls back to one stored mechanism line', () => {
  const mechanism = 'VISIBLEFACT'.repeat(20);
  const fact = readerVisibleFact({ description: '', headings: [] }, { oneLineMechanism: mechanism });
  assert.equal(fact, 'VISIBLEFACT'.repeat(20).slice(0, 140));
  assert.equal(fact.length, 140);
  const ring = briefPrompt({
    isEn: false,
    page: { description: '', headings: [], body: 'HIDDEN_PAGE_BODY' },
    masterPlan: { topicRing: 'ring3_product_bridge' },
    brandKnowledge: { oneLineMechanism: mechanism }
  });
  const factLine = ring.split('読者が画面で確かめられる事実は1文だけ: ')[1].split('\n')[0];
  assert.equal(factLine, mechanism.slice(0, 140));
  assert.equal(factLine.length, 140);
  assert.equal(ring.includes('HIDDEN_PAGE_BODY'), false);
  const isolated = briefPrompt({
    isEn: false,
    page: { description: '', headings: [] },
    isolateLpContext: true,
    masterPlan: { topicRing: 'ring3_product_bridge' },
    brandKnowledge: { oneLineMechanism: mechanism }
  });
  assert.equal(isolated.includes('VISIBLEFACT'), false);
});

test('an official account with no posts starts in polite Japanese', () => {
  const operational = decideEditorialPlan({
    accountState: { lang: 'ja' },
    voiceProfile: { accountRole: 'operator', register: 'professional_operational' },
    recentPosts: []
  });
  const official = decideEditorialPlan({
    accountState: { lang: 'ja' },
    voiceProfile: { accountRole: 'official_brand', register: 'plain' },
    recentPosts: []
  });
  const plainPosts = decideEditorialPlan({
    accountState: { lang: 'ja' },
    voiceProfile: { accountRole: 'official_brand', register: 'professional_operational' },
    recentPosts: ['入口は一つだ。', '確認はそこだ。']
  });
  const untouched = decideEditorialPlan({ accountState: { lang: 'ja' }, recentPosts: [] });
  assert.equal(operational.registerLock, 'polite_ja');
  assert.equal(official.registerLock, 'polite_ja');
  assert.equal(plainPosts.registerLock, 'plain_ja');
  assert.equal(untouched.registerLock, 'plain_ja');
});
