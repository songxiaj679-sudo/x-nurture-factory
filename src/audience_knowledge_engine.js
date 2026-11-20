'use strict';

const crypto = require('crypto');

const ARCHETYPES = [
  'before_after_rewrite',
  'actionable_checklist',
  'failure_autopsy',
  'contrarian_sharp',
  'live_trend_brief'
];
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAKE_RESULT = /導入後|売上が|フォロワーが増えた|導入事例|顧客が|customers gained|revenue increased/i;
const STAT = /\d+(?:[.,]\d+)?\s*(?:%|％|倍|円|万|件|時間|分|秒)|[$¥￥]\s*\d|\d{1,2}[:：]\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日/;
const LP_CARD = /登録ページ|同一サイト内の案内|ページに書かれた機能|URLを入力|saved page|registered page|how an automation tool works/i;
const GENERIC_JARGON = /^(?:次の1本|投稿|確認|draft|drafts|drafting|post|posts|posting|workflow|next-post drafting|next post)$/i;
const GENERIC_TOKEN = /^(?:次の|1本|次の1本|投稿|確認|draft|drafts|drafting|post|posts|posting|workflow|next|the|a|an|of|and)$/i;

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function contentHash(brandKnowledge, lang) {
  const product = clip(brandKnowledge && brandKnowledge.productName, 80);
  const terms = (Array.isArray(brandKnowledge && brandKnowledge.terminology) ? brandKnowledge.terminology : [])
    .map(item => clip(item, 40))
    .filter(item => item && item !== product);
  const body = JSON.stringify({
    category: clip(brandKnowledge && brandKnowledge.category, 80),
    icpSummary: clip(brandKnowledge && brandKnowledge.icpSummary, 240),
    oneLineMechanism: clip(brandKnowledge && brandKnowledge.oneLineMechanism, 240),
    terminology: terms.slice(0, 16),
    lang,
    schema: 2
  });
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 24);
}

function cacheFresh(existing, hash, lang, now) {
  if (!existing || existing.schemaVersion !== 2 || existing.outputLang !== lang || existing.contentHash !== hash) return false;
  const at = new Date(existing.extractedAt || 0).getTime();
  return Number.isFinite(at) && now.getTime() - at < TTL_MS && Array.isArray(existing.audienceTopics) && existing.audienceTopics.length >= 4;
}

function cardText(card) {
  return JSON.stringify(card || {});
}

function cardLeakReason(card, brandKnowledge) {
  const text = cardText(card);
  const product = clip(brandKnowledge && brandKnowledge.productName, 80);
  if (product.length >= 2 && text.toLowerCase().includes(product.toLowerCase())) return 'product';
  if (FAKE_RESULT.test(text)) return 'fake';
  if (STAT.test(text)) return 'stat';
  if (LP_CARD.test(text)) return 'lp';
  return '';
}

function cardLeaks(card, brandKnowledge) {
  return Boolean(cardLeakReason(card, brandKnowledge));
}

function cleanSteps(value) {
  const rows = (Array.isArray(value) ? value : []).map(item => clip(item, 120)).filter(Boolean).slice(0, 3);
  return rows.length === 3 ? rows : null;
}

function archetypeOf(raw) {
  const named = String(raw && (raw.archetype || raw.cardType || raw.type) || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = {
    before_after_rewrite: 'before_after_rewrite',
    before_after: 'before_after_rewrite',
    rewrite: 'before_after_rewrite',
    actionable_checklist: 'actionable_checklist',
    checklist: 'actionable_checklist',
    failure_autopsy: 'failure_autopsy',
    autopsy: 'failure_autopsy',
    contrarian_sharp: 'contrarian_sharp',
    contrarian: 'contrarian_sharp',
    live_trend_brief: 'live_trend_brief',
    trend: 'live_trend_brief'
  }[named];
  if (mapped) return mapped;
  if (raw && (raw.weakExample || raw.before || raw.strongExample || raw.after)) return 'before_after_rewrite';
  if (raw && raw.steps) return 'actionable_checklist';
  if (raw && (raw.commonTrap || raw.trap || raw.realCause)) return 'failure_autopsy';
  if (raw && (raw.lazyBelief || raw.sharpTruth)) return 'contrarian_sharp';
  if (raw && (raw.practitionerStance || raw.stance || raw.evaluationCriteria)) return 'live_trend_brief';
  return '';
}

function normalizeCard(raw, index) {
  const archetype = archetypeOf(raw);
  if (!archetype || !raw) return null;
  const ring = raw.topicRing === 'ring2_broad_adjacent' ? 'ring2_broad_adjacent' : 'ring1_craft';
  const base = {
    id: clip(raw.id, 40) || `aud_${index + 1}`,
    archetype,
    exampleKind: 'illustrative',
    topicRing: ring,
    topicDomain: clip(raw.topicDomain || raw.domain || raw.topic || raw.title, 80),
    topic: clip(raw.topic || raw.title, 80)
  };
  if (!base.topic) return null;
  if (archetype === 'before_after_rewrite') {
    const card = {
      ...base,
      context: clip(raw.context || raw.tryItOnYourDraft, 160),
      weakExample: clip(raw.weakExample || raw.before, 180),
      strongExample: clip(raw.strongExample || raw.after, 180),
      whyItWorks: clip(raw.whyItWorks || raw.reason, 180)
    };
    if (!card.weakExample || !card.strongExample || !card.whyItWorks) return null;
    return card;
  }
  if (archetype === 'actionable_checklist') {
    const steps = cleanSteps(raw.steps);
    if (!steps) return null;
    const card = { ...base, readerPain: clip(raw.readerPain, 160), steps, boundaryNote: clip(raw.boundaryNote, 160) };
    if (!card.readerPain || !card.boundaryNote) return null;
    return card;
  }
  if (archetype === 'failure_autopsy') {
    const card = {
      ...base,
      commonTrap: clip(raw.commonTrap, 160),
      realCause: clip(raw.realCause, 160),
      practicalFix: clip(raw.practicalFix, 160),
      boundaryNote: clip(raw.boundaryNote, 160)
    };
    if (!card.commonTrap || !card.realCause || !card.practicalFix) return null;
    return card;
  }
  if (archetype === 'contrarian_sharp') {
    const card = {
      ...base,
      lazyBelief: clip(raw.lazyBelief, 160),
      sharpTruth: clip(raw.sharpTruth, 160),
      concreteCheck: clip(raw.concreteCheck, 160)
    };
    if (!card.lazyBelief || !card.sharpTruth || !card.concreteCheck) return null;
    return card;
  }
  const card = {
    ...base,
    practitionerStance: clip(raw.practitionerStance, 180),
    evaluationCriteria: clip(raw.evaluationCriteria, 180)
  };
  if (!card.practitionerStance || !card.evaluationCriteria) return null;
  return card;
}

function scrubAudienceTopics(rows, brandKnowledge) {
  const seen = new Set();
  const clean = [];
  const rejected = { incomplete: 0, product: 0, fake: 0, stat: 0, lp: 0, duplicate: 0 };
  (Array.isArray(rows) ? rows : []).forEach((raw, index) => {
    const card = normalizeCard(raw, index);
    if (!card) {
      rejected.incomplete += 1;
      return;
    }
    const reason = cardLeakReason(card, brandKnowledge);
    if (reason) {
      rejected[reason] += 1;
      return;
    }
    if (seen.has(card.id)) {
      rejected.duplicate += 1;
      return;
    }
    seen.add(card.id);
    clean.push(card);
  });
  return { cards: clean.slice(0, 16), rejected };
}

function genericJargon(term) {
  const text = clip(term, 40);
  if (!text || GENERIC_JARGON.test(text)) return true;
  const parts = text.split(/[\s\-_/]+/).filter(Boolean);
  return parts.length > 0 && parts.every(part => GENERIC_TOKEN.test(part));
}

function jargonList(raw, brandKnowledge) {
  const product = clip(brandKnowledge && brandKnowledge.productName, 80);
  const rows = (Array.isArray(raw) ? raw : [])
    .map(item => clip(item, 40))
    .filter(item => item.length >= 2 && !genericJargon(item));
  if (product.length >= 2 && !genericJargon(product) && !rows.includes(product)) rows.unshift(product);
  return [...new Set(rows)].slice(0, 25);
}

function readerSource(brandKnowledge, userPrompt) {
  return {
    category: clip(brandKnowledge && brandKnowledge.category, 80),
    icpSummary: clip(brandKnowledge && brandKnowledge.icpSummary, 400),
    readerGoal: clip(userPrompt, 400)
  };
}

function writerSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['readerPersona', 'internalToolJargonBlocklist', 'audienceTopics'],
    properties: {
      readerPersona: { type: 'string' },
      internalToolJargonBlocklist: { type: 'array', items: { type: 'string' } },
      broadTopicDomains: { type: 'object', additionalProperties: true },
      audienceTopics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['archetype', 'topic', 'topicRing', 'topicDomain'],
          properties: {
            archetype: { type: 'string', enum: ARCHETYPES },
            topic: { type: 'string' },
            topicRing: { type: 'string', enum: ['ring1_craft', 'ring2_broad_adjacent'] },
            topicDomain: { type: 'string' },
            exampleKind: { type: 'string' },
            context: { type: 'string' },
            weakExample: { type: 'string' },
            strongExample: { type: 'string' },
            whyItWorks: { type: 'string' },
            readerPain: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            boundaryNote: { type: 'string' },
            commonTrap: { type: 'string' },
            realCause: { type: 'string' },
            practicalFix: { type: 'string' },
            lazyBelief: { type: 'string' },
            sharpTruth: { type: 'string' },
            concreteCheck: { type: 'string' },
            practitionerStance: { type: 'string' },
            evaluationCriteria: { type: 'string' }
          }
        }
      }
    }
  };
}

async function ensureAudienceKnowledge({
  db,
  userId,
  user,
  brandKnowledge,
  radar = null,
  radarFresh = false,
  userPrompt = '',
  lang = 'ja',
  now = new Date(),
  completeWriter = null
} = {}) {
  const outputLang = String(lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const existing = user && user.audienceKnowledge;
  const hash = contentHash(brandKnowledge || {}, outputLang);
  if (cacheFresh(existing, hash, outputLang, now)) {
    return { ok: true, cached: true, audienceKnowledge: existing, budgetRecorded: false };
  }
  const reader = readerSource(brandKnowledge, userPrompt);
  if (!reader.category && !reader.icpSummary && !reader.readerGoal) {
    return { ok: false, audienceKnowledge: null, needsReaderHint: true, reason: 'missing_reader_context', budgetRecorded: false };
  }
  let budget;
  try {
    budget = await require('./tenant_ai_budget').checkTenantAiBudget({ db, userId, user, kind: 'llm', count: radarFresh ? 2 : 1, now });
  } catch (_error) {
    budget = { allowed: true };
  }
  if (budget && budget.allowed === false) {
    return { ok: false, fallback: true, reason: 'monthly_budget_exceeded', audienceKnowledge: cacheFresh(existing, hash, outputLang, now) ? existing : null, budgetRecorded: false };
  }
  const writer = completeWriter || require('./llm_router').completeWriter;
  const signals = Array.isArray(radar) ? radar : (radar && Array.isArray(radar.signals) ? radar.signals : []);
  const keyGuide = 'before_after_rewrite {topic, context, weakExample, strongExample, whyItWorks}; actionable_checklist {topic, readerPain, steps exactly 3, boundaryNote}; failure_autopsy {topic, commonTrap, realCause, practicalFix, boundaryNote}; contrarian_sharp {topic, lazyBelief, sharpTruth, concreteCheck}; live_trend_brief {topic, practitionerStance, evaluationCriteria}';
  const prompt = outputLang === 'en'
    ? `Expand the reader's world, not the product. From the reader description only, build broadTopicDomains with 4 to 6 ring1_craft skills and 4 to 6 ring2_broad_adjacent fields a stranger would bookmark even if no product existed. Then build 12 to 16 audienceTopics spread across both rings. Every card must include archetype, topic, topicRing, topicDomain, and exampleKind illustrative. Use exactly one of these shapes: ${keyGuide}. Never mention a product, a registered page, a URL field, prices, customers, or numbers. internalToolJargonBlocklist is only the product name and unique screen labels, never everyday words such as draft, posting, or workflow.\nReader: ${JSON.stringify(readerSource(brandKnowledge, userPrompt))}\nQualitative field notes: ${JSON.stringify(signals).slice(0, 600)}`
    : `製品の機能ではなく、読み手が製品がなくても保存する話題へ広げる。broadTopicDomains に ring1_craft を4〜6領域、ring2_broad_adjacent を4〜6領域入れる。audienceTopics は両リングにまたがる12〜16枚。全カードに archetype、topic、topicRing、topicDomain、exampleKind は illustrative を入れる。型は次のどれか1つで、キー名を変えない。${keyGuide}。登録ページの照合、URL入力、ツールの使い方、製品名、料金、数値は禁止。internalToolJargonBlocklist は製品名と画面にしかない語だけ。投稿、確認、次の1本のような普通の語は入れない。\n読者: ${JSON.stringify(readerSource(brandKnowledge, userPrompt))}\n現場のメモ: ${JSON.stringify(signals).slice(0, 600)}`;
  const systemPrompt = outputLang === 'en'
    ? 'Return JSON only. exampleKind on every card is illustrative. Fill every key required by the chosen archetype. Do not invent customers or statistics.'
    : 'JSONだけ返す。各カードの exampleKind は illustrative。選んだ型の必須キーをすべて埋める。顧客や統計は作らない。';
  async function askWriter(extra) {
    const result = await writer({
      prompt: extra ? `${prompt}\n${extra}` : prompt,
      systemPrompt,
      schemaName: 'audience_knowledge',
      inputSchema: writerSchema(),
      maxTokens: 6000,
      timeoutMs: 75000
    });
    return result && (result.parsed || JSON.parse(String(result.text || '{}').replace(/```json/gi, '').replace(/```/g, '').trim()));
  }
  let parsed = null;
  try {
    parsed = await askWriter();
  } catch (_error) {
    parsed = null;
  }
  if (scrubAudienceTopics(parsed && parsed.audienceTopics, brandKnowledge).cards.length < 4) {
    try {
      parsed = await askWriter(outputLang === 'en'
        ? 'The previous cards were discarded because archetype keys were missing. Rebuild 12 cards. Each card uses exactly one archetype and includes every key named for that archetype.'
        : '前回のカードは型の必須キーが欠けていたため破棄した。12枚を作り直す。各カードは1つの archetype だけを使い、その型のキーをすべて入れる。');
    } catch (_error) {}
  }
  const scrubbed = scrubAudienceTopics(parsed && parsed.audienceTopics, brandKnowledge);
  const audienceTopics = scrubbed.cards;
  const rawRows = Array.isArray(parsed && parsed.audienceTopics) ? parsed.audienceTopics : [];
  const shape = {
    topKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 12) : [],
    cardKeys: rawRows[0] && typeof rawRows[0] === 'object' ? Object.keys(rawRows[0]).slice(0, 12) : [],
    archetypeValues: rawRows.map(row => String(row && row.archetype || '').slice(0, 40)).slice(0, 8)
  };
  if (!parsed) {
    return { ok: false, fallback: true, reason: 'writer_unparsed', audienceKnowledge: null, budgetRecorded: false, rejected: scrubbed.rejected, shape };
  }
  if (audienceTopics.length < 4) {
    return { ok: false, fallback: true, reason: 'audience_cards_rejected', audienceKnowledge: null, budgetRecorded: false, rejected: scrubbed.rejected, rawCount: rawRows.length, shape };
  }
  const broadTopicDomains = {
    ring1_craft: [...new Set(audienceTopics.filter(card => card.topicRing === 'ring1_craft').map(card => card.topicDomain))].slice(0, 6),
    ring2_broad_adjacent: [...new Set(audienceTopics.filter(card => card.topicRing === 'ring2_broad_adjacent').map(card => card.topicDomain))].slice(0, 6)
  };
  const supplied = parsed && parsed.broadTopicDomains;
  if (supplied && Array.isArray(supplied.ring1_craft)) broadTopicDomains.ring1_craft = supplied.ring1_craft.map(item => clip(item, 80)).filter(Boolean).slice(0, 6);
  if (supplied && Array.isArray(supplied.ring2_broad_adjacent)) broadTopicDomains.ring2_broad_adjacent = supplied.ring2_broad_adjacent.map(item => clip(item, 80)).filter(Boolean).slice(0, 6);
  const audienceKnowledge = {
    schemaVersion: 2,
    outputLang,
    contentHash: hash,
    extractedAt: now.toISOString(),
    readerPersona: clip(parsed && parsed.readerPersona, 240),
    broadTopicDomains,
    internalToolJargonBlocklist: jargonList(parsed && parsed.internalToolJargonBlocklist, brandKnowledge),
    audienceTopics
  };
  if (db && userId) {
    await db.collection('saas_users').doc(userId).set({ audienceKnowledge }, { merge: true });
    try {
      const budgetApi = require('./tenant_ai_budget');
      await budgetApi.recordTenantAiUsage({ db, userId, kind: 'llm', role: 'writer', count: 1, now });
      if (radarFresh || signals.length) {
        await budgetApi.recordTenantAiUsage({ db, userId, kind: 'llm', role: 'writer', count: 1, now });
      }
    } catch (_budgetError) {}
  }
  return { ok: true, cached: false, audienceKnowledge, budgetRecorded: true };
}

module.exports = {
  ensureAudienceKnowledge,
  scrubAudienceTopics,
  contentHash,
  cardLeaks,
  cacheFresh,
  genericJargon,
  jargonList
};
