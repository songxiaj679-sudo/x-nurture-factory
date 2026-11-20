/**
 * src/market_init.js
 * ユーザーまたはアカウントが選択した国 (ispCountry) に応じて
 * ブラウザのタイムゾーン・言語ロケール・ターゲットタグを完全同期するモジュール
 */

const COUNTRY_PROFILES = {
  US: {
    code: 'US',
    lang: 'en',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezone: 'America/New_York',
    westTimezone: 'America/Los_Angeles',
    acceptLanguage: 'en-US,en;q=0.9',
    targetTags: ['#CashAppFriday', '#InstantPayout', '#PersonalLoan', '#OnlyFans', '#OFM', '#Solana', '#Memecoin', '#SideHustle', '#AffiliateMarketing', '#MakeMoneyOnline', '#CryptoAirdrop', '#PassiveIncome']
  },
  JP: {
    code: 'JP',
    lang: 'ja',
    locale: 'ja-JP',
    languages: ['ja-JP', 'ja', 'en-US', 'en'],
    timezone: 'Asia/Tokyo',
    acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    targetTags: ['#個人融資', '#即金', '#即日融資', '#裏バイト', '#スカウト', '#ナイトワーク', '#高収入バイト', '#チャットレディ', '#メンエス求人', '#案件紹介', '#副業探してます']
  },
  GB: {
    code: 'GB',
    lang: 'en',
    locale: 'en-GB',
    languages: ['en-GB', 'en-US', 'en'],
    timezone: 'Europe/London',
    acceptLanguage: 'en-GB,en;q=0.9',
    targetTags: ['#SideHustle', '#PassiveIncome', '#MakeMoneyOnline', '#OnlyFans', '#OFM', '#Solana', '#CryptoUK', '#AffiliateMarketing']
  },
  UK: {
    code: 'GB',
    lang: 'en',
    locale: 'en-GB',
    languages: ['en-GB', 'en-US', 'en'],
    timezone: 'Europe/London',
    acceptLanguage: 'en-GB,en;q=0.9',
    targetTags: ['#SideHustle', '#PassiveIncome', '#MakeMoneyOnline', '#OnlyFans', '#OFM', '#Solana', '#CryptoUK', '#AffiliateMarketing']
  },
  DE: {
    code: 'DE',
    lang: 'de',
    locale: 'de-DE',
    languages: ['de-DE', 'de', 'en-US', 'en'],
    timezone: 'Europe/Berlin',
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
    targetTags: ['#GeldVerdienen', '#PassivesEinkommen', '#Krypto', '#Solana', '#OnlyFans', '#SideHustle', '#AffiliateMarketing']
  },
  FR: {
    code: 'FR',
    lang: 'fr',
    locale: 'fr-FR',
    languages: ['fr-FR', 'fr', 'en-US', 'en'],
    timezone: 'Europe/Paris',
    acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
    targetTags: ['#ArgentEnLigne', '#RevenuPassif', '#CryptoFR', '#Solana', '#OnlyFans', '#SideHustle', '#Affiliation']
  },
  NL: {
    code: 'NL',
    lang: 'en',
    locale: 'nl-NL',
    languages: ['nl-NL', 'nl', 'en-US', 'en'],
    timezone: 'Europe/Amsterdam',
    acceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.8',
    targetTags: ['#CryptoNL', '#PassiveIncome', '#SideHustle', '#Solana', '#OnlyFans', '#AffiliateMarketing']
  },
  CA: {
    code: 'CA',
    lang: 'en',
    locale: 'en-CA',
    languages: ['en-CA', 'en-US', 'en'],
    timezone: 'America/Toronto',
    acceptLanguage: 'en-CA,en-US;q=0.9,en;q=0.8',
    targetTags: ['#CashApp', '#SideHustle', '#PassiveIncome', '#PersonalLoan', '#OnlyFans', '#OFM', '#Solana', '#MakeMoneyOnline']
  },
  AU: {
    code: 'AU',
    lang: 'en',
    locale: 'en-AU',
    languages: ['en-AU', 'en-US', 'en'],
    timezone: 'Australia/Sydney',
    acceptLanguage: 'en-AU,en-US;q=0.9,en;q=0.8',
    targetTags: ['#SideHustle', '#PassiveIncome', '#MakeMoneyOnline', '#OnlyFans', '#OFM', '#Solana', '#CryptoAU']
  },
  SG: {
    code: 'SG',
    lang: 'en',
    locale: 'en-SG',
    languages: ['en-SG', 'en-US', 'en', 'zh-SG'],
    timezone: 'Asia/Singapore',
    acceptLanguage: 'en-SG,en;q=0.9,zh-SG;q=0.8',
    targetTags: ['#CryptoSG', '#Solana', '#Web3', '#PassiveIncome', '#SideHustle', '#AffiliateMarketing', '#MakeMoneyOnline']
  },
  KR: {
    code: 'KR',
    lang: 'ko',
    locale: 'ko-KR',
    languages: ['ko-KR', 'ko', 'en-US', 'en'],
    timezone: 'Asia/Seoul',
    acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8',
    targetTags: ['#부업', '#재테크', '#코인', '#에어드랍', '#수익인증', '#Solana', '#Crypto']
  },
  HK: {
    code: 'HK',
    lang: 'zh',
    locale: 'zh-HK',
    languages: ['zh-HK', 'zh-TW', 'zh-CN', 'en'],
    timezone: 'Asia/Hong_Kong',
    acceptLanguage: 'zh-HK,zh;q=0.9,en;q=0.8',
    targetTags: ['#加密货币', '#空投', '#副业', '#被动收入', '#网赚', '#推特引流', '#Solana']
  },
  TW: {
    code: 'TW',
    lang: 'zh',
    locale: 'zh-TW',
    languages: ['zh-TW', 'zh-HK', 'zh', 'en'],
    timezone: 'Asia/Taipei',
    acceptLanguage: 'zh-TW,zh;q=0.9,en;q=0.8',
    targetTags: ['#加密貨幣', '#空投', '#副業', '#被動收入', '#網賺', '#推特引流', '#Solana']
  }
};

function getCountryProfile(countryCode = 'US') {
  const clean = String(countryCode || 'US').toUpperCase().trim();
  return COUNTRY_PROFILES[clean] || COUNTRY_PROFILES.US;
}

function detectPostLang(text = '') {
  const s = String(text || '');
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(s)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(s)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(s)) return 'zh';
  return 'en';
}

function resolveMarketForCycle(tenantUser = {}, postsList = [], accData = null) {
  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();

  // アカウント個別の国設定 -> ユーザーの選択国 (ispCountry) -> デフォルト 'US' の優先順で決定
  const isBasicTrialOrFree = !tenantUser || !tenantUser.planId || tenantUser.planId === 'free' || tenantUser.planId === 'oneday';
  const isOwner = tenantUser && (tenantUser.isAdmin || ['TG-8401260325', 'USR-MVUA1GLP-D640'].includes(tenantUser.userId));
  let chosenCountry = String((accData && accData.ispCountry) || (tenantUser && tenantUser.ispCountry) || 'US').toUpperCase().trim();

  // フリープラン（管理者以外）は US または JP の2択に制限
  if (isBasicTrialOrFree && !isOwner && !['US', 'JP'].includes(chosenCountry)) {
    chosenCountry = (tenantUser && tenantUser.lang === 'ja') ? 'JP' : 'US';
  }

  const baseProf = getCountryProfile(chosenCountry);
  let activeTimezone = (accData && accData.timezone) || (tenantUser && tenantUser.timezone) || baseProf.timezone;

  // US選択時は時間帯によって東海岸(NY)と西海岸(LA)のアクティブな方を自動適用
  if (baseProf.code === 'US' && (!accData || !accData.timezone)) {
    activeTimezone = (jstHour >= 10 && jstHour <= 16) ? 'America/Los_Angeles' : 'America/New_York';
  }

  return {
    countryCode: baseProf.code,
    lang: baseProf.lang,
    locale: baseProf.locale,
    languages: baseProf.languages,
    timezone: activeTimezone,
    acceptLanguage: baseProf.acceptLanguage,
    targetTags: baseProf.targetTags,
    jstHour,
    candidatePosts: postsList
  };
}

async function applyMarketInitToPage(page, marketCfg) {
  if (!page || !marketCfg) return;
  try {
    await page.emulateTimezone(marketCfg.timezone).catch(() => {});
    await page.setExtraHTTPHeaders({
      'Accept-Language': marketCfg.acceptLanguage
    }).catch(() => {});

    try {
      const client = await page.target().createCDPSession();
      await client.send('Emulation.setTimezoneOverride', { timezoneId: marketCfg.timezone }).catch(() => {});
      await client.send('Emulation.setLocaleOverride', { locale: marketCfg.locale }).catch(() => {});
    } catch (cdpErr) {}

    await page.evaluateOnNewDocument((cfg) => {
      try {
        Object.defineProperty(navigator, 'language', { get: () => cfg.locale, configurable: true });
        Object.defineProperty(navigator, 'languages', { get: () => cfg.languages, configurable: true });
        const OrigDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function(locales, options) {
          const finalLocale = locales || cfg.locale;
          const finalOpts = Object.assign({ timeZone: cfg.timezone }, options || {});
          return new OrigDateTimeFormat(finalLocale, finalOpts);
        };
        Intl.DateTimeFormat.prototype = OrigDateTimeFormat.prototype;
        Intl.DateTimeFormat.supportedLocalesOf = OrigDateTimeFormat.supportedLocalesOf;
      } catch (e) {}
    }, {
      locale: marketCfg.locale,
      languages: marketCfg.languages,
      timezone: marketCfg.timezone
    });
  } catch (e) {}
}

module.exports = {
  COUNTRY_PROFILES,
  getCountryProfile,
  detectPostLang,
  resolveMarketForCycle,
  applyMarketInitToPage
};
