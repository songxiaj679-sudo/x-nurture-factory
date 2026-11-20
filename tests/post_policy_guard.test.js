'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectPostCompliance } = require('../src/post_policy_guard');

test('ordinary informational posts pass without unnecessary review', () => {
  const result = inspectPostCompliance([
    '投稿の振り返りでは、表示回数と保存数を分けて記録しています。',
    '次の投稿では、冒頭の説明を短くして反応を確認します。'
  ], { lang: 'ja' });
  assert.equal(result.canAutoPost, true);
  assert.deepEqual(result.issues, []);
});

test('promotional posts require an obvious disclosure near the start of the first post', () => {
  const missing = inspectPostCompliance(['新しいツールの紹介です。', 'https://example.com'], {
    lang: 'ja',
    isPromotion: true
  });
  assert.equal(missing.canAutoPost, false);
  assert.ok(missing.issues.some(issue => issue.code === 'promotion_disclosure_missing'));

  const disclosed = inspectPostCompliance(['【PR】新しいツールを紹介します。', '詳細: https://example.com'], {
    lang: 'ja',
    isPromotion: true
  });
  assert.equal(disclosed.canAutoPost, true);
});

test('incentivized engagement and unsupported outcome claims require review', () => {
  const result = inspectPostCompliance([
    'いいねとリポストで応募、売上が必ず3倍になります。'
  ], { lang: 'ja' });
  assert.equal(result.canAutoPost, false);
  assert.deepEqual(new Set(result.issues.map(issue => issue.code)), new Set([
    'incentivized_engagement',
    'claim_needs_evidence'
  ]));
});

test('English disclosure and claim screening use English markers', () => {
  assert.equal(inspectPostCompliance(['[Ad] A product introduction.', 'Details below.'], {
    lang: 'en',
    isPromotion: true
  }).canAutoPost, true);

  const claim = inspectPostCompliance(['Our tool guarantees 3x revenue growth.'], { lang: 'en' });
  assert.ok(claim.issues.some(issue => issue.code === 'claim_needs_evidence'));
});
