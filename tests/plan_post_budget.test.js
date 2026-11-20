'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePlan, slotsForPlan, nextPlanSlot, isPaidAccount } = require('../src/plan_post_budget');

function slotAt(hours) {
  return (slot, dayOffset) => {
    const map = { morning: 8.5, noon: 12.5, afternoon: 17.5, evening: 20, night: 22.5 };
    const base = new Date('2026-11-18T00:00:00Z');
    return new Date(base.getTime() + ((map[slot] + dayOffset * 24) * 60 - 0) * 60 * 1000);
  };
}

test('plan caps match starter, pro, and business', () => {
  assert.deepEqual(slotsForPlan('starter'), ['morning']);
  assert.deepEqual(slotsForPlan('pro'), ['morning', 'noon', 'evening']);
  assert.deepEqual(slotsForPlan('business'), ['morning', 'noon', 'afternoon', 'evening', 'night']);
  assert.equal(resolvePlan({ planId: 'starter' }), 'starter');
  assert.equal(resolvePlan({ tierLevel: 3 }), 'business');
  assert.equal(resolvePlan({ planId: 'pro' }), 'pro');
});

test('next slot skips taken and past slots, then the first slot tomorrow', () => {
  const now = slotAt()('morning', 0);
  now.setTime(now.getTime() + 60 * 60 * 1000);
  const next = nextPlanSlot({
    plan: 'pro',
    takenSlots: ['morning'],
    now,
    slotAt: slotAt()
  });
  assert.deepEqual(next, { timeSlot: 'noon', dayOffset: 0 });

  const late = slotAt()('night', 0);
  const tomorrow = nextPlanSlot({
    plan: 'starter',
    takenSlots: [],
    now: late,
    slotAt: slotAt()
  });
  assert.deepEqual(tomorrow, { timeSlot: 'morning', dayOffset: 1 });

  const full = nextPlanSlot({
    plan: 'pro',
    takenSlots: ['morning', 'noon', 'evening'],
    now,
    slotAt: slotAt()
  });
  assert.equal(full, null);
});

test('isPaidAccount rejects free planId even when planStatus is active', () => {
  assert.equal(isPaidAccount({ planId: 'free', planStatus: 'active', tierLevel: 0 }), false);
  assert.equal(isPaidAccount({ planId: 'free_trial', planStatus: 'active' }), false);
  assert.equal(isPaidAccount({ planId: 'free', planStatus: 'free' }), false);
  assert.equal(isPaidAccount({ planId: 'starter', planStatus: 'active' }), true);
  assert.equal(isPaidAccount({ tierLevel: 1 }), true);
  assert.equal(isPaidAccount({ planStatus: 'cancelled', tierLevel: 2, planId: 'pro' }), false);
  assert.equal(isPaidAccount({ planStatus: 'active', tierLevel: 2, stripeSubscriptionStatus: 'unpaid' }), false);
  assert.equal(isPaidAccount({ planStatus: 'active', tierLevel: 2, stripeSubscriptionStatus: 'incomplete_expired' }), false);
});
