/**
 * @file tests/autonomous_evolution_core.test.js
 * @description 自律進化コア機能（DPOペア構造・MAP-Elites適応度計算・会話サポート）の単体テスト
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

let storedGrid = {};
const db = {
  collection(name) {
    if (name === 'saas_users') {
      return { doc: () => ({
        async get() { return { exists: false }; },
        collection: () => {
          const query = {
            orderBy() { return query; },
            limit() { return query; },
            async get() { return { docs: [] }; }
          };
          return query;
        }
      }) };
    }
    assert.strictEqual(name, 'collective_intelligence');
    return {
      doc() {
        return {
          async get() { return { exists: Object.keys(storedGrid).length > 0, data: () => ({ grid: storedGrid }) }; },
          async set(value) { storedGrid = value.grid; }
        };
      }
    };
  }
};
const firestorePath = require.resolve('../src/firestore');
require.cache[firestorePath] = { id: firestorePath, filename: firestorePath, loaded: true, exports: { db } };
const { calculateParetoFitness, sampleFromMapElitesArchive, registerPostPerformanceAndReflect } = require('../src/map_elites_memory');
const { getUserMarketingKnowledge } = require('../src/ai_deliberation_council');
for (const name of ['../src/collective_intelligence', '../src/official_api_client']) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports: {} };
}
const { buildCouncilWritingPrompt, fetchUrlSummary } = require('../src/autonomous_promo_ai');

describe('Autonomous Evolution Core (VELOX 4.0)', () => {
  test('calculateParetoFitness returns baseline score when impressions is 0', () => {
    const score = calculateParetoFitness({ impressions: 0 });
    assert.strictEqual(score, 60);
  });

  test('calculateParetoFitness rewards high bookmarks and engagement rates', () => {
    const lowMetrics = {
      impressions: 1000,
      likes: 2,
      retweets: 0,
      quotes: 0,
      bookmarks: 0,
      profileClicks: 0
    };
    const highMetrics = {
      impressions: 1000,
      likes: 50,
      retweets: 10,
      quotes: 5,
      bookmarks: 20,
      profileClicks: 15
    };

    const lowScore = calculateParetoFitness(lowMetrics);
    const highScore = calculateParetoFitness(highMetrics);

    assert.ok(highScore > lowScore);
    assert.ok(highScore >= 70);
    assert.ok(lowScore < 60);
  });

  test('empty archives use unverified exploration rather than invented results', async () => {
    storedGrid = {};
    const sample = await sampleFromMapElitesArchive('user', { allowMutation: false }, db);
    assert.strictEqual(sample.mode, 'exploration');
    assert.ok(sample.cellId);
    assert.match(sample.directive, /未検証/);
    assert.strictEqual(sample.referenceHook, undefined);
    assert.strictEqual(sample.eliteScore, undefined);
  });

  test('measured results can populate an empty cell without competing against fake seed scores', async () => {
    storedGrid = {};
    const cellId = 'contrarian:logical_thread:b2b_executive';
    const result = await registerPostPerformanceAndReflect({
      userId: 'user', cellId, postText: 'Actual post',
      metrics: { impressions: 100, bookmarks: 0, likes: 0 }
    });
    assert.ok(result.fitness < 82);
    assert.strictEqual(storedGrid[cellId].fullSample, 'Actual post');
    assert.match(storedGrid[cellId].reflection, /因果関係は未検証/);
    storedGrid[cellId].reflection = '根拠のない旧分析';
    const sample = await sampleFromMapElitesArchive('user', { allowMutation: false }, db);
    assert.strictEqual(sample.mode, 'exploitation');
    assert.strictEqual(sample.referenceHook, 'Actual post');
    assert.doesNotMatch(sample.reflection, /根拠のない旧分析/);
    assert.match(sample.reflection, /因果関係は未検証/);
    assert.match(sample.directive, /因果関係は未検証/);
  });

  test('getUserMarketingKnowledge includes dpoPreferencePairs in default and returned schema', async () => {
    const knowledge = await getUserMarketingKnowledge('non_existent_mock_user_123');
    assert.ok(knowledge);
    assert.ok(Array.isArray(knowledge.dpoPreferencePairs));
    assert.ok(Array.isArray(knowledge.negativeList));
    assert.ok(Array.isArray(knowledge.successfulCases));
    assert.ok(Array.isArray(knowledge.failedCases));
    assert.deepStrictEqual(knowledge.successfulCases, []);
    assert.deepStrictEqual(knowledge.failedCases, []);
    assert.deepStrictEqual(knowledge.topPerformingAngles, []);
  });

  test('legacy synthetic cases are excluded while real saved cases are preserved', async () => {
    const legacySuccess = {
      title: '具体的数字・Before/After対比型',
      hookSnippet: '残業月40時間→定時退社で売上2倍。私が実践した“仕組み化の3大原則”がこれ',
      whyItSucceeded: '具体的な数字がタイムラインでのスクロールを止め、ブックマーク率が急上昇した。',
      format: 'two_tier_reply_link', impressions: 2400
    };
    const legacyFailure = {
      title: '抽象的・問いかけのみで終わるフック',
      hookSnippet: '効率化に悩んでいませんか？ツールの導入がおすすめです。',
      flawReason: '誰にでも言える導入で、ターゲットの当事者意識を刺激できず離脱された。',
      improvementPoint: '誰の・どんな状況を指しているのかターゲットを1行目で絞り込む。',
      impressions: 320
    };
    const savedSuccess = { ...legacySuccess, impressions: 2401 };
    const savedFailure = { title: 'Real post', hookSnippet: 'Actual post' };
    const targetDb = { collection: () => ({ doc: () => ({
      async get() { return { exists: true, data: () => ({
        successfulCases: [legacySuccess, savedSuccess], failedCases: [legacyFailure, savedFailure]
      }) }; }
    }) }) };
    const knowledge = await getUserMarketingKnowledge('user', targetDb);
    assert.deepStrictEqual(knowledge.successfulCases, [savedSuccess]);
    assert.deepStrictEqual(knowledge.failedCases, [savedFailure]);
    assert.deepStrictEqual(knowledge.topPerformingAngles, []);
    assert.deepStrictEqual(await getUserMarketingKnowledge('new-user', {
      collection: () => ({ doc: () => ({ async get() { return { exists: true, data: () => ({}) }; } }) })
    }).then(data => data.successfulCases), []);
  });

  test('new-user writing prompt does not present default examples as measured results', async () => {
    const userKnowledge = await getUserMarketingKnowledge('new-user');
    const { prompt } = await buildCouncilWritingPrompt({
      userKnowledge,
      councilPlan: { postPlan: [{ timeSlot: 'morning' }] }
    });
    assert.ok(!prompt.includes('残業月40時間→定時退社で売上2倍。私が実践した'));
    assert.ok(!prompt.includes('過去30日間で120社のアカウントを精査'));
    assert.ok(!prompt.includes('【🏆 自社実測勝ちパターン'));
    assert.match(prompt, /誰に・なぜ今・どの根拠か/);
  });

  test('page summary reads supplied HTML and does not fetch a URL', async () => {
    const html = await fetchUrlSummary('<html><head><title>月額980円</title><meta name="description" content="法人メールで申し込めます"></head><body><h1>手順は三つです</h1></body></html>');
    assert.equal(html.title, '月額980円');
    assert.equal(html.description, '法人メールで申し込めます');
    assert.deepEqual(html.headings, ['手順は三つです']);
    assert.ok(html.pageVersion);
    const blocked = await fetchUrlSummary('http://127.0.0.1/private');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.title, undefined);
  });

  test('DPO preference pair schema validates winner vs loser structure', () => {
    const mockDpoPair = {
      winner: {
        text: '痛点数字を入れた高反響ポスト',
        impressions: 1500,
        bookmarks: 18,
        whyWon: '具体的数字による高い保存動線'
      },
      loser: {
        text: '抽象的な感想ポスト',
        impressions: 300,
        bookmarks: 0,
        whyLost: '当事者意識を惹けず離脱'
      },
      pairedAt: new Date()
    };

    assert.ok(mockDpoPair.winner.bookmarks > mockDpoPair.loser.bookmarks);
    assert.strictEqual(typeof mockDpoPair.winner.whyWon, 'string');
    assert.strictEqual(typeof mockDpoPair.loser.whyLost, 'string');
  });
});
