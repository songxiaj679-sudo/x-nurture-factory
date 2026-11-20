'use strict';

const { BANNED_LEGACY } = require('./lp_knowledge_extractor');

const UI_BADGE = /PAGE FACTS ONLY|ACCOUNT VOICE|QUALITY\s*&\s*SHAPE|ADAPTIVE LOOP SYSTEM|2段階設計と投稿審査/i;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memory = new Map();
const hydratedSlugs = new Set();

function categorySlug(category, lang) {
  const cleaned = String(category || 'general')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@\w+/g, '')
    .replace(/[a-z0-9.-]+\.(?:com|jp|io|ai|net|org)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'general';
  return `${cleaned}_${String(lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja'}`;
}

function scrubBenchmarkPatterns(patterns, brandWords = []) {
  const brands = (Array.isArray(brandWords) ? brandWords : [brandWords]).map(word => String(word || '').trim()).filter(word => word.length >= 2);
  return (Array.isArray(patterns) ? patterns : []).map(pattern => {
    const raw = `${pattern && pattern.hookPattern || ''} ${pattern && pattern.cadence || ''} ${pattern && pattern.whyBookmarked || ''}`;
    if (BANNED_LEGACY.test(raw) || UI_BADGE.test(raw)) return null;
    if (brands.some(word => raw.toLowerCase().includes(word.toLowerCase()))) return null;
    const clean = value => String(value || '').replace(/\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const next = {
      hookPattern: clean(pattern && pattern.hookPattern),
      cadence: clean(pattern && pattern.cadence),
      whyBookmarked: clean(pattern && pattern.whyBookmarked)
    };
    if (!next.hookPattern || !next.cadence || !next.whyBookmarked) return null;
    return next;
  }).filter(Boolean).slice(0, 3);
}

function peekNicheBenchmark(slug, now = Date.now()) {
  const row = memory.get(slug);
  if (!row || !row.expiresAt || new Date(row.expiresAt).getTime() <= now) return null;
  return row;
}

function rememberNicheBenchmark(row) {
  if (!row || !row.categorySlug) return null;
  memory.set(row.categorySlug, row);
  return row;
}

function nicheHintText(row) {
  const pattern = row && Array.isArray(row.patterns) ? row.patterns[0] : null;
  if (!pattern) return '';
  return `${pattern.hookPattern} / ${pattern.cadence}`.slice(0, 180);
}

async function hydrateNicheBenchmark(slug, db) {
  if (!db || hydratedSlugs.has(slug)) return peekNicheBenchmark(slug);
  hydratedSlugs.add(slug);
  try {
    const snap = await db.collection('collective_intelligence').doc('niche_benchmarks_v1').get();
    const stored = snap.exists ? (snap.data() || {})[slug] : null;
    if (stored && stored.expiresAt && new Date(stored.expiresAt).getTime() > Date.now()) {
      rememberNicheBenchmark({ ...stored, categorySlug: stored.categorySlug || slug });
    }
  } catch (_err) {}
  return peekNicheBenchmark(slug);
}

async function refreshNicheBenchmark({ category, lang, ownHandle, brandWords = [], db = null, now = new Date(), completeTextImpl = null } = {}) {
  const slug = categorySlug(category, lang);
  if (!peekNicheBenchmark(slug, now.getTime())) await hydrateNicheBenchmark(slug, db);
  const cached = peekNicheBenchmark(slug, now.getTime());
  if (cached) return cached;
  const completeText = completeTextImpl || require('./grok_client').completeText;
  const searched = await completeText({
    search: true,
    xSearch: true,
    excludedXHandles: [ownHandle].filter(Boolean),
    timeoutMs: 35000,
    tier: 'fast',
    json: true,
    prompt: `Return JSON {"patterns":[{"hookPattern":"","cadence":"","whyBookmarked":""}]}. Describe only abstract post structure for ${slug}. No brand names, quotes, sentences copied from posts, or numbers.`
  });
  let parsed = {};
  try { parsed = JSON.parse(String(searched.text || '{}')); } catch (_err) { parsed = {}; }
  const row = {
    categorySlug: slug,
    patterns: scrubBenchmarkPatterns(parsed.patterns, brandWords),
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString()
  };
  rememberNicheBenchmark(row);
  if (db && row.patterns.length) {
    db.collection('collective_intelligence').doc('niche_benchmarks_v1').set({
      [slug]: row,
      updatedAt: now
    }, { merge: true }).catch(() => {});
  }
  return row;
}

function scheduleNicheBenchmark(options = {}) {
  const slug = categorySlug(options.category, options.lang);
  const cached = peekNicheBenchmark(slug);
  refreshNicheBenchmark(options).catch(error => {
    console.warn(`[Niche Benchmark] ${String(error && error.message || error).slice(0, 160)}`);
  });
  return { categorySlug: slug, hint: nicheHintText(cached), refreshing: !cached };
}

module.exports = {
  categorySlug,
  scrubBenchmarkPatterns,
  peekNicheBenchmark,
  rememberNicheBenchmark,
  nicheHintText,
  refreshNicheBenchmark,
  hydrateNicheBenchmark,
  scheduleNicheBenchmark
};
