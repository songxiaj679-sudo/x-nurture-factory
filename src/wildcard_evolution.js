'use strict';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ARM_CAP = 4;

const WILDCARD_RECIPES = Object.freeze([
  {
    id: 'wc_cross_domain_analogy',
    ja: '異分野の仕組みを1つだけ借りて、読者の現場の仕組みが一瞬で分かる対比にする。料理、建築、航空、スポーツの判定のどれか1つ。いつもの解説の型と言い回しは外す。自然な口語と空行は守る。比喩や対比は2文目までに必ず現場の一動作へ戻し、遠回りな説明を伸ばさない。',
    en: 'Borrow one mechanism from cooking, building, flight, or sports officiating. Use it once so the reader sees their own work. Leave the usual explainer shape. Keep spoken English and blank lines. Land the analogy back onto one concrete practitioner action by sentence 2; never stretch the metaphor.'
  },
  {
    id: 'wc_sacred_cow_inversion',
    ja: 'その業界で良い習慣だと思われていることを1つだけ取り上げ、現場で見ると逆になる点を示す。いつもの型と言い回しは外す。自然な口語と空行は守る。比喩や対比は2文目までに必ず現場の一動作へ戻し、遠回りな説明を伸ばさない。',
    en: 'Take one habit the field treats as obviously good, and show the point where the work runs the other way. Leave the usual shape. Keep spoken English and blank lines. Land the analogy back onto one concrete practitioner action by sentence 2; never stretch the metaphor.'
  },
  {
    id: 'wc_failure_autopsy',
    ja: '成功談ではなく、真面目にやって静かに失敗した構造を順にほどく。見落としは1点だけ。いつもの型と言い回しは外す。自然な口語と空行は守る。比喩や対比は2文目までに必ず現場の一動作へ戻し、遠回りな説明を伸ばさない。',
    en: 'Skip the success story. Walk through one careful attempt that failed quietly, and name one missed point. Leave the usual shape. Keep spoken English and blank lines. Land the analogy back onto one concrete practitioner action by sentence 2; never stretch the metaphor.'
  },
  {
    id: 'wc_reverse_metric_lens',
    ja: 'みんなが見る表の数字ではなく、現場で実際に効く観察ポイントから切り直す。いつもの型と言い回しは外す。自然な口語と空行は守る。作った数字は書かない。',
    en: 'Leave the public number everyone watches. Open from the observation that actually changes the work. Leave the usual shape. Keep spoken English and blank lines. Do not invent a figure.'
  }
]);

const WILDCARD_IDS = Object.freeze(WILDCARD_RECIPES.map(recipe => recipe.id));

function recipeById(id) {
  return WILDCARD_RECIPES.find(recipe => recipe.id === id) || null;
}

function recipeLine(id, isEn) {
  const recipe = recipeById(id);
  if (!recipe) return '';
  return isEn ? recipe.en : recipe.ja;
}

function jobMillis(job) {
  const raw = job && (job.postedAt || job.scheduledAt || job.createdAt || job.updatedAt);
  const date = raw && typeof raw.toDate === 'function' ? raw.toDate() : (raw ? new Date(raw) : null);
  const ms = date ? date.getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function selectWeeklyWildcard({ accountState, masterPlan, jobs, promotedArms, now = new Date() } = {}) {
  if (!accountState || accountState.singleOnly || accountState.searchVisible !== true) return null;
  const ring = String(masterPlan && masterPlan.topicRing || '');
  if (ring !== 'ring1_craft' && ring !== 'ring2_broad_adjacent') return null;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const history = Array.isArray(jobs) ? jobs : [];
  const recent = history.filter(job => job && nowMs - jobMillis(job) <= WEEK_MS && nowMs >= jobMillis(job));
  if (recent.some(job => job.isWildcard === true)) return null;
  const frozen = history.filter(job => job && job.metrics24hSnapshot && job.metrics24hSnapshot.isFrozen === true);
  const postedRecent = recent.filter(job => job.isWildcard !== true && (job.status === 'posted' || job.postedAt));
  if (!frozen.length && postedRecent.length < 2) return null;
  const counts = Object.create(null);
  for (const id of WILDCARD_IDS) counts[id] = 0;
  const used = history.filter(job => job && WILDCARD_IDS.includes(job.wildcardRecipe))
    .slice()
    .sort((a, b) => jobMillis(b) - jobMillis(a));
  for (const job of used) counts[job.wildcardRecipe] += 1;
  const promoted = new Set((Array.isArray(promotedArms) ? promotedArms : []).filter(id => WILDCARD_IDS.includes(id)));
  const unpromoted = WILDCARD_RECIPES.filter(recipe => !promoted.has(recipe.id));
  const pool = unpromoted.length ? unpromoted : WILDCARD_RECIPES;
  const least = Math.min(...pool.map(recipe => counts[recipe.id]));
  const tied = pool.filter(recipe => counts[recipe.id] === least);
  const lastId = used[0] && used[0].wildcardRecipe;
  const recipe = tied.find(item => item.id !== lastId) || tied[0];
  return recipe ? { id: recipe.id, ja: recipe.ja, en: recipe.en } : null;
}

function freshHook(current, recentHooks) {
  const banned = new Set((Array.isArray(recentHooks) ? recentHooks : []).filter(Boolean));
  if (!banned.has(current)) return current || '';
  const { GENE_SPACES } = require('./bandit_optimization_engine');
  return GENE_SPACES.hookType.find(item => !banned.has(item)) || current || '';
}

function evaluateWildcardPromotions(traces, currentPromoted = []) {
  const groups = Object.create(null);
  for (const trace of Array.isArray(traces) ? traces : []) {
    const id = trace && trace.wildcardRecipe;
    if (!WILDCARD_IDS.includes(id)) continue;
    const residual = trace.outcome24h && trace.outcome24h.residualReward;
    if (!Number.isFinite(Number(residual))) continue;
    const stamp = trace.createdAt || (trace.outcome24h && trace.outcome24h.frozenAt) || '';
    if (!groups[id]) groups[id] = [];
    groups[id].push({ residual: Number(residual), stamp: String(stamp) });
  }
  let promoted = (Array.isArray(currentPromoted) ? currentPromoted : []).filter(id => WILDCARD_IDS.includes(id));
  promoted = promoted.filter(id => {
    const rows = groups[id] || [];
    if (rows.length < 3) return true;
    const latest = rows.slice().sort((a, b) => b.stamp.localeCompare(a.stamp)).slice(0, 3).map(row => row.residual);
    return !(median(latest) < 0);
  });
  for (const id of WILDCARD_IDS) {
    if (promoted.includes(id) || promoted.length >= ARM_CAP) continue;
    const rows = groups[id] || [];
    if (rows.length < 2) continue;
    if (median(rows.map(row => row.residual)) > 0) promoted.push(id);
  }
  return promoted.slice(0, ARM_CAP);
}

module.exports = {
  WILDCARD_RECIPES,
  WILDCARD_IDS,
  recipeById,
  recipeLine,
  selectWeeklyWildcard,
  freshHook,
  evaluateWildcardPromotions
};
