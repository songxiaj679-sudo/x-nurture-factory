require('dotenv').config();
const https = require('https');

const FIVESIM_API_KEY = (process.env.FIVESIM_API_KEY || '').trim();
const SMSPOOL_API_KEY = (process.env.SMSPOOL_API_KEY || '').trim();

const MAX_5SIM_COST_RUB = 65.0;
const MAX_SMSPOOL_COST_USD = 0.65;

const GLOBAL_COUNTRY_META = {
  unitedstates: { iso: 'us', spCountry: 'US', tz: 'America/New_York',                dial: '+1',   nameJa: 'アメリカ',       nameEn: 'United States' },
  england:      { iso: 'gb', spCountry: 'GB', tz: 'Europe/London',                  dial: '+44',  nameJa: 'イギリス',       nameEn: 'United Kingdom' },
  netherlands:  { iso: 'nl', spCountry: 'NL', tz: 'Europe/Amsterdam',               dial: '+31',  nameJa: 'オランダ',       nameEn: 'Netherlands' },
  brazil:       { iso: 'br', spCountry: 'BR', tz: 'America/Sao_Paulo',              dial: '+55',  nameJa: 'ブラジル',       nameEn: 'Brazil' },
  indonesia:    { iso: 'id', spCountry: 'ID', tz: 'Asia/Jakarta',                   dial: '+62',  nameJa: 'インドネシア',   nameEn: 'Indonesia' },
  philippines:  { iso: 'ph', spCountry: 'PH', tz: 'Asia/Manila',                    dial: '+63',  nameJa: 'フィリピン',     nameEn: 'Philippines' },
  colombia:     { iso: 'co', spCountry: 'CO', tz: 'America/Bogota',                 dial: '+57',  nameJa: 'コロンビア',     nameEn: 'Colombia' },
  mexico:       { iso: 'mx', spCountry: 'MX', tz: 'America/Mexico_City',            dial: '+52',  nameJa: 'メキシコ',       nameEn: 'Mexico' },
  thailand:     { iso: 'th', spCountry: 'TH', tz: 'Asia/Bangkok',                   dial: '+66',  nameJa: 'タイ',           nameEn: 'Thailand' },
  poland:       { iso: 'pl', spCountry: 'PL', tz: 'Europe/Warsaw',                  dial: '+48',  nameJa: 'ポーランド',     nameEn: 'Poland' },
  malaysia:     { iso: 'my', spCountry: 'MY', tz: 'Asia/Kuala_Lumpur',              dial: '+60',  nameJa: 'マレーシア',     nameEn: 'Malaysia' },
  vietnam:      { iso: 'vn', spCountry: 'VN', tz: 'Asia/Ho_Chi_Minh',               dial: '+84',  nameJa: 'ベトナム',       nameEn: 'Vietnam' },
  argentina:    { iso: 'ar', spCountry: 'AR', tz: 'America/Argentina/Buenos_Aires', dial: '+54',  nameJa: 'アルゼンチン',   nameEn: 'Argentina' },
  chile:        { iso: 'cl', spCountry: 'CL', tz: 'America/Santiago',               dial: '+56',  nameJa: 'チリ',           nameEn: 'Chile' },
  peru:         { iso: 'pe', spCountry: 'PE', tz: 'America/Lima',                   dial: '+51',  nameJa: 'ペルー',         nameEn: 'Peru' },
  romania:      { iso: 'ro', spCountry: 'RO', tz: 'Europe/Bucharest',               dial: '+40',  nameJa: 'ルーマニア',     nameEn: 'Romania' },
  southafrica:  { iso: 'za', spCountry: 'ZA', tz: 'Africa/Johannesburg',            dial: '+27',  nameJa: '南アフリカ',     nameEn: 'South Africa' },
  kenya:        { iso: 'ke', spCountry: 'KE', tz: 'Africa/Nairobi',                 dial: '+254', nameJa: 'ケニア',         nameEn: 'Kenya' },
  kazakhstan:   { iso: 'kz', spCountry: 'KZ', tz: 'Asia/Almaty',                    dial: '+7',   nameJa: 'カザフスタン',   nameEn: 'Kazakhstan' },
  japan:        { iso: 'jp', spCountry: 'JP', tz: 'Asia/Tokyo',                     dial: '+81',  nameJa: '日本',           nameEn: 'Japan' }
};

const BANNED_FACE_LIVENESS_OPS = new Set([
  'virtual34', 'virtual51', 'virtual63', 'virtual58', 'virtual59',
  'virtual65', 'virtual66', 'virtual53', 'virtual21', 'virtual38', 'virtual40'
]);

function apiRequest5Sim(path, method = 'GET', useAuth = true) {
  return new Promise((resolve, reject) => {
    const headers = { 'Accept': 'application/json' };
    if (useAuth && FIVESIM_API_KEY) headers['Authorization'] = `Bearer ${FIVESIM_API_KEY}`;
    const req = https.request({ hostname: '5sim.net', port: 443, path, method, headers, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body), raw: body }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('5sim API timeout')); });
    req.end();
  });
}

function apiRequestSmsPool(endpoint, paramsObj = {}) {
  return new Promise((resolve) => {
    const qs = new URLSearchParams({ key: SMSPOOL_API_KEY, ...paramsObj }).toString();
    const req = https.request({
      hostname: 'api.smspool.net',
      port: 443,
      path: `${endpoint}?${qs}`,
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({ raw: body }); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function normalizeLocalPhone(fullPhone, dialCode) {
  const cleanFull = String(fullPhone).replace(/[^\d+]/g, '');
  let local = cleanFull.startsWith(dialCode)
    ? cleanFull.slice(dialCode.length)
    : cleanFull.replace(/^\+\d{1,3}/, '');
  return local.replace(/^0+/, '');
}

async function tryBuyFromSmsPool(skipCountryList = [], fixedCountry = null, skipPhones = new Set()) {
  if (!SMSPOOL_API_KEY) return null;
  const balRes = await apiRequestSmsPool('/request/balance');
  const balanceUsd = balRes && balRes.balance !== undefined ? parseFloat(balRes.balance) : 0;
  if (balanceUsd < 0.10) {
    console.log(`  ℹ️ [SMSPool残高: $${balanceUsd.toFixed(2)}] 残高不足のため5SIMを使用します`);
    return null;
  }
  console.log(`  💎 [SMSPool稼働] 現在残高: $${balanceUsd.toFixed(2)} -> Non-VoIP高到達率回線を優先取得します`);

  const targetKeys = fixedCountry
    ? [fixedCountry]
    : ['unitedstates', 'england', 'netherlands', 'brazil', 'indonesia', 'philippines', 'colombia', 'mexico', 'thailand', 'poland'];

  for (const cKey of targetKeys) {
    if (!fixedCountry && skipCountryList.includes(cKey)) continue;
    const meta = GLOBAL_COUNTRY_META[cKey];
    if (!meta) continue;

    for (const svc of ['Twitter', '919']) {
      const order = await apiRequestSmsPool('/purchase/sms', {
        country: meta.spCountry,
        service: svc,
        pricing_option: '1',
        max_price: String(MAX_SMSPOOL_COST_USD)
      });

      if (order && order.success === 1 && order.order_id && (order.number || order.phonenumber)) {
        const cc = order.cc ? `+${String(order.cc).replace(/^\+/, '')}` : meta.dial;
        const rawPh = String(order.phonenumber || order.number).trim().replace(/^0+/, '');
        const fullPhone = rawPh.startsWith('+') ? rawPh : `${cc}${rawPh}`;
        if (skipPhones.has(fullPhone)) {
          await apiRequestSmsPool('/sms/cancel', { orderid: order.order_id });
          continue;
        }
        skipPhones.add(fullPhone);
        const localNumber = normalizeLocalPhone(fullPhone, meta.dial);
        console.log(`  🌐 [SMSPool番号取得成功] 国: ${meta.nameJa}(${meta.dial}) | 番号: ${fullPhone} -> ローカル打鍵番号: "${localNumber}" ($${order.cost || ''})`);
        return {
          orderId: `sp_${order.order_id}`,
          provider: 'smspool',
          phone: fullPhone,
          localNumber,
          dialCode: meta.dial,
          isoCountry: meta.iso,
          timezone: meta.tz,
          country: cKey,
          nameJa: meta.nameJa,
          nameEn: meta.nameEn,
          operator: 'smspool_nonvoip',
          rate: 95,
          price: order.cost || 0.25
        };
      }
    }
  }
  return null;
}

async function buyTwitterNumber(skipCountryList = [], fixedCountry = null, skipPhones = new Set()) {
  try {
    const spOrder = await tryBuyFromSmsPool(skipCountryList, fixedCountry, skipPhones);
    if (spOrder) return spOrder;
  } catch (e) {}

  if (!FIVESIM_API_KEY) throw new Error('利用可能なSMSプロバイダーがありません');

  let currentBalance = 10.12;
  if (!fixedCountry) {
    try {
      const prof = await apiRequest5Sim('/v1/user/profile', 'GET', true);
      if (prof.status === 200 && prof.data) {
        currentBalance = parseFloat(prof.data.balance) || 0;
        console.log(`  💰 [5sim残高確認] ${currentBalance} RUB`);
      }
    } catch (e) {}
  }

  const maxAllowedCost = Math.min(currentBalance, MAX_5SIM_COST_RUB);
  const candidates = [];

  const collectFromOps = (country, ops) => {
    if (fixedCountry && country !== fixedCountry) return;
    if (!fixedCountry && skipCountryList.includes(country)) return;
    const meta = GLOBAL_COUNTRY_META[country];
    if (!meta || !ops || typeof ops !== 'object') return;

    for (const [opName, info] of Object.entries(ops)) {
      if (!info || typeof info !== 'object') continue;
      const opLower = opName.toLowerCase();
      if (BANNED_FACE_LIVENESS_OPS.has(opLower)) continue;
      const count = info.count || 0;
      const cost = info.cost || 0;
      const rate = typeof info.rate === 'number' ? info.rate : 0;
      if (count < 3 || cost > maxAllowedCost || cost < 0.5) continue;

      const isRealCarrier = !opLower.includes('virtual');
      const score = (isRealCarrier ? 2000 : 0) + (rate * 140) + Math.min(cost, 15) * 40;
      candidates.push({ country, meta, opName, count, cost, rate, isRealCarrier, score });
    }
  };

  try {
    const pathUrl = fixedCountry
      ? `/v1/guest/prices?country=${encodeURIComponent(fixedCountry)}&product=twitter`
      : '/v1/guest/prices?product=twitter';
    const res = await apiRequest5Sim(pathUrl, 'GET', false);
    if (res.status === 200 && res.data) {
      const rootObj = (res.data.twitter && typeof res.data.twitter === 'object' && !res.data.twitter.count)
        ? res.data.twitter
        : res.data;
      for (const [country, val] of Object.entries(rootObj)) {
        if (!val || typeof val !== 'object') continue;
        const ops = (val.twitter && typeof val.twitter === 'object') ? val.twitter : val;
        collectFromOps(country, ops);
      }
    }
  } catch (e) {}

  candidates.sort((a, b) => b.score - a.score);

  for (const cand of candidates) {
    try {
      const buyRes = await apiRequest5Sim(`/v1/user/buy/activation/${cand.country}/${cand.opName}/twitter`, 'GET', true);
      if (buyRes.status === 200 && buyRes.data && buyRes.data.id && buyRes.data.phone) {
        const fullPhone = String(buyRes.data.phone).trim();
        if (skipPhones.has(fullPhone)) {
          await cancelOrder(buyRes.data.id);
          continue;
        }
        skipPhones.add(fullPhone);
        const localNumber = normalizeLocalPhone(fullPhone, cand.meta.dial);
        console.log(`  🌐 [5sim番号取得] 国: ${cand.meta.nameJa}(${cand.meta.dial}) | 回線: ${cand.opName} | 番号: ${fullPhone}`);
        return {
          orderId: buyRes.data.id,
          provider: '5sim',
          phone: fullPhone,
          localNumber,
          dialCode: cand.meta.dial,
          isoCountry: cand.meta.iso,
          timezone: cand.meta.tz,
          country: cand.country,
          nameJa: cand.meta.nameJa,
          nameEn: cand.meta.nameEn,
          operator: cand.opName,
          rate: cand.rate,
          price: buyRes.data.price
        };
      }
    } catch (e) {}
  }
  throw new Error('購入可能な番号が見つかりませんでした');
}

async function cancelOrder(orderId) {
  if (!orderId) return;
  const idStr = String(orderId);
  if (idStr.startsWith('sp_')) {
    await apiRequestSmsPool('/sms/cancel', { orderid: idStr.slice(3) }).catch(() => {});
    return;
  }
  await apiRequest5Sim(`/v1/user/cancel/${idStr}`, 'GET', true).catch(() => {});
}

async function waitForSmsCode(orderId, maxWaitSec = 45) {
  const start = Date.now();
  const idStr = String(orderId || '');

  if (idStr.startsWith('sp_')) {
    const rawId = idStr.slice(3);
    while ((Date.now() - start) < maxWaitSec * 1000) {
      await new Promise(r => setTimeout(r, 3500));
      const check = await apiRequestSmsPool('/sms/check', { orderid: rawId });
      if (check && (check.status === 3 || check.sms)) {
        const rawSms = String(check.sms || check.full_sms || '');
        const m = rawSms.match(/\b(\d{6})\b/);
        if (m) return m[1];
        if (/^\d{6}$/.test(rawSms.trim())) return rawSms.trim();
      }
      if (check && (check.status === 2 || check.status === 6)) {
        throw new Error('SMSPool ステータス期限切れ/キャンセル');
      }
    }
    await cancelOrder(orderId);
    throw new Error(`SMSPool 未着タイムアウト(${maxWaitSec}秒) -> 自動キャンセル＆返金済`);
  }

  while ((Date.now() - start) < maxWaitSec * 1000) {
    await new Promise(r => setTimeout(r, 3500));
    const res = await apiRequest5Sim(`/v1/user/check/${idStr}`, 'GET', true);
    if (res.status === 200 && res.data) {
      const smsList = res.data.sms || [];
      if (smsList.length > 0) {
        const lastSms = smsList[smsList.length - 1];
        if (lastSms.code) {
          await apiRequest5Sim(`/v1/user/finish/${idStr}`, 'GET', true).catch(() => {});
          return String(lastSms.code).trim();
        }
        const m = (lastSms.text || '').match(/\b(\d{6})\b/);
        if (m) {
          await apiRequest5Sim(`/v1/user/finish/${idStr}`, 'GET', true).catch(() => {});
          return m[1];
        }
      }
      if (['CANCELED', 'TIMEOUT', 'BANNED'].includes(res.data.status)) {
        throw new Error(`5simステータス終了: ${res.data.status}`);
      }
    }
  }
  await cancelOrder(orderId);
  throw new Error(`5sim SMS未着タイムアウト(${maxWaitSec}秒) -> 自動キャンセル＆返金済`);
}

module.exports = {
  has5SimKey: () => FIVESIM_API_KEY.length > 10 || SMSPOOL_API_KEY.length > 10,
  buyTwitterNumber,
  waitForSmsCode,
  cancelOrder
};
