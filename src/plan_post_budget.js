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

function slotsForPlan(plan) {
  return PLAN_SLOTS[plan] ? PLAN_SLOTS[plan].slice() : [];
}

function localDateKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function nextPlanSlot({ plan, takenSlots = [], now = new Date(), slotAt }) {
  const slots = slotsForPlan(plan);
  if (slots.length === 0 || typeof slotAt !== 'function') return null;
  const taken = new Set(takenSlots.filter(slot => slots.includes(slot)));
  const upcoming = slots.find(slot => {
    if (taken.has(slot)) return false;
    const at = slotAt(slot, 0);
    return at instanceof Date && !Number.isNaN(at.getTime()) && at.getTime() > now.getTime() + 15 * 60 * 1000;
  });
  if (upcoming) return { timeSlot: upcoming, dayOffset: 0 };
  if (taken.size >= slots.length) return null;
  return { timeSlot: slots[0], dayOffset: 1 };
}

module.exports = {
  PLAN_SLOTS,
  resolvePlan,
  isPaidAccount,
  slotsForPlan,
  localDateKey,
  nextPlanSlot
};
