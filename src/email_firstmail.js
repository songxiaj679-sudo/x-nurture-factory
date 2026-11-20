const { ensureCloudflareDnsForDomain, syncAllDomainsZoneStatus } = require('./cloudflare_dns');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OTP_HISTORY_FILE = path.join(__dirname, '..', '.used_otp_codes.json');
const FIRSTMAIL_POOL_PATH = path.join(__dirname, '..', 'firstmail_pool.txt');
const DOMAIN_HEALTH_PATH = path.join(__dirname, '..', '.domain_health.json');

function getUsedOtpCodesForEmail(email) {
  const key = String((email && typeof email === 'object') ? (email.email || '') : (email || '')).trim().toLowerCase();
  if (!key) return new Set();
  try {
    if (fs.existsSync(OTP_HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(OTP_HISTORY_FILE, 'utf8'));
      return new Set(Array.isArray(data[key]) ? data[key].map(String) : []);
    }
  } catch (e) {}
  return new Set();
}

function recordUsedOtpCodeForEmail(email, code) {
  const key = String((email && typeof email === 'object') ? (email.email || '') : (email || '')).trim().toLowerCase();
  const cleanCode = String(code || '').trim();
  if (!key || !/^\d{6}$/.test(cleanCode)) return;
  try {
    let data = {};
    if (fs.existsSync(OTP_HISTORY_FILE)) {
      try { data = JSON.parse(fs.readFileSync(OTP_HISTORY_FILE, 'utf8')) || {}; } catch (e) { data = {}; }
    }
    const list = Array.isArray(data[key]) ? data[key] : [];
    if (!list.includes(cleanCode)) list.push(cleanCode);
    data[key] = list.slice(-15);
    fs.writeFileSync(OTP_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

function loadDomainHealth() {
  try {
    if (fs.existsSync(DOMAIN_HEALTH_PATH)) {
      return JSON.parse(fs.readFileSync(DOMAIN_HEALTH_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveDomainHealth(healthObj) {
  try {
    fs.writeFileSync(DOMAIN_HEALTH_PATH, JSON.stringify(healthObj, null, 2), 'utf8');
  } catch (e) {}
}

function buildCustomDomainAddress(domain, profile = null) {
  if (profile && profile.displayName && Math.random() < 0.75) {
    const parts = String(profile.displayName).toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
    if (parts.length >= 2) {
      const pFn = parts[0];
      const pLn = parts[1];
      const by2 = profile.birthYear ? String(profile.birthYear).slice(-2) : String(78 + Math.floor(Math.random() * 22));
      const bm = String(profile.birthMonth || (1 + Math.floor(Math.random() * 12))).padStart(2, '0');
      const bd = String(profile.birthDay || (1 + Math.floor(Math.random() * 28))).padStart(2, '0');
      const r2 = String(10 + Math.floor(Math.random() * 89));
      const syncedPatterns = [
        `${pFn}.${pLn}${by2}`,
        `${pFn}_${pLn}${bm}${bd}`,
        `${pFn[0]}.${pLn}${bm}${bd}`,
        `${pLn}.${pFn}${r2}`,
        `${pFn}_${pLn}_${by2}`
      ];
      return syncedPatterns[Math.floor(Math.random() * syncedPatterns.length)] + '@' + domain;
    }
  }

  const firstNames = [
    'kenta', 'haruki', 'takumi', 'sota', 'ren', 'yuto', 'daiki', 'kaito', 'asahi', 'hinata',
    'riku', 'haruto', 'yuki', 'sho', 'kazuki', 'taiga', 'yamato', 'sosuke', 'minato', 'itsuki',
    'naoto', 'ryota', 'tatsuya', 'kohei', 'shota', 'keita', 'yuma', 'hayato', 'tomoya', 'ryo'
  ];
  const lastNames = [
    'sato', 'suzuki', 'takahashi', 'tanaka', 'watanabe', 'ito', 'yamamoto', 'nakamura', 'kobayashi', 'kato',
    'yoshida', 'yamada', 'sasaki', 'yamaguchi', 'matsumoto', 'inoue', 'kimura', 'hayashi', 'saito', 'ogawa',
    'shimizu', 'yamazaki', 'mori', 'abe', 'ikeda', 'hashimoto', 'ishikawa', 'nakajima', 'maeda', 'fujita'
  ];

  const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
  const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
  const birthYear2 = String(78 + Math.floor(Math.random() * 23));
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const num2 = String(10 + Math.floor(Math.random() * 89));
  const num3 = String(100 + Math.floor(Math.random() * 899));

  const patterns = [
    `${fn}.${ln}${birthYear2}`,
    `${fn}_${ln}${month}${day}`,
    `${fn[0]}.${ln}${month}${day}`,
    `${ln}.${fn}${num3}`,
    `${fn}.${ln}.${num2}`,
    `${fn}_${ln}_${birthYear2}`
  ];
  return patterns[Math.floor(Math.random() * patterns.length)] + '@' + domain;
}

async function acquireFirstmailAccount(profile = null) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
  const customDomains = (process.env.CUSTOM_EMAIL_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (customDomains.length > 0 && process.env.CATCHALL_IMAP_USER && process.env.CATCHALL_IMAP_PASS) {
    const health = loadDomainHealth();
    const now = Date.now();
    const oneHourAgo = now - 3600 * 1000;
    const minSameDomainGapMs = 90 * 1000;
    const maxHourlyAttemptsPerDomain = 6;

    const candidates = customDomains.map((dom) => {
      const st = health[dom] || { lastUsedAt: 0, cooldownUntil: 0, failStreak: 0, successCount: 0, recentStamps: [] };
      const recentStamps = Array.isArray(st.recentStamps) ? st.recentStamps.filter(ts => ts > oneHourAgo) : [];
      st.recentStamps = recentStamps;

      let readyAt = Math.max((st.lastUsedAt || 0) + minSameDomainGapMs, st.cooldownUntil || 0);
      if (recentStamps.length >= maxHourlyAttemptsPerDomain) {
        const oldestInWindow = recentStamps[0];
        readyAt = Math.max(readyAt, oldestInWindow + 3600 * 1000);
      }
      return { dom, st, readyAt, hourlyUsed: recentStamps.length };
    });

    candidates.sort((a, b) => {
      if (a.readyAt !== b.readyAt) return a.readyAt - b.readyAt;
      if (a.hourlyUsed !== b.hourlyUsed) return a.hourlyUsed - b.hourlyUsed;
      return (a.st.lastUsedAt || 0) - (b.st.lastUsedAt || 0);
    });

    const picked = candidates[0];
    const waitMs = picked.readyAt - now;
    if (waitMs > 1000) {
      const cappedWaitMs = Math.min(waitMs, 180000);
      const waitSec = Math.ceil(cappedWaitMs / 1000);
      console.log(`  🛡️ [ドメインVelocity保護] ${picked.dom} (直近1h:${picked.hourlyUsed}回) の冷却のため ${waitSec} 秒待機します...`);
      await new Promise(r => setTimeout(r, cappedWaitMs));
    }

    const pickedDom = picked.dom;
    const finalNow = Date.now();
    const updatedStamps = (picked.st.recentStamps || []).filter(ts => ts > finalNow - 3600 * 1000);
    updatedStamps.push(finalNow);

    health[pickedDom] = {
      ...picked.st,
      lastUsedAt: finalNow,
      recentStamps: updatedStamps
    };
    saveDomainHealth(health);

    const signupEmail = buildCustomDomainAddress(pickedDom, profile);
    const imapUser = process.env.CATCHALL_IMAP_USER.trim();
    const imapPass = process.env.CATCHALL_IMAP_PASS.trim();
    const domIdx = customDomains.indexOf(pickedDom) + 1;
    console.log(`📧 [スマートドメイン選択] X入力用: ${signupEmail} (ドメイン ${domIdx}/${customDomains.length}: ${pickedDom} | 直近1h:${updatedStamps.length}回 | 累計成功:${health[pickedDom].successCount || 0} / 連続失敗:${health[pickedDom].failStreak || 0})`);
    return { email: signupEmail, password: `${imapUser}|${imapPass}`, source: 'custom_catchall' };
  }

  if (fs.existsSync(FIRSTMAIL_POOL_PATH)) {
    const raw = fs.readFileSync(FIRSTMAIL_POOL_PATH, 'utf8');
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && /^[^\s@:]+@[^\s@:]+\.[^\s@:]+:.+$/.test(l));
    if (lines.length > 0) {
      const firstLine = lines.shift();
      fs.writeFileSync(FIRSTMAIL_POOL_PATH, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
      const idx = firstLine.indexOf(':');
      const email = firstLine.slice(0, idx).trim();
      const password = firstLine.slice(idx + 1).trim();
      return { email, password, source: 'pool_file' };
    }
  }

  throw new Error('利用可能なメールアドレス設定が見つかりません。');
}



function reportDomainOutcome(emailOrDomain, outcome) {
  if (outcome !== 'code_reached') {
    _origReportDomainOutcome(emailOrDomain, outcome);
  }
  const raw = String(emailOrDomain || '').trim().toLowerCase();
  const dom = raw.includes('@') ? raw.split('@')[1] : raw;
  if (!dom) return;
  try {
    const data = fs.existsSync(DOMAIN_HEALTH_PATH)
      ? JSON.parse(fs.readFileSync(DOMAIN_HEALTH_PATH, 'utf8'))
      : {};
    const st = data[dom] || { successCount: 0, failStreak: 0, rejectedStreak: 0, cooldownUntil: 0, recentTimestamps: [] };
    if (outcome === 'success' || outcome === 'code_reached') {
      st.rejectedStreak = 0;
      if (outcome === 'success' || outcome === 'code_reached') st.wasLongCooled = false;
      st.failStreak = 0;
      st.cooldownUntil = 0;
    } else if (outcome === 'begin_login_rejected') {
      const maxStreak = Math.max(2, parseInt(process.env.DOMAIN_MAX_REJECT_STREAK || '3', 10));
      st.rejectedStreak = (st.rejectedStreak || 0) + 1;
      console.log(`  ⚠️ [何かがおかしいです監視] ${dom} の連続拒絶カウント: ${st.rejectedStreak}/${maxStreak}回`);
      if (st.rejectedStreak >= maxStreak) {
        const twoDaysMs = 48 * 3600 * 1000;
        st.cooldownUntil = Date.now() + twoDaysMs;
        st.wasLongCooled = true;
        st.failStreak = 0;
        if (process.env.DOMAIN_AUTO_DISABLE_ON_BURN !== '0') {
          st.disabled = true;
          st.burnedAt = new Date().toISOString();
          console.log(`  🛑 [汚染ドメイン自動隔離] ${dom} が${maxStreak}回連続で拒絶されたため、クリーンIPの巻き添え汚染を防ぐためローテーションから自動隔離(停止)しました（管理画面から手動リセット可能）`);
        } else {
          st.rejectedStreak = 0;
          const wakeDate = new Date(st.cooldownUntil + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
          console.log(`  🧊 [2日間長期冷却・自動復帰予約] ${dom} が${maxStreak}回連続で「何かがおかしいです」になったため、48時間（2日間）休止させます（自動復帰予定: ${wakeDate} JST）`);
        }
      }
    }
    data[dom] = st;
    fs.writeFileSync(DOMAIN_HEALTH_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

function _origReportDomainOutcome(email, outcome) {
  if (!email || !String(email).includes('@')) return;
  const dom = String(email).split('@')[1].trim().toLowerCase();
  if (!dom) return;

  const health = loadDomainHealth();
  const cur = health[dom] || { lastUsedAt: Date.now(), cooldownUntil: 0, failStreak: 0, successCount: 0, recentStamps: [] };
  const now = Date.now();

  if (outcome === 'success') {
    cur.failStreak = 0;
    cur.successCount = (cur.successCount || 0) + 1;
    cur.cooldownUntil = now + (135 + Math.floor(Math.random() * 65)) * 1000;
  } else if (outcome === 'face_liveness' || outcome === 'begin_login_rejected') {
    cur.failStreak = (cur.failStreak || 0) + 1;
    if (cur.failStreak >= 2) {
      const coolSec = 180 + Math.floor(Math.random() * 120);
      cur.cooldownUntil = now + coolSec * 1000;
      console.log(`  🧊 [ドメイン冷却隔離] ${dom} が連続拒絶(${cur.failStreak}回)されたため ${coolSec} 秒間休止させます`);
    } else {
      cur.cooldownUntil = now + (75 + Math.floor(Math.random() * 45)) * 1000;
    }
  }
  cur.lastUsedAt = now;
  health[dom] = cur;
  saveDomainHealth(health);
}

function decodeMimeWords(str) {
  const unfolded = String(str || '').replace(/\r?\n[ \t]+/g, '');
  return unfolded.replace(/=\?([^?]+)\?([BbQq])\?([^?]+)\?=/g, (_, _charset, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') {
        return Buffer.from(text, 'base64').toString('utf8');
      }
      const qp = text
        .replace(/_/g, ' ')
        .replace(/=([0-9A-Fa-f]{2})/g, (__, hex) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(qp, 'binary').toString('utf8');
    } catch (e) {
      return text;
    }
  });
}

function extractLatestXCodeFromFetchOutput(rawImapText, targetEmail, usedCodesSet = new Set(), isPeekOnly = false) {
  const cleanTarget = String(targetEmail || '').trim().toLowerCase();
  const blocks = String(rawImapText || '').split(/\*\s+\d+\s+FETCH\s+\(/i).slice(1);

  for (let i = blocks.length - 1; i >= 0; i--) {
    const rawBlock = blocks[i];
    const decodedBlock = decodeMimeWords(rawBlock);
    const lowerBlock = decodedBlock.toLowerCase();

    const isFromX =
      lowerBlock.includes('@x.com') ||
      lowerBlock.includes('@twitter.com') ||
      decodedBlock.includes('認証コード') ||
      lowerBlock.includes('verification code');
    if (!isFromX) continue;
    if (cleanTarget && !lowerBlock.includes(cleanTarget)) continue;

    const subjectMatch = decodedBlock.match(/Subject:\s*([^\r\n]+)/i);
    const searchArea = subjectMatch ? subjectMatch[1] : decodedBlock;
    const codeMatch =
      searchArea.match(/(?<!\d)(\d{6})(?!\d)/) ||
      decodedBlock.match(/(?:認証コードは|verification code[:\s]*|code is[:\s]*)(\d{6})/i);

    if (codeMatch) {
      const code = codeMatch[1];
      if (isPeekOnly) {
        return code;
      }
      // 受信時刻が8分以上前のメール（アカウント作成時のコード等）は使わず除外する。
      // 2FAのプロキシ待ちで届いたコードは、3分を超えてもまだ有効なことがある。
      const dateMatch = decodedBlock.match(/Date:\s*([^\r\n]+)/i);
      if (dateMatch) {
        const msgTime = Date.parse(dateMatch[1].trim());
        if (!isNaN(msgTime) && (Date.now() - msgTime) > 480 * 1000) {
          if (usedCodesSet) usedCodesSet.add(code);
          recordUsedOtpCodeForEmail(targetEmail, code);
          continue;
        }
      }
      if (usedCodesSet && usedCodesSet.has(code)) {
        continue;
      }
      return code;
    }
  }
  return null;
}

async function waitForFirstmailXCode(email, password = '', maxSec = 75, excludeCode = null, isPeekOnly = false) {
  let timeoutSec = (typeof maxSec === 'number' && maxSec > 0) ? maxSec : 75;
  const usedCodesSet = getUsedOtpCodesForEmail(email);
  if (excludeCode) {
    if (Array.isArray(excludeCode)) excludeCode.forEach(c => { if (c) usedCodesSet.add(String(c).trim()); });
    else usedCodesSet.add(String(excludeCode).trim());
  }
  const startTime = Date.now();
  const timeoutMs = timeoutSec * 1000;
  const imapHost = (process.env.CATCHALL_IMAP_HOST || 'imap.zoho.jp').trim();
  const imapPort = Number(process.env.CATCHALL_IMAP_PORT || 993);

  let imapUser = process.env.CATCHALL_IMAP_USER ? process.env.CATCHALL_IMAP_USER.trim() : email;
  let imapPass = process.env.CATCHALL_IMAP_PASS ? process.env.CATCHALL_IMAP_PASS.trim() : password;
  if (password && password.includes('|')) {
    const parts = password.split('|');
    imapUser = parts[0].trim();
    imapPass = parts[1].trim();
  }

  if (!isPeekOnly) {
    console.log(`  ⏳ Catch-All IMAP (${imapUser} @ ${imapHost}) で ${email} 宛ての6桁確認コードを待機中 (除外済: ${Array.from(usedCodesSet).join(',') || 'なし'})...`);
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      const code = await new Promise((resolve) => {
        const socket = tls.connect({ host: imapHost, port: imapPort, servername: imapHost }, () => {});
        let buffer = '';
        let step = 0;
        let finished = false;

        const safeClose = (val) => {
          if (finished) return;
          finished = true;
          try { socket.end(); } catch (e) {}
          setTimeout(() => { try { socket.destroy(); } catch (e) {} }, 300);
          resolve(val);
        };

        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');

          if (step === 0 && /\*\s+OK/i.test(buffer)) {
            step = 1;
            buffer = '';
            socket.write(`A1 LOGIN "${imapUser}" "${imapPass}"\r\n`);
          } else if (step === 1 && /A1\s+OK/i.test(buffer)) {
            step = 2;
            buffer = '';
            socket.write('A2 SELECT INBOX\r\n');
          } else if (step === 1 && /A1\s+(NO|BAD)/i.test(buffer)) {
            safeClose(null);
          } else if (step === 2 && /A2\s+OK/i.test(buffer)) {
            step = 3;
            const existsMatch = buffer.match(/\*\s+(\d+)\s+EXISTS/i);
            const existsCount = existsMatch ? parseInt(existsMatch[1], 10) : 0;
            buffer = '';
            if (existsCount <= 0) {
              socket.write('A4 LOGOUT\r\n');
              safeClose(null);
            } else {
              const startSeq = Math.max(1, existsCount - 29);
              socket.write(`A3 FETCH ${startSeq}:${existsCount} (BODY.PEEK[HEADER.FIELDS (FROM TO DELIVERED-TO SUBJECT DATE)])\r\n`);
            }
          } else if (step === 3 && /A3\s+(OK|NO|BAD)/i.test(buffer)) {
            step = 4;
            const found = extractLatestXCodeFromFetchOutput(buffer, email, usedCodesSet, isPeekOnly);
            socket.write('A4 LOGOUT\r\n');
            safeClose(found);
          }
        });

        socket.on('error', () => safeClose(null));
        setTimeout(() => safeClose(null), 11000);
      });

      if (code && /^\d{6}$/.test(code)) {
        recordUsedOtpCodeForEmail(email, code);
        if (isPeekOnly) return code;
        console.log(`  ✅ [IMAP受信成功] ${email} 宛ての最新認証コード [${code}] を取得しました！(除外済: ${Array.from(usedCodesSet).join(',') || 'なし'})`);
        return code;
      }
      if (isPeekOnly) return null;
    } catch (e) {
      if (isPeekOnly) return null;
    }

    await new Promise(r => setTimeout(r, 3500));
  }
  return null;
}

async function getVerificationCode(accountOrEmail, timeoutMs = 15000) {
  const email = typeof accountOrEmail === 'object' ? (accountOrEmail.email || '') : String(accountOrEmail || '');
  const pass = typeof accountOrEmail === 'object' ? (accountOrEmail.password || accountOrEmail.emailPassword || '') : '';
  const sec = Math.max(8, Math.ceil((timeoutMs || 15000) / 1000));
  return await waitForFirstmailXCode(email, pass, sec);
}

async function fetchLatestCodeViaImapOnce(email, password) {
  const existing = await waitForFirstmailXCode(email, password, 6, null, true);
  if (existing) {
    recordUsedOtpCodeForEmail(email, existing);
  }
  return existing;
}


const crypto = require('crypto');

// 独自ドメインの各メールアドレスに対して一意の専用メールパスワード (mpw_xxxxxxxx) を生成
function generateDedicatedMailboxPassword(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return 'mpw_velox2026';
  const hash = crypto.createHash('sha256').update('velox_mbox_salt_2026_' + clean).digest('hex').slice(0, 8);
  return 'mpw_' + hash;
}

// MIME本文から人間が読みやすいテキストを抽出するヘルパー
function cleanEmailBodyText(rawBlock) {
  let text = String(rawBlock || '');
  const bodySplit = text.split(/\r?\n\r?\n/);
  if (bodySplit.length > 1) {
    text = bodySplit.slice(1).join('\n\n');
  }
  // Quoted-Printable のソフト改行と16進コードをデコード
  text = text.replace(/=\r?\n/g, '');
  text = text.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
    try { return String.fromCharCode(parseInt(hex, 16)); } catch (e) { return ''; }
  });
  try {
    text = Buffer.from(text, 'binary').toString('utf8');
  } catch (e) {}
  // HTMLタグや不要なMIME境界線を除去してクリーンなテキストに整形
  text = text
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/--[0-9a-zA-Z_=-]+/g, '')
    .replace(/Content-[A-Za-z-]+:[^\r\n]+/gi, '')
    .replace(/\)\r?\n?$/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, 1200);
}

// 指定したメールアドレス宛ての受信BOX一覧（新しい順）をZoho Catch-All / 個別IMAPから高速取得
async function fetchInboxMessagesForEmail(targetEmail, emailPassword = '', maxResults = 30) {
  const cleanTarget = String(targetEmail || '').trim().toLowerCase();
  if (!cleanTarget || !cleanTarget.includes('@')) return [];

  const imapHost = (process.env.CATCHALL_IMAP_HOST || 'imap.zoho.jp').trim();
  const imapPort = Number(process.env.CATCHALL_IMAP_PORT || 993);
  let imapUser = process.env.CATCHALL_IMAP_USER ? process.env.CATCHALL_IMAP_USER.trim() : cleanTarget;
  let imapPass = process.env.CATCHALL_IMAP_PASS ? process.env.CATCHALL_IMAP_PASS.trim() : emailPassword;

  if (emailPassword && emailPassword.includes('|')) {
    const parts = emailPassword.split('|');
    imapUser = parts[0].trim();
    imapPass = parts[1].trim();
  }

  if (cleanTarget === imapUser.toLowerCase()) {
    return [];
  }

  return await new Promise((resolve) => {
    const socket = tls.connect({ host: imapHost, port: imapPort, servername: imapHost }, () => {});
    let buffer = '';
    let step = 0;
    let finished = false;
    const headerMap = new Map();

    const buildFinalList = () => {
      const arr = Array.from(headerMap.values());
      arr.sort((a, b) => (b.timestamp || b.seq || 0) - (a.timestamp || a.seq || 0));
      return arr.slice(0, maxResults);
    };

    const safeFinish = () => {
      if (finished) return;
      finished = true;
      try { socket.end(); } catch (e) {}
      setTimeout(() => { try { socket.destroy(); } catch (e) {} }, 250);
      resolve(buildFinalList());
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      if (step === 0 && /\*\s+OK/i.test(buffer)) {
        step = 1;
        buffer = '';
        socket.write(`A1 LOGIN "${imapUser}" "${imapPass}"\r\n`);
      } else if (step === 1 && /A1\s+OK/i.test(buffer)) {
        step = 2;
        buffer = '';
        socket.write('A2 SELECT INBOX\r\n');
      } else if (step === 1 && /A1\s+(NO|BAD)/i.test(buffer)) {
        safeFinish();
      } else if (step === 2 && /A2\s+OK/i.test(buffer)) {
        step = 3;
        const existsMatch = buffer.match(/\*\s+(\d+)\s+EXISTS/i);
        const existsCount = existsMatch ? parseInt(existsMatch[1], 10) : 0;
        buffer = '';
        if (existsCount <= 0) {
          socket.write('A4 LOGOUT\r\n');
          safeFinish();
        } else {
          // 直近250通のヘッダを高速スキャン
          const startSeq = Math.max(1, existsCount - 249);
          socket.write(`A3 FETCH ${startSeq}:${existsCount} (BODY.PEEK[HEADER.FIELDS (FROM TO DELIVERED-TO SUBJECT DATE)])\r\n`);
        }
      } else if (step === 3 && /A3\s+(OK|NO|BAD)/i.test(buffer)) {
        const blocks = String(buffer || '').split(/\*\s+(\d+)\s+FETCH\s+\(/i);
        for (let i = 1; i + 1 < blocks.length; i += 2) {
          const seqNum = parseInt(blocks[i], 10);
          const decodedHeader = decodeMimeWords(blocks[i + 1]);
          const lowerHeader = decodedHeader.toLowerCase();
          if (!lowerHeader.includes(cleanTarget)) continue;

          const subjMatch = decodedHeader.match(/Subject:\s*([^\r\n]+)/i);
          const fromMatch = decodedHeader.match(/From:\s*([^\r\n]+)/i);
          const dateMatch = decodedHeader.match(/Date:\s*([^\r\n]+)/i);

          const subject = subjMatch ? subjMatch[1].trim() : '(件名なし)';
          const from = fromMatch ? fromMatch[1].trim() : 'X (Twitter)';
          const rawDateStr = dateMatch ? dateMatch[1].trim() : '';
          let dateFormatted = rawDateStr || '日時不明';
          let timestamp = 0;
          if (rawDateStr) {
            const parsedMs = Date.parse(rawDateStr);
            if (!isNaN(parsedMs)) {
              timestamp = parsedMs;
              dateFormatted = new Date(parsedMs).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            }
          }

          const codeMatch =
            subject.match(/(?<!\d)(\d{6})(?!\d)/) ||
            decodedHeader.match(/(?:認証コードは|verification code[:\s]*|code is[:\s]*)(\d{6})/i);
          const code = codeMatch ? codeMatch[1] : null;

          const defaultBody = code
            ? `X（旧Twitter）からの本人確認メールです。\n\n【6桁認証コード】: ${code}\n宛先: ${cleanTarget}\n受信日時: ${dateFormatted}\n\n※右上の「コピー」ボタンを押してXの入力欄に貼り付けてください。`
            : `件名: ${subject}\n差出人: ${from}\n宛先: ${cleanTarget}\n受信日時: ${dateFormatted}`;

          headerMap.set(seqNum, {
            seq: seqNum,
            subject,
            from,
            date: dateFormatted,
            timestamp,
            code,
            snippet: code ? `認証コード [${code}] が届いています（クリックで詳細表示）` : subject,
            body: defaultBody
          });
        }

        if (headerMap.size === 0) {
          socket.write('A5 LOGOUT\r\n');
          safeFinish();
        } else {
          step = 4;
          const targetSeqList = Array.from(headerMap.keys()).slice(-10).join(',');
          buffer = '';
          socket.write(`A4 FETCH ${targetSeqList} (BODY.PEEK[TEXT])\r\n`);
        }
      } else if (step === 4 && /A4\s+(OK|NO|BAD)/i.test(buffer)) {
        step = 5;
        const blocks = String(buffer || '').split(/\*\s+(\d+)\s+FETCH\s+\(/i);
        for (let i = 1; i + 1 < blocks.length; i += 2) {
          const seqNum = parseInt(blocks[i], 10);
          const item = headerMap.get(seqNum);
          if (!item) continue;
          const cleaned = cleanEmailBodyText(decodeMimeWords(blocks[i + 1]));
          if (cleaned && cleaned.length >= 12) {
            if (!item.code) {
              const bodyCodeMatch = cleaned.match(/(?:認証コードは|verification code[:\s]*|code is[:\s]*|(?<!\d))(\d{6})(?!\d)/i);
              if (bodyCodeMatch) item.code = bodyCodeMatch[1];
            }
            item.body = cleaned;
            item.snippet = cleaned.replace(/\s+/g, ' ').slice(0, 95);
          }
        }
        socket.write('A5 LOGOUT\r\n');
        safeFinish();
      }
    });

    socket.on('error', () => safeFinish());
    setTimeout(() => safeFinish(), 10000);
  });
}


// 10万アカウント規模対応：Catch-All IMAP (Zoho) に溜まった24時間以上前の古い認証メールを一括削除してパンクを防止
async function purgeOldVerificationEmails(olderThanHours = 24) {
  try {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
    const host = (process.env.CATCHALL_IMAP_HOST || 'imap.zoho.jp').trim();
    const user = (process.env.CATCHALL_IMAP_USER || '').trim();
    const pass = (process.env.CATCHALL_IMAP_PASS || '').trim();
    if (!user || !pass) return { ok: false, reason: 'no_imap_credentials' };

    const { execFileSync } = require('child_process');
    const pyScript = `
import imaplib, datetime, json, sys
host, user, pw, hours = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
try:
    M = imaplib.IMAP4_SSL(host, 993)
    M.login(user, pw)
    M.select('INBOX')
    cutoff = (datetime. datetime.now() - datetime.timedelta(hours=hours)).strftime('%d-%b-%Y')
    typ, data = M.search(None, f'(BEFORE {cutoff})')
    uids = data[0].split() if (typ == 'OK' and data and data[0]) else []
    target = uids[:400]
    for u in target:
        M.store(u, '+FLAGS', chr(92) + 'Deleted')
    if target:
        M.expunge()
    M.logout()
    print(json.dumps({"ok": True, "deleted": len(target), "remainingOld": max(0, len(uids) - len(target))}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`.replace('datetime. datetime', 'datetime.datetime');

    const out = execFileSync('python3', ['-c', pyScript, host, user, pass, String(olderThanHours)], {
      encoding: 'utf8',
      timeout: 25000
    }).trim();
    return JSON.parse(out.split(/\r?\n/).pop());
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  purgeOldVerificationEmails,
  generateDedicatedMailboxPassword,
  fetchInboxMessagesForEmail,
  acquireFirstmailAccount,
  waitForFirstmailXCode,
  reportDomainOutcome,
  getVerificationCode,
  fetchLatestCodeViaImapOnce
};

// === [STRICT_DOMAIN_VELOCITY_GUARD] ===
const _fsGuard = require('fs');
const _pathGuard = require('path');

const _ROOT_DIR_G = _pathGuard.join(__dirname, '..');
const _ENV_PATH_G = _pathGuard.join(_ROOT_DIR_G, '.env');
const _HEALTH_PATH_G = _pathGuard.join(_ROOT_DIR_G, '.domain_health.json');
const _USED_MAIL_PATH_G = _pathGuard.join(_ROOT_DIR_G, 'used_firstmail.txt');

const MAX_USES_PER_HOUR = Math.max(1, parseInt(process.env.DOMAIN_MAX_USES_PER_HOUR || '1', 10));              // 1ドメインあたり1時間に最大1回(デフォルト)まで厳守
const MIN_SAME_DOMAIN_INTERVAL_MS = Math.max(10, parseInt(process.env.DOMAIN_MIN_INTERVAL_MIN || '50', 10)) * 60 * 1000; // 同一ドメインは最低50分間隔(デフォルト)を空ける
const REJECT_SHORT_COOL_MS = Math.max(15, parseInt(process.env.DOMAIN_REJECT_COOL_MIN || '65', 10)) * 60 * 1000;        // 「何かがおかしいです」発生時は65分(デフォルト)休ませる
const MAX_REJECT_STREAK = Math.max(2, parseInt(process.env.DOMAIN_MAX_REJECT_STREAK || '3', 10));              // 連続拒絶上限(デフォルト3回で自動隔離)
const AUTO_DISABLE_ON_MAX_REJECT = process.env.DOMAIN_AUTO_DISABLE_ON_BURN !== '0';                            // 汚染確定ドメインの自動隔離(デフォルトON)
const FACE_SHORT_COOL_MS = 3 * 60 * 1000;           // カメラ認証(IP要因)時は3分のみ間隔を空ける
const LONG_48H_COOL_MS = 48 * 60 * 60 * 1000;       // 長期休止時は48時間(2日間)完全休止

function _loadCustomDomainsFromEnv() {
  try {
    require('dotenv').config({ path: _ENV_PATH_G, override: true });
    if (_fsGuard.existsSync(_ENV_PATH_G)) {
      const envTxt = _fsGuard.readFileSync(_ENV_PATH_G, 'utf8');
      const m = envTxt.match(/^CUSTOM_EMAIL_DOMAINS=(.*)$/m);
      if (m) {
        return m[1].split(',').map(s => s.trim().toLowerCase()).filter(d => d && d !== 'veloxpostapp.com');
      }
    }
  } catch (e) {}
  return (process.env.CUSTOM_EMAIL_DOMAINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(d => d && d !== 'veloxpostapp.com');
}

function _loadDomainHealth() {
  try {
    if (_fsGuard.existsSync(_HEALTH_PATH_G)) {
      return JSON.parse(_fsGuard.readFileSync(_HEALTH_PATH_G, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function _saveDomainHealth(hMap) {
  try {
    _fsGuard.writeFileSync(_HEALTH_PATH_G, JSON.stringify(hMap, null, 2), 'utf8');
  } catch (e) {}
}

function _generateNaturalLocalPart() {
  const firstNames = [
    'kenta', 'haruki', 'takumi', 'sota', 'ren', 'yuto', 'daiki', 'kaito', 'asahi', 'hinata',
    'riku', 'haruto', 'yuki', 'sho', 'kazuki', 'naoto', 'ryota', 'kohei', 'shota', 'keita',
    'hayato', 'tomoya', 'ryo', 'issei', 'taiga', 'kosuke', 'yuma', 'tsubasa', 'makoto', 'jun',
    'misaki', 'aoi', 'mei', 'yui', 'hina', 'sakura', 'rin', 'mio', 'nanami', 'ayaka',
    'koharu', 'akari', 'kaede', 'honoka', 'anna', 'riko', 'noa', 'kokona', 'saki', 'kanon'
  ];
  const lastNames = [
    'sato', 'suzuki', 'takahashi', 'tanaka', 'watanabe', 'ito', 'yamamoto', 'nakamura', 'kobayashi', 'kato',
    'yoshida', 'yamada', 'sasaki', 'yamaguchi', 'matsumoto', 'inoue', 'kimura', 'hayashi', 'saito', 'shimizu',
    'mori', 'ikeda', 'hashimoto', 'yamazaki', 'ishikawa', 'nakajima', 'maeda', 'fujita', 'ogawa', 'goto',
    'okada', 'hasegawa', 'murakami', 'kondo', 'ishii', 'sakamoto', 'endo', 'aoki', 'fujii', 'nishimura',
    'fukuda', 'ota', 'miura', 'fujiwara', 'okamoto', 'matsuda', 'nakagawa', 'nakano', 'harada', 'ono'
  ];
  const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
  const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
  const num2 = String(11 + Math.floor(Math.random() * 88));
  const num3 = String(100 + Math.floor(Math.random() * 899));
  const num4 = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0') + String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const alpha1 = 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)];

  // 毎回必ず完全ランダムな別名＋乱数になり、二度と@の前が被らない8パターン
  const patterns = [
    `${fn}.${ln}${num2}`,
    `${ln}.${fn}${num2}`,
    `${fn}_${ln}_${num2}`,
    `${fn}.${ln}.${num2}`,
    `${fn}.${ln}${num2}${alpha1}`,
    `${ln}.${fn}${num2}${alpha1}`,
    `${fn}_${ln}${num2}`,
    `${fn[0]}.${ln}${num4}`
  ];
  return patterns[Math.floor(Math.random() * patterns.length)];
}

async function strictAcquireFirstmailAccount(profile = null) {
  const usedSet = new Set(
    _fsGuard.existsSync(_USED_MAIL_PATH_G)
      ? _fsGuard.readFileSync(_USED_MAIL_PATH_G, 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean)
      : []
  );

  while (true) {
    const domains = _loadCustomDomainsFromEnv();
    if (domains.length === 0) {
      if (_fsGuard.existsSync(FIRSTMAIL_POOL_PATH)) {
        const raw = _fsGuard.readFileSync(FIRSTMAIL_POOL_PATH, 'utf8');
        const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && /^[^\s@:]+@[^\s@:]+\.[^\s@:]+:.+$/.test(l));
        if (lines.length > 0) {
          const firstLine = lines.shift();
          _fsGuard.writeFileSync(FIRSTMAIL_POOL_PATH, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
          const idx = firstLine.indexOf(':');
          return {
            email: firstLine.slice(0, idx).trim(),
            password: firstLine.slice(idx + 1).trim(),
            source: 'pool_file'
          };
        }
      }
      return null;
    }

    let health = _loadDomainHealth();
    let now = Date.now();
    const needsNsRecheck = domains.some(d => {
      const st = health[d];
      if (!st || (!st.pendingNsActivation && st.zoneStatus !== 'pending')) return false;
      const lastChk = st.lastCheckedAt ? Date.parse(st.lastCheckedAt) : 0;
      return !lastChk || (now - lastChk > 5 * 60 * 1000);
    });
    if (needsNsRecheck && typeof syncAllDomainsZoneStatus === 'function') {
      await syncAllDomainsZoneStatus().catch(() => {});
      health = _loadDomainHealth();
      now = Date.now();
    }
    const oneHourAgo = now - 60 * 60 * 1000;
    let stateChanged = false;

    // 稼働可能なドメイン数を算出し、10ドメイン以上ある場合は同一ドメインの再使用間隔を自動で最大180分(3時間)まで広げて汚染を予防する
    const activeDomPoolCount = domains.filter(d => {
      const s = health[d];
      return !s || (!s.disabled && !s.pendingNsActivation && s.zoneStatus !== 'pending');
    }).length;
    const effectiveMinIntervalMs = (!process.env.DOMAIN_MIN_INTERVAL_MIN && activeDomPoolCount >= 10)
      ? Math.max(MIN_SAME_DOMAIN_INTERVAL_MS, Math.min(180, activeDomPoolCount * 9) * 60 * 1000)
      : MIN_SAME_DOMAIN_INTERVAL_MS;

    const readyCandidates = [];
    let earliestAvailableMs = Infinity;
    let earliestDomainName = '';

    domains.forEach((dom, idx) => {
      if (!health[dom]) {
        health[dom] = { successCount: 0, failStreak: 0, rejectedStreak: 0, cooldownUntil: 0, disabled: false, recentTimestamps: [] };
        stateChanged = true;
      }
      const st = health[dom];
      if (st.disabled) return;

      // ネームサーバー浸透待ち (Cloudflare Zone status が pending) のドメインは開通するまで選出しない
      if (st.pendingNsActivation || st.zoneStatus === 'pending') {
        const nextNsCheckAt = now + 5 * 60 * 1000;
        if (nextNsCheckAt < earliestAvailableMs) {
          earliestAvailableMs = nextNsCheckAt;
          earliestDomainName = `${dom} (NS浸透待ち)`;
        }
        return;
      }

      // 48時間冷却や短期冷却が既に明けていた場合は自動復帰リセット
      if (st.cooldownUntil && st.cooldownUntil <= now) {
        if (st.rejectedStreak >= MAX_REJECT_STREAK) {
          console.log(`  🌱 [長期冷却明け・自動復帰] ${dom} の冷却が完了したため、失敗カウントを 0 にリセットして復帰させます！`);
          st.rejectedStreak = 0;
          st.wasLongCooled = true;
          st.failStreak = 0;
        }
        st.cooldownUntil = 0;
        stateChanged = true;
      }

      // 直近(最大3時間または60分)のタイムスタンプを保持
      const historyWindowAgo = now - Math.max(60 * 60 * 1000, effectiveMinIntervalMs);
      const rawTs = Array.isArray(st.recentTimestamps) ? st.recentTimestamps : [];
      const keptTs = rawTs.filter(t => typeof t === 'number' && t > historyWindowAgo).sort((a, b) => a - b);
      if (keptTs.length !== rawTs.length) {
        st.recentTimestamps = keptTs;
        stateChanged = true;
      }
      const validTs = keptTs.filter(t => t > oneHourAgo);

      // 1) 長期冷却中 (残り1時間以上 = 48h冷却中) は完全にスキップ（無理に引きずり出さない）
      if (st.cooldownUntil && st.cooldownUntil > now) {
        if (st.cooldownUntil - now < 12 * 3600 * 1000) {
          if (st.cooldownUntil < earliestAvailableMs) {
            earliestAvailableMs = st.cooldownUntil;
            earliestDomainName = dom;
          }
        }
        return;
      }

      const recent1h = validTs.length;
      const lastUsedAt = keptTs.length > 0 ? keptTs[keptTs.length - 1] : 0;
      const nextIntervalReadyAt = lastUsedAt ? (lastUsedAt + effectiveMinIntervalMs) : 0;

      // 2) 直近1時間の使用回数が MAX_USES_PER_HOUR (2回) に達している場合は絶対に選出しない
      if (recent1h >= MAX_USES_PER_HOUR) {
        const slotFreeAt = validTs[0] + 60 * 60 * 1000 + 5000;
        const effectiveReadyAt = Math.max(slotFreeAt, nextIntervalReadyAt);
        if (effectiveReadyAt < earliestAvailableMs) {
          earliestAvailableMs = effectiveReadyAt;
          earliestDomainName = dom;
        }
        return;
      }

      // 3) 同一ドメインの最低12分インターバル中も待機候補に回す
      if (nextIntervalReadyAt > now) {
        if (nextIntervalReadyAt < earliestAvailableMs) {
          earliestAvailableMs = nextIntervalReadyAt;
          earliestDomainName = dom;
        }
        return;
      }

      readyCandidates.push({
        domain: dom,
        index: idx + 1,
        totalDomains: domains.length,
        recent1h,
        lastUsedAt,
        rejectedStreak: st.rejectedStreak || 0,
        failStreak: st.failStreak || 0,
        successCount: st.successCount || 0
      });
    });

    if (stateChanged) {
      _saveDomainHealth(health);
    }

    if (readyCandidates.length > 0) {
      // 優先順位: ①直近1hの使用回数が少ない順(0回優先) -> ②連続拒絶が少ない順 -> ③最後に使ってから最も時間が経っている順
      // 同条件(特に新規追加で recent1h=0, lastUsedAt=0 が並んだ時)に順番をランダムシャッフルして再整列する
      for (let i = readyCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = readyCandidates[i];
        readyCandidates[i] = readyCandidates[j];
        readyCandidates[j] = tmp;
      }
      readyCandidates.sort((a, b) => {
        if (a.recent1h !== b.recent1h) return a.recent1h - b.recent1h;
        if (a.rejectedStreak !== b.rejectedStreak) return a.rejectedStreak - b.rejectedStreak;
        // 最終使用時刻の差が2分以内ならランダム順を維持して特定順序の固定化を防ぐ
        if (Math.abs(a.lastUsedAt - b.lastUsedAt) < 120000) return 0;
        return a.lastUsedAt - b.lastUsedAt;
      });

      const chosen = readyCandidates[0];
      const st = health[chosen.domain];
      st.recentTimestamps = Array.isArray(st.recentTimestamps) ? st.recentTimestamps : [];
      st.recentTimestamps.push(now);
      _saveDomainHealth(health);

      let finalEmail = '';
      for (let retry = 0; retry < 50; retry++) {
        const candidateEmail = `${_generateNaturalLocalPart(retry === 0 ? profile : null)}@${chosen.domain}`.toLowerCase();
        if (!usedSet.has(candidateEmail)) {
          finalEmail = candidateEmail;
          break;
        }
      }
      if (!finalEmail) {
        finalEmail = `user_${Date.now().toString(36)}@${chosen.domain}`;
      }

      const imapUser = (process.env.CATCHALL_IMAP_USER || '').trim();
      const imapPass = (process.env.CATCHALL_IMAP_PASS || '').trim();
      const formattedPass = (imapUser && imapPass) ? `${imapUser}|${imapPass}` : imapPass;

      console.log(`📧 [スマートドメイン選択] X入力用: ${finalEmail} (ドメイン ${chosen.index}/${chosen.totalDomains}: ${chosen.domain} | 直近1h:${chosen.recent1h + 1}/${MAX_USES_PER_HOUR}回・最小間隔:${Math.round(effectiveMinIntervalMs / 60000)}分 | 累計成功:${chosen.successCount} / 拒絶カウント:${chosen.rejectedStreak}/${MAX_REJECT_STREAK})`);
      return {
        email: finalEmail,
        password: formattedPass,
        source: 'custom_catchall'
      };
    }

    // 使えるドメインが1つもない場合：強制使用せず、最も早く枠が空くまで安全に自動待機する
    const waitMs = (earliestAvailableMs < Infinity)
      ? Math.max(30000, Math.min(earliestAvailableMs - now, 180000))
      : 180000;
    const remainTotalMin = (earliestAvailableMs < Infinity)
      ? Math.max(1, Math.ceil((earliestAvailableMs - now) / 60000))
      : 15;

    console.log(`  🛡️ [ドメイン過負荷保護・共倒れ防止] 現在すべての稼働ドメインが1時間上限(${MAX_USES_PER_HOUR}回/h)またはインターバル中です（最短復帰: ${earliestDomainName || '待機中'} / 約${remainTotalMin}分後）。${Math.round(waitMs / 1000)}秒間スリープして再確認します...`);
    await new Promise(r => setTimeout(r, waitMs));
  }
}

function strictReportDomainOutcome(emailOrDomain, outcome) {
  try {
    const raw = String(emailOrDomain || '').trim().toLowerCase();
    const dom = raw.includes('@') ? raw.split('@')[1] : raw;
    if (!dom) return;

    const health = _loadDomainHealth();
    const now = Date.now();
    const st = health[dom] || { successCount: 0, failStreak: 0, rejectedStreak: 0, cooldownUntil: 0, disabled: false, recentTimestamps: [] };

    if (outcome === 'not_submitted') {
      // ページ描画タイムアウト等でXにメールを送信していない場合は、消費した1時間枠を返却する
      if (Array.isArray(st.recentTimestamps) && st.recentTimestamps.length > 0) {
        st.recentTimestamps.pop();
      }
    } else if (outcome === 'success') {
      st.successCount = (st.successCount || 0) + 1;
      st.failStreak = 0;
      st.rejectedStreak = 0;
      if (outcome === 'success' || outcome === 'code_reached') st.wasLongCooled = false;
      st.cooldownUntil = 0;
    } else if (outcome === 'code_reached') {
      st.failStreak = 0;
      st.rejectedStreak = 0;
      if (outcome === 'success' || outcome === 'code_reached') st.wasLongCooled = false;
      st.cooldownUntil = 0;
    } else if (outcome === 'face_liveness') {
      // IP要因のカメラ画面ではXから確認メールは発行されていないため、1時間枠を半分返却し3分だけ間隔を空ける
      if (Array.isArray(st.recentTimestamps) && st.recentTimestamps.length > 1) {
        st.recentTimestamps.pop();
      }
      st.cooldownUntil = Math.max(st.cooldownUntil || 0, now + FACE_SHORT_COOL_MS);
      console.log(`  ℹ️ [IP要因カメラ認証] ${dom} の1時間枠を温存(汚染カウント:${st.rejectedStreak || 0}/5回)し、3分間だけインターバルを空けます`);
    } else if (outcome === 'begin_login_rejected') {
      st.failStreak = (st.failStreak || 0) + 1;
      st.rejectedStreak = (st.rejectedStreak || 0) + 1;
      console.log(`  ⚠️ [何かがおかしいです監視] ${dom} の連続拒絶カウント: ${st.rejectedStreak}/${MAX_REJECT_STREAK}回`);

      if (st.rejectedStreak >= MAX_REJECT_STREAK) {
        st.cooldownUntil = now + LONG_48H_COOL_MS;
        st.wasLongCooled = true;
        if (AUTO_DISABLE_ON_MAX_REJECT) {
          st.disabled = true;
          st.burnedAt = new Date().toISOString();
          console.log(`  🛑 [汚染ドメイン自動隔離] ${dom} が${MAX_REJECT_STREAK}回連続で「何かがおかしいです」になったため、クリーンIPの道連れ汚染を防ぐためローテーションから自動隔離(停止)しました（管理画面から手動リセット可能）`);
        } else {
          const resumeStr = new Date(st.cooldownUntil + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' JST';
          console.log(`  🧊 [2日間長期冷却・自動復帰予約] ${dom} が${MAX_REJECT_STREAK}回連続で「何かがおかしいです」になったため、48時間（2日間）休止させます（自動復帰予定: ${resumeStr}）`);
        }
      } else {
        if (st.wasLongCooled && st.rejectedStreak >= 2) {
          st.cooldownUntil = now + (24 * 60 * 60 * 1000);
          console.log(`  🛡️ [省エネ早期再冷却] ${dom} は長期冷却明けに再び2回拒絶されたため、無駄な通信を防ぐため24時間再休止させます`);
        } else {
          st.cooldownUntil = Math.max(st.cooldownUntil || 0, now + REJECT_SHORT_COOL_MS);
          console.log(`  🧊 [ドメイン保護インターバル] ${dom} が拒絶(${st.rejectedStreak}/${MAX_REJECT_STREAK}回)されたため、X側の1時間制限リセットのため${Math.round(REJECT_SHORT_COOL_MS / 60000)}分間休止させます`);
        }
      }
    }

    health[dom] = st;
    _saveDomainHealth(health);
  } catch (e) {}
}

module.exports.acquireFirstmailAccount = strictAcquireFirstmailAccount;
module.exports.reportDomainOutcome = strictReportDomainOutcome;

async function reserveDomainFor2FA(emailStr, maxWaitMs = 180000) {
  try {
    const raw = String(emailStr || '').trim().toLowerCase();
    const dom = raw.includes('@') ? raw.split('@')[1] : '';
    if (!dom) return { ok: true };

    const customDomains = _loadCustomDomainsFromEnv();
    const initHealth = _loadDomainHealth();
    // 新規追加ドメインで Cloudflare DNS チェックが未実行のものがあれば自動実行
    for (const d of customDomains) {
      if (!initHealth[d] || !initHealth[d].cfDnsSynced) {
        if (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || process.env.CLOUDFLARE_GLOBAL_KEY) {
          await ensureCloudflareDnsForDomain(d).catch(() => {});
        }
        const latestHealth = _loadDomainHealth();
        if (!latestHealth[d]) {
          latestHealth[d] = { successCount: 0, failStreak: 0, rejectedStreak: 0, cooldownUntil: 0, disabled: false, recentTimestamps: [], cfDnsSynced: true };
        } else {
          latestHealth[d].cfDnsSynced = true;
        }
        _saveDomainHealth(latestHealth);
      }
    }
    if (!customDomains.includes(dom)) {
      return { ok: true }; // 独自ドメイン以外(Firstmail等)は制限対象外
    }

    const startWait = Date.now();
    while (Date.now() - startWait < maxWaitMs) {
      const health = _loadDomainHealth();
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const st = health[dom] || { successCount: 0, failStreak: 0, rejectedStreak: 0, cooldownUntil: 0, disabled: false, recentTimestamps: [] };

      const validTs = (Array.isArray(st.recentTimestamps) ? st.recentTimestamps : [])
        .filter(t => typeof t === 'number' && t > oneHourAgo)
        .sort((a, b) => a - b);

      const lastUsedAt = validTs.length > 0 ? validTs[validTs.length - 1] : 0;
      const intervalReadyAt = lastUsedAt ? (lastUsedAt + MIN_SAME_DOMAIN_INTERVAL_MS) : 0;
      const isCooldown = st.cooldownUntil && st.cooldownUntil > now;

      if (!isCooldown && validTs.length < MAX_USES_PER_HOUR && now >= intervalReadyAt) {
        validTs.push(now);
        st.recentTimestamps = validTs;
        health[dom] = st;
        _saveDomainHealth(health);
        console.log(`  🛡️ [2FAドメイン枠確保] ${dom} の1時間枠(${validTs.length}/${MAX_USES_PER_HOUR}回)を確保して2FAメールを受信します`);
        return { ok: true, domain: dom, usedInHour: validTs.length };
      }

      const slotFreeAt = validTs.length >= MAX_USES_PER_HOUR ? (validTs[0] + 60 * 60 * 1000 + 5000) : 0;
      const nextReady = Math.max(st.cooldownUntil || 0, intervalReadyAt, slotFreeAt);
      const remainMin = Math.max(1, Math.ceil((nextReady - now) / 60000));

      // 残り待ち時間が3分を超える場合はブラウザを開いたまま待たず、今回の2FAをスキップして次サイクル(またはbatch_engineの自動補完)へ回す
      if (nextReady - now > 180000) {
        console.log(`  ⏸️ [2FAドメイン競合回避] ${dom} は新規作成側で使用中(直近1h:${validTs.length}/${MAX_USES_PER_HOUR}回・残り約${remainMin}分)のため、ドメイン保護を優先して2FAを次回へ延期します`);
        return { ok: false, deferred: true, remainMin };
      }

      const sleepSec = Math.min(30, Math.max(5, Math.ceil((nextReady - now) / 1000)));
      console.log(`  ⏳ [2FAドメイン間隔調整] ${dom} のインターバル明けまで ${sleepSec}秒 待機中...`);
      await new Promise(r => setTimeout(r, sleepSec * 1000));
    }
    return { ok: false, deferred: true };
  } catch (e) {
    return { ok: true };
  }
}
module.exports.reserveDomainFor2FA = reserveDomainFor2FA;

function getDynamicPacingConfig(wasCreated = true) {
  try {
    const domains = _loadCustomDomainsFromEnv();
    const health = _loadDomainHealth();
    const now = Date.now();
    let healthyCount = 0;

    for (const dom of domains) {
      const st = health[dom] || {};
      if (st.disabled || st.pendingNsActivation || st.zoneStatus === 'pending') continue;
      // 48h長期冷却中ではない有効ドメイン数をカウント
      const isLongCooling = st.cooldownUntil && (st.cooldownUntil - now > 30 * 60 * 1000);
      if (!isLongCooling) healthyCount++;
    }

    const activeDomCount = Math.max(1, healthyCount);
    const maxHourlyTries = activeDomCount * MAX_USES_PER_HOUR;
    // 1試行の平均実行時間(約55秒)を差し引き、1時間枠を均等に使い切る理想クールダウンを算出
    // 下限40秒(Zoho IMAP & IPRoyal保護リミッター) 〜 上限165秒
    const idealCycleSec = Math.round(3600 / maxHourlyTries);
    const baseCooldownSec = Math.max(40, Math.min(165, idealCycleSec - 55));
    const jitter = Math.floor(Math.random() * 22) - 8;

    const cooldownSec = wasCreated
      ? Math.max(38, baseCooldownSec + jitter)
      : Math.max(18, Math.round(baseCooldownSec * 0.35) + Math.floor(Math.random() * 10));

    return {
      activeDomCount,
      totalDomCount: domains.length,
      maxHourlyTries,
      cooldownSec
    };
  } catch (e) {
    return { activeDomCount: 8, totalDomCount: 8, maxHourlyTries: 16, cooldownSec: wasCreated ? 65 : 20 };
  }
}
module.exports.getDynamicPacingConfig = getDynamicPacingConfig;

