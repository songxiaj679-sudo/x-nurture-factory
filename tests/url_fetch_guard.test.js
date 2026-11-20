const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isBlockedAddress, assertPublicHttpUrl } = require('../src/url_fetch_guard');

test('internal and link-local addresses are blocked', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1']) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
});

test('public address literals pass and internal URLs do not', async () => {
  const allowed = await assertPublicHttpUrl('https://8.8.8.8/path');
  assert.equal(allowed.hostname, '8.8.8.8');
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1/'), /内部ネットワーク/);
  await assert.rejects(() => assertPublicHttpUrl('http://localhost/admin'), /内部向け/);
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), /公開URLだけ/);
  await assert.rejects(() => assertPublicHttpUrl('https://user:pass@example.com/'), /公開URLだけ/);
});
