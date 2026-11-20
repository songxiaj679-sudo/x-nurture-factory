const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getGrowthPhase, trustHandle, trustGoalStatus, operatingPosture } = require('../src/growth_phase');

test('a matching diagnosis still identifies the trust handle', () => {
  const diagnosis = {
    username: 'owner', hasOfficialData: true, followersMeasured: true,
    stage: 'STAGE_1_TRUST_BUILDING', followers: 10
  };
  const user = { xUsername: '@Owner', latestMarketingStrategy: { accountDiagnosis: diagnosis } };
  assert.equal(trustHandle(user, diagnosis), 'owner');
  assert.equal(trustHandle(user, { ...diagnosis, username: 'other' }), null);
});

test('promotion stays off until a page exists and the response is ready or requested', () => {
  const early = { xUsername: 'owner', targetUrl: 'https://example.com', officialFollowerCount: 49, recentMaxImpressions: 67 };
  assert.equal(operatingPosture(early).allowPromo, false);
  assert.equal(getGrowthPhase(early), 'trust');
  assert.match(operatingPosture(early).situation, /49/);
  assert.match(operatingPosture(early).approach, /宣伝リンクは抑え/);

  const steady = { ...early, recentAvgImpressions: 180 };
  assert.equal(getGrowthPhase(steady), 'advanced');
  assert.match(operatingPosture(steady).approach, /【PR】/);

  const personaOnly = { xUsername: 'owner', userPrompt: '検証ログを残す', recentAvgImpressions: 400 };
  assert.equal(getGrowthPhase(personaOnly), 'trust');
  assert.match(operatingPosture(personaOnly).approach, /PRリンクは付けません/);
});

test('an explicit introduction request can mix a marked PR reply when a page is set', () => {
  const user = {
    xUsername: 'owner',
    targetUrl: 'https://example.com',
    userPrompt: '紹介を交ぜてほしい',
    officialFollowerCount: 12
  };
  assert.equal(trustGoalStatus(user).allowPromo, true);
  assert.equal(getGrowthPhase(user), 'advanced');
});

test('an account without a handle cannot be treated as ready for promotion', () => {
  assert.equal(getGrowthPhase({ targetUrl: 'https://example.com', recentAvgImpressions: 500 }), 'unknown');
});

test('a verified authority diagnosis or 100 followers is advanced, and an unmeasured account stays unknown', () => {
  const authority = {
    xUsername: 'owner',
    targetUrl: 'https://example.com',
    latestMarketingStrategy: { accountDiagnosis: {
      username: 'owner', hasOfficialData: true, followersMeasured: true,
      followers: 600, stage: 'STAGE_2_AUTHORITY_ENGAGEMENT'
    } }
  };
  assert.equal(getGrowthPhase(authority), 'advanced');
  assert.equal(getGrowthPhase({ xUsername: 'owner', officialFollowerCount: 100, targetUrl: 'https://example.com' }), 'advanced');
  assert.equal(getGrowthPhase({ xUsername: 'owner', targetUrl: 'https://example.com' }), 'unknown');
  assert.equal(getGrowthPhase({ xUsername: 'owner', targetUrl: 'https://example.com', trustBuildingAccounts: ['owner'], officialFollowerCount: 600 }), 'trust');
});
