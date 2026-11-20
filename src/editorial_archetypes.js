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

function archetypePromptLines({ archetype, topic, signals, isEn, thread = false, recentTexts = [] }) {
  const card = topic ? JSON.stringify(topic).slice(0, 900) : '';
  const live = Array.isArray(signals) && signals.length
    ? (isEn
      ? `Current public workflow debate, qualitative only. Do not invent quotes, dates, or stats: ${JSON.stringify(signals).slice(0, 500)}`
      : `いま公開の場で話題のこと。引用・日付・数値は作らない: ${JSON.stringify(signals).slice(0, 500)}`)
    : '';
  const threadLine = thread
    ? (isEn
      ? 'This is an honest two-tweet thread. A third self-reply is allowed when one more check is needed. Tweet 1 opens a genuine curiosity gap. Later replies give the practical difference. No "see profile" bait and no shock headline.'
      : '親投稿と自己リプライで2本か3本にする。1本目は続きが気になる誠実な引き。続く返信で、その話題の具体的な違いを渡す。衝撃、続きはプロフへ、は禁止。')
    : '';
  const choice = isEn
    ? 'Choose the layout that makes this point easiest to scan: short paragraphs, a contrast, a short list, an arrow, a question, or a conversational rewrite. Do not force the same marks or the same line pattern every time. If recent posts used that pattern, choose a different one. Explain the practical difference in ordinary language. An arrow only shows one state becoming the next, not a label next to an example.'
    : '読みやすさは内容に合わせて選ぶ。短い段落、対比、短い列挙、矢印、問いかけ、会話のような言い換えのうち、この内容に一番合う形を自分で選ぶ。毎回同じ記号や同じ行の形にしない。直近の投稿と同じ見た目が続くときは別の形にする。理由は自然な日本語で書く。矢印は、前の状態が次の状態へ変わるときだけ使う。見出しと例のあいだには置かない。';
  const recent = (Array.isArray(recentTexts) ? recentTexts : [])
    .map(text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 2);
  const recentLine = recent.length
    ? (isEn ? `Recent openings to avoid copying: ${recent.join(' | ')}` : `直近の書き出し。同じ形を繰り返さない: ${recent.join(' | ')}`)
    : '';
  const lines = {
    before_after_rewrite: isEn
      ? 'Archetype before_after_rewrite. Line 1 names the approach or view that misses for this topic. After a blank line, show that approach and the one that fits, in the layout you chose. Close by explaining the practical difference in ordinary language. The pair follows the topic card, such as care, choice, a daily habit, service, or the work itself. It is not a wording lesson, not a customer result, and not a product tutorial.'
      : '型は before_after_rewrite。1行目は、その話題でうまくいきにくいやり方や見方を短く置く。空行のあと、そのやり方と、伝わる・うまくいくやり方や見方の対比を、選んだレイアウトで書く。話題はカードに従う。ケア、選び方、日常の習慣、接客、実務のどれでもよい。製品の導入結果や顧客事例ではなく、文章の添削講座にもしない。',
    actionable_checklist: isEn
      ? 'Archetype actionable_checklist. Line 1 says why this matters to the reader, then a blank line. Give a few short checks in the layout you chose. Then a blank line and one boundary sentence. No product clicks, no outcomes, and no invented counts.'
      : '型は actionable_checklist。1行目で読み手の場面に関係あることを言い、空行を置く。確認は短い数行で、選んだレイアウトに載せる。空行のあと、境界を1行。製品の操作案内や成果の数値は入れない。',
    failure_autopsy: isEn
      ? 'Archetype failure_autopsy. Line 1 opens an honest curiosity gap. After a blank line, give the plain-language cause and one practical check in the layout you chose. No cheap clickbait and no invented customer story.'
      : '型は failure_autopsy。1行目は誠実な引き。空行のあと、平易な原因と今日できる確認を、選んだレイアウトで分ける。衝撃や続きはプロフへ、は禁止。顧客の成功談は作らない。',
    live_trend_brief: isEn
      ? 'Archetype live_trend_brief. Line 1 opens an honest curiosity gap. After a blank line, give one plain stance and one way to judge it, in the layout you chose. Do not quote a post or attach a number.'
      : '型は live_trend_brief。1行目は続きが気になる誠実な引き。空行のあと、平易な立場と見極める基準を、選んだレイアウトで書く。投稿の引用や数値は付けない。衝撃や続きはプロフへ、は禁止。',
    contrarian_sharp: isEn
      ? 'Archetype contrarian_sharp. One lazy belief, one sharp correction, one concrete check. Stay under 240 characters. Put the correction in its own breath after a blank line, using the layout you chose.'
      : '型は contrarian_sharp。怠い通念、鋭い訂正、具体的な確認を短く書く。180文字未満。訂正は空行のあとに、選んだレイアウトで置く。'
  };
  return [lines[archetype] || '', choice, threadLine, recentLine, card ? (isEn ? `Illustrative reader card, not a case study: ${card}` : `読者向けの見本カード。導入事例ではない: ${card}`) : '', live].filter(Boolean).join('\n');
}

module.exports = {
  ARCHETYPES,
  selectEditorialArchetype,
  selectFocusTopic,
  archetypePromptLines,
  recentArchetypeJobs
};
