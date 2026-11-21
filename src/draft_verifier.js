'use strict';

const { fitsAccountState } = require('./customer_post_state');
const { assertPostThreadUnambiguous } = require('./post_constraint_guard');
const { inspectPostCompliance } = require('./post_policy_guard');
const { containsJapaneseScript } = require('./measured_pair');
const { auditReadability } = require('./readability_formatter');

const SLOP = /いかがでしたでしょうか|必見です|について解説します|ゲームチェンジャー|game-changer|unlock the power|delve into|in today's fast-paced|深掘りします|保存必須|知っておくべき\d+選|let's break this down|here's why that matters|何が変わると感じますか|仕組みがここにある|これが核心だ|どのように活用|What changes for your team|the mechanism is right here|この現象の裏には|設計上のトレードオフがあります|これにより.{0,24}が可能です|を支える核心|が核心です|これが核心|チームはこれを解明し|(?:効率的な|持続可能な)運用が可能です|一つの仕組みで管理できるように設計|判断軸となります|根拠に基づく判断が重要です/i;
const CLICHE_OPENER = /という見方があります|とよく言われます|と考えがちです|そう考えて運用する方がいます|多くの場合、|Many assume|Most operators assume|It is often said/i;
const FAKE_RESULT = /導入後|売上が|フォロワーが増えた|導入事例|顧客が|customers gained/i;
const LP_META = /登録ページ|同一サイト内の案内|ページに書かれた機能|保存したアカウント像|saved page|registered page/i;
const BROKEN_EN = /^(?:The rule is|Feed one URL\b)|\bcreate schedule\b|\binput the URL\b/i;

function grams(text, lang) {
  const clean = String(text || '').normalize('NFKC').toLowerCase();
  const english = lang === 'en' && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(clean);
  const units = english ? clean.split(/[^a-z0-9']+/).filter(Boolean) : [...clean.replace(/\s+/g, '')];
  const size = english ? 2 : 3;
  const found = new Set();
  for (let i = 0; i <= units.length - size; i += 1) {
    found.add(units.slice(i, i + size).join(english ? ' ' : ''));
  }
  return found;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function computeMaxSimilarity(text, recentTexts, lang) {
  const current = grams(text, lang);
  const hook = grams(String(text || '').slice(0, 24), lang);
  let body = 0;
  let opening = 0;
  for (const recent of recentTexts) {
    body = Math.max(body, jaccard(current, grams(recent, lang)));
    opening = Math.max(opening, jaccard(hook, grams(String(recent || '').slice(0, 24), lang)));
  }
  return { body, opening };
}

function allowedNumbers(context) {
  const knowledge = context.brandKnowledge || {};
  const claims = Array.isArray(knowledge.verifiedClaims) ? knowledge.verifiedClaims : [];
  const values = [
    ...(knowledge.verifiedPricing || []),
    ...claims.flatMap(claim => claim.verifiedNumbers || [])
  ];
  const notePattern = /(?:¥|￥|\$)?\d[\d,]*(?:\.\d+)?\s*(?:%|％|倍|円|日|時間|人|件)?/g;
  const promptNumbers = String(context.userPrompt || '').match(notePattern) || [];
  const contextNoteNumbers = String(context.brandContextNotes || '').match(notePattern) || [];
  const topic = context.topicSource || {};
  const groundedText = [
    context.ownerSpark && context.ownerSpark.text,
    context.audiencePushback,
    context.pushback,
    topic.title,
    topic.coreFact,
    topic.whyItMatters,
    topic.mechanism,
    topic.readerQuestion,
    topic.plainTranslation,
    topic.actionableTakeaway,
    topic.commonMyth
  ].filter(Boolean).join('\n');
  const groundedNumbers = groundedText.match(notePattern) || [];
  const state = context.accountState || {};
  if (Number.isSafeInteger(state.followers)) values.push(String(state.followers));
  if (Number.isSafeInteger(state.following)) values.push(String(state.following));
  return [...values, ...promptNumbers, ...contextNoteNumbers, ...groundedNumbers].map(item => String(item).normalize('NFKC'));
}

function digitCores(token) {
  return (String(token || '').normalize('NFKC').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(v => v.replace(/,/g, ''));
}

function digitCore(token) {
  return digitCores(token)[0] || '';
}

function verifyNumericGrounding(text, context) {
  const withoutUrls = String(text || '').replace(/https?:\/\/\S+/g, ' ');
  const found = withoutUrls.match(/(?:¥|￥|\$)?\d[\d,]*(?:\.\d+)?\s*(?:%|％|倍|割|年|ヶ月|ヵ月|日|時間|時半?|分|秒|万|億|人|社|件|円)?/g) || [];
  const allowed = allowedNumbers(context).flatMap(digitCores).filter(Boolean);
  const bad = [];
  for (const token of found) {
    const normalized = token.normalize('NFKC').trim();
    const core = digitCore(normalized);
    if (/^[123]$/.test(normalized)) continue;
    if (core && allowed.includes(core)) continue;
    bad.push(normalized);
  }
  return bad;
}

function minimumLength(context, thread) {
  const lang = String(context.lang || '').toLowerCase().startsWith('en') ? 'en' : 'ja';
  if (thread) return lang === 'en' ? 65 : 20;
  const format = context.genes && (context.genes.format || context.genes.formatSingle);
  if (format === 'micro_punch') return 45;
  return 70;
}

function hasInternalSentenceRepetition(tweets, lang) {
  const minLength = lang === 'en' ? 40 : 18;
  const sentences = (Array.isArray(tweets) ? tweets : []).flatMap(tweet => String(tweet || '')
    .split(/[。\n.!?！？]+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= minLength));
  for (let i = 0; i < sentences.length; i += 1) {
    for (let j = i + 1; j < sentences.length; j += 1) {
      if (jaccard(grams(sentences[i], lang), grams(sentences[j], lang)) >= 0.58) return true;
    }
  }
  return false;
}

function runDeterministicAudit(candidate, context = {}) {
  const reasons = [];
  const tweets = Array.isArray(candidate && candidate.tweets) ? candidate.tweets : [];
  const lang = String(context.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const promoPlan = Boolean(context.portfolioPlan && context.portfolioPlan.allowPromoUrl);
  const promo = promoPlan && !context.auditBodyOnly;
  const thread = !promoPlan && context.accountState && context.accountState.postShape !== 'single' && context.accountState.subscription !== 'premium' && !context.accountState.singleOnly;
  const floor = minimumLength({ ...context, lang }, thread);
  const bodyFloor = floor;
  if (!tweets[0] || tweets[0].trim().length < bodyFloor) reasons.push('too_short');
  if (promoPlan && context.auditBodyOnly && context.accountState && Number.isFinite(Number(context.accountState.maxChars))) {
    const room = Number(context.accountState.maxChars) - 5;
    if (tweets[0] && tweets[0].length > room) reasons.push('too_long_for_disclosure');
  }
  const replyFloor = lang === 'en' ? 55 : 10;
  if (tweets.slice(1).some(text => typeof text !== 'string' || text.trim().length < replyFloor)) reasons.push('too_short');
  if (context.accountState && !fitsAccountState(tweets, context.accountState, { allowPromoReply: promo })) {
    reasons.push('shape_mismatch');
  }
  try {
    assertPostThreadUnambiguous(tweets, { lang, timeSlot: context.timeSlot });
  } catch (err) {
    reasons.push('thread_constraint');
  }
  const compliance = inspectPostCompliance(tweets, { lang, isPromotion: promo });
  if (!compliance.canAutoPost) {
    reasons.push(...compliance.issues.map(issue => `compliance:${issue.code}`));
  }
  if (lang === 'en' && tweets.some(text => containsJapaneseScript(text))) reasons.push('japanese_in_english');
  const quoted = [context.ownerSpark && context.ownerSpark.text, context.audiencePushback, context.pushback].filter(Boolean).join('\n');
  const slopPattern = new RegExp(SLOP.source, 'gi');
  const unquotedSlop = text => {
    const hits = String(text || '').match(slopPattern) || [];
    return hits.some(hit => !quoted.includes(hit));
  };
  if (tweets.some(unquotedSlop)) reasons.push('ai_slop');
  if (lang === 'en' && tweets.some(text => BROKEN_EN.test(String(text || '').trim()))) reasons.push('ai_slop');
  if (hasInternalSentenceRepetition(tweets, lang)) reasons.push('duplicate_sentence_in_post');
  const similarity = computeMaxSimilarity(tweets.join('\n'), context.recentTexts || [], lang);
  if (similarity.body >= 0.38) reasons.push('too_similar_to_recent');
  if (similarity.opening >= 0.55) reasons.push('hook_too_similar');
  if (promoPlan && /https?:\/\//i.test(tweets[0] || '')) reasons.push('url_in_body');
  const joined = tweets.join('\n');
  const ungrounded = verifyNumericGrounding(joined, context);
  if (ungrounded.length) reasons.push(`ungrounded_number:${ungrounded[0]}`);
  if (CLICHE_OPENER.test(joined)) reasons.push('cliche_opener');
  if (context.isolateLpContext === true && LP_META.test(joined)) reasons.push('lp_meta_leak');
  if (context.enforceReadability === true) {
    const readable = auditReadability(tweets, { lang, formatName: context.genes && (context.genes.format || context.genes.formatSingle) });
    reasons.push(...readable.reasons);
  }
  const promoRole = context.portfolioPlan && context.portfolioPlan.portfolioRole;
  const jargonExempt = Boolean(context.pinned || (context.portfolioPlan && (context.portfolioPlan.allowPromoUrl || promoRole === 'explicit_promo_offer')));
  const audience = context.audienceKnowledge;
  if (!jargonExempt && audience && Number(audience.schemaVersion) >= 1) {
    const blockedTerms = (Array.isArray(audience.internalToolJargonBlocklist) ? audience.internalToolJargonBlocklist : [])
      .map(item => String(item || '').trim())
      .filter(item => item.length >= 2)
      .sort((a, b) => b.length - a.length);
    const jargon = blockedTerms.find(term => joined.includes(term));
    if (jargon) reasons.push(`internal_jargon:${jargon.slice(0, 40)}`);
    if (FAKE_RESULT.test(joined)) reasons.push('fake_result_claim');
  }
  const blocked = Array.isArray(context.ngTopics)
    ? context.ngTopics
    : String(context.ngTopics || '').split(/[\n,、]/).map(item => item.trim()).filter(Boolean);
  const hit = blocked.find(topic => topic && joined.includes(topic));
  if (hit) reasons.push(`ng_topic:${hit.slice(0, 40)}`);
  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  runDeterministicAudit,
  computeMaxSimilarity,
  verifyNumericGrounding,
  hasInternalSentenceRepetition
};
