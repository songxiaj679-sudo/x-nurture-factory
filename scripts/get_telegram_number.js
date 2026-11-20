/**
 * @file scripts/get_telegram_number.js
 * @description 5SIM経由でTelegram新規登録用の一時電話番号を取得し、SMS認証コードを待機するスクリプト
 */

'use strict';

require('dotenv').config();
const https = require('https');

const FIVESIM_API_KEY = (process.env.FIVESIM_API_KEY || '').trim();

if (!FIVESIM_API_KEY) {
  console.error('❌ エラー: .env に FIVESIM_API_KEY が設定されていません。');
  process.exit(1);
}

function apiRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '5sim.net',
      port: 443,
      path,
      method,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${FIVESIM_API_KEY}`
      },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('5SIM API タイムアウト')); });
    req.end();
  });
}

async function cancelOrder(orderId) {
  console.log(`\n⏳ オーダー ${orderId} をキャンセル・返金処理中...`);
  await apiRequest(`/v1/user/cancel/${orderId}`);
  console.log('✅ キャンセル完了（残高は即座に返金されました）');
}

async function run() {
  console.log('====================================================');
  console.log('📱 VELOX / 5SIM Telegram 電話番号取得ツール');
  console.log('====================================================');

  // 1. プロファイルと残高確認
  const prof = await apiRequest('/v1/user/profile');
  if (prof.status !== 200 || !prof.data) {
    console.error('❌ 5SIMプロファイル取得失敗:', prof.status);
    return;
  }
  const balance = parseFloat(prof.data.balance) || 0;
  console.log(`👤 ユーザー: ${prof.data.email}`);
  console.log(`💰 現在の残高: ${balance.toFixed(2)} RUB`);

  if (balance < 0.5) {
    console.error('❌ 残高不足です（0.5 RUB以上必要です）');
    return;
  }

  // 2. Telegramの在庫と価格を検索（成功率上位順）
  console.log('\n🔍 Telegram用番号の在庫と成功率を検索中...');
  const pricesRes = await apiRequest('/v1/guest/prices?product=telegram');
  if (pricesRes.status !== 200 || !pricesRes.data || !pricesRes.data.telegram) {
    console.error('❌ 価格情報の取得に失敗しました');
    return;
  }

  const tgPrices = pricesRes.data.telegram;
  const candidates = [];

  for (const [country, ops] of Object.entries(tgPrices)) {
    for (const [op, details] of Object.entries(ops)) {
      if (details.count > 0 && details.cost <= balance) {
        candidates.push({
          country,
          op,
          cost: details.cost,
          count: details.count,
          rate: details.rate24 || details.rate || 0
        });
      }
    }
  }

  // 成功率順にソート
  candidates.sort((a, b) => b.rate - a.rate);

  if (candidates.length === 0) {
    console.error('❌ 現在購入可能なTelegram用番号の在庫がありません');
    return;
  }

  console.log(`✅ ${candidates.length} 件の購入候補が見つかりました。上位候補:`);
  candidates.slice(0, 3).forEach((c, idx) => {
    console.log(`   ${idx + 1}. 国: ${c.country} | 回線: ${c.op} | 価格: ${c.cost} RUB | 成功率: ${c.rate}% | 在庫: ${c.count}件`);
  });

  // 3. 番号購入
  let order = null;
  for (const cand of candidates.slice(0, 5)) {
    console.log(`\n🛒 [試行] 国: ${cand.country} (${cand.op}) の番号を購入中... (${cand.cost} RUB)`);
    const buyRes = await apiRequest(`/v1/user/buy/activation/${cand.country}/${cand.op}/telegram`);
    if (buyRes.status === 200 && buyRes.data && buyRes.data.id && buyRes.data.phone) {
      order = buyRes.data;
      console.log(`✨ 番号取得成功！`);
      break;
    } else {
      console.log(`   ⚠️ 購入失敗 (${buyRes.status}): 別の候補を試します...`);
    }
  }

  if (!order) {
    console.error('❌ 購入に失敗しました。時間をおいて再試行してください。');
    return;
  }

  const fullPhone = String(order.phone).trim();
  console.log('\n====================================================');
  console.log(`📱 発行された電話番号:  ${fullPhone}`);
  console.log(`🆔 オーダーID:         ${order.id}`);
  console.log(`🌍 国:                 ${order.country}`);
  console.log(`⏱️ 有効期限:           約15分`);
  console.log('====================================================');
  console.log('👉 今すぐ Telegram アプリを開き、上記の電話番号を入力してください！');
  console.log('   （国番号を含めて入力してください）');
  console.log('\n⏳ TelegramからのSMS認証コードを待機中 (最大3分間)...');
  console.log('   ※もしTelegram側で「利用停止されています」と出た場合は Ctrl+C で中断してください（自動返金されます）');

  // 4. SMS待機ループ
  const maxWaitMs = 180 * 1000;
  const startTime = Date.now();
  let receivedCode = null;

  // Ctrl+C 割り込み時の自動キャンセル処理
  process.on('SIGINT', async () => {
    console.log('\nユーザーによる中断を検知しました。');
    await cancelOrder(order.id);
    process.exit(0);
  });

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 4000));
    const checkRes = await apiRequest(`/v1/user/check/${order.id}`);

    if (checkRes.status === 200 && checkRes.data) {
      const smsList = checkRes.data.sms || [];
      if (smsList.length > 0) {
        const lastSms = smsList[smsList.length - 1];
        if (lastSms.code) {
          receivedCode = String(lastSms.code).trim();
        } else {
          // Telegramの認証コード（通常5桁）を正規表現で抽出
          const match = (lastSms.text || '').match(/\b(\d{5})\b/) || (lastSms.text || '').match(/\b(\d{6})\b/);
          if (match) receivedCode = match[1];
        }

        if (receivedCode) {
          console.log('\n====================================================');
          console.log(`🎉 SMS認証コードを受信しました！: 【 ${receivedCode} 】`);
          console.log(`📩 本文: "${lastSms.text || ''}"`);
          console.log('====================================================');
          // 注文完了通知
          await apiRequest(`/v1/user/finish/${order.id}`);
          console.log('✅ オーダー完了');
          return;
        }
      }

      if (['CANCELED', 'TIMEOUT', 'BANNED'].includes(checkRes.data.status)) {
        console.error(`❌ オーダーステータス終了: ${checkRes.data.status}`);
        return;
      }
    }
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r   待機中... (${elapsedSec}s / 180s)`);
  }

  console.log('\n⚠️ タイムアウト（3分以内にSMSが届きませんでした）');
  await cancelOrder(order.id);
}

run().catch(err => {
  console.error('\n❌ 予期せぬエラー:', err.message);
});
