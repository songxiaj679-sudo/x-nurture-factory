const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scheduleSubscriptionCancellation, subscriptionStatePatch } = require('../src/billing_cancel');

test('one button schedules cancellation at the period end and records the end date', async () => {
  const stripe = {
    subscriptions: {
      async update(id, body) {
        assert.equal(id, 'sub_trial');
        assert.deepEqual(body, { cancel_at_period_end: true });
        return { id, current_period_end: 1_800_000_000, cancel_at_period_end: true };
      }
    }
  };
  const patch = await scheduleSubscriptionCancellation(stripe, { stripeSubscriptionId: 'sub_trial' });
  assert.equal(patch.cancelAtPeriodEnd, true);
  assert.equal(patch.stripeSubscriptionId, 'sub_trial');
  assert.equal(patch.billingEndsAt.toISOString(), new Date(1_800_000_000 * 1000).toISOString());
  assert.ok(patch.subscriptionCancelledAt instanceof Date);
});

test('a missing subscription id is recovered from the customer or email', async () => {
  const stripe = {
    customers: { async list() { return { data: [{ id: 'cus_mail' }] }; } },
    subscriptions: {
      async list(query) {
        assert.equal(query.customer, 'cus_mail');
        return { data: [{ id: 'sub_found', status: 'trialing' }] };
      },
      async update(id) {
        return { id, current_period_end: 1_800_000_100, cancel_at_period_end: true };
      }
    }
  };
  const patch = await scheduleSubscriptionCancellation(stripe, { email: 'owner@example.com' });
  assert.equal(patch.stripeSubscriptionId, 'sub_found');
});

test('subscription webhooks sync cancellation and deletion', () => {
  const updated = subscriptionStatePatch({ id: 'sub_1', customer: 'cus_1', cancel_at_period_end: true, current_period_end: 1_800_000_200, status: 'trialing', trial_end: 1_800_000_400 }, 'customer.subscription.updated');
  assert.equal(updated.cancelAtPeriodEnd, true);
  assert.equal(updated.planStatus, undefined);
  assert.equal(updated.stripeSubscriptionStatus, 'trialing');
  assert.equal(updated.stripeSubscriptionTrialEnd.toISOString(), new Date(1_800_000_400 * 1000).toISOString());
  const deleted = subscriptionStatePatch({ id: 'sub_1', status: 'canceled', current_period_end: 1_800_000_300 }, 'customer.subscription.deleted');
  assert.equal(deleted.planStatus, 'cancelled');
  assert.equal(deleted.cancelAtPeriodEnd, true);
  assert.equal(deleted.tierLevel, 0);
  assert.equal(deleted.planId, 'free');
  assert.equal(deleted.aiReplyUnlocked, false);
  const unpaid = subscriptionStatePatch({ id: 'sub_2', status: 'unpaid' }, 'customer.subscription.updated');
  assert.equal(unpaid.planStatus, 'cancelled');
  assert.equal(unpaid.tierLevel, 0);
  assert.equal(unpaid.planId, 'free');
  assert.equal(unpaid.aiReplyUnlocked, false);
});
