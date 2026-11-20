const { db, updateAccountState } = require('./src/firestore');
const { getResidentialProxy } = require('./src/iproyal');

async function recover() {
  console.log('🔍 [誤隔離アカウントの復旧スキャン] 開始...');
  const snap = await db.collection('accounts').where('status', '==', 'unavailable').get();
  console.log(`対象候補: ${snap.size} 件`);

  let restoredCount = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const reason = String(d.errorReason || '');
    const isHardFreeze = /frozen|64|63|suspended|withheld|robot|326/i.test(reason);

    // invalid_token_top_page, proxy_timeout, invalid_token_no_session, 自動パトロール検品 等の誤判定で隔離された純国産・健全垢を復旧
    if (!isHardFreeze && (reason.includes('invalid_token') || reason.includes('top_page') || reason.includes('自動パトロール') || reason.includes('proxy_timeout') || reason.includes('suspended_public_check'))) {
      const country = (d.originType === 'pure_en' || (d.signupCountry && d.signupCountry !== 'jp')) ? 'US' : 'JP';
      const freshProxy = getResidentialProxy(d.authToken + '_restored_' + Date.now(), { country });
      const targetStatus = (d.farmingCycle && d.farmingCycle >= 1) ? 'farming' : (d.status === 'cleared' ? 'cleared' : 'farming');

      console.log(`  ♻️ 復旧: @${d.userId || doc.id} (理由: ${reason}) -> [${targetStatus}] へ復元`);
      await updateAccountState(doc.id, targetStatus, {
        errorReason: null,
        farmingTokenFailCount: 0,
        proxy: freshProxy,
        nextActionAt: new Date(Date.now() + 5 * 60 * 1000) // 5分後に養殖再開
      });
      restoredCount++;
    } else {
      console.log(`  ⏭️ スキップ (確定凍結/ロック): @${d.userId || doc.id} (理由: ${reason})`);
    }
  }

  console.log(`\n🎉 復旧完了: ${restoredCount} 件のアカウントを健全な養殖プールへ復帰させました！`);
}

recover().then(() => process.exit(0)).catch(err => {
  console.error('復旧エラー:', err);
  process.exit(1);
});
