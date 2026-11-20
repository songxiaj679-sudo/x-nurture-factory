const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const CACHE_DIR = path.join(__dirname, '../.saas_browser_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function getTokenHash(token) {
  return crypto.createHash('md5').update(String(token || '').trim().toLowerCase()).digest('hex').slice(0, 12);
}

function isPidAlive(pid) {
  const num = parseInt(pid, 10);
  if (!num || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function acquireTokenLock(token, holderName = 'worker', maxWaitMs = 15000, staleMs = 240000) {
  const hash = getTokenHash(token);
  const lockFile = `/tmp/xsw_tok_${hash}.lock`;
  const start = Date.now();

  while (true) {
    try {
      if (fs.existsSync(lockFile)) {
        let shouldBreakLock = false;
        try {
          const raw = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
          const age = Date.now() - (raw.ts || 0);
          if (age > staleMs || !isPidAlive(raw.pid)) {
            shouldBreakLock = true;
          }
        } catch (e) {
          const st = fs.statSync(lockFile);
          if (Date.now() - st.mtimeMs > staleMs) shouldBreakLock = true;
        }
        if (shouldBreakLock) {
          try { fs.unlinkSync(lockFile); } catch (e) {}
        }
      }

      const payload = JSON.stringify({ pid: process.pid, holder: holderName, ts: Date.now() });
      fs.writeFileSync(lockFile, payload, { flag: 'wx' });
      return { lockFile, hash };
    } catch (e) {
      if (Date.now() - start >= maxWaitMs) return null;
      await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 400)));
    }
  }
}

function releaseTokenLock(lockObj) {
  try {
    const file = typeof lockObj === 'string' ? lockObj : (lockObj && lockObj.lockFile);
    if (file && fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (raw.pid && raw.pid !== process.pid && isPidAlive(raw.pid)) return;
      } catch (e) {}
      fs.unlinkSync(file);
    }
  } catch (e) {}
}

// トークン排他ロック取得後にのみ呼び出し、ゾンビ化したChromeとロックファイルだけを安全に掃除する
function prepareLockedProfileDir(prefix, token) {
  const hash = getTokenHash(token);
  const dir = path.join(CACHE_DIR, `${prefix}_${hash}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    const baseName = path.basename(dir);
    execSync(`pkill -9 -f "${baseName}" 2>/dev/null || true`);
  } catch (e) {}
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
    try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
  });
  return dir;
}

function slimBrowserCache(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  ['Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Default/Service Worker', 'ShaderCache', 'Crashpad'].forEach(sub => {
    try { fs.rmSync(path.join(dir, sub), { recursive: true, force: true }); } catch (e) {}
  });
}

module.exports = {
  CACHE_DIR,
  getTokenHash,
  acquireTokenLock,
  releaseTokenLock,
  prepareLockedProfileDir,
  slimBrowserCache
};
