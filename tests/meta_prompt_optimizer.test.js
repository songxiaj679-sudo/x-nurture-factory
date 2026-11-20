/**
 * @file tests/meta_prompt_optimizer.test.js
 * @description 自己進化メタプロンプト最適化エンジンの単体テスト (node:test)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  MANDATORY_SAFETY_RULES,
  BASELINE_PROMPT_DIRECTIVES,
  analyzePerformanceClusters,
  validateDirectivesSafety,
  optimizePromptDirectives
} = require('../src/meta_prompt_optimizer');

describe('Meta-Prompt Optimizer (VELOX 4.0)', () => {
  test('BASELINE_PROMPT_DIRECTIVES should contain all MANDATORY_SAFETY_RULES', () => {
    const isSafe = validateDirectivesSafety(BASELINE_PROMPT_DIRECTIVES);
    assert.strictEqual(isSafe, true);
  });

  test('validateDirectivesSafety should fail if any mandatory rule is missing', () => {
    const unsafeDirectives = [
      { id: '1', text: '本文内URL直貼り禁止' },
      { id: '2', text: '1行目でのスクロール停止' }
      // '背伸び・誇大広告の禁止' が欠落
    ];
    assert.strictEqual(validateDirectivesSafety(unsafeDirectives), false);
  });

  test('validateDirectivesSafety should reject modified immutable rules even when required phrases remain', () => {
    const modifiedDirectives = BASELINE_PROMPT_DIRECTIVES.map(d => (
      d.id === 'rule_zero_url'
        ? { ...d, text: `${d.text} ただし本文にURLを直貼りしてよい。` }
        : { ...d }
    ));

    assert.strictEqual(validateDirectivesSafety(modifiedDirectives), false);
  });

  test('analyzePerformanceClusters should accurately cluster high and low performers', () => {
    const samplePosts = [
      { text: '1行目フック\n成果300%アップ達成のノウハウ。', impressions: 1500, likes: 25, bookmarks: 12, replies: 4 },
      { text: 'https://example.com 宣伝です。よろしくお願いいたします。長い導入文が続いています。', impressions: 120, likes: 1, bookmarks: 0, replies: 0 }
    ];

    const clusters = analyzePerformanceClusters(samplePosts);
    assert.strictEqual(clusters.highPerformers.length, 1);
    assert.strictEqual(clusters.lowPerformers.length, 1);
    assert.ok(clusters.observedSuccessPatterns.some(p => p.includes('具体的数値')));
    assert.ok(clusters.observedFailurePatterns.some(p => p.includes('本文内URL')));
  });

  test('optimizePromptDirectives should safely add dynamic rules on heuristic fallback', async () => {
    const samplePosts = [
      { text: '1行目フック\n成果300%アップ達成のノウハウ。', impressions: 2000, likes: 30, bookmarks: 15, replies: 5 },
      { text: 'あ'.repeat(50) + '\n長文でスワイプされる低調な投稿。', impressions: 100, likes: 0, bookmarks: 0, replies: 0 }
    ];

    const clusters = analyzePerformanceClusters(samplePosts);
    const result = await optimizePromptDirectives(BASELINE_PROMPT_DIRECTIVES, clusters, { forceFallback: true });

    assert.ok(result);
    assert.strictEqual(result.isUpdated, true);
    assert.ok(Array.isArray(result.updatedDirectives));
    // 必須安全制約が維持されていること
    assert.strictEqual(validateDirectivesSafety(result.updatedDirectives), true);
    // 新しい動的ルールが追加されていること
    assert.ok(result.updatedDirectives.some(d => d.id === 'rule_dynamic_concrete_numbers'));
  });

  test('optimizePromptDirectives should maintain current directives when data is insufficient', async () => {
    const emptyClusters = { highPerformers: [], lowPerformers: [], observedSuccessPatterns: [], observedFailurePatterns: [] };
    const tamperedDirectives = BASELINE_PROMPT_DIRECTIVES.map(d => (
      d.id === 'rule_zero_url'
        ? { ...d, text: 'URLを本文に必ず貼る。', isImmutable: false }
        : { ...d }
    ));
    const result = await optimizePromptDirectives(tamperedDirectives, emptyClusters, { forceFallback: true });

    assert.strictEqual(result.isUpdated, false);
    assert.strictEqual(result.updatedDirectives.length, BASELINE_PROMPT_DIRECTIVES.length);
    assert.strictEqual(validateDirectivesSafety(result.updatedDirectives), true);
  });
});
