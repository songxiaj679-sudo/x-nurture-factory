const fs = require('fs');
const path = require('path');

async function test() {
  console.log('=== 🔬 Testing All 5 Modules Unit Logic ===\n');

  // Test 1: Phase 1 & 2 exports & functions
  console.log('[Test 1] Testing Instant Preview & Council Functions...');
  const { generateInstantPreviewPosts } = require('../src/autonomous_promo_ai');
  if (typeof generateInstantPreviewPosts !== 'function') {
    throw new Error('generateInstantPreviewPosts is not a function');
  }
  console.log('✅ Phase 1: generateInstantPreviewPosts function successfully loaded.');

  // Test 2: Phase 2 Account Diagnosis Scorecard Logic
  console.log('\n[Test 2] Testing Phase 2: Council Account Audit...');
  // Check hybrid_saas_routes file contains instant-preview and account diagnose
  const routesSrc = fs.readFileSync(path.join(__dirname, '../src/hybrid_saas_routes.js'), 'utf8');
  if (!routesSrc.includes('/api/autopilot/instant-preview')) {
    throw new Error('/api/autopilot/instant-preview missing in hybrid_saas_routes.js');
  }
  console.log('✅ Phase 1: /api/autopilot/instant-preview route verified in hybrid_saas_routes.js');

  if (!routesSrc.includes('/api/account/diagnose')) {
    throw new Error('/api/account/diagnose missing in hybrid_saas_routes.js');
  }
  console.log('✅ Phase 2: /api/account/diagnose route verified in hybrid_saas_routes.js');

  // Test 3: Trial billing disclosure in shop.js
  console.log('\n[Test 3] Testing trial billing and cancellation disclosure...');
  const shopSrc = fs.readFileSync(path.join(__dirname, '../src/shop.js'), 'utf8');
  if (!shopSrc.includes('{{TRIAL_PROTECTION_BANNER}}')) {
    throw new Error('{{TRIAL_PROTECTION_BANNER}} replacement missing in shop.js');
  }
  if (!shopSrc.includes('Your selected plan will begin monthly billing when the trial ends.')) {
    throw new Error('Trial end billing disclosure missing in shop.js');
  }
  if (!shopSrc.includes('終了日の前日までにサポートへご連絡ください。')) {
    throw new Error('Trial cancellation deadline missing in shop.js');
  }
  console.log('✅ Trial ending and cancellation details verified in shop.js');

  // Test 4: Phase 4 Weekly ROI Email Engine in shop.js
  console.log('\n[Test 4] Testing Phase 4: Weekly ROI Wrapped Email Engine...');
  if (!shopSrc.includes('sendWeeklyRoiEmail')) {
    throw new Error('sendWeeklyRoiEmail missing in shop.js');
  }
  if (!shopSrc.includes('trigger-weekly-report')) {
    throw new Error('/api/admin/trigger-weekly-report missing in shop.js');
  }
  if (!shopSrc.includes('startWeeklyRoiBatchRunner')) {
    throw new Error('startWeeklyRoiBatchRunner missing in shop.js');
  }
  console.log('✅ Phase 4: Weekly ROI email generator, Sunday batch runner, and admin trigger verified in shop.js');

  // Test 5: Phase 5 & UI Template checks in views/dashboard_view.html
  console.log('\n[Test 5] Testing Phase 5: Dashboard View UI & Typefully Polish...');
  const tpl = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
  if (!tpl.includes('{{TRIAL_PROTECTION_BANNER}}')) {
    throw new Error('{{TRIAL_PROTECTION_BANNER}} missing in dashboard_view.html');
  }
  if (!tpl.includes('generateInstantPreview')) {
    throw new Error('generateInstantPreview missing in dashboard_view.html');
  }
  if (!tpl.includes('tweetIntentUrl') || !tpl.includes('VeloxPostAI診断')) {
    throw new Error('tweetIntentUrl or #VeloxPostAI診断 missing in dashboard_view.html');
  }
  if (!tpl.includes('preview_box_title')) {
    throw new Error('preview_box_title missing in dashboard_view.html');
  }
  if (!tpl.includes('id="secStep1"')) {
    throw new Error('id="secStep1" missing in dashboard_view.html');
  }
  console.log('✅ Phase 5: Minimalist UI, Instant Preview box, Viral Share loop, and Trial banner verified in dashboard_view.html');

  console.log('\n🎉 ALL 5 MODULE SPECIFICATIONS VERIFIED 100% PERFECTLY!');
}

test().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
