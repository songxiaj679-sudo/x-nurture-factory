import re

with open('views/dashboard_view.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Extract the Account Diagnose Card (Card 0)
audit_start = content.find('<!-- 0. 【新機能】現状アカウント診断 ＆ 7名AI合議制スコアリング（過去1ヶ月分析） -->')
if audit_start == -1:
    print('ERROR: Card 0 not found')
    exit(1)

# Find the start of secStep1
step1_start = content.find('<!-- 1. 本アカウント 公式APIキーの接続 -->', audit_start)
if step1_start == -1:
    step1_start = content.find('<!-- 1. X(Twitter)公式アカウントの連携 -->', audit_start)
if step1_start == -1:
    step1_start = content.find('<div class="cockpit-card" id="secStep1">', audit_start)

card0_html = content[audit_start:step1_start].strip()

# 2. Extract Steps 1 to 4 and replace them with the simplified, elegant, whitespace-rich versions
# Find end of secStep4 (which ends right before secStrategyReport)
strat_start = content.find('<div class="cockpit-card" id="secStrategyReport"')
if strat_start == -1:
    print('ERROR: secStrategyReport not found')
    exit(1)

# The new Steps 1 to 4 HTML:
new_steps_html = """
    <!-- 1. X(Twitter)公式アカウントの連携 -->
    <div class="cockpit-card" id="secStep1">
      <div class="card-header justify-between flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <div class="card-num">1</div>
          <div>
            <div class="card-title">X(Twitter)公式アカウントを連携</div>
            <div class="text-xs text-slate-500 mt-0.5">X公式API v2準拠・パスワード入力不要・いつでも1クリックで解除可能です。</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          {{API_STATUS_BADGE}}
        </div>
      </div>

      {{API_CONNECTED_NOTICE}}

      <div id="apiKeyFormDrawer" {{API_DRAWER_STYLE}} class="space-y-4 mt-4">
        <!-- 🚀 1クリック X公式連携カード（VELOXにお任せ） -->
        <div class="p-6 sm:p-8 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xl border border-indigo-500/30 flex flex-col md:flex-row items-center justify-between gap-6">
          <div class="flex items-start gap-4">
            <div class="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl shrink-0 shadow-inner">
              <svg class="w-7 h-7 fill-white" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono font-bold border border-blue-400/30">1-CLICK CONNECT</span>
                <span class="text-xs text-emerald-400 font-bold">● X公式API v2連携（安全認証）</span>
              </div>
              <h2 class="text-base sm:text-lg font-black text-white mt-1.5">面倒なSNS運用は、すべてVELOXにお任せください。</h2>
              <p class="text-xs sm:text-sm text-slate-300 mt-1 leading-relaxed max-w-xl">
                「何を投稿すればいいかわからない…」「毎日運用する時間がない…」そんな悩みは今日で終わりです。<br>
                ボタンを押してX公式の許可画面で連携するだけ。今日からあなた専属のAI運用チームが全自動で稼働します。
              </p>
            </div>
          </div>
          <div class="w-full md:w-auto shrink-0 flex flex-col items-center gap-2">
            <a href="/api/auth/twitter" class="w-full md:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-black text-sm sm:text-base text-center shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap">
              <span>🚀</span>
              <span>Xと1クリック連携する（VELOXにおまかせ） ↗</span>
            </a>
            <span class="text-[11px] text-slate-400">※アカウント凍結リスクゼロ・いつでも解除可能</span>
          </div>
        </div>

        <!-- 開発者用キー直接入力（通常は完全に非表示・折りたたみ） -->
        <details class="text-[11px] text-slate-400 mt-2">
          <summary class="cursor-pointer text-slate-400 hover:text-slate-600 py-1">⚙️ 開発者・上級者向け: APIキー直接設定（通常は1クリック連携だけでOK）</summary>
          <div class="mt-3 p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">API Key</label>
                <input type="text" id="inpApiKey" value="{{MASKED_API_KEY}}" placeholder="API Key" class="inp-light text-xs font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">API Secret</label>
                <input type="password" id="inpApiSecret" value="{{MASKED_API_SECRET}}" placeholder="API Secret" class="inp-light text-xs font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">Access Token</label>
                <input type="text" id="inpAccessToken" value="{{MASKED_ACCESS_TOKEN}}" placeholder="Access Token" class="inp-light text-xs font-mono">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-1">Access Token Secret</label>
                <input type="password" id="inpAccessTokenSecret" value="{{MASKED_ACCESS_TOKEN_SECRET}}" placeholder="Access Token Secret" class="inp-light text-xs font-mono">
              </div>
            </div>
            <div class="flex justify-end pt-1">
              <button type="button" onclick="verifyAndSaveKeys()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer">
                <span data-i18n="btn_verify_keys">⚡ APIキーを保存</span>
              </button>
            </div>
            <div id="keyMsg" class="text-xs font-bold" style="display:none;"></div>
          </div>
        </details>
      </div>
    </div>

    <!-- 2. 配信時間枠（朝・昼・夜）＆ タイムゾーン -->
    <div class="cockpit-card" id="secStep2">
      <div class="card-header justify-between flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <div class="card-num">2</div>
          <div>
            <div class="card-title">配信時間枠（朝・昼・夜）＆ タイムゾーン</div>
            <div class="text-xs text-slate-500 mt-0.5">読者が一番スマホを見る「朝・昼・夜」にAIが自動配信します。あなたが時間を気にする必要はありません。</div>
          </div>
        </div>
      </div>

      <div class="space-y-4 mt-4">
        <!-- タイムゾーン設定 -->
        <div class="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <label for="workspaceScheduleTimeZone" class="block text-xs font-bold text-slate-700 mb-1.5">
            予約タイムゾーン / Schedule Timezone
          </label>
          <div class="flex flex-col sm:flex-row gap-2">
            <select id="workspaceScheduleTimeZone" data-saved-time-zone="{{SCHEDULE_TIME_ZONE}}" class="inp-light"></select>
            <button type="button" onclick="saveWorkspaceScheduleTimeZone()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold shrink-0 cursor-pointer">
              保存
            </button>
          </div>
          <div id="scheduleTimeZoneMsg" class="text-xs font-bold mt-2" style="display:none;"></div>
        </div>

        <!-- 投稿言語設定 -->
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
            <span data-i18n="lbl_post_lang">投稿・生成言語</span>
            <span class="text-[11px] text-blue-600 font-bold font-mono">BILINGUAL</span>
          </label>
          <div class="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button type="button" id="btnPostLangJa" onclick="selectPostLanguage('ja')" class="py-2.5 rounded-lg text-xs font-bold transition-all bg-white text-blue-700 shadow-sm border border-slate-200 flex items-center justify-center gap-2 cursor-pointer">
              <span>🇯🇵</span>
              <span data-i18n="opt_post_lang_ja">日本語 (Japanese)</span>
            </button>
            <button type="button" id="btnPostLangEn" onclick="selectPostLanguage('en')" class="py-2.5 rounded-lg text-xs font-bold transition-all text-slate-500 hover:text-slate-800 flex items-center justify-center gap-2 cursor-pointer">
              <span>🇺🇸</span>
              <span data-i18n="opt_post_lang_en">English (Global)</span>
            </button>
          </div>
          <input type="hidden" id="inpPostLang" value="{{CONFIGURED_AI_LANG}}">
        </div>

        <!-- ゴールデンタイム自動配分案内 -->
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
        </div>

        <div style="display:none;">
          <select id="campaignScheduleTimeZone" class="inp-light"></select>
        </div>
      </div>
    </div>

    <!-- 3. 宣伝したいWebサイト / サービスのURL（複数可） -->
    <div class="cockpit-card" id="secStep3">
      <div class="card-header justify-between flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <div class="card-num">3</div>
          <div>
            <div class="card-title">宣伝したいWebサイト / サービスのURL（複数可）</div>
            <div class="text-xs text-slate-500 mt-0.5">サイトやLPのURLを入力するだけ。高度なアルゴリズムが内容を自動解析し、読者に刺さる投稿を自動で組み立てます。</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          {{TARGET_STATUS_BADGE}}
        </div>
      </div>

      {{TARGET_CONFIGURED_NOTICE}}

      <div id="targetFormDrawer" {{TARGET_DRAWER_STYLE}} class="space-y-4 mt-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
            <span><span data-i18n="lbl_target_url">宣伝・広報対象のWebサイト / LPのURL</span> <span class="text-rose-500">*</span></span>
            <span class="text-[11px] text-blue-600 font-bold font-mono">複数URL対応</span>
          </label>
          <textarea id="inpTargetUrl" rows="2" placeholder="https://your-service.com/product&#10;https://your-service.com/lp (複数ある場合は改行して入力)" class="inp-light text-xs font-mono mb-1 leading-relaxed">{{CONFIGURED_TARGET_URL}}</textarea>
          <div class="text-[11px] text-slate-500 mt-1">
            💡 メインサイト、商品ページ、LP、noteなど、複数ある場合は改行してご入力いただけます。AIがすべて読み込んで総合分析します。
          </div>
        </div>

        <div class="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 text-xs text-blue-900 flex items-center gap-2.5">
          <span class="text-base shrink-0">✨</span>
          <span><b>URLを入力するだけで完了です。</b> 7名のAI評議会がページ内容を自動解析し、最も反響の出やすいフック・共感切り口を自律決定します。</span>
        </div>

        <!-- ✨ Phase 1: 保有効果・瞬速Aha! プレビュー生成ボックス (X連携前でもURLから5秒で3本生成) -->
        <div class="mt-4 p-5 rounded-2xl bg-gradient-to-br from-blue-50/70 via-indigo-50/40 to-slate-50 border border-blue-200 shadow-xs">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-base">✨</span>
                <span class="text-xs sm:text-sm font-black text-slate-900" data-i18n="preview_box_title">保有効果・瞬速Aha! プレビュー生成（X連携前にお試し）</span>
                <span class="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-mono font-bold">5s AHA!</span>
              </div>
              <div class="text-xs text-slate-500 mt-1" data-i18n="preview_box_sub">
                URLを入力してボタンを押すだけ。AI合議制が「朝・昼・夜」の最適化ポスト3本をわずか5〜8秒で無料プレビュー生成します。
              </div>
            </div>
            <button type="button" onclick="generateInstantPreview()" id="btnInstantPreview" class="w-full sm:w-auto px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs sm:text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer">
              <span>⚡</span>
              <span data-i18n="btn_instant_preview">今すぐ3本のポスト案を生成 →</span>
            </button>
          </div>

          <!-- ローディング表示 -->
          <div id="previewProgressBox" style="display:none;" class="mt-4 p-4 rounded-xl bg-white border border-blue-200">
            <div class="flex items-center gap-3">
              <div class="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></div>
              <span class="text-xs font-bold text-blue-900" id="previewProgressTitle">7名の専門AI評議会がURLの強みを抽出・朝昼夜の3本を多角起草中...</span>
            </div>
          </div>

          <!-- プレビュー結果カード一覧 -->
          <div id="previewContainer" style="display:none;" class="mt-4 space-y-4"></div>
        </div>

        <!-- ⚙️ プロンプト入力は上級者向けとして下部に折りたたみ退避 -->
        <details class="mt-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
          <summary class="text-xs font-bold text-slate-600 cursor-pointer hover:text-indigo-600 flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <span>⚙️</span>
              <span data-i18n="lbl_user_prompt">高度な設定：AIへの外せない指示・プロンプト（上級者向け・任意）</span>
            </span>
            <span class="text-[11px] font-mono text-slate-400">▼ 通常は空欄のままでOK</span>
          </summary>
          <div class="mt-3 space-y-2">
            <p class="text-[11px] text-slate-500">※通常は空欄のままで問題ありません。AIがURLから最適な戦略を全自動で立案します。「特定ターゲットに絞りたい」「特定の語り口を指定したい」場合のみご入力ください。</p>
            <textarea id="inpUserPrompt" rows="2" placeholder="例：ターゲットは中小企業の経営者。今月は無料相談を実施中。押し売り感のない誠実なトーンで。" class="inp-light text-xs leading-relaxed" data-i18n-ph="ph_user_prompt">{{CONFIGURED_USER_PROMPT}}</textarea>
            
            <!-- クイックプリセットバッジ -->
            <div class="flex flex-wrap items-center gap-1.5 pt-1">
              <span class="text-[11px] text-slate-400" data-i18n="quick_input_label">クイック入力:</span>
              <button type="button" onclick="appendPrompt(currentLang === 'en' ? '【Target Audience】B2B enterprise executives & SME founders' : '【ターゲット】中小企業の経営者・個人事業主向け')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-[11px] font-bold transition-all cursor-pointer" data-i18n="quick_b2b">🎯 B2B経営者向け</button>
              <button type="button" onclick="appendPrompt(currentLang === 'en' ? '【Strategic Objective】Prioritize qualified lead & deal pipeline acquisition over vanity impressions' : '【重視する目的】単なる認知ではなく、商談・リード獲得を最優先')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-[11px] font-bold transition-all cursor-pointer" data-i18n="quick_deals">📈 商談獲得重視</button>
              <button type="button" onclick="appendPrompt(currentLang === 'en' ? '【Tone of Voice】Authoritative, objective, respectful enterprise tone without AI hype' : '【文体】煽り文句を排し、信頼できるプロの論理的・誠実なトーン')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-[11px] font-bold transition-all cursor-pointer" data-i18n="quick_tone">🛡️ 誠実プロトーン</button>
              <button type="button" onclick="appendPrompt(currentLang === 'en' ? '【Value Angle】Overcome manual operation bottlenecks and reclaim valuable strategic time' : '【訴求軸】手作業運用の限界と、自律化による業務時間の解放')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-[11px] font-bold transition-all cursor-pointer" data-i18n="quick_overhead">⏳ 業務工数削減</button>
            </div>
          </div>
        </details>
      </div>
    </div>

    <!-- 4. 自律運用の開始（完全おまかせ稼働） -->
    <div class="cockpit-card" id="secStep4">
      <div class="card-header justify-between flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <div class="card-num bg-emerald-600 text-white">4</div>
          <div>
            <div class="card-title">自律運用の開始（完全おまかせ稼働）</div>
            <div class="text-xs text-slate-500 mt-0.5">初期設定が完了したら、下のボタンを押すだけで完全おまかせ運用がスタートします。</div>
          </div>
        </div>
      </div>

      <div class="mt-4 space-y-4">
        <button type="button" onclick="launchAutopilot()" id="btnLaunchAutopilot" class="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-600 text-white font-black text-base shadow-xl shadow-emerald-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer">
          <span>🚀</span>
          <span data-i18n="btn_launch_autopilot">自律運用をスタートする（完全おまかせで自動投稿）</span>
        </button>

        <div class="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2.5">
          <span class="text-base shrink-0">🛡️</span>
          <div>
            <div class="font-bold">たったこれだけで設定完了。あとはもう任せっきりでOK</div>
            <div class="text-[11px] text-emerald-800 mt-0.5 leading-relaxed">
              一度スタートボタンを押せば、毎日決まった時間枠（朝・昼・夜）に合わせて、VELOX AIが最新トレンドを自動で取り込んで文章を生成・発射します。確認ややり直し作業、毎日のログインは一切不要です。
            </div>
          </div>
        </div>
        <div id="launchMsg" class="mt-3 text-xs font-bold p-3 rounded-xl" style="display:none;"></div>
      </div>
    </div>
"""

# Replace the top region (from audit_start to strat_start) with new_steps_html
content_without_top_card0 = content[:audit_start] + new_steps_html + '\n' + content[strat_start:]

# 3. Now insert Card 0 (Account Diagnose) right below secJobs (which is above secSyndicate)
jobs_end_marker = '      <div id="jobsContainer">'
# Find the closing tag of secJobs
jobs_div_start = content_without_top_card0.find('<div class="cockpit-card" id="secJobs">')
if jobs_div_start == -1:
    print('ERROR: secJobs not found')
    exit(1)

# Find the end of this cockpit card (it is closed before the syndicate card)
syndicate_marker = '<!-- 5. シンジケート・エンゲージメント加速プロトコル -->'
synd_start = content_without_top_card0.find(syndicate_marker)
if synd_start == -1:
    print('ERROR: syndicate marker not found')
    exit(1)

# Insert card0_html right before synd_start
card0_polished = card0_html.replace('<!-- 0. 【新機能】現状アカウント診断', '<!-- 📊 現状アカウント診断')

final_content = (
    content_without_top_card0[:synd_start] +
    card0_polished + '\n\n    ' +
    content_without_top_card0[synd_start:]
)

with open('views/dashboard_view.html', 'w', encoding='utf-8') as f:
    f.write(final_content)

print('SUCCESS: dashboard_view.html reordered and polished!')
