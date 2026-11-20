'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { previewFactsFromClaims } = require('../src/luxury_web_funnel');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'views/funnel_index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public/funnel/funnel_client.js'), 'utf8');
const forbidden = /7名|合議|運用レーン|接続枠|接続アカウント|サテライト|凍結リスクゼロ|98\.4%|4\.8x|translate\.google|USDT|バーナー|Zero Suspension|複数アカウント|multiple .*accounts|レーン数|サスペンド|25台|リプライ営業|burner|Quote-RT|googleTranslateElementInit/i;

test('the homepage and its script do not keep retired claims', () => {
  assert.equal(forbidden.test(html), false);
  assert.equal(forbidden.test(client), false);
  assert.equal(html.includes('id="topAuthBtn"'), true);
  assert.equal(html.includes('id="topUnlockBtn"'), true);
  assert.equal(html.includes('id="topDashboardBtn"'), true);
  assert.equal(html.includes('openAuthModal'), true);
  assert.equal(html.includes('openUnlockModal'), true);
  assert.equal(html.includes("choosePlan('starter')"), true);
  assert.equal(html.includes('朝 8:30'), true);
  assert.equal(html.includes('深夜 22:30'), true);
});

test('page facts keep the extracted scene, mechanism, and proof', () => {
  const facts = previewFactsFromClaims([
    { audience: '現場の担当', painScene: '手順が止まる', mechanism: '確認場所を一つに絞る', proofQuote: '最初に見る場所を残す' },
    { audience: '', painScene: '', mechanism: '', proofQuote: '' }
  ]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].claim, '手順が止まる — 確認場所を一つに絞る — 最初に見る場所を残す');
  assert.equal(facts[0].audience, '現場の担当');
});

test('every visible translation key exists in Japanese and English', () => {
  const keys = new Set();
  for (const match of html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) keys.add(match[1]);
  const missing = [];
  for (const key of keys) {
    const count = html.split(`${key}:`).length - 1;
    if (count < 2) missing.push(`${key}:${count}`);
  }
  assert.deepEqual(missing, []);
});
