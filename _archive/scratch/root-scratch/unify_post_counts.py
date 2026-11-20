import re

# ==============================================================================
# 1. Update views/funnel_index.html
# ==============================================================================
with open('views/funnel_index.html', 'r', encoding='utf-8') as f:
    fi_content = f.read()

# Replace static card 1 features
old_p1_feats = """              <ul class="p-feats">
                <li data-i18n="plan1_feat1"><span class="chk-svg">✓</span> <strong>運用レーン 1</strong> (同時運用数)</li>
                <li data-i18n="plan1_feat2"><span class="chk-svg">✓</span> <strong>接続アカウント枠 5</strong></li>
                <li data-i18n="plan1_feat3"><span class="chk-svg">✓</span> X公式API連携</li>
                <li data-i18n="plan1_feat4"><span class="chk-svg">✓</span> 🧠 <strong>AI評議会</strong>による投稿案作成支援</li>
              </ul>"""

new_p1_feats = """              <ul class="p-feats">
                <li data-i18n="plan1_feat1"><span class="chk-svg">✓</span> <strong>1日1投稿</strong> (月30本の自動最適化配信)</li>
                <li data-i18n="plan1_feat2"><span class="chk-svg">✓</span> <strong>運用レーン 1</strong> (接続アカウント枠 5)</li>
                <li data-i18n="plan1_feat3"><span class="chk-svg">✓</span> X公式API連携</li>
                <li data-i18n="plan1_feat4"><span class="chk-svg">✓</span> 🧠 <strong>AI評議会</strong>による投稿案作成支援</li>
              </ul>"""

# Replace static card 2 features
old_p2_feats = """              <ul class="p-feats">
                <li data-i18n="plan2_feat1"><span class="chk-svg">✓</span> <strong>運用レーン 3</strong> (同時運用数)</li>
                <li data-i18n="plan2_feat2"><span class="chk-svg">✓</span> <strong>接続アカウント枠 12</strong></li>
                <li data-i18n="plan2_feat3"><span class="chk-svg">✓</span> 🧠 <strong>AI評議会</strong>による投稿案の作成・見直し</li>
                <li data-i18n="plan2_feat4"><span class="chk-svg">✓</span> 投稿スケジュール管理</li>
              </ul>"""

new_p2_feats = """              <ul class="p-feats">
                <li data-i18n="plan2_feat1"><span class="chk-svg">✓</span> <strong>1日3投稿</strong> (朝・昼・夜ゴールデンタイム / 月90本)</li>
                <li data-i18n="plan2_feat2"><span class="chk-svg">✓</span> <strong>運用レーン 3</strong> (接続アカウント枠 12)</li>
                <li data-i18n="plan2_feat3"><span class="chk-svg">✓</span> 🧠 <strong>AI評議会</strong>による投稿案の作成・見直し</li>
                <li data-i18n="plan2_feat4"><span class="chk-svg">✓</span> 投稿スケジュール管理</li>
              </ul>"""

# Replace static card 3 features
old_p3_feats = """              <ul class="p-feats">
                <li data-i18n="plan3_feat1"><span class="chk-svg">✓</span> <strong>運用レーン 5</strong> (同時運用数)</li>
                <li data-i18n="plan3_feat2"><span class="chk-svg">✓</span> <strong>接続アカウント枠 25</strong></li>
                <li data-i18n="plan3_feat3"><span class="chk-svg">✓</span> 🧠 <strong>キーワード対応AI返信機能</strong></li>
                <li data-i18n="plan3_feat4"><span class="chk-svg">✓</span> 投稿スケジュール管理</li>
              </ul>"""

new_p3_feats = """              <ul class="p-feats">
                <li data-i18n="plan3_feat1"><span class="chk-svg">✓</span> <strong>1日5投稿</strong> (朝昼夕夜深夜フルオート / 月150本)</li>
                <li data-i18n="plan3_feat2"><span class="chk-svg">✓</span> <strong>運用レーン 5</strong> (接続アカウント枠 25)</li>
                <li data-i18n="plan3_feat3"><span class="chk-svg">✓</span> 🧠 <strong>キーワード対応AI返信機能</strong></li>
                <li data-i18n="plan3_feat4"><span class="chk-svg">✓</span> 投稿スケジュール管理</li>
              </ul>"""

fi_content = fi_content.replace(old_p1_feats, new_p1_feats)
fi_content = fi_content.replace(old_p2_feats, new_p2_feats)
fi_content = fi_content.replace(old_p3_feats, new_p3_feats)

# Replace modal features in HTML
old_modal_starter = '<li data-i18n="modal_starter_features"><span class="chk-svg">✓</span> 運用レーン 1<br><span class="chk-svg">✓</span> 接続アカウント枠 5</li>'
new_modal_starter = '<li data-i18n="modal_starter_features"><span class="chk-svg">✓</span> 1日1投稿 (月30本)<br><span class="chk-svg">✓</span> 運用レーン 1 / 接続枠 5</li>'

old_modal_pro = '<li data-i18n="modal_pro_features"><span class="chk-svg">✓</span> 運用レーン 3<br><span class="chk-svg">✓</span> 接続アカウント枠 12</li>'
new_modal_pro = '<li data-i18n="modal_pro_features"><span class="chk-svg">✓</span> 1日3投稿 (朝昼夜 / 月90本)<br><span class="chk-svg">✓</span> 運用レーン 3 / 接続枠 12</li>'

old_modal_business = '<li data-i18n="modal_business_features"><span class="chk-svg">✓</span> 運用レーン 5<br><span class="chk-svg">✓</span> 接続アカウント枠 25・AI返信機能</li>'
new_modal_business = '<li data-i18n="modal_business_features"><span class="chk-svg">✓</span> 1日5投稿 (朝昼夕夜深夜 / 月150本)<br><span class="chk-svg">✓</span> 運用レーン 5 / 接続枠 25・AI返信営業</li>'

fi_content = fi_content.replace(old_modal_starter, new_modal_starter)
fi_content = fi_content.replace(old_modal_pro, new_modal_pro)
fi_content = fi_content.replace(old_modal_business, new_modal_business)

# Update I18N_LANDING.ja
old_ja_checkout = """        checkout_starter_features: "運用レーン 1<br>接続アカウント枠 5",
        checkout_pro_features: "運用レーン 3<br>接続アカウント枠 12",
        checkout_business_features: "運用レーン 5<br>接続アカウント枠 25・AI返信機能","""

new_ja_checkout = """        checkout_starter_features: "1日1投稿 (月30本)<br>運用レーン 1 / 接続枠 5",
        checkout_pro_features: "1日3投稿 (朝昼夜 / 月90本)<br>運用レーン 3 / 接続枠 12",
        checkout_business_features: "1日5投稿 (朝昼夕夜深夜 / 月150本)<br>運用レーン 5 / 接続枠 25・AI返信営業","""

old_ja_modal = """        modal_starter_features: "✓ 運用レーン 1<br>✓ 接続アカウント枠 5",
        modal_pro_features: "✓ 運用レーン 3<br>✓ 接続アカウント枠 12",
        modal_business_features: "✓ 運用レーン 5<br>✓ 接続アカウント枠 25・AI返信機能","""

new_ja_modal = """        modal_starter_features: "✓ 1日1投稿 (月30本の自動最適化配信)<br>✓ 運用レーン 1 / 接続アカウント枠 5",
        modal_pro_features: "✓ 1日3投稿 (朝・昼・夜ゴールデンタイム / 月90本)<br>✓ 運用レーン 3 / 接続アカウント枠 12",
        modal_business_features: "✓ 1日5投稿 (朝昼夕夜深夜フルオート / 月150本)<br>✓ 運用レーン 5 / 接続アカウント枠 25・AI返信営業","""

old_ja_planfeats = """        plan1_feat1: "✓ <strong>運用レーン 1</strong> (同時運用数)",
        plan1_feat2: "✓ <strong>接続アカウント枠 5</strong>",
        plan1_feat3: "✓ X公式API連携",
        plan1_feat4: "✓ 🧠 <strong>AI評議会</strong>による投稿案作成支援",
        plan1_btn: "Solo Starter を選択 →",
        plan2_badge: "チーム向け",
        plan2_tier: "🏢 BUSINESS PRO",
        plan2_price: "¥9,800 <span>/ 月（税込・$79）</span>",
        plan2_desc: "複数の投稿テーマやアカウントを運用する個人・チーム向けのプランです。",
        plan2_feat1: "✓ <strong>運用レーン 3</strong> (同時運用数)",
        plan2_feat2: "✓ <strong>接続アカウント枠 12</strong>",
        plan2_feat3: "✓ 🧠 <strong>AI評議会</strong>による投稿案の作成・見直し",
        plan2_feat4: "✓ 投稿スケジュール管理",
        plan2_btn: "Agency Pro を選択 →",
        plan3_badge: "👑 ENTERPRISE SCALE",
        plan3_tier: "🌐 SYNDICATE",
        plan3_price: "¥19,800 <span>/ 月（税込・$179）</span>",
        plan3_desc: "複数アカウントや投稿テーマを運用するチーム向けのプランです。",
        plan3_feat1: "✓ <strong>運用レーン 5</strong> (同時運用数)",
        plan3_feat2: "✓ <strong>接続アカウント枠 25</strong>",
        plan3_feat3: "✓ 🧠 <strong>キーワード対応AI返信機能</strong>",
        plan3_feat4: "✓ 投稿スケジュール管理","""

new_ja_planfeats = """        plan1_feat1: "✓ <strong>1日1投稿</strong> (月30本の自動最適化配信)",
        plan1_feat2: "✓ <strong>運用レーン 1</strong> (接続アカウント枠 5)",
        plan1_feat3: "✓ X公式API連携",
        plan1_feat4: "✓ 🧠 <strong>AI評議会</strong>による投稿案作成支援",
        plan1_btn: "Solo Starter を選択 →",
        plan2_badge: "チーム向け",
        plan2_tier: "🏢 BUSINESS PRO",
        plan2_price: "¥9,800 <span>/ 月（税込・$79）</span>",
        plan2_desc: "複数の投稿テーマやアカウントを運用する個人・チーム向けのプランです。",
        plan2_feat1: "✓ <strong>1日3投稿</strong> (朝・昼・夜ゴールデンタイム / 月90本)",
        plan2_feat2: "✓ <strong>運用レーン 3</strong> (接続アカウント枠 12)",
        plan2_feat3: "✓ 🧠 <strong>AI評議会</strong>による投稿案の作成・見直し",
        plan2_feat4: "✓ 投稿スケジュール管理",
        plan2_btn: "Agency Pro を選択 →",
        plan3_badge: "👑 ENTERPRISE SCALE",
        plan3_tier: "🌐 SYNDICATE",
        plan3_price: "¥19,800 <span>/ 月（税込・$179）</span>",
        plan3_desc: "複数アカウントや投稿テーマを運用するチーム向けのプランです。",
        plan3_feat1: "✓ <strong>1日5投稿</strong> (朝昼夕夜深夜フルオート / 月150本)",
        plan3_feat2: "✓ <strong>運用レーン 5</strong> (接続アカウント枠 25)",
        plan3_feat3: "✓ 🧠 <strong>キーワード対応AI返信機能</strong>",
        plan3_feat4: "✓ 投稿スケジュール管理","""

fi_content = fi_content.replace(old_ja_checkout, new_ja_checkout)
fi_content = fi_content.replace(old_ja_modal, new_ja_modal)
fi_content = fi_content.replace(old_ja_planfeats, new_ja_planfeats)

# Update I18N_LANDING.en
old_en_checkout = """        checkout_starter_features: "1 workflow lane<br>5 connected-account slots",
        checkout_pro_features: "3 workflow lanes<br>12 connected-account slots",
        checkout_business_features: "5 workflow lanes<br>25 connected-account slots · AI reply feature","""

new_en_checkout = """        checkout_starter_features: "1 post/day (30 posts/mo)<br>1 workflow lane / 5 account slots",
        checkout_pro_features: "3 posts/day (90 posts/mo)<br>3 workflow lanes / 12 account slots",
        checkout_business_features: "5 posts/day (150 posts/mo)<br>5 workflow lanes / 25 account slots · AI reply","""

old_en_modal = """        modal_starter_features: "✓ 1 workflow lane<br>✓ 5 connected-account slots",
        modal_pro_features: "✓ 3 workflow lanes<br>✓ 12 connected-account slots",
        modal_business_features: "✓ 5 workflow lanes<br>✓ 25 connected-account slots · AI reply feature","""

new_en_modal = """        modal_starter_features: "✓ 1 post/day (30 posts/month autonomous scheduling)<br>✓ 1 workflow lane / 5 account slots",
        modal_pro_features: "✓ 3 posts/day (Morning, Noon, Night / 90 posts/mo)<br>✓ 3 workflow lanes / 12 account slots",
        modal_business_features: "✓ 5 posts/day (Full 24h Golden Hours / 150 posts/mo)<br>✓ 5 workflow lanes / 25 account slots & AI reply","""

old_en_planfeats = """        plan1_feat1: "✓ <strong>1 workflow lane</strong> (concurrent operations)",
        plan1_feat2: "✓ <strong>5 connected-account slots</strong>",
        plan1_feat3: "✓ Official X API connection",
        plan1_feat4: "✓ 🧠 <strong>AI council</strong> post-drafting support",
        plan1_btn: "Select Solo Starter →",
        plan2_badge: "For teams",
        plan2_tier: "🏢 BUSINESS PRO",
        plan2_price: "$79 <span>/ month (¥9,800)</span>",
        plan2_desc: "For individuals and teams managing multiple post themes or accounts.",
        plan2_feat1: "✓ <strong>3 workflow lanes</strong> (concurrent operations)",
        plan2_feat2: "✓ <strong>12 connected-account slots</strong>",
        plan2_feat3: "✓ 🧠 <strong>AI council</strong> drafting and review",
        plan2_feat4: "✓ Post scheduling tools",
        plan2_btn: "Select Agency Pro →",
        plan3_badge: "👑 ENTERPRISE SCALE",
        plan3_tier: "🌐 SYNDICATE",
        plan3_price: "$179 <span>/ month (¥19,800)</span>",
        plan3_desc: "For teams managing multiple accounts and post themes.",
        plan3_feat1: "✓ <strong>5 workflow lanes</strong> (concurrent operations)",
        plan3_feat2: "✓ <strong>25 connected-account slots</strong>",
        plan3_feat3: "✓ 🧠 <strong>Keyword-based AI reply feature</strong>",
        plan3_feat4: "✓ Post scheduling tools",
        plan3_btn: "Select Syndicate Business →","""

new_en_planfeats = """        plan1_feat1: "✓ <strong>1 post/day</strong> (30 posts/month autonomous scheduling)",
        plan1_feat2: "✓ <strong>1 workflow lane</strong> (5 connected-account slots)",
        plan1_feat3: "✓ Official X API connection",
        plan1_feat4: "✓ 🧠 <strong>AI council</strong> post-drafting support",
        plan1_btn: "Select Solo Starter →",
        plan2_badge: "For teams",
        plan2_tier: "🏢 BUSINESS PRO",
        plan2_price: "$79 <span>/ month (¥9,800)</span>",
        plan2_desc: "For individuals and teams managing multiple post themes or accounts.",
        plan2_feat1: "✓ <strong>3 posts/day</strong> (Morning, Noon, Night / 90 posts/month)",
        plan2_feat2: "✓ <strong>3 workflow lanes</strong> (12 connected-account slots)",
        plan2_feat3: "✓ 🧠 <strong>AI council</strong> drafting and review",
        plan2_feat4: "✓ Post scheduling tools",
        plan2_btn: "Select Agency Pro →",
        plan3_badge: "👑 ENTERPRISE SCALE",
        plan3_tier: "🌐 SYNDICATE",
        plan3_price: "$179 <span>/ month (¥19,800)</span>",
        plan3_desc: "For teams managing multiple accounts and post themes.",
        plan3_feat1: "✓ <strong>5 posts/day</strong> (Full 24h Golden Hours / 150 posts/month)",
        plan3_feat2: "✓ <strong>5 workflow lanes</strong> (25 connected-account slots & AI reply outreach)",
        plan3_feat3: "✓ 🧠 <strong>Keyword-based AI reply feature</strong>",
        plan3_feat4: "✓ Post scheduling tools",
        plan3_btn: "Select Syndicate Business →","""

fi_content = fi_content.replace(old_en_checkout, new_en_checkout)
fi_content = fi_content.replace(old_en_modal, new_en_modal)
fi_content = fi_content.replace(old_en_planfeats, new_en_planfeats)

with open('views/funnel_index.html', 'w', encoding='utf-8') as f:
    f.write(fi_content)

print("Updated views/funnel_index.html with unified 1/3/5 post frequencies")

# ==============================================================================
# 2. Update views/dashboard_view.html Step 2 Golden Time Banner
# ==============================================================================
with open('views/dashboard_view.html', 'r', encoding='utf-8') as f:
    dash_content = f.read()

old_dash_step2 = """        <!-- ゴールデンタイム自動配分案内 -->
        <div class="p-4 rounded-xl bg-blue-50/50 border border-blue-200">
          <div class="text-xs font-bold text-blue-900 mb-2 flex items-center gap-1.5">
            <span>⏰</span> <span>自動配分される1日のゴールデンタイム投稿枠</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800">🌅 朝枠 (08:30)</div>
              <div class="text-[11px] text-slate-500 mt-0.5">通勤・始業前の意思決定者向け</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800">☀️ 昼枠 (12:30)</div>
              <div class="text-[11px] text-slate-500 mt-0.5">ランチタイムのタイムライン巡回層</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800">🌙 夜枠 (20:00)</div>
              <div class="text-[11px] text-slate-500 mt-0.5">プライムタイムの長文読者・深掘り層</div>
            </div>
          </div>
          <div class="text-[11px] text-blue-700 mt-2 font-medium">
            ※たったこれだけで、あとはVELOX AIが投稿時間直前に最新トレンドを取り込んで自動作成・配信します。
          </div>
        </div>"""

new_dash_step2 = """        <!-- ゴールデンタイム自動配分案内 (1枠/3枠/最高峰5枠対応) -->
        <div class="p-4 rounded-xl bg-blue-50/50 border border-blue-200">
          <div class="text-xs font-bold text-blue-900 mb-2.5 flex items-center justify-between flex-wrap gap-2">
            <span class="flex items-center gap-1.5">
              <span>⏰</span> <span>自動配分される1日のゴールデンタイム投稿枠</span>
            </span>
            <span class="text-[11px] text-blue-700 font-mono font-bold">1日1枠 〜 最大5枠フルオート</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800 text-[11px]">🌅 朝枠 (08:30)</div>
              <div class="text-[10px] text-slate-500 mt-0.5">通勤・始業前</div>
              <div class="text-[10px] text-emerald-600 font-bold mt-1">全プラン共通</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800 text-[11px]">☀️ 昼枠 (12:30)</div>
              <div class="text-[10px] text-slate-500 mt-0.5">ランチ巡回層</div>
              <div class="text-[10px] text-blue-600 font-bold mt-1">プロ / ビジネス</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800 text-[11px]">☕ 夕方枠 (17:30)</div>
              <div class="text-[10px] text-slate-500 mt-0.5">退勤・帰宅ラッシュ</div>
              <div class="text-[10px] text-purple-600 font-bold mt-1">ビジネス限定</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800 text-[11px]">🌙 夜枠 (20:00)</div>
              <div class="text-[10px] text-slate-500 mt-0.5">プライム精読</div>
              <div class="text-[10px] text-blue-600 font-bold mt-1">プロ / ビジネス</div>
            </div>
            <div class="p-2.5 rounded-lg bg-white border border-blue-100">
              <div class="font-bold text-blue-800 text-[11px]">🦉 深夜枠 (22:30)</div>
              <div class="text-[10px] text-slate-500 mt-0.5">就寝前リラックス</div>
              <div class="text-[10px] text-purple-600 font-bold mt-1">ビジネス限定</div>
            </div>
          </div>
          <div class="text-[11px] text-blue-900 mt-2.5 font-medium leading-relaxed bg-white/70 p-2.5 rounded-lg border border-blue-100">
            💡 <b>ご契約プランに応じた自動配信枠：</b><br>
            ・<b>スターター</b>：1日1投稿 (月30本) ─ 朝枠<br>
            ・<b>プロ運用</b>：1日3投稿 (月90本) ─ 朝・昼・夜のゴールデンタイム網羅<br>
            ・<b>ビジネス（最高峰）</b>：<b>1日5投稿 (月150本・フルオート)</b> ─ 朝・昼・夕方・夜・深夜の24時間露出 ＋ AI返信営業
          </div>
        </div>"""

if old_dash_step2 in dash_content:
    dash_content = dash_content.replace(old_dash_step2, new_dash_step2)
    with open('views/dashboard_view.html', 'w', encoding='utf-8') as f:
        f.write(dash_content)
    print("Updated views/dashboard_view.html Step 2 banner")
else:
    print("Warning: old_dash_step2 not found in dashboard_view.html")

print("SUCCESS: Post count alignment completed!")
