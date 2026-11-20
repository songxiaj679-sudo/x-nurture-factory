'use strict';

const CONTENT_ANGLES = Object.freeze({
  practical_steps: Object.freeze({
    name: '具体的な手順',
    nameEn: 'Practical steps',
    directive: '読者が自分で試せる手順を、確認できる事実とともに説明する。根拠のない数値や成果は加えない。',
    directiveEn: 'Explain steps the reader can try, using verifiable facts. Do not invent numbers or outcomes.'
  }),
  tradeoffs: Object.freeze({
    name: '選択肢とトレードオフ',
    nameEn: 'Options and trade-offs',
    directive: '複数の選択肢とそれぞれの利点・制約を公平に示し、読者が判断できる材料を提供する。',
    directiveEn: 'Present options and their benefits and limitations fairly so readers can make an informed choice.'
  }),
  misconception: Object.freeze({
    name: 'よくある誤解',
    nameEn: 'Common misconception',
    directive: 'よくある誤解を一つ取り上げ、確認可能な根拠に基づいて説明する。対立や不安をあおらない。',
    directiveEn: 'Address one common misconception with verifiable evidence. Do not provoke conflict or anxiety.'
  }),
  field_observation: Object.freeze({
    name: '観察と学び',
    nameEn: 'Observation and learning',
    directive: '共有可能な観察や実体験が入力されている場合に限り、そこから得た学びを具体的に説明する。',
    directiveEn: 'Describe a concrete lesson only when a shareable observation or firsthand experience has been provided.'
  }),
  reflective_question: Object.freeze({
    name: '振り返りの問い',
    nameEn: 'Reflective question',
    directive: '読者が自身の状況を振り返れる、回答を強制しない具体的な問いを添える。',
    directiveEn: 'Include a specific, optional question that helps readers reflect on their own situation.'
  })
});

const RANDOM_EPSILON = Number.EPSILON;

function randomUnit(random) {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('乱数生成関数は0から1の有限値を返す必要があります。');
  }
  return Math.min(1 - RANDOM_EPSILON, Math.max(RANDOM_EPSILON, value));
}

function sampleStandardNormal(random) {
  const u1 = randomUnit(random);
  const u2 = randomUnit(random);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleLogGamma(shape, random) {
  if (shape < 1) {
    return sampleLogGamma(shape + 1, random) + Math.log(randomUnit(random)) / shape;
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const normal = sampleStandardNormal(random);
    const factor = 1 + c * normal;
    if (factor <= 0) continue;

    const v = factor ** 3;
    const u = randomUnit(random);
    if (u < 1 - 0.0331 * normal ** 4 ||
        Math.log(u) < 0.5 * normal ** 2 + d * (1 - v + Math.log(v))) {
      return Math.log(d) + Math.log(v);
    }
  }
  throw new Error('ガンマ分布のサンプリングが収束しませんでした。');
}

function sampleBetaDistribution(alpha, beta, random = Math.random) {
  if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha <= 0 ||
      typeof beta !== 'number' || !Number.isFinite(beta) || beta <= 0 ||
      typeof random !== 'function') {
    throw new RangeError('ベータ分布の形状パラメーターと乱数生成関数が無効です。');
  }

  const logAlpha = sampleLogGamma(alpha, random);
  const logBeta = sampleLogGamma(beta, random);
  const difference = logBeta - logAlpha;
  if (difference > 0) {
    const ratio = Math.exp(-difference);
    return ratio / (1 + ratio);
  }
  const ratio = Math.exp(difference);
  return 1 / (1 + ratio);
}

function validateState(state) {
  if (state === undefined) return { successes: 0, failures: 0 };
  if (!state || typeof state !== 'object' ||
      !Number.isSafeInteger(state.successes) || state.successes < 0 ||
      !Number.isSafeInteger(state.failures) || state.failures < 0) {
    throw new TypeError('バンディット状態のsuccesses/failuresは0以上の安全な整数で指定してください。');
  }
  return state;
}

function selectActionViaThompsonSampling(stateMap, availableKeys, random = Math.random) {
  if (!Array.isArray(availableKeys) || availableKeys.length === 0) return null;
  if (!stateMap || typeof stateMap !== 'object' || Array.isArray(stateMap) ||
      typeof random !== 'function') {
    throw new TypeError('バンディット状態または選択肢が無効です。');
  }

  const keys = [...new Set(availableKeys)];
  if (keys.some(key => typeof key !== 'string' || key.length === 0)) {
    throw new TypeError('選択肢は空でない文字列で指定してください。');
  }

  let bestKey = keys[0];
  let maxSample = -1;
  for (const key of keys) {
    const state = validateState(Object.hasOwn(stateMap, key) ? stateMap[key] : undefined);
    const sample = sampleBetaDistribution(state.successes + 1, state.failures + 1, random);
    if (sample > maxSample) {
      maxSample = sample;
      bestKey = key;
    }
  }
  return bestKey;
}

function updateBanditState(currentStateMap, appliedKey, score, threshold = 0.8) {
  if (!currentStateMap || typeof currentStateMap !== 'object' || Array.isArray(currentStateMap) ||
      typeof appliedKey !== 'string' || !appliedKey ||
      typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1 ||
      typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new TypeError('バンディット状態更新の入力が無効です。');
  }

  const nextState = { ...currentStateMap };
  const current = validateState(Object.hasOwn(nextState, appliedKey) ? nextState[appliedKey] : undefined);
  if (current.successes >= Number.MAX_SAFE_INTEGER || current.failures >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('バンディット観測数が上限を超えています。');
  }
  Object.defineProperty(nextState, appliedKey, {
    value: {
      successes: current.successes + (score >= threshold ? 1 : 0),
      failures: current.failures + (score >= threshold ? 0 : 1)
    },
    enumerable: true,
    configurable: true,
    writable: true
  });
  return nextState;
}

function learningSnapshot(post) {
  const frozen = post?.metrics24hSnapshot;
  if (frozen?.isFrozen === true) return frozen;
  const early = post?.metricsEarlySnapshot;
  if (early && Number.isSafeInteger(early.impressions) && early.impressions > 0) return early;
  return null;
}

function deriveAngleBanditState(posts, availableAngles, timeSlot, pageVersion = null) {
  if (!Array.isArray(posts) || !Array.isArray(availableAngles) || typeof timeSlot !== 'string') {
    throw new TypeError('投稿履歴、アングル一覧、時間帯を指定してください。');
  }

  const allowedAngles = new Set(availableAngles);
  const requireVersion = typeof pageVersion === 'string' && pageVersion.length > 0;
  const observed = posts.filter(post => {
    const snapshot = learningSnapshot(post);
    return post?.timeSlot === timeSlot &&
      (!requireVersion || post?.pageVersion === pageVersion) &&
      allowedAngles.has(post?.contentAngle) &&
      Number.isSafeInteger(snapshot?.impressions) && snapshot.impressions > 0 &&
      Number.isSafeInteger(snapshot?.bookmarks) && snapshot.bookmarks >= 0 &&
      snapshot.bookmarks <= snapshot.impressions;
  }).map(post => {
    const snapshot = learningSnapshot(post);
    const replies = Number.isSafeInteger(snapshot.replies) && snapshot.replies >= 0 ? snapshot.replies : 0;
    return {
      angle: post.contentAngle,
      rate: Math.min(1, (snapshot.bookmarks + replies) / snapshot.impressions)
    };
  });

  if (observed.length === 0) {
    return { state: {}, baselineRate: null, sampleCount: 0 };
  }

  const sortedRates = observed.map(item => item.rate).sort((a, b) => a - b);
  const middle = Math.floor(sortedRates.length / 2);
  const baselineRate = sortedRates.length % 2
    ? sortedRates[middle]
    : (sortedRates[middle - 1] + sortedRates[middle]) / 2;
  let state = {};
  for (const item of observed) {
    const reward = item.rate > baselineRate ? 1 : 0;
    state = updateBanditState(state, item.angle, reward, 0.5);
  }

  return { state, baselineRate, sampleCount: observed.length };
}

function stableFactId(text) {
  let hash = 2166136261;
  for (const ch of String(text)) {
    hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  }
  return `fact_${(hash >>> 0).toString(16)}`;
}

function extractPageFacts(pageSummary) {
  const facts = [];
  const push = (text) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length < 8 || facts.some(fact => fact.text === clean)) return;
    facts.push({ id: stableFactId(clean), text: clean.slice(0, 180) });
  };
  push(pageSummary && pageSummary.title);
  push(pageSummary && pageSummary.description);
  const headings = Array.isArray(pageSummary && pageSummary.headings) ? pageSummary.headings : [];
  headings.slice(0, 4).forEach(push);
  if (facts.length === 0) push(pageSummary && pageSummary.snippet);
  return facts.slice(0, 5);
}

function chooseFactForSlot(posts, facts, timeSlot) {
  const available = Array.isArray(facts) ? facts.filter(fact => fact && fact.id && fact.text) : [];
  if (available.length === 0) return null;
  const derived = deriveAngleBanditState(posts, available.map(fact => fact.id), String(timeSlot || 'evening'));
  const id = selectActionViaThompsonSampling(derived.state, available.map(fact => fact.id));
  const fact = available.find(item => item.id === id) || available[0];
  return {
    fact,
    sampleCount: derived.sampleCount,
    baselineRate: derived.baselineRate
  };
}

function pageVersionHash(pageSummary) {
  const body = [
    pageSummary && pageSummary.title,
    pageSummary && pageSummary.description,
    ...(Array.isArray(pageSummary && pageSummary.headings) ? pageSummary.headings : []),
    pageSummary && pageSummary.snippet
  ].map(part => String(part || '').replace(/\s+/g, ' ').trim()).join('\n');
  return stableFactId(body);
}

function isPageDisclaimer(line) {
  return /保証するものではありません|保証しません|保証できない|記載はない|利用条件|適用される規約|規約は変更|利用者自身による確認|terms of (?:use|service)|subject to change|does not guarantee|not a guarantee|no warranty|特定商取引法|フッター|法務ページ|解約・更新条件|データの取り扱い|提供条件|プライバシーポリシー|privacy policy|legal notice|利用規約|停止・解約|ボタン1つ|自動更新|無料トライアル終了|規約条件|cancel anytime/i.test(line);
}

function pageLines(pageSummary) {
  return [
    pageSummary && pageSummary.title,
    pageSummary && pageSummary.description,
    ...(Array.isArray(pageSummary && pageSummary.headings) ? pageSummary.headings : []),
    pageSummary && pageSummary.snippet
  ].join('。')
    .split(/[。！？.!?\n]/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 8 && line.length <= 180 && !isPageDisclaimer(line));
}

function knowledgeLine(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < 8 || text.length > 180) return '';
  if (isPageDisclaimer(text) || /対象はページに無い|ページに今の条件は書かれていません/.test(text)) return '';
  return text;
}

function extractPageHypotheses(pageSummary, brandKnowledge = null) {
  const lines = pageLines(pageSummary);
  const version = pageVersionHash(pageSummary);
  const isPricingOrNavNoise = line => /¥|￥|\$|税込|\/\s*月|CREATOR\s*&|Starter\b|Business\b|プラン|料金・機能・FAQ/i.test(line);
  const cleanFragment = line => String(line || '').replace(/[（(][^）)]*$/, '').replace(/\s+/g, ' ').trim();
  const isUiChrome = line => /誰向けか|あなたの声|信用段階の設計|精密読解|事実検証|固定ポストを見て|https?:|www\.|\.com\/|\.png|\.jpg|\.webp/i.test(line);
  const namesAReader = line => !isPricingOrNavNoise(line) && !isUiChrome(line) && !/回復向け|向けの(?:投稿|構成|設計|画面|機能|設定)/.test(line) && /向け|の方|担当者|経営者|開発者|operator|team/i.test(line);
  const isBareProcessHeading = line => /手順|設計/.test(line) && !namesAReader(line);
  const whos = lines.filter(line => namesAReader(line) && !isBareProcessHeading(line)).map(cleanFragment).filter(line => line.length >= 8).slice(0, 2);
  const whys = lines.filter(line => !isBareProcessHeading(line) && !isPricingOrNavNoise(line) && !isUiChrome(line) && /円|価格|申込|期限|条件|日以内|price|apply|until/i.test(line)).map(cleanFragment).filter(line => line.length >= 8).slice(0, 2);
  const proofs = [];
  const headings = Array.isArray(pageSummary && pageSummary.headings) ? pageSummary.headings : [];
  headings.forEach(line => {
    const clean = String(line || '').replace(/\s+/g, ' ').trim();
    if (clean.length >= 8 && clean.length <= 180 && !isPageDisclaimer(clean) && !/誰向けか|あなたの声|信用段階の設計|精密読解|事実検証/.test(clean) && !proofs.includes(clean)) proofs.push(clean);
  });
  lines.forEach(line => {
    if (proofs.length < 3 && !proofs.includes(line) && !isUiChrome(line) && !isPageDisclaimer(line)) proofs.push(line);
  });
  const knowledgeWho = knowledgeLine(brandKnowledge && brandKnowledge.icpSummary);
  const claimLines = (brandKnowledge && Array.isArray(brandKnowledge.verifiedClaims) ? brandKnowledge.verifiedClaims : [])
    .flatMap(claim => [claim && claim.audience, claim && claim.painScene, claim && claim.mechanism])
    .map(knowledgeLine)
    .filter(Boolean);
  const audiences = whos.length ? whos : (knowledgeWho ? [knowledgeWho] : ['対象はページに無い']);
  const reasons = whys.length ? whys : (claimLines.length ? claimLines.slice(0, 2) : ['ページに今の条件は書かれていません']);
  const evidence = proofs.slice(0, 2);
  if (evidence.length === 0) return [];
  const hypotheses = [];
  for (const who of audiences) {
    for (const why of reasons) {
      for (const proof of evidence) {
        hypotheses.push({
          id: stableFactId([version, who, why, proof].join('|')),
          who: cleanFragment(who).slice(0, 180),
          why: cleanFragment(why).slice(0, 180),
          proof: cleanFragment(proof).slice(0, 180),
          pageVersion: version
        });
        if (hypotheses.length >= 5) return hypotheses;
      }
    }
  }
  return hypotheses;
}

function hypothesisForPlaybook(playbook, brandKnowledge, pageSummary) {
  const version = pageVersionHash(pageSummary || {});
  const who = knowledgeLine(brandKnowledge && brandKnowledge.icpSummary) || '現場で次の確認を残す担当者';
  return {
    id: stableFactId([version, playbook && playbook.id, playbook && playbook.readerSituation, playbook && playbook.checkCriteria].join('|')),
    who: String(who).slice(0, 80),
    why: String(playbook && playbook.readerSituation || '').slice(0, 180),
    proof: String(playbook && playbook.checkCriteria || '').slice(0, 180),
    pageVersion: version,
    playbookId: playbook && playbook.id || ''
  };
}

function extractDomainHypotheses(brandKnowledge, pageSummary) {
  const version = pageVersionHash(pageSummary || {});
  const books = brandKnowledge && Array.isArray(brandKnowledge.domainPlaybooks) ? brandKnowledge.domainPlaybooks : [];
  const problems = brandKnowledge && Array.isArray(brandKnowledge.domainProblems) ? brandKnowledge.domainProblems : [];
  const who = knowledgeLine(brandKnowledge && brandKnowledge.icpSummary) || '現場で次の確認を残す担当者';
  const rows = books.length ? books.map(book => ({
    why: book.readerSituation || book.commonMistake,
    proof: book.checkCriteria || book.concreteTradeoff
  })) : problems.map(problem => ({ why: problem, proof: problem }));
  return rows.slice().sort((left, right) => Number(left.why === left.proof) - Number(right.why === right.proof)).map(row => ({
    id: stableFactId([version, who, row.why, row.proof].join('|')),
    who: String(who).slice(0, 80),
    why: String(row.why || '').slice(0, 180),
    proof: String(row.proof || '').slice(0, 180),
    pageVersion: version
  })).filter(item => item.why && item.proof && !isPageDisclaimer(item.why) && !isPageDisclaimer(item.proof)).slice(0, 8);
}

function chooseHypothesis(posts, hypotheses, timeSlot, pageVersion = null) {
  const version = pageVersion || (hypotheses[0] && hypotheses[0].pageVersion) || null;
  const available = (Array.isArray(hypotheses) ? hypotheses : []).filter(item =>
    item && item.id && item.who && item.why && item.proof && (!version || item.pageVersion === version));
  if (available.length === 0) return null;
  const derived = deriveAngleBanditState(posts, available.map(item => item.id), String(timeSlot || 'evening'), version);
  const id = selectActionViaThompsonSampling(derived.state, available.map(item => item.id));
  const hypothesis = available.find(item => item.id === id) || available[0];
  return { hypothesis, sampleCount: derived.sampleCount, baselineRate: derived.baselineRate };
}

function formatHypothesis(choice, lang = 'ja') {
  const isEn = String(lang).toLowerCase().startsWith('en');
  const hypothesis = choice && choice.hypothesis;
  if (!hypothesis) {
    return isEn
      ? 'No page-specific hypothesis is set. Rely strictly on the customer direction, profile, field notes, and verifiable domain principles to deliver one sharp, useful insight without inventing outcomes or copying recent posts.'
      : 'ページ固有の仮説が未設定のため、顧客の方針・プロフィール・公開済みメモと検証可能なドメイン原理だけを使い、読者が実務で使える鋭い一点を書く。ページに無い成果・数値・過去投稿コピーは禁止。';
  }
  const who = hypothesis.who === '対象はページに無い' ? (isEn ? 'not stated on the page' : 'ページに対象の記載はない') : hypothesis.who;
  const why = hypothesis.why === 'ページに今の条件は書かれていません' ? (isEn ? 'not stated on the page' : 'ページに条件の記載はない') : hypothesis.why;
  return isEn
    ? `Write a post a reader could reply to or save. Use the page to explain the product: what it does, who it is for, and one concrete way to use it. Who: "${who}". Why now: "${why}". Proof: "${hypothesis.proof}". If who or why is not stated, leave it out. Do not mention that it is missing. A disclaimer is a limit, not the subject. Do not promise followers, sales, or search placement. Do not add prices, numbers, or stories that are not on the page. Do not copy an earlier post.`
    : `読者が返信したくなる、または保存したくなる投稿を書く。ページにある商品の中身、誰の役に立つか、具体的な使い方を書く。誰に: 「${who}」。なぜ今: 「${why}」。根拠: 「${hypothesis.proof}」。記載がない項目は本文に出さない。「記載はない」とも書かない。免責の一文は主題にしない。フォロワー増加、購入、検索順位は約束しない。ページに無い値段、数値、体験は足さない。過去の投稿文はコピーしない。`;
}

function formatSelectedFact(choice, lang = 'ja') {
  const isEn = String(lang).toLowerCase().startsWith('en');
  if (!choice || !choice.fact) {
    return isEn
      ? 'No page fact is available. Do not invent a claim, and do not copy an earlier post.'
      : '使えるページの事実がありません。効果を作らず、過去の投稿文もコピーしないでください。';
  }
  return isEn
    ? `Use only this fact from the customer's page: "${choice.fact.text}". Do not add results that are not in the page, and do not copy an earlier post.`
    : `お客さんのページにあるこの事実だけを使う: 「${choice.fact.text}」。ページに無い効果は足さない。過去の投稿文はコピーしない。`;
}

const GENE_SPACES = Object.freeze({
  angle: ['practical_steps', 'tradeoffs', 'misconception', 'field_observation', 'reflective_question', 'contrarian_evidence', 'checklist_framework'],
  hookType: ['scene_trigger', 'specific_artifact', 'counter_intuitive', 'direct_question', 'observation_lead', 'problem_reframe'],
  formatSingle: ['micro_punch', 'structured_breakdown', 'narrative_insight'],
  formatThread: ['scene_then_mechanism', 'myth_then_reality'],
  ctaMode: ['zero_cta', 'open_question', 'bookmark_anchor', 'soft_offer_mention', 'explicit_pr_reply']
});

function computeDeconfoundedRewards(posts) {
  const { computeResidualRewards } = require('./metrics_harvest_engine');
  return computeResidualRewards(posts);
}

function geneValue(post, key) {
  return post && post.genes && post.genes[key];
}

function chooseGenesForPost({ posts = [], brandKnowledge = null, portfolioPlan = null, accountState = {}, timeSlot = 'evening', random = Math.random, constraints = {} } = {}) {
  const rewards = computeDeconfoundedRewards(posts);
  const account = Object.create(null);
  const slot = Object.create(null);
  const safeKey = key => {
    const name = String(key || '');
    if (!name || name === '__proto__' || name === 'constructor' || name === 'toString') return '';
    return name;
  };
  const touch = (store, key) => {
    const name = safeKey(key);
    if (!name) return;
    const cell = store[name];
    if (!cell || typeof cell !== 'object' || !Number.isFinite(cell.alpha) || !Number.isFinite(cell.beta)) {
      store[name] = { alpha: 0, beta: 0 };
    }
  };
  const add = (store, key, weight, success) => {
    const name = safeKey(key);
    const w = Number(weight);
    const s = Number(success);
    if (!name || !Number.isFinite(w) || !Number.isFinite(s)) return;
    touch(store, name);
    store[name].alpha += w * s;
    store[name].beta += w * (1 - s);
  };
  const decay = store => {
    for (const cell of Object.values(store)) {
      if (!cell || typeof cell !== 'object' || !Number.isFinite(cell.alpha) || !Number.isFinite(cell.beta)) continue;
      cell.alpha *= 0.94;
      cell.beta *= 0.94;
    }
  };
  for (const reward of rewards) {
    decay(account);
    decay(slot);
    for (const key of ['angle', 'hookType', 'format', 'ctaMode', 'claimSemanticKey', 'delivery']) {
      add(account, geneValue(reward.post, key), reward.weight, reward.residual);
      if (reward.post.timeSlot === timeSlot) add(slot, geneValue(reward.post, key), reward.weight, reward.residual);
    }
  }
  const newest = posts.slice().sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
  const recent = key => newest.map(post => geneValue(post, key)).filter(Boolean);
  const single = accountState.postShape === 'single' || accountState.subscription === 'premium' || accountState.singleOnly;
  const claims = (brandKnowledge && Array.isArray(brandKnowledge.verifiedClaims) ? brandKnowledge.verifiedClaims : [])
    .map(claim => claim.semanticKey)
    .filter(Boolean);
  const spaces = {
    angle: GENE_SPACES.angle,
    hookType: GENE_SPACES.hookType,
    format: single ? GENE_SPACES.formatSingle : GENE_SPACES.formatThread,
    ctaMode: portfolioPlan && portfolioPlan.allowPromoUrl ? ['explicit_pr_reply'] : GENE_SPACES.ctaMode.filter(mode => mode !== 'explicit_pr_reply'),
    claimSemanticKey: claims.length ? claims : ['page_fact'],
    delivery: accountState.singleOnly
      ? ['single']
      : (accountState.subscription === 'premium' ? ['single', 'parent_self_reply'] : ['parent_self_reply'])
  };
  if (constraints.lockClaim) spaces.claimSemanticKey = [constraints.lockClaim];
  for (const key of ['angle', 'hookType', 'claimSemanticKey']) {
    const banned = constraints.avoid && constraints.avoid[key];
    if (!banned) continue;
    const remaining = spaces[key].filter(item => item !== banned);
    if (remaining.length) spaces[key] = remaining;
  }
  const pick = (key) => {
    const options = spaces[key];
    if (options.length === 1) return options[0];
    const history = recent(key);
    let best = options[0];
    let bestSample = -1;
    for (const option of options) {
      const seen = account[option] || { alpha: 0, beta: 0 };
      const slotSeen = slot[option] || { alpha: 0, beta: 0 };
      let sample = sampleBetaDistribution(1.5 + seen.alpha + slotSeen.alpha, 1.5 + seen.beta + slotSeen.beta, random);
      if (history[0] === option && history[1] === option) sample *= 0.65;
      else if (history[0] === option) sample *= 0.75;
      if (sample > bestSample) {
        bestSample = sample;
        best = option;
      }
    }
    return best;
  };
  const pickDelivery = () => {
    const options = spaces.delivery;
    if (options.length === 1) return options[0];
    const mean = option => {
      const seen = account[option] || { alpha: 0, beta: 0 };
      const slotSeen = slot[option] || { alpha: 0, beta: 0 };
      const alpha = 1.5 + seen.alpha + slotSeen.alpha;
      const beta = 1.5 + seen.beta + slotSeen.beta;
      return alpha / (alpha + beta);
    };
    const ranked = options.slice().sort((a, b) => mean(b) - mean(a) || options.indexOf(a) - options.indexOf(b));
    if (random() < 0.2) return ranked[1] || ranked[0];
    return ranked[0];
  };
  return {
    angle: pick('angle'),
    hookType: pick('hookType'),
    format: pick('format'),
    ctaMode: pick('ctaMode'),
    claimSemanticKey: pick('claimSemanticKey'),
    delivery: pickDelivery()
  };
}

function playbookRecencyFactor(playbookId, recentIds) {
  if (recentIds[0] && recentIds[0] === playbookId) return 0.15;
  if (recentIds[1] && recentIds[1] === playbookId) return 0.45;
  return 1;
}

function postedJobTime(job, index) {
  const raw = job && (job.postedAt || job.updatedAt);
  const date = raw && typeof raw.toDate === 'function' ? raw.toDate() : (raw ? new Date(raw) : null);
  const ms = date ? date.getTime() : NaN;
  return Number.isFinite(ms) ? ms : (Number.MAX_SAFE_INTEGER - index);
}

function medianNumber(values) {
  const sorted = [...values].filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function engagementRate(snapshot) {
  const impressions = Number(snapshot && snapshot.impressions);
  if (!(impressions > 0)) return null;
  const bookmarks = Number(snapshot.bookmarks || 0);
  const replies = Number(snapshot.replies || 0);
  const likes = Number(snapshot.likes || 0);
  return ((bookmarks * 3) + (replies * 2) + likes) / impressions;
}

function selectPlaybookByPerformance(playbooks, recentPostedJobs, options = {}) {
  const books = (Array.isArray(playbooks) ? playbooks : []).filter(book => book && book.id);
  if (!books.length) return null;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const ordered = (Array.isArray(recentPostedJobs) ? recentPostedJobs : [])
    .map((job, index) => ({ job, index }))
    .filter(row => row.job)
    .sort((a, b) => postedJobTime(b.job, b.index) - postedJobTime(a.job, a.index) || a.index - b.index);
  const recentIds = ordered.map(row => row.job.focusPlaybookId).filter(Boolean).slice(0, 3);
  const observations = [];
  for (const row of ordered) {
    const id = row.job.focusPlaybookId;
    if (!id) continue;
    const frozen = Boolean(row.job.metrics24hSnapshot && row.job.metrics24hSnapshot.isFrozen === true);
    const snapshot = frozen ? row.job.metrics24hSnapshot : row.job.metricsEarlySnapshot;
    const impressions = Number(snapshot && snapshot.impressions);
    if (frozen && impressions < 100) continue;
    const rate = engagementRate(snapshot);
    if (rate == null) continue;
    observations.push({ id, rate, weight: frozen ? 1 : 0.35, frozen });
  }
  const frozenRates = observations.filter(row => row.frozen).map(row => row.rate);
  const median = medianNumber(frozenRates.length ? frozenRates : observations.map(row => row.rate));
  const posterior = new Map(books.map(book => [book.id, { alpha: 0, beta: 0, frozen: 0 }]));
  for (const row of observations) {
    const cell = posterior.get(row.id);
    if (!cell) continue;
    if (row.rate >= median) cell.alpha += row.weight;
    else cell.beta += row.weight;
    if (row.frozen) cell.frozen += 1;
  }
  let winner = books[0];
  let bestSample = -1;
  for (const book of books) {
    const cell = posterior.get(book.id);
    const sample = sampleBetaDistribution(1.5 + cell.alpha, 1.5 + cell.beta, random) * playbookRecencyFactor(book.id, recentIds);
    if (sample > bestSample) {
      bestSample = sample;
      winner = book;
    }
  }
  const cell = posterior.get(winner.id);
  const sampleCount = observations.filter(row => row.frozen).length;
  const reason = cell.frozen > 0 ? 'exploit_24h' : 'explore';
  const chosen = { ...winner };
  Object.defineProperty(chosen, 'reason', { value: reason });
  Object.defineProperty(chosen, 'sampleCount', { value: sampleCount });
  Object.defineProperty(chosen, 'selection', { value: { reason, sampleCount } });
  return chosen;
}

module.exports = {
  GENE_SPACES,
  computeDeconfoundedRewards,
  chooseGenesForPost,
  CONTENT_ANGLES,
  sampleBetaDistribution,
  selectActionViaThompsonSampling,
  updateBanditState,
  deriveAngleBanditState,
  extractPageFacts,
  chooseFactForSlot,
  formatSelectedFact,
  pageVersionHash,
  extractPageHypotheses,
  extractDomainHypotheses,
  hypothesisForPlaybook,
  isPageDisclaimer,
  chooseHypothesis,
  formatHypothesis,
  selectPlaybookByPerformance
};
