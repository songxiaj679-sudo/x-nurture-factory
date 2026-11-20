const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isOperatedOfficialAccount, officialApiOperationAllowed } = require('../src/operated_accounts');

test('only the two Velox accounts stay on the official API', () => {
  assert.equal(isOperatedOfficialAccount({ xUsername: '@VeloxSystemsV4' }), true);
  assert.equal(isOperatedOfficialAccount({ twitterAuth: { username: 'VeloxSystemsHQ' } }), true);
  assert.equal(isOperatedOfficialAccount({ userId: 'USR-MVUA1GLP-D640' }), true);
  assert.equal(isOperatedOfficialAccount({ xUsername: 'some_customer' }), false);
  const previous = process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  try {
    assert.equal(officialApiOperationAllowed({ xUsername: 'some_customer' }), false);
    assert.equal(officialApiOperationAllowed({ xUsername: 'VeloxSystemsV4' }), true);
  } finally {
    if (previous === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previous;
  }
});

test('extra handles and paid customers open only when the env switch says so', () => {
  const closed = { FIRESTORE_EMULATOR_HOST: '' };
  const creds = { oauth2AccessToken: 'token' };
  assert.equal(officialApiOperationAllowed({ xUsername: 'trial_tester' }, creds, closed), false);
  assert.equal(officialApiOperationAllowed(
    { xUsername: '@trial_tester' },
    creds,
    { ...closed, OFFICIAL_API_EXTRA_HANDLES: 'trial_tester' }
  ), true);
  assert.equal(officialApiOperationAllowed(
    { xUsername: 'trial_tester' },
    null,
    { ...closed, OFFICIAL_API_EXTRA_HANDLES: 'trial_tester' }
  ), false);
  const open = { ...closed, OFFICIAL_API_ALLOW_PAID_CUSTOMERS: 'true' };
  assert.equal(officialApiOperationAllowed({ planStatus: 'active', xOfficialCredentials: 'enc', xUsername: 'paid_user' }, null, open), true);
  assert.equal(officialApiOperationAllowed({ planStatus: 'active', xUsername: 'paid_user' }, { apiKey: 'k', apiSecret: 's', accessToken: 't', accessTokenSecret: 'sec' }, open), true);
  assert.equal(officialApiOperationAllowed({ xOfficialCredentials: 'enc', xUsername: 'free_user' }, null, open), false);
  assert.equal(officialApiOperationAllowed({ planId: 'free', planStatus: 'active', xOfficialCredentials: 'enc', xUsername: 'free_user' }, null, open), false);
  assert.equal(officialApiOperationAllowed({ planStatus: 'active', xUsername: 'paid_user' }, null, open), false);
  assert.equal(officialApiOperationAllowed({ planStatus: 'active', originType: 'imported', xOfficialCredentials: 'enc', xUsername: 'paid_user' }, null, open), false);
});
