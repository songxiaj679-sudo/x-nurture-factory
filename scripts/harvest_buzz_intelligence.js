#!/usr/bin/env node
/**
 * 🛰️ CLI: Harvest Buzz Intelligence via X Official API v2
 * 
 * 使い方:
 *   node scripts/harvest_buzz_intelligence.js --targets "elonmusk,OpenAI"
 *   node scripts/harvest_buzz_intelligence.js --query "B2B マーケティング"
 *   node scripts/harvest_buzz_intelligence.js --show-top
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { db } = require('../src/firestore');
const { decryptCredentials, refreshOAuth2TokenIfNeeded } = require('../src/official_api_client');
const {
  harvestUserTweets,
  harvestSearchTweets,
  getTopPerformingHooks,
  CORPUS_JSONL_FILE
} = require('../src/intelligence_harvester');

async function resolveDefaultCredentials() {
  // 1. saas_users から有効な公式API連携アカウントを探索
  if (db) {
    const snap = await db.collection('saas_users')
      .where('planStatus', '==', 'active')
      .limit(5)
      .get();
    
    for (const doc of snap.docs) {
      const u = doc.data();
      if (u.twitterAuth && u.twitterAuth.oauth2RefreshToken) {
        let creds = {
          userId: doc.id,
          username: u.twitterAuth.username || 'user',
          oauth2AccessToken: u.twitterAuth.oauth2AccessToken,
          oauth2RefreshToken: u.twitterAuth.oauth2RefreshToken,
          oauth2ExpiresAt: u.twitterAuth.oauth2ExpiresAt
        };
        creds = await refreshOAuth2TokenIfNeeded(creds, false, doc.id);
        return { creds, ownerUid: doc.id };
      }
      if (u.xOfficialCredentials) {
        try {
          const dec = decryptCredentials(u.xOfficialCredentials);
          dec.userId = doc.id;
          return { creds: dec, ownerUid: doc.id };
        } catch (e) {}
      }
      if (u.officialApiKey && u.officialAccessToken) {
        return {
          creds: {
            apiKey: u.officialApiKey,
            apiSecret: u.officialApiSecret,
            accessToken: u.officialAccessToken,
            accessTokenSecret: u.officialAccessTokenSecret,
            userId: doc.id
          },
          ownerUid: doc.id
        };
      }
    }
  }

  // 2. 環境変数からのフォールバック
  if (process.env.TWITTER_API_KEY && process.env.TWITTER_ACCESS_TOKEN) {
    return {
      creds: {
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_SECRET
      },
      ownerUid: 'env'
    };
  }

  return { creds: null, ownerUid: null };
}

async function main() {
  const args = process.argv.slice(2);
  console.log('====================================================');
  console.log('🧠 VeloxPost Official X Intelligence Harvester');
  console.log('====================================================');

  if (args.includes('--show-top')) {
    const isUnderdogOnly = args.includes('--underdog');
    const isThreadsOnly = args.includes('--threads');
    let targetGenre = null;
    const gIdx = args.indexOf('--genre');
    if (gIdx !== -1 && args[gIdx + 1]) targetGenre = args[gIdx + 1];

    const top = getTopPerformingHooks({
      genre: targetGenre,
      limit: 10,
      diversified: !isUnderdogOnly && !isThreadsOnly,
      filterUnderdog: isUnderdogOnly,
      includeCrossGenre: true,
      includeUnderdogBuzz: true,
      includeSplitThreads: true,
      preferFormat: isThreadsOnly ? 'split_thread' : null
    });

    const displayItems = top;

    console.log(`\n📚 Currently Saved Buzz Corpus: ${displayItems.length} items (File: ${CORPUS_JSONL_FILE})`);
    console.log(`   モード: ${isUnderdogOnly ? '⚡ 弱小アカウント下剋上バズのみ' : (isThreadsOnly ? '🧵 分割長文スレッドのみ' : '🔄 多ジャンル＆下剋上＆分割長文バランシングサンプリング')}\n`);

    displayItems.forEach((item, idx) => {
      const formatBadge = item.postFormat === 'split_thread' ? '🧵 分割長文（リプライ連動）' : '☕ 単発一撃';
      const underdogBadge = item.isUnderdogBuzz ? `⚡ 弱小下剋上 (x${item.outlierMultiplier || item.metrics?.outlierMultiplier || 1}倍 / ${item.authorFollowers || '小規模'}フォロワー)` : '🏢 一般・大手';
      console.log(`[#${idx + 1}] ${formatBadge} | ${underdogBadge} | ジャンル: ${item.genre || '汎用'} | Type: ${item.hookType}`);
      console.log(`    🎯 Hook: "${item.openingHook}"`);
      console.log(`    📊 ViralityScore: ${item.metrics?.viralityScore} (保存率: ${item.metrics?.bookmarkRate || 0}) | 補正スコア: ${item.metrics?.cloutAdjustedScore || item.metrics?.viralityScore}`);
      if (item.threadTweets && item.threadTweets.length > 1) {
        console.log(`    💬 Reply continuation: "${item.threadTweets[1].slice(0, 60)}..."`);
      }
      console.log('----------------------------------------------------');
    });
    return;
  }

  const { creds, ownerUid } = await resolveDefaultCredentials();
  if (!creds) {
    console.error('❌ X公式APIの認証情報が見つかりません。');
    console.error('   ダッシュボードから公式APIキーを登録するか、.env に TWITTER_API_KEY を設定してください。');
    process.exit(1);
  }

  console.log(`✅ Using credentials of tenant: ${ownerUid}`);

  let targetUsers = [];
  let query = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--targets' && args[i + 1]) {
      targetUsers = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--query' && args[i + 1]) {
      query = args[i + 1].trim();
      i++;
    }
  }

  if (targetUsers.length === 0 && !query) {
    console.log('\n💡 [使用例]');
    console.log('  node scripts/harvest_buzz_intelligence.js --targets "VeloxSystemsV4,XDevelopers"');
    console.log('  node scripts/harvest_buzz_intelligence.js --query "B2B マーケティング"');
    console.log('  node scripts/harvest_buzz_intelligence.js --show-top');
    process.exit(0);
  }

  // 1. ターゲットアカウントの収集
  if (targetUsers.length > 0) {
    console.log(`\n🔍 Harvesting recent tweets from ${targetUsers.length} accounts: [${targetUsers.join(', ')}]...`);
    for (const u of targetUsers) {
      console.log(` -> Fetching @${u}...`);
      const res = await harvestUserTweets({
        credentials: creds,
        targetUsername: u,
        maxResults: 10,
        ownerUid
      });
      if (res.ok) {
        console.log(`    ✅ @${u}: ${res.totalFetched} tweets fetched, ${res.savedCount} new items saved to corpus.`);
      } else {
        console.warn(`    ⚠️ @${u} fetch warning: ${res.error}`);
      }
    }
  }

  // 2. キーワード検索での収集
  if (query) {
    console.log(`\n🔍 Harvesting tweets via Search API: "${query}"...`);
    const res = await harvestSearchTweets({
      credentials: creds,
      query,
      maxResults: 15,
      ownerUid
    });
    if (res.ok) {
      console.log(`    ✅ Query "${query}": ${res.totalFetched} tweets fetched, ${res.savedCount} new items saved to corpus.`);
    } else {
      console.warn(`    ⚠️ Search warning: ${res.error}`);
    }
  }

  console.log(`\n🎉 Harvest process complete! Output: ${CORPUS_JSONL_FILE}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
