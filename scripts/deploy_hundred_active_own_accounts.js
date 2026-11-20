#!/usr/bin/env node
/**
 * 🚀 Deploy 100 Accounts to "active_own" (自社運用中)
 * 
 * データベース (accounts コレクション) 内の厳選された優良育成アカウントから、
 * 🇯🇵 日本語部隊 50アカウント (lang=ja, 10ジャンル×各5名) -> for @VeloxSystemsV4
 * 🇺🇸 英語部隊   50アカウント (lang=en, 10ジャンル×各5名) -> for @VeloxSystemsHQ
 * 合計100アカウントを一括昇格・配備し、saas_accounts シンジケートプールへ登録するスクリプト。
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { db } = require('../src/firestore');

// 🇯🇵 日本語部隊用 10ジャンル別ペルソナテンプレート (50名)
const JA_GENRE_PERSONAS = [
  // 1. B2B・法人営業・経営 (5名)
  { genre: 'B2B・法人営業・経営', name: '佐藤 健一 | B2B事業開発', bio: 'エンタープライズ営業の仕組み化とセールスOps。商談化率を倍増させるファネル設計を実践発信。', location: '東京 / 丸の内' },
  { genre: 'B2B・法人営業・経営', name: '高橋 創 | 法人マーケ', bio: 'B2Bマーケティング×ABM戦略。リード獲得から受注までのパイプライン歩留まりを改善。', location: '東京' },
  { genre: 'B2B・法人営業・経営', name: '小林 義明 | 営業DX', bio: 'インサイドセールスとSFA連携の最適化。泥臭い営業を科学して自動化する実践記。', location: '大阪' },
  { genre: 'B2B・法人営業・経営', name: '渡辺 翔太 | 経営企画', bio: 'SME経営者のための事業戦略とKPIマネジメント。手作業の機会損失を減らす経営判断。', location: '名古屋' },
  { genre: 'B2B・法人営業・経営', name: '加藤 亮 | クラウド営業', bio: 'クラウドSaaSの直販＆代理店チャネル開拓。B2B営業の成約率向上ノウハウ。', location: '東京 / 虎ノ門' },

  // 2. エンジニア・個人開発・AI (5名)
  { genre: 'エンジニア・個人開発・AI', name: '鈴木 大輔 | AIエンジニア', bio: 'LLM・自律AIエージェントのプロダクト実装。オープンソース開発とアーキテクチャ設計。', location: '東京 / 渋谷' },
  { genre: 'エンジニア・個人開発・AI', name: '田中 悠人 | 個人開発者', bio: 'フルスタック個人開発で月100万MRRを目指す軌跡。Next.js / Python / Docker。', location: '福岡' },
  { genre: 'エンジニア・個人開発・AI', name: '松本 蓮 | プロンプト設計', bio: '業務特化型GPTs・AI自動化パイプライン構築。実践プロンプトとワークフロー公開中。', location: '京都' },
  { genre: 'エンジニア・個人開発・AI', name: '井上 拓海 | クラウド基盤', bio: 'AWS / GCPインフラコスト最適化とサーバーレス分散処理。落ちないシステムの作り方。', location: '横浜' },
  { genre: 'エンジニア・個人開発・AI', name: '清水 健 | DevRel', bio: 'エンジニア組織の開発生産性とAIツール導入支援。コードと技術発信の自動化。', location: '東京' },

  // 3. 業務効率化・Notion・ツール (5名)
  { genre: '業務効率化・Notion・ツール', name: '木村 彩花 | Notionエキスパート', bio: 'Notion×GASで社内ポータルと業務フローを全自動化。日々の無駄タスクをゼロにする仕組み。', location: '東京' },
  { genre: '業務効率化・Notion・ツール', name: '林 翔平 | 業務自動化', bio: 'スプレッドシート・Zapier・Makeで完結する中小企業DX。月間80時間の手作業を削減。', location: '千葉' },
  { genre: '業務効率化・Notion・ツール', name: '斎藤 まゆみ | バックオフィスDX', bio: '総務・経理・労務のペーパーレス化とツール連携。ミスを減らす自動リマインド設計。', location: '埼玉' },
  { genre: '業務効率化・Notion・ツール', name: '池田 陽介 | GAS職人', bio: 'Google Apps Script自動化テンプレート公開。ワンクリックで完了する業務ハック。', location: '仙台' },
  { genre: '業務効率化・Notion・ツール', name: '橋本 奈央 | プロダクティビティ', bio: 'デジタル文具とタスク管理の最適解。仕事に追われないスマートな時間術。', location: '東京 / 吉祥寺' },

  // 4. デザイン・UI/UX・図解 (5名)
  { genre: 'デザイン・UI/UX・図解', name: '森田 結衣 | UI/UXデザイナー', bio: '成約率を高めるランディングページとSaaS画面設計。Figmaコンポーネント管理術。', location: '東京 / 中目黒' },
  { genre: 'デザイン・UI/UX・図解', name: '岡田 健太 | 図解クリエイター', bio: '小難しいビジネス構造を1枚の図解で直感理解。Canvaテンプレートと配色ルール。', location: '神戸' },
  { genre: 'デザイン・UI/UX・図解', name: '藤田 葵 | Webデザイナー', bio: '離脱されないスマホファーストUIとマイクロインタラクション。CVR改善事例。', location: '東京' },
  { genre: 'デザイン・UI/UX・図解', name: '長谷川 陸 | クリエイティブディレクター', bio: '企業のブランドアイデンティティ設計とフォント選定。伝わるビジュアル戦略。', location: '札幌' },
  { genre: 'デザイン・UI/UX・図解', name: '石川 さくら | 動画エディター', bio: 'Premiere Pro時短ショート動画編集。0.5秒で離脱を防ぐカット割り。', location: '東京' },

  // 5. 資産形成・投資・新NISA (5名)
  { genre: '資産形成・投資・新NISA', name: '中島 裕樹 | 資産形成アドバイザー', bio: '新NISA×インデックス投資の超長期複利戦略。無理なく年間120万積み立てる家計管理術。', location: '東京' },
  { genre: '資産形成・投資・新NISA', name: '前田 哲也 | 高配当株投資家', bio: '日米高配当株で月10万円の不労所得ポートフォリオ構築。暴落に動じない分散投資。', location: '愛知' },
  { genre: '資産形成・投資・新NISA', name: '小川 美咲 | 家計再生FP', bio: '固定費削減と先取り貯蓄の仕組み。将来の教育資金と老後不安を数値化して解消。', location: '広島' },
  { genre: '資産形成・投資・新NISA', name: '村上 誠 | 不動産・税務', bio: '法人化・マイクロ法人を活用した合法節税スキームと資産防衛。キャッシュフロー経営。', location: '東京' },
  { genre: '資産形成・投資・新NISA', name: '近藤 健介 | 金融リテラシー', bio: 'インフレ時代に預金だけはNG。初心者でも分かる金融市場の見方と経済ニュース解説。', location: '横浜' },

  // 6. 美容・健康・ヘルスケア (5名)
  { genre: '美容・健康・ヘルスケア', name: '遠藤 美穂 | スキンケアアドバイザー', bio: '皮膚科学に基づいた成分買いコスメ＆美肌ルーティン。無駄な美容課金を防ぐ知識。', location: '東京 / 表参道' },
  { genre: '美容・健康・ヘルスケア', name: '青木 俊樹 | 睡眠コンサルタント', bio: 'スタンフォード式最高の睡眠法実践。朝の光浴と深部体温コントロールで集中力最大化。', location: '東京' },
  { genre: '美容・健康・ヘルスケア', name: '坂本 友美 | 予防医学ナビ', bio: 'デスクワーカーのための眼精疲労・首肩こりリセット術。毎日15分のストレッチ習慣。', location: '神奈川' },
  { genre: '美容・健康・ヘルスケア', name: '福田 達也 | 腸活・インナーケア', bio: '腸内環境を整えて疲れにくい身体を作る。エビデンスに基づくサプリと食事の選び方。', location: '大阪' },
  { genre: '美容・健康・ヘルスケア', name: '西村 佳奈 | メディカルヘルス', bio: 'ストレスコーピングと自律神経の整え方。ワーカホリックな現代人の休息設計。', location: '京都' },

  // 7. 筋トレ・ボディメイク・ダイエット (5名)
  { genre: '筋トレ・ボディメイク・ダイエット', name: '三浦 翔平 | パーソナルトレーナー', bio: '週3回45分の時短ウエイトトレーニング。忙しいビジネスパーソンの体型維持。', location: '東京 / 六本木' },
  { genre: '筋トレ・ボディメイク・ダイエット', name: '岡本 亮太 | PFC管理ダイエッター', bio: '我慢ゼロの脂質制限＆高タンパク自炊飯。3ヶ月で体脂肪-7%達成のロードマップ。', location: '埼玉' },
  { genre: '筋トレ・ボディメイク・ダイエット', name: '竹内 雅人 | ホームジムトレーニー', bio: '自宅器具だけで作る逆三角形ボディ。ダンベル・可変式ベンチで筋肥大を狙う。', location: '千葉' },
  { genre: '筋トレ・ボディメイク・ダイエット', name: '安藤 祐子 | ピラティス講師', bio: '体幹インナーマッスル強化と姿勢矯正。猫背・巻き肩を解消して疲れ知らずの身体へ。', location: '東京' },
  { genre: '筋トレ・ボディメイク・ダイエット', name: '野村 康平 | サプリメント研究', bio: 'クレアチン・EAA・ホエイプロテインの科学的摂取タイミング。無駄買い撲滅。', location: '兵庫' },

  // 8. キャリア・組織・転職 (5名)
  { genre: 'キャリア・組織・転職', name: '工藤 隆 | キャリア戦略コーチ', bio: '年収を最大化する市場価値の高め方。職務経歴書と逆質問で内定率を跳ね上げるテクニック。', location: '東京 / 大手町' },
  { genre: 'キャリア・組織・転職', name: '平野 健太郎 | 組織開発マネージャー', bio: '1on1ミーティングと心理的安全性。若手社員が辞めないエンゲージメント組織構築。', location: '東京' },
  { genre: 'キャリア・組織・転職', name: '大野 晴香 | 人事採用担当', bio: '中途採用の書類選考通過率を上げるポイント。企業が本当に求めているポテンシャルとは。', location: '横浜' },
  { genre: 'キャリア・組織・転職', name: '武田 裕司 | ハイキャリア転職', bio: '外資コンサル・メガベンチャー転職の実践記録。英語面接とケース面接対策。', location: '東京' },
  { genre: 'キャリア・組織・転職', name: '菅原 雄介 | リーダーシップ論', bio: 'プレイングマネージャーの脱却。人に任せる技術と権限委譲のステップ。', location: '名古屋' },

  // 9. 時短料理・ライフハック・朝活 (5名)
  { genre: '時短料理・ライフハック・朝活', name: '原田 陽菜 | 時短ズボラクッキング', bio: '包丁不要・レンジだけで完成する悪魔の簡単レシピ。平日夜の自炊ハードルをゼロに。', location: '東京' },
  { genre: '時短料理・ライフハック・朝活', name: '内田 慎一郎 | 朝活ルーティナー', bio: '毎朝5時起きで読書と筋トレを継続中。意志力に頼らない自動習慣化のトリガー設計。', location: '長野' },
  { genre: '時短料理・ライフハック・朝活', name: '柴田 真帆 | つくりおきマイスター', bio: '日曜90分で平日5日分のおかず完結。冷凍保存テクニックと買い物リスト化。', location: '静岡' },
  { genre: '時短料理・ライフハック・朝活', name: '宮崎 俊輔 | ミニマリスト生活', bio: 'モノを減らして思考をクリアにする持たない暮らし。買ってよかった厳選アイテム。', location: '京都' },
  { genre: '時短料理・ライフハック・朝活', name: '酒井 優美 | タイムマネジメント', bio: '家事の自動化家電（ルンバ・食洗機・ドラム式）導入効果。浮いた時間を自己投資へ。', location: '東京' },

  // 10. EC・D2C・SNSマーケティング (5名)
  { genre: 'EC・D2C・SNSマーケティング', name: '高木 蓮 | D2Cグロースハッカー', bio: 'Shopify×LINE自動化でリピート率向上。顧客体験を最大化するオムニチャネル戦略。', location: '東京 / 原宿' },
  { genre: 'EC・D2C・SNSマーケティング', name: '横山 美咲 | SNSコピーライター', bio: '0.2秒で指を止めるフックの作り方。共感を生んでブックマークされるポスト構造研究。', location: '東京' },
  { genre: 'EC・D2C・SNSマーケティング', name: '久保 拓也 | EC運営ディレクター', bio: '商品企画から広告クリエイティブ改善まで。ROASを引き上げるLP改善テスト。', location: '大阪' },
  { genre: 'EC・D2C・SNSマーケティング', name: '岩崎 健太 | ファンコミュニティ設計', bio: '売上を支えるロイヤルカスタマーの育て方。UGC（クチコミ）創出の仕掛け。', location: '福岡' },
  { genre: 'EC・D2C・SNSマーケティング', name: '松田 真理子 | ブランドストーリーテラー', bio: '中小企業のためのブランド発信。競合と価格競争に巻き込まれない独自ポジション構築。', location: '東京' }
];

// 🇺🇸 英語部隊用 10ジャンル別グローバルペルソナテンプレート (50名)
const EN_GENRE_PERSONAS = [
  // 1. SaaS & B2B Pipeline Growth (5名)
  { genre: 'SaaS & B2B Pipeline Growth', name: 'Alex Vance', bio: 'SaaS pipeline engineer. Scaling enterprise ARR with autonomous multi-agent outbound funnels.', location: 'New York, NY' },
  { genre: 'SaaS & B2B Pipeline Growth', name: 'Marcus Sterling', bio: 'B2B RevOps lead. Fixing PLG churn and accelerating sales velocity without bloated SDR headcount.', location: 'San Francisco, CA' },
  { genre: 'SaaS & B2B Pipeline Growth', name: 'Elena Rostova', bio: 'Enterprise demand gen strategist. Turning zero-click social distribution into qualified SQLs.', location: 'Boston, MA' },
  { genre: 'SaaS & B2B Pipeline Growth', name: 'David Kim', bio: 'B2B founder & ex-GTM consultant. Writing about pipeline math, sales cycle compression, and retention.', location: 'Seattle, WA' },
  { genre: 'SaaS & B2B Pipeline Growth', name: 'Rachel Foster', bio: 'SaaS monetization strategist. Pricing tier architecture and expansion revenue systems.', location: 'Austin, TX' },

  // 2. AI Agents & LLM Dev (5名)
  { genre: 'AI Agents & LLM Dev', name: 'Sophia Chen', bio: 'Autonomous agent researcher & AI engineer. Building multi-model consensus and real-time execution graphs.', location: 'San Francisco, CA' },
  { genre: 'AI Agents & LLM Dev', name: 'Julian Thorne', bio: 'LLM infrastructure architect. Distributed inference optimization and deterministic guardrails.', location: 'London, UK' },
  { genre: 'AI Agents & LLM Dev', name: 'Priya Sharma', bio: 'Applied AI builder. Turning experimental LLM papers into production enterprise automations.', location: 'Toronto, Canada' },
  { genre: 'AI Agents & LLM Dev', name: 'Nikolai Vane', bio: 'Open-source AI developer. Crafting autonomous background workers and dialectical reasoning workflows.', location: 'Berlin, Germany' },
  { genre: 'AI Agents & LLM Dev', name: 'Aaron Brooks', bio: 'Prompt systems engineer. Zero-shot reliability and anti-hallucination pipelines.', location: 'Denver, CO' },

  // 3. Indie Hacking & Micro-SaaS (5名)
  { genre: 'Indie Hacking & Micro-SaaS', name: 'Lucas Miller', bio: 'Solo founder scaling micro-SaaS to $20k MRR. Documenting daily buildinpublic lessons and cash flow.', location: 'Austin, TX' },
  { genre: 'Indie Hacking & Micro-SaaS', name: 'Clara Dupont', bio: 'Indie maker & designer. Bootstrapping profitable tools with lean code and extreme organic reach.', location: 'Paris, France' },
  { genre: 'Indie Hacking & Micro-SaaS', name: 'Evan Wright', bio: 'Solopreneur engineering freedom. Automating customer support, marketing, and deployment.', location: 'Boulder, CO' },
  { genre: 'Indie Hacking & Micro-SaaS', name: 'Mateo Silva', bio: 'Full-stack builder. Testing 6 micro-products a year with zero venture capital.', location: 'Barcelona, Spain' },
  { genre: 'Indie Hacking & Micro-SaaS', name: 'Zack Taylor', bio: 'Software craftsman. Sharing unvarnished metrics from zero to ramen profitability.', location: 'Vancouver, Canada' },

  // 4. Viral Copywriting & Narrative Hooks (5名)
  { genre: 'Viral Copywriting & Narrative Hooks', name: 'Liam Davies', bio: 'B2B copywriter. Architecting 0.2s thumb-stopping hooks that generate high-retention bookmarks.', location: 'London, UK' },
  { genre: 'Viral Copywriting & Narrative Hooks', name: 'Maya Lin', bio: 'Brand narrative strategist. Deconstructing viral frameworks and high-converting audience psychology.', location: 'New York, NY' },
  { genre: 'Viral Copywriting & Narrative Hooks', name: 'Sam Gallagher', bio: 'Direct response copywriter. Transforming dry corporate software into urgent, compelling narratives.', location: 'Chicago, IL' },
  { genre: 'Viral Copywriting & Narrative Hooks', name: 'Zoe Kravitz-Ross', bio: 'Social growth editor. Testing algorithmic link penalties and second-tier reply funnels.', location: 'Los Angeles, CA' },
  { genre: 'Viral Copywriting & Narrative Hooks', name: 'Christian Meyer', bio: 'Executive ghostwriter for Series A founders. Crafting authority without generic corporate speak.', location: 'Zurich, Switzerland' },

  // 5. Productivity & Deep Work Systems (5名)
  { genre: 'Productivity & Deep Work Systems', name: 'Oliver Smith', bio: 'Systems thinker. Designing async deep-work protocols and elimination of calendar fatigue.', location: 'Seattle, WA' },
  { genre: 'Productivity & Deep Work Systems', name: 'Hannah Abbott', bio: 'Workplace architecture consultant. Notion workspaces and zero-meeting operational rhythms.', location: 'Portland, OR' },
  { genre: 'Productivity & Deep Work Systems', name: 'Gabriel Santos', bio: 'Time architect. Engineering leverage by removing 80% of trivial operational tasks.', location: 'Miami, FL' },
  { genre: 'Productivity & Deep Work Systems', name: 'Chloe Martin', bio: 'Digital minimalism practitioner. Clear inputs, focused cognitive outputs, and continuous compounding.', location: 'Dublin, Ireland' },
  { genre: 'Productivity & Deep Work Systems', name: 'Victor Reed', bio: 'High-agency executive operator. Daily execution frameworks and mental clarity routines.', location: 'Salt Lake City, UT' },

  // 6. UI/UX & Design Systems (5名)
  { genre: 'UI/UX & Design Systems', name: 'Daniel Park', bio: 'Staff product designer. Building accessible design systems in Figma and eliminating onboarding friction.', location: 'San Francisco, CA' },
  { genre: 'UI/UX & Design Systems', name: 'Audrey Hepburn-Lee', bio: 'Conversion rate optimization UX lead. Analyzing micro-interactions that double trial-to-paid rates.', location: 'New York, NY' },
  { genre: 'UI/UX & Design Systems', name: 'Leon Moreau', bio: 'Design engineer. Merging tactile aesthetic craftsmanship with scalable front-end code.', location: 'Paris, France' },
  { genre: 'UI/UX & Design Systems', name: 'Mia Robinson', bio: 'Enterprise UI strategist. Simplifying complex dashboard hierarchies for non-technical users.', location: 'Boston, MA' },
  { genre: 'UI/UX & Design Systems', name: 'Felix Weber', bio: 'Minimalist product designer. Designing software that feels calm, fast, and indispensable.', location: 'Munich, Germany' },

  // 7. Fintech & Monetization (5名)
  { genre: 'Fintech & Monetization', name: 'James Wilson', bio: 'Fintech builder & angel investor. Documenting payment orchestration, unit economics, and Stripe integration.', location: 'New York, NY' },
  { genre: 'Fintech & Monetization', name: 'Tara Al-Mansoor', bio: 'SaaS CFO & financial modeler. Payback periods, capital efficiency, and sustainable bootstrapping.', location: 'Dubai, UAE' },
  { genre: 'Fintech & Monetization', name: 'Connor O’Reilly', bio: 'Subscription monetization strategist. Churn reduction algorithms and dynamic pricing models.', location: 'London, UK' },
  { genre: 'Fintech & Monetization', name: 'Brendan Hayes', bio: 'Micro-economics researcher. Testing loss aversion pricing psychology and annual contract velocity.', location: 'Sydney, Australia' },
  { genre: 'Fintech & Monetization', name: 'Serena Vance', bio: 'Venture finance analyst. Cash flow management for high-growth bootstrapped startups.', location: 'Chicago, IL' },

  // 8. Biohacking & Longevity Protocols (5名)
  { genre: 'Biohacking & Longevity Protocols', name: 'Dr. James Harrison', bio: 'Physiology researcher. Circadian sleep optimization, zone-2 metabolic health, and peak cognitive stamina.', location: 'San Diego, CA' },
  { genre: 'Biohacking & Longevity Protocols', name: 'Kelly Sommers', bio: 'Executive health coach. Designing sustainable biomarker tracking and morning light protocols.', location: 'Austin, TX' },
  { genre: 'Biohacking & Longevity Protocols', name: 'Derek Vance', bio: 'Longevity practitioner. Hypertrophy science, protein timing, and VO2 max training for longevity.', location: 'Boulder, CO' },
  { genre: 'Biohacking & Longevity Protocols', name: 'Dr. Evelyn Ward', bio: 'Neuroscience researcher. Dopamine regulation, deep focus states, and mitigating executive burnout.', location: 'Cambridge, MA' },
  { genre: 'Biohacking & Longevity Protocols', name: 'Arjun Mehta', bio: 'Bio-tracking engineer. Using wearable data to eliminate mid-day fatigue and maximize HRV.', location: 'San Francisco, CA' },

  // 9. Creator Economy & Substack (5名)
  { genre: 'Creator Economy & Substack', name: 'Sebastian Cole', bio: 'Newsletter growth architect. Scaling paid Substack subscriptions and high-retention readership.', location: 'New York, NY' },
  { genre: 'Creator Economy & Substack', name: 'Isabella Rossi', bio: 'Digital product publisher. Monetizing intellectual capital into compounding evergreen courses.', location: 'Rome, Italy' },
  { genre: 'Creator Economy & Substack', name: 'Tyler Bennett', bio: 'Audience flywheel engineer. Repurposing long-form essays into viral social snippets.', location: 'Nashville, TN' },
  { genre: 'Creator Economy & Substack', name: 'Natasha Romanova', bio: 'Creator business strategist. Building 7-figure personal monopolies without algorithmic dependency.', location: 'Toronto, Canada' },
  { genre: 'Creator Economy & Substack', name: 'Grant Mitchell', bio: 'Media operator. Sponsorship monetization, newsletter deliverability, and audience trust.', location: 'Atlanta, GA' },

  // 10. Executive Leadership & High Agency (5名)
  { genre: 'Executive Leadership & High Agency', name: 'Arthur Pendelton', bio: 'Startup operator & advisor. Hiring high-agency leaders and building resilient decentralized teams.', location: 'San Francisco, CA' },
  { genre: 'Executive Leadership & High Agency', name: 'Camilla Valente', bio: 'Executive coach for tech founders. Conflict resolution, strategic alignment, and boardroom psychology.', location: 'London, UK' },
  { genre: 'Executive Leadership & High Agency', name: 'Trevor Vance', bio: 'Operations director. Designing company-wide operating cadences and single-threaded ownership.', location: 'New York, NY' },
  { genre: 'Executive Leadership & High Agency', name: 'Danielle Cooper', bio: 'Talent architecture lead. Identifying top 1% operators who solve problems without supervision.', location: 'Chicago, IL' },
  { genre: 'Executive Leadership & High Agency', name: 'Howard Hughes Jr.', bio: 'Scale advisor. Lessons on transitioning from founder-led hustle to autonomous system scale.', location: 'Austin, TX' }
];

async function deployHundredActiveOwnAccounts() {
  console.log('========================================================================');
  console.log('🚀 Deploying 100 Multi-Genre Accounts to "active_own" (自社運用中)');
  console.log('   🇯🇵 50 Japanese Accounts (10 Genres x 5 Accounts) -> for @VeloxSystemsV4');
  console.log('   🇺🇸 50 English Accounts (10 Genres x 5 Accounts) -> for @VeloxSystemsHQ');
  console.log('========================================================================\n');

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

  // 育成サイクル・ツイート実績順にソート (既に実績のある強固なアカウントを優先配備)
  candidates.sort((a, b) => {
    const scoreA = (a.data.farmingCycles || 0) * 10 + (a.data.recentTweets || []).length;
    const scoreB = (b.data.farmingCycles || 0) * 10 + (b.data.recentTweets || []).length;
    return scoreB - scoreA;
  });

  if (candidates.length < 100) {
    console.error(`❌ 候補アカウントが不足しています (必要: 100, 検出: ${candidates.length})`);
    process.exit(1);
  }

  const selected100 = candidates.slice(0, 100);
  const jaAccounts = selected100.slice(0, 50);
  const enAccounts = selected100.slice(50, 100);

  console.log(`✅ Selected 100 top-tier healthy accounts from ${candidates.length} candidate pool.`);

  // 2. 日本語部隊 50アカウントの更新
  console.log('\n🇯🇵 [Deploying 50 Japanese Multi-Genre Accounts]');
  for (let i = 0; i < jaAccounts.length; i++) {
    const acc = jaAccounts[i];
    const persona = JA_GENRE_PERSONAS[i] || JA_GENRE_PERSONAS[0];
    const username = acc.data.username || acc.data.userId || `ja_syndicate_${i + 1}`;

    await acc.ref.update({
      status: 'active_own',
      role: 'syndicate_ja',
      lang: 'ja',
      name: persona.name,
      bio: persona.bio,
      location: persona.location,
      genre: persona.genre,
      targetSponsorship: '@VeloxSystemsV4',
      isSyndicateActive: true,
      lastPromotedToOwnAt: new Date(),
      updatedAt: new Date()
    });

    if ((i + 1) % 10 === 0 || i === 0 || i === 49) {
      console.log(`  [JA #${i + 1}/50] ID: ${acc.id.slice(0, 8)}... | ${persona.genre} | ${persona.name} -> 🔵 active_own (JA)`);
    }
  }

  // 3. 英語部隊 50アカウントの更新
  console.log('\n🇺🇸 [Deploying 50 English Multi-Genre Accounts]');
  for (let i = 0; i < enAccounts.length; i++) {
    const acc = enAccounts[i];
    const persona = EN_GENRE_PERSONAS[i] || EN_GENRE_PERSONAS[0];
    const username = acc.data.username || acc.data.userId || `en_syndicate_${i + 1}`;

    await acc.ref.update({
      status: 'active_own',
      role: 'syndicate_en',
      lang: 'en',
      name: persona.name,
      bio: persona.bio,
      location: persona.location,
      genre: persona.genre,
      targetSponsorship: '@VeloxSystemsHQ',
      isSyndicateActive: true,
      lastPromotedToOwnAt: new Date(),
      updatedAt: new Date()
    });

    if ((i + 1) % 10 === 0 || i === 0 || i === 49) {
      console.log(`  [EN #${i + 1}/50] ID: ${acc.id.slice(0, 8)}... | ${persona.genre} | ${persona.name} -> 🔵 active_own (EN)`);
    }
  }

  // 4. 自社アカウントコレクション (saas_accounts) へ100台を一括ミラー登録 (50件ずつバッチ分割)
  console.log('\n🔄 Mirroring 100 accounts to saas_accounts syndicate pool...');

  // 日本語公式オーナー: WEB-GOOGLE-D12E2479A76266AEA2B4
  const batch1 = db.batch();
  for (let i = 0; i < jaAccounts.length; i++) {
    const acc = jaAccounts[i];
    const persona = JA_GENRE_PERSONAS[i];
    const uName = acc.data.username || acc.data.userId || acc.id.slice(0, 10);
    const mRef = db.collection('saas_accounts').doc(`own_ja_${uName.toLowerCase()}`);
    batch1.set(mRef, {
      ownerUserId: 'WEB-GOOGLE-D12E2479A76266AEA2B4',
      username: uName,
      name: persona.name,
      bio: persona.bio,
      location: persona.location,
      genre: persona.genre,
      lang: 'ja',
      status: 'active_own',
      role: '自社利用中',
      isSyndicateSquad: true,
      authToken: acc.data.authToken,
      ct0: acc.data.ct0,
      updatedAt: new Date()
    }, { merge: true });
  }
  await batch1.commit();
  console.log('  ✅ 50 Japanese syndicate accounts mirrored to saas_accounts.');

  // グローバル公式オーナー: USR-MVUA1GLP-D640
  const batch2 = db.batch();
  for (let i = 0; i < enAccounts.length; i++) {
    const acc = enAccounts[i];
    const persona = EN_GENRE_PERSONAS[i];
    const uName = acc.data.username || acc.data.userId || acc.id.slice(0, 10);
    const mRef = db.collection('saas_accounts').doc(`own_en_${uName.toLowerCase()}`);
    batch2.set(mRef, {
      ownerUserId: 'USR-MVUA1GLP-D640',
      username: uName,
      name: persona.name,
      bio: persona.bio,
      location: persona.location,
      genre: persona.genre,
      lang: 'en',
      status: 'active_own',
      role: '自社利用中',
      isSyndicateSquad: true,
      authToken: acc.data.authToken,
      ct0: acc.data.ct0,
      updatedAt: new Date()
    }, { merge: true });
  }
  await batch2.commit();
  console.log('  ✅ 50 English syndicate accounts mirrored to saas_accounts.');

  console.log('\n========================================================================');
  console.log('🎉 100 ACCOUNTS FULLY DEPLOYED TO "active_own"!');
  console.log('   🇯🇵 50 Accounts (10 Genres) actively boosting @VeloxSystemsV4');
  console.log('   🇺🇸 50 Accounts (10 Genres) actively boosting @VeloxSystemsHQ');
  console.log('========================================================================\n');

  return { ok: true, jaCount: jaAccounts.length, enCount: enAccounts.length, total: 100 };
}

if (require.main === module) {
  deployHundredActiveOwnAccounts().catch(err => {
    console.error('Fatal error during deployment:', err);
    process.exit(1);
  });
}

module.exports = { deployHundredActiveOwnAccounts, JA_GENRE_PERSONAS, EN_GENRE_PERSONAS };
