/**
 * @file tests/audience_simulation_engine.test.js
 * @description 仮想オーディエンス評価器のユニットテスト (node:test)
 * 決定的なテストのため、外部APIを呼ばない明示的なフォールバック設定を使用します。
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  AUDIENCE_PERSONAS,
  calculateWeightedAudienceScore,
  normalizeSentenceSentiments,
  evaluatePostWithAudience,
  simulateAudienceReaction,
  selectBestDraftBySimulation
} = require('../src/audience_simulation_engine');

describe('Audience Simulation Engine (VELOX 4.0)', () => {
  test('AUDIENCE_PERSONAS should define 5 distinct critic personas with weights summing to 1.0', () => {
    assert.strictEqual(AUDIENCE_PERSONAS.length, 5);
    const totalWeight = AUDIENCE_PERSONAS.reduce((sum, p) => sum + p.weight, 0);
    assert.strictEqual(Math.round(totalWeight * 100) / 100, 1.0);
  });

  test('calculateWeightedAudienceScore uses configured persona weights and rejects incomplete scores', () => {
    const critiques = AUDIENCE_PERSONAS.map((persona, index) => ({
      personaId: persona.id,
      score: index === 0 ? 100 : 0
    }));

    assert.strictEqual(calculateWeightedAudienceScore(critiques, 75), 25);
    assert.strictEqual(calculateWeightedAudienceScore(critiques.slice(1), 72), 72);
  });

  test('normalizeSentenceSentiments accepts aligned scores and rejects malformed entries', () => {
    assert.deepStrictEqual(normalizeSentenceSentiments([
      { sentenceIndex: 1, score: -0.5 },
      { sentenceIndex: 2, score: 0.4 }
    ]), [-0.5, 0.4]);
    assert.deepStrictEqual(normalizeSentenceSentiments([-0.5, 0.4]), [-0.5, 0.4]);
    assert.ok(Number.isNaN(normalizeSentenceSentiments([
      { sentenceIndex: 2, score: 0.4 }
    ])[0]));
    assert.equal(normalizeSentenceSentiments(null), null);
  });

  test('simulateAudienceReaction should return valid score, feedback, and evaluationMethod on heuristic fallback', async () => {
    const sampleTweet = 'SaaSの個人開発で最も後悔したこと。\n\nそれは「最初から高機能を作ろうとしたこと」でした。\nまずは1機能・1ターゲットから始めるのが正解です。';
    const result = await simulateAudienceReaction(sampleTweet, {
      accountStage: 'growth',
      forceFallback: true
    });

    assert.ok(result);
    assert.strictEqual(result.originalText, sampleTweet);
    assert.strictEqual(result.evaluationMethod, 'heuristic_fallback');
    assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
    assert.ok(Array.isArray(result.personaCritiques));
    assert.strictEqual(result.personaCritiques.length, 5);
    assert.ok(Array.isArray(result.keyStrengths));
    assert.equal(result.linguisticAnalysis.readabilityEstimate.status, 'estimated');
    assert.equal(result.linguisticAnalysis.readabilityEstimate.language, 'ja');
    assert.equal(result.linguisticAnalysis.sentimentArc.status, 'unavailable');
    assert.equal(result.linguisticAnalysis.sentimentArc.reason, 'scores_unavailable');
  });

  test('simulateAudienceReaction should penalize direct URLs in tweet body under heuristic evaluation', async () => {
    const textWithUrl = '最新AIツールはこちらから使えます https://example.com ぜひチェックしてください！';
    const cleanText = '最新AIツールの実証実験を開始。\n初動24時間で1,200インプレッションを獲得しました。';

    const resultWithUrl = await simulateAudienceReaction(textWithUrl, { forceFallback: true });
    const resultClean = await simulateAudienceReaction(cleanText, { forceFallback: true });

    assert.ok(resultWithUrl.overallScore < resultClean.overallScore);
    assert.ok(resultWithUrl.riskFactors.some(r => r.includes('本文直リンク')));
  });

  test('selectBestDraftBySimulation should pick the highest scoring draft under heuristic evaluation', async () => {
    const candidates = [
      'https://badurl.com 買ってね！', // 低スコア候補（URL直貼り＋短文）
      '個人開発者が最初の100人を集めるための具体策。\n\n1. 毎日の開発進捗を泥臭く公開\n2. ユーザーの意見を24時間以内に実装\n\nこの2つだけで十分です。' // 高スコア候補
    ];

    const { bestDraft, bestScore, allEvaluations } = await selectBestDraftBySimulation(candidates, { forceFallback: true });

    assert.ok(bestScore >= 70);
    assert.ok(bestDraft.includes('個人開発者'));
    assert.strictEqual(allEvaluations.length, 2);
    assert.ok(allEvaluations[0].overallScore >= allEvaluations[1].overallScore);
  });

  test('evaluatePostWithAudience attaches evaluation metadata to a post', async () => {
    const samplePost = {
      text: 'AI駆動開発の現場ログ。\n設計と骨組みを固めてから補完を効かせると手戻りが激減します。',
      tweets: ['AI駆動開発の現場ログ。\n設計と骨組みを固めてから補完を効かせると手戻りが激減します。']
    };

    await evaluatePostWithAudience(samplePost, {
      accountStage: 'growth',
      forceFallback: true
    });

    assert.ok(samplePost.audienceSimulation);
    assert.strictEqual(typeof samplePost.audienceSimulation.overallScore, 'number');
    assert.strictEqual(samplePost.audienceSimulation.evaluationMethod, 'heuristic_fallback');
    assert.strictEqual(samplePost.audienceSimulation.personaCritiques.length, 5);
  });

  test('evaluatePostWithAudience keeps the original text and stores the score as a note', async () => {
    const post = { text: '元の投稿', tweets: ['元の投稿'] };
    const evaluatedTexts = [];

    await evaluatePostWithAudience(post, {}, {
      evaluate: async text => {
        evaluatedTexts.push(text);
        return { originalText: text, overallScore: 60, refinedText: '改善した投稿' };
      }
    });

    assert.deepStrictEqual(evaluatedTexts, ['元の投稿']);
    assert.strictEqual(post.text, '元の投稿');
    assert.strictEqual(post.tweets[0], '元の投稿');
    assert.strictEqual(post.audienceSimulation.overallScore, 60);
  });

  test('evaluatePostWithAudience keeps the original when refinement is unsafe', async () => {
    const post = { text: '元の投稿', tweets: ['元の投稿'] };
    let calls = 0;

    await evaluatePostWithAudience(post, {}, {
      evaluate: async () => {
        calls += 1;
        return { overallScore: 60, refinedText: 'https://example.com 宣伝' };
      },
      isSafeRefinement: text => !/(https?:\/\/[^\s]+)/i.test(text)
    });

    assert.strictEqual(calls, 1);
    assert.strictEqual(post.text, '元の投稿');
    assert.strictEqual(post.tweets[0], '元の投稿');
    assert.strictEqual(post.audienceSimulation.overallScore, 60);
  });
});
