require('dotenv').config();
process.env.DISPLAY = process.env.DISPLAY || ':99';
delete process.env.XAUTHORITY;
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execSync } = require('child_process');
const { db, saveAccount } = require('./firestore');
const { checkAndEnforceQuotaSync, recordExtraProxyKb, getResidentialProxy } = require('./iproyal');
const { getDeviceProfile } = require('./browser_config');
const { generateUniquePersonaProfileViaGemini } = require('./persona_engine');
const { buildStealthExtensionDir } = require('./browser_ext');
const { getPersistentProfileDir, slimProfileDir } = require('./status_checker');
const { has5SimKey, buyTwitterNumber, waitForSmsCode, cancelOrder } = require('./sms_5sim');
const { acquireFirstmailAccount, waitForFirstmailXCode, reportDomainOutcome, getDynamicPacingConfig } = require('./email_firstmail');

const rl = { close: () => {} };
const ask = (q) => new Promise(res => {
  const r = readline.createInterface({ input: process.stdin, output: process.stdout });
  r.question(q, ans => { r.close(); res(ans.trim()); });
});

const ROOT_DIR = path.join(__dirname, '..');
const SHOTS_DIR = path.join(ROOT_DIR, 'shots');
const LATEST_SNAP_PATH = path.join(ROOT_DIR, 'signup_step.png');
const POOL_FILE_PATH = path.join(ROOT_DIR, 'firstmail_pool.txt');
const USED_MAIL_PATH = path.join(ROOT_DIR, 'used_firstmail.txt');

if (fs.existsSync(SHOTS_DIR)) {
  try { fs.rmSync(SHOTS_DIR, { recursive: true, force: true }); } catch (e) {}
}
fs.mkdirSync(SHOTS_DIR, { recursive: true });

let _usedEmailCacheSet = null;
function getUsedEmailSetFast() {
  if (!_usedEmailCacheSet) {
    _usedEmailCacheSet = new Set(
      fs.existsSync(USED_MAIL_PATH)
        ? fs.readFileSync(USED_MAIL_PATH, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        : []
    );
  }
  return _usedEmailCacheSet;
}

function markEmailPermanentlyUsed(emailStr) {
  if (!emailStr) return;
  try {
    const clean = String(emailStr).trim();
    const usedSet = getUsedEmailSetFast();
    if (!usedSet.has(clean)) {
      usedSet.add(clean);
      fs.appendFileSync(USED_MAIL_PATH, clean + '\n', 'utf8');
    }

    if (fs.existsSync(POOL_FILE_PATH)) {
      const lines = fs.readFileSync(POOL_FILE_PATH, 'utf8')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(l => l.includes(':') && !l.startsWith(clean + ':'));
      fs.writeFileSync(POOL_FILE_PATH, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    }
  } catch (e) {}
}

function getRemainingPoolCount() {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
    const cDoms = (process.env.CUSTOM_EMAIL_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (cDoms.length > 0 && process.env.CATCHALL_IMAP_USER) return 9999;
    if (!fs.existsSync(POOL_FILE_PATH)) return 0;
    return fs.readFileSync(POOL_FILE_PATH, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(l => l.includes(':')).length;
  } catch (e) {
    return 9999;
  }
}

function generateRandomAccountProfile() {
  const isFemale = Math.random() < 0.48;
  const maleFirst = ['Kenta', 'Haruki', 'Takumi', 'Sota', 'Ren', 'Yuto', 'Daiki', 'Kaito', 'Asahi', 'Hinata', 'Riku', 'Haruto', 'Yuki', 'Sho', 'Kazuki', 'Naoto', 'Ryota', 'Kohei', 'Shota', 'Keita', 'Hayato', 'Tomoya', 'Sosuke', 'Tatsuya', 'Kosuke'];
  const femaleFirst = ['Yui', 'Hina', 'Sakura', 'Aoi', 'Rin', 'Mio', 'Nanami', 'Ayaka', 'Misaki', 'Kaede', 'Riko', 'Yuna', 'Mei', 'Koharu', 'Ichika', 'Saki', 'Honoka', 'Akari', 'Kanon', 'Noa', 'Natsuki', 'Chihiro', 'Haruka', 'Miyu', 'Rina'];
  const lastNames = ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Yamaguchi', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Saito', 'Shimizu', 'Mori', 'Ikeda', 'Hashimoto', 'Abe', 'Ishikawa', 'Yamashita', 'Nakajima', 'Ishii', 'Ogawa', 'Maeda', 'Okada', 'Hasegawa', 'Fujita', 'Goto', 'Kondo', 'Murakami', 'Endo', 'Aoki', 'Sakamoto', 'Fukuda', 'Ota', 'Nishimura', 'Fujii', 'Kaneko', 'Okamoto', 'Fujiwara', 'Miura', 'Nakano', 'Harada', 'Ono'];

  const firstList = isFemale ? femaleFirst : maleFirst;
  const fn = firstList[Math.floor(Math.random() * firstList.length)];
  const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
  const displayName = `${fn} ${ln}`;

  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = ['', '!', '_', '.'];
  const pick = (s, n) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');

  const birthYear = String(1978 + Math.floor(Math.random() * 24));
  const birthMonth = String(1 + Math.floor(Math.random() * 12));
  const birthDay = String(1 + Math.floor(Math.random() * 28));
  const mmdd = birthMonth.padStart(2, '0') + birthDay.padStart(2, '0');
  const yy = birthYear.slice(-2);

  // 機械的なランダム英字2文字を廃止し、本物の日本人が付ける自然なID構造に統一
  const fnLow = fn.toLowerCase();
  const lnLow = ln.toLowerCase();
  const uPatterns = [
    `${fnLow}_${lnLow.slice(0, 4)}${pick(digits, 2)}`,
    `${lnLow.slice(0, 4)}_${fnLow}${yy}`,
    `${fnLow}_${lnLow}${pick(digits, 2)}`,
    `${fnLow[0]}_${lnLow}${mmdd}`,
    `${lnLow}_${fnLow}${pick(digits, 2)}`,
    `${fnLow}${mmdd}${lnLow.slice(0, 3)}`
  ];
  const username = uPatterns[Math.floor(Math.random() * uPatterns.length)].slice(0, 14);

  const sym = symbols[Math.floor(Math.random() * symbols.length)];
  const pwPatterns = [
    `${pick(upper, 1)}${pick(lower, 6)}${pick(digits, 4)}${sym}`,
    `${pick(lower, 4)}${pick(upper, 2)}${pick(digits, 5)}`,
    `${pick(upper, 2)}${pick(lower, 5)}${pick(digits, 3)}${sym}${pick(lower, 2)}`,
    `${pick(lower, 6)}${pick(digits, 4)}${pick(upper, 2)}`
  ];
  const password = pwPatterns[Math.floor(Math.random() * pwPatterns.length)];

  return {
    displayName,
    username,
    password,
    gender: isFemale ? '女性' : '男性',
    birthYear,
    birthMonth,
    birthDay,
    age: 2026 - parseInt(birthYear, 10)
  };
}

function saveStageScreenshot(stageFileName, description) {
  try {
    const cleanName = stageFileName.endsWith('.png') ? stageFileName : `${stageFileName}.png`;
    const stagePathInShots = path.join(SHOTS_DIR, cleanName);
    const stagePathInRoot = path.join(ROOT_DIR, cleanName);

    execSync(`DISPLAY=:99 scrot -o "${stagePathInShots}" >/dev/null 2>&1`);
    fs.copyFileSync(stagePathInShots, stagePathInRoot);
    fs.copyFileSync(stagePathInShots, LATEST_SNAP_PATH);

    const sizeKb = (fs.statSync(stagePathInShots).size / 1024).toFixed(1);
    console.log(`  📸 [スクショ保存] ${cleanName} (${sizeKb}KB / ${description}) -> /signup-step.png 更新済`);
    return stagePathInShots;
  } catch (e) {
    return null;
  }
}


function ensureXvfbDisplay99WithResolution() {
  process.env.DISPLAY = ":99";
  try {
    execSync("DISPLAY=:99 xdotool getmouselocation >/dev/null 2>&1");
    try {
      execSync("pgrep -x openbox >/dev/null 2>&1");
    } catch (obErr) {
      const ob = spawn("openbox", [], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, DISPLAY: ":99", TZ: "Asia/Tokyo", LANG: "ja_JP.UTF-8" }
      });
      ob.unref();
      execSync("sleep 0.6");
    }
    return;
  } catch (e) {
    try {
      execSync("rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 >/dev/null 2>&1 || true");
      const xvfb = spawn("Xvfb", [":99", "-ac", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], {
        detached: true,
        stdio: "ignore"
      });
      xvfb.unref();
      execSync("sleep 1.5");
      const ob = spawn("openbox", [], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, DISPLAY: ":99", TZ: "Asia/Tokyo", LANG: "ja_JP.UTF-8" }
      });
      ob.unref();
      execSync("sleep 0.5");
      execSync("DISPLAY=:99 setxkbmap us >/dev/null 2>&1 || true");
    } catch (err) {}
  }
}

function startWindowManager() {
  ensureXvfbDisplay99WithResolution();
  console.log("  🪟 Xvfb :99 (1920x1080常時維持) & openbox 正常稼働中");
}

class DiagnosticRawCdp {
  constructor() {
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.recvBuffer = Buffer.alloc(0);
  }

  static async listTargets(debugPort) {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve([]); }
        });
      }).on('error', () => resolve([]));
    });
  }

  static async getBrowserWsUrl(debugPort) {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:${debugPort}/json/version`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data).webSocketDebuggerUrl || ''); } catch (e) { resolve(''); }
        });
      }).on('error', () => resolve(''));
    });
  }

  static async connectToTarget(wsUrlStr) {
    const wsUrl = new URL(wsUrlStr);
    const client = new DiagnosticRawCdp();
    await client._handshake(wsUrl);
    return client;
  }

  _handshake(wsUrl) {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: wsUrl.hostname,
        port: wsUrl.port,
        path: wsUrl.pathname + wsUrl.search,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13'
        }
      });

      req.on('upgrade', (res, socket, head) => {
        this.socket = socket;
        if (head && head.length > 0) this._onData(head);
        socket.on('data', (chunk) => this._onData(chunk));
        socket.on('error', () => {});
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  }

  _onData(chunk) {
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
    while (this.recvBuffer.length >= 2) {
      const firstByte = this.recvBuffer[0];
      const secondByte = this.recvBuffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.recvBuffer.length < 4) return;
        payloadLen = this.recvBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.recvBuffer.length < 10) return;
        payloadLen = Number(this.recvBuffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskOffset = isMasked ? 4 : 0;
      if (this.recvBuffer.length < offset + maskOffset + payloadLen) return;

      let payload = this.recvBuffer.slice(offset + maskOffset, offset + maskOffset + payloadLen);
      if (isMasked) {
        const mask = this.recvBuffer.slice(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }

      this.recvBuffer = this.recvBuffer.slice(offset + maskOffset + payloadLen);

      if (opcode === 0x01) {
        try {
          const msg = JSON.parse(payload.toString('utf8'));
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          } else if (msg.method && this.eventHandlers.has(msg.method)) {
            for (const fn of this.eventHandlers.get(msg.method)) {
              try { fn(msg.params, msg.sessionId); } catch (e) {}
            }
          }
        } catch (e) {}
      } else if (opcode === 0x09) {
        this._sendFrame(0x0a, payload);
      }
    }
  }

  _sendFrame(opcode, payloadBuffer) {
    if (!this.socket || this.socket.destroyed) return;
    const mask = crypto.randomBytes(4);
    const len = payloadBuffer.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const maskedPayload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) maskedPayload[i] = payloadBuffer[i] ^ mask[i % 4];
    try { this.socket.write(Buffer.concat([header, mask, maskedPayload])); } catch (e) {}
  }

  on(method, fn) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
    this.eventHandlers.get(method).push(fn);
  }

  send(method, params = {}, sessionId = null) {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject: () => resolve({}) });
      const payloadObj = sessionId ? { id, method, params, sessionId } : { id, method, params };
      const data = Buffer.from(JSON.stringify(payloadObj), 'utf8');
      this._sendFrame(0x01, data);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({});
        }
      }, 6000);
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res && res.result ? res.result.value : null;
  }

  close() {
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) {}
      this.socket = null;
    }
  }
}

async function getLivePageUrlWithoutCdp(debugPort) {
  const list = await DiagnosticRawCdp.listTargets(debugPort);
  const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  const hasGsiIframe = list.some(t => t.url && t.url.includes('accounts.google.com/gsi/'));
  return page ? { url: page.url || '', title: page.title || '', hasGsiIframe } : { url: '', title: '', hasGsiIframe: false };
}

async function dumpAiDiagnosticLog(debugPort, label) {
  console.log(`\n📊 ==================== [AI診断ログ: ${label}] ====================`);
  const targets = await DiagnosticRawCdp.listTargets(debugPort);
  const relevantTargets = targets.filter(t => (t.type === 'page' || t.type === 'iframe') && !t.url.startsWith('devtools://'));

  let summary = {
    mainUrl: '',
    actualUA: '',
    hasModal: false,
    state: 'unknown',
    activeDesc: '',
    inputs: [],
    modalInputs: [],
    selects: [],
    buttons: [],
    countryBtn: null,
    alerts: [],
    recentApis: [],
    modalContinueBtn: null,
    modalSkipBtn: null,
    cookies: [],
    authToken: null
  };

  for (let i = 0; i < relevantTargets.length; i++) {
    const t = relevantTargets[i];
    if (!t.webSocketDebuggerUrl) continue;
    let client = null;
    try {
      client = await DiagnosticRawCdp.connectToTarget(t.webSocketDebuggerUrl);
      if (i === 0) {
        const cookieRes = await client.send('Network.getAllCookies');
        const allCookies = (cookieRes && cookieRes.cookies) ? cookieRes.cookies : [];
        const xCookies = allCookies.filter(c => c.domain.includes('x.com') || c.domain.includes('twitter.com'));
        summary.cookies = xCookies;
        const authObj = xCookies.find(c => c.name === 'auth_token');
        if (authObj) summary.authToken = authObj.value;
      }

      const info = await client.evaluate("(function collectBrowserDiagnostics() {\n  const NL = String.fromCharCode(10);\n  const WS_RE = new RegExp('\\\\s+', 'g');\n\n  if (!window.__xHookInstalled) {\n    window.__xHookInstalled = true;\n    window.__xApiBodyLogs = [];\n    const origFetch = window.fetch;\n    if (origFetch) {\n      window.fetch = async function(...args) {\n        let reqText = 'none';\n        try {\n          const opts = args[1] || {};\n          const b = opts.body;\n          if (typeof b === 'string') {\n            reqText = b.slice(0, 240);\n          } else if (b && (b instanceof Uint8Array || b instanceof ArrayBuffer || ArrayBuffer.isView(b))) {\n            const u8 = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);\n            reqText = Array.from(u8).map(c => (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.').join('').slice(0, 240);\n          }\n        } catch (e) {}\n        const res = await origFetch.apply(this, args);\n        try {\n          const u = String((args[0] && args[0].url) || args[0] || '');\n          if (u.includes('begin_') || u.includes('viewer.json') || u.includes('onboarding') || u.includes('task.json') || u.includes('signup')) {\n            const clone = res.clone();\n            clone.text().then(t => {\n              const clean = t.split(NL).join(' ').replace(WS_RE, ' ').slice(0, 400);\n              window.__xApiBodyLogs.push({ url: u.slice(-55), status: res.status, req: reqText, body: clean });\n            }).catch(() => {});\n          }\n        } catch (e) {}\n        return res;\n      };\n    }\n  }\n\n  const apiBodyLogs = (window.__xApiBodyLogs || []).slice(-5);\n  const chromeTop = Math.max(78, window.outerHeight - window.innerHeight);\n  const ox = (window.screenX || 0);\n  const oy = (window.screenY || 0) + chromeTop;\n\n  const toScr = (r) => ({\n    x: Math.round(ox + r.left + r.width / 2),\n    leftX: Math.round(ox + r.left + r.width * 0.38),\n    y: Math.round(oy + r.top + r.height / 2),\n    w: Math.round(r.width),\n    h: Math.round(r.height)\n  });\n\n  let gpu = 'none';\n  try {\n    const c = document.createElement('canvas');\n    const gl = c.getContext('webgl');\n    if (gl) {\n      const ext = gl.getExtension('WEBGL_debug_renderer_info');\n      gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : 37446);\n    }\n  } catch (e) {}\n\n  const plat = (navigator.platform || '') + ' (Cores:' + (navigator.hardwareConcurrency || '?') + ', Screen:' + screen.width + 'x' + screen.height + ')';\n  const uaPlat = (navigator.userAgentData && navigator.userAgentData.platform) ? navigator.userAgentData.platform : '';\n  const actualUA = navigator.userAgent || '';\n  const webdriver = !!navigator.webdriver;\n  const activeEl = document.activeElement;\n  const activeDesc = activeEl\n    ? (activeEl.tagName + (activeEl.name ? '[name=' + activeEl.name + ']' : ''))\n    : 'none';\n\n  const dialog = document.querySelector('[role=\"dialog\"], [aria-modal=\"true\"]');\n\n  const alerts = Array.from(document.querySelectorAll('[role=\"alert\"], [data-testid=\"toast\"], [aria-live=\"assertive\"], [aria-live=\"polite\"]'))\n    .map(el => (el.innerText || el.textContent || '').split(NL).join(' ').replace(WS_RE, ' ').trim())\n    .filter(Boolean);\n\n  const recentApis = performance.getEntriesByType('resource')\n    .filter(r => r.name.includes('/i/api/') || r.name.includes('onboarding') || r.name.includes('arkose') || r.name.includes('account') || r.name.includes('flow'))\n    .slice(-6)\n    .map(r => ({\n      url: r.name.replace('https://x.com', '').replace('https://api.x.com', '').slice(0, 75),\n      status: r.responseStatus || 0,\n      durMs: Math.round(r.duration || 0)\n    }));\n\n  const inputs = Array.from(document.querySelectorAll('input')).filter(el => {\n    const r = el.getBoundingClientRect();\n    return r.width > 12 && r.height > 12;\n  }).map(el => {\n    const r = el.getBoundingClientRect();\n    const sc = toScr(r);\n    return {\n      ...sc,\n      inModal: !!(dialog && dialog.contains(el)) || sc.x > 600,\n      type: el.type || 'text',\n      name: el.name || '',\n      value: el.value || '',\n      invalid: el.getAttribute('aria-invalid') === 'true',\n      focused: (document.activeElement === el)\n    };\n  });\n\n  const selects = Array.from(document.querySelectorAll('select')).filter(el => {\n    const r = el.getBoundingClientRect();\n    return r.width > 15 && r.height > 12;\n  }).map((el, idx) => {\n    const r = el.getBoundingClientRect();\n    return { ...toScr(r), idx, name: el.name || '', value: el.value || '' };\n  });\n\n  const rawBtns = Array.from(document.querySelectorAll('button, [role=\"button\"], [role=\"combobox\"], [aria-disabled], [data-testid]'));\n  const buttons = rawBtns.filter(el => {\n    const r = el.getBoundingClientRect();\n    return r.width > 20 && r.height > 15 && r.top >= 0 && r.left < 1500;\n  }).map(el => {\n    const r = el.getBoundingClientRect();\n    const s = window.getComputedStyle(el);\n    const sc = toScr(r);\n    return {\n      ...sc,\n      inModal: !!(dialog && dialog.contains(el)) || sc.x > 600,\n      tag: el.tagName,\n      testId: el.getAttribute('data-testid') || '',\n      text: (el.innerText || el.textContent || '').split(NL).join(' ').replace(WS_RE, ' ').trim().slice(0, 35),\n      disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),\n      bg: s.backgroundColor,\n      opacity: s.opacity\n    };\n  }).filter(b => b.text.length > 0 || b.testId.length > 0);\n\n  const rawBody = document.body ? document.body.innerText : '';\n  const targetTextSource = dialog ? dialog.innerText : rawBody;\n  const visibleLines = targetTextSource.split(NL).map(s => s.trim()).filter(Boolean).slice(0, 20);\n  const modalOrBody = visibleLines.join(' ');\n  const url = window.location.href;\n\n  let detectedState = 'other';\n  if (url.includes('/home')) {\n    detectedState = 'home_screen';\n  } else if (url.includes('signup_preferences') || modalOrBody.includes('プライバシー設定')) {\n    detectedState = 'signup_preferences_screen';\n  } else if (url.includes('prelude_gate') || modalOrBody.includes('本人確認の準備中') || modalOrBody.includes('Preparing')) {\n    detectedState = 'prelude_gate_loading';\n  } else if (url.includes('face_liveness') || modalOrBody.includes('顔で認証') || modalOrBody.includes('人間による操作であることを確認') || modalOrBody.includes('Confirm with Face')) {\n    detectedState = 'face_liveness_screen';\n  } else if (url.includes('mode=login') || modalOrBody.includes('パスワードを入力')) {\n    detectedState = 'existing_login_screen';\n  } else if (url.includes('signup_phone') || modalOrBody.includes('電話番号を入力') || modalOrBody.includes('Enter your phone number')) {\n    detectedState = 'phone_screen';\n  } else if (\n    url.includes('verify_code') || url.includes('verify_phone') || url.includes('verification') ||\n    modalOrBody.includes('コードを送信しました') || modalOrBody.includes('認証コードを入力') ||\n    modalOrBody.includes('確認コード') || modalOrBody.includes('We sent you a code') ||\n    inputs.filter(x => x.inModal).length >= 6\n  ) {\n    detectedState = 'code_screen';\n  } else if (url.includes('signup_dob') || modalOrBody.includes('誕生日') || modalOrBody.includes('生年月日') || selects.length >= 3) {\n    detectedState = 'birth_screen';\n  } else if (\n    inputs.some(x => x.name === 'username_or_email') ||\n    modalOrBody.includes('以下のオプションから選択') ||\n    modalOrBody.includes('すべての話題が、ここに')\n  ) {\n    detectedState = 'landing_signup_modal';\n  } else if (\n    url.includes('unified_signup') ||\n    inputs.some(x => x.inModal && x.name === 'name') ||\n    modalOrBody.includes('アカウントを設定') ||\n    modalOrBody.includes('Set up your account') ||\n    modalOrBody.includes('Choose your name')\n  ) {\n    detectedState = 'account_setup_screen';\n  }\n\n  return {\n    url, chromeTop, gpu, plat, uaPlat, actualUA, webdriver, activeDesc, hasDialog: !!dialog, detectedState,\n    inputs, selects, buttons, alerts, recentApis, apiBodyLogs,\n    bodyText: modalOrBody.slice(0, 400),\n    visibleLines\n  };\n})()");

      if (info) {
        if (i === 0) {
          summary.mainUrl = info.url;
          summary.actualUA = info.actualUA || '';
          summary.activeDesc = info.activeDesc;
          summary.state = info.detectedState;
          summary.alerts = info.alerts || [];
          summary.recentApis = info.recentApis || [];
        }
        if (info.hasDialog) summary.hasModal = true;
        if (info.selects && info.selects.length > 0) summary.selects.push(...info.selects);

        console.log(`  📄 [Target ${i} (${t.type})] State=${info.detectedState} | URL: ${info.url}`);
        console.log(`      🖥️ [実機環境] OS=${info.plat} (UAData:${info.uaPlat}) | WebGL=${info.gpu} | webdriver=${info.webdriver}`);
        console.log(`      -> ChromeTop: ${info.chromeTop}px | Active要素: ${info.activeDesc} | Dialog: ${info.hasDialog}`);
        console.log(`      📖 [画面に書かれている文字一覧]:`);
        if (info.visibleLines && info.visibleLines.length > 0) {
          info.visibleLines.forEach((line, idx) => console.log(`         [${idx + 1}] "${line}"`));
        } else {
          console.log(`         (文字なし: "${info.bodyText}")`);
        }
        if (info.alerts && info.alerts.length > 0) {
          console.log(`      🚨 [警告/トースト検出]: ${JSON.stringify(info.alerts)}`);
        }
        if (info.recentApis && info.recentApis.length > 0) {
          console.log(`      🌐 [直近のX内部API通信]: ${info.recentApis.map(a => `${a.url} (status:${a.status}, ${a.durMs}ms)`).join(' | ')}`);
        }
        if (info.apiBodyLogs && info.apiBodyLogs.length > 0) {
          for (const ab of info.apiBodyLogs) {
            console.log(`      📦 [API応答中身] ${ab.url} (HTTP ${ab.status}) -> Req: ${ab.req || 'none'} | Res: ${ab.body}`);
          }
        }
        if (info.inputs && info.inputs.length > 0) {
          for (const inp of info.inputs) {
            console.log(`      ✏️ [Input (inModal=${inp.inModal})] name="${inp.name}" | value="${inp.value}" | invalid=${inp.invalid} | focused=${inp.focused} | 座標=(X:${inp.x}, Y:${inp.y})`);
            summary.inputs.push(inp);
            if (inp.inModal) summary.modalInputs.push(inp);
          }
        }
        if (info.buttons && info.buttons.length > 0) {
          for (const btn of info.buttons) {
            console.log(`      🔘 [Btn (inModal=${btn.inModal})] text="${btn.text}" | testId="${btn.testId}" | disabled=${btn.disabled} | bg=${btn.bg} | 座標=(X:${btn.x}, Y:${btn.y})`);
            summary.buttons.push(btn);
            const isCont = ['続ける', '次へ', '登録', '確認', '完了', 'Continue', 'Next', 'Sign up', 'Submit'].some(w => btn.text === w || (btn.text.includes(w) && !btn.text.includes('電話') && !btn.text.includes('Google') && !btn.text.includes('Apple') && !btn.text.includes('Cookie')));
            if (isCont && (btn.inModal || btn.x > 600)) {
              summary.modalContinueBtn = btn;
            }
            const isSkip = ['今はスキップ', 'スキップ', '後で', '今はしない', '同意する', 'Skip', 'Not now', 'Accept'].some(w => btn.text.includes(w));
            if (isSkip && (btn.inModal || btn.x > 600) && !btn.text.includes('Cookie')) {
              summary.modalSkipBtn = btn;
            }
          }
        }
      }
    } catch (e) {} finally {
      if (client) client.close();
    }
  }
  summary.countryBtn = summary.buttons.find(b => b.inModal && /\+\d+/.test(b.text)) || null;
  const phoneInp = summary.modalInputs.find(x => x.name === 'phone' || x.type === 'tel') || null;
  console.log(`  -----------------------------------------------------------------------`);
  console.log(`  🎯 [AI要旨] 状態: ${summary.state} | 続けるボタン: ${summary.modalContinueBtn ? `(X:${summary.modalContinueBtn.x}, Y:${summary.modalContinueBtn.y} / disabled=${summary.modalContinueBtn.disabled})` : '未検出'} | AuthToken: ${summary.authToken ? '発行済!' : '未発行'}`);
  console.log(`📊 =======================================================================\n`);
  return summary;
}

// ============================================================================
// 🖱️ 純粋X11物理マウス＆キーボード操作 (CDP一切不要)
// ============================================================================
let curX = 960;
let curY = 540;

function focusChromeWindow() {
  try {
    const winIds = execSync('DISPLAY=:99 xdotool search --onlyvisible --class "chrome" 2>/dev/null || true')
      .toString()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (winIds.length > 0) {
      const targetWin = winIds[winIds.length - 1];
      execSync(`DISPLAY=:99 xdotool windowactivate --sync ${targetWin} windowfocus --sync ${targetWin} >/dev/null 2>&1 || true`);
    }
  } catch (e) {}
}

function cubicBezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function humanMoveMouseRealTime(targetX, targetY) {
  const startX = curX;
  const startY = curY;
  const dist = Math.hypot(targetX - startX, targetY - startY);
  const steps = Math.max(18, Math.min(44, Math.floor(dist / 15) + randInt(-2, 5)));

  const spread = Math.min(120, Math.max(22, dist * (0.18 + Math.random() * 0.22)));
  const dir1 = Math.random() < 0.5 ? 1 : -1;
  const dir2 = Math.random() < 0.5 ? 1 : -1;
  const cp1x = startX + (targetX - startX) * 0.28 + dir1 * spread * (0.5 + Math.random() * 0.5);
  const cp1y = startY + (targetY - startY) * 0.28 + dir2 * spread * (0.5 + Math.random() * 0.5);
  const overX = targetX + (Math.random() < 0.4 ? randInt(-6, 6) : 0);
  const overY = targetY + (Math.random() < 0.4 ? randInt(-4, 4) : 0);
  const cp2x = startX + (overX - startX) * 0.72 - dir1 * spread * 0.25;
  const cp2y = startY + (overY - startY) * 0.72 - dir2 * spread * 0.25;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 2.4);
    const jx = (i < steps - 2) ? randInt(-1, 1) : 0;
    const jy = (i < steps - 2) ? randInt(-1, 1) : 0;
    const nx = Math.round(cubicBezier(eased, startX, cp1x, cp2x, overX) + jx);
    const ny = Math.round(cubicBezier(eased, startY, cp1y, cp2y, overY) + jy);
    try {
      execSync(`DISPLAY=:99 xdotool mousemove ${nx} ${ny}`);
    } catch (e) {}
    await new Promise(r => setTimeout(r, (t > 0.75) ? randInt(14, 25) : randInt(8, 16)));
  }
  if (overX !== Math.round(targetX) || overY !== Math.round(targetY)) {
    await new Promise(r => setTimeout(r, randInt(35, 75)));
    try {
      execSync(`DISPLAY=:99 xdotool mousemove ${Math.round(targetX)} ${Math.round(targetY)}`);
    } catch (e) {}
  }
  curX = Math.round(targetX);
  curY = Math.round(targetY);
}

// ページ完全描画後に人間が画面を見渡す自然なマウス移動・ホバー・微スクロールを発生させる
async function performPostLoadHumanExploration() {
  const points = [
    { x: randInt(410, 640), y: randInt(310, 390) },
    { x: randInt(760, 1140), y: randInt(360, 640) },
    { x: randInt(430, 630), y: randInt(490, 610) },
    { x: randInt(450, 620), y: randInt(660, 735) }
  ];
  const count = randInt(3, 4);
  console.log(`  🕵️ [人間行動テレメトリ] ページ描画完了後、視線に合わせてマウスを ${count} 箇所へ自然に動かします...`);
  for (let i = 0; i < count; i++) {
    const p = points[i % points.length];
    await humanMoveMouseRealTime(p.x + randInt(-20, 20), p.y + randInt(-15, 15));
    await new Promise(r => setTimeout(r, randInt(320, 740)));
  }
  if (Math.random() < 0.65) {
    try {
      execSync("DISPLAY=:99 xdotool click 5");
      await new Promise(r => setTimeout(r, randInt(240, 480)));
      execSync("DISPLAY=:99 xdotool click 4");
      await new Promise(r => setTimeout(r, randInt(300, 550)));
    } catch (e) {}
  }
}

async function humanClickRealTime(targetX, targetY, label, spreadX = 24, spreadY = 4) {
  const rx = Math.round(targetX + randInt(-spreadX, spreadX));
  const ry = Math.round(targetY + randInt(-spreadY, spreadY));
  console.log(`  🖱️ [人間物理クリック] 「${label}」 (X:${rx}, Y:${ry}) へ曲線移動してクリックします...`);
  await humanMoveMouseRealTime(rx, ry);
  await new Promise(r => setTimeout(r, randInt(260, 540)));
  try {
    execSync("DISPLAY=:99 xdotool mousedown 1");
    await new Promise(r => setTimeout(r, randInt(75, 145)));
    execSync("DISPLAY=:99 xdotool mouseup 1");
  } catch (e) {}
  await new Promise(r => setTimeout(r, randInt(850, 1250)));
}

function charToPhysicalKeySpec(ch) {
  if (ch === "@") return { key: "2", shift: true };
  if (ch === "_") return { key: "minus", shift: true };
  if (ch === "!") return { key: "1", shift: true };
  if (ch === "+") return { key: "equal", shift: true };
  if (ch === ".") return { key: "period", shift: false };
  if (ch === "-") return { key: "minus", shift: false };
  if (ch === "'") return { key: "apostrophe", shift: false };
  if (ch === " ") return { key: "space", shift: false };
  if (ch >= "A" && ch <= "Z") return { key: ch.toLowerCase(), shift: true };
  return { key: ch, shift: false };
}

async function clearInputSafely() {
  try {
    execSync("DISPLAY=:99 xdotool key End");
    await new Promise(r => setTimeout(r, 80));
    for (let i = 0; i < 18; i++) {
      execSync("DISPLAY=:99 xdotool key BackSpace");
      await new Promise(r => setTimeout(r, 30));
    }
    for (let i = 0; i < 8; i++) {
      execSync("DISPLAY=:99 xdotool key Delete");
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => setTimeout(r, 250));
  } catch (e) {}
}

async function humanTypePureKeysyms(text, clearExisting = false) {
  if (clearExisting) {
    await clearInputSafely();
  }

  const chars = Array.from(String(text));
  console.log(`  ⌨️ [人間リズム物理打鍵] "${text}" (${chars.length}文字) を実機キーボード配列で1鍵ずつ打ち込みます...`);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "@" || ch === ".") {
      await new Promise(r => setTimeout(r, randInt(180, 360)));
    }
    const spec = charToPhysicalKeySpec(ch);
    try {
      if (spec.shift) {
        execSync("DISPLAY=:99 xdotool keydown Shift_L");
        await new Promise(r => setTimeout(r, randInt(35, 70)));
      }
      execSync(`DISPLAY=:99 xdotool keydown ${spec.key}`);
      await new Promise(r => setTimeout(r, randInt(52, 115)));
      execSync(`DISPLAY=:99 xdotool keyup ${spec.key}`);
      if (spec.shift) {
        await new Promise(r => setTimeout(r, randInt(28, 60)));
        execSync("DISPLAY=:99 xdotool keyup Shift_L");
      }
    } catch (e) {}
    const isFast = (i > 0 && chars[i - 1] === ch) || "aeiou".includes(ch);
    await new Promise(r => setTimeout(r, isFast ? randInt(70, 135) : randInt(105, 240)));
  }
  await new Promise(r => setTimeout(r, randInt(950, 1450)));
}

async function enter6DigitSmsCodePhysically(debugPort, codeStr) {
  const cleanCode = String(codeStr).replace(/\D/g, '');
  const diag = await dumpAiDiagnosticLog(debugPort, '認証コード打鍵前の入力欄座標確認');

  const mInputs = diag.modalInputs.filter(x => x.name !== 'username').sort((a, b) => a.x - b.x);
  if (mInputs.length >= 6) {
    console.log('  🔢 6分割のコード入力ボックスを検出しました。1枠目をクリックして打鍵します...');
    await humanClickRealTime(mInputs[0].x, mInputs[0].y, 'コード1桁目入力欄');
    await humanTypePureKeysyms(cleanCode, false);
  } else if (mInputs.length >= 1) {
    const targetInp = mInputs.find(x => x.focused) || mInputs[0];
    if (!targetInp.focused) {
      await humanClickRealTime(targetInp.x, targetInp.y, 'モーダル内・認証コード入力欄');
    } else {
      console.log(`  ✨ 認証コード入力欄 (X:${targetInp.x}, Y:${targetInp.y}) にフォーカス済のため、そのまま "${cleanCode}" を打鍵します...`);
    }
    await humanTypePureKeysyms(cleanCode, false);
  } else {
    await humanClickRealTime(948, 519, 'モーダル中央コード入力位置');
    await humanTypePureKeysyms(cleanCode, false);
  }

  saveStageScreenshot('shot_07_code_typed.png', '6桁認証コード打鍵完了直後');
  console.log('  ⏳ 6桁入力によるX側の自動認証(スピナー処理)の完了を4.5秒間待機します...');
  await new Promise(r => setTimeout(r, 4500));

  const afterTypeDiag = await dumpAiDiagnosticLog(debugPort, '6桁コード打鍵4.5秒後の画面遷移確認');
  if (afterTypeDiag.state === 'code_screen') {
    if (afterTypeDiag.modalContinueBtn && !afterTypeDiag.modalContinueBtn.disabled) {
      await humanClickRealTime(afterTypeDiag.modalContinueBtn.x, afterTypeDiag.modalContinueBtn.y, `モーダル内「${afterTypeDiag.modalContinueBtn.text}」ボタン`);
    } else {
      await humanClickRealTime(944, 785, 'モーダル下部「続ける」ボタン');
    }
  } else {
    console.log(`  🎉 6桁コード認証成功！画面が [${afterTypeDiag.state}] へ自動遷移しました！`);
  }
}

// ============================================================================
// 🌍 Geo-Sync (国籍完全同期) プロキシ取得 ＆ 直近使用IP回避
// ============================================================================
function buildGeoSyncedProxy(baseSeed, targetIsoCountry = 'jp') {
  const iso = String(targetIsoCountry || 'jp').toLowerCase() === 'uk' ? 'gb' : String(targetIsoCountry || 'jp').toLowerCase();
  const baseProxy = getResidentialProxy(baseSeed, { country: iso });
  return {
    ...baseProxy,
    targetIso: iso.toUpperCase()
  };
}

function verifyProxyIpAndHttpsTunnel(proxy, expectedIsoUpper = 'JP') {
  return new Promise((resolve) => {
    const auth = 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64');
    const req = http.request({
      host: proxy.host,
      port: parseInt(proxy.port, 10),
      method: 'GET',
      path: 'http://ip-api.com/json/?fields=status,countryCode,isp,hosting,proxy,query',
      headers: { 'Proxy-Authorization': auth, 'User-Agent': 'curl/8.0' },
      timeout: 7500
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (!d || d.status !== 'success') return resolve({ ok: false });
          if (d.hosting || d.countryCode !== expectedIsoUpper) {
            return resolve({ ok: false, ip: d.query, countryCode: d.countryCode, isp: d.isp, hosting: !!d.hosting, proxy: !!d.proxy });
          }

          const t0 = Date.now();
          const connectReq = http.request({
            host: proxy.host,
            port: parseInt(proxy.port, 10),
            method: 'CONNECT',
            path: 'x.com:443',
            headers: { 'Proxy-Authorization': auth },
            timeout: 3200
          });
          connectReq.on('connect', (cRes, sock) => {
            const rttMs = Date.now() - t0;
            sock.destroy();
            if (cRes.statusCode === 200 && rttMs <= 1500) {
              resolve({ ok: !d.proxy, usableFallback: true, ip: d.query, countryCode: d.countryCode, isp: d.isp, hosting: false, proxy: !!d.proxy, rttMs });
            } else {
              resolve({ ok: false, ip: d.query, countryCode: d.countryCode, isp: d.isp, reason: rttMs > 1500 ? ('SLOW_' + rttMs + 'ms') : ('CONNECT_' + cRes.statusCode) });
            }
          });
          connectReq.on('error', () => resolve({ ok: false, ip: d.query, countryCode: d.countryCode, isp: d.isp, reason: 'CONNECT_ERR' }));
          connectReq.on('timeout', () => { connectReq.destroy(); resolve({ ok: false, ip: d.query, countryCode: d.countryCode, isp: d.isp, reason: 'CONNECT_TIMEOUT' }); });
          connectReq.end();
        } catch (e) { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
}

const RECENT_SUBNETS_FILE = path.join(ROOT_DIR, '.recent_subnets.json');
function getRecentSubnets() {
  try {
    if (fs.existsSync(RECENT_SUBNETS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(RECENT_SUBNETS_FILE, 'utf8'));
      // 過去の /16 (A.B.) 広域ブロックや ISP: タグは良質な家庭回線まで枯渇させるため除外し、完全一致IPと /24 (A.B.C.) のみ保持する
      return Array.isArray(raw)
        ? raw.filter(p => typeof p === 'string' && !p.startsWith('ISP:') && !/^\d+\.\d+\.$/.test(p))
        : [];
    }
  } catch (e) {}
  return [];
}
function recordUsedSubnet(ipStr = '') {
  try {
    const parts = String(ipStr).split('.');
    if (parts.length < 4) return;
    const prefix24 = `${parts[0]}.${parts[1]}.${parts[2]}.`;
    const list = getRecentSubnets().filter(p => p !== prefix24 && p !== ipStr);
    list.unshift(ipStr);
    list.unshift(prefix24);
    fs.writeFileSync(RECENT_SUBNETS_FILE, JSON.stringify(list.slice(0, 80)), 'utf8');
  } catch (e) {}
}

async function acquireGeoSyncedCleanProxy(baseSeed, targetIsoCountry = 'jp') {
  const expectedIso = String(targetIsoCountry || 'jp').toUpperCase();
  for (let round = 1; round <= 3; round++) {
    const recentSubnets = getRecentSubnets();
    console.log(`🔍 [Geo-Sync IP品質監査] 国 (${expectedIso}) の未使用ISP回線を厳選中 (直近/24・同一IP回避: ${recentSubnets.slice(0, 4).join(', ')})...`);
    let fallbackCandidate = null;

    for (let i = 1; i <= 18; i++) {
      const candidate = buildGeoSyncedProxy(`${baseSeed}_r${round}_try${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, targetIsoCountry);
      const check = await verifyProxyIpAndHttpsTunnel(candidate, expectedIso);
      if (check.ip) {
        const parts = String(check.ip).split('.');
        const prefix16 = parts.length >= 2 ? `${parts[0]}.${parts[1]}.` : '';
        const prefix24 = parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}.` : '';
        const bannedPrefixes = ['202.231.'];
        // データセンター・クラウド・VPN・衛星回線のみを除外し、J:COM・楽天・CATV・地域光などの一般家庭ISPはすべて許可する
        const isBannedIsp = bannedPrefixes.includes(prefix16) || /ntt\s*pc|level\s*3|interlink|multifeed|space\s*exploration|starlink|sakura\s*internet|linode|akamai|vultr|digitalocean|amazon|google\s*cloud|microsoft|oracle|hetzner|ovh|m247|datacamp|leaseweb|cogent/i.test(String(check.isp || ''));
        const isExactRecent = recentSubnets.includes(check.ip);
        const isSubnetRecent = isBannedIsp || recentSubnets.slice(0, 24).includes(prefix24);
        console.log(`   -> [試行 ${i}] IP: ${check.ip} (${check.countryCode}) / ISP: ${check.isp} (Hosting:${!!check.hosting}, Proxy:${!!check.proxy}${(isExactRecent || isSubnetRecent) ? ', ⚠️直近/24またはDC帯域のためスキップ' : ''})`);
        if (check.ok && !isExactRecent && !isSubnetRecent) {
          recordUsedSubnet(check.ip, check.isp);
          console.log(`  ✅ [Geo-Sync完了] 未使用/24サブネットのクリーン住宅用IPをロックしました！ (${check.ip} / ${check.isp})`);
          return candidate;
        }
        if (check.ok && !check.proxy && !isBannedIsp && !isExactRecent && !fallbackCandidate) {
          fallbackCandidate = { candidate, ip: check.ip };
        }
      } else {
        console.log(`   -> [試行 ${i}] オフライン回線のためスキップして次を検索中...`);
      }
    }
    if (fallbackCandidate) {
      recordUsedSubnet(fallbackCandidate.ip);
      console.log(`  ✅ [Geo-Sync完了] 稼働住宅用ISP回線をロックしました！ (${fallbackCandidate.ip})`);
      return fallbackCandidate.candidate;
    }
    console.log('  ⏳ 有効なプロキシが見つからなかったため、12秒待機して再検索します...');
    await new Promise(r => setTimeout(r, 12000));
  }
  throw new Error(`国コード ${expectedIso} の有効なプロキシ回線が見つかりませんでした。`);
}

function startLoggingProxyForwarder(initialProxy) {
  let currentProxy = initialProxy;
  let proxyBytesUsed = 0;
  const activeSockets = new Set();

  const server = http.createServer((req, res) => {
    activeSockets.add(req.socket);
    req.socket.on('close', () => activeSockets.delete(req.socket));
    const auth = 'Basic ' + Buffer.from(`${currentProxy.user}:${currentProxy.pass}`).toString('base64');
    const pReq = http.request({
      host: currentProxy.host,
      port: parseInt(currentProxy.port, 10),
      method: req.method,
      path: req.url,
      headers: { ...req.headers, 'Proxy-Authorization': auth }
    }, (pRes) => {
      res.writeHead(pRes.statusCode, pRes.headers);
      pRes.on('data', chunk => { proxyBytesUsed += chunk.length; });
      pRes.pipe(res);
    });
    pReq.on('error', () => { try { res.end(); } catch (e) {} });
    req.pipe(pReq);
  });

  server.on('connect', (req, clientSocket, head) => {
    activeSockets.add(clientSocket);
    clientSocket.on('close', () => activeSockets.delete(clientSocket));

    const auth = 'Basic ' + Buffer.from(`${currentProxy.user}:${currentProxy.pass}`).toString('base64');
    const connectReq = http.request({
      host: currentProxy.host,
      port: parseInt(currentProxy.port, 10),
      method: 'CONNECT',
      path: req.url,
      headers: { 'Proxy-Authorization': auth }
    });
    connectReq.on('connect', (res, targetSocket, targetHead) => {
      activeSockets.add(targetSocket);
      targetSocket.on('close', () => activeSockets.delete(targetSocket));
      if (res.statusCode === 200) {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (targetHead && targetHead.length) clientSocket.write(targetHead);
        if (head && head.length) targetSocket.write(head);
        targetSocket.on('data', c => { proxyBytesUsed += c.length; });
        clientSocket.on('data', c => { proxyBytesUsed += c.length; });
        targetSocket.on('error', () => { try { clientSocket.destroy(); } catch (e) {} });
        clientSocket.on('error', () => { try { targetSocket.destroy(); } catch (e) {} });
        targetSocket.pipe(clientSocket);
        clientSocket.pipe(targetSocket);
      } else {
        clientSocket.end();
        targetSocket.end();
      }
    });
    connectReq.on('error', () => { try { clientSocket.end(); } catch (e) {} });
    clientSocket.on('error', () => { try { connectReq.destroy(); } catch (e) {} });
    connectReq.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        getStats: () => ({ proxyKb: Math.round(proxyBytesUsed / 1024) }),
        getProxy: () => currentProxy,
        closeAll: () => {
          for (const s of activeSockets) {
            try { s.destroy(); } catch (e) {}
          }
          activeSockets.clear();
          try { server.close(); } catch (e) {}
        }
      });
    });
    server.on('error', reject);
  });
}

function generateNativeMorphProfile(seedStr = "") {
  let h = 2166136261;
  const s = String(seedStr) + "_" + Date.now() + "_" + Math.random();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const abs = Math.abs(h);

  const gpuCatalog = [
    { vendor: "Intel", renderer: "Mesa Intel(R) UHD Graphics 630 (CFL GT2)", version: "4.6 (Core Profile) Mesa 24.0.9" },
    { vendor: "Intel", renderer: "Mesa Intel(R) UHD Graphics 770 (ADL-S GT1)", version: "4.6 (Core Profile) Mesa 24.0.9" },
    { vendor: "Intel", renderer: "Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2)", version: "4.6 (Core Profile) Mesa 24.0.9" },
    { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce RTX 3060/PCIe/SSE2", version: "4.5.0 NVIDIA 550.120" },
    { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce RTX 4060/PCIe/SSE2", version: "4.5.0 NVIDIA 550.120" },
    { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce GTX 1660 SUPER/PCIe/SSE2", version: "4.5.0 NVIDIA 535.183.01" },
    { vendor: "AMD", renderer: "AMD Radeon RX 6600 (radeonsi, navi23, LLVM 17.0.6, DRM 3.57, 6.8.0-45-generic)", version: "4.6 (Core Profile) Mesa 24.0.9" },
    { vendor: "AMD", renderer: "AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 17.0.6, DRM 3.57, 6.8.0-45-generic)", version: "4.6 (Core Profile) Mesa 24.0.9" }
  ];

  // Xvfb 物理モニター解像度自体を毎回変更 (JS改ざんゼロで screen.width === window.outerWidth が全フレームで一致する)
  const screenResolutions = [ { w: 1920, h: 1080 } ];

  const coreConfigs = [
    { cores: 4, mask: "0-3" },
    { cores: 6, mask: "0-5" },
    { cores: 8, mask: "0-7" }
  ];

  const pickedGpu = gpuCatalog[abs % gpuCatalog.length];
  const pickedRes = screenResolutions[(abs >> 2) % screenResolutions.length];
  const pickedCore = coreConfigs[(abs >> 5) % coreConfigs.length];
  const colorProfiles = ["srgb", "display-p3-d65"];
  const colorProfile = colorProfiles[(abs >> 7) % colorProfiles.length];
  // 4回に1回は 09:05 (@asahi_suz92cf1) 一発成功パターンの WebGL 無効モードも織り交ぜる
  const useWebgl = true;

  return {
    vendor: pickedGpu.vendor,
    renderer: pickedGpu.renderer,
    version: pickedGpu.version,
    screenW: pickedRes.w,
    screenH: pickedRes.h,
    cores: pickedCore.cores,
    cpuMask: pickedCore.mask,
    colorProfile,
    useWebgl
  };
}

function spawnPureSandboxChrome(userDataDir, localProxyPort, debugPort, timezone = "Asia/Tokyo", seedUser = "default", startUrl = "https://x.com/") {
  const chromeBins = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  const bin = chromeBins.find(p => fs.existsSync(p));
  const bypass = ["127.0.0.1", "localhost"].join(";");

  const morph = generateNativeMorphProfile(seedUser);
  // 1. Xvfb :99 自体を今回のモニター解像度 (screenW x screenH) で起動して実応答を確認
  ensureXvfbDisplay99WithResolution(morph.screenW, morph.screenH);
  // 2. 隔離 HOME (userDataDir) 内に固有 DPI の fontconfig と Chrome Preferences を生成
  buildStealthExtensionDir(userDataDir, {}, seedUser + "_" + Date.now());

  // モニター解像度に応じた中心座標オフセット (1920x1080 基準との差分)
  const offsetX = Math.round((morph.screenW - 1920) / 2);
  const offsetY = Math.round((morph.screenH - 1080) / 2);

  const soFile = path.join(__dirname, "libgl_morph.so");
  const hasSo = fs.existsSync(soFile);

  console.log(`  🛡️ [純粋OS/Cネイティブ起動 (CDP未接続・JS改ざんゼロ)] Xvfb=${morph.screenW}x${morph.screenH} (座標補正:X${offsetX >= 0 ? "+" : ""}${offsetX},Y${offsetY >= 0 ? "+" : ""}${offsetY}) | Cores=${morph.cores} | WebGL=${morph.useWebgl ? morph.renderer.slice(0, 42) : "none(09:05成功モード)"}`);

  const args = [
    "-c", morph.cpuMask,
    bin,
    `--force-color-profile=${morph.colorProfile}`,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--proxy-server=http://127.0.0.1:${localProxyPort}`,
    `--proxy-bypass-list=${bypass}`,
    ...(morph.useWebgl ? ["--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"] : ["--disable-webgl"]),
    "--use-fake-device-for-media-stream",
    "--test-type",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--enforce-webrtc-ip-permission-check",
    "--password-store=basic",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--autoplay-policy=document-user-activation-required",
    "--no-default-browser-check",
    "--disable-features=Translate,TranslateUI,OptimizationHints,MediaRouter",
    "--lang=ja",
    "--window-position=0,0",
    `--window-size=${morph.screenW},${morph.screenH}`,
    startUrl
  ];

  const proc = spawn("taskset", args, {
    stdio: "ignore",
    env: {
      ...process.env,
      HOME: userDataDir,
      XDG_CONFIG_HOME: path.join(userDataDir, ".config"),
      XDG_CACHE_HOME: path.join(userDataDir, ".cache"),
      DISPLAY: ":99",
      LANG: "ja_JP.UTF-8",
      LANGUAGE: "ja:en",
      TZ: timezone,
      MORPH_GL_VENDOR: morph.vendor,
      MORPH_GL_RENDERER: morph.renderer,
      MORPH_GL_VERSION: morph.version,
      ...(hasSo && morph.useWebgl ? { LD_PRELOAD: soFile } : {})
    }
  });
  proc.morphOffset = { offsetX, offsetY, screenW: morph.screenW, screenH: morph.screenH };
  return proc;
}

async function setRandomBirthdateSelects(debugPort, yearStr, monthStr, dayStr) {
  const targets = await DiagnosticRawCdp.listTargets(debugPort);
  const pageT = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
  if (!pageT || !pageT.webSocketDebuggerUrl) return;
  const client = await DiagnosticRawCdp.connectToTarget(pageT.webSocketDebuggerUrl);
  await client.evaluate(`((yVal, mVal, dVal) => {
    const selects = Array.from(document.querySelectorAll('select'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    const enMonths = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const targetEnMonth = enMonths[parseInt(mVal, 10) - 1] || 'May';

    for (const sel of selects) {
      const opts = Array.from(sel.options);
      const name = (sel.name || '').toLowerCase();
      let targetOpt = null;
      if (name.includes('year') || opts.some(o => o.value === '1995')) {
        targetOpt = opts.find(o => o.value === yVal || (o.text || '').includes(yVal));
      } else if (name.includes('month') || opts.length <= 14) {
        targetOpt = opts.find(o => o.value === mVal || o.value === mVal.padStart(2, '0') || (o.text || '') === mVal + '月' || (o.text || '').includes(targetEnMonth));
      } else {
        targetOpt = opts.find(o => o.value === dVal || o.value === dVal.padStart(2, '0') || (o.text || '') === dVal || (o.text || '') === dVal + '日');
      }
      if (targetOpt) {
        sel.focus();
        if (setter) setter.call(sel, targetOpt.value);
        else sel.value = targetOpt.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  })(${JSON.stringify(yearStr)}, ${JSON.stringify(monthStr)}, ${JSON.stringify(dayStr)})`);
  client.close();
}

let _probeDomainCursor = 0;
async function tryAcquireEmailForSignup(profile = null) {
  const probeArg = process.argv.find(a => a.startsWith("--probe-domain="));
  if (probeArg) {
    const rawDomList = (probeArg.split("=")[1] || "gmail.com").split(",").map(s => s.trim()).filter(Boolean);
    const dom = rawDomList[_probeDomainCursor % rawDomList.length] || "gmail.com";
    _probeDomainCursor++;
    const cArg = (process.argv.find(a => a.startsWith("--country=")) || "").slice(10).trim().toLowerCase();
    const isNonJp = Boolean(cArg && cArg !== "jp");
    const jpPrefixes = ["haruki.yoshida", "kenta.takahashi", "takumi.watanabe", "ren.kobayashi", "sota.nakamura", "yuto.yamamoto", "daiki.ito", "naoto.saito"];
    const enPrefixes = ["alex.carter", "lucas.bennett", "ethan.parker", "noah.mitchell", "liam.turner", "mason.collins", "oliver.hayes", "logan.brooks"];
    const prefixes = isNonJp ? enPrefixes : jpPrefixes;
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(1000 + Math.random() * 8999);
    const probeEmail = `${p}${num}@${dom}`;
    console.log(`🧪 [ドメイン突破テスト] テスト用アドレスを生成しました: ${probeEmail}`);
    return { email: probeEmail, password: "", source: "probe_domain" };
  }
  const manualArg = process.argv.find(a => a.startsWith("--manual-email="));
  if (manualArg) {
    const raw = manualArg.slice("--manual-email=".length).trim();
    const [em, pw] = raw.includes(":") ? raw.split(":") : [raw, ""];
    console.log(`📧 [手動指定メール] ${em} を使用します`);
    return { email: em.trim(), password: (pw || "").trim(), source: "manual_email" };
  }
  try {
    const usedSet = getUsedEmailSetFast();
    for (let guard = 0; guard < 200; guard++) {
      const acc = await acquireFirstmailAccount(profile);
      if (!acc) return null;
      if (!usedSet.has(acc.email)) return acc;
      console.log(`  ⏭️ 既に使用済みのメール (${acc.email}) をスキップしました`);
    }
    return null;
  } catch (e) {
    console.error(`  ⚠️ [メール取得エラー]: ${e && e.message ? e.message : e}`);
    return null;
  }
}

// グローバル中断ハンドラ用ステート
const activeSession = {
  mailAccount: null,
  accountSaved: false,
  emailConsumedOnX: false,
  forwarder: null,
  chromeProc: null,
  stealthClient: null
};


async function hardKillAllBrowserAndProxy(tempDirPrefix = '') {
  if (activeSession.stealthClient) {
    try { activeSession.stealthClient.close(); } catch (e) {}
    activeSession.stealthClient = null;
  }
  if (activeSession.chromeProc) {
    const pid = activeSession.chromeProc.pid;
    try {
      if (pid) execSync(`pkill -9 -P ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
      activeSession.chromeProc.kill('SIGKILL');
    } catch (e) {}
    activeSession.chromeProc = null;
  }
  if (activeSession.forwarder) {
    try { activeSession.forwarder.closeAll(); } catch (e) {}
    activeSession.forwarder = null;
  }
  // 他のエンジン(init_profiles/batch_engine/VNC)のChromeを巻き込まないよう camoufox / patchright 関連のみクリーンアップ
  try { execSync('pkill -9 -f camoufox_runner.py || pkill -9 -f patchright_runner.py || pkill -9 -f patchright_prof_ || pkill -9 -f camoufox || true', { stdio: 'ignore' }); } catch (e) {}
  try { execSync('rm -rf /tmp/camoufox* /tmp/playwright* /tmp/patchright_prof_* 2>/dev/null || true', { stdio: 'ignore' }); } catch (e) {}
  if (tempDirPrefix) {
    try { execSync(`rm -rf "${tempDirPrefix}"* 2>/dev/null || true`, { stdio: 'ignore' }); } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 1200));
}

function returnCurrentMailIfUnused(putAtFront = false) {
  const m = activeSession.mailAccount;
  if (m && m.source === 'pool_file' && !activeSession.accountSaved && !activeSession.emailConsumedOnX) {
    try {
      const usedSet = getUsedEmailSetFast();
      if (usedSet.has(m.email)) return;

      let lines = fs.existsSync(POOL_FILE_PATH)
        ? fs.readFileSync(POOL_FILE_PATH, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(':'))
        : [];
      lines = lines.filter(l => !l.startsWith(m.email + ':'));
      const entry = `${m.email}:${m.password}`;

      if (putAtFront) {
        lines.unshift(entry);
        console.log(`♻️ [Firstmail保護] 未送信の ${m.email} を firstmail_pool.txt の先頭へ戻しました`);
      } else {
        lines.push(entry);
        console.log(`♻️ [Firstmail保護] 送信済みの ${m.email} をクールダウンのため firstmail_pool.txt の最後尾へ移動しました`);
      }
      fs.writeFileSync(POOL_FILE_PATH, lines.join('\n') + '\n', 'utf8');
      activeSession.mailAccount = null;
    } catch (e) {}
  }
}

process.once('SIGINT', () => {
  console.log('\n🛑 中断シグナル (SIGINT) 検知: 未使用メール保護とクリーンアップを実行しています...');
  returnCurrentMailIfUnused(true);
  if (activeSession.forwarder && activeSession.forwarder.getStats) {
    const st = activeSession.forwarder.getStats();
    console.log(`📊 [プロキシ通信量] 今回セッション消費: ${st.proxyKb} KB`);
  }
  if (activeSession.chromeProc) { try { activeSession.chromeProc.kill('SIGKILL'); } catch (e) {} }
  try { execSync('pkill -9 -f camoufox_runner.py || pkill -9 -f camoufox || true', { stdio: 'ignore' }); } catch (e) {}
  process.exit(0);
});

function runCamoufoxAttempt(payloadObj) {
  return new Promise((resolve) => {
    const pyBin = path.join(ROOT_DIR, ".camoufox_env/bin/python");
    const isPatchright = payloadObj.engine === "patchright";
    const runnerPath = path.join(__dirname, isPatchright ? "patchright_runner.py" : "camoufox_runner.py");
    const tagLabel = isPatchright ? "[Patchright]" : "[Camoufox]";
    let resultObj = null;
    const child = spawn(pyBin, [runnerPath, JSON.stringify(payloadObj)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DISPLAY: ":99" }
    });
    activeSession.chromeProc = child;
    let buf = "";
    child.stdout.on("data", (chunk) => {
      const s = chunk.toString("utf8");
      buf += s;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith("RESULT_JSON:")) {
          try { resultObj = JSON.parse(line.slice("RESULT_JSON:".length)); } catch (e) {}
        } else {
          console.log(line);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString("utf8").trim();
      if (s && !s.includes("LeakWarning")) console.log("  " + tagLabel, s);
    });
    child.on("close", () => resolve(resultObj || { ok: false, reason: "closed" }));
    child.on("error", () => resolve(resultObj || { ok: false, reason: "spawn_error" }));
  });
}

async function runSingleAccountSession(sessionNumber) {
  checkAndEnforceQuotaSync('setup_worker');
  try { execSync('pkill -9 -f camoufox_runner.py || pkill -9 -f camoufox || true', { stdio: 'ignore' }); } catch (e) {}

  let profile = generateRandomAccountProfile();
  let finalUser = profile.username;
  const devProf = getDeviceProfile(finalUser);
  let password = profile.password;
  let geminiPersona = null;
  let tempName = profile.displayName;

  activeSession.mailAccount = null;
  activeSession.accountSaved = false;
  activeSession.emailConsumedOnX = false;
  activeSession.forwarder = null;
  activeSession.chromeProc = null;

  console.log("\n============================================================");
  console.log(`🛠️ 【Camoufox 連続自動作成ファクトリー: 第 ${sessionNumber} アカウント目 (残りメールプール: ${getRemainingPoolCount()}件)】`);
  console.log(`  🎲 生成プロフィール: ${tempName} (@${finalUser}) | PW: ${password} | ${profile.birthYear}-${profile.birthMonth}-${profile.birthDay} (${profile.age}歳)`);
  console.log("============================================================");

  try {
    const isProbeMode = process.argv.some(a => a.startsWith("--probe-domain="));
    const probeArgPre = (process.argv.find(a => a.startsWith("--probe-domain=")) || "").slice(15).trim();
    const probeDomCountPre = probeArgPre ? probeArgPre.split(",").filter(Boolean).length : 1;
    const countryArgPre = (process.argv.find(a => a.startsWith("--country=")) || "").slice(10).trim().toLowerCase();
    const envCountryPre = String(process.env.SETUP_TARGET_COUNTRY || "mix").trim().toLowerCase();
    const effectiveCountryMode = countryArgPre || envCountryPre || "mix";
    const countryCountPre = (effectiveCountryMode === "multi" || effectiveCountryMode === "en" || effectiveCountryMode === "mix")
      ? 4
      : (effectiveCountryMode ? effectiveCountryMode.split(",").filter(Boolean).length : 1);
    const maxCountryLoops = isProbeMode ? Math.max(2, countryCountPre, probeDomCountPre) : 12;
    const shuffledEn = ["us", "gb", "ca", "au"].sort(() => Math.random() - 0.5);
    const startWithJp = Math.random() < 0.5;
    const sessionMixPool = [];
    for (let i = 0; i < shuffledEn.length; i++) {
      if (startWithJp) {
        sessionMixPool.push("jp", shuffledEn[i]);
      } else {
        sessionMixPool.push(shuffledEn[i], "jp");
      }
    }
    for (let cLoop = 1; cLoop <= maxCountryLoops; cLoop++) {
      console.log(`\n🧹 [完全クリーンアップ (試行 ${cLoop}/${maxCountryLoops})] ブラウザプロセスとプロキシソケットをリセットしています...`);
      try { execSync("pkill -9 -f camoufox || pkill -9 -f firefox || true", { stdio: "ignore" }); } catch (e) {}
      await hardKillAllBrowserAndProxy();
      // [Guard] Xvfb & openbox 生存保証
      ensureXvfbDisplay99WithResolution();

      // [Guard] ループ先頭で未返却メールを保護（未送信中断時は同一メールアドレスを再利用してドメイン消費を防止）
      returnCurrentMailIfUnused(false);
      activeSession.emailConsumedOnX = false;
      if (activeSession.pendingReuseMail) {
        activeSession.mailAccount = activeSession.pendingReuseMail;
        activeSession.pendingReuseMail = null;
        console.log(`♻️ [ドメイン節約] 前回未送信だった ${activeSession.mailAccount.email} を新しいクリーンIPで再利用します`);
      } else {
        if (cLoop > 1) {
          profile = generateRandomAccountProfile();
          finalUser = profile.username;
          tempName = profile.displayName;
          password = profile.password;
        }
        activeSession.mailAccount = await tryAcquireEmailForSignup(profile);
      }
      if (!activeSession.mailAccount) {
        console.log("\n🏁 firstmail_pool.txt の未使用メールアドレスがすべてなくなりました！連続作成を完了します。");
        return { poolExhausted: true, created: false };
      }

      const countryArgRaw = (process.argv.find(a => a.startsWith("--country=")) || "").slice(10).trim().toLowerCase();
      const envCountry = String(process.env.SETUP_TARGET_COUNTRY || "mix").trim().toLowerCase();
      const rawCountrySpec = countryArgRaw || envCountry || "mix";
      const countryPool = rawCountrySpec === "mix"
        ? sessionMixPool
        : ((rawCountrySpec === "multi" || rawCountrySpec === "en")
            ? shuffledEn
            : rawCountrySpec.split(",").map(s => s.trim()).filter(Boolean));
      const targetCountry = countryPool[(cLoop - 1) % countryPool.length] || "jp";

      const syncedProxy = await acquireGeoSyncedCleanProxy(`camoufox_${targetCountry}_${Date.now()}`, targetCountry);
      activeSession.forwarder = await startLoggingProxyForwarder(syncedProxy);
      const recent = getRecentSubnets();
      const lockedIp = recent.find(s => /^\d+\.\d+\.\d+\.\d+$/.test(s)) || true;

      const engineArg = (process.argv.find(a => a.startsWith("--engine=")) || "").slice(9).trim().toLowerCase();
      const envEngine = String(process.env.SETUP_ENGINE || "camoufox").trim().toLowerCase();
      const engine = (engineArg === "patchright" || engineArg === "chrome" || envEngine === "patchright") ? "patchright" : "camoufox";

      const osArg = (process.argv.find(a => a.startsWith("--os=")) || "").slice(5).trim().toLowerCase();
      const envOs = String(process.env.SETUP_TARGET_OS || (engine === "patchright" ? "windows" : "macos")).trim().toLowerCase();
      const rawOsMode = osArg || envOs || (engine === "patchright" ? "windows" : "macos");
      const targetOs = (rawOsMode === "mix" || rawOsMode === "random")
        ? (Math.random() < 0.5 ? "windows" : "macos")
        : (rawOsMode === "linux" ? "linux" : (rawOsMode === "win" || rawOsMode === "windows" ? "windows" : "macos"));

      const langArgRaw = (process.argv.find(a => a.startsWith("--lang=")) || "").slice(7).trim();
      const countryToLocaleMap = {
        jp: "ja-JP",
        us: "en-US",
        gb: "en-GB",
        uk: "en-GB",
        ca: "en-CA",
        au: "en-AU",
        sg: "en-SG"
      };
      const targetLocale = langArgRaw
        ? (langArgRaw.toLowerCase() === "en" ? (countryToLocaleMap[targetCountry] && countryToLocaleMap[targetCountry].startsWith("en") ? countryToLocaleMap[targetCountry] : "en-US") : langArgRaw)
        : (countryToLocaleMap[targetCountry] || (targetCountry === "jp" ? "ja-JP" : "en-US"));

      const engineName = engine === "patchright" ? "Patchright Chrome" : "Camoufox C++";
      console.log(`\n🚀 [Step 1: ${engineName} アンチディテクト起動 (試行 ${cLoop}/${maxCountryLoops})] OS: ${targetOs.toUpperCase()} | Country: ${targetCountry.toUpperCase()} (${targetLocale}) | メール: ${activeSession.mailAccount.email} | ProxyIP: ${lockedIp}`);

      const res = await runCamoufoxAttempt({
        engine,
        localProxyPort: activeSession.forwarder.port,
        proxyIp: lockedIp,
        targetOs,
        targetLocale,
        targetCountry,
        email: activeSession.mailAccount.email,
        emailPassword: activeSession.mailAccount.password || "",
        profile,
        shotsDir: SHOTS_DIR,
        rootDir: ROOT_DIR
      });

      const st = activeSession.forwarder.getStats();
      console.log(`  📊 [試行 ${cLoop} 通信量] ${st.proxyKb} KB`);
      recordExtraProxyKb(st.proxyKb, 'setup_worker');

      if (res && res.reason === "probe_success") {
        console.log("\n🎯 [結論] この独自ドメインはXのフィルタを完全突破し、6桁コード画面へ直行しました！");
        return { poolExhausted: true, created: false };
      }
      if (res && res.reason === "already_registered") {
        console.log(`  ⚠️ このメールアドレス (${activeSession.mailAccount.email}) は既に登録済みのため除外して次へ進みます...`);
        markEmailPermanentlyUsed(activeSession.mailAccount.email);
        activeSession.mailAccount = null;
        continue;
      }

      if (res && res.ok && res.authToken) {
        activeSession.accountSaved = true;
        activeSession.emailConsumedOnX = true;
        reportDomainOutcome(activeSession.mailAccount.email, "success");
        markEmailPermanentlyUsed(activeSession.mailAccount.email);
        if (res.finalUser) finalUser = res.finalUser;
        if (res.finalName) tempName = res.finalName;
        if (res.geminiPersona) geminiPersona = res.geminiPersona;

        const finalAuthToken = res.authToken;
        const rawCookies = Array.isArray(res.cookies) ? res.cookies : [];
        const finalCookies = rawCookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || ".x.com",
          path: c.path || "/",
          secure: !!c.secure,
          httpOnly: !!c.httpOnly
        }));
        const ct0 = finalCookies.find(c => c.name === "ct0")?.value || null;
        const originTypeVal = targetCountry === "jp" ? "pure_jp" : "pure_en";
        const tokenDevProf = getDeviceProfile(finalAuthToken, res.userAgent || res.ua || '', {
          targetOs,
          signupCountry: targetCountry,
          signupLocale: targetLocale,
          originType: originTypeVal
        });
        const finalUA = tokenDevProf.userAgent || devProf.userAgent;
        const targetProfDir = getPersistentProfileDir(finalAuthToken);
        const personaNameForInit = (geminiPersona && geminiPersona.name) ? geminiPersona.name : tempName;
        try {
          fs.mkdirSync(targetProfDir, { recursive: true });
          fs.writeFileSync(path.join(targetProfDir, "meta.json"), JSON.stringify({
            userId: finalUser,
            authToken: finalAuthToken,
            ct0,
            email: activeSession.mailAccount ? activeSession.mailAccount.email : "",
            proxy: syncedProxy,
            userAgent: finalUA,
            deviceProfile: tokenDevProf,
            originType: originTypeVal,
            signupCountry: targetCountry,
            signupLocale: targetLocale,
            cookies: finalCookies,
            createdAt: new Date().toISOString()
          }, null, 2), "utf8");
        } catch (e) {}

        await saveAccount({
          accountId: finalAuthToken,
          userId: finalUser,
          username: finalUser,
          name: personaNameForInit,
          signupDisplayName: tempName,
          ...(geminiPersona ? { persona: geminiPersona } : {}),
          ...(geminiPersona && geminiPersona.bio ? { bio: geminiPersona.bio } : {}),
          ...(geminiPersona && geminiPersona.location ? { location: geminiPersona.location } : {}),
          ...(geminiPersona && geminiPersona.attributes ? { attributes: geminiPersona.attributes } : {}),
          ...(geminiPersona && geminiPersona.attributes && geminiPersona.attributes.personaId
            ? { personaId: geminiPersona.attributes.personaId }
            : {}),
          password: profile.password || password,
          birthDate: `${profile.birthYear}-${profile.birthMonth}-${profile.birthDay}`,
          age: profile.age,
          phone: "",
          email: activeSession.mailAccount ? activeSession.mailAccount.email : "",
          emailStatus: "verified_firstmail",
          emailPassword: activeSession.mailAccount ? activeSession.mailAccount.password : "",
          twoFactorKey: "",
          backupCode: "",
          authToken: finalAuthToken,
          status: "standby",
          source: "setup_worker",
          proxy: syncedProxy,
          userAgent: finalUA,
          deviceProfile: tokenDevProf,
          profileDir: targetProfDir,
          ...(ct0 ? { ct0 } : {}),
          savedCookies: finalCookies,
          isNewborn: true,
          originType: originTypeVal,
          signupCountry: targetCountry,
          signupLocale: targetLocale,
          country: targetCountry,
          language: targetLocale.split("-")[0],
          farmingStage: 1,
          farmingCycles: 0,
          initReadyAt: new Date(Date.now() + (15 + Math.floor(Math.random() * 8)) * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date()
        });

        console.log("\n============================================================");
        console.log(`🎉 【第 ${sessionNumber} アカウント目 作成 ＆ Firestore自動登録 完全成功！】`);
        console.log(`🌍 作成区分   : ${originTypeVal === "pure_jp" ? "🇯🇵 日本純正 (pure_jp)" : `🌐 多国籍EN純正 (pure_en / ${targetCountry.toUpperCase()} / ${targetLocale})`}`);
        console.log(`👤 ユーザーID : @${finalUser}`);
        console.log(`🔑 パスワード : ${password}`);
        console.log(`📧 メール     : ${activeSession.mailAccount.email}`);
        console.log(`🎂 生年月日   : ${profile.birthYear}-${profile.birthMonth}-${profile.birthDay} (${profile.age}歳)`);
        console.log(`🎫 AuthToken  : ${finalAuthToken}`);
        console.log(`📁 端末引継   : ${targetProfDir}`);
        console.log(`📦 残りメール : ${getRemainingPoolCount()} 件`);
        console.log("============================================================\n");
        return { poolExhausted: false, created: true };
      }

      const failReason = (res && res.reason) ? res.reason : "unknown";
      const isNotSubmitted = !res || ["page_not_ready", "closed", "spawn_error"].includes(failReason);
      if (res && res.emailConsumed) {
        activeSession.emailConsumedOnX = true;
        reportDomainOutcome(activeSession.mailAccount ? activeSession.mailAccount.email : "", "code_reached");
        markEmailPermanentlyUsed(activeSession.mailAccount.email);
      } else if (isNotSubmitted) {
        if (activeSession.mailAccount && activeSession.mailAccount.email) {
          reportDomainOutcome(activeSession.mailAccount.email, "not_submitted");
          console.log(`  ♻️ [ドメイン枠返却] 未送信終了 (${failReason}) のため ${activeSession.mailAccount.email} の1時間枠を返却しました`);
        }
        returnCurrentMailIfUnused(true);
      } else {
        if (failReason === "face_liveness_screen") {
          reportDomainOutcome(activeSession.mailAccount ? activeSession.mailAccount.email : "", "face_liveness");
        } else if (failReason === "landing_signup_modal" || failReason === "other") {
          reportDomainOutcome(activeSession.mailAccount ? activeSession.mailAccount.email : "", "begin_login_rejected");
          if (cLoop % 3 === 0) {
            console.log("  🛡️ [連続拒絶クールダウン] 3試行連続で拒絶されたため、ドメイン保護のため 180 秒間小休止します...");
            await new Promise(r => setTimeout(r, 180000));
          }
        }
        returnCurrentMailIfUnused(false);
      }
      if (isProbeMode && cLoop >= maxCountryLoops) {
        console.log(`\n🛑 [プローブ診断完了] 異なるクリーンIPで ${maxCountryLoops} 回試行しましたが両方とも拒絶されました。ドメイン保護のためこれ以上の連続試行を停止します。`);
        return { poolExhausted: true, created: false };
      }
      const retryJitterMs = isNotSubmitted ? (3500 + Math.floor(Math.random() * 2500)) : (10000 + Math.floor(Math.random() * 8000));
      console.log(`  ⏳ [リズム分散待機] 次の試行まで ${(retryJitterMs / 1000).toFixed(1)} 秒間待機します...`);
      await new Promise(r => setTimeout(r, retryJitterMs));
    }
    return { poolExhausted: false, created: false };
  } catch (err) {
    console.error("❌ セッションエラー:", err.message);
    return { poolExhausted: false, created: false };
  } finally {
    returnCurrentMailIfUnused();
    await hardKillAllBrowserAndProxy();
  }
}

async function runContinuousFactory() {
  startWindowManager();
  const isOnce = process.argv.includes('--once');
  let sessionCount = 0;
  let successCount = 0;

  while (true) {
    if (getRemainingPoolCount() === 0) {
      console.log('\n🏁 firstmail_pool.txt の全メールアドレスの自動作成が完了しました！ (累計成功: ' + successCount + '件)');
      break;
    }

    sessionCount++;
    const res = await runSingleAccountSession(sessionCount);
    if (res.created) successCount++;
    console.log(`📈 [連続稼働ステータス] 試行セッション: ${sessionCount}回 | 作成成功: ${successCount}アカウント | 残りメールプール: ${getRemainingPoolCount()}件`);

    if (res.poolExhausted || isOnce) {
      break;
    }

    let cooldownSec;
    if (res.created) {
      if (successCount > 0 && successCount % 5 === 0) {
        // 5アカウント作成成功ごとに 150〜240秒（2.5〜4分）の中休憩を挟み、日産100件ペースと非周期性を両立
        cooldownSec = 150 + Math.floor(Math.random() * 90);
        console.log(`☕ [5件達成・中休憩モード] リズム分散のため ${cooldownSec} 秒間（約${Math.round(cooldownSec / 60)}分）休止します...`);
      } else {
        const pacing = getDynamicPacingConfig ? getDynamicPacingConfig(true) : { activeDomCount: 8, maxHourlyTries: 16, cooldownSec: 65 };
        cooldownSec = pacing.cooldownSec;
        console.log(`⚡ [可変スケーリング] 稼働ドメイン:${pacing.activeDomCount}個 (上限:${pacing.maxHourlyTries}枠/h) -> 最適クールダウン:${cooldownSec}秒`);
      }
    } else {
      const pacing = getDynamicPacingConfig ? getDynamicPacingConfig(false) : { cooldownSec: 22 };
      cooldownSec = pacing.cooldownSec;
    }
    const jstHour = (new Date().getUTCHours() + 9) % 24;
    if (jstHour >= 2 && jstHour <= 5) {
      cooldownSec = Math.round(cooldownSec * 1.45);
    }
    console.log(`⏳ 次のアカウント作成開始まで ${cooldownSec} 秒間クールダウンします... (停止する場合は Ctrl+C)`);
    await new Promise(r => setTimeout(r, cooldownSec * 1000));
  }

  rl.close();
  process.exit(0);
}

if (require.main === module) {
  runContinuousFactory();
}
module.exports = { runContinuousFactory, runSingleAccountSession };
