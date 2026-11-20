#!/usr/bin/env node
/**
 * 📚 Seed Diverse Buzz Corpus (Underdog Outliers, Split Long-Form Threads, Multi-Genre Cross Inspiration)
 * 
 * ユーザー要求に対応:
 * 1. 単発だけでなく「リプライに続きを書く分割長文投稿（スレッド）」の構造データを拡充
 * 2. TOP10の偏りを防ぐため、他ジャンル（異業種）の多角的サンプルを網羅
 * 3. 大手アカウントの自明な数字ではなく「フォロワーが少ないのにバズった弱小下剋上アカウント」の異常値データを注入
 */

const fs = require('fs');
const path = require('path');
const { persistIntelligenceKnowledge, CORPUS_JSONL_FILE } = require('../src/intelligence_harvester');

const DIVERSE_SEED_ITEMS = [
  // =========================================================================
  // ⚡ 弱小アカウント下剋上バズ（フォロワー200〜900人なのに1,000〜3,500反響獲得）
  // =========================================================================
  {
    tweet_id: 'underdog_ja_01',
    author_username: 'dev_taro_junior',
    author_name: '駆け出し個人開発者たろう',
    author_followers: 320,
    lang: 'ja',
    genre: 'エンジニア・個人開発・AI',
    postFormat: 'single_impact',
    isSplitThread: false,
    text: '「個人開発で月5万円稼ぐの無理ゲーだろ」と諦めてた過去の自分に言いたい。\n\n機能増やすの全部やめて「直リンク排除＋1枚のLPだけで予約受付」に絞ったら、リリース3日で有料課金18件ついた。技術力じゃなくて見せ方の問題だった。',
    openingHook: '「個人開発で月5万円稼ぐの無理ゲーだろ」と諦めてた過去の自分に言いたい。',
    hookType: 'story_empathy',
    hasInBodyUrl: false,
    ctaType: 'none',
    charLength: 128,
    isUnderdogBuzz: true,
    outlierMultiplier: 7.2,
    metrics: {
      likes: 1850,
      retweets: 420,
      replies: 45,
      quotes: 18,
      bookmarks: 980,
      impressions: 48500,
      bookmarkRate: 0.53,
      viralityScore: 4910,
      cloutAdjustedScore: 9500,
      outlierMultiplier: 7.2,
      isUnderdogBuzz: true,
      authorFollowers: 320
    }
  },
  {
    tweet_id: 'underdog_ja_02',
    author_username: 'zubora_cook_ol',
    author_name: '残業後ズボラ飯OL',
    author_followers: 480,
    lang: 'ja',
    genre: '時短料理・レシピ・ズボラ飯',
    postFormat: 'single_impact',
    isSplitThread: false,
    text: '月40時間残業の限界OLがたどり着いた、包丁もフライパンも使わない「豚バラもやし蒸し」。\n\n耐熱皿に敷いてポン酢とごま油回しかけてレンジ4分。\n洗い物ゼロでコンビニ弁当より安くて美味い。保存して今夜試してみて📌',
    openingHook: '月40時間残業の限界OLがたどり着いた、包丁もフライパンも使わない「豚バラもやし蒸し」。',
    hookType: 'loss_aversion',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    charLength: 122,
    isUnderdogBuzz: true,
    outlierMultiplier: 5.8,
    metrics: {
      likes: 2400,
      retweets: 610,
      replies: 38,
      quotes: 22,
      bookmarks: 1650,
      impressions: 62000,
      bookmarkRate: 0.69,
      viralityScore: 8127,
      cloutAdjustedScore: 12800,
      outlierMultiplier: 5.8,
      isUnderdogBuzz: true,
      authorFollowers: 480
    }
  },
  {
    tweet_id: 'underdog_ja_03',
    author_username: 'nisa_fire_rookie',
    author_name: '手取り20万からの高配当',
    author_followers: 650,
    lang: 'ja',
    genre: '資産形成・新NISA・高配当株',
    postFormat: 'single_impact',
    isSplitThread: false,
    text: '手取り20万・貯金30万から4年で500万貯めた友人の口癖。\n\n「スタバ我慢するより、スマホ格安SIMにして保険見直すほうが100倍楽」。\n\n毎日の小銭を削って疲弊するのやめな。固定費削れば勝手に年間48万浮く。保存推奨📌',
    openingHook: '手取り20万・貯金30万から4年で500万貯めた友人の口癖。',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    charLength: 132,
    isUnderdogBuzz: true,
    outlierMultiplier: 4.6,
    metrics: {
      likes: 1980,
      retweets: 510,
      replies: 28,
      quotes: 16,
      bookmarks: 1420,
      impressions: 51000,
      bookmarkRate: 0.72,
      viralityScore: 7567,
      cloutAdjustedScore: 10400,
      outlierMultiplier: 4.6,
      isUnderdogBuzz: true,
      authorFollowers: 650
    }
  },
  {
    tweet_id: 'underdog_en_01',
    author_username: 'solobuilder_eth',
    author_name: 'Alex Solo Dev',
    author_followers: 410,
    lang: 'en',
    genre: 'AI Agents & LLM Dev',
    postFormat: 'single_impact',
    isSplitThread: false,
    text: "Spent 4 months coding a complex SaaS. Made $0.\n\nThen spent 4 hours building a simple 1-click prompt workflow. Made $1,200 this weekend.\n\nStop building what sounds technically impressive. Build what removes painful manual friction immediately.",
    openingHook: "Spent 4 months coding a complex SaaS. Made $0.",
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'none',
    charLength: 236,
    isUnderdogBuzz: true,
    outlierMultiplier: 6.5,
    metrics: {
      likes: 2150,
      retweets: 480,
      replies: 86,
      quotes: 34,
      bookmarks: 1100,
      impressions: 72000,
      bookmarkRate: 0.51,
      viralityScore: 6704,
      cloutAdjustedScore: 11200,
      outlierMultiplier: 6.5,
      isUnderdogBuzz: true,
      authorFollowers: 410
    }
  },

  // =========================================================================
  // 🧵 分割長文投稿・ツリー投稿（リプライに続きを書く2〜3段構造）
  // =========================================================================
  {
    tweet_id: 'thread_ja_01',
    author_username: 'b2b_funnel_architect',
    author_name: 'B2Bファネル設計士',
    author_followers: 3200,
    lang: 'ja',
    genre: 'B2B・法人営業・経営',
    postFormat: 'split_thread',
    isSplitThread: true,
    threadLength: 2,
    threadTweets: [
      '月100時間かかっていた法人営業のテレアポが、たった15分のX自動運用になった手順。\n\nツールの導入ではなく「直リンク全廃＋リプ欄への逃がし」でした。9割の営業部長が知らずにインプ減衰で損しています。\n\n現場で使っている具体的な3大原則をリプ欄にまとめました👇',
      '【Xアルゴリズム攻略の3大原則】\n\n① 本文にURLを置かない（インプ70%減衰を完全回避）\n② 冒頭1行目で損失回避または数字対比（0.2秒で親指停止）\n③ 投稿直後の初速エンゲージメントを確保\n\n自社でもこの手順を徹底してから商談数が3.4倍になりました。保存して後で見返してください📌'
    ],
    text: '月100時間かかっていた法人営業のテレアポが、たった15分のX自動運用になった手順。\n\nツールの導入ではなく「直リンク全廃＋リプ欄への逃がし」でした。9割の営業部長が知らずにインプ減衰で損しています。\n\n現場で使っている具体的な3大原則をリプ欄にまとめました👇',
    openingHook: '月100時間かかっていた法人営業のテレアポが、たった15分のX自動運用になった手順。',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    charLength: 142,
    isUnderdogBuzz: false,
    outlierMultiplier: 1.8,
    metrics: {
      likes: 3100,
      retweets: 890,
      replies: 120,
      quotes: 45,
      bookmarks: 2450,
      impressions: 98000,
      bookmarkRate: 0.79,
      viralityScore: 11505,
      cloutAdjustedScore: 10800,
      outlierMultiplier: 1.8,
      isUnderdogBuzz: false,
      authorFollowers: 3200
    }
  },
  {
    tweet_id: 'thread_ja_02',
    author_username: 'uiux_design_system',
    author_name: 'UI/UXデザイナー健',
    author_followers: 1800,
    lang: 'ja',
    genre: 'デザイン・UI/UX・図解',
    postFormat: 'split_thread',
    isSplitThread: true,
    threadLength: 3,
    threadTweets: [
      '「デザインセンスがない」と悩んでいる非デザイナーへ。\n\n実はプロが作るときに守っているルールは「センス」ではなく「引き算の数学」です。これを知るだけでダサい資料が劇的に洗練されます。\n\n今日から使える5つの鉄則をリプに分解しました👇',
      '【非デザイナーのための5大原則】\n\n1. 色は3色以内（ベース70%、メイン25%、アクセント5%）\n2. フォントは1種類だけに統一\n3. 余白は「広すぎるかな」と思うくらい空ける\n4. 数字だけフォントサイズを1.5倍にする\n5. 揃える軸を必ず1本通す',
      'センスではなく構造を覚えるだけで、クライアントの成約率が2倍変わります。\n\n社内資料やプレゼン作成ですぐ見返せるように、保存推奨です📌'
    ],
    text: '「デザインセンスがない」と悩んでいる非デザイナーへ。\n\n実はプロが作るときに守っているルールは「センス」ではなく「引き算の数学」です。これを知るだけでダサい資料が劇的に洗練されます。\n\n今日から使える5つの鉄則をリプに分解しました👇',
    openingHook: '「デザインセンスがない」と悩んでいる非デザイナーへ。',
    hookType: 'loss_aversion',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    charLength: 138,
    isUnderdogBuzz: true,
    outlierMultiplier: 3.2,
    metrics: {
      likes: 2850,
      retweets: 740,
      replies: 95,
      quotes: 32,
      bookmarks: 2150,
      impressions: 84000,
      bookmarkRate: 0.75,
      viralityScore: 10142,
      cloutAdjustedScore: 11500,
      outlierMultiplier: 3.2,
      isUnderdogBuzz: true,
      authorFollowers: 1800
    }
  },
  {
    tweet_id: 'thread_en_01',
    author_username: 'agency_architect_io',
    author_name: 'Agency Architect',
    author_followers: 2400,
    lang: 'en',
    genre: 'SaaS & B2B Pipeline Growth',
    postFormat: 'split_thread',
    isSplitThread: true,
    threadLength: 2,
    threadTweets: [
      "Why 90% of SaaS founders fail at social distribution on X:\n\nThey write tweets like marketing press releases. Nobody logs onto X to read a corporate brochure.\n\nHere is the 3-step high-agency distribution funnel we use to generate $30k MRR organically👇",
      "【The Stealth Zero-Link Protocol】\n\n1. The Hook: Identify an expensive, painful bottleneck with an exact number.\n2. The Body: Give away the exact playbook for free in the thread (creates extreme debt of gratitude).\n3. The Funnel: Never paste a raw link. Route qualified readers to your pinned profile.\n\nBookmark this framework📌"
    ],
    text: "Why 90% of SaaS founders fail at social distribution on X:\n\nThey write tweets like marketing press releases. Nobody logs onto X to read a corporate brochure.\n\nHere is the 3-step high-agency distribution funnel we use to generate $30k MRR organically👇",
    openingHook: "Why 90% of SaaS founders fail at social distribution on X:",
    hookType: 'question_hook',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    charLength: 248,
    isUnderdogBuzz: false,
    outlierMultiplier: 2.1,
    metrics: {
      likes: 2600,
      retweets: 680,
      replies: 110,
      quotes: 48,
      bookmarks: 1850,
      impressions: 78000,
      bookmarkRate: 0.71,
      viralityScore: 9115,
      cloutAdjustedScore: 9500,
      outlierMultiplier: 2.1,
      isUnderdogBuzz: false,
      authorFollowers: 2400
    }
  }
];

async function seed() {
  console.log('🌱 Seeding Diverse Buzz Corpus (Underdogs, Threads, Cross-Genre)...');
  const res = await persistIntelligenceKnowledge({
    items: DIVERSE_SEED_ITEMS,
    saveJsonl: true,
    saveFirestore: false,
    ownerUid: 'system_curated'
  });
  console.log(`✅ Saved ${res.savedCount} diverse items to ${CORPUS_JSONL_FILE}`);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
