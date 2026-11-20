/**
 * src/affiliate_manager.js
 * Web一元化アフィリエイト管理モジュール
 * - フリープラン (planId === 'free') は報酬対象外 ($0)
 * - 月額有料プランの実決済額に対してのみ 30% の紹介報酬を計上
 * - 報酬発生時・出金申請時に Telegram へプッシュ通知を送信
 */
require('dotenv').config();
const https = require('https');
const crypto = require('crypto');
const { db } = require('./firestore');

const AFFILIATE_COMMISSION_RATE = 0.30; // 月額課金額の30%
const MIN_PAYOUT_USD = 30; // 最低出金申請額 ($30)

// Telegramプッシュ通知専用ヘルパー（常駐Botプロセス不要でスマホへ即時通知）
function sendTgNotification(chatId, htmlText) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '9047128394:AAEN3puCbpuuTZM52NQILwZUGq5afbok-ak').trim();
  if (!chatId || !botToken) return Promise.resolve(false);
  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: chatId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: htmlText
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + botToken + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 12000
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}

async function getAdminTgChatId() {
  try {
    const cfgDoc = await db.collection('settings').doc('payment_config').get();
    if (cfgDoc.exists && cfgDoc.data().adminTgChatId) {
      return cfgDoc.data().adminTgChatId;
    }
  } catch (e) {}
  return '8401260325';
}

// 1. ユーザーの固有アフィリエイトコード取得・自動生成
async function getOrCreateAffiliateProfile(userId) {
  if (!userId) return null;
  const userRef = db.collection('saas_users').doc(userId);
  const doc = await userRef.get();
  if (!doc.exists) return null;

  const data = doc.data() || {};
  let affCode = data.affCode;
  if (!affCode) {
    const hash = crypto.createHash('md5').update(userId).digest('hex').slice(0, 6).toUpperCase();
    affCode = 'XSW-' + hash;
    await userRef.set({
      affCode,
      affBalanceUsd: data.affBalanceUsd || 0,
      affTotalEarnedUsd: data.affTotalEarnedUsd || 0,
      affReferralsCount: data.affReferralsCount || 0,
      affPaidReferralsCount: data.affPaidReferralsCount || 0,
      affWalletUsdt: data.affWalletUsdt || '',
      updatedAt: new Date()
    }, { merge: true });
  }

  return {
    userId,
    affCode,
    affBalanceUsd: Number(data.affBalanceUsd || 0),
    affTotalEarnedUsd: Number(data.affTotalEarnedUsd || 0),
    affReferralsCount: Number(data.affReferralsCount || 0),
    affPaidReferralsCount: Number(data.affPaidReferralsCount || 0),
    affWalletUsdt: String(data.affWalletUsdt || '')
  };
}

async function ensureAffiliateCode(userId) {
  const profile = await getOrCreateAffiliateProfile(userId);
  return profile ? profile.affCode : null;
}

async function getAffiliateDashboardData(userId) {
  return await getOrCreateAffiliateProfile(userId);
}

// 2. 新規Web訪問・登録時の紹介コード紐付け（無料登録時点では報酬 $0）
async function bindReferralIfEligible(childUserId, rawRefCode) {
  try {
    const cleanRef = String(rawRefCode || '').trim().toUpperCase();
    if (!childUserId || !cleanRef) return { bound: false, reason: 'empty_params' };

    const childRef = db.collection('saas_users').doc(childUserId);
    const childDoc = await childRef.get();
    if (!childDoc.exists) return { bound: false, reason: 'child_not_found' };
    const childData = childDoc.data() || {};

    // 既に紹介者が紐付いている場合は上書きしない
    if (childData.referredBy) {
      return { bound: false, reason: 'already_bound', referredBy: childData.referredBy };
    }

    // 紹介コードから親ユーザーを検索
    let parentSnap = await db.collection('saas_users').where('affCode', '==', cleanRef).limit(1).get();
    if (parentSnap.empty) {
      // 直接 userId が指定された場合のフォールバック
      const directDoc = await db.collection('saas_users').doc(rawRefCode.trim()).get();
      if (directDoc.exists) parentSnap = { empty: false, docs: [directDoc] };
    }
    if (parentSnap.empty) return { bound: false, reason: 'referrer_not_found' };

    const parentDoc = parentSnap.docs[0];
    const parentUserId = parentDoc.id;

    // 自己アフィリエイト防止
    if (parentUserId === childUserId) return { bound: false, reason: 'self_referral_blocked' };
    if (childData.email && parentDoc.data().email && String(childData.email).toLowerCase() === String(parentDoc.data().email).toLowerCase()) {
      return { bound: false, reason: 'same_email_blocked' };
    }

    await childRef.set({
      referredBy: parentUserId,
      referredByCode: cleanRef,
      referredAt: new Date()
    }, { merge: true });

    const curCount = Number(parentDoc.data().affReferralsCount || 0) + 1;
    await parentDoc.ref.set({ affReferralsCount: curCount, updatedAt: new Date() }, { merge: true });

    return { bound: true, referredBy: parentUserId };
  } catch (e) {
    return { bound: false, reason: e.message };
  }
}

// 3. 月額有料プラン課金時の 30% 報酬計上処理（フリープラン・$0決済は除外）
async function processPaidSubscriptionCommission({
  contractId,
  childUserId,
  paidAmountUsd,
  planId,
  planName,
  sourceCurrency = 'usd',
  sourceAmount = paidAmountUsd,
  usdConversionRate = 1,
  conversionSource = 'USD invoice amount',
  fxRateDate = null,
  paidAt = null
}) {
  const cleanPlan = String(planId || '').toLowerCase();
  const amountNum = Number(paidAmountUsd);
  const cleanSourceCurrency = String(sourceCurrency || 'usd').toLowerCase();
  const sourceAmountNum = Number(sourceAmount);
  const conversionRateNum = Number(usdConversionRate);
  if (!cleanPlan || cleanPlan === 'free' || cleanPlan === 'oneday' || cleanPlan === 'trial' ||
      !Number.isFinite(amountNum) || amountNum <= 0 ||
      !['jpy', 'usd'].includes(cleanSourceCurrency) ||
      !Number.isFinite(sourceAmountNum) || sourceAmountNum < 0 ||
      !Number.isFinite(conversionRateNum) || conversionRateNum <= 0) {
    return { credited: false, reason: 'free_or_zero_amount' };
  }
  if (!contractId || !childUserId) {
    return { credited: false, reason: 'missing_payment_identity' };
  }

  const childRef = db.collection('saas_users').doc(childUserId);
  const contractRef = db.collection('saas_contracts').doc(contractId);
  const ledgerId = crypto.createHash('sha256').update(String(contractId)).digest('hex');
  const ledgerRef = db.collection('saas_affiliate_ledger').doc(ledgerId);

  const result = await db.runTransaction(async (transaction) => {
    const contractDoc = await transaction.get(contractRef);
    const ledgerDoc = await transaction.get(ledgerRef);
    if ((contractDoc.exists && contractDoc.data().affCredited === true) || ledgerDoc.exists) {
      return { credited: false, reason: 'already_credited' };
    }

    const childDoc = await transaction.get(childRef);
    if (!childDoc.exists) return { credited: false, reason: 'user_not_found' };
    const childData = childDoc.data() || {};
    const parentUserId = childData.referredBy;
    if (!parentUserId || parentUserId === childUserId) {
      return { credited: false, reason: 'no_referrer' };
    }

    const parentRef = db.collection('saas_users').doc(parentUserId);
    const parentDoc = await transaction.get(parentRef);
    if (!parentDoc.exists) return { credited: false, reason: 'parent_not_found' };
    const parentData = parentDoc.data() || {};
    const commissionUsd = Math.round(amountNum * AFFILIATE_COMMISSION_RATE * 100) / 100;
    const newBalance = Math.round((Number(parentData.affBalanceUsd || 0) + commissionUsd) * 100) / 100;
    const newTotal = Math.round((Number(parentData.affTotalEarnedUsd || 0) + commissionUsd) * 100) / 100;
    const isFirstPaidReferralCommission = !childData.affFirstPaidCommissionRecorded;

    transaction.set(parentRef, {
      affBalanceUsd: newBalance,
      affTotalEarnedUsd: newTotal,
      ...(isFirstPaidReferralCommission ? {
        affPaidReferralsCount: Number(parentData.affPaidReferralsCount || 0) + 1
      } : {}),
      updatedAt: new Date()
    }, { merge: true });
    if (isFirstPaidReferralCommission) {
      transaction.set(childRef, { affFirstPaidCommissionRecorded: true, updatedAt: new Date() }, { merge: true });
    }
    transaction.set(contractRef, {
      affReferrerId: parentUserId,
      affCommissionUsd: commissionUsd,
      affCredited: true,
      affPaidAmountUsd: amountNum,
      affPaidCurrency: cleanSourceCurrency,
      affPaidSourceAmount: sourceAmountNum,
      affUsdConversionRate: conversionRateNum,
      affConversionSource: conversionSource,
      affFxRateDate: fxRateDate,
      affPaidAt: paidAt,
      updatedAt: new Date()
    }, { merge: true });
    transaction.set(ledgerRef, {
      type: 'commission',
      referrerUserId: parentUserId,
      referredUserId: childUserId,
      contractId,
      planId: cleanPlan,
      planName: planName || cleanPlan,
      paidAmountUsd: amountNum,
      sourceCurrency: cleanSourceCurrency,
      sourceAmount: sourceAmountNum,
      usdConversionRate: conversionRateNum,
      conversionSource,
      fxRateDate,
      paidAt,
      commissionRate: AFFILIATE_COMMISSION_RATE,
      amountUsd: commissionUsd,
      status: 'credited',
      createdAt: new Date()
    });

    return { credited: true, parentUserId, parentData, commissionUsd, newBalance, ledgerId };
  });

  if (!result.credited) return result;

  const adminChatId = await getAdminTgChatId();
  const adminMsg =
    '💰 <b>【Webアフィリエイト報酬発生 (30%)】</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    '• 紹介者ID: <code>' + result.parentUserId + '</code>\n' +
    '• 購入ユーザー: <code>' + childUserId + '</code>\n' +
    '• 契約プラン: <b>' + (planName || cleanPlan) + ' ($' + amountNum.toFixed(2) + ')</b>\n' +
    '• 30%報酬加算: <b>+$' + result.commissionUsd.toFixed(2) + ' USD</b>\n' +
    '• 紹介者現在残高: <b>$' + result.newBalance.toFixed(2) + ' USD</b>';
  await sendTgNotification(adminChatId, adminMsg);

  if (result.parentData.tgChatId && String(result.parentData.tgChatId) !== String(adminChatId)) {
    const userMsg =
      '🎉 <b>[X-Swarm Affiliate: +$' + result.commissionUsd.toFixed(2) + ' Earned!]</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      'Your referral subscribed to a paid monthly plan (<b>$' + amountNum.toFixed(2) + '</b>).\n' +
      '• Commission Credited (30%): <b>+$' + result.commissionUsd.toFixed(2) + ' USD</b>\n' +
      '• Available Payout Balance: <b>$' + result.newBalance.toFixed(2) + ' USD</b>';
    await sendTgNotification(result.parentData.tgChatId, userMsg);
  }

  return {
    credited: true,
    commissionUsd: result.commissionUsd,
    newBalance: result.newBalance,
    ledgerId: result.ledgerId
  };
}

// 4. ユーザーからの報酬出金申請（USDTウォレット宛）
async function requestAffiliatePayout(userId, usdtAddress) {
  const cleanWallet = String(usdtAddress || '').trim();
  if (!cleanWallet || cleanWallet.length < 20) {
    return { ok: false, error: 'Valid USDT wallet address required' };
  }
  const userRef = db.collection('saas_users').doc(userId);
  const doc = await userRef.get();
  if (!doc.exists) return { ok: false, error: 'User not found' };

  const data = doc.data() || {};
  const balance = Number(data.affBalanceUsd || 0);
  if (balance < MIN_PAYOUT_USD) {
    return { ok: false, error: `Minimum payout balance is $${MIN_PAYOUT_USD} USD (Current: $${balance.toFixed(2)})` };
  }

  await userRef.set({
    affBalanceUsd: 0,
    affWalletUsdt: cleanWallet,
    updatedAt: new Date()
  }, { merge: true });

  const reqDoc = await db.collection('saas_affiliate_ledger').add({
    type: 'payout_request',
    referrerUserId: userId,
    amountUsd: balance,
    usdtAddress: cleanWallet,
    status: 'pending_payout',
    createdAt: new Date()
  });

  const adminChatId = await getAdminTgChatId();
  await sendTgNotification(
    adminChatId,
    '🏦 <b>【アフィリエイト出金申請】</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    '• 申請ユーザー: <code>' + userId + '</code> (' + (data.email || 'No Email') + ')\n' +
    '• 出金申請額: <b>$' + balance.toFixed(2) + ' USD</b>\n' +
    '• 送金先USDTアドレス: <code>' + cleanWallet + '</code>\n' +
    '• 台帳ID: <code>' + reqDoc.id + '</code>'
  );

  return { ok: true, payoutAmountUsd: balance, requestId: reqDoc.id };
}

module.exports = {
  AFFILIATE_COMMISSION_RATE,
  MIN_PAYOUT_USD,
  getOrCreateAffiliateProfile,
  ensureAffiliateCode,
  getAffiliateDashboardData,
  bindReferralIfEligible,
  processPaidSubscriptionCommission,
  requestAffiliatePayout,
  sendTgNotification
};
