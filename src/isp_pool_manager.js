require('dotenv').config();
const crypto = require('crypto');
const { db } = require('./firestore');

// ============================================================================
// 1. 全プラン ＆ 追加固定ISPアドオンのマスターカタログ定義
// ============================================================================
const PLAN_CATALOG = {
  oneday: {
    id: 'oneday',
    orderType: 'saas_plan',
    tierLevel: 1,
    name: '24-Hour Test Drive',
    nameJa: '24時間テストドライブ',
    usd: 7,
    jpy: 1080,
    threads: 1,
    accounts: 3,
    ispCount: 1,
    days: 1,
    minIntervalMin: 5,
    onlyUsJp: true,
    aiReply: false,
    autoPost: true,
    preferRecycledIsp: true
  },
  starter: {
    id: 'starter',
    orderType: 'saas_plan',
    tierLevel: 1,
    name: 'Solo Starter (30d)',
    nameJa: 'ソロスターター (30日)',
    usd: 39,
    jpy: 4980,
    threads: 1,
    accounts: 5,
    ispCount: 1,
    days: 30,
    minIntervalMin: 5,
    onlyUsJp: false,
    aiReply: false,
    autoPost: true,
    preferRecycledIsp: false
  },
  pro: {
    id: 'pro',
    orderType: 'saas_plan',
    tierLevel: 2,
    name: 'Agency Pro (30d)',
    nameJa: 'エージェンシーPro (30日)',
    usd: 79,
    jpy: 9800,
    threads: 3,
    accounts: 12,
    ispCount: 3,
    days: 30,
    minIntervalMin: 5,
    onlyUsJp: false,
    aiReply: false,
    autoPost: true,
    preferRecycledIsp: false
  },
  business: {
    id: 'business',
    orderType: 'saas_plan',
    tierLevel: 3,
    name: 'Syndicate Business (30d)',
    nameJa: 'シンジケートBusiness (30日)',
    usd: 179,
    jpy: 19800,
    threads: 5,
    accounts: 25,
    ispCount: 8,
    days: 30,
    minIntervalMin: 5,
    onlyUsJp: false,
    aiReply: true,
    autoPost: true,
    preferRecycledIsp: false
  },
  addon_isp: {
    id: 'addon_isp',
    orderType: 'isp_addon',
    tierLevel: 0,
    name: 'Dedicated Static ISP Addon (+1 IP / 30d)',
    nameJa: '追加固定ISPアドオン (+1本 / 30日)',
    usd: 19,
    jpy: 2950,
    threads: 0,
    accounts: 5,
    ispCount: 1,
    days: 30,
    minIntervalMin: 5,
    onlyUsJp: false,
    aiReply: false,
    autoPost: true,
    preferRecycledIsp: false
  }
};

const SUPPORTED_ISP_COUNTRIES = ['US', 'JP', 'GB', 'DE', 'NL', 'CA', 'AU', 'SG', 'HK', 'TW'];

function normalizeCountryList(rawCountryStr, requiredCount = 1, onlyUsJp = false) {
  const tokens = String(rawCountryStr || 'US')
    .toUpperCase()
    .split(/[,+\s]+/)
    .map(s => s.trim())
    .filter(s => SUPPORTED_ISP_COUNTRIES.includes(s));

  const valid = onlyUsJp ? tokens.filter(c => c === 'US' || c === 'JP') : tokens;
  const result = [];
  for (let i = 0; i < requiredCount; i++) {
    result.push(valid[i] || valid[0] || 'US');
  }
  return result;
}

// プール在庫がない国でも即座に固定セッションIPを発行して登録するフォールバック生成関数
function buildCountryStickyIspProxyString(countryCode, userId, slotIndex = 1) {
  const host = (process.env.IPROYAL_HOST || 'geo.iproyal.com').trim();
  const port = (process.env.IPROYAL_PORT || '12321').trim();
  const user = (process.env.IPROYAL_USER || 'TK3YqN2e7NyXeC55').trim();
  const passBase = (process.env.IPROYAL_PASS || '6v2R9ONbTDZFbc6F_country-jp').replace(/_country-[a-z]+/ig, '').replace(/_session-[a-z0-9]+/ig, '').replace(/_lifetime-[a-z0-9]+/ig, '').trim();
  if (!user || !passBase) {
    throw new Error('IPROYAL_USER and IPROYAL_PASS must be configured before generating an ISP proxy');
  }
  const cleanCountry = String(countryCode || 'US').toLowerCase();
  const sessionSeed = crypto.createHash('md5').update(`${userId}_${cleanCountry}_${slotIndex}_${Date.now()}`).digest('hex').slice(0, 8);
  const fullPass = passBase
    ? `${passBase}_country-${cleanCountry}_session-${sessionSeed}_lifetime-168h`
    : `country-${cleanCountry}_session-${sessionSeed}_lifetime-168h`;
  return `${host}:${port}:${user}:${fullPass}`;
}

// ============================================================================
// 2. 空きISPの自動回収とワンデイ($7)優先リサイクル割り当て関数
// ============================================================================
async function reconcileAndRecycleIspPool() {
  const nowMs = Date.now();
  const summary = { totalPool: 0, availableForOneDay: 0, assignedCount: 0, byCountry: {} };
  try {
    // 期限切れ契約をスキャンしてプロキシを解放
    const expContracts = await db.collection('saas_contracts').where('status', '==', 'active').get();
    for (const cDoc of expContracts.docs) {
      const c = cDoc.data() || {};
      const expMs = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().getTime() : 0;
      if (expMs > 0 && expMs <= nowMs) {
        await cDoc.ref.update({ status: 'expired', expiredAt: new Date(), updatedAt: new Date() }).catch(() => {});
        if (Array.isArray(c.proxies) && c.proxies.length > 0) {
          const pSnap = await db.collection('isp_proxy_pool').where('assignedUserId', '==', c.userId).get();
          for (const pDoc of pSnap.docs) {
            const pData = pDoc.data() || {};
            if (c.proxies.includes(pData.proxy)) {
              await pDoc.ref.update({
                assignedUserId: null,
                isRecycled: true,
                recycleCount: parseInt(pData.recycleCount || '0', 10) + 1,
                lastUserId: c.userId,
                releasedAt: new Date(),
                updatedAt: new Date()
              }).catch(() => {});
            }
          }
        }
      }
    }

    const poolSnap = await db.collection('isp_proxy_pool').get();
    for (const doc of poolSnap.docs) {
      const d = doc.data() || {};
      const country = String(d.country || 'US').toUpperCase();
      const provExpMs = d.providerExpiresAt && d.providerExpiresAt.toDate
        ? d.providerExpiresAt.toDate().getTime()
        : (nowMs + 25 * 86400000);
      if (provExpMs <= nowMs) continue;

      summary.totalPool++;
      if (!summary.byCountry[country]) summary.byCountry[country] = { idle: 0, assigned: 0 };
      if (d.assignedUserId) {
        summary.assignedCount++;
        summary.byCountry[country].assigned++;
      } else {
        summary.availableForOneDay++;
        summary.byCountry[country].idle++;
      }
    }
  } catch (e) {}
  return summary;
}

async function allocateIspProxiesForOrder({ userId, planId, countries = ['US'], count = 1, durationDays = 1 }) {
  const nowMs = Date.now();
  const minRemainingMs = Math.max(1, durationDays) * 86400000;
  const isOneDay = (planId === 'oneday' || durationDays <= 1);

  await reconcileAndRecycleIspPool();

  const poolSnap = await db.collection('isp_proxy_pool').get();
  const idleDocs = [];
  for (const doc of poolSnap.docs) {
    const d = doc.data() || {};
    if (d.assignedUserId) continue;
    const provExpMs = d.providerExpiresAt && d.providerExpiresAt.toDate
      ? d.providerExpiresAt.toDate().getTime()
      : (nowMs + 30 * 86400000);
    // ワンデイなら残り26時間以上、30日プランなら残り7日以上の固定ISPを対象にする
    const requiredValidMs = isOneDay ? (26 * 3600 * 1000) : Math.min(minRemainingMs, 7 * 86400000);
    if (provExpMs - nowMs < requiredValidMs) continue;
    idleDocs.push({
      ref: doc.ref,
      id: doc.id,
      proxy: d.proxy,
      country: String(d.country || 'US').toUpperCase(),
      recycleCount: parseInt(d.recycleCount || '0', 10),
      provExpMs
    });
  }

  // ワンデイ($7)の場合は「リサイクル回数が多い ＆ プロバイダ残り期限が短い順」に並べて端数期間ISPを優先消化
  // 30日プランの場合は「リサイクル回数が少ない（新鮮な）＆ 残り期限が長い順」に並べる
  if (isOneDay) {
    idleDocs.sort((a, b) => {
      if ((b.recycleCount > 0 ? 1 : 0) !== (a.recycleCount > 0 ? 1 : 0)) {
        return (b.recycleCount > 0 ? 1 : 0) - (a.recycleCount > 0 ? 1 : 0);
      }
      return a.provExpMs - b.provExpMs;
    });
  } else {
    idleDocs.sort((a, b) => {
      if (a.recycleCount !== b.recycleCount) return a.recycleCount - b.recycleCount;
      return b.provExpMs - a.provExpMs;
    });
  }

  const allocatedProxies = [];
  const usedDocIds = new Set();

  for (let i = 0; i < count; i++) {
    const targetCountry = String(countries[i] || countries[0] || 'US').toUpperCase();
    const matchIdx = idleDocs.findIndex(item => !usedDocIds.has(item.id) && item.country === targetCountry);

    if (matchIdx !== -1) {
      const picked = idleDocs[matchIdx];
      usedDocIds.add(picked.id);
      allocatedProxies.push(picked.proxy);
      await picked.ref.update({
        assignedUserId: userId,
        assignedPlanId: planId,
        assignedAt: new Date(),
        updatedAt: new Date()
      }).catch(() => {});
    } else {
      // プールに該当国の空きがない場合は国別固定セッションを生成し、30日有効なプール資産としてDB登録（ワンデイ終了後に他ユーザーへリサイクル可能！）
      const generatedProxy = buildCountryStickyIspProxyString(targetCountry, userId, i + 1);
      const newPoolId = `ISP-${targetCountry}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      await db.collection('isp_proxy_pool').doc(newPoolId).set({
        poolId: newPoolId,
        proxy: generatedProxy,
        country: targetCountry,
        assignedUserId: userId,
        assignedPlanId: planId,
        recycleCount: 0,
        providerExpiresAt: new Date(nowMs + 30 * 86400000),
        createdAt: new Date(),
        updatedAt: new Date()
      }).catch(() => {});
      allocatedProxies.push(generatedProxy);
    }
  }

  return allocatedProxies;
}

// ============================================================================
// 3. ワンデイ($7)からのアップグレード割引(-$7 OFF)判定
// ============================================================================
async function checkOneDayUpgradeCredit(userId, targetPlanId) {
  if (!userId || !['starter', 'pro', 'business'].includes(targetPlanId)) {
    return { eligible: false, discountUsd: 0 };
  }
  try {
    const snap = await db.collection('saas_contracts').where('userId', '==', userId).get();
    const nowMs = Date.now();
    for (const doc of snap.docs) {
      const c = doc.data() || {};
      const expMs = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().getTime() : 0;
      if (c.planId === 'oneday' && c.status === 'active' && expMs > nowMs && !c.upgradeCreditUsed) {
        return { eligible: true, discountUsd: 7, oneDayContractId: doc.id };
      }
    }
  } catch (e) {}
  return { eligible: false, discountUsd: 0 };
}

// ============================================================================
// 4. 決済完了時の契約発行・ISP割当・ユーザー権限合算・30%アフィリエイト計上
// ============================================================================
async function activateOrderAndProvisionResources(orderId, orderData = null) {
  const oRef = db.collection('orders').doc(orderId);
  const oSnap = await oRef.get();
  const o = orderData || (oSnap.exists ? oSnap.data() : null);
  if (!o) return { ok: false, error: 'Order not found' };
  if (o.status === 'completed' && o.provisionedProxies) {
    return { ok: true, alreadyCompleted: true, userId: o.userId, proxies: o.provisionedProxies };
  }

  const plan = PLAN_CATALOG[o.planId] || PLAN_CATALOG.starter;
  const userId = o.userId;
  const durationDays = parseInt(o.durationDays || plan.days || '30', 10);
  const ispCount = parseInt(o.totalIspCount || plan.ispCount || '1', 10);
  const countries = normalizeCountryList(o.ispCountry || 'US', ispCount, plan.onlyUsJp);

  // 1) 専用固定ISPを引き当て（ワンデイはリサイクル優先）
  const allocatedProxies = await allocateIspProxiesForOrder({
    userId,
    planId: plan.id,
    countries,
    count: ispCount,
    durationDays
  });

  const now = new Date();
  const expiresAt = new Date(Date.now() + durationDays * 86400000);
  const contractId = 'CTR-' + orderId.replace(/^ORD-/, '');

  // 2) saas_contracts に契約レコードを保存
  await db.collection('saas_contracts').doc(contractId).set({
    contractId,
    orderId,
    userId,
    planId: plan.id,
    planName: plan.name,
    orderType: plan.orderType,
    status: 'active',
    threads: plan.threads,
    accounts: plan.accounts,
    ispCount,
    minIntervalMin: plan.minIntervalMin || 5,
    proxies: allocatedProxies,
    countries,
    aiReplyUnlocked: !!plan.aiReply,
    createdAt: now,
    expiresAt,
    updatedAt: now
  }, { merge: true });

  // ワンデイからのアップグレード割引を使用した場合はワンデイ契約にフラグを付与
  if (o.oneDayContractId) {
    await db.collection('saas_contracts').doc(o.oneDayContractId).update({
      upgradeCreditUsed: true,
      updatedAt: now
    }).catch(() => {});
  }

  // 3) ユーザーの全アクティブ契約を合算して saas_users を更新
  const allContractsSnap = await db.collection('saas_contracts').where('userId', '==', userId).get();
  let totalThreads = 0;
  let totalAccounts = 0;
  let totalIspQuota = 0;
  let highestPlan = plan;
  let hasAiReply = !!plan.aiReply;
  let maxExpiresMs = expiresAt.getTime();
  const mergedProxies = [];
  const mergedCountries = [];

  for (const cDoc of allContractsSnap.docs) {
    const c = cDoc.data() || {};
    const expMs = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().getTime() : 0;
    if (c.status === 'active' && expMs > Date.now()) {
      totalThreads += parseInt(c.threads || '0', 10);
      totalAccounts += parseInt(c.accounts || '0', 10);
      totalIspQuota += parseInt(c.ispCount || '0', 10);
      if (c.aiReplyUnlocked) hasAiReply = true;
      if (expMs > maxExpiresMs) maxExpiresMs = expMs;
      const cSpec = PLAN_CATALOG[c.planId];
      if (cSpec && cSpec.tierLevel > highestPlan.tierLevel) highestPlan = cSpec;
      if (Array.isArray(c.proxies)) {
        c.proxies.forEach(p => { if (p && !mergedProxies.includes(p)) mergedProxies.push(p); });
      }
      if (Array.isArray(c.countries)) {
        c.countries.forEach(cn => { if (cn) mergedCountries.push(cn); });
      }
    }
  }

  await db.collection('saas_users').doc(userId).set({
    userId,
    planId: highestPlan.id,
    planName: highestPlan.name,
    tierLevel: highestPlan.tierLevel,
    planStatus: 'active',
    ispCountry: mergedCountries.join(',') || countries.join(','),
    ispCountries: mergedCountries.length > 0 ? mergedCountries : countries,
    maxThreads: Math.min(3, Math.max(1, totalThreads)),
    maxAccounts: Math.max(3, totalAccounts),
    ispQuota: Math.max(1, totalIspQuota),
    assignedProxies: mergedProxies.length > 0 ? mergedProxies : allocatedProxies,
    aiReplyUnlocked: hasAiReply,
    autoPostMode: true,
    aiReplyMode: hasAiReply,
    aiKeywords: o.aiKeywords || 'アダアフィ, Xアフィ, サーチバン, シャドバン, OFM twitter',
    minIntervalMin: 5,
    planExpiresAt: new Date(maxExpiresMs),
    updatedAt: now
  }, { merge: true });

  // 4) 注文ステータスを completed に更新
  await oRef.update({
    status: 'completed',
    provisionedProxies: allocatedProxies,
    contractId,
    completedAt: now,
    updatedAt: now
  }).catch(() => {});

  // 5) 30%継続アフィリエイト報酬の自動計上 ($15以上の決済が対象)
  const paidUsd = Number(o.grossAmountUsd || plan.usd || 0);
  const refCode = String(o.referredBy || '').trim().toUpperCase();
  if (paidUsd >= 15 && refCode && /^XSW-[A-Z0-9]+$/.test(refCode)) {
    try {
      const commissionUsd = Number((paidUsd * 0.30).toFixed(2));
      await db.collection('affiliate_commissions').add({
        orderId,
        buyerUserId: userId,
        planId: plan.id,
        refCode,
        grossUsd: paidUsd,
        commissionUsd,
        status: 'credited',
        createdAt: now
      });
    } catch (e) {}
  }

  return {
    ok: true,
    userId,
    planId: highestPlan.id,
    tierLevel: highestPlan.tierLevel,
    proxies: mergedProxies.length > 0 ? mergedProxies : allocatedProxies,
    countries: mergedCountries.length > 0 ? mergedCountries : countries,
    aiReplyUnlocked: hasAiReply
  };
}

module.exports = {
  PLAN_CATALOG,
  SUPPORTED_ISP_COUNTRIES,
  normalizeCountryList,
  reconcileAndRecycleIspPool,
  allocateIspProxiesForOrder,
  checkOneDayUpgradeCredit,
  activateOrderAndProvisionResources
};
