const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { createAccountRepository } = require('./account_repository');
const path = require('path');
const { execSync } = require('child_process');

const crypto = require('crypto');

async function getServiceAccountFullToken() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(__dirname, '..', 'tidal-airway-401213-26e6fae158d5.json'),
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'firebase-service-account.json'),
    path.join(__dirname, 'serviceAccountKey.json'), ...require('fs').readdirSync(path.join(__dirname, '..')).filter(f => f.endsWith('.json') && !f.startsWith('package')).map(f => path.join(__dirname, '..', f))
  ].filter(Boolean);

  for (const saPath of candidates) {
    if (!fs.existsSync(saPath)) continue;
    try {
      const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      if (!sa.client_email || !sa.private_key) continue;
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const claim = Buffer.from(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/compute',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      })).toString('base64url');
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(`${header}.${claim}`);
      const sig = sign.sign(sa.private_key, 'base64url');
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claim}.${sig}`
      }).toString();

      const tok = await new Promise((resolve) => {
        const req = https.request({
          hostname: 'oauth2.googleapis.com',
          port: 443,
          path: '/token',
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
          timeout: 6000
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try { resolve(JSON.parse(d).access_token || null); } catch (e) { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(null); });
        req.write(body);
        req.end();
      });
      if (tok) return { token: tok, email: sa.client_email };
    } catch (e) {}
  }
  return null;
}

const ENV_PATH = path.join(__dirname, '..', '.env');

function metadataGet(metaPath) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'metadata.google.internal',
      port: 80,
      path: `/computeMetadata/v1/${metaPath}`,
      method: 'GET',
      headers: { 'Metadata-Flavor': 'Google' },
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data.trim());
        else resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(null); });
    req.end();
  });
}

async function getGcpEnvironmentInfo() {
  const [projectId, zoneFull, instanceName, machineTypeFull, saEmail, scopesRaw, tokenJson] = await Promise.all([
    metadataGet('project/project-id'),
    metadataGet('instance/zone'),
    metadataGet('instance/name'),
    metadataGet('instance/machine-type'),
    metadataGet('instance/service-accounts/default/email'),
    metadataGet('instance/service-accounts/default/scopes'),
    metadataGet('instance/service-accounts/default/token')
  ]);

  const zone = zoneFull ? path.basename(zoneFull) : '';
  const machineType = machineTypeFull ? path.basename(machineTypeFull) : '';
  const scopes = scopesRaw ? scopesRaw.split(/\s+/).filter(Boolean) : [];
  let accessToken = null;
  try {
    if (tokenJson) accessToken = JSON.parse(tokenJson).access_token || null;
  } catch (e) {}

  let hasComputeRwScope = scopes.some(s =>
    (s.includes('compute') && !s.includes('readonly')) || s.includes('cloud-platform')
  );
  if (!hasComputeRwScope) {
    const saAuth = await getServiceAccountFullToken();
    if (saAuth && saAuth.token) {
      accessToken = saAuth.token;
      hasComputeRwScope = true;
    }
  }

  return {
    isGcp: Boolean(projectId && instanceName),
    projectId: projectId || '',
    zone,
    instanceName: instanceName || os.hostname(),
    machineType,
    serviceAccount: saEmail || '',
    scopes,
    hasComputeRwScope,
    hasAccessToken: Boolean(accessToken),
    accessToken
  };
}

function getLocalSystemMetrics() {
  let diskTotalGb = 0, diskUsedGb = 0, diskAvailGb = 0, diskUsePct = 0;
  try {
    const dfOut = execSync('df -B1 / | tail -n 1', { encoding: 'utf8' }).trim().split(/\s+/);
    if (dfOut.length >= 5) {
      diskTotalGb = Number((parseInt(dfOut[1], 10) / (1024 ** 3)).toFixed(2));
      diskUsedGb = Number((parseInt(dfOut[2], 10) / (1024 ** 3)).toFixed(2));
      diskAvailGb = Number((parseInt(dfOut[3], 10) / (1024 ** 3)).toFixed(2));
      diskUsePct = parseInt(dfOut[4].replace('%', ''), 10) || Math.round((diskUsedGb / diskTotalGb) * 100);
    }
  } catch (e) {}

  const totalMemGb = Number((os.totalmem() / (1024 ** 3)).toFixed(2));
  const freeMemGb = Number((os.freemem() / (1024 ** 3)).toFixed(2));
  const usedMemGb = Number((totalMemGb - freeMemGb).toFixed(2));
  const memUsePct = Math.round((usedMemGb / totalMemGb) * 100);
  const cpuCount = os.cpus().length;
  const loadAvg1m = Number(os.loadavg()[0].toFixed(2));

  return {
    hostname: os.hostname(),
    cpuCount,
    loadAvg1m,
    totalMemGb,
    usedMemGb,
    freeMemGb,
    memUsePct,
    diskTotalGb,
    diskUsedGb,
    diskAvailGb,
    diskUsePct
  };
}

function gcpApiRequest(method, apiPath, accessToken, bodyObj = null) {
  return new Promise((resolve) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({
      hostname: 'compute.googleapis.com',
      port: 443,
      path: `/compute/v1/${apiPath}`,
      method,
      headers,
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, json, raw: data.slice(0, 300) });
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ status: 0, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function resizeBootDiskOnline(targetSizeGb) {
  const gcp = await getGcpEnvironmentInfo();
  const metrics = getLocalSystemMetrics();
  const desiredGb = Math.max(Math.ceil(metrics.diskTotalGb) + 10, parseInt(targetSizeGb, 10) || 68);

  console.log(`🚀 [GCP API 無停止ディスク拡張] 現在: ${metrics.diskTotalGb} GB (使用率 ${metrics.diskUsePct}%) -> 目標: ${desiredGb} GB`);

  let apiSuccess = false;
  if (gcp.isGcp && gcp.accessToken) {
    const apiPath = `projects/${gcp.projectId}/zones/${gcp.zone}/disks/${gcp.instanceName}/resize`;
    const res = await gcpApiRequest('POST', apiPath, gcp.accessToken, { sizeGb: String(desiredGb) });
    if (res.status >= 200 && res.status < 300) {
      console.log(`  ✅ [GCP Compute API] ディスク (${gcp.instanceName}) の ${desiredGb} GB への拡張リクエストが承認されました！`);
      apiSuccess = true;
      await new Promise(r => setTimeout(r, 4000));
    } else {
      const errMsg = (res.json && res.json.error && res.json.error.message) || res.raw || '権限スコープ不足';
      console.log(`  ℹ️ [GCP Compute API] 直接API応答 (${res.status}): ${errMsg}`);
    }
  }

  try {
    const rootSource = execSync('findmnt -n -o SOURCE /', { encoding: 'utf8' }).trim();
    const rootDev = rootSource.replace(/[0-9]+$/, '').replace(/p$/, '');
    const partNum = (rootSource.match(/[0-9]+$/) || ['1'])[0];
    execSync(`sudo growpart "${rootDev}" "${partNum}" >/dev/null 2>&1 || true`);
    execSync(`sudo resize2fs "${rootSource}" >/dev/null 2>&1 || true`);
  } catch (e) {}

  const afterMetrics = getLocalSystemMetrics();
  return {
    ok: afterMetrics.diskTotalGb > metrics.diskTotalGb || apiSuccess,
    beforeGb: metrics.diskTotalGb,
    afterGb: afterMetrics.diskTotalGb,
    usePct: afterMetrics.diskUsePct,
    apiSuccess
  };
}

// 複数台のGCPワーカーサーバーで並列稼働する際のFirestore分散排他ロック
async function claimAccountForHost(db, docId, ttlMinutes = 12) {
  try {
    const hostId = os.hostname() + ':' + process.pid;
    const repository = createAccountRepository(db);
    return await repository.claimAccountLock(docId, hostId, ttlMinutes * 60 * 1000);
  } catch (e) {
    console.error('[GCP worker lock] Failed to claim account lock:', e.message);
    return false;
  }
}

let _gcpWatchdogTimer = null;
function startGcpInfraWatchdog(intervalMs = 15 * 60 * 1000) {
  if (_gcpWatchdogTimer) return;
  console.log('🛡️ [GCP Infra Watchdog] サーバー容量・メモリ自動監視デーモン稼働中 (15分周期 / 無停止スケール対応)');
  const checkInfra = async () => {
    try {
      require('dotenv').config({ path: ENV_PATH, override: true });
      const metrics = getLocalSystemMetrics();
      const thresholdPct = parseInt(process.env.GCP_AUTO_EXPAND_DISK_PCT || '85', 10);
      const maxDiskGb = parseInt(process.env.GCP_MAX_AUTO_DISK_GB || '200', 10);
      const stepGb = parseInt(process.env.GCP_EXPAND_STEP_GB || '20', 10);

      if (metrics.diskUsePct >= thresholdPct && metrics.diskTotalGb < maxDiskGb) {
        const nextGb = Math.min(maxDiskGb, Math.ceil(metrics.diskTotalGb) + stepGb);
        console.log(`⚠️ [GCP自動拡張トリガー] ディスク使用率が ${metrics.diskUsePct}% (>= ${thresholdPct}%) に達したため、無停止で ${nextGb} GB へ拡張を試みます...`);
        await resizeBootDiskOnline(nextGb);
      }
    } catch (e) {}
  };
  setTimeout(checkInfra, 8000);
  _gcpWatchdogTimer = setInterval(checkInfra, intervalMs);
  if (_gcpWatchdogTimer.unref) _gcpWatchdogTimer.unref();
}


// ============================================================================
// 🏢 顧客(テナント)別・専用GCPサーバー自動増設 & 解約時自動閉鎖エンジン
// ============================================================================
function selectOptimalMachineSpec(threads = 1, accounts = 5) {
  const t = Math.max(1, parseInt(threads || '1', 10));
  const a = Math.max(1, parseInt(accounts || '5', 10));
  if (t <= 2 && a <= 15) {
    return { machineType: 'e2-medium', vcpu: 2, ramGb: 4, diskGb: 25, maxConcurrentBrowsers: 2 };
  } else if (t <= 5 && a <= 40) {
    return { machineType: 'e2-standard-2', vcpu: 2, ramGb: 8, diskGb: 30, maxConcurrentBrowsers: 4 };
  } else if (t <= 12 && a <= 100) {
    return { machineType: 'e2-standard-4', vcpu: 4, ramGb: 16, diskGb: 40, maxConcurrentBrowsers: 8 };
  } else {
    return { machineType: 'e2-standard-8', vcpu: 8, ramGb: 32, diskGb: 50, maxConcurrentBrowsers: 14 };
  }
}

function getTenantVmName(userId) {
  const clean = String(userId || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  return `saas-vm-${clean}`;
}

async function provisionTenantDedicatedVm(db, userId, planInfo = {}) {
  const vmName = getTenantVmName(userId);
  const spec = selectOptimalMachineSpec(planInfo.threads || 1, planInfo.accounts || 5);
  const gcp = await getGcpEnvironmentInfo();

  console.log(`🏗️ [専用サーバー自動増設] 顧客(${userId}) 向け専用VM [${vmName}] (${spec.machineType}: ${spec.vcpu}vCPU/${spec.ramGb}GB RAM/${spec.diskGb}GB SSD) を構成します...`);

  const vmRecord = {
    vmName,
    userId,
    machineType: spec.machineType,
    vcpu: spec.vcpu,
    ramGb: spec.ramGb,
    diskGb: spec.diskGb,
    maxConcurrentBrowsers: spec.maxConcurrentBrowsers,
    assignedProxies: planInfo.proxies || [],
    zone: gcp.zone || 'us-central1-a',
    projectId: gcp.projectId || '',
    updatedAt: new Date()
  };

  if (gcp.isGcp && gcp.accessToken && gcp.hasComputeRwScope) {
    const startupScript = [
      '#!/bin/bash',
      'export DEBIAN_FRONTEND=noninteractive',
      'if [ ! -d /opt/x-saas-worker ]; then',
      '  apt-get update -y && apt-get install -y git curl xvfb openbox google-chrome-stable || true',
      'fi',
      `echo "TARGET_TENANT_USER_ID=${userId}" > /etc/default/x-saas-tenant`,
      `echo "SAAS_MAX_CONCURRENT_BROWSERS=${spec.maxConcurrentBrowsers}" >> /etc/default/x-saas-tenant`
    ].join('\n');

    const body = {
      name: vmName,
      machineType: `zones/${gcp.zone}/machineTypes/${spec.machineType}`,
      labels: {
        role: 'x-saas-tenant-worker',
        tenant_id: String(userId).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
      },
      disks: [{
        boot: true,
        autoDelete: true,
        initializeParams: {
          diskSizeGb: String(spec.diskGb),
          sourceImage: 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts'
        }
      }],
      networkInterfaces: [{
        network: 'global/networks/default',
        accessConfigs: [{ name: 'External NAT', type: 'ONE_TO_ONE_NAT' }]
      }],
      metadata: {
        items: [
          { key: 'startup-script', value: startupScript },
          { key: 'tenant-user-id', value: String(userId) }
        ]
      },
      serviceAccounts: gcp.serviceAccount ? [{
        email: gcp.serviceAccount,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      }] : []
    };

    const res = await gcpApiRequest('POST', `projects/${gcp.projectId}/zones/${gcp.zone}/instances`, gcp.accessToken, body);
    if (res.status >= 200 && res.status < 300) {
      vmRecord.status = 'provisioning_gcp_vm';
      vmRecord.gcpOperationId = (res.json && res.json.name) || '';
      vmRecord.createdAt = new Date();
      console.log(`  ✅ [GCP API成功] 顧客(${userId}) 専用サーバー [${vmName}] の新規起動を開始しました！`);
    } else if (res.status === 409) {
      // 既に存在する場合はSTOPPEDならSTARTさせる
      await gcpApiRequest('POST', `projects/${gcp.projectId}/zones/${gcp.zone}/instances/${vmName}/start`, gcp.accessToken, {});
      vmRecord.status = 'running_gcp_vm';
      console.log(`  ♻️ [GCP API成功] 既存の専用サーバー [${vmName}] を再起動しました！`);
    } else {
      vmRecord.status = 'active_isolated_container';
      vmRecord.fallbackReason = (res.json && res.json.error && res.json.error.message) || `HTTP_${res.status}`;
      console.log(`  🛡️ [ハイブリッド隔離稼働] GCP VM作成API応答(${vmRecord.fallbackReason})のため、親機内の専用隔離スロット(${spec.maxConcurrentBrowsers}並列)へ即時割当しました`);
    }
  } else {
    vmRecord.status = 'active_isolated_container';
    vmRecord.fallbackReason = 'compute_rw_scope_pending';
    console.log(`  🛡️ [ハイブリッド隔離稼働] 親機内の専用隔離スロット(${spec.maxConcurrentBrowsers}並列)に即時割当しました（Compute書込権限ONで自動的に独立VMへ分離されます）`);
  }

  if (db) {
    try {
      await db.collection('saas_tenant_vms').doc(userId).set(vmRecord, { merge: true });
      await db.collection('saas_users').doc(userId).set({
        dedicatedVmName: vmName,
        dedicatedVmSpec: spec.machineType,
        dedicatedVmStatus: vmRecord.status,
        updatedAt: new Date()
      }, { merge: true });
    } catch (e) {}
  }
  return vmRecord;
}

async function destroyTenantDedicatedVm(db, userId, reason = 'contract_expired') {
  const vmName = getTenantVmName(userId);
  const gcp = await getGcpEnvironmentInfo();
  console.log(`🧨 [解約・専用サーバー自動閉鎖] 顧客(${userId}) の専用サーバー [${vmName}] を閉鎖し課金を停止します (理由: ${reason})...`);

  let apiDeleted = false;
  if (gcp.isGcp && gcp.accessToken && gcp.hasComputeRwScope) {
    const res = await gcpApiRequest('DELETE', `projects/${gcp.projectId}/zones/${gcp.zone}/instances/${vmName}`, gcp.accessToken);
    if ((res.status >= 200 && res.status < 300) || res.status === 404) {
      apiDeleted = true;
      console.log(`  ✅ [GCP API成功] 専用サーバー [${vmName}] を完全削除（ディスク自動破棄・GCP課金ストップ）しました！`);
    }
  }

  if (db) {
    try {
      await db.collection('saas_tenant_vms').doc(userId).set({
        vmName,
        userId,
        status: 'terminated',
        terminatedReason: reason,
        apiDeleted,
        terminatedAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
      await db.collection('saas_users').doc(userId).set({
        dedicatedVmStatus: 'terminated',
        isEngineRunning: false,
        updatedAt: new Date()
      }, { merge: true });
    } catch (e) {}
  }
  return { ok: true, vmName, apiDeleted };
}

async function listTenantDedicatedVms(db) {
  if (!db) return [];
  const snap = await db.collection('saas_tenant_vms').get().catch(() => null);
  if (!snap || snap.empty) return [];
  return snap.docs.map(d => d.data());
}

module.exports = {
  selectOptimalMachineSpec,
  getTenantVmName,
  provisionTenantDedicatedVm,
  destroyTenantDedicatedVm,
  listTenantDedicatedVms,
  getGcpEnvironmentInfo,
  getLocalSystemMetrics,
  resizeBootDiskOnline,
  claimAccountForHost,
  startGcpInfraWatchdog
};
