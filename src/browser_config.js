const path = require('path');
const fs = require('fs');
const _FONTCONFIG_PATH = path.join(__dirname, '..', '.fonts.conf');
if (fs.existsSync(_FONTCONFIG_PATH) && !process.env.FONTCONFIG_FILE) {
  process.env.FONTCONFIG_FILE = _FONTCONFIG_PATH;
}

function getTokenHash(token, salt = '') {
  const str = String(token || 'default') + salt;
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const LOCALE_CONFIG_BY_COUNTRY = {
  jp: {
    country: 'jp',
    locale: 'ja-JP',
    langCookie: 'ja',
    acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    navLanguages: ['ja-JP', 'ja', 'en-US', 'en'],
    timezone: 'Asia/Tokyo'
  },
  us: {
    country: 'us',
    locale: 'en-US',
    langCookie: 'en',
    acceptLanguage: 'en-US,en;q=0.9',
    navLanguages: ['en-US', 'en'],
    timezone: 'America/New_York'
  },
  gb: {
    country: 'gb',
    locale: 'en-GB',
    langCookie: 'en',
    acceptLanguage: 'en-GB,en-US;q=0.9,en;q=0.8',
    navLanguages: ['en-GB', 'en-US', 'en'],
    timezone: 'Europe/London'
  },
  uk: {
    country: 'gb',
    locale: 'en-GB',
    langCookie: 'en',
    acceptLanguage: 'en-GB,en-US;q=0.9,en;q=0.8',
    navLanguages: ['en-GB', 'en-US', 'en'],
    timezone: 'Europe/London'
  },
  ca: {
    country: 'ca',
    locale: 'en-CA',
    langCookie: 'en',
    acceptLanguage: 'en-CA,en-US;q=0.9,en;q=0.8',
    navLanguages: ['en-CA', 'en-US', 'en'],
    timezone: 'America/Toronto'
  },
  au: {
    country: 'au',
    locale: 'en-AU',
    langCookie: 'en',
    acceptLanguage: 'en-AU,en-US;q=0.9,en;q=0.8',
    navLanguages: ['en-AU', 'en-US', 'en'],
    timezone: 'Australia/Sydney'
  }
};

function normalizeCountryCode(raw) {
  const country = String(raw || '').trim().toLowerCase();
  if (country === 'uk') return 'gb';
  if (country === 'japan') return 'jp';
  return country;
}

function isSetupForeignAccount(account) {
  if (!account || typeof account !== 'object') return false;
  const source = String(account.source || '');
  const origin = String(account.originType || '');
  if (source !== 'setup_worker' && origin !== 'pure_en') return false;
  if (origin === 'pure_en') return true;
  const country = normalizeCountryCode(account.signupCountry || account.country || '');
  return !!country && country !== 'jp';
}

function resolveExitCountry(account) {
  if (!isSetupForeignAccount(account)) return 'jp';
  let country = normalizeCountryCode(account.signupCountry || account.country || '');
  if ((!country || country === 'jp') && account.proxy && account.proxy.pass) {
    const match = String(account.proxy.pass).match(/_country-([a-z]{2})/i);
    if (match) country = normalizeCountryCode(match[1]);
  }
  if (!country || country === 'jp') return 'us';
  return country;
}

function readStoredUserAgent(account) {
  if (!account) return '';
  if (typeof account === 'string') return account.trim();
  return String(account.userAgent || (account.deviceProfile && account.deviceProfile.userAgent) || '').trim();
}

function resolveAccountLocaleConfig(accountMeta = {}) {
  if (!accountMeta || typeof accountMeta !== 'object') {
    return LOCALE_CONFIG_BY_COUNTRY.jp;
  }
  let rawCountry = String(accountMeta.signupCountry || accountMeta.country || '').trim().toLowerCase();
  if (!rawCountry && accountMeta.proxy && accountMeta.proxy.pass) {
    const m = String(accountMeta.proxy.pass).match(/_country-([a-z]{2})/i);
    if (m) rawCountry = m[1].toLowerCase();
  }
  if (!rawCountry && accountMeta.originType === 'pure_en') {
    rawCountry = 'us';
  }
  return LOCALE_CONFIG_BY_COUNTRY[rawCountry] || LOCALE_CONFIG_BY_COUNTRY.jp;
}

// 重要: Puppeteer(Chromium)稼働時にFirefoxのUA文字列を被せるとTLS(JA3/JA4)指紋とUAの矛盾で即凍結されるため、
// Chromium上では必ずChromiumの正規UAとClient Hintsに100%統一する（Mac/WinのOS属性のみ引き継ぐ）
function getDeviceProfile(token, existingUA = '', accountMeta = {}) {
  const h1 = getTokenHash(token, 'ua_main');
  const h2 = getTokenHash(token, 'gpu_hw');
  const h3 = getTokenHash(token, 'vp_seed');
  const h4 = getTokenHash(token, 'os_ver');

  const forceMac = !!(accountMeta && (accountMeta.isMac || accountMeta.targetOs === 'macos'));
  const isMacUA = forceMac || /Macintosh|Mac OS X/i.test(String(existingUA || ''));
  const isFirefoxUA = /Firefox\//i.test(String(existingUA || ''));

  const winGpus = [
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)" }
  ];

  const macGpus = [
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" },
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)" },
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" },
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)" },
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)" },
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)" }
  ];

  const chromeBranches = [
    { major: "131", prefix: "131.0.6778" },
    { major: "132", prefix: "132.0.6834" },
    { major: "133", prefix: "133.0.6943" },
    { major: "134", prefix: "134.0.6998" }
  ];
  const branch = chromeBranches[h1 % chromeBranches.length];
  const patch = 10 + (Math.floor(h1 / 97) % 230);
  let ver = `${branch.prefix}.${patch}`;
  let majorStr = branch.major;

  const macPlatVers = ["13.6.7", "14.4.1", "14.5.0", "14.6.1", "15.0.1", "15.1.0"];
  const osObj = isMacUA
    ? { os: "Macintosh; Intel Mac OS X 10_15_7", platform: "MacIntel", chPlatform: "macOS", chPlatVer: macPlatVers[h4 % macPlatVers.length], arch: "arm" }
    : { os: "Windows NT 10.0; Win64; x64", platform: "Win32", chPlatform: "Windows", chPlatVer: "15.0.0", arch: "x86" };

  const chromeUA = `Mozilla/5.0 (${osObj.os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  // 既存UAがFirefoxの場合はTLS矛盾による即凍結を防ぐため、同じOS(MacIntel)の正規Chrome UAへ安全に変換する
  const finalUA = (!existingUA || isFirefoxUA) ? chromeUA : String(existingUA).trim();
  const existingVerMatch = finalUA.match(/Chrome\/((\d+)\.\d+\.\d+\.\d+)/);
  if (existingVerMatch) {
    ver = existingVerMatch[1];
    majorStr = existingVerMatch[2];
  }

  const gpuList = isMacUA ? macGpus : winGpus;
  const gpu = gpuList[h2 % gpuList.length];

  const winViewports = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 }
  ];
  const macViewports = [
    { width: 1920, height: 1080 },
    { width: 1680, height: 1050 },
    { width: 1512, height: 982 },
    { width: 1440, height: 900 }
  ];
  const viewport = isMacUA ? macViewports[h3 % macViewports.length] : winViewports[h3 % winViewports.length];

  const brands = [
    { brand: "Not(A:Brand", version: "99" },
    { brand: "Google Chrome", version: majorStr },
    { brand: "Chromium", version: majorStr }
  ];
  const fullVersionList = [
    { brand: "Not(A:Brand", version: "99.0.0.0" },
    { brand: "Google Chrome", version: ver },
    { brand: "Chromium", version: ver }
  ];

  const cores = isMacUA ? [8, 10, 12][h2 % 3] : [4, 8, 12, 16][h2 % 4];
  const memory = 8;
  const canvasNoise = (h3 % 5) + 1;

  return {
    userAgent: finalUA,
    isMacUA,
    platform: osObj.platform,
    chPlatform: osObj.chPlatform,
    chPlatformVersion: osObj.chPlatVer,
    arch: osObj.arch,
    fullVersion: ver,
    brands,
    fullVersionList,
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    viewport,
    cores,
    memory,
    canvasNoise
  };
}

async function applyDeviceProfile(page, token, customUA = null, accountMeta = {}) {
  const lockedUa = customUA && String(customUA).trim();
  const prof = getDeviceProfile(token, lockedUa || '', accountMeta);
  const finalUA = lockedUa || prof.userAgent;
  const platform = prof.platform;
  const localeCfg = resolveAccountLocaleConfig(accountMeta);

  try {
    const client = await page.target().createCDPSession();
    await client.send('Network.setUserAgentOverride', {
      userAgent: finalUA,
      acceptLanguage: localeCfg.acceptLanguage,
      platform: prof.platform,
      userAgentMetadata: {
        brands: prof.brands,
        fullVersionList: prof.fullVersionList,
        fullVersion: prof.fullVersion,
        platform: prof.chPlatform,
        platformVersion: prof.chPlatformVersion,
        architecture: prof.arch,
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false
      }
    });
  } catch (e) {}

  await page.setViewport(prof.viewport).catch(() => {});
  await page.setExtraHTTPHeaders({ 'Accept-Language': localeCfg.acceptLanguage }).catch(() => {});
  await page.emulateTimezone(localeCfg.timezone).catch(() => {});

  await page.evaluateOnNewDocument((plat, c, m, vendor, renderer, noise, navLang, navLangs) => {
    Object.defineProperty(navigator, 'platform', { get: () => plat });
    Object.defineProperty(navigator, 'language', { get: () => navLang });
    Object.defineProperty(navigator, 'languages', { get: () => navLangs });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => c });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => m });
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });

    Object.defineProperty(Document.prototype, 'hasFocus', { value: () => true, configurable: true });
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });

    const maskNative = (fn, name) => {
      try {
        Object.defineProperty(fn, 'toString', {
          value: () => 'function ' + name + '() { [native code] }',
          configurable: true
        });
      } catch (e) {}
      return fn;
    };

    try {
      const hookGl = (proto) => {
        if (!proto || !proto.getParameter) return;
        const orig = proto.getParameter;
        const wrapped = function getParameter(p) {
          if (p === 37445) return vendor;
          if (p === 37446) return renderer;
          return orig.apply(this, arguments);
        };
        proto.getParameter = maskNative(wrapped, 'getParameter');
      };
      hookGl(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null);
      hookGl(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null);
    } catch (e) {}
  }, platform, prof.cores, prof.memory, prof.webglVendor, prof.webglRenderer, prof.canvasNoise, localeCfg.locale, localeCfg.navLanguages);

  return finalUA;
}

module.exports = {
  getTokenHash,
  getDeviceProfile,
  applyDeviceProfile,
  resolveAccountLocaleConfig,
  normalizeCountryCode,
  isSetupForeignAccount,
  resolveExitCountry,
  readStoredUserAgent,
};
