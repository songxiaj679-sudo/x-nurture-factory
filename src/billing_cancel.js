async function resolveSubscriptionId(stripe, user = {}) {
  if (user.stripeSubscriptionId) return String(user.stripeSubscriptionId);
  let customerId = user.stripeCustomerId ? String(user.stripeCustomerId) : '';
  if (!customerId && user.email && stripe.customers && stripe.customers.list) {
    const customers = await stripe.customers.list({ email: String(user.email), limit: 1 });
    customerId = customers && customers.data && customers.data[0] ? customers.data[0].id : '';
  }
  if (!customerId || !stripe.subscriptions || !stripe.subscriptions.list) return '';
  const listed = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  const rows = (listed && listed.data) || [];
  const current = rows.find(row => ['active', 'trialing', 'past_due'].includes(row.status)) || rows[0];
  return current && current.id ? current.id : '';
}

async function scheduleSubscriptionCancellation(stripe, user = {}) {
  if (!stripe || !stripe.subscriptions || !stripe.subscriptions.update) {
    throw new Error('Stripe is not configured');
  }
  const subscriptionId = await resolveSubscriptionId(stripe, user);
  if (!subscriptionId) {
    const error = new Error('有効な購読が見つかりません。');
    error.statusCode = 404;
    throw error;
  }
  const updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  const periodEnd = updated && updated.current_period_end ? new Date(updated.current_period_end * 1000) : null;
  return {
    stripeSubscriptionId: subscriptionId,
    cancelAtPeriodEnd: true,
    subscriptionCancelledAt: new Date(),
    billingEndsAt: periodEnd,
    updatedAt: new Date()
  };
}

function subscriptionStatePatch(subscription, eventType) {
  const status = String(subscription.status || '').toLowerCase();
  const deleted = eventType === 'customer.subscription.deleted' || status === 'canceled';
  const terminated = deleted || ['canceled', 'unpaid', 'incomplete_expired'].includes(status);
  const patch = {
    stripeSubscriptionId: subscription.id || '',
    cancelAtPeriodEnd: deleted ? true : Boolean(subscription.cancel_at_period_end),
    billingEndsAt: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
    stripeSubscriptionStatus: subscription.status || '',
    stripeSubscriptionTrialEnd: subscription.trial_end ? new Date(Number(subscription.trial_end) * 1000) : null,
    updatedAt: new Date()
  };
  if (terminated) {
    patch.planStatus = 'cancelled';
    patch.tierLevel = 0;
    patch.planId = 'free';
    patch.aiReplyUnlocked = false;
  }
  if (subscription.customer) patch.stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : (subscription.customer.id || '');
  return patch;
}

module.exports = { resolveSubscriptionId, scheduleSubscriptionCancellation, subscriptionStatePatch };
