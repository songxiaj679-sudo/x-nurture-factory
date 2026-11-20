require('dotenv').config();
const { hasXaiKey, completeJson } = require('./grok_client');

function calcXWeightServer(str) {
  // スピン構文 {A|B|C} は最長の選択肢で計算し、送信ボタン無効化（文字数超過）を防ぐ
  const expanded = String(str || '').replace(/\{([^{}]+)\}/g, (_, grp) => {
    const opts = grp.split('|');
    opts.sort((a, b) => b.length - a.length);
    return opts[0] || '';
  });
  const s = expanded.replace(/https?:\/\/[^\s]+/g, 'xxxxxxxxxxxxxxxxxxxxxxx');
  let w = 0;
  for (const ch of s) {
    w += (ch.charCodeAt(0) > 255) ? 2 : 1;
  }
  return w;
}

function fitMainPostWithinXWeight(rawText, maxWeight = 258) {
  let txt = String(rawText || '').trim();
  if (!txt) return '';
  if (calcXWeightServer(txt) <= maxWeight) return txt;

  // 末尾のハッシュタグ群を保持したまま本文側を安全に短縮
  const tagMatches = txt.match(/(?:\s+#[^\s#]+)+\s*$/);
  const trailingTags = tagMatches ? tagMatches[0].trim() : '';
  let body = tagMatches ? txt.slice(0, txt.length - tagMatches[0].length).trim() : txt;

  const tagWeight = trailingTags ? (calcXWeightServer(trailingTags) + 2) : 0;
  const targetBodyWeight = Math.max(80, maxWeight - tagWeight - 4);

  // スピン構文を壊さないよう、長すぎる場合はスピンを1つ目の選択肢へ展開してから切り詰める
  if (calcXWeightServer(body) > targetBodyWeight) {
    let trimmed = '';
    let curW = 0;
    const safeBody = body.replace(/\{([^{}|]+)\|([^{}]+)\}/g, '{$1|$2}');
    let inBrace = false;
    for (const ch of safeBody) {
      if (ch === '{') inBrace = true;
      if (ch === '}') inBrace = false;
      const cw = (ch.charCodeAt(0) > 255) ? 2 : 1;
      if (!inBrace && curW + cw > targetBodyWeight) break;
      trimmed += ch;
      curW += cw;
    }
    if ((trimmed.match(/\{/g) || []).length !== (trimmed.match(/\}/g) || []).length) {
      trimmed = trimmed.replace(/\{[^}]*$/, '');
    }
    body = trimmed.trim() + '👇';
  }
  return trailingTags ? `${body}\n${trailingTags}` : body;
}

function fitBioWithinXWeight(rawBio, cleanUrl, isSafeNoUrlMode = false, lang = 'en') {
  let b = String(rawBio || '').replace(/\r?\n/g, ' ').trim();
  if (!b) return '';
  const u = String(cleanUrl || '').trim();
  const isJa = lang === 'ja';

  if (isSafeNoUrlMode) {
    b = b.replace(/https?:\/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim();
    if (isJa && !/リプ|固定|ツリー|下/.test(b)) {
      b += ' 👇詳細は固定ポスト・リプ欄へ';
    } else if (!isJa && !/reply|pinned|below|thread/i.test(b)) {
      b += ' 👇 Full access in pinned post & replies';
    }
    let trimmed = '';
    let curW = 0;
    for (const ch of b) {
      const cw = (ch.charCodeAt(0) > 255) ? 2 : 1;
      if (curW + cw > 150) break;
      trimmed += ch;
      curW += cw;
    }
    return trimmed.trim();
  }

  if (calcXWeightServer(b) <= 152) return b;
  const withoutUrl = u ? b.replace(u, '').trim() : b;
  let trimmed = '';
  const maxBodyWeight = u ? 120 : 150;
  let curW = 0;
  for (const ch of withoutUrl) {
    const cw = (ch.charCodeAt(0) > 255) ? 2 : 1;
    if (curW + cw > maxBodyWeight) break;
    trimmed += ch;
    curW += cw;
  }
  return u ? (trimmed.trim() + ' 👇 ' + u) : trimmed.trim();
}

function normalizeLangCode(targetLang) {
  const s = String(targetLang || 'ja').trim().toLowerCase();
  return s.startsWith('en') ? 'en' : 'ja';
}

function containsJapaneseKana(str) {
  return /[\u3040-\u309f\u30a0-\u30ff]/.test(String(str || ''));
}

function isPredominantlyJapanese(text) {
  const str = String(text || '');
  if (!str) return false;
  const jpMatches = str.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g) || [];
  return jpMatches.length >= 6 && (jpMatches.length / Math.max(1, str.replace(/\s+/g, '').length)) >= 0.15;
}

function isStrictlyEnglish(text) {
  const str = String(text || '');
  if (!str) return false;
  return !containsJapaneseKana(str);
}

// 商材ジャンルから「B2B運用者向け vs B2C一般客向け」と「検索流入が強い攻めたタグ・検索クエリ」を推定
function inferNicheProfile(productDesc, lang = 'en') {
  const p = String(productDesc || '').toLowerCase();
  const isB2B = /saas|automation|tool|bot|proxy|isp|agency|affiliate tool|x-swarm|velox|自動投稿|自動化|ツール|システム|アフィリエイター向け|複数垢|シャドウバン/.test(p);

  if (lang === 'ja') {
    if (/fx|投資|仮想通貨|ビットコイン|トレード|株|バイナリー|自動売買|ea/.test(p)) {
      return {
        segment: 'b2c_consumer',
        tags: ['#FX', '#仮想通貨', '#自動売買', '#資産運用'],
        queries: ['"給料 足りない" -filter:links', '"FX 勝てない" -filter:links', '"種銭 増やしたい" -filter:links', '"不労所得 欲しい" -filter:links', '自動売買 気になる -filter:links', 'ドル円 溶けた -filter:links', '投資 初心者 少額 -filter:links', '副収入 欲しい -filter:links']
      };
    }
    if (/裏垢|アダアフィ|dmm|fanza|出会い|セフレ|オフパコ|パパ活|ギャラ飲み/.test(p)) {
      return {
        segment: 'b2c_consumer',
        tags: ['#裏垢女子と繋がりたい', '#裏垢男子', '#深夜の独り言', '#暇人絡め'],
        queries: ['"暇 誰か" -filter:links', '"寝れない 誰か" -filter:links', '"寂しい 通話" -filter:links', '"会える人" -filter:links', '今日ひま -filter:links', '呑みに行きたい -filter:links']
      };
    }
    if (isB2B) {
      return {
        segment: 'b2b_operator',
        tags: ['#X運用', '#アフィリエイト', '#AI副業', '#SNSマーケティング'],
        queries: ['"シャドウバン" アフィ', '"インプ 伸びない" X', '"手動 投稿" 限界', '複数垢 運用', 'al.dmm.com', 'amzn.to', 'note.com 収益', 'tips.jp']
      };
    }
    return {
      segment: 'b2c_consumer',
      tags: ['#副業', '#在宅ワーク', '#AI副業', '#スキマ時間'],
      queries: ['"バイト 辞めたい" -filter:links', '"仕事 行きたくない" -filter:links', '"お金 足りない" -filter:links', '"在宅で稼ぎたい" -filter:links', '"副業 何から" -filter:links', '"スマホ 副業" -filter:links', '残業 つらい 転職 -filter:links', '貯金 増えない -filter:links']
    };
  }

  // English (Global) Niche Inference
  if (/forex|crypto|trading|bitcoin|memecoin|solana|defi|signals|prop firm/.test(p)) {
    return {
      segment: 'b2c_consumer',
      tags: ['#Crypto', '#Trading', '#Bitcoin', '#PassiveIncome'],
      queries: ['"tired of losing trades" -filter:links', '"need a better strategy" crypto -filter:links', '"prop firm" payout -filter:links', '"passive income" crypto -filter:links', 'solana alpha -filter:links', 'forex setup -filter:links']
    };
  }
  if (/ofm|onlyfans|creator|model|dating|cam/.test(p)) {
    return {
      segment: 'b2b_operator',
      tags: ['#OFM', '#CreatorEconomy', '#TrafficGeneration', '#DigitalMarketing'],
      queries: ['"OFM" traffic', 'onlyfans marketing', 'beacons.ai', 'linktr.ee', '"reddit traffic" ofm', '"x traffic" agency']
    };
  }
  if (isB2B) {
    return {
      segment: 'b2b_operator',
      tags: ['#AffiliateMarketing', '#GrowthHacking', '#AIAutomation', '#SaaS'],
      queries: ['linktr.ee', 'beacons.ai', 'amzn.to', '"shadowbanned" again -filter:links', '"affiliate marketing" traffic', '"multi account" X', '"OFM" agency', 'gumroad.com']
    };
  }
  return {
    segment: 'b2c_consumer',
    tags: ['#SideHustle', '#PassiveIncome', '#MakeMoneyOnline', '#RemoteWork'],
    queries: ['"need extra income" -filter:links', '"tired of my 9 to 5" -filter:links', '"side hustle" ideas -filter:links', '"work from home" hiring -filter:links', '"paycheck to paycheck" -filter:links', '"how to make extra money" -filter:links']
  };
}

async function runGeminiWithAutoDiscovery(_unusedKey, promptText) {
  if (!hasXaiKey()) throw new Error('NO_XAI_KEY');
  const { parsed, modelName } = await completeJson({ tier: 'quality', prompt: promptText, temperature: 0.85 });
  if (parsed && typeof parsed === 'object') return { data: parsed, modelUsed: modelName };
  throw new Error('GROK_EMPTY');
}

function detectUrlPlatformType(urlStr, lang = 'en') {
  const u = String(urlStr || '').toLowerCase();
  if (lang === 'ja') {
    if (u.includes('lin.ee') || u.includes('line.me')) return '公式LINE追加・限定特典受け取り';
    if (u.includes('t.me') || u.includes('telegram')) return 'Telegram限定コミュニティ・配信';
    if (u.includes('note.com') || u.includes('tips.jp') || u.includes('brmk.io') || u.includes('brain-market')) return '実践ノウハウ・特設記事';
    return '公式LP・特設ページ';
  }
  if (u.includes('t.me') || u.includes('telegram')) return 'Telegram VIP Channel / Access';
  if (u.includes('discord.gg')) return 'Discord Community Invite';
  if (u.includes('gumroad.com') || u.includes('whop.com')) return 'Instant Access Blueprint / Portal';
  return 'Official Live Sandbox / Landing Page';
}

function resolveBattleModeSpec(battleMode) {
  const m = String(battleMode || 'aggressive').toLowerCase();
  if (m === 'safe') {
    return {
      mode: 'safe',
      labelEn: 'Safe Brand & Authority (60m Interval / Clean BIO / 1 Niche Tag)',
      labelJa: '🛡️ 公式・長期安全モード（60分間隔 / BIO内URLなし / 厳選1タグ）',
      recommendedIntervalMin: 60,
      recommendedAiReply: false,
      noUrlInBio: true
    };
  }
  if (m === 'sniper') {
    return {
      mode: 'sniper',
      labelEn: 'High-ROI Sniper (30m Interval / Proof + Niche Tags + AI Replies ON)',
      labelJa: '⚡ 王道スナイパー成約モード（30分間隔 / 検索タグ＋体験談＋AI営業ON）',
      recommendedIntervalMin: 30,
      recommendedAiReply: true,
      noUrlInBio: false
    };
  }
  return {
    mode: 'aggressive',
    labelEn: 'Viral & Aggressive Blitz (15m Interval / High-Traffic Search Tags + AI Replies ON)',
    labelJa: '🔥 バズ＆インプ強奪・特攻モード（15分間隔 / 攻めの検索タグ＋バズ構文＋AI営業ON）',
    recommendedIntervalMin: 15,
    recommendedAiReply: true,
    noUrlInBio: false
  };
}

// ============================================================================
// Step 1 -> Step 2: 6つの攻めた切り口提案（日英完全分離・検索タグ入りサンプル）
// ============================================================================
async function generateAiCampaignAngles({ productDesc, affiliateUrl, targetLang, battleMode }) {
  const cleanProd = String(productDesc || '').trim();
  const cleanUrl = String(affiliateUrl || '').trim();
  const lang = normalizeLangCode(targetLang);
  const urlType = detectUrlPlatformType(cleanUrl, lang);
  const modeSpec = resolveBattleModeSpec(battleMode);
  const niche = inferNicheProfile(cleanProd, lang);
  const promptText = lang === 'en'
    ? `You are an elite, high-earning X (Twitter) affiliate & growth hacker who drives massive search impressions and link clicks fast.
CRITICAL LANGUAGE LOCK: Every single field in your JSON response MUST be written in natural, punchy English—even if the product description contains non-English words. NEVER output Japanese characters.

[Product / Offer]: ${cleanProd}
[Destination URL]: ${cleanUrl} (${urlType})
[Operating Stance]: ${modeSpec.labelEn}
[Suggested High-Volume Search Tags]: ${niche.tags.join(' ')}

Propose 6 distinct, high-impression X campaign angles (numbered 1 to 6) designed to get immediate views on X Search & For You feeds even on a low-follower account.
- Every "samplePost" MUST include a strong scroll-stopping hook in line 1 (numbers, curiosity gap, bold claim, or relatable pain) AND 1–2 high-volume search hashtags at the end (such as ${niche.tags.slice(0, 2).join(' ')}).
- Mark the single highest-converting angle with "isRecommended": true (and the other 5 as false).

Output valid JSON ONLY:
{
  "aiGreeting": "Locked onto '${cleanProd}'! Here are 6 high-impression English campaign angles with targeted search hashtags built for fast views and clicks. Pick any angle below:",
  "recommendedIntervalMin": ${modeSpec.recommendedIntervalMin},
  "recommendedAiReply": ${modeSpec.recommendedAiReply},
  "angles": [
    { "number": 1, "isRecommended": true, "title": "...", "targetAudience": "...", "samplePost": "... 👇 ${niche.tags[0]} ${niche.tags[1]}", "strategyDetail": "..." },
    ... (6 items total)
  ]
}`
    : `あなたはX（旧Twitter）でフォロワー0の新規垢からでも初日で数万VIEWと大量のリンククリックを叩き出す「凄腕アフィリエイター兼グロースハッカー」です。
【言語固定ルール】: 出力するJSONのすべての項目を必ず自然な日本語で記述してください。

【宣伝したい商材】: ${cleanProd}
【誘導先URL】: ${cleanUrl} (${urlType})
【選択スタンス】: ${modeSpec.labelJa}
【推奨ジャンル検索タグ例】: ${niche.tags.join(' ')}

フォロワーが少ないアカウントでも「検索流入（話題・最新タブ）」と「おすすめ」から即座にVIEWとアクセスを奪える6つの攻めた切り口（1〜6番）をJSONで提案してください。
- 各 "samplePost" には必ず「1行目で指を止める強いフック（具体的な数字・損得・暴露・本音）」と、末尾に「実際に検索されている攻めたハッシュタグ1〜2個（例: ${niche.tags.slice(0, 2).join(' ')}）」を含めてください。
- 最も短期でクリックと成約が出るイチオシ1つだけ "isRecommended": true にしてください（他は false）。

以下のJSONのみを出力してください：
{
  "aiGreeting": "『${cleanProd}』で短期アクセスを狙う6つの攻めた切り口（検索流入タグ付き）を作成しました！光っている【👑AIイチオシ】を含め、番号を選んでください。",
  "recommendedIntervalMin": ${modeSpec.recommendedIntervalMin},
  "recommendedAiReply": ${modeSpec.recommendedAiReply},
  "angles": [
    { "number": 1, "isRecommended": true, "title": "...", "targetAudience": "...", "samplePost": "...👇 ${niche.tags[0]} ${niche.tags[1]}", "strategyDetail": "..." },
    ... (計6個)
  ]
}`;

  try {
    const { data, modelUsed } = await runGeminiWithAutoDiscovery(null, promptText);
    if (data && Array.isArray(data.angles) && data.angles.length >= 6) {
      const joinedSamples = data.angles.map(a => a.samplePost || '').join(' ');
      const langMismatch = (lang === 'en' && containsJapaneseKana(joinedSamples)) || (lang === 'ja' && !containsJapaneseKana(joinedSamples));
      if (!langMismatch) {
        const hasRec = data.angles.slice(0, 6).some(a => a.isRecommended === true);
        return {
          aiGreeting: String(data.aiGreeting || ''),
          recommendedIntervalMin: modeSpec.recommendedIntervalMin,
          recommendedAiReply: modeSpec.recommendedAiReply,
          battleMode: modeSpec.mode,
          targetSegment: niche.segment,
          angles: data.angles.slice(0, 6).map((a, idx) => ({
            number: idx + 1,
            isRecommended: hasRec ? !!a.isRecommended : (idx === 0),
            title: String(a.title || ''),
            targetAudience: String(a.targetAudience || ''),
            samplePost: fitMainPostWithinXWeight(a.samplePost || ''),
            strategyDetail: String(a.strategyDetail || '')
          })),
          modelUsed
        };
      }
    }
  } catch (e) {
    console.warn('[AICampaignBuilder] Using niche-targeted 6-angle generator:', e.message);
  }

  const isAgg = modeSpec.mode === 'aggressive';
  const t1 = niche.tags[0] || (lang === 'en' ? '#SideHustle' : '#副業');
  const t2 = niche.tags[1] || (lang === 'en' ? '#AIAutomation' : '#在宅ワーク');

  if (lang === 'en') {
    return {
      aiGreeting: `Locked onto "${cleanProd}"! Crafted 6 high-velocity English angles with search-indexed tags (${t1} ${t2}) to maximize immediate views and link clicks:`,
      recommendedIntervalMin: modeSpec.recommendedIntervalMin,
      recommendedAiReply: modeSpec.recommendedAiReply,
      battleMode: modeSpec.mode,
      targetSegment: niche.segment,
      modelUsed: 'smart-en-v2',
      angles: [
        { number: 1, isRecommended: !isAgg, title: '📈 Concrete Numbers & Before/After Proof', targetAudience: 'Action-takers looking for fast, proven results', samplePost: `Cut 3+ hours of daily grind down to 5 minutes after switching to ${cleanProd}. Full breakdown & live access in the reply below 👇 ${t1} ${t2}`, strategyDetail: 'Combines specific time/money numbers with search tags for immediate CTR.' },
        { number: 2, isRecommended: isAgg, title: '🔥 Unfiltered Wake-Up Call (Scroll-Stopper + Search Bait)', targetAudience: 'People still stuck doing things the hard way', samplePost: `95% of people still waste hours doing this manually while top operators quietly automate everything with ${cleanProd}. Left the exact link below 👇 ${t1} ${t2}`, strategyDetail: 'Triggers FOMO, replies, and search impressions simultaneously.' },
        { number: 3, isRecommended: false, title: '🔖 Bookmark-Bait Blueprint (+10x Dwell & Save Boost)', targetAudience: 'Growth-minded users collecting actionable setups', samplePost: `Bookmark this before you scroll: how we run ${cleanProd} 24/7 hands-free without burning accounts or time. Step-by-step setup in replies 👇 ${t1} ${t2}`, strategyDetail: 'Engineered to rack up Bookmarks (+10.0 weight) to hit For You feeds.' },
        { number: 4, isRecommended: false, title: '⚡ Zero-Fluff Insider Shortcut', targetAudience: 'Busy operators wanting plug-and-play speed', samplePost: `If you only have 15 minutes a day to scale, let ${cleanProd} do the heavy lifting while you sleep. Direct access below 👇 ${t1}`, strategyDetail: 'Targets time-strapped buyers ready to click immediately.' },
        { number: 5, isRecommended: false, title: '💡 Brutally Honest Comparison (Old Way vs. New Stack)', targetAudience: 'Skeptics burned by outdated methods', samplePost: `Tested almost everything in this space this year—nothing came close to the consistency of ${cleanProd}. Put the live link in the reply 👇 ${t1} ${t2}`, strategyDetail: 'Builds instant authority and overcomes buyer skepticism.' },
        { number: 6, isRecommended: false, title: '🎯 Step-by-Step Starter Hook (Fast Onboarding)', targetAudience: 'Beginners wanting a 5-minute start today', samplePost: `Zero complex setup needed. Here is the fastest way to get ${cleanProd} running today—check the reply right below 👇 ${t2}`, strategyDetail: 'Removes friction to maximize link click-through rate.' }
      ]
    };
  }

  return {
    aiGreeting: `「${cleanProd}」で初動からVIEWとリンク誘導を稼ぐ6つの攻めた切り口（検索タグ ${t1} ${t2} 付き）を作成しました！一番狙いたい番号を選んでください。`,
    recommendedIntervalMin: modeSpec.recommendedIntervalMin,
    recommendedAiReply: modeSpec.recommendedAiReply,
    battleMode: modeSpec.mode,
    targetSegment: niche.segment,
    modelUsed: 'smart-ja-v2',
    angles: [
      { number: 1, isRecommended: !isAgg, title: '📈 数字・ビフォーアフター直球実績型（高クリック率）', targetAudience: '具体的な数字と結果を見て即決したい層', samplePost: `毎日3時間溶けてた作業が「${cleanProd}」に変えてから実質5分で終わるようになった。実際に使ってる環境はリプ欄に置いときます👇 ${t1} ${t2}`, strategyDetail: '具体的な数字比較＋検索ビッグタグで検索タブからの流入とクリックを同時に奪います。' },
      { number: 2, isRecommended: isAgg, title: '🔥 常識否定・暴露フック型（検索＆おすすめ強奪）', targetAudience: '今のやり方で伸び悩んでいる現役層', samplePost: `まだ全部手作業で消耗してる人、悪いこと言わないから一度だけ「${cleanProd}」の裏側を見てほしい。時給換算したら普通に赤字レベル。答えはリプ欄へ👇 ${t1} ${t2}`, strategyDetail: 'ドキッとする本音と界隈タグでスクロールを強制停止させ、リプ欄を開かせます。' },
      { number: 3, isRecommended: false, title: '🔖 保存（ブックマーク）誘発・裏手順公開型（+10倍加点）', targetAudience: '有益ノウハウや裏ワザを探して検索している層', samplePost: `あとで見返せるように保存推奨。「${cleanProd}」を使って24時間放置で回すための具体的な手順と入口をリプ欄にまとめました👇 ${t1} ${t2}`, strategyDetail: 'いいね20個分の価値があるブックマーク保存（+10.0）を誘発してVIEWを跳ね上げます。' },
      { number: 4, isRecommended: false, title: '⚡ 24時間放置・タイパ特化アピール型', targetAudience: '本業が忙しく最短ルートを探している層', samplePost: `寝てる間も仕事中も裏で勝手に動いてくれる「${cleanProd}」が結局一番コスパ良かった。すぐ試せるリンクはリプ欄へ👇 ${t1}`, strategyDetail: 'スキマ時間・放置稼働のメリットを直球で刺してLPへ流し込みます。' },
      { number: 5, isRecommended: false, title: '💡 旧手法との比較・乗り換え本音レビュー型', targetAudience: '過去に別ツールや別案件で失敗した層', samplePost: `今年いろいろ試して一番手応えがあったのが間違いなく「${cleanProd}」だった。遠回りしたくない人向けにリプ欄へ直リンク置いてます👇 ${t1} ${t2}`, strategyDetail: '比較目線のリアルな口コミ感で警戒心を解き、成約率を引き上げます。' },
      { number: 6, isRecommended: false, title: '🎯 初心者5分スタート・即行動フック型', targetAudience: '今日からすぐ始められる案件を探している層', samplePost: `難しい設定ゼロで今日からすぐ動かせる「${cleanProd}」の案内ページ、質問多かったので下のツリーに貼っておきます👇 ${t2}`, strategyDetail: 'ハードルの低さを強調して迷わず2段目リンクを踏ませます。' }
    ]
  };
}

// ============================================================================
// Step 3: 20パターン一括生成 ＋ 攻めた検索タグ ＋ 3種誘導ミックス ＋ 看板ピン留めポスト ＋ ノイズ除外クエリ
// ============================================================================
async function generateAiCampaignPayload({ productDesc, affiliateUrl, funnelStyle, targetLang, selectedAngle, userFeedback, battleMode }) {
  const cleanProd = String(productDesc || '').trim();
  const cleanUrl = String(affiliateUrl || '').trim();
  const lang = normalizeLangCode(targetLang);
  const urlType = detectUrlPlatformType(cleanUrl, lang);
  const modeSpec = resolveBattleModeSpec(battleMode);
  const niche = inferNicheProfile(cleanProd, lang);
  const chosenNum = (selectedAngle && selectedAngle.number) ? selectedAngle.number : 1;
  const chosenTitle = (selectedAngle && selectedAngle.title) ? selectedAngle.title : `Angle #${chosenNum}`;

  const promptText = lang === 'en'
    ? `You are a top-1% X (Twitter) affiliate marketer & viral copywriter focused on FAST views, search impressions, and link clicks.
CRITICAL LANGUAGE LOCK: Write EVERY field strictly in natural, high-converting English. NEVER output Japanese characters anywhere.

[Offer]: ${cleanProd}
[Destination URL]: ${cleanUrl} (${urlType})
[Chosen Angle]: #${chosenNum} — ${chosenTitle}
[Stance]: ${modeSpec.labelEn}
[High-Traffic Niche Tags]: ${niche.tags.join(' ')}
${userFeedback ? '[Operator Custom Instructions]: ' + userFeedback : ''}

CAMPAIGN ENGINEERING RULES FOR MAXIMUM VIEWS & CLICKS:
1. Generate 20 distinct posts ("posts" array of 20 items) so the account never hits duplicate-content decay.
2. Every post's "mainText" MUST:
   - Stay under 235 characters (including hashtags).
   - Start with a hard-hitting human hook (concrete numbers, bold insight, curiosity gap, or bookmark trigger) plus natural search keywords people actually search on X.
   - Include 2 spintax variations like {Honestly|Real talk|Tbh} or {wild|insane|massive}.
   - End with 1–2 targeted high-traffic hashtags (mix from ${niche.tags.join(', ')} or closely searched niche tags).
   - NEVER put http/https URLs inside "mainText".
3. Mix Funnel Types across the 20 posts:
   - Posts #1–15 (75%): End "mainText" with a pointer to the reply 👇, and set "selfReplyText" to a punchy micro-CTA + newline + "${cleanUrl}".
   - Posts #16–20 (25% — Pure Reach Boosters): Zero links even in the reply! Set "selfReplyText" to "" (empty string), and end "mainText" with "Pinned the full setup & link at the top of my profile 📌" + hashtags so X boosts these link-free posts into For You feeds!
4. Also generate 1 flagship "pinnedPost" {"mainText": "...", "selfReplyText": "... ${cleanUrl}"} to pin at the very top of the profile as our highest-converting billboard.
5. Set "targetSegment" to "${niche.segment}" ("b2c_consumer" if targeting everyday buyers, or "b2b_operator" if targeting marketers/agencies).
6. Set "aiKeywords" to 8 comma-separated X live-search queries that real buyers post right now. For B2C consumers, append -filter:links to exclude rival spammers (e.g. "need extra income" -filter:links).

Output valid JSON ONLY with keys:
"aiClosingMessage", "profileBio", "targetSegment", "aiKeywords", "aiReplyPersona", "pinnedPost": {"mainText":"...","selfReplyText":"..."}, "posts": [{"mainText":"...","selfReplyText":"..."}] (20 objects).`
    : `あなたはX（旧Twitter）で短期で爆発的なVIEW（検索流入＋おすすめ露出）とアフィリエイト成約を叩き出す「現役トップアフィリエイター」です。
【言語固定ルール】: 出力するJSONのすべての項目を必ず自然な日本語で記述してください。

【宣伝する商材】: ${cleanProd}
【誘導先URL】: ${cleanUrl} (${urlType})
【選択された切り口】: ${chosenNum}番 — ${chosenTitle}
【運用スタンス】: ${modeSpec.labelJa}
【推奨検索ビッグタグ】: ${niche.tags.join(' ')}
${userFeedback ? '【追加オーダー】: ' + userFeedback : ''}

【短期でVIEWとクリックを最大化する絶対設計ルール】
1. 重複判定を防いでガンガン回せるよう、必ず「20パターン」の投稿（"posts" 配列に20個）を生成してください。
2. 各 "mainText"（全角110文字以内厳守）には：
   - 1行目にスクロールを止める強いフック（数字・損得・実証・業務改善・保存推奨）と、Xでよく検索される自然なトレンド語・業界課題ワードを入れること。
   - 信頼感と説得力のあるスピン構文 {検証データが示す事実|現場が直面するボトルネック|成果を出す運用体制の分岐点} を適切に織り交ぜ、プロフェッショナルなB2B/B2Cマーケティング文体で執筆すること（過度な俗語「ぶっちゃけ」等の下品な表現は厳禁）。
   - 末尾に検索流入が強い攻めたハッシュタグを1〜2個（${niche.tags.join(' ')} や関連の伸びやすい界隈タグ）必ず付与すること。
   - "mainText" 内には http/https のURLは入れないこと。
3. 20パターンの誘導比率を以下のようにミックスすること：
   - 1〜15個目（75%）：1段目で「詳細はリプ欄へ👇 ＋ #タグ」と誘導し、"selfReplyText" にクリックしたくなる一言マイクロコピー＋改行＋「${cleanUrl}」を入れる。
   - 16〜20個目（25%・インプ起爆用リンク完全ゼロ投稿）：ツリー全体でURLを一切貼らず（"selfReplyText" は "" の空文字にする）、1段目の末尾を「やり方とリンクはプロフ一番上の固定ポストに置いてます📌 ＋ #タグ」にして外部リンク減点を完全回避し、検索＆おすすめ露出を稼ぐ。
4. プロフィール最上部に固定して成約を決める最強の看板ポスト "pinnedPost": {"mainText": "...", "selfReplyText": "... ${cleanUrl}"} も1つ作成すること。
5. "targetSegment" は "${niche.segment}"（一般消費者向けなら "b2c_consumer"、同業者・マーケター向けなら "b2b_operator"）を設定すること。
6. "aiKeywords" はカンマ区切りで8個。見込み客がXで呟くリアルな口語検索クエリ（一般客向けなら同業スパムを除外するため -filter:links を付与、例: "給料 足りない" -filter:links）を出力すること。

以下のキーを持つJSONのみを出力してください：
"aiClosingMessage", "profileBio", "targetSegment", "aiKeywords", "aiReplyPersona", "pinnedPost": {"mainText":"...","selfReplyText":"..."}, "posts": [{"mainText":"...","selfReplyText":"..."}] (20個のオブジェクト)。`;

  try {
    const { data, modelUsed } = await runGeminiWithAutoDiscovery(null, promptText);
    if (data && Array.isArray(data.posts) && data.posts.length >= 8) {
      const allPosts = data.posts.slice(0, 25);
      const isConsistentLang = (lang === 'ja')
        ? allPosts.every(p => isPredominantlyJapanese(p.mainText || p.text || ''))
        : allPosts.every(p => isStrictlyEnglish(p.mainText || p.text || ''));

      if (isConsistentLang) {
        const cleanPosts = allPosts.map((p, idx) => {
          const isReachBooster = p.selfReplyText === '' || (idx >= 15 && !String(p.selfReplyText || '').includes('http'));
          return {
            mainText: fitMainPostWithinXWeight(p.mainText || p.text || ''),
            selfReplyText: isReachBooster ? '' : String(p.selfReplyText || cleanUrl).trim(),
            funnelType: isReachBooster ? 'pinned_bridge' : 'self_reply_url'
          };
        }).filter(p => p.mainText.length > 10);

        const rawPin = data.pinnedPost || cleanPosts[0] || {};
        const pinnedPost = {
          mainText: fitMainPostWithinXWeight(rawPin.mainText || cleanPosts[0].mainText),
          selfReplyText: String(rawPin.selfReplyText || (lang === 'en' ? `👇 Official Access & Live Demo:\n${cleanUrl}` : `👇 公式ページ・詳細はこちら\n${cleanUrl}`)).trim()
        };

        return {
          aiClosingMessage: String(data.aiClosingMessage || ''),
          profileBio: fitBioWithinXWeight(data.profileBio, cleanUrl, modeSpec.noUrlInBio, lang),
          targetSegment: data.targetSegment === 'b2b_operator' ? 'b2b_operator' : niche.segment,
          aiKeywords: String(data.aiKeywords || niche.queries.join(', ')),
          aiReplyPersona: String(data.aiReplyPersona || ''),
          pinnedPost,
          posts: cleanPosts,
          recommendedIntervalMin: modeSpec.recommendedIntervalMin,
          recommendedAiReply: modeSpec.recommendedAiReply,
          battleMode: modeSpec.mode,
          targetLang: lang,
          modelUsed
        };
      }
    }
  } catch (e) {
    console.warn('[AICampaignBuilder] Using 20-pattern high-view fallback generator:', e.message);
  }

  return buildHighViewFallbackCampaign({ cleanProd, cleanUrl, lang, modeSpec, niche, chosenNum, chosenTitle });
}

function buildHighViewFallbackCampaign({ cleanProd, cleanUrl, lang, modeSpec, niche, chosenNum, chosenTitle }) {
  const t1 = niche.tags[0] || (lang === 'en' ? '#SideHustle' : '#副業');
  const t2 = niche.tags[1] || (lang === 'en' ? '#PassiveIncome' : '#在宅ワーク');
  const t3 = niche.tags[2] || (lang === 'en' ? '#AIAutomation' : '#AI副業');

  if (lang === 'en') {
    const shortProd = cleanProd.slice(0, 48);
    const rawBio = modeSpec.noUrlInBio
      ? `Scaling results 24/7 with ${shortProd} ⚡ Full setup & live access pinned right below 👇`
      : `Scaling 24/7 with ${shortProd} ⚡ Check pinned thread & live access 👉 ${cleanUrl}`;

    const enPosts = [
      { mainText: `{Honestly|Real talk|Tbh}, switching to ${shortProd} cut 3+ hours of daily manual grind down to almost zero.\n\nDropped the direct access link in the reply below 👇\n${t1} ${t2}`, selfReplyText: `👆 Try the live setup right here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{95% of people|Most operators} still waste hours doing this by hand while a small group automates the entire flow with ${shortProd}.\n\nFull link in replies 👇\n${t1} ${t3}`, selfReplyText: `👆 Official access & live demo:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `Bookmark this before it gets buried:\n\nHow we run ${shortProd} 24/7 on autopilot without burning accounts or babysitting tabs. Link below 👇\n${t1} ${t2}`, selfReplyText: `👆 See the exact workflow here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Quick 2-week update|Real numbers}: moving our daily workflow to ${shortProd} was easily the highest-ROI decision this month.\n\nLeft the link in the thread 👇\n${t2} ${t3}`, selfReplyText: `👆 Check out the full stack here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Still struggling with consistency|Tired of slow results}? Let ${shortProd} execute 24/7 while you focus on scaling offers.\n\nDirect link below 👇\n${t1}`, selfReplyText: `👆 Start in under 5 minutes here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `Tested {almost every tool|dozens of setups} this year and most flopped within days—until I switched to ${shortProd}.\n\nDetails in the reply 👇\n${t1} ${t3}`, selfReplyText: `👆 Live test & full details:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Best feeling|Nothing beats} waking up and seeing ${shortProd} handled your entire outreach & traffic pipeline overnight.\n\nSetup link below 👇\n${t2}`, selfReplyText: `👆 Grab access right here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `If you only have {15 minutes a day|limited time after work}, automating with ${shortProd} is the fastest way to build momentum.\n\nLink in replies 👇\n${t1} ${t2}`, selfReplyText: `👆 Step-by-step access:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Stop trading hours for pennies|Work smarter in 2026}: plug your offer into ${shortProd} once and let it run around the clock.\n\nLink right below 👇\n${t3}`, selfReplyText: `👆 Launch your first stream here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `People keep DMing me what stack I use for ${shortProd}—so I put the public access page in the reply below 👇\n${t1} ${t2}`, selfReplyText: `👆 Direct link while it is open:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Zero coding|Zero complex setup} required. Even complete beginners are getting ${shortProd} live in 5 minutes.\n\nCheck the reply thread 👇\n${t1}`, selfReplyText: `👆 Instant onboarding page:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `Why do manual operators burn out in 2 weeks? Because consistency beats willpower—and ${shortProd} never sleeps.\n\nDetails below 👇\n${t2} ${t3}`, selfReplyText: `👆 See it running live here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Unpopular opinion|Hard truth}: if your workflow stops the moment you close your laptop, you do not have a system yet. ${shortProd} fixes that 👇\n${t1} ${t3}`, selfReplyText: `👆 Build your 24/7 pipeline here:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Save this post|Keep this handy}: the cleanest way to scale ${shortProd} without hiring VAs or wasting ad spend.\n\nLink in the reply 👇\n${t1} ${t2}`, selfReplyText: `👆 Full breakdown & access:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      { mainText: `{Wish I started sooner|Honestly a game changer}: once ${shortProd} is dialed in, daily traffic becomes predictable.\n\nAccess link below 👇\n${t2}`, selfReplyText: `👆 Official portal:\n${cleanUrl}`, funnelType: 'self_reply_url' },
      // 5 Pure Reach Boosters (Zero external URLs anywhere -> directs to Pinned Post & Profile)
      { mainText: `{Real talk|Hot take}: manual grind is dead in 2026. Automated systems like ${shortProd} are quietly taking all the traffic.\n\nPinned the full breakdown at the top of my profile 📌\n${t1} ${t3}`, selfReplyText: '', funnelType: 'pinned_bridge' },
      { mainText: `Bookmark this: 3 things that multiplied our daily output—\n1. Ditching manual routines\n2. Running ${shortProd} 24/7\n3. Tracking every click\n\nFull setup is pinned on my profile 📌\n${t1} ${t2}`, selfReplyText: '', funnelType: 'pinned_bridge' },
      { mainText: `{Wild how fast|Crazy how much} things change once you automate the boring 90% with ${shortProd}.\n\nLeft the live proof in my pinned post 📌\n${t2} ${t3}`, selfReplyText: '', funnelType: 'pinned_bridge' },
      { mainText: `Anyone else tired of spending 3 hours a day on tasks ${shortProd} can handle automatically? Check my pinned post for the exact workflow 📌\n${t1}`, selfReplyText: '', funnelType: 'pinned_bridge' },
      { mainText: `{Consistency > luck|Systems > hustle} every single time. Everything we use to run ${shortProd} 24/7 is pinned at the top of my profile 📌\n${t1} ${t2}`, selfReplyText: '', funnelType: 'pinned_bridge' }
    ].map(p => ({ ...p, mainText: fitMainPostWithinXWeight(p.mainText) }));

    return {
      modelUsed: 'smart-en-v2',
      targetLang: 'en',
      targetSegment: niche.segment,
      recommendedIntervalMin: modeSpec.recommendedIntervalMin,
      recommendedAiReply: modeSpec.recommendedAiReply,
      battleMode: modeSpec.mode,
      aiClosingMessage: `Generated 20 high-view English post patterns (with ${t1} ${t2} search tags + Pinned Billboard) at an optimized ${modeSpec.recommendedIntervalMin}m pace!`,
      profileBio: fitBioWithinXWeight(rawBio, cleanUrl, modeSpec.noUrlInBio, 'en'),
      aiKeywords: niche.queries.join(', '),
      aiReplyPersona: `Reply in natural, casual English like an experienced peer. Reference a specific detail from their post, share a quick relatable insight about ${shortProd}, and casually mention your pinned post/profile without dropping any links.`,
      pinnedPost: {
        mainText: fitMainPostWithinXWeight(`📌 [START HERE] How we run ${shortProd} 24/7 on autopilot to drive consistent daily results without manual grind.\n\nLive demo & instant access in the reply right below 👇\n${t1} ${t2}`),
        selfReplyText: `🚀 Official Access & Free Live Demo:\n${cleanUrl}`
      },
      posts: enPosts
    };
  }

  const shortProdJa = cleanProd.slice(0, 34);
  const rawBioJa = modeSpec.noUrlInBio
    ? `${shortProdJa}で24時間自動化した実践ログを公開中⚡ 実際の仕組みと入口は一番上の固定ポスト＆リプ欄へ👇`
    : `${shortProdJa}で手作業ゼロ化した実践記録⚡ 詳細・無料体験は固定ポスト＆こちら👇 ${cleanUrl}`;

  const jaPosts = [
    { mainText: `{検証データが示す事実|業務効率化の要点}、手作業で消耗していた工程を「${shortProdJa}」に移行してから運用工数が大幅に削減された。\n\n詳細な仕組みと導入手順はリプ欄へ👇\n${t1} ${t2}`, selfReplyText: `👆 実際の運用環境と導入事例はこちらです\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{まだ全部手動でやってる人|伸び悩んでる人}、悪いこと言わないから一度だけ「${shortProdJa}」の裏側を見てほしい。時給換算したらマジで世界変わる👇\n${t1} ${t3}`, selfReplyText: `👆 公式アクセス・詳細はこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `【{消す前に保存推奨|あとで見返す用}】「${shortProdJa}」を24時間放置で回して手作業ゼロにする手順、質問多かったのでリプ欄にまとめました👇\n${t1} ${t2}`, selfReplyText: `👆 手順とスタートページはこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{2週間ガチ検証した結果|ここだけの話}、今まで試した中で一番コスパ良く数字が伸びたのが「${shortProdJa}」だった。\n\n直リンクは下のツリーへ👇\n${t2} ${t3}`, selfReplyText: `👆 今すぐ中身を確認できます\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{寝てる間も|本業で忙しい間も}24時間勝手に動いてくれる「${shortProdJa}」が結局一番強い。スキマ時間で結果出したい人はリプ欄へ👇\n${t1}`, selfReplyText: `👆 詳細ページはこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{気合と根性で頑張る|毎日何時間も張り付く}のってもう限界がある。「${shortProdJa}」に丸投げしてから時間の余裕が段違い👇\n${t1} ${t3}`, selfReplyText: `👆 使ってる仕組みの案内はこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `知識ゼロからでも{迷わず5分で|今日からすぐ}動かせるように「${shortProdJa}」の導入手順がかなり整理されてた。詳細はリプ欄に置いときます👇\n${t1} ${t2}`, selfReplyText: `👆 初心者向けの案内はこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{周りで結果出してる人|要領いい人}が裏でこっそり使ってるのが大体この「${shortProdJa}」だったりする。知らないと普通に損するレベル👇\n${t2} ${t3}`, selfReplyText: `👆 裏側の仕組みはこちらから見れます\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `今まで{いろんな案件で遠回りした|何をやっても続かなかった}けど、「${shortProdJa}」に絞ってからやっとペースが安定した。詳細はリプ欄へ👇\n${t1}`, selfReplyText: `👆 遠回りしたくない人はここからどうぞ\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{DMでよく聞かれる|質問が多かった}「${shortProdJa}」の参加リンク、すぐ見れるようにリプ欄に貼っておきます👇\n${t1} ${t2}`, selfReplyText: `👆 公開中のリンクはこちらです\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{月数万でも副収入がある|自動化の柱が1つある}だけでメンタルの余裕が全然違う。「${shortProdJa}」のリアルな中身はリプ欄へ👇\n${t1} ${t3}`, selfReplyText: `👆 詳細と限定案内はこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{作業時間が取れない人|文章考えるのが苦手な人}ほど、最初から「${shortProdJa}」を使った方が圧倒的に早いと思う👇\n${t2}`, selfReplyText: `👆 5分でチェックできる公式ページ\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `朝起きてスマホ見た時に「${shortProdJa}」が裏で勝手に仕事してくれてる感覚、一度味わうと手動には戻れない👇\n${t1} ${t3}`, selfReplyText: `👆 実際の稼働イメージはこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{今の収入にプラスしたい|現状を本気で変えたい}なら、まずは「${shortProdJa}」みたいな仕組みを1つ持っておくのが鉄板👇\n${t1} ${t2}`, selfReplyText: `👆 スタート案内ページはこちら\n${cleanUrl}`, funnelType: 'self_reply_url' },
    { mainText: `{もっと早く知りたかった|正直チート級}と言われた「${shortProdJa}」の全貌、下のツリーからそのまま覗けます👇\n${t2} ${t3}`, selfReplyText: `👆 こちらからすぐ確認できます\n${cleanUrl}`, funnelType: 'self_reply_url' },
    // 5 Pure Reach Boosters (外部URL完全ゼロ -> プロフ最上部の固定ポストへ誘導してインプ稼ぎ)
    { mainText: `{成果を出す運用体制の分岐点|実証データから判明した結論}、2026年のSNS展開において人手頼みの運用を続けるのは最大の機会損失。「${shortProdJa}」の全体設計図はプロフ一番上の固定ポストに公開しています📌\n${t1} ${t3}`, selfReplyText: '', funnelType: 'pinned_bridge' },
    { mainText: `【保存版】最短で結果を出す人が絶対にやらない3つのこと\n・毎日数時間の単純作業\n・根性頼みの継続\n・仕組み化の先送り\n\n僕が回してる「${shortProdJa}」はプロフの固定ポストにまとめてます📌\n${t1} ${t2}`, selfReplyText: '', funnelType: 'pinned_bridge' },
    { mainText: `{作業時間を10分の1にして|手作業ストレスを消して}本業と両立できた一番の理由は間違いなく「${shortProdJa}」。詳細はプロフ一番上の固定ポストへ📌\n${t2} ${t3}`, selfReplyText: '', funnelType: 'pinned_bridge' },
    { mainText: `よく聞かれる「${shortProdJa}って初心者でもいける？」への回答と実際のリンク、全部プロフの固定ポストにまとめておきました📌\n${t1}`, selfReplyText: '', funnelType: 'pinned_bridge' },
    { mainText: `{才能より仕組み|気合より自動化}。毎日コツコツ手動で消耗するのをやめて「${shortProdJa}」に切り替えた記録、プロフの固定ポストからどうぞ📌\n${t1} ${t2}`, selfReplyText: '', funnelType: 'pinned_bridge' }
  ].map(p => ({ ...p, mainText: fitMainPostWithinXWeight(p.mainText) }));

  return {
    modelUsed: 'smart-ja-v2',
    targetLang: 'ja',
    targetSegment: niche.segment,
    recommendedIntervalMin: modeSpec.recommendedIntervalMin,
    recommendedAiReply: modeSpec.recommendedAiReply,
    battleMode: modeSpec.mode,
    aiClosingMessage: `検索流入タグ（${t1} ${t2}）付きの20パターン投稿＋看板ピン留めポストを日本語で生成しました！（AI推奨ペース: ${modeSpec.recommendedIntervalMin}分間隔）`,
    profileBio: fitBioWithinXWeight(rawBioJa, cleanUrl, modeSpec.noUrlInBio, 'ja'),
    aiKeywords: niche.queries.join(', '),
    aiReplyPersona: `相手の投稿内容の具体的な言葉に自然な口調で共感し、宣伝臭を出さずに「自分も同じ状況から『${shortProdJa}』を取り入れて一気にラクになったので、プロフの固定ポストに詳細メモしてあります」と軽く伝えてください。`,
    pinnedPost: {
      mainText: fitMainPostWithinXWeight(`📌【まずはこちら】手作業ゼロで24時間「${shortProdJa}」を回している実際の仕組みと導入手順を公開中⚡\n\n今すぐ確認できる公式リンクは下のツリー（リプ欄）に置いてます👇\n${t1} ${t2}`),
      selfReplyText: `🚀 公式アクセス・詳細ページはこちら👇\n${cleanUrl}`
    },
    posts: jaPosts
  };
}

// ============================================================================
// 見込み客へのAI営業リプライ生成（日英完全ロック・投稿主からの返信+75.0誘発）
// ============================================================================
async function generateEmpathyBridgeReply({
  targetTweetText,
  targetUsername,
  keyword,
  productDesc,
  funnelStyle,
  targetLang,
  aiReplyPersona,
  profileBio
}) {
  const cleanTweet = String(targetTweetText || '').trim().slice(0, 350);
  const cleanProd = String(productDesc || '').trim().slice(0, 180);
  const cleanPersona = String(aiReplyPersona || '').trim().slice(0, 450);
  const lang = normalizeLangCode(targetLang);
  const promptText = lang === 'en'
    ? `Write 1 short, authentic human reply (95–185 chars) in JSON {"replyText": "..."} to the X post below.
STRICT RULES:
- MUST be written strictly in natural, casual English (NEVER output Japanese).
- NO URLs, NO hashtags, NO @mentions, max 1 emoji.
- Reference a specific detail from their post so they want to reply back (+75x algorithm boost), and casually mention how switching your workflow (pinned on your profile) helped you solve that exact issue.
[Target Post]: ${cleanTweet || keyword}
[Our Context]: ${cleanProd || profileBio}
${cleanPersona ? '[Tone Guide]: ' + cleanPersona : ''}`
    : `以下の相手のXポストに対して、生身の人間らしい自然な共感リプライ（全角60〜105文字）をJSON形式 {"replyText": "..."} で1つだけ出力してください。
【厳守ルール】
- 必ず自然な日本語で書くこと。URL・ハッシュタグ・@メンションは絶対に入れないこと（絵文字は最大1個）。
- 相手の投稿内の具体的な言葉に触れて相手が思わず返信したくなる一言を添えつつ、「自分も同じことで詰まってた時に試した仕組み（プロフの固定ポストにメモしてます）で一気にラクになりました」と自然に誘導してください。
【相手のポスト】: ${cleanTweet || keyword}
【こちらのテーマ】: ${cleanProd || profileBio}
${cleanPersona ? '【トーン指針】: ' + cleanPersona : ''}`;

  try {
    const { data } = await runGeminiWithAutoDiscovery(null, promptText);
    if (data && data.replyText) {
      const sanitized = String(data.replyText)
        .replace(/https?:\/\/[^\s]+/gi, '')
        .replace(/@[a-zA-Z0-9_]+/g, '')
        .replace(/#[a-zA-Z0-9_\u3040-\u30ff\u4e00-\u9faf]+/g, '')
        .trim();
      const mismatch = (lang === 'en' && containsJapaneseKana(sanitized)) || (lang === 'ja' && !containsJapaneseKana(sanitized));
      if (!mismatch && sanitized.length >= 15) {
        return lang === 'en' ? sanitized.slice(0, 210) : sanitized.slice(0, 130);
      }
    }
  } catch (e) {}

  if (lang === 'en') {
    const enFallbacks = [
      '100% feel this—used to burn hours on that exact bottleneck until I switched to an automated setup (left the breakdown pinned on my profile if you ever want to compare notes).',
      'Spot on. Consistency is the hardest part when doing it manually—moving that routine onto autopilot changed everything for us (pinned the exact workflow on my profile).'
    ];
    return enFallbacks[Math.floor(Math.random() * enFallbacks.length)];
  }

  const jaFallbacks = [
    'これ本当に分かります…自分も少し前まで全く同じところで消耗してたんですが、今の仕組みに変えてから一気にラクになりました（やった手順はプロフの固定ポストにメモしてあります）',
    'まさにそこ一番時間溶けますよね。うちも同じ状況からいろいろ試してやっと抜け出せたんですが、その時の環境をプロフの固定ポストにまとめてあるので参考になれば覗いてみてください'
  ];
  return jaFallbacks[Math.floor(Math.random() * jaFallbacks.length)];
}

// ============================================================================
// Phase 3 連携用: バズ投稿への「引用ポスト（Quote RT）」相乗りコメント生成
// ============================================================================
async function generateQuoteRtCommentary({ targetTweetText, productDesc, targetLang }) {
  const lang = normalizeLangCode(targetLang);
  const cleanTweet = String(targetTweetText || '').trim().slice(0, 280);
  const cleanProd = String(productDesc || '').trim().slice(0, 120);
  const niche = inferNicheProfile(cleanProd, lang);
  const tag = niche.tags[0] || (lang === 'en' ? '#AIAutomation' : '#副業');
  const promptText = lang === 'en'
    ? `Write 1 sharp, insightful Quote-Tweet commentary (110–210 chars) in JSON {"quoteText": "..."} reacting to the post below.
- Strictly English, NO URLs, include 1 hashtag (${tag}), and end with "Full breakdown in the reply 👇".
[Quoted Post]: ${cleanTweet}
[Our Offer]: ${cleanProd}`
    : `以下のポストを引用リポスト（Quote RT）して自分のタイムラインとおすすめ欄でインプを稼ぐ鋭い一言コメント（全角70〜105文字）をJSON {"quoteText": "..."} で出力してください。
- 日本語固定、URL禁止、末尾に「詳細はリプ欄へ👇 ${tag}」を含めること。
【引用元ポスト】: ${cleanTweet}
【紹介したい仕組み】: ${cleanProd}`;

  try {
    const { data } = await runGeminiWithAutoDiscovery(null, promptText);
    if (data && data.quoteText) {
      const q = fitMainPostWithinXWeight(String(data.quoteText).replace(/https?:\/\/[^\s]+/gi, '').trim());
      const mismatch = (lang === 'en' && containsJapaneseKana(q)) || (lang === 'ja' && !containsJapaneseKana(q));
      if (!mismatch && q.length >= 15) return q;
    }
  } catch (e) {}

  return lang === 'en'
    ? fitMainPostWithinXWeight(`100% truth right here. Once we automated this exact bottleneck with ${cleanProd || 'our cloud stack'}, daily output completely changed. Breakdown in the reply 👇 ${tag}`)
    : fitMainPostWithinXWeight(`これ本当に真理。うちもここを「${cleanProd || '今の自動化環境'}」に切り替えてから毎日の作業効率が劇的に変わった。実際の仕組みはリプ欄へ👇 ${tag}`);
}

module.exports = {
  calcXWeightServer,
  fitMainPostWithinXWeight,
  fitBioWithinXWeight,
  normalizeLangCode,
  inferNicheProfile,
  resolveBattleModeSpec,
  generateAiCampaignAngles,
  generateAiCampaignPayload,
  generateEmpathyBridgeReply,
  generateQuoteRtCommentary
};
