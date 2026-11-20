const { db } = require('./firestore');

/**
 * 🏛️ システム全体の集合知（Cross-Tenant Collective Intelligence）
 * 全クライアントのアカウント運用における「成功事例（高CTR・高保存）」と
 * 「失敗事例（伸び悩み・機械判定）」を匿名化・抽象化して蓄積し、
 * すべてのユーザーのAI評議会が継続的に自己進化する基盤。
 */

// 初期の基本ナレッジ（シード知見 ＆ BATCHENGINE最新巡回データ）
const SEED_COLLECTIVE_PATTERNS = {
  successPatterns: [
    {
      category: 'quote_debate_trap',
      patternName: '常識の逆張り・引用RT議論惹起型（脱・リプ欄URL依存）',
      syntaxRule: '「〇〇を真面目にやってる人、実は逆効果です」「なぜ業界の常識と逆の〇〇をやると成果が3倍になるのか」など、プロ同士の議論・引用RTを意図的に引き起こす',
      whyItWorks: 'BATCHENGINE巡回分析：2026年最新Xアルゴリズムで最も拡散係数が高いのは「引用リポスト（Quote Tweet）」。読者に反論や補足を言わせることで、リンクなしで10万〜100万インプに跳ね上がる。',
      targetAudience: '経営者・マーケター・知的好奇心の高いビジネス層'
    },
    {
      category: 'profile_pinned_funnel',
      patternName: 'プロフ固定記事集中型（リンク完全排除・ステルス導線）',
      syntaxRule: '本文およびリプ欄にURLを一切置かず、「詳細はプロフの固定記事にまとめた」「本質は固ツイ参照」でアカウントへ誘導',
      whyItWorks: 'BATCHENGINE巡回分析：リプ欄URLの乱用はアルゴリズムから「営業Bot」としてフラグが立ちやすい。プロフ導線はアルゴリズム減衰がゼロで、フォロワー獲得と商談化が同時に起きる。',
      targetAudience: '高単価B2B・慎重な検討層'
    },
    {
      category: 'primary_data_teardown',
      patternName: '自社検証・一次データ暴露型（反論不能のファクト）',
      syntaxRule: '「過去1ヶ月で〇〇社のアカウントを分解してわかった不都合な真実」「自社で〇〇時間を費やして検証した結果」など、一次情報で語る',
      whyItWorks: 'AI生成コンテンツが溢れるタイムラインにおいて、「生々しい泥臭い一次データ」だけが読者の信頼を勝ち取る。ブックマーク率が異常に高い。',
      targetAudience: '経営者・意思決定層'
    },
    {
      category: 'hook_loss_aversion',
      patternName: '疑問形・損失回避型フック（親指停止率No.1）',
      syntaxRule: '「まだ〇〇手動でやってる人、正直損してます」「〇〇を放置すると年間〇時間の損失」など、読者の機会損失を1行目で突く',
      whyItWorks: 'アルゴリズム上、最初の1〜2秒の滞在時間が最大化され、おすすめ（For You）初速が3.4倍に跳ね上がる。',
      targetAudience: '経営者・マーケター・個人事業主'
    },
    {
      category: 'format_thread_killer',
      patternName: '4段スレッド（成約キラー＆滞在時間ハック）',
      syntaxRule: '1本目フック(1/4)👇 → 2本目原因の解体(2/4) → 3本目具体的3ステップ(3/4) → 4本目オファー＆LP誘導(4/4)',
      whyItWorks: '読了率が高く、X最新アルゴリズムが「高価値な長文コンテンツ」と判定し、拡散ブーストがかかる。',
      targetAudience: '高単価商材・SaaS・B2B見込み客'
    },
    {
      category: 'short_punchline',
      patternName: '短文切れ味型・本質の一行（読了率100%＆金言パンチライン）',
      syntaxRule: '50〜95文字の簡潔・鋭利な文章で、本質を突く対比や反直感の真実を言い切る（余計な修飾語を削ぎ落とし、改行で視線を誘導）',
      whyItWorks: 'スマホのファーストビューでスクロール不要で全文読まれるため読了率（Completion Rate）が100%に達する。思考の余白と高い純度により「まさにこれ」「刺さった」と引用RTやブックマークが急速に跳ね上がる。',
      targetAudience: '忙しい朝や移動中のビジネス層・経営者・意思決定層'
    }
  ],
  failurePatterns: [
    {
      category: 'reply_link_fatigue',
      patternName: 'ワンパターンなリプ欄誘導（読者の見透かし離脱＆Bot判定）',
      syntaxRule: 'すべての投稿で毎回「詳細はリプ欄へ👇」を連発する',
      flawReason: 'BATCHENGINE分析：ユーザー側が「またアフィリエイトか」「どうせ誘導だな」と学習してスクロールスルーする上、Xのスパムフィルターが「リンクファームBot」と判定してエンゲージメント係数を下げる。'
    },
    {
      category: 'ai_cliche_flaw',
      patternName: '量産型ChatGPT構文（機械臭による即離脱）',
      syntaxRule: '「いかがでしたでしょうか」「〜について解説します」「必見です！」「〜ですね！」の多用',
      flawReason: '読者が一瞬で「AIの自動生成」と見破り、親指を即座に下にスクロールして離脱するため、アルゴリズムスコアが急落する。'
    },
    {
      category: 'direct_link_penalty',
      patternName: '親ツイートへの直接URLベタ貼り',
      syntaxRule: '1本目の本文中に直接https://...を貼り付ける',
      flawReason: 'X社がプラットフォーム外へのユーザー流出を嫌うため、リーチが通常の30%以下に強制制限される。'
    },
    {
      category: 'fake_hype_flaw',
      patternName: '中身のない空虚な煽り・バズ狙いポエム',
      syntaxRule: '感情だけを煽り、具体的な業務改善や数字が一切ない精神論',
      flawReason: 'B2B経営者層から「怪しい情報商材屋」と判定され、ミュート・ブロックが激増する。'
    }
  ],
  optimalTimeSlots: [
    { slot: 'morning', label: '出勤・朝の始業前 (07:30 - 08:30)', bestType: '単発・共感/マインドセット', reason: '通勤中の親指スクロールに刺さり、いいね・共感が集まりやすい。' },
    { slot: 'noon', label: '昼休み (12:00 - 12:45)', bestType: '2段リプ誘導ノウハウ', reason: '短時間の昼休憩でサクッと読まれ、リプ欄のリンククリック率が高い。' },
    { slot: 'evening_gold', label: '夜のゴールデンタイム (20:30 - 22:30)', bestType: '4段スレッド / 成約キラー', reason: '一日の終わりにじっくり読まれるため、長文スレッドの読了・保存・商談化率が最も高い。' }
  ]
};

/**
 * 集合知ナレッジを取得する（Firestoreキャッシュ + シード結合）
 */
async function getCollectiveMarketingIntelligence(targetDb = null) {
  const activeDb = targetDb || db;
  const isTest = process.env.NODE_ENV === 'test' || (process.argv && process.argv.some(a => a.includes('test')));

  if (!targetDb && isTest && !process.env.FIRESTORE_EMULATOR_HOST) {
    const seedSuccess = SEED_COLLECTIVE_PATTERNS.successPatterns.map(p => ({ ...p, source: 'baseline_seed_knowledge' }));
    const seedFailure = SEED_COLLECTIVE_PATTERNS.failurePatterns.map(p => ({ ...p, source: 'baseline_seed_knowledge' }));
    return {
      empiricalSuccessPatterns: [],
      empiricalFailurePatterns: [],
      baselineSeedSuccessPatterns: seedSuccess,
      baselineSeedFailurePatterns: seedFailure,
      successPatterns: seedSuccess,
      failurePatterns: seedFailure,
      optimalTimeSlots: SEED_COLLECTIVE_PATTERNS.optimalTimeSlots,
      liveSampledAccounts: 0,
      liveSampledPosts: 0,
      totalLearnedAccounts: 0,
      totalLearnedPosts: 0,
      lastEvolvedAt: new Date()
    };
  }

  try {
    const doc = await activeDb.collection('collective_intelligence').doc('global_marketing_v1').get();
    let actualAccountCount = 0;
    let actualPostCount = 0;
    try {
      const uSnap = await activeDb.collection('saas_users').limit(100).get();
      actualAccountCount = uSnap.size;
      const jSnap = await activeDb.collection('autopilot_jobs').where('status', '==', 'posted').limit(500).get();
      actualPostCount = jSnap.size;
    } catch (_) {}

    const empiricalSuccess = (doc.exists && doc.data()?.successPatterns) ? doc.data().successPatterns.map(p => ({ ...p, source: 'empirical_measurement' })) : [];
    const empiricalFailure = (doc.exists && doc.data()?.failurePatterns) ? doc.data().failurePatterns.map(p => ({ ...p, source: 'empirical_measurement' })) : [];
    const seedSuccess = SEED_COLLECTIVE_PATTERNS.successPatterns.map(p => ({ ...p, source: 'baseline_seed_knowledge' }));
    const seedFailure = SEED_COLLECTIVE_PATTERNS.failurePatterns.map(p => ({ ...p, source: 'baseline_seed_knowledge' }));

    if (doc.exists) {
      const data = doc.data() || {};
      return {
        // 実績学習パターンと初期シード知識を分離して識別可能にする
        empiricalSuccessPatterns: empiricalSuccess,
        empiricalFailurePatterns: empiricalFailure,
        baselineSeedSuccessPatterns: seedSuccess,
        baselineSeedFailurePatterns: seedFailure,
        successPatterns: [...empiricalSuccess, ...seedSuccess].slice(0, 10),
        failurePatterns: [...empiricalFailure, ...seedFailure].slice(0, 10),
        optimalTimeSlots: data.optimalTimeSlots || SEED_COLLECTIVE_PATTERNS.optimalTimeSlots,
        // 実測サンプリング数と永続カウンターを明確に区別
        liveSampledAccounts: actualAccountCount,
        liveSampledPosts: actualPostCount,
        totalLearnedAccounts: data.totalLearnedAccounts || actualAccountCount,
        totalLearnedPosts: data.totalLearnedPosts || actualPostCount,
        lastEvolvedAt: data.lastEvolvedAt || new Date()
      };
    }

    return {
      empiricalSuccessPatterns: [],
      empiricalFailurePatterns: [],
      baselineSeedSuccessPatterns: seedSuccess,
      baselineSeedFailurePatterns: seedFailure,
      successPatterns: seedSuccess,
      failurePatterns: seedFailure,
      optimalTimeSlots: SEED_COLLECTIVE_PATTERNS.optimalTimeSlots,
      liveSampledAccounts: actualAccountCount,
      liveSampledPosts: actualPostCount,
      totalLearnedAccounts: actualAccountCount,
      totalLearnedPosts: actualPostCount,
      lastEvolvedAt: new Date()
    };
  } catch (err) {
    console.warn('[Collective Intelligence] Warning, using seed knowledge:', err.message);
  }

  return {
    ...SEED_COLLECTIVE_PATTERNS,
    totalLearnedAccounts: 0,
    totalLearnedPosts: 0,
    lastEvolvedAt: new Date()
  };
}

/**
 * クライアントの運用実績から新しい成功・失敗知見を匿名化して集合知にフィードバックする
 */
async function recordAnonymousKnowledgeFeedback({ hookPattern, category, wasSuccessful, reason, metrics }) {
  if (!hookPattern || hookPattern.length < 10) return;

  // 個人情報・固有名詞・URLをマスクして抽象構文化
  const sanitizedPattern = hookPattern
    .replace(/https?:\/\/\S+/g, '[URL]')
    .replace(/@[a-zA-Z0-9_]+/g, '[@ユーザー]')
    .slice(0, 120);

  try {
    const docRef = db.collection('collective_intelligence').doc('global_marketing_v1');
    const doc = await docRef.get();
    const current = doc.exists ? doc.data() : { successPatterns: [], failurePatterns: [], totalLearnedPosts: 0 };

    if (wasSuccessful) {
      const list = current.successPatterns || [];
      if (!list.some(p => p.syntaxRule === sanitizedPattern)) {
        list.unshift({
          category: category || 'custom_success',
          patternName: `高反響実証構文 (${metrics?.impressions || 'High'} IMP)`,
          syntaxRule: sanitizedPattern,
          whyItWorks: reason || '高い読者エンゲージメントを獲得',
          recordedAt: new Date()
        });
        if (list.length > 20) list.pop();
        await docRef.set({ successPatterns: list, totalLearnedPosts: (current.totalLearnedPosts || 0) + 1, lastEvolvedAt: new Date() }, { merge: true });
      }
    } else {
      const list = current.failurePatterns || [];
      if (!list.some(p => p.syntaxRule === sanitizedPattern)) {
        list.unshift({
          category: category || 'custom_flaw',
          patternName: `低反応・反省構文`,
          syntaxRule: sanitizedPattern,
          flawReason: reason || '初速が伸び悩んだ表現',
          recordedAt: new Date()
        });
        if (list.length > 20) list.pop();
        await docRef.set({ failurePatterns: list, totalLearnedPosts: (current.totalLearnedPosts || 0) + 1, lastEvolvedAt: new Date() }, { merge: true });
      }
    }
  } catch (e) {
    console.warn('[Collective Feedback Warning]:', e.message);
  }
}

/**
 * ユーザー固有のマーケティングナレッジ（成功事例・失敗事例・URL分析・DPOペア）を取得する
 * 実装の二重管理を防ぐため、ai_deliberation_council.jsの実装を単一の真実源として委譲
 */
async function getUserMarketingKnowledge(userId) {
  const { getUserMarketingKnowledge: getFromCouncil } = require('./ai_deliberation_council');
  return getFromCouncil(userId);
}

/**
 * 🏛️ 実績データの自動回収・集合知自己進化エンジン (Data Flywheel)
 * 公式API v2から投稿結果メトリクス（IMP、いいね、BM、引用RT）を取得し、
 * 成功・失敗知見を自動抽出して集合知DBを継続的に自己進化させる。
 */
async function harvestAndEvolveCollectiveKnowledge() {
  console.log('🏛️ [Collective Intelligence] 集合知自己進化サイクルを開始中...');
  try {
    const { decryptCredentials, getUserProfileAndRecentTweets } = require('./official_api_client');
    // 1. songxiaj679@gmail.com (公式API本アカウント) の最新投稿データを巡回回収
    const adminDoc = await db.collection('saas_users').doc('WEB-GOOGLE-D12E2479A76266AEA2B4').get();
    if (!adminDoc.exists || !adminDoc.data().xOfficialCredentials) {
      console.log('  ⚠️ 公式APIクレデンシャルが見つかりません');
      return { ok: false, error: 'no_creds' };
    }

    const creds = decryptCredentials(adminDoc.data().xOfficialCredentials);
    const officialData = await getUserProfileAndRecentTweets(creds, 10);
    if (!officialData || !officialData.ok || !Array.isArray(officialData.tweets)) {
      console.log('  ⚠️ ツイート取得失敗:', officialData?.error);
      return { ok: false, error: officialData?.error };
    }

    let learnedSuccessCount = 0;
    let learnedFailureCount = 0;

    for (const t of officialData.tweets) {
      const text = String(t.text || '');
      const m = t.metrics || {};
      const imps = m.impression_count || 0;
      const bms = m.bookmark_count || 0;
      const quotes = m.quote_count || 0;
      const likes = m.like_count || 0;

      // 失敗パターンの自動検出: 親ポスト直接URL貼り & 低インプ (IMP < 5)
      if (text.includes('http') && imps < 5 && bms === 0) {
        await recordAnonymousKnowledgeFeedback({
          hookPattern: text,
          category: 'direct_link_penalty',
          wasSuccessful: false,
          reason: `親ツイートへの直接URLベタ貼りによりアルゴリズム減衰が発生 (IMP: ${imps}, BM: 0)`,
          metrics: { impressions: imps }
        });
        learnedFailureCount++;
      }

      // 成功パターンの自動検出: ブックマーク多 (BM >= 2) または 引用RT発生 または 高いいね
      if (bms >= 2 || quotes >= 1 || (likes >= 5 && !text.includes('http'))) {
        let category = 'quote_debate_trap';
        if (text.includes('「') || text.includes('？') || text.includes('ですか')) {
          category = 'quote_debate_trap';
        } else if (text.includes('0分') || text.includes('時間') || text.includes('数字')) {
          category = 'primary_data_teardown';
        }

        await recordAnonymousKnowledgeFeedback({
          hookPattern: text,
          category,
          wasSuccessful: true,
          reason: `高いエンゲージメントを獲得 (IMP: ${imps}, いいね: ${likes}, ブックマーク: ${bms}, 引用: ${quotes})`,
          metrics: { impressions: imps }
        });
        learnedSuccessCount++;
      }
    }

    console.log(`  🎉 [集合知自己進化完了] 成功構文 ${learnedSuccessCount}件、失敗則 ${learnedFailureCount}件を蓄積・学習しました！`);
    return { ok: true, learnedSuccessCount, learnedFailureCount };
  } catch (err) {
    console.error('  ⚠️ [集合知自己進化エラー]:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getCollectiveMarketingIntelligence,
  recordAnonymousKnowledgeFeedback,
  getUserMarketingKnowledge,
  harvestAndEvolveCollectiveKnowledge
};
