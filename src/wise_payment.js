require('dotenv').config();
const https = require('https');
const { db } = require('./firestore');

const DEFAULT_WISE_LINKS = {
  token: 'd8149ade-8bc1-4fc8-9345-ce8d396156c9',
  // USD プランリンク
  usd: {
    starter: 'https://wise.com/pay/r/1OUW9iJBEMfwiN4',  // $39 or $79
    pro: 'https://wise.com/pay/r/WQRO5dMpUa7145g',      // $79 or $179
    business: 'https://wise.com/pay/r/h1yv3kXIvvcbh08'  // $179 or $399
  },
  // JPY プランリンク (公式実稼働リンク)
  jpy: {
    starter: 'https://wise.com/pay/r/kXYnWl-m6k8WVOY',     // ¥4,980
    pro: 'https://wise.com/pay/r/V_tnc7azl63ng3w',         // ¥9,800
    business: 'https://wise.com/pay/r/HEO5qptIIPhwhVQ'     // ¥19,800
  },
  oneday: 'https://wise.com/pay/r/NTtGmEOmN3zuNKY',   // $7
  starter: 'https://wise.com/pay/r/1OUW9iJBEMfwiN4',  // $79
  pro: 'https://wise.com/pay/r/WQRO5dMpUa7145g',      // $179
  business: 'https://wise.com/pay/r/h1yv3kXIvvcbh08', // $399
  addon_isp: 'https://wise.com/pay/r/1OUW9iJBEMfwiN4' // $19
};

function httpsGetJson(hostname, reqPath, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, path: reqPath, method: 'GET', headers: { 'Accept': 'application/json', ...headers }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getWiseConfig(planId = 'pro', currency = 'jpy') {
  let apiToken = (process.env.WISE_API_TOKEN || DEFAULT_WISE_LINKS.token).trim();
  const cur = String(currency || 'jpy').toLowerCase();
  
  // 通貨別の決済URLマップ
  const planUrls = {
    // JPY (日本円)
    jpy_starter: (process.env.WISE_URL_JPY_STARTER || DEFAULT_WISE_LINKS.jpy.starter).trim(),
    jpy_pro: (process.env.WISE_URL_JPY_PRO || DEFAULT_WISE_LINKS.jpy.pro).trim(),
    jpy_business: (process.env.WISE_URL_JPY_BUSINESS || DEFAULT_WISE_LINKS.jpy.business).trim(),
    // USD (米ドル)
    usd_starter: (process.env.WISE_URL_USD_STARTER || DEFAULT_WISE_LINKS.usd.starter).trim(),
    usd_pro: (process.env.WISE_URL_USD_PRO || DEFAULT_WISE_LINKS.usd.pro).trim(),
    usd_business: (process.env.WISE_URL_USD_BUSINESS || DEFAULT_WISE_LINKS.usd.business).trim(),
    // フォールバック
    oneday: (process.env.WISE_URL_ONEDAY || DEFAULT_WISE_LINKS.oneday).trim(),
    starter: (process.env.WISE_URL_STARTER || DEFAULT_WISE_LINKS.starter).trim(),
    pro: (process.env.WISE_URL_PRO || DEFAULT_WISE_LINKS.pro).trim(),
    business: (process.env.WISE_URL_BUSINESS || DEFAULT_WISE_LINKS.business).trim()
  };

  const lookupKey = `${cur}_${planId}`;
  const quickPayUrl = planUrls[lookupKey] || planUrls[planId] || planUrls.jpy_pro || planUrls.pro;

  let profileId = (process.env.WISE_PROFILE_ID || '').trim();
  try {
    const doc = await db.collection('settings').doc('payment_config').get();
    if (doc.exists) {
      const d = doc.data() || {};
      if (d.wiseApiToken) apiToken = String(d.wiseApiToken).trim();
      if (d.wiseProfileId) profileId = String(d.wiseProfileId).trim();
      if (d[lookupKey]) quickPayUrl = String(d[lookupKey]).trim();
    }
  } catch (e) {}

  return { apiToken, quickPayUrl, profileId, planUrls };
}

function buildWiseOrderSpec(orderId, amount, currency = 'JPY') {
  const shortRef = 'XSW-' + String(orderId).replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase();
  return {
    wiseRef: shortRef,
    exactAmount: Number(amount),
    currency: String(currency).toUpperCase()
  };
}

async function fetchWiseProfiles(apiToken) {
  const headers = { 'Authorization': 'Bearer ' + apiToken };
  for (const host of ['api.wise.com', 'api.transferwise.com']) {
    const res = await httpsGetJson(host, '/v1/profiles', headers);
    if (Array.isArray(res) && res.length > 0) return { host, profiles: res };
  }
  return { host: 'api.wise.com', profiles: [{ id: 151713704, type: 'personal' }, { id: 151715121, type: 'business' }] };
}

async function checkWiseOrderPaidViaApi(orderData, orderId = '') {
  try {
    if (!orderData || orderData.status === 'completed') return false;
    const cfg = await getWiseConfig(orderData.planId);
    if (!cfg.apiToken) return false;

    const { host, profiles } = await fetchWiseProfiles(cfg.apiToken);
    const headers = { 'Authorization': 'Bearer ' + cfg.apiToken };
    const profileIds = cfg.profileId ? [String(cfg.profileId)] : profiles.map(p => String(p.id)).filter(Boolean);
    if (profileIds.length === 0) return false;

    const usedSnap = await db.collection('orders').where('status', '==', 'completed').limit(100).get();
    const usedActIds = new Set();
    usedSnap.docs.forEach(d => {
      const aid = d.data().wiseActivityId;
      if (aid) usedActIds.add(String(aid));
    });

    const wiseRef = String(orderData.wiseRef || '').toUpperCase();
    const currency = String(orderData.currency || (orderData.grossAmountJpy ? 'JPY' : 'USD')).toUpperCase();
    const baseAmount = Number(orderData.exactAmount || orderData.grossAmountJpy || orderData.grossAmountUsd || orderData.wiseExactUsd || 0);
    const origAmount = Number(orderData.originalAmount || orderData.originalAmountUsd || baseAmount);
    const isJpy = currency === 'JPY' || baseAmount >= 500; // 500以上なら日本円判定

    const orderCreatedMs = orderData.createdAt && orderData.createdAt.toDate
      ? orderData.createdAt.toDate().getTime()
      : (Date.now() - 3600000);

    for (const pid of profileIds) {
      const acts = await httpsGetJson(host, '/v2/profiles/' + pid + '/activities?size=40', headers);
      const list = (acts && Array.isArray(acts.activities)) ? acts.activities : [];

      for (const act of list) {
        const actId = String(act.id || act.resource?.id || '');
        if (actId && usedActIds.has(actId)) continue;
        const st = String(act.status || '').toUpperCase();
        if (st && ['CANCELLED', 'FAILED', 'REJECTED'].includes(st)) continue;

        const actTime = act.createdOn ? new Date(act.createdOn).getTime() : Date.now();
        if (actTime + 300000 < orderCreatedMs) continue;

        const rawJson = JSON.stringify(act).toUpperCase();
        let matched = false;

        // 1. 注文リファレンスコード (例: XSW-ABC123) による完全照合
        if (wiseRef && wiseRef.length >= 6 && rawJson.includes(wiseRef)) {
          matched = true;
        } else {
          // 2. 金額および通貨シンボルによる自動照合
          const primaryAmt = String(act.primaryAmount || '');
          const numMatch = primaryAmt.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
          if (numMatch) {
            const paidVal = parseFloat(numMatch[1]);
            if (isJpy) {
              // JPY (日本円) 照合
              if ((Math.abs(paidVal - baseAmount) < 1 || Math.abs(paidVal - origAmount) < 1) && /JPY|円/i.test(primaryAmt)) {
                matched = true;
              }
            } else {
              // USD (米ドル) 照合
              if ((Math.abs(paidVal - baseAmount) < 0.05 || Math.abs(paidVal - origAmount) < 0.05) && /USD|\$|EUR|GBP/i.test(primaryAmt)) {
                matched = true;
              }
            }
          }
        }

        if (matched) {
          if (orderId && actId) {
            await db.collection('orders').doc(orderId).update({
              wiseActivityId: actId,
              paidVia: 'wise_api',
              paidAt: new Date(),
              updatedAt: new Date()
            }).catch(() => {});
          }
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

/**
 * Wise Webhook イベントハンドラー
 * Wise管理画面で設定したWebhook (transfers#state-change 等) を受信して即座に入金照合＆有効化
 */
async function processWiseWebhook(event) {
  try {
    const eventType = event.event_type || event.type;
    const resource = event.data?.resource || event.resource || {};
    console.log(`🔔 [Wise Webhook受信] イベント: ${eventType}, ID: ${resource.id || 'N/A'}`);

    if (eventType === 'transfers#state-change' || eventType === 'balances#credit') {
      const transferId = resource.id;
      // pending状態の未決済注文を検索して照合
      const pendingSnap = await db.collection('orders').where('status', '==', 'pending').limit(20).get();
      for (const doc of pendingSnap.docs) {
        const orderData = doc.data();
        const paid = await checkWiseOrderPaidViaApi(orderData, doc.id);
        if (paid) {
          console.log(`  🎉 [Wise Webhook照合完了] 注文ID: ${doc.id} が決済完了になりました！`);
          return { ok: true, matchedOrderId: doc.id };
        }
      }
    }
    return { ok: true, matched: false };
  } catch (err) {
    console.error('Wise Webhook Error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getWiseConfig,
  buildWiseOrderSpec,
  checkWiseOrderPaidViaApi,
  processWiseWebhook,
  fetchWiseProfiles
};
