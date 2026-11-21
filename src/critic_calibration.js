'use strict';

const { compositeEngagementScore, computeResidualRewards } = require('./metrics_harvest_engine');

const AXIS_KEYS = ['scrollStopHook', 'saveUtility', 'strangerClarity', 'craftAndTruth'];

function countOf(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function postedMillis(post) {
  const raw = post && (post.postedAt || post.createdAt);
  const date = raw && typeof raw.toDate === 'function' ? raw.toDate() : (raw ? new Date(raw) : null);
  const ms = date ? date.getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function finiteAxis(row, key) {
  if (!row || row[key] == null || row[key] === '') return null;
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : null;
}

function buildFrozenOutcome(snapshot, posts, jobId) {
  const impressions = Number(snapshot && snapshot.impressions) || 0;
  const bookmarks = countOf(snapshot && snapshot.bookmarks);
  const likes = countOf(snapshot && snapshot.likes);
  const replies = countOf(snapshot && snapshot.replies);
  const quotes = countOf(snapshot && snapshot.quotes);
  const retweets = countOf(snapshot && snapshot.retweets);
  const metrics = { impressions, bookmarks, likes, replies, quotes, retweets };
  const ordered = (Array.isArray(posts) ? posts : [])
    .filter(post => post && post.metrics24hSnapshot && post.metrics24hSnapshot.isFrozen === true && Number(post.metrics24hSnapshot.impressions) > 0)
    .slice()
    .sort((a, b) => postedMillis(a) - postedMillis(b) || String(a.jobId || a.id || '').localeCompare(String(b.jobId || b.id || '')));
  const index = ordered.findIndex(post => String(post.jobId || post.id || '') === String(jobId || ''));
  let residualReward = null;
  if (index > 0) {
    const rewards = computeResidualRewards(ordered);
    const row = rewards[index];
    if (row && Number.isFinite(row.residual)) residualReward = row.residual - 0.5;
  }
  return {
    impressions,
    bookmarks,
    bookmarkRate: impressions > 0 ? bookmarks / impressions : 0,
    likes,
    replies,
    quotes,
    retweets,
    compositeReward: compositeEngagementScore(metrics).rate,
    residualReward,
    frozenAt: new Date().toISOString()
  };
}

function classifyTraceCalibration(trace, residualReward) {
  if (!trace || trace.criticDegraded === true) return null;
  if (residualReward == null || residualReward === '' || !Number.isFinite(Number(residualReward))) return null;
  const axes = trace.criticAxes;
  const score = finiteAxis(axes, 'score');
  const values = AXIS_KEYS.map(key => finiteAxis(axes, key));
  if (score == null || values.some(value => value == null)) return null;
  const residual = Number(residualReward);
  let verdict = 'aligned_loss';
  if (score >= 80 && residual < 0) verdict = 'false_positive_honors';
  else if (score < 80 && residual > 0) verdict = 'hidden_gem';
  else if (score >= 80 && residual >= 0) verdict = 'aligned_win';
  return {
    verdict,
    axes: {
      scrollStopHook: values[0],
      saveUtility: values[1],
      strangerClarity: values[2],
      craftAndTruth: values[3],
      score
    },
    residualReward: residual,
    evaluatedAt: new Date().toISOString()
  };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (!n || n !== ys.length) return 0;
  const mean = rows => rows.reduce((sum, value) => sum + value, 0) / n;
  const left = mean(xs);
  const right = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - left;
    const b = ys[i] - right;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

function usableTrace(trace) {
  if (!trace || trace.criticDegraded === true) return null;
  const residual = trace.outcome24h && trace.outcome24h.residualReward;
  if (residual == null || residual === '' || !Number.isFinite(Number(residual))) return null;
  const calibration = classifyTraceCalibration(trace, Number(residual));
  return calibration;
}

function summarizeCriticCalibration(traces) {
  const rows = (Array.isArray(traces) ? traces : []).map(usableTrace).filter(Boolean);
  if (rows.length < 5) return { status: 'insufficient_data', sampleCount: rows.length };
  const correlations = {};
  for (const key of [...AXIS_KEYS, 'score']) {
    correlations[key] = pearson(rows.map(row => row.axes[key]), rows.map(row => row.residualReward));
  }
  const counts = { false_positive_honors: 0, hidden_gem: 0, aligned_win: 0, aligned_loss: 0 };
  for (const row of rows) counts[row.verdict] += 1;
  const ranked = AXIS_KEYS.slice().sort((a, b) => correlations[a] - correlations[b] || AXIS_KEYS.indexOf(a) - AXIS_KEYS.indexOf(b));
  return {
    status: 'ok',
    sampleCount: rows.length,
    axisCorrelations: correlations,
    counts,
    falsePositiveRate: counts.false_positive_honors / rows.length,
    overratedAxis: ranked[0],
    predictiveAxis: ranked[ranked.length - 1]
  };
}

function computeCalibratedAxisWeights(calibration) {
  if (!calibration || calibration.status !== 'ok' || Number(calibration.sampleCount) < 5) return null;
  const correlations = calibration.axisCorrelations || {};
  const values = AXIS_KEYS.map(key => Number(correlations[key]));
  if (values.some(value => !Number.isFinite(value)) || values.every(value => value === 0)) return null;
  let weights = values.map(value => 1 + Math.max(-0.25, Math.min(0.25, value * 0.25)));
  const scale = 4 / weights.reduce((sum, value) => sum + value, 0);
  weights = weights.map(value => value * scale);
  for (let pass = 0; pass < 4; pass += 1) {
    let overflow = 0;
    const open = [];
    weights = weights.map((value, index) => {
      const clamped = Math.max(0.75, Math.min(1.25, value));
      overflow += value - clamped;
      if (clamped > 0.75 && clamped < 1.25) open.push(index);
      return clamped;
    });
    if (Math.abs(overflow) < 0.0001 || !open.length) break;
    const share = overflow / open.length;
    open.forEach(index => { weights[index] += share; });
  }
  const rounded = weights.map(value => Math.round(value * 1000) / 1000);
  const drift = Math.round((4 - rounded.reduce((sum, value) => sum + value, 0)) * 1000) / 1000;
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 1000) / 1000;
  const result = {};
  AXIS_KEYS.forEach((key, index) => { result[key] = rounded[index]; });
  return result;
}

module.exports = {
  buildFrozenOutcome,
  classifyTraceCalibration,
  summarizeCriticCalibration,
  computeCalibratedAxisWeights
};
