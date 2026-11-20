'use strict';

const crypto = require('crypto');

const DOC_ID = 'source_dossiers_v1';
const TTL_MS = 12 * 60 * 60 * 1000;

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clipClean(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max + 1);
  const sentenceAt = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('。'), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (sentenceAt >= Math.floor(max * 0.45)) return slice.slice(0, sentenceAt + 1).trim();
  const boundary = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('、'), slice.lastIndexOf('，'));
  if (boundary >= Math.floor(max * 0.5)) return slice.slice(0, boundary).trim();
  return clean.slice(0, max).trim();
}

function dossierKey(topicDomain, lang) {
  return crypto.createHash('sha256').update(`${String(topicDomain || '').trim()}|${lang || 'ja'}`).digest('hex').slice(0, 32);
}

function scrubField(value, max, productName) {
  let text = String(value || '')
    .replace(/[「」『』"'“”‘’]/g, '')
    .replace(/\d+(?:[.,]\d+)?\s*[%％]?/g, '')
    .replace(/[$¥￥]\s*\d[\d,]*/g, '');
  const product = String(productName || '').trim();
  if (product.length >= 2) text = text.split(product).join(' ');
  return clipClean(text, max);
}

function scrubDossier(raw, productName) {
  const angles = (Array.isArray(raw && raw.concreteAngles) ? raw.concreteAngles : [])
    .map(item => scrubField(item, 120, productName))
    .filter(Boolean)
    .slice(0, 3);
  const dossier = {
    currentDebate: scrubField(raw && raw.currentDebate, 240, productName),
    concreteAngles: angles,
    specialistInsight: scrubField(raw && raw.specialistInsight, 240, productName),
    avoidCliches: (Array.isArray(raw && raw.avoidCliches) ? raw.avoidCliches : [])
      .map(item => scrubField(item, 80, productName))
      .filter(Boolean)
      .slice(0, 4)
  };
  if (!dossier.currentDebate && !dossier.specialistInsight) return null;
  return dossier;
}

function collection(db) {
  if (!db || typeof db.collection !== 'function') return null;
  return db.collection('collective_intelligence').doc(DOC_ID);
}

async function readCache(db, key, now) {
  const ref = collection(db);
  if (!ref) return null;
  try {
    const snap = await ref.get();
    const entries = snap && snap.exists && Array.isArray(snap.data().entries) ? snap.data().entries : [];
    const hit = entries.find(entry => entry && entry.key === key && entry.expiresAt && new Date(entry.expiresAt).getTime() > now.getTime());
    if (!hit || !hit.dossier) return null;
    return { ...hit.dossier, key, cached: true, latencyMs: Number(hit.latencyMs) || 0, fetchedAt: hit.fetchedAt, expiresAt: hit.expiresAt };
  } catch (_error) {
    return null;
  }
}

async function writeCache(db, payload, now) {
  const ref = collection(db);
  if (!ref) return;
  try {
    const snap = await ref.get();
    const current = snap && snap.exists && Array.isArray(snap.data().entries) ? snap.data().entries : [];
    const entries = current
      .filter(entry => entry && entry.key && entry.key !== payload.key && entry.expiresAt && new Date(entry.expiresAt).getTime() > now.getTime())
      .slice(0, 39);
    entries.unshift(payload);
    await ref.set({ entries, updatedAt: now.toISOString() }, { merge: true });
  } catch (_error) {}
}

async function fetchSourceDossier({
  topicDomain = '',
  topicRing = '',
  readerPersona = '',
  lang = 'ja',
  excludedXHandles = [],
  productName = '',
  db = null,
  userId = '',
  user = null,
  now = new Date()
} = {}) {
  const outputLang = String(lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const topic = scrubField(topicDomain, 120, productName);
  if (topic.length < 2) return null;
  const key = dossierKey(topic, outputLang);
  const cached = await readCache(db, key, now);
  if (cached) return cached;
  try {
    const budget = await require('./tenant_ai_budget').checkTenantAiBudget({ db, userId, user, kind: 'llm', count: 1, now });
    if (budget && budget.allowed === false) return null;
  } catch (_error) {}
  const web = topicRing === 'ring2_broad_adjacent';
  const model = process.env.XAI_MODEL_RADAR || 'grok-4.20-0309-non-reasoning';
  const prompt = outputLang === 'en'
    ? `Return JSON only for this practitioner topic: ${topic}. Reader: ${scrubField(readerPersona, 160, productName)}. Fields: currentDebate, concreteAngles (2), specialistInsight, avoidCliches (2). Qualitative only. No numbers, dates, quotes, product names, or page-checking steps.`
    : `この話題の実務メモをJSONだけで返す。話題: ${topic}。読み手: ${scrubField(readerPersona, 160, productName)}。項目は currentDebate、concreteAngles を2つ、specialistInsight、avoidCliches を2つ。数値、日付、引用、製品名、登録ページの照合手順は入れない。`;
  const started = Date.now();
  try {
    const { completeText } = require('./grok_client');
    const text = (await completeText({
      model,
      tier: 'fast',
      search: true,
      xSearch: !web,
      xSearchOnly: !web,
      excludedXHandles,
      timeoutMs: 18000,
      systemPrompt: 'One tool call. Qualitative practitioner notes only. No invented statistics or quotations.',
      prompt
    })).text;
    const parsed = JSON.parse(String(text).replace(/```json/gi, '').replace(/```/g, '').trim());
    const dossier = scrubDossier(parsed, productName);
    if (!dossier) return null;
    const payload = {
      key,
      topicDomain: topic,
      lang: outputLang,
      dossier,
      latencyMs: Date.now() - started,
      model,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString()
    };
    await writeCache(db, payload, now);
    if (db && userId) {
      try {
        await require('./tenant_ai_budget').recordTenantAiUsage({ db, userId, kind: 'llm', role: 'writer', count: 1, now });
      } catch (_budgetError) {}
    }
    return { ...dossier, key, cached: false, latencyMs: payload.latencyMs, model };
  } catch (error) {
    console.warn(`[Source Dossier] ${String(error && error.message || error).slice(0, 180)}`);
    return null;
  }
}

module.exports = { fetchSourceDossier, scrubDossier, dossierKey, scrubField, clipClean };
