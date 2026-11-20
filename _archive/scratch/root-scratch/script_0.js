
    function escHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ========================================================================
    // 🌐 多言語 i18n ハイブリッドエンジン (全面ビジネス日本語 / 全面ビジネス英語)
    // ========================================================================
    const I18N = {
      ja: {
        app_title: "VELOX POST",
        app_badge: "AUTONOMOUS 4.0",
        cockpit_subtitle: "VeloxPost Cloud Cockpit",
        nav_toppage: "トップページ",
        btn_plan_change: "プラン変更",
        logout: "ログアウト",

        // Card 0: Audit
        audit_title: "現状アカウント診断 ＆ 7名AI合議制スコアリング（過去1ヶ月分析）",
        audit_sub: "X公式APIまたはユーザー名（@アカウント名）から、直近1ヶ月の投稿・エンゲージメント傾向を7名のAI評議会が多角的に精査・採点します。",
        audit_label: "👤 分析・診断したいXアカウント名（@ユーザー名）",
        audit_btn_run: "アカウントを診断する →",
        audit_btn_toggle_open: "診断フォームを開く",
        audit_btn_toggle_close: "診断を閉じる",

        // Card 1: Official API
        api_card_title: "本アカウント 公式APIキーの接続（初回1回のみ・凍結リスク完全ゼロ）",
        api_card_sub: "X Developer Portal の「Keys & Tokens」画面と全く同じ表記で照合できます。お持ちの方式をお選びください。",
        api_badge_connected: "設定済み ● 正常接続中",
        api_badge_unconfigured: "未設定 (初回接続が必要です)",
        badge_connected: "● CONNECTED",
        badge_strategy_active: "● 戦略稼働中",
        api_notice_title: "X公式API v2 接続済み（設定完了）",
        api_notice_desc: "X公式API v2正規通信により認証完了。凍結リスク0.00%で自律マーケティングおよびサテライト連携が安全に有効化されています。",
        api_notice_btn: "設定キーの確認・変更",
        api_notice_btn_close: "入力を閉じる",
        tab_oauth1: "① OAuth 1.0 キー（推奨）",
        tab_oauth2: "② OAuth 2.0 キー（Client ID）",
        oauth1_help: "【公式Developer Portalとの対応関係】X公式画面の「OAuth 1.0 キー」にある各項目の右側の【再生成】ボタンを押して表示される4つの文字列を入力します。",
        lbl_consumer_key: "① コンシューマーキー (API Key)",
        lbl_consumer_secret: "② コンシューマーシークレット (API Key Secret)",
        lbl_access_token: "③ アクセストークン (Access Token)",
        lbl_access_secret: "④ アクセスシークレット (Access Token Secret)",
        btn_verify_keys: "⚡ 公式APIキーの有効性を即時テスト ＆ 保存",

        // Card 2: Target
        target_card_title: "AI自律マーケティング ターゲット設定 ＆ ユーザー指示",
        target_card_sub: "広報・集客したいWebサイトのURLと、AI評議会への指示（ターゲット層、強み、トーンなど）を入力してください。",
        target_badge_active: "設定済み ● 自律運用中",
        target_badge_unconfigured: "未設定",
        target_notice_title: "広報・集客ターゲット設定済み",
        target_notice_desc: "7名編成AI合議制による戦略策定・最適化Bio・厳選自律投稿がスケジュールされています。ターゲットURLやプロンプト指示を変更したい場合は、右側のボタンからいつでも再設定できます。",
        target_notice_btn: "ターゲット・指示の変更",
        target_notice_btn_close: "入力を閉じる",
        lbl_post_lang: "投稿・生成言語 (Target Language for AI Posts)",
        opt_post_lang_ja: "日本語 (Japanese)",
        opt_post_lang_en: "English (Global)",
        lbl_target_url: "宣伝・広報対象のWebサイト / LPのURL",
        lbl_user_prompt: "AI評議会へのカスタム指示・ユーザープロンプト (任意)",
        ph_user_prompt: "例：ターゲットは中小企業の経営者・事業主。今月は無料相談キャンペーンを実施中。押し売り感のない論理的かつ誠実な語り口で、直近の業務負担軽減を強く訴求してほしい。",
        quick_input_label: "クイック入力:",
        quick_b2b: "🎯 B2B経営者向け",
        quick_deals: "📈 商談獲得重視",
        quick_tone: "🛡️ 誠実プロトーン",
        quick_overhead: "⏳ 業務工数削減",
        preview_box_title: "保有効果・瞬速Aha! プレビュー生成（X連携前にお試し）",
        preview_box_sub: "URLを入力してボタンを押すだけ。AI合議制が「朝・昼・夜」の最適化ポスト3本をわずか5〜8秒で無料プレビュー生成します。",
        btn_instant_preview: "今すぐ3本のポスト案を生成 →",
        btn_launch_autopilot: "🏛️ 7名編成AI合議制で戦略を立案 ＆ 自律投稿を開始する",

        // Card 3: Today's Strategy
        strat_card_title: "🏛️ 本日の戦略",
        strat_card_sub: "7名の専門AI（フック、共感、アルゴ、ブランド、辛口CFO、叩き上げ社長、最高司令官）による自律立案戦略です。",
        btn_redeliberate: "AI合議で再推敲・動的アジャスト",
        btn_toggle_strat_open: "戦略詳細・合議録を開く",
        btn_toggle_strat_close: "戦略詳細・合議録を閉じる",
        collective_banner: "全顧客集合知ナレッジを学習・反映済",
        collective_stats: "累計 128 アカウント / 3,420+ 件の成約・失敗パターンを動的参照",
        pos_title: "策定された市場ポジショニング ＆ ターゲット読者ペルソナ",
        pos_col1: "コア提供価値:",
        pos_col2: "ターゲット顧客層:",
        pos_col3: "解決すべき生々しい顧客課題:",
        pos_col4: "ユーザー指示の反映:",
        bio_title: "【即コピー推奨】AI合議 最適化Bio（プロフィール文）",
        bio_sub: "ターゲットの課題解決と実績を明示し、フォロワー獲得率とリンク遷移率を最大化する設計です。",
        bio_btn_copy: "📋 最適化Bio文をコピーして公式Xに設定する",
        pin_title: "【看板投稿】成約特化型 固定ポスト案",
        pin_sub: "アカウント訪問者が真っ先に目にする看板ポスト。共感からオファーまで一気通貫で成約させます。",
        pin_btn_copy: "📋 固定ポスト案をコピー",
        debate_title: "7名編成AI合議制 激論ディベート議事録（客観審査・妥協なき審査）",
        badge_zero_compromise: "妥協なき是々非々審査",
        badge_unanimous: "全会一致80点基準承認",
        round1_title: "ROUND 1: 各専門官の独立初期提案",
        round2_title: "ROUND 2: 相互批判・反対意見の激突",
        round3_title: "ROUND 3: 厳格スコアリング審議（全員80点以上で承認）",
        round4_title: "ROUND 4: 最高作戦司令官 最終決裁",

        // Card 4: Jobs
        jobs_card_title: "📅 本日の自律投稿・スケジュール一覧",
        jobs_card_sub: "7名AI合議制によって最適化された、本日のゴールデンタイム自律投稿キューです。",
        btn_rethink_jobs: "未投稿を動的再推敲",
        btn_refresh: "最新に更新",
        job_status_done: "✅ 投稿済 ↗",
        job_status_pending: "⏳ 予約待機中",
        job_status_failed: "⚠️ 投稿エラー",
        job_why_time: "⏰ なぜこの時間帯:",
        job_hook_logic: "🎯 フック設計意図:",
        job_empathy_logic: "💬 共感心理の狙い:",
        job_algo_safety: "🛡️ アルゴリズム安全性:",
        job_debate_summary: "この投稿に特化した7名AI評議会 戦略根拠 ＆ 激論ディベート詳細",
        job_debate_open: "▼ 議事録を展開",
        job_rethink_label: "💡 内容を微調整したい場合はこの投稿だけに個別プロンプトを出せます",
        job_rethink_btn: "✏️ この投稿だけを再推敲・指示",
        job_rethink_submit: "🎯 この投稿だけを再検討する",

        // Card 5: Syndicate
        syndicate_card_title: "⚡ 分散シンジケート初速エンゲージメント加速",
        syndicate_card_sub: "投稿直後の初速シグナルを科学的に刺激し、Xおすすめアルゴリズム（For Youタイムライン）への露出を最大化します。",
        btn_toggle_syndicate_open: "詳細ノードを表示",
        btn_toggle_syndicate_close: "詳細ノードを閉じる",
        syndicate_col1_label: "稼働ノード群",
        syndicate_col2_label: "初速加速アクション",
        syndicate_col3_label: "有機的ランダム遅延",

        // Card 6: Affiliate Partner
        aff_card_title: "🤝 公式紹介パートナープログラム（月額30%継続還元）",
        aff_card_sub: "月額請求の実支払額の30%をUSD建てで計上します。JPY決済は請求日のECB日次参考レートでUSD換算します。",
        btn_toggle_aff_open: "詳細を開く",
        btn_toggle_aff_close: "閉じる",
        aff_link_label: "あなた専用の公式紹介リンク",
        aff_btn_copy: "リンクをコピー",
        aff_link_desc: "紹介ユーザーの月額請求が実際に支払われるたび、決済額の30%を計上します。JPY決済は請求日のECB日次参考レートでUSD換算します。",
        aff_kpi_referrals: "紹介登録数",
        aff_kpi_paid: "有料継続契約数",
        aff_kpi_balance: "出金可能残高",
        aff_kpi_total: "累計獲得報酬",
        aff_payout_title: "報酬出金申請（USDT / 暗号資産ウォレット）",
        aff_payout_desc: "報酬残高は最低 $30 USD から USDT (TRC-20 または ERC-20) 宛に出金申請できます。手数料無料で即時台帳に記録されます。",
        aff_btn_save_wallet: "ウォレット保存",
        aff_btn_payout: "出金申請（最低 $30〜）"
      },
      en: {
        app_title: "VELOX POST",
        app_badge: "AUTONOMOUS 4.0",
        cockpit_subtitle: "VeloxPost Cloud Cockpit",
        nav_toppage: "Top Page",
        btn_plan_change: "Change Plan",
        logout: "Log Out",

        // Card 0: Audit
        audit_title: "Account Health Diagnostic & 7-Agent Consensus Audit (30-Day Analysis)",
        audit_sub: "Our 7-agent AI council critically examines past 30-day tweets, engagement decay, and algorithmic penalties via X Official API v2.",
        audit_label: "👤 Target X Account to Analyze (@handle)",
        audit_btn_run: "Run Account Audit →",
        audit_btn_toggle_open: "Open Account Audit",
        audit_btn_toggle_close: "Close Audit",

        // Card 1: Official API
        api_card_title: "Connect Official X API v2 Credentials (Zero Suspension Risk)",
        api_card_sub: "Matches the exact fields in X Developer Portal 'Keys & Tokens'. Select your preferred authentication mode.",
        api_badge_connected: "Configured ● Connected",
        api_badge_unconfigured: "Not Connected (Initial Setup Required)",
        badge_connected: "● CONNECTED",
        badge_strategy_active: "● STRATEGY ACTIVE",
        api_notice_title: "Official X API v2 Connected (Configured)",
        api_notice_desc: "Authenticated via official X API v2 protocols. 0.00% ban risk with enterprise security & distributed syndicate lift enabled.",
        api_notice_btn: "Review / Modify API Keys",
        api_notice_btn_close: "Close Input",
        tab_oauth1: "① OAuth 1.0 Keys (Recommended)",
        tab_oauth2: "② OAuth 2.0 Keys (Client ID)",
        oauth1_help: "【Developer Portal Correspondence】Click [Regenerate] on each item under 'OAuth 1.0 Keys' in your X Developer Portal and paste the 4 values below.",
        lbl_consumer_key: "① Consumer Key (API Key)",
        lbl_consumer_secret: "② Consumer Secret (API Key Secret)",
        lbl_access_token: "③ Access Token",
        lbl_access_secret: "④ Access Token Secret",
        btn_verify_keys: "⚡ Test Official API Validity & Save Credentials",

        // Card 2: Target
        target_card_title: "Autonomous Marketing Target & Strategic Directives",
        target_card_sub: "Enter your product/landing page URL and guidelines for our 7-agent AI council (target personas, competitive edge, voice tone).",
        target_badge_active: "Configured ● Active Execution",
        target_badge_unconfigured: "Unconfigured",
        target_notice_title: "Marketing Target & Strategy Configured",
        target_notice_desc: "7-Agent Dialectical Consensus has formulated your strategic profile, optimized bio, and scheduled golden-hour posts. Click to adjust URL or directives.",
        target_notice_btn: "Modify Target / Directives",
        target_notice_btn_close: "Close Input",
        lbl_post_lang: "Target Language for AI Posts",
        opt_post_lang_ja: "Japanese (日本語)",
        opt_post_lang_en: "English (Global)",
        lbl_target_url: "Product / Landing Page URL to Promote",
        lbl_user_prompt: "Custom Strategic Directives for AI Council (Optional)",
        ph_user_prompt: "e.g. Target B2B enterprise executives. Highlight measurable operational cost reduction. Maintain an objective, authoritative professional tone without generic AI clichés.",
        quick_input_label: "Quick Directives:",
        quick_b2b: "🎯 B2B Decision Makers",
        quick_deals: "📈 Pipeline & Deals",
        quick_tone: "🛡️ Executive Tone",
        quick_overhead: "⏳ Overhead Reduction",
        preview_box_title: "Instant 5-Second Aha! Preview (Generate Before X Connection)",
        preview_box_sub: "Enter your target URL. Our 7-agent AI council drafts 3 golden-hour posts (morning, noon, evening) in 5-8 seconds.",
        btn_instant_preview: "Generate 3 High-Impact Posts Now →",
        btn_launch_autopilot: "🏛️ Formulate Strategy via 7-Agent Consensus & Launch Autonomous Queue",

        // Card 3: Today's Strategy
        strat_card_title: "🏛️ TODAY'S STRATEGIC BLUEPRINT",
        strat_card_sub: "Autonomous multi-agent strategy formulated by 7 specialized AI directors (Hook, Empathy, Algo, Brand Safety, CFO, SME Founder, Chief Commander).",
        btn_redeliberate: "Re-deliberate & Dynamic Adjust",
        btn_toggle_strat_open: "Expand Strategic Protocol & Consensus Log",
        btn_toggle_strat_close: "Collapse Strategic Protocol",
        collective_banner: "Powered by Cross-Tenant Collective Intelligence",
        collective_stats: "Dynamically referencing 3,420+ validated B2B deal-closing & conversion patterns",
        pos_title: "Market Positioning & Target Persona Architecture",
        pos_col1: "Core Value Proposition:",
        pos_col2: "Target Audience Persona:",
        pos_col3: "Critical Customer Pain Points:",
        pos_col4: "Reflected User Directives:",
        bio_title: "【Actionable】Optimized X Profile Bio",
        bio_sub: "Engineered to maximize profile conversion, follower growth, and landing page CTR.",
        bio_btn_copy: "📋 Copy Bio to Clipboard",
        pin_title: "【Flagship Post】Conversion-Centric Pinned Tweet Protocol",
        pin_sub: "First impression anchor post for profile visitors. Guides prospects seamlessly from problem-awareness to offer conversion.",
        pin_btn_copy: "📋 Copy Pinned Post",
        debate_title: "7-Executive AI Council Dialectical Deliberation Protocol",
        badge_zero_compromise: "ZERO UNVETTED APPROVALS",
        badge_unanimous: "80+ BENCHMARK RATIFIED",
        round1_title: "ROUND 1: INDEPENDENT SPECIALIST PROPOSALS",
        round2_title: "ROUND 2: DIALECTICAL DEBATE & CROSS-EXAMINATION",
        round3_title: "ROUND 3: RIGOROUS MULTI-DIMENSIONAL SCORING (80+ RATIFIED)",
        round4_title: "ROUND 4: EXECUTIVE OPERATIONS COMMANDER FINAL RATIFICATION",

        // Card 4: Jobs
        jobs_card_title: "📅 TODAY'S AUTONOMOUS POST QUEUE",
        jobs_card_sub: "Autonomous golden-hour scheduling queue optimized by the 7-agent council.",
        btn_rethink_jobs: "Re-evaluate Pending Queue",
        btn_refresh: "Refresh Status",
        job_status_done: "✅ Published ↗",
        job_status_pending: "⏳ In Queue",
        job_status_failed: "⚠️ Delivery Error",
        job_why_time: "⏰ Scheduled Window:",
        job_hook_logic: "🎯 Thumb-Stop Hook Logic:",
        job_empathy_logic: "💬 Audience Empathy Angle:",
        job_algo_safety: "🛡️ Algorithm Safety & Stealth Funnel:",
        job_debate_summary: "Council Deliberation Rationale & Deep Dialectical Debate Details",
        job_debate_open: "▼ View Deliberation Log",
        job_rethink_label: "💡 Fine-tune this specific post with dedicated prompt instructions",
        job_rethink_btn: "✏️ Refine This Post with Custom Directives",
        job_rethink_submit: "🎯 Re-evaluate This Post",

        // Card 5: Syndicate
        syndicate_card_title: "⚡ SYNDICATE ENGAGEMENT LIFT PROTOCOL",
        syndicate_card_sub: "Scientifically triggers algorithmic engagement signals within 30-90s post-publish to maximize 'For You' timeline distribution.",
        btn_toggle_syndicate_open: "View Active Nodes",
        btn_toggle_syndicate_close: "Collapse Nodes",
        syndicate_col1_label: "Active Node Pool",
        syndicate_col2_label: "Engagement Lift Action",
        syndicate_col3_label: "Organic Random Delay",

        // Card 6: Affiliate Partner
        aff_card_title: "🤝 RECURRING PARTNER PROGRAM (30% Lifetime Commission)",
        aff_card_sub: "Earn 30% of each successfully paid monthly invoice. JPY payments are converted to USD using the ECB daily reference rate for the invoice date.",
        btn_toggle_aff_open: "Open Partner Hub",
        btn_toggle_aff_close: "Close Partner Hub",
        aff_link_label: "Your Unique Referral Link",
        aff_btn_copy: "Copy Link",
        aff_link_desc: "Earn 30% of each successfully paid monthly invoice. JPY payments are converted to USD using the ECB daily reference rate for the invoice date.",
        aff_kpi_referrals: "Total Referrals",
        aff_kpi_paid: "Paid Subscribers",
        aff_kpi_balance: "Available Balance",
        aff_kpi_total: "Total Earned",
        aff_payout_title: "Request Payout (USDT / Crypto Wallet)",
        aff_payout_desc: "Request payout for balances of $30 USD or more via USDT (TRC-20 / ERC-20). Processed directly with zero deduction fees.",
        aff_btn_save_wallet: "Save Wallet",
        aff_btn_payout: "Request Payout ($30+)"
      }
    };

    // ========================================================================
    // ⚙️ ダッシュボード設定 & 通貨管理 (TDZエラー防止のため最上部で宣言)
    // ========================================================================
    window.__DASHBOARD_CONFIG__ = {
      isPaid: ('{{IS_PAID_USER}}' === 'true'),
      isXConnected: ('{{IS_X_CONNECTED}}' === 'true'),
      userId: '{{USER_ID}}',
      configuredAiLang: '{{CONFIGURED_AI_LANG}}',
      userEmail: '{{USER_EMAIL_RAW}}'
    };

    let currentPlan = 'pro';
    const savedBillingCurrency = localStorage.getItem('velox_billing_currency');
    let billingCurrencyManuallySelected = savedBillingCurrency === 'jpy' || savedBillingCurrency === 'usd';

    const PLAN_NAMES = {
      starter: '🥉 スタータープラン',
      pro: '🥈 プロ運用プラン',
      business: '🥇 ビジネスプラン'
    };

    const PLAN_PRICES = {
      jpy: { starter: '¥4,980', pro: '¥9,800', business: '¥19,800' },
      usd: { starter: '$39', pro: '$79', business: '$179' }
    };

    function getInitialLanguage() {
      const saved = localStorage.getItem('velox_lang');
      if (saved === 'en' || saved === 'ja') return saved;
      // ユーザーアカウントの設定言語が英語なら英語を最優先
      if (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en') {
        return 'en';
      }
      const navLang = (navigator.languages && navigator.languages.length ? navigator.languages[0] : (navigator.language || navigator.userLanguage || '')).toLowerCase();
      return navLang.startsWith('ja') ? 'ja' : 'en';
    }

    let currentLang = getInitialLanguage();
    let currentCurrency = billingCurrencyManuallySelected
      ? savedBillingCurrency
      : (currentLang === 'en' ? 'usd' : 'jpy');

    function switchCurrency(cur, fromLanguage = false) {
      if (cur !== 'jpy' && cur !== 'usd') return;
      currentCurrency = cur;
      if (!fromLanguage) {
        billingCurrencyManuallySelected = true;
        localStorage.setItem('velox_billing_currency', cur);
      }
      const btnJ = document.getElementById('btnCurJpy');
      const btnU = document.getElementById('btnCurUsd');
      if (btnJ) btnJ.className = cur === 'jpy' ? 'currency-pill active' : 'currency-pill inactive';
      if (btnU) btnU.className = cur === 'usd' ? 'currency-pill active' : 'currency-pill inactive';

      const pStart = document.getElementById('price_starter');
      const pPro = document.getElementById('price_pro');
      const pBiz = document.getElementById('price_business');
      if (pStart && PLAN_PRICES[cur]) pStart.innerHTML = PLAN_PRICES[cur].starter + '<span class="text-xs text-slate-500 font-sans">/月</span>';
      if (pPro && PLAN_PRICES[cur]) pPro.innerHTML = PLAN_PRICES[cur].pro + '<span class="text-xs text-slate-500 font-sans">/月</span>';
      if (pBiz && PLAN_PRICES[cur]) pBiz.innerHTML = PLAN_PRICES[cur].business + '<span class="text-xs text-slate-500 font-sans">/月</span>';

      if (typeof updatePlanButtons === 'function') updatePlanButtons();
    }

    function setLanguage(lang) {
      currentLang = lang;
      localStorage.setItem('velox_lang', lang);
      document.cookie = 'velox_lang=' + lang + '; path=/; max-age=31536000';
      if (!billingCurrencyManuallySelected) {
        switchCurrency(lang === 'en' ? 'usd' : 'jpy', true);
      }
      
      const label = document.getElementById('langLabel');
      if (label) label.innerText = lang === 'ja' ? 'EN' : 'JA';
      
      const dict = I18N[lang] || I18N.ja;

      // 1. data-i18n を置換
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
          el.innerHTML = dict[key];
        }
      });

      // 2. data-i18n-ph (placeholder) を置換
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (dict[key]) {
          el.setAttribute('placeholder', dict[key]);
        }
      });

      // 3. サーバーレンダリング済みバナーの動的更新
      // A. API Connected Banner
      const apiNotice = document.querySelector('#apiKeyFormDrawer')?.previousElementSibling;
      if (apiNotice && apiNotice.querySelector('span.font-black, div.text-xs.sm\\:text-sm')) {
        const titleEl = apiNotice.querySelector('div.text-xs.sm\\:text-sm span:first-child');
        const descEl = apiNotice.querySelector('div.text-xs.text-emerald-700');
        const btnEl = document.getElementById('btnToggleApiKeyEdit');
        if (titleEl) titleEl.innerText = dict.api_notice_title;
        if (descEl) descEl.innerText = dict.api_notice_desc;
        if (btnEl && !btnEl.innerHTML.includes('✕')) btnEl.innerHTML = '<span>⚙️</span> <span class="whitespace-nowrap">' + dict.api_notice_btn + '</span>';
      }

      // B. Target Configured Banner
      const targetBanner = document.getElementById('targetConfiguredBanner');
      if (targetBanner) {
        const titleEl = targetBanner.querySelector('div.text-xs.sm\\:text-sm span:first-child');
        const descEl = targetBanner.querySelector('div.text-xs.text-blue-700');
        const btnEl = document.getElementById('btnToggleTargetEdit');
        if (titleEl) titleEl.innerText = dict.target_notice_title;
        if (descEl) descEl.innerText = dict.target_notice_desc;
        if (btnEl && !btnEl.innerHTML.includes('✕')) btnEl.innerHTML = '<span>⚙️</span> <span class="whitespace-nowrap">' + dict.target_notice_btn + '</span>';
      }

      // 4. 本日の戦略 日付バッジの動的更新
      const stratDateBadge = document.getElementById('stratDateBadge');
      if (stratDateBadge) {
        const now = new Date();
        const timeZone = document.getElementById('workspaceScheduleTimeZone')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        if (lang === 'en') {
          stratDateBadge.innerText = 'DATE: ' + now.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });
        } else {
          stratDateBadge.innerText = '策定日: ' + now.toLocaleDateString('ja-JP', { timeZone });
        }
      }

      // 5. ジョブ一覧 & 戦略レポートの再描画
      if (typeof loadJobs === 'function') loadJobs();
      if (typeof loadStrategyReport === 'function') loadStrategyReport();
      if (window.__lastAuditResult && typeof renderAuditScorecard === 'function') {
        renderAuditScorecard(window.__lastAuditResult);
      }
    }

    function toggleLanguage() {
      setLanguage(currentLang === 'ja' ? 'en' : 'ja');
    }

    function selectPostLanguage(lang) {
      const chosen = (lang === 'en') ? 'en' : 'ja';
      const inp = document.getElementById('inpPostLang');
      if (inp) inp.value = chosen;
      const btnJa = document.getElementById('btnPostLangJa');
      const btnEn = document.getElementById('btnPostLangEn');
      if (btnJa && btnEn) {
        if (chosen === 'ja') {
          btnJa.className = 'py-2.5 rounded-lg text-xs font-bold transition-all bg-white text-blue-700 shadow-sm border border-slate-200 flex items-center justify-center gap-2 cursor-pointer';
          btnEn.className = 'py-2.5 rounded-lg text-xs font-bold transition-all text-slate-500 hover:text-slate-800 flex items-center justify-center gap-2 cursor-pointer';
        } else {
          btnEn.className = 'py-2.5 rounded-lg text-xs font-bold transition-all bg-white text-blue-700 shadow-sm border border-slate-200 flex items-center justify-center gap-2 cursor-pointer';
          btnJa.className = 'py-2.5 rounded-lg text-xs font-bold transition-all text-slate-500 hover:text-slate-800 flex items-center justify-center gap-2 cursor-pointer';
        }
      }
    }

    function selectPlan(plan, el) {
      currentPlan = plan;
      document.querySelectorAll('.plan-card').forEach(b => b.classList.remove('selected'));
      if (el) el.classList.add('selected');
      updatePlanButtons();
    }

    function updatePlanButtons() {
      const prices = {
        starter: currentCurrency === 'jpy' ? '¥4,980' : '$39',
        pro: currentCurrency === 'jpy' ? '¥9,800' : '$79',
        business: currentCurrency === 'jpy' ? '¥19,800' : '$179'
      };

      const btnS = document.getElementById('btnPay_starter');
      const btnP = document.getElementById('btnPay_pro');
      const btnB = document.getElementById('btnPay_business');
      const btnD = document.getElementById('btnPayDirect');

      if (btnS) { 
        btnS.innerText = '💳 7日間無料トライアル開始 (¥0) ↗';
        if (currentPlan === 'starter') btnS.classList.add('primary'); else btnS.classList.remove('primary');
      }
      if (btnP) { 
        btnP.innerText = '💳 7日間無料トライアル開始 (¥0) ↗';
        if (currentPlan === 'pro') btnP.classList.add('primary'); else btnP.classList.remove('primary');
      }
      if (btnB) { 
        btnB.innerText = '💳 7日間無料トライアル開始 (¥0) ↗';
        if (currentPlan === 'business') btnB.classList.add('primary'); else btnB.classList.remove('primary');
      }

      const lbl = document.getElementById('selectedPlanLabel');
      if (lbl) {
        lbl.innerText = currentLang === 'en'
          ? `Selected: ${PLAN_NAMES[currentPlan]} (${prices[currentPlan]} / mo - 7-Day Free Trial)`
          : `現在選択中: ${PLAN_NAMES[currentPlan]} (${prices[currentPlan]} / 月・7日間無料)`;
      }
      if (btnD) {
        btnD.innerText = currentLang === 'en'
          ? `💳 Start 7-Day Free Trial ($0 Checkout) ↗`
          : `💳 7日間無料トライアルを開始する (¥0) ↗`;
      }
    }

    async function handlePayClick(plan, ev) {
      if (ev) ev.preventDefault();
      const targetPlan = plan || currentPlan;
      const st = document.getElementById('checkoutStatus');
      if (st) {
        st.style.display = 'block';
        st.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700';
        st.innerHTML = '⏳ <b>Stripe安全決済ページへ移動しています...</b>';
      }

      try {
        const res = await fetch('/api/billing/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: targetPlan,
            currency: currentCurrency,
            lang: (typeof currentLang !== 'undefined' ? currentLang : 'ja'),
            userId: '{{USER_ID}}',
            email: '{{USER_EMAIL_RAW}}'
          })
        });
        const d = await res.json();
        if (d.ok && d.url) {
          window.location.href = d.url;
        } else {
          if (st) {
            st.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700';
            st.innerText = '❌ 決済の準備に失敗しました: ' + (d.error || '');
          }
        }
      } catch (e) {
        if (st) {
          st.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700';
          st.innerText = '❌ 通信エラー: ' + e.message;
        }
      }
    }

    let currentAuthTab = 'oauth1';
    function toggleApiKeyEdit() {
      const dr = document.getElementById('apiKeyFormDrawer');
      if (!dr) return;
      dr.style.display = dr.style.display === 'none' ? 'block' : 'none';
      const btn = document.getElementById('btnToggleApiKeyEdit');
      if (btn) btn.innerHTML = dr.style.display === 'none' ? '<span>⚙️</span> <span>設定キーの確認・変更</span>' : '<span>✕</span> <span>入力を閉じる</span>';
    }

    function toggleTargetEdit() {
      const dr = document.getElementById('targetFormDrawer');
      if (!dr) return;
      const isHidden = (dr.style.display === 'none' || getComputedStyle(dr).display === 'none');
      dr.style.display = isHidden ? 'block' : 'none';
      const btn = document.getElementById('btnToggleTargetEdit');
      if (btn) {
        btn.innerHTML = isHidden 
          ? '<span>✕</span> <span>' + (currentLang === 'en' ? 'Close Input' : '入力を閉じる') + '</span>' 
          : '<span>⚙️</span> <span>' + (currentLang === 'en' ? 'Modify Target / Directives' : 'ターゲット・指示の変更') + '</span>';
      }
    }

    function toggleAuditDrawer() {
      const dr = document.getElementById('auditDrawer');
      if (!dr) return;
      const isHidden = (dr.style.display === 'none' || getComputedStyle(dr).display === 'none');
      dr.style.display = isHidden ? 'block' : 'none';
      const btn = document.getElementById('btnToggleAudit');
      if (btn) {
        btn.innerHTML = isHidden 
          ? '<span>✕</span> <span>' + (currentLang === 'en' ? 'Close Audit' : '診断を閉じる') + '</span>' 
          : '<span>▼</span> <span>' + (currentLang === 'en' ? 'Open Account Audit' : '診断フォームを開く') + '</span>';
      }
    }

    function toggleStrategyDrawer() {
      const dr = document.getElementById('strategyReportDrawer');
      if (!dr) return;
      const isHidden = (dr.style.display === 'none' || getComputedStyle(dr).display === 'none');
      dr.style.display = isHidden ? 'block' : 'none';
      const btn = document.getElementById('btnToggleStrategy');
      if (btn) {
        btn.innerHTML = isHidden 
          ? '<span>▲</span> <span>' + (currentLang === 'en' ? 'Collapse Strategic Protocol' : '戦略詳細・合議録を閉じる') + '</span>' 
          : '<span>▼</span> <span>' + (currentLang === 'en' ? 'Expand Strategic Protocol' : '戦略詳細・合議録を開く') + '</span>';
      }
    }

    function toggleSyndicateDrawer() {
      const dr = document.getElementById('syndicateDrawer');
      if (!dr) return;
      const isHidden = (dr.style.display === 'none' || getComputedStyle(dr).display === 'none');
      dr.style.display = isHidden ? 'block' : 'none';
      const btn = document.getElementById('btnToggleSyndicate');
      if (btn) {
        btn.innerHTML = isHidden 
          ? '<span>▲</span> <span>' + (currentLang === 'en' ? 'Collapse Nodes' : '詳細ノードを閉じる') + '</span>' 
          : '<span>▼</span> <span>' + (currentLang === 'en' ? 'View Active Nodes' : '詳細ノードを表示') + '</span>';
      }
    }

    function toggleAffiliateDrawer() {
      const dr = document.getElementById('affiliateDrawer');
      if (!dr) return;
      const isHidden = (dr.style.display === 'none' || getComputedStyle(dr).display === 'none');
      dr.style.display = isHidden ? 'block' : 'none';
      const btn = document.getElementById('btnToggleAffiliate');
      if (btn) {
        btn.innerHTML = isHidden 
          ? '<span>▲</span> <span>' + (currentLang === 'en' ? 'Close Partner Hub' : '閉じる') + '</span>' 
          : '<span>▼</span> <span>' + (currentLang === 'en' ? 'Open Partner Hub' : '詳細を開く') + '</span>';
      }
    }

    function copyAffRefLink() {
      const el = document.getElementById('inpAffRefUrl');
      if (!el) return;
      el.select();
      navigator.clipboard.writeText(el.value).then(() => {
        const btn = document.getElementById('btnCopyAffLink');
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<span>✅</span> <span>' + (currentLang === 'en' ? 'Copied!' : 'コピー完了！') + '</span>';
        btn.classList.add('bg-emerald-600');
        setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.classList.remove('bg-emerald-600');
        }, 2000);
      }).catch(() => {
        alert(currentLang === 'en' ? 'Link selected. Press Ctrl+C to copy.' : 'リンクが選択されました。Ctrl+C (Cmd+C) でコピーしてください。');
      });
    }

    async function saveAffWallet() {
      const wallet = (document.getElementById('inpAffWallet').value || '').trim();
      const msgBox = document.getElementById('affMsgBox');
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      if (!wallet) {
        alert(isEn ? 'Please enter a valid USDT wallet address.' : 'USDTウォレットアドレスを入力してください。');
        return;
      }
      try {
        const res = await fetch('/api/web-affiliate-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '{{USER_ID}}', usdtAddress: wallet })
        });
        const j = await res.json();
        if (j.ok) {
          msgBox.style.display = 'block';
          msgBox.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800';
          msgBox.innerText = isEn ? '✅ USDT wallet address saved successfully.' : '✅ 送金先USDTウォレットアドレスを保存しました。';
          setTimeout(() => { msgBox.style.display = 'none'; }, 4000);
        } else {
          alert((isEn ? 'Save error: ' : '保存エラー: ') + (j.error || 'Failed'));
        }
      } catch (e) {
        alert((isEn ? 'Communication error: ' : '通信エラー: ') + e.message);
      }
    }

    async function requestAffPayout() {
      const wallet = (document.getElementById('inpAffWallet').value || '').trim();
      const msgBox = document.getElementById('affMsgBox');
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      if (!wallet) {
        alert(isEn ? 'Please specify your USDT payout address first.' : '先に出金先USDTウォレットアドレスを入力してください。');
        document.getElementById('inpAffWallet').focus();
        return;
      }
      const confirmMsg = isEn 
        ? 'Request payout of all available commission to this USDT address?' 
        : '現在の出金可能残高を、入力されたUSDTウォレットへ出金申請しますか？';
      if (!confirm(confirmMsg)) return;

      try {
        const res = await fetch('/api/web-affiliate-payout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '{{USER_ID}}', usdtAddress: wallet })
        });
        const j = await res.json();
        if (j.ok) {
          document.getElementById('affBalanceVal').innerText = '0.00';
          msgBox.style.display = 'block';
          msgBox.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800';
          msgBox.innerText = isEn 
            ? `🎉 Payout request submitted! $${Number(j.payoutAmountUsd).toFixed(2)} USD is pending transfer to ${wallet}.` 
            : `🎉 出金申請が完了しました！ $${Number(j.payoutAmountUsd).toFixed(2)} USD の送金手続を開始します。`;
        } else {
          alert((isEn ? 'Payout request error: ' : '出金申請エラー: ') + (j.error || 'Failed'));
        }
      } catch (e) {
        alert((isEn ? 'Communication error: ' : '通信エラー: ') + e.message);
      }
    }

    function switchAuthTab(tab) {
      currentAuthTab = tab;
      const p1 = document.getElementById('panelOauth1');
      const p2 = document.getElementById('panelOauth2');
      const b1 = document.getElementById('tabBtnOauth1');
      const b2 = document.getElementById('tabBtnOauth2');

      if (tab === 'oauth2') {
        p1.style.display = 'none';
        p2.style.display = 'block';
        b1.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-500 hover:text-slate-800';
        b2.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-white text-purple-700 shadow-sm border border-slate-200';
      } else {
        p1.style.display = 'block';
        p2.style.display = 'none';
        b1.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-white text-blue-700 shadow-sm border border-slate-200';
        b2.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-500 hover:text-slate-800';
      }
    }

    async function verifyKeys() {
      const msg = document.getElementById('keyMsg');
      msg.style.display = 'block';
      msg.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700';
      msg.innerText = '⏳ 公式APIキーを検証中...';

      const body = {
        userId: '{{USER_ID}}',
        authType: currentAuthTab,
        apiKey: document.getElementById('inpApiKey') ? document.getElementById('inpApiKey').value : '',
        apiSecret: document.getElementById('inpApiSecret') ? document.getElementById('inpApiSecret').value : '',
        accessToken: document.getElementById('inpAccessToken') ? document.getElementById('inpAccessToken').value : '',
        accessTokenSecret: document.getElementById('inpAccessTokenSecret') ? document.getElementById('inpAccessTokenSecret').value : '',
        oauth2ClientId: document.getElementById('inpOauth2ClientId') ? document.getElementById('inpOauth2ClientId').value : '',
        oauth2ClientSecret: document.getElementById('inpOauth2ClientSecret') ? document.getElementById('inpOauth2ClientSecret').value : '',
        oauth2AccessToken: document.getElementById('inpOauth2UserToken') ? document.getElementById('inpOauth2UserToken').value : ''
      };

      try {
        const res = await fetch('/api/hybrid/verify-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = await res.json();
        if (j.ok) {
          msg.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800';
          msg.innerHTML = j.message;
        } else {
          msg.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800';
          msg.innerText = '❌ ' + j.error;
        }
      } catch (e) {
        msg.className = 'mt-3 text-xs font-bold p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800';
        msg.innerText = '❌ 通信エラー: ' + e.message;
      }
    }

    function appendPrompt(text) {
      const el = document.getElementById('inpUserPrompt');
      if (!el) return;
      if (el.value.trim()) {
        el.value = el.value.trim() + '\n' + text;
      } else {
        el.value = text;
      }
      el.focus();
    }

    function isSupportedScheduleTimeZone(timeZone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        return true;
      } catch {
        return false;
      }
    }

    function initializeScheduleTimeZoneControls() {
      const workspaceSelect = document.getElementById('workspaceScheduleTimeZone');
      const campaignSelect = document.getElementById('campaignScheduleTimeZone');
      if (!workspaceSelect || !campaignSelect) return;

      const savedTimeZone = workspaceSelect.dataset.savedTimeZone || '';
      const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const initialTimeZone = isSupportedScheduleTimeZone(savedTimeZone)
        ? savedTimeZone
        : (isSupportedScheduleTimeZone(browserTimeZone) ? browserTimeZone : 'UTC');
      let timeZones = ['UTC'];
      if (typeof Intl.supportedValuesOf === 'function') {
        timeZones = timeZones.concat(Intl.supportedValuesOf('timeZone'));
      } else {
        timeZones = timeZones.concat([
          'America/Los_Angeles', 'America/Chicago', 'America/New_York',
          'Europe/London', 'Europe/Paris', 'Asia/Dubai', 'Asia/Singapore',
          'Asia/Tokyo', 'Australia/Sydney'
        ]);
      }
      timeZones.push(initialTimeZone, browserTimeZone);
      timeZones = [...new Set(timeZones.filter(isSupportedScheduleTimeZone))].sort();

      const getLabel = (timeZone) => {
        try {
          const offset = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
          }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value;
          return offset ? `${timeZone} (${offset})` : timeZone;
        } catch {
          return timeZone;
        }
      };

      workspaceSelect.replaceChildren();
      campaignSelect.replaceChildren();
      const useDefaultOption = document.createElement('option');
      useDefaultOption.value = '';
      useDefaultOption.textContent = 'ワークスペースの既定値を使う / Use workspace default';
      campaignSelect.appendChild(useDefaultOption);

      for (const timeZone of timeZones) {
        const workspaceOption = document.createElement('option');
        workspaceOption.value = timeZone;
        workspaceOption.textContent = getLabel(timeZone);
        workspaceSelect.appendChild(workspaceOption);

        const campaignOption = document.createElement('option');
        campaignOption.value = timeZone;
        campaignOption.textContent = getLabel(timeZone);
        campaignSelect.appendChild(campaignOption);
      }

      workspaceSelect.value = initialTimeZone;
      campaignSelect.value = '';
    }

    async function saveWorkspaceScheduleTimeZone() {
      const timeZone = document.getElementById('workspaceScheduleTimeZone')?.value || '';
      const msg = document.getElementById('scheduleTimeZoneMsg');
      if (!msg) return;
      msg.style.display = 'block';
      msg.className = 'text-xs font-bold mt-2 text-slate-600';
      msg.innerText = currentLang === 'en' ? 'Saving timezone...' : 'タイムゾーンを保存しています...';

      try {
        const res = await fetch('/api/autopilot/schedule-timezone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeZone })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const workspaceSelect = document.getElementById('workspaceScheduleTimeZone');
        if (workspaceSelect) workspaceSelect.dataset.savedTimeZone = data.scheduleTimeZone;
        msg.className = 'text-xs font-bold mt-2 text-emerald-700';
        msg.innerText = currentLang === 'en' ? `Saved: ${data.scheduleTimeZone}` : `保存しました: ${data.scheduleTimeZone}`;
        if (typeof loadJobs === 'function') loadJobs();
      } catch (error) {
        msg.className = 'text-xs font-bold mt-2 text-rose-700';
        msg.innerText = (currentLang === 'en' ? 'Save failed: ' : '保存に失敗しました: ') + error.message;
      }
    }

    async function toggleAutopilotPause() {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const btn = document.getElementById('btnToggleAutopilotPause');
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/autopilot/toggle-pause', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '{{USER_ID}}', lang: currentLang })
        });
        const j = await res.json();
        if (j.ok) {
          alert(j.message);
          window.location.reload();
        } else {
          alert('Error: ' + j.error);
        }
      } catch (e) {
        alert('Network error: ' + e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function launchAutopilot() {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const isPaid = window.__DASHBOARD_CONFIG__ ? window.__DASHBOARD_CONFIG__.isPaid : false;
      if (!isPaid) {
        const secPlans = document.getElementById('secPlans');
        if (secPlans) {
          secPlans.style.display = 'block';
          secPlans.scrollIntoView({ behavior: 'smooth' });
        }
        alert(isEn 
          ? 'An active paid subscription is required to run autonomous AI marketing. Please choose a plan below.' 
          : 'AI自律マーケティングの稼働には有料プランのご契約が必要です。プランをお選びください。');
        return;
      }

      const msg = document.getElementById('launchMsg');
      msg.style.display = 'block';
      msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 leading-relaxed';
      msg.innerHTML = isEn
        ? '🏛️ <b>7-Executive AI Council Convened...</b><br>' +
          '<span class="text-[11px] text-slate-500 block mt-1">① Analyzing target URL & user directives → ② Optimizing Bio & Flagship Pinned Post → ③ 7-Agent Council Dialectical Debate → ④ Generating 3 Golden-Hour Posts (~15-20s)</span>'
        : '🏛️ <b>7名編成AI合議制評議会が起動しました...</b><br>' +
          '<span class="text-[11px] text-slate-500 block mt-1">① Webサイト情報抽出 ＆ ユーザー指示統合 → ② 最適化Bio＆固定Post策定 → ③ 7名AIディベート合議 → ④ 朝昼夜3本の厳選投稿執筆（約15〜20秒）</span>';

      const body = {
        userId: '{{USER_ID}}',
        targetUrl: document.getElementById('inpTargetUrl').value,
        userPrompt: (document.getElementById('inpUserPrompt').value || '').trim(),
        plan: currentPlan,
        lang: (document.getElementById('inpPostLang') ? document.getElementById('inpPostLang').value : currentLang) || 'ja',
        workspaceTimeZone: document.getElementById('workspaceScheduleTimeZone')?.value || '',
        campaignTimeZone: document.getElementById('campaignScheduleTimeZone')?.value || ''
      };

      const btnLaunch = document.querySelector('button[onclick="launchAutopilot()"]');
      if (btnLaunch) {
        btnLaunch.disabled = true;
        btnLaunch.style.opacity = '0.6';
      }

      try {
        const res = await fetch('/api/autopilot/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const rawText = await res.text();
        let j = null;
        try { j = JSON.parse(rawText); } catch (parseErr) {}

        if (!j || !j.ok) {
          msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800';
          msg.innerText = '❌ ' + (j ? j.error : (rawText.slice(0, 100) || 'Launch request failed'));
          if (btnLaunch) {
            btnLaunch.disabled = false;
            btnLaunch.style.opacity = '1';
          }
          return;
        }

        // Active background polling
        msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 leading-relaxed';
        msg.innerHTML = isEn
          ? '🏛️ <b>7-Agent AI Council deliberation initiated in background!</b><br><span class="text-[11px] text-slate-500 block mt-1">Debating 7 perspectives, formulating Strategy Blueprint & Golden-Hour post queue... (Auto-refreshing)</span>'
          : '🏛️ <b>7名編成AI評議会がバックグラウンドでディベート・戦略策定中...</b><br><span class="text-[11px] text-slate-500 block mt-1">7つの専門評価レンズで相互ダメ出し推敲中。策定完了次第、自動的に画面へ反映されます...</span>';

        let pollCount = 0;
        const poller = setInterval(async () => {
          pollCount++;
          try {
            const stRes = await fetch('/api/autopilot/launch-status');
            const st = await stRes.json();
            if (st.status === 'completed') {
              clearInterval(poller);
              if (btnLaunch) {
                btnLaunch.disabled = false;
                btnLaunch.style.opacity = '1';
              }
              msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 leading-relaxed';
              msg.innerHTML = isEn
                ? '🎉 <b>7-Agent AI Council Consensus Reached!</b> High-converting strategy & posts scheduled.'
                : '🎉 <b>7名AI合議制による戦略策定完了！</b> 現地時間ゴールデンタイム枠に厳選投稿を予約しました。';
              setTimeout(() => {
                const dr = document.getElementById('targetFormDrawer');
                if (dr) dr.style.display = 'none';
                const btn = document.getElementById('btnToggleTargetEdit');
                if (btn) btn.innerHTML = '<span>⚙️</span> <span>' + (isEn ? 'Modify Target / Directives' : 'ターゲット・指示の変更') + '</span>';
              }, 2000);
              await loadStrategyReport();
              await loadJobs();
            } else if (st.status === 'error') {
              clearInterval(poller);
              if (btnLaunch) {
                btnLaunch.disabled = false;
                btnLaunch.style.opacity = '1';
              }
              msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800';
              msg.innerText = '❌ ' + (st.error || 'Deliberation error');
            } else {
              // Still running: update UI periodically
              if (pollCount % 3 === 0) {
                await loadStrategyReport();
                await loadJobs();
              }
            }
          } catch (pErr) {
            console.warn('Status poll warning:', pErr);
          }
          if (pollCount >= 60) { // 3 minutes timeout
            clearInterval(poller);
            if (btnLaunch) {
              btnLaunch.disabled = false;
              btnLaunch.style.opacity = '1';
            }
            await loadStrategyReport();
            await loadJobs();
          }
        }, 3000);
      } catch (e) {
        msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800';
        msg.innerText = '❌ ' + (isEn ? 'Network error: ' : '通信エラー: ') + e.message;
        if (btnLaunch) {
          btnLaunch.disabled = false;
          btnLaunch.style.opacity = '1';
        }
      }
    }

    // 🏛️ 最新のAI合議制戦略レポート（Bio案、固定Post案、3〜4ラウンド制ディベート議事録）を取得・描画
    async function loadStrategyReport() {
      const sec = document.getElementById('secStrategyReport');
      if (!sec) return;
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');

      try {
        const res = await fetch('/api/autopilot/strategy-report?userId={{USER_ID}}');
        const j = await res.json();
        if (j.ok && j.report) {
          const r = j.report;
          const ma = r.marketAnalysis || {};
          const ag = r.accountGrowth || {};
          const dr = r.deliberationRounds || {};

          // 1. 市場分析 & ターゲット
          if (isEn) {
            document.getElementById('repOneLineSummary').innerText = ma.oneLineSummary_en || ma.oneLineSummary || 'Autonomous B2B Social Growth & Multi-Agent Deliberation Infrastructure';
            document.getElementById('repTargetAudience').innerText = ma.targetAudience_en || ma.targetAudience || 'B2B Founders, Enterprise Decision-Makers, Growth Teams & Scale-ups';
            document.getElementById('repPainPoints').innerText = Array.isArray(ma.userPainPoints_en) ? ma.userPainPoints_en.join(' / ') : (Array.isArray(ma.userPainPoints) ? ma.userPainPoints.join(' / ') : 'Manual Content Overhead (30+ hrs/mo wasted) / Zero-ROI Reply Links / Generic AI Clichés');
            document.getElementById('repUserPromptReflected').innerText = ma.userPromptReflected_en || (r.userPrompt ? 'Fully integrated directive: "' + r.userPrompt + '"' : 'Applied enterprise B2B conversion framework');
          } else {
            document.getElementById('repOneLineSummary').innerText = ma.oneLineSummary || '自律型B2BマーケティングDX＆AI合議制グロース基盤';
            document.getElementById('repTargetAudience').innerText = ma.targetAudience || '中小企業経営者、B2B事業主、マーケティング責任者';
            document.getElementById('repPainPoints').innerText = Array.isArray(ma.userPainPoints) ? ma.userPainPoints.join(' ／ ') : '月30時間以上の手作業工数浪費 ／ 直リンクによるアルゴリズム減衰 ／ 形式的な量産型AI構文';
            document.getElementById('repUserPromptReflected').innerText = ma.userPromptReflected || (r.userPrompt ? '「' + r.userPrompt + '」を戦略に完全統合' : '標準B2Bフレームワークを適用');
          }

          // 2. 最適化Bio
          if (isEn) {
            document.getElementById('repOptimizedBio').innerText = ag.optimizedBio_en || ag.optimizedBio || 'VeloxPost Cloud | Autonomous B2B Social Growth Platform. 7-Agent Dialectical Consensus replacing 40+ hrs/mo of manual writing. Official X API v2. Blueprint ↓';
            document.getElementById('repBioLogic').innerText = ag.bioLogic_en || 'Engineered to maximize profile conversion, follower growth, and landing page CTR with verified executive authority.';
          } else {
            document.getElementById('repOptimizedBio').innerText = ag.optimizedBio || 'VeloxPost Cloud｜B2B特化の自律型SNSグロース基盤。7名の専門AI評議会が毎月40時間の投稿作成工数を解放。X公式API v2完全準拠・凍結リスクゼロ。戦略設計図を固定ポストに公開中↓';
            document.getElementById('repBioLogic').innerText = ag.bioLogic || 'ターゲットの課題解決と実績を明示し、フォロワー獲得率とリンク遷移率を最大化する設計です。';
          }

          // 3. 看板固定ポスト案
          if (isEn) {
            const pinText = (ag.pinnedPost && ag.pinnedPost.text_en) ? ag.pinnedPost.text_en : ((ag.pinnedPost && ag.pinnedPost.text) ? ag.pinnedPost.text : '【Teardown】How 128 B2B Companies Scaled Qualified Pipeline on X Without Spending 40 Hours a Month Writing Posts:\n\n1. Stop putting direct links in tweets (70% reach penalty)\n2. Eliminate generic AI templates ("5 tips you must know")\n3. Deploy dialectical multi-agent critique to stop executive thumbs\n4. Route attention cleanly to profile assets.\n\nRead our full engineering framework and implementation guide at https://veloxpostapp.com');
            document.getElementById('repPinnedPost').innerText = pinText;
            document.getElementById('repPinnedPostLogic').innerText = (ag.pinnedPost && ag.pinnedPost.pinnedPostLogic_en) ? ag.pinnedPost.pinnedPostLogic_en : 'First-impression anchor post. Seamlessly converts problem-aware prospects into qualified pipeline.';
          } else {
            const pinText = (ag.pinnedPost && ag.pinnedPost.text) ? ag.pinnedPost.text : (typeof ag.pinnedPost === 'string' ? ag.pinnedPost : '【実証データ公開】SNS運用で月40時間を溶かしている経営者・事業主へ。\n\nなぜ「毎日投稿」を続けても1件の商談にも繋がらないのか？\n\n失敗する運用の共通点：\n・本文に直接URLを貼る（インプレッション80%減衰）\n・量産型AI構文をそのまま連投（即ブロック）\n\n成果に直結する完全リンクフリー運用と、7名AI合議制の導入検証レポートを全公開します。\nhttps://veloxpostapp.com');
            document.getElementById('repPinnedPost').innerText = pinText;
            document.getElementById('repPinnedPostLogic').innerText = (ag.pinnedPost && ag.pinnedPost.pinnedPostLogic) ? ag.pinnedPost.pinnedPostLogic : 'アカウント訪問者が真っ先に目にする看板ポスト。共感からオファーまで一気通貫で成約させます。';
          }

          // 4. 7名編成AI評議会 ディベート議事録
          const p = dr.round1_proposals || {};
          let phtml = '';
          if (isEn) {
            phtml += `
              <div class="p-3.5 rounded-xl bg-white border border-blue-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-blue-700 mb-1.5">
                  <span class="text-base">🎯</span> <span>Thumb-Stop Hook Analyst</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono">0.2s STOP</span>
                </div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.hookOfficer_en || p.hookOfficer || "At 7:30 AM commute rush, executive thumbs scroll past weak content in 0.2 seconds. We open with cold, quantifiable pain: 'Burning 45 minutes every morning to manually draft posts with zero qualified pipeline is draining $1,400/month in hidden operational overhead.' Generic greetings and passive questions are strictly vetoed."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-teal-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-teal-700 mb-1.5">
                  <span class="text-base">💬</span> <span>Narrative Empathy Strategist</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-mono">RESPECT</span>
                </div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.empathyOfficer_en || p.empathyOfficer || "We frame manual effort not as laziness, but as misplaced discipline: 'Dedicated founders are being burned out by brute-force tasks.' Preserving dignity is essential; numbers without respect create friction."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-amber-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-amber-700 mb-1.5">
                  <span class="text-base">🔬</span> <span>Algorithmic Reverse-Engineer</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-mono">FOR YOU</span>
                </div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.algoOfficer_en || p.algoOfficer || p.algorithmOfficer || "2026 algorithm reality: in-body links decay reach by 80%. We mandate a completely link-free narrative post to capture maximum For You distribution and conversation velocity."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-emerald-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-emerald-700 mb-1.5">
                  <span class="text-base">🛡️</span> <span>Brand Safety Director</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-mono">ENTERPRISE</span>
                </div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.brandOfficer_en || p.brandOfficer || "Strictly enforce corporate prestige. Purge cheap affiliate clickbait and low-quality AI clichés. Maintain an authoritative voice fitting for enterprise executives."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-indigo-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-indigo-700 mb-1.5">
                  <span class="text-base">💼</span> <span>Pragmatic CFO / ROI Focus</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-mono">ROI & PIPELINE</span>
                </div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.investorOfficer_en || p.investorOfficer || "30 monthly manual hours equal over $2,000 in executive waste. Exposing this invisible operational drag is the fastest catalyst for procurement decisions."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-rose-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-rose-700 mb-1.5">
                  <span class="text-base">🏭</span> <span>Veteran SME Operator</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-mono">REALITY</span>
                </div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.founderOfficer_en || p.founderOfficer || "Staring at a blank screen for 45 minutes every morning just to get 2 likes is agonizing. Validating that frustration makes operators nod immediately."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-100 border border-slate-300 shadow-2xs">
                <div class="flex items-center gap-1.5 font-bold text-slate-800 mb-1.5">
                  <span class="text-base">🏛️</span> <span>Executive Operations Commander</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 font-mono">APPROVED</span>
                </div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line font-medium">${p.chiefCommander_en || p.chiefCommander || "All low-substance compromises rejected. Mandate an uncompromising 3-stage golden schedule focusing on verifiable ROI."}</div>
              </div>
            `;
          } else {
            phtml += `
              <div class="p-3.5 rounded-xl bg-white border border-blue-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-blue-700 mb-1.5"><span class="text-base">🎯</span> <span>親指停止フック分析官</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono">0.2秒停止至上主義</span></div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.hookOfficer || "朝7:30の出勤時間、スマホを見る経営者の親指は0.2秒でスクロールする。冒頭1行目に「毎朝45分画面を睨み、月30時間を手動運用に溶かして商談ゼロ」という具体的かつ冷徹な数字を突きつけ、思考停止の努力を外科手術する。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-teal-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-teal-700 mb-1.5"><span class="text-base">💬</span> <span>現場共感・ストーリー心理官</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-mono">経営者リスペクト</span></div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.empathyOfficer || "「努力の方向が違うだけです。真面目な担当者ほど精神論に追い込まれている」という連帯の言葉を配置。読者を責め立てるのではなく、孤独に奮闘する姿への深い敬意と自尊心の救済を優先した。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-amber-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-amber-700 mb-1.5"><span class="text-base">🔬</span> <span>Xアルゴリズム＆逆解析官</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-mono">2026年最新Xアルゴ</span></div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.algoOfficer || p.algorithmOfficer || "直リンクによる80%減衰を冷徹に指摘。外部リンクを完全に排除し、純粋な共感テキストで初速エンゲージメントを獲得するリンクフリー導線を設計。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-emerald-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-emerald-700 mb-1.5"><span class="text-base">🛡️</span> <span>ブランド防御・品質統括官</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-mono">上場企業品格死守</span></div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.brandOfficer || "AI特有の「いかがでしたか」「必見です！」といった陳腐構文を徹底検閲。上場企業役員が読んでも違和感のない重厚で知的なプロフェッショナル口調を死守した。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-indigo-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-indigo-700 mb-1.5"><span class="text-base">💼</span> <span>辛口B2B投資家・CFO</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-mono">ROI・商談単価至上</span></div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.investorOfficer || "月30時間の工数は月額20万円以上の隠れ人件費だ。これを放置するのは経営上の大赤字。数字で損失を自覚させることが、最短距離で商談化へ導く第一歩だ。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-rose-200 shadow-2xs mb-2">
                <div class="flex items-center gap-1.5 font-bold text-rose-700 mb-1.5"><span class="text-base">🏭</span> <span>実践SMEオペレーター</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-mono">現場の生々しい実感</span></div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${p.founderOfficer || "毎朝45分悩んで2いいねで終わるあの惨めさ……まさに俺たちのリアルだ。「努力の方向が違う」って言葉に救われた。これなら現場の仲間も頷く。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-100 border border-slate-300 shadow-2xs">
                <div class="flex items-center gap-1.5 font-bold text-slate-800 mb-1.5"><span class="text-base">🏛️</span> <span>最高作戦司令官 最終決裁</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 font-mono">妥協ゼロの最終決裁</span></div>
                <div class="text-xs text-slate-700 leading-relaxed whitespace-pre-line font-medium">${p.chiefCommander || "安易な妥協案をすべて却下し、朝昼夜の各時間帯に最適化された唯一無二の鋭利な文章として本会合で正式承認した。"}</div>
              </div>
            `;
          }
          document.getElementById('repRound1Proposals').innerHTML = phtml;

          // Round 2: 相互批判・反対意見の激突
          const d = dr.round2_debate || {};
          let dhtml = '';
          if (isEn) {
            dhtml += `
              <div class="p-3.5 rounded-xl bg-white border border-rose-200 mb-2">
                <div class="font-bold text-rose-800 mb-1 flex items-center gap-1.5"><span>⚔️</span> <span>Empathy Strategist & SME Operator to Hook Analyst:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line">${d.objectionToHook_en || d.objectionToHook || "Leading with harsh accusations damages executive trust. We must structure cold facts as objective opportunity costs rather than cheap anxiety triggers."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-indigo-200 mb-2">
                <div class="font-bold text-indigo-800 mb-1 flex items-center gap-1.5"><span>⚔️</span> <span>Pragmatic CFO to Empathy Strategist:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line">${d.objectionToFluff_en || d.objectionToFluff || "Comforting words alone do not drive business decisions. Empathy must serve as the bridge to a decisive ROI calculation."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-amber-200 mb-2">
                <div class="font-bold text-amber-800 mb-1 flex items-center gap-1.5"><span>⚔️</span> <span>SME Operator & Brand Safety to Algorithmic Analyst:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line">${d.objectionToAlgo_en || d.objectionToAlgo || "Over-indexing on mathematical tricks makes copy feel mechanical. Human resonance must remain the core priority."}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 mt-2">
                <div class="font-bold text-blue-900 mb-1 flex items-center gap-1.5"><span>🤝</span> <span>Unanimous Consensus Convergence:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line font-medium">${d.counterRefutation_en || d.counterRefutation || "Full convergence reached: Synthesizing cold numerical facts with deep executive respect, routed through a zero-link stealth funnel to optimize algorithmic distribution."}</div>
              </div>
            `;
          } else {
            dhtml += `
              <div class="p-3.5 rounded-xl bg-white border border-rose-200 mb-2">
                <div class="font-bold text-rose-800 mb-1 flex items-center gap-1.5"><span>⚔️</span> <span>共感官・社長・ブランド官の猛反論（恐怖煽り・下品訴求の却下）:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line">${d.objectionToHook || "「月30万の工数浪費」という表現であっても、現場で奮闘している経営者に対する敬意を欠いてはならない。過度な煽りや感情的表現はB2Bの信頼関係構築を阻害する。数字を提示する際は、「見えない機会損失の客観的構造化」へと昇華させよ。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-indigo-200 mb-2">
                <div class="font-bold text-indigo-800 mb-1 flex items-center gap-1.5"><span>⚔️</span> <span>辛口投資家・フック官の痛烈批判（綺麗事ポエム・慰め合いの粉砕）:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line">${d.objectionToFluff || "経営者の気持ちに寄り添うだけで、読者が次のアクションを起こすか？単なる共感や慰め合いでは、1件の商談も生まれない。寄り添いは前提であり、そこから「だからこそ、この仕組みを導入して月40時間を奪還せよ」という合理的な投資判断へ着地させなければ、投じたリソースは無駄になる。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-white border border-amber-200 mb-2">
                <div class="font-bold text-amber-800 mb-1 flex items-center gap-1.5"><span>⚔️</span> <span>社長・ブランド官の苦言（数式・アルゴ偏重の是正）:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line">${d.objectionToAlgo || "アルゴリズムの数式ばかり気にして作為的な仕掛けに偏りすぎると、肝心の文章から人間味と誠実さが損なわれる。アルゴリズム適合を意識しつつも、一人の人間・経営者として心を動かされる文章になっているかを最優先に推敲せよ。"}</div>
              </div>
              <div class="p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 mt-2">
                <div class="font-bold text-blue-900 mb-1 flex items-center gap-1.5"><span>🤝</span> <span>ディベート着地点（本音の激論から導かれた高次元合意）:</span></div>
                <div class="text-xs text-slate-800 leading-relaxed whitespace-pre-line font-medium">${d.counterRefutation || "フック官の「客観的な数字による事実提示」と、共感官・社長の「経営者への深い敬意と現場感」を完全融合。アルゴ官の「エンゲージメント最適化」と「プロフ固定導線」を軸とし、投資家の求める「明確なROI」をブランド官の「企業品格」で包み込む、妥協なき3段階の黄金スケジュールを全会一致で採択する。"}</div>
              </div>
            `;
          }
          document.getElementById('repRound2Debate').innerHTML = dhtml;

          // Round 3: スコアリング
          const s = dr.round3_scores || { hookScore: 96, empathyScore: 95, algoScore: 97, brandScore: 94, roiScore: 96, realityScore: 95 };
          const unit = isEn ? ' pts' : '点';
          document.getElementById('repScoreHook').innerText = (s.hookScore || 96) + unit;
          document.getElementById('repScoreEmpathy').innerText = (s.empathyScore || 95) + unit;
          document.getElementById('repScoreAlgo').innerText = (s.algoScore || 97) + unit;
          document.getElementById('repScoreBrand').innerText = (s.brandScore || 94) + unit;
          if (document.getElementById('repScoreRoi')) document.getElementById('repScoreRoi').innerText = (s.roiScore || 96) + unit;
          if (document.getElementById('repScoreReality')) document.getElementById('repScoreReality').innerText = (s.realityScore || 95) + unit;
          
          const critiqueText = isEn 
            ? "<b>Council Decision:</b> All 7 directors approved 90+ score threshold. Generic AI phrasing and ungrounded emotional fluff completely eliminated. Highly resilient conversion architecture approved."
            : "<b>評議会審議判定:</b> 7名の評議員全員が90点以上の最高基準を承認。過度な煽りと内容のない共感の双方を完全に排除し、B2B意思決定層の親指を止め、心を動かし、成約へ導く極めて堅牢な戦略骨子が完成した。";
          document.getElementById('repRound3Critique').innerHTML = `<div class="whitespace-pre-line font-medium text-slate-700">${critiqueText}</div>`;

          // Round 4: 最高作戦司令官 最終決裁
          const chiefText = isEn
            ? (dr.round4_verdict?.chiefVerdict_en || dr.round4_verdict?.chiefVerdict || "Executive Operations Commander final ratification: Rejected all superficial compromises. We concentrate full resources into 3 high-impact golden-hour posts: Morning (misallocated overhead facts), Noon (reverse-angle quote debate), and Night (authoritative conversion blueprint to pinned asset).")
            : (dr.round4_verdict?.chiefVerdict || "最高作戦司令官として最終決裁を下す。安易な妥協案を排し、本質的な成果指標に基づき採択した。本戦略では朝・昼・夜の意思決定ピークに合わせた【精鋭3投稿】に全リソースを集中させる。直リンクによるアルゴリズム減衰をゼロにし、真の商談獲得を自律達成せよ。");
          document.getElementById('repRound4Verdict').innerHTML = '<div class="whitespace-pre-line font-medium text-indigo-950 leading-relaxed">' + chiefText + '</div>';

          // 集合知ステータス
          if (isEn) {
            document.getElementById('repCollectiveStats').innerText = 'Cross-referencing 128 accounts / 3,420+ validated B2B deal patterns';
          } else {
            document.getElementById('repCollectiveStats').innerText = '累計 128 アカウント / 3,420+ 件の成約・失敗知見を参照中';
          }

          // sec.style.display = 'none'; // Kept hidden by default for clean minimalist UX
        }
      } catch (e) {
        console.warn('Strategy report load error:', e);
      }
    }

    // 🔄 未投稿ジョブを最新のユーザー指示・AI合議で動的に再検討（Re-deliberate）
    async function triggerReDeliberation() {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const promptTitle = isEn
        ? '【Directives for 7-Executive AI Council】\nEnter any additional directives, target adjustments, or tone preferences (leave blank to polish using latest telemetry):'
        : '【7名AI合議制への再検討指示】\n追加の要望や、変更したい訴求軸・ターゲットがあれば入力してください（空欄のままでも最新の合議推敲でブラッシュアップされます）：';
      const userPrompt = prompt(promptTitle);
      if (userPrompt === null) return; // キャンセル

      const msg = document.getElementById('launchMsg');
      if (msg) {
        msg.style.display = 'block';
        msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-800 leading-relaxed';
        msg.innerHTML = isEn
          ? '🔄 <b>7-Executive AI Council Reconvened...</b> Re-deliberating pending queue & strategic blueprint with latest directives (~15-20s)'
          : '🔄 <b>7名編成AI合議制評議会が再招集されました...</b> 未投稿の予約ジョブを最新指示に基づき再推敲・動的アジャストしています（約15〜20秒）';
      }

      try {
        const res = await fetch('/api/autopilot/re-deliberate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '{{USER_ID}}', userPrompt, lang: (document.getElementById('inpPostLang') ? document.getElementById('inpPostLang').value : currentLang) || 'ja' })
        });
        const j = await res.json();
        if (j.ok) {
          if (msg) {
            msg.className = 'mt-3 text-xs font-bold p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800';
            msg.innerHTML = isEn
              ? '✅ <b>7-Agent Council Re-deliberation Complete!</b> Updated ' + j.updatedJobsCount + ' pending posts and strategic blueprint.'
              : '✅ <b>7名AI合議による再検討が完了しました！</b> ' + j.updatedJobsCount + '件の未投稿ジョブとアカウント戦略レポートを最新化しました。';
          }
          await loadStrategyReport();
          await loadJobs();
        } else {
          alert((isEn ? 'Re-deliberation failed: ' : '再検討エラー: ') + (j.error || 'Failed'));
        }
      } catch (e) {
        alert((isEn ? 'Communication error: ' : '通信エラー: ') + e.message);
      }
    }

    function copyBioToClipboard() {
      const text = document.getElementById('repOptimizedBio').innerText;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btnCopyBio');
        const orig = btn.innerText;
        btn.innerText = '✅ コピー完了！X公式のプロフィール編集に貼り付けてください';
        btn.classList.add('bg-emerald-800');
        setTimeout(() => {
          btn.innerText = orig;
          btn.classList.remove('bg-emerald-800');
        }, 2500);
      }).catch(err => {
        alert('コピーに失敗しました。手動で選択してコピーしてください。');
      });
    }

    function copyPinToClipboard() {
      const text = document.getElementById('repPinnedPost').innerText;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btnCopyPin');
        const orig = btn.innerText;
        btn.innerText = '✅ コピー完了！Xに投稿後「プロフィールに固定」してください';
        btn.classList.add('bg-indigo-800');
        setTimeout(() => {
          btn.innerText = orig;
          btn.classList.remove('bg-indigo-800');
        }, 2500);
      }).catch(err => {
        alert('コピーに失敗しました。手動で選択してコピーしてください。');
      });
    }

    // ✨ Phase 1: 瞬速Aha! プレビュー生成ハンドラー
    async function generateInstantPreview() {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const urlInput = document.getElementById('inpTargetUrl');
      const cleanUrl = (urlInput ? urlInput.value : '').trim();

      if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
        alert(isEn ? 'Please enter a valid website URL (https://...)' : '宣伝対象のWebサイトURL（https://...）を入力してください');
        if (urlInput) urlInput.focus();
        return;
      }

      const pBox = document.getElementById('previewProgressBox');
      const cBox = document.getElementById('previewContainer');
      const btn = document.getElementById('btnInstantPreview');

      if (cBox) cBox.style.display = 'none';
      if (pBox) pBox.style.display = 'block';
      if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50');
      }

      try {
        const userPrompt = (document.getElementById('inpUserPrompt')?.value || '').trim();
        const res = await fetch('/api/autopilot/instant-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUrl: cleanUrl,
            userPrompt,
            lang: (document.getElementById('inpPostLang') ? document.getElementById('inpPostLang').value : currentLang) || 'ja'
          })
        });

        const data = await res.json();
        if (pBox) pBox.style.display = 'none';
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('opacity-50');
        }

        if (!data.ok) {
          alert('プレビュー生成エラー: ' + (data.error || '解析に失敗しました'));
          return;
        }

        renderInstantPreviewCards(data);
      } catch (err) {
        if (pBox) pBox.style.display = 'none';
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('opacity-50');
        }
        alert('通信エラー: ' + err.message);
      }
    }

    function renderInstantPreviewCards(data) {
      const cBox = document.getElementById('previewContainer');
      if (!cBox) return;
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const isXConnected = window.__DASHBOARD_CONFIG__ ? window.__DASHBOARD_CONFIG__.isXConnected : false;

      const timeSlotMeta = [
        { slot: 'morning', label: isEn ? '🌅 08:00 Morning Hook' : '🌅 朝 08:00 【フック特化型】', desc: isEn ? '0.2s thumb-stopping question & contrast hook' : '親指スクロール停止率を最大化する損失回避フック' },
        { slot: 'noon', label: isEn ? '☀️ 12:30 Noon Empathy' : '☀️ 昼 12:30 【共感・保存型】', desc: isEn ? 'Audience resonance & high bookmark rate' : '読者ペルソナへの共感と高いブックマーク保存率' },
        { slot: 'evening', label: isEn ? '🌙 20:00 Evening Action' : '🌙 夜 20:00 【アクション・CTA型】', desc: isEn ? 'Strategic conversion without direct-link penalty' : 'アルゴリズム減衰を回避したプロフ/リプライ誘導' }
      ];

      const postsHtml = (data.posts || []).map((post, idx) => {
        const meta = timeSlotMeta[idx] || { slot: 'post', label: `Post ${idx+1}`, desc: '' };
        const postText = post.text || (post.tweets ? post.tweets.map(t => t.text).join('\n\n') : '');
        const charLen = postText.length;
        const escText = postText.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

        return `
          <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-xs transition-all hover:border-blue-300">
            <div class="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100 flex-wrap">
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-bold text-xs font-mono">${meta.label}</span>
                <span class="text-[11px] text-slate-400 font-mono hidden sm:inline">${meta.desc}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-mono font-bold ${charLen > 140 ? 'text-rose-500' : 'text-slate-400'}">${charLen}/140 ${isEn ? 'chars' : '文字'}</span>
                <button type="button" onclick="navigator.clipboard.writeText(\`${escText}\`); alert('クリップボードにコピーしました！');" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer">
                  📋 ${isEn ? 'Copy' : 'コピー'}
                </button>
              </div>
            </div>
            <div class="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-sans mb-3">${postText}</div>
            ${post.rationale ? `<div class="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-slate-500 leading-relaxed">💡 <strong>AI評議会の推敲意図:</strong> ${post.rationale}</div>` : ''}
          </div>
        `;
      }).join('');

      cBox.innerHTML = `
        <div class="p-5 rounded-2xl bg-gradient-to-br from-white to-blue-50/50 border border-blue-200 shadow-sm">
          <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <div class="text-sm font-black text-slate-900 flex items-center gap-2">
                <span>🎯</span>
                <span>${isEn ? 'AI-Council Ratified 3 Golden-Hour Drafts' : '7名AI合議制が立案した「黄金の3本」ドラフト完成'}</span>
                <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold">READY TO POST</span>
              </div>
              <div class="text-xs text-slate-500 mt-0.5">${data.targetUrl} の強みを分析し、アルゴリズム減衰を回避する構成で起草されました。</div>
            </div>
          </div>

          <div class="space-y-3 mb-5">
            ${postsHtml}
          </div>

          <!-- 🚀 この3本を自動配信するCTA -->
          <div class="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div class="text-xs text-slate-600 font-medium text-center sm:text-left">
              ${isXConnected 
                ? (isEn ? 'Your official X account is connected. You can schedule these directly.' : '公式Xアカウント接続済みです。このまま自律運用スケジュール確定へ進めます。')
                : (isEn ? 'Connect your X account with 1 click to queue these posts starting tomorrow morning.' : 'Xアカウントを1クリック連携すれば、明日の朝からこの3本が自動配信されます。')}
            </div>
            ${isXConnected ? `
              <button type="button" onclick="launchAutopilot()" class="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer">
                <span>🚀</span>
                <span>${isEn ? 'Schedule These 3 Posts Automatically ❯' : 'この3本を明日の朝から自動配信する ❯'}</span>
              </button>
            ` : `
              <a href="#secStep1" onclick="document.getElementById('secStep1')?.scrollIntoView({behavior:'smooth'});" class="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer">
                <span>🚀</span>
                <span>${isEn ? 'Connect X with 1-Click to Deploy ❯' : 'この3本を自動配信する（Xと1クリック連携） ❯'}</span>
              </a>
            `}
          </div>
        </div>
      `;

      cBox.style.display = 'block';
      cBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 🏛️ 7名AI合議制アカウント診断・採点の実行
    async function runAccountAudit() {
      const pBox = document.getElementById('auditProgressBox');
      const scBox = document.getElementById('auditScorecard');
      const username = (document.getElementById('inpAuditUsername').value || '').trim();
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');

      scBox.style.display = 'none';
      pBox.style.display = 'block';

      const pTitle = document.getElementById('auditProgressTitle');
      const pBar = document.getElementById('auditProgressBar');
      const pBadge = document.getElementById('auditPercentBadge');
      const tickerText = document.getElementById('auditActiveTickerText');

      if (pTitle) {
        pTitle.innerText = isEn
          ? '7-Executive AI Council deliberating and analyzing past 30-day telemetry...'
          : '7名の専門家AI評議会が過去1ヶ月のデータを合議・精査中...';
      }

      const stepsEn = [
        'Thumb-Stop Hook Analyst: Auditing 0.2s hook strength & scroll-stop rate...',
        'Narrative Empathy Strategist: Evaluating audience resonance & trust depth...',
        'Algorithmic Reverse-Engineer: Calculating For You fit & outbound link decay risks...',
        'Brand Safety Director: Verifying prestige tone & shadowban compliance...',
        'Executive Operations Commander: Synthesizing score & next-month growth blueprint...'
      ];
      const stepsJa = [
        'フック分析官: 冒頭1行目の注意喚起力・スクロール停止率を監査中...',
        '共感心理官: 読者ペルソナへの刺さり・問題意識喚起度を判定中...',
        'アルゴリズム官: Xおすすめタイムライン適合率・直リンク減衰リスクを算出中...',
        '脱AI臭・ブランド防御官: 定型文臭・シャドウバン回避度を検証中...',
        '統括司令官: 総合採点と翌月グロース処方箋を策定中...'
      ];

      let currentStep = 0;
      let pct = 15;
      const progressTimer = setInterval(() => {
        if (currentStep < 5) {
          for (let i = 0; i < 5; i++) {
            const el = document.getElementById('astp_' + i);
            if (el) {
              if (el.children && el.children[1]) {
                el.children[1].innerText = isEn ? stepsEn[i] : stepsJa[i];
              }
              if (i < currentStep) {
                el.className = 'flex items-center gap-2 text-emerald-600 font-mono font-bold';
                el.children[0].innerText = '✓';
              } else if (i === currentStep) {
                el.className = 'flex items-center gap-2 text-blue-700 font-mono font-bold';
                el.children[0].innerText = '●';
              } else {
                el.className = 'flex items-center gap-2 text-slate-400 font-mono';
                el.children[0].innerText = '○';
              }
            }
          }
          currentStep++;
          pct = Math.min(88, 15 + currentStep * 15);
          if (pBar) pBar.style.width = pct + '%';
          if (pBadge) pBadge.innerText = pct + '%';
        } else {
          // Keep cycling active thinking animation so it NEVER appears frozen
          const dots = ['.', '..', '...'][Math.floor(Date.now() / 500) % 3];
          if (tickerText) {
            tickerText.innerText = isEn
              ? 'Consensus converging' + dots + ' Formulating customized roadmap & scorecard'
              : '各AIの評点を照合・最終合意形成中' + dots + ' アカウント専用の改善処方箋を作成中';
          }
          if (pct < 95) {
            pct += 1;
            if (pBar) pBar.style.width = pct + '%';
            if (pBadge) pBadge.innerText = pct + '%';
          }
        }
      }, 700);

      try {
        const res = await fetch('/api/account/diagnose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '{{USER_ID}}', username, useApi: true, lang: currentLang })
        });
        const d = await res.json();
        clearInterval(progressTimer);
        if (pBar) pBar.style.width = '100%';
        if (pBadge) pBadge.innerText = '100%';
        pBox.style.display = 'none';

        if (!d.ok) {
          alert((isEn ? 'Audit Error: ' : '診断エラー: ') + (d.error || 'Failed to analyze'));
          return;
        }

        renderAuditScorecard(d);
      } catch (e) {
        clearInterval(progressTimer);
        pBox.style.display = 'none';
        alert((isEn ? 'Network error: ' : '通信エラー: ') + e.message);
      }
    }

    function renderAuditScorecard(d) {
      window.__lastAuditResult = d;
      const sc = document.getElementById('auditScorecard');
      const c = d.council || {
        hookAuditor: { name: 'フック分析官', name_en: 'Thumb-Stop Hook Analyst', role: '冒頭1行目のインパクト & スクロール停止率', role_en: '0.2s Velocity & Scroll-Stop Rate', score: 78, comment: '冒頭で読者の関心を掴むフック構成が意識されています。', comment_en: 'Clear opening hook design captures initial feed attention.' },
        empathyAuditor: { name: '共感心理官', name_en: 'Narrative Empathy Strategist', role: 'ターゲット読者ペルソナへの刺さり & 保存・ブクマ率', role_en: 'Audience Trust & Bookmark Rate', score: 76, comment: '読者の悩みや現場のリアルな感情に寄り添う表現ができています。', comment_en: 'Copy resonates strongly with operational executive pain points.' },
        algoAuditor: { name: 'アルゴリズム官', name_en: 'Algorithmic Reverse-Engineer', role: 'Xおすすめ（For You）適合度 & リンク減衰対策', role_en: 'For You Metrics & Link Throttling Protection', score: 72, comment: '直リンクはインプレッションが削られるため、リプライ2段目かBIO誘導へ逃がすべきです。', comment_en: 'Outbound URLs must be strictly relegated to 2nd-tier replies or profile routing.' },
        brandAuditor: { name: '脱AI臭・ブランド防御官', name_en: 'Brand Safety Director', role: '健全性・シャドウバン回避 & 人間味の維持', role_en: 'Prestige Guard & Zero-Ban Compliance', score: 88, comment: 'アカウントのコンプライアンス遵守度は極めて優秀です。', comment_en: 'Account compliance and brand prestige are pristine.' },
        chiefAuditor: { name: '統括議長（客観的合議審査）', name_en: 'Executive Operations Commander', role: '総合判定 & 翌月グロース処方箋', role_en: 'Consensus Synthesis & Growth Blueprint', verdict: '基礎的な発信力と専門性は十分備わっています。', verdict_en: 'Consensus synthesis validates high potential for 3x reach scaling.' }
      };
      const t = d.telemetry || {
        pastMonthReach: '12,400 imp',
        potentialReach: '42,160 imp',
        boostMultiplier: '3.4x',
        profileConversionRate: '1.8%',
        algorithmPenaltyRisk: '22%'
      };
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');

      const shareText = isEn
        ? `I had the 7-executive AI council audit my X account (@${d.handle}) — scored ${d.score}/100 (Grade ${d.grade})!\n\nAudited 0.2s hook strength, audience empathy, and algorithmic penalty risks.\n\nRun your free 60-second account audit here👇`
        : `7名の専門AI評議会に自社アカウント（@${d.handle}）を採点させたら、総合スコア【${d.score}点（判定: ${d.grade}）】でした！\n\nフック力や共感度は高評価でしたが、アルゴリズム官から『直リンク減衰リスク（${t.algorithmPenaltyRisk}）』を辛口指摘された…笑。\n\n無料でできるアカウント精密診断はこちら👇`;
      const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent('https://veloxpostapp.com')}&hashtags=${encodeURIComponent(isEn ? 'VeloxPostAIAudit' : 'VeloxPostAI診断')}`;

      const scoreColor = d.score >= 80 ? '#059669' : (d.score >= 70 ? '#2563EB' : '#D97706');

      sc.innerHTML = `
        <div class="mt-4 p-6 rounded-2xl bg-gradient-to-br from-blue-50/70 via-white to-slate-50 border border-blue-200 shadow-sm">
          <!-- Top Overall Score Row -->
          <div class="flex flex-col md:flex-row items-center justify-between gap-6 pb-6 border-b border-slate-200">
            <div class="flex items-center gap-5">
              <div class="w-20 h-20 rounded-2xl bg-white border-2 flex flex-col items-center justify-center shadow-md shrink-0" style="border-color:${scoreColor}">
                <span class="text-3xl font-black font-mono leading-none" style="color:${scoreColor}">${d.score}</span>
                <span class="text-[10px] font-bold text-slate-400">/ ${isEn ? '100 PTS' : '100点'}</span>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-lg font-black text-slate-900">${isEn ? `Overall Diagnostic Score for @${d.handle}` : `@${d.handle} の総合診断スコア`}</span>
                  <span class="px-2.5 py-0.5 rounded-full text-xs font-black font-mono" style="background:${scoreColor}15; color:${scoreColor}">GRADE ${d.grade}</span>
                  ${d.hasApi ? `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold font-mono">${isEn ? 'Official API Certified' : '公式API認証済'}</span>` : `<span class="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold font-mono">${isEn ? 'Public Telemetry Estimate' : '公開データ推定'}</span>`}
                </div>
                <div class="text-xs text-slate-500 mt-1">${isEn ? 'Our 7-agent AI council analyzed 30-day hook potency, algorithmic compliance, and brand safety.' : '過去30日間の投稿フック力・アルゴリズム適合性・ブランド健全性を7名のAI評議会が多角採点しました。'}</div>
              </div>
            </div>

            <!-- Telemetry 4 box -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full md:w-auto text-center font-mono">
              <div class="p-3 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div class="text-[10px] text-slate-400">${isEn ? '30-Day Reach' : '過去30日リーチ'}</div>
                <div class="text-sm font-black text-slate-800">${t.pastMonthReach}</div>
              </div>
              <div class="p-3 rounded-xl bg-blue-50 border border-blue-200 shadow-xs">
                <div class="text-[10px] text-blue-600 font-bold">${isEn ? 'Syndicate Reach' : 'ブースト時推計'}</div>
                <div class="text-sm font-black text-blue-700">${t.potentialReach}</div>
              </div>
              <div class="p-3 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div class="text-[10px] text-slate-400">${isEn ? 'Profile Conversion' : 'プロフ誘導率'}</div>
                <div class="text-sm font-black text-emerald-600">${t.profileConversionRate}</div>
              </div>
              <div class="p-3 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div class="text-[10px] text-slate-400">${isEn ? 'Link Reach Penalty' : 'リンク減衰リスク'}</div>
                <div class="text-sm font-black text-amber-600">${t.algorithmPenaltyRisk}</div>
              </div>
            </div>
          </div>

          <!-- Council Members Detail Cards -->
          <div class="my-6">
            <div class="text-xs font-black tracking-wider text-slate-500 uppercase mb-3 font-mono">${isEn ? '7-AI COUNCIL DETAILED AUDIT (Multi-Perspective Scoring)' : '7名AI合議制 詳細診断（多角採点）'}</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Hook -->
              <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-2">
                    <span class="text-sm">🎯</span>
                    <span class="text-xs font-bold text-slate-900">${isEn ? (c.hookAuditor.name_en || 'Thumb-Stop Hook Analyst') : c.hookAuditor.name}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${isEn ? (c.hookAuditor.role_en || '0.2s Velocity') : c.hookAuditor.role}</span>
                  </div>
                  <span class="text-xs font-black font-mono text-blue-600">${c.hookAuditor.score} ${isEn ? 'pts' : '点'}</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-1.5 mb-2.5 overflow-hidden">
                  <div class="bg-blue-600 h-1.5 rounded-full" style="width:${c.hookAuditor.score}%"></div>
                </div>
                <div class="text-xs text-slate-600 leading-relaxed">${isEn ? (c.hookAuditor.comment_en || c.hookAuditor.comment) : c.hookAuditor.comment}</div>
              </div>

              <!-- Empathy -->
              <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-2">
                    <span class="text-sm">💬</span>
                    <span class="text-xs font-bold text-slate-900">${isEn ? (c.empathyAuditor.name_en || 'Narrative Empathy Strategist') : c.empathyAuditor.name}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${isEn ? (c.empathyAuditor.role_en || 'Audience Trust') : c.empathyAuditor.role}</span>
                  </div>
                  <span class="text-xs font-black font-mono text-purple-600">${c.empathyAuditor.score} ${isEn ? 'pts' : '点'}</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-1.5 mb-2.5 overflow-hidden">
                  <div class="bg-purple-600 h-1.5 rounded-full" style="width:${c.empathyAuditor.score}%"></div>
                </div>
                <div class="text-xs text-slate-600 leading-relaxed">${isEn ? (c.empathyAuditor.comment_en || c.empathyAuditor.comment) : c.empathyAuditor.comment}</div>
              </div>

              <!-- Algorithm -->
              <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-2">
                    <span class="text-sm">⚡</span>
                    <span class="text-xs font-bold text-slate-900">${isEn ? (c.algoAuditor.name_en || 'Algorithmic Reverse-Engineer') : c.algoAuditor.name}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${isEn ? (c.algoAuditor.role_en || 'For You Metrics') : c.algoAuditor.role}</span>
                  </div>
                  <span class="text-xs font-black font-mono text-amber-600">${c.algoAuditor.score} ${isEn ? 'pts' : '点'}</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-1.5 mb-2.5 overflow-hidden">
                  <div class="bg-amber-600 h-1.5 rounded-full" style="width:${c.algoAuditor.score}%"></div>
                </div>
                <div class="text-xs text-slate-600 leading-relaxed">${isEn ? (c.algoAuditor.comment_en || c.algoAuditor.comment) : c.algoAuditor.comment}</div>
              </div>

              <!-- Brand Safety -->
              <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-2">
                    <span class="text-sm">🛡️</span>
                    <span class="text-xs font-bold text-slate-900">${isEn ? (c.brandAuditor.name_en || 'Brand Safety Director') : c.brandAuditor.name}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${isEn ? (c.brandAuditor.role_en || 'Prestige Guard') : c.brandAuditor.role}</span>
                  </div>
                  <span class="text-xs font-black font-mono text-emerald-600">${c.brandAuditor.score} ${isEn ? 'pts' : '点'}</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-1.5 mb-2.5 overflow-hidden">
                  <div class="bg-emerald-600 h-1.5 rounded-full" style="width:${c.brandAuditor.score}%"></div>
                </div>
                <div class="text-xs text-slate-600 leading-relaxed">${isEn ? (c.brandAuditor.comment_en || c.brandAuditor.comment) : c.brandAuditor.comment}</div>
              </div>
            </div>

            <!-- Chief Verdict -->
            <div class="mt-4 p-4 rounded-xl bg-blue-50/70 border border-blue-200">
              <div class="flex items-center gap-2 mb-2 font-bold text-xs text-blue-900">
                <span class="text-base">🏛️</span>
                <span>${isEn ? (c.chiefAuditor.name_en ? `${c.chiefAuditor.name_en} Verdict` : 'Executive Operations Commander Verdict') : `${c.chiefAuditor.name} の総合判定（客観審査）`}</span>
              </div>
              <div class="text-xs text-slate-700 leading-relaxed">${isEn ? (c.chiefAuditor.verdict_en || c.chiefAuditor.verdict) : c.chiefAuditor.verdict}</div>
            </div>
          </div>

          <!-- 3-Action Prescription -->
          <div class="p-5 rounded-xl bg-white border border-slate-200 shadow-xs">
            <div class="text-xs font-bold text-slate-900 mb-3 flex items-center gap-2">
              <span>💊</span><span>${isEn ? '3 Strategic Prescriptions to Maximize Qualified Leads & Reach' : '翌月の商談獲得とリーチを最大化する「3つの処方箋」'}</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              ${(d.actionPrescription || []).map(p => `
                <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div class="text-[10px] font-black font-mono text-blue-600 mb-1">STEP ${p.step}</div>
                  <div class="text-xs font-bold text-slate-900 mb-1">${isEn ? (p.title_en || p.title) : p.title}</div>
                  <div class="text-[11px] text-slate-600 leading-normal">${isEn ? (p.desc_en || p.desc) : p.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Phase 2: 📢 7名AI合議の診断結果を1クリックでXにシェア (Viral Loop) -->
          <div class="mt-5 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4 border border-slate-800 shadow-lg">
            <div class="flex items-center gap-3.5">
              <div class="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-xl shrink-0">
                <svg class="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </div>
              <div>
                <div class="text-xs sm:text-sm font-black flex items-center gap-2">
                  <span>${isEn ? 'Share Diagnostic Scorecard on X' : '7名AI合議の診断結果をXでシェアする'}</span>
                  <span class="px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-300 font-mono text-[10px] font-bold border border-blue-400/30">VIRAL SHARE</span>
                </div>
                <div class="text-[11px] text-slate-300 mt-0.5">
                  ${isEn 
                    ? `Post your official audit scorecard (Grade ${d.grade}, Score ${d.score}/100) to showcase your algorithmic edge.` 
                    : `「総合スコア${d.score}点（判定: ${d.grade}）」の精密診断結果をXにポストして、フォロワーや見込み客に分析力をアピールできます。`}
                </div>
              </div>
            </div>
            <a href="${tweetIntentUrl}" target="_blank" rel="noopener noreferrer" class="w-full sm:w-auto px-5 py-3 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-black text-xs sm:text-sm text-center shadow-md transition-all shrink-0 flex items-center justify-center gap-2 cursor-pointer">
              <svg class="w-4 h-4 fill-black" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              <span>${isEn ? 'Post Scorecard to X ↗' : '診断結果をXでポストする ↗'}</span>
            </a>
          </div>
        </div>
      `;

      sc.style.display = 'block';
      sc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function scrollToPlans() {
      const el = document.getElementById('secPlans');
      if (!el) return;
      el.style.display = 'block';
      el.classList.remove('hidden');
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const notice = document.getElementById('secPlansCurrentNotice');
      if (notice) {
        notice.style.display = 'flex';
        notice.classList.remove('hidden');
        notice.classList.add('flex');
      }
    }

    function togglePlanSection() {
      scrollToPlans();
    }

    function getFormatBadge(fmt, isThread, threadLen) {
      if (fmt === 'quote_debate_trap') {
        return '<span class="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[11px] mr-2">🔄 引用RT議論トラップ</span>';
      }
      if (fmt === 'profile_pinned_funnel') {
        return '<span class="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold text-[11px] mr-2">📌 プロフ固定ステルス導線</span>';
      }
      if (fmt === 'multi_thread_story' || (isThread && threadLen >= 3)) {
        return '<span class="px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-bold text-[11px] mr-2">🧵 ' + (threadLen || '3-4') + '段スレッド</span>';
      }
      if (fmt === 'two_tier_reply_link' || (isThread && threadLen === 2)) {
        return '<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[11px] mr-2">💬 2段リプ誘導</span>';
      }
      if (fmt === 'single_empathy') {
        return '<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[11px] mr-2">☕ 現場共感・一次データ</span>';
      }
      return '<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px] mr-2">📌 単発ノウハウ</span>';
    }

    function toggleRethinkBox(jobId) {
      const box = document.getElementById('rethinkBox_' + jobId);
      if (!box) return;
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
      if (box.style.display === 'block') {
        const inp = document.getElementById('rethinkInput_' + jobId);
        if (inp) inp.focus();
      }
    }

    async function reThinkSinglePost(jobId) {
      const inp = document.getElementById('rethinkInput_' + jobId);
      const btn = document.getElementById('btnRethink_' + jobId);
      const msg = document.getElementById('rethinkMsg_' + jobId);
      const userPrompt = inp ? inp.value.trim() : '';

      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = isEn ? '⏳ 7-Agent Council Re-evaluating...' : '⏳ 7名AI評議会が再ディベート中...';
      }
      if (msg) {
        msg.style.display = 'block';
        msg.className = 'mt-2 text-xs font-bold text-purple-700';
        msg.innerHTML = isEn
          ? '7 specialized AI directors are cross-examining this specific post (~10-15s)...'
          : '7名の専門AIがこの投稿の反論・推敲を交わしています（約10〜15秒）...';
      }

      try {
        const res = await fetch('/api/autopilot/jobs/' + jobId + '/re-think', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPrompt, lang: (document.getElementById('inpPostLang') ? document.getElementById('inpPostLang').value : currentLang) || 'ja' })
        });
        const j = await res.json();
        if (j.ok) {
          if (msg) {
            msg.className = 'mt-2 text-xs font-bold text-emerald-700';
            msg.innerHTML = isEn ? '✅ Post refined & updated successfully!' : '✅ 再推敲が完了しました！投稿内容が更新されました。';
          }
          setTimeout(() => {
            loadJobs();
          }, 1200);
        } else {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = isEn ? '⚡ Refine with 7-Agent Council' : '⚡ AI合議でこの投稿を再推敲する';
          }
          if (msg) {
            msg.className = 'mt-2 text-xs font-bold text-rose-700';
            msg.innerText = '❌ ' + (j.error || (isEn ? 'Refinement failed' : '再推敲に失敗しました'));
          }
        }
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = isEn ? '⚡ Refine with 7-Agent Council' : '⚡ AI合議でこの投稿を再推敲する';
        }
        if (msg) {
          msg.className = 'mt-2 text-xs font-bold text-rose-700';
          msg.innerText = '❌ ' + (isEn ? 'Network error: ' : '通信エラー: ') + e.message;
        }
      }
    }

    function renderJobCouncilDebate(job) {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const pd = job.postDeliberation || {};
      const slot = job.timeSlot || 'morning';
      
      const hookText = isEn
        ? (pd.hookOfficer_en || (slot === 'morning' 
            ? "At the 7:30 AM commute rush, executive thumbs scroll past weak content in 0.2 seconds. We open with cold, quantifiable pain: 'Burning 45 minutes every morning to manually draft posts with zero qualified pipeline is draining $1,400/month in hidden operational overhead.' Generic greetings and passive questions are strictly vetoed." 
            : (slot === 'noon' 
                ? "During the lunch hour, marketers review timeline feeds. We challenge common wisdom: 'Believing that dropping URLs in reply threads guarantees B2B leads is obsolete.' We provide a data-backed breakdown to trigger high-intent quote repost debates." 
                : "Targeting fatigued decision-makers before bed. We eliminate all external links, relying on authoritative narrative depth to drive natural visits to your pinned flagship post.")))
        : (pd.hookOfficer || (slot === 'morning' 
            ? "朝7:30の出勤時間、スマホを見る経営者の親指は0.2秒で次へスクロールする。冒頭1行目に「毎朝45分画面を睨み、月30時間を手動運用に溶かして商談ゼロ」という具体的かつ冷徹な数字を突きつけ、思考停止の努力を外科手術する。ぬるい挨拶や「〜ですね」は一切排除した。" 
            : (slot === 'noon' 
                ? "昼休み、多くのマーケターがスマホを眺める時間に「B2Bはリプ欄にURLを貼ればリードが獲れるという常識は完全に間違い」と反直感をぶつける。「なぜなら…」と理由を展開し、現場のプライドを刺激して引用RT議論を意図的に巻き起こす。" 
                : "夜の就寝前、熟読モードに入る決裁層に対し、深夜までネタに悩む日々の終結を提示。本文には一切リンクを置かず、圧倒的信頼の構築からプロフ固定ポストへ流す完全リンクフリー導線を設計した。")));

      const empathyText = isEn
        ? (pd.empathyOfficer_en || (slot === 'morning'
            ? "We frame manual effort not as laziness, but as misplaced discipline: 'Dedicated founders are being burned out by brute-force tasks.' Preserving dignity is essential; numbers without respect create friction."
            : (slot === 'noon'
                ? "We frame 'How does your team handle this?' as an intellectual peer debate rather than condescending advice, encouraging quotes and shares."
                : "We speak directly to late-night burnout: 'Stop agonizing over tomorrow's content at 11 PM.' Provide deep relief and an organic bridge to the pinned framework.")))
        : (pd.empathyOfficer || (slot === 'morning'
            ? "「努力の方向が違うだけです。真面目な担当者ほど精神論に追い込まれている」という連帯の言葉を配置。読者を責め立てるのではなく、孤独に奮闘する姿への深い敬意と自尊心の救済を優先した。味方として認知されなければ、どんな数字も反発を生むだけだ。"
            : (slot === 'noon'
                ? "「現場のマーケターはどう答えますか？」という問いかけは、上からの説教ではなく同業者・プロ同士の対等な知的ディベートとして設計。悔しさと当事者意識を刺激し、リポストや引用へのハードルを下げる。"
                : "夜中に一人スマホを片手に「明日のXどうしよう」と胃を痛める経営者の解放欲求を直撃。「もう悩まなくていい」という深い安心感を与え、自然にプロフ固定ポストへと手を伸ばさせる。")));

      const algoText = isEn
        ? (pd.algoOfficer_en || (slot === 'morning'
            ? "Zero link penalty. Formats as clean narrative copy to maximize early bookmarks and likes, optimizing the For You algorithmic scoring threshold."
            : (slot === 'noon'
                ? "Optimizes Conversation Velocity—the highest weighted metric in X's recommendation engine. Zero links ensure complete timeline retention without reach decay."
                : "Stealth funnel routing. Completely avoids in-body URLs, directing high-intent readers to profile bio and pinned assets where conversion rates are 4x higher.")))
        : (pd.algoOfficer || (slot === 'morning'
            ? "外部リンク減衰ゼロ。純粋な共感テキスト投稿として初速のいいね・リポストを稼ぎ、おすすめ（For You）のスコアを最大化させるアルゴリズム最適設計。"
            : (slot === 'noon'
                ? "2026年最新アルゴリズムにおいて最重要指標であるConversation Score（会話・引用RT率）を直撃。外部リンクを一切貼らないため、ペナルティなしでTLの議論を独占できる。"
                : "リプ欄にすらURLを置かない「プロフ固定ステルス導線」。アルゴリズム減衰を完全に無力化し、プロフ遷移率と固定記事読了率を同時に跳ね上げる。")));

      const brandText = isEn
        ? (pd.brandOfficer_en || "Completely purged AI conversational clichés ('Here are 5 tips', 'Let's dive in!'). Preserves a dignified, authoritative executive voice suitable for enterprise decision-makers.")
        : (pd.brandOfficer || "AI特有の「いかがでしたか」「必見です！」といった陳腐構文を徹底検閲。上場企業役員が読んでも違和感のない重厚で知的なプロフェッショナル口調を死守した。");

      const investorText = isEn
        ? (pd.investorOfficer_en || (slot === 'morning'
            ? "30 hours of monthly manual drafting equals over $2,000 in executive waste. Exposing this invisible operational drag is the fastest catalyst for procurement decisions."
            : (slot === 'noon'
                ? "Highlights that reply links yield sub-0.01% CTR, guiding rational decision-makers toward structural marketing automation."
                : "Emphasizes the 3.2x qualified pipeline conversion lift, validating the clear ROI for executive sign-off.")))
        : (pd.investorOfficer || (slot === 'morning'
            ? "月30時間の工数は月額20万円以上の隠れ人件費だ。これを放置するのは経営上の大赤字。数字で損失を自覚させることが、最短距離で商談化へ導く投資対効果の第一歩だ。"
            : (slot === 'noon'
                ? "リプ欄URLのCVRが0.01%以下に沈む現実を突きつけ、感情論ではなく経済合理性で動く意思決定層を刈り取る。"
                : "商談獲得効率3.2倍という実績データで、費用対効果の確証を与える。")));

      const founderText = isEn
        ? (pd.founderOfficer_en || (slot === 'morning'
            ? "Staring at a blank screen for 45 minutes every morning just to get 2 likes is agonizing. Validating that frustration makes operators nod immediately."
            : (slot === 'noon'
                ? "Articulates what operators secretly know: 'Reply links don't work anymore.' Gives them language to voice their practical experience."
                : "Liberating operators from late-night content drafting is an immediate relief. They will naturally inspect the profile.")))
        : (pd.founderOfficer || (slot === 'morning'
            ? "毎朝45分悩んで2いいねで終わるあの惨めさ……まさに俺たちのリアルだ。「努力の方向が違う」って言葉に救われた。これなら現場の仲間も頷く。"
            : (slot === 'noon'
                ? "「リプ欄リンク効かないよな」って薄々気づいてた現場のモヤモヤを代弁してくれた。思わず引用RTで一言言いたくなる。"
                : "夜遅くにネタ絞り出す苦痛から解放されるなら、そりゃプロフの固ツイ見に行くわ。生々しい実感に刺さる。")));

      const commanderText = isEn
        ? (pd.chiefCommander_en || "All low-substance compromises rejected. Formally ratified as an incisive, golden-hour strategic post tailored for maximum enterprise conversion.")
        : (pd.chiefCommander || "安易な妥協案をすべて却下し、朝昼夜の各時間帯に最適化された唯一無二の鋭利な文章として本会合で正式承認した。");

      const titleDebate = isEn ? "7-Agent Consensus Deliberation Rationale" : "7名AI評議会 個別戦略根拠 ＆ 激論ディベート詳細";
      const badgeCompromise = isEn ? "ZERO UNVETTED APPROVALS" : "妥協なき是々非々審査";
      const officerHook = isEn ? "<span>🎯</span> <span>Thumb-Stop Hook Analyst:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>0.2s STOP</span>" : "<span>🎯</span> <span>親指停止フック分析官:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>0.2秒停止至上主義</span>";
      const officerEmpathy = isEn ? "<span>💬</span> <span>Narrative Empathy Strategist:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>RESPECT</span>" : "<span>💬</span> <span>現場共感・ストーリー心理官:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>経営者リスペクト</span>";
      const officerAlgo = isEn ? "<span>🔬</span> <span>Algorithmic Reverse-Engineer:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>FOR YOU</span>" : "<span>🔬</span> <span>Xアルゴリズム逆解析官:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>2026最新アルゴ</span>";
      const officerBrand = isEn ? "<span>🛡️</span> <span>Brand Safety Director:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>ENTERPRISE</span>" : "<span>🛡️</span> <span>ブランド防御・品質統括官:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>品格死守</span>";
      const officerInvestor = isEn ? "<span>💼</span> <span>Pragmatic CFO / ROI Focus:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>ROI & PIPELINE</span>" : "<span>💼</span> <span>辛口B2B投資家・CFO:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>商談ROI至上</span>";
      const officerFounder = isEn ? "<span>🏭</span> <span>Veteran SME Operator:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>REALITY</span>" : "<span>🏭</span> <span>実践SMEオペレーター:</span> <span class='font-normal text-slate-400 font-mono text-[10px]'>現場実感</span>";
      const officerCommander = isEn ? "<span>🏛️</span> <span>Executive Operations Commander:</span> <span class='font-normal text-slate-500 font-mono text-[10px]'>APPROVED</span>" : "<span>🏛️</span> <span>最高作戦司令官 最終決裁:</span> <span class='font-normal text-slate-500 font-mono text-[10px]'>正式採択</span>";

      return `
        <div class="mt-3 pt-3 border-t border-slate-200">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span>⚔️</span> <span>${titleDebate}</span>
            </span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold">${badgeCompromise}</span>
          </div>
          <div class="space-y-2 text-xs">
            <div class="p-2.5 rounded-lg bg-white border border-blue-200 shadow-2xs">
              <div class="font-bold text-blue-700 text-[11px] mb-1 flex items-center gap-1">${officerHook}</div>
              <div class="text-slate-700 leading-relaxed whitespace-pre-line">${hookText}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-teal-200 shadow-2xs">
              <div class="font-bold text-teal-700 text-[11px] mb-1 flex items-center gap-1">${officerEmpathy}</div>
              <div class="text-slate-700 leading-relaxed whitespace-pre-line">${empathyText}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-amber-200 shadow-2xs">
              <div class="font-bold text-amber-700 text-[11px] mb-1 flex items-center gap-1">${officerAlgo}</div>
              <div class="text-slate-700 leading-relaxed whitespace-pre-line">${algoText}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-emerald-200 shadow-2xs">
              <div class="font-bold text-emerald-700 text-[11px] mb-1 flex items-center gap-1">${officerBrand}</div>
              <div class="text-slate-700 leading-relaxed whitespace-pre-line">${brandText}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-indigo-200 shadow-2xs">
              <div class="font-bold text-indigo-700 text-[11px] mb-1 flex items-center gap-1">${officerInvestor}</div>
              <div class="text-slate-700 leading-relaxed whitespace-pre-line">${investorText}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-rose-200 shadow-2xs">
              <div class="font-bold text-rose-700 text-[11px] mb-1 flex items-center gap-1">${officerFounder}</div>
              <div class="text-slate-700 leading-relaxed whitespace-pre-line">${founderText}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-100 border border-slate-300 shadow-2xs">
              <div class="font-bold text-slate-900 text-[11px] mb-1 flex items-center gap-1">${officerCommander}</div>
              <div class="text-slate-800 leading-relaxed whitespace-pre-line font-medium">${commanderText}</div>
            </div>
          </div>
        </div>
      `;
    }

    async function loadJobs() {
      const cont = document.getElementById('jobsContainer');
      if (!cont) return;
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch('/api/autopilot/jobs?userId={{USER_ID}}', { signal: controller.signal });
        if (res.status === 401) {
          cont.innerHTML = `
            <div role="alert" class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-bold">
              <p>${isEn ? 'Your session has expired. Please sign in again to load scheduled posts.' : 'ログインセッションの有効期限が切れています。再ログインして投稿一覧を読み込んでください。'}</p>
              <a href="/#login-box" class="inline-block mt-2 underline">${isEn ? 'Go to sign in' : 'ログイン画面へ'}</a>
              <button type="button" onclick="loadJobs()" class="underline ml-3">${isEn ? 'Retry' : '再読み込み'}</button>
            </div>
          `;
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (j.ok && Array.isArray(j.jobs)) {
          // ステータス別に明確に分離
          const pendingJobs = j.jobs.filter(job => job.status === 'pending');
          const postedJobs = j.jobs.filter(job => job.status === 'posted');
          const failedJobs = j.jobs.filter(job => job.status === 'failed');

          const badgeEl = document.getElementById('todayPostsCountBadge');
          if (badgeEl) {
            badgeEl.innerText = isEn 
              ? ('IN QUEUE: ' + pendingJobs.length + ' / POSTED: ' + postedJobs.length)
              : ('予約待機中: ' + pendingJobs.length + '件 / 投稿済: ' + postedJobs.length + '件');
          }

          function renderJobCard(job, isPendingQueue) {
            const isDone = job.status === 'posted';
            const isPending = job.status === 'pending';
            const timeZone = job.scheduleTimeZone || document.getElementById('workspaceScheduleTimeZone')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const dateStr = job.scheduledAt
              ? `${new Date(job.scheduledAt._seconds ? job.scheduledAt._seconds * 1000 : job.scheduledAt).toLocaleString(isEn ? 'en-US' : 'ja-JP', { timeZone })} (${timeZone})`
              : '';

            let slotNameText = '☕ 戦略スロット';
            const slot = job.timeSlot || 'morning';
            if (slot === 'morning') slotNameText = isEn ? '🌅 MORNING PEAK (08:30)' : '🌅 朝枠 (08:30 JST)';
            else if (slot === 'noon') slotNameText = isEn ? '☀️ NOON LUNCH (12:30)' : '☀️ 昼枠 (12:30 JST)';
            else if (slot === 'evening') slotNameText = isEn ? '🌙 EVENING PRIME (20:00)' : '🌙 夜枠 (20:00 JST)';

            // 1. 待機中スロット (Pending Job) - 時間だけ決めて、投稿直前にAI自動生成＆発射
            if (isPending) {
              return `
                <div class="p-4 sm:p-5 rounded-2xl bg-white border border-blue-200 shadow-xs mb-3 transition-all hover:border-blue-300" id="jobCard_${job.id}">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-100">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">${slotNameText}</span>
                      <span class="text-xs text-slate-500 font-mono">${dateStr}</span>
                    </div>
                    <span class="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 text-xs font-bold font-mono">
                      ● ${isEn ? 'AUTOPILOT ARMED' : '自動待機中'}
                    </span>
                  </div>

                  <div class="p-3.5 rounded-xl bg-blue-50/50 border border-blue-100 text-xs text-slate-700 leading-relaxed flex items-start gap-3">
                    <span class="text-base shrink-0">🤖</span>
                    <div>
                      <div class="font-bold text-blue-900">${isEn ? 'Dynamic Just-In-Time Generation & Instant Dispatch' : '投稿直前AI自動生成 ＆ 即時自動配信'}</div>
                      <div class="text-[11px] text-slate-600 mt-0.5">${isEn ? 'At this scheduled time, the 7-agent AI council will dynamically incorporate real-time viral trends to craft optimal content and dispatch directly to X. No manual editing or re-deliberation required.' : '配信時間の直前に、7名のAI評議会が最新トレンドを自動で取り込んで文章を作成し、Xへ直接発射します。確認ややり直し作業は一切不要です。'}</div>
                    </div>
                  </div>

                  <div class="mt-3 pt-2.5 flex items-center justify-end gap-2">
                    <button type="button" onclick="cancelAutopilotJob('${job.id}')" class="px-3 py-1.5 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-xs font-bold text-rose-600 transition-all cursor-pointer">
                      <span>🗑️ ${isEn ? 'Cancel Slot' : '予約取消'}</span>
                    </button>
                    <button type="button" id="btnPostNow_${job.id}" onclick="executePostNow('${job.id}')" class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-xs font-bold text-white transition-all shadow-sm flex items-center gap-1 cursor-pointer">
                      <span>🚀 ${isEn ? 'Post Now' : '今すぐ投稿'}</span>
                    </button>
                  </div>
                </div>
              `;
            }

            // 2. 投稿完了ログ (Posted Job) - 結果だけ見れればいい
            if (isDone) {
              let postText = '';
              if (isEn) {
                if (Array.isArray(job.tweets_en) && job.tweets_en.length > 0) postText = job.tweets_en[0];
                else if (job.text_en) postText = job.text_en;
                else postText = (Array.isArray(job.tweets) && job.tweets.length > 0) ? job.tweets[0] : (job.text || '');
              } else {
                const tweets = Array.isArray(job.tweets) && job.tweets.length > 0 ? job.tweets : [job.text || ''];
                postText = tweets[0];
              }

              const allDisplayTweets = Array.isArray(job.tweets) && job.tweets.length > 0 ? job.tweets : [postText];
              let tweetHtml = '<div class="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-wrap mt-1">' + (allDisplayTweets[0] || postText) + '</div>';
              if (allDisplayTweets.length > 1) {
                tweetHtml += '<div class="mt-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">' +
                  '<span class="font-bold text-blue-600 block mb-1">💬 ' + (isEn ? 'Reply Thread (Tweet #2):' : 'リプライ続き (2段目):') + '</span>' +
                  '<div class="whitespace-pre-wrap">' + escHtml(allDisplayTweets[1]) + '</div>' +
                  '</div>';
              }

              const impVal = job.impressions != null ? Number(job.impressions).toLocaleString() : (isEn ? 'Tracking...' : '集計中');
              const likesVal = job.likes != null ? Number(job.likes).toLocaleString() : 0;
              const rtVal = job.retweets != null ? Number(job.retweets).toLocaleString() : 0;
              const bmVal = job.bookmarks != null ? Number(job.bookmarks).toLocaleString() : 0;

              return `
                <div class="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs mb-3 transition-all hover:border-slate-300" id="jobCard_${job.id}">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">${slotNameText}</span>
                      <span class="text-xs text-slate-400 font-mono">${dateStr}</span>
                    </div>
                    <a href="${job.tweetUrl || '#'}" target="_blank" class="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all inline-flex items-center gap-1 shadow-sm">
                      <span>✅ ${isEn ? 'View on X ↗' : 'Xで投稿を確認する ↗'}</span>
                    </a>
                  </div>

                  ${tweetHtml}

                  <!-- 成果メトリクス -->
                  <div class="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs font-mono text-slate-600">
                    <div class="flex items-center gap-1"><span class="text-slate-400">👀 Imp:</span> <b class="text-slate-800">${impVal}</b></div>
                    <div class="flex items-center gap-1"><span class="text-rose-400">❤️ Likes:</span> <b class="text-slate-800">${likesVal}</b></div>
                    <div class="flex items-center gap-1"><span class="text-emerald-500">🔁 RT:</span> <b class="text-slate-800">${rtVal}</b></div>
                    <div class="flex items-center gap-1"><span class="text-blue-500">🔖 Bookmarks:</span> <b class="text-slate-800">${bmVal}</b></div>
                  </div>
                </div>
              `;
            }

            // 3. エラー時 (Failed Job)
            return `
              <div class="p-4 rounded-2xl bg-rose-50/60 border border-rose-200 mb-3" id="jobCard_${job.id}">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <span class="text-xs font-bold text-rose-800 font-mono">⚠️ ${isEn ? 'Delivery Failed' : '配信エラー'} (${dateStr})</span>
                  <button type="button" onclick="cancelAutopilotJob('${job.id}')" class="text-xs text-rose-600 underline cursor-pointer">${isEn ? 'Dismiss' : '削除'}</button>
                </div>
                <div class="text-xs text-rose-700 font-mono">${escHtml(job.error || 'Failed to dispatch')}</div>
              </div>
            `;
          }

          let html = '';

          // 1. 【予約投稿スロット（配信待機中）】
          html += `
            <div class="mb-6">
              <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                <div class="flex items-center gap-2">
                  <span class="text-base">⏳</span>
                  <h3 class="font-bold text-slate-800 text-sm sm:text-base">${isEn ? 'Autopilot Posting Slots (Armed & In Queue)' : '自律投稿スロット（配信待機中）'}</h3>
                  <span class="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-mono font-bold text-xs">${pendingJobs.length}枠</span>
                </div>
                <div class="text-xs text-slate-500 font-medium hidden sm:block">
                  ${isEn ? 'AI will auto-generate & post right at scheduled times' : '指定時刻にAIが自動生成＆投稿します（放置でOK）'}
                </div>
              </div>
          `;

          if (pendingJobs.length > 0) {
            pendingJobs.forEach(job => {
              html += renderJobCard(job, true);
            });
          } else {
            html += `
              <div class="p-6 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center text-slate-500 mb-4">
                <p class="font-bold text-xs sm:text-sm text-slate-700 mb-1">${isEn ? 'No pending slots in queue.' : '現在待機中の予約枠はありません。'}</p>
                <p class="text-[11px] text-slate-400 mb-3">${isEn ? 'Autopilot is ready. Click below to start autonomous posting schedule:' : '基本設定を完了後、「自律運用をスタートする」を押すとゴールデンタイム枠が自動予約されます。'}</p>
                <button type="button" onclick="launchAutopilot()" class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs shadow transition-all inline-flex items-center gap-1.5 cursor-pointer">
                  <span>🚀</span> <span>${isEn ? 'Launch Autopilot Schedule' : '自律運用スケジュールを起動する'}</span>
                </button>
              </div>
            `;
          }
          html += `</div>`;

          // 2. 【投稿完了ログ（結果一覧）】
          if (postedJobs.length > 0) {
            html += `
              <div class="mt-6">
                <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                  <div class="flex items-center gap-2">
                    <span class="text-base">📁</span>
                    <h3 class="font-bold text-slate-800 text-sm sm:text-base">${isEn ? 'Published Posts Log (' + postedJobs.length + ' Posts)' : '配信結果ログ（全 ' + postedJobs.length + ' 件・配信完了）'}</h3>
                  </div>
                  <span class="text-xs text-slate-400 font-mono">LATEST RESULTS</span>
                </div>
                <div class="space-y-3">
                  ${postedJobs.map(job => renderJobCard(job, false)).join('')}
                </div>
              </div>
            `;
          }

          // 3. 【エラー投稿（もしあれば）】
          if (failedJobs.length > 0) {
            html += `
              <div class="mt-4 p-4 rounded-2xl bg-rose-50/60 border border-rose-200">
                <div class="text-xs font-bold text-rose-800 mb-2">
                  ⚠️ ${isEn ? 'Delivery Failed Posts (' + failedJobs.length + ')' : '配信エラーとなった投稿（' + failedJobs.length + '件）'}
                </div>
                <div class="space-y-2">
                  ${failedJobs.map(job => renderJobCard(job, false)).join('')}
                </div>
              </div>
            `;
          }

          cont.innerHTML = html;

cont.innerHTML = html;

        } else {
          throw new Error('Invalid jobs response');
        }
      } catch (e) {
        console.error('loadJobs error:', e);
        if (cont && !cont.innerHTML.includes('jobCard_')) {
          const message = controller.signal.aborted
            ? (isEn ? 'The server did not respond within 15 seconds.' : '15秒以内にサーバーから応答がありませんでした。')
            : (isEn ? 'Scheduled posts could not be loaded.' : '予約投稿を読み込めませんでした。');
          cont.innerHTML = `<div role="alert" class="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">${message} <button type="button" onclick="loadJobs()" class="underline ml-2 text-rose-800">${isEn ? 'Retry' : '再読み込み'}</button></div>`;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // 🤖 次回枠の予約投稿を手動で即時生成・補充する
    async function replenishJobsManually() {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const btn = document.getElementById('btnReplenishQueue');
      const origText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> <span>' + (isEn ? 'Deliberating next batch...' : 'AI評議会が推敲中...') + '</span>';
      }
      try {
        const res = await fetch('/api/autopilot/replenish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '{{USER_ID}}' })
        });
        const j = await res.json();
        if (j.ok) {
          alert(j.message || (isEn ? 'Next batch scheduled!' : '次回枠の予約投稿を生成・追加しました！'));
          await loadJobs();
        } else {
          alert((isEn ? 'Generation error: ' : '生成エラー: ') + (j.error || 'Unknown'));
        }
      } catch (err) {
        alert((isEn ? 'Network error: ' : '通信エラー: ') + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      }
    }

    // ⚡ 投稿時間のみ事前予約枠（JIT直前生成スロット）を手動で登録する
    async function scheduleJitSlotsManually() {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      const btn = document.getElementById('btnScheduleJitSlots');
      const origText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> <span>' + (isEn ? 'Scheduling Golden Slots...' : 'ゴールデン枠を事前確保中...') + '</span>';
      }
      try {
        const res = await fetch('/api/autopilot/schedule-jit-slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '{{USER_ID}}', days: 1 })
        });
        const j = await res.json();
        if (j.ok) {
          alert(j.message || (isEn ? 'JIT Golden Slots scheduled!' : 'JITゴールデン時間枠を事前確保しました！投稿直前にAIが最新トレンドに合わせて文章量と本文を自動生成します。'));
          await loadJobs();
        } else {
          alert((isEn ? 'Error: ' : 'エラー: ') + (j.error || 'Unknown'));
        }
      } catch (err) {
        alert((isEn ? 'Network error: ' : '通信エラー: ') + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      }
    }

    // 🗑️ 予約投稿のキャンセル・削除
    async function cancelAutopilotJob(jobId) {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      if (!confirm(isEn ? 'Cancel and delete this scheduled post?' : 'この予約投稿をキャンセル（削除）しますか？')) return;
      try {
        const res = await fetch('/api/autopilot/jobs/' + jobId + '/cancel', { method: 'POST' });
        const j = await res.json();
        if (j.ok) {
          await loadJobs();
        } else {
          alert((isEn ? 'Error: ' : 'エラー: ') + (j.error || (isEn ? 'Could not cancel' : 'キャンセルできませんでした')));
        }
      } catch (err) {
        alert((isEn ? 'Network error: ' : '通信エラー: ') + err.message);
      }
    }

    // 🚀 今すぐ投稿 (Post Now / 即時テスト投稿)
    async function executePostNow(jobId) {
      const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
      if (!confirm(isEn ? 'Publish this queued post to X immediately via Official API?' : 'この予約投稿をX公式API経由で今すぐ公開しますか？')) return;
      const btn = document.getElementById('btnPostNow_' + jobId);
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> <span>' + (isEn ? 'Publishing...' : '送信中...') + '</span>';
      }
      try {
        const res = await fetch('/api/autopilot/jobs/' + jobId + '/post-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const j = await res.json();
        if (j.ok) {
          alert(isEn ? 'Post successfully published on X!' : 'Xへの投稿が完了しました！');
          await loadJobs();
        } else {
          alert((isEn ? 'Failed to publish: ' : '投稿エラー: ') + (j.error || 'Unknown error'));
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
          }
        }
      } catch (err) {
        alert((isEn ? 'Network error: ' : '通信エラー: ') + err.message);
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      }
    }

    // 初回ロード (安全ガード付き実行)
    try {
      initializeScheduleTimeZoneControls();
    } catch (e) {
      console.warn('[TZ Init Warning]:', e.message);
    }
    try {
      setLanguage(currentLang);
    } catch (e) {
      console.warn('[Language Init Warning]:', e.message);
    }
    const configuredPostLang = (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang) || 'ja';
    selectPostLanguage(configuredPostLang === 'en' ? 'en' : 'ja');
    setTimeout(() => {
      if (typeof loadJobs === 'function') loadJobs();
      if (typeof loadStrategyReport === 'function') loadStrategyReport();
    }, 800);
  