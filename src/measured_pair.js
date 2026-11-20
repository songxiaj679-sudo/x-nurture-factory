'use strict';

function measuredBookmark(job) {
  const snap = job && job.metrics24hSnapshot;
  if (!snap || snap.isFrozen !== true) return null;
  const age = snap.postAgeHours;
  if (typeof age !== 'number' || age < 24 || age > 36) return null;
  const impressions = snap.impressions;
  const bookmarks = snap.bookmarks;
  if (typeof impressions !== 'number' || !Number.isFinite(impressions) || impressions <= 0) return null;
  if (typeof bookmarks !== 'number' || !Number.isFinite(bookmarks) || bookmarks < 0) return null;
  return { impressions, bookmarks, rate: bookmarks / impressions };
}

function containsJapaneseScript(text) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\uFF66-\uFF9F]/u.test(String(text || ''));
}

function measuredText(job, lang) {
  const japanese = typeof job?.text === 'string' ? job.text.trim() : '';
  const english = typeof job?.text_en === 'string' ? job.text_en.trim() : '';
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  const text = isEn
    ? (english || (containsJapaneseScript(japanese) ? '' : japanese))
    : (japanese || english);
  if (!text || (isEn && containsJapaneseScript(text))) return '';
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

function selectMeasuredPair(jobs, options = {}) {
  const lang = options && options.lang;
  const rows = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const metric = measuredBookmark(job);
    const text = measuredText(job, lang);
    if (!metric || !text) continue;
    rows.push({ text, ...metric });
  }
  rows.sort((a, b) => b.rate - a.rate || b.bookmarks - a.bookmarks || b.impressions - a.impressions);
  if (rows.length === 0) return { winner: null, loser: null };
  const winner = rows[0];
  const loser = rows.length > 1 && rows[rows.length - 1] !== winner ? rows[rows.length - 1] : null;
  return { winner, loser };
}

function formatRate(rate) {
  return `${(rate * 100).toFixed(3)}%`;
}

function formatMeasuredPair(pair, lang = 'ja') {
  const isEn = String(lang).toLowerCase().startsWith('en');
  if (!pair || !pair.winner) {
    return isEn ? [
      '[Measured results for this account]',
      'No post yet has impressions in the 24–36 hour window.',
      'Do not invent results, experiences, or numbers.'
    ].join('\n') : [
      '【このアカウントの実測】',
      '公開後24〜36時間で表示回数が取れた投稿はまだありません。',
      '未測定の成果、体験、数値は書かないでください。'
    ].join('\n');
  }
  if (isEn) {
    const line = (label, item) => `${label}: "${item.text}" impressions ${item.impressions} bookmarks ${item.bookmarks} bookmark rate ${formatRate(item.rate)}`;
    return [
      '[This account, bookmark rate 24–36 hours after publish]',
      line('Winner', pair.winner),
      pair.loser ? line('Loser', pair.loser) : 'Loser: No second measured post is available for comparison.',
      'Use only this winner, this loser, and the fixed rules. Ignore posts without impressions, simulated scores, and explanations of cause.'
    ].join('\n');
  }
  const line = (label, item) => `${label}: 「${item.text}」 表示${item.impressions} 保存${item.bookmarks} ブックマーク率${formatRate(item.rate)}`;
  return [
    '【このアカウントの実測（公開後24〜36時間のブックマーク率）】',
    line('勝ち1件', pair.winner),
    pair.loser ? line('負け1件', pair.loser) : '負け1件: 比較できる別の実測投稿はまだありません。',
    '次の投稿は、この勝ち1件と負け1件、および不変ルールだけを参考にしてください。表示回数がない投稿、仮想の点数、原因の説明は使わないでください。'
  ].join('\n');
}

module.exports = { containsJapaneseScript, selectMeasuredPair, formatMeasuredPair };
