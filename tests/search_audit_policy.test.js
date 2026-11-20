const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canAuditSearchIndex,
  isNewAccountHold,
  searchLangForAccount,
  fromSearchClearsAccount,
  nextClearedAuditDecision,
} = require('../src/search_audit_policy');

test('pure accounts wait 21 days and imported accounts are auditable immediately', () => {
  const young = { originType: 'pure_jp', isNewborn: true, farmingCycles: 20, createdAt: new Date() };
  assert.equal(canAuditSearchIndex(young), false);
  const fifteenDays = {
    originType: 'pure_en',
    isNewborn: true,
    farmingCycles: 40,
    createdAt: new Date(Date.now() - 15 * 86400000),
  };
  assert.equal(canAuditSearchIndex(fifteenDays), false);
  const day21 = {
    originType: 'pure_jp',
    isNewborn: true,
    farmingCycles: 0,
    createdAt: new Date(Date.now() - (21 * 86400000 + 60000)),
  };
  assert.equal(canAuditSearchIndex(day21), true);
  assert.equal(canAuditSearchIndex({ originType: 'imported', farmingCycles: 0, createdAt: new Date() }), true);
  assert.equal(isNewAccountHold(young), true);
  assert.equal(isNewAccountHold(day21), false);
  assert.equal(isNewAccountHold({ originType: 'imported', createdAt: new Date() }), false);
});

test('foreign setup uses signup locale and from: hit can clear', () => {
  const en = { originType: 'pure_en', signupLocale: 'en-GB' };
  assert.equal(searchLangForAccount(en), 'en');
  assert.equal(fromSearchClearsAccount(en), true);
  assert.equal(searchLangForAccount({ originType: 'pure_jp', signupLocale: 'ja-JP' }), 'ja');
  assert.equal(fromSearchClearsAccount({ originType: 'pure_jp', language: 'ja' }), false);
});

test('cleared accounts demote only after two consecutive from: misses', () => {
  const account = { fromMissStreak: 0 };
  assert.equal(nextClearedAuditDecision(account, { cleared: false, level: 'checker_unavailable' }).demote, false);
  assert.equal(nextClearedAuditDecision(account, { cleared: false, level: 'from_only_warming' }).demote, false);
  const once = nextClearedAuditDecision(account, { cleared: false, level: 'from_miss' });
  assert.equal(once.demote, false);
  assert.equal(once.fromMissStreak, 1);
  const twice = nextClearedAuditDecision({ fromMissStreak: 1 }, { cleared: false, level: 'from_miss' });
  assert.equal(twice.demote, true);
  assert.equal(nextClearedAuditDecision({ fromMissStreak: 1 }, { cleared: true, level: 'from_search_verified' }).fromMissStreak, 0);
});
