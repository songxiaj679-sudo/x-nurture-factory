'use strict';

function reachRatio(impressions, followers) {
  const shown = Number.isSafeInteger(impressions) ? impressions : 0;
  const base = Math.max(Number.isSafeInteger(followers) ? followers : 0, 20);
  return shown / base;
}

function detectAlgorithmRecovery(posts, followers) {
  const mature = (Array.isArray(posts) ? posts : [])
    .map(post => {
      const snapshot = post && post.metrics24hSnapshot;
      if (!snapshot || snapshot.isFrozen !== true || !Number.isSafeInteger(snapshot.impressions) || snapshot.impressions <= 0) return null;
      return {
        at: new Date(post.postedAt || 0).getTime(),
        ratio: reachRatio(snapshot.impressions, followers)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  if (mature.length < 6) return false;
  const ratios = mature.map(item => item.ratio);
  const baseline = ratios.slice(0, -3);
  if (baseline.length < 3) return false;
  const sorted = baseline.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const recent = ratios.slice(-3);
  return recent.every(ratio => ratio < median * 0.15);
}

module.exports = { detectAlgorithmRecovery, reachRatio };
