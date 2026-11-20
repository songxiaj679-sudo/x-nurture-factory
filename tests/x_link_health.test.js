'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { xLinkHealth } = require('../src/x_link_health');

test('stored credentials stay connected until a relink flag or an expired token without refresh', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  assert.equal(xLinkHealth({}).connected, false);
  assert.equal(xLinkHealth({ xOfficialCredentials: { encrypted: 'a' }, twitterRefreshToken: 'keep' }, now).relink, false);
  assert.equal(xLinkHealth({
    xOfficialCredentials: { encrypted: 'a' },
    xLinkStatus: 'relink_required'
  }, now).relink, true);
  assert.equal(xLinkHealth({
    officialApiKey: 'connected',
    officialAccessToken: 'connected',
    twitterAuth: { authType: 'oauth2', oauth2ExpiresAt: '2026-11-17T00:00:00Z' }
  }, now).relink, true);
  assert.equal(xLinkHealth({
    xOfficialCredentials: { encrypted: 'a' },
    twitterAuth: { authType: 'oauth2', oauth2ExpiresAt: '2026-11-17T00:00:00Z', oauth2RefreshToken: 'still-valid' }
  }, now).relink, false);
});
