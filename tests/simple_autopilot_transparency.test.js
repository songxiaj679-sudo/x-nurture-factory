const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildProfileChecklist } = require('../src/profile_checklist');
const { planSlotPortfolio } = require('../src/slot_portfolio_planner');
const { buildOperatingSummary, formatPlanLabel } = require('../src/growth_phase');
const { draftNextPostText, draftNextPostWithMeta } = require('../src/next_post_draft');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('phase 2 controls stay collapsed and the default path stays on review-and-send', () => {
  const html = read('views/dashboard_view.html');
  assert.match(html, /id="phase2AdvancedDetails"/);
  assert.doesNotMatch(html, /<details id="phase2AdvancedDetails"[^>]*open/);
  assert.match(html, /mention_safe_note/);
  assert.match(html, /No Automated label or second X account is needed/);
  assert.match(html, /btnAutoReplyPhase1/);
  assert.match(html, /saveAutoReplyMode\('auto_mentions', true\)/);
  const phase2 = html.slice(html.indexOf('id="phase2AdvancedDetails"'), html.indexOf('id="autoReplyLog"'));
  assert.match(phase2, /btnAutoReplyPhase2/);
  assert.match(phase2, /autoReplyLabelConfirmed/);
});

test('profile advice follows the dashboard language and the post language separately', () => {
  const checklist = buildProfileChecklist({
    xUsername: 'example',
    aiTargetLang: 'en',
    targetUrl: 'https://example.com',
    userPrompt: '手順を短く残す',
    voiceProfile: { bio: '現場担当者向けに手順を残すアカウント https://example.com' },
    brandKnowledge: { productName: 'VeloxPost', oneLineMechanism: '登録ページの手順を短くする', icpSummary: '運用担当' }
  }, 'ja', { brandKnowledge: { productName: 'VeloxPost', oneLineMechanism: '登録ページの手順を短くする', icpSummary: '運用担当' } });
  assert.match(checklist.currentBioReview, /誰向けか/);
  assert.match(checklist.displayName, /VeloxPost/);
  assert.equal(/[ぁ-ん]/.test(checklist.bio), false);
  assert.ok(checklist.bio.length <= 160);
  assert.match(checklist.bio, /https:\/\/example\.com/);
  assert.match(checklist.automated, /Phase 2/);
  const missing = buildProfileChecklist({ userPrompt: '人物像だけ' }, 'en');
  assert.match(missing.currentBioReview, /was not available/);
  assert.equal(missing.bio.includes('http'), false);
});

test('customer-facing role names and operating summary avoid raw planner codes', () => {
  const html = read('views/dashboard_view.html');
  const facts = html.slice(html.indexOf('function renderNextPostFacts'), html.indexOf('function renderJobCard'));
  assert.match(facts, /portfolioRoleLabel\(job\.portfolioRole, isEn\)/);
  assert.doesNotMatch(facts, /\$\{escHtml\(job\.portfolioRole\)\}/);
  assert.match(html, /story_observation: isEn \? 'Observation and story'/);
  const ja = planSlotPortfolio({ growthPhase: 'trust', timeSlot: 'morning', dayOfWeek: 1 });
  const en = planSlotPortfolio({ growthPhase: 'trust', timeSlot: 'morning', dayOfWeek: 1, lang: 'en' });
  assert.match(ja.rationale, /宣伝リンクは付けず/);
  assert.match(en.rationale, /does not add a promotion link/);
  const summary = buildOperatingSummary({
    officialFollowerCount: 12,
    recentAvgImpressions: 40,
    targetUrl: '',
    uiLang: 'ja'
  }, { uiLang: 'ja' });
  assert.match(summary.situation, /12/);
  assert.match(summary.whyNextPostOnly, /次の1本/);
  assert.match(summary.insights, /実測|平均表示|保存率|蓄積/);
  assert.doesNotMatch(summary.situation, /story_observation|utility_save/);
  const mixed = buildOperatingSummary({
    officialFollowerCount: 49,
    recentAvgImpressions: 40,
    recentBookmarkRate: 0.02,
    uiLang: 'ja',
    xSubscription: 'None'
  }, { uiLang: 'ja', subscription: 'None' });
  assert.doesNotMatch(mixed.situation, /None|Xプラン:/);
  assert.doesNotMatch(mixed.situation, /\./);
  assert.doesNotMatch(mixed.insights.replace(/\d\.\d/g, ''), /\./);
  assert.match(mixed.situation, /通常プラン/);
  assert.equal(formatPlanLabel('PremiumPlus', false), 'X有料プラン（長文対応）');
  assert.equal(formatPlanLabel('PremiumPlus', true), 'Paid X plan (long posts)');
  assert.equal(formatPlanLabel('basic', false), '通常プラン（短文枠）');
  assert.equal(formatPlanLabel('none', true), 'Standard plan');
  assert.doesNotMatch(`${formatPlanLabel('premium', false)} ${formatPlanLabel('premium_plus', true)} ${formatPlanLabel('super', false)}`, /X Premium\+|X Basic|X Premium/);
  assert.match(mixed.insights, /2\.0%/);
  assert.doesNotMatch(mixed.insights, /順位は予測しません/);
});

test('pinned copy is paste-ready and the bio review names stale wording', () => {
  const ja = buildProfileChecklist({
    xUsername: 'VeloxSystemsHQ',
    aiTargetLang: 'ja',
    targetUrl: 'https://veloxpostapp.com',
    userPrompt: '登録ページの手順を短く残す',
    voiceProfile: { bio: '7-agent AI council with zero-link stealth. No URL here.' },
    brandKnowledge: {
      productName: 'VeloxPost',
      oneLineMechanism: '登録ページの手順を1本の投稿に落とす',
      icpSummary: '運用担当',
      verifiedClaims: [{ mechanism: '次の1本だけを予約する' }]
    }
  }, 'ja');
  assert.match(ja.currentBioReview, /見直し推奨表現/);
  assert.match(ja.currentBioReview, /veloxpostapp\.com/);
  assert.doesNotMatch(ja.pin, /固定ポストは/);
  assert.match(ja.pin, /veloxpostapp\.com/);
  assert.match(ja.pinNote, /プロフィールに固定/);
  assert.ok(ja.pin.length <= 280);
  const en = buildProfileChecklist({
    xUsername: 'VeloxSystemsHQ',
    aiTargetLang: 'en',
    targetUrl: 'https://veloxpostapp.com',
    userPrompt: '手順を短く残す',
    brandKnowledge: { productName: 'VeloxPost', oneLineMechanism: '登録ページの手順を短くする' }
  }, 'ja');
  assert.equal(/[ぁ-ん]/.test(en.pin), false);
  assert.match(en.pin, /veloxpostapp\.com/);
  assert.match(en.pinNote, /プロフィールに固定/);
  const enUi = buildProfileChecklist({
    xUsername: 'VeloxSystemsHQ',
    aiTargetLang: 'en',
    targetUrl: 'https://veloxpostapp.com'
  }, 'en');
  assert.match(enUi.pinNote, /pin it/);
  assert.doesNotMatch(en.bio, /Practical notes for the reader\./);
});

test('the next post can carry a brief and a persona-only rewrite still runs', () => {
  assert.equal(typeof draftNextPostText, 'function');
  assert.equal(typeof draftNextPostWithMeta, 'function');
  const promo = read('src/autonomous_promo_ai.js');
  assert.match(promo, /personaText/);
  assert.match(promo, /\|\| personaText\)/);
  assert.match(promo, /draftBriefSummary/);
  assert.match(promo, /allowPromoUrl: false/);
  const routes = read('src/hybrid_saas_routes.js');
  assert.match(routes, /operatingSummary/);
  assert.match(routes, /buildAiProfileChecklist/);
  const architect = read('src/autonomous_strategy_architect.js');
  assert.match(architect, /getUserProfileAndRecentTweets/);
  assert.match(architect, /slice\(0, 20\)/);
});
