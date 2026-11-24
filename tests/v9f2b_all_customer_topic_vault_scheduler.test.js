'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { topicVaultEligibility, runTopicSourceVaultSweep, WEEKLY_ARTICLE_CAP, MIN_GAP_MS } = require('../src/topic_source_vault');

const now = new Date('2026-11-21T04:00:00.000Z');
const day = 24 * 60 * 60 * 1000;

function user(extra = {}) {
  return {
    targetUrl: 'https://customer.example/home',
    brandKnowledge: { icpSummary: '店主', domainProblems: ['紙が古い'] },
    ...extra
  };
}

test('weekly caps and gaps follow the plan', () => {
  assert.deepEqual(WEEKLY_ARTICLE_CAP, { free: 1, starter: 2, pro: 3, business: 7 });
  assert.equal(MIN_GAP_MS.free, 7 * day);
  assert.equal(MIN_GAP_MS.starter, 3.5 * day);
  assert.equal(MIN_GAP_MS.pro, 2.3 * day);
  assert.equal(MIN_GAP_MS.business, 2.3 * day);
  assert.equal(topicVaultEligibility({ user: user(), cards: [], now }).ok, true);
  const recent = [{ fetchedAt: new Date(now.getTime() - 4 * day).toISOString(), usedCount: 1 }];
  const yesterday = [{ fetchedAt: new Date(now.getTime() - day).toISOString(), usedCount: 1, plainTranslation: '入口の紙は遅れる。' }];
  assert.equal(topicVaultEligibility({ user: user({ planId: 'starter' }), cards: recent, now }).reason, 'ready');
  assert.equal(topicVaultEligibility({ user: user({ planId: 'starter' }), cards: yesterday, now }).reason, 'ready');
  assert.equal(topicVaultEligibility({ user: user(), cards: yesterday, now }).reason, 'weekly_cap');
  const three = [1, 2, 3].map(index => ({ fetchedAt: new Date(now.getTime() - index * day).toISOString(), usedCount: 1, plainTranslation: '入口の紙は遅れる。' }));
  assert.equal(topicVaultEligibility({ user: user({ planId: 'pro' }), cards: three, now }).reason, 'weekly_cap');
});

test('a full unused pile, a paused account, and a denied budget are skipped', () => {
  const unused = Array.from({ length: 6 }, () => ({ fetchedAt: new Date(now.getTime() - 20 * day).toISOString(), usedCount: 0 }));
  assert.equal(topicVaultEligibility({ user: user(), cards: unused, now }).reason, 'unused_full');
  assert.equal(topicVaultEligibility({ user: user({ autopilotPaused: true }), cards: [], now }).reason, 'inactive');
  assert.equal(topicVaultEligibility({ user: user({ planStatus: 'cancelled' }), cards: [], now }).reason, 'cancelled');
  assert.equal(topicVaultEligibility({ user: user(), cards: [], now, budgetAllowed: false }).reason, 'budget');
});

test('one sweep collects at most three customers', async () => {
  const docs = ['a', 'b', 'c', 'd', 'e'].map(id => ({
    id,
    data: () => user()
  }));
  const collected = [];
  const result = await runTopicSourceVaultSweep(null, {
    now,
    listUsers: async () => ({ docs }),
    loadCards: async () => [],
    budgetAllowed: async () => true,
    collect: async ({ userId }) => {
      collected.push(userId);
      return { sourceId: userId };
    }
  });
  assert.deepEqual(collected, ['a', 'b', 'c']);
  assert.equal(result.collected, 3);
  assert.equal(result.scanned, 3);
});

test('the query shifts to the reader job and names the scene in the card', () => {
  const source = fs.readFileSync('src/topic_source_vault.js', 'utf8');
  assert.match(source, /読者の本業の課題へ一段ずらす/);
  assert.match(source, /ツール自体の自作・開発・自動化スクリプト実装記は除外する/);
  assert.match(source, /productName や実装用語では検索しない/);
  assert.match(source, /coreFact の冒頭は、どの場面の何の仕組みの話かが一読でわかる主語から始める/);
  const routes = fs.readFileSync('src/hybrid_saas_routes.js', 'utf8');
  assert.match(routes, /runTopicSourceVaultSweep\(db\)/);
  assert.match(routes, /5 \* 60 \* 1000/);
  assert.match(routes, /3 \* 60 \* 60 \* 1000/);
});
