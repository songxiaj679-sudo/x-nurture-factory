'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideEditorialPlan, evolveAccountLexiconAndLessons } = require('../src/editorial_lexicon_engine');
const { analyzePerformanceClusters } = require('../src/meta_prompt_optimizer');

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

test('a recent question ending is not chosen again', () => {
  const plan = decideEditorialPlan({
    accountState: { lang: 'ja' },
    recentPosts: ['入口を先に残しますか？', '確認は一つに固定する。']
  });
  assert.notEqual(plan.endingMove, 'genuine_tension');
  assert.match(plan.endingMove, /verdict_cut|condition_edge|concrete_check/);
});

test('a repeated recent phrase is retired from the next post', () => {
  const plan = decideEditorialPlan({
    accountState: { lang: 'ja' },
    recentPosts: [
      '遅延境界を先に置くと、再試行の判断が一つに残る。',
      '遅延境界を後から足すと、同じ判断が現場で分かれる。',
      '今日の確認対象は別の入口だけにする。'
    ]
  });
  assert.ok(plan.autoRetiredFromRecent.includes('遅延境界'));
});

test('an official account stays in one polite register', () => {
  const plan = decideEditorialPlan({
    accountState: { lang: 'ja' },
    voiceProfile: { accountRole: 'official_brand', register: 'official-polite' },
    recentPosts: []
  });
  assert.equal(plan.registerLock, 'polite_ja');
  assert.match(plan.registerInstruction, /です・ます/);
  assert.match(plan.registerInstruction, /ここにある/);
});

test('the same mature digest does not call the model again', async () => {
  let calls = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeJson() {
      calls += 1;
      return { parsed: { domainTerms: ['遅延境界'], winningExpressions: ['入口を一つ'], retiredPhrases: [], preferredRegister: 'plain_ja', whyWon: '保存が残った', whyLost: '疑問で閉じた', episodeLessons: [{ tweetId: '1', lessonLearned: '入口を一つに固定する。' }, { tweetId: '2', lessonLearned: '疑問文の締めをやめる。' }] } };
    }
  });
  const enginePath = require.resolve('../src/editorial_lexicon_engine');
  delete require.cache[enginePath];
  try {
    const engine = require('../src/editorial_lexicon_engine');
    const posts = [
      { tweetId: '1', text: '入口を一つに固定する。', bookmarks: 4, impressions: 100 },
      { tweetId: '2', text: 'どこから始めますか？', bookmarks: 0, impressions: 80 }
    ];
    const first = await engine.evolveAccountLexiconAndLessons({ maturePosts: posts, currentKnowledge: {} });
    const second = await engine.evolveAccountLexiconAndLessons({ maturePosts: posts, currentKnowledge: { domainLexicon: first.domainLexicon } });
    assert.equal(calls, 1);
    assert.equal(second.skipped, true);
    assert.ok(first.domainLexicon.domainTerms.includes('遅延境界'));
    assert.equal(first.episodeLessons.length, 2);
    assert.equal(first.pairInsight.whyWon, '保存が残った');
  } finally {
    restore();
    delete require.cache[enginePath];
  }
});

test('cluster analysis keeps the original patterns and adds angle and question bias', () => {
  const clusters = analyzePerformanceClusters([
    { text: '入口を固定。成果は300件。', impressions: 1500, likes: 20, bookmarks: 8, replies: 2, genes: { angle: 'constraint_boundary' } },
    { text: '境界を先に見る。成果は120件。', impressions: 900, likes: 10, bookmarks: 4, replies: 1, angle: 'constraint_boundary' },
    { text: 'https://example.com を本文に置いて、どこから始めますか？', impressions: 50, likes: 0, bookmarks: 0, replies: 0 },
    { text: '長い導入のあとで、もう一度同じ問いを重ねますか？', impressions: 40, likes: 0, bookmarks: 0, replies: 0 }
  ]);
  assert.ok(clusters.observedSuccessPatterns.some(row => row.includes('具体的数値')));
  assert.ok(clusters.observedFailurePatterns.some(row => row.includes('本文内URL')));
  assert.ok(clusters.observedSuccessPatterns.some(row => row.includes('constraint_boundary')));
  assert.ok(clusters.observedFailurePatterns.some(row => row.includes('疑問文')));
});
