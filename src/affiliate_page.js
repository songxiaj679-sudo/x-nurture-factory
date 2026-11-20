/**
 * src/affiliate_page.js
 * 特設アフィリエイトLP ＆ 会員専用パートナーダッシュボード (https://appflowsystem.com/affiliate)
 * - ブラウザ側 <script> 内の改行エスケープバグを解消（無反応バグの修正）
 * - /studio や /dashboard からのログイン状態 (uid / email) を自動引き継ぎして即時アンロック
 * - ウォレット保存・出金申請APIでも email から userId を自動解決
 */
const { ensureAffiliateCode, getAffiliateDashboardData, requestAffiliatePayout } = require('./affiliate_manager');

async function resolvePartnerUserId(db, userId, email, req) {
  let uid = String(userId || '').trim();
  let cleanEmail = String(email || '').trim().toLowerCase();

  if (!uid && !cleanEmail && req) {
    const raw = req.headers?.cookie || '';
    const cookies = {};
    raw.split(';').forEach(p => {
      const idx = p.indexOf('=');
      if (idx > 0) cookies[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
    });
    if (cookies.xcloud_sess) {
      const sSnap = await db.collection('saas_users').where('sessionToken', '==', cookies.xcloud_sess).limit(1).get().catch(() => ({ empty: true }));
      if (!sSnap.empty) {
        return { userId: sSnap.docs[0].id, userDoc: sSnap.docs[0] };
      }
    }
    if (cookies.xsw_uid) uid = cookies.xsw_uid;
    if (cookies.xsw_email) cleanEmail = cookies.xsw_email.toLowerCase();
  }

  if (uid) {
    const doc = await db.collection('saas_users').doc(uid).get().catch(() => null);
    if (doc && doc.exists) return { userId: uid, userDoc: doc };
  }

  if (cleanEmail) {
    let uSnap = await db.collection('saas_users').where('email', '==', cleanEmail).limit(1).get().catch(() => ({ empty: true }));
    if (!uSnap.empty) {
      return { userId: uSnap.docs[0].id, userDoc: uSnap.docs[0] };
    }
    const allSnap = await db.collection('saas_users').get().catch(() => ({ docs: [] }));
    for (const d of allSnap.docs) {
      if (String(d.data().email || '').trim().toLowerCase() === cleanEmail) {
        return { userId: d.id, userDoc: d };
      }
    }
    // 新規パートナー登録
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    uid = `USR-${Date.now().toString(36).toUpperCase()}-${rand}`;
    await db.collection('saas_users').doc(uid).set({
      userId: uid,
      email: cleanEmail,
      planId: 'free',
      planName: 'Free Trial ($0)',
      createdAt: new Date(),
      updatedAt: new Date()
    }, { merge: true });
    const newDoc = await db.collection('saas_users').doc(uid).get();
    return { userId: uid, userDoc: newDoc };
  }

  return { userId: '', userDoc: null };
}

function getAffiliatePageHtml() {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>X-Swarm Cloud — 30% Recurring Affiliate Partner Program</title>',
    '  <style>',
    '    :root { --bg:#f8fafc; --card:#ffffff; --slate:#0f172a; --muted:#475569; --emerald:#10b981; --emerald-dark:#059669; --emerald-light:#ecfdf5; --border:#e2e8f0; }',
    '    * { box-sizing: border-box; }',
    '    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--slate); line-height:1.6; }',
    '    .topbar { background:#fff; border-bottom:1px solid var(--border); padding:14px 24px; position:sticky; top:0; z-index:50; }',
    '    .topbar-inner { max-width:1080px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }',
    '    .brand { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--slate); font-weight:900; font-size:18px; }',
    '    .brand-icon { background:var(--slate); color:#fff; width:32px; height:32px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; font-weight:900; }',
    '    .nav-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
    '    .pill-btn { border-radius:999px; padding:8px 16px; font-size:13px; font-weight:800; cursor:pointer; text-decoration:none; border:1.5px solid var(--border); background:#fff; color:var(--slate); transition:all 0.15s ease; display:inline-flex; align-items:center; gap:6px; }',
    '    .pill-btn.primary { background:var(--slate); color:#fff; border-color:var(--slate); }',
    '    .pill-btn.emerald { background:var(--emerald-light); color:var(--emerald-dark); border-color:var(--emerald); }',
    '    .container { max-width:1040px; margin:0 auto; padding:32px 20px 64px; }',
    '    .hero-card { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%); color:#fff; border-radius:24px; padding:38px 32px; margin-bottom:28px; box-shadow:0 20px 35px -10px rgba(15,23,42,0.25); }',
    '    .badge-emerald { display:inline-block; background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(52,211,153,0.4); padding:5px 14px; border-radius:999px; font-size:12.5px; font-weight:800; margin-bottom:14px; }',
    '    .hero-title { margin:0 0 12px 0; font-size:30px; font-weight:900; line-height:1.25; }',
    '    .hero-sub { margin:0 0 22px 0; font-size:15px; color:#cbd5e1; max-width:780px; }',
    '    .grid-3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:18px; margin-bottom:28px; }',
    '    .card { background:var(--card); border:1px solid var(--border); border-radius:20px; padding:24px; box-shadow:0 4px 15px rgba(15,23,42,0.04); }',
    '    .card.highlight { border:2px solid var(--emerald); box-shadow:0 12px 28px -6px rgba(16,185,129,0.14); }',
    '    .calc-box { background:#f0fdf4; border:1.5px solid #86efac; border-radius:16px; padding:20px; text-align:center; }',
    '    .calc-amount { font-size:36px; font-weight:900; color:var(--emerald-dark); margin:6px 0; }',
    '    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:22px; }',
    '    .kpi-card { background:#f8fafc; border:1px solid var(--border); border-radius:14px; padding:16px; }',
    '    .kpi-val { font-size:26px; font-weight:900; margin-top:6px; }',
    '    .input-field { width:100%; padding:11px 14px; border:1.5px solid #cbd5e1; border-radius:10px; font-size:14px; color:var(--slate); background:#fff; }',
    '    .swipe-box { background:#f8fafc; border:1px solid var(--border); border-radius:12px; padding:14px; font-size:13px; white-space:pre-wrap; color:#334155; margin-bottom:10px; }',
    '    table { width:100%; border-collapse:collapse; font-size:13px; }',
    '    th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--border); }',
    '    th { color:var(--muted); font-weight:800; background:#f8fafc; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <header class="topbar">',
    '    <div class="topbar-inner">',
    '      <a href="/studio" class="brand">',
    '        <span class="brand-icon">𝕏</span>',
    '        <span>X-Swarm Cloud</span>',
    '        <span style="background:#ecfdf5;color:#059669;border:1px solid #6ee7b7;font-size:11.5px;padding:3px 10px;border-radius:999px;">🤝 Partner Portal</span>',
    '      </a>',
    '      <div class="nav-actions">',
    '        <button id="lang-toggle-btn" class="pill-btn" type="button">🌐 日本語 / English</button>',
    '        <a href="/studio" class="pill-btn emerald">⚡ Post Studio</a>',
    '        <span id="nav-auth-badge" style="display:none;" class="pill-btn"></span>',
    '        <button id="nav-logout-btn" style="display:none;" class="pill-btn" type="button">Log Out</button>',
    '      </div>',
    '    </div>',
    '  </header>',
    '  <main class="container">',
    '    <section class="hero-card">',
    '      <div class="badge-emerald" data-i18n="hero_badge">💰 30% LIFETIME RECURRING COMMISSION (PAID PLANS)</div>',
    '      <h1 class="hero-title" data-i18n="hero_title">Earn 30% Monthly Recurring USDT for Every Active Referral</h1>',
    '      <p class="hero-sub" data-i18n="hero_sub">Share your dedicated referral link. For each successfully paid monthly invoice, 30% is credited to your USD-denominated USDT balance. JPY payments are converted using the ECB daily reference rate for the invoice payment date; the rate and date are recorded in the ledger.</p>',
    '      <div style="display:flex;gap:12px;flex-wrap:wrap;">',
    '        <a href="#member-portal-section" class="pill-btn emerald" style="padding:11px 22px;font-size:14px;" data-i18n="hero_cta">🔑 Access Member Affiliate Dashboard ↓</a>',
    '      </div>',
    '    </section>',
    '    <section id="member-portal-section" style="margin-bottom:32px;">',
    '      <div id="guest-login-gate" class="card highlight">',
    '        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px;">',
    '          <h2 style="margin:0;font-size:20px;font-weight:900;" data-i18n="gate_title">🔒 Member-Only Affiliate Dashboard (Log In to Generate Your Link)</h2>',
    '          <span style="background:#fef3c7;color:#b45309;font-size:12px;font-weight:800;padding:4px 12px;border-radius:999px;" data-i18n="gate_badge">Members Only</span>',
    '        </div>',
    '        <p style="margin:0 0 16px 0;font-size:14px;color:var(--muted);" data-i18n="gate_desc">Your dedicated referral code (?ref=XSW-XXXXXX), real-time conversion stats, and USDT payout controls are protected inside your member account. Enter your registered Studio email below (or Account ID) to unlock your partner portal.</p>',
    '        <div style="display:flex;gap:10px;flex-wrap:wrap;max-width:680px;">',
    '          <input id="partner-login-email" type="text" class="input-field" style="flex:1;min-width:240px;" placeholder="Enter your email (e.g. hank3jones@gmail.com) or User ID" />',
    '          <button id="partner-login-btn" type="button" class="pill-btn primary" style="padding:11px 22px;font-size:14px;" data-i18n="gate_btn">🚀 Unlock My Affiliate Portal</button>',
    '        </div>',
    '        <div id="gate-error-msg" style="margin-top:10px;font-size:13px;font-weight:800;color:#dc2626;display:none;"></div>',
    '      </div>',
    '      <div id="authenticated-dashboard" class="card highlight" style="display:none;">',
    '        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:18px;border-bottom:1px solid var(--border);padding-bottom:14px;">',
    '          <div>',
    '            <span style="background:#0f172a;color:#fff;font-size:11px;font-weight:800;padding:4px 10px;border-radius:999px;">MEMBER PARTNER PORTAL</span>',
    '            <h2 style="margin:6px 0 0 0;font-size:21px;font-weight:900;" data-i18n="dash_title">Your Affiliate Command Center</h2>',
    '          </div>',
    '          <div style="text-align:right;">',
    '            <div style="font-size:12px;color:var(--muted);" data-i18n="dash_logged_as">Logged in Partner</div>',
    '            <div id="dash-user-email" style="font-size:14px;font-weight:900;color:var(--emerald-dark);"></div>',
    '          </div>',
    '        </div>',
    '        <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:16px;padding:16px 18px;margin-bottom:20px;">',
    '          <div style="font-size:12.5px;font-weight:800;color:#065f46;margin-bottom:8px;" data-i18n="dash_link_label">🔗 1. Direct Studio Sandbox Referral Link (Best for X Bios & Posts — 30-Day Cookie)</div>',
    '          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">',
    '            <input id="dash-studio-link" type="text" readonly class="input-field" style="flex:1;font-weight:800;" value="" />',
    '            <button id="copy-studio-link-btn" type="button" class="pill-btn primary" data-i18n="btn_copy">📋 Copy Link</button>',
    '          </div>',
    '          <div style="font-size:12.5px;font-weight:800;color:#065f46;margin-bottom:8px;" data-i18n="dash_lp_link_label">🤝 2. Partner Program Landing Page Link (For Recruiting Sub-Affiliates & Marketers)</div>',
    '          <div style="display:flex;gap:8px;flex-wrap:wrap;">',
    '            <input id="dash-aff-link" type="text" readonly class="input-field" style="flex:1;font-weight:700;" value="" />',
    '            <button id="copy-aff-link-btn" type="button" class="pill-btn" data-i18n="btn_copy">📋 Copy Link</button>',
    '          </div>',
    '        </div>',
    '        <div class="kpi-grid">',
    '          <div class="kpi-card">',
    '            <div style="font-size:12px;font-weight:700;color:var(--muted);" data-i18n="kpi_signups">Total Signups</div>',
    '            <div id="kpi-val-signups" class="kpi-val">0</div>',
    '          </div>',
    '          <div class="kpi-card">',
    '            <div style="font-size:12px;font-weight:700;color:var(--muted);" data-i18n="kpi_paid">Paid Monthly Referrals (30%)</div>',
    '            <div id="kpi-val-paid" class="kpi-val" style="color:var(--emerald-dark);">0</div>',
    '          </div>',
    '          <div class="kpi-card" style="background:#ecfdf5;border-color:#6ee7b7;">',
    '            <div style="font-size:12px;font-weight:800;color:#065f46;" data-i18n="kpi_balance">Available USDT Balance</div>',
    '            <div id="kpi-val-balance" class="kpi-val" style="color:var(--emerald-dark);">$0.00</div>',
    '          </div>',
    '          <div class="kpi-card">',
    '            <div style="font-size:12px;font-weight:700;color:var(--muted);" data-i18n="kpi_total">Total Earned (USD)</div>',
    '            <div id="kpi-val-total" class="kpi-val">$0.00</div>',
    '          </div>',
    '        </div>',
    '        <div style="margin-bottom:22px;">',
    '          <h3 style="margin:0 0 10px 0;font-size:15px;font-weight:900;" data-i18n="assets_title">📣 Ready-to-Post Promo Templates (Your Referral Link Pre-Embedded)</h3>',
    '          <div class="grid-3" style="margin-bottom:0;">',
    '            <div>',
    '              <div style="font-size:12px;font-weight:800;margin-bottom:4px;">𝕏 Post / Bio Template (English)</div>',
    '              <div id="swipe-en" class="swipe-box"></div>',
    '              <button id="copy-swipe-en-btn" type="button" class="pill-btn">📋 Copy English Post</button>',
    '            </div>',
    '            <div>',
    '              <div style="font-size:12px;font-weight:800;margin-bottom:4px;">𝕏 ポスト / 紹介テンプレート (日本語)</div>',
    '              <div id="swipe-ja" class="swipe-box"></div>',
    '              <button id="copy-swipe-ja-btn" type="button" class="pill-btn">📋 日本語紹介文をコピー</button>',
    '            </div>',
    '          </div>',
    '        </div>',
    '        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:16px;padding:18px;margin-bottom:20px;">',
    '          <h3 style="margin:0 0 12px 0;font-size:15px;font-weight:900;" data-i18n="payout_title">💳 Payout Wallet & Instant USDT Withdrawal</h3>',
    '          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:14px;">',
    '            <div>',
    '              <label style="display:block;font-size:12px;font-weight:800;margin-bottom:4px;" data-i18n="wallet_label">USDT Wallet Address (TRC20 or BEP20)</label>',
    '              <input id="dash-wallet-input" type="text" class="input-field" placeholder="T... (TRC20) or 0x... (BEP20)" />',
    '            </div>',
    '            <div>',
    '              <label style="display:block;font-size:12px;font-weight:800;margin-bottom:4px;" data-i18n="tg_label">Telegram Chat ID (For Instant Commission Alerts)</label>',
    '              <input id="dash-tg-input" type="text" class="input-field" placeholder="e.g. 8401260325" />',
    '            </div>',
    '          </div>',
    '          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">',
    '            <button id="dash-save-btn" type="button" class="pill-btn primary" data-i18n="btn_save_wallet">💾 Save Wallet & Alert Settings</button>',
    '            <button id="dash-payout-btn" type="button" class="pill-btn emerald" style="background:#10b981;color:#fff;" data-i18n="btn_req_payout">💸 Request USDT Payout (Min $30)</button>',
    '          </div>',
    '          <div id="dash-action-msg" style="margin-top:10px;font-size:13px;font-weight:800;display:none;"></div>',
    '        </div>',
    '        <div>',
    '          <h3 style="margin:0 0 10px 0;font-size:15px;font-weight:900;" data-i18n="hist_title">📜 Commission & Payout Ledger</h3>',
    '          <div style="overflow-x:auto;">',
    '            <table>',
    '              <thead><tr><th>Date</th><th>Type</th><th>Amount (USD)</th><th>Status / TX</th></tr></thead>',
    '              <tbody id="dash-history-tbody"><tr><td colspan="4" style="color:var(--muted);">No commission or payout records yet.</td></tr></tbody>',
    '            </table>',
    '          </div>',
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="card" style="margin-bottom:28px;">',
    '      <h2 style="margin:0 0 8px 0;font-size:20px;font-weight:900;" data-i18n="calc_title">📊 Interactive Recurring Revenue Calculator</h2>',
    '      <p style="margin:0 0 18px 0;font-size:14px;color:var(--muted);" data-i18n="calc_sub">Estimate your passive monthly USDT income based on active referred users. Commissions recur every month as users renew their plans.</p>',
    '      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;align-items:center;">',
    '        <div>',
    '          <label style="display:flex;justify-content:space-between;font-weight:800;font-size:13.5px;margin-bottom:6px;">',
    '            <span data-i18n="calc_slider_users">Active Referred Users:</span>',
    '            <span id="calc-users-val" style="color:var(--emerald-dark);font-size:16px;">10 users</span>',
    '          </label>',
    '          <input id="calc-users-range" type="range" min="1" max="100" value="10" style="width:100%;accent-color:#10b981;margin-bottom:18px;" />',
    '          <label style="display:flex;justify-content:space-between;font-weight:800;font-size:13.5px;margin-bottom:6px;">',
    '            <span data-i18n="calc_slider_plan">Average Monthly Plan Price:</span>',
    '            <span id="calc-plan-val" style="color:var(--emerald-dark);font-size:16px;">$79 / mo</span>',
    '          </label>',
    '          <input id="calc-plan-range" type="range" min="39" max="179" step="1" value="79" style="width:100%;accent-color:#10b981;" />',
    '        </div>',
    '        <div class="calc-box">',
    '          <div style="font-size:12.5px;font-weight:800;color:#065f46;" data-i18n="calc_res_label">ESTIMATED MONTHLY PASSIVE INCOME (30%)</div>',
    '          <div id="calc-monthly-out" class="calc-amount">$237.00 / mo</div>',
    '          <div id="calc-yearly-out" style="font-size:13px;font-weight:700;color:#047857;">($2,844.00 / year in USDT)</div>',
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="grid-3">',
    '      <div class="card"><div style="font-size:24px;margin-bottom:8px;">1️⃣</div><h3 style="margin:0 0 8px 0;font-size:16px;font-weight:900;" data-i18n="step1_t">Grab Your Member Link</h3><p style="margin:0;font-size:13.5px;color:var(--muted);" data-i18n="step1_d">Log in to your X-Swarm account to get your unique referral code. Visitors who click your link are tracked for 30 days via first-party cookies and localStorage.</p></div>',
    '      <div class="card"><div style="font-size:24px;margin-bottom:8px;">2️⃣</div><h3 style="margin:0 0 8px 0;font-size:16px;font-weight:900;" data-i18n="step2_t">Let the Free Sandbox Convert</h3><p style="margin:0;font-size:13.5px;color:var(--muted);" data-i18n="step2_d">Send traffic to the Free 1-Click Live Post Studio. Visitors test real cloud browser posting for $0 and see their live post URL on X right away.</p></div>',
    '      <div class="card"><div style="font-size:24px;margin-bottom:8px;">3️⃣</div><h3 style="margin:0 0 8px 0;font-size:16px;font-weight:900;" data-i18n="step3_t">30% Recurring USDT Payouts</h3><p style="margin:0;font-size:13.5px;color:var(--muted);" data-i18n="step3_d">30% of each successfully paid monthly invoice is credited. JPY payments are converted to USD using the ECB daily reference rate for the invoice date. Withdraw via USDT from $30.</p></div>',
    '    </section>',
    '  </main>',
    '  <script>',
    '    (function() {',
    '      var NL = String.fromCharCode(10);',
    '      var currentLang = (localStorage.getItem("xswarm_lang") || (navigator.language && navigator.language.indexOf("ja") === 0 ? "ja" : "en"));',
    '      var i18nDict = {',
    '        ja: {',
    '          hero_badge: "💰 月額有料プラン課金の 30% 継続報酬（USDT即時反映）",',
    '          hero_title: "紹介ユーザーが継続する限り、毎月30%のUSDT報酬を自動獲得",',
    '          hero_sub: "紹介リンク経由のユーザーが月額請求を実際に支払うたび、支払額の30%をUSD建てのUSDT残高に計上します。JPY決済は請求日のECB日次参考レートでUSD換算し、適用レートと日付を台帳に記録します。",',
    '          hero_cta: "🔑 会員専用アフィリエイト管理画面へ移動 ↓",',
    '          gate_title: "🔒 会員専用アフィリエイト・ポータル（ログインして専用リンクを発行）",',
    '          gate_badge: "会員限定エリア",',
    '          gate_desc: "あなた固有の紹介コード（?ref=XSW-XXXXXX）、リアルタイム紹介実績、USDT出金申請は会員専用エリアで保護されています。登録メールアドレス（またはユーザーID）を入力してポータルを開いてください。",',
    '          gate_btn: "🚀 専用ポータルを開く",',
    '          dash_title: "アフィリエイト・パートナー専用ダッシュボード",',
    '          dash_logged_as: "ログイン中のパートナー会員",',
    '          dash_link_label: "🔗 1. スタジオ直行の紹介リンク（XのBIOや投稿での誘導に最適 — 30日間Cookie追跡）",',
    '          dash_lp_link_label: "🤝 2. アフィリエイト説明ページ紹介リンク（マーケター・紹介者募集用）",',
    '          btn_copy: "📋 コピー",',
    '          kpi_signups: "紹介登録ユーザー数",',
    '          kpi_paid: "月額有料課金件数 (30%対象)",',
    '          kpi_balance: "出金可能 USDT残高",',
    '          kpi_total: "累計獲得報酬額 (USD)",',
    '          assets_title: "📣 そのまま使える宣伝テンプレート（あなたの紹介コード自動挿入済み）",',
    '          payout_title: "💳 報酬受取用USDTウォレット設定 ＆ 出金申請",',
    '          wallet_label: "受取用 USDTウォレットアドレス (TRC20 / BEP20)",',
    '          tg_label: "Telegram Chat ID（任意：報酬発生＆送金完了の即時通知用）",',
    '          btn_save_wallet: "💾 ウォレット＆通知設定を保存",',
    '          btn_req_payout: "💸 USDT報酬を出金申請する (最低 $30〜)",',
    '          hist_title: "📜 報酬計上・出金申請履歴",',
    '          calc_title: "📊 継続アフィリエイト収益シミュレーター",',
    '          calc_sub: "紹介したアクティブユーザー数に応じた毎月のUSDT継続報酬を試算できます（フリープラン・無料テストは除外、月額有料プランのみ対象）。",',
    '          calc_slider_users: "紹介した有料アクティブユーザー数:",',
    '          calc_slider_plan: "平均契約プラン単価 (月額):",',
    '          calc_res_label: "毎月の推定継続報酬額 (30%還元)",',
    '          step1_t: "会員専用リンクを取得",',
    '          step1_d: "会員ポータルにログインするとあなた固有の紹介コードが発行されます。リンクを踏んだ訪問者は30日間Cookieで自動追跡されます。",',
    '          step2_t: "無料ライブ投稿体験で高成約",',
    '          step2_d: "訪問者は /studio でアカウント登録不要・0円で実機クラウド投稿を体験でき、実際にXに反映されたPOSTのURLをその場で確認できます。",',
    '          step3_t: "毎月30%をUSDTで継続受取",',
    '          step3_d: "紹介ユーザーの月額請求が実際に支払われるたび、支払額の30%をUSD建てで計上します。JPY決済は請求日のECB日次参考レートで換算します。$30からUSDTで出金可能です。"',
    '        },',
    '        en: {}',
    '      };',
    '      function applyLang() {',
    '        var nodes = document.querySelectorAll("[data-i18n]");',
    '        for (var i = 0; i < nodes.length; i++) {',
    '          var el = nodes[i];',
    '          var k = el.getAttribute("data-i18n");',
    '          if (!el.getAttribute("data-en-orig")) el.setAttribute("data-en-orig", el.innerText);',
    '          if (currentLang === "ja" && i18nDict.ja[k]) el.innerText = i18nDict.ja[k];',
    '          else if (el.getAttribute("data-en-orig")) el.innerText = el.getAttribute("data-en-orig");',
    '        }',
    '      }',
    '      function updateCalculator() {',
    '        var u = parseInt(document.getElementById("calc-users-range").value || "10", 10);',
    '        var p = parseInt(document.getElementById("calc-plan-range").value || "79", 10);',
    '        var monthly = u * p * 0.30;',
    '        var yearly = monthly * 12;',
    '        document.getElementById("calc-users-val").innerText = u + (currentLang === "ja" ? " 人" : " users");',
    '        document.getElementById("calc-plan-val").innerText = "$" + p + " / mo";',
    '        document.getElementById("calc-monthly-out").innerText = "$" + monthly.toFixed(2) + " / mo";',
    '        document.getElementById("calc-yearly-out").innerText = (currentLang === "ja" ? "（年間換算 $" + yearly.toFixed(2) + " USDT）" : "($" + yearly.toFixed(2) + " / year in USDT)");',
    '      }',
    '      function copyTextFromEl(id, btn) {',
    '        var el = document.getElementById(id);',
    '        if (!el) return;',
    '        var txt = el.value || el.innerText || "";',
    '        if (navigator.clipboard && navigator.clipboard.writeText) {',
    '          navigator.clipboard.writeText(txt).catch(function() {});',
    '        }',
    '        var orig = btn.innerText;',
    '        btn.innerText = "✅ Copied!";',
    '        setTimeout(function() { btn.innerText = orig; }, 1800);',
    '      }',
    '      function detectStoredCredentials() {',
    '        var sp = new URLSearchParams(window.location.search);',
    '        var qUid = sp.get("uid") || sp.get("userId") || "";',
    '        var qEmail = sp.get("email") || "";',
    '        if (qUid) localStorage.setItem("xswarm_user_id", qUid);',
    '        if (qEmail) localStorage.setItem("xswarm_user_email", qEmail);',
    '        var uid = qUid || localStorage.getItem("xswarm_user_id") || localStorage.getItem("saas_user_id") || localStorage.getItem("studio_user_id") || localStorage.getItem("uid") || "";',
    '        var email = qEmail || localStorage.getItem("xswarm_user_email") || localStorage.getItem("saas_user_email") || localStorage.getItem("studio_email") || localStorage.getItem("email") || "";',
    '        return { userId: uid.trim(), email: email.trim() };',
    '      }',
    '      function loadMemberDashboard(customCreds) {',
    '        var base = detectStoredCredentials();',
    '        var uid = (customCreds && customCreds.userId !== undefined) ? customCreds.userId : base.userId;',
    '        var email = (customCreds && customCreds.email !== undefined) ? customCreds.email : base.email;',
    '        var errEl = document.getElementById("gate-error-msg");',
    '        var loginBtn = document.getElementById("partner-login-btn");',
    '        if (!uid && !email) {',
    '          document.getElementById("guest-login-gate").style.display = "block";',
    '          document.getElementById("authenticated-dashboard").style.display = "none";',
    '          document.getElementById("nav-auth-badge").style.display = "none";',
    '          document.getElementById("nav-logout-btn").style.display = "none";',
    '          return;',
    '        }',
    '        if (loginBtn) loginBtn.innerText = "⏳ Unlocking Portal...";',
    '        fetch("/api/web-affiliate-auth", {',
    '          method: "POST",',
    '          headers: { "Content-Type": "application/json" },',
    '          body: JSON.stringify({ userId: uid, email: email })',
    '        })',
    '        .then(function(r) { return r.json(); })',
    '        .then(function(d) {',
    '          if (loginBtn) loginBtn.innerText = (currentLang === "ja" ? "🚀 専用ポータルを開く" : "🚀 Unlock My Affiliate Portal");',
    '          if (!d || !d.ok || !d.authenticated || !d.profile) {',
    '            document.getElementById("guest-login-gate").style.display = "block";',
    '            document.getElementById("authenticated-dashboard").style.display = "none";',
    '            if (errEl) { errEl.style.display = "block"; errEl.innerText = "⚠️ Account not found. Please check your email or User ID."; }',
    '            return;',
    '          }',
    '          if (errEl) errEl.style.display = "none";',
    '          var p = d.profile;',
    '          localStorage.setItem("xswarm_user_email", p.email || "");',
    '          localStorage.setItem("xswarm_user_id", p.userId || "");',
    '          document.getElementById("guest-login-gate").style.display = "none";',
    '          document.getElementById("authenticated-dashboard").style.display = "block";',
    '          var badge = document.getElementById("nav-auth-badge");',
    '          badge.style.display = "inline-flex";',
    '          badge.innerText = "👤 " + (p.email || p.userId);',
    '          document.getElementById("nav-logout-btn").style.display = "inline-flex";',
    '          document.getElementById("dash-user-email").innerText = (p.email || p.userId) + " (Code: " + p.affCode + ")";',
    '          var studioUrl = window.location.origin + "/studio?ref=" + p.affCode;',
    '          var affUrl = window.location.origin + "/affiliate?ref=" + p.affCode;',
    '          document.getElementById("dash-studio-link").value = studioUrl;',
    '          document.getElementById("dash-aff-link").value = affUrl;',
    '          document.getElementById("kpi-val-signups").innerText = String(p.affReferralsCount || 0);',
    '          document.getElementById("kpi-val-paid").innerText = String(p.affPaidReferralsCount || 0);',
    '          document.getElementById("kpi-val-balance").innerText = "$" + Number(p.affBalanceUsd || 0).toFixed(2);',
    '          document.getElementById("kpi-val-total").innerText = "$" + Number(p.affTotalEarnedUsd || 0).toFixed(2);',
    '          if (p.affWalletUsdt) document.getElementById("dash-wallet-input").value = p.affWalletUsdt;',
    '          if (p.tgChatId) document.getElementById("dash-tg-input").value = p.tgChatId;',
    '          document.getElementById("swipe-en").innerText = [',
    '            "🚀 Running my multi-account X workflow on autonomous cloud browsers with dedicated static residential IPs & 0-sec shadowban auto-swap.",',
    '            "",',
    '            "✅ Test a live post for $0 right from your browser",',
    '            "✅ 30% monthly recurring USDT partner share",',
    '            "",',
    '            "👇 Try Free Live Sandbox:",',
    '            studioUrl',
    '          ].join(NL);',
    '          document.getElementById("swipe-ja").innerText = [',
    '            "⚡ Xの複数アカウント運用をクラウド実機ブラウザ＋固定ISPプロキシで自動化中。",',
    '            "",',
    '            "・シャドウバン0秒自動スワップ搭載",',
    '            "・Xを開かずWebから無料ライブ投稿テストが可能",',
    '            "・月額課金30%継続のUSDTパートナー報酬対応",',
    '            "",',
    '            "👇 無料テスト投稿はこちら:",',
    '            studioUrl',
    '          ].join(NL);',
    '          var tbody = document.getElementById("dash-history-tbody");',
    '          if (d.history && d.history.length > 0) {',
    '            tbody.innerHTML = d.history.map(function(h) {',
    '              var dt = h.createdAt ? h.createdAt.slice(0, 10) : "-";',
    '              var label = h.type === "payout_request" ? "💸 Payout Request" : ("💰 30% Commission (" + (h.planId || "Paid Plan") + ")");',
    '              return "<tr><td>" + dt + "</td><td>" + label + "</td><td style=\\"font-weight:800;color:#059669;\\">$" + Number(h.amountUsd || 0).toFixed(2) + "</td><td>" + (h.status || "credited") + "</td></tr>";',
    '            }).join("");',
    '          }',
    '        })',
    '        .catch(function(err) {',
    '          if (loginBtn) loginBtn.innerText = "🚀 Unlock My Affiliate Portal";',
    '          if (errEl) { errEl.style.display = "block"; errEl.innerText = "⚠️ Network error: " + err.message; }',
    '        });',
    '      }',
    '      function triggerManualLogin() {',
    '        var raw = (document.getElementById("partner-login-email").value || "").trim();',
    '        var errEl = document.getElementById("gate-error-msg");',
    '        if (!raw) {',
    '          errEl.style.display = "block";',
    '          errEl.innerText = "⚠️ Please enter your registered email address or User ID.";',
    '          return;',
    '        }',
    '        errEl.style.display = "none";',
    '        if (raw.indexOf("@") !== -1) {',
    '          loadMemberDashboard({ userId: "", email: raw.toLowerCase() });',
    '        } else {',
    '          loadMemberDashboard({ userId: raw, email: "" });',
    '        }',
    '      }',
    '      document.getElementById("lang-toggle-btn").onclick = function() {',
    '        currentLang = (currentLang === "ja" ? "en" : "ja");',
    '        localStorage.setItem("xswarm_lang", currentLang);',
    '        applyLang();',
    '        updateCalculator();',
    '      };',
    '      document.getElementById("calc-users-range").oninput = updateCalculator;',
    '      document.getElementById("calc-plan-range").oninput = updateCalculator;',
    '      document.getElementById("copy-studio-link-btn").onclick = function() { copyTextFromEl("dash-studio-link", this); };',
    '      document.getElementById("copy-aff-link-btn").onclick = function() { copyTextFromEl("dash-aff-link", this); };',
    '      document.getElementById("copy-swipe-en-btn").onclick = function() { copyTextFromEl("swipe-en", this); };',
    '      document.getElementById("copy-swipe-ja-btn").onclick = function() { copyTextFromEl("swipe-ja", this); };',
    '      document.getElementById("partner-login-btn").onclick = triggerManualLogin;',
    '      document.getElementById("partner-login-email").onkeydown = function(e) {',
    '        if (e.key === "Enter") { e.preventDefault(); triggerManualLogin(); }',
    '      };',
    '      document.getElementById("nav-logout-btn").onclick = function() {',
    '        localStorage.removeItem("xswarm_user_email");',
    '        localStorage.removeItem("xswarm_user_id");',
    '        document.getElementById("partner-login-email").value = "";',
    '        loadMemberDashboard({ userId: "", email: "" });',
    '      };',
    '      document.getElementById("dash-save-btn").onclick = function() {',
    '        var email = localStorage.getItem("xswarm_user_email") || "";',
    '        var userId = localStorage.getItem("xswarm_user_id") || "";',
    '        var w = document.getElementById("dash-wallet-input").value.trim();',
    '        var tg = document.getElementById("dash-tg-input").value.trim();',
    '        var msg = document.getElementById("dash-action-msg");',
    '        fetch("/api/web-affiliate-save", {',
    '          method: "POST",',
    '          headers: { "Content-Type": "application/json" },',
    '          body: JSON.stringify({ userId: userId, email: email, usdtAddress: w, tgChatId: tg })',
    '        }).then(function(r) { return r.json(); }).then(function(res) {',
    '          msg.style.display = "block";',
    '          msg.style.color = res.ok ? "#059669" : "#dc2626";',
    '          msg.innerText = res.ok ? "✅ Wallet & Telegram alert settings saved!" : ("⚠️ " + (res.error || "Failed to save"));',
    '        });',
    '      };',
    '      document.getElementById("dash-payout-btn").onclick = function() {',
    '        var email = localStorage.getItem("xswarm_user_email") || "";',
    '        var userId = localStorage.getItem("xswarm_user_id") || "";',
    '        var w = document.getElementById("dash-wallet-input").value.trim();',
    '        var msg = document.getElementById("dash-action-msg");',
    '        fetch("/api/web-affiliate-payout", {',
    '          method: "POST",',
    '          headers: { "Content-Type": "application/json" },',
    '          body: JSON.stringify({ userId: userId, email: email, usdtAddress: w })',
    '        }).then(function(r) { return r.json(); }).then(function(res) {',
    '          msg.style.display = "block";',
    '          msg.style.color = res.ok ? "#059669" : "#dc2626";',
    '          msg.innerText = res.ok ? ("🎉 Payout request ($" + Number(res.payoutAmountUsd || 0).toFixed(2) + " USD) submitted!") : ("⚠️ " + (res.error || "Minimum payout is $30.00 USD"));',
    '          if (res.ok) loadMemberDashboard({ userId: userId, email: email });',
    '        });',
    '      };',
    '      try {',
    '        var sp = new URLSearchParams(window.location.search);',
    '        var rCode = sp.get("ref") || sp.get("aff");',
    '        if (rCode && /^[A-Za-z0-9_-]{3,32}$/.test(rCode.trim())) {',
    '          localStorage.setItem("xswarm_ref_code", rCode.trim().toUpperCase());',
    '          document.cookie = "xswarm_ref=" + encodeURIComponent(rCode.trim().toUpperCase()) + "; path=/; max-age=" + (60 * 60 * 24 * 30);',
    '        }',
    '      } catch (e) {}',
    '      applyLang();',
    '      updateCalculator();',
    '      loadMemberDashboard();',
    '    })();',
    '  </script>',
    '  <div id="google_translate_element" style="position:fixed;bottom:16px;right:16px;z-index:999;background:rgba(15,23,42,0.9);padding:8px 12px;border-radius:12px;border:1px solid #3B82F6;"></div><script>(function(){var u=localStorage.getItem("xsw_uid"),e=localStorage.getItem("xsw_email");if(u&&!localStorage.getItem("xswarm_uid"))localStorage.setItem("xswarm_uid",u);if(e&&!localStorage.getItem("xswarm_email"))localStorage.setItem("xswarm_email",e);})();function googleTranslateElementInit(){new google.translate.TranslateElement({pageLanguage:"en",includedLanguages:"en,ja,zh-CN,zh-TW,ko,es,fr,de,pt,ru",autoDisplay:false},"google_translate_element");}</script><script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script></body>',
    '</html>'
  ].join('\n');
}

function registerAffiliatePageRoutes(app, db) {
  app.post('/api/web-affiliate-auth', async (req, res) => {
    try {
      const { userId, email } = req.body || {};
      const resolved = await resolvePartnerUserId(db, userId, email, req);
      if (!resolved.userId || !resolved.userDoc || !resolved.userDoc.exists) {
        return res.json({ ok: true, authenticated: false });
      }
      const uData = resolved.userDoc.data() || {};
      const affCode = await ensureAffiliateCode(resolved.userId);
      const dash = await getAffiliateDashboardData(resolved.userId);

      const ledgerSnap = await db.collection('saas_affiliate_ledger')
        .where('referrerUserId', '==', resolved.userId)
        .limit(20)
        .get()
        .catch(() => ({ docs: [] }));

      const history = (ledgerSnap.docs || []).map(doc => {
        const x = doc.data() || {};
        return {
          id: doc.id,
          type: x.type || 'commission',
          amountUsd: Number(x.amountUsd || x.commissionUsd || 0),
          planId: x.planId || '',
          status: x.status || 'credited',
          usdtAddress: x.usdtAddress || '',
          txHash: x.txHash || '',
          createdAt: x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toISOString() : ''
        };
      }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      return res.json({
        ok: true,
        authenticated: true,
        profile: {
          userId: resolved.userId,
          email: uData.email || email || resolved.userId,
          planName: uData.planName || 'Free Trial ($0)',
          affCode: affCode || dash.affCode,
          affReferralsCount: Number(uData.affReferralsCount || 0),
          affPaidReferralsCount: Number(uData.affPaidReferralsCount || 0),
          affBalanceUsd: Number(uData.affBalanceUsd || 0),
          affTotalEarnedUsd: Number(uData.affTotalEarnedUsd || 0),
          affWalletUsdt: uData.affWalletUsdt || '',
          tgChatId: uData.tgChatId || ''
        },
        history
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/web-affiliate-save', async (req, res) => {
    try {
      const { userId, email, usdtAddress, tgChatId } = req.body || {};
      const resolved = await resolvePartnerUserId(db, userId, email, req);
      if (!resolved.userId) return res.status(400).json({ ok: false, error: 'Please log in first' });

      const updateData = { updatedAt: new Date() };
      if (typeof usdtAddress === 'string') updateData.affWalletUsdt = usdtAddress.trim();
      if (typeof tgChatId === 'string' && tgChatId.trim()) updateData.tgChatId = tgChatId.trim();
      await db.collection('saas_users').doc(resolved.userId).set(updateData, { merge: true });
      return res.json({ ok: true, userId: resolved.userId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/web-affiliate-payout', async (req, res) => {
    try {
      const { userId, email, usdtAddress } = req.body || {};
      const resolved = await resolvePartnerUserId(db, userId, email, req);
      if (!resolved.userId) return res.status(400).json({ ok: false, error: 'Please log in first' });
      const result = await requestAffiliatePayout(resolved.userId, usdtAddress);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/affiliate', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getAffiliatePageHtml());
  });
}

module.exports = { registerAffiliatePageRoutes, getAffiliatePageHtml };
