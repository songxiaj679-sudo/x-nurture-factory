'use strict';

/**
 * Deterministic text-shape utilities.
 * Sentiment scores must be supplied by an external estimator; this module does
 * not infer emotion or claim that a particular arc performs better.
 */

function isFiniteNumberSeries(series) {
  return Array.isArray(series) && series.length > 0 &&
    series.every(value => typeof value === 'number' && Number.isFinite(value));
}

/**
 * Calculate normalized dynamic time warping distance using O(m) memory.
 * Invalid or empty sequences return Infinity.
 */
function calculateDTWDistance(seq1, seq2) {
  if (!isFiniteNumberSeries(seq1) || !isFiniteNumberSeries(seq2)) return Infinity;

  let previous = Array(seq2.length + 1).fill(Infinity);
  previous[0] = 0;

  for (let i = 1; i <= seq1.length; i++) {
    const current = Array(seq2.length + 1).fill(Infinity);
    for (let j = 1; j <= seq2.length; j++) {
      const cost = Math.abs(seq1[i - 1] - seq2[j - 1]);
      current[j] = cost + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    previous = current;
  }

  return previous[seq2.length] / Math.max(seq1.length, seq2.length);
}

/**
 * Reference arcs are comparison baselines only, not empirically proven
 * templates or requirements for generated content.
 */
const GOLDEN_ARCS = Object.freeze({
  PAS_STANDARD: Object.freeze([-0.8, -0.4, 0.0, 0.5, 0.8]),
  REVERSAL_STORY: Object.freeze([-0.9, -0.6, 0.2, 0.9]),
  AUTHORITY_INSIGHT: Object.freeze([0.0, -0.2, 0.4, 0.7])
});

function invalidArcResult(feedback) {
  return {
    distance: Infinity,
    isCompliant: false,
    status: 'invalid_input',
    feedback
  };
}

/**
 * Compare externally supplied, normalized sentence scores with a reference arc.
 */
function evaluateSentimentArc(textSentimentSeries, targetArcType = 'PAS_STANDARD', options = {}) {
  if (!isFiniteNumberSeries(textSentimentSeries) ||
      textSentimentSeries.some(score => score < -1 || score > 1)) {
    return invalidArcResult('各文の感情スコア（-1〜1）を指定してください。');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return invalidArcResult('比較オプションが無効です。');
  }

  const arcType = Object.hasOwn(GOLDEN_ARCS, targetArcType) ? targetArcType : 'PAS_STANDARD';
  const threshold = options.threshold === undefined ? 0.35 : options.threshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    return invalidArcResult('比較しきい値が無効です。');
  }

  const goldenArc = GOLDEN_ARCS[arcType];
  const distance = calculateDTWDistance(textSentimentSeries, goldenArc);
  const isCompliant = distance <= threshold;
  let feedback = '指定された参照曲線との距離はしきい値以内です。';

  if (!isCompliant) {
    if (textSentimentSeries.every(score => Math.abs(score) < 0.3)) {
      feedback = '入力された感情スコアは全体に平坦です。感情の起伏が必要か、内容と読者に照らして確認してください。';
    } else if (textSentimentSeries[0] > 0.3 && goldenArc[0] < 0) {
      feedback = '冒頭のスコアが参照曲線と異なります。課題提示が適切か、内容に基づいて確認してください。';
    } else {
      feedback = `入力された感情曲線は参照曲線と異なります（DTW距離: ${distance.toFixed(2)}）。`;
    }
  }

  return { distance, isCompliant, status: 'evaluated', arcType, threshold, feedback };
}

function splitTextSegments(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text.trim()
    .split(/(?:[。！？!?]+|[.]+(?=\s|$))\s*|\r?\n+/u)
    .map(segment => segment.trim())
    .filter(Boolean);
}

/**
 * Compare model-estimated sentence tone to an illustrative reference arc.
 * This is descriptive metadata only and must not be used as an approval gate.
 */
function analyzeSentimentArc(text, sentenceScores, targetArcType = 'PAS_STANDARD') {
  const segments = splitTextSegments(text);
  if (segments.length === 0) {
    return { status: 'unavailable', reason: 'empty_text' };
  }
  if (!Array.isArray(sentenceScores)) {
    return { status: 'unavailable', reason: 'scores_unavailable', segmentCount: segments.length };
  }
  if (sentenceScores.length !== segments.length) {
    return { status: 'unavailable', reason: 'segment_count_mismatch', segmentCount: segments.length };
  }
  if (!isFiniteNumberSeries(sentenceScores) ||
      sentenceScores.some(score => score < -1 || score > 1)) {
    return { status: 'unavailable', reason: 'invalid_scores', segmentCount: segments.length };
  }

  const comparison = evaluateSentimentArc(sentenceScores, targetArcType);
  return {
    status: 'reference_only',
    source: 'model_estimate',
    segmentCount: segments.length,
    sentenceScores: [...sentenceScores],
    referenceComparison: {
      arcType: comparison.arcType,
      dtwDistance: comparison.distance
    },
    note: 'Approximate model-estimated tone only. Reference arcs are illustrative, unvalidated, and not quality or performance targets.'
  };
}

function detectLanguage(text, requestedLanguage) {
  if (requestedLanguage === 'ja' || requestedLanguage === 'en') return requestedLanguage;
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text) ? 'ja' : 'en';
}

/**
 * Return approximate sentence-length statistics, not a standardized
 * readability grade. Japanese and English use different rough length units.
 */
function analyzeReadability(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      status: 'empty',
      language: null,
      sentenceCount: 0,
      totalUnits: 0,
      averageUnitsPerSentence: null,
      longSentenceCount: 0,
      unit: null
    };
  }

  const cleanText = text.trim();
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return { status: 'invalid_options', language: null, sentenceCount: 0 };
  }
  const language = detectLanguage(cleanText, options.language);
  const sentences = splitTextSegments(cleanText);
  const unitFor = sentence => language === 'ja'
    ? Array.from(sentence.replace(/\s+/gu, '')).length
    : (sentence.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  const units = sentences.map(unitFor);
  const totalUnits = units.reduce((sum, value) => sum + value, 0);
  const longSentenceLimit = options.longSentenceLimit === undefined
    ? (language === 'ja' ? 80 : 25)
    : options.longSentenceLimit;

  if (!Number.isSafeInteger(longSentenceLimit) || longSentenceLimit < 1) {
    return { status: 'invalid_options', language, sentenceCount: sentences.length };
  }

  return {
    status: 'estimated',
    language,
    sentenceCount: sentences.length,
    totalUnits,
    averageUnitsPerSentence: Number((totalUnits / sentences.length).toFixed(2)),
    longSentenceCount: units.filter(value => value > longSentenceLimit).length,
    unit: language === 'ja' ? 'non_whitespace_characters' : 'words',
    note: 'Approximate length statistics only; not a readability or comprehension score.'
  };
}

module.exports = {
  calculateDTWDistance,
  GOLDEN_ARCS,
  evaluateSentimentArc,
  splitTextSegments,
  analyzeSentimentArc,
  analyzeReadability
};
