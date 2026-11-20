const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectMeasuredPair, formatMeasuredPair } = require('../src/measured_pair');

function job(text, impressions, bookmarks, extra = {}) {
  return {
    text,
    metrics24hSnapshot: {
      isFrozen: true,
      postAgeHours: 25,
      impressions,
      bookmarks,
      ...extra
    }
  };
}

test('measured pair keeps the highest and lowest bookmark rates with impressions', () => {
  const pair = selectMeasuredPair([
    job('表示なし', 0, 0),
    job('未凍結', 100, 50, { isFrozen: false }),
    job('時間外', 100, 40, { postAgeHours: 40 }),
    job('勝ち', 1000, 30),
    job('負け', 1000, 1)
  ]);
  assert.equal(pair.winner.text, '勝ち');
  assert.equal(pair.winner.rate, 0.03);
  assert.equal(pair.loser.text, '負け');
  assert.match(formatMeasuredPair(pair), /勝ち1件: 「勝ち」 表示1000 保存30/);
  assert.doesNotMatch(formatMeasuredPair(pair), /表示なし|未凍結|時間外/);
});

test('a single measured post does not invent a losing example', () => {
  const pair = selectMeasuredPair([job('だけ', 200, 2)]);
  assert.equal(pair.loser, null);
  assert.match(formatMeasuredPair(pair), /比較できる別の実測投稿はまだありません/);
});
