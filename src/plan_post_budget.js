'use strict';

const PLAN_SLOTS = {
  starter: ['morning'],
  pro: ['morning', 'noon', 'evening'],
  business: ['morning', 'noon', 'afternoon', 'evening', 'night']
};

function resolvePlan(user = {}) {
  if (Number(user.tierLevel) >= 3 || user.planId === 'business' || user.planId === 'syndicate_business') return 'business';
  if (Number(user.tierLevel) === 1 || user.planId === 'starter') return 'starter';
  if (user.planId === 'pro' || Number(user.tierLevel) === 2) return 'pro';
  return null;
}

function isPaidAccount(user = {}) {
  if (!user) return false;
  const status = String(user.planStatus || '').toLowerCase();
  const stripeStatus = String(user.stripeSubscriptionStatus || '').toLowerCase();
  if (status === 'cancelled' || status === 'free') return false;
  if (stripeStatus === 'canceled' || stripeStatus === 'unpaid' || stripeStatus === 'incomplete_expired') return false;
  if (Number(user.tierLevel) >= 1) return true;
  return status === 'active' && user.planId !== 'free' && user.planId !== 'free_trial';
}

function slotsForPlan(plan, userOrCap = null) {
  const base = PLAN_SLOTS[plan] ? PLAN_SLOTS[plan].slice() : [];
  const rawCap = typeof userOrCap === 'number'
    ? userOrCap
    : (userOrCap && userOrCap.maxPostsPerDay != null ? Number(userOrCap.maxPostsPerDay) : NaN);
  if (Number.isInteger(rawCap) && rawCap >= 1) return base.slice(0, rawCap);
  return base;
}

function localDateKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function nextPlanSlot({ plan, takenSlots = [], now = new Date(), slotAt, maxPostsPerDay = null }) {
  const slots = slotsForPlan(plan, maxPostsPerDay);
  if (slots.length === 0 || typeof slotAt !== 'function') return null;
  const taken = new Set(takenSlots.filter(slot => slots.includes(slot)));
  if (taken.size >= slots.length) return null;
  const upcoming = slots.find(slot => {
    if (taken.has(slot)) return false;
    const at = slotAt(slot, 0);
    return at instanceof Date && !Number.isNaN(at.getTime()) && at.getTime() > now.getTime() + 15 * 60 * 1000;
  });
  if (upcoming) return { timeSlot: upcoming, dayOffset: 0 };
  return { timeSlot: slots[0], dayOffset: 1 };
}

function nextTomorrowFirstSlot(now = new Date(), timeZone = 'Asia/Tokyo', plan) {
  const slots = slotsForPlan(plan);
  if (!slots.length) return null;
  const zone = timeZone || 'Asia/Tokyo';
  const today = localDateKey(now, zone);
  let cursor = new Date(now.getTime());
  let tomorrow = today;
  for (let step = 0; step < 40 && tomorrow === today; step += 1) {
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    tomorrow = localDateKey(cursor, zone);
  }
  if (tomorrow === today) return null;
  return { timeSlot: slots[0], dayOffset: 1, localDate: tomorrow };
}

function reserveAfterDailyCap({ next, pendingCount = 0, plan, now = new Date(), timeZone = 'Asia/Tokyo' } = {}) {
  if (Number(pendingCount) > 0) return null;
  if (next) return { timeSlot: next.timeSlot, dayOffset: next.dayOffset || 0 };
  return nextTomorrowFirstSlot(now, timeZone, plan);
}

module.exports = {
  PLAN_SLOTS,
  resolvePlan,
  isPaidAccount,
  slotsForPlan,
  localDateKey,
  nextPlanSlot,
  nextTomorrowFirstSlot,
  reserveAfterDailyCap
};
