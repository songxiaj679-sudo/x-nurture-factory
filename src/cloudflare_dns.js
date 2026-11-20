require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const HEALTH_PATH = path.join(__dirname, '..', '.domain_health.json');

// 無関係なシステムドメインや拡張子を除外するブラックリスト
const IGNORED_DOMAINS = new Set([
  'cloudflare.com', 'porkbun.com', 'namecheap.com', 'spaceship.com', 'dynadot.com',
  'godaddy.com', 'onamae.com', 'zohomail.jp', 'zoho.jp', 'zoho.com', 'google.com',
  'googleapis.com', 'gmail.com', 'yahoo.co.jp', 'x.com', 'twitter.com', 'iproyal.com',
  'github.com', 'example.com', 'localhost.localdomain'
]);

const IGNORED_TLDS = new Set([
  'js', 'json', 'css', 'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
  'ico', 'txt', 'log', 'sh', 'py', 'bak', 'gz', 'tar', 'zip', 'pdf', 'exe', 'Local'
]);

// どんな雑多なコピペテキスト（購入完了画面・メール本文・改行/空白/カンマ区切り・URL等）からでもドメイン名だけを自動抽出
function extractValidDomainsFromAnyText(rawInput) {
  if (!rawInput) return [];
  const text = Array.isArray(rawInput) ? rawInput.join('\n') : String(rawInput);
  // URLやメールアドレスの @ 以降、または単体のドメイン表記にマッチ
  const regex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/g;
  const found = [];
  const seen = new Set();

  let match;
  while ((match = regex.exec(text)) !== null) {
    let candidate = match[1].toLowerCase().trim();
    // ネームサーバー表記 (xxx.ns.cloudflare.com) などを除外
    if (candidate.endsWith('.ns.cloudflare.com') || candidate.endsWith('.mx.cloudflare.net')) continue;

    const parts = candidate.split('.');
    if (parts.length < 2) continue;
    const tld = parts[parts.length - 1];
    if (tld.length < 2 || /^\d+$/.test(tld)) continue;
    if (IGNORED_TLDS.has(tld)) continue;

    // サブドメインが混入している場合（mail.example.com 等）、ルートドメインを取り出す（co.jp / org.uk 等を考慮）
    if (parts.length > 2) {
      const sld = parts[parts.length - 2];
      if (!['co', 'or', 'ne', 'ac', 'go', 'com', 'org', 'net', 'gov', 'edu'].includes(sld) || parts.length > 3) {
        if (['www', 'mail', 'ns1', 'ns2', 'route1', 'route2', 'route3', '_dmarc', 'api', 'dashboard'].includes(parts[0])) {
          candidate = parts.slice(1).join('.');
        }
      }
    }

    if (IGNORED_DOMAINS.has(candidate)) continue;
    if (candidate.length < 4 || candidate.length > 63) continue;

    if (!seen.has(candidate)) {
      seen.add(candidate);
      found.push(candidate);
    }
  }
  return found;
}

function getCfCredentials() {
  require('dotenv').config({ path: ENV_PATH, override: true });
  const token = (process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_TOKEN || '').trim();
  const email = (process.env.CF_EMAIL || process.env.CLOUDFLARE_EMAIL || '').trim();
  const globalKey = (process.env.CF_GLOBAL_KEY || process.env.CLOUDFLARE_GLOBAL_KEY || '').trim();
  const accountId = (process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const forwardTo = (process.env.CATCHALL_FORWARD_TO || process.env.CATCHALL_IMAP_USER || 'hank3jones@zohomail.jp').trim();
  return { token, email, globalKey, accountId, forwardTo };
}

function cfApiRequest(method, apiPath, bodyObj = null) {
  return new Promise((resolve) => {
    const { token, email, globalKey } = getCfCredentials();
    if (!token && !(email && globalKey)) {
      return resolve({ ok: false, status: 0, error: 'Cloudflare APIトークン未設定' });
    }
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    else { headers['X-Auth-Email'] = email; headers['X-Auth-Key'] = globalKey; }
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`,
      method,
      headers,
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        const ok = Boolean(json && json.success);
        const errMsg = (json && Array.isArray(json.errors) && json.errors[0] && json.errors[0].message) || '';
        resolve({ ok, status: res.statusCode, json, result: json ? json.result : null, error: errMsg });
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, status: 0, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function autoUpdateRegistrarNameservers(domain, nameServers = []) {
  if (!Array.isArray(nameServers) || nameServers.length < 2) return { attempted: false };
  require('dotenv').config({ path: ENV_PATH, override: true });

  const pbKey = (process.env.PORKBUN_API_KEY || '').trim();
  const pbSecret = (process.env.PORKBUN_SECRET_KEY || '').trim();
  if (pbKey && pbSecret) {
    const pbRes = await new Promise((resolve) => {
      const body = JSON.stringify({ apikey: pbKey, secretapikey: pbSecret, ns: nameServers });
      const req = https.request({
        hostname: 'api.porkbun.com',
        port: 443,
        path: `/api/json/v3/domain/updateNs/${encodeURIComponent(domain)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 12000
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            resolve({ attempted: true, registrar: 'Porkbun', ok: j.status === 'SUCCESS', detail: j.message || d });
          } catch (e) { resolve({ attempted: true, registrar: 'Porkbun', ok: false }); }
        });
      });
      req.on('error', (e) => resolve({ attempted: true, registrar: 'Porkbun', ok: false, error: e.message }));
      req.write(body);
      req.end();
    });
    if (pbRes.ok) return pbRes;
  }

  const dynaKey = (process.env.DYNADOT_API_KEY || '').trim();
  if (dynaKey) {
    const nsParams = nameServers.map((ns, i) => `ns${i}=${encodeURIComponent(ns)}`).join('&');
    const dynaRes = await new Promise((resolve) => {
      https.get(`https://api.dynadot.com/api3.json?key=${encodeURIComponent(dynaKey)}&command=set_ns&domain=${encodeURIComponent(domain)}&${nsParams}`, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ attempted: true, registrar: 'Dynadot', ok: d.includes('"Success"') }));
      }).on('error', () => resolve({ attempted: true, registrar: 'Dynadot', ok: false }));
    });
    if (dynaRes.ok) return dynaRes;
  }

  return { attempted: false };
}

async function resolveCloudflareAccountId() {
  const { accountId } = getCfCredentials();
  if (accountId) return accountId;
  const zRes = await cfApiRequest('GET', '/zones?per_page=5');
  if (zRes.ok && Array.isArray(zRes.result) && zRes.result.length > 0 && zRes.result[0].account) {
    return zRes.result[0].account.id;
  }
  const aRes = await cfApiRequest('GET', '/accounts?page=1&per_page=5');
  if (aRes.ok && Array.isArray(aRes.result) && aRes.result.length > 0) {
    return aRes.result[0].id;
  }
  return null;
}

async function ensureDnsRecord(zoneId, type, name, content, extra = {}) {
  const listRes = await cfApiRequest('GET', `/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`);
  if (!listRes.ok || !Array.isArray(listRes.result)) {
    return { ok: false, error: listRes.error || `既存の${type}レコードを取得できませんでした` };
  }
  const exact = listRes.result.find(r => (
    r.content === content && (type !== 'MX' || r.priority === extra.priority)
  ));
  if (exact) return { ok: true, action: 'exists' };
  if ((type === 'A' || (type === 'TXT' && name.startsWith('_dmarc'))) && listRes.result.length > 0) {
    const updateRes = await cfApiRequest('PUT', `/zones/${zoneId}/dns_records/${listRes.result[0].id}`, { type, name, content, ttl: 1, ...extra });
    return updateRes.ok
      ? { ok: true, action: 'updated' }
      : { ok: false, error: updateRes.error || `${type}レコードを更新できませんでした` };
  }
  const createRes = await cfApiRequest('POST', `/zones/${zoneId}/dns_records`, { type, name, content, ttl: 1, ...extra });
  return createRes.ok
    ? { ok: true, action: 'created' }
    : { ok: false, error: createRes.error || `${type}レコードを作成できませんでした` };
}

function registerDomainToLocalEnvAndHealth(domain, zoneStatus, nameServers = []) {
  try {
    if (fs.existsSync(ENV_PATH)) {
      let envText = fs.readFileSync(ENV_PATH, 'utf8');
      const m = envText.match(/^CUSTOM_EMAIL_DOMAINS=(.*)$/m);
      if (m) {
        const list = m[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (!list.includes(domain)) {
          list.push(domain);
          envText = envText.replace(/^CUSTOM_EMAIL_DOMAINS=.*$/m, `CUSTOM_EMAIL_DOMAINS=${list.join(',')}`);
          fs.writeFileSync(ENV_PATH, envText, 'utf8');
        }
      } else {
        fs.appendFileSync(ENV_PATH, `\nCUSTOM_EMAIL_DOMAINS=${domain}\n`, 'utf8');
      }
    }
  } catch (e) {}

  try {
    let health = {};
    if (fs.existsSync(HEALTH_PATH)) {
      health = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
    }
    const cur = health[domain] || { totalCreated: 0, recentTimestamps: [] };
    cur.zoneStatus = zoneStatus;
    cur.nameServers = nameServers;
    cur.lastCheckedAt = new Date().toISOString();

    if (zoneStatus !== 'active') {
      cur.pendingNsActivation = true;
      cur.cooldownUntil = Math.max(cur.cooldownUntil || 0, Date.now() + 6 * 3600 * 1000);
      cur.cooldownReason = 'waiting_nameserver_propagation';
    } else if (cur.pendingNsActivation) {
      cur.pendingNsActivation = false;
      if (cur.cooldownReason === 'waiting_nameserver_propagation') {
        cur.cooldownUntil = 0;
        delete cur.cooldownReason;
      }
    }
    health[domain] = cur;
    fs.writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2), 'utf8');
  } catch (e) {}
}

async function setupDomainInCloudflare(rawDomain, customForwardEmail = null) {
  const extracted = extractValidDomainsFromAnyText(rawDomain);
  const domain = extracted[0] || String(rawDomain || '').trim().toLowerCase();
  if (!domain || !domain.includes('.')) return { ok: false, domain: rawDomain, error: '有効なドメイン名が判別できませんでした' };

  const { forwardTo } = getCfCredentials();
  const destEmail = (customForwardEmail || forwardTo || 'hank3jones@zohomail.jp').trim();

  let zoneObj = null;
  let newlyCreatedZone = false;
  const zFind = await cfApiRequest('GET', `/zones?name=${encodeURIComponent(domain)}`);
  if (zFind.ok && Array.isArray(zFind.result) && zFind.result.length > 0) {
    zoneObj = zFind.result[0];
  } else {
    const accId = await resolveCloudflareAccountId();
    if (!accId) return { ok: false, domain, error: 'Cloudflare Account ID が取得できませんでした' };
    const zCreate = await cfApiRequest('POST', '/zones', { name: domain, account: { id: accId }, type: 'full' });
    if (!zCreate.ok || !zCreate.result) {
      return { ok: false, domain, error: `ゾーン作成失敗: ${zCreate.error || 'API権限を確認してください'}` };
    }
    zoneObj = zCreate.result;
    newlyCreatedZone = true;
  }

  const zoneId = zoneObj.id;
  const zoneStatus = zoneObj.status || 'pending';
  const nameServers = Array.isArray(zoneObj.name_servers) ? zoneObj.name_servers : [];

  let nsAutoResult = { attempted: false };
  if (zoneStatus !== 'active' && nameServers.length >= 2) {
    nsAutoResult = await autoUpdateRegistrarNameservers(domain, nameServers);
  }

  const routingEnableRes = await cfApiRequest('POST', `/zones/${zoneId}/email/routing/enable`);
  if (!routingEnableRes.ok) {
    return { ok: false, domain, error: `Cloudflare Email Routing を有効化できませんでした: ${routingEnableRes.error || 'APIエラー'}` };
  }
  const routingDnsRes = await cfApiRequest('POST', `/zones/${zoneId}/email/routing/dns`);
  if (!routingDnsRes.ok) {
    return { ok: false, domain, error: `Cloudflare Email Routing のDNS設定に失敗しました: ${routingDnsRes.error || 'APIエラー'}` };
  }

  const mxRecords = [
    ['route1.mx.cloudflare.net', 69],
    ['route2.mx.cloudflare.net', 99],
    ['route3.mx.cloudflare.net', 40]
  ];
  for (const [server, priority] of mxRecords) {
    const mxResult = await ensureDnsRecord(zoneId, 'MX', domain, server, { priority });
    if (!mxResult.ok) {
      return { ok: false, domain, mxConfigured: false, error: `MXレコード設定に失敗しました (${server}): ${mxResult.error}` };
    }
  }
  const mxConfigured = true;
  const dnsRecords = [
    { type: 'TXT', name: domain, content: 'v=spf1 include:_spf.mx.cloudflare.net ~all', label: 'SPF TXT', status: 'spfConfigured' },
    { type: 'A', name: domain, content: '192.0.2.1', extra: { proxied: true }, label: 'A', status: 'aConfigured' },
    { type: 'TXT', name: `_dmarc.${domain}`, content: `v=DMARC1; p=none; rua=mailto:${destEmail}`, label: 'DMARC TXT', status: 'dmarcConfigured' }
  ];
  const recordStatus = { spfConfigured: false, aConfigured: false, dmarcConfigured: false };
  for (const record of dnsRecords) {
    const recordResult = await ensureDnsRecord(
      zoneId,
      record.type,
      record.name,
      record.content,
      record.extra || {}
    );
    if (!recordResult.ok) {
      return {
        ok: false,
        domain,
        mxConfigured,
        ...recordStatus,
        error: `${record.label}レコード設定に失敗しました: ${recordResult.error}`
      };
    }
    recordStatus[record.status] = true;
  }
  const txtConfigured = recordStatus.spfConfigured && recordStatus.dmarcConfigured;
  const aConfigured = recordStatus.aConfigured;

  const catchAllRes = await cfApiRequest('PUT', `/zones/${zoneId}/email/routing/rules/catch_all`, {
    actions: [{ type: 'forward', value: [destEmail] }],
    matchers: [{ type: 'all' }],
    enabled: true,
    name: `Catch-All forward to ${destEmail}`
  });
  if (!catchAllRes.ok) {
    return {
      ok: false,
      domain,
      mxConfigured,
      txtConfigured,
      aConfigured,
      catchAllConfigured: false,
      error: `キャッチオール設定に失敗しました: ${catchAllRes.error || 'APIエラー'}`
    };
  }

  registerDomainToLocalEnvAndHealth(domain, zoneStatus, nameServers);

  return {
    ok: true,
    domain,
    zoneId,
    newlyCreatedZone,
    status: zoneStatus,
    isActive: zoneStatus === 'active',
    nameServers,
    nsAutoUpdated: Boolean(nsAutoResult && nsAutoResult.ok),
    nsRegistrar: nsAutoResult.registrar || null,
    mxConfigured,
    txtConfigured,
    spfConfigured: recordStatus.spfConfigured,
    dmarcConfigured: recordStatus.dmarcConfigured,
    aConfigured,
    catchAllConfigured: true,
    forwardTo: destEmail
  };
}

async function setupMultipleDomainsBulk(domainsInput, customForwardEmail = null) {
  const cleanList = extractValidDomainsFromAnyText(domainsInput);
  const results = [];
  for (const d of cleanList) {
    results.push(await setupDomainInCloudflare(d, customForwardEmail));
  }
  return results;
}

async function syncAllDomainsZoneStatus() {
  require('dotenv').config({ path: ENV_PATH, override: true });
  const doms = (process.env.CUSTOM_EMAIL_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  let health = {};
  try {
    if (fs.existsSync(HEALTH_PATH)) health = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
  } catch (e) {}

  const summary = [];
  for (const d of doms) {
    const zFind = await cfApiRequest('GET', `/zones?name=${encodeURIComponent(d)}`);
    if (zFind.ok && Array.isArray(zFind.result) && zFind.result.length > 0) {
      const z = zFind.result[0];
      const st = z.status || 'unknown';
      const ns = z.name_servers || [];
      registerDomainToLocalEnvAndHealth(d, st, ns);
      summary.push({
        domain: d,
        status: st,
        nameServers: ns,
        totalCreated: (health[d] && health[d].totalCreated) || 0,
        cooldownUntil: (health[d] && health[d].cooldownUntil) || 0
      });
    } else {
      summary.push({
        domain: d,
        status: 'not_in_cloudflare',
        nameServers: [],
        totalCreated: (health[d] && health[d].totalCreated) || 0,
        cooldownUntil: (health[d] && health[d].cooldownUntil) || 0
      });
    }
  }
  return summary;
}

let _nsWatchdogTimer = null;
function startDomainNsWatchdog(intervalMs = 15 * 60 * 1000) {
  if (_nsWatchdogTimer) return;
  _nsWatchdogTimer = setInterval(async () => {
    try {
      if (!fs.existsSync(HEALTH_PATH)) return;
      const health = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
      const hasPending = Object.values(health).some(v => v && v.pendingNsActivation);
      if (hasPending) {
        const list = await syncAllDomainsZoneStatus();
        const newlyActive = list.filter(item => item.status === 'active' && health[item.domain] && health[item.domain].pendingNsActivation);
        for (const na of newlyActive) {
          console.log(`🎉 [ドメインNS開通検知] ${na.domain} のネームサーバー変更が反映(active)されました！アカウント作成プールへ自動合流します！`);
        }
      }
    } catch (e) {}
  }, intervalMs);
  if (_nsWatchdogTimer.unref) _nsWatchdogTimer.unref();
}

module.exports = {
  extractValidDomainsFromAnyText,
  getCfCredentials,
  cfApiRequest,
  resolveCloudflareAccountId,
  setupDomainInCloudflare,
  setupMultipleDomainsBulk,
  syncAllDomainsZoneStatus,
  startDomainNsWatchdog,
  autoUpdateRegistrarNameservers,
  setupCloudflareEmailRouting: setupDomainInCloudflare,
  autoConfigureDomain: setupDomainInCloudflare,
  configureCloudflareDomain: setupDomainInCloudflare,
  addDomainToCloudflare: setupDomainInCloudflare,
  syncAllCustomDomainsDns: setupDomainInCloudflare,
  ensureCloudflareDnsForDomain: setupDomainInCloudflare,
  cfRequest: setupDomainInCloudflare,
  getCloudflareAuthHeaders: setupDomainInCloudflare
};
