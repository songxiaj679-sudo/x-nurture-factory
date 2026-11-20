'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeReadability,
  calculateDTWDistance,
  evaluateSentimentArc,
  splitTextSegments,
  analyzeSentimentArc,
  GOLDEN_ARCS
} = require('../src/linguistic_analyzer');

test('DTW handles equal, stretched, and invalid input sequences', () => {
  assert.equal(calculateDTWDistance([0, 1, 0], [0, 1, 0]), 0);
  assert.equal(calculateDTWDistance([0, 1, 1, 0], [0, 1, 0]), 0);
  assert.equal(calculateDTWDistance([], [0]), Infinity);
  assert.equal(calculateDTWDistance([0, NaN], [0, 1]), Infinity);
  assert.equal(calculateDTWDistance([0], '1'), Infinity);
});

test('arc evaluation validates normalized scores and labels comparisons as references', () => {
  const aligned = evaluateSentimentArc(GOLDEN_ARCS.PAS_STANDARD);
  assert.equal(aligned.isCompliant, true);
  assert.equal(aligned.status, 'evaluated');
  assert.equal(aligned.arcType, 'PAS_STANDARD');

  const invalid = evaluateSentimentArc(null);
  assert.equal(invalid.status, 'invalid_input');
  assert.equal(invalid.isCompliant, false);
  assert.equal(evaluateSentimentArc([-1.1, 0, 1]).status, 'invalid_input');
  assert.equal(evaluateSentimentArc([0, 0], 'PAS_STANDARD', { threshold: -1 }).status, 'invalid_input');
  assert.equal(evaluateSentimentArc([0, 0], 'PAS_STANDARD', null).status, 'invalid_input');
  assert.match(evaluateSentimentArc([0, 0, 0, 0, 0]).feedback, /平坦/u);
});

test('sentiment arc metadata requires one valid estimate per segment and stays reference-only', () => {
  const text = '困った。手順を整理した。解決できた。';
  const result = analyzeSentimentArc(text, [-0.7, 0, 0.7]);

  assert.equal(splitTextSegments(text).length, 3);
  assert.equal(result.status, 'reference_only');
  assert.equal(result.source, 'model_estimate');
  assert.equal(result.segmentCount, 3);
  assert.equal(typeof result.referenceComparison.dtwDistance, 'number');
  assert.equal(Object.hasOwn(result, 'isCompliant'), false);
  assert.match(result.note, /unvalidated/u);

  assert.equal(analyzeSentimentArc(text, [-0.7]).reason, 'segment_count_mismatch');
  assert.equal(analyzeSentimentArc(text, [-0.7, null, 0.7]).reason, 'invalid_scores');
  assert.equal(analyzeSentimentArc(text, [-1.1, 0, 0.7]).reason, 'invalid_scores');
  assert.equal(analyzeSentimentArc(text, null).reason, 'scores_unavailable');
  assert.equal(analyzeSentimentArc('', [0]).reason, 'empty_text');
});

test('readability estimates use language-appropriate approximate units', () => {
  const english = analyzeReadability('A short sentence. This sentence contains several useful words for readers.');
  assert.equal(english.status, 'estimated');
  assert.equal(english.language, 'en');
  assert.equal(english.sentenceCount, 2);
  assert.equal(english.unit, 'words');
  assert.equal(english.longSentenceCount, 0);
  assert.match(english.note, /not a readability/u);

  const japanese = analyzeReadability('短い文です。これは少し長めの説明文です。');
  assert.equal(japanese.language, 'ja');
  assert.equal(japanese.sentenceCount, 2);
  assert.equal(japanese.unit, 'non_whitespace_characters');
  assert.equal(analyzeReadability('').status, 'empty');
  assert.equal(analyzeReadability('words', { longSentenceLimit: 0 }).status, 'invalid_options');
  assert.equal(analyzeReadability('words', null).status, 'invalid_options');
});
