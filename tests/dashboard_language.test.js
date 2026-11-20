const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const dashboardPath = path.join(__dirname, '../views/dashboard_view.html');
const html = fs.readFileSync(dashboardPath, 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

test('dashboard does not claim that undeployed automation changes are active', () => {
  assert.match(html, /自動応援の停止対応は本番の反映状況をご確認ください/);
  assert.match(script, /Check production deployment status for automatic support disabling/);
  assert.doesNotMatch(html, /25 \/ 25 Nodes|READY TO BOOST|ブースト時推計/);
  assert.match(html, /自動返信の停止対応は本番の反映状況をご確認ください/);
  assert.match(script, /Check production deployment status for automatic reply disabling/);
  assert.doesNotMatch(html, /onclick="boostConversations\(\)"/);
});

test('X connection requires terms and keeps automatic posting opt-in', () => {
  assert.match(html, /<form action="\/api\/auth\/twitter\/connect" method="post"/);
  assert.match(html, /id="connectionTerms" name="terms" type="checkbox" required/);
  assert.match(html, /id="connectionAutopost" name="autopost" type="checkbox" class=/);
  assert.match(script, /autoPostingAccepted: document\.getElementById\('connectionAutopost'\)\.checked/);
});

function extractFunction(name) {
  const match = script.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`));
  assert.ok(match, `${name} should be defined in the dashboard`);
  return match[0];
}

test('consent controls remain unavailable until the server confirms support', async () => {
  for (const available of [false, true]) {
    const elements = {
      connectionConsentControls: { hidden: true, disabled: true },
      manualConnectionControls: { hidden: true },
      autopilotConsentControls: { hidden: true },
      consentFeatureWarning: { hidden: false }
    };
    const context = {
      document: { getElementById: id => elements[id] },
      console: { warn() {} },
      fetch: async () => ({ ok: available, status: 404, json: async () => ({ ok: true, version: 1 }) })
    };
    vm.createContext(context);
    vm.runInContext(`async ${extractFunction('initializeConsentControls')}`, context);
    await context.initializeConsentControls();
    assert.equal(elements.connectionConsentControls.disabled, !available);
    assert.equal(elements.connectionConsentControls.hidden, !available);
    assert.equal(elements.manualConnectionControls.hidden, !available);
    assert.equal(elements.autopilotConsentControls.hidden, !available);
    assert.equal(elements.consentFeatureWarning.hidden, available);
  }
});

test('posting consent requires checking the box and can be withdrawn', async () => {
  const elements = {
    autopilotConsentCheckbox: { checked: false },
    autopilotConsentMessage: { textContent: '' }
  };
  const calls = [];
  let reloads = 0;
  const context = {
    document: { getElementById: id => elements[id] },
    checkIsEn: () => false,
    alert() {},
    window: { location: { reload() { reloads++; } } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, username: 'test' }) };
    }
  };
  vm.createContext(context);
  vm.runInContext(`async ${extractFunction('grantAutopilotConsent')}
    async ${extractFunction('revokeAutopilotConsent')}`, context);
  await context.grantAutopilotConsent();
  assert.equal(calls.length, 0);
  assert.match(elements.autopilotConsentMessage.textContent, /チェック/);
  elements.autopilotConsentCheckbox.checked = true;
  await context.grantAutopilotConsent();
  assert.equal(calls[0].url, '/api/autopilot/consent');
  assert.deepEqual(JSON.parse(calls[0].options.body), { accepted: true, version: 1 });
  await context.revokeAutopilotConsent();
  assert.equal(calls[1].url, '/api/autopilot/consent/revoke');
  assert.equal(elements.autopilotConsentCheckbox.checked, false);
  assert.equal(reloads, 2);
});

test('dashboard UI language is independent from post-generation language', () => {
  const getInitialLanguage = extractFunction('getInitialLanguage');
  const context = {
    localStorage: { getItem: () => null },
    navigator: { languages: ['ja-JP'], language: 'ja-JP' },
    window: { __DASHBOARD_CONFIG__: { configuredAiLang: 'en' } }
  };
  vm.createContext(context);
  vm.runInContext(`${getInitialLanguage}\nglobalThis.result = getInitialLanguage();`, context);
  assert.equal(context.result, 'ja');

  vm.runInContext(`let currentLang = 'ja'; ${extractFunction('checkIsEn')}; globalThis.isEnglish = checkIsEn;`, context);
  assert.equal(context.isEnglish(), false);
  vm.runInContext(`currentLang = 'en';`, context);
  assert.equal(context.isEnglish(), true);
});

test('post language changes are saved before the selection is updated', async () => {
  for (const language of ['ja', 'en']) {
    const elements = {
      inpPostLang: { value: 'ja' },
      btnPostLangJa: {},
      btnPostLangEn: {},
      postLanguageMessage: {}
    };
    let succeeds = false;
    let calls = 0;
    const context = {
      document: { getElementById: id => elements[id] },
      checkIsEn: () => language === 'en',
      console: { warn() {} },
      loadJobs: async () => {},
      fetch: async (url, options) => {
        calls++;
        assert.equal(url, '/api/autopilot/post-language');
        assert.deepEqual(JSON.parse(options.body), { lang: 'en' });
        return { ok: succeeds, json: async () => ({ ok: succeeds, lang: 'en' }) };
      }
    };
    vm.createContext(context);
    vm.runInContext(`${extractFunction('selectPostLanguage')}\nasync ${extractFunction('savePostLanguage')}`, context);
    context.selectPostLanguage('ja');
    assert.equal(calls, 0);
    await context.savePostLanguage('en');
    assert.equal(elements.inpPostLang.value, 'ja');
    assert.match(elements.postLanguageMessage.textContent, language === 'en' ? /Reload/ : /再読み込み/);
    assert.equal(elements.btnPostLangEn.disabled, false);
    succeeds = true;
    await context.savePostLanguage('en');
    assert.equal(elements.inpPostLang.value, 'en');
    assert.match(elements.postLanguageMessage.textContent, language === 'en' ? /already being processed/ : /処理中/);
  }
});

test('all dashboard data-i18n keys have Japanese and English translations', () => {
  const i18nStart = script.indexOf('const I18N = {');
  const jaStart = script.indexOf('      ja: {', i18nStart);
  const enStart = script.indexOf('      en: {', jaStart);
  const staticTranslationsStart = script.indexOf('const STATIC_TEXT_I18N = {', enStart);
  const jaKeys = new Set([...script.slice(jaStart, enStart).matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map(match => match[1]));
  const enKeys = new Set([...script.slice(enStart, staticTranslationsStart).matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map(match => match[1]));
  const htmlKeys = new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]));

  assert.deepEqual([...htmlKeys].filter(key => !jaKeys.has(key)), []);
  assert.deepEqual([...htmlKeys].filter(key => !enKeys.has(key)), []);
});

test('static dashboard text can switch languages and restore its source text', () => {
  const mapStart = script.indexOf('const STATIC_TEXT_I18N = {');
  const mapEnd = script.indexOf('const translatedTextNodes =', mapStart);
  const helpersEnd = script.indexOf('let dashboardTextObserver', mapEnd);
  const textNode = {
    nodeType: 3,
    nodeValue: ' 会話サポート ',
    parentElement: { closest: () => null }
  };
  const root = {
    nodeType: 1,
    querySelectorAll: () => [],
    hasAttribute: () => false
  };
  const context = {
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    document: {
      body: root,
      createTreeWalker: () => {
        let visited = false;
        return {
          currentNode: null,
          nextNode() {
            if (visited) return false;
            visited = true;
            this.currentNode = textNode;
            return true;
          }
        };
      }
    }
  };
  root.querySelectorAll = () => [];
  vm.createContext(context);
  vm.runInContext(
    `let currentLang = 'en';\n${script.slice(mapStart, mapEnd)}\n${script.slice(mapEnd, helpersEnd)}\nglobalThis.translate = translateDashboardText;`,
    context
  );

  context.translate(root);
  assert.equal(textNode.nodeValue, ' Conversation support ');
  vm.runInContext(`currentLang = 'ja';`, context);
  context.translate(root);
  assert.equal(textNode.nodeValue, ' 会話サポート ');
});

test('strategy failure warns in both languages that JIT reservations remain active', async () => {
  for (const language of ['ja', 'en']) {
    let poll;
    let progress;
    let log;
    let jobsLoaded = 0;
    const badge = {};
    const badgeText = {};
    const context = {
      checkIsEn: () => language === 'en',
      setInterval: callback => { poll = callback; return 1; },
      clearInterval: () => {},
      fetch: async () => ({ json: async () => ({ ok: true, status: 'error', error: '<untrusted error>' }) }),
      setAiCouncilProgress: (...args) => { progress = args; },
      appendAiLog: (...args) => { log = args; },
      formatTimeCode: () => '00:00',
      document: { getElementById: id => id === 'aiCouncilLiveBadge' ? badge : badgeText },
      loadJobs: async () => { jobsLoaded++; }
    };
    vm.createContext(context);
    vm.runInContext(`let aiConsolePoller = null, aiConsoleTimer = 2, aiConsoleStartTime = Date.now();
      ${extractFunction('startPollingLaunchStatus')}
      startPollingLaunchStatus();`, context);
    await poll();
    assert.match(progress[2], language === 'en' ? /next post failed/i : /次の1投稿に失敗/);
    assert.equal(badgeText.innerText, language === 'en' ? 'FAILED' : '失敗');
    assert.equal(log[3], '');
    assert.equal(jobsLoaded, 1);
  }
});

test('re-deliberation conflicts are visible in the selected language', async () => {
  for (const language of ['ja', 'en']) {
    const message = { style: {} };
    let alertText;
    const context = {
      checkIsEn: () => language === 'en',
      prompt: () => 'instruction',
      document: { getElementById: id => id === 'launchMsg' ? message : null },
      currentLang: language,
      fetch: async () => ({ json: async () => ({ ok: false, code: 'redeliberation_conflict' }) }),
      alert: text => { alertText = text; }
    };
    vm.createContext(context);
    vm.runInContext(`async ${extractFunction('triggerReDeliberation')};`, context);
    await vm.runInContext('triggerReDeliberation()', context);
    assert.match(alertText, language === 'en' ? /changed during re-deliberation/ : /再検討中に予約またはユーザー情報が変更/);
    assert.equal(message.innerText, alertText);
  }
});

test('dashboard status labels and posted metrics follow the selected language', () => {
  assert.match(html, /data-i18n="setup_title"/);
  assert.match(html, /data-i18n="setup_change"/);
  assert.match(html, /data-i18n="step3_title"/);
  assert.match(html, /data-i18n="analysis_tab_weekly"/);
  assert.match(html, /data-i18n="analysis_tab_audit"/);
  assert.match(html, /metrics24hSnapshot/);
  assert.match(html, /tweets_en/);
  assert.match(script, /function updateDashboardStatusLabels\(/);
  assert.match(script, /updateDashboardStatusLabels\(\)/);
  assert.doesNotMatch(html, /AI診断 v4\.0|凍結リスク0\.00%|7名編成AI合議制|Plan: paid/);
  assert.match(html, /aria-hidden="true"/);
});

test('dashboard copy stays on one account and keeps server placeholders', () => {
  assert.doesNotMatch(html, /7名|AI評議会|Hands-Off Autopilot|見本プレビューは廃止しました/);
  for (const token of ['{{USER_PLAN}}', '{{PLAN_CHANGE_BUTTON}}', '{{USER_EMAIL}}', '{{IS_X_CONNECTED}}', '{{CONFIGURED_TARGET_URL}}', '{{USER_ID}}', '{{DEFAULT_HANDLE}}']) {
    assert.equal(html.includes(token), true, token);
  }
  assert.equal(html.includes('id="secJobs"'), true);
  assert.equal(html.includes('id="jobsContainer"'), true);
  assert.equal(html.includes('id="btnLaunchAutopilot"'), true);
  assert.equal(html.includes('id="btnCancelSubscription"'), true);
  assert.equal(html.includes('プランを解約する（ボタン1つで自動更新を停止）'), true);
  assert.equal(html.includes('自律運用スケジュールを起動する'), false);
  assert.equal(html.includes('id="autopilotConsentControls"'), false);
  assert.equal(html.includes('id="autopilotStatusBadge"'), true);
  assert.equal(html.includes('● 自動運用中（稼働中）'), true);
  assert.equal(html.includes('⏸ 停止中'), true);
});

test('council duplicate warning follows the selected landing-page language', async () => {
  const funnel = fs.readFileSync(path.join(__dirname, '../views/funnel_index.html'), 'utf8');
  const start = funnel.indexOf('    async function commitCouncilSchedule() {');
  const end = funnel.indexOf('\n    // ========================================================================', start);
  assert.ok(start >= 0 && end > start);
  const button = {};
  const status = { style: {} };
  let code = 'council_already_approved';
  const context = {
    activeCouncilDeliberation: { deliberationId: 'draft' },
    currentLandingLang: 'ja',
    currentActivePlanType: 'planA',
    currentPlan: 'pro',
    document: { getElementById: id => id === 'btnCommitCouncil' ? button : status },
    localStorage: { getItem: () => null },
    fetch: async () => ({
      json: async () => ({ ok: false, code, error: 'server error' })
    }),
    alert: () => { throw new Error('unexpected alert'); },
    loadJobs: () => {}
  };
  vm.createContext(context);
  vm.runInContext(funnel.slice(start, end), context);
  await vm.runInContext('commitCouncilSchedule()', context);
  assert.match(status.innerText, /既に予約に使用/);
  context.currentLandingLang = 'en';
  await vm.runInContext('commitCouncilSchedule()', context);
  assert.match(status.innerText, /already been used for a reservation/);
  code = 'council_conflict';
  await vm.runInContext('commitCouncilSchedule()', context);
  assert.match(status.innerText, /Check your schedule/);
  context.currentLandingLang = 'ja';
  await vm.runInContext('commitCouncilSchedule()', context);
  assert.match(status.innerText, /予約一覧を確認/);
});

test('header and main Japanese copy is translated or marked for translation', () => {
  const textStart = script.indexOf('const STATIC_TEXT_I18N = {');
  const attrStart = script.indexOf('const STATIC_ATTRIBUTE_I18N = {');
  const enTextBlock = script.slice(textStart, script.indexOf('\n      ja: {', textStart));
  const keys = new Set();
  for (const match of enTextBlock.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)) {
    keys.add(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  }
  const regions = [
    html.slice(html.indexOf('<header'), html.indexOf('</header>') + 9),
    html.slice(html.indexOf('<main'), html.lastIndexOf('</main>') + 7)
  ];
  const misses = [];
  for (const region of regions) {
    const cleaned = region.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    const parts = cleaned.split(/(<[^>]+>)/);
    const stack = [];
    for (const part of parts) {
      if (part.startsWith('<')) {
        if (part.startsWith('</')) {
          stack.pop();
          continue;
        }
        if (part.startsWith('<!') || part.endsWith('/>') || /^<(br|hr|img|input|meta|link|source|wbr)\b/i.test(part)) continue;
        const id = (part.match(/\bid="([^"]+)"/) || [])[1] || '';
        stack.push({ skip: id.startsWith('wizStep'), i18n: /data-i18n=/.test(part) });
        continue;
      }
      const text = part.replace(/\s+/g, ' ').trim();
      if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) continue;
      if (stack.some(item => item.skip || item.i18n) || keys.has(text)) continue;
      misses.push(text);
    }
  }
  assert.deepEqual(misses, []);
  for (const key of ['profile_guide_title', 'profile_guide_bio', 'profile_guide_automated', 'nav_add_workspace']) {
    assert.match(script, new RegExp(`${key}:\\s*"`));
    assert.equal((script.match(new RegExp(`${key}:\\s*"`, 'g')) || []).length >= 2, true, key);
  }
  assert.match(html, /id="advancedSettingsDetails"/);
  assert.match(html, /id="secXProfileGuide"/);
  assert.match(html, /data-i18n="logout"/);
  assert.equal((html.slice(html.indexOf('<header'), html.indexOf('</header>')).match(/href="\/"/g) || []).length, 1);
  assert.equal((html.match(/onclick="openUsageGuideModal\(\)"/g) || []).length, 1);
  assert.equal(html.includes('id="btnToggleAudit"'), false);
  assert.equal(html.includes('id="btnPay_starter"'), false);
  assert.ok(attrStart > textStart);
});

test('weekly report renders measured results in the selected language without default scores', () => {
  for (const language of ['ja', 'en']) {
    const elements = Object.fromEntries([
      'weeklyReportLoading', 'weeklyReportContent', 'repCouncilScore', 'repWeekSummary',
      'repBestSlotName', 'repBestSlotReason', 'repWorstSlotName', 'repWorstSlotCritique',
      'repNextWeekDirectives'
    ].map(id => [id, { style: {}, replaceChildren(...children) { this.children = children; } }]));
    const context = {
      document: {
        getElementById: id => elements[id],
        createElement: tag => ({ tag, textContent: '' })
      },
      checkIsEn: () => language === 'en'
    };
    vm.createContext(context);
    vm.runInContext(extractFunction('renderWeeklyReport'), context);
    context.renderWeeklyReport({
      councilScore: null,
      weekSummary: '実測指標はありません。',
      weekSummary_en: 'No measured metrics.',
      nextWeekDirectives: ['宣伝表示を確認する。'],
      nextWeekDirectives_en: ['Review disclosures.', '<script>not executable</script>']
    });

    assert.equal(elements.repCouncilScore.innerText, language === 'en' ? 'Not scored' : '未採点');
    assert.equal(elements.repWeekSummary.innerText, language === 'en' ? 'No measured metrics.' : '実測指標はありません。');
    assert.equal(elements.repBestSlotName.innerText, language === 'en' ? 'Not measured' : '未測定');
    assert.deepEqual(
      Array.from(elements.repNextWeekDirectives.children, item => item.textContent),
      language === 'en' ? ['Review disclosures.', '<script>not executable</script>'] : ['宣伝表示を確認する。']
    );
    assert.equal(elements.weeklyReportContent.style.display, 'block');
  }
});

test('phase 2 pill stays on phase 1 while the server flag is off', () => {
  const elements = {
    autoReplyModePill: { className: '', textContent: '' },
    autoReplyPhase2Banner: { style: { display: '' }, textContent: '' },
    autoReplyLabelConfirmed: { checked: false },
    btnAutoReplyPhase1: { className: '' },
    btnAutoReplyPhase2: { className: '' }
  };
  const context = {
    window: { __DASHBOARD_CONFIG__: { autoReplyEnabled: true, autoReplyMode: 'auto_mentions', phase2ServerEnabled: false } },
    document: { getElementById: id => elements[id] || null },
    checkIsEn: () => false
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('syncAutoReplyUiState'), context);
  context.syncAutoReplyUiState();
  assert.doesNotMatch(elements.autoReplyModePill.textContent, /現在: Phase 2（自動返信中）/);
  assert.match(elements.autoReplyModePill.textContent, /Phase 2は公開待ち/);
});

function extractByBrace(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = script.indexOf('{', start); i < script.length; i += 1) {
    if (script[i] === '{') depth += 1;
    else if (script[i] === '}') {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  assert.fail(`${name} should close`);
}

test('operating summary does not render an advice lock button', () => {
  const elements = { operatingSummaryBody: { innerHTML: '' } };
  const context = {
    document: { getElementById: id => elements[id] || null },
    checkIsEn: () => false,
    escHtml: value => String(value)
  };
  vm.createContext(context);
  vm.runInContext(extractByBrace('renderOperatingSummary'), context);
  context.renderOperatingSummary({
    situation: '現在地',
    advisoryNote: 'VELOX AIが自動学習として次回に活かします。',
    suggestedPromptAddition: '実測で残った対比を次の1本の軸にする',
    guidancePhase: 'lead'
  });
  assert.match(elements.operatingSummaryBody.innerHTML, /実測の自動反映/);
  assert.doesNotMatch(elements.operatingSummaryBody.innerHTML, /applyVeloxAdvice|この助言を方針に反映する/);
});

test('next post facts hide a foreign brief and a recovery heading', () => {
  const context = {
    visibleHypothesis: value => value || '',
    portfolioRoleLabel: () => '',
    escHtml: value => String(value)
  };
  vm.createContext(context);
  vm.runInContext(extractByBrace('renderNextPostFacts'), context);
  const htmlOut = context.renderNextPostFacts({
    hypothesisWho: '到達率が直近の水準から大きく下がった場合は、無理に攻めず回復向けの投稿構成へ自動調整します。',
    draftBriefSummary: { scene: 'solo operators manually curating posts', readerPayoff: 'one concrete checkpoint' },
    accountStateSnapshot: { measured: true, followers: 12, searchVisible: true }
  }, false);
  assert.doesNotMatch(htmlOut, /今回の切り口/);
  assert.doesNotMatch(htmlOut, /solo operators/);
  assert.doesNotMatch(htmlOut, /誰に:/);
});

test('operating summary suppresses the duplicate direction card and copy stays aligned', () => {
  assert.match(script, /if \(!j\.operatingSummary && j\.trustGoal && j\.trustGoal\.situation\)/);
  assert.match(script, /weekly_report_badge: "過去7日集計"/);
  assert.match(script, /weekly_report_badge: "7-Day Summary"/);
  assert.match(html, /ページの文章だけでは伝わりにくい現場の背景・想定読者・具体例を2〜3行足すと、投稿の具体性が上がります。/);
  assert.match(script, /ページの文章だけでは伝わりにくい現場の背景・想定読者・具体例を2〜3行足すと、投稿の具体性が上がります。/);
  assert.equal((script.match(/aff_card_title:/g) || []).length, 2);
  assert.doesNotMatch(script, /aff_card_title: "🤝/);
});

test('inline launch progress stays on the jobs card in both languages and restores without the modal', async () => {
  const sec = html.indexOf('id="secJobs"');
  const cardAt = html.indexOf('id="jobsLiveProgressCard"');
  const jobsAt = html.indexOf('id="jobsContainer"');
  assert.ok(sec >= 0 && cardAt > sec && jobsAt > cardAt);
  assert.match(script, /function reopenAiCouncilModal\(/);
  assert.match(script, /function syncBackgroundLaunchProgress\(/);
  assert.match(script, /function renderInlineLaunchProgress\(/);
  assert.match(script, /ログ詳細を見る/);
  assert.match(script, /View detailed logs/);
  const card = { style: {}, innerHTML: '' };
  const msg = { style: {}, className: '', innerText: '', onclick: null };
  const context = {
    checkIsEn: () => false,
    document: { getElementById: id => (id === 'jobsLiveProgressCard' ? card : (id === 'launchMsg' ? msg : null)) },
    setInterval: () => 1,
    clearInterval: () => {}
  };
  vm.createContext(context);
  vm.runInContext(`let latestLaunchStatus = null, activeLaunchOriginMs = Date.now() - 42000, inlineLaunchTicker = null;
    ${extractByBrace('inlineLaunchStage')}
    ${extractByBrace('escapeInlineText')}
    ${extractByBrace('launchStepPercent')}
    ${extractByBrace('stopInlineLaunchTicker')}
    ${extractByBrace('scrollToInlineLaunch')}
    ${extractByBrace('renderInlineLaunchProgress')}`, context);
  context.renderInlineLaunchProgress({ status: 'running', currentStep: 'draft_candidates', stepTitle: '複数案を作成しています', stepDetail: '作成中', elapsedSec: 42 });
  assert.match(card.innerHTML, /ログ詳細を見る/);
  assert.doesNotMatch(card.innerHTML, /View detailed logs/);
  assert.match(msg.innerText, /進行中 74%/);
  context.checkIsEn = () => true;
  context.renderInlineLaunchProgress({ status: 'running', currentStep: 'draft_candidates', stepTitle: 'Drafting options', stepDetail: 'Writing', elapsedSec: 42 });
  assert.match(card.innerHTML, /View detailed logs/);
  assert.match(msg.innerText, /In progress 74%/);

  let polled = 0;
  const overlay = { style: { display: 'none' } };
  let rendered = null;
  const restore = {
    fetch: async () => ({ json: async () => ({ ok: true, status: 'running', elapsedSec: 42, currentStep: 'draft_candidates', stepTitle: '複数案', stepDetail: '作成中', logs: [] }) }),
    document: { getElementById: id => (id === 'aiCouncilModalOverlay' ? overlay : null) },
    startPollingLaunchStatus: () => { polled += 1; },
    renderInlineLaunchProgress: state => { rendered = state; }
  };
  vm.createContext(restore);
  vm.runInContext(`let latestLaunchStatus = null, activeLaunchOriginMs = null, aiConsolePoller = null;
    async ${extractByBrace('syncBackgroundLaunchProgress')}`, restore);
  await restore.syncBackgroundLaunchProgress();
  assert.equal(polled, 1);
  assert.equal(rendered.status, 'running');
  assert.notEqual(overlay.style.display, 'flex');
});
