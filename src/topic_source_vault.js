'use strict';

const crypto = require('crypto');
const { DAILY_PAGE_CAP } = require('./site_crawler');

const BLOCKED_PATH = /\/(login|signin|signup|register|auth|oauth|terms|privacy|legal|tokushoho|policy)(\/|$|\?)/i;
const SOCIAL_HOST = /(^|\.)((?:x|twitter|facebook|instagram|tiktok|youtube)\.com|youtu\.be|t\.co)$/i;
const DOC_HOST = /(^|\.)((?:docs|developer|developers)\.(?:x|twitter)\.com)$/i;

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
  if ((SOCIAL_HOST.test(host) && !DOC_HOST.test(host)) || BLOCKED_PATH.test(url.pathname)) return '';
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

function isSecondaryRoundup(item) {
  const label = `${item && item.sourceName || ''} ${item && item.title || ''} ${item && item.url || ''}`;
  return /初心者向け|完全ガイド|コツ\s*\d+\s*選|\d+\s*選|基本設計|まとめ記事|SEO解説|入門ガイド|保存版|beginner(?:'s)? guide|ultimate guide|complete guide|\b\d+\s+tips\b/i.test(label);
}

function isPrimarySource(item) {
  if (!item || isSecondaryRoundup(item)) return false;
  let host = '';
  const raw = String(item.url || '');
  try { host = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch (_err) { host = ''; }
  const name = String(item.sourceName || '');
  if (/(^|\.)(docs|developer|developers|spec)\./i.test(host)) return true;
  if (/(^|\.)((?:github|gitlab|arxiv|doi|rfc-editor)\.(?:com|org))$/i.test(host)) return true;
  if (/(?:^|\.)(?:gov|go\.jp|gov\.uk)$/i.test(host)) return true;
  if (/\/(?:docs|spec|specs|specification|whitepaper|guideline|guidelines|rfc|release-notes|releases|statistics|papers?)\b/i.test(raw)) return true;
  return /公式仕様|公式ドキュメント|ガイドライン|白書|統計|論文|リリースノート|調査報告/.test(name);
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
  const problems = Array.isArray(knowledge.domainProblems) ? knowledge.domainProblems.slice(0, 4) : [];
  const brief = [knowledge.icpSummary, ...problems].filter(Boolean).join('\n').slice(0, 800);
  const prompt = lang === 'en'
    ? `Shift one step away from the product. From icpSummary and domainProblems only, choose one concrete question this field still answers with a rumor. Do not search by productName or implementation terms. Find at most 3 primary sources a specialist would cite, preferably on different domains: an official specification, a public statistic, an industry guideline, a paper, a public repository, or a release note. Exclude competitor tool comparisons, setup manuals, pricing pages, product reviews, affiliate roundups, diaries about building the tool, and beginner SEO explainers such as "7 tips" or "the complete guide". If no primary source exists, return {"items":[]}. Return JSON {"items":[{"url":"","sourceName":""}]} only. No social network, login, or terms pages.\n${brief}`
    : `読者の本業の課題へ一段ずらす。icpSummary と domainProblems だけを主軸にする。productName や実装用語では検索しない。読者課題として、この分野の人が仕組みを知らないまま噂や思い込みで困っている具体的な疑問を1つだけ自律的に選ぶ。その答えがある一次原典だけを最大3件、可能なら別のドメインから選ぶ。公式仕様、公的統計、業界ガイドライン、論文、公開コード、リリースノート、調査報告。同業のツール比較、競合ツールの操作マニュアル、料金比較、導入手順、製品レビュー、アフィリエイトまとめに加え、ツール自体の自作・開発・自動化スクリプト実装記は除外する。初心者向けまとめ・SEO解説ブログ（コツ7選、完全ガイド、基本設計の解説）も除外する。一次原典が無いときは {"items":[]} を返す。JSON {"items":[{"url":"","sourceName":""}]} だけ。SNS、ログイン、規約は入れない。\n${brief}`;
  const result = await ask({
    search: true,
    xSearch: false,
    tier: 'fast',
    timeoutMs: 20000,
    systemPrompt: lang === 'en'
      ? 'Return JSON only. Pick the reader\'s own work problem, not a tool build log, a setup manual, or a pricing comparison.'
      : 'JSONだけ返す。読者の本業課題の記事を選ぶ。商材ツールの自作・操作記事と料金比較は選ばない。',
    prompt
  });
  const pool = [];
  for (const item of urlsFromSearch(result && result.text)) {
    const url = safeArticleUrl(item.url, ownUrls, null);
    if (!url || pool.some(row => row.url === url) || !isPrimarySource({ ...item, url })) continue;
    try {
      if (assertUrl) await assertUrl(new URL(url));
      else await require('./url_fetch_guard').assertPublicHttpUrl(url);
    } catch (_err) {
      continue;
    }
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (_err) { host = ''; }
    pool.push({ url, host, sourceName: stripUrls(item.sourceName).slice(0, 80) });
  }
  const chosen = [];
  const seenHost = new Set();
  pool.forEach(row => {
    if (chosen.length >= 3 || seenHost.has(row.host)) return;
    seenHost.add(row.host);
    chosen.push({ url: row.url, sourceName: row.sourceName });
  });
  pool.forEach(row => {
    if (chosen.length >= 3 || chosen.some(item => item.url === row.url)) return;
    chosen.push({ url: row.url, sourceName: row.sourceName });
  });
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
    ? `From this article only, return JSON with sourceName, title, readerQuestion, coreFact, whyItMatters, mechanism, plainTranslation, commonMyth. readerQuestion is the one concrete question a non-specialist is stuck on. coreFact is one fact from the source, not a checklist. mechanism is the specialist point underneath that fact. plainTranslation says that mechanism in everyday words so a non-specialist can see how it works. Do not turn plainTranslation into a task or a checklist. commonMyth is the rumor this source contradicts, at most 120 characters. Keep a number only when it appears in the article. Do not invent a quotation or a number. Do not include a URL.\nSource name: ${sourceName}\nArticle:\n${markdown.slice(0, 6000)}`
    : `この記事に書いてあることだけからJSONを返す。項目は sourceName, title, readerQuestion, coreFact, whyItMatters, mechanism, plainTranslation, commonMyth。ツールの使い方や料金比較ではなく、専門的な仕組みを訳す。readerQuestion は、専門知識がない人が噂のまま困っている具体的な疑問を1文で書く。coreFact は核の1事実だけ。mechanism は原典が示している裏側の仕組み。plainTranslation は、その仕組みを専門知識がない人でも「そういう仕組みだったのか」と読める日常の言葉へ訳す。作業命令やチェックリストにしない。coreFact の冒頭は、どの場面の何の仕組みの話かが一読でわかる主語から始める。「この仕組みでは」のような主語のない書き出しにしない。commonMyth は、その記事が覆している現場の思い込みを120字以内で書く。数字は記事にあるものだけ残す。引用と数字を作らない。URLは入れない。\n出典名: ${sourceName}\n記事:\n${markdown.slice(0, 6000)}`;
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
    readerQuestion: field(parsed.readerQuestion, 160),
    coreFact: field(parsed.coreFact, 220),
    whyItMatters: field(parsed.whyItMatters, 180),
    mechanism: field(parsed.mechanism, 220),
    plainTranslation: field(parsed.plainTranslation, 220),
    actionableTakeaway: field(parsed.actionableTakeaway, 180),
    commonMyth: field(parsed.commonMyth, 120),
    fetchedAt: (now instanceof Date ? now : new Date()).toISOString(),
    usedCount: 0,
    lastUsedAt: null
  };
  if (!card.coreFact || !card.mechanism || (!card.plainTranslation && !card.actionableTakeaway)) return null;
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

const WEEKLY_ARTICLE_CAP = { free: 1, starter: 2, pro: 3, business: 3 };
const MIN_GAP_MS = {
  free: 7 * 24 * 60 * 60 * 1000,
  starter: 3.5 * 24 * 60 * 60 * 1000,
  pro: 2.3 * 24 * 60 * 60 * 1000,
  business: 2.3 * 24 * 60 * 60 * 1000
};
const UNUSED_CARD_CAP = 6;
const SWEEP_CUSTOMER_CAP = 3;

function topicPlan(user) {
  return require('./tenant_ai_budget').monthlyLimitsForUser(user || {}).plan;
}

function topicVaultEligibility({ user, cards = [], now = new Date(), budgetAllowed = true } = {}) {
  if (!user || user.autopilotPaused === true || user.isActive === false) return { ok: false, reason: 'inactive' };
  const status = String(user.planStatus || '').toLowerCase();
  const stripe = String(user.stripeSubscriptionStatus || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || stripe === 'canceled') return { ok: false, reason: 'cancelled' };
  const brand = user.brandKnowledge;
  const hasUrl = Boolean(String(user.targetUrl || (brand && brand.sourceUrl) || '').trim());
  if (!hasUrl || !brand || typeof brand !== 'object') return { ok: false, reason: 'missing_brand' };
  const unused = cards.filter(card => Number(card && card.usedCount) === 0).length;
  if (unused >= UNUSED_CARD_CAP) return { ok: false, reason: 'unused_full' };
  if (budgetAllowed === false) return { ok: false, reason: 'budget' };
  const plan = topicPlan(user);
  const cap = WEEKLY_ARTICLE_CAP[plan] || WEEKLY_ARTICLE_CAP.free;
  const gap = MIN_GAP_MS[plan] || MIN_GAP_MS.free;
  const weekAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
  const recent = cards.filter(card => {
    const at = Date.parse(card && card.fetchedAt || '');
    return Number.isFinite(at) && at >= weekAgo;
  });
  if (recent.length >= cap) return { ok: false, reason: 'weekly_cap' };
  const last = cards.reduce((max, card) => {
    const at = Date.parse(card && card.fetchedAt || '');
    return Number.isFinite(at) && at > max ? at : max;
  }, 0);
  if (last && now.getTime() - last < gap) return { ok: false, reason: 'interval' };
  return { ok: true, reason: 'ready', plan, weeklyCap: cap, minGapMs: gap };
}

async function runTopicSourceVaultSweep(db, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const cap = Number.isInteger(options.customerCap) ? options.customerCap : SWEEP_CUSTOMER_CAP;
  const listed = options.listUsers
    ? await options.listUsers()
    : await db.collection('saas_users').orderBy('__name__').limit(40).get();
  const docs = listed && listed.docs ? listed.docs : [];
  let scanned = 0;
  let collected = 0;
  let skipped = 0;
  for (const doc of docs) {
    if (collected >= cap) break;
    scanned += 1;
    const user = typeof doc.data === 'function' ? (doc.data() || {}) : (doc.data || {});
    const userId = doc.id;
    let cards = [];
    try {
      cards = options.loadCards
        ? await options.loadCards(userId)
        : await loadTopicCards(db, userId);
    } catch (_err) {
      cards = [];
    }
    let budgetAllowed = true;
    try {
      if (options.budgetAllowed) budgetAllowed = await options.budgetAllowed(userId, user);
      else {
        const gate = await require('./tenant_ai_budget').checkTenantAiBudget({ db, userId, user, kind: 'crawl', count: 1, now });
        budgetAllowed = !(gate && gate.allowed === false);
      }
    } catch (_err) {
      budgetAllowed = true;
    }
    const decision = topicVaultEligibility({ user, cards, now, budgetAllowed });
    if (!decision.ok) {
      skipped += 1;
      continue;
    }
    const lang = String(user.aiTargetLang || '').toLowerCase().startsWith('en') ? 'en' : 'ja';
    const collect = options.collect || collectTopicSourceForUser;
    try {
      const card = await collect({
        db,
        userId,
        user,
        brandKnowledge: user.brandKnowledge,
        outputLang: lang,
        dryRun: false,
        now
      });
      if (card) collected += 1;
      else skipped += 1;
    } catch (_err) {
      skipped += 1;
    }
  }
  console.log(`[Topic Vault] scanned=${scanned} collected=${collected} skipped=${skipped}`);
  return { scanned, collected, skipped };
}

async function loadTopicCards(db, userId) {
  if (!db || !userId) return [];
  const snap = await db.collection('saas_users').doc(userId).collection('topic_sources').limit(40).get();
  const cards = [];
  snap.forEach(doc => cards.push(doc.data() || {}));
  return cards;
}

function oneDossierPoint(value) {
  const clean = stripUrls(value);
  const sentence = clean.split(/\n|。|！|？/).map(part => part.trim()).filter(Boolean)[0] || '';
  if ((sentence.match(/、|,/g) || []).length >= 3) return sentence.split(/、|,/)[0].trim();
  return sentence;
}

function formatTopicSourceAsDossier(card, isEn, maxChars = 700) {
  const translation = oneDossierPoint(card && card.plainTranslation);
  const legacy = oneDossierPoint(card && card.actionableTakeaway);
  const studied = oneDossierPoint(card && card.coreFact);
  const lines = isEn
    ? [
      'Use the source name in the post and end on the finding as ordinary prose. Do not end on a check or a fix list. Do not explain the same mechanism twice.',
      `Source: ${oneDossierPoint(card && card.sourceName) || stripUrls(card && card.sourceName)}`,
      `Question: ${oneDossierPoint(card && card.readerQuestion)}`,
      `Studied: ${studied}`,
      translation ? '' : `Mechanism: ${oneDossierPoint(card && card.mechanism)}`,
      translation || `Point: ${legacy}`,
      `Rumor: ${oneDossierPoint(card && card.commonMyth)}`
    ]
    : [
      '扱い: 出典名を本文に残し、かみ砕いた中身を地の文で終える。確認手順や直しどころでは終えない。同じ仕組みは一度だけ書く。',
      `出典: ${oneDossierPoint(card && card.sourceName) || stripUrls(card && card.sourceName)}`,
      `疑問: ${oneDossierPoint(card && card.readerQuestion)}`,
      `調べたこと: ${studied}`,
      translation ? '' : `仕組み: ${oneDossierPoint(card && card.mechanism)}`,
      translation || `要点: ${legacy}`,
      `思い込み: ${oneDossierPoint(card && card.commonMyth)}`
    ];
  return lines.filter(line => line && !/[:：]\s*$/.test(line)).join('\n').slice(0, maxChars).trim();
}

function verifiedReferenceUrlForJob({ sourceType, ownerSparkUsed, topicRing, sourceUrl } = {}) {
  if (sourceType !== 'topic_source') return null;
  if (ownerSparkUsed === true) return null;
  if (String(topicRing || '') === 'ring3_product_bridge') return null;
  const url = safeArticleUrl(sourceUrl, [], null);
  return url || null;
}

function referenceLine(lang, url) {
  return `${String(lang || '').toLowerCase().startsWith('en') ? 'Source: ' : '参考: '}${url}`;
}

function planVerifiedReference({ tweets, verifiedReferenceUrl, singleOnly, lang, maxChars } = {}) {
  const rows = (Array.isArray(tweets) ? tweets : []).map(text => String(text || '')).filter(text => text.trim());
  const url = verifiedReferenceUrlForJob({
    sourceType: 'topic_source',
    ownerSparkUsed: false,
    topicRing: '',
    sourceUrl: verifiedReferenceUrl
  });
  if (singleOnly === true || !url) return { action: 'skipped', status: 'skipped', tweets: rows, replyText: '' };
  const line = referenceLine(lang, url);
  const prefix = line.slice(0, line.length - url.length);
  if (rows.length <= 1) return { action: 'reply', status: 'sent', tweets: rows, replyText: line };
  const capped = rows.slice(0, 3);
  const last = capped[capped.length - 1];
  const limit = Number(maxChars) || (String(lang || '').toLowerCase().startsWith('en') ? 270 : 140);
  if (last.length + 1 + prefix.length + 23 > limit) {
    return { action: 'skipped_length', status: 'skipped_length', tweets: capped, replyText: '' };
  }
  capped[capped.length - 1] = `${last}\n${line}`;
  return { action: 'append', status: 'sent', tweets: capped, replyText: '' };
}

module.exports = {
  collectTopicSourceForUser,
  pickTopicSourceForPost,
  markTopicSourceUsed,
  formatTopicSourceAsDossier,
  selectArticleUrls,
  isPrimarySource,
  safeArticleUrl,
  verifiedReferenceUrlForJob,
  planVerifiedReference,
  keepGroundedNumbers,
  sourceIdFor,
  topicVaultEligibility,
  runTopicSourceVaultSweep,
  WEEKLY_ARTICLE_CAP,
  MIN_GAP_MS
};
