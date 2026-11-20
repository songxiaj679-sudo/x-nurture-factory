const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildProfileChecklist } = require('../src/profile_checklist');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('legal pages switch language and keep the Japanese facts', () => {
  const files = ['tokushoho', 'terms', 'privacy', 'company'].map(name => read(`views/compliance_${name}.html`));
  for (const html of files) {
    assert.match(html, /id="legalLangToggle"/);
    assert.match(html, /🌐 日本語 \/ English/);
    assert.match(html, /function preferredLegalLang/);
    assert.match(html, /URLSearchParams\(location\.search\)\.get\('lang'\)/);
    assert.match(html, /velox_lang=/);
    assert.match(html, /localStorage\.getItem\('velox_lang'\)/);
    assert.match(html, /navigator\.language/);
    assert.match(html, /For legal compliance under Japanese law, the Japanese version is authoritative/);
    assert.match(html, /id="backHomeBtn"/);
    assert.match(html, /← Back to Top Page/);
    assert.doesNotMatch(html, /songxiaj679@gmail\.com|軍事規格|Gemini AI|Tokyo, Japan \/ Global Distributed Engineering Team/);
  }
  const tokusho = files[0];
  assert.match(tokusho, /松下 駿介/);
  assert.match(tokusho, /〒651-1111 兵庫県神戸市北区鈴蘭台７丁目３－１－８/);
  assert.match(tokusho, /070-4482-7020/);
  assert.match(tokusho, /support@veloxpostapp\.com/);
  assert.match(tokusho, /¥4,980 \/ \$39/);
  assert.match(tokusho, /¥9,800 \/ \$79/);
  assert.match(tokusho, /¥19,800 \/ \$179/);
  assert.match(tokusho, /noindex, nofollow/);
  const terms = files[1];
  assert.match(terms, /第5条（準拠法および管轄）/);
  assert.match(terms, /Article 5 \(Governing law\)/);
  assert.match(terms, /第6条（免責事項およびAI生成内容について）/);
  assert.match(terms, /Article 6 \(Disclaimers and AI-generated content\)/);
  assert.match(terms, /Automated/);
  const privacy = files[2];
  assert.match(privacy, /AES-256-GCM 暗号化方式/);
  assert.match(privacy, /X Corp\./);
  assert.match(privacy, /Stripe/);
  const company = files[3];
  assert.match(company, /個人事業主 \/ 松下 駿介/);
  assert.match(company, /xAI API/);
  assert.match(company, /noindex, nofollow/);
});

test('logged-in header keeps one account action and honors the language query', () => {
  const client = read('public/funnel/funnel_client.js');
  const start = client.indexOf('ログイン状態: トップページを自由に閲覧');
  const loggedIn = client.slice(start, client.indexOf('ログアウト（未ログイン）状態', start));
  assert.match(loggedIn, /authBtn\.style\.display = 'none'/);
  assert.match(loggedIn, /🚀 ダッシュボード/);
  assert.doesNotMatch(loggedIn, /ダッシュボードを開く/);
  const css = read('public/funnel/funnel.css');
  assert.match(css, /@media \(max-width: 1260px\) \{ \.product-links \{ display: none; \} \}/);
  assert.match(css, /#topDashboardBtn \{ white-space: nowrap; flex-shrink: 0; \}/);
  const funnel = read('views/funnel_index.html');
  const init = funnel.slice(funnel.indexOf('function initLandingLanguage'), funnel.indexOf('function startSocialLogin'));
  assert.ok(init.indexOf("get('lang')") < init.indexOf('velox_lang='));
  assert.ok(init.indexOf('velox_lang=') < init.indexOf("localStorage.getItem('velox_lang')"));
  for (const key of ['pipe_f2_desc', 'pipe_f2_badge', 'faq_a8']) {
    assert.equal((funnel.match(new RegExp(`${key}:`, 'g')) || []).length >= 2, true, key);
  }
  assert.match(funnel, /受信メンションへの返信支援は確認制/);
  assert.match(funnel, /inbound mention support is opt-in/);
  assert.doesNotMatch(funnel, /7名|合議|運用レーン|接続枠|接続アカウント|サテライト|凍結リスクゼロ|98\.4%|4\.8x|translate\.google|USDT|バーナー|Zero Suspension|複数アカウント|multiple .*accounts|レーン数|サスペンド|25台|リプライ営業|burner|Quote-RT|googleTranslateElementInit/i);
});

test('profile checklist stays within the bio limit and does not invent results', () => {
  const ja = buildProfileChecklist({
    xUsername: 'example',
    targetUrl: 'https://example.com',
    userPrompt: '手順を短く残す'
  }, 'ja');
  const en = buildProfileChecklist({ xUsername: 'example', targetUrl: 'not a url' }, 'en');
  assert.ok(ja.bio.length <= 160);
  assert.match(ja.bio, /https:\/\/example\.com/);
  assert.match(ja.automated, /Phase 2/);
  assert.match(ja.automated, /別の X アカウント/);
  assert.match(en.automated, /different X account/);
  assert.equal(en.bio.includes('not a url'), false);
  assert.match(read('src/hybrid_saas_routes.js'), /\/api\/autopilot\/profile-checklist/);
  assert.match(read('views/dashboard_view.html'), /function loadProfileChecklist/);
  assert.match(read('views/dashboard_view.html'), /別の X アカウント/);
  assert.match(read('views/dashboard_view.html'), /different X account/);
});
