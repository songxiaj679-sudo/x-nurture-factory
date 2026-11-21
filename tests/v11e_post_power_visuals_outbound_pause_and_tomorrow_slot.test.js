'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { planMythVsRealityCard, planVisualCard, cardMarkup, renderGroundedCard } = require('../src/visual_card');
const { nextPlanSlot, nextTomorrowFirstSlot, reserveAfterDailyCap } = require('../src/plan_post_budget');
const { candidatePrompt, criticSystemRules } = require('../src/next_post_draft');

test('the myth card renders beside the existing templates and keeps the media gate', () => {
  const previous = process.env.X_MEDIA_WRITE_ENABLED;
  try {
    delete process.env.X_MEDIA_WRITE_ENABLED;
    const plan = planMythVsRealityCard({
      lang: 'ja',
      coreFact: '入口の紙を先に見る',
      editorialStance: { rejectedNorm: '予定表だけを信じれば足りる', coreBelief: '休みの変更は入口の紙で先に確認する' },
      contrasts: ['紙が古いか', '予定と紙が違うか', 'https://example.com/secret']
    });
    assert.equal(plan.template, 'myth_vs_reality_card');
    assert.equal(plan.reason, 'media_write_not_enabled');
    assert.equal(JSON.stringify(plan).includes('http'), false);
    process.env.X_MEDIA_WRITE_ENABLED = 'true';
    assert.equal(planMythVsRealityCard({
      lang: 'ja',
      coreFact: '入口の紙',
      editorialStance: { rejectedNorm: '予定表だけで足りる', coreBelief: '入口の紙を先に見る' },
      contrasts: ['紙の日付']
    }).reason, 'ready');
    const markup = cardMarkup(plan);
    assert.equal(markup.props.children[1].props.children.some(node => Array.isArray(node.props.children) && node.props.children.some(row => String(row.props.children).includes('紙が古いか'))), true);
    const svg = renderGroundedCard(plan);
    assert.match(svg, /<svg/);
    assert.match(svg, /&amp;|&lt;|入口の紙|予定表/);
    const existing = planVisualCard({
      portfolioRole: 'utility_save',
      archetype: 'before_after_rewrite',
      isolateLpContext: true,
      focusTopic: { topic: '入口', weakExample: '予定表だけを見る', strongExample: '入口の紙を先に見る', whyItWorks: '来店前に分かる' },
      lang: 'ja'
    });
    assert.equal(existing.template, 'before_after_card');
    assert.equal(existing.reason, 'ready');
  } finally {
    if (previous === undefined) delete process.env.X_MEDIA_WRITE_ENABLED;
    else process.env.X_MEDIA_WRITE_ENABLED = previous;
  }
});

test('approve send can pause without touching discovery or inbound replies', () => {
  const source = fs.readFileSync('src/hybrid_saas_routes.js', 'utf8');
  const start = source.indexOf("app.post('/api/autopilot/outbound-replies/:tweetId/approve'");
  const end = source.indexOf("app.get('/api/autopilot/jobs/:jobId/visual-card.png'");
  const handler = source.slice(start, end);
  assert.match(handler, /X_OUTBOUND_REPLY_SEND_ENABLED/);
  assert.match(handler, /outbound_reply_send_paused/);
  assert.equal(handler.includes('processInboundAutoReplies'), false);
  assert.equal(source.indexOf('X_OUTBOUND_REPLY_DISCOVERY') < start, true);
  assert.equal(criticSystemRules(false).length < 400, true);
});

test('tomorrow is reserved only after the day is full and the queue is empty', () => {
  const now = new Date('2026-11-21T10:00:00.000Z');
  const slotAt = () => new Date('2026-11-21T00:00:00.000Z');
  assert.equal(nextPlanSlot({ plan: 'pro', takenSlots: ['morning', 'noon', 'evening'], now, slotAt }), null);
  const tomorrow = nextTomorrowFirstSlot(now, 'Asia/Tokyo', 'pro');
  assert.equal(tomorrow.timeSlot, 'morning');
  assert.equal(tomorrow.dayOffset, 1);
  assert.equal(tomorrow.localDate, '2026-11-22');
  assert.equal(reserveAfterDailyCap({ next: null, pendingCount: 0, plan: 'pro', now, timeZone: 'Asia/Tokyo' }).timeSlot, 'morning');
  assert.equal(reserveAfterDailyCap({ next: null, pendingCount: 1, plan: 'pro', now, timeZone: 'Asia/Tokyo' }), null);
  assert.deepEqual(reserveAfterDailyCap({ next: { timeSlot: 'noon', dayOffset: 0 }, pendingCount: 0, plan: 'pro', now, timeZone: 'Asia/Tokyo' }), { timeSlot: 'noon', dayOffset: 0 });
  const craft = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { count: 1, maxCount: 1 },
    accountState: { maxChars: 140, delivery: 'single' },
    genes: { delivery: 'single' },
    masterPlan: { topicRing: 'ring1_craft' }
  });
  assert.match(craft, /1つの気づきをまっすぐ語る/);
  const bridge = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { count: 1, maxCount: 1 },
    accountState: { maxChars: 140, delivery: 'single' },
    genes: { delivery: 'single' },
    masterPlan: { topicRing: 'ring3_product_bridge' }
  });
  assert.equal(bridge.includes('いいねやコメントの依頼'), false);
});
