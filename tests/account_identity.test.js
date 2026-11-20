const test = require('node:test');
const assert = require('node:assert/strict');
const { isSetupForeignAccount, resolveExitCountry, readStoredUserAgent } = require('../src/browser_config');
const { getResidentialProxyForAccount } = require('../src/iproyal');

test('imported and Japanese setup accounts exit via Japan', () => {
  assert.equal(resolveExitCountry({ source: 'imported', signupCountry: 'us' }), 'jp');
  assert.equal(resolveExitCountry({ source: 'setup_worker', originType: 'pure_jp', signupCountry: 'jp' }), 'jp');
  assert.equal(isSetupForeignAccount({ source: 'setup_worker', originType: 'pure_jp', signupCountry: 'jp' }), false);
});

test('setup foreign accounts keep signup country', () => {
  const gb = { source: 'setup_worker', originType: 'pure_en', signupCountry: 'gb' };
  assert.equal(isSetupForeignAccount(gb), true);
  assert.equal(resolveExitCountry(gb), 'gb');
  assert.equal(resolveExitCountry({ originType: 'pure_en', signupCountry: 'uk' }), 'gb');
  assert.equal(resolveExitCountry({ originType: 'pure_en', signupCountry: 'ca' }), 'ca');
});

test('stored proxy is reused only when its country matches', () => {
  const account = {
    originType: 'pure_en',
    signupCountry: 'au',
    proxy: {
      host: 'geo.iproyal.com',
      port: '12321',
      user: 'user',
      pass: 'secret_country-au_session-auabc123_lifetime-168h'
    }
  };
  assert.equal(getResidentialProxyForAccount('tok', account).pass, account.proxy.pass);

  const japan = getResidentialProxyForAccount('tok', {
    source: 'imported',
    proxy: account.proxy
  });
  assert.match(japan.pass, /_country-jp/);
  assert.doesNotMatch(japan.pass, /_country-au/);
});

test('stored user agent string is returned unchanged', () => {
  assert.equal(readStoredUserAgent({ userAgent: 'UA-KEEP' }), 'UA-KEEP');
  assert.equal(readStoredUserAgent({ deviceProfile: { userAgent: 'UA-PROFILE' } }), 'UA-PROFILE');
});
