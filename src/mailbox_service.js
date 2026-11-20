const { fetchInboxMessagesForEmail, generateDedicatedMailboxPassword } = require('./email_firstmail');
const { createAccountRepository } = require('./account_repository');

function escapeHtmlServer(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function authenticateAndFetchMailbox(db, rawEmail, rawPass) {
  const { getAccountsByField } = createAccountRepository(db);
  const email = String(rawEmail || '').trim().toLowerCase();
  const inputPass = String(rawPass || '').trim();
  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, error: 'メールアドレスを正しく入力してください。' };
  }
  if (!inputPass) {
    return { ok: false, status: 400, error: 'メールPW（またはXログインパスワード）を入力してください。' };
  }

  let matchedAcc = null;
  const matchingAccounts = await getAccountsByField('email', email, { limit: 5 });
  if (matchingAccounts.length > 0) {
    matchedAcc = matchingAccounts[0].data();
  } else if (rawEmail && String(rawEmail).trim() !== email) {
    const exactMatches = await getAccountsByField('email', String(rawEmail).trim(), { limit: 2 });
    if (exactMatches.length > 0) {
      matchedAcc = exactMatches[0].data();
    }
  }

  const dedicatedMpw = generateDedicatedMailboxPassword(email);
  const adminMasterPass = (process.env.ADMIN_PASS || '').trim();
  const customDomains = (process.env.CUSTOM_EMAIL_DOMAINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const emailDomain = email.split('@')[1] || '';

  if (!matchedAcc && !customDomains.includes(emailDomain)) {
    return { ok: false, status: 404, error: 'このメールアドレスは登録されていないか、対象外のドメインです。' };
  }

  const validCandidates = [dedicatedMpw, adminMasterPass].filter(Boolean);
  if (matchedAcc) {
    if (matchedAcc.password) validCandidates.push(String(matchedAcc.password).trim());
    if (matchedAcc.twoFactorKey) validCandidates.push(String(matchedAcc.twoFactorKey).trim());
    if (matchedAcc.twoFactorSecret) validCandidates.push(String(matchedAcc.twoFactorSecret).trim());
    if (matchedAcc.authToken) validCandidates.push(String(matchedAcc.authToken).trim());
    const rawMailPass = String(matchedAcc.emailPassword || '').trim();
    if (rawMailPass && !rawMailPass.includes('|')) {
      validCandidates.push(rawMailPass);
    }
  }

  const isAuthorized = validCandidates.some(
    c => c && (c === inputPass || c.toLowerCase() === inputPass.toLowerCase())
  );
  if (!isAuthorized) {
    return {
      ok: false,
      status: 403,
      error: 'パスワードが一致しません。納品データの「メールPW（mpw_...）」または「Xログインパスワード」を入力してください。'
    };
  }

  const messages = await fetchInboxMessagesForEmail(
    email,
    matchedAcc ? (matchedAcc.emailPassword || '') : '',
    30
  );
  return {
    ok: true,
    status: 200,
    email,
    userId: matchedAcc && matchedAcc.userId ? '@' + String(matchedAcc.userId).replace(/^@/, '') : '',
    dedicatedMpw,
    count: messages.length,
    messages
  };
}

function renderMailboxPage(prefillEmail = '', prefillPass = '', initialResult = null) {
  const initialJson = initialResult ? JSON.stringify(initialResult).replace(/</g, '\\u003c') : 'null';
  return [
    '<!DOCTYPE html>',
    '<html lang="ja">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>専用メール受信BOX | VeloxPost Cloud</title>',
    '  <style>',
    '    :root { --bg:#0b0f19; --card:#131b2e; --card-hover:#1a2540; --border:#26334d; --text:#f1f5f9; --muted:#94a3b8; --accent:#3b82f6; --emerald:#10b981; }',
    '    * { box-sizing:border-box; }',
    '    body { margin:0; padding:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Hiragino Sans",sans-serif; }',
    '    .header { background:rgba(19,27,46,0.95); border-bottom:1px solid var(--border); padding:14px 20px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:50; }',
    '    .brand { font-weight:800; font-size:18px; color:#fff; text-decoration:none; }',
    '    .nav-btn { background:#1e293b; color:#e2e8f0; border:1px solid var(--border); padding:8px 14px; border-radius:8px; text-decoration:none; font-size:13px; font-weight:600; }',
    '    .container { max-width:960px; margin:24px auto; padding:0 16px 60px; }',
    '    .auth-card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:22px; margin-bottom:20px; box-shadow:0 10px 25px rgba(0,0,0,0.35); }',
    '    .title { font-size:20px; font-weight:800; margin:0 0 6px; }',
    '    .subtitle { font-size:13px; color:var(--muted); margin:0 0 18px; line-height:1.5; }',
    '    .form-grid { display:grid; grid-template-columns:1fr 1fr auto; gap:12px; align-items:end; }',
    '    @media (max-width:720px) { .form-grid { grid-template-columns:1fr; } }',
    '    .field label { display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px; }',
    '    .field input { width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#090d16; color:#fff; font-size:14px; outline:none; }',
    '    .field input:focus { border-color:var(--accent); }',
    '    .btn-primary { background:linear-gradient(135deg,#2563eb,#1d4ed8); color:#fff; border:none; padding:12px 22px; border-radius:10px; font-weight:700; font-size:14px; cursor:pointer; height:43px; white-space:nowrap; }',
    '    .saved-bar { margin-top:14px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }',
    '    .saved-pill { background:#1e293b; border:1px solid #334155; color:#cbd5e1; padding:5px 11px; border-radius:999px; font-size:12px; cursor:pointer; }',
    '    .inbox-header { display:flex; align-items:center; justify-content:space-between; margin:22px 0 12px; flex-wrap:wrap; gap:10px; }',
    '    .inbox-status { font-size:15px; font-weight:800; color:#38bdf8; }',
    '    .btn-refresh { background:#1e293b; color:#fff; border:1px solid var(--border); padding:8px 14px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; }',
    '    .mail-list { background:var(--card); border:1px solid var(--border); border-radius:14px; overflow:hidden; }',
    '    .mail-row { border-bottom:1px solid var(--border); padding:16px 18px; cursor:pointer; transition:background 0.15s; }',
    '    .mail-row:last-child { border-bottom:none; }',
    '    .mail-row:hover { background:var(--card-hover); }',
    '    .mail-top { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }',
    '    .mail-subj { font-size:15px; font-weight:700; color:#fff; }',
    '    .mail-meta { font-size:12px; color:var(--muted); margin-top:4px; }',
    '    .mail-snippet { font-size:13px; color:#cbd5e1; margin-top:8px; }',
    '    .code-badge { background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.45); color:#34d399; padding:6px 12px; border-radius:8px; font-weight:800; font-size:15px; display:inline-flex; align-items:center; gap:8px; }',
    '    .copy-btn { background:var(--emerald); color:#06281e; border:none; padding:4px 10px; border-radius:6px; font-weight:800; font-size:12px; cursor:pointer; }',
    '    .mail-body { display:none; margin-top:12px; padding:14px; background:#090d16; border:1px solid var(--border); border-radius:10px; font-size:13px; color:#e2e8f0; white-space:pre-wrap; line-height:1.6; }',
    '    .mail-row.open .mail-body { display:block; }',
    '    .empty-box { padding:45px 20px; text-align:center; color:var(--muted); font-size:14px; line-height:1.7; }',
    '    .err-msg { background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); color:#fca5a5; padding:12px 16px; border-radius:10px; font-size:13px; margin-top:14px; display:none; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="header">',
    '    <a href="/mailbox" class="brand">📬 VeloxPost 専用メール受信BOX</a>',
    '    <div><a href="/dashboard" class="nav-btn">⬅ マイページ</a></div>',
    '  </div>',
    '  <div class="container">',
    '    <div class="auth-card">',
    '      <h1 class="title">🔐 アカウント専用メール受信トレイ</h1>',
    '      <p class="subtitle">納品データの「メールアドレス」と「メールPW（mpw_... または Xログインパスワード）」を入力すると、そのアドレス宛てに届いたXの確認メールや6桁認証コードが新しい順にずらっと表示されます。</p>',
    '      <form id="inboxForm" method="POST" action="/mailbox" class="form-grid">',
    '        <div class="field">',
    '          <label>📧 メールアドレス</label>',
    '          <input type="email" name="email" id="emailInput" placeholder="例: yamato_mori_82@netbaseget.com" value="' + escapeHtmlServer(prefillEmail) + '" required />',
    '        </div>',
    '        <div class="field">',
    '          <label>🔑 メールPW（またはXパスワード）</label>',
    '          <input type="password" name="password" id="passInput" placeholder="mpw_xxxxxxxx または Xパスワード" value="' + escapeHtmlServer(prefillPass) + '" required />',
    '        </div>',
    '        <button type="submit" class="btn-primary" id="submitBtn">📂 受信BOXを開く</button>',
    '      </form>',
    '      <div id="errorBox" class="err-msg"></div>',
    '      <div id="savedAccountsBar" class="saved-bar" style="display:none;"></div>',
    '    </div>',
    '    <div id="inboxSection" style="display:none;">',
    '      <div class="inbox-header">',
    '        <div class="inbox-status" id="inboxTitle">📥 受信トレイ</div>',
    '        <div style="display:flex;gap:10px;align-items:center;">',
    '          <label style="font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:5px;cursor:pointer;">',
    '            <input type="checkbox" id="autoRefreshToggle" checked /> 15秒ごとに自動更新',
    '          </label>',
    '          <button type="button" class="btn-refresh" id="refreshBtn">🔄 最新メールを受信</button>',
    '        </div>',
    '      </div>',
    '      <div class="mail-list" id="mailList"></div>',
    '    </div>',
    '  </div>',
    '  <script>',
    '    const INITIAL_DATA = ' + initialJson + ';',
    '    let autoTimer = null;',
    '',
    '    function loadSavedMailboxes() {',
    '      try {',
    '        const list = JSON.parse(localStorage.getItem("vp_saved_mailboxes") || "[]");',
    '        const bar = document.getElementById("savedAccountsBar");',
    '        if (!Array.isArray(list) || list.length === 0) { bar.style.display = "none"; return; }',
    '        bar.style.display = "flex";',
    '        bar.innerHTML = "";',
    '        const label = document.createElement("span");',
    '        label.style.cssText = "font-size:12px;color:#94a3b8;";',
    '        label.textContent = "履歴から1クリック切替:";',
    '        bar.appendChild(label);',
    '        list.forEach(item => {',
    '          const btn = document.createElement("button");',
    '          btn.type = "button";',
    '          btn.className = "saved-pill";',
    '          btn.textContent = item.userId ? (item.userId + " (" + item.email + ")") : item.email;',
    '          btn.addEventListener("click", () => {',
    '            document.getElementById("emailInput").value = item.email;',
    '            document.getElementById("passInput").value = item.password;',
    '            fetchInbox(null, false);',
    '          });',
    '          bar.appendChild(btn);',
    '        });',
    '      } catch (e) {}',
    '    }',
    '',
    '    function saveMailboxHistory(email, password, userId) {',
    '      try {',
    '        let list = JSON.parse(localStorage.getItem("vp_saved_mailboxes") || "[]");',
    '        list = list.filter(x => x.email !== email);',
    '        list.unshift({ email, password, userId: userId || "" });',
    '        localStorage.setItem("vp_saved_mailboxes", JSON.stringify(list.slice(0, 12)));',
    '        loadSavedMailboxes();',
    '      } catch (e) {}',
    '    }',
    '',
    '    function renderMailboxResult(data, email, password) {',
    '      const errBox = document.getElementById("errorBox");',
    '      if (!data || !data.ok) {',
    '        errBox.textContent = "⚠️ " + ((data && data.error) ? data.error : "照会に失敗しました");',
    '        errBox.style.display = "block";',
    '        return;',
    '      }',
    '      errBox.style.display = "none";',
    '      if (email && password) saveMailboxHistory(email, password, data.userId);',
    '      document.getElementById("inboxSection").style.display = "block";',
    '      document.getElementById("inboxTitle").textContent =',
    '        "📥 " + data.email + (data.userId ? " (" + data.userId + ")" : "") + " の受信トレイ (" + data.count + "件)";',
    '',
    '      const listEl = document.getElementById("mailList");',
    '      listEl.innerHTML = "";',
    '      if (!Array.isArray(data.messages) || data.messages.length === 0) {',
    '        const empty = document.createElement("div");',
    '        empty.className = "empty-box";',
    '        empty.innerHTML = "📭 現在このメールアドレス宛てに届いている新着メールはありません。<br>Xの画面で「コードを送信 (Send code)」を押してから数秒後に「🔄 最新メールを受信」を押してください。";',
    '        listEl.appendChild(empty);',
    '        return;',
    '      }',
    '',
    '      data.messages.forEach((m, idx) => {',
    '        const row = document.createElement("div");',
    '        row.className = "mail-row" + (idx === 0 ? " open" : "");',
    '        row.addEventListener("click", () => row.classList.toggle("open"));',
    '',
    '        const top = document.createElement("div");',
    '        top.className = "mail-top";',
    '',
    '        const left = document.createElement("div");',
    '        const subj = document.createElement("div");',
    '        subj.className = "mail-subj";',
    '        subj.textContent = m.subject || "(件名なし)";',
    '        const meta = document.createElement("div");',
    '        meta.className = "mail-meta";',
    '        meta.textContent = "🕒 " + (m.date || "") + " ｜ 差出人: " + (m.from || "X");',
    '        left.appendChild(subj);',
    '        left.appendChild(meta);',
    '        top.appendChild(left);',
    '',
    '        if (m.code) {',
    '          const badge = document.createElement("div");',
    '          badge.className = "code-badge";',
    '          const codeSpan = document.createElement("span");',
    '          codeSpan.textContent = "🔢 コード: " + m.code;',
    '          const copyBtn = document.createElement("button");',
    '          copyBtn.type = "button";',
    '          copyBtn.className = "copy-btn";',
    '          copyBtn.textContent = "コピー";',
    '          copyBtn.addEventListener("click", (ev) => {',
    '            ev.stopPropagation();',
    '            navigator.clipboard.writeText(m.code);',
    '            copyBtn.textContent = "✅ コピー完了!";',
    '            setTimeout(() => { copyBtn.textContent = "コピー"; }, 1600);',
    '          });',
    '          badge.appendChild(codeSpan);',
    '          badge.appendChild(copyBtn);',
    '          top.appendChild(badge);',
    '        }',
    '',
    '        const snippet = document.createElement("div");',
    '        snippet.className = "mail-snippet";',
    '        snippet.textContent = m.snippet || "";',
    '',
    '        const body = document.createElement("div");',
    '        body.className = "mail-body";',
    '        body.textContent = m.body || m.subject || "";',
    '',
    '        row.appendChild(top);',
    '        row.appendChild(snippet);',
    '        row.appendChild(body);',
    '        listEl.appendChild(row);',
    '      });',
    '    }',
    '',
    '    async function fetchInbox(ev, isSilentRefresh = false) {',
    '      if (ev) ev.preventDefault();',
    '      const email = document.getElementById("emailInput").value.trim();',
    '      const password = document.getElementById("passInput").value.trim();',
    '      const errBox = document.getElementById("errorBox");',
    '      const btn = document.getElementById("submitBtn");',
    '      if (!email || !password) return;',
    '      errBox.style.display = "none";',
    '      if (!isSilentRefresh) {',
    '        btn.textContent = "⏳ メールサーバー照会中...";',
    '        btn.disabled = true;',
    '      }',
    '      try {',
    '        const res = await fetch("/api/mailbox/messages", {',
    '          method: "POST",',
    '          headers: { "Content-Type": "application/json" },',
    '          body: JSON.stringify({ email, password })',
    '        });',
    '        const data = await res.json();',
    '        renderMailboxResult(data, email, password);',
    '        if (data.ok && !autoTimer) {',
    '          autoTimer = setInterval(() => {',
    '            const toggle = document.getElementById("autoRefreshToggle");',
    '            if (toggle && toggle.checked && document.getElementById("inboxSection").style.display !== "none") {',
    '              fetchInbox(null, true);',
    '            }',
    '          }, 15000);',
    '        }',
    '      } catch (e) {',
    '        errBox.textContent = "⚠️ 通信エラーが発生しました: " + e.message;',
    '        errBox.style.display = "block";',
    '      } finally {',
    '        btn.textContent = "📂 受信BOXを開く";',
    '        btn.disabled = false;',
    '      }',
    '    }',
    '',
    '    document.getElementById("inboxForm").addEventListener("submit", (ev) => fetchInbox(ev, false));',
    '    document.getElementById("refreshBtn").addEventListener("click", () => fetchInbox(null, true));',
    '    loadSavedMailboxes();',
    '    if (INITIAL_DATA) {',
    '      renderMailboxResult(INITIAL_DATA, document.getElementById("emailInput").value.trim(), document.getElementById("passInput").value.trim());',
    '    }',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');
}

function registerMailboxRoutes(app, db) {
  app.post('/api/mailbox/messages', async (req, res) => {
    try {
      const result = await authenticateAndFetchMailbox(db, req.body.email, req.body.password);
      return res.status(result.status || 200).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'サーバーエラー: ' + e.message });
    }
  });

  app.get('/mailbox', async (req, res) => {
    const email = String(req.query.email || '').trim();
    const pass = String(req.query.password || req.query.mpw || '').trim();
    let initialResult = null;
    if (email && pass) {
      initialResult = await authenticateAndFetchMailbox(db, email, pass).catch(e => ({ ok: false, error: e.message }));
    }
    res.send(renderMailboxPage(email, pass, initialResult));
  });

  app.post('/mailbox', async (req, res) => {
    const email = String(req.body.email || '').trim();
    const pass = String(req.body.password || '').trim();
    const initialResult = await authenticateAndFetchMailbox(db, email, pass).catch(e => ({ ok: false, error: e.message }));
    res.send(renderMailboxPage(email, pass, initialResult));
  });
}

module.exports = { registerMailboxRoutes, authenticateAndFetchMailbox, renderMailboxPage };
