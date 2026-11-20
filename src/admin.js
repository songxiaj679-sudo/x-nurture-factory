require('dotenv').config();
process.on('uncaughtException', (err) => console.error('[AdminUI Guard] uncaughtException:', err && err.message ? err.message : err));
process.on('unhandledRejection', (err) => console.error('[AdminUI Guard] unhandledRejection:', err && err.message ? err.message : err));
const { startDomainNsWatchdog, setupMultipleDomainsBulk, syncAllDomainsZoneStatus } = require('./cloudflare_dns');
startDomainNsWatchdog();
const { startGcpInfraWatchdog, getGcpEnvironmentInfo, getLocalSystemMetrics, resizeBootDiskOnline } = require('./gcp_scaler');
startGcpInfraWatchdog();
const { startQuotaWatchdogDaemon, syncIproyalApiBalanceIfConfigured, setRemainingGbAndResume, getQuotaState } = require('./iproyal');
startQuotaWatchdogDaemon();
const { ensureCloudflareDnsForDomain, syncAllCustomDomainsDns } = require('./cloudflare_dns');
try {
  const xFiles = require('fs').readdirSync('/tmp/.X11-unix').filter(f => /^X\d+$/.test(f));
  const topNum = xFiles.map(f => parseInt(f.slice(1), 10)).sort((a, b) => b - a)[0];
  if (topNum !== undefined) { process.env.DISPLAY = ':20'; process.env.XAUTHORITY = '/home/u0_a217/.Xauthority'; }
} catch (e) {}
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { hasXaiKey, completeText, extractJson } = require('./grok_client');
const {
  db,
  updateAccountState,
  getLegacyAccountStatus,
  getAccount,
  getAllAccounts,
  getAccountsByLifecycleStatuses,
  getAccountRef,
  saveAccounts,
  stageAccountStateUpdate,
  deleteAccounts,
  updateAccountData,
} = require('./firestore');
const {
  getAccountLifecycleStatus,
  getAccountDisplayStatus,
} = require('./account_state');
const { launchXBrowser } = require('./platform_client');

let getResidentialProxyForAdmin = null;
try { ({ getResidentialProxy: getResidentialProxyForAdmin } = require('./iproyal')); } catch (e) {}
let checkAccountHealthApi = null;
let inspectUserFromExternalView = null;
let purgeProfileDirCompletely = null;
let preCheckAccountWithoutBrowser = null;
try { ({ checkAccountHealth: checkAccountHealthApi, inspectUserFromExternalView, purgeProfileDirCompletely, preCheckAccountWithoutBrowser } = require('./status_checker')); } catch (e) {}


function isInitProcessAlive() {
  try {
    if (typeof workers !== 'undefined' && workers.init && workers.init.proc) return true;
    const lockFile = '/tmp/x_init_worker.lock';
    if (fs.existsSync(lockFile)) {
      const pid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
      if (pid) {
        process.kill(pid, 0);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function readLiveLogTail(type, maxLines = 180) {
  try {
    const file = type === 'init' ? '/tmp/x_init_live.log' : '/tmp/x_farming_live.log';
    let lines = [];
    if (fs.existsSync(file)) {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    }
    // PM2のログファイルからもフォールバック取得
    if (lines.length === 0) {
      const pm2Log = type === 'init'
        ? '/home/u0_a217/.pm2/logs/x-admin-ui-out.log'
        : '/home/u0_a217/.pm2/logs/x-batch-engine-out.log';
      if (fs.existsSync(pm2Log)) {
        lines = fs.readFileSync(pm2Log, 'utf8').split(/\r?\n/).filter(Boolean);
      }
    }
    return lines.slice(-maxLines);
  } catch (e) {
    return [];
  }
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
require('./luxury_web_funnel').attachLuxuryWebFunnel(app, db);
require('./affiliate_page').registerAffiliatePageRoutes(app, require('./firestore').db);

const upload = multer({ storage: multer.memoryStorage() });
const { registerLandingAndCustomerWebRoutes } = require('./landing_page');
registerLandingAndCustomerWebRoutes(app, db);
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || 'xfarm2026').trim();
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase();
  const pubPaths = ['/lp', '/studio', '/affiliate', '/post', '/lp-client.js', '/welcome', '/auth/tg', '/dashboard', '/legal', '/uploads', '/favicon.ico', '/robots.txt', '/api/lp-track', '/api/web-ai-spintax', '/api/web-launch', '/api/web-create-checkout', '/api/web-order-status', '/api/web-auth', '/api/web-me', '/api/web-logout', '/api/web-upload-arch-diagram', '/api/web-verify-token', '/api/web-save-item', '/api/web-delete-item', '/api/web-switch-country', '/api/web-toggle-engine', '/api/web-trigger-now'];
  if (pubPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  if ((host.includes('appflowsystem.com') || host.includes('trycloudflare.com')) && req.path === '/' && (!req.query || req.query.admin !== '1')) return next();
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return next();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (!req.socket.encrypted && forwardedProto !== 'https') {
    return res.status(426).send('HTTPS is required for admin access');
  }
  const b64 = (req.headers.authorization || "").split(" ")[1] || "";
  const [u, p] = Buffer.from(b64, "base64").toString().split(":");
  if (u === ADMIN_USER && p === ADMIN_PASS) return next();
  res.set("WWW-Authenticate", "Basic realm=\"X-Nurture-Factory\"");
  return res.status(401).send("Authentication required");
});

let accountsCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30 * 1000;

const STATUS_META = {
  standby:     { group: "standby", label: "⚪ 1.初期設定待ち",     bg: "#455a64", border: "#90a4ae" },
  reset:       { group: "standby", label: "🧹 1.過去ツイ洗浄待ち", bg: "#5e35b1", border: "#b388ff" },
  farming:     { group: "farming", label: "🌱 2.表示制限定期処理中", bg: "#2e7d32", border: "#69f0ae" },
  cleared:     { group: "ready",   label: "🟢 完成・出荷可能",     bg: "#00695c", border: "#00e676" },
  active_own:  { group: "own",     label: "🔵 自社利用中",         bg: "#0d47a1", border: "#40c4ff" },
  sold:        { group: "sold",    label: "📦 出荷済み(切離)",     bg: "#37474f", border: "#b0bec5" },
  robot:       { group: "robot",   label: "🤖 ロボット解除待ち",   bg: "#ad1457", border: "#ff80ab" },
  app_lock:    { group: "applock", label: "📱 アプリロック(低優先)", bg: "#e65100", border: "#ffb74d" },
  unavailable: { group: "trouble", label: "🚨 凍結・不良",         bg: "#b71c1c", border: "#ff5252" }
};

function normalizeStatus(rawStatus, errorReason = '', lifecycleStatus = '') {
  const errStr = String(errorReason || '').toLowerCase();
  if (errStr.includes('app_lock') || errStr.includes('アプリ')) return 'app_lock';
  if (!rawStatus && !lifecycleStatus) return 'standby';
  const displayStatus = getAccountDisplayStatus({
    status: rawStatus,
    lifecycleStatus,
  });
  if (displayStatus === 'applock') return 'app_lock';
  if (STATUS_META[displayStatus]) return displayStatus;
  return getLegacyAccountStatus(displayStatus);
}

async function getAccountsCached(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && accountsCache && (now - lastCacheTime < CACHE_TTL_MS)) {
    return accountsCache;
  }
  try {
    const snapshot = await Promise.race([
      getAllAccounts(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DB応答タイムアウト(10秒)")), 10000))
    ]);
    const list = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      d.normStatus = normalizeStatus(d.status, d.errorReason, d.lifecycleStatus);
      d.group = STATUS_META[d.normStatus].group;
      list.push({ id: doc.id, ...d });
    });
    accountsCache = list;
    lastCacheTime = Date.now();
    return list;
  } catch (e) {
    console.error("⚠️ DB取得エラーまたはタイムアウト:", e.message);
    if (accountsCache) return accountsCache;
    throw e;
  }
}

function invalidateCache() {
  accountsCache = null;
  lastCacheTime = 0;
}

let initWorkerProc = null;
let farmingWorkerProc = null;
let initWorkerLogs = [];
const MAX_LOG_LINES = 100;

function appendWorkerLog(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  for (const l of lines) {
    const ts = new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' });
    initWorkerLogs.push(`[${ts}] ${l}`);
    if (initWorkerLogs.length > MAX_LOG_LINES) initWorkerLogs.shift();
  }
}

function formatDateJST(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeJsStr(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function fastParseAccountLines(rawText) {
  const lines = String(rawText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const parsed = [];

  const isAuthToken = (s) => /^[a-fA-F0-9]{40}$/.test(s);
  const isCt0 = (s) => /^[a-fA-F0-9]{32,160}$/.test(s) && !isAuthToken(s);
  const isEmail = (s) => /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(s);
  const isPhone = (s) => /^\+?\d{9,15}$/.test(s);
  // Base32 2FAシード (12〜64文字、大文字または数字2〜7を含むBase32構成)
  const is2FA = (s) => {
    const clean = String(s || '').replace(/\s+/g, '');
    if (!/^[A-Z2-7]{12,64}$/i.test(clean)) return false;
    if (isAuthToken(clean) || isCt0(clean)) return false;
    // 単なる英小文字のみのパスワードと区別するため、すべて大文字か数字2-7を含むものを2FAと判定
    return /^[A-Z2-7]{12,64}$/.test(clean) || (/[2-7]/.test(clean) && clean.length >= 16);
  };

  for (let line of lines) {
    // もし otpauth:// URL が含まれていれば secret= を抜き出す
    const otpMatch = line.match(/secret=([A-Z2-7]{12,64})/i);
    let extractedOtpSecret = otpMatch ? otpMatch[1].toUpperCase() : '';

    // Cookie形式 (auth_token=xxx; ct0=yyy) が含まれている場合の事前抽出
    let cookieToken = '';
    let cookieCt0 = '';
    const mTok = line.match(/auth_token=([a-fA-F0-9]{40})/i);
    if (mTok) cookieToken = mTok[1].toLowerCase();
    const mCt0 = line.match(/ct0=([a-fA-F0-9]{32,160})/i);
    if (mCt0) cookieCt0 = mCt0[1].toLowerCase();

    if (isAuthToken(line)) {
      parsed.push({
        userId: 'pending_' + line.substring(0, 6),
        password: '', email: '', emailPassword: '', twoFactorKey: '', authToken: line.toLowerCase(), ct0: ''
      });
      continue;
    }

    let delim = null;
    if (line.includes('----')) delim = '----';
    else if (line.includes('\t')) delim = '\t';
    else if (line.includes('|')) delim = '|';
    else if (line.includes(':')) delim = ':';
    else if (line.includes(';')) delim = ';';
    else if (line.includes(',')) delim = ',';
    else if (/\s+/.test(line)) delim = /\s+/;

    if (!delim) continue;
    const rawParts = line.split(delim).map(p => p.trim()).filter( p => p !== undefined );
    if (rawParts.length < 2 && !cookieToken) continue;

    let userId = '', password = '', email = '', emailPassword = '', twoFactorKey = extractedOtpSecret, authToken = cookieToken, ct0 = cookieCt0;
    const usedIdx = new Set();

    // Pass 1: 確実に判別できる AuthToken (40桁hex), Email, Ct0 (長尺hex) を特定
    rawParts.forEach((p, idx) => {
      if (!p) { usedIdx.add(idx); return; }
      const cleanP = p.replace(/^auth_token=/i, '').replace(/^ct0=/i, '');
      if (!authToken && isAuthToken(cleanP)) {
        authToken = cleanP.toLowerCase();
        usedIdx.add(idx);
      } else if (!email && isEmail(p)) {
        email = p;
        usedIdx.add(idx);
      } else if (!ct0 && idx >= 2 && isCt0(cleanP)) {
        ct0 = cleanP.toLowerCase();
        usedIdx.add(idx);
      }
    });

    // Pass 2: 2FAシード (idx >= 2) を特定
    rawParts.forEach((p, idx) => {
      if (usedIdx.has(idx) || !p) return;
      if (!twoFactorKey && idx >= 2 && is2FA(p)) {
        twoFactorKey = p.replace(/\s+/g, '').toUpperCase();
        usedIdx.add(idx);
      }
    });

    // Pass 3: メールの直後の未使用フィールドはメールパスワードとして優先取得
    if (email) {
      const emailIdx = rawParts.indexOf(email);
      const nextIdx = emailIdx + 1;
      if (nextIdx < rawParts.length && !usedIdx.has(nextIdx) && rawParts[nextIdx]) {
        const candidate = rawParts[nextIdx];
        if (emailIdx >= 1 && !is2FA(candidate) && !isAuthToken(candidate) && !isPhone(candidate)) {
          emailPassword = candidate;
          usedIdx.add(nextIdx);
        }
      }
    }

    // Pass 4: 残ったフィールドを順番 (userId -> password -> emailPassword / twoFactorKey) に割り当て
    const leftovers = [];
    rawParts.forEach((p, idx) => {
      if (!usedIdx.has(idx) && p && !isPhone(p)) leftovers.push({ val: p, idx });
    });

    if (leftovers.length > 0) userId = leftovers.shift().val.replace(/^@/, '');
    if (leftovers.length > 0) password = leftovers.shift().val;
    if (leftovers.length > 0) {
      const nextVal = leftovers.shift().val;
      if (email && !emailPassword) emailPassword = nextVal;
      else if (!twoFactorKey && /^[A-Za-z0-9]{12,64}$/.test(nextVal)) twoFactorKey = nextVal.toUpperCase();
      else if (!emailPassword) emailPassword = nextVal;
    }
    if (leftovers.length > 0 && !twoFactorKey) {
      const cand2fa = leftovers.shift().val;
      if (/^[A-Za-z0-9]{12,64}$/.test(cand2fa)) twoFactorKey = cand2fa.toUpperCase();
    }

    if (userId || authToken) {
      parsed.push({
        userId: userId || ('pending_' + (authToken ? authToken.substring(0, 6) : Math.random().toString(36).slice(2, 8))),
        password, email, emailPassword, twoFactorKey, authToken, ct0
      });
    }
  }
  return parsed;
}

async function extractTextForGemini(file) {
  const mime = file.mimetype;
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (mime.startsWith('image/') || mime === 'application/pdf') return { inlineData: { data: file.buffer.toString('base64'), mimeType: mime } };
  if (ext === 'xlsx' || ext === 'xls') return `【Excel】\n${xlsx.utils.sheet_to_txt(xlsx.read(file.buffer, { type: 'buffer' }).Sheets[xlsx.read(file.buffer, { type: 'buffer' }).SheetNames[0]])}`;
  if (ext === 'docx') return `【Word】\n${(await mammoth.extractRawText({ buffer: file.buffer })).value}`;
  return `【テキスト】\n${file.buffer.toString('utf-8')}`;
}

async function parseWithGemini(promptParts) {
  const parts = Array.isArray(promptParts) ? promptParts : [promptParts];
  const hasBinaryPdf = parts.some(part => part && part.inlineData && String(part.inlineData.mimeType || '').includes('pdf'));
  if (hasXaiKey() && !hasBinaryPdf) {
    const content = [{
      type: 'text',
      text: 'データ抽出のプロとしてXアカウント情報をJSON配列で出力して。【キー】userId(@外す), password, email, emailPassword, twoFactorKey, authToken。ない項目は空文字。'
    }];
    for (const part of parts) {
      if (typeof part === 'string') content.push({ type: 'text', text: part });
      else if (part && part.inlineData && part.inlineData.data) {
        const mime = part.inlineData.mimeType || 'image/jpeg';
        content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${part.inlineData.data}` } });
      }
    }
    const { text } = await completeText({
      tier: 'nurture',
      messages: [{ role: 'user', content }],
      json: true,
      temperature: 0.2
    });
    return extractJson(text);
  }
  throw new Error('自動解析に失敗しました。XAI_API_KEY を設定するか、コロン(:)またはタブ区切りのテキストで入力してください。');
}

async function bulkSaveAccounts(accounts, initialStatus = 'standby') {
  const records = accounts.map((acc) => ({
    userId: String(acc.userId || '').replace(/^@/, '').trim(),
    password: acc.password || '',
    email: acc.email || '',
    emailPassword: acc.emailPassword || '',
    twoFactorKey: (acc.twoFactorKey || acc.twoFactorSecret || '').trim(),
    authToken: String(acc.authToken || '').trim(),
    ...(acc.ct0 ? { ct0: acc.ct0 } : {}),
    status: initialStatus,
    source: 'imported',
    originType: 'imported',
    isNewborn: false,
    farmingStage: initialStatus === 'standby' ? 1 : 2,
    farmingCycles: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await saveAccounts(records, { defaultStatus: initialStatus });
  invalidateCache();
}


function explainErrorReason(rawReason, status) {
  const r = String(rawReason || '').trim();
  if (!r) {
    if (status === 'unavailable') return '🚨 凍結またはトークン無効（詳細コード未記録）';
    if (status === 'robot') return '🤖 ロボット認証・メールコード入力待ち';
    if (status === 'app_lock') return '📱 スマホアプリからのログイン要求ロック';
    return '';
  }
  const low = r.toLowerCase();
  if (low.includes('api_64') || low.includes('user_64') || low.includes('user_63') || low.includes('suspended') || low === 'frozen') {
    return `🚨 本凍結 [${r}]: Xのスパム/自動化検知によりアカウントが凍結されました`;
  }
  if (low.includes('invalid_token') || low.includes('top_page') || low.includes('no_session') || low.includes('logged_out') || low.includes('api_32') || low.includes('api_89')) {
    return `⚠️ トークン失効(トップ画面落ち) [${r}]: セッション期限切れ・PW変更・または作成直後の無効化`;
  }
  if (low.includes('api_326') || low.includes('access_page') || low.includes('robot')) {
    return `🤖 ロボット/メール認証ロック [${r}]: パズルまたはメール認証コードの入力が必要です`;
  }
  if (low.includes('withheld')) {
    return `🌐 国別/法的表示制限 [${r}]: アカウントが特定地域で制限されています`;
  }
  if (low.includes('app_lock')) {
    return `📱 アプリ強制ロック [${r}]: モバイル版Xアプリからのみ解除可能`;
  }
  return `⚠️ 異常検知 [${r}]`;
}

function sanitizeEmailPassForExport(rawPass, email = '') {
  const s = String(rawPass || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const genMpw = (em) => {
    if (!em) return 'mpw_velox2026';
    return 'mpw_' + crypto.createHash('sha256').update('velox_mbox_salt_2026_' + em).digest('hex').slice(0, 8);
  };
  if (!s) return cleanEmail ? genMpw(cleanEmail) : '';
  const catchallPass = (process.env.CATCHALL_IMAP_PASS || '').trim();
  if (s.includes('|') || (catchallPass && s.includes(catchallPass))) {
    return genMpw(cleanEmail);
  }
  return s;
}
function buildCsvString(accountDocs) {
  const csvRows = [['ユーザーID', 'パスワード', 'メールアドレス', 'メールパスワード', '2FAキー', 'バックアップコード', 'AuthToken', '出荷メモ'].join(',')];
  accountDocs.forEach(d => {
    csvRows.push([
      d.userId || '', d.password || '', d.email || '',
      sanitizeEmailPassForExport(d.emailPassword, d.email), d.twoFactorKey || d.twoFactorSecret || '', d.backupCode || '', d.authToken || '', d.buyerNote || ''
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  });
  return '\uFEFF' + csvRows.join('\n');
}

// クライアントスクリプト（内部でバッククォートを一切使わず構文エラーを100%防止）
const CLIENT_SCRIPT_RAW = String.raw`
function copyTotpCode(secret, event) {
  if (event) event.stopPropagation();
  if (!secret) return alert('2FAキーが登録されていません');
  fetch('/api/totp?secret=' + encodeURIComponent(secret))
    .then(r => r.json())
    .then(d => {
      if (!d.ok) return alert(d.error);
      navigator.clipboard.writeText(d.otp).then(() => {
        showToast('🔢 6桁コード [' + d.otp + '] をコピーしました！(残り' + d.remainSec + '秒)');
      });
    });
}

function copyAccountProxy(docId, authToken, event) {
  if (event) event.stopPropagation();
  fetch('/api/get-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId, authToken })
  }).then(r => r.json()).then(d => {
    if (!d.ok) return alert('プロキシ取得エラー: ' + d.error);
    navigator.clipboard.writeText(d.formatted).then(() => {
      showToast('🌐 定期処理用固定プロキシをコピーしました！(' + d.proxy.host + ':' + d.proxy.port + ')');
    });
  });
}


function scanClearedStock() {
  if (!confirm('「🟢 完成・在庫」および「🌱 養殖中」のアカウントを高速診断し、事後凍結されたアカウントが混ざっていれば自動で「🚨 凍結・不良」へ排除しますか？')) return;
  showToast('🛡️ 完成在庫の生存・凍結チェックを実行中...');
  fetch('/api/audit-cleared-stock', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (!d.ok) return alert('エラー: ' + d.error);
      alert(d.message);
      location.reload();
    })
    .catch(e => alert('通信エラー: ' + e.message));
}

function scanRobotFrozen() {
  if (!confirm('「🤖 ロボット解除待ち」のアカウントをAPIで一括検査し、既に凍結されているアカウントを自動で「🚨 凍結・不良」へ振り分けますか？')) return;
  showToast('🔍 凍結・生存ステータスを高速診断中...');
  fetch('/api/check-robot-frozen', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (!d.ok) return alert('エラー: ' + d.error);
      alert(d.message);
      location.reload();
    })
    .catch(e => alert('通信エラー: ' + e.message));
}

function setEmuTarget(docId, event) {
  if (event) event.stopPropagation();
  fetch('/api/select-emu-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId })
  }).then(r => r.json()).then(d => {
    if (!d.ok) return alert('切替エラー: ' + d.error);
    renderActiveEmuBar(d.active);
    showToast('🎯 プロキシを @' + d.active.userId + ' 専用に自動切替しました！');
  });
}

function markActiveAccountStatus(docId, status, label, event) {
  if (event) event.stopPropagation();
  fetch('/update-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId, status })
  }).then(() => {
    showToast('✅ ' + label + ' へ移動しました');
    setTimeout(() => location.reload(), 600);
  });
}

function renderActiveEmuBar(acc) {
  const bar = document.getElementById('emu-active-bar');
  if (!bar) return;
  if (!acc) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  const sessionPart = (acc.proxy && acc.proxy.pass) ? acc.proxy.pass.slice(-14) : '';
  const safeId = String(acc.userId || '').replace(/'/g, "\\'");
  const safePw = String(acc.password || '').replace(/'/g, "\\'");
  const safeMail = String(acc.email || '').replace(/'/g, "\\'");
  const safeTwoFa = String(acc.twoFa || '').replace(/'/g, "\\'");
  const safeDocId = String(acc.docId || '').replace(/'/g, "\\'");

  let html = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%;">';
  html += '<span style="background:#ffeb3b;color:#000;font-weight:bold;padding:4px 10px;border-radius:4px;">🎯 現在エミュ接続中のプロキシ</span>';
  html += '<strong style="font-size:16px;color:#00e676;">@' + safeId + '</strong>';
  html += '<span style="font-size:12px;color:#bbb;">(IPセッション: ...' + sessionPart + ')</span>';
  html += '<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">';
  html += '<button type="button" class="btn-sm" style="background:#0288d1;font-weight:bold;padding:6px 12px;" onclick="copyToClipboard(\'' + safeId + '\', event)">① IDをコピー</button>';
  html += '<button type="button" class="btn-sm" style="background:#00897b;font-weight:bold;padding:6px 12px;" onclick="copyToClipboard(\'' + safePw + '\', event)">② PWをコピー</button>';
  if (acc.email) {
    html += '<button type="button" class="btn-sm" style="background:#5e35b1;font-weight:bold;padding:6px 12px;" onclick="copyToClipboard(\'' + safeMail + '\', event)">③ メールをコピー</button>';
  }
  if (acc.twoFa) {
    html += '<button type="button" class="btn-sm" style="background:#fbc02d;color:#000;font-weight:bold;padding:6px 12px;" onclick="copyTotpCode(\'' + safeTwoFa + '\', event)">④ 6桁2FAをコピー</button>';
  }
  html += '<button type="button" class="btn-sm" style="background:#00c853;color:#000;font-weight:bold;padding:6px 12px;" onclick="resolveRobot(\'' + safeDocId + '\', event)">✅ 解除完了(次へ)</button>';
  html += '<button type="button" class="btn-sm" style="background:#b71c1c;color:#fff;font-weight:bold;padding:6px 12px;" onclick="markActiveAccountStatus(\'' + safeDocId + '\', \'unavailable\', \'🚨凍結・不良\', event)">🚨 凍結・不良へ移動</button>';
  html += '</div></div>';
  bar.innerHTML = html;
}

window.addEventListener('DOMContentLoaded', () => {
  fetch('/api/current-emu-account').then(r => r.json()).then(d => {
    if (d && d.active) renderActiveEmuBar(d.active);
  }).catch(() => {});
});


function toggleDomainPanel() {
  const panel = document.getElementById('domain-health-panel');
  if (!panel) return;
  const show = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = show ? 'block' : 'none';
  if (show) loadDomainHealthStatus();
}

function loadDomainHealthStatus() {
  const tbody = document.getElementById('domain-health-tbody');
  const summaryEl = document.getElementById('domain-health-summary');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:12px;">⏳ ドメイン状態を読み込み中...</td></tr>';
  fetch('/api/domains/status')
    .then(r => r.json())
    .then(d => {
      if (!d.ok) return alert('取得エラー: ' + d.error);
      const list = d.domains || [];
      let activeCnt = 0;
      let coolCnt = 0;
      let rows = '';
      list.forEach((item, idx) => {
        const isPendingNs = item.pendingNsActivation || item.zoneStatus === 'pending';
        if (item.isCooling || item.disabled || isPendingNs) coolCnt++;
        else activeCnt++;

        const maxStreak = item.maxRejectStreak || 3;
        let badgeHtml = '';
        if (item.disabled) {
          badgeHtml = item.burnedAt
            ? '<span style="background:#b71c1c;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;font-size:11px;">🛑 汚染自動隔離 (' + maxStreak + '回拒絶)</span>'
            : '<span style="background:#b71c1c;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;font-size:11px;">🚫 停止中</span>';
        } else if (isPendingNs) {
          badgeHtml = '<span style="background:#6a1b9a;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;font-size:11px;">⏳ NS浸透待ち (Cloudflare Pending)</span>';
        } else if (item.isCooling) {
          badgeHtml = '<span style="background:#0277bd;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;font-size:11px;">🧊 冷却中 (残り' + item.remainHours + 'h)</span>';
        } else if (item.rejectedStreak >= 2) {
          badgeHtml = '<span style="background:#e65100;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;font-size:11px;">⚠️ 警戒稼働中</span>';
        } else {
          badgeHtml = '<span style="background:#2e7d32;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;font-size:11px;">🟢 正常稼働中</span>';
        }

        const rejColor = item.rejectedStreak >= maxStreak ? '#ff5252' : (item.rejectedStreak >= 2 ? '#ffb74d' : '#69f0ae');
        const safeDom = item.domain.replace(/'/g, "\\'");
        rows += '<tr style="border-bottom:1px solid #2c2c34;">'
          + '<td style="text-align:center;color:#888;">' + (idx + 1) + '</td>'
          + '<td style="font-weight:bold;color:#fff;font-family:monospace;font-size:13px;">' + item.domain + '</td>'
          + '<td>' + badgeHtml + '</td>'
          + '<td><strong style="color:' + rejColor + ';font-size:13px;">' + item.rejectedStreak + ' / ' + maxStreak + '回</strong> <span style="color:#888;font-size:11px;">(直近失敗:' + item.failStreak + ')</span></td>'
          + '<td style="color:#40c4ff;font-weight:bold;">🎉 ' + item.successCount + ' 件</td>'
          + '<td style="text-align:right;">'
          + '<button type="button" class="btn-sm" style="background:#00897b;font-weight:bold;" onclick="resetSingleDomain(\'' + safeDom + '\')">🔄 失敗0にリセット</button> '
          + '<button type="button" class="btn-sm" style="background:#c62828;" onclick="removeSingleDomain(\'' + safeDom + '\')">🗑️ 除外</button>'
          + '</td>'
          + '</tr>';
      });
      if (!rows) {
        rows = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:12px;">登録されている独自ドメインがありません</td></tr>';
      }
      if (tbody) tbody.innerHTML = rows;
      if (summaryEl) summaryEl.innerText = '全 ' + list.length + ' ドメイン (🟢稼働可能: ' + activeCnt + ' / 🧊冷却中: ' + coolCnt + ')';
      const btnBadge = document.getElementById('domain-btn-badge');
      if (btnBadge) btnBadge.innerText = activeCnt + '/' + list.length + '稼働';
    })
    .catch(e => {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="color:#f44336;padding:10px;">通信エラー: ' + e.message + '</td></tr>';
    });
}

function addNewCustomDomains() {
  const inp = document.getElementById('new-domain-input');
  if (!inp || !inp.value.trim()) return alert('追加するドメイン名を入力してください（例: example.com）');
  fetch('/api/domains/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawDomains: inp.value.trim() })
  }).then(r => r.json()).then(d => {
    if (d.added > 0) {
      inp.value = '';
      loadDomainHealthStatus();
    }
    if (!d.ok) return alert('追加・設定エラー: ' + d.error);
    showToast('✅ ' + d.message);
  }).catch(e => alert('追加エラー: ' + e.message));
}

function resetSingleDomain(domain) {
  fetch('/api/domains/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain })
  }).then(r => r.json()).then(d => {
    if (!d.ok) return alert('エラー: ' + d.error);
    showToast('🔄 ' + d.message);
    loadDomainHealthStatus();
  });
}

function removeSingleDomain(domain) {
  if (!confirm('ドメイン「' + domain + '」をローテーション（.env）から除外しますか？')) return;
  fetch('/api/domains/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain })
  }).then(r => r.json()).then(d => {
    if (!d.ok) return alert('エラー: ' + d.error);
    showToast('🗑️ ' + d.message);
    loadDomainHealthStatus();
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2400);
}

function filterByNote(note, event) {
  if (event) event.stopPropagation();
  location.href = '/list?tab=sold&q=' + encodeURIComponent(note);
}

function copyToClipboard(text, event) {
  if (event) event.stopPropagation();
  navigator.clipboard.writeText(text).then(() => showToast('📋 コピーしました！'));
}

function copySelectedBulk(mode) {
  const checked = Array.from(document.querySelectorAll('.row-checkbox:checked'));
  if (checked.length === 0) return alert('まずは表のチェックボックスでアカウントを選択してください！');
  const lines = checked.map(cb => {
    const tr = document.getElementById('tr-' + cb.value);
    return decodeURIComponent(mode === 'colon' ? tr.dataset.colon : tr.dataset.tab);
  });
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    showToast('📋 選択した ' + lines.length + ' 件を一括コピーしました！');
  });
}

function updateStatus(docId, selectEl) {
  const newStatus = selectEl.value;
  const meta = (window.STATUS_META && window.STATUS_META[newStatus]) || { bg: '#455a64', border: '#90a4ae', label: newStatus };
  selectEl.style.background = meta.bg;
  selectEl.style.borderColor = meta.border;
  fetch('/update-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId, status: newStatus })
  }).then(() => showToast('✅ 変更しました: ' + meta.label));
}

function resolveRobot(docId, event) {
  if (event) event.stopPropagation();
  fetch('/resolve-robot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId })
  }).then(() => location.reload());
}

function reissueSingleCsv(docId, event) {
  if (event) event.stopPropagation();
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/export-csv';
  const inp = document.createElement('input');
  inp.type = 'hidden';
  inp.name = 'selectedIds';
  inp.value = docId;
  form.appendChild(inp);
  document.body.appendChild(form);
  form.submit();
  setTimeout(() => document.body.removeChild(form), 1000);
}

function exchangeSingle(docId, event) {
  if (event) event.stopPropagation();
  if ((window.READY_STOCK_COUNT || 0) < 1) return alert('⚠️ 「🟢 完成・在庫」が0件のため自動補充できません！');
  if (!confirm('この1件を「🚨凍結・不良」へ移動し、完成在庫から新しい1件を自動で引き当ててCSV出力しますか？')) return;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/exchange-accounts';
  const inp1 = document.createElement('input'); inp1.type = 'hidden'; inp1.name = 'selectedIds'; inp1.value = docId;
  const inp2 = document.createElement('input'); inp2.type = 'hidden'; inp2.name = 'badDisposition'; inp2.value = 'unavailable';
  form.appendChild(inp1);
  form.appendChild(inp2);
  document.body.appendChild(form);
  form.submit();
  setTimeout(() => { document.body.removeChild(form); location.reload(); }, 1800);
}

function submitExchange(badDisposition) {
  const count = document.querySelectorAll('.row-checkbox:checked').length;
  if (count === 0) return alert('交換したい不良アカウントにチェックを入れてください！');
  if ((window.READY_STOCK_COUNT || 0) < count) {
    return alert('⚠️ 完成在庫が足りません！（選択: ' + count + '件 / 現在の完成在庫: ' + (window.READY_STOCK_COUNT || 0) + '件）');
  }
  const dispLabel = badDisposition === 'reset' ? '「🧹 再育成（過去ツイ洗浄）」へ回収' : '「🚨 凍結・不良」として廃棄';
  if (!confirm('選択した ' + count + ' 件を' + dispLabel + 'し、\n「🟢 完成・在庫」から新しい ' + count + ' 件を自動補充して交換用CSVを出力しますか？')) return;

  const form = document.getElementById('bulk-form');
  document.getElementById('hidden-bad-disposition').value = badDisposition;
  form.action = '/exchange-accounts';
  form.submit();
  setTimeout(() => location.reload(), 2000);
}

function openServerBrowser(docId, authToken, event) {
  if (event) event.stopPropagation();
  showToast('🖥️ VNC上にブラウザを起動しています...');
  fetch('/open-browser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId, authToken })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      showToast('✅ VNC上にブラウザを起動しました！');
    } else {
      alert('起動エラー: ' + d.error);
    }
  }).catch(err => alert('通信エラー: ' + err.message));
}

let logTimer = null;
let logPaused = false;
let logAutoScroll = true;
let lastLogTextCache = '';

function initLogBoxScrollListener() {
  const box = document.getElementById('log-box');
  if (!box || box.dataset.boundScroll === '1') return;
  box.dataset.boundScroll = '1';
  box.addEventListener('scroll', () => {
    const distFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    logAutoScroll = distFromBottom <= 45;
    const badge = document.getElementById('log-scroll-status');
    if (badge) {
      badge.innerText = logAutoScroll ? '🟢 自動追従ON (最下部)' : '🔒 スクロール位置固定中 (上閲覧中)';
      badge.style.color = logAutoScroll ? '#00e676' : '#ffb74d';
    }
  });
}

function toggleLogBox(forceShow) {
  const wrap = document.getElementById('log-panel-wrap');
  const box = document.getElementById('log-box');
  if (!box) return;
  const targetEl = wrap || box;
  const show = forceShow !== undefined ? forceShow : (targetEl.style.display === 'none' || !targetEl.style.display);
  targetEl.style.display = show ? 'block' : 'none';
  box.style.display = show ? 'block' : 'none';
  if (show) {
    initLogBoxScrollListener();
    fetchWorkerLogs(true);
    if (!logTimer) logTimer = setInterval(() => fetchWorkerLogs(false), 2500);
  } else if (logTimer) {
    clearInterval(logTimer);
    logTimer = null;
  }
}

function togglePauseLogs() {
  logPaused = !logPaused;
  const btn = document.getElementById('btn-pause-log');
  if (btn) {
    btn.innerText = logPaused ? '▶️ 自動更新を再開' : '⏸️ 更新を一時停止';
    btn.style.background = logPaused ? '#f57c00' : '#37474f';
  }
  if (!logPaused) fetchWorkerLogs(false);
}

function scrollLogToBottom() {
  const box = document.getElementById('log-box');
  if (!box) return;
  logAutoScroll = true;
  box.scrollTop = box.scrollHeight;
  const badge = document.getElementById('log-scroll-status');
  if (badge) {
    badge.innerText = '🟢 自動追従ON (最下部)';
    badge.style.color = '#00e676';
  }
}

function copyAllWorkerLogs() {
  const box = document.getElementById('log-box');
  const txt = (box ? box.innerText : lastLogTextCache) || '';
  if (!txt) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => {
      showToast('📋 ログ全文（' + txt.split('\n').length + '行）をコピーしました！');
    }).catch(() => fallbackCopyText(txt));
  } else {
    fallbackCopyText(txt);
  }
}

function fallbackCopyText(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('📋 ログ全文（' + txt.split('\n').length + '行）をコピーしました！');
  } catch (e) {
    alert('コピーに失敗しました');
  }
  document.body.removeChild(ta);
}

function fetchWorkerLogs(isInitial) {
  if (logPaused && !isInitial) return;

  // ユーザーがログ内のテキストをドラッグ選択中の場合はDOM更新をスキップして選択解除を防ぐ
  const sel = window.getSelection ? window.getSelection() : null;
  const box = document.getElementById('log-box');
  if (!isInitial && sel && sel.toString().length > 0 && box && box.contains(sel.anchorNode)) {
    return;
  }

  fetch('/worker/logs?limit=1000').then(r => r.json()).then(d => {
    if (!box) return;
    const lines = (d.logs && d.logs.length) ? d.logs : ['ログはまだありません'];
    const newText = lines.join('\n');
    const lineCountEl = document.getElementById('log-line-count');
    if (lineCountEl) lineCountEl.innerText = lines.length + '行表示中 (最大1,000行)';

    // 内容が全く同じならDOM書き換え自体を行わない（スクロール位置・選択状態の完全維持）
    if (newText === lastLogTextCache && !isInitial) return;

    const prevScrollTop = box.scrollTop;
    lastLogTextCache = newText;
    box.innerText = newText;

    if (isInitial || logAutoScroll) {
      box.scrollTop = box.scrollHeight;
    } else {
      box.scrollTop = prevScrollTop;
    }
  }).catch(() => {});
}

function startInitWorker() {
  const concEl = document.getElementById('worker-conc');
  const conc = concEl ? concEl.value : '1';
  toggleLogBox(true);
  fetch('/worker/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concurrency: conc })
  }).then(r => r.json()).then(d => {
    showToast(d.message);
    fetchWorkerLogs();
  });
}

function stopInitWorker() {
  fetch('/worker/stop', { method: 'POST' }).then(r => r.json()).then(d => {
    showToast(d.message);
    setTimeout(() => location.reload(), 800);
  });
}

function startFarmingWorker(force) {
  toggleLogBox(true);
  fetch('/worker/start-farming', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: !!force })
  }).then(r => r.json()).then(d => {
    showToast(d.message);
    fetchWorkerLogs();
  });
}

function stopFarmingWorker() {
  fetch('/worker/stop-farming', { method: 'POST' }).then(r => r.json()).then(d => {
    showToast(d.message);
    setTimeout(() => location.reload(), 800);
  });
}

let lastChecked = null;
function handleRowClick(e, docId) {
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'OPTION'].includes(e.target.tagName)) return;
  const cb = document.getElementById('cb-' + docId);
  if (!cb) return;
  cb.checked = !cb.checked;
  if (e.shiftKey && lastChecked) {
    const cbs = Array.from(document.querySelectorAll('.row-checkbox'));
    const s = cbs.indexOf(cb), end = cbs.indexOf(lastChecked);
    for (let i = Math.min(s, end); i <= Math.max(s, end); i++) cbs[i].checked = lastChecked.checked;
  }
  lastChecked = cb;
  updateSelectedCounter();
}

function toggleAll(source) {
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = source.checked);
  updateSelectedCounter();
}

function selectFirstN(n) {
  document.querySelectorAll('.row-checkbox').forEach((cb, idx) => cb.checked = (idx < n));
  updateSelectedCounter();
}

function updateSelectedCounter() {
  const el = document.getElementById('sel-count');
  if (el) el.innerText = document.querySelectorAll('.row-checkbox:checked').length;
}

function quickMoveStatus(targetSt, confirmMsg) {
  const count = document.querySelectorAll('.row-checkbox:checked').length;
  if (count === 0) return alert('まずは表のチェックボックスでアカウントを選択してください！');
  if (!confirm(count + ' 件を ' + confirmMsg)) return;
  const form = document.getElementById('bulk-form');
  document.getElementById('hidden-target-status').value = targetSt;
  form.action = '/bulk-update-status';
  form.submit();
}

function submitBulkAction(actionType) {
  const form = document.getElementById('bulk-form');
  const count = document.querySelectorAll('.row-checkbox:checked').length;
  if (count === 0) return alert('まずは表のチェックボックスでアカウントを選択してください！');

  if (actionType === 'export') {
    form.action = '/export-csv';
    form.submit();
  } else if (actionType === 'sell-export') {
    if (!confirm(count + ' 件の納品用CSVを出力し、「📦 出荷済み」タブへ移動しますか？')) return;
    form.action = '/sell-and-export';
    form.submit();
    setTimeout(() => location.reload(), 1800);
  } else if (actionType === 'delete') {
    if (confirm(count + ' 件をデータベースから完全に削除しますか？')) {
      form.action = '/delete-bulk';
      form.submit();
    }
  }
}
`;

app.get('/admin-client.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(CLIENT_SCRIPT_RAW);
});


app.get("/signup-step.png", (req, res) => { const p = path.join(__dirname, "../signup_step.png"); if (fs.existsSync(p)) { res.setHeader("Cache-Control", "no-store"); res.sendFile(p); } else { res.status(404).send("Not generated yet"); } });
app.get(['/', '/register', '/admin'], (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>アカウント登録</title>
        <style>
          body{font-family:sans-serif;background:#181818;color:#fff;padding:20px;}
          .container{max-width:780px;margin:0 auto;background:#222225;padding:30px;border-radius:10px;}
          textarea,input,select{width:100%;margin-bottom:16px;padding:12px;background:#141416;color:#fff;border:1px solid #444;border-radius:6px;}
          button{background:#00c853;color:#000;border:none;padding:16px;width:100%;font-size:18px;font-weight:bold;cursor:pointer;border-radius:6px;}
          .btn-link{display:inline-block;background:#1976d2;color:white;padding:12px 20px;text-decoration:none;border-radius:6px;margin-bottom:20px;font-weight:bold;}
        </style>
      


<style id="table-compact-fix">
  .container, body {
    max-width: 100% !important;
    box-sizing: border-box !important;
  }
  .table-scroll-wrap {
    width: 100% !important;
    overflow-x: auto !important;
    border: 1px solid #333;
    border-radius: 8px;
    background: #141416;
    padding-bottom: 6px;
  }
  .table-scroll-wrap::-webkit-scrollbar {
    height: 12px;
  }
  .table-scroll-wrap::-webkit-scrollbar-thumb {
    background: #4daafc;
    border-radius: 6px;
  }
  .table-scroll-wrap::-webkit-scrollbar-track {
    background: #222;
  }
  table {
    width: 100% !important;
    border-collapse: collapse !important;
  }
  th, td {
    padding: 6px 5px !important;
    font-size: 11.5px !important;
    white-space: nowrap;
  }
  td:nth-child(3) {
    max-width: 210px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  td:nth-child(3) span[onclick*="filterByNote"] {
    display: inline-block !important;
    max-width: 135px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    vertical-align: bottom !important;
  }
  td:nth-child(4) {
    max-width: 175px !important;
    white-space: normal !important;
  }
  .table-scroll-wrap th:last-child, .table-scroll-wrap td:last-child {
    position: sticky !important;
    right: 0 !important;
    background: #18191c !important;
    z-index: 4 !important;
    box-shadow: -4px 0 8px rgba(0,0,0,0.6) !important;
  }
  .table-scroll-wrap th:nth-last-child(2), .table-scroll-wrap td:nth-last-child(2) {
    position: sticky !important;
    right: 170px !important;
    background: #18191c !important;
    z-index: 4 !important;
    box-shadow: -2px 0 4px rgba(0,0,0,0.4) !important;
  }
</style>
</head>
      <body>
        <div class="container">
          <a href="/list" class="btn-link">📋 アカウント管理画面（一覧）を開く</a>
          <h2>📥 仕入れアカウント一括登録</h2>
          <p style="font-size:13px;color:#aaa;">海外サイトで買ったリスト（ID:PASS:TOKENのみ、メアド無し、2FA無し、コロン・タブ・----区切り・Token単体など）をそのまま貼り付けるだけで、項目を自動判別して一括登録します。</p>
          <form method="POST" action="/upload" enctype="multipart/form-data">
            <label style="font-size:13px;font-weight:bold;">登録時の初期状態:</label>
            <select name="initialStatus">
              <option value="standby" selected>⚪ 1.初期設定待ち (standby) — 日本化＆過去ツイ全消しを実行</option>
              <option value="farming">🌱 2.自動定期処理中 (farming) — 初期設定をスキップして定期処理へ</option>
              <option value="cleared">🟢 完成・出荷可能 (cleared) — すぐ販売・自社利用プールへ</option>
            </select>
            <input type="file" name="accountFile" accept="image/*,.txt,.csv,.xlsx,.xls,.pdf,.docx" />
            <textarea name="rawText" placeholder="ここに仕入れたリストをコピペ（項目が欠けていても自動判別します）..." style="height:220px;font-family:monospace;"></textarea>
            <button type="submit">🚀 一括登録する</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

app.get('/list', async (req, res) => {
  try {
    const tab = req.query.tab || 'all';
    const originFilter = req.query.origin || 'all'; // 'all' | 'pure_jp' | 'imported'
    const searchQ = (req.query.q || '').trim().toLowerCase();
    const limitNum = parseInt(req.query.limit || '200', 10);
    const forceRefresh = req.query.refresh === '1';

    let rawAllAccounts = [...(await getAccountsCached(forceRefresh))];
    const originCounts = { all: rawAllAccounts.length, pure_jp: 0, pure_en: 0, imported: 0 };
    rawAllAccounts.forEach(a => {
      if (a.originType === 'pure_en') originCounts.pure_en++;
      else if (a.isNewborn || a.originType === 'pure_jp') originCounts.pure_jp++;
      else originCounts.imported++;
    });

    let allAccounts = rawAllAccounts.filter(a => {
      if (originFilter === 'pure_jp') return (a.originType === 'pure_jp' || (a.isNewborn && a.originType !== 'pure_en'));
      if (originFilter === 'pure_en') return a.originType === 'pure_en';
      if (originFilter === 'imported') return (!a.isNewborn && a.originType !== 'pure_jp' && a.originType !== 'pure_en');
      return true;
    });

    allAccounts.sort((a, b) => {
      if (tab === 'sold') {
        const sa = a.soldAt && a.soldAt.toDate ? a.soldAt.toDate().getTime() : 0;
        const sb = b.soldAt && b.soldAt.toDate ? b.soldAt.toDate().getTime() : 0;
        if (sb !== sa) return sb - sa;
      }
      const ta = a.updatedAt && a.updatedAt.toDate ? a.updatedAt.toDate().getTime() : 0;
      const tb = b.updatedAt && b.updatedAt.toDate ? b.updatedAt.toDate().getTime() : 0;
      return tb - ta;
    });

    const tabCounts = { all: allAccounts.length, standby: 0, farming: 0, ready: 0, own: 0, sold: 0, robot: 0, applock: 0, trouble: 0 };
    allAccounts.forEach(a => { if (tabCounts[a.group] !== undefined) tabCounts[a.group]++; });

    let filtered = (tab === 'all') ? allAccounts : allAccounts.filter(a => a.group === tab);
    if (searchQ) {
      filtered = filtered.filter(a =>
        (a.userId || '').toLowerCase().includes(searchQ) ||
        (a.name || '').toLowerCase().includes(searchQ) ||
        (a.email || '').toLowerCase().includes(searchQ) ||
        (a.buyerNote || '').toLowerCase().includes(searchQ) ||
        (a.authToken || '').toLowerCase().includes(searchQ)
      );
    }

    const totalFiltered = filtered.length;
    const displayAccounts = limitNum > 0 ? filtered.slice(0, limitNum) : filtered;
    const statusStylesJson = JSON.stringify(STATUS_META);
    const isWorkerRunning = !!initWorkerProc || isInitProcessAlive();
    const isFarmingRunning = !!farmingWorkerProc;

    let guideBannerHtml = '';
    if (tab === 'ready') {
      guideBannerHtml = `
        <div class="guide-box" style="border-left:5px solid #00e676;">
          <div style="font-size:15px;font-weight:bold;color:#00e676;margin-bottom:6px;">🟢 完成・在庫プール（現在 ${tabCounts.ready} 件の在庫があります ｜ 出荷時は自動でロボット・凍結チェックが走ります）</div>
          <div style="margin-bottom:8px;">
            <button type="button" class="btn-big" style="background:#ffeb3b;color:#000;border:2px solid #fff;" onclick="scanClearedStock()">🔍 ① 出荷前に全在庫を事前検品（ロボット・凍結を自動排除）</button>
          </div>
          <input type="text" name="buyerNote" id="buyer-note-input" placeholder="📝 購入者名・注文メモ（任意: 例「田中様」「GameClub #12」など）" style="padding:11px;width:320px;background:#141416;color:#fff;border:1px solid #555;border-radius:6px;margin-right:8px;">
          <button type="button" class="btn-big" style="background:#00c853;color:#000;" onclick="submitBulkAction('sell-export')">📦 ① 選択分を販売出荷（CSV出力＋出荷済みへ）</button>
          <button type="button" class="btn-big" style="background:#0288d1;color:#fff;" onclick="quickMoveStatus('active_own', '🔵 自社利用中へ移動しますか？')">🔵 ② 選択分を自社利用へ回す</button>
        </div>`;
    } else if (tab === 'sold') {
      guideBannerHtml = `
        <div class="guide-box" style="border-left:5px solid #ffb300;">
          <div style="font-size:15px;font-weight:bold;color:#ffd54f;margin-bottom:6px;">
            📦 出荷済み保管庫 ＆ ワンクリック不良交換（現在の完成在庫: 🟢 ${tabCounts.ready} 件）
          </div>
          <div style="font-size:12px;color:#ccc;margin-bottom:10px;">
            💡 購入者から交換申請が来たら、不良アカウントにチェックを入れて下の交換ボタンを押すだけで、<b>完成在庫から自動で新しいアカウントを引き当てて差し替え用CSVを出力</b>します。
          </div>
          <button type="button" class="btn-big" style="background:#ff5252;color:#fff;" onclick="submitExchange('unavailable')">
            🔄 選択した不良垢を交換（元垢は「🚨凍結廃棄」＋ 在庫から新垢をCSV出力）
          </button>
          <button type="button" class="btn-big" style="background:#ab47bc;color:#fff;" onclick="submitExchange('reset')">
            ♻️ 選択した不良垢を交換（元垢は「🧹再育成へ回収」＋ 在庫から新垢をCSV出力）
          </button>
          <button type="button" class="btn-big" style="background:#ffa000;color:#000;" onclick="submitBulkAction('export')">
            📥 選択分をそのままCSV再発行
          </button>
          <button type="button" class="btn-big" style="background:#455a64;color:#fff;" onclick="quickMoveStatus('cleared', '🟢 出荷を取り消して「完成・在庫」へ戻しますか？')">
            ↩️ 在庫へ戻す
          </button>
        </div>`;
    } else if (tab === 'own') {
      guideBannerHtml = `
        <div class="guide-box" style="border-left:5px solid #40c4ff;">
          <div style="font-size:15px;font-weight:bold;color:#40c4ff;margin-bottom:8px;">🔵 自社利用中（アフィリエイト等で運用中のアカウントです）</div>
          <button type="button" class="btn-big" style="background:#7e57c2;color:#fff;" onclick="quickMoveStatus('reset', '🧹 選択したアカウントの過去ポストを全消去し、表示制限再育成へ回しますか？')">🧹 表示制限になったので初期化＆再育成へ回す</button>
          <button type="button" class="btn-big" style="background:#00897b;color:#fff;" onclick="quickMoveStatus('cleared', '🟢 完成・在庫プールへ戻しますか？')">↩️ 完成・在庫プールへ戻す</button>
        </div>`;
    } else if (tab === 'robot') {
      guideBannerHtml = `
        <div class="guide-box" style="border-left:5px solid #ff80ab;">
          <div style="font-size:15px;font-weight:bold;color:#ff80ab;margin-bottom:6px;">🤖 ロボット解除待ち専用タブ（現在 ${tabCounts.robot} 件）</div>
          <div style="font-size:12px;color:#ccc;margin-bottom:10px;">
            💡 右側の「🖥️ CRDで開く(UA/IP維持)」を押すと、GCPのChromeリモートデスクトップ上にこのアカウントの固定IP・UA・Cookieを維持したままブラウザが開きます。メール認証コードが求められた場合は「📩 コード取得」を押すとその場で6桁コードが表示されます。
          </div>
          <button type="button" class="btn-big" style="background:#ffeb3b;color:#000;border:2px solid #fff;" onclick="scanRobotFrozen()">🔍 ① まず凍結済みを自動で弾く（API一括診断）</button>
          <button type="button" class="btn-big" style="background:#00c853;color:#000;" onclick="quickMoveStatus('standby', '⚪ 初期設定待ちへ戻して再開しますか？')">✅ 選択分を一括で「初期設定待ち」へ戻す</button>
          <button type="button" class="btn-big" style="background:#2e7d32;color:#fff;" onclick="quickMoveStatus('farming', '🌱 自動定期処理中へ戻しますか？')">🌱 選択分を一括で「自動定期処理中」へ戻す</button>
          <button type="button" class="btn-big" style="background:#e65100;color:#fff;" onclick="quickMoveStatus('app_lock', '📱 アプリロック(低優先)タブへ移動しますか？')">📱 選択分を「アプリロック」へ移動</button>
          <button type="button" class="btn-big" style="background:#ffa000;color:#000;" onclick="submitBulkAction('export')">📋 仕入れ先への交換申請用にCSV出力</button>
          <button type="button" class="btn-big" style="background:#b71c1c;color:#fff;" onclick="quickMoveStatus('unavailable', '🚨 凍結・不良タブへ移動しますか？')">🚨 解除不能分を「凍結・不良」へ移動</button>
        </div>`;
    } else if (tab === 'applock') {
      guideBannerHtml = `
        <div class="guide-box" style="border-left:5px solid #ffb74d;">
          <div style="font-size:15px;font-weight:bold;color:#ffb74d;margin-bottom:6px;">📱 スマートフォンアプリ強制ロック保管庫（現在 ${tabCounts.applock} 件 / 低優先）</div>
          <div style="font-size:12px;color:#ccc;margin-bottom:10px;">
            💡 Webブラウザから解除できない「スマートフォンでXアプリを開いて続行してください」状態のアカウントです。「🎯エミュ切替」でエミュレータから解除するか、仕入れ先への交換申請CSVとして出力できます。
          </div>
          <button type="button" class="btn-big" style="background:#ffa000;color:#000;" onclick="submitBulkAction('export')">📋 仕入れ先への交換申請用にCSV出力</button>
          <button type="button" class="btn-big" style="background:#00c853;color:#000;" onclick="quickMoveStatus('standby', '⚪ 初期設定待ちへ戻しますか？')">✅ 解除できた分を「初期設定待ち」へ戻す</button>
          <button type="button" class="btn-big" style="background:#b71c1c;color:#fff;" onclick="quickMoveStatus('unavailable', '🚨 凍結・不良タブへ移動しますか？')">🚨 廃棄（「凍結・不良」へ移動）</button>
        </div>`;
    } else if (tab === 'trouble') {
      guideBannerHtml = `
        <div class="guide-box" style="border-left:5px solid #ff5252;">
          <div style="font-size:15px;font-weight:bold;color:#ff8a80;margin-bottom:8px;">🚨 凍結・不良（仕入れ先への交換申請用出力や一括削除ができます）</div>
          <button type="button" class="btn-big" style="background:#ffa000;color:#000;" onclick="submitBulkAction('export')">📋 仕入れ先への交換申請用に選択分をCSV出力</button>
          <button type="button" class="btn-big" style="background:#455a64;color:#fff;" onclick="quickMoveStatus('standby', '⚪ 初期設定待ちへ戻して再試行しますか？')">🔄 初期設定待ちへ戻して再トライ</button>
          <button type="button" class="btn-big" style="background:#d32f2f;color:#fff;" onclick="submitBulkAction('delete')">🗑️ 選択分をDBから完全削除</button>
        </div>`;
    } else {
      guideBannerHtml = `
        <div class="guide-box" style="border-left:5px solid #4daafc;">
          <div style="font-size:14px;font-weight:bold;color:#4daafc;margin-bottom:8px;">📋 すべて表示（ID・PW・メール・メールPW・2FA・Tokenが常時確認できます）</div>
          <input type="text" name="buyerNote" id="buyer-note-input" placeholder="📝 販売出荷時のメモ（任意）" style="padding:10px;width:220px;background:#141416;color:#fff;border:1px solid #555;border-radius:6px;margin-right:6px;">
          <button type="button" class="btn-big" style="background:#00c853;color:#000;" onclick="submitBulkAction('sell-export')">📦 選択分を販売出荷（CSV出力＋出荷済みへ）</button>
          <button type="button" class="btn-big" style="background:#0288d1;color:#fff;" onclick="quickMoveStatus('active_own', '🔵 自社利用中へ移動しますか？')">🔵 自社利用へ回す</button>
          <button type="button" class="btn-big" style="background:#7e57c2;color:#fff;" onclick="quickMoveStatus('reset', '🧹 過去ポストを全消去し、再育成へ回しますか？')">🧹 再育成(リセット)へ回す</button>
          <button type="button" class="btn-big" style="background:#d32f2f;color:#fff;" onclick="submitBulkAction('delete')">🗑️ 一括削除</button>
        </div>`;
    }

    let rowsHtml = '';
    let count = 1;

    displayAccounts.forEach(data => {
      const docId = data.id;
      const st = data.normStatus;
      const meta = STATUS_META[st] || STATUS_META.standby;
      const twoFa = data.twoFactorKey || data.twoFactorSecret || '';
      const backupCd = data.backupCode || '';
      const cleanMailPass = sanitizeEmailPassForExport(data.emailPassword, data.email);
      const encodedTab = encodeURIComponent(`${data.userId||''}\t${data.password||''}\t${data.email||''}\t${cleanMailPass}\t${twoFa}\t${backupCd}\t${data.authToken || ''}`);
      const encodedColon = encodeURIComponent(`${data.userId||''}:${data.password||''}:${data.email||''}:${cleanMailPass}:${twoFa}:${backupCd}:${data.authToken || ''}`);
      const rowStyle = (count % 10 === 0) ? 'border-bottom: 2px solid #4daafc;' : 'border-bottom: 1px solid #2c2c34;';
      const dateText = (tab === 'sold' && data.soldAt) ? `📦 ${formatDateJST(data.soldAt)}` : formatDateJST(data.updatedAt);

      const detailedErr = explainErrorReason(data.errorReason, st);
      const errBadge = (detailedErr && ['unavailable', 'robot', 'app_lock'].includes(st))
        ? `<div style="background:#3e1b1b;border:1px solid #ff5252;color:#ff8a80;font-size:11px;padding:3px 6px;border-radius:4px;margin-top:4px;line-height:1.3;max-width:250px;white-space:normal;">${detailedErr}</div>`
        : '';

      const safeBuyerNote = escapeJsStr(data.buyerNote || '');
      const noteBadge = data.buyerNote ? `<span style="background:#37474f;color:#80d8ff;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:4px;cursor:pointer;" onclick="filterByNote('${safeBuyerNote}', event)" title="クリックでこの出荷ロットを絞り込み">🏷️ ${data.buyerNote}</span>` : '';
      let originBadge = '';
      if (data.originType === 'pure_en') {
        const countryUpper = String(data.signupCountry || data.country || 'EN').toUpperCase();
        originBadge = `<span style="background:#00bcd4;color:#000;font-size:10px;font-weight:bold;padding:1px 5px;border-radius:4px;margin-left:4px;">🌐多国籍(${countryUpper})</span>`;
      } else if (data.isNewborn || data.originType === 'pure_jp') {
        originBadge = '<span style="background:#00e676;color:#000;font-size:10px;font-weight:bold;padding:1px 5px;border-radius:4px;margin-left:4px;">🇯🇵純国産</span>';
      } else {
        originBadge = '<span style="background:#37474f;color:#cfd8dc;font-size:10px;font-weight:bold;padding:1px 5px;border-radius:4px;margin-left:4px;">📦外部</span>';
      }

      const stageBadge = data.farmingStage ? `<span style="background:#0288d1;color:#fff;font-size:10px;font-weight:bold;padding:1px 5px;border-radius:4px;margin-left:3px;">Stage${data.farmingStage}</span>` : '';
      const cycleBadge = typeof data.farmingCycles === 'number' ? `<span style="background:#455a64;color:#fff;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:3px;">🔄${data.farmingCycles}回</span>` : '';
      const ageBadge = typeof data.maturityDays === 'number' ? `<span style="color:#999;font-size:10px;margin-left:3px;">(${data.maturityDays}日)</span>` : '';

      const attr = data.attributes || {};
      const dnaText = attr.job ? `🧬 ${attr.location || '日本'} / ${attr.age || ''} / ${attr.job} (${(attr.hobbies || []).join('・')})` : '🧬 ペルソナ未生成';
      let proxySessionId = '未割当';
      if (data.proxy && data.proxy.pass) {
        const m = String(data.proxy.pass).match(/_session-([a-zA-Z0-9]+)/);
        proxySessionId = m ? m[1] : '固定済';
      }
      const nextTimeStr = data.nextActionAt ? formatDateJST(data.nextActionAt) : '-';

      // 折りたたみ式のプロフィール＆育成詳細（普段は1行でスッキリ表示）
      const detailColumnHtml = `
        <details onclick="event.stopPropagation()" style="font-size:11.5px;max-width:340px;">
          <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:4px;flex-wrap:wrap;outline:none;">
            <span style="background:#2c2c34;color:#80cbc4;padding:2px 6px;border-radius:4px;font-size:10.5px;border:1px solid #444;">▶ 詳細</span>
            <strong style="color:#fff;">${data.name || '未設定'}</strong>
            ${stageBadge}${cycleBadge}${ageBadge}
          </summary>
          <div style="margin-top:6px;padding:8px;background:#141418;border:1px solid #383842;border-radius:6px;line-height:1.45;white-space:normal;font-size:11px;">
            <div style="color:#80cbc4;margin-bottom:4px;">${dnaText}</div>
            ${data.bio ? `<div style="color:#ddd;margin-bottom:4px;"><b>📋 Bio:</b> ${data.bio}</div>` : ''}
            ${data.lastTweetText ? `<div style="color:#a5d6a7;margin-bottom:4px;"><b>💬 最新ツイ:</b> ${data.lastTweetText}</div>` : ''}
            ${(twoFa || backupCd) ? `<div style="color:#ffd54f;font-size:10.5px;margin-bottom:4px;"><b>🔐 2FA:</b> <code>${twoFa || '-'}</code> ｜ <b>🎫 控え:</b> <code>${backupCd || '-'}</code></div>` : ''}
            <div style="color:#90a4ae;font-size:10px;border-top:1px solid #2c2c34;padding-top:4px;margin-top:4px;">
              🛡️ 固定IPセッション: <code>${proxySessionId}</code> ｜ ⏳ 次回予定: ${nextTimeStr}
            </div>
          </div>
        </details>
      `;

      let optionsHtml = '';
      for (const [k, v] of Object.entries(STATUS_META)) {
        optionsHtml += `<option value="${k}" ${st === k ? 'selected' : ''} style="background:#222;color:#fff;">${v.label}</option>`;
      }

      // 長い文字列を全部出さず、ワンクリックでコピーできるスッキリしたバッジボタン群
      const copyPassBtn = data.password
        ? `<button type="button" class="btn-sm" style="background:#263238;border:1px solid #455a64;color:#cfd8dc;" onclick="copyToClipboard('${escapeJsStr(data.password)}', event)" title="PW: ${escapeJsStr(data.password)} (クリックでコピー)">🔑 PWコピー</button>`
        : '<span style="color:#555;">-</span>';

      const emailDomain = data.email && data.email.includes('@') ? '@' + data.email.split('@')[1] : '';
      const copyMailBtn = data.email
        ? `<button type="button" class="btn-sm" style="background:#263238;border:1px solid #455a64;color:#b0bec5;" onclick="copyToClipboard('${escapeJsStr(data.email)}', event)" title="${escapeJsStr(data.email)} (クリックでメールをコピー)">📧 メール(${emailDomain.slice(0, 10)})</button>`
        : '<span style="color:#555;">-</span>';

      const copyMailPwBtn = cleanMailPass
        ? `<button type="button" class="btn-sm" style="background:#263238;border:1px solid #455a64;color:#90a4ae;" onclick="copyToClipboard('${escapeJsStr(cleanMailPass)}', event)" title="メールPW: ${escapeJsStr(cleanMailPass)} (クリックでコピー)">🔐 メールPW</button>`
        : '';

      const copyBackupBtn = backupCd
        ? ` <button type="button" class="btn-sm" style="background:#263238;color:#80deea;border:1px solid #00838f;" onclick="copyToClipboard('${escapeJsStr(backupCd)}', event)" title="2FAバックアップコードをコピー (${escapeJsStr(backupCd)})">🎫控え</button>`
        : '';
      const copy2faBtns = twoFa
        ? `<button type="button" class="btn-sm" style="background:#fbc02d;color:#000;font-weight:bold;" onclick="copyTotpCode('${escapeJsStr(twoFa)}', event)" title="今の6桁ワンタイムパスワードを計算してコピー">🔢 6桁コード</button>
           <button type="button" class="btn-sm" style="background:#333;color:#ffd54f;border:1px solid #665214;" onclick="copyToClipboard('${escapeJsStr(twoFa)}', event)" title="2FAシード全文をコピー (${escapeJsStr(twoFa)})">KEY</button>${copyBackupBtn}`
        : '<span style="color:#555;">なし</span>';

      const copyTokenBtn = data.authToken
        ? `<button type="button" class="btn-sm" style="background:#1b3b3b;border:1px solid #00897b;color:#80cbc4;font-family:monospace;" onclick="copyToClipboard('${escapeJsStr(data.authToken)}', event)" title="AuthToken全文をコピー: ${escapeJsStr(data.authToken)}">🎟️ ${data.authToken.slice(0, 6)}…</button>`
        : '<span style="color:#555;">-</span>';

      rowsHtml += `
        <tr id="tr-${docId}" style="${rowStyle} cursor:pointer;" onclick="handleRowClick(event, '${docId}')" class="account-row"
            data-colon="${encodedColon}" data-tab="${encodedTab}">
          <td style="text-align:center;"><input type="checkbox" name="selectedIds" value="${docId}" id="cb-${docId}" class="row-checkbox" style="width:17px; height:17px;"></td>
          <td style="text-align:center; font-weight:bold; color:#888;">${count}</td>
          <td style="white-space:nowrap;">
            <strong style="font-size:13px;cursor:pointer;color:#4daafc;" onclick="copyToClipboard('${escapeJsStr(data.userId)}', event)" title="クリックで @ID をコピー">@${data.userId || '不明'}</strong>
            ${originBadge}${noteBadge}
            <a href="https://x.com/${data.userId || ''}" target="_blank" onclick="event.stopPropagation()" style="font-size:11px;color:#888;margin-left:4px;text-decoration:none;" title="Xのプロフィールを新しいタブで開く">↗️</a>
          </td>
          <td>${detailColumnHtml}</td>
          <td style="white-space:nowrap;">${copyPassBtn}</td>
          <td style="white-space:nowrap;">${copyMailBtn} ${copyMailPwBtn}</td>
          <td style="white-space:nowrap;">${copy2faBtns}</td>
          <td style="white-space:nowrap;">${copyTokenBtn}</td>
          <td style="font-size:11px;color:#bbb;white-space:nowrap;">${dateText}</td>
          <td>
            <select class="status-select" onchange="updateStatus('${docId}', this)" onclick="event.stopPropagation()"
              style="background:${meta.bg}; color:#fff; border:2px solid ${meta.border}; padding:4px 7px; border-radius:6px; font-weight:bold; font-size:11.5px; cursor:pointer;">
              ${optionsHtml}
            </select>
            ${errBadge}
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${data.authToken ? `
              <button type="button" class="btn-sm" style="background:#7b1fa2;color:#fff;font-weight:bold;padding:5px 9px;" title="GCPのChromeリモートデスクトップ上に、このアカウント固有のUA・固定IP・Cookieを完全維持したままブラウザを起動します" onclick="openServerBrowser('${docId}', '${escapeJsStr(data.authToken)}', event)">🖥️ CRD起動</button>
            ` : ''}
            ${(data.email && data.emailPassword) ? `
              <button type="button" class="btn-sm" style="background:#0288d1;color:#fff;font-weight:bold;padding:5px 8px;" title="メールボックスからXの最新認証コードを自動取得してコピーします" onclick="fetchEmailVerifyCode('${docId}', event)">📩 コード取得</button>
            ` : ''}
            ${['robot', 'app_lock'].includes(st) ? `
              <button type="button" class="btn-sm" style="background:#00c853;color:#000;font-weight:bold;padding:5px 8px;" onclick="resolveRobot('${docId}', event)">✅ 解除済</button>
            ` : ''}
            ${st === 'sold' ? `
              <button type="button" class="btn-sm" style="background:#ff5252;color:#fff;font-weight:bold;padding:5px 8px;" onclick="exchangeSingle('${docId}', event)">🔄 交換</button>
            ` : ''}
          </td>
        </tr>
      `;
      count++;
    });

    res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0"><title>アカウント管理画面</title>
          <style>
            body { font-family: sans-serif; background: #141416; color: #e0e0e0; padding: 12px; margin:0; }
            .container { max-width: 1750px; margin: 0 auto; background: #1e1e22; padding: 18px; border-radius: 10px; overflow-x: auto; }
            .top-bar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:15px; }
            .worker-bar { background:#25252b; border:1px solid #3c3c44; padding:10px 15px; border-radius:8px; margin-bottom:15px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
            .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px; border-bottom: 2px solid #333; padding-bottom: 10px; }
            .tabs a { padding: 10px 15px; text-decoration: none; color: #bbb; font-weight: bold; border-radius: 8px; background: #29292e; font-size: 13px; border: 2px solid transparent; }
            .tabs a.active { background: #263238; color: #fff; border-color: #4daafc; }
            .tabs a:hover:not(.active) { background: #38383f; color: #fff; }
            .guide-box { background: #27272c; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
            .btn-big { border: none; padding: 11px 16px; font-size: 13px; font-weight: bold; cursor: pointer; border-radius: 6px; margin-right: 8px; margin-top: 4px; }
            .btn-big:hover { opacity: 0.9; }
            .sub-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; font-size:13px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { padding: 8px 6px; text-align: left; vertical-align: middle; }
            th { background: #29292e; color:#fff; white-space: nowrap; border-bottom: 2px solid #444; position: sticky; top: 0; }
            .account-row:hover { background: #2a2d32; }
            .btn-sm { color: white; border: none; padding: 5px 8px; cursor: pointer; border-radius: 4px; margin-right: 2px; font-size:11px; }
            .toast { position:fixed; bottom:20px; right:20px; background:#00c853; color:#000; padding:12px 24px; border-radius:6px; font-weight:bold; display:none; z-index:999; }
            #log-box { display:none; background:#0d0d0f; color:#69f0ae; font-family:monospace; font-size:12px; padding:12px; border-radius:6px; max-height:240px; overflow-y:auto; margin-bottom:15px; border:1px solid #333; white-space:pre-wrap; }
          </style>
          <script>
            window.STATUS_META = ${statusStylesJson};
            window.READY_STOCK_COUNT = ${tabCounts.ready};
          </script>
          <script src="/admin-client.js?v=${Date.now()}"></script>
          <script>
            async function fetchEmailVerifyCode(docId, ev) {
              if (ev) ev.stopPropagation();
              const btn = ev && ev.currentTarget ? ev.currentTarget : null;
              const origText = btn ? btn.innerText : '';
              if (btn) { btn.innerText = '⏳ 受信中...'; btn.disabled = true; }
              try {
                const r = await fetch('/fetch-email-code', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ docId })
                });
                const j = await r.json();
                if (j.ok && j.code) {
                  try { await navigator.clipboard.writeText(j.code); } catch (e) {}
                  alert('📩 Xの認証コードを取得しました（クリップボードにコピー済）:\n\n👉  ' + j.code + '\n\n対象メール: ' + (j.email || ''));
                } else {
                  alert('⚠️ 認証コードが見つかりませんでした: ' + (j.error || '新着メールなし'));
                }
              } catch (e) {
                alert('通信エラー: ' + e.message);
              } finally {
                if (btn) { btn.innerText = origText; btn.disabled = false; }
              }
            }
          </script>
        <style id="table-compact-fix">
  .container, body {
    max-width: 100% !important;
    box-sizing: border-box !important;
  }
  .table-scroll-wrap {
    width: 100% !important;
    overflow-x: auto !important;
    border: 1px solid #333;
    border-radius: 8px;
    background: #141416;
    padding-bottom: 6px;
  }
  .table-scroll-wrap::-webkit-scrollbar {
    height: 12px;
  }
  .table-scroll-wrap::-webkit-scrollbar-thumb {
    background: #4daafc;
    border-radius: 6px;
  }
  .table-scroll-wrap::-webkit-scrollbar-track {
    background: #222;
  }
  table {
    width: 100% !important;
    border-collapse: collapse !important;
  }
  th, td {
    padding: 6px 5px !important;
    font-size: 11.5px !important;
    white-space: nowrap;
  }
  td:nth-child(3) {
    max-width: 210px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  td:nth-child(3) span[onclick*="filterByNote"] {
    display: inline-block !important;
    max-width: 135px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    vertical-align: bottom !important;
  }
  td:nth-child(4) {
    max-width: 175px !important;
    white-space: normal !important;
  }
  .table-scroll-wrap th:last-child, .table-scroll-wrap td:last-child {
    position: sticky !important;
    right: 0 !important;
    background: #18191c !important;
    z-index: 4 !important;
    box-shadow: -4px 0 8px rgba(0,0,0,0.6) !important;
  }
  .table-scroll-wrap th:nth-last-child(2), .table-scroll-wrap td:nth-last-child(2) {
    position: sticky !important;
    right: 170px !important;
    background: #18191c !important;
    z-index: 4 !important;
    box-shadow: -2px 0 4px rgba(0,0,0,0.4) !important;
  }
</style>
</head>
        <body>
          <div id="toast" class="toast"></div>
          <div class="container">
            <div class="top-bar">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <a href="/register" style="background:#00c853;color:#000;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;">➕ 新規アカウント仕入れ登録</a>
                <button type="button" onclick="toggleDomainPanel()" style="background:#6a1b9a;color:#fff;padding:10px 16px;border-radius:6px;border:1px solid #ab47bc;font-weight:bold;font-size:13px;cursor:pointer;">
                  🌐 ドメイン汚染度・追加管理 <span id="domain-btn-badge" style="background:#ab47bc;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;margin-left:4px;">確認</span>
                </button>
                <a href="/list?tab=${tab}&refresh=1" style="background:#37474f;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;font-size:13px;">🔄 最新DB再読込</a>
              </div>
              <form method="GET" action="/list" style="display:flex;gap:6px;margin:0;">
                <input type="hidden" name="tab" value="${tab}">
                <input type="text" name="q" value="${req.query.q || ''}" placeholder="ID / 購入者メモ / メール検索..." style="padding:8px 12px;background:#141416;color:#fff;border:1px solid #555;border-radius:6px;width:240px;">
                <select name="limit" onchange="this.form.submit()" style="padding:8px;background:#141416;color:#fff;border:1px solid #555;border-radius:6px;">
                  <option value="100" ${limitNum===100?'selected':''}>100件表示</option>
                  <option value="200" ${limitNum===200?'selected':''}>200件表示</option>
                  <option value="500" ${limitNum===500?'selected':''}>500件表示</option>
                  <option value="0" ${limitNum===0?'selected':''}>全件表示</option>
                </select>
                <button type="submit" class="btn-sm" style="background:#1976d2;padding:8px 14px;">🔍 検索</button>
                ${searchQ ? `<a href="/list?tab=${tab}" class="btn-sm" style="background:#555;padding:8px 10px;text-decoration:none;">✖ 解除</a>` : ''}
              </form>
            </div>

            
            <div id="domain-health-panel" style="display:none;background:#16181d;border:2px solid #8e24aa;border-radius:8px;padding:14px;margin-bottom:15px;">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;border-bottom:1px solid #333;padding-bottom:10px;">
                <div>
                  <strong style="font-size:15px;color:#e1bee7;">🌐 独自ドメイン汚染度（連続拒絶カウント）＆ 新規ドメイン追加パネル</strong>
                  <span id="domain-health-summary" style="font-size:12px;color:#aaa;margin-left:10px;"></span>
                  <div style="font-size:11.5px;color:#999;margin-top:3px;">
                    💡 「何かがおかしいです」が <b>3回連続</b> になると、クリーンIPの巻き添え汚染を防ぐため自動で隔離（停止）されます。また10ドメイン以上稼働時は同一ドメインの使用間隔が自動で最大3時間まで広がります。
                  </div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                  <input type="text" id="new-domain-input" placeholder="追加ドメイン (例: newdomain.com / カンマ区切り可)" style="padding:8px 12px;background:#0d0e11;color:#fff;border:1px solid #666;border-radius:6px;width:280px;margin:0;">
                  <button type="button" class="btn-sm" style="background:#00c853;color:#000;font-weight:bold;padding:8px 14px;font-size:12px;" onclick="addNewCustomDomains()">➕ ドメイン追加</button>
                  <button type="button" class="btn-sm" style="background:#0288d1;color:#fff;font-weight:bold;padding:8px 12px;font-size:12px;" onclick="resetSingleDomain('ALL')">🔄 全ドメイン失敗0リセット</button>
                  <button type="button" class="btn-sm" style="background:#455a64;color:#fff;padding:8px 10px;" onclick="loadDomainHealthStatus()">🔄 更新</button>
                </div>
              </div>
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                  <thead>
                    <tr style="background:#25252e;color:#ddd;">
                      <th style="width:40px;text-align:center;padding:6px;">No.</th>
                      <th style="padding:6px;">ドメイン名</th>
                      <th style="padding:6px;">現在ステータス</th>
                      <th style="padding:6px;">汚染度 (何かがおかしいです連続回数)</th>
                      <th style="padding:6px;">累計作成成功</th>
                      <th style="text-align:right;padding:6px;">操作</th>
                    </tr>
                  </thead>
                  <tbody id="domain-health-tbody"></tbody>
                </table>
              </div>
            </div>

            <div class="worker-bar">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong>⚙️ 1.初期設定ワーカー (init):</strong>
                ${(isWorkerRunning || isInitProcessAlive()) ? '<span style="color:#00e676;font-weight:bold;">🟢稼働中 (自動処理中)</span>' : '<span style="color:#aaa;">⚪停止中</span>'}
                <select id="worker-conc" style="padding:5px;background:#141416;color:#fff;border:1px solid #555;border-radius:4px;font-size:12px;">
                  <option value="1">1枠</option>
                  <option value="2">2枠</option>
                  <option value="3">3枠並列</option>
                  <option value="5">5枠並列</option>
                </select>
                <button type="button" class="btn-sm" style="background:#00897b;padding:6px 12px;font-weight:bold;" onclick="startInitWorker()">▶️ 初期設定を起動</button>
                <button type="button" class="btn-sm" style="background:#d32f2f;padding:6px 12px;font-weight:bold;" onclick="stopInitWorker()">⏹️ 停止</button>
              </div>

              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong>🌱 2.ステータス最適化・定期処理エンジン:</strong>
                ${isFarmingRunning ? '<span style="color:#00e676;font-weight:bold;">🟢定期処理稼働中</span>' : '<span style="color:#aaa;">🟢 PM2常駐・24h自動稼働中</span>'}
                <button type="button" class="btn-sm" style="background:#2e7d32;padding:6px 12px;font-weight:bold;" onclick="startFarmingWorker(false)">▶️ 自動定期処理を起動</button>
                <button type="button" class="btn-sm" style="background:#f57c00;padding:6px 10px;font-weight:bold;" onclick="startFarmingWorker(true)" title="8時間の寝かせ時間を待たずに今すぐ定期処理アクションを実行します">⚡ 即時定期処理(寝かせ無視)</button>
                <button type="button" class="btn-sm" style="background:#d32f2f;padding:6px 12px;font-weight:bold;" onclick="stopFarmingWorker()">⏹️ 定期処理停止</button>
                <button type="button" class="btn-sm" style="background:#455a64;padding:6px 12px;" onclick="toggleLogBox()">📺 リアルタイム稼働ログ</button>
              </div>
            </div>
            <div id="log-panel-wrap" style="display:none;margin-bottom:14px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:10px;font-size:12px;">
                  <strong style="color:#fff;">📺 ライブ稼働ターミナル</strong>
                  <span id="log-line-count" style="color:#8b949e;">1000行読込</span>
                  <span id="log-scroll-status" style="color:#00e676;font-weight:bold;">🟢 自動追従ON (最下部)</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <button type="button" class="btn-sm" style="background:#1976d2;padding:5px 12px;font-weight:bold;" onclick="copyAllWorkerLogs()">📋 全文コピー (1000行)</button>
                  <a href="/worker/download-setup-log?lines=5000" class="btn-sm" style="background:#8e24aa;color:#fff;padding:5px 12px;font-weight:bold;text-decoration:none;display:inline-block;">📥 setup_workerログ全文DL</a>
                  <button type="button" id="btn-pause-log" class="btn-sm" style="background:#37474f;padding:5px 10px;font-weight:bold;" onclick="togglePauseLogs()">⏸️ 更新を一時停止</button>
                  <button type="button" class="btn-sm" style="background:#2e7d32;padding:5px 10px;font-weight:bold;" onclick="scrollLogToBottom()">⬇️ 最下部へ</button>
                </div>
              </div>
              <div id="log-box" style="margin:0;border:none;border-radius:0;max-height:480px;overflow-y:auto;user-select:text;-webkit-user-select:text;"></div>
            </div>
            <div style="display:flex;gap:10px;margin-bottom:12px;background:#141418;padding:10px;border-radius:8px;border:1px solid #333;align-items:center;flex-wrap:wrap;">
              <strong style="color:#fff;font-size:13px;margin-right:4px;">📂 アカウント種別切替:</strong>
              <a href="/list?origin=all&tab=${tab}&limit=${limitNum}" style="padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;${originFilter==='all'?'background:#4daafc;color:#000;':'background:#29292e;color:#ccc;'}">📋 全アカウント (${originCounts.all})</a>
              <a href="/list?origin=pure_jp&tab=${tab}&limit=${limitNum}" style="padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;${originFilter==='pure_jp'?'background:#00e676;color:#000;':'background:#29292e;color:#80e27e;'}">🇯🇵 純国産アカウント (${originCounts.pure_jp})</a>
              <a href="/list?origin=pure_en&tab=${tab}&limit=${limitNum}" style="padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;${originFilter==='pure_en'?'background:#00bcd4;color:#000;':'background:#29292e;color:#80deea;'}">🌐 多国籍ENアカウント (${originCounts.pure_en})</a>
              <a href="/list?origin=imported&tab=${tab}&limit=${limitNum}" style="padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;${originFilter==='imported'?'background:#80d8ff;color:#000;':'background:#29292e;color:#80d8ff;'}">📦 外部仕入れアカウント (${originCounts.imported})</a>
              <span style="margin-left:auto;font-size:12px;color:#aaa;">🖥️ ロボット解除時は「CRDで開く(UA/IP維持)」を押してから <a href="https://remotedesktop.google.com/access" target="_blank" style="color:#4daafc;font-weight:bold;">Chromeリモートデスクトップ</a> を見るとそのままブラウザが開いています</span>
            </div>

            <div class="tabs">
              <a href="/list?origin=${originFilter}&tab=all&limit=${limitNum}" class="${tab==='all'?'active':''}">すべて (${tabCounts.all})</a>
              <a href="/list?origin=${originFilter}&tab=ready&limit=${limitNum}" class="${tab==='ready'?'active':''}">🟢 完成・在庫 (${tabCounts.ready})</a>
              <a href="/list?origin=${originFilter}&tab=standby&limit=${limitNum}" class="${tab==='standby'?'active':''}">⚪ 初期設定待ち (${tabCounts.standby})</a>
              <a href="/list?origin=${originFilter}&tab=farming&limit=${limitNum}" class="${tab==='farming'?'active':''}">🌱 表示制限・定期処理中 (${tabCounts.farming})</a>
              <a href="/list?origin=${originFilter}&tab=own&limit=${limitNum}" class="${tab==='own'?'active':''}">🔵 自社利用中 (${tabCounts.own})</a>
              <a href="/list?origin=${originFilter}&tab=sold&limit=${limitNum}" class="${tab==='sold'?'active':''}">📦 出荷済み・交換対応 (${tabCounts.sold})</a>
              <a href="/list?origin=${originFilter}&tab=robot&limit=${limitNum}" class="${tab==='robot'?'active':''}">🤖 ロボット解除待ち (${tabCounts.robot})</a>
              <a href="/list?origin=${originFilter}&tab=applock&limit=${limitNum}" class="${tab==='applock'?'active':''}">📱 アプリロック (${tabCounts.applock})</a>
              <a href="/list?origin=${originFilter}&tab=trouble&limit=${limitNum}" class="${tab==='trouble'?'active':''}">🚨 凍結・不良 (${tabCounts.trouble})</a>
            </div>

            <form id="bulk-form" method="POST">
              <input type="hidden" name="targetStatus" id="hidden-target-status" value="">
              <input type="hidden" name="badDisposition" id="hidden-bad-disposition" value="unavailable">
              <input type="hidden" name="returnTab" value="${tab}">

              ${guideBannerHtml}

              <div class="sub-toolbar">
                <strong style="color:#4daafc;">選択中: <span id="sel-count">0</span> / ${totalFiltered}件</strong>
                <button type="button" class="btn-sm" style="background:#455a64;" onclick="selectFirstN(10)">先頭10件</button>
                <button type="button" class="btn-sm" style="background:#455a64;" onclick="selectFirstN(30)">先頭30件</button>
                <button type="button" class="btn-sm" style="background:#455a64;" onclick="selectFirstN(50)">先頭50件</button>
                <button type="button" class="btn-sm" style="background:#455a64;" onclick="selectFirstN(100)">先頭100件</button>

                <div style="margin-left:auto;display:flex;gap:6px;">
                  <button type="button" class="btn-sm" style="background:#0277bd;font-weight:bold;" onclick="copySelectedBulk('colon')">📋 選択分を一括コピー ( : 区切り)</button>
                  <button type="button" class="btn-sm" style="background:#2e7d32;font-weight:bold;" onclick="copySelectedBulk('tab')">📋 選択分を一括コピー (Tab区切り)</button>
                  <button type="button" class="btn-sm" style="background:#ffa000;color:#000;font-weight:bold;" onclick="submitBulkAction('export')">📥 選択分を単純CSV出力</button>
                </div>
              </div>

              <div class="table-scroll-wrap"><table>
                <thead>
                  <tr>
                    <th style="text-align:center;width:32px;"><input type="checkbox" onclick="toggleAll(this)" style="width:18px; height:18px;"></th>
                    <th style="text-align:center;width:38px;">No.</th>
                    <th>ユーザーID / 種別</th>
                    <th>プロフ詳細 / 育成進捗 / 固定環境</th>
                    <th>パスワード</th>
                    <th>メール / メールPW</th>
                    <th>2FAキー</th>
                    <th>Token</th>
                    <th>${tab === 'sold' ? '出荷日時' : '最終更新'}</th>
                    <th>状態 / 凍結・ロック理由</th>
                    <th style="text-align:center;">ロボット解除 / 操作</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table></div>
            </form>
          </div>
        </body>
      </html>
    `);
  } catch (error) { res.send(`<h3 style="color:#f44336;">エラー: ${error.message}</h3>`); }
});

app.post('/worker/start', (req, res) => {
  if (initWorkerProc) {
    try { initWorkerProc.kill('SIGKILL'); } catch (e) {}
    initWorkerProc = null;
  }
  const conc = String(req.body.concurrency || '1');
  const rootDir = path.join(__dirname, '..');
  initWorkerLogs = ['🚀 初期設定ワーカーを起動しました (並列枠: ' + conc + ')'];
  initWorkerProc = spawn(process.execPath, [path.join(__dirname, 'init_profiles.js'), conc], {
    cwd: rootDir,
    env: { ...process.env, CONCURRENCY: conc }
  });
  initWorkerProc.stdout.on('data', d => appendWorkerLog(d));
  initWorkerProc.stderr.on('data', d => appendWorkerLog('[ERR] ' + d));
  initWorkerProc.on('close', code => {
    appendWorkerLog('✅ 初期設定ワーカーが完了しました (code: ' + code + ')');
    initWorkerProc = null;
    invalidateCache();
  });
  initWorkerProc.on('error', err => {
    appendWorkerLog('❌ 起動エラー: ' + err.message);
    initWorkerProc = null;
  });
  res.json({ message: '▶️ 初期設定ワーカーを起動しました！' });
});

app.post('/worker/stop', (req, res) => {
  if (initWorkerProc) {
    try { initWorkerProc.kill('SIGKILL'); } catch (e) {}
    initWorkerProc = null;
  }
  try {
    const lf = '/tmp/x_init_worker.lock';
    if (fs.existsSync(lf)) {
      const pid = parseInt(fs.readFileSync(lf, 'utf8').trim(), 10);
      if (pid) { try { process.kill(pid, 'SIGTERM'); } catch (e) {} }
      fs.unlinkSync(lf);
    }
  } catch (e) {}
  appendWorkerLog('⏹️ 初期設定ワーカーを停止しました');
  invalidateCache();
  res.json({ message: '⏹️ 初期設定ワーカーを停止しました' });
});

app.post('/worker/start-farming', (req, res) => {
  if (farmingWorkerProc) {
    try { farmingWorkerProc.kill('SIGKILL'); } catch (e) {}
    farmingWorkerProc = null;
  }
  const forceFlag = req.body.force ? ['--force'] : [];
  const rootDir = path.join(__dirname, '..');
  initWorkerLogs = ['🌱 自動定期処理エンジン (batch_engine.js) を起動しました...'];
  farmingWorkerProc = spawn(process.execPath, [path.join(__dirname, 'batch_engine.js'), ...forceFlag], {
    cwd: rootDir,
    env: { ...process.env }
  });
  farmingWorkerProc.stdout.on('data', d => appendWorkerLog('[定期処理] ' + d));
  farmingWorkerProc.stderr.on('data', d => appendWorkerLog('[定期処理ERR] ' + d));
  farmingWorkerProc.on('close', code => {
    appendWorkerLog('🌱 自動定期処理エンジンが停止しました (code: ' + code + ')');
    farmingWorkerProc = null;
    invalidateCache();
  });
  farmingWorkerProc.on('error', err => {
    appendWorkerLog('❌ 定期処理エラー: ' + err.message);
    farmingWorkerProc = null;
  });
  res.json({ message: '🌱 自動定期処理エンジンを起動しました！' });
});

app.post('/worker/stop-farming', (req, res) => {
  if (farmingWorkerProc) {
    try { farmingWorkerProc.kill('SIGKILL'); } catch (e) {}
    farmingWorkerProc = null;
  }
  appendWorkerLog('⏹️ 自動定期処理エンジンを停止しました');
  invalidateCache();
  res.json({ message: '⏹️ 定期処理エンジンを停止しました' });
});


app.get('/worker/download-setup-log', (req, res) => {
  try {
    const outPath = '/home/u0_a217/.pm2/logs/x-nurture-factory-out.log';
    const errPath = '/home/u0_a217/.pm2/logs/x-nurture-factory-error.log';
    const lines = Math.min(20000, Math.max(500, parseInt(req.query.lines || '5000', 10) || 5000));
    let content = '';
    if (fs.existsSync(outPath)) {
      const all = fs.readFileSync(outPath, 'utf8').split(/\r?\n/);
      content += '=== [x-nurture-factory (setup_worker.js) OUT LOG (Last ' + lines + ' lines)] ===\n';
      content += all.slice(-lines).join('\n') + '\n\n';
    }
    if (fs.existsSync(errPath)) {
      const errAll = fs.readFileSync(errPath, 'utf8').split(/\r?\n/);
      content += '=== [x-nurture-factory (setup_worker.js) ERROR LOG (Last 1000 lines)] ===\n';
      content += errAll.slice(-1000).join('\n') + '\n';
    }
    if (!content) content = 'ログファイルが見つかりません';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="setup_worker_full.log"');
    res.send(content);
  } catch (e) {
    res.status(500).send('Log read error: ' + e.message);
  }
});

app.get('/worker/logs', (req, res) => {
  const initAlive = isInitProcessAlive();
  const limitLines = Math.min(2000, Math.max(100, parseInt(req.query.limit || '1000', 10) || 1000));
  const fileInitLogs = readLiveLogTail('init', limitLines);
  const fileFarmLogs = readLiveLogTail('farming', limitLines);
  let merged = [];
  if (fileInitLogs.length > 0 && fileFarmLogs.length > 0) {
    merged = [...fileFarmLogs, '--- [初期設定ワーカーログ] ---', ...fileInitLogs].slice(-limitLines);
  } else if (fileInitLogs.length > 0) {
    merged = fileInitLogs.slice(-limitLines);
  } else if (initWorkerLogs && initWorkerLogs.length > 0) {
    merged = initWorkerLogs.slice(-limitLines);
  } else {
    merged = fileFarmLogs.slice(-limitLines);
  }
  res.json({
    running: initAlive || !!initWorkerProc || !!farmingWorkerProc,
    initRunning: initAlive || !!initWorkerProc,
    logs: merged.length > 0 ? merged : ['⏳ ワーカー稼働待機中...']
  });
});

app.post('/update-status', async (req, res) => {
  try {
    const updateData = {};
    if (req.body.status === 'sold') updateData.soldAt = new Date();
    if (['standby', 'farming', 'cleared', 'active_own'].includes(
      getAccountDisplayStatus({ status: req.body.status })
    )) updateData.errorReason = null;
    await updateAccountState(req.body.docId, req.body.status, updateData);
    invalidateCache();
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

app.post('/resolve-robot', async (req, res) => {
  try {
    const snap = await getAccount(req.body.docId);
    const d = snap.exists ? snap.data() : {};
    const nextSt = d.initializedAt ? 'farming' : 'standby';
    await updateAccountState(req.body.docId, nextSt, { errorReason: null });
    invalidateCache();
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

app.post('/bulk-update-status', async (req, res) => {
  try {
    let { selectedIds, targetStatus, returnTab } = req.body;
    if (!selectedIds || !targetStatus) return res.redirect('/list');
    if (!Array.isArray(selectedIds)) selectedIds = [selectedIds];
    const chunkSize = 400;
    for (let i = 0; i < selectedIds.length; i += chunkSize) {
      const chunk = selectedIds.slice(i, i + chunkSize);
      const batch = db.batch();
      chunk.forEach(id => {
        const updates = {};
        if (targetStatus === 'sold') { updates.soldAt = new Date(); }
        if (['standby', 'farming', 'cleared', 'active_own'].includes(
          getAccountDisplayStatus({ status: targetStatus })
        )) updates.errorReason = null;
        stageAccountStateUpdate(batch, getAccountRef(id), targetStatus, updates);
      });
      await batch.commit();
    }
    invalidateCache();
    res.redirect('/list?tab=' + (returnTab || 'all'));
  } catch (e) { res.send(`エラー: ${e.message}`); }
});

require('./x_unofficial_account_check_guard').registerUnofficialAccountCheckGuard(app);

app.post('/exchange-accounts', async (req, res) => {
  try {
    let { selectedIds, badDisposition } = req.body;
    if (!selectedIds) return res.send('<script>alert("交換対象の不良アカウントが選択されていません！"); history.back();</script>');
    if (!Array.isArray(selectedIds)) selectedIds = [selectedIds];
    const needCount = selectedIds.length;
    const targetBadStatus = (badDisposition === 'reset') ? 'reset' : 'unavailable';

    const candidateDocs = await getAccountsByLifecycleStatuses(['healthy'], { limit: needCount * 4 + 10 });
    if (candidateDocs.length === 0) {
      return res.send('<script>alert("⚠️ 完成・在庫が0件です！"); history.back();</script>');
    }

    const badRefs = selectedIds.map(id => getAccount(id));
    const badSnaps = await Promise.all(badRefs);
    let originalNote = '';
    const badUserIds = [];
    badSnaps.forEach(s => {
      if (s.exists) {
        const d = s.data();
        if (!originalNote && d.buyerNote) originalNote = d.buyerNote;
        if (d.userId) badUserIds.push('@' + d.userId);
      }
    });

    const now = new Date();
    const exchangeNote = (originalNote ? originalNote + ' ' : '') + `[交換補充 ${formatDateJST(now)}]`;
    const batch = db.batch();

    // 候補在庫を1件ずつ出荷前ロボット・制限チェックし、合格した個体だけを引き当てる
    const replacementDocs = [];
    for (const doc of candidateDocs) {
      if (replacementDocs.length >= needCount) break;
      if (selectedIds.includes(doc.id)) continue;
      const d = doc.data();
      const chk = await verifySingleAccountAliveForSale(d, true);
      if (chk.alive) {
        d.buyerNote = exchangeNote;
        replacementDocs.push(d);
        stageAccountStateUpdate(batch, doc.ref, 'sold', {
          soldAt: now,
          buyerNote: exchangeNote,
          replacedFor: badUserIds.join(', ')
        }, now);
      } else {
        stageAccountStateUpdate(batch, doc.ref, chk.status || 'robot', {
          errorReason: `交換直前検品で除外: ${chk.reason}`
        }, now);
      }
    }

    if (replacementDocs.length < needCount) {
      await batch.commit().catch(() => {});
      invalidateCache();
      return res.send(`<script>alert("⚠️ 出荷前検品（ロボット・凍結チェック）の結果、正常な完成在庫が足りませんでした（必要:${needCount}件 / 正常在庫:${replacementDocs.length}件）。不良在庫は自動隔離しました。"); location.href="/list?tab=sold&refresh=1";</script>`);
    }

    badSnaps.forEach(s => {
      if (!s.exists) return;
      stageAccountStateUpdate(batch, s.ref, targetBadStatus, {
        errorReason: `出荷後不良により交換済 (${formatDateJST(now)})`
      }, now);
    });

    await batch.commit();
    invalidateCache();

    const dateStr = now.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="exchange_replacement_${dateStr}_${replacementDocs.length}pcs.csv"`);
    res.send(buildCsvString(replacementDocs));
  } catch (e) {
    res.send(`<script>alert("交換処理エラー: ${e.message}"); history.back();</script>`);
  }
});


app.post('/fetch-email-code', async (req, res) => {
  try {
    const { docId } = req.body;
    if (!docId) return res.json({ ok: false, error: 'docIdが指定されていません' });
    const snap = await getAccount(docId);
    if (!snap.exists) return res.json({ ok: false, error: 'アカウントが見つかりません' });
    const d = snap.data();
    if (!d.email || !d.emailPassword) {
      return res.json({ ok: false, error: 'メールアドレスまたはメールPWが登録されていません' });
    }
    const { getVerificationCode } = require('./email_firstmail');
    const code = await getVerificationCode({ email: d.email, password: d.emailPassword }, 12000);
    if (code) {
      return res.json({ ok: true, code, email: d.email });
    }
    return res.json({ ok: false, error: '直近のメールから認証コードが検出されませんでした。X画面でコード送信ボタンを押してから数秒後にもう一度押してください。' });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

app.post('/open-browser', async (req, res) => {
  const { authToken, docId } = req.body;
  if (!authToken) return res.json({ ok: false, error: 'AuthTokenがありません' });
  try {
    let accountData = null;
    if (docId) {
      const snap = await db.collection('accounts').doc(docId).get();
      if (snap.exists) accountData = snap.data();
    }
    await launchXBrowser(authToken, accountData);
    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});


// 出荷直前および定期パトロール用の「完全非接触（ゼロタッチ）」生存検査ヘルパー
// ※ auth_token を一切使わず外部CDNから @ID の凍結有無のみを確認するため、アカウントが傷つくリスクは0%です
async function getObserverTokenFromPool() {
  try {
    const all = await getAccountsCached(false);
    // 純国産(isNewborn / pure_jp)は絶対にチェッカーとして傷つけず、外部仕入れ(imported)の養殖中アカウントのみを使用
    const obs = all.find(a => !a.isNewborn && a.originType !== 'pure_jp' &&
                  getAccountDisplayStatus(a) === 'farming' && a.authToken && a.ct0) ||
                all.find(a => !a.isNewborn && a.originType !== 'pure_jp' &&
                  getAccountDisplayStatus(a) === 'active_own' && a.authToken && a.ct0);
    return obs ? { authToken: obs.authToken, ct0: obs.ct0 } : null;
  } catch (e) { return null; }
}

async function verifySingleAccountAliveForSale(accData, checkInternalApi = true) {
  if (!accData) return { alive: false, status: 'unavailable', reason: 'no_data' };
  const lifecycleStatus = getAccountLifecycleStatus(accData);
  const curSt = getAccountDisplayStatus(accData);
  if (['restricted', 'shadowbanned', 'unavailable'].includes(lifecycleStatus)) {
    return { alive: false, status: curSt, reason: accData.errorReason || curSt };
  }

  const uid = String(accData.userId || '').replace(/^@/, '').trim();
  if (uid && !uid.startsWith('pending_') && inspectUserFromExternalView) {
    const obs = await getObserverTokenFromPool();
    const ext = await inspectUserFromExternalView(uid, obs);
    if (!ext.ok) {
      const extReason = String(ext.reason || 'external_blocked');
      const extSt = /robot|326/i.test(extReason) ? 'robot' : 'unavailable';
      return { alive: false, status: extSt, reason: extReason };
    }
  }

  // 内部APIによるロボットロック(api_326)・トークン失効チェック（純国産垢はNode.jsのTLS指紋汚染を防ぐためスキップし、外部垢で厳密実行）
  const isPureJp = !!(accData.isNewborn || accData.originType === 'pure_jp');
  if (checkInternalApi && !isPureJp && preCheckAccountWithoutBrowser && accData.authToken) {
    try {
      const proxy = (accData.proxy && accData.proxy.host)
        ? accData.proxy
        : (getResidentialProxyForAdmin ? getResidentialProxyForAdmin(accData.authToken) : null);
      const apiChk = await preCheckAccountWithoutBrowser(accData.authToken, proxy, accData.userAgent || '', accData.savedCookies || []);
      if (!apiChk.ok) {
        return { alive: false, status: apiChk.status || 'robot', reason: apiChk.reason || 'api_lock_detected' };
      }
    } catch (e) {}
  }
  return { alive: true };
}

app.post('/api/audit-cleared-stock', async (req, res) => {
  try {
    const all = await getAccountsCached(true);
    const targets = all.filter(a => a.normStatus === 'cleared');
    if (targets.length === 0) {
      return res.json({ ok: true, message: '現在検品対象の在庫がありません。' });
    }
    let deadCount = 0;
    let aliveCount = 0;
    const now = new Date();
    let idx = 0;
    async function worker() {
      while (idx < targets.length) {
        const acc = targets[idx++];
        const chk = await verifySingleAccountAliveForSale(acc, false);
        if (!chk.alive) {
          deadCount++;
          await updateAccountState(acc.id, chk.status || 'unavailable', {
            errorReason: `在庫検品で検出: ${chk.reason}`
          }).catch(() => {});
        } else {
          aliveCount++;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, targets.length) }, () => worker()));
    invalidateCache();
    res.json({
      ok: true,
      message: `🛡️ 在庫検品完了（検査:${targets.length}件）\n・🟢 正常生存: ${aliveCount}件\n・🚨 凍結/ロック排除: ${deadCount}件（自動で凍結・不良タブへ隔離しました）`
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/sell-and-export', async (req, res) => {
  try {
    let { selectedIds, buyerNote } = req.body;
    if (!selectedIds) return res.send('<script>alert("選択されていません！"); history.back();</script>');
    if (!Array.isArray(selectedIds)) selectedIds = [selectedIds];
    const selectedSet = new Set(selectedIds);
    const refs = selectedIds.map(id => getAccount(id));
    const snapshots = await Promise.all(refs);

    const now = new Date();
    const noteText = (buyerNote && buyerNote.trim()) ? buyerNote.trim() : `ロット_${formatDateJST(now)}`;
    const batch = db.batch();
    const docsForCsv = [];
    let replacedDeadCount = 0;

    // 1. 選択されたアカウントを出荷直前に1件ずつ生存検品
    for (const snap of snapshots) {
      if (!snap.exists) continue;
      const d = snap.data();
      const chk = await verifySingleAccountAliveForSale(d, true);
      if (chk.alive) {
        d.buyerNote = noteText;
        docsForCsv.push(d);
        stageAccountStateUpdate(batch, snap.ref, 'sold', { soldAt: now, buyerNote: noteText }, now);
      } else {
        replacedDeadCount++;
        stageAccountStateUpdate(batch, snap.ref, chk.status || 'unavailable', {
          errorReason: `出荷直前検品で除外: ${chk.reason}`
        }, now);
      }
    }

    // 2. もし凍結垢が混ざっていた場合、他の「🟢完成・在庫(cleared)」から生きているアカウントを自動補充
    if (replacedDeadCount > 0) {
      const backupDocs = await getAccountsByLifecycleStatuses(['healthy'], { limit: replacedDeadCount * 3 + 10 });
      for (const bDoc of backupDocs) {
        if (docsForCsv.length >= selectedIds.length) break;
        if (selectedSet.has(bDoc.id)) continue;
        const bData = bDoc.data();
        const bChk = await verifySingleAccountAliveForSale(bData, true);
        if (bChk.alive) {
          bData.buyerNote = noteText;
          docsForCsv.push(bData);
          stageAccountStateUpdate(batch, bDoc.ref, 'sold', { soldAt: now, buyerNote: noteText }, now);
        } else {
          stageAccountStateUpdate(batch, bDoc.ref, bChk.status || 'unavailable', {
            errorReason: `出荷補充検品で除外: ${bChk.reason}`
          }, now);
        }
      }
    }

    await batch.commit();
    invalidateCache();

    const dateStr = now.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sold_accounts_${dateStr}_${docsForCsv.length}pcs.csv"`);
    res.send(buildCsvString(docsForCsv));
  } catch (e) { res.send(`エラー: ${e.message}`); }
});

app.post('/export-csv', async (req, res) => {
  try {
    let { selectedIds } = req.body;
    if (!selectedIds) return res.send('<script>alert("選択されていません！"); history.back();</script>');
    if (!Array.isArray(selectedIds)) selectedIds = [selectedIds];
    const refs = selectedIds.map(id => getAccount(id));
    const snapshots = await Promise.all(refs);
    const docsForCsv = [];
    snapshots.forEach(snap => { if (snap.exists) docsForCsv.push(snap.data()); });

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reissue_accounts_${dateStr}_${selectedIds.length}pcs.csv"`);
    res.send(buildCsvString(docsForCsv));
  } catch (e) { res.send(`エラー: ${e.message}`); }
});

app.post('/delete-bulk', async (req, res) => {
  try {
    let { selectedIds, returnTab } = req.body;
    if (!selectedIds) return res.redirect('/list');
    if (!Array.isArray(selectedIds)) selectedIds = [selectedIds];
    await deleteAccounts(selectedIds);
    invalidateCache();
    res.redirect('/list?tab=' + (returnTab || 'all'));
  } catch (e) { res.send(`エラー: ${e.message}`); }
});

function autoTriggerInitWorkerOnUpload(addedCount = 1, reason = 'auto') {
  if (!addedCount || addedCount <= 0) return;
  if (initWorkerProc) {
    appendWorkerLog(`ℹ️ [${reason}] 初期設定ワーカーは稼働中です。追加 ${addedCount}件は待機列に入ります`);
    return;
  }
  const conc = '1';
  const rootDir = path.join(__dirname, '..');
  initWorkerLogs = [`🚀 [${reason}] 初期設定ワーカーを起動しました (${addedCount}件 / 並列枠: ${conc})`];
  initWorkerProc = spawn(process.execPath, [path.join(__dirname, 'init_profiles.js'), conc], {
    cwd: rootDir,
    env: { ...process.env, CONCURRENCY: conc }
  });
  initWorkerProc.stdout.on('data', d => appendWorkerLog(d));
  initWorkerProc.stderr.on('data', d => appendWorkerLog('[ERR] ' + d));
  initWorkerProc.on('close', code => {
    appendWorkerLog(`✅ 初期設定ワーカーが完了しました (code: ${code})`);
    initWorkerProc = null;
    invalidateCache();
  });
}

app.post('/upload', upload.single('accountFile'), async (req, res) => {
  const initialStatus = req.body.initialStatus || 'standby';
  try {
    if (req.body.rawText && req.body.rawText.trim()) {
      const fastParsed = fastParseAccountLines(req.body.rawText);
      if (fastParsed.length > 0) {
        await bulkSaveAccounts(fastParsed, initialStatus);
        if (initialStatus === 'standby') autoTriggerInitWorkerOnUpload(fastParsed.length);
        return res.redirect('/list?tab=' + encodeURIComponent(initialStatus === 'cleared' ? 'ready' : initialStatus));
      }
    }
    if (req.file) {
      const ext = req.file.originalname.split('.').pop().toLowerCase();
      if (ext === 'txt' || ext === 'csv') {
        const fastParsed = fastParseAccountLines(req.file.buffer.toString('utf-8'));
        if (fastParsed.length > 0) {
          await bulkSaveAccounts(fastParsed, initialStatus);
          return res.redirect('/list?tab=standby');
        }
      }
    }
    let parts = [];
    if (req.file) parts.push(await extractTextForGemini(req.file));
    if (req.body.rawText) parts.push(`【直接入力】\n${req.body.rawText}`);
    if (parts.length === 0) return res.send('<h3>入力なし<br><a href="/register">戻る</a></h3>');

    const accounts = await parseWithGemini(parts);
    await bulkSaveAccounts(accounts, initialStatus);
    res.redirect('/list?tab=standby');
  } catch (e) { res.send(`<h3>エラー: ${e.message}<br><a href="/register">戻る</a></h3>`); }
});

// Base32の2FAシードから現在の6桁ワンタイムパスワードを計算
function generateTotpCode(secret) {
  const clean = String(secret || '').replace(/\s+/g, '').toUpperCase();
  if (!clean) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of clean) {
    const val = alphabet.indexOf(ch);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) |
                  ((hmac[offset + 1] & 0xff) << 16) |
                  ((hmac[offset + 2] & 0xff) << 8) |
                  (hmac[offset + 3] & 0xff);
  const otp = (binCode % 1000000).toString().padStart(6, '0');
  const remainSec = 30 - (epoch % 30);
  return { otp, remainSec };
}

function checkPublicUserExists(userId) {
  return new Promise((resolve) => {
    const cleanId = String(userId || '').replace(/^@/, '').trim();
    if (!cleanId || cleanId.startsWith('pending_')) return resolve({ unknown: true });
    const url = 'https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=' + encodeURIComponent(cleanId);
    const req = https.get(url, { timeout: 6000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (Array.isArray(json) && json.length === 0) {
            // 新規作成垢やフォロワー0、未インデックスアカウントでも [] が返るため、これ単独で凍結と断定しない
            return resolve({ unknown: true });
          }
          return resolve({ alive: true });
        } catch (e) {
          resolve({ unknown: true });
        }
      });
    });
    req.on('error', () => resolve({ unknown: true }));
    req.on('timeout', () => { req.destroy(); resolve({ unknown: true }); });
  });
}

app.get('/api/totp', (req, res) => {
  const secret = req.query.secret || '';
  const r = generateTotpCode(secret);
  if (!r) return res.json({ ok: false, error: '無効な2FAキーです' });
  res.json({ ok: true, otp: r.otp, remainSec: r.remainSec });
});

app.post('/api/get-proxy', async (req, res) => {
  try {
    const { docId, authToken } = req.body;
    let proxy = null;
    if (docId) {
      const snap = await getAccount(docId);
      if (snap.exists && snap.data().proxy && snap.data().proxy.host) {
        proxy = snap.data().proxy;
      }
    }
    if (!proxy && getResidentialProxyForAdmin && authToken) {
      proxy = await getResidentialProxyForAdmin(authToken.trim());
    }
    if (!proxy || !proxy.host) return res.json({ ok: false, error: 'プロキシ設定が見つかりません' });
    const formatted = proxy.user ? `${proxy.host}:${proxy.port}:${proxy.user}:${proxy.pass}` : `${proxy.host}:${proxy.port}`;
    const urlFormat = proxy.user ? `http://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}` : `http://${proxy.host}:${proxy.port}`;
    res.json({ ok: true, proxy, formatted, urlFormat });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/check-robot-frozen', async (req, res) => {
  try {
    const all = await getAccountsCached(true);
    const targets = all.filter(a => ['robot', 'app_lock'].includes(a.normStatus));
    if (targets.length === 0) {
      return res.json({ ok: true, message: '現在「ロボット解除待ち」のアカウントはありません。' });
    }

    let frozenCount = 0;
    let aliveLockCount = 0;
    const now = new Date();

    const concurrency = 5;
    let idx = 0;
    async function worker() {
      while (idx < targets.length) {
        const acc = targets[idx++];
        let isDead = false;
        let deadReason = '';

        if (checkAccountHealthApi && acc.authToken) {
          try {
            const proxy = (acc.proxy && acc.proxy.host) ? acc.proxy : (getResidentialProxyForAdmin ? await getResidentialProxyForAdmin(acc.authToken) : null);
            const hRes = await checkAccountHealthApi(acc.authToken, proxy, acc.userAgent, acc.savedCookies);
            if (hRes && hRes.status === 'unavailable') {
              isDead = true;
              deadReason = hRes.reason || 'frozen_or_invalid_api';
            }
          } catch (e) {}
        }

        if (!isDead && acc.userId && !acc.userId.startsWith('pending_')) {
          const pub = await checkPublicUserExists(acc.userId);
          if (pub.suspendedOrGone) {
            isDead = true;
            deadReason = 'suspended_public_check';
          }
        }

        if (isDead) {
          frozenCount++;
          await updateAccountState(acc.id, 'unavailable', { errorReason: deadReason }).catch(() => {});
        } else {
          aliveLockCount++;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
    invalidateCache();

    res.json({
      ok: true,
      message: `🔍 診断完了（全${targets.length}件）: 🚨既に凍結・死亡していた ${frozenCount} 件を「凍結・不良」へ移動しました！（生存ロック残り: ${aliveLockCount} 件）`
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// === エミュレーター専用の固定ポート自動切替ゲートウェイ (ポート 3128) ===
const EMULATOR_GATEWAY_PORT = parseInt(process.env.EMULATOR_GATEWAY_PORT || '3128', 10);
let currentTargetAccount = null;
const activeGatewaySockets = new Set();

function trackGatewaySocket(sock) {
  if (!sock) return;
  activeGatewaySockets.add(sock);
  sock.on('close', () => activeGatewaySockets.delete(sock));
}

function resetAllGatewaySockets() {
  for (const sock of activeGatewaySockets) {
    try { sock.destroy(); } catch (e) {}
  }
  activeGatewaySockets.clear();
}

const emuGatewayServer = http.createServer((req, res) => {
  trackGatewaySocket(req.socket);
  if (!currentTargetAccount || !currentTargetAccount.proxy) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('No target account selected in Admin UI.');
  }
  const proxy = currentTargetAccount.proxy;
  const authHeader = (proxy.user && proxy.pass)
    ? 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64')
    : null;

  const pReq = http.request({
    host: proxy.host,
    port: parseInt(proxy.port, 10),
    method: req.method,
    path: req.url,
    headers: { ...req.headers, ...(authHeader ? { 'Proxy-Authorization': authHeader } : {}) }
  }, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  pReq.on('error', () => res.end());
  req.pipe(pReq);
});

emuGatewayServer.on('connect', (req, clientSocket, head) => {
  trackGatewaySocket(clientSocket);
  if (!currentTargetAccount || !currentTargetAccount.proxy) {
    clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    return clientSocket.end();
  }
  const proxy = currentTargetAccount.proxy;
  const authHeader = (proxy.user && proxy.pass)
    ? 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64')
    : null;

  const connectReq = http.request({
    host: proxy.host,
    port: parseInt(proxy.port, 10),
    method: 'CONNECT',
    path: req.url,
    headers: authHeader ? { 'Proxy-Authorization': authHeader } : {}
  });
  connectReq.on('connect', (res, targetSocket, targetHead) => {
    trackGatewaySocket(targetSocket);
    if (res.statusCode === 200) {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (targetHead && targetHead.length) clientSocket.write(targetHead);
      if (head && head.length) targetSocket.write(head);
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    } else {
      clientSocket.end();
      targetSocket.end();
    }
  });
  connectReq.on('error', () => clientSocket.end());
  clientSocket.on('error', () => connectReq.destroy());
  connectReq.end();
});

emuGatewayServer.on('error', (e) => {
  console.log('⚠️ エミュゲートウェイ起動スキップ:', e.message);
});
emuGatewayServer.listen(EMULATOR_GATEWAY_PORT, '0.0.0.0', () => {
  console.log(`🎯 エミュレーター用・自動切替プロキシがポート ${EMULATOR_GATEWAY_PORT} で待機中`);
});

app.post('/api/select-emu-account', async (req, res) => {
  try {
    const { docId } = req.body;
    const snap = await getAccount(docId);
    if (!snap.exists) return res.json({ ok: false, error: 'アカウントが見つかりません' });
    const d = snap.data();
    const cleanToken = (d.authToken || '').trim();
    let proxy = (d.proxy && d.proxy.host) ? d.proxy : null;
    if (!proxy && getResidentialProxyForAdmin && cleanToken) {
      proxy = await getResidentialProxyForAdmin(cleanToken);
      if (proxy && proxy.host) {
        await updateAccountData(docId, { proxy }).catch(() => {});
      }
    }
    if (!proxy || !proxy.host) return res.json({ ok: false, error: 'プロキシが割り当てられていません' });

    // 前のアカウントのKeep-Alive通信ソケットをすべて強制切断し、IP混線を100%防ぐ
    resetAllGatewaySockets();

    currentTargetAccount = {
      docId,
      userId: d.userId || '',
      password: d.password || '',
      email: d.email || '',
      emailPassword: sanitizeEmailPassForExport(d.emailPassword, d.email),
      twoFa: d.twoFactorKey || d.twoFactorSecret || '',
      proxy
    };
    res.json({ ok: true, active: currentTargetAccount });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/current-emu-account', (req, res) => {
  res.json({ ok: true, active: currentTargetAccount, port: EMULATOR_GATEWAY_PORT });
});

const PORT = process.env.PORT || 3000;
const { registerMailboxRoutes } = require('./mailbox_service');
registerMailboxRoutes(app, db);

const { registerHybridSaasRoutes } = require('./hybrid_saas_routes');
registerHybridSaasRoutes(app, { runWorker: false });


const ENV_FILE_PATH = path.join(__dirname, '..', '.env');
const DOMAIN_HEALTH_FILE_PATH = path.join(__dirname, '..', '.domain_health.json');

function readEnvDomainsList() {
  try {
    if (!fs.existsSync(ENV_FILE_PATH)) return [];
    const envText = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    const m = envText.match(/^CUSTOM_EMAIL_DOMAINS=(.*)$/m);
    if (!m) return [];
    return m[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function writeEnvDomainsList(domList) {
  const unique = Array.from(new Set(domList.map(d => String(d || '').trim().toLowerCase()).filter(Boolean)));
  let envText = fs.existsSync(ENV_FILE_PATH) ? fs.readFileSync(ENV_FILE_PATH, 'utf8') : '';
  if (/^CUSTOM_EMAIL_DOMAINS=.*$/m.test(envText)) {
    envText = envText.replace(/^CUSTOM_EMAIL_DOMAINS=.*$/m, 'CUSTOM_EMAIL_DOMAINS=' + unique.join(','));
  } else {
    if (envText && !envText.endsWith('\n')) envText += '\n';
    envText += 'CUSTOM_EMAIL_DOMAINS=' + unique.join(',') + '\n';
  }
  fs.writeFileSync(ENV_FILE_PATH, envText, 'utf8');
  process.env.CUSTOM_EMAIL_DOMAINS = unique.join(',');
  return unique;
}

function readDomainHealthMap() {
  try {
    if (fs.existsSync(DOMAIN_HEALTH_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(DOMAIN_HEALTH_FILE_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function writeDomainHealthMap(mapObj) {
  fs.writeFileSync(DOMAIN_HEALTH_FILE_PATH, JSON.stringify(mapObj, null, 2), 'utf8');
}

app.get('/api/domains/status', (req, res) => {
  try {
    const envDoms = readEnvDomainsList();
    const health = readDomainHealthMap();
    const now = Date.now();
    const result = envDoms.map(dom => {
      const st = health[dom] || {};
      const cooldownUntil = st.cooldownUntil || 0;
      const isCooling = cooldownUntil > now;
      const remainHours = isCooling ? ((cooldownUntil - now) / 3600000).toFixed(1) : '0.0';
      const maxRejectStreak = Math.max(2, parseInt(process.env.DOMAIN_MAX_REJECT_STREAK || '3', 10));
      return {
        domain: dom,
        successCount: st.successCount || 0,
        failStreak: st.failStreak || 0,
        rejectedStreak: st.rejectedStreak || 0,
        maxRejectStreak,
        isCooling,
        remainHours,
        disabled: !!st.disabled,
        burnedAt: st.burnedAt || null,
        pendingNsActivation: !!st.pendingNsActivation,
        zoneStatus: st.zoneStatus || 'active'
      };
    });
    res.json({ ok: true, domains: result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/domains/add', async (req, res) => {
  try {
    const raw = String(req.body.rawDomains || '');
    const candidates = Array.from(new Set(raw.split(/[\s,;]+/)
      .map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^@/, '').replace(/\/.*$/, ''))
      .filter(s => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s))));
    if (candidates.length === 0) {
      return res.json({ ok: false, error: '有効なドメイン形式ではありません' });
    }

    const setupResults = await setupMultipleDomainsBulk(candidates);
    const configuredDomains = setupResults
      .filter(result => (
        result.ok &&
        result.mxConfigured &&
        result.txtConfigured &&
        result.spfConfigured &&
        result.dmarcConfigured &&
        result.aConfigured &&
        result.catchAllConfigured
      ))
      .map(result => result.domain);
    const failures = setupResults.filter(result => (
      !result.ok ||
      !result.mxConfigured ||
      !result.txtConfigured ||
      !result.spfConfigured ||
      !result.dmarcConfigured ||
      !result.aConfigured ||
      !result.catchAllConfigured
    ));
    if (configuredDomains.length === 0) {
      const details = failures.map(result => `${result.domain}: ${result.error || 'MX・TXT・Aレコードまたはキャッチオールの設定を確認できませんでした'}`).join('\n');
      return res.json({
        ok: false,
        added: 0,
        error: details || 'MX・TXT・Aレコードとキャッチオールを設定できませんでした',
        results: setupResults
      });
    }

    const current = readEnvDomainsList();
    const updated = writeEnvDomainsList([...current, ...configuredDomains]);
    const health = readDomainHealthMap();
    for (const d of configuredDomains) {
      if (!health[d]) {
        health[d] = {
          successCount: 0,
          failStreak: 0,
          rejectedStreak: 0,
          cooldownUntil: 0,
          disabled: false,
          recentTimestamps: []
        };
      }
    }
    writeDomainHealthMap(health);
    const failureMessage = failures.length
      ? ' / 設定失敗: ' + failures.map(result => `${result.domain} (${result.error || '設定失敗'})`).join(', ')
      : '';
    res.json({
      ok: failures.length === 0,
      added: configuredDomains.length,
      message: configuredDomains.length + '件のドメインにMX・TXT・Aレコードとキャッチオールを設定して追加しました (総数: ' + updated.length + '件)' + failureMessage,
      error: failures.length ? failureMessage.trim() : null,
      results: setupResults
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/domains/reset', (req, res) => {
  try {
    const target = String(req.body.domain || '').trim().toLowerCase();
    const health = readDomainHealthMap();
    const envDoms = readEnvDomainsList();
    const targets = target === 'all' ? envDoms : [target];
    for (const d of targets) {
      if (!d) continue;
      const prev = health[d] || {};
      const isPendingNs = !!(prev.pendingNsActivation || prev.zoneStatus === 'pending');
      health[d] = {
        ...prev,
        successCount: prev.successCount || 0,
        failStreak: 0,
        rejectedStreak: 0,
        wasLongCooled: false,
        burnedAt: null,
        cooldownUntil: isPendingNs ? (prev.cooldownUntil || 0) : 0,
        disabled: false,
        recentTimestamps: []
      };
    }
    writeDomainHealthMap(health);
    res.json({ ok: true, message: (target === 'all' ? '全ドメイン' : target) + ' の失敗回数・冷却時間を 0 にリセットしました！' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/domains/remove', (req, res) => {
  try {
    const target = String(req.body.domain || '').trim().toLowerCase();
    const current = readEnvDomainsList();
    const updated = writeEnvDomainsList(current.filter(d => d !== target));
    const health = readDomainHealthMap();
    if (health[target]) {
      health[target].disabled = true;
      writeDomainHealthMap(health);
    }
    res.json({ ok: true, message: target + ' をローテーションから除外しました (残り: ' + updated.length + '件)' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/debug-tunnel-info', (req, res) => {
  try {
    const info = {};
    const cfDir = '/home/u0_a217/.cloudflared';
    if (fs.existsSync(cfDir)) {
      info.cloudflaredFiles = fs.readdirSync(cfDir);
      for (const f of info.cloudflaredFiles) {
        if (f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json')) {
          try {
            info[f] = fs.readFileSync(path.join(cfDir, f), 'utf8');
          } catch (e) {}
        }
      }
    }
    const pm2Dump = '/home/u0_a217/.pm2/dump.pm2';
    if (fs.existsSync(pm2Dump)) {
      try {
        const dump = JSON.parse(fs.readFileSync(pm2Dump, 'utf8'));
        info.pm2Apps = dump.map(a => ({ name: a.name, script: a.pm_exec_path, args: a.args, env: a.pm2_env?.env }));
      } catch (e) {
        info.pm2DumpErr = e.message;
      }
    }
    const tLogOut = '/home/u0_a217/.pm2/logs/x-web-tunnel-out.log';
    if (fs.existsSync(tLogOut)) {
      info.tunnelLogOut = fs.readFileSync(tLogOut, 'utf8').slice(-2000);
    }
    const tLogErr = '/home/u0_a217/.pm2/logs/x-web-tunnel-error.log';
    if (fs.existsSync(tLogErr)) {
      info.tunnelLogErr = fs.readFileSync(tLogErr, 'utf8').slice(-2000);
    }
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  getAccountsCached(true).then(l => console.log("✅ DB初回キャッシュ完了: " + l.length + "件")).catch(e => console.error("⚠️ DB初回読込エラー:", e.message));
  return console.log(`\n🚀 高速キャッシュ＆ワーカー制御搭載 UI (src/admin.js) がポート ${PORT} で起動しました\n`);
});


// [PORT_80_DIRECT_LISTENER] ポート80 (HTTP) & ポート443 (HTTPS) でも直接マルチリンガルLPを提供
try {
  http.createServer(app).listen(80, '0.0.0.0', () => {
    console.log('🌐 マルチリンガルLP HTTPサーバーがポート 80 で待機開始しました');
  }).on('error', (e) => console.log('ℹ️ Port 80 listen skip:', e.message));
} catch (e) {}
try {
  if (fs.existsSync('/tmp/appflow_ssl.key') && fs.existsSync('/tmp/appflow_ssl.crt')) {
    const sslOpts = {
      key: fs.readFileSync('/tmp/appflow_ssl.key'),
      cert: fs.readFileSync('/tmp/appflow_ssl.crt')
    };
    https.createServer(sslOpts, app).listen(443, '0.0.0.0', () => {
      console.log('🔒 マルチリンガルLP HTTPSサーバーがポート 443 で待機開始しました');
    }).on('error', (e) => console.log('ℹ️ Port 443 listen skip:', e.message));
  }
} catch (e) {}
