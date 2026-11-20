'use strict';

const { resolvePlan } = require('./plan_post_budget');

function monthKeyFor(now) {
  return (now instanceof Date ? now : new Date()).toISOString().slice(0, 7);
}

function monthlyLimitsForUser(user = {}, env = process.env) {
  const plan = resolvePlan(user) || 'free';
  const table = {
    free: { llmCalls: Number(env.AI_MONTHLY_CALL_CAP_FREE || 20), crawlPages: 10 },
    starter: { llmCalls: Number(env.AI_MONTHLY_CALL_CAP_STARTER || 140), crawlPages: 40 },
    pro: { llmCalls: Number(env.AI_MONTHLY_CALL_CAP_PRO || 380), crawlPages: 80 },
    business: { llmCalls: Number(env.AI_MONTHLY_CALL_CAP_BUSINESS || 750), crawlPages: 160 }
  };
  return { plan, ...(table[plan] || table.free) };
}

function usageForMonth(user, monthKey) {
  const usage = user && user.aiMonthlyUsage;
  if (!usage || usage.monthKey !== monthKey) {
    return { monthKey, llmCalls: 0, writerCalls: 0, criticCalls: 0, crawlPages: 0 };
  }
  return usage;
}

async function checkTenantAiBudget({ db, userId, user, kind = 'llm', count = 1, now = new Date() } = {}) {
  const monthKey = monthKeyFor(now);
  const open = { allowed: true, degraded: false, remaining: null, limit: null, used: 0, monthKey };
  try {
    let record = user;
    if (!record && db && userId) {
      const snap = await db.collection('saas_users').doc(userId).get();
      record = snap && snap.exists ? (snap.data() || {}) : {};
    }
    const limits = monthlyLimitsForUser(record || {});
    const usage = usageForMonth(record, monthKey);
    const limit = kind === 'crawl' ? limits.crawlPages : limits.llmCalls;
    const used = kind === 'crawl' ? Number(usage.crawlPages || 0) : Number(usage.llmCalls || 0);
    const allowed = used + Number(count || 1) <= limit;
    return { allowed, degraded: !allowed, remaining: Math.max(0, limit - used), limit, used, monthKey };
  } catch (_error) {
    return open;
  }
}

async function recordTenantAiUsage({ db, userId, kind = 'llm', role = 'writer', count = 1, now = new Date() } = {}) {
  if (!db || !userId) return { ok: false, reason: 'missing_db' };
  const monthKey = monthKeyFor(now);
  const amount = Math.max(1, Number(count) || 1);
  try {
    const ref = db.collection('saas_users').doc(userId);
    const write = async (currentUser) => {
      const usage = usageForMonth(currentUser, monthKey);
      const next = {
        monthKey,
        llmCalls: Number(usage.llmCalls || 0),
        writerCalls: Number(usage.writerCalls || 0),
        criticCalls: Number(usage.criticCalls || 0),
        crawlPages: Number(usage.crawlPages || 0),
        updatedAt: now
      };
      if (kind === 'crawl') next.crawlPages += amount;
      else {
        next.llmCalls += amount;
        if (role === 'critic') next.criticCalls += amount;
        else next.writerCalls += amount;
      }
      await ref.set({ aiMonthlyUsage: next }, { merge: true });
      return next;
    };
    if (typeof db.runTransaction === 'function') {
      const next = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap && snap.exists ? (snap.data() || {}) : {};
        const usage = usageForMonth(current, monthKey);
        const nextUsage = {
          monthKey,
          llmCalls: Number(usage.llmCalls || 0),
          writerCalls: Number(usage.writerCalls || 0),
          criticCalls: Number(usage.criticCalls || 0),
          crawlPages: Number(usage.crawlPages || 0),
          updatedAt: now
        };
        if (kind === 'crawl') nextUsage.crawlPages += amount;
        else {
          nextUsage.llmCalls += amount;
          if (role === 'critic') nextUsage.criticCalls += amount;
          else nextUsage.writerCalls += amount;
        }
        tx.set(ref, { aiMonthlyUsage: nextUsage }, { merge: true });
        return nextUsage;
      });
      return { ok: true, usage: next };
    }
    const snap = await ref.get();
    const current = snap && snap.exists ? (snap.data() || {}) : {};
    return { ok: true, usage: await write(current) };
  } catch (_error) {
    return { ok: false, reason: 'write_failed' };
  }
}

async function recordTenantLlmBreakdown({ db, userId, writerCalls = 0, criticCalls = 0, now = new Date() } = {}) {
  const writers = Math.max(0, Number(writerCalls) || 0);
  const critics = Math.max(0, Number(criticCalls) || 0);
  if (!db || !userId || (!writers && !critics)) return { ok: false, reason: 'nothing_to_record' };
  const monthKey = monthKeyFor(now);
  try {
    const ref = db.collection('saas_users').doc(userId);
    const apply = (currentUser) => {
      const usage = usageForMonth(currentUser, monthKey);
      return {
        monthKey,
        llmCalls: Number(usage.llmCalls || 0) + writers + critics,
        writerCalls: Number(usage.writerCalls || 0) + writers,
        criticCalls: Number(usage.criticCalls || 0) + critics,
        crawlPages: Number(usage.crawlPages || 0),
        updatedAt: now
      };
    };
    if (typeof db.runTransaction === 'function') {
      const usage = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = apply(snap && snap.exists ? (snap.data() || {}) : {});
        tx.set(ref, { aiMonthlyUsage: next }, { merge: true });
        return next;
      });
      return { ok: true, usage };
    }
    const snap = await ref.get();
    const usage = apply(snap && snap.exists ? (snap.data() || {}) : {});
    await ref.set({ aiMonthlyUsage: usage }, { merge: true });
    return { ok: true, usage };
  } catch (_error) {
    return { ok: false, reason: 'write_failed' };
  }
}

function clipDegradedSentence(text, max) {
  const clean = String(text || '').replace(/[ \t]+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const end = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('。'));
  if (end >= Math.floor(max * 0.45)) return slice.slice(0, end + 1).trim();
  const word = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  if (word >= Math.floor(max * 0.5)) return slice.slice(0, word).trim();
  return slice.trim();
}

function degradedPostText(playbook = {}, options = {}) {
  const lang = String(options.lang || '').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const maxChars = Math.max(80, Math.min(450, Number(options.maxChars) || (lang === 'en' ? 280 : 140)));
  const topic = String(playbook.topic || '').trim();
  const situation = String(playbook.readerSituation || '').trim();
  const check = String(playbook.checkCriteria || '').trim();
  const boundary = String(playbook.boundaryCondition || '').trim();
  const parts = [topic, situation, check, boundary].filter(Boolean);
  const joined = parts.join(lang === 'en' ? '\n\n' : '\n\n');
  let text = clipDegradedSentence(joined, maxChars);
  if (text.length < 80) {
    const pad = lang === 'en'
      ? 'Before the next post is queued, compare each claim with the saved page and leave out anything that page does not state.'
      : '次の投稿を予約する前に、本文の主張が登録ページの文と一致しているかを見て、ページに無い体験は足さない。';
    text = clipDegradedSentence([text, pad].filter(Boolean).join('\n\n'), maxChars);
  }
  return text;
}

function reviewDegradedDraft(text, context = {}) {
  const { inspectPostCompliance } = require('./post_policy_guard');
  const { runDeterministicAudit } = require('./draft_verifier');
  const tweets = [String(text || '')];
  const compliance = inspectPostCompliance(tweets, {
    lang: context.lang,
    isPromotion: Boolean(context.portfolioPlan && context.portfolioPlan.allowPromoUrl)
  });
  const audit = runDeterministicAudit({ tweets }, context);
  return { ok: compliance.canAutoPost === true && audit.ok === true, reasons: audit.reasons || [], compliance };
}

function usageSummary(user, now = new Date()) {
  const monthKey = monthKeyFor(now);
  const limits = monthlyLimitsForUser(user || {});
  const usage = usageForMonth(user, monthKey);
  return {
    used: Number(usage.llmCalls || 0),
    crawlPages: Number(usage.crawlPages || 0),
    limit: limits.llmCalls,
    crawlLimit: limits.crawlPages,
    monthKey,
    degraded: Number(usage.llmCalls || 0) >= limits.llmCalls
  };
}

module.exports = {
  monthlyLimitsForUser,
  checkTenantAiBudget,
  recordTenantAiUsage,
  usageSummary,
  degradedPostText,
  reviewDegradedDraft,
  recordTenantLlmBreakdown
};
