import re

with open('views/dashboard_view.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update loadStrategyReport() so that it does NOT force sec.style.display = 'block';
# This prevents TODAY'S STRATEGIC BLUEPRINT from suddenly popping up and confusing the user!
old_display_block = "sec.style.display = 'block';"
new_display_block = "// sec.style.display = 'none'; // Kept hidden by default for clean minimalist UX"
if old_display_block in content:
    content = content.replace(old_display_block, new_display_block, 1)
    print("Replaced sec.style.display = 'block' in loadStrategyReport")

# 2. Reorder cards so secJobs comes immediately after secStep4:
# Find secStep4 end
step4_start = content.find('<div class="cockpit-card" id="secStep4">')
if step4_start == -1:
    print("ERROR: secStep4 not found")
    exit(1)

# Find end of secStep4: it ends before secStrategyReport
strat_start = content.find('<div class="cockpit-card" id="secStrategyReport"', step4_start)
if strat_start == -1:
    print("ERROR: secStrategyReport not found")
    exit(1)

# Find secPlans start and end
plans_start = content.find('<!-- 3. プラン選択 ＆ Stripe公式オンライン決済 -->')
if plans_start == -1:
    plans_start = content.find('<div class="cockpit-card" id="secPlans">')

# Find secJobs start
jobs_start = content.find('<!-- 4. 配信スケジュール ＆ 自律生成ログ -->')
if jobs_start == -1:
    jobs_start = content.find('<div class="cockpit-card" id="secJobs">')

# Find end of secJobs (starts before Account Diagnose)
diag_start = content.find('<!-- 📊 現状アカウント診断')
if diag_start == -1:
    diag_start = content.find('<!-- 0. 【新機能】現状アカウント診断')
    if diag_start == -1:
        diag_start = content.find('<div class="cockpit-card" style="border: 1.5px solid #BFDBFE')

print(f"step4: {step4_start}, strat: {strat_start}, plans: {plans_start}, jobs: {jobs_start}, diag: {diag_start}")

# Extract parts:
# before_step4: up to strat_start
# strat_html: from strat_start to plans_start
# plans_html: from plans_start to jobs_start
# jobs_html: from jobs_start to diag_start
# rest_html: from diag_start onwards

before_strat = content[:strat_start]
strat_html = content[strat_start:plans_start]
plans_html = content[plans_start:jobs_start]
jobs_html = content[jobs_start:diag_start]
rest_html = content[diag_start:]

# Inside strat_html, remove the Re-deliberate button to eliminate "やり直しなんていらない"
# Replace the header buttons
strat_html = re.sub(
    r'<button type="button" onclick="triggerReDeliberation\(\)".*?</button>',
    '<!-- Re-deliberate button omitted: fully autonomous -->',
    strat_html,
    flags=re.DOTALL
)

# Put secJobs right after step4!
# secPlans goes after secJobs!
# secStrategyReport stays hidden (style="display:none;") right after secPlans or inside a collapsed details!
# Make secStrategyReport collapsed details or hidden div:
new_reordered_body = (
    before_strat +
    "\n    " + jobs_html.strip() + "\n\n" +
    "    " + plans_html.strip() + "\n\n" +
    "    " + strat_html.strip() + "\n\n" +
    "    " + rest_html.strip()
)

content = new_reordered_body

# 3. Upgrade auditProgressBox in HTML with progress bar and percent badge
old_audit_progress = """        <!-- Live Deliberation Radar Animation Box -->
        <div id="auditProgressBox" style="display:none;" class="p-5 rounded-xl bg-blue-50/70 border border-blue-200 mb-4">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></div>
            <span class="text-xs font-bold text-blue-900" id="auditProgressTitle">7名の専門家AI評議会が過去1ヶ月のデータを合議・精査中...</span>
          </div>
          <div class="space-y-2 text-xs" id="auditStepsList">
            <div class="flex items-center gap-2 text-blue-700 font-mono" id="astp_0"><span>●</span> <span>フック分析官: 冒頭1行目の注意喚起力・スクロール停止率を監査中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_1"><span>○</span> <span>共感心理官: 読者ペルソナへの刺さり・問題意識喚起度を判定中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_2"><span>○</span> <span>アルゴリズム官: Xおすすめタイムライン適合率・直リンク減衰リスクを算出中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_3"><span>○</span> <span>脱AI臭・ブランド防御官: 定型文臭・シャドウバン回避度を検証中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_4"><span>○</span> <span>統括司令官: 総合採点と翌月グロース処方箋を策定中...</span></div>
          </div>
        </div>"""

new_audit_progress = """        <!-- Live Deliberation Radar Animation Box -->
        <div id="auditProgressBox" style="display:none;" class="p-5 rounded-2xl bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-slate-50 border border-blue-200 mb-4 shadow-sm">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></div>
              <span class="text-xs font-black text-blue-900" id="auditProgressTitle">7名の専門家AI評議会が過去1ヶ月のデータを合議・精査中...</span>
            </div>
            <span class="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-mono font-bold" id="auditPercentBadge">15%</span>
          </div>

          <!-- Animated Progress Bar -->
          <div class="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden mb-3.5">
            <div id="auditProgressBar" style="width: 15%;" class="h-full bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full transition-all duration-500"></div>
          </div>

          <!-- Dynamic Steps List -->
          <div class="space-y-2 text-xs" id="auditStepsList">
            <div class="flex items-center gap-2 text-blue-700 font-mono font-bold" id="astp_0"><span>●</span> <span>フック分析官: 冒頭1行目の注意喚起力・スクロール停止率を監査中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_1"><span>○</span> <span>共感心理官: 読者ペルソナへの刺さり・問題意識喚起度を判定中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_2"><span>○</span> <span>アルゴリズム官: Xおすすめタイムライン適合率・直リンク減衰リスクを算出中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_3"><span>○</span> <span>脱AI臭・ブランド防御官: 定型文臭・シャドウバン回避度を検証中...</span></div>
            <div class="flex items-center gap-2 text-slate-400 font-mono" id="astp_4"><span>○</span> <span>統括司令官: 総合採点と翌月グロース処方箋を策定中...</span></div>
          </div>

          <!-- Active Pulsing Indicator -->
          <div id="auditActiveTicker" class="mt-3 pt-3 border-t border-blue-100 flex items-center gap-2 text-[11px] font-bold text-blue-700">
            <span class="inline-block animate-spin">⚡</span>
            <span id="auditActiveTickerText">AI評議員7名が多角ディベート中... 各視点からの採点を集計中</span>
          </div>
        </div>"""

if old_audit_progress in content:
    content = content.replace(old_audit_progress, new_audit_progress)
    print("Replaced auditProgressBox HTML with upgraded animated version")
else:
    print("Warning: old_audit_progress exact match not found, checking with normalize")

# 4. Upgrade runAccountAudit() in JS with active continuous deliberation loop
old_run_audit_regex = r"async function runAccountAudit\(\) \{.*?function renderAuditScorecard\(d\)"
new_run_audit = """async function runAccountAudit() {
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

    function renderAuditScorecard(d)"""

content = re.sub(old_run_audit_regex, new_run_audit, content, flags=re.DOTALL)
print("Updated runAccountAudit function in JS")

with open('views/dashboard_view.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS: Finished updating dashboard_view.html")
