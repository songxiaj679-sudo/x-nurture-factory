'use strict';

const RSSParser = require('rss-parser');

const ALLOWED_PATH = /\/about|company-profile|features?|product|service|use-cases?|cases?|faq|help|docs?|guide|blog|column|pricing|plan|特徴|機能|事例|よくある質問|料金|サービス/i;
const BLOCKED_PATH = /terms|privacy|tokushoho|legal|compliance|company|login|signin|register|signup|auth|oauth|dashboard|accounting|admin|contract|order|cart|checkout|wp-admin|feed|rss|article\/note_|articles\b|^\/lp\b/i;
const CRAWL_BUDGET_MS = 25000;
const DAILY_PAGE_CAP = 20;
const EXTRA_PAGE_CAP = 4;
const memoryQuota = new Map();

function linkUrl(item) {
  if (typeof item === 'string') return item;
  return item && item.url ? String(item.url) : '';
}

function pathOf(raw) {
  try {
    return new URL(raw).pathname || '/';
  } catch (err) {
    return '';
  }
}

function blockedCrawlPath(raw) {
  return BLOCKED_PATH.test(pathOf(raw));
}

function allowedCrawlPath(raw) {
  return ALLOWED_PATH.test(pathOf(raw)) && !blockedCrawlPath(raw);
}

function dayKey(now) {
  return (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
}

async function readQuota({ userId, db, now }) {
  const key = dayKey(now);
  if (db && userId) {
    const snap = await db.collection('saas_users').doc(userId).get();
    const quota = snap.exists ? (snap.data() || {}).crawlQuota : null;
    if (quota && quota.dayKey === key) return { dayKey: key, pagesUsed: Number(quota.pagesUsed) || 0 };
    return { dayKey: key, pagesUsed: 0 };
  }
  const cached = memoryQuota.get(userId || 'public');
  if (cached && cached.dayKey === key) return { ...cached };
  return { dayKey: key, pagesUsed: 0 };
}

async function writeQuota({ userId, db, quota }) {
  if (db && userId) {
    await db.collection('saas_users').doc(userId).set({ crawlQuota: quota }, { merge: true });
    return;
  }
  memoryQuota.set(userId || 'public', quota);
}

function remaining(deadline) {
  return deadline - Date.now();
}

async function guard(url, assertUrl) {
  const check = assertUrl || require('./url_fetch_guard').assertPublicHttpUrl;
  return check(url);
}

async function localText(url, timeoutMs, fetchText) {
  const read = fetchText || require('./url_fetch_guard').fetchPublicText;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await read(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function firecrawl(path, body, key, fetchImpl, timeoutMs) {
  const response = await (fetchImpl || fetch)(`https://api.firecrawl.dev${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (_err) { parsed = null; }
  if (!response.ok || !parsed || parsed.success === false) {
    throw new Error(`firecrawl_${response.status}`);
  }
  return parsed;
}

function discoverFeed(html, entry) {
  const match = String(html || '').match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i);
  if (!match) return '';
  const href = match[0].match(/href=["']([^"']+)["']/i);
  if (!href) return '';
  try {
    return new URL(href[1], entry).href;
  } catch (err) {
    return '';
  }
}

async function readFeed(feedUrl, deadline, fetchText, assertUrl) {
  if (remaining(deadline) < 1000) return [];
  await guard(feedUrl, assertUrl);
  if (blockedCrawlPath(feedUrl)) return [];
  const loaded = await localText(feedUrl, Math.min(8000, remaining(deadline)), fetchText);
  if (!loaded || !loaded.ok) return [];
  const xml = String(loaded.text || '').slice(0, 512 * 1024);
  const parsed = await new RSSParser().parseString(xml);
  return (parsed.items || []).slice(0, 5).map(item => ({
    title: String(item.title || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
    snippet: String(item.contentSnippet || item.content || item.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220)
  })).filter(item => item.title);
}

async function crawlSite(options = {}) {
  const started = Date.now();
  const deadline = started + CRAWL_BUDGET_MS;
  const entryUrl = String(options.url || '');
  const assertUrl = options.assertUrl;
  const fetchText = options.fetchText;
  const fetchImpl = options.fetchImpl;
  try {
    await guard(entryUrl, assertUrl);
  } catch (err) {
    return { ok: false, error: err.message, pages: [], rssItems: [], quota: null };
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const quota = await readQuota({ userId: options.userId, db: options.db, now });
  const key = process.env.FIRECRAWL_API_KEY && String(process.env.FIRECRAWL_API_KEY).trim();
  let allowFirecrawl = Boolean(key);
  if (allowFirecrawl && options.db && options.userId) {
    try {
      const { checkTenantAiBudget } = require('./tenant_ai_budget');
      const gate = await checkTenantAiBudget({ db: options.db, userId: options.userId, kind: 'crawl', now });
      allowFirecrawl = gate.allowed !== false;
    } catch (_err) {
      allowFirecrawl = true;
    }
  }
  const pages = [];
  const remember = async (url, text, via) => {
    pages.push({ url, text: String(text || ''), via });
    if (via === 'firecrawl') {
      quota.pagesUsed += 1;
      await writeQuota({ userId: options.userId, db: options.db, quota });
      if (options.db && options.userId) {
        try {
          const { recordTenantAiUsage } = require('./tenant_ai_budget');
          await recordTenantAiUsage({ db: options.db, userId: options.userId, kind: 'crawl', count: 1, now });
        } catch (_err) {}
      }
    }
  };
  let entryHtml = '';
  if (key && allowFirecrawl && quota.pagesUsed < DAILY_PAGE_CAP && remaining(deadline) > 1000) {
    try {
      await guard(entryUrl, assertUrl);
      const scraped = await firecrawl('/v2/scrape', { url: entryUrl, formats: ['markdown'], onlyMainContent: true }, key, fetchImpl, Math.min(12000, remaining(deadline)));
      entryHtml = scraped.data && (scraped.data.markdown || scraped.data.html) || '';
      await remember(entryUrl, entryHtml, 'firecrawl');
    } catch (err) {
      entryHtml = '';
    }
  }
  if (!entryHtml) {
    const local = await localText(entryUrl, Math.min(8000, remaining(deadline)), fetchText);
    if (!local || !local.ok) return { ok: false, error: local && local.error || 'fetch_failed', pages, rssItems: [], quota };
    entryHtml = local.text || '';
    await remember(local.url || entryUrl, entryHtml, 'local');
  }
  const extras = [];
  if (key && allowFirecrawl && quota.pagesUsed < DAILY_PAGE_CAP && remaining(deadline) > 1500) {
    try {
      await guard(entryUrl, assertUrl);
      const mapped = await firecrawl('/v2/map', { url: entryUrl, limit: 25 }, key, fetchImpl, Math.min(8000, remaining(deadline)));
      const origin = new URL(entryUrl).origin;
      for (const item of (mapped.links || [])) {
        const href = linkUrl(item);
        if (!href || extras.length >= EXTRA_PAGE_CAP) break;
        let next;
        try { next = new URL(href); } catch (err) { continue; }
        if (next.origin !== origin || next.href === pages[0].url) continue;
        if (!allowedCrawlPath(next.href) || blockedCrawlPath(next.href)) continue;
        try {
          await guard(next.href, assertUrl);
        } catch (err) {
          continue;
        }
        extras.push(next.href);
      }
    } catch (err) {}
  }
  for (const href of extras) {
    if (pages.length >= EXTRA_PAGE_CAP + 1 || quota.pagesUsed >= DAILY_PAGE_CAP || remaining(deadline) < 1000) break;
    try {
      await guard(href, assertUrl);
      if (key && allowFirecrawl && quota.pagesUsed < DAILY_PAGE_CAP) {
        const scraped = await firecrawl('/v2/scrape', { url: href, formats: ['markdown'], onlyMainContent: true }, key, fetchImpl, Math.min(8000, remaining(deadline)));
        await remember(href, scraped.data && scraped.data.markdown || '', 'firecrawl');
      }
    } catch (err) {}
  }
  let rssItems = [];
  try {
    const feedUrl = discoverFeed(entryHtml, entryUrl);
    if (feedUrl) rssItems = await readFeed(feedUrl, deadline, fetchText, assertUrl);
  } catch (err) {
    rssItems = [];
  }
  return { ok: true, pages: pages.slice(0, 8), rssItems, quota, entryUrl: pages[0] && pages[0].url || entryUrl };
}

module.exports = {
  crawlSite,
  linkUrl,
  blockedCrawlPath,
  allowedCrawlPath,
  discoverFeed,
  DAILY_PAGE_CAP,
  EXTRA_PAGE_CAP
};
