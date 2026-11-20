'use strict';

function toDate(value) {
  const date = value && typeof value.toDate === 'function'
    ? value.toDate()
    : (value instanceof Date ? value : new Date(value));
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

function buildWeeklyGrowthReport({ posts, now = new Date() }) {
  if (!Array.isArray(posts) || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('投稿履歴または集計日時が無効です。');
  }

  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const recentPosts = posts.filter(post => {
    const postedAt = toDate(post?.postedAt);
    return postedAt && postedAt.getTime() >= weekStart && postedAt.getTime() <= now.getTime();
  });

  const measuredPosts = recentPosts.filter(post => {
    const snapshot = post?.metrics24hSnapshot;
    return snapshot?.isFrozen === true &&
      Number.isSafeInteger(snapshot.impressions) && snapshot.impressions > 0 &&
      Number.isSafeInteger(snapshot.bookmarks) && snapshot.bookmarks >= 0 &&
      snapshot.bookmarks <= snapshot.impressions;
  });
  const impressions = measuredPosts.reduce((total, post) => total + post.metrics24hSnapshot.impressions, 0);
  const bookmarks = measuredPosts.reduce((total, post) => total + post.metrics24hSnapshot.bookmarks, 0);
  const bySlot = new Map();

  for (const post of measuredPosts) {
    const slot = String(post.timeSlot || post.slotId || post.scheduledSlot || post.slot || '').trim();
    if (!slot) continue;
    const aggregate = bySlot.get(slot) || { impressions: 0, bookmarks: 0, posts: 0 };
    aggregate.impressions += post.metrics24hSnapshot.impressions;
    aggregate.bookmarks += post.metrics24hSnapshot.bookmarks;
    aggregate.posts++;
    bySlot.set(slot, aggregate);
  }

  const rankedSlots = [...bySlot.entries()]
    .map(([slot, data]) => ({ slot, ...data, rate: data.bookmarks / data.impressions }))
    .sort((a, b) => b.rate - a.rate || a.slot.localeCompare(b.slot));
  const hasComparison = rankedSlots.length >= 2;
  const formatSlot = item => {
    if (!item) return null;
    const rate = `${(item.rate * 100).toFixed(3)}%`;
    return {
      slotName: `${item.slot} (${item.posts}件)`,
      slotName_en: `${item.slot} (${item.posts} posts)`,
      reason: `24時間後の表示${item.impressions.toLocaleString()}件に対するブックマーク率は${rate}です。切り口の因果効果を示すものではありません。`,
      reason_en: `The 24-hour bookmark rate was ${rate} across ${item.impressions.toLocaleString()} impressions. This does not establish a causal effect of the content angle.`
    };
  };
  const provisionalImpressions = recentPosts.reduce((sum, post) => {
    const value = Number(post?.metrics?.impressions ?? post?.metrics24hSnapshot?.impressions);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  const provisionalBookmarks = recentPosts.reduce((sum, post) => {
    const value = Number(post?.metrics?.bookmarks ?? post?.metrics24hSnapshot?.bookmarks);
    return Number.isFinite(value) && value >= 0 ? sum + value : sum;
  }, 0);
  const summary = measuredPosts.length
    ? `取得した最大300件の投稿記録のうち、過去7日間の投稿は${recentPosts.length}件、凍結済み24時間指標がある投稿は${measuredPosts.length}件です。表示${impressions.toLocaleString()}件、ブックマーク${bookmarks.toLocaleString()}件を集計しました。`
    : (provisionalImpressions > 0
      ? `取得した最大300件の投稿記録のうち、過去7日間の投稿は${recentPosts.length}件（累計表示 ${provisionalImpressions.toLocaleString()}件・保存 ${provisionalBookmarks.toLocaleString()}件・反映中）です。時間帯の優劣比較に使う24時間凍結スナップショットがまだ揃っていないため、比較評価は未測定です。`
      : `取得した最大300件の投稿記録のうち、過去7日間の投稿は${recentPosts.length}件です。凍結済み24時間指標がないため、反応の比較や評価は未測定です。`);
  const summaryEn = measuredPosts.length
    ? `Among up to 300 fetched post records, ${recentPosts.length} were published in the last 7 days; ${measuredPosts.length} have frozen 24-hour metrics. Totals: ${impressions.toLocaleString()} impressions and ${bookmarks.toLocaleString()} bookmarks.`
    : (provisionalImpressions > 0
      ? `Among up to 300 fetched post records, ${recentPosts.length} were published in the last 7 days (${provisionalImpressions.toLocaleString()} live impressions and ${provisionalBookmarks.toLocaleString()} bookmarks so far). Slot comparisons are not measured yet because frozen 24-hour snapshots are not ready.`
      : `Among up to 300 fetched post records, ${recentPosts.length} were published in the last 7 days. Response comparisons and ratings are not measured because frozen 24-hour metrics are unavailable.`);

  return {
    totalPosts: recentPosts.length,
    measuredPosts: measuredPosts.length,
    impressions,
    bookmarks,
    councilScore: null,
    weekSummary: summary,
    weekSummary_en: summaryEn,
    bestSlotAnalysis: hasComparison ? formatSlot(rankedSlots[0]) : null,
    worstSlotAnalysis: hasComparison ? formatSlot(rankedSlots[rankedSlots.length - 1]) : null,
    nextWeekDirectives: [
      '24時間指標が凍結されるまで投稿の優劣は判断しない。',
      '切り口を比較する場合は、同じ指標と観測期間を使う。',
      '宣伝関係と数値主張の根拠を投稿前に確認する。'
    ],
    nextWeekDirectives_en: [
      'Do not compare post performance until 24-hour metrics are frozen.',
      'Use the same metric and observation window when comparing content angles.',
      'Check promotional disclosures and evidence for numerical claims before publishing.'
    ],
    generatedAt: now.toISOString(),
    geneSummary: summarizeGenes(measuredPosts),
    hourSummary: summarizeHours(measuredPosts),
    recommendedExperiments: recommendExperiments(measuredPosts)
  };
}

function recommendExperiments(posts) {
  if (!Array.isArray(posts) || posts.length < 4) return [];
  const genes = summarizeGenes(posts).slice().sort((a, b) => b.bookmarks - a.bookmarks || b.posts - a.posts);
  if (!genes.length) return [];
  const top = genes[0];
  const low = genes[genes.length - 1];
  return [
    `今週の記録では「${top.angle}」のブックマークが${top.bookmarks}件、「${low.angle}」が${low.bookmarks}件でした。来週は手順解説を増やすか問いかけを増やすかを、同じ24時間指標で比べられます。この差は因果を断定するものではありません。`,
    `This week's records show ${top.bookmarks} bookmarks for "${top.angle}" and ${low.bookmarks} for "${low.angle}". Next week can compare more procedure posts with more questions, using the same 24-hour metric. This does not establish causation.`
  ];
}

function summarizeHours(posts) {
  const buckets = new Map();
  for (const post of posts) {
    const hour = post.postedHourLocal;
    if (!hour) continue;
    const bucket = buckets.get(hour) || { hour, posts: 0, bookmarks: 0 };
    bucket.posts += 1;
    bucket.bookmarks += post.metrics24hSnapshot.bookmarks;
    buckets.set(hour, bucket);
  }
  return [...buckets.values()].map(bucket => ({
    ...bucket,
    note: `${bucket.hour}時台の記録は${bucket.posts}件です。この差は因果を示すものではありません。`
  }));
}

function summarizeGenes(posts) {
  const buckets = new Map();
  for (const post of posts) {
    const angle = post.genes && post.genes.angle;
    if (!angle) continue;
    const bucket = buckets.get(angle) || { angle, posts: 0, impressions: 0, bookmarks: 0 };
    bucket.posts += 1;
    bucket.impressions += post.metrics24hSnapshot.impressions;
    bucket.bookmarks += post.metrics24hSnapshot.bookmarks;
    buckets.set(angle, bucket);
  }
  return [...buckets.values()].map(bucket => ({
    ...bucket,
    note: `${bucket.angle} は24時間後の記録が${bucket.posts}件です。この並びは因果を示すものではありません。`
  }));
}

module.exports = { buildWeeklyGrowthReport };
