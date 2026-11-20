'use strict';

function toDate(value) {
  const date = value && typeof value.toDate === 'function'
    ? value.toDate()
    : (value instanceof Date ? value : new Date(value));
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

function buildAccountGrowthReport({ handle, hasApi, posts, now = new Date(), isEn = false }) {
  if (!Array.isArray(posts) || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('投稿履歴または集計日時が無効です。');
  }

  const start = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const measured = posts.filter(post => {
    const postedAt = toDate(post?.postedAt);
    const snapshot = post?.metrics24hSnapshot;
    return postedAt && postedAt.getTime() >= start && postedAt.getTime() <= now.getTime() &&
      snapshot?.isFrozen === true &&
      Number.isSafeInteger(snapshot.impressions) && snapshot.impressions > 0 &&
      Number.isSafeInteger(snapshot.bookmarks) && snapshot.bookmarks >= 0 &&
      snapshot.bookmarks <= snapshot.impressions;
  });

  const impressions = measured.reduce((sum, post) => sum + post.metrics24hSnapshot.impressions, 0);
  const bookmarks = measured.reduce((sum, post) => sum + post.metrics24hSnapshot.bookmarks, 0);
  const sampleCount = measured.length;
  const bookmarkRate = impressions > 0 ? bookmarks / impressions : null;
  const notMeasured = '未測定';
  const notMeasuredEn = 'Not measured';
  const sampleNote = `取得した自動投稿ジョブ（最大300件）のうち、過去30日間の凍結済み24時間スナップショットは${sampleCount}件です。`;
  const sampleNoteEn = `${sampleCount} frozen 24-hour snapshots were found among up to 300 fetched autopilot jobs from the last 30 days.`;
  const notMeasuredNote = '利用可能な投稿指標では測定できないため、推定値は表示しません。';
  const notMeasuredNoteEn = 'Not measurable from the available post metrics; no estimate is shown.';
  const algorithmNote = 'Xの推薦順位やリンクによる表示変化は、このレポートから判定できません。';
  const algorithmNoteEn = 'X recommendation ranking and link-related distribution effects cannot be determined from this report.';
  const brandNote = '広告表示を明確にし、成果・比較・数値の主張には確認できる根拠を用意してください。';
  const brandNoteEn = 'Clearly disclose promotions and retain verifiable support for outcome, comparison, and numeric claims.';

  const council = {
    hookAuditor: {
      name: 'フック分析',
      name_en: 'Opening analysis',
      role: '投稿冒頭の比較',
      role_en: 'Post opening comparison',
      score: null,
      comment: notMeasuredNote,
      comment_en: notMeasuredNoteEn
    },
    empathyAuditor: {
      name: '読者反応',
      name_en: 'Reader response',
      role: '実測反応の集計',
      role_en: 'Observed response metrics',
      score: null,
      comment: sampleNote,
      comment_en: sampleNoteEn
    },
    algoAuditor: {
      name: 'プラットフォーム規約',
      name_en: 'Platform policy',
      role: 'Xの推薦順位は測定しません',
      role_en: 'X ranking is not measured',
      score: null,
      comment: algorithmNote,
      comment_en: algorithmNoteEn
    },
    brandAuditor: {
      name: '広告・主張の確認',
      name_en: 'Disclosure and claims',
      role: '投稿前の確認項目',
      role_en: 'Pre-publication checks',
      score: null,
      comment: brandNote,
      comment_en: brandNoteEn
    },
    chiefAuditor: {
      name: '実測レポート',
      name_en: 'Measured report',
      role: '予測・認証ではありません',
      role_en: 'Not a prediction or certification',
      verdict: sampleNote,
      verdict_en: sampleNoteEn
    }
  };

  return {
    handle: String(handle || '').trim().replace(/^@/, '') || 'account',
    hasApi: Boolean(hasApi),
    dataScope: 'autopilot_jobs',
    score: null,
    grade: isEn ? 'Not scored' : '未採点',
    tier: sampleNote,
    tier_en: sampleNoteEn,
    metrics: { reachScore: null, conversionScore: null, brandTrustScore: null },
    radar: null,
    councilDebate: [],
    council,
    telemetry: {
      pastMonthReach: sampleCount ? `${impressions.toLocaleString()} imp` : (isEn ? notMeasuredEn : notMeasured),
      observedPosts: String(sampleCount),
      bookmarkRate: bookmarkRate === null ? (isEn ? notMeasuredEn : notMeasured) : `${(bookmarkRate * 100).toFixed(3)}%`
    },
    actionPrescription: [
      {
        step: '01',
        title: '役立つ情報を継続する',
        title_en: 'Publish useful, sustainable content',
        desc: '読者とテーマを明確にし、続けられる投稿頻度を選びます。',
        desc_en: 'Define the audience and topic, then choose a cadence you can sustain.'
      },
      {
        step: '02',
        title: '実測値で小さく検証する',
        title_en: 'Test small changes against measured data',
        desc: '成熟した投稿の実測値を記録し、一度に一つの変更を比較します。',
        desc_en: 'Record mature post metrics and compare one change at a time.'
      },
      {
        step: '03',
        title: '広告と根拠を明示する',
        title_en: 'Disclose promotions and substantiate claims',
        desc: '宣伝は読者に分かる形で表示し、成果の保証や根拠のない数値を避けます。',
        desc_en: 'Make promotional relationships clear and avoid unsupported numbers or guaranteed outcomes.'
      }
    ]
  };
}

module.exports = { buildAccountGrowthReport };
