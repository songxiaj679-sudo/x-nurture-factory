const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { encryptCredentials, decryptCredentials } = require('../src/official_api_client');

test('Syndicate Importer: Encryption and Credential Packaging', () => {
  const sample = {
    apiKey: 'TEST_API_KEY_123',
    apiSecret: 'TEST_API_SECRET_456',
    accessToken: 'TEST_ACCESS_TOKEN_789',
    accessTokenSecret: 'TEST_ACCESS_SECRET_012',
    username: 'syndicate_bot_01',
    lang: 'ja'
  };

  const encrypted = encryptCredentials(sample);
  assert.ok(typeof encrypted === 'object');
  assert.ok(encrypted.encrypted);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.tag);

  const decrypted = decryptCredentials(encrypted);
  assert.equal(decrypted.apiKey, sample.apiKey);
  assert.equal(decrypted.accessToken, sample.accessToken);
  assert.equal(decrypted.username, sample.username);
  assert.equal(decrypted.lang, 'ja');
});
