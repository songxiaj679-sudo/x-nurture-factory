const { test } = require('node:test');
const assert = require('node:assert/strict');

let user;
const db = {
  collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => user }) }) })
};
const file = require.resolve('../src/firestore');
require.cache[file] = { id: file, filename: file, loaded: true, exports: { db } };
const { runOfficialAutonomousEngagement, registerBoostCampaign } = require('../src/official_api_client');
const { performHumanBoostAction } = require('../src/hybrid_boost_manager');
const { runNurtureAndOfficialSupportCycle, runProspectOutreachCycle } = require('../src/reply_promo_engine');
const { executeAutoPinBillboardPost, executeInterleavedOutreachCycle } = require('../src/saas_outreach_worker');
const { runFreeLiveBrowserTestV3, executeSafeStealthDeleteTweet, diagnoseBurnerAccountHealthV3 } = require('../src/v3_post_executor');
const { executeInstantFreeTestPost } = require('../src/v3_live_tester');
const { runClearedMentorAssistCycle } = require('../src/mentor_assist');

test('automatic replies and follows remain disabled without X approval', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected X request'); };
  try {
    for (const data of [
      { xUsername: 'owner', trustBuildingAccounts: ['owner'] },
      { xUsername: 'owner' },
      { xUsername: 'owner', latestMarketingStrategy: { accountDiagnosis: {
        username: 'owner', hasOfficialData: true, followersMeasured: true, followers: 600,
        stage: 'STAGE_2_AUTHORITY_ENGAGEMENT'
      } } }
    ]) {
      user = data;
      const result = await runOfficialAutonomousEngagement('owner');
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'x_approval_required');
      assert.equal(calls, 0);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('browser automation entry points are exported and callable', () => {
  for (const action of [
    runProspectOutreachCycle, executeAutoPinBillboardPost, executeInterleavedOutreachCycle,
    runFreeLiveBrowserTestV3, executeSafeStealthDeleteTweet, diagnoseBurnerAccountHealthV3,
    executeInstantFreeTestPost, runClearedMentorAssistCycle
  ]) {
    assert.equal(typeof action, 'function');
  }
});

test('support actions are exported and callable', () => {
  assert.equal(typeof registerBoostCampaign, 'function');
  assert.equal(typeof performHumanBoostAction, 'function');
  assert.equal(typeof runNurtureAndOfficialSupportCycle, 'function');
});
