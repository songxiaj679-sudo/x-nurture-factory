const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  analyzeTweetStructure,
  persistIntelligenceKnowledge,
  getTopPerformingHooks,
  getMetricAvailability,
  selectCorpusRecordsToAppend,
  summarizeCorpusPatterns,
  CORPUS_JSONL_FILE
} = require('../src/intelligence_harvester');

test('再収集で出所を確認できた投稿は旧データに追加し、集計では確認済みを優先する', () => {
  const legacy = { tweet_id: '123', genre: 'old', lang: 'ja', metrics: { likes: 999 } };
  const verified = {
    tweet_id: '123', genre: 'current', lang: 'ja', source: 'x_api_recent_search',
    author_followers: 50, metrics: { likes: 0 }, metricAvailability: { likes: true }
  };
  const fresh = { tweet_id: '456', genre: 'new', source: 'x_api_recent_search' };
  const selected = selectCorpusRecordsToAppend([legacy], [verified, verified, fresh]);
  assert.deepEqual(selected, [verified, fresh]);
  assert.deepEqual(selectCorpusRecordsToAppend([legacy, ...selected], [verified, fresh]), []);
  const groups = summarizeCorpusPatterns([legacy, verified]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].genre, 'current');
  assert.equal(groups[0].source, 'api_collected');
  assert.deepEqual(groups[0].likes, { available: 1, median: 0, min: 0, max: 0 });
  assert.deepEqual(summarizeCorpusPatterns([legacy, verified], 32, {
    peerFollowers: { min: 100, max: 200 }
  }), []);
});

test('旧データを残しつつ確認済みの再収集を一度だけ保存する', async t => {
  const legacy = { tweet_id: '123', genre: 'old' };
  const verified = { tweet_id: '123', genre: 'new', source: 'x_api_recent_search' };
  let contents = JSON.stringify(legacy) + '\n';
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => contents);
  t.mock.method(fs, 'appendFileSync', (_file, payload) => { contents += payload; });
  const options = { items: [verified], saveJsonl: true, saveFirestore: false };
  assert.equal((await persistIntelligenceKnowledge(options)).savedCount, 1);
  assert.equal((await persistIntelligenceKnowledge(options)).savedCount, 0);
  assert.deepEqual(contents.trim().split('\n').map(line => JSON.parse(line)), [legacy, verified]);
  const hooks = getTopPerformingHooks({ limit: 10 });
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].genre, 'new');
});

test('Corpus summary includes varied genres and low measured results without copying posts', () => {
  assert.deepEqual(getMetricAvailability({ like_count: 0, retweet_count: -1 }), {
    likes: true, retweets: false, bookmarks: false, impressions: false
  });
  const record = (id, genre, likes, extra = {}) => ({
    tweet_id: id, genre, lang: 'ja', hookType: 'question_hook', ctaType: 'none',
    postFormat: 'single_impact', source: 'x_api_recent_search',
    text: 'PRIVATE SOURCE TEXT', author_username: 'private_author',
    metrics: { likes, impressions: 100 }, metricAvailability: { likes: true, impressions: true },
    ...extra
  });
  const groups = summarizeCorpusPatterns([
    record('101', 'restaurant', 0), record('102', 'restaurant', 100),
    record('102', 'restaurant', 100), record('103', 'dentist', 7),
    record('104', 'software', 3),
    record('seed_fake', 'restaurant', 9999),
    record('105', 'legacy', 0, { source: undefined, metricAvailability: undefined })
  ]);
  const restaurant = groups.find(group => group.genre === 'restaurant');
  assert.equal(restaurant.samples, 2);
  assert.deepEqual(restaurant.likes, { available: 2, median: 0, min: 0, max: 100 });
  assert.equal(groups.find(group => group.genre === 'legacy').likes.available, 0);
  assert.equal(groups.find(group => group.genre === 'legacy').source, 'unverified');
  assert.ok(groups.some(group => group.genre === 'dentist'));
  assert.ok(groups.some(group => group.genre === 'software'));
  assert.doesNotMatch(JSON.stringify(groups), /PRIVATE SOURCE TEXT|private_author|9999/);
  const peers = summarizeCorpusPatterns([
    record('201', 'same', 1, { author_followers: 42 }),
    record('202', 'peer', 1, { author_followers: 43 }),
    record('203', 'too_large', 1, { author_followers: 127 }),
    record('204', 'unknown', 1)
  ], 8, { peerFollowers: { min: 43, max: 126 } });
  assert.deepEqual(peers.map(group => group.genre), ['peer']);
});

test('Intelligence Harvester: Tweet structure analysis and hook categorization', () => {
  // 1. 数字対比フック
  const tw1 = `月100時間かかっていた作業が、たった15分になった手順。\n\nツールの導入ではなく、無駄な工程の全自動化でした。\n詳しい導入リストはリプ欄にまとめました👇`;
  const res1 = analyzeTweetStructure(tw1, { like_count: 500, retweet_count: 120, bookmark_count: 350 });

  assert.equal(res1.hookType, 'numeric_contrast');
  assert.equal(res1.ctaType, 'reply_thread');
  assert.equal(res1.hasInBodyUrl, false);
  assert.equal(res1.metrics.bookmarkRate, 0.7);
  assert.ok(res1.metrics.viralityScore > 1000);

  // 2. 損失回避フック
  const tw2 = `9割の経営者が損している「直リンク減衰」の落とし穴。\n\n実はXアルゴリズムでは本文にリンクを貼るとインプが70%削られます。\n絶対にリプライ2段目に逃がしてください。`;
  const res2 = analyzeTweetStructure(tw2, { like_count: 200, retweet_count: 50, bookmark_count: 180 });

  assert.equal(res2.hookType, 'loss_aversion');
  assert.equal(res2.ctaType, 'reply_thread');
  assert.equal(res2.hasInBodyUrl, false);

  // 3. 直リンクあり・まとめ型
  const tw3 = `おすすめのAIツール5選をまとめました！\nhttps://example.com/ai-tools`;
  const res3 = analyzeTweetStructure(tw3, { like_count: 100, retweet_count: 10, bookmark_count: 40 });

  assert.equal(res3.hookType, 'curated_list');
  assert.equal(res3.hasInBodyUrl, true);

  // 4. 弱小アカウント下剋上バズ（フォロワー350人なのに爆発的エンゲージメント）
  const tw4 = `「個人開発で月5万円稼ぐの無理ゲーだろ」と諦めてた過去の自分に言いたい。\n直リンク全廃したら有料課金18件ついた。`;
  const res4 = analyzeTweetStructure(tw4, { like_count: 1800, retweet_count: 450, bookmark_count: 950 }, { authorFollowers: 350 });

  assert.equal(res4.isUnderdogBuzz, true);
  assert.ok(res4.outlierMultiplier > 5.0);
  assert.ok(res4.metrics.cloutAdjustedScore > res4.metrics.viralityScore);

  // 5. 分割長文・ツリー投稿（スレッド連動・リプライ続き）
  const tw5 = `月100時間かかっていた作業が15分になった手順。\nリプ欄にまとめました👇`;
  const res5 = analyzeTweetStructure(tw5, { like_count: 500, retweet_count: 100, bookmark_count: 300 }, {
    isThread: true,
    threadTweets: [
      tw5,
      '【3大原則】\n① 直リンク排除\n② 冒頭フック\n③ 保存推奨'
    ]
  });

  assert.equal(res5.postFormat, 'split_thread');
  assert.equal(res5.isSplitThread, true);
  assert.equal(res5.threadLength, 2);
  assert.ok(Array.isArray(res5.threadTweets));
});

test('Intelligence Harvester: Persist to JSONLines and retrieve top hooks', async () => {
  const dummyItems = [
    {
      tweet_id: 'test_tweet_1001',
      author_username: 'ai_marketer',
      author_name: 'AI Marketer',
      text: '月100時間かかっていた作業が15分に短縮された手順。\nリプ欄にまとめました。',
      created_at: new Date().toISOString(),
      openingHook: '月100時間かかっていた作業が15分に短縮された手順。',
      hookType: 'numeric_contrast',
      hasInBodyUrl: false,
      ctaType: 'reply_thread',
      metrics: {
        likes: 1000,
        retweets: 300,
        bookmarks: 850,
        viralityScore: 3800
      }
    },
    {
      tweet_id: 'test_tweet_1002',
      author_username: 'growth_lead',
      author_name: 'Growth Lead',
      text: 'まだ手動でX運用して消耗していませんか？\nプロフリンクに自動化の仕組みを公開中。',
      created_at: new Date().toISOString(),
      openingHook: 'まだ手動でX運用して消耗していませんか？',
      hookType: 'loss_aversion',
      hasInBodyUrl: false,
      ctaType: 'profile_link',
      metrics: {
        likes: 500,
        retweets: 150,
        bookmarks: 400,
        viralityScore: 1800
      }
    }
  ];

  const persistRes = await persistIntelligenceKnowledge({
    items: dummyItems,
    saveJsonl: true,
    saveFirestore: false // テスト環境ではJSONLのみ
  });

  assert.ok(persistRes.savedCount >= 0);
  assert.ok(fs.existsSync(CORPUS_JSONL_FILE));

  const topHooks = getTopPerformingHooks('numeric_contrast', 20);
  assert.ok(Array.isArray(topHooks));
  assert.ok(topHooks.some(h => h.tweet_id === 'test_tweet_1001'));
});
