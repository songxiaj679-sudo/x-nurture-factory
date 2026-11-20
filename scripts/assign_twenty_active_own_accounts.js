#!/usr/bin/env node
/**
 * 🚀 Deploy 20 Accounts to "active_own" (自社運用中)
 * 
 * データベース (accounts コレクション) 内の厳選された優良アカウントから、
 * 🇯🇵 日本語部隊 10アカウント (lang=ja)
 * 🇺🇸 英語部隊   10アカウント (lang=en)
 * を抽出し、ステータスを【active_own (自社利用中)】へ一括昇格・配備するスクリプト。
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { db } = require('../src/firestore');

// 英語部隊用グローバルペルソナ辞書 (英語圏のTech / SaaS / Creator仕様)
const GLOBAL_ENGLISH_PERSONAS = [
  { name: 'Alex Vance', bio: 'Building autonomous AI workflows in NYC. Obsessed with clean code, coffee, and distributed architecture.', location: 'New York, USA' },
  { name: 'Sophia Chen', bio: 'Growth engineer & SaaS founder. Tweeting about AI distribution, high-converting hooks, and product velocity.', location: 'San Francisco, USA' },
  { name: 'Liam Davies', bio: 'B2B marketing strategist based in London. Exploring multi-agent AI deliberation & viral social funnels.', location: 'London, UK' },
  { name: 'Emma Watson-Lee', bio: 'Tech founder & developer. Automating social growth and testing algorithmic distribution limits.', location: 'Toronto, Canada' },
  { name: 'Lucas Miller', bio: 'Indie hacker building micro-SaaS. Sharing daily lessons on conversion rate optimization & audience building.', location: 'Austin, USA' },
  { name: 'Oliver Smith', bio: 'AI researcher and systems architect. Optimizing 0.2s hook retention and executive marketing blueprints.', location: 'Seattle, USA' },
  { name: 'Chloe Dubois', bio: 'Digital strategist & designer. Living between Paris and NYC. Curating high-converting organic reach strategies.', location: 'Paris / NYC' },
  { name: 'Daniel Park', bio: 'Full-stack builder. Writing about AI automation, organic growth engines, and zero-compromise security.', location: 'Chicago, USA' },
  { name: 'Mia Robinson', bio: 'SaaS marketing lead. Turning impressions into qualified enterprise leads with multi-agent consensus.', location: 'Boston, USA' },
  { name: 'James Wilson', bio: 'Tech entrepreneur & investor. Documenting the future of autonomous marketing and AI-first workflows.', location: 'Singapore / USA' }
];

async function deployTwentyAccounts() {
  console.log('====================================================');
  console.log('🏛️ Deploying 20 High-Trust Accounts to "active_own"');
  console.log('   🇯🇵 10 Japanese Accounts (for @VeloxSystemsV4)');
  console.log('   🇺🇸 10 English Accounts (for @VeloxSystemsHQ)');
  console.log('====================================================\n');

  if (!db) {
    console.error('❌ Firestore connection unavailable.');
    process.exit(1);
  }

  // 1. farming または 既存 active_own から最高品質のアカウントを抽出
  const snap = await db.collection('accounts')
    .where('status', 'in', ['farming', 'active_own'])
    .get();

  const candidates = [];
  snap.forEach(d => {
    const data = d.data();
    if (!data.authToken || !data.ct0) return;
    if (data.reachRestricted === true) return;
    if (data.errorReason && data.errorReason !== null) return;
    candidates.push({
      id: d.id,
      ref: d.ref,
      data
    });
  });

  // 育成サイクル・ツイート実績順にソート (既に実績のある強いアカウントを優先)
  candidates.sort((a, b) => {
    const scoreA = (a.data.farmingCycles || 0) * 10 + (a.data.recentTweets || []).length;
    const scoreB = (b.data.farmingCycles || 0) * 10 + (b.data.recentTweets || []).length;
    return scoreB - scoreA;
  });

  if (candidates.length < 20) {
    console.error(`❌ 候補アカウントが不足しています (必要: 20, 検出: ${candidates.length})`);
    process.exit(1);
  }

  const selected20 = candidates.slice(0, 20);
  const jaAccounts = selected20.slice(0, 10);
  const enAccounts = selected20.slice(10, 20);

  console.log(`✅ Selected 20 top-tier healthy accounts from ${candidates.length} pool.`);

  // 2. 日本語部隊 (10アカウント) の更新
  console.log('\n🇯🇵 [Deploying Japanese Syndicate Squad (10 Accounts)]');
  for (let i = 0; i < jaAccounts.length; i++) {
    const acc = jaAccounts[i];
    const username = acc.data.username || acc.data.userId || `ja_syndicate_${i + 1}`;
    await acc.ref.update({
      status: 'active_own',
      role: 'syndicate_ja',
      lang: 'ja',
      targetSponsorship: '@VeloxSystemsV4',
      isSyndicateActive: true,
      lastPromotedToOwnAt: new Date(),
      updatedAt: new Date()
    });
    console.log(`  [JA #${i + 1}] ID: ${acc.id.slice(0, 8)}... | Name: ${acc.data.name || '自社'} | @${username} -> 🔵 active_own (JA)`);
  }

  // 3. 英語部隊 (10アカウント) の更新 (グローバルBio & ペルソナ付与)
  console.log('\n🇺🇸 [Deploying English Global Syndicate Squad (10 Accounts)]');
  for (let i = 0; i < enAccounts.length; i++) {
    const acc = enAccounts[i];
    const persona = GLOBAL_ENGLISH_PERSONAS[i] || GLOBAL_ENGLISH_PERSONAS[0];
    const username = acc.data.username || acc.data.userId || `en_syndicate_${i + 1}`;
    await acc.ref.update({
      status: 'active_own',
      role: 'syndicate_en',
      lang: 'en',
      name: persona.name,
      bio: persona.bio,
      location: persona.location,
      targetSponsorship: '@VeloxSystemsHQ',
      isSyndicateActive: true,
      lastPromotedToOwnAt: new Date(),
      updatedAt: new Date()
    });
    console.log(`  [EN #${i + 1}] ID: ${acc.id.slice(0, 8)}... | Name: ${persona.name} | @${username} -> 🔵 active_own (EN)`);
  }

  // 4. 自社アカウントコレクション (saas_accounts) へもシンジケート部隊としてミラー登録
  console.log('\n🔄 Mirroring 20 accounts to saas_accounts syndicate pool...');
  const batch = db.batch();

  // 日本語公式オーナー: WEB-GOOGLE-D12E2479A76266AEA2B4
  // グローバル公式オーナー: USR-MVUA1GLP-D640
  for (const acc of jaAccounts) {
    const uName = acc.data.username || acc.data.userId || acc.id.slice(0, 10);
    const mRef = db.collection('saas_accounts').doc(`own_ja_${uName.toLowerCase()}`);
    batch.set(mRef, {
      ownerUserId: 'WEB-GOOGLE-D12E2479A76266AEA2B4',
      username: uName,
      name: acc.data.name || '自社日本語サテライト',
      lang: 'ja',
      status: 'active_own',
      role: '自社利用中',
      isSyndicateSquad: true,
      authToken: acc.data.authToken,
      ct0: acc.data.ct0,
      updatedAt: new Date()
    }, { merge: true });
  }

  for (let i = 0; i < enAccounts.length; i++) {
    const acc = enAccounts[i];
    const persona = GLOBAL_ENGLISH_PERSONAS[i];
    const uName = acc.data.username || acc.data.userId || acc.id.slice(0, 10);
    const mRef = db.collection('saas_accounts').doc(`own_en_${uName.toLowerCase()}`);
    batch.set(mRef, {
      ownerUserId: 'USR-MVUA1GLP-D640',
      username: uName,
      name: persona.name,
      bio: persona.bio,
      lang: 'en',
      status: 'active_own',
      role: '自社利用中',
      isSyndicateSquad: true,
      authToken: acc.data.authToken,
      ct0: acc.data.ct0,
      updatedAt: new Date()
    }, { merge: true });
  }

  await batch.commit();
  console.log('✅ Mirroring complete! 20 accounts are now active in the internal syndicate pool.');

  console.log('\n====================================================');
  console.log('🎉 20 ACCOUNTS FULLY DEPLOYED TO "active_own"!');
  console.log('   🇯🇵 10 Accounts actively supporting @VeloxSystemsV4');
  console.log('   🇺🇸 10 Accounts actively supporting @VeloxSystemsHQ');
  console.log('====================================================\n');
}

if (require.main === module) {
  deployTwentyAccounts().catch(err => {
    console.error('Fatal error during deployment:', err);
    process.exit(1);
  });
}

module.exports = { deployTwentyAccounts };
