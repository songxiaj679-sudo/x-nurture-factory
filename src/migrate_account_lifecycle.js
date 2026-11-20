'use strict';
require('dotenv').config();

const { db } = require('./firestore');
const { normalizeAccountStatus, getAccountLifecycleStatus } = require('./account_state');

async function migrateAccountLifecycleStatuses({ dryRun = false, batchSize = 400 } = {}) {
  console.log('======================================================================');
  console.log(`🔄 【Firestore アカウント・ライフサイクルステータス正規化マイグレーション】`);
  console.log(`モード: ${dryRun ? '🔍 DRY RUN (書き込みなし・検証のみ)' : '🚀 LIVE (Firestore 更新実行)'}`);
  console.log('======================================================================');

  const snapshot = await db.collection('accounts').get();
  console.log(`📊 対象アカウント総数: ${snapshot.size} 件\n`);

  let updatedCount = 0;
  let alreadyNormalizedCount = 0;
  let currentBatch = db.batch();
  let stagedInBatch = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const currentLifecycle = data.lifecycleStatus;
    const resolvedLifecycle = getAccountLifecycleStatus(data);

    // 既に正しい lifecycleStatus が入っている場合はスキップ
    if (currentLifecycle === resolvedLifecycle) {
      alreadyNormalizedCount++;
      continue;
    }

    updatedCount++;
    console.log(`[修正対象] ID: ${doc.id} | raw status: "${data.status}" -> lifecycleStatus: "${resolvedLifecycle}" (旧値: "${currentLifecycle || '(未設定)'}")`);

    if (!dryRun) {
      currentBatch.update(doc.ref, {
        lifecycleStatus: resolvedLifecycle,
        updatedAt: new Date(),
      });
      stagedInBatch++;

      if (stagedInBatch >= batchSize) {
        await currentBatch.commit();
        console.log(`💾 ${stagedInBatch}件のバッチコミットが完了しました。`);
        currentBatch = db.batch();
        stagedInBatch = 0;
      }
    }
  }

  if (!dryRun && stagedInBatch > 0) {
    await currentBatch.commit();
    console.log(`💾 残り ${stagedInBatch}件のバッチコミットが完了しました。`);
  }

  console.log('\n======================================================================');
  console.log(`🏁 マイグレーション結果:`);
  console.log(`   ・検証総数: ${snapshot.size} 件`);
  console.log(`   ・正規化済み（変更不要）: ${alreadyNormalizedCount} 件`);
  console.log(`   ・更新実行（補正対象）: ${updatedCount} 件`);
  console.log('======================================================================');
}

if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  migrateAccountLifecycleStatuses({ dryRun: isDryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ マイグレーションエラー:', err);
      process.exit(1);
    });
}

module.exports = { migrateAccountLifecycleStatuses };
