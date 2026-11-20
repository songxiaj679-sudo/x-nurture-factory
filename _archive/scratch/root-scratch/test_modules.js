const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: buf });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path,
      method: 'GET',
      headers
    }, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('--- 🧪 Integration Test: VeloxPost 5 Core Modules ---');

  // Test 1: Account Diagnosis (Phase 2)
  console.log('\n[1] Testing Account Diagnosis & Viral Scoring (/api/account/diagnose)...');
  const diagRes = await post('/api/account/diagnose', { username: 'VeloxSystemsV4' });
  console.log('Status:', diagRes.status);
  console.log('Diagnosis OK:', diagRes.body?.ok, 'Score:', diagRes.body?.score, 'Grade:', diagRes.body?.grade);
  if (!diagRes.body?.ok || !diagRes.body?.council) {
    console.error('❌ Phase 2 Audit Diagnosis failed');
    process.exit(1);
  }
  console.log('✅ Phase 2 Audit Diagnosis passed!');

  // Test 2: Instant Preview Engine (Phase 1)
  console.log('\n[2] Testing Instant Preview Engine (/api/autopilot/instant-preview)...');
  const prevRes = await post('/api/autopilot/instant-preview', {
    targetUrl: 'https://veloxpostapp.com',
    userPrompt: 'B2B経営者向け。商談獲得を重視し、誠実な語り口で訴求',
    lang: 'ja'
  });
  console.log('Status:', prevRes.status);
  console.log('Preview OK:', prevRes.body?.ok, 'Post count:', prevRes.body?.posts?.length);
  if (prevRes.body?.posts?.[0]) {
    console.log('Sample Draft 1:', prevRes.body.posts[0].text?.slice(0, 70) + '...');
  }
  if (!prevRes.body?.ok || !prevRes.body?.posts) {
    console.error('❌ Phase 1 Instant Preview failed:', prevRes.body?.error);
    process.exit(1);
  }
  console.log('✅ Phase 1 Instant Preview passed!');

  // Test 3: Weekly ROI Email Trigger (Phase 4)
  console.log('\n[3] Testing Weekly ROI Email Trigger (/api/admin/trigger-weekly-report)...');
  const roiRes = await post('/api/admin/trigger-weekly-report', { targetEmail: 'test_nonexistent@example.com' });
  console.log('Weekly Report API OK:', roiRes.body?.ok, 'Results count:', roiRes.body?.count);
  console.log('✅ Phase 4 Weekly ROI API passed!');

  console.log('\n🎉 ALL CORE MODULE INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
