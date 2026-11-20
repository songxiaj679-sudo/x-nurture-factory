/**
 * src/iproyal_isp_buyer.js
 * IPRoyal Reseller API (apid.iproyal.com/v1/reseller) 準拠
 * 希望国(US/JP/UK/DE/SG/CA等)のStatic ISPプロキシを自動購入・プール割当するモジュール
 */
const https = require('https');
const { db } = require('./firestore');

function iproyalApi(method, apiPath, token, bodyObj = null) {
  return new Promise((resolve) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = https.request({
      hostname: 'apid.iproyal.com',
      port: 443,
      path: apiPath,
      method,
      headers: {
        'Accept': 'application/json',
        'X-Access-Token': token,
        'Authorization': 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
      },
      timeout: 25000
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, data: json, raw });
      });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (body) req.write(body);
    req.end();
  });
}

function matchCountryLocation(locations = [], targetCountry = 'US') {
  const code = String(targetCountry || 'US').toUpperCase().trim();
  const patterns = {
    US: /united states|^us$|^usa$/i,
    JP: /japan|^jp$/i,
    UK: /united kingdom|great britain|^uk$|^gb$/i,
    GB: /united kingdom|great britain|^uk$|^gb$/i,
    DE: /germany|^de$/i,
    SG: /singapore|^sg$/i,
    CA: /canada|^ca$/i,
    AU: /australia|^au$/i,
    FR: /france|^fr$/i,
    NL: /netherlands|^nl$/i,
    BR: /brazil|^br$/i
  };
  const rx = patterns[code] || new RegExp('^' + code + '$', 'i');
  const exactLoc = locations.find(l => rx.test(String(l.name || '')) && !l.out_of_stock);
  if (exactLoc) return exactLoc;
  if (['US', 'UK', 'GB', 'CA', 'AU'].includes(code)) {
    return locations.find(l => /united states|united kingdom|canada/i.test(String(l.name || '')) && !l.out_of_stock) || null;
  }
  return null;
}

async function orderNewIspProxiesFromIproyal(userId, countNeeded = 1, targetCountry = 'US', durationDays = 30) {
  return await _orderNewIspProxiesFromIproyalInner(userId, countNeeded, targetCountry, durationDays);
}
async function _orderNewIspProxiesFromIproyalInner(userId, countNeeded = 1, targetCountry = 'US', durationDays = 30) {
  const cleanCountry = String(targetCountry || 'US').toUpperCase().trim();
  const allocated = [];
  try {
    let token = (process.env.IPROYAL_API_TOKEN || '').trim();
    const cfgDoc = await db.collection('settings').doc('payment_config').get().catch(() => null);
    if (cfgDoc && cfgDoc.exists && cfgDoc.data().iproyalApiToken) {
      token = cfgDoc.data().iproyalApiToken.trim();
    }
    if (!token) return [];

    const prodRes = await iproyalApi('GET', '/v1/reseller/products', token);
    if (prodRes.status !== 200 || !prodRes.data || !Array.isArray(prodRes.data.data)) {
      console.error('[IPRoyal AutoBuy] Products fetch failed:', prodRes.status, prodRes.raw);
      return [];
    }
    const ispProd = prodRes.data.data.find(p => /isp/i.test(p.name)) || prodRes.data.data.find(p => /static/i.test(p.name));
    if (!ispProd) return [];

    const plans = ispProd.plans || [];
    const chosenPlan = plans.find(p => /30\s*day/i.test(p.name)) || plans[0];
    const chosenLoc = matchCountryLocation(ispProd.locations || [], cleanCountry);
    if (!chosenPlan || !chosenLoc) {
      console.error('[IPRoyal AutoBuy] Plan or Location unavailable:', { cleanCountry, chosenPlan, chosenLoc });
      return [];
    }

    const qty = Math.max(countNeeded, chosenPlan.min_quantity || 1);
    const payload = {
      product_id: ispProd.id,
      product_plan_id: chosenPlan.id,
      product_location_id: chosenLoc.id,
      quantity: qty,
      auto_extend: false
    };
    if (Array.isArray(ispProd.questions) && ispProd.questions.length > 0) {
      payload.questions_answers = [];
    }

    const buyRes = await iproyalApi('POST', '/v1/reseller/orders', token, payload);
    if ((buyRes.status !== 200 && buyRes.status !== 201) || !buyRes.data || !buyRes.data.id) {
      console.error('[IPRoyal AutoBuy] Order POST failed:', buyRes.status, buyRes.raw);
      return [];
    }

    const orderId = buyRes.data.id;
    console.log('🎉 [IPRoyal AutoBuy] Order #' + orderId + ' (' + chosenLoc.name + ' x ' + qty + ')');

    let rawProxies = [];
    let port = 12323;
    let expireStr = '';
    for (let i = 1; i <= 12; i++) {
      await new Promise(r => setTimeout(r, 3200));
      const dRes = await iproyalApi('GET', '/v1/reseller/orders/' + orderId, token);
      if (dRes.status === 200 && dRes.data) {
        expireStr = dRes.data.expire_date || '';
        const pd = dRes.data.proxy_data || {};
        port = (pd.ports && (pd.ports['http|https'] || pd.ports.http)) || 12323;
        if (Array.isArray(pd.proxies) && pd.proxies.length > 0) {
          rawProxies = pd.proxies;
          break;
        }
      }
    }

    const poolExpireDate = expireStr ? new Date(expireStr) : new Date(Date.now() + 30 * 86400000);
    const userExpireDate = new Date(Date.now() + Math.max(1, durationDays) * 86400000);

    for (let idx = 0; idx < rawProxies.length; idx++) {
      const item = rawProxies[idx];
      const pStr = item.ip + ':' + port + ':' + item.username + ':' + item.password;
      const assignToUser = idx < countNeeded ? userId : null;
      if (assignToUser) allocated.push(pStr);

      await db.collection('isp_proxy_pool').add({
        proxy: pStr,
        country: cleanCountry,
        orderId: String(orderId),
        source: 'iproyal_reseller_api',
        assignedUserId: assignToUser,
        assignedCountry: cleanCountry,
        assignedPlanDays: assignToUser ? durationDays : null,
        assignedAt: assignToUser ? new Date() : null,
        expiresAt: assignToUser ? userExpireDate : poolExpireDate,
        poolExpiresAt: poolExpireDate,
        expiresAtStr: expireStr.slice(0, 10),
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    return allocated;
  } catch (e) {
    console.error('[IPRoyal AutoBuy] Exception:', e.message);
    return allocated;
  }
}

async function provisionSmartIspProxies(userId, countNeeded = 1, targetCountry = 'US', durationDays = 30) {
  if (!countNeeded || countNeeded <= 0) return [];
  const cleanCountry = String(targetCountry || 'US').toUpperCase().trim();
  const days = parseInt(durationDays || '30', 10);
  const allocated = [];

  try {
    const allPoolSnap = await db.collection('isp_proxy_pool').get();
    const nowMs = Date.now();

    for (const doc of allPoolSnap.docs) {
      if (allocated.length >= countNeeded) break;
      const d = doc.data();
      if (!d.proxy || d.assignedUserId) continue;
      const docCountry = String(d.country || d.assignedCountry || 'JP').toUpperCase();
      if (docCountry !== cleanCountry) continue;
      const expMs = d.poolExpiresAt && d.poolExpiresAt.toDate
        ? d.poolExpiresAt.toDate().getTime()
        : (d.expiresAt && d.expiresAt.toDate ? d.expiresAt.toDate().getTime() : (nowMs + 86400000));
      if (expMs <= nowMs) continue;

      allocated.push(d.proxy);
      await doc.ref.update({
        assignedUserId: userId,
        assignedCountry: cleanCountry,
        assignedPlanDays: days,
        assignedAt: new Date(),
        expiresAt: new Date(nowMs + days * 86400000),
        updatedAt: new Date()
      });
    }

    if (allocated.length >= countNeeded) {
      console.log('♻️ [ISPプール割当] User=' + userId + ' に既存の ' + cleanCountry + ' 在庫から ' + allocated.length + '本を割当');
      return allocated;
    }

    const stillNeeded = countNeeded - allocated.length;
    console.log('🌐 [IPRoyal自動発注] User=' + userId + ' の希望国(' + cleanCountry + ')在庫不足のため APIで ' + stillNeeded + '本を自動購入します');
    const newlyBought = await orderNewIspProxiesFromIproyal(userId, stillNeeded, cleanCountry, days);
    for (const p of newlyBought) {
      if (allocated.length < countNeeded) allocated.push(p);
    }
    return allocated;
  } catch (e) {
    console.error('[provisionSmartIspProxies] Error:', e.message);
    return allocated;
  }
}

module.exports = {
  orderNewIspProxiesFromIproyal,
  provisionSmartIspProxies
};