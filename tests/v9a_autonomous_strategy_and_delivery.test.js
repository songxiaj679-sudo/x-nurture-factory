'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseGenesForPost } = require('../src/bandit_optimization_engine');
const { writingShape, fitsAccountState } = require('../src/customer_post_state');
const { runDeterministicAudit } = require('../src/draft_verifier');
const { weeklyStrategyHint } = require('../src/autonomous_strategy_architect');
const { editorialDirective } = require('../src/editorial_lexicon_engine');

const paid = { subscription: 'premium', postShape: 'single', singleOnly: false, maxChars: 900, lang: 'ja' };

test('paid delivery explores one time in five and a hidden account stays single', () => {
  const exploit = chooseGenesForPost({ accountState: paid, random: () => 0.8 });
  const explore = chooseGenesForPost({ accountState: paid, random: () => 0.1 });
  const hidden = chooseGenesForPost({ accountState: { ...paid, singleOnly: true }, random: () => 0.1 });
  assert.equal(exploit.delivery, 'single');
  assert.equal(explore.delivery, 'parent_self_reply');
  assert.equal(hidden.delivery, 'single');
  assert.equal(typeof exploit.angle, 'string');
  assert.equal(typeof exploit.format, 'string');
});

test('a stronger self-reply history is reused on the next paid post', () => {
  const frozen = (impressions, bookmarks) => ({ isFrozen: true, impressions, bookmarks, replies: 0, quotes: 0, retweets: 0, likes: 0 });
  const posts = [
    { genes: { delivery: 'single', angle: 'field_observation' }, timeSlot: 'evening', postedAt: '2026-11-01T00:00:00.000Z', metrics24hSnapshot: frozen(1000, 1) },
    { genes: { delivery: 'parent_self_reply', angle: 'field_observation' }, timeSlot: 'evening', postedAt: '2026-11-02T00:00:00.000Z', metrics24hSnapshot: frozen(1000, 40) }
  ];
  const chosen = chooseGenesForPost({ posts, accountState: paid, timeSlot: 'evening', random: () => 0.8 });
  assert.equal(chosen.delivery, 'parent_self_reply');
});

test('a paid self-reply series accepts two or three posts and rejects four', () => {
  const state = { ...paid, delivery: 'parent_self_reply' };
  const shape = writingShape(state);
  assert.deepEqual(shape, { thread: true, count: 2, minCount: 2, maxCount: 3 });
  const one = '朝の一杯は、淹れた直後より少し置いた方が香りが残る。';
  const two = '一口目で香りが残っているかだけ見る。';
  const three = '冷めた杯には、この見方を使わない。';
  const four = '店の外の音が強い日は、席を奥にする。';
  assert.equal(fitsAccountState([one], state), false);
  assert.equal(fitsAccountState([one, two], state), true);
  assert.equal(fitsAccountState([one, two, three], state), true);
  assert.equal(fitsAccountState([one, two, three, four], state), false);
  const accepted = runDeterministicAudit({ tweets: [one, two, three] }, { lang: 'ja', accountState: state, recentTexts: [], brandKnowledge: { verifiedClaims: [], verifiedPricing: [] } });
  const rejected = runDeterministicAudit({ tweets: [one, two, three, four] }, { lang: 'ja', accountState: state, recentTexts: [], brandKnowledge: { verifiedClaims: [], verifiedPricing: [] } });
  assert.equal(accepted.reasons.includes('shape_mismatch'), false);
  assert.equal(rejected.reasons.includes('shape_mismatch'), true);
});

test('a weekly memo loses its counts and a niche hint stays available after five posts', () => {
  const hint = weeklyStrategyHint([
    { at: '2026-11-01T00:00:00.000Z', memo: '古いメモ' },
    { at: '2026-11-20T00:00:00.000Z', memo: '今週の記録ではブックマークが12件でした。来週は問いかけを増やす。' }
  ]);
  assert.equal(hint.includes('12'), false);
  assert.equal(hint.includes('件'), false);
  assert.match(hint, /問いかけを増やす/);
  assert.equal(weeklyStrategyHint([{ memo: '12件' }]), '');
  const line = editorialDirective(
    { cognitiveMove: 'concrete_check', endingMove: 'verdict_cut', registerLock: 'plain_ja', registerInstruction: '常体で統一する。' },
    { matureCount: 8, nicheHint: '朝の一文は場面から入る / 短い段落', weeklyStrategyHint: hint },
    false
  );
  assert.match(line, /業種の構造メモ/);
  assert.match(line, /今週の方針/);
  assert.equal(line.includes('12'), false);
});
