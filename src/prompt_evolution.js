'use strict';

const AXIS_LABELS = {
  ja: {
    scrollStopHook: '1行目',
    saveUtility: '保存したくなる具体',
    strangerClarity: '一読の分かりやすさ',
    craftAndTruth: '作らない数字'
  },
  en: {
    scrollStopHook: 'the opening line',
    saveUtility: 'one saveable point',
    strangerClarity: 'a first-read scene',
    craftAndTruth: 'no invented figures'
  }
};

function frozenTraces(traces) {
  return (Array.isArray(traces) ? traces : []).filter(trace => {
    const residual = trace && trace.outcome24h && trace.outcome24h.residualReward;
    return Number.isFinite(Number(residual));
  });
}

function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mode(rows, key) {
  const counts = Object.create(null);
  for (const row of rows) {
    const value = row && row[key];
    if (value == null || value === '') continue;
    const id = String(value);
    counts[id] = (counts[id] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : '';
}

function sanitizeEvolutionText(text, max) {
  const clean = String(text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/[{}[\]<>`;]/g, '')
    .replace(/9割|月100時間|3\.2倍|3\.4倍|凍結リスクゼロ|シャドウバン|7名|合議|バズ保証|98\.4%/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, max).join('');
}

function fitPair(doMore, avoidMore) {
  let more = sanitizeEvolutionText(doMore, 90);
  let avoid = sanitizeEvolutionText(avoidMore, 90);
  let pair = Array.from(`${more}${avoid}`);
  if (pair.length > 180) {
    avoid = Array.from(avoid).slice(0, Math.max(0, 180 - Array.from(more).length)).join('');
    pair = Array.from(`${more}${avoid}`);
  }
  if (pair.length > 180) more = Array.from(more).slice(0, 180 - Array.from(avoid).length).join('');
  return { doMore: more, avoidMore: avoid };
}

function distillPatch(traces, calibration) {
  const frozen = frozenTraces(traces);
  const wins = frozen.filter(trace => Number(trace.outcome24h.residualReward) > 0);
  const losses = frozen.filter(trace => Number(trace.outcome24h.residualReward) < 0 || (trace.calibration && trace.calibration.verdict === 'false_positive_honors'));
  const english = frozen.filter(trace => trace.lang === 'en').length >= frozen.filter(trace => trace.lang !== 'en').length;
  const labels = AXIS_LABELS[english ? 'en' : 'ja'];
  const predictive = labels[calibration && calibration.predictiveAxis] || (english ? 'the opening line' : '1行目');
  const overrated = labels[calibration && calibration.overratedAxis] || (english ? 'a polished explanation' : '丁寧な説明');
  const hook = mode(wins, 'selectedHookAngle');
  const source = mode(wins, 'sourceType');
  const count = mode(wins, 'segmentCount');
  const losingHook = mode(losses, 'selectedHookAngle');
  const raw = english
    ? {
      doMore: `Winners lean on ${predictive}, ${hook || 'a concrete opening'}, ${source || 'owned facts'}, and ${count || '1'} part.`,
      avoidMore: `Losses pile up when ${overrated} scores high. ${losingHook ? `Do not repeat ${losingHook}.` : 'Do not delay the point.'}`
    }
    : {
      doMore: `勝ちは${predictive}と${hook || '現場の一行'}、${source || '自社の事実'}の${count || '1'}段に寄っている。`,
      avoidMore: `伸びないのは${overrated}が高い丁寧な説明。${losingHook ? `${losingHook}は繰り返さない。` : '前置きで結論を遅らせない。'}`
    };
  const fitted = fitPair(raw.doMore, raw.avoidMore);
  if (!fitted.doMore) fitted.doMore = english ? 'Put the concrete action in the first two sentences.' : '具体の一動作を先に置く。';
  if (!fitted.avoidMore) fitted.avoidMore = english ? 'Do not delay the point with a polished preface.' : '丁寧な前置きで結論を遅らせない。';
  return fitPair(fitted.doMore, fitted.avoidMore);
}

function evaluatePromptEvolution(traces, currentEvolution = null, calibration = null, now = new Date()) {
  const frozen = frozenTraces(traces);
  const current = currentEvolution && typeof currentEvolution === 'object' ? currentEvolution : null;
  if (frozen.length < 5 || !calibration || calibration.status !== 'ok') return { changed: false, promptEvolution: current };
  const stamp = (now instanceof Date ? now : new Date(now)).toISOString();
  const challenger = current && current.challenger;
  if (challenger && challenger.version) {
    const samples = frozen.filter(trace => trace.evolutionVersion === challenger.version);
    if (samples.length < 3) return { changed: false, promptEvolution: current };
    const challengerMedian = median(samples.map(trace => Number(trace.outcome24h.residualReward)));
    const activeRows = current.active && current.active.version
      ? frozen.filter(trace => trace.evolutionVersion === current.active.version)
      : [];
    const baselineMedian = activeRows.length ? median(activeRows.map(trace => Number(trace.outcome24h.residualReward))) : 0;
    const won = challengerMedian > 0 && challengerMedian >= baselineMedian;
    const next = won
      ? {
        active: { version: challenger.version, doMore: challenger.doMore, avoidMore: challenger.avoidMore, promotedAt: stamp },
        challenger: null,
        historyCount: Number(current.historyCount || 0) + 1,
        frozenCount: frozen.length,
        updatedAt: stamp
      }
      : { ...current, challenger: null, frozenCount: frozen.length, updatedAt: stamp };
    return { changed: true, promptEvolution: next };
  }
  const seen = current && Number.isFinite(Number(current.frozenCount)) ? Number(current.frozenCount) : 0;
  const first = !current || !current.updatedAt;
  if (!first && frozen.length - seen < 3) return { changed: false, promptEvolution: current };
  const patch = distillPatch(frozen, calibration);
  const version = `evo_${Number(current && current.historyCount || 0) + 1}`;
  return {
    changed: true,
    promptEvolution: {
      active: current && current.active || null,
      challenger: { version, doMore: patch.doMore, avoidMore: patch.avoidMore, createdAt: stamp, minSamples: 3 },
      historyCount: Number(current && current.historyCount || 0),
      frozenCount: frozen.length,
      updatedAt: stamp
    }
  };
}

function chooseEvolutionAssignment({ evolution, jobs, topicRing, isWildcard } = {}) {
  const active = evolution && evolution.active && evolution.active.version;
  const challenger = evolution && evolution.challenger && evolution.challenger.version;
  const eligible = (topicRing === 'ring1_craft' || topicRing === 'ring2_broad_adjacent') && isWildcard !== true;
  if (!challenger || !eligible) return active || 'baseline';
  const last = (Array.isArray(jobs) ? jobs : []).find(job => job && job.evolutionVersion);
  if (!last || last.evolutionVersion !== challenger) return challenger;
  return active || 'baseline';
}

function evolutionPatchFor(evolution, version) {
  if (!evolution || !version || version === 'baseline') return null;
  if (evolution.active && evolution.active.version === version) return evolution.active;
  if (evolution.challenger && evolution.challenger.version === version) return evolution.challenger;
  return null;
}

module.exports = {
  sanitizeEvolutionText,
  evaluatePromptEvolution,
  chooseEvolutionAssignment,
  evolutionPatchFor
};
