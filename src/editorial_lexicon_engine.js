'use strict';

const crypto = require('node:crypto');
const { hasXaiKey, completeJson } = require('./grok_client');

const SHARED_DOC = 'editorial_lexicon_v1';

const SHARED_LEXICON = {
  schemaVersion: 1,
  styleAntiPatterns: [
    {
      id: 'essay_mix',
      why: '敬体の途中に常体の翻訳エッセイ文が混ざると、同じ書き手に見えない',
      fix: '選んだ文体の文末だけで最後まで書く',
      samples: ['仕組みがここにある', 'は明らかだ', 'これが設計の核心だ', 'が見えてくる']
    },
    {
      id: 'lecture_question',
      why: 'まとめの疑問文は、中身の代わりに講師の口調へ逃げる',
      fix: '言い切り、条件、確認対象のいずれかで終える',
      samples: ['と感じますか', 'どう考えますか', 'What changes for your team?']
    },
    {
      id: 'thread_restatement',
      why: '2本目が1本目の言い換えだと、新しい情報がゼロになる',
      fix: '例外、反例、確認手順のどれか一つだけを足す',
      samples: []
    },
    {
      id: 'academic_preface',
      why: '学問名の前置きは、仕組みの代わりに権威を借りて見せる',
      fix: '原理そのものを比喩か対比で書く',
      samples: ['学によると', '理論によると', 'according to']
    }
  ],
  cognitiveMoves: {
    mechanism_translation: { winScore: 1, sampleCount: 0 },
    inversion_contrast: { winScore: 1, sampleCount: 0 },
    constraint_boundary: { winScore: 1, sampleCount: 0 },
    practitioner_rule: { winScore: 1, sampleCount: 0 },
    micro_observation: { winScore: 1, sampleCount: 0 }
  },
  endingMoves: {
    verdict_cut: { winScore: 1, sampleCount: 0 },
    condition_edge: { winScore: 1, sampleCount: 0 },
    concrete_check: { winScore: 1, sampleCount: 0 },
    genuine_tension: { winScore: 1, sampleCount: 0 }
  }
};

const STOP_TOKENS = new Set(['こと', 'これ', 'それ', 'ため', 'よう', 'ます', 'です', 'した', 'から', 'など', 'この', 'その', '投稿', 'アカウント']);

function isTestProcess() {
  return process.env.NODE_ENV === 'test'
    || Boolean(process.env.NODE_TEST_CONTEXT)
    || (process.argv || []).some(arg => String(arg).includes('test'));
}

function cloneShared(source) {
  return JSON.parse(JSON.stringify(source || SHARED_LEXICON));
}

function emptyDomainLexicon() {
  return {
    schemaVersion: 1,
    domainTerms: [],
    winningExpressions: [],
    retiredPhrases: [],
    preferredRegister: '',
    moveScores: {},
    lastLexiconDigest: '',
    updatedAt: ''
  };
}

function postText(row) {
  if (typeof row === 'string') return row;
  if (row && typeof row.text === 'string') return row.text;
  if (row && typeof row.textSnippet === 'string') return row.textSnippet;
  return '';
}

function finalSentence(text) {
  const parts = String(text || '').split(/[\n。！!]/).map(part => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function endsAsQuestion(text) {
  const trimmed = String(text || '').trim();
  return /[?？]\s*$/.test(trimmed) || /か。\s*$/.test(trimmed);
}

function registerCounts(text) {
  return {
    polite: (String(text).match(/です|ます/g) || []).length,
    plain: (String(text).match(/だ。|である/g) || []).length
  };
}

function inferEnding(text) {
  if (endsAsQuestion(text)) return 'genuine_tension';
  if (/ただし|except\b|unless\b/i.test(text)) return 'condition_edge';
  if (/確認|見直|check\b|look at/i.test(text)) return 'concrete_check';
  return 'verdict_cut';
}

function inferMove(text) {
  if (/ただし|限界|壊れる|tradeoff|boundary/i.test(text)) return 'constraint_boundary';
  if (/一方|ではなく|通説|instead/i.test(text)) return 'inversion_contrast';
  if (/基準|判断|rule/i.test(text)) return 'practitioner_rule';
  if (/たとえば|例えば|noticed|detail/i.test(text)) return 'micro_observation';
  return 'mechanism_translation';
}

function repeatedTokens(posts) {
  const counts = new Map();
  posts.slice(0, 3).forEach(row => {
    const seen = new Set();
    const tokens = String(postText(row)).match(/[A-Za-z][A-Za-z'-]{4,}|[\u30A0-\u30FF\u4E00-\u9FFF]{3,8}/g) || [];
    tokens.forEach(token => {
      if (!STOP_TOKENS.has(token)) seen.add(token);
    });
    seen.forEach(token => counts.set(token, (counts.get(token) || 0) + 1));
  });
  return [...counts.entries()].filter(([, count]) => count >= 2).map(([token]) => token);
}

function endingExploreScore(shared, id, recentCount, order) {
  const row = shared.endingMoves && shared.endingMoves[id] || {};
  const win = Number(row.winScore) || 0;
  const samples = Number(row.sampleCount) || 0;
  if (id === 'genuine_tension' || samples > 0) return win;
  const index = Math.max(0, order.indexOf(id));
  return win + (((Number(recentCount) || 0) + index) % 3) * 0.2;
}

function decideEditorialPlan(input = {}) {
  const accountState = input.accountState || {};
  const voice = input.voiceProfile || {};
  const genes = input.genes || {};
  const portfolio = input.portfolioPlan || {};
  const recent = (Array.isArray(input.recentPosts) ? input.recentPosts : []).map(postText).filter(Boolean);
  const domain = input.domainLexicon || {};
  const shared = input.sharedLexicon && input.sharedLexicon.cognitiveMoves ? input.sharedLexicon : SHARED_LEXICON;
  const isEn = String(accountState.lang || '').toLowerCase().startsWith('en');
  const counts = recent.reduce((sum, text) => {
    const row = registerCounts(text);
    return { polite: sum.polite + row.polite, plain: sum.plain + row.plain };
  }, { polite: 0, plain: 0 });
  let registerLock = 'plain_ja';
  if (isEn) registerLock = 'concise_en';
  else if (counts.polite > counts.plain && counts.polite > 0) registerLock = 'polite_ja';
  else if (counts.plain > counts.polite && counts.plain > 0) registerLock = 'plain_ja';
  else if (voice.accountRole === 'official_brand' || /polite|敬体|です/.test(String(voice.register || ''))) registerLock = 'polite_ja';

  const registerInstruction = registerLock === 'concise_en'
    ? 'Use one concise English register for the whole post.'
    : (registerLock === 'polite_ja'
      ? '敬体（です・ます）で統一し、途中の「〜だ。」「明らかだ。」「ここにある。」を混ぜない。'
      : '常体（だ・である）で統一し、です・ますを混ぜない。');

  let endings = ['verdict_cut', 'condition_edge', 'concrete_check', 'genuine_tension'];
  if (recent.slice(0, 2).some(endsAsQuestion)) endings = endings.filter(id => id !== 'genuine_tension');
  const previousEnding = recent[0] ? inferEnding(recent[0]) : '';
  const endingPool = endings.filter(id => id !== previousEnding);
  const endingOrder = ['verdict_cut', 'condition_edge', 'concrete_check', 'genuine_tension'];
  const endingMove = (endingPool.length ? endingPool : endings)
    .slice()
    .sort((a, b) => endingExploreScore(shared, b, recent.length, endingOrder) - endingExploreScore(shared, a, recent.length, endingOrder))[0] || 'verdict_cut';

  const weights = computeGuidanceWeights({ matureCount: input.matureCount, strategyLocked: input.strategyLocked });
  const sampleCount = Math.max(0, Math.floor(Number(input.matureCount) || 0));
  const accountShare = Math.min(1, sampleCount / 15);
  const sharedShare = 1 - accountShare;
  const previousMove = recent[0] ? inferMove(recent[0]) : '';
  const moveIds = Object.keys(shared.cognitiveMoves || {});
  const cognitiveMove = (moveIds.length ? moveIds : Object.keys(SHARED_LEXICON.cognitiveMoves))
    .map(id => {
      const sharedScore = (shared.cognitiveMoves[id] && shared.cognitiveMoves[id].winScore) || 0;
      const accountScore = domain.moveScores && Number(domain.moveScores[id]) || 0;
      const angleBoost = genes.angle && id.includes(String(genes.angle).split('_')[0]) ? 1 : 0;
      const roleBoost = portfolio.portfolioRole && id === 'micro_observation' && /trust|proof/.test(String(portfolio.portfolioRole)) ? 1 : 0;
      return { id, score: (sharedScore * sharedShare) + (accountScore * accountShare) + angleBoost + roleBoost - (id === previousMove ? 3 : 0) };
    })
    .sort((a, b) => b.score - a.score)[0].id;

  const craftHits = (shared.styleAntiPatterns || []).flatMap(row => row.samples || []).filter(sample => {
    const hits = recent.slice(0, 3).filter(text => text.includes(sample)).length;
    return hits >= 2;
  });
  const autoRetiredFromRecent = [...new Set([...(domain.retiredPhrases || []), ...repeatedTokens(recent), ...craftHits])].slice(0, 12);
  const threadSecondMove = input.shape && input.shape.thread
    ? (isEn
      ? 'Tweet two must add one new exception, counterexample, or concrete check. Do not restate tweet one.'
      : '2本目は、1本目が成り立たない例外条件・具体的な失敗ケース・次の確認手順のどれか1つだけを新しく書く。1本目の要約や言い換えは禁止。')
    : '';

  return { registerLock, registerInstruction, endingMove, cognitiveMove, autoRetiredFromRecent, threadSecondMove, weights, guidanceMode: weights.phase };
}

function computeGuidanceWeights({ matureCount = 0, strategyLocked = false } = {}) {
  const count = Math.max(0, Math.floor(Number(matureCount) || 0));
  if (count < 5) return { phase: 'observe', userWeight: 80, veloxWeight: 20 };
  if (count < 15) return { phase: 'calibrate', userWeight: 60, veloxWeight: 40 };
  return strategyLocked
    ? { phase: 'lead_locked', userWeight: 50, veloxWeight: 50 }
    : { phase: 'lead', userWeight: 35, veloxWeight: 65 };
}

function clampScore(value) {
  return Math.round(Math.min(3, Math.max(0.2, value)) * 1000) / 1000;
}

function bumpMove(bucket, id, beatBaseline) {
  if (!bucket || !bucket[id]) return;
  const current = Number(bucket[id].winScore) || 1;
  bucket[id].winScore = clampScore((current * 0.9) + ((beatBaseline ? 1.5 : 0.4) * 0.1));
  bucket[id].sampleCount = (Number(bucket[id].sampleCount) || 0) + 1;
}

async function recordSharedOutcomeSignals({ outcomes = [], userIdHash = '' } = {}, targetDb = null) {
  if (!targetDb && isTestProcess() && !process.env.FIRESTORE_EMULATOR_HOST) return { ok: false, skipped: true };
  try {
    const activeDb = targetDb || require('./firestore').db;
    const ref = activeDb.collection('collective_intelligence').doc(SHARED_DOC);
    const snap = await ref.get();
    const current = snap.exists ? (snap.data() || {}) : {};
    const lexicon = {
      ...cloneShared(SHARED_LEXICON),
      ...current,
      cognitiveMoves: { ...cloneShared(SHARED_LEXICON).cognitiveMoves, ...(current.cognitiveMoves || {}) },
      endingMoves: { ...cloneShared(SHARED_LEXICON).endingMoves, ...(current.endingMoves || {}) }
    };
    const seen = new Set(Array.isArray(current.processedSignalKeys) ? current.processedSignalKeys : []);
    const freshKeys = [];
    for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
      const signalKey = String(outcome && outcome.signalKey || '').trim();
      if (!/^[a-z0-9]{8,64}$/i.test(signalKey) || seen.has(signalKey)) continue;
      seen.add(signalKey);
      freshKeys.push(signalKey);
      bumpMove(lexicon.cognitiveMoves, outcome.cognitiveMove, outcome.beatBaseline === true);
      bumpMove(lexicon.endingMoves, outcome.endingMove, outcome.beatBaseline === true);
    }
    const hashes = Array.isArray(current.accountHashes) ? current.accountHashes.filter(item => /^[a-f0-9]{8,64}$/i.test(String(item))) : [];
    const hash = String(userIdHash || '').trim().toLowerCase();
    if (/^[a-f0-9]{8,64}$/.test(hash) && !hashes.includes(hash)) hashes.push(hash);
    const processedSignalKeys = [...seen].slice(-300);
    const accountHashes = hashes.slice(-500);
    await ref.set({
      cognitiveMoves: lexicon.cognitiveMoves,
      endingMoves: lexicon.endingMoves,
      processedSignalKeys,
      accountHashes,
      totalOutcomeSamples: (Number(current.totalOutcomeSamples) || 0) + freshKeys.length,
      totalOutcomeAccounts: accountHashes.length,
      updatedAt: new Date()
    }, { merge: true });
    return { ok: true, added: freshKeys.length };
  } catch (err) {
    return { ok: false };
  }
}

function editorialDirective(decision, editorialContext, isEn) {
  if (!decision) return '';
  const containsJapanese = text => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(String(text || ''));
  const BANNED_LEGACY = /9割の|月100時間|3\.2倍|3\.4倍|保存して後で見返|シャドウバン/;
  const keepForPrompt = text => {
    const value = String(text || '');
    if (!value || BANNED_LEGACY.test(value)) return false;
    if (isEn && containsJapanese(value)) return false;
    return true;
  };
  const lexicon = editorialContext && editorialContext.domainLexicon || {};
  const wins = (Array.isArray(lexicon.winningExpressions) ? lexicon.winningExpressions : []).filter(keepForPrompt).slice(0, 3);
  const pairs = (editorialContext && Array.isArray(editorialContext.dpoPairs) ? editorialContext.dpoPairs : []).filter(pair => keepForPrompt(JSON.stringify(pair))).slice(0, 2);
  const hint = editorialContext && editorialContext.mapElitesHint;
  const hintText = hint && hint.directive && keepForPrompt(hint.directive) ? String(hint.directive).slice(0, 240) : '';
  const retired = (Array.isArray(decision.autoRetiredFromRecent) ? decision.autoRetiredFromRecent : []).filter(keepForPrompt);
  const lines = [
    isEn ? `Editorial decision. Move: ${decision.cognitiveMove}. Ending: ${decision.endingMove}. Register: ${decision.registerLock}. ${decision.registerInstruction}` : `編集判断。思考: ${decision.cognitiveMove}。結び: ${decision.endingMove}。文体: ${decision.registerLock}。${decision.registerInstruction}`,
    decision.threadSecondMove || '',
    retired.length
      ? (isEn ? `Do not reuse these recent phrases: ${retired.join(', ')}` : `今回は次の表現を使わない: ${retired.join('、')}`)
      : '',
    wins.length ? (isEn ? `Expressions that earned a response: ${JSON.stringify(wins)}` : `反応が残った表現メモ: ${JSON.stringify(wins)}`) : '',
    pairs.length ? (isEn ? `Measured preference pairs: ${JSON.stringify(pairs).slice(0, 500)}` : `実測の勝ち負け: ${JSON.stringify(pairs).slice(0, 500)}`) : '',
    hintText ? (isEn ? `Archive note: ${hintText}` : `記録メモ: ${hintText}`) : '',
    editorialContext && editorialContext.nicheHint && keepForPrompt(editorialContext.nicheHint)
      ? (isEn ? `Niche structure hint: ${String(editorialContext.nicheHint).slice(0, 180)}` : `業種の構造メモ: ${String(editorialContext.nicheHint).slice(0, 180)}`)
      : '',
    editorialContext && editorialContext.weeklyStrategyHint && keepForPrompt(editorialContext.weeklyStrategyHint)
      ? (isEn ? `Weekly direction, numbers removed: ${String(editorialContext.weeklyStrategyHint).slice(0, 180)}` : `今週の方針。数値は除いてある: ${String(editorialContext.weeklyStrategyHint).slice(0, 180)}`)
      : ''
  ];
  return lines.filter(Boolean).join('\n');
}

async function getSharedEditorialLexicon(targetDb = null) {
  if (!targetDb && isTestProcess() && !process.env.FIRESTORE_EMULATOR_HOST) return cloneShared(SHARED_LEXICON);
  try {
    const activeDb = targetDb || require('./firestore').db;
    const snap = await activeDb.collection('collective_intelligence').doc(SHARED_DOC).get();
    if (snap.exists) {
      const data = snap.data() || {};
      return {
        ...cloneShared(SHARED_LEXICON),
        ...data,
        cognitiveMoves: { ...SHARED_LEXICON.cognitiveMoves, ...(data.cognitiveMoves || {}) },
        endingMoves: { ...SHARED_LEXICON.endingMoves, ...(data.endingMoves || {}) }
      };
    }
  } catch (err) {}
  return cloneShared(SHARED_LEXICON);
}

async function recordSharedRejectionSignal({ reasons = [], texts = [], lang = 'ja' } = {}, targetDb = null) {
  if (!targetDb && isTestProcess() && !process.env.FIRESTORE_EMULATOR_HOST) return { ok: false, skipped: true };
  try {
    const activeDb = targetDb || require('./firestore').db;
    const ref = activeDb.collection('collective_intelligence').doc(SHARED_DOC);
    const snap = await ref.get();
    const current = snap.exists ? (snap.data() || {}) : {};
    const signals = Array.isArray(current.rejectionSignals) ? current.rejectionSignals.slice(-19) : [];
    signals.push({
      lang: String(lang).startsWith('en') ? 'en' : 'ja',
      reasons: reasons.map(reason => String(reason).slice(0, 80)).slice(0, 4),
      sample: texts.map(text => String(text).slice(0, 80)).slice(0, 2),
      at: new Date().toISOString()
    });
    await ref.set({ rejectionSignals: signals, updatedAt: new Date() }, { merge: true });
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
}

function lexiconDigest(posts) {
  const body = posts.map(post => [post.tweetId || post.id || '', post.impressions || 0, post.bookmarks || 0, postText(post).slice(0, 80)].join(':')).join('|');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 24);
}

function fallbackEvolution(posts, digest) {
  const sorted = posts.slice().sort((a, b) => (Number(b.bookmarks) || 0) - (Number(a.bookmarks) || 0));
  const winner = sorted[0] || {};
  const loser = sorted[sorted.length - 1] || {};
  const winnerText = postText(winner);
  const loserText = postText(loser);
  const questions = posts.filter(post => endsAsQuestion(postText(post))).length;
  const lexicon = emptyDomainLexicon();
  lexicon.domainTerms = [...new Set(repeatedTokens(posts.map(postText)))].slice(0, 15);
  lexicon.winningExpressions = winnerText ? [winnerText.slice(0, 80)] : [];
  lexicon.retiredPhrases = [...new Set([
    ...repeatedTokens([loserText, loserText]),
    ...(questions ? ['疑問文だけの締め'] : [])
  ])].filter(Boolean).slice(0, 15);
  lexicon.preferredRegister = registerCounts(winnerText).polite >= registerCounts(winnerText).plain ? 'polite_ja' : 'plain_ja';
  lexicon.moveScores = { [inferMove(winnerText)]: 1 };
  lexicon.lastLexiconDigest = digest;
  lexicon.updatedAt = new Date().toISOString();
  return {
    domainLexicon: lexicon,
    episodeLessons: posts.map(post => ({
      tweetId: String(post.tweetId || post.id || ''),
      lessonLearned: endsAsQuestion(postText(post))
        ? '疑問文で閉じた投稿は、同じ確認を言い切りへ戻す。'
        : `保存${Number(post.bookmarks) || 0}の投稿は、${inferMove(postText(post))}の形で残った。`
    })).filter(row => row.tweetId),
    pairInsight: winnerText && loserText && winnerText !== loserText
      ? {
        whyWon: `保存${Number(winner.bookmarks) || 0}。結びは${inferEnding(winnerText)}。`,
        whyLost: `保存${Number(loser.bookmarks) || 0}。結びは${inferEnding(loserText)}。`
      }
      : null
  };
}

function cleanList(value, limit) {
  return (Array.isArray(value) ? value : []).map(item => String(item).trim()).filter(Boolean).slice(0, limit);
}

async function evolveAccountLexiconAndLessons({ maturePosts = [], currentKnowledge = null } = {}) {
  const posts = (Array.isArray(maturePosts) ? maturePosts : []).filter(post => postText(post));
  const digest = lexiconDigest(posts);
  const current = currentKnowledge && currentKnowledge.domainLexicon;
  if (current && current.lastLexiconDigest === digest) {
    return { skipped: true, domainLexicon: current, episodeLessons: [], pairInsight: null };
  }
  if (posts.length < 2 || !hasXaiKey()) return { skipped: false, ...fallbackEvolution(posts, digest) };
  try {
    const prompt = `Compare the winning and losing posts for one account. Return JSON only.
{"domainTerms":[],"winningExpressions":[],"retiredPhrases":[],"preferredRegister":"","moveScores":{},"whyWon":"","whyLost":"","episodeLessons":[{"tweetId":"","lessonLearned":""}]}
Use only contrasts visible in the texts. Do not name an academic field. Do not invent numbers that are not in the metrics.
Posts: ${JSON.stringify(posts.map(post => ({
  tweetId: post.tweetId || post.id || '',
  text: postText(post).slice(0, 280),
  bookmarks: post.bookmarks || 0,
  impressions: post.impressions || 0
}))).slice(0, 4000)}`;
    const parsed = (await completeJson({ tier: 'fast', timeoutMs: 15000, prompt })).parsed || {};
    const fallback = fallbackEvolution(posts, digest);
    const lexicon = emptyDomainLexicon();
    lexicon.domainTerms = cleanList(parsed.domainTerms, 15);
    lexicon.winningExpressions = cleanList(parsed.winningExpressions, 10);
    lexicon.retiredPhrases = cleanList(parsed.retiredPhrases, 15);
    lexicon.preferredRegister = String(parsed.preferredRegister || fallback.domainLexicon.preferredRegister).slice(0, 40);
    const rawScores = parsed.moveScores && typeof parsed.moveScores === 'object' && !Array.isArray(parsed.moveScores) ? parsed.moveScores : {};
    lexicon.moveScores = Object.keys(rawScores).length ? rawScores : (fallback.domainLexicon.moveScores || {});
    lexicon.lastLexiconDigest = digest;
    lexicon.updatedAt = new Date().toISOString();
    if (!lexicon.domainTerms.length) lexicon.domainTerms = fallback.domainLexicon.domainTerms;
    const lessons = Array.isArray(parsed.episodeLessons) ? parsed.episodeLessons : [];
    return {
      skipped: false,
      domainLexicon: lexicon,
      episodeLessons: (lessons.length ? lessons : fallback.episodeLessons).map(row => ({
        tweetId: String(row.tweetId || ''),
        lessonLearned: String(row.lessonLearned || '').slice(0, 160)
      })).filter(row => row.tweetId && row.lessonLearned),
      pairInsight: {
        whyWon: String(parsed.whyWon || fallback.pairInsight && fallback.pairInsight.whyWon || '').slice(0, 160),
        whyLost: String(parsed.whyLost || fallback.pairInsight && fallback.pairInsight.whyLost || '').slice(0, 160)
      }
    };
  } catch (err) {
    return { skipped: false, ...fallbackEvolution(posts, digest) };
  }
}

module.exports = {
  SHARED_LEXICON,
  decideEditorialPlan,
  editorialDirective,
  computeGuidanceWeights,
  getSharedEditorialLexicon,
  recordSharedRejectionSignal,
  recordSharedOutcomeSignals,
  evolveAccountLexiconAndLessons,
  inferMove,
  inferEnding
};
