/**
 * @file tests/episodic_memory_store.test.js
 * @description エピソード記憶ストアの単体テスト (node:test)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  BASELINE_EPISODES,
  extractKeywordsFromText,
  createEpisodeFromPost,
  queryRelevantEpisodes,
  formatEpisodesForPrompt
} = require('../src/episodic_memory_store');

describe('Episodic Memory Store (VELOX 4.0)', () => {
  test('extractKeywordsFromText should extract meaningful tokens and filter stop words', () => {
    const text = 'SaaSの個人開発で最も後悔した仕組み化のノウハウ';
    const keywords = extractKeywordsFromText(text);

    assert.ok(Array.isArray(keywords));
    assert.ok(keywords.length > 0);
    assert.ok(keywords.includes('SaaS') || keywords.includes('個人開発'));
    assert.ok(!keywords.includes('こと'));
  });

  test('createEpisodeFromPost should classify WINNER on high bookmarks and composite score', () => {
    const winnerPost = {
      text: '開発の現場Tips\n再現性のある自動化手順',
      angle: '開発裏話',
      format: 'two_tier_reply_link',
      impressions: 3000,
      bookmarks: 25,
      likes: 50,
      replies: 10,
      lessonLearned: '手順化が保存需要を刺激した'
    };

    const episode = createEpisodeFromPost(winnerPost);
    assert.ok(episode.id.startsWith('ep_'));
    assert.strictEqual(episode.outcome, 'WINNER');
    assert.ok(episode.compositeScore >= 70);
    assert.strictEqual(episode.angle, '開発裏話');
  });

  test('createEpisodeFromPost should classify FAILURE on zero-engagement post with moderate impressions', () => {
    const failPost = {
      text: '単なるツール告知リンク',
      angle: '告知',
      format: 'single_value',
      impressions: 400,
      bookmarks: 0,
      likes: 0,
      replies: 0,
      lessonLearned: '当事者意識が惹けなかった'
    };

    const episode = createEpisodeFromPost(failPost);
    assert.strictEqual(episode.outcome, 'FAILURE');
    assert.ok(episode.compositeScore < 40);
  });

  test('queryRelevantEpisodes should rank matching angle and keywords higher', () => {
    const customEpisodes = [
      {
        id: '1',
        text: 'SaaSの価格設定で学んだこと',
        angle: 'SaaSマネタイズ',
        format: 'single_value',
        outcome: 'WINNER',
        compositeScore: 85,
        keywords: ['SaaS', '価格設定', 'マネタイズ']
      },
      {
        id: '2',
        text: '日常のつぶやき',
        angle: '日常雑談',
        format: 'single_value',
        outcome: 'WINNER',
        compositeScore: 70,
        keywords: ['日常', '雑談']
      }
    ];

    const result = queryRelevantEpisodes({
      angle: 'SaaSマネタイズ',
      keywords: ['SaaS', '価格']
    }, customEpisodes);

    assert.strictEqual(result.winners.length, 2);
    // 最も関連度の高いエピソードが先頭に来ること
    assert.strictEqual(result.winners[0].id, '1');
  });

  test('queryRelevantEpisodes should respect an explicitly empty store', () => {
    const result = queryRelevantEpisodes({}, []);

    assert.deepStrictEqual(result, { winners: [], failures: [] });
  });

  test('formatEpisodesForPrompt should generate formatted Markdown for few-shot injection', () => {
    const mockRetrieved = {
      winners: [
        {
          angle: '開発裏話',
          text: '後悔から学んだ1つの教訓。',
          lessonLearned: '冒頭フックが効いた'
        }
      ],
      failures: [
        {
          angle: '宣伝',
          text: 'ツールはこちらから。',
          lessonLearned: '宣伝感が強すぎた'
        }
      ]
    };

    const promptText = formatEpisodesForPrompt(mockRetrieved);
    assert.ok(promptText.includes('【自社エピソード記憶（過去の実績ナレッジ）】'));
    assert.ok(promptText.includes('▼ 高反響を記録した参考構文'));
    assert.ok(promptText.includes('▼ 反響が低迷した注意構文'));
    assert.ok(promptText.includes('後悔から学んだ1つの教訓。'));
  });
});
