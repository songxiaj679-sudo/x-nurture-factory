const crypto = require('crypto');
const { resolveExitCountry } = require('./browser_config');
const fs = require('fs');
const path = require('path');

const IPROYAL_HOST = process.env.IPROYAL_HOST || 'geo.iproyal.com';
const IPROYAL_PORT = process.env.IPROYAL_PORT || '12321';
const IPROYAL_USER = (process.env.IPROYAL_USER || 'TK3YqN2e7NyXeC55').trim();
const IPROYAL_BASE_PASS = (process.env.IPROYAL_PASS || '6v2R9ONbTDZFbc6F_country-jp').trim();

const TRAFFIC_LOG_FILE = path.join(__dirname, '../.traffic_stats.json');

// アカウントのAuthTokenから常に同一の8文字英数字セッションIDを生成（IPブレを100%防止＆0.001秒で即時返却）
function getResidentialProxy(authToken, countryOrSalt = '') {
  if (!IPROYAL_USER || !IPROYAL_BASE_PASS) {
    throw new Error('IPROYAL_USER and IPROYAL_PASS must be configured before resolving a residential proxy');
  }
  let targetCountry = 'jp';
  let extraSalt = '';
  if (countryOrSalt && typeof countryOrSalt === 'object') {
    if (countryOrSalt.country) targetCountry = String(countryOrSalt.country).trim().toLowerCase();
    if (countryOrSalt.salt) extraSalt = String(countryOrSalt.salt);
  } else if (typeof countryOrSalt === 'string' && /^[a-z]{2}$/i.test(countryOrSalt.trim())) {
    targetCountry = countryOrSalt.trim().toLowerCase();
  } else if (countryOrSalt) {
    extraSalt = String(countryOrSalt);
  }
  const iso = targetCountry === 'uk' ? 'gb' : targetCountry;
  const clean = String(authToken || 'default').trim() + extraSalt;
  const sid = iso + crypto.createHash('md5').update(clean).digest('hex').slice(0, 6);
  const cleanBasePass = IPROYAL_BASE_PASS
    .replace(/_country-[a-zA-Z]{2}/g, `_country-${iso}`)
    .replace(/_session-[a-zA-Z0-9]+/g, '')
    .replace(/_lifetime-[a-zA-Z0-9]+/g, '');

  return {
    host: IPROYAL_HOST,
    port: String(IPROYAL_PORT),
    user: IPROYAL_USER,
    pass: `${cleanBasePass}_session-${sid}_lifetime-168h`,
    sessionId: sid,
    country: iso
  };
}

function storedProxyCountry(proxy) {
  if (!proxy || !proxy.pass) return '';
  const match = String(proxy.pass).match(/_country-([a-z]{2})/i);
  if (!match) return '';
  const country = match[1].toLowerCase();
  return country === 'uk' ? 'gb' : country;
}

function getResidentialProxyForAccount(authToken, account) {
  const country = resolveExitCountry(account || {});
  const stored = account && account.proxy;
  if (
    stored && stored.host && stored.port && stored.pass &&
    String(stored.pass).includes('_session-') &&
    storedProxyCountry(stored) === country
  ) {
    return stored;
  }
  return getResidentialProxy(authToken, { country });
}

function recordTrafficBytes(bytes) {
  let stats = { totalBytes: 0, sessions: 0, startedAt: new Date().toISOString() };
  try {
    if (fs.existsSync(TRAFFIC_LOG_FILE)) {
      stats = JSON.parse(fs.readFileSync(TRAFFIC_LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  stats.totalBytes = (stats.totalBytes || 0) + bytes;
  stats.sessions = (stats.sessions || 0) + 1;
  stats.updatedAt = new Date().toISOString();
  try { fs.writeFileSync(TRAFFIC_LOG_FILE, JSON.stringify(stats, null, 2), 'utf8'); } catch (e) {}
  return stats;
}

async function attachTrafficMeter(page) {
  let networkBytes = 0;
  try {
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');
    const bypassedReqIds = new Set();
    client.on('Network.responseReceived', (p) => {
      const u = (p.response && p.response.url) || '';
      if (p.response && (p.response.fromDiskCache || p.response.fromServiceWorker || /abs(-0)?\.twimg\.com|googleapis\.com|gvt1\.com|gstatic\.com|google\.com/.test(u))) {
        bypassedReqIds.add(p.requestId);
      }
    });
    client.on('Network.loadingFinished', (params) => {
      if (bypassedReqIds.has(params.requestId)) return;
      if (params && typeof params.encodedDataLength === 'number') {
        networkBytes += params.encodedDataLength;
      }
    });
  } catch (e) {}

  return {
    getBytes: () => networkBytes,
    finalizeAndLog: (label = '') => {
      const stats = recordTrafficBytes(networkBytes);
      const mbNow = (networkBytes / (1024 * 1024)).toFixed(2);
      const kbNow = (networkBytes / 1024).toFixed(0);
      const totalMb = (stats.totalBytes / (1024 * 1024)).toFixed(2);
      const remainMb = Math.max(0, 10240 - parseFloat(totalMb)).toFixed(1);
      const avgKb = stats.sessions > 0 ? Math.round((stats.totalBytes / stats.sessions) / 1024) : 0;
      const estMoreRuns = avgKb > 0 ? Math.floor((parseFloat(remainMb) * 1024) / avgKb) : 0;
      console.log(`📊 [プロキシ実通信量 ${label}] 今回: ${kbNow} KB (${mbNow} MB) ｜ 累計: ${totalMb} MB / 10240 MB (残り約 ${estMoreRuns} 回稼働可能)`);
      return { sessionBytes: networkBytes, stats };
    }
  };
}

// ============================================================================
// 🛡️ IPRoyal 動的残量管理 & グレースフル安全停止・再開コントローラー (本実装)
// ============================================================================
const QUOTA_STATE_FILE = require('path').join(__dirname, '..', '.iproyal_quota.json');
const MIN_SAFE_REMAINING_GB = 0.50;

function getQuotaState() {
  try {
    if (require('fs').existsSync(QUOTA_STATE_FILE)) {
      return JSON.parse(require('fs').readFileSync(QUOTA_STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    remainingMb: 307.2,
    remainingGb: 0.30,
    minSafeMb: 512.0,
    pausedByQuota: true,
    manualDrainStop: false,
    updatedAt: new Date().toISOString()
  };
}

function saveQuotaState(stateObj) {
  try {
    require('fs').writeFileSync(QUOTA_STATE_FILE, JSON.stringify(stateObj, null, 2), 'utf8');
  } catch (e) {}
}

// 処理中アカウントの完了時に通信量だけを減算（ここではプロセスを強制終了しない＝アカウント保護）
function recordExtraProxyKb(kbUsed, label = 'worker') {
  try {
    const st = getQuotaState();
    const mb = Math.max(0, Number(kbUsed || 0) / 1024);
    st.remainingMb = Math.max(0, Number((st.remainingMb - mb).toFixed(2)));
    st.remainingGb = Number((st.remainingMb / 1024).toFixed(3));
    if (st.remainingMb <= (st.minSafeMb || 512)) {
      st.pausedByQuota = true;
    }
    st.updatedAt = new Date().toISOString();
    saveQuotaState(st);
  } catch (e) {}
}

function _extractTrafficGbFromObj(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const gbKeys = [
    'available_traffic', 'traffic_available', 'traffic_left',
    'availableTraffic', 'residential_traffic', 'unsettled_traffic', 'balance_traffic'
  ];
  for (const k of gbKeys) {
    if (typeof obj[k] === 'number' && obj[k] >= 0) return obj[k];
    if (typeof obj[k] === 'string' && !isNaN(parseFloat(obj[k]))) return parseFloat(obj[k]);
  }
  const byteKeys = ['available_bytes', 'traffic_left_bytes', 'remaining_bytes', 'available_traffic_bytes'];
  for (const k of byteKeys) {
    if (typeof obj[k] === 'number' && obj[k] >= 0) return obj[k] / (1024 * 1024 * 1024);
  }
  for (const sub of ['data', 'residential', 'user', 'account', 'result', 'sub_user', 'traffic']) {
    if (obj[sub] && typeof obj[sub] === 'object') {
      const found = _extractTrafficGbFromObj(obj[sub]);
      if (found !== null) return found;
    }
  }
  return null;
}

function _httpGetJson(hostname, apiPath, headers) {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.request({
      hostname,
      port: 443,
      path: apiPath,
      method: 'GET',
      headers,
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, body: body.slice(0, 240), json: parsed });
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message, json: null }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ status: 0, error: 'timeout', json: null }); });
    req.end();
  });
}

async function syncIproyalApiBalanceIfConfigured(verbose = false) {
  try {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
    const apiToken = (process.env.IPROYAL_API_TOKEN || '').trim();
    if (!apiToken) return { ...getQuotaState(), syncedFromApi: false, reason: 'no_token' };

    const headers = {
      'Authorization': `Bearer ${apiToken}`,
      'X-Access-Token': apiToken,
      'Accept': 'application/json',
      'User-Agent': 'x-nurture-quota-monitor/1.0'
    };

    const endpoints = [
      ['resi-api.iproyal.com', '/v1/me'],
      ['resi-api.iproyal.com', '/v1/user'],
      ['apid.iproyal.com', '/v1/reseller/my-account'],
      ['apid.iproyal.com', '/v1/residential/user'],
      ['apid.iproyal.com', '/v1/me'],
      ['dashboard.iproyal.com', '/api/residential/info']
    ];

    let detectedGb = null;
    let matchedEndpoint = null;
    const probeResults = [];

    for (const [host, p] of endpoints) {
      const res = await _httpGetJson(host, p, headers);
      probeResults.push({ endpoint: `https://${host}${p}`, status: res.status, sample: res.body });
      if (res.status >= 200 && res.status < 300 && res.json) {
        const gb = _extractTrafficGbFromObj(res.json);
        if (gb !== null) {
          detectedGb = gb;
          matchedEndpoint = `https://${host}${p}`;
          break;
        }
      }
    }

    if (verbose) {
      console.log('📡 [IPRoyal API 照会結果]:');
      for (const pr of probeResults) {
        console.log(`   -> ${pr.endpoint} [HTTP ${pr.status}] : ${pr.sample || '応答なし'}`);
        if (matchedEndpoint && pr.endpoint === matchedEndpoint) break;
      }
    }

    if (detectedGb !== null) {
      const prev = getQuotaState();
      const wasPaused = !!prev.pausedByQuota;
      const newMb = Number((detectedGb * 1024).toFixed(2));
      const minMb = prev.minSafeMb || (MIN_SAFE_REMAINING_GB * 1024);
      const isNowUnderLimit = newMb <= minMb;

      const nextState = {
        ...prev,
        remainingMb: newMb,
        remainingGb: Number(detectedGb.toFixed(3)),
        minSafeMb: minMb,
        pausedByQuota: isNowUnderLimit,
        matchedEndpoint,
        lastApiSyncAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      saveQuotaState(nextState);

      if (!isNowUnderLimit && wasPaused && !nextState.manualDrainStop) {
        console.log(`🎉 [IPRoyal 課金自動検知] 残量が ${detectedGb.toFixed(3)} GB に回復しました！養殖エンジン(24)と初期設定ワーカーを安全に自動再開します！`);
        try {
          require('child_process').execSync('pm2 start 24 >/dev/null 2>&1 || true');
          require('child_process').execSync('nohup node src/init_profiles.js >> /tmp/x_init_live.log 2>&1 &');
        } catch (e) {}
      }
      return { ...nextState, syncedFromApi: true };
    }
    return { ...getQuotaState(), syncedFromApi: false, reason: 'local_ledger_active', probeResults };
  } catch (e) {
    return { ...getQuotaState(), syncedFromApi: false, reason: e.message };
  }
}

// 次のアカウント処理に入る「前」に呼ばれ、0.50GB以下または手動停止予約なら安全にプロセスを停止する
function checkAndEnforceQuotaSync(callerName = 'system') {
  const st = getQuotaState();
  const remGb = (st.remainingMb / 1024).toFixed(3);
  const minGb = ((st.minSafeMb || 512) / 1024).toFixed(2);

  if (st.manualDrainStop) {
    console.log(`\n🛑 【手動グレースフル停止完了 (${callerName})】`);
    console.log(`   直前のアカウント処理をすべて正常保存し、安全な状態で停止しました。`);
    if (callerName !== 'admin' && callerName !== 'test') {
      try { require('child_process').execSync('pm2 stop 24 25 >/dev/null 2>&1 || true'); } catch (e) {}
      process.exit(0);
    }
    return st;
  }

  if (st.remainingMb <= (st.minSafeMb || 512)) {
    st.pausedByQuota = true;
    saveQuotaState(st);
    console.log(`\n🛑 【IPRoyal 0.50GB 安全保護ロック発動 (${callerName})】`);
    console.log(`   現在の残り通信量: ${remGb} GB (${st.remainingMb} MB) <= 安全停止ライン: ${minGb} GB`);
    console.log(`   処理中アカウントを傷つけないよう、新規セッション開始前に安全停止しました。`);
    console.log(`   💡 チャージ後の再開コマンド: ./safe_ctl.sh resume <合計GB数>\n`);
    if (callerName !== 'admin' && callerName !== 'test') {
      try { require('child_process').execSync('pm2 stop 24 25 >/dev/null 2>&1 || true'); } catch (e) {}
      process.exit(0);
    }
  }
  return st;
}

function requestGracefulDrainStop() {
  const st = getQuotaState();
  st.manualDrainStop = true;
  st.updatedAt = new Date().toISOString();
  saveQuotaState(st);
  console.log('🛡️ [グレースフル停止予約] 現在処理中のアカウントが完了し次第、全エンジンを安全に停止します...');
  return st;
}

function setRemainingGbAndResume(newRemainingGb = null, autoStartPm2 = true, startSetupWorkerToo = false) {
  const prev = getQuotaState();
  const mb = (newRemainingGb !== null && !isNaN(Number(newRemainingGb)))
    ? Math.round(Number(newRemainingGb) * 1024 * 100) / 100
    : prev.remainingMb;
  const st = {
    ...prev,
    remainingMb: mb,
    remainingGb: Number((mb / 1024).toFixed(3)),
    minSafeMb: 512.0,
    pausedByQuota: mb <= 512.0,
    manualDrainStop: false,
    updatedAt: new Date().toISOString()
  };
  saveQuotaState(st);
  console.log(`✅ [状態更新] 残り通信量: ${(mb / 1024).toFixed(3)} GB (${mb} MB) | 手動停止ロック: 解除済`);
  if (!st.pausedByQuota && autoStartPm2) {
    // 残留ロックファイルの安全な掃除
    try {
      require('child_process').execSync('find .profiles -name "Singleton*" -delete 2>/dev/null || true');
      require('child_process').execSync('rm -f /tmp/x_init_worker.lock 2>/dev/null || true');
    } catch (e) {}
    const targets = startSetupWorkerToo ? '24 25' : '24';
    console.log(`🚀 安全ライン (0.50 GB) クリア確認！PM2 (${targets}) と未完了2FA初期設定をクリーン再開します...`);
    try {
      require('child_process').execSync(`pm2 start ${targets}`, { stdio: 'inherit' });
      require('child_process').execSync('nohup node src/init_profiles.js >> /tmp/x_init_live.log 2>&1 &');
    } catch (e) {}
  } else if (st.pausedByQuota) {
    console.log(`⚠️ 残量が ${(mb / 1024).toFixed(3)} GB (<= 0.50 GB) のため、安全ロックを維持しています。`);
  }
  return st;
}

let _watchdogTimer = null;
function startQuotaWatchdogDaemon(intervalMs = 10 * 60 * 1000) {
  if (_watchdogTimer) return;
  console.log('🛡️ [IPRoyal Watchdog] 残量自動監視デーモン稼働中 (10分周期 / 0.50GB安全停止 & 課金時自動再開)');
  setTimeout(() => { syncIproyalApiBalanceIfConfigured(false).catch(() => {}); }, 3000);
  _watchdogTimer = setInterval(() => {
    syncIproyalApiBalanceIfConfigured(false).catch(() => {});
  }, intervalMs);
  if (_watchdogTimer.unref) _watchdogTimer.unref();
}

module.exports = {
  getQuotaState,
  saveQuotaState,
  recordExtraProxyKb,
  syncIproyalApiBalanceIfConfigured,
  checkAndEnforceQuotaSync,
  requestGracefulDrainStop,
  setRemainingGbAndResume,
  startQuotaWatchdogDaemon, getResidentialProxy, getResidentialProxyForAccount, attachTrafficMeter };
