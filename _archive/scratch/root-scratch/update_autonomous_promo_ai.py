import re

with open('src/autonomous_promo_ai.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update deliberateCouncilStrategy signature to accept userPlan
old_sig = "async function deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone = 'Asia/Tokyo', userKnowledge = null) {"
new_sig = "async function deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone = 'Asia/Tokyo', userKnowledge = null, userPlan = 'pro') {"
code = code.replace(old_sig, new_sig, 1)

# 2. In deliberateCouncilStrategy prompt, include contract plan & target post count
old_prompt_marker = "- 予約タイムゾーン: ${scheduleTimeZone}（時間帯・理由はこの現地時間を基準にし、理由にもタイムゾーン名を明記）"
new_prompt_marker = """- 予約タイムゾーン: ${scheduleTimeZone}（時間帯・理由はこの現地時間を基準にし、理由にもタイムゾーン名を明記）
- 契約プラン: ${userPlan} (ビジネス: 1日5投稿 / プロ運用: 1日3投稿 / スターター: 1日1投稿)"""
code = code.replace(old_prompt_marker, new_prompt_marker, 1)

# 3. Update fallback councilPlan in deliberateCouncilStrategy to support 1, 3, or 5 posts
old_fallback_postplan = """      postPlan: [
        {
          step: 1,
          format: 'single_empathy',
          timeSlot: 'morning',
          angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示（一次データ＋共感）',
          angle_en: 'Operational Cost Recovery & Executive Empathy',
          scores: { hook: 96, empathy: 97, algo: 94, brand: 95, total: 95.5 },
          rationale: {
            whyThisTime: '朝7:30〜8:00の出勤時間帯。意思決定層が移動中に一人でスマホを見るため、共感フックが最も深く刺さる。',
            whyThisTime_en: 'Matches morning 7:30 AM executive commute peak when decision-makers review feeds alone.',
            hookLogic: '冒頭1行目で『毎朝の工数逼迫（月30時間の消失）』を具体的数字で示し、スクロールを完全停止させる。',
            hookLogic_en: 'Opens with quantifiable operational drag ($1,400/month executive waste) to stop 0.2s thumb-scrolling.',
            empathyLogic: '孤独に奮闘する経営者へのリスペクトを担保し、説教臭さやAI臭を完全排除。',
            empathyLogic_en: 'Frames manual grind not as laziness, but as misplaced discipline, building executive solidarity.',
            algorithmSafety: '直リンクなし。純粋な共感と有益性でいいね・リポスト初速を獲得し、アルゴリズムのおすすめTLへ乗せる。',
            algorithmSafety_en: 'Zero in-body URLs, avoiding reach penalties while maximizing early bookmarks & dwell time.'
          },
          postDeliberation: {
            hookOfficer: '朝7:30の出勤時間、スマホを見る経営者の親指は0.2秒で次へスクロールする。冒頭1行目に「毎朝45分画面を睨み、月30時間を手動運用に溶かして商談ゼロ」という具体的かつ冷徹な数字を突きつけ、思考停止の努力を外科手術する。ぬるい挨拶や「〜ですね」は一切排除した。',
            hookOfficer_en: 'At the 7:30 AM commute rush, executive thumbs scroll past weak content in 0.2 seconds. We open with cold, quantifiable pain: Burning 45 minutes every morning to manually draft posts with zero qualified pipeline is draining $1,400/month in hidden operational overhead.',
            empathyOfficer: '「努力の方向が違うだけです。真面目な担当者ほど精神論に追い込まれている」という連帯の言葉を配置。読者を責め立てるのではなく、孤独に奮闘する姿への深い敬意と自尊心の救済を優先した。味方として認知されなければ、どんな数字も反発を生むだけだ。',
            empathyOfficer_en: 'We frame manual effort not as laziness, but as misplaced discipline: Dedicated founders are being burned out by brute-force tasks. Preserving dignity is essential; numbers without respect create friction.',
            algoOfficer: '外部リンク減衰ゼロ。純粋な共感テキスト投稿として初速のいいね・リポストを稼ぎ、おすすめ（For You）のスコアを最大化させるアルゴリズム最適設計。',
            algoOfficer_en: 'Zero link penalty. Formats as clean narrative copy to maximize early bookmarks and likes, optimizing the For You algorithmic scoring threshold.',
            brandOfficer: 'AI特有の「いかがでしたか」「必見です！」といった陳腐構文を徹底検閲。上場企業役員が読んでも違和感のない重厚で知的なプロフェッショナル口調を死守した。',
            brandOfficer_en: 'Completely purged AI conversational clichés. Preserves a dignified, authoritative executive voice suitable for enterprise decision-makers.',
            investorOfficer: '月30時間の工数は月額20万円以上の隠れ人件費だ。これを放置するのは経営上の大赤字。数字で損失を自覚させることが、最短距離で商談化へ導く投資対効果の第一歩だ。',
            investorOfficer_en: '30 hours of monthly manual drafting equals over $2,000 in executive waste. Exposing this invisible operational drag is the fastest catalyst for procurement decisions.',
            founderOfficer: '毎朝45分悩んで2いいねで終わるあの惨めさ……まさに俺たちのリアルだ。「努力の方向が違う」って言葉に救われた。これなら現場の仲間も頷く。',
            founderOfficer_en: 'Staring at a blank screen for 45 minutes every morning just to get 2 likes is agonizing. Validating that frustration makes operators nod immediately.',
            chiefCommander: '安易な妥協案をすべて却下し、朝の時間帯に最適化された唯一無二の鋭利な文章として本会合で正式承認した。',
            chiefCommander_en: 'All low-substance compromises rejected. Formally ratified as an incisive, morning-hour strategic post tailored for maximum enterprise conversion.'
          }
        },
        {
          step: 2,
          format: 'quote_debate_trap',
          timeSlot: 'noon',
          angle: '常識の逆張り・引用RT議論惹起型ディベートトラップ（脱・リプ欄URL依存）',
          angle_en: 'Challenging Common Wisdom & Quote Tweet Debate Velocity',
          scores: { hook: 97, empathy: 93, algo: 98, brand: 94, total: 95.5 },
          rationale: {
            whyThisTime: '昼休み12:05〜12:45。タイムラインのアクティブ数が急増し、引用RTでの議論が急速に広がる。',
            whyThisTime_en: '12:05-12:45 PM lunch peak when timeline engagement velocity reaches maximum daily velocity.',
            hookLogic: '「B2Bはリプ欄にURLを貼ればリードが獲れるという常識は間違い」と反直感を提起し、プロの議論を誘発。',
            hookLogic_en: 'Challenges the myth of reply-link funnels with hard platform data to trigger peer repost debates.',
            empathyLogic: '現場の固定観念を解体し、知的刺激を与える。',
            empathyLogic_en: 'Stimulates peer respect by framing the post as an intellectual debate among industry experts.',
            algorithmSafety: '外部リンク完全排除。引用リポスト（Quote Tweet）を誘発することで、Conversation Scoreを最大化させる。',
            algorithmSafety_en: 'Zero links. Triggers Quote Reposts, the highest-weighted algorithmic metric in the 2026 engine.'
          },
          postDeliberation: {
            hookOfficer: '昼休み、多くのマーケターがスマホを眺める時間に「B2Bはリプ欄にURLを貼ればリードが獲れるという常識は完全に間違い」と反直感をぶつける。「なぜなら…」と理由を展開し、現場のプライドを刺激して引用RT議論を意図的に巻き起こす。',
            hookOfficer_en: 'During the lunch hour, marketers review timeline feeds. We challenge common wisdom: Believing that dropping URLs in reply threads guarantees B2B leads is obsolete. We provide a data-backed breakdown to trigger high-intent quote repost debates.',
            empathyOfficer: '「現場のマーケターはどう答えますか？」という問いかけは、上からの説教ではなく同業者・プロ同士の対等な知的ディベートとして設計。悔しさと当事者意識を刺激し、リポストや引用へのハードルを下げる。',
            empathyOfficer_en: 'We frame "How does your team handle this?" as an intellectual peer debate rather than condescending advice, encouraging quotes and shares.',
            algoOfficer: '2026年最新アルゴリズムにおいて最重要指標であるConversation Score（会話・引用RT率）を直撃。外部リンクを一切貼らないため、ペナルティなしでTLの議論を独占できる。',
            algoOfficer_en: 'Optimizes Conversation Velocity—the highest weighted metric in Xs recommendation engine. Zero links ensure complete timeline retention without reach decay.',
            brandOfficer: '知的な問題提起でありながら企業の品格を担保。単なる逆張り炎上ではなく、業界全体の生産性向上を志すリーダーシップを印象付ける。',
            brandOfficer_en: 'Positions the brand as an authoritative thought leader addressing industry-wide operational efficiency, rather than a controversial engagement farmer.',
            investorOfficer: 'リプ欄URLのCVRが0.01%以下に沈む現実を突きつけ、感情論ではなく経済合理性で動く意思決定層を刈り取る。',
            investorOfficer_en: 'Highlights that reply links yield sub-0.01% CTR, guiding rational decision-makers toward structural marketing automation.',
            founderOfficer: '「リプ欄リンク効かないよな」って薄々気づいてた現場のモヤモヤを代弁してくれた。思わず引用RTで一言言いたくなる。',
            founderOfficer_en: 'Articulates what operators secretly know: Reply links do not work anymore. Gives them language to voice their practical experience.',
            chiefCommander: '昼の活発なタイムラインに投下する議論トラップとして完璧な構成。全会一致で承認する。',
            chiefCommander_en: 'Ratified unanimously as a mathematically superior mid-day debate catalyst.'
          }
        },
        {
          step: 3,
          format: 'four_tier_thread',
          timeSlot: 'night',
          angle: '世間のためになる有益ノウハウ：2026年最新Xアルゴリズムの真実 ＆ シャドウバン即時回避・解除完全マニュアル',
          angle_en: 'Universal High-Value Blueprint: 2026 Algorithm Mechanics & Shadowban Recovery Manual',
          scores: { hook: 98, empathy: 97, algo: 99, brand: 98, total: 98.0 },
          rationale: {
            whyThisTime: '夜21:15〜22:00の就寝前ゴールデンタイム。タイムライン上で最も長文スレッドが精読・熟読され、ブックマーク（保存）が急増するピーク時間帯。',
            whyThisTime_en: 'Evening 21:15-22:00 peak when decision-makers read structured long-form threads and bookmark high-value blueprints before bedtime.',
            hookLogic: '「インプ急減とシャドウバンの危険性」という全X運用者が最も恐れる痛点を突いて0.2秒で親指を停止させ、4段スレッドで深層解説。',
            hookLogic_en: 'Targets the urgent fear of reach decay and shadowbans to halt timeline scrolling, delivering a 4-part value thread.',
            empathyLogic: '理不尽なアルゴリズム変動に苦しむ運用者を救済し、圧倒的ギブ（世間のためになる知見）で絶大な信用とフォロワーを獲得する。',
            empathyLogic_en: 'Provides authentic structural relief and universal goodwill, converting cold timeline readers into loyal followers.',
            algorithmSafety: '親ツイート完全リンクフリー。ブックマーク加点（+10倍）と滞在時間（Dwell Time）の最大化、スレッド読了率でFor YouおすすめTLを独占する。',
            algorithmSafety_en: 'Zero links on root tweet. Maximize Bookmark Velocity (+10.0 weight) and thread dwell time to dominate algorithmic recommendations.'
          },
          postDeliberation: {
            hookOfficer: '夜の就寝前、タイムラインを見る運用者に向けて「【警告】最近急にインプレッションが落ちた人、これ見落としてたら一発でシャドウバン対象です」と投下。4段構成のスレッドで親指を完全に停止させる。',
            hookOfficer_en: 'Deploys an urgent warning on shadowban risks and reach drop to stop thumb scrolls at 9:30 PM, routing readers through a 4-part master thread.',
            empathyOfficer: 'ただのツール宣伝ではなく「世間のためになる一次情報」を包み隠さず提供する。この圧倒的ギブの姿勢が、読者の心を動かし「このアカウントはフォロー必須」と思わせる。',
            empathyOfficer_en: 'Delivers pure high-utility education rather than self-serving promotion. Generous value creation creates instant trust and followers.',
            algoOfficer: '4段スレッドは滞在時間（Dwell Time）を極限まで引き延ばす。さらにブックマーク率が通常の単発ツイートの3.5倍に達するため、2026年アルゴリズムで最高峰の推薦スコアを獲得する。',
            algoOfficer_en: 'A 4-part connected thread multiplies dwell time by 4x and bookmark rates by 3.5x, achieving maximum rank in the recommendation graph.',
            brandOfficer: '上場企業・エンジニア組織としての高い知見と品格を証明。浅い量産型Tipsと完全に差別化された骨太なドキュメントとして位置付ける。',
            brandOfficer_en: 'Demonstrates deep systems engineering and platform expertise, setting a high standard of authority.',
            investorOfficer: '信頼残高の蓄積こそが最も低コストな見込み客獲得。有益情報で惹きつけられた読者は、プロフの固定記事から極めて高い成約率で商談化する。',
            investorOfficer_en: 'Accumulating trust capital is the highest-ROI acquisition strategy, yielding warm enterprise inquiries.',
            founderOfficer: 'シャドウバンの原因や解除手順が具体的に書かれてたら、そりゃ即ブクマしてフォローする。現場の切実な悩みに直撃してる。',
            founderOfficer_en: 'Concrete recovery steps for shadowbans are instantly bookmarkable. Speaks directly to real operator pain.',
            chiefCommander: 'フォロワー獲得と権威性確立を同時に果たす4段骨太スレッドとして全会一致で採択する。',
            chiefCommander_en: 'Unanimously ratified as our authoritative 4-stage flagship value thread.'
          }
        }
      ]"""

new_fallback_postplan = """      postPlan: (() => {
        const full5Posts = [
          {
            step: 1,
            format: 'single_empathy',
            timeSlot: 'morning',
            angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示（一次データ＋共感）',
            angle_en: 'Operational Cost Recovery & Executive Empathy',
            scores: { hook: 96, empathy: 97, algo: 94, brand: 95, total: 95.5 },
            rationale: {
              whyThisTime: '朝08:30の出勤時間帯。意思決定層が移動中に一人でスマホを見るため、共感フックが最も深く刺さる。',
              whyThisTime_en: 'Matches morning 8:30 AM executive commute peak when decision-makers review feeds alone.',
              hookLogic: '冒頭1行目で『毎朝の工数逼迫（月30時間の消失）』を具体的数字で示し、スクロールを完全停止させる。',
              hookLogic_en: 'Opens with quantifiable operational drag ($1,400/month executive waste) to stop 0.2s thumb-scrolling.',
              empathyLogic: '孤独に奮闘する経営者へのリスペクトを担保し、説教臭さやAI臭を完全排除。',
              empathyLogic_en: 'Frames manual grind not as laziness, but as misplaced discipline, building executive solidarity.',
              algorithmSafety: '直リンクなし。純粋な共感と有益性でいいね・リポスト初速を獲得し、アルゴリズムのおすすめTLへ乗せる。',
              algorithmSafety_en: 'Zero in-body URLs, avoiding reach penalties while maximizing early bookmarks & dwell time.'
            },
            postDeliberation: {
              hookOfficer: '朝08:30の出勤時間、スマホを見る経営者の親指は0.2秒で次へスクロールする。冷徹な数字を突きつけ、思考停止の努力を外科手術する。',
              hookOfficer_en: 'At 8:30 AM commute rush, executive thumbs scroll past weak content in 0.2 seconds.',
              empathyOfficer: '孤独に奮闘する姿への深い敬意と自尊心の救済を最優先した。',
              empathyOfficer_en: 'Preserving dignity is essential; numbers without respect create friction.',
              algoOfficer: '直リンクなし。純粋な共感テキスト投稿として初速のいいね・リポストを稼ぐ設計。',
              algoOfficer_en: 'Zero link penalty. Formats as clean narrative copy to maximize early bookmarks.',
              brandOfficer: 'AI特有の陳腐構文を徹底検閲。重厚で知的なプロフェッショナル口調を死守した。',
              brandOfficer_en: 'Completely purged AI conversational clichés.',
              investorOfficer: '月30時間の工数は月額20万円以上の隠れ人件費。損失を自覚させ商談化へ導く。',
              investorOfficer_en: '30 hours of monthly manual drafting equals over $2,000 in executive waste.',
              founderOfficer: '現場のリアルな痛みに直撃している。これなら仲間も頷く。',
              founderOfficer_en: 'Speaks directly to operator frustration.',
              chiefCommander: '朝の時間帯に最適化された文章として本会合で正式承認した。',
              chiefCommander_en: 'Formally ratified as an incisive morning-hour post.'
            }
          },
          {
            step: 2,
            format: 'quote_debate_trap',
            timeSlot: 'noon',
            angle: '常識の逆張り・引用RT議論惹起型ディベートトラップ（脱・リプ欄URL依存）',
            angle_en: 'Challenging Common Wisdom & Quote Tweet Debate Velocity',
            scores: { hook: 97, empathy: 93, algo: 98, brand: 94, total: 95.5 },
            rationale: {
              whyThisTime: '昼休み12:30。タイムラインのアクティブ数が急増し、引用RTでの議論が急速に広がる。',
              whyThisTime_en: '12:30 PM lunch peak when timeline engagement velocity reaches maximum daily velocity.',
              hookLogic: '「B2Bはリプ欄にURLを貼ればリードが獲れるという常識は間違い」と反直感を提起し、プロの議論を誘発。',
              hookLogic_en: 'Challenges the myth of reply-link funnels with hard platform data to trigger peer repost debates.',
              empathyLogic: '現場の固定観念を解体し、知的刺激を与える。',
              empathyLogic_en: 'Stimulates peer respect by framing the post as an intellectual debate among industry experts.',
              algorithmSafety: '外部リンク完全排除。引用リポストを誘発し、会話スコアを最大化させる。',
              algorithmSafety_en: 'Zero links. Triggers Quote Reposts, the highest-weighted algorithmic metric.'
            },
            postDeliberation: {
              hookOfficer: '昼休み、多くのマーケターがスマホを眺める時間に反直感をぶつけ、引用RT議論を意図的に巻き起こす。',
              hookOfficer_en: 'Triggers quote repost debates during the lunch hour peak.',
              empathyOfficer: '上からの説教ではなく同業者同士の知的ディベートとして設計。',
              empathyOfficer_en: 'Intellectual peer debate rather than condescending advice.',
              algoOfficer: '最重要指標であるConversation Score（会話・引用RT率）を直撃。',
              algoOfficer_en: 'Optimizes Conversation Velocity—the highest weighted metric.',
              brandOfficer: '業界全体の生産性向上を志すリーダーシップを印象付ける。',
              brandOfficer_en: 'Positions the brand as an authoritative thought leader.',
              investorOfficer: 'リプ欄URLのCVRが0.01%以下に沈む現実を突きつけ、合理的な意思決定層を刈り取る。',
              investorOfficer_en: 'Highlights that reply links yield sub-0.01% CTR.',
              founderOfficer: '「リプ欄リンク効かないよな」という現場のモヤモヤを代弁してくれた。',
              founderOfficer_en: 'Articulates what operators secretly know.',
              chiefCommander: '昼のタイムラインに投下する議論トラップとして完璧。承認する。',
              chiefCommander_en: 'Ratified unanimously as a mid-day debate catalyst.'
            }
          },
          {
            step: 3,
            format: 'single_value',
            timeSlot: 'afternoon',
            angle: '夕方の業務ハック・工数解放Before/After（残業削減から売上倍増へ）',
            angle_en: 'Afternoon Operational Hack & Before/After Conversion',
            scores: { hook: 95, empathy: 96, algo: 95, brand: 95, total: 95.2 },
            rationale: {
              whyThisTime: '夕方17:30の退勤・移動ラッシュ。今日の業務の振り返りと明日の改善策を求める時間帯。',
              whyThisTime_en: 'Evening 17:30 commute when executives reflect on daily productivity and operational bottlenecks.',
              hookLogic: '「残業月40時間→定時退社で売上2倍」の鮮明なBefore/Afterでスクロールを止める。',
              hookLogic_en: 'Highlights a stark 40hr/mo overhead reduction to halt feed scrolling.',
              empathyLogic: '経営者の役割は「作業」ではなく「戦略」であるという本質的な解放感を提供。',
              empathyLogic_en: 'Emphasizes that executive responsibility is strategy, not repetitive mechanical drafting.',
              algorithmSafety: 'クリーンテキストによる読了率とリポスト率の最大化。',
              algorithmSafety_en: 'Clean narrative copy designed to maximize timeline dwell time.'
            },
            postDeliberation: {
              hookOfficer: '17:30の退勤時に「作業で一日が終わるな」と強烈な気付きを提示。',
              hookOfficer_en: 'Prompts immediate executive self-reflection during evening commute.',
              empathyOfficer: '真面目な担当者が抱える慢性残業の痛みを完全に言語化。',
              empathyOfficer_en: 'Validates operational fatigue with actionable systemic relief.',
              algoOfficer: '夕方のTLアクティブ急増時間に適合した高読了率テキスト。',
              algoOfficer_en: 'Engineered for high completion and dwell time during evening peak.',
              brandOfficer: '知的な業務改革リーダーシップを確立。',
              brandOfficer_en: 'Reinforces executive engineering pedigree.',
              investorOfficer: '工数削減から直接売上へ繋がる最短動線を証明。',
              investorOfficer_en: 'Clear ROI line from time reclamation to pipeline conversion.',
              founderOfficer: '「定時で帰って戦略を練る」という理想を思い出させてくれる。',
              founderOfficer_en: 'Reminds founders of their true leverage points.',
              chiefCommander: 'ビジネスプラン限定の第3スロットとして採択。',
              chiefCommander_en: 'Ratified for highest-tier multi-post schedule.'
            }
          },
          {
            step: 4,
            format: 'four_tier_thread',
            timeSlot: 'evening',
            angle: '世間のためになる有益ノウハウ：2026年最新Xアルゴリズムの真実 ＆ シャドウバン即時回避・解除完全マニュアル',
            angle_en: 'Universal High-Value Blueprint: 2026 Algorithm Mechanics & Shadowban Recovery Manual',
            scores: { hook: 98, empathy: 97, algo: 99, brand: 98, total: 98.0 },
            rationale: {
              whyThisTime: '夜20:00のプライムタイム。タイムライン上で最も長文スレッドが精読・熟読され、ブックマークが急増するピーク。',
              whyThisTime_en: 'Evening 20:00 peak when decision-makers read structured threads and bookmark blueprints.',
              hookLogic: '「インプ急減とシャドウバンの危険性」という痛点を突いて0.2秒停止。',
              hookLogic_en: 'Targets reach drop and shadowban anxiety to stop scrolls.',
              empathyLogic: '理不尽なアルゴリズム変動に苦しむ運用者を救済し、圧倒的ギブで信頼を獲得。',
              empathyLogic_en: 'Provides universal goodwill to convert readers into loyal followers.',
              algorithmSafety: '親ツイート完全リンクフリー。ブックマーク加点（+10倍）と滞在時間を最大化。',
              algorithmSafety_en: 'Zero links on root tweet. Maximize Bookmark Velocity (+10.0 weight).'
            },
            postDeliberation: {
              hookOfficer: '20:00のプライムタイムに4段骨太スレッドを投下し親指を完全停止させる。',
              hookOfficer_en: 'Deploys a high-retention 4-part thread during prime reading peak.',
              empathyOfficer: 'ただの宣伝ではなく一次情報を惜しみなくギブし絶大な信頼を獲得。',
              empathyOfficer_en: 'Pure utility education creating instant trust.',
              algoOfficer: 'ブックマーク率が通常の3.5倍に達し、推薦グラフで最高峰スコアを獲得。',
              algoOfficer_en: 'Maximizes bookmarks and thread dwell time.',
              brandOfficer: 'エンジニア組織としての高い知見と品格を証明。',
              brandOfficer_en: 'Demonstrates deep systems engineering authority.',
              investorOfficer: '信頼残高の蓄積こそが最も低コストな高単価見込み客獲得。',
              investorOfficer_en: 'Accumulating trust capital is the highest-ROI acquisition.',
              founderOfficer: 'シャドウバンの原因や解除手順が具体的に書かれてたら即ブクマする。',
              founderOfficer_en: 'Actionable recovery steps are immediately bookmarkable.',
              chiefCommander: 'フォロワー獲得と権威性確立を同時に果たすスレッドとして採択。',
              chiefCommander_en: 'Unanimously ratified as authoritative value thread.'
            }
          },
          {
            step: 5,
            format: 'single_reflection',
            timeSlot: 'night',
            angle: '深夜の静かな本音考察：フォロワー500人で毎月商談が絶えないアカウントの設計思想',
            angle_en: 'Late-Night Quiet Insight: Account Architecture Converting at 500 Followers',
            scores: { hook: 96, empathy: 98, algo: 95, brand: 97, total: 96.5 },
            rationale: {
              whyThisTime: '深夜22:30の就寝前。リラックスした状態でじっくり心に染み渡る思索的ポストが好まれる時間帯。',
              whyThisTime_en: 'Late-night 22:30 quiet reflection peak when executives read thoughtful long-form observations.',
              hookLogic: '「万人受けのバズ vs 1人の意思決定者に深く刺す設計」の対比で深く引き込む。',
              hookLogic_en: 'Contrasts vanity impression chasing with high-intent decision-maker targeting.',
              empathyLogic: '数字ゲームに疲弊した運用者に寄り添い、本質的なビジネス価値へ着地させる。',
              empathyLogic_en: 'Reassures founders exhausted by vanity metrics, redirecting focus to high-value pipeline.',
              algorithmSafety: '夜間の読了滞在時間を最大化し、翌朝のTL露出へ繋ぐ。',
              algorithmSafety_en: 'Maximizes night dwell time, rolling momentum into next-morning recommendation graph.'
            },
            postDeliberation: {
              hookOfficer: '深夜22:30、静かに考え込む経営者の心に刺さる言葉を配置。',
              hookOfficer_en: 'Resonates deeply during late-night quiet contemplation.',
              empathyOfficer: '「誰に向けて書くか」という原点に立ち返る安らぎと確信を提供。',
              empathyOfficer_en: 'Re-centers reader on core purpose and authenticity.',
              algoOfficer: '滞在時間の蓄積が翌朝のレコメンド初速を底上げする。',
              algoOfficer_en: 'Dwell time carries momentum into next morning feed scoring.',
              brandOfficer: '煽りを一切排した、静かで誠実な企業トップの品格を表現。',
              brandOfficer_en: 'Understated, authoritative executive reflection.',
              investorOfficer: '無駄な認知ではなく、1件の高単価商談に直結する思考法。',
              investorOfficer_en: 'Reinforces focus on qualified pipeline over empty views.',
              founderOfficer: '寝る前にこういう本質的な言葉を読むと、明日も頑張ろうと思える。',
              founderOfficer_en: 'Inspiring and deeply grounding for business operators.',
              chiefCommander: '最高峰ビジネスプランの1日の締めくくりとして全会一致で正式承認。',
              chiefCommander_en: 'Unanimously approved as closing post for top-tier schedule.'
            }
          }
        ];

        if (userPlan === 'business') {
          return full5Posts; // 1日5投稿 (朝・昼・夕・夜・深夜)
        } else if (userPlan === 'starter') {
          return [full5Posts[0]]; // 1日1投稿 (朝枠)
        } else {
          return [full5Posts[0], full5Posts[1], full5Posts[3]]; // プロ運用: 1日3投稿 (朝・昼・夜)
        }
      })()"""

code = code.replace(old_fallback_postplan, new_fallback_postplan, 1)

# 4. In launchAutopilotCampaign: Pass userPlan to deliberateCouncilStrategy
old_council_call = "const councilPlan = await deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone, userKnowledge);"
new_council_call = "const councilPlan = await deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone, userKnowledge, userPlan);"
code = code.replace(old_council_call, new_council_call, 1)

# 5. In launchAutopilotCampaign: Update timeSlotMap with unified times
old_timeslot_map = """  const timeSlotMap = {
    morning: { h: 7, m: 35 },
    noon: { h: 12, m: 10 },
    night: { h: 21, m: 15 },
    sunday_night: { h: 21, m: 30 },
    afternoon: { h: 17, m: 30 },
    evening: { h: 20, m: 30 }
  };"""

new_timeslot_map = """  const timeSlotMap = {
    morning: { h: 8, m: 30 },
    noon: { h: 12, m: 30 },
    afternoon: { h: 17, m: 30 },
    evening: { h: 20, m: 0 },
    night: { h: 22, m: 30 },
    sunday_night: { h: 21, m: 30 }
  };"""
code = code.replace(old_timeslot_map, new_timeslot_map, 1)

# 6. In writeCouncilApprovedPosts: provide 5 fallback posts
old_default_ja_posts = """  const defaultJaPosts = [
    `毎朝45分画面を睨み、月30時間を手作業に溶かして商談ゼロ。真面目な担当者ほど「熱量が大事」と精神論に追い込まれ、アルゴリズムの仕様変更に搾取されている。\\n\\n努力の方向が違うだけです。泥臭い手作業で自社の貴重なリソースをすり減らすのは、もう終わりにしませんか。`,
    `「B2Bはリプ欄にURLを貼ればリードが獲れる」という常識、実は完全に間違いです。なぜなら今のアルゴリズムは外部誘導を厳罰化しており、インプが削られCVRは0.01%以下に沈むから。\\n\\nこの冷徹な数字の現実に、現場のマーケターはどう答えますか？`,
    [
      `【警告】最近急にインプレッションが激減した人、これ見落としてたら一発でシャドウバン対象です。\\n\\n2026年最新のXレコメンドアルゴリズムで厳罰化された「即死ルール」と、アカウントの露出を復活させる具体的手順をまとめました。運用担当者は必ず確認してください👇 (1/4)`,
      `① なぜインプが落ちるのか？\\n今のXアルゴリズムは「短時間の同一URL投稿」「外部サイトへの誘導」をスパムスコアとして即時検知します。特にSearch Suggestion Ban（検索候補からの除外）にかかると、既存フォロワー以外へのリーチが90%以上遮断されます。(2/4)`,
      `② 即効でやるべき3つの対策\\n1. 親ツイートに外部リンクを絶対に貼らない（自己リプまたはプロフ固定へ誘導）\\n2. 過去の不審なサードパーティアプリ連携を全解除\\n3. 48時間はリポストや過剰リプライを止め、クリーンな閲覧（滞在時間獲得）のみ行う(3/4)`,
      `③ アルゴリズムを味方につける最重要指標\\n現在のXで最も加点されるのは「いいね」ではなく「ブックマーク（保存）」と「読了滞在時間（Dwell Time）」です。\\n\\n後から見返せるようこのスレッドを【保存】推奨。質問や相談はリプ欄へどうぞ。(4/4)`
    ]
  ];"""

new_default_ja_posts = """  const defaultJaPosts = [
    `毎朝45分画面を睨み、月30時間を手作業に溶かして商談ゼロ。真面目な担当者ほど「熱量が大事」と精神論に追い込まれ、アルゴリズムの仕様変更に搾取されている。\\n\\n努力の方向が違うだけです。泥臭い手作業で自社の貴重なリソースをすり減らすのは、もう終わりにしませんか。`,
    `「B2Bはリプ欄にURLを貼ればリードが獲れる」という常識、実は完全に間違いです。なぜなら今のアルゴリズムは外部誘導を厳罰化しており、インプが削られCVRは0.01%以下に沈むから。\\n\\nこの冷徹な数字の現実に、現場のマーケターはどう答えますか？`,
    `残業月40時間→定時退社で売上2倍。手作業でSNSを運用していた時は「投稿を作ること」が目的になっていましたが、仕組み化した瞬間に商談数が劇変しました。\\n\\n経営者がやるべきは「文章を書くこと」ではなく「戦略を打つこと」です。`,
    [
      `【警告】最近急にインプレッションが激減した人、これ見落としてたら一発でシャドウバン対象です。\\n\\n2026年最新のXレコメンドアルゴリズムで厳罰化された「即死ルール」と、アカウントの露出を復活させる具体的手順をまとめました。運用担当者は必ず確認してください👇 (1/4)`,
      `① なぜインプが落ちるのか？\\n今のXアルゴリズムは「短時間の同一URL投稿」「外部サイトへの誘導」をスパムスコアとして即時検知します。特にSearch Suggestion Ban（検索候補からの除外）にかかると、既存フォロワー以外へのリーチが90%以上遮断されます。(2/4)`,
      `② 即効でやるべき3つの対策\\n1. 親ツイートに外部リンクを絶対に貼らない（自己リプまたはプロフ固定へ誘導）\\n2. 過去の不審なサードパーティアプリ連携を全解除\\n3. 48時間はリポストや過剰リプライを止め、クリーンな閲覧（滞在時間獲得）のみ行う(3/4)`,
      `③ アルゴリズムを味方につける最重要指標\\n現在のXで最も加点されるのは「いいね」ではなく「ブックマーク（保存）」と「読了滞在時間（Dwell Time）」です。\\n\\n後から見返せるようこのスレッドを【保存】推奨。質問や相談はリプ欄へどうぞ。(4/4)`
    ],
    `深夜のひとりごと。フォロワー数が多いのに1円も売上が立たないアカウントと、フォロワー500人なのに毎月商談が絶えないアカウントの決定的な違いは何か？\\n\\n答えは「誰に向けて書いているか」。万人受けのバズではなく、たった1人の意思決定者に深く刺さる言葉を届ける設計です。`
  ];"""

code = code.replace(old_default_ja_posts, new_default_ja_posts, 1)

old_default_en_posts = """  const defaultEnPosts = [
    `Burning 45 minutes every morning staring at a blank screen to draft an X post—only to get 2 likes. Does that sound painfully familiar?\\n\\nSocial channels should be an engine for scalable distribution, not a daily chore that exhausts executive bandwidth. Stop wasting high-leverage hours on manual content writing.`,
    `The belief that "dropping offer links in reply threads guarantees qualified B2B leads" is officially dead in 2026.\\n\\nDirect links trigger an immediate 75% algorithmic reach penalty. Top enterprise teams use zero-link stealth funnels: build narrative authority on the timeline, then guide prospects to an optimized pinned asset.`,
    [
      `[CRITICAL ALERT] If your impressions plummeted this week, you likely triggered an algorithmic shadowban.\\n\\nHere is the exact breakdown of the 2026 X recommendation penalty thresholds and our verified recovery protocol. Bookmark this thread for your team 👇 (1/4)`,
      `1. Why Reach Gets Crushed\\nX now immediately flags repeated outbound URLs and erratic session footprints. When hit with a Search Suggestion Ban, your impressions to non-followers decay by over 90% within hours.(2/4)`,
      `2. The 3-Step Emergency Fix\\n• Zero links on root tweets (move routing to pinned profile assets)\\n• Revoke legacy third-party app OAuth permissions immediately\\n• 48-hour cooloff: zero mass replies, accumulate clean reading dwell time(3/4)`,
      `3. Winning the 2026 Recommendation Graph\\nThe single highest-weighted factor is now Bookmarks (+10.0 multiplier) and Thread Dwell Time, far surpassing superficial likes.\\n\\nSave this blueprint to your bookmarks. Drop your questions below.(4/4)`
    ]
  ];"""

new_default_en_posts = """  const defaultEnPosts = [
    `Burning 45 minutes every morning staring at a blank screen to draft an X post—only to get 2 likes. Does that sound painfully familiar?\\n\\nSocial channels should be an engine for scalable distribution, not a daily chore that exhausts executive bandwidth. Stop wasting high-leverage hours on manual content writing.`,
    `The belief that "dropping offer links in reply threads guarantees qualified B2B leads" is officially dead in 2026.\\n\\nDirect links trigger an immediate 75% algorithmic reach penalty. Top enterprise teams use zero-link stealth funnels: build narrative authority on the timeline, then guide prospects to an optimized pinned asset.`,
    `Cutting manual drafting overhead by 40 hours/month while doubling inbound pipeline. When automated systems replace brute-force typing, founders reclaim strategic control over their time.`,
    [
      `[CRITICAL ALERT] If your impressions plummeted this week, you likely triggered an algorithmic shadowban.\\n\\nHere is the exact breakdown of the 2026 X recommendation penalty thresholds and our verified recovery protocol. Bookmark this thread for your team 👇 (1/4)`,
      `1. Why Reach Gets Crushed\\nX now immediately flags repeated outbound URLs and erratic session footprints. When hit with a Search Suggestion Ban, your impressions to non-followers decay by over 90% within hours.(2/4)`,
      `2. The 3-Step Emergency Fix\\n• Zero links on root tweets (move routing to pinned profile assets)\\n• Revoke legacy third-party app OAuth permissions immediately\\n• 48-hour cooloff: zero mass replies, accumulate clean reading dwell time(3/4)`,
      `3. Winning the 2026 Recommendation Graph\\nThe single highest-weighted factor is now Bookmarks (+10.0 multiplier) and Thread Dwell Time, far surpassing superficial likes.\\n\\nSave this blueprint to your bookmarks. Drop your questions below.(4/4)`
    ],
    `A late-night observation: The difference between a 50k-follower account making $0 and a 500-follower account closing high-ticket deals every week comes down to one principle: specificity over vanity reach.`
  ];"""

code = code.replace(old_default_en_posts, new_default_en_posts, 1)

# Ensure fallback array indexing wraps safely
code = code.replace('defaultJaPosts[i] || defaultJaPosts[0]', 'defaultJaPosts[i] || defaultJaPosts[i % defaultJaPosts.length]')
code = code.replace('defaultEnPosts[i] || defaultEnPosts[0]', 'defaultEnPosts[i] || defaultEnPosts[i % defaultEnPosts.length]')
code = code.replace('defaultJaPosts[idx] || defaultJaPosts[0]', 'defaultJaPosts[idx] || defaultJaPosts[idx % defaultJaPosts.length]')
code = code.replace('defaultEnPosts[idx] || defaultEnPosts[0]', 'defaultEnPosts[idx] || defaultEnPosts[idx % defaultEnPosts.length]')

with open('src/autonomous_promo_ai.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated src/autonomous_promo_ai.js with plan-aware post scheduling (1, 3, or 5 posts)")
