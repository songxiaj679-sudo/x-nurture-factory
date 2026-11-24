'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { runDeterministicAudit } = require('../src/draft_verifier');
const { sourceIdFor, topicSourceGroundingSnapshot, topicSourceForAudit } = require('../src/topic_source_vault');

const noon = '今の料金が続く前提で選ぶと危ういです\n\n「今は安く使えるから」でツールを選ぶと、条件が変わった日に全体が止まります。有料化後の2024年にTwitter APIを使った研究が前年比13%減ったという、arXivの論文の報告もその一例です。\n\n公式の範囲に収まっているか、権限が必要最小限か、公開前に人が読めるか。この3点で選んでおけば、条件が動いても組み直す範囲は小さく済みます。';
const card = {
  sourceUrl: 'https://journal.example.org/items/api-pricing',
  sourceName: '論文',
  coreFact: 'Twitter APIを使った研究は2006年から2023年まで毎年中央値25%増加していたが、API有料化後の2024年には前年比13%減少した。',
  mechanism: '入口の条件が変わると、その取得元に依存した分析も止まる。',
  plainTranslation: 'In 2024 the papers using that API fell 13% from the year before.',
  readerQuestion: 'APIが有料化すると研究は止まるのか。'
};

function publishContext(topicSource) {
  return {
    lang: 'ja',
    accountState: { maxChars: 500, postShape: 'single', subscription: 'premium', measured: true },
    portfolioPlan: { allowPromoUrl: false },
    recentTexts: [],
    brandKnowledge: { verifiedClaims: [{ verifiedNumbers: ['41'] }] },
    topicSource: topicSource || null
  };
}

function fakeDb(stored) {
  return {
    collection() {
      return {
        doc() {
          return {
            collection() {
              return {
                doc(id) {
                  return {
                    get: async () => ({
                      exists: id === sourceIdFor(card.sourceUrl),
                      data: () => stored
                    })
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

test('a V13 year in the post passes only when the card fact is in the publish audit', () => {
  const bare = runDeterministicAudit({ tweets: [noon] }, publishContext(null));
  assert.equal(bare.reasons.includes('ungrounded_number:2024年'), true);
  const grounded = runDeterministicAudit({ tweets: [noon] }, publishContext(topicSourceGroundingSnapshot(card)));
  assert.equal(grounded.reasons.some(reason => reason.startsWith('ungrounded_number')), false);
  const invented = runDeterministicAudit({
    tweets: ['今の料金が続く前提で選ぶと危ういです。条件が変わった日に全体の88%が止まります。公式の範囲と権限と公開前の確認で選びます。']
  }, publishContext(topicSourceGroundingSnapshot(card)));
  assert.equal(invented.reasons.includes('ungrounded_number:88%'), true);
});

test('an English 2024 in the card grounds the Japanese 2024年, and a year that exists only in the URL does not', () => {
  const englishOnly = topicSourceGroundingSnapshot({
    plainTranslation: 'Papers using the API fell in 2024.',
    coreFact: 'The paid change broke the previous rise.',
    mechanism: 'One paid gate stops the whole study.'
  });
  const fromEnglish = runDeterministicAudit({
    tweets: ['有料化のあと、2024年にその取得は減りました。入口が一つだと、条件が変わった日に全体が止まります。']
  }, publishContext(englishOnly));
  assert.equal(fromEnglish.reasons.some(reason => reason.startsWith('ungrounded_number')), false);
  const urlOnly = topicSourceGroundingSnapshot({
    sourceUrl: 'https://journal.example.org/2024/paper',
    coreFact: '入口の条件が変わると分析も止まる。',
    mechanism: '取得元が一つだと同時に止まる。',
    plainTranslation: '条件が変わった日に全体が止まります。'
  });
  assert.equal(Boolean(urlOnly.sourceUrl), false);
  const leaked = runDeterministicAudit({
    tweets: ['有料化のあと、2024年にその取得は減りました。入口が一つだと、条件が変わった日に全体が止まります。']
  }, publishContext(urlOnly));
  assert.equal(leaked.reasons.includes('ungrounded_number:2024年'), true);
});

test('a reserved parent-and-reply keeps its shape when the stored account snapshot only says premium', () => {
  const tweets = [
    '全部見ないと不安になります\n\n投稿ごとの数字を残らず並べないと、振り返りとは言えない気がしてしまいます。その結果、どれも開かないまま終わる流れになりがちです。',
    '見る範囲を、読み手が自分から動いた投稿に絞ります。開いたら、次に試すことを一つだけ書き残して閉じます。'
  ];
  const state = { maxChars: 900, subscription: 'premium', singleOnly: false };
  const missing = runDeterministicAudit({ tweets }, { ...publishContext(null), accountState: state });
  assert.equal(missing.reasons.includes('shape_mismatch'), true);
  const kept = runDeterministicAudit({ tweets }, { ...publishContext(null), accountState: state, delivery: 'parent_self_reply' });
  assert.equal(kept.reasons.includes('shape_mismatch'), false);
});

test('a pending job without a snapshot still loads the card that matches its reference', async () => {
  const loaded = await topicSourceForAudit(fakeDb(card), {
    userId: 'user-1',
    sourceType: 'topic_source',
    verifiedReferenceUrl: card.sourceUrl
  });
  assert.equal(loaded.coreFact.includes('13%'), true);
  assert.equal(Boolean(loaded.sourceUrl), false);
  const missed = await topicSourceForAudit(fakeDb(card), {
    userId: 'user-1',
    sourceType: 'topic_source',
    verifiedReferenceUrl: 'https://other.example.org/note'
  });
  assert.equal(missed, null);
});

test('reserving a post stores the card grounding and does not consume it before X accepts the post', () => {
  const promo = fs.readFileSync(path.join(__dirname, '../src/autonomous_promo_ai.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/hybrid_saas_routes.js'), 'utf8');
  const reserveAt = promo.lastIndexOf('topicSourceId:');
  const reserve = promo.slice(reserveAt, promo.indexOf('await cancelOtherPendingJobs', reserveAt));
  assert.match(reserve, /topicSourceGrounding/);
  assert.equal(reserve.includes('markTopicSourceUsed'), false);
  assert.match(routes, /topicSourceForAudit/);
  const send = routes.slice(routes.indexOf('markTopicSourceUsed'), routes.indexOf("status: 'posted'"));
  assert.match(send, /topicSourceId/);
});
