'use strict';

const ARCHETYPES = [
  'before_after_rewrite',
  'actionable_checklist',
  'failure_autopsy',
  'live_trend_brief',
  'contrarian_sharp'
];

const WEIGHTS = {
  before_after_rewrite: 25,
  actionable_checklist: 25,
  failure_autopsy: 20,
  live_trend_brief: 15,
  contrarian_sharp: 15
};

const EVERGREEN = ['before_after_rewrite', 'actionable_checklist', 'failure_autopsy'];

function jobTime(job, index) {
  const raw = job && (job.postedAt || job.scheduledAt || job.updatedAt || job.createdAt);
  const date = raw && typeof raw.toDate === 'function' ? raw.toDate() : (raw ? new Date(raw) : null);
  const ms = date ? date.getTime() : NaN;
  return Number.isFinite(ms) ? ms : (Number.MAX_SAFE_INTEGER - index);
}

function recentArchetypeJobs(jobs) {
  return (Array.isArray(jobs) ? jobs : [])
    .map((job, index) => ({ job, index }))
    .filter(row => row.job)
    .sort((a, b) => jobTime(b.job, b.index) - jobTime(a.job, a.index) || a.index - b.index)
    .slice(0, 5)
    .map(row => row.job);
}

function pickWeighted(pool, random) {
  const weights = pool.map(name => WEIGHTS[name] || 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function selectFocusTopic(topics, archetype, recentIds) {
  const rows = (Array.isArray(topics) ? topics : []).filter(topic => topic && topic.archetype === archetype && topic.exampleKind === 'illustrative');
  const fresh = rows.find(topic => topic.id && !recentIds.includes(topic.id));
  return fresh || rows[0] || null;
}

function selectEditorialArchetype({ recentJobs = [], topics = [], radarAvailable = false, random = Math.random } = {}) {
  const recent = recentArchetypeJobs(recentJobs);
  const lastTwo = recent.map(job => job && job.archetype).filter(Boolean).slice(0, 2);
  const recentTopicIds = recent.map(job => job && job.focusTopicId).filter(Boolean);
  let pool = ARCHETYPES.filter(name => !lastTwo.includes(name));
  if (!radarAvailable) pool = pool.filter(name => EVERGREEN.includes(name) || name === 'contrarian_sharp');
  if (!pool.length) pool = ARCHETYPES.filter(name => name !== lastTwo[0] && (radarAvailable || name !== 'live_trend_brief'));
  if (!pool.length) pool = EVERGREEN.filter(name => name !== lastTwo[0]);
  const archetype = pickWeighted(pool.length ? pool : EVERGREEN, random);
  const topic = selectFocusTopic(topics, archetype, recentTopicIds);
  return { archetype, topic, focusTopicId: topic && topic.id || '' };
}

function archetypePromptLines({ archetype, topic, signals, isEn, thread = false }) {
  const card = topic ? JSON.stringify(topic).slice(0, 900) : '';
  const live = Array.isArray(signals) && signals.length
    ? (isEn
      ? `Current public workflow debate, qualitative only. Do not invent quotes, dates, or stats: ${JSON.stringify(signals).slice(0, 500)}`
      : `いま公開の場で話題の作業論。引用・日付・数値は作らない: ${JSON.stringify(signals).slice(0, 500)}`)
    : '';
  const threadLine = thread
    ? (isEn
      ? 'This is an honest two-tweet thread. Tweet 1 opens a genuine curiosity gap or the weak version. Tweet 2, the self-reply, gives the concrete rewrite or the three steps. No "see profile" bait and no shock headline.'
      : '2本の連続ツリーにする。1本目は続きが気になる誠実な引きか、弱い例で止める。2本目の返信で書き直しか3つの手順を渡す。衝撃、続きはプロフへ、は禁止。')
    : '';
  const lines = {
    before_after_rewrite: isEn
      ? 'Archetype before_after_rewrite. Line 1 is a crisp hook about why the common phrasing fails, then a blank line. Put the contrast on its own lines, with a blank line before and after: Before: "..." then After: "...". You may use Weak: and Better: instead. Close with one plain-language sentence on why the second holds. The pair is an illustrative craft example, not a customer result and not a product tutorial.'
      : '型は before_after_rewrite。1行目は、よくある言い方がなぜ届かないかを短く置く。空行のあと、対比は独立した行にする。空行、×「弱い一文」、改行、○「伝わる一文」、空行、なぜ後者が持つかを平易に1〜2行。製品の導入結果や顧客事例ではなく、作業文の見本である。',
    actionable_checklist: isEn
      ? 'Archetype actionable_checklist. Line 1 says why this matters to the reader, then a blank line. Then exactly three short lines a human can scan in one glance: 1. ... 2. ... 3. ... Then a blank line and one boundary sentence. No product clicks, no outcomes, no counts beyond the three steps.'
      : '型は actionable_checklist。1行目で読み手の作業に関係あることを言い、空行を置く。確認はちょうど3行で、・ か ① ② ③ を行頭にする。各行は一目で読める短さ。空行のあと、境界を1行。製品の操作案内や成果の数値は入れない。',
    failure_autopsy: isEn
      ? 'Archetype failure_autopsy. Line 1 opens an honest curiosity gap, then a blank line, a plain-language cause, a blank line, and one practical check on its own line starting with → or a bullet. No cheap clickbait and no invented customer story.'
      : '型は failure_autopsy。1行目は「なぜ？」と自然に気になる誠実な引き。空行、平易な原因、空行、→ か ・ で今日できる確認を独立行にする。衝撃や続きはプロフへ、は禁止。顧客の成功談は作らない。',
    live_trend_brief: isEn
      ? 'Archetype live_trend_brief. Line 1 opens an honest curiosity gap, then a blank line, one plain stance, a blank line, and one evaluation check on its own line starting with → or a bullet. Do not quote a post or attach a number.'
      : '型は live_trend_brief。1行目は続きが気になる誠実な引き。空行、平易な立場、空行、→ か ・ で見極める基準を独立行にする。投稿の引用や数値は付けない。衝撃や続きはプロフへ、は禁止。',
    contrarian_sharp: isEn
      ? 'Archetype contrarian_sharp. One lazy belief, one sharp correction, one concrete check. Stay under 240 characters. Keep the correction on its own line after a blank line.'
      : '型は contrarian_sharp。怠い通念、鋭い訂正、具体的な確認を短く書く。180文字未満。訂正は空行の次の独立行。'
  };
  return [lines[archetype] || '', threadLine, card ? (isEn ? `Illustrative reader card, not a case study: ${card}` : `読者向けの見本カード。導入事例ではない: ${card}`) : '', live].filter(Boolean).join('\n');
}

module.exports = {
  ARCHETYPES,
  selectEditorialArchetype,
  selectFocusTopic,
  archetypePromptLines,
  recentArchetypeJobs
};
