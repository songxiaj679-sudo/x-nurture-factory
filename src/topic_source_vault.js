'use strict';

const crypto = require('crypto');
const { DAILY_PAGE_CAP } = require('./site_crawler');

const BLOCKED_PATH = /\/(login|signin|signup|register|auth|oauth|terms|privacy|legal|tokushoho|policy)(\/|$|\?)/i;
const SOCIAL_HOST = /(^|\.)((?:x|twitter|facebook|instagram|tiktok|youtube)\.com|youtu\.be|t\.co)$/i;

function normalizeSourceUrl(value) {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch (err) {
    return '';
  }
}

function sourceIdFor(url) {
  return crypto.createHash('sha256').update(normalizeSourceUrl(url)).digest('hex').slice(0, 32);
}

function stripUrls(value) {
  return String(value || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function keepGroundedNumbers(text, corpus) {
  let body = stripUrls(text);
  const source = String(corpus || '');
  const numbers = body.match(/\d+(?:[.,]\d+)?/g) || [];
  numbers.forEach(token => {
    if (!source.includes(token)) body = body.split(token).join(' ');
  });
  return body.replace(/\s+/g, ' ').trim();
}

function safeArticleUrl(raw, ownUrls, assertUrl) {
  const normalized = normalizeSourceUrl(raw);
  if (!normalized) return '';
  let url;
  try {
    url = new URL(normalized);
  } catch (err) {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '127.0.0.1' || host === '::1' || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return '';
  if (SOCIAL_HOST.test(host) || BLOCKED_PATH.test(url.pathname)) return '';
  if (ownUrls.some(item => item && item === normalized)) return '';
  if (typeof assertUrl === 'function') {
    try {
      assertUrl(url);
    } catch (err) {
      return '';
    }
  }
  return normalized;
}

function urlsFromSearch(text) {
  const raw = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const found = [];
  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed && parsed.items) ? parsed.items : [];
    items.forEach(item => {
      if (item && item.url) found.push({ url: String(item.url), sourceName: String(item.sourceName || '') });
    });
  } catch (err) {
    const matches = raw.match(/https?:\/\/[^\s"'<>]+/g) || [];
    matches.forEach(url => found.push({ url, sourceName: '' }));
  }
  return found;
}

async function selectArticleUrls({ brandKnowledge, outputLang, ownUrls, completeText, assertUrl }) {
  const ask = completeText || require('./grok_client').completeText;
  const lang = outputLang === 'en' ? 'en' : 'ja';
  const knowledge = brandKnowledge || {};
  const brief = [knowledge.category, knowledge.icpSummary, knowledge.oneLineMechanism, ...(Array.isArray(knowledge.domainProblems) ? knowledge.domainProblems.slice(0, 3) : [])]
    .filter(Boolean)
    .join('\n')
    .slice(0, 800);
  const prompt = lang === 'en'
    ? `Find at most 2 public article URLs that explain this field for a general reader. Return JSON {"items":[{"url":"","sourceName":""}]} only. No social network, login, or terms pages.\n${brief}`
    : `この分野の一般読者に役立つ一次記事か実務解説のURLを最大2件返す。JSON {"items":[{"url":"","sourceName":""}]} だけ。SNS、ログイン、規約は入れない。\n${brief}`;
  const result = await ask({
    search: true,
    xSearch: false,
    tier: 'fast',
    timeoutMs: 20000,
    systemPrompt: 'Return JSON only. Each URL must be an https article page.',
    prompt
  });
  const chosen = [];
  for (const item of urlsFromSearch(result && result.text)) {
    if (chosen.length >= 2) break;
    const url = safeArticleUrl(item.url, ownUrls, null);
    if (!url || chosen.some(row => row.url === url)) continue;
    try {
      if (assertUrl) await assertUrl(new URL(url));
      else await require('./url_fetch_guard').assertPublicHttpUrl(url);
    } catch (_err) {
      continue;
    }
    chosen.push({ url, sourceName: stripUrls(item.sourceName).slice(0, 80) });
  }
  return chosen;
}

async function scrapeMarkdown(url, fetchImpl) {
  const key = process.env.FIRECRAWL_API_KEY && String(process.env.FIRECRAWL_API_KEY).trim();
  if (!key) return '';
  const response = await (fetchImpl || fetch)('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    signal: AbortSignal.timeout(12000)
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (_err) { parsed = null; }
  if (!response.ok || !parsed || parsed.success === false) return '';
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  return String(data.markdown || '').trim();
}

async function crawlAllowed({ db, userId, user, now }) {
  if (!db || !userId) return true;
  try {
    const gate = await require('./tenant_ai_budget').checkTenantAiBudget({ db, userId, user, kind: 'crawl', count: 1, now });
    if (gate && gate.allowed === false) return false;
  } catch (_err) {
    return true;
  }
  try {
    const snap = await db.collection('saas_users').doc(userId).get();
    const quota = snap && snap.exists ? (snap.data() || {}).crawlQuota : null;
    const day = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    if (quota && quota.dayKey === day && Number(quota.pagesUsed) >= DAILY_PAGE_CAP) return false;
  } catch (_err) {
    return true;
  }
  return true;
}

async function buildCard({ markdown, sourceUrl, sourceName, outputLang, completeJson, now }) {
  const lang = outputLang === 'en' ? 'en' : 'ja';
  const ask = completeJson || require('./grok_client').completeJson;
  const prompt = lang === 'en'
    ? `From this article only, return JSON with sourceName, title, coreFact, whyItMatters, mechanism, actionableTakeaway. Keep a number only when it appears in the article. Do not invent a quotation or a number. Do not include a URL. Explain the mechanism in plain words.\nSource name: ${sourceName}\nArticle:\n${markdown.slice(0, 6000)}`
    : `この記事に書いてあることだけからJSONを返す。項目は sourceName, title, coreFact, whyItMatters, mechanism, actionableTakeaway。数字は記事にあるものだけ残す。引用と数字を作らない。URLは入れない。仕組みは平易な言葉で分解する。\n出典名: ${sourceName}\n記事:\n${markdown.slice(0, 6000)}`;
  const scored = await ask({
    tier: 'fast',
    timeoutMs: 20000,
    search: false,
    systemPrompt: lang === 'en'
      ? 'Return JSON only. Use only facts present in the article.'
      : 'JSONだけ返す。記事にある事実だけを使う。',
    prompt
  });
  const parsed = scored && (scored.parsed || scored) || {};
  const field = (value, max) => keepGroundedNumbers(value, markdown).slice(0, max);
  const card = {
    sourceName: field(parsed.sourceName || sourceName, 80),
    sourceUrl,
    title: field(parsed.title, 120),
    outputLang: lang,
    coreFact: field(parsed.coreFact, 220),
    whyItMatters: field(parsed.whyItMatters, 180),
    mechanism: field(parsed.mechanism, 220),
    actionableTakeaway: field(parsed.actionableTakeaway, 180),
    fetchedAt: (now instanceof Date ? now : new Date()).toISOString(),
    usedCount: 0,
    lastUsedAt: null
  };
  if (!card.coreFact || !card.mechanism || !card.actionableTakeaway) return null;
  return card;
}

async function collectTopicSourceForUser({
  db = null,
  userId = '',
  user = null,
  brandKnowledge = null,
  outputLang = 'ja',
  dryRun = false,
  now = new Date(),
  completeText = null,
  completeJson = null,
  fetchImpl = null,
  assertUrl = null
} = {}) {
  const ownUrls = [brandKnowledge && brandKnowledge.sourceUrl, user && user.targetUrl].map(normalizeSourceUrl).filter(Boolean);
  let selected = [];
  try {
    selected = await selectArticleUrls({
      brandKnowledge,
      outputLang,
      ownUrls,
      completeText,
      assertUrl
    });
  } catch (_err) {
    return null;
  }
  if (!selected.length) return null;
  if (!(await crawlAllowed({ db, userId, user, now }))) return null;
  let markdown = '';
  let chosen = null;
  for (const item of selected) {
    try {
      markdown = await scrapeMarkdown(item.url, fetchImpl);
    } catch (_err) {
      markdown = '';
    }
    if (markdown) {
      chosen = item;
      break;
    }
  }
  if (!chosen || !markdown) return null;
  const card = await buildCard({
    markdown,
    sourceUrl: chosen.url,
    sourceName: chosen.sourceName,
    outputLang,
    completeJson,
    now
  });
  if (!card) return null;
  card.sourceId = sourceIdFor(chosen.url);
  if (dryRun || !db || !userId) return card;
  await db.collection('saas_users').doc(userId).collection('topic_sources').doc(card.sourceId).set(card);
  try {
    const quotaSnap = await db.collection('saas_users').doc(userId).get();
    const current = quotaSnap && quotaSnap.exists ? (quotaSnap.data() || {}).crawlQuota : null;
    const day = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const pagesUsed = current && current.dayKey === day ? Number(current.pagesUsed) || 0 : 0;
    await db.collection('saas_users').doc(userId).set({ crawlQuota: { dayKey: day, pagesUsed: pagesUsed + 1 } }, { merge: true });
    await require('./tenant_ai_budget').recordTenantAiUsage({ db, userId, kind: 'crawl', count: 1, now });
  } catch (_err) {}
  return card;
}

async function pickTopicSourceForPost(db, userId, { outputLang = 'ja' } = {}) {
  if (!db || !userId) return null;
  const snap = await db.collection('saas_users').doc(userId).collection('topic_sources').limit(20).get();
  const lang = outputLang === 'en' ? 'en' : 'ja';
  const rows = [];
  snap.forEach(doc => {
    const data = doc.data() || {};
    if ((data.outputLang || 'ja') !== lang || !data.coreFact || !data.mechanism) return;
    rows.push({ ...data, sourceId: doc.id });
  });
  rows.sort((left, right) => (Number(left.usedCount) || 0) - (Number(right.usedCount) || 0) || String(right.fetchedAt || '').localeCompare(String(left.fetchedAt || '')));
  return rows[0] || null;
}

async function markTopicSourceUsed(db, userId, sourceId, now = new Date()) {
  if (!db || !userId || !sourceId) return;
  const ref = db.collection('saas_users').doc(userId).collection('topic_sources').doc(sourceId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() || {};
  await ref.set({
    usedCount: (Number(data.usedCount) || 0) + 1,
    lastUsedAt: (now instanceof Date ? now : new Date()).toISOString()
  }, { merge: true });
}

function formatTopicSourceAsDossier(card, isEn, maxChars = 700) {
  const clean = value => stripUrls(value);
  const lines = isEn
    ? [`Source: ${clean(card && card.sourceName)}`, `Fact: ${clean(card && card.coreFact)}`, `Why: ${clean(card && card.whyItMatters)}`, `Mechanism: ${clean(card && card.mechanism)}`, `Next: ${clean(card && card.actionableTakeaway)}`]
    : [`出典: ${clean(card && card.sourceName)}`, `事実: ${clean(card && card.coreFact)}`, `関係: ${clean(card && card.whyItMatters)}`, `仕組み: ${clean(card && card.mechanism)}`, `一手: ${clean(card && card.actionableTakeaway)}`];
  return lines.filter(line => !/[:：]\s*$/.test(line)).join('\n').slice(0, maxChars).trim();
}

module.exports = {
  collectTopicSourceForUser,
  pickTopicSourceForPost,
  markTopicSourceUsed,
  formatTopicSourceAsDossier,
  safeArticleUrl,
  keepGroundedNumbers,
  sourceIdFor
};
