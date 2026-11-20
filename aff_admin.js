/**
 * aff_admin.js
 * アフィリエイト実績＆出金申請 (pending_payout) 管理CLIツール
 * 使い方:
 *   node aff_admin.js list               -> 紹介実績＆未処理の出金申請一覧を表示
 *   node aff_admin.js pay <台帳ID> [TXID] -> 指定した出金申請を支払完了(paid)に更新
 */
require('dotenv').config();
const { db } = require('./src/firestore');
const { sendTgNotification } = require('./src/affiliate_manager');

(async () => {
  const cmd = process.argv[2] || 'list';
  const targetId = process.argv[3] || '';
  const txHash = process.argv[4] || 'USDT_TRANSFERRED';

  if (cmd === 'pay' && targetId) {
    const ref = db.collection('saas_affiliate_ledger').doc(targetId);
    const doc = await ref.get();
    if (!doc.exists) {
      console.error('❌ 指定された台帳IDが見つかりません:', targetId);
      process.exit(1);
    }
    const d = doc.data();
    await ref.set({ status: 'paid', txHash, paidAt: new Date() }, { merge: true });
    console.log(`✅ 台帳ID [${targetId}] ($${Number(d.amountUsd || 0).toFixed(2)} USD -> ${d.usdtAddress}) を支払完了(paid)に更新しました！`);

    const uDoc = await db.collection('saas_users').doc(d.referrerUserId).get();
    if (uDoc.exists && uDoc.data().tgChatId) {
      await sendTgNotification(
        uDoc.data().tgChatId,
        `💸 <b>[X-Swarm Affiliate Payout Sent!]</b>\nYour payout of <b>$${Number(d.amountUsd || 0).toFixed(2)} USD</b> has been sent to <code>${d.usdtAddress}</code>.\nTx/Ref: <code>${txHash}</code>`
      );
    }
    process.exit(0);
  }

  console.log('=== 📊 1. 未処理のアフィリエイト出金申請 (pending_payout) ===');
  const pSnap = await db.collection('saas_affiliate_ledger').where('status', '==', 'pending_payout').get();
  if (pSnap.empty) {
    console.log('  (現在、未処理の出金申請はありません)');
  } else {
    pSnap.docs.forEach(doc => {
      const x = doc.data();
      console.log(`  • 台帳ID: ${doc.id} | 申請者: ${x.referrerUserId} | 金額: $${Number(x.amountUsd || 0).toFixed(2)} USD | 送金先USDT: ${x.usdtAddress}`);
      console.log(`    👉 支払完了コマンド: node aff_admin.js pay ${doc.id}`);
    });
  }

  console.log('\n=== 🤝 2. アフィリエイト紹介コード発行済みユーザー一覧 ===');
  const uSnap = await db.collection('saas_users').get();
  uSnap.docs.forEach(doc => {
    const u = doc.data();
    if (u.affCode) {
      console.log(`  • ${doc.id} (${u.email || 'No Email'}) | Code: ${u.affCode} | 登録紹介: ${u.affReferralsCount || 0}件 | 有料課金: ${u.affPaidReferralsCount || 0}件 | 残高: $${Number(u.affBalanceUsd || 0).toFixed(2)} | 累計: $${Number(u.affTotalEarnedUsd || 0).toFixed(2)}`);
    }
  });
  process.exit(0);
})();
