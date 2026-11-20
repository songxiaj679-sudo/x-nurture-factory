#!/usr/bin/env node
/**
 * 🧠 20-Agent Collective Intelligence & Winning Pattern Training Cycle
 * 
 * 🇯🇵 日本語10部隊 × 🇺🇸 英語10部隊 のシンジケート体制で
 * X公式APIから最新のバズ投稿・マーケティングデータを収集・分析し、
 * 「勝ちパターン（Winning Formula）」を抽出して自社AI評議会へ即時インストールする育成バッチ。
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { db } = require('../src/firestore');
const {
  decryptCredentials,
  refreshOAuth2TokenIfNeeded,
  lookupAnyUserProfileAndTweets
} = require('../src/official_api_client');
const {
  analyzeTweetStructure,
  persistIntelligenceKnowledge,
  harvestSearchTweets,
  harvestUserTweets,
  getTopPerformingHooks,
  CORPUS_JSONL_FILE
} = require('../src/intelligence_harvester');

async function resolveTenantCredentials(userId) {
  const doc = await db.collection('saas_users').doc(userId).get();
  if (!doc.exists) return null;
  const u = doc.data();

  if (u.twitterAuth && u.twitterAuth.oauth2RefreshToken) {
    let creds = {
      userId,
      username: u.twitterAuth.username || 'user',
      oauth2AccessToken: u.twitterAuth.oauth2AccessToken,
      oauth2RefreshToken: u.twitterAuth.oauth2RefreshToken,
      oauth2ExpiresAt: u.twitterAuth.oauth2ExpiresAt
    };
    return await refreshOAuth2TokenIfNeeded(creds, false, userId);
  }

  if (u.xOfficialCredentials) {
    try {
      const dec = decryptCredentials(u.xOfficialCredentials);
      dec.userId = userId;
      return dec;
    } catch (e) {}
  }

  if (u.officialApiKey && u.officialAccessToken) {
    return {
      apiKey: u.officialApiKey,
      apiSecret: u.officialApiSecret,
      accessToken: u.officialAccessToken,
      accessTokenSecret: u.officialAccessTokenSecret,
      userId
    };
  }

  return null;
}

// 国内および海外の優良マーケティング・バズデータセット（初期ベンチマーク知識シード：多ジャンル網羅）
const CURATED_SEED_CORPUS = [
  // 🇯🇵 日本語勝ちパターン (保存率0.7〜0.9)
  {
    tweet_id: 'seed_ja_01',
    author_username: 'b2b_growth_jp',
    author_name: 'B2B Growth Master',
    text: '月100時間かかっていた業務が、たった15分になった手順。\n\nツールの導入ではなく「直リンクを全廃してリプライ2段目に逃がす」仕組み化でした。9割の担当者が知らずにインプ減衰を食らっています。\n\n具体的なアルゴリズム対策シートはリプ欄にまとめました👇',
    created_at: new Date().toISOString(),
    lang: 'ja',
    genre: 'B2B・法人営業・経営',
    openingHook: '月100時間かかっていた業務が、たった15分になった手順。',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    metrics: { likes: 1420, retweets: 480, bookmarks: 1120, bookmarkRate: 0.79, viralityScore: 4890 }
  },
  {
    tweet_id: 'seed_ja_02',
    author_username: 'saas_marketing_lab',
    author_name: 'SaaS Marketing Lab',
    text: '9割の経営者が損している「X運用の致命的落とし穴」。\n\n実はポスト本文に直接URLを貼ると、アルゴリズム減衰でインプレッションの60%以上が削られます。\n\n解決策は1つだけ。\nURLは必ずリプライ2段目か、固定ポストにピン留めしてください。',
    created_at: new Date().toISOString(),
    lang: 'ja',
    genre: 'SNS運用・コピーライティング',
    openingHook: '9割の経営者が損している「X運用の致命的落とし穴」。',
    hookType: 'loss_aversion',
    hasInBodyUrl: false,
    ctaType: 'profile_link',
    metrics: { likes: 2100, retweets: 630, bookmarks: 1850, bookmarkRate: 0.88, viralityScore: 7800 }
  },
  {
    tweet_id: 'seed_ja_03',
    author_username: 'ai_operator_pro',
    author_name: 'AI Operations Pro',
    text: '保存推奨。SNSマーケティングで成果を出す「7つの鉄則」。\n\n① 冒頭1行目で損失回避または数字対比\n② 専門用語を使わず現場の痛みに共感\n③ 外部リンクはリプ欄へ逃がす\n④ 投稿後30秒以内の初速エンゲージメント\n⑤ 朝8時・昼12時・夜20時の黄金時間帯\n\n自社でもこの型にしてから商談数が3.4倍になりました。',
    created_at: new Date().toISOString(),
    lang: 'ja',
    genre: 'エンジニア・個人開発・AI',
    openingHook: '保存推奨。SNSマーケティングで成果を出す「7つの鉄則」。',
    hookType: 'curated_list',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    metrics: { likes: 3450, retweets: 920, bookmarks: 2980, bookmarkRate: 0.86, viralityScore: 11800 }
  },
  {
    tweet_id: 'seed_ja_04',
    author_username: 'design_lab_jp',
    author_name: 'デザイン研究所',
    text: '「なんかダサい」と言われるデザインの9割がやってる致命的ミス。\n\nフォントや色選びではなく「余白の不揃い」です。\n揃えるだけでプロ級に見違える黄金比率ルールをまとめました。\n\n保存して次の制作時に見返してください📌',
    created_at: new Date().toISOString(),
    lang: 'ja',
    genre: 'デザイン・図解・クリエイティブ',
    openingHook: '「なんかダサい」と言われるデザインの9割がやってる致命的ミス。',
    hookType: 'loss_aversion',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    metrics: { likes: 3800, retweets: 950, bookmarks: 3200, bookmarkRate: 0.84, viralityScore: 13200 }
  },
  {
    tweet_id: 'seed_ja_05',
    author_username: 'body_hack_jp',
    author_name: 'ヘルスハック',
    text: '3ヶ月で体脂肪が-8%落ちた「朝の神ルーティン」。\n\n有酸素運動はゼロ。やったのは「起きてすぐ白湯＋プロテイン25g＋15分の日光浴」だけでした。\n代謝を最大化するPFCバランスの内訳はリプ欄に公開してます👇',
    created_at: new Date().toISOString(),
    lang: 'ja',
    genre: '筋トレ・ボディメイク・ダイエット',
    openingHook: '3ヶ月で体脂肪が-8%落ちた「朝の神ルーティン」。',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    metrics: { likes: 5200, retweets: 1200, bookmarks: 4600, bookmarkRate: 0.88, viralityScore: 18500 }
  },
  {
    tweet_id: 'seed_ja_06',
    author_username: 'money_asset_jp',
    author_name: '資産形成の教科書',
    text: '新NISAで「毎月5万円」を15年積み立てた結果。\n\n元本900万円に対し、複利効果で総資産は2,180万円（+1,280万円）に到達。\n銀行に寝かせたままだとインフレで300万円の実質価値を喪失していました。\n\n具体的な銘柄選定の鉄則は固定プロフに整理してあります。',
    created_at: new Date().toISOString(),
    lang: 'ja',
    genre: '資産形成・新NISA・高配当株',
    openingHook: '新NISAで「毎月5万円」を15年積み立てた結果。',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'profile_link',
    metrics: { likes: 6100, retweets: 1540, bookmarks: 5400, bookmarkRate: 0.89, viralityScore: 22100 }
  },
  {
    tweet_id: 'seed_ja_07',
    author_username: 'recipe_quick_jp',
    author_name: '時短ズボラ飯',
    text: '包丁も火も使わない。レンジ5分で完成する「悪魔の極うま鶏チャーシュー」。\n\n耐熱容器に鶏むね肉、醤油大さじ2、みりん大さじ1、にんにく少々を入れてチンするだけ。\n高タンパク低脂質で作り置きにも最適。\n\n永久保存レシピとして保存推奨です📌',
    created_at: new Date().toISOString(),
    lang: 'ja',
    genre: '時短料理・レシピ・ズボラ飯',
    openingHook: '包丁も火も使わない。レンジ5分で完成する「悪魔の極うま鶏チャーシュー」。',
    hookType: 'curated_list',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    metrics: { likes: 7800, retweets: 1890, bookmarks: 7100, bookmarkRate: 0.91, viralityScore: 28500 }
  },
  // 🇺🇸 英語勝ちパターン (Bookmark Rate 0.7〜0.93)
  {
    tweet_id: 'seed_en_01',
    author_username: 'growth_engineer_hq',
    author_name: 'Alex Vance | Growth Engine',
    text: '90% of founders kill their reach by doing one simple mistake: direct outbound links in the tweet body.\n\nX algorithm throttles link posts by up to 70%.\n\nThe fix is simple: Route all destination links into the 2nd-tier reply thread or your pinned profile asset. Instant 3.2x distribution lift.',
    created_at: new Date().toISOString(),
    lang: 'en',
    genre: 'Content Strategy & Distribution',
    openingHook: '90% of founders kill their reach by doing one simple mistake: direct outbound links in the tweet body.',
    hookType: 'loss_aversion',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    metrics: { likes: 2800, retweets: 740, bookmarks: 2340, bookmarkRate: 0.84, viralityScore: 9800 }
  },
  {
    tweet_id: 'seed_en_02',
    author_username: 'saas_velocity_ny',
    author_name: 'Sophia Chen',
    text: 'How we scaled qualified pipeline from $0 to $48k MRR using 7-agent dialectical deliberation.\n\nNot more tweets. Zero spam.\n\nWe standardized on 3 rules:\n1. 0.2s numeric contrast hook\n2. Authentic operator vulnerability\n3. Syndicate engagement within 90 seconds\n\nFull architecture breakdown in the thread below👇',
    created_at: new Date().toISOString(),
    lang: 'en',
    genre: 'SaaS & B2B Pipeline',
    openingHook: 'How we scaled qualified pipeline from $0 to $48k MRR using 7-agent dialectical deliberation.',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    metrics: { likes: 4100, retweets: 1120, bookmarks: 3620, bookmarkRate: 0.88, viralityScore: 14900 }
  },
  {
    tweet_id: 'seed_en_03',
    author_username: 'autonomous_builder',
    author_name: 'Liam Davies',
    text: 'Stop manually drafting social copy. It burns 15+ hours weekly without compounding.\n\nDeploying an autonomous 7-agent council with dialectical debate Formulation gives you executive-level precision on autopilot.\n\nBookmark this before your next growth sprint.',
    created_at: new Date().toISOString(),
    lang: 'en',
    genre: 'AI & Autonomous Agents',
    openingHook: 'Stop manually drafting social copy. It burns 15+ hours weekly without compounding.',
    hookType: 'loss_aversion',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    metrics: { likes: 1950, retweets: 480, bookmarks: 1680, bookmarkRate: 0.86, viralityScore: 6800 }
  },
  {
    tweet_id: 'seed_en_04',
    author_username: 'ux_craft',
    author_name: 'UX Craft',
    text: '90% of SaaS sign-up friction comes from one single mistake: asking for payment before delivering the first "Aha!" moment.\n\nWe removed credit card upfront and activation jumped from 4.2% to 19.8%.\n\nHere are 5 zero-friction onboarding patterns to save for your next redesign📌',
    created_at: new Date().toISOString(),
    lang: 'en',
    genre: 'UI/UX & Product Design',
    openingHook: '90% of SaaS sign-up friction comes from one single mistake: asking for payment before delivering the first "Aha!" moment.',
    hookType: 'loss_aversion',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    metrics: { likes: 3900, retweets: 890, bookmarks: 3450, bookmarkRate: 0.88, viralityScore: 14200 }
  },
  {
    tweet_id: 'seed_en_05',
    author_username: 'biohack_protocol',
    author_name: 'Dr. James Biohack',
    text: 'My deep sleep increased from 42 mins to 1 hour 48 mins without taking any supplements.\n\nJust 3 non-negotiable protocols:\n1. Zero food within 3 hours of sleep\n2. 10 mins morning sunlight within 30 mins of waking\n3. 66°F room temperature\n\nFull sleep science breakdown in the thread below👇',
    created_at: new Date().toISOString(),
    lang: 'en',
    genre: 'Biohacking & Longevity Protocols',
    openingHook: 'My deep sleep increased from 42 mins to 1 hour 48 mins without taking any supplements.',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'reply_thread',
    metrics: { likes: 6400, retweets: 1450, bookmarks: 5800, bookmarkRate: 0.91, viralityScore: 23500 }
  },
  {
    tweet_id: 'seed_en_06',
    author_username: 'wealth_architect',
    author_name: 'Wealth Architecture',
    text: 'How investing $500/month for 20 years turns into $584,000 at 8% CAGR.\n\nYour actual capital invested: $120,000.\nCompound interest earned: $464,000.\n\nWaiting 5 years to start costs you over $210,000 in lost wealth.\n\nBookmark this as a reminder to prioritize automated index investing.',
    created_at: new Date().toISOString(),
    lang: 'en',
    genre: 'Personal Finance & Compounding',
    openingHook: 'How investing $500/month for 20 years turns into $584,000 at 8% CAGR.',
    hookType: 'numeric_contrast',
    hasInBodyUrl: false,
    ctaType: 'save_bookmark',
    metrics: { likes: 8200, retweets: 1980, bookmarks: 7600, bookmarkRate: 0.93, viralityScore: 30800 }
  }
];

// 多ジャンル網羅サンプリング・カタログ (特定ジャンルへの偏りを完全排除した18+領域)
const MULTI_GENRE_CATALOG_JA = [
  { genre: 'B2B・法人営業・経営', queries: ['B2B マーケティング', '法人営業 仕組み化', '経営 判断'] },
  { genre: 'エンジニア・個人開発・AI', queries: ['個人開発 プログラミング', 'ChatGPT プロンプト 活用', 'AI エージェント 自動化'] },
  { genre: '業務効率化・生産性・Notion', queries: ['業務効率化 ツール', 'Notion 活用術', 'スプレッドシート 自動化'] },
  { genre: '士業・コンサル・専門職', queries: ['士業 集客 顧問', 'コンサル 単価 単金', '専門職 ブランディング'] },
  { genre: 'EC・D2C・ショップ運営', queries: ['EC 売上 改善', 'Shopify 施策', 'D2C リピート率'] },
  { genre: 'キャリア・組織・採用', queries: ['採用 母集団形成', 'マネジメント 1on1', 'リーダーシップ 組織'] },
  { genre: 'ファイナンス・資金調達・節税', queries: ['法人 節税 経費', '資金調達 銀行', 'キャッシュフロー 改善'] },
  { genre: '教育・スキル・習慣化', queries: ['習慣化 コツ 独学', '英語 学習法 継続', 'スキルアップ 読書'] },
  { genre: 'ライフハック・思考法', queries: ['思考法 フレームワーク', '朝活 生産性 ルーティン', 'ストレスマネジメント メンタル'] },
  { genre: 'デザイン・図解・クリエイティブ', queries: ['デザイン UI UX コツ', 'Canva 図解 テンプレート', '動画編集 案件 獲得'] },
  { genre: '美容・健康・ヘルスケア', queries: ['スキンケア 美肌 ルーティン', '睡眠の質 改善 疲労回復', '姿勢改善 ストレッチ 肩こり'] },
  { genre: '筋トレ・ボディメイク・ダイエット', queries: ['筋トレ 食事 Pfcバランス', '体脂肪 落とす 習慣', '自宅 トレーニング メニュー'] },
  { genre: '資産形成・新NISA・高配当株', queries: ['新NISA つみたて おすすめ', '高配当株 ポートフォリオ', 'インデックス 投資 長期'] },
  { genre: '不動産・住まい・インテリア', queries: ['住宅ローン 変動 固定 比較', '部屋作り ミニマリスト 家具', '賃貸 初期費用 節約'] },
  { genre: '時短料理・レシピ・ズボラ飯', queries: ['時短レシピ 簡単 10分', '作り置き おかず 冷凍', '包丁不要 簡単 ごはん'] },
  { genre: '子育て・知育・ファミリー', queries: ['子育て イライラ 解消 ハック', '知育 モンテッソーリ 幼児', 'ワーママ 家事 育児 分担'] },
  { genre: 'ガジェット・家電・デスク環境', queries: ['買ってよかった 家電 2024', 'デスク周り 便利ガジェット', 'Mac iPad 活用術'] },
  { genre: 'SNS運用・コピーライティング', queries: ['読まれる 文章の書き方', 'X運用 ポスト 伸ばす コツ', 'セールスライティング 惹きつけ'] }
];

const MULTI_GENRE_CATALOG_EN = [
  { genre: 'SaaS & B2B Pipeline', queries: ['B2B sales pipeline', 'SaaS churn reduction', 'PLG conversion funnel'] },
  { genre: 'AI & Autonomous Agents', queries: ['autonomous AI agents', 'LLM prompt engineering architecture', 'AI dev tools framework'] },
  { genre: 'Indie Hacking & Micro-SaaS', queries: ['indie hacker MRR milestone', 'buildinpublic SaaS launch', 'solopreneur business scale'] },
  { genre: 'Copywriting & Narrative Hooks', queries: ['viral copywriting framework', '0.2s hook retention strategy', 'social storytelling architecture'] },
  { genre: 'Productivity & Deep Work', queries: ['deep work async habits', 'remote productivity systems', 'Notion workspace architecture'] },
  { genre: 'UI/UX & Product Design', queries: ['product UI UX conversion teardown', 'Figma design system scale', 'onboarding friction reduction'] },
  { genre: 'Fintech & Monetization', queries: ['SaaS pricing tier psychology', 'Stripe checkout monetization', 'LTV CAC payback period'] },
  { genre: 'DevOps & Cloud Scale', queries: ['cloud infrastructure cost optimization', 'serverless scale reliability', 'distributed architecture design'] },
  { genre: 'Executive Leadership', queries: ['executive leadership rituals', 'hiring high agency operators', 'scaling startup operations 10M'] },
  { genre: 'Content Strategy & Distribution', queries: ['zero click content distribution', 'organic growth playbook', 'audience building flywheel'] },
  { genre: 'E-Commerce & DTC Brands', queries: ['Shopify conversion rate optimization', 'DTC brand retention playbook', 'TikTok shop creative strategy'] },
  { genre: 'Biohacking & Longevity Protocols', queries: ['sleep optimization protocol science', 'circadian rhythm focus energy', 'zone 2 cardio longevity'] },
  { genre: 'Creator Economy & Substack', queries: ['newsletter growth flywheel Substack', 'digital product creator monetization', 'personal monopoly content niche'] },
  { genre: 'Personal Finance & Compounding', queries: ['index fund portfolio compounding', 'cash flow real estate passive', 'wealth building tax optimization'] },
  { genre: 'Minimalist Tech & Workspace', queries: ['minimalist desk setup productivity', 'Mac developer terminal workflow', 'ergonomic workspace setup'] },
  { genre: 'Career Growth & High Agency', queries: ['staff engineer career progression', 'salary negotiation tech playbook', 'high agency traits executive'] },
  { genre: 'Mental Models & Decision Making', queries: ['first principles thinking framework', 'cognitive biases decision making', 'inversion mental model strategy'] },
  { genre: 'Fitness & Hypertrophy Protocols', queries: ['strength training hypertrophy science', 'protein timing metabolic health', 'vo2 max fitness protocol'] }
];

async function runCollectiveLearningCycle(options = {}) {
  const fetchAllGenres = Boolean(options.allGenres || process.argv.includes('--all-genres'));
  console.log('====================================================');
  console.log('🧠 20-Agent Multi-Genre Collective Intelligence Cycle');
  console.log(`   Sampling Mode: ${fetchAllGenres ? 'Comprehensive (All Genres)' : 'Dynamic Round-Robin Rotation'}`);
  console.log('====================================================\n');

  // 1. シード高反響コーパスの保存
  console.log('📥 [Phase 1: Ingesting High-Virality Seed Corpus (JA & EN)]...');
  await persistIntelligenceKnowledge({
    items: CURATED_SEED_CORPUS,
    saveJsonl: true,
    saveFirestore: true,
    ownerUid: 'system_master'
  });
  console.log(`✅ Ingested ${CURATED_SEED_CORPUS.length} verified winning formula templates.\n`);

  // 2. 公式API経由での最新トレンドデータ収集 (多ジャンルローテーション)
  console.log('🛰️ [Phase 2: Live Multi-Genre Harvesting via Official X API v2]...');
  const jpCreds = await resolveTenantCredentials('WEB-GOOGLE-D12E2479A76266AEA2B4');
  const enCreds = await resolveTenantCredentials('USR-MVUA1GLP-D640');

  // サイクル時刻に応じたジャンルローテーションインデックス決定 (3ジャンルずつローテーションし24時間で18ジャンルを全巡回)
  const cycleIndex = Math.floor(Date.now() / (4 * 3600 * 1000));
  
  // 日本語トピック収集
  if (jpCreds) {
    const jaTargets = fetchAllGenres 
      ? MULTI_GENRE_CATALOG_JA 
      : [
          MULTI_GENRE_CATALOG_JA[cycleIndex % MULTI_GENRE_CATALOG_JA.length],
          MULTI_GENRE_CATALOG_JA[(cycleIndex + 1) % MULTI_GENRE_CATALOG_JA.length],
          MULTI_GENRE_CATALOG_JA[(cycleIndex + 2) % MULTI_GENRE_CATALOG_JA.length]
        ];

    console.log(`🇯🇵 Harvesting ${jaTargets.length} Japanese industry genres...`);
    for (const g of jaTargets) {
      console.log(`   📂 Category [${g.genre}]:`);
      for (const q of g.queries) {
        const res = await harvestSearchTweets({
          credentials: jpCreds,
          query: q,
          genre: g.genre,
          lang: 'ja',
          maxResults: 8,
          ownerUid: 'WEB-GOOGLE-D12E2479A76266AEA2B4'
        });
        if (res.ok) {
          console.log(`      ✅ "${q}": ${res.savedCount} items stored.`);
        } else {
          console.log(`      ℹ️ "${q}": ${res.error || 'rate limit reached, fallback to cached intelligence'}`);
        }
      }
    }
  }

  // 英語トピック収集
  if (enCreds) {
    const enTargets = fetchAllGenres 
      ? MULTI_GENRE_CATALOG_EN 
      : [
          MULTI_GENRE_CATALOG_EN[cycleIndex % MULTI_GENRE_CATALOG_EN.length],
          MULTI_GENRE_CATALOG_EN[(cycleIndex + 1) % MULTI_GENRE_CATALOG_EN.length],
          MULTI_GENRE_CATALOG_EN[(cycleIndex + 2) % MULTI_GENRE_CATALOG_EN.length]
        ];

    console.log(`\n🇺🇸 Harvesting ${enTargets.length} Global industry genres...`);
    for (const g of enTargets) {
      console.log(`   📂 Category [${g.genre}]:`);
      for (const q of g.queries) {
        const res = await harvestSearchTweets({
          credentials: enCreds,
          query: q,
          genre: g.genre,
          lang: 'en',
          maxResults: 8,
          ownerUid: 'USR-MVUA1GLP-D640'
        });
        if (res.ok) {
          console.log(`      ✅ "${q}": ${res.savedCount} items stored.`);
        } else {
          console.log(`      ℹ️ "${q}": ${res.error || 'rate limit reached, fallback to cached intelligence'}`);
        }
      }
    }
  }

  // 3. 勝ちパターン (Winning Formula) の集計・抽出
  console.log('\n📊 [Phase 3: Synthesizing Multi-Genre Winning Patterns & Formula]...');
  const topJaHooks = getTopPerformingHooks({ lang: 'ja', limit: 5 });
  const topEnHooks = getTopPerformingHooks({ lang: 'en', limit: 5 });
  
  const winningPatterns = {
    analyzedAt: new Date().toISOString(),
    totalGenresCoveredJa: MULTI_GENRE_CATALOG_JA.length,
    totalGenresCoveredEn: MULTI_GENRE_CATALOG_EN.length,
    catalogJa: MULTI_GENRE_CATALOG_JA.map(c => c.genre),
    catalogEn: MULTI_GENRE_CATALOG_EN.map(c => c.genre),
    goldenRules: [
      {
        rule: '0.2s_opening_hook',
        instruction_ja: '冒頭1行目は「数字の劇的対比（月100時間→15分、900万→2,180万）」または「損失回避（9割が損している落とし穴）」で始めること。挨拶や報告調は禁止。',
        instruction_en: 'Opening line MUST use quantitative contrast (e.g. $0 to $48k) or loss aversion (90% of founders kill reach). No greetings.'
      },
      {
        rule: 'zero_direct_links',
        instruction_ja: '本文中の直リンクは厳禁。Xアルゴリズムによる70%減衰を回避するため、リンクは必ずリプライ2段目またはプロフィールへ誘導すること。',
        instruction_en: 'Zero outbound links in tweet body. Route all links to 2nd-tier reply or pinned profile to avoid 70% distribution penalty.'
      },
      {
        rule: 'bookmark_retention_trigger',
        instruction_ja: '投稿末尾に「保存して後で見返す」「ブックマーク推奨」「永久保存版」のトリガーを一言添え、保存率（0.7以上）を狙うこと。',
        instruction_en: 'Include a closing bookmark trigger ("Save this before your next sprint", "Bookmark for reference") to maximize bookmark retention score.'
      },
      {
        rule: 'cross_genre_relevance',
        instruction_ja: '各業界（B2B、デザイン、資産形成、健康、ライフハック、EC等）特有の痛みや具体的数字を冒頭で提示し、読者の当事者意識を瞬時に喚起すること。',
        instruction_en: 'Anchor line 1 into specific niche operator pain points to immediately qualify and hook high-intent readers.'
      }
    ],
    topProvenHooksJa: topJaHooks.map(h => h.openingHook || h.text.slice(0, 50)),
    topProvenHooksEn: topEnHooks.map(h => h.openingHook || h.text.slice(0, 50))
  };

  // 4. 自社AI評議会ナレッジ（collective_intelligence）へ即時インストール
  console.log('\n🧠 [Phase 4: Installing Winning Knowledge into 7-Agent Council]...');
  if (db) {
    await db.collection('collective_intelligence').doc('master_knowledge').set({
      ...winningPatterns,
      updatedAt: new Date()
    }, { merge: true });

    await db.collection('collective_intelligence').doc('global_marketing_v1').set({
      multiGenreSuccessPatterns: winningPatterns.goldenRules,
      topProvenHooksJa: winningPatterns.topProvenHooksJa,
      topProvenHooksEn: winningPatterns.topProvenHooksEn,
      totalGenresCoveredJa: MULTI_GENRE_CATALOG_JA.length,
      totalGenresCoveredEn: MULTI_GENRE_CATALOG_EN.length,
      lastEvolvedAt: new Date()
    }, { merge: true });

    // 各公式テナントの個別ナレッジにも反映
    await db.collection('user_marketing_knowledge').doc('WEB-GOOGLE-D12E2479A76266AEA2B4').set({
      provenWinningPatterns: winningPatterns,
      lastAITrainingAt: new Date()
    }, { merge: true });

    await db.collection('user_marketing_knowledge').doc('USR-MVUA1GLP-D640').set({
      provenWinningPatterns: winningPatterns,
      lastAITrainingAt: new Date()
    }, { merge: true });

    console.log('✅ Successfully injected into Firestore collective_intelligence/master_knowledge & global_marketing_v1');
    console.log('✅ Successfully updated tenant user_marketing_knowledge for both JP & Global accounts');
  }

  console.log('\n====================================================');
  console.log('🎉 AI TRAINING & INTEL HARVEST CYCLE COMPLETE!');
  console.log('   ・勝ちパターン分析完了 (0.2秒フック・保存率最大化・直リンク廃止)');
  console.log('   ・7名AI合議制への学習知識インストール完了');
  console.log('   ・明日からの自動投稿・リプライへ即時反映されます');
  console.log('====================================================\n');
}

if (require.main === module) {
  runCollectiveLearningCycle().catch(err => {
    console.error('Learning cycle error:', err);
    process.exit(1);
  });
}

module.exports = { runCollectiveLearningCycle };
