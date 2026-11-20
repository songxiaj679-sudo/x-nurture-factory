require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db } = require('./firestore');
const { probeProxyHttpsToX } = require('./x_browser_helpers');

const TMP_BAK = '/tmp/iproyal-proxies.csv.bak';
const MASTER_BAK = path.join(os.homedir(), '.xsw_isp_master_backup.csv');
const LIVE_CSV = path.join(__dirname, '../iproyal-proxies.csv');
const OWNER_UID = 'USR-MVUA1GLP-D640';

(async () => {
  if (fs.existsSync(TMP_BAK)) {
    const tmpText = fs.readFileSync(TMP_BAK, 'utf8').trim();
    const curMaster = fs.existsSync(MASTER_BAK) ? fs.readFileSync(MASTER_BAK, 'utf8').trim() : '';
    if (tmpText.split(/\r?\n/).length >= curMaster.split(/\r?\n/).length) {
      fs.writeFileSync(MASTER_BAK, tmpText + '\n', { encoding: 'utf8', mode: 0o600 });
      console.log('🔒 Saved persistent ISP master backup to:', MASTER_BAK);
    }
  } else if (!fs.existsSync(MASTER_BAK) && fs.existsSync(LIVE_CSV)) {
    fs.copyFileSync(LIVE_CSV, MASTER_BAK);
    fs.chmodSync(MASTER_BAK, 0o600);
  }

  if (!fs.existsSync(MASTER_BAK)) {
    console.log('⚠️ Master backup file not found.');
    process.exit(0);
  }

  const lines = fs.readFileSync(MASTER_BAK, 'utf8').split(/\r?\n/);
  const csvKept = [];
  const healthyAssigned = [];

  console.log('\n🌐 Probing all Static ISP proxies against x.com:443...');
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (t.toLowerCase().startsWith('host')) {
      csvKept.push(ln);
      continue;
    }
    const p = t.includes(',') ? t.split(',') : t.split(':');
    if (p.length >= 4) {
      const prx = {
        host: p[0].trim(),
        port: p[1].trim(),
        user: p[2].trim(),
        pass: p.slice(3).join(':').trim()
      };
      const chk = await probeProxyHttpsToX(prx, 4500);
      const isFastAndHealthy = chk.ok && chk.latencyMs < 3500;
      console.log(`  • ${prx.host}:${prx.port} -> ${isFastAndHealthy ? '🟢 ACTIVE' : '🔴 QUARANTINED'} (${chk.reason}, ${chk.latencyMs}ms)`);
      if (isFastAndHealthy) {
        csvKept.push(`${prx.host}:${prx.port}:${prx.user}:${prx.pass}`);
        healthyAssigned.push(`${prx.host}:${prx.port}:${prx.user}:${prx.pass}`);
      }
    }
  }

  if (healthyAssigned.length > 0) {
    fs.writeFileSync(LIVE_CSV, csvKept.join('\n') + '\n', 'utf8');
    await db.collection('saas_users').doc(OWNER_UID).set({
      assignedProxies: healthyAssigned,
      updatedAt: new Date()
    }, { merge: true });
    console.log(`✅ Synced ${healthyAssigned.length} healthy Static ISP proxy(s) to CSV & Firestore!`);
  } else {
    console.log('⚠️ No Static ISP passed health probe; keeping current fallback configuration.');
  }
  process.exit(0);
})();
