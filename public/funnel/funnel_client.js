/* === PHASE 5 TIMER GUARD === */
(function() {
  if (window.__xswTimerGuardInstalled) return;
  window.__xswTimerGuardInstalled = true;
  try {
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.' + location.hostname + ';';
  } catch (e) {}
})();

window._wizardSelectedInterval = 15;
window._wizardSelectedReplyMode = true;
window._wizardSelectedBattleMode = 'aggressive';
window._currentComposerMode = 'ai';

function switchComposerCreationMode(mode) {
  window._currentComposerMode = (mode === 'manual') ? 'manual' : 'ai';
  var isAi = (window._currentComposerMode === 'ai');

  var aiCard = document.getElementById('aiAutopilotBuilderCard');
  var manualBlock = document.getElementById('manualComposerFullBlock');
  var manualBottom = document.getElementById('manualBottomControlsWrap');
  var btnAi = document.getElementById('tabBtnModeAi');
  var btnMan = document.getElementById('tabBtnModeManual');

  if (btnAi && btnMan) {
    if (isAi) {
      btnAi.classList.add('active-mode');
      btnMan.classList.remove('active-mode');
    } else {
      btnMan.classList.add('active-mode');
      btnAi.classList.remove('active-mode');
    }
  }

  if (aiCard) aiCard.style.display = isAi ? 'block' : 'none';
  if (manualBlock) manualBlock.style.display = isAi ? 'none' : 'block';
  if (manualBottom) manualBottom.style.display = isAi ? 'none' : 'block';

  // 手動モード時はテンプレート一覧を自動で開く
  var pList = document.getElementById('tenantPostsList');
  var tBtn = document.getElementById('btnToggleSavedTemplatesList');
  if (pList && !isAi) {
    pList.style.display = 'block';
    if (tBtn) tBtn.innerText = '▲ 保存済みテンプレート一覧を折りたたむ';
  }
}

function toggleSavedTemplatesAccordion() {
  var pList = document.getElementById('tenantPostsList');
  var tBtn = document.getElementById('btnToggleSavedTemplatesList');
  if (!pList) return;
  if (pList.style.display === 'none') {
    pList.style.display = 'block';
    if (tBtn) tBtn.innerText = '▲ 保存済みテンプレート一覧を折りたたむ';
  } else {
    pList.style.display = 'none';
    if (tBtn) tBtn.innerText = '▼ 保存済みテンプレート一覧を開く / 編集する';
  }
}

function selectAiBattleStance(stanceMode, skipToast) {
  var m = (stanceMode === 'safe' || stanceMode === 'sniper') ? stanceMode : 'aggressive';
  window._wizardSelectedBattleMode = m;
  var hiddenInp = document.getElementById('aiCampBattleModeInput');
  if (hiddenInp) hiddenInp.value = m;

  ['aggressive', 'sniper', 'safe'].forEach(function(k) {
    var card = document.getElementById('stanceCard_' + k);
    if (!card) return;
    if (k === m) card.classList.add('active-stance');
    else card.classList.remove('active-stance');
  });

  if (m === 'aggressive') {
    selectWizardInterval(15);
    selectWizardReplyMode(true);
    if (!skipToast && typeof showDynamicToast === 'function') {
      showDynamicToast('🔥 「シャドウバン覚悟でバズ強奪モード」を選択しました（AI推奨: 15分間隔 / AIリプライON）', 'good');
    }
  } else if (m === 'sniper') {
    selectWizardInterval(30);
    selectWizardReplyMode(true);
    if (!skipToast && typeof showDynamicToast === 'function') {
      showDynamicToast('⚡ 「王道スナイパー成約モード」を選択しました（AI推奨: 30分間隔 / AIリプライON）', 'good');
    }
  } else {
    selectWizardInterval(60);
    selectWizardReplyMode(false);
    if (!skipToast && typeof showDynamicToast === 'function') {
      showDynamicToast('🛡️ 「公式・長期安全ブランドモード」を選択しました（AI推奨: 60分間隔 / BIO内URL排除 / AIリプライOFF）', 'good');
    }
  }
}

async function quickAddTokensFromTopBar() {
  var topInp = document.getElementById('topQuickAuthTokenInput');
  var btn = document.getElementById('btnTopQuickAddToken');
  if (!topInp) return;
  var rawVal = topInp.value.trim();
  if (!rawVal) {
    showDynamicToast('⚠️ 40文字の auth_token を貼り付けてください。', 'error');
    topInp.focus();
    return;
  }
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ トークンを登録して初回検証を起動中...';
  }
  try {
    var r = await fetch('/api/funnel/quick-add-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        laneIndex: selectedLane,
        tokens: rawVal
      })
    });
    var d = await safeParseApiJson(r);
    if (!d || !d.ok) {
      showDynamicToast('⚠️ ' + ((d && d.error) || 'トークンの追加に失敗しました。'), 'error');
      return;
    }
    topInp.value = '';
    if (d.skippedCrossLaneCount && d.skippedCrossLaneCount > 0) {
      showDynamicToast('⚠️ 別レーン登録済みのトークン ' + d.skippedCrossLaneCount + '件を除外し、' + (d.addedTokens || 0) + '件を登録しました！', 'error');
    } else {
      showDynamicToast('🔑 ' + (d.addedTokens || 1) + '件のトークンを Stream Lane #0' + selectedLane + ' に登録し、裏側で初回検証を開始しました！', 'good');
    }
    await loadUserCockpitState();
    await pollLaneTerminalLogs();
  } catch (e) {
    showDynamicToast('⚠️ Error: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '➕ トークンを追加して裏で検証開始 ➔';
    }
  }
}

function selectWizardInterval(mins) {
  window._wizardSelectedInterval = Number(mins) || 15;
  selectedInterval = window._wizardSelectedInterval;
  [15, 30, 60, 120].forEach(function(m) {
    var b = document.getElementById('wizIntBtn_' + m);
    if (!b) return;
    if (m === window._wizardSelectedInterval) {
      b.style.border = '2px solid #4F46E5';
      b.style.background = '#EEF2FF';
      b.style.color = '#312E81';
      b.style.fontWeight = '900';
    } else {
      b.style.border = '1.5px solid #CBD5E1';
      b.style.background = '#FFFFFF';
      b.style.color = '#334155';
      b.style.fontWeight = '800';
    }
  });
  var badge = document.getElementById('aiAutoIntervalSummaryBadge');
  if (badge) {
    var modeLabel = window._wizardSelectedInterval <= 15 ? '🔥 攻め・高速回転' : (window._wizardSelectedInterval <= 30 ? '⚡ 標準バランス' : '🛡️ 安全・長期運用');
    badge.innerText = '🤖 AI自動設定ペース: ' + window._wizardSelectedInterval + '分ごと (' + modeLabel + ' / ±20%ゆらぎ)';
  }
}

function selectWizardReplyMode(enable) {
  window._wizardSelectedReplyMode = !!enable;
  var bOn = document.getElementById('wizReplyBtn_ON');
  var bOff = document.getElementById('wizReplyBtn_OFF');
  if (bOn && bOff) {
    if (window._wizardSelectedReplyMode) {
      bOn.style.border = '2px solid #4F46E5';
      bOn.style.background = '#4F46E5';
      bOn.style.color = '#FFFFFF';
      bOff.style.border = '1.5px solid #CBD5E1';
      bOff.style.background = '#FFFFFF';
      bOff.style.color = '#475569';
    } else {
      bOff.style.border = '2px solid #334155';
      bOff.style.background = '#334155';
      bOff.style.color = '#FFFFFF';
      bOn.style.border = '1.5px solid #CBD5E1';
      bOn.style.background = '#FFFFFF';
      bOn.style.color = '#475569';
    }
  }
}

async function confirmAndLaunchAiWizard() {
  var btn = document.getElementById('btnWizardLaunchFinal');
  var bioConfirmEl = document.getElementById('aiWizardBioConfirmInput');
  var bioVal = bioConfirmEl ? bioConfirmEl.value.trim() : '';
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';

  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ 設定を保存して自動投稿＆AI営業エンジンを起動中...';
  }
  try {
    var r = await fetch('/api/funnel/ai-launch-wizard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        laneIndex: selectedLane,
        postIntervalMin: window._wizardSelectedInterval || 15,
        aiReplyMode: window._wizardSelectedReplyMode,
        profileBio: bioVal
      })
    });
    var d = await safeParseApiJson(r);
    if (btn) {
      btn.disabled = false;
      btn.innerText = '✅ 稼働中！設定を更新する（Update & Restart Lane Autopilot）';
    }
    if (!d || !d.ok) {
      showDynamicToast('⚠️ ' + ((d && d.error) || '起動に失敗しました。'), 'error');
      return;
    }
    await loadUserCockpitState();
    await pollLaneTerminalLogs();
    showDynamicToast('🚀 Stream Lane #0' + selectedLane + ' の自動投稿（' + (window._wizardSelectedInterval || 15) + '分間隔）＆AI営業モード（' + (window._wizardSelectedReplyMode ? 'ON' : 'OFF') + '）を起動しました！', 'good');
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🚀 この設定で自動投稿＆AI営業をスタートする（Confirm & Launch Lane Autopilot）';
    }
    showDynamicToast('⚠️ Error: ' + e.message, 'error');
  }
}


function persistUserSession(uid, email) {
  try {
    localStorage.removeItem('xsw_signed_out');
    if (uid) {
      localStorage.setItem('xsw_uid', uid);
      document.cookie = 'xsw_uid=' + encodeURIComponent(uid) + '; path=/; max-age=31536000; SameSite=Lax';
    }
    if (email) {
      localStorage.setItem('xsw_email', email);
      document.cookie = 'xsw_email=' + encodeURIComponent(email) + '; path=/; max-age=31536000; SameSite=Lax';
    }
  } catch (e) {}
}

function getPersistedUid() {
  try {
    if (localStorage.getItem('xsw_signed_out') === '1') return '';
    var u = localStorage.getItem('xsw_uid');
    if (u && u !== 'null' && u !== 'undefined') return u;
    var m = document.cookie.match(/(?:^|;\s*)xsw_uid=([^;]+)/);
    if (m && m[1]) {
      var dec = decodeURIComponent(m[1]);
      localStorage.setItem('xsw_uid', dec);
      return dec;
    }
  } catch (e) {}
  return '';
}

window._proposedAiAngles = [];

function escapeHtmlSafe(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function proposeAiAnglesChat() {
  var prodEl = document.getElementById('aiCampProductInput');
  var urlEl = document.getElementById('aiCampUrlInput');
  var langEl = document.getElementById('aiCampLangSelect');
  var btn = document.getElementById('btnProposeAiAngles');

  var productDesc = prodEl ? prodEl.value.trim() : '';
  var affiliateUrl = urlEl ? urlEl.value.trim() : '';
  var targetLang = langEl ? langEl.value : 'ja';

  if (!productDesc) {
    showDynamicToast('⚠️ Q1. 宣伝したい商品（例：FXのアフィ、Xの自動投稿ツールなど）を入力してください。', 'error');
    if (prodEl) prodEl.focus();
    return;
  }
  if (!affiliateUrl) {
    showDynamicToast('⚠️ Q2. 今一番宣伝したいURL（アフィURL・LINE・Telegram等）を入力してください。', 'error');
    if (urlEl) urlEl.focus();
    return;
  }

  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ AIが「' + productDesc.slice(0, 12) + '」に最適な6つの切り口（👑おすすめ付き）を考案中...';
  }

  var step3Wrap = document.getElementById('aiConciergeStep3Wrap');
  if (step3Wrap) step3Wrap.style.display = 'none';

  try {
    var r = await fetch('/api/funnel/ai-propose-angles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        productDesc: productDesc,
        affiliateUrl: affiliateUrl,
        targetLang: targetLang,
        battleMode: window._wizardSelectedBattleMode || 'aggressive'
      })
    });
    var d = await safeParseApiJson(r);
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🔄 6つの切り口候補（1〜6）を再提案してもらう';
    }
    if (!d || !d.ok || !Array.isArray(d.angles)) {
      showDynamicToast('⚠️ ' + ((d && d.error) || '候補の生成に失敗しました。'), 'error');
      return;
    }

    window._proposedAiAngles = d.angles;
    var step2Wrap = document.getElementById('aiConciergeStep2Wrap');
    var greetEl = document.getElementById('aiConciergeStep2Greeting');
    var cardsBox = document.getElementById('aiAngleCardsContainer');

    if (greetEl) {
      greetEl.innerText = d.aiGreeting || ('「' + productDesc + '」ですね！以下の6つの候補（👑AIイチオシ付き）の中で、どれが一番イメージに近いですか？');
    }

    if (cardsBox) {
      cardsBox.innerHTML = d.angles.map(function(ang) {
        var n = ang.number || 1;
        var isRec = !!ang.isRecommended;
        var recBadgeHtml = isRec
          ? '<span class="ai-rec-crown-badge">👑 AI MOST RECOMMENDED（イチオシ）</span>'
          : '<span style="font-size:0.7rem;font-weight:800;color:#4F46E5;">🎯 ' + escapeHtmlSafe(ang.targetAudience) + '</span>';

        return '<div class="ai-angle-card ' + (isRec ? 'recommended-glow' : '') + '" id="aiAngleCard_' + n + '" onclick="selectAndGenerateAiAngle(' + n + ')">' +
          '<div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' +
              '<span class="ai-angle-num-badge">候補 ' + n + ' 番</span>' +
              recBadgeHtml +
            '</div>' +
            '<div style="font-weight:900;font-size:0.88rem;color:#0F172A;margin-bottom:8px;">' +
              escapeHtmlSafe(ang.title) +
            '</div>' +
            '<div style="background:#F1F5F9;border-radius:10px;padding:9px 11px;font-size:0.76rem;color:#334155;line-height:1.45;margin-bottom:10px;">' +
              '<strong>📝 投稿イメージ:</strong><br>' + escapeHtmlSafe(ang.samplePost) +
            '</div>' +
          '</div>' +
          '<button type="button" style="width:100%;background:' + (isRec ? 'linear-gradient(135deg,#D97706,#F59E0B)' : 'linear-gradient(135deg,#4F46E5,#2563EB)') + ';color:#FFF;border:none;padding:10px 12px;border-radius:9px;font-weight:900;font-size:0.78rem;cursor:pointer;">' +
            (isRec ? '👑 イチオシの ' + n + '番で投稿を作成する ➔' : '✨ ' + n + '番の方向で投稿を作成する ➔') +
          '</button>' +
        '</div>';
      }).join('');
    }

    if (step2Wrap) {
      step2Wrap.style.display = 'block';
      step2Wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '💬 AIに6つの切り口候補（👑おすすめ付き）を出してもらう ➔';
    }
    showDynamicToast('⚠️ Error: ' + e.message, 'error');
  }
}

async function selectAndGenerateAiAngle(angleNum) {
  var angles = window._proposedAiAngles || [];
  var chosen = angles.find(function(a) { return Number(a.number) === Number(angleNum); }) || angles[0] || { number: angleNum, title: 'Option #' + angleNum };

  for (var i = 1; i <= 6; i++) {
    var cEl = document.getElementById('aiAngleCard_' + i);
    if (cEl) {
      if (i === Number(angleNum)) cEl.classList.add('selected-angle');
      else cEl.classList.remove('selected-angle');
    }
  }

  var step3Wrap = document.getElementById('aiConciergeStep3Wrap');
  var step3Text = document.getElementById('aiConciergeStep3Text');
  var confirmPanel = document.getElementById('aiWizardConfirmPanel');
  if (step3Wrap && step3Text) {
    step3Wrap.style.display = 'block';
    if (confirmPanel) confirmPanel.style.display = 'none';
    step3Text.innerHTML = '⏳ <strong>かしこまりました！それでは【' + angleNum + '番：' + escapeHtmlSafe(chosen.title) + '】の方向で、プロフィールBIOと10パターンの投稿ツリーをジェネレートしています...（約5〜8秒）</strong>';
    step3Wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  var prodEl = document.getElementById('aiCampProductInput');
  var urlEl = document.getElementById('aiCampUrlInput');
  var langEl = document.getElementById('aiCampLangSelect');
  var repChk = document.getElementById('aiCampReplaceChk');
  var fbEl = document.getElementById('aiCampUserFeedback');

  var productDesc = prodEl ? prodEl.value.trim() : '';
  var affiliateUrl = urlEl ? urlEl.value.trim() : '';
  var targetLang = langEl ? langEl.value : 'ja';
  var replaceExisting = repChk ? repChk.checked : true;
  var userFeedback = fbEl ? fbEl.value.trim() : '';
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';

  try {
    var r = await fetch('/api/funnel/ai-generate-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        laneIndex: selectedLane,
        productDesc: productDesc,
        affiliateUrl: affiliateUrl,
        funnelStyle: 'empathy_bridge',
        targetLang: targetLang,
        replaceExisting: replaceExisting,
        selectedAngle: chosen,
        userFeedback: userFeedback,
        battleMode: window._wizardSelectedBattleMode || 'aggressive'
      })
    });
    var d = await safeParseApiJson(r);
    if (!d || !d.ok) {
      if (step3Text) step3Text.innerText = '⚠️ ' + ((d && d.error) || '生成に失敗しました。');
      showDynamicToast('⚠️ ' + ((d && d.error) || 'Generation failed'), 'error');
      return;
    }

    window._bioDirty = false;
    window._aiKwDirty = false;
    window._aiCampDirty = false;

    if (!allLanesConfig[selectedLane]) allLanesConfig[selectedLane] = {};
    allLanesConfig[selectedLane].profileBio = d.profileBio || '';
    allLanesConfig[selectedLane].aiKeywords = d.aiKeywords || '';
    allLanesConfig[selectedLane].aiProductDesc = productDesc;
    allLanesConfig[selectedLane].aiAffiliateUrl = affiliateUrl;
    allLanesConfig[selectedLane].aiTargetLang = targetLang;
    allLanesConfig[selectedLane].aiReplyPersona = d.aiReplyPersona || '';

    var bioInp = document.getElementById('proBioInput');
    if (bioInp) bioInp.value = d.profileBio || '';
    var wizBioInp = document.getElementById('aiWizardBioConfirmInput');
    if (wizBioInp) wizBioInp.value = d.profileBio || '';

    var previewListEl = document.getElementById('aiWizardPostsPreviewList');
    if (previewListEl && Array.isArray(d.generatedPosts)) {
      previewListEl.innerHTML = d.generatedPosts.map(function(p, idx) {
        return '<div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;padding:9px 12px;font-size:0.76rem;color:#1E293B;">' +
          '<div style="font-weight:900;color:#4F46E5;margin-bottom:3px;">Pattern #' + (idx + 1) + '</div>' +
          '<div style="margin-bottom:4px;line-height:1.4;">' + escapeHtmlSafe(p.mainText || p.text || '') + '</div>' +
          '<div style="color:#047857;font-size:0.72rem;background:#ECFDF5;padding:4px 8px;border-radius:6px;">💬 Self-Reply: ' + escapeHtmlSafe(p.selfReplyText || '') + '</div>' +
        '</div>';
      }).join('');
    }

    if (step3Text) {
      step3Text.innerHTML = '🎉 <strong>【' + angleNum + '番：' + escapeHtmlSafe(chosen.title) + '】でプロフィールBIOと10パターンの投稿を作成しました！下のプレビューを確認し、投稿間隔と返信モードを選んで稼働を開始してください✨</strong>';
    }
    if (d.recommendedIntervalMin) {
      selectWizardInterval(d.recommendedIntervalMin);
    }
    if (typeof d.recommendedAiReply === 'boolean') {
      selectWizardReplyMode(d.recommendedAiReply);
    }
    if (confirmPanel) {
      confirmPanel.style.display = 'block';
    }

    updateLiveCharCounters();
    await loadUserCockpitState();
    await pollLaneTerminalLogs();
  } catch (e) {
    if (step3Text) step3Text.innerText = '⚠️ Error: ' + e.message;
    showDynamicToast('⚠️ Error: ' + e.message, 'error');
  }
}

var userHasAiRadarAddon = false;
function openAiRadarAddonModal() {
  if (userHasAiRadarAddon) {
    showDynamicToast('🟢 AI Empathy Direct-Sales Radar is already unlocked on your account!', 'good');
    return;
  }
  openUnlockModal('ai_radar_addon');
}

window._aiCampDirty = false;

function toggleAiBuilderBody() {
  var wrap = document.getElementById('aiBuilderBodyWrap');
  var btn = document.getElementById('btnToggleAiBuilder');
  if (!wrap) return;
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    if (btn) btn.innerText = 'Collapse ▲';
  } else {
    wrap.style.display = 'none';
    if (btn) btn.innerText = 'Expand ▼';
  }
}

async function runAiAutopilotCampaign() {
  if (activeTierLevel === 0) return openUnlockModal('starter');
  var prodEl = document.getElementById('aiCampProductInput');
  var urlEl = document.getElementById('aiCampUrlInput');
  var styleEl = document.getElementById('aiCampStyleSelect');
  var langEl = document.getElementById('aiCampLangSelect');
  var repChk = document.getElementById('aiCampReplaceChk');
  var btn = document.getElementById('btnRunAiCampaign');

  var productDesc = prodEl ? prodEl.value.trim() : '';
  var affiliateUrl = urlEl ? urlEl.value.trim() : '';
  var funnelStyle = styleEl ? styleEl.value : 'empathy_bridge';
  var targetLang = langEl ? langEl.value : 'ja';
  var replaceExisting = repChk ? repChk.checked : true;

  if (!productDesc) {
    showDynamicToast('⚠️ Please enter what product, offer, or niche you want to promote.', 'error');
    if (prodEl) prodEl.focus();
    return;
  }

  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Gemini AI is building your BIO, 10 Spintax Posts & Radar...';
  }

  try {
    var r = await fetch('/api/funnel/ai-generate-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        laneIndex: selectedLane,
        productDesc: productDesc,
        affiliateUrl: affiliateUrl,
        funnelStyle: funnelStyle,
        targetLang: targetLang,
        replaceExisting: replaceExisting
      })
    });
    var d = await safeParseApiJson(r);
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🪄 Generate BIO, 10 Post Patterns & Empathy Radar';
    }
    if (!d || !d.ok) {
      showDynamicToast('⚠️ ' + ((d && d.error) || 'AI Campaign generation failed.'), 'error');
      return;
    }

    window._bioDirty = false;
    window._aiKwDirty = false;
    window._aiCampDirty = false;

    if (!allLanesConfig[selectedLane]) allLanesConfig[selectedLane] = {};
    allLanesConfig[selectedLane].profileBio = d.profileBio || '';
    allLanesConfig[selectedLane].aiKeywords = d.aiKeywords || '';
    allLanesConfig[selectedLane].aiProductDesc = productDesc;
    allLanesConfig[selectedLane].aiAffiliateUrl = affiliateUrl;
    allLanesConfig[selectedLane].aiFunnelStyle = funnelStyle;
    allLanesConfig[selectedLane].aiTargetLang = targetLang;
    allLanesConfig[selectedLane].aiReplyPersona = d.aiReplyPersona || '';

    var bioInp = document.getElementById('proBioInput');
    if (bioInp) bioInp.value = d.profileBio || '';
    var kwInp = document.getElementById('proAiKeywords');
    if (kwInp) kwInp.value = d.aiKeywords || '';
    var perInp = document.getElementById('aiCampPersonaPreview');
    if (perInp) perInp.value = d.aiReplyPersona || '';

    updateLiveCharCounters();
    await loadUserCockpitState();
    await pollLaneTerminalLogs();

    showDynamicToast('🪄 Gemini AI built ' + (d.addedCount || 10) + ' post patterns, synced BIO & configured Empathy Radar for Stream Lane #0' + selectedLane + '!', 'good');
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🪄 Generate BIO, 10 Post Patterns & Empathy Radar';
    }
    showDynamicToast('⚠️ Network error: ' + e.message, 'error');
  }
}


var allLaneLogsCache = { 1: [], 2: [], 3: [] };

function renderActiveLaneTerminal() {
  var titleEl = document.getElementById('laneTermTitle');
  var cCode = activeCountries[selectedLane - 1] || activeCountries[0] || 'US';
  if (titleEl) {
    titleEl.innerText = '🖥️ LIVE TERMINAL — STREAM LANE #0' + selectedLane + ' (' + cCode + ' Static ISP #' + selectedLane + ')';
  }
  for (var t = 1; t <= 3; t++) {
    var tabBtn = document.getElementById('termTab' + t);
    if (tabBtn) {
      if (t === selectedLane) {
        tabBtn.style.background = '#2563EB';
        tabBtn.style.color = '#FFFFFF';
        tabBtn.style.border = 'none';
      } else {
        tabBtn.style.background = 'rgba(255,255,255,0.08)';
        tabBtn.style.color = '#94A3B8';
        tabBtn.style.border = '1px solid rgba(255,255,255,0.15)';
      }
    }
  }
  var screenEl = document.getElementById('laneTermScreen');
  if (!screenEl) return;
  var lines = allLaneLogsCache[selectedLane] || [];
  if (lines.length === 0) {
    screenEl.innerHTML = '<div class="lane-term-line">[SYSTEM] [LANE #0' + selectedLane + '] Standing by for execution cycle...</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < lines.length; i++) {
    var ln = String(lines[i] || '');
    var cls = 'lane-term-line';
    if (ln.includes('✅') || ln.includes('🟢') || ln.includes('🎉')) cls += ' ok';
    else if (ln.includes('⚠️') || ln.includes('⏳') || ln.includes('🔎')) cls += ' warn';
    else if (ln.includes('🚨') || ln.includes('❌')) cls += ' err';
    html += '<div class="' + cls + '">' + ln.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
  }
  var wasAtBottom = (screenEl.scrollHeight - screenEl.scrollTop - screenEl.clientHeight) < 40;
  screenEl.innerHTML = html;
  if (wasAtBottom) {
    screenEl.scrollTop = screenEl.scrollHeight;
  }
}

async function pollLaneTerminalLogs() {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (!uid || !loggedInEmail || document.visibilityState !== 'visible') return;
  try {
    var r = await fetch('/api/funnel/lane-logs?userId=' + encodeURIComponent(uid));
    var d = await r.json();
    if (d && d.ok && d.logs) {
      allLaneLogsCache = d.logs;
      renderActiveLaneTerminal();
    }
  } catch (e) {}
}

async function clearCurrentLaneTerminal() {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (!uid) return;
  await fetch('/api/funnel/clear-lane-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, laneIndex: selectedLane })
  });
  await pollLaneTerminalLogs();
}

setInterval(pollLaneTerminalLogs, 3500);


window._bioDirty = false;
window._aiKwDirty = false;

async function saveLaneBioOnly() {
  if (activeTierLevel === 0) return openUnlockModal('starter');
  var bioEl = document.getElementById('proBioInput');
  var bio = bioEl ? bioEl.value.trim() : '';
  if (bio && calcXWeight(bio, false) > 160) {
    showDynamicToast('⚠️ プロフィール(BIO)が文字数オーバーです！全角80文字（半角160文字）以内にしてください。', 'error');
    return;
  }
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  var btn = document.getElementById('btnSaveBioOnly');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Saving...'; }
  try {
    var r = await fetch('/api/funnel/save-lane-bio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, laneIndex: selectedLane, bio: bio })
    });
    var d = await safeParseApiJson(r);
    if (btn) { btn.disabled = false; btn.innerText = '💾 Save BIO'; }
    if (!d || !d.ok) {
      showDynamicToast('⚠️ ' + ((d && d.error) || 'BIOの保存に失敗しました'), 'error');
      return;
    }
    window._bioDirty = false;
    if (!allLanesConfig[selectedLane]) allLanesConfig[selectedLane] = {};
    allLanesConfig[selectedLane].profileBio = bio;
    showDynamicToast(bio
      ? ('✅ Stream Lane #0' + selectedLane + ' のBIOを保存しました！（次回投稿時にアカウントへ反映されます）')
      : ('✅ Stream Lane #0' + selectedLane + ' のBIOを空欄（変更なし）として保存しました！'), 'good');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerText = '💾 Save BIO'; }
    showDynamicToast('⚠️ Connection error: ' + e.message, 'error');
  }
}


function evaluatePostAntiBanSafety(rawText) {
  var badge = document.getElementById('postSafetyBadge');
  if (!badge) return;
  var txt = String(rawText || '').trim();
  if (!txt) {
    badge.className = 'char-badge';
    badge.style.background = '#ECFDF5';
    badge.style.color = '#047857';
    badge.style.borderColor = '#6EE7B7';
    badge.innerText = '🛡️ Safety: Optimal';
    return;
  }
  var hashtags = txt.match(/[#＃][^\s#＃]+/g) || [];
  var badShorteners = txt.match(/\b(bit\.ly|tinyurl\.com|is\.gd|cutt\.ly|t\.ly|shorturl\.at)\b/i);
  var mentions = txt.match(/@[a-zA-Z0-9_]+/g) || [];

  if (badShorteners) {
    badge.className = 'char-badge over';
    badge.style.background = ''; badge.style.color = ''; badge.style.borderColor = '';
    badge.innerText = '🚨 Flagged Shortener (' + badShorteners[1] + ')';
  } else if (hashtags.length >= 3) {
    badge.className = 'char-badge near';
    badge.style.background = ''; badge.style.color = ''; badge.style.borderColor = '';
    badge.innerText = '⚠️ ' + hashtags.length + ' Hashtags (Max 2 Rec.)';
  } else if (mentions.length >= 2) {
    badge.className = 'char-badge near';
    badge.style.background = ''; badge.style.color = ''; badge.style.borderColor = '';
    badge.innerText = '⚠️ Excessive @Mentions';
  } else {
    badge.className = 'char-badge';
    badge.style.background = '#ECFDF5';
    badge.style.color = '#047857';
    badge.style.borderColor = '#6EE7B7';
    badge.innerText = '🛡️ Safety: Optimal';
  }
}

function formatLastPostedAgo(ms) {
  if (!ms || ms <= 0) return 'Never';
  var diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  var diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm ago';
  var diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  return Math.floor(diffHr / 24) + 'd ago';
}

async function triggerImmediateLanePost(btnEl) {
  if (activeTierLevel === 0) return openUnlockModal('starter');
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (btnEl) { btnEl.disabled = true; btnEl.innerText = '⏳ Queuing Browser...'; }
  try {
    var r = await fetch('/api/funnel/trigger-lane-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, laneIndex: selectedLane })
    });
    var d = await safeParseApiJson(r);
    if (btnEl) { btnEl.disabled = false; btnEl.innerText = '⚡ Run 1 Post Now'; }
    if (!d || !d.ok) {
      showDynamicToast('⚠️ ' + ((d && d.error) || '即時投稿の起動に失敗しました'), 'error');
      return;
    }
    showDynamicToast('🚀 Stream Lane #0' + selectedLane + ' (@' + (d.targetUsername || 'account') + ') の即時投稿キューを発火しました！約30〜45秒で実機タイピング投稿が完了し、下部ログに反映されます。', 'good');
    loadUserCockpitState();
    setTimeout(loadUserCockpitState, 15000);
    setTimeout(loadUserCockpitState, 32000);
    setTimeout(loadUserCockpitState, 48000);
  } catch (e) {
    if (btnEl) { btnEl.disabled = false; btnEl.innerText = '⚡ Run 1 Post Now'; }
    showDynamicToast('⚠️ Connection error: ' + e.message, 'error');
  }
}

async function reorderPostTemplate(postId, dir) {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  await fetch('/api/funnel/reorder-post-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, laneIndex: selectedLane, postId: postId, direction: dir })
  });
  loadUserCockpitState();
}

function toggleBulkImportDrawer() {
  var dr = document.getElementById('bulkImportDrawer');
  if (!dr) return;
  dr.style.display = (dr.style.display === 'none' || !dr.style.display) ? 'block' : 'none';
}

async function submitBulkImportTemplates() {
  if (activeTierLevel === 0) return openUnlockModal('starter');
  var ta = document.getElementById('bulkImportTextarea');
  if (!ta || !ta.value.trim()) {
    showDynamicToast('⚠️ 一括登録する投稿文を1行に1つずつ入力してください。', 'error');
    return;
  }
  var autoSplit = document.getElementById('autoExtractUrlChk') ? document.getElementById('autoExtractUrlChk').checked : true;
  var rawLines = ta.value.split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean);
  var validItems = [];
  for (var i = 0; i < rawLines.length; i++) {
    var line = rawLines[i];
    var mainTxt = line;
    var selfRep = '';
    if (autoSplit) {
      var uMatches = line.match(/https?:\/\/[^\s]+/g);
      if (uMatches && uMatches.length > 0) {
        mainTxt = line.replace(/https?:\/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim() || '👇';
        selfRep = uMatches.join(' ');
      }
    }
    if (calcXWeight(mainTxt, false) > 280) {
      showDynamicToast('⚠️ ' + (i + 1) + '行目の投稿が全角140文字（半角280文字）を超えています。短く修正してください。', 'error');
      return;
    }
    validItems.push({ post: mainTxt, selfReplyText: selfRep });
  }

  var btn = document.getElementById('btnSubmitBulkImport');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Importing...'; }
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  var r = await fetch('/api/funnel/bulk-add-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, laneIndex: selectedLane, items: validItems })
  });
  var d = await safeParseApiJson(r);
  if (btn) { btn.disabled = false; btn.innerText = '➕ Import All to Current Lane'; }
  if (!d || !d.ok) {
    showDynamicToast('⚠️ ' + ((d && d.error) || '一括登録に失敗しました'), 'error');
    return;
  }
  ta.value = '';
  toggleBulkImportDrawer();
  showDynamicToast('🎉 Stream Lane #0' + selectedLane + ' に ' + d.addedCount + '件 のテンプレートを一括保存しました！（計 ' + d.totalInLane + ' / 100件）', 'good');
  loadUserCockpitState();
}


function previewPastedTokens() {
  var el = document.getElementById('proTokens');
  var badge = document.getElementById('tokenParsePreviewBadge');
  if (!el || !badge) return;
  var raw = el.value.trim();
  if (!raw) {
    badge.className = 'char-badge';
    badge.innerText = '0 Tokens Detected';
    return;
  }
  var matches = raw.match(/\b[a-fA-F0-9]{40}\b/g) || [];
  var unique = [];
  for (var i = 0; i < matches.length; i++) {
    var t = matches[i].toLowerCase();
    if (unique.indexOf(t) === -1) unique.push(t);
  }
  var existingPrefixes = allAccountsRaw.map(function(a) { return String(a.rawTokenPrefix || '').toLowerCase(); });
  var newCnt = 0;
  var dupCnt = 0;
  for (var j = 0; j < unique.length; j++) {
    if (existingPrefixes.indexOf(unique[j].slice(0, 10)) !== -1) dupCnt++;
    else newCnt++;
  }
  if (unique.length === 0) {
    badge.className = 'char-badge over';
    badge.innerText = '⚠️ No valid 40-char hex auth_token detected';
  } else if (newCnt === 0) {
    badge.className = 'char-badge near';
    badge.innerText = '⚠️ ' + unique.length + ' Tokens Found (All Duplicates)';
  } else {
    badge.className = 'char-badge';
    badge.style.background = '#ECFDF5';
    badge.style.color = '#047857';
    badge.style.borderColor = '#6EE7B7';
    badge.innerText = '✓ Ready to Add: ' + newCnt + ' New' + (dupCnt > 0 ? ' (' + dupCnt + ' Dup Skipped)' : '');
  }
}

function formatNextPostCountdown(laneNo) {
  var laneAccs = allAccountsRaw.filter(function(a) {
    var isBan = (a.role === 'シャドウバン' || a.role === 'ロボット' || a.role === '利用不可' || a.isActive === false);
    return parseInt(a.laneIndex || '1', 10) === laneNo && !isBan;
  });
  if (laneAccs.length === 0) return '<span style="color:#DC2626;">⚠️ No Active accounts</span>';

  var verifiedAccs = laneAccs.filter(function(a) { return a.role === '最新' || a.role === 'ACTIVE'; });
  var standbyCnt = Math.max(0, laneAccs.length - 1);
  var standbyTag = standbyCnt === 0
    ? ' <span style="color:#D97706;font-size:0.72rem;">(0 Standby)</span>'
    : ' <span style="color:#16A34A;font-size:0.72rem;">(' + standbyCnt + ' Standby)</span>';

  if (verifiedAccs.length === 0) {
    return '<span style="color:#D97706;">⏳ Verifying account & Search...</span>' + standbyTag;
  }

  var primary = verifiedAccs[0];
  var nextMs = primary.nextPostAtMs || 0;
  var diffSec = Math.floor((nextMs - Date.now()) / 1000);
  if (!nextMs || diffSec <= 0) {
    return '<span style="color:#2563EB;">🚀 Executing Cycle Now...</span>' + standbyTag;
  }
  var mm = Math.floor(diffSec / 60);
  var ss = diffSec % 60;
  var timeStr = mm > 0 ? (mm + 'm ' + String(ss).padStart(2, '0') + 's') : (ss + 's');
  return '<span style="color:#059669;font-family:\'JetBrains Mono\',monospace;">⏱️ Next: ' + timeStr + '</span>' + standbyTag;
}


var currentHistoryFilterLane = 0;

function getActiveAiReplyLaneNumber() {
  for (var i = 1; i <= 3; i++) {
    if (allLanesConfig[i] && allLanesConfig[i].aiReplyMode === true) return i;
  }
  return 0;
}

function updateAiActiveLaneBadgeUi() {
  var badge = document.getElementById('aiActiveLaneBadge');
  if (!badge) return;
  if (activeTierLevel < 4) {
    badge.style.background = '#F1F5F9';
    badge.style.color = '#64748B';
    badge.style.borderColor = '#CBD5E1';
    badge.innerText = '🔒 AI Reply: Unlocks on $399 Plan (1-Lane Exclusive)';
    return;
  }
  var actLane = getActiveAiReplyLaneNumber();
  if (actLane > 0) {
    var cCode = activeCountries[actLane - 1] || activeCountries[0] || 'US';
    badge.style.background = '#F5F3FF';
    badge.style.color = '#6D28D9';
    badge.style.borderColor = '#C4B5FD';
    badge.innerText = '🤖 AI Reply Active: STREAM LANE #0' + actLane + ' (' + cCode + ' ISP — 1-Lane Exclusive)';
  } else {
    badge.style.background = '#FEF3C7';
    badge.style.color = '#B45309';
    badge.style.borderColor = '#FCD34D';
    badge.innerText = '⏸️ AI Reply: Paused on All Lanes (1-Lane Exclusive)';
  }
}

function insertSpintaxSample(sampleText) {
  var el = document.getElementById('proPostInput');
  if (!el) return;
  var start = el.selectionStart || el.value.length;
  var end = el.selectionEnd || el.value.length;
  el.value = el.value.slice(0, start) + sampleText + el.value.slice(end);
  el.focus();
  updateLiveCharCounters();
}

function previewSpintaxOutput() {
  var el = document.getElementById('proPostInput');
  var out = document.getElementById('spintaxPreviewInline');
  if (!el || !out) return;
  var raw = el.value.trim();
  if (!raw) {
    out.innerText = 'Enter post text above to preview spintax variations.';
    return;
  }
  var resolved = raw.replace(/\{([^{}]+)\}/g, function(_, grp) {
    var opts = grp.split('|');
    return opts[Math.floor(Math.random() * opts.length)];
  });
  out.innerText = '👁️ Sample Output: 「' + resolved.slice(0, 60) + (resolved.length > 60 ? '...' : '') + '」';
}

async function diagnoseaccountAccountNow(accDocId, btnEl) {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (btnEl) { btnEl.disabled = true; btnEl.innerText = '⏳ Auditing...'; }
  showDynamicToast('🔍 実機ブラウザでアカウントの生存・ロック・シャドウバン(リーチ制限)を診断しています(約8〜12秒)...', 'good');
  try {
    var r = await fetch('/api/funnel/diagnose-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, accountId: accDocId })
    });
    var d = await safeParseApiJson(r);
    if (d && d.ok) {
      if (d.role === '最新') {
        showDynamicToast('🟢 診断結果 (@' + (d.username || 'account') + '): ' + d.reason, 'good');
      } else {
        showDynamicToast('🚨 診断結果 (@' + (d.username || 'account') + '): [' + d.role + '] ' + (d.reason || ''), 'error');
      }
    } else {
      showDynamicToast('⚠️ ' + ((d && d.error) || '診断に失敗しました'), 'error');
    }
  } catch (e) {
    showDynamicToast('⚠️ 診断エラー: ' + e.message, 'error');
  }
  loadUserCockpitState();
}

async function promoteaccountToFront(accDocId) {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  await fetch('/api/funnel/promote-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, accountId: accDocId })
  });
  showDynamicToast('⬆️ アカウントをこのレーンの1番手（最前線稼働）にセットしました！', 'good');
  loadUserCockpitState();
}

function filterHistoryByLane(laneNo) {
  currentHistoryFilterLane = laneNo;
  var btns = document.querySelectorAll('.hist-f-btn');
  for (var i = 0; i < btns.length; i++) {
    var bLane = parseInt(btns[i].getAttribute('data-flane') || '0', 10);
    if (bLane === laneNo) {
      btns[i].style.background = '#2563EB';
      btns[i].style.color = '#FFFFFF';
    } else {
      btns[i].style.background = 'transparent';
      btns[i].style.color = '#475569';
    }
  }
  renderFilteredHistoryList();
}

function renderFilteredHistoryList() {
  var hBox = document.getElementById('tenantHistoryItems');
  if (!hBox) return;
  var list = allHistoryRaw.filter(function(h) {
    if (currentHistoryFilterLane === 0) return true;
    return parseInt(h.laneIndex || '1', 10) === currentHistoryFilterLane;
  });
  if (list.length === 0) {
    var emptyMsg = currentHistoryFilterLane === 0
      ? 'No execution history yet.'
      : 'No execution history for Stream Lane #0' + currentHistoryFilterLane + ' yet.';
    if (hBox.innerHTML !== emptyMsg) hBox.innerHTML = emptyMsg;
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var h = list[i];
    var lNo = parseInt(h.laneIndex || '1', 10);
    var isAiRep = String(h.type || '').includes('reply') || String(h.text || '').startsWith('[AI');
    var typeTag = isAiRep
      ? '<span style="background:#F5F3FF;color:#6D28D9;border:1px solid #C4B5FD;padding:2px 7px;border-radius:5px;font-size:0.7rem;font-weight:800;flex-shrink:0;">🤖 AI REPLY</span>'
      : '<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;padding:2px 7px;border-radius:5px;font-size:0.7rem;font-weight:800;flex-shrink:0;">📢 AUTO-POST</span>';
    var agoStr = h.createdAtMs ? formatLastPostedAgo(h.createdAtMs) : '';
    var timeBadge = agoStr ? '<span style="color:#64748B;font-size:0.73rem;font-family:\'JetBrains Mono\',monospace;flex-shrink:0;">' + agoStr + '</span>' : '';
    var uNameDisp = h.username && h.username !== 'account'
      ? '<a href="https://x.com/' + h.username + '" target="_blank" style="font-weight:900;color:#0F172A;text-decoration:none;flex-shrink:0;">@' + h.username + '</a>'
      : '<strong style="flex-shrink:0;">@' + (h.username || 'account') + '</strong>';
    var delStatus = h.deleted ? '<span style="color:#94A3B8;font-weight:700;font-size:0.78rem;">✓ Deleted</span>' :
      (h.deleteReq ? '<span style="color:#D97706;font-weight:800;font-size:0.78rem;">⏳ Deleting...</span>' :
      '<button type="button" class="btn-del-remote" data-hid="' + h.id + '" onclick="requestRemoteDelete(this.dataset.hid)" style="white-space:nowrap;">🗑️ Remote Delete from X</button>');
    html +=
      '<div class="hist-item" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:nowrap;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;min-width:0;">' +
          '<span class="flag-badge" style="flex-shrink:0;">LANE #0' + lNo + '</span>' +
          typeTag +
          timeBadge +
          uNameDisp +
          '<span style="color:#334155;word-break:break-all;">— ' + String(h.text || '') + '</span>' +
          (h.url ? '<a href="' + h.url + '" target="_blank" style="color:#2563EB;font-weight:800;white-space:nowrap;flex-shrink:0;">[Open Link ↗]</a>' : '') +
        '</div>' +
        '<div style="flex-shrink:0;">' + delStatus + '</div>' +
      '</div>';
  }
  if (hBox._lastHtml !== html) {
    hBox.innerHTML = html;
    hBox._lastHtml = html;
  }
}


if (window.location.hash && window.location.hash.includes('lane')) {
  try {
    history.replaceState(null, document.title, location.pathname + location.search);
  } catch (e) {}
}
var selectedLane = 1;
var allLanesConfig = { 1: {}, 2: {}, 3: {} };
var allAccountsRaw = [];
var allPostsRaw = [];
var allHistoryRaw = [];

// 通信レスポンスがHTMLエラーページ(413容量超過・502・404等)だった場合に素人にも分かる日本語理由に変換
async function safeParseApiJson(res) {
  var contentType = (res.headers && res.headers.get('content-type')) || '';
  if (res.status === 413) {
    return { ok: false, error: 'アップロードされた画像データの容量が大きすぎます（上限20MB）。別の画像でお試しください。' };
  }
  if (res.status === 404) {
    return { ok: false, error: '通信先APIが見つかりません（HTTP 404）。ページをリロード（Ctrl+F5）してください。' };
  }
  if (res.status >= 500) {
    return { ok: false, error: 'サーバー側で一時的な処理エラーが発生しました（HTTP ' + res.status + '）。数秒後にもう一度お試しください。' };
  }
  if (!contentType.includes('application/json')) {
    var txt = await res.text().catch(function(){ return ''; });
    if (txt.includes('PayloadTooLarge') || txt.includes('too large')) {
      return { ok: false, error: '画像サイズが大きすぎます。自動的にリサイズするか、小さい画像を選択してください。' };
    }
    return { ok: false, error: 'サーバーから予期しない応答が返されました（ステータス: ' + res.status + '）。ページをリロードしてください。' };
  }
  return await res.json();
}

function selectActiveLane(laneNo) {
  var unlockedStreams = activeTierLevel === 0 ? 0 : (activeTierLevel <= 2 ? 1 : 3);
  if (laneNo > unlockedStreams) {
    var targetPlan = laneNo === 1 ? 'starter' : 'pro';
    openUnlockModal(targetPlan);
    showDynamicToast('🔒 Stream Lane #0' + laneNo + ' は Agency Pro ($179) 以上で解放されます！', 'good');
    return;
  }
  selectedLane = laneNo;
  window._bioDirty = false;
  window._aiKwDirty = false;
  window._aiCampDirty = false;
  renderStreamLanes(activeTierLevel);
  applySelectedLaneToFormUi();
  renderActiveLaneTerminal();
  pollLaneTerminalLogs();
  var cCode = activeCountries[laneNo - 1] || activeCountries[0] || 'US';
  showDynamicToast('🎯 操作対象を「🚀 STREAM LANE #0' + laneNo + ' (' + cCode + ' Static ISP #' + laneNo + ')」に切り替えました！', 'good');
  var barEl = document.getElementById('activeLaneWorkspaceBar');
  if (barEl) barEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function applySelectedLaneToFormUi() {
  var cCode = activeCountries[selectedLane - 1] || activeCountries[0] || 'US';
  var titleEl = document.getElementById('activeLaneTitleText');
  if (titleEl) {
    titleEl.innerText = 'Currently Editing: 🚀 STREAM LANE #0' + selectedLane + ' (🌍 ' + cCode + ' Static ISP #' + selectedLane + ')';
  }
  var pillBox = document.getElementById('lanePillTabsBox');
  if (pillBox) {
    var unlockedStreams = activeTierLevel === 0 ? 0 : (activeTierLevel <= 2 ? 1 : 3);
    var pHtml = '';
    for (var i = 1; i <= 3; i++) {
      var lc = activeCountries[i - 1] || activeCountries[0] || 'US';
      var isLocked = i > unlockedStreams;
      var cls = 'lane-pill-tab' + (i === selectedLane ? ' active' : '');
      pHtml += '<button type="button" class="' + cls + '" onclick="selectActiveLane(' + i + ')">' +
        (isLocked ? '🔒' : '🚀') + ' Lane #0' + i + ' (' + lc + ')' +
      '</button>';
    }
    pillBox.innerHTML = pHtml;
  }

  var lCfg = allLanesConfig[selectedLane] || {};
  var bioInp = document.getElementById('proBioInput');
  if (bioInp && !window._bioDirty && document.activeElement !== bioInp) {
    bioInp.value = typeof lCfg.profileBio === 'string' ? lCfg.profileBio : '';
  }
  var kwInp = document.getElementById('proAiKeywords');
  if (kwInp && !window._aiKwDirty && document.activeElement !== kwInp) {
    kwInp.value = typeof lCfg.aiKeywords === 'string' ? lCfg.aiKeywords : '';
  }

  // AIウィザードの Q1(商品) / Q2(URL) / 投稿言語 / Q3(スタンス) を現在選択中のレーン設定と同期
  if (!window._aiCampDirty) {
    var prodEl = document.getElementById('aiCampProductInput');
    var urlEl = document.getElementById('aiCampUrlInput');
    var langEl = document.getElementById('aiCampLangSelect');
    if (prodEl && document.activeElement !== prodEl) prodEl.value = lCfg.aiProductDesc || '';
    if (urlEl && document.activeElement !== urlEl) urlEl.value = lCfg.aiAffiliateUrl || '';
    if (langEl && document.activeElement !== langEl && lCfg.aiTargetLang) langEl.value = lCfg.aiTargetLang;
    if (lCfg.aiBattleMode) {
      selectAiBattleStance(lCfg.aiBattleMode, true);
    }
  }

  dualModes.autopost = (lCfg.autoPostMode !== false);
  dualModes.aireply = !!lCfg.aiReplyMode;
  renderAiDualEngineCard(activeTierLevel);

  selectedInterval = lCfg.postIntervalMin || 15;
  selectWizardInterval(selectedInterval);
  selectWizardReplyMode(dualModes.aireply);

  var pills = document.querySelectorAll('.int-pill');
  var intVals = [5, 15, 30, 60, 120];
  for (var k = 0; k < pills.length; k++) {
    if (intVals[k] === selectedInterval) pills[k].classList.add('active');
    else pills[k].classList.remove('active');
  }

  updatePostSelectionModeUi(lCfg.postSelectionMode || 'loop');
  updateEngineLiveBarUi(lCfg.isEngineRunning !== false);
  updateLiveCharCounters();

  var laneAccounts = allAccountsRaw.filter(function(a) { return (parseInt(a.laneIndex || '1', 10)) === selectedLane; });
  var lanePosts = allPostsRaw.filter(function(p) { return (parseInt(p.laneIndex || '1', 10)) === selectedLane; });
  cachedUserPosts = lanePosts;

  var accBox = document.getElementById('tenantAccountsList');
  var cntSum = document.getElementById('accountCountSummary');
  var depletedBanner = document.getElementById('accountDepletedWarningBanner');
  var maxPerLane = activeTierLevel === 1 ? 3 : (activeTierLevel === 2 ? 10 : (activeTierLevel === 3 ? 10 : 16));

  var healthyInLane = laneAccounts.filter(function(a) {
    var isBan = (a.role === 'シャドウバン' || a.role === 'ロボット' || a.role === '利用不可' || a.isActive === false);
    return !isBan;
  });

  if (cntSum) {
    cntSum.innerText = 'Lane #0' + selectedLane + ': ' + laneAccounts.length + ' / ' + maxPerLane + ' accounts (' + healthyInLane.length + ' Active)';
  }

  if (depletedBanner) {
    if (laneAccounts.length > 0 && healthyInLane.length === 0) {
      depletedBanner.style.display = 'block';
      depletedBanner.innerHTML = '⚠️ <strong>現在このレーンで通常投稿できる無傷アカウントが0件（全て SWAPPED 状態）です。</strong><br>' +
        '・新しい <code>auth_token</code> を上の入力欄から追加するか、48〜72時間経過したアカウントの <strong>[🔍 Diagnose（再診断）]</strong> または <strong>[⬆️ Promote #1（強制復帰）]</strong> を押してください。<br>' +
        '・※なお、AI返信モード（ON）では、サーチバン中のアカウントも「見込み客への1対1通知スナイパー」として自動活用されます。';
    } else {
      depletedBanner.style.display = 'none';
    }
  }

  if (accBox) {
    if (laneAccounts.length === 0) {
      accBox.innerHTML = 'No account accounts registered in <strong>Stream Lane #0' + selectedLane + '</strong> yet. Paste 40-char auth_tokens above and click Add.';
    } else {
      var aHtml = '';
      for (var a = 0; a < laneAccounts.length; a++) {
        var acc = laneAccounts[a];
        var roleBadge = '<span style="background:#FEF3C7;color:#B45309;padding:3px 9px;border-radius:999px;font-weight:800;font-size:0.74rem;">⏳ VERIFYING</span>';
        if (acc.role === '最新') roleBadge = '<span style="background:#DCFCE7;color:#15803D;padding:3px 9px;border-radius:999px;font-weight:800;font-size:0.74rem;">🟢 ACTIVE' + (a === 0 ? ' (#1 PRIMARY)' : ' / STANDBY') + '</span>';
        else if (acc.role === 'シャドウバン' || acc.role === 'ロボット' || acc.role === '利用不可') roleBadge = '<span style="background:#FEE2E2;color:#991B1B;padding:3px 9px;border-radius:999px;font-weight:800;font-size:0.74rem;">🚨 SWAPPED (' + acc.role + ')</span>';
        aHtml += '<div class="hist-item" style="background:#FFFFFF;">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<span class="flag-badge">LANE #0' + selectedLane + '</span>' +
            roleBadge +
            (acc.username
              ? '<a href="https://x.com/' + acc.username + '" target="_blank" style="font-weight:900;color:#1D4ED8;text-decoration:none;">@' + acc.username + ' ↗</a>'
              : '<strong>Token: ' + acc.authToken + '</strong>') +
            '<span style="color:#64748B;font-size:0.76rem;">Posts: ' + (acc.postCount || 0) + ' &nbsp;|&nbsp; Last: ' + formatLastPostedAgo(acc.lastPostedAtMs) + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button type="button" class="btn-acc-action" onclick="diagnoseaccountAccountNow(\'' + acc.id + '\', this)" title="実機ブラウザで生存・シャドウバン解除を即時診断">🔍 Diagnose</button>' +
            '<button type="button" class="btn-acc-action" onclick="promoteaccountToFront(\'' + acc.id + '\')" title="このアカウントを1番手(ACTIVE)として最前線に復帰">⬆️ Promote #1</button>' +
            '<button type="button" class="btn-del-remote" data-aid="' + acc.id + '" onclick="deleteaccountAccount(this.dataset.aid)">Remove</button>' +
          '</div>' +
        '</div>';
      }
      accBox.innerHTML = aHtml;
    }
  }

  var pBox = document.getElementById('tenantPostsList');
  var pBadge = document.getElementById('postTemplatesCountBadge');
  var enabledCnt = lanePosts.filter(function(x){ return x.isEnabled !== false; }).length;
  if (pBadge) pBadge.innerText = 'Lane #0' + selectedLane + ': ' + lanePosts.length + ' / 100 Saved (' + enabledCnt + ' Active)';
  if (pBox) {
    if (lanePosts.length === 0) {
      pBox.innerHTML = 'No post templates saved in <strong>Stream Lane #0' + selectedLane + '</strong> yet.';
    } else {
      var pHtml = '';
      for (var p = 0; p < lanePosts.length; p++) {
        var po = lanePosts[p];
        var isEn = (po.isEnabled !== false);
        var toggleBtn = isEn
          ? '<button type="button" onclick="togglePostTemplateEnabled(\'' + po.id + '\', false)" style="background:#DCFCE7;color:#15803D;border:1px solid #86EFAC;padding:5px 11px;border-radius:8px;font-weight:800;font-size:0.74rem;cursor:pointer;">🟢 ENABLED</button>'
          : '<button type="button" onclick="togglePostTemplateEnabled(\'' + po.id + '\', true)" style="background:#E2E8F0;color:#475569;border:1px solid #CBD5E1;padding:5px 11px;border-radius:8px;font-weight:800;font-size:0.74rem;cursor:pointer;">⏸️ PAUSED</button>';
        pHtml += '<div class="hist-item" style="' + (isEn ? '' : 'opacity:0.6;background:#F1F5F9;') + '">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;">' +
            '<span class="flag-badge">L' + selectedLane + '-#' + String(p + 1).padStart(2, '0') + '</span>' +
            toggleBtn +
            (po.imageUrl ? '<img src="' + po.imageUrl + '" onerror="this.style.display=\'none\'" style="height:36px;width:36px;object-fit:cover;border-radius:6px;border:1px solid #CBD5E1;" />' : '') +
            '<span style="font-weight:600;color:#0F172A;">' + String(po.text || '').slice(0, 85) + '</span>' +
            (po.selfReplyText ? '<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;padding:2px 8px;border-radius:6px;font-size:0.72rem;font-weight:800;">💬 Self-Reply: ' + String(po.selfReplyText).slice(0, 28) + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<button type="button" title="1つ上へ移動" onclick="reorderPostTemplate(\'' + po.id + '\', \'up\')" style="background:#F8FAFC;color:#334155;border:1px solid #CBD5E1;padding:5px 8px;border-radius:7px;font-weight:900;font-size:0.72rem;cursor:pointer;">⬆️</button>' +
            '<button type="button" title="1つ下へ移動" onclick="reorderPostTemplate(\'' + po.id + '\', \'down\')" style="background:#F8FAFC;color:#334155;border:1px solid #CBD5E1;padding:5px 8px;border-radius:7px;font-weight:900;font-size:0.72rem;cursor:pointer;">⬇️</button>' +
            '<button type="button" onclick="startEditPostTemplate(\'' + po.id + '\')" style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;padding:6px 12px;border-radius:8px;font-weight:800;font-size:0.75rem;cursor:pointer;">✏️ Edit</button>' +
            '<button type="button" class="btn-del-remote" data-pid="' + po.id + '" onclick="deletePostTemplate(this.dataset.pid)">🗑️ Delete</button>' +
          '</div>' +
        '</div>';
      }
      pBox.innerHTML = pHtml;
    }
  }
}

var editingPostId = '';
var cachedUserPosts = [];
var isEngineCurrentlyRunning = true;

function syncModalPlanCardsWithCurrentTier() {
  var banner = document.getElementById('currentPlanModalBanner');
  var bannerTxt = document.getElementById('currentPlanModalText');
  var tierNames = {
    0: 'Lv.0 Free Member (No Active Subscription)',
    1: 'Lv.1 — 24h Test Drive ($7)',
    2: 'Lv.2 — Solo Starter ($79)',
    3: 'Lv.3 — Agency Pro ($179)',
    4: 'Lv.4 — AI Autopilot Pro ($399)'
  };
  if (banner && bannerTxt) {
    banner.classList.add('show');
    if (activeTierLevel > 0) {
      bannerTxt.innerHTML = '🟢 Current Active Plan: <strong>' + (tierNames[activeTierLevel] || 'Active') + '</strong> &nbsp;|&nbsp; Bound ISPs: <strong>' + activeCountries.join(', ') + '</strong>';
    } else {
      bannerTxt.innerHTML = '🔓 Current Status: <strong>Lv.0 Free Member</strong> — Choose an edition below to unlock your cockpit';
    }
  }

  var ids = ['oneday', 'starter', 'pro', 'business'];
  for (var i = 0; i < ids.length; i++) {
    var pid = ids[i];
    var meta = PLAN_META[pid];
    var card = document.getElementById('pcard_' + pid);
    var btn = document.getElementById('pbtn_' + pid);
    if (!card || !btn || !meta) continue;

    // 既存の現在プランバッジを削除して再付与
    var oldTag = card.querySelector('.cur-plan-tag');
    if (oldTag) oldTag.parentNode.removeChild(oldTag);
    card.classList.remove('current-plan-card');
    btn.classList.remove('is-current', 'is-upgrade', 'is-downgrade');

    if (activeTierLevel > 0 && meta.tier === activeTierLevel) {
      card.classList.add('current-plan-card');
      var tag = document.createElement('div');
      tag.className = 'cur-plan-tag';
      tag.innerText = '🟢 CURRENT PLAN';
      card.appendChild(tag);
      btn.classList.add('is-current');
      btn.innerText = (currentPlanId === pid) ? '✓ Selected (Current Plan)' : '✓ Current Plan (Extend / ISP)';
    } else if (meta.tier > activeTierLevel) {
      btn.classList.add('is-upgrade');
      var dispPrice = (activeTierLevel === 1 && meta.tier >= 2) ? ('$' + (meta.usd - 7) + ' (-$7 Credit)') : ('$' + meta.usd);
      btn.innerText = (currentPlanId === pid)
        ? ('✓ Selected Upgrade (' + dispPrice + ')')
        : (activeTierLevel > 0 ? ('🚀 Upgrade (' + dispPrice + ')') : ('Select Plan ($' + meta.usd + ')'));
    } else {
      btn.classList.add('is-downgrade');
      btn.innerText = (currentPlanId === pid)
        ? ('✓ Selected Downgrade ($' + meta.usd + ')')
        : ('↘ Downgrade ($' + meta.usd + ')');
    }
  }
}

function startEditPostTemplate(postId) {
  var found = null;
  for (var i = 0; i < cachedUserPosts.length; i++) {
    if (cachedUserPosts[i].id === postId) { found = cachedUserPosts[i]; break; }
  }
  if (!found) return;
  editingPostId = postId;
  var pIn = document.getElementById('proPostInput');
  var sIn = document.getElementById('proSelfReplyInput');
  var iIn = document.getElementById('proImageUrlInput');
  var btn = document.getElementById('btnAddPostOnly');
  if (pIn) { pIn.value = found.text || ''; pIn.focus(); }
  if (sIn) sIn.value = found.selfReplyText || '';
  if (iIn) iIn.value = found.imageUrl || '';
  if (btn) {
    btn.style.background = '#FEF3C7';
    btn.style.color = '#B45309';
    btn.style.borderColor = '#F59E0B';
    btn.innerText = '💾 Update Template #' + (cachedUserPosts.indexOf(found) + 1) + ' (Click to Save Changes)';
  }
  updateLiveCharCounters();
  showDynamicToast('✏️ Editing Template #' + (cachedUserPosts.indexOf(found) + 1) + ' — Modify text above and click Update!', 'good');
}

async function bulkTogglePosts(enableAll) {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (!uid) return;
  await fetch('/api/funnel/bulk-toggle-posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, laneIndex: selectedLane, isEnabled: enableAll })
  });
  showDynamicToast(enableAll ? '🟢 All post templates enabled!' : '⏸️ All post templates paused.', 'good');
  loadUserCockpitState();
}

function updateEngineLiveBarUi(running) {
  isEngineCurrentlyRunning = !!running;
  var bar = document.getElementById('engineLiveBar');
  var dot = document.getElementById('engineLiveDot');
  var title = document.getElementById('engineLiveTitle');
  var sub = document.getElementById('engineLiveSub');
  var btn = document.getElementById('btnToggleEngineRun');
  if (!bar || !title || !btn) return;
  if (isEngineCurrentlyRunning) {
    bar.className = 'engine-live-bar';
    if (dot) dot.style.background = '#10B981';
    title.innerText = '🟢 24/7 Cloud Autopilot Engine: ACTIVE & RUNNING';
    if (sub) sub.innerText = 'Executing scheduled human-typed posts (' + selectedInterval + 'm interval) & AI target radar automatically.';
    btn.innerText = '⏸️ Pause Autopilot';
    btn.style.color = '#065F46';
  } else {
    bar.className = 'engine-live-bar paused';
    if (dot) dot.style.background = '#F59E0B';
    title.innerText = '⏸️ 24/7 Cloud Autopilot Engine: PAUSED';
    if (sub) sub.innerText = 'All streams are currently paused. Click Resume below to restart 24/7 automation.';
    btn.innerText = '▶️ Resume Autopilot';
    btn.style.color = '#92400E';
  }
}

async function toggleEngineRunState() {
  if (activeTierLevel === 0) return openUnlockModal('starter');
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  var nextRun = !isEngineCurrentlyRunning;
  updateEngineLiveBarUi(nextRun);
  await fetch('/api/funnel/toggle-engine-running', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, laneIndex: selectedLane, isRunning: nextRun })
  });
  showDynamicToast(nextRun ? '🟢 24/7 Cloud Autopilot resumed!' : '⏸️ 24/7 Cloud Autopilot paused.', 'good');
}


// X (Twitter) 公式文字数ウェイト計算: 半角=1, 全角=2, URL=一律23 (上限280ウェイト = 全角140文字)
function calcXWeight(rawStr, stripUrlForSelfReply) {
  if (!rawStr) return 0;
  // スピン構文 {A|B} がある場合は最も長い選択肢で計算
  var expanded = String(rawStr).replace(/\{([^{}]+)\}/g, function(_, grp) {
    var parts = grp.split('|');
    parts.sort(function(a, b) { return b.length - a.length; });
    return parts[0] || '';
  });
  var urlRegex = /https?:\/\/[^\s]+/g;
  var urls = expanded.match(urlRegex) || [];
  var textWithoutUrls = expanded.replace(urlRegex, '').trim();
  var weight = 0;
  for (var i = 0; i < textWithoutUrls.length; i++) {
    var code = textWithoutUrls.charCodeAt(i);
    // ASCII範囲 (0x0000 - 0x00FF) 等は半角(1)、日本語・絵文字等は全角(2)
    weight += (code >= 0 && code <= 255) ? 1 : 2;
  }
  if (!stripUrlForSelfReply) {
    weight += urls.length * 23;
  }
  return weight;
}

function updateLiveCharCounters() {
  var postEl = document.getElementById('proPostInput');
  var postBadge = document.getElementById('postCharBadge');
  var autoSplit = document.getElementById('autoExtractUrlChk') ? document.getElementById('autoExtractUrlChk').checked : false;
  if (postEl && postBadge) {
    evaluatePostAntiBanSafety(postEl.value);
    var w = calcXWeight(postEl.value, autoSplit);
    var cjk = Math.ceil(w / 2);
    if (w > 280) {
      var overW = w - 280;
      postBadge.className = 'char-badge over';
      postBadge.innerText = '⚠️ Over Limit: ' + w + ' / 280 Weight (-' + overW + ')';
    } else if (w >= 240) {
      postBadge.className = 'char-badge near';
      postBadge.innerText = w + ' / 280 Weight (' + cjk + ' / 140 CJK)';
    } else {
      postBadge.className = 'char-badge';
      postBadge.innerText = w + ' / 280 Weight (' + cjk + ' / 140 CJK)';
    }
  }

  var bioEl = document.getElementById('proBioInput');
  var bioBadge = document.getElementById('bioCharBadge');
  if (bioEl && bioBadge) {
    var bw = calcXWeight(bioEl.value, false);
    var bCjk = Math.ceil(bw / 2);
    if (bw > 160) {
      var bOver = bw - 160;
      bioBadge.className = 'char-badge over';
      bioBadge.innerText = '⚠️ BIO Over Limit: ' + bw + ' / 160 (-' + bOver + ')';
    } else {
      bioBadge.className = 'char-badge';
      bioBadge.innerText = bw + ' / 160 Weight (' + bCjk + ' / 80 CJK)';
    }
  }
}


var currentPostSelectionMode = 'loop';

function updatePostSelectionModeUi(mode) {
  currentPostSelectionMode = (mode === 'random') ? 'random' : 'loop';
  var bLoop = document.getElementById('modeBtnLoop');
  var bRand = document.getElementById('modeBtnRandom');
  if (!bLoop || !bRand) return;
  if (currentPostSelectionMode === 'loop') {
    bLoop.style.background = '#2563EB'; bLoop.style.color = '#FFFFFF';
    bRand.style.background = 'transparent'; bRand.style.color = '#475569';
  } else {
    bRand.style.background = '#2563EB'; bRand.style.color = '#FFFFFF';
    bLoop.style.background = 'transparent'; bLoop.style.color = '#475569';
  }
}

async function setPostSelectionMode(mode) {
  updatePostSelectionModeUi(mode);
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (!uid) return;
  await fetch('/api/funnel/update-post-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, laneIndex: selectedLane, postSelectionMode: currentPostSelectionMode })
  });
  showDynamicToast(currentPostSelectionMode === 'loop'
    ? '🔄 Post Mode: Sequential Loop (#1 -> #2 -> #3 in order)'
    : '🎲 Post Mode: Random Pick (Randomly selected from enabled posts)', 'good');
}

async function togglePostTemplateEnabled(postId, makeEnabled) {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  if (!uid) return;
  await fetch('/api/funnel/toggle-post-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, postId: postId, isEnabled: makeEnabled })
  });
  showDynamicToast(makeEnabled ? '🟢 Post template enabled!' : '⏸️ Post template paused (skipped during auto-posting).', 'good');
  loadUserCockpitState();
}

async function addPostTemplateOnly() {
  if (activeTierLevel === 0) return openUnlockModal('starter');
  var rawPost = (document.getElementById('proPostInput') ? document.getElementById('proPostInput').value : '').trim();
  var selfReply = (document.getElementById('proSelfReplyInput') ? document.getElementById('proSelfReplyInput').value : '').trim();
  var autoSplit = document.getElementById('autoExtractUrlChk') ? document.getElementById('autoExtractUrlChk').checked : false;

  if (!rawPost) {
    showDynamicToast('⚠️ 投稿テキストを入力してから保存ボタンを押してください。', 'error');
    return;
  }

  // 本文内にURLがあり、「本文内URLも自動で自己リプへ分離」がONなら自動分離
  var finalMainText = rawPost;
  var finalSelfReply = selfReply;
  if (autoSplit) {
    var urlMatches = rawPost.match(/https?:\/\/[^\s]+/g);
    if (urlMatches && urlMatches.length > 0) {
      finalMainText = rawPost.replace(/https?:\/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim();
      if (!finalSelfReply) {
        finalSelfReply = urlMatches.join(' ');
      }
      if (!finalMainText) {
        finalMainText = '👇';
      }
    }
  }

  var weight = calcXWeight(finalMainText, false);
  if (weight > 280) {
    var zenkaku = Math.ceil(weight / 2);
    var overChars = zenkaku - 140;
    showDynamicToast('⚠️ 文字数オーバーです！Xの仕様上、全角140文字（半角280文字）以内に収めてください（現在: 全角換算 ' + zenkaku + '文字 / ' + overChars + '文字超過）', 'error');
    return;
  }

  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  var btn = document.getElementById('btnAddPostOnly');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Saving...'; }

  try {
    var apiEndpoint = editingPostId ? '/api/funnel/edit-post-template' : '/api/funnel/add-post-template';
    var res = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        laneIndex: selectedLane,
        postId: editingPostId,
        post: finalMainText,
        selfReplyText: finalSelfReply,
        imageBase64: uploadedImageBase64,
        imageUrl: (document.getElementById('proImageUrlInput') ? document.getElementById('proImageUrlInput').value.trim() : '')
      })
    });
    var d = await safeParseApiJson(res);
    if (btn) { btn.disabled = false; btn.innerText = '➕ Save Post to Template Vault (Up to 100 Patterns)'; }
    if (!d || !d.ok) {
      showDynamicToast('⚠️ ' + ((d && d.error) || 'Could not save template'), 'error');
      return;
    }
    document.getElementById('proPostInput').value = '';
    if (document.getElementById('proSelfReplyInput')) document.getElementById('proSelfReplyInput').value = '';
    uploadedImageBase64 = '';
    if (document.getElementById('proImagePreviewWrap')) document.getElementById('proImagePreviewWrap').style.display = 'none';
    if (document.getElementById('proImageFile')) document.getElementById('proImageFile').value = '';
    if (document.getElementById('proImageUrlInput')) document.getElementById('proImageUrlInput').value = '';
    updateLiveCharCounters();
    var wasEdit = !!editingPostId;
    editingPostId = '';
    if (btn) {
      btn.style.background = '#EFF6FF';
      btn.style.color = '#1D4ED8';
      btn.style.borderColor = '#2563EB';
      btn.innerText = '➕ Save Post to Template Vault (Up to 100 Patterns)';
    }
    showDynamicToast(wasEdit ? '✅ テンプレートの上書き編集を保存しました！' : ('✅ 投稿テンプレートを新規保存しました！ (' + (d.totalCount || 1) + ' / 100)' + (finalSelfReply ? ' [💬自己リプライURL付き]' : '')), 'good');
    loadUserCockpitState();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerText = '➕ Save Post to Template Vault (Up to 100 Patterns)'; }
    showDynamicToast('⚠️ Connection errorが発生しました: ' + e.message, 'error');
  }
}


var uploadedImageBase64 = '';

function handleProImageSelect(fileInput) {
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  var file = fileInput.files[0];
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
    showDynamicToast('⚠️ エラー：対応していないファイル形式（' + (file.type || '不明') + '）です。PNG / JPG / WEBP / GIF の画像ファイルを選択してください！', 'error');
    fileInput.value = '';
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showDynamicToast('⚠️ エラー：画像ファイルが大きすぎます（現在: ' + (file.size / 1048576).toFixed(1) + 'MB / 上限: 20MB）。もう少し小さい画像を選択してください！', 'error');
    fileInput.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onerror = function() {
    showDynamicToast('⚠️ エラー：画像ファイルの読み込みに失敗しました。別のファイルを選択してください。', 'error');
  };
  reader.onload = function(e) {
    var rawDataUrl = e.target.result;
    // 自動リサイズ・軽量化 (横幅1600px以内に最適化してConnection errorを100%防ぐ)
    var imgObj = new Image();
    imgObj.onload = function() {
      try {
        var maxW = 1600;
        var w = imgObj.width;
        var h = imgObj.height;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(imgObj, 0, 0, w, h);
        uploadedImageBase64 = canvas.toDataURL('image/jpeg', 0.88);
      } catch (err) {
        uploadedImageBase64 = rawDataUrl;
      }
      var wrap = document.getElementById('proImagePreviewWrap');
      var img = document.getElementById('proImagePreviewEl');
      var badge = document.getElementById('proImageReadyBadge');
      if (wrap && img) {
        img.src = uploadedImageBase64;
        wrap.style.display = 'flex';
      }
      if (badge) badge.style.display = 'inline';
      showDynamicToast('📸 画像を最適化して添付しました！（投稿ごとに明度±1%自動変調されます）', 'good');
    };
    imgObj.onerror = function() {
      showDynamicToast('⚠️ エラー：壊れているか非対応の画像データです。別のPNG/JPG画像を選択してください。', 'error');
    };
    imgObj.src = rawDataUrl;
  };
  reader.readAsDataURL(file);
}

function copyCockpitRefLink() {
  var inp = document.getElementById('myCockpitRefUrl');
  if (!inp) return;
  navigator.clipboard.writeText(inp.value).then(function() {
    showDynamicToast('Referral link copied.', 'good');
  }).catch(function() {
    inp.select();
    document.execCommand('copy');
    showDynamicToast('Referral link copied.', 'good');
  });
}

async function deleteaccountAccount(accDocId) {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  await fetch('/api/funnel/delete-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, accountId: accDocId })
  });
  showDynamicToast('🗑️ account account removed from queue.', 'good');
  loadUserCockpitState();
}

async function deletePostTemplate(postDocId) {
  var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
  await fetch('/api/funnel/delete-post-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, postId: postDocId })
  });
  showDynamicToast('🗑️ Post template removed.', 'good');
  loadUserCockpitState();
}

// ========================================================================
    // 10-LANGUAGE STYLISH TRANSLATION ENGINE (Google Translate Bridge + Cookie)
    // ========================================================================
    function toggleLangMenu(e) {
      if (e) e.stopPropagation();
      var menu = document.getElementById('langMenuPop');
      if (menu) menu.classList.toggle('open');
    }
    document.addEventListener('click', function() {
      var menu = document.getElementById('langMenuPop');
      if (menu) menu.classList.remove('open');
    });

    if (!localStorage.getItem('xsw_email')) {
      localStorage.removeItem('xsw_tier_level');
      localStorage.removeItem('xsw_pro_unlocked');
    }

    var urlRef = (new URLSearchParams(window.location.search)).get('ref');
    if (urlRef && /^XSW-[A-Z0-9]+$/i.test(urlRef)) {
      localStorage.setItem('xsw_ref', urlRef.toUpperCase());
      document.cookie = 'xswarm_ref=' + encodeURIComponent(urlRef.toUpperCase()) + '; path=/; max-age=' + (30*86400) + '; SameSite=Lax';
    }

    // Hero Self-Typing Animation (VeloxPost Cloud 4.0 公式仕様)
    var DEMO_PHRASES = [
      'Official X API. No automatic likes, follows, or replies.',
      'Only facts written on the registered page.',
      'The next post is checked before it is sent.'
    ];
    var phraseIdx = 0;
    var charIdx = 0;
    var impCount = 154290;

    setInterval(function() {
      var el = document.getElementById('stageTypedText');
      var spd = document.getElementById('stageKeySpeed');
      if (!el) return;
      var currentStr = DEMO_PHRASES[phraseIdx];
      if (charIdx <= currentStr.length) {
        el.innerText = currentStr.slice(0, charIdx);
        charIdx++;
        if (spd) spd.innerText = (28 + Math.floor(Math.random() * 45)) + 'ms';
      } else {
        charIdx = 0;
        phraseIdx = (phraseIdx + 1) % DEMO_PHRASES.length;
      }
    }, 75);

    setInterval(function() {
      var impEl = document.getElementById('stageImpCounter');
      if (impEl) {
        impCount += Math.floor(Math.random() * 85) + 12;
        impEl.innerText = impCount.toLocaleString();
      }
    }, 1500);

    var COUNTRIES = [
      { code: 'US', flag: '<img src="https://flagcdn.com/w20/us.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="US">', name: 'United States (US)' },
      { code: 'JP', flag: '<img src="https://flagcdn.com/w20/jp.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="JP">', name: 'Japan (JP)' },
      { code: 'GB', flag: '<img src="https://flagcdn.com/w20/gb.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="GB">', name: 'United Kingdom (GB)' },
      { code: 'DE', flag: '<img src="https://flagcdn.com/w20/de.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="DE">', name: 'Germany (DE)' },
      { code: 'NL', flag: '<img src="https://flagcdn.com/w20/nl.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="NL">', name: 'Netherlands (NL)' },
      { code: 'CA', flag: '<img src="https://flagcdn.com/w20/ca.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="CA">', name: 'Canada (CA)' },
      { code: 'AU', flag: '<img src="https://flagcdn.com/w20/au.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="AU">', name: 'Australia (AU)' },
      { code: 'SG', flag: '<img src="https://flagcdn.com/w20/sg.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="SG">', name: 'Singapore (SG)' },
      { code: 'HK', flag: '<img src="https://flagcdn.com/w20/hk.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="HK">', name: 'Hong Kong (HK)' },
      { code: 'TW', flag: '<img src="https://flagcdn.com/w20/tw.png" style="width:18px;border-radius:2px;vertical-align:middle;margin-right:4px;" alt="TW">', name: 'Taiwan (TW)' }
    ];

    var PLAN_META = {
      starter:   { id: 'starter',   tier: 1, name: 'Solo Starter (¥4,980 / 月・14日間無料)',      nameEn: 'Solo Starter ($39 / mo - 14-Day Trial)',      displayName: 'Solo Starter', displayNameEn: 'Solo Starter', usd: 39,  jpy: 4980,  accounts: 5 },
      pro:       { id: 'pro',       tier: 2, name: 'Agency Pro (¥9,800 / 月・14日間無料)',       nameEn: 'Agency Pro ($79 / mo - 14-Day Trial)',       displayName: 'Agency Pro', displayNameEn: 'Agency Pro', usd: 79,  jpy: 9800, accounts: 12 },
      business:  { id: 'business',  tier: 4, name: 'Syndicate Business (¥19,800 / 月・14日間無料)', nameEn: 'Syndicate Business ($179 / mo - 14-Day Trial)', displayName: 'Syndicate Business', displayNameEn: 'Syndicate Business', usd: 179, jpy: 19800, accounts: 25 }
    };

    var currentAuthMode = 'register';
    var loggedInEmail = '';
    var pendingCheckoutMethod = '';
    var currentPlanId = '';
    var pickedCountries = [];
    var currentOrderId = localStorage.getItem('xsw_active_order_id') || '';
    var activeTierLevel = 0;
    var activeCountries = ['US'];
    var selectedInterval = 15;
    var dualModes = { autopost: true, aireply: true };

    function showDynamicToast(msg, type) {
      var wrap = document.getElementById('dynToastWrap');
      var el = document.createElement('div');
      el.className = 'dyn-toast ' + (type === 'error' ? 'error' : 'good');
      el.innerHTML = '<span>' + msg + '</span>';
      wrap.innerHTML = '';
      wrap.appendChild(el);
      setTimeout(function() {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 4300);
    }

    function syncViewByAuthStatus() {
      var guestView = document.getElementById('guestShowcaseView');
      var cockpitView = document.getElementById('memberCockpitView');
      var authBtn = document.getElementById('topAuthBtn');
      var navLinks = document.getElementById('navGuestLinks');
      var dashBtn = document.getElementById('topDashboardBtn');
      var topUnl = document.getElementById('topUnlockBtn');

      // Strip any legacy #lane hash immediately
      if (window.location.hash && window.location.hash.includes('lane')) {
        try {
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', location.pathname + location.search);
          }
        } catch (e) {}
      }

      // Guest showcase LP is ALWAYS visible so users can freely browse the top page!
      if (guestView) guestView.style.display = 'block';

      if (loggedInEmail) {
        // === ログイン状態: トップページを自由に閲覧しつつ、ヘッダーにダッシュボードリンクを表示 ===
        if (navLinks) navLinks.style.display = '';
        if (dashBtn) {
          dashBtn.style.display = 'inline-flex';
          dashBtn.style.alignItems = 'center';
          dashBtn.style.gap = '6px';
          dashBtn.innerHTML = (window.currentLandingLang === 'en') ? '🚀 Dashboard' : '🚀 ダッシュボード';
        }
        if (authBtn) {
          authBtn.style.display = 'none';
          authBtn.onclick = function() { openAuthModal('login'); };
          authBtn.title = '';
        }
        if (topUnl) {
          topUnl.style.display = 'inline-block';
          topUnl.innerText = (window.currentLandingLang === 'en') ? '🚪 Log Out' : '🚪 ログアウト';
          topUnl.style.background = '#F1F5F9';
          topUnl.style.color = '#475569';
          topUnl.style.borderColor = '#CBD5E1';
          topUnl.onclick = function() { logoutAccount(); };
        }
      } else {
        // === ログアウト（未ログイン）状態 ===
        if (guestView) guestView.style.display = 'block';
        if (cockpitView) {
          cockpitView.style.setProperty('display', 'none', 'important');
          cockpitView.classList.remove('active-view');
        }
        // === 未ログイン状態 ===
        if (navLinks) navLinks.style.display = '';
        if (dashBtn) dashBtn.style.display = 'none';
        if (authBtn) {
          authBtn.style.display = 'inline-block';
          authBtn.style.background = '#FFFFFF';
          authBtn.style.color = '#111827';
          authBtn.style.borderColor = '#D1D5DB';
          authBtn.innerText = (window.currentLandingLang === 'en') ? 'Log In' : 'ログイン';
          authBtn.onclick = function() { openAuthModal('login'); };
          authBtn.title = '';
        }
        if (topUnl) {
          topUnl.style.display = 'inline-block';
          topUnl.innerText = (window.currentLandingLang === 'en') ? 'Get Started' : '新規登録';
          topUnl.style.background = '';
          topUnl.style.color = '';
          topUnl.style.borderColor = '';
          topUnl.onclick = function() { openAuthModal('register'); };
        }
      }
    }

    function openAuthModal(defaultTab) {
      switchAuthTab(defaultTab || (loggedInEmail ? 'login' : 'register'));
      document.getElementById('authModal').classList.add('open');
    }

    function closeAuthModal() {
      document.getElementById('authModal').classList.remove('open');
    }

    function switchAuthTab(mode) {
      currentAuthMode = mode;
      var tReg = document.getElementById('tabBtnReg');
      var tLog = document.getElementById('tabBtnLogin');
      var p2 = document.getElementById('authPass2Wrap');
      var title = document.getElementById('authModalTitle');
      var btn = document.getElementById('btnSubmitAuth');
      var isEn = (typeof currentLandingLang !== 'undefined' ? currentLandingLang === 'en' : localStorage.getItem('velox_lang') === 'en');

      if (mode === 'register') {
        tReg.style.background = '#2563EB'; tReg.style.color = '#FFFFFF';
        tLog.style.background = 'transparent'; tLog.style.color = '#475569';
        p2.style.display = 'block';
        title.innerText = isEn ? 'Create Account' : '新規登録';
        btn.innerText = isEn ? '✅ Continue to VELOX AI →' : '✅ 新規登録して管理画面へ進む →';
      } else {
        tLog.style.background = '#2563EB'; tLog.style.color = '#FFFFFF';
        tReg.style.background = 'transparent'; tReg.style.color = '#475569';
        p2.style.display = 'none';
        title.innerText = isEn ? 'Log In' : 'ログイン';
        btn.innerText = isEn ? '🔓 Log In to VELOX AI →' : '🔓 ログインして管理画面へ進む →';
      }
    }

    async function submitAuthForm() {
      var isEn = (typeof currentLandingLang !== 'undefined') ? currentLandingLang === 'en' : (localStorage.getItem('velox_lang') === 'en');
      var email = (document.getElementById('authEmail').value || '').trim().toLowerCase();
      var pass1 = document.getElementById('authPass1').value || '';
      var pass2 = document.getElementById('authPass2').value || '';

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showDynamicToast(isEn ? '⚠️ Please enter a valid email address.' : '⚠️ 有効なメールアドレスを入力してください。', 'error');
        return;
      }
      if (pass1.length < 8) {
        showDynamicToast(isEn ? '⚠️ Password must be at least 8 characters long.' : '⚠️ パスワードは8文字以上にしてください。', 'error');
        return;
      }
      if (currentAuthMode === 'register' && pass1 !== pass2) {
        showDynamicToast(isEn ? '⚠️ Passwords do not match. Please enter the same password twice.' : '⚠️ 確認用パスワードが一致しません。同じパスワードを2回入力してください。', 'error');
        return;
      }

      var btn = document.getElementById('btnSubmitAuth');
      btn.disabled = true;
      btn.innerText = isEn ? '⏳ Authenticating...' : '⏳ 認証しています...';

      var endpoint = currentAuthMode === 'register' ? '/api/funnel/register' : '/api/funnel/login';
      try {
        var r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: pass1,
            passwordConfirm: pass2,
            lang: isEn ? 'en' : 'ja',
            currentUserId: localStorage.getItem('xsw_uid') || '',
            refCode: localStorage.getItem('xsw_ref') || 'XSW-B334EF'
          })
        });
        var d = await r.json();
        btn.disabled = false;
        switchAuthTab(currentAuthMode);

        if (!d || !d.ok) {
          showDynamicToast('⚠️ ' + ((d && d.error) || (isEn ? 'Authentication failed' : '認証に失敗しました')), 'error');
          return;
        }

        loggedInEmail = d.email;
        activeTierLevel = parseInt(d.tierLevel || '0', 10);
        localStorage.setItem('xsw_email', d.email);
        localStorage.setItem('xsw_uid', d.userId);
        if (d.sessionToken) localStorage.setItem('xsw_token', d.sessionToken);
        localStorage.removeItem('xsw_signed_out');
        if (typeof persistUserSession === 'function') persistUserSession(d.userId, d.email);
        closeAuthModal();
        syncViewByAuthStatus();
        await loadUserCockpitState();

        if (pendingCheckoutMethod) {
          var m = pendingCheckoutMethod;
          pendingCheckoutMethod = '';
          showDynamicToast(isEn ? '🎉 Account created. Continuing to checkout...' : '🎉 アカウントを作成しました。決済へ進みます。', 'good');
          proceedToCheckout(m);
        } else {
          showDynamicToast(isEn ? '🎉 Welcome to VELOX AI' : '🎉 VELOX AI へようこそ', 'good');
          window.location.href = '/dashboard';
        }
      } catch (e) {
        btn.disabled = false;
        switchAuthTab(currentAuthMode);
        showDynamicToast(isEn ? '⚠️ Network error. Please try again.' : '⚠️ 通信エラーが発生しました。もう一度お試しください。', 'error');
        console.warn('[AuthSync Warning]:', e && e.message ? e.message : e);
      }
    }

    function logoutAccount() {
      try {
        loggedInEmail = '';
        activeTierLevel = 0;
        localStorage.setItem('xsw_signed_out', '1');
        localStorage.removeItem('xsw_email');
        localStorage.removeItem('xsw_uid');
        localStorage.removeItem('xsw_token');
        localStorage.removeItem('xsw_tier');
        localStorage.removeItem('xsw_tier_level');
        localStorage.removeItem('xsw_pro_unlocked');
        localStorage.removeItem('xsw_x_handle');
        localStorage.removeItem('xsw_active_order_id');
        sessionStorage.clear();
        document.cookie = 'xcloud_sess=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'xsw_uid=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'xsw_email=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'xsw_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      } catch (e) {}
      // サーバーサイドログアウトエンドポイントを経由して全キャッシュ・Cookie・表示状態を完全初期化
      window.location.href = '/auth/logout';
    }

    function applyCockpitTierView(tierLv, customCountries) {
      try {
        activeTierLevel = tierLv;
        if (customCountries && customCountries.length > 0) {
          activeCountries = customCountries;
        }

        var topBadge = document.getElementById('topTierBadge');
        var oneDayBanner = document.getElementById('onedayUpgradeBanner');
        var subText = document.getElementById('cockpitStatusSub');

        if (topBadge) {
          if (tierLv === 0) {
            topBadge.className = 'tier-badge-pill';
            topBadge.innerText = 'Lv.0 FREE MEMBER (UNSUBSCRIBED)';
          } else if (tierLv === 1) {
            topBadge.className = 'tier-badge-pill lv1';
            topBadge.innerText = 'Lv.1 24H TEST DRIVE ($7 ACTIVE)';
          } else if (tierLv === 2) {
            topBadge.className = 'tier-badge-pill lv2';
            topBadge.innerText = 'Lv.2 SOLO STARTER ($79 ACTIVE)';
          } else if (tierLv === 3) {
            topBadge.className = 'tier-badge-pill lv3';
            topBadge.innerText = '👑 Lv.3 AGENCY PRO (3-STREAM ACTIVE)';
          } else if (tierLv >= 4) {
            topBadge.className = 'tier-badge-pill lv4';
            topBadge.innerText = '💎 Lv.4 AI AUTOPILOT PRO ($399 FULL UNLOCK)';
          }
        }

        if (oneDayBanner) {
          if (tierLv === 1) oneDayBanner.classList.add('show');
          else oneDayBanner.classList.remove('show');
        }

        if (subText) {
          if (tierLv === 0) subText.innerText = '🔒 Currently unsubscribed: Click "Upgrade Edition" to unlock your dedicated ISP slots and streams.';
          else if (tierLv === 1) subText.innerText = '🟢 Stream #1 & Static ISP #1 Active! (Upgrade to unlock 3-Stream Parallel & AI Reply)';
          else if (tierLv === 2) subText.innerText = '🟢 Stream #1 (10 account Slots) & Static ISP #1 Active!';
          else if (tierLv === 3) subText.innerText = '🟢 All 3 Parallel Streams & 3 Static ISPs Unlocked!';
          else if (tierLv >= 4) subText.innerText = '🟣 Full Enterprise Unlock: 3 Parallel Streams + 🤖 AI Auto-Judge Keyword Reply Active!';
        }

        renderIspSlotsRack(tierLv);
        renderStreamLanes(tierLv);
        renderAiDualEngineCard(tierLv);

        var vault = document.getElementById('proAutoPanel');
        var lockBadge = document.getElementById('proLockBadge');
        if (vault && lockBadge) {
          if (tierLv > 0) {
            vault.classList.remove('locked-vault');
            lockBadge.style.background = '#DCFCE7';
            lockBadge.style.color = '#166534';
            lockBadge.innerText = '✅ UNLOCKED — account Token Queue & Interval Controller Active';
          } else {
            vault.classList.add('locked-vault');
            lockBadge.style.background = '#EFF6FF';
            lockBadge.style.color = '#1D4ED8';
            lockBadge.innerText = '🔒 LOCKED — Unlock an edition to deploy account tokens and start 24/7 autopilot';
          }
        }
      } catch (e) {
        console.warn('[applyCockpitTierView Warning]:', e && e.message ? e.message : e);
      }
    }

    function renderIspSlotsRack(tierLv) {
      var grid = document.getElementById('ispSlotsGrid');
      if (!grid) return;
      var unlockedCount = tierLv === 0 ? 0 : (tierLv <= 2 ? 1 : 3);
      var html = '';
      var defaultFlags = ['US', 'JP', 'GB'];

      for (var i = 0; i < 3; i++) {
        var slotNum = i + 1;
        var cCode = activeCountries[i] || activeCountries[0] || defaultFlags[i];
        if (i < unlockedCount) {
          html +=
            '<div class="isp-slot-item unlocked">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                '<span style="font-weight:900;font-size:0.84rem;color:#166534;">🟢 ISP SLOT #' + slotNum + ' (ACTIVE)</span>' +
                '<span style="background:#DCFCE7;color:#15803D;font-size:0.7rem;font-weight:900;padding:2px 8px;border-radius:999px;">DEDICATED</span>' +
              '</div>' +
              '<div style="font-weight:900;font-size:1.05rem;color:#090D16;margin-bottom:4px;">🌍 Region: ' + cCode + ' Static Residential IP</div>' +
              '<div style="font-size:0.76rem;color:#475569;">Status: 100% Sticky Session Isolation Active</div>' +
            '</div>';
        } else {
          var reqPlan = i === 0 ? 'starter' : 'pro';
          var reqLabel = i === 0 ? 'Unlock with Plan' : 'Agency Pro ($179)';
          html +=
            '<div class="isp-slot-item locked" data-plan="' + reqPlan + '" onclick="openUnlockModal(this.dataset.plan)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                '<span style="font-weight:900;font-size:0.84rem;color:#475569;">🔒 ISP SLOT #' + slotNum + ' (LOCKED)</span>' +
                '<span style="background:#E2E8F0;color:#334155;font-size:0.7rem;font-weight:800;padding:2px 8px;border-radius:999px;">' + reqLabel + '</span>' +
              '</div>' +
              '<div style="font-weight:800;font-size:0.95rem;color:#334155;margin-bottom:4px;">Unassigned Slot (Click to Unlock)</div>' +
              '<div style="font-size:0.75rem;color:#64748B;">Unlock to bind an independent country IP to Stream #' + slotNum + '</div>' +
            '</div>';
        }
      }

      html +=
        '<div class="isp-addon-card" onclick="openAddonIspPurchase()">' +
          '<div>' +
            '<div style="font-weight:900;font-size:0.84rem;color:#1D4ED8;margin-bottom:4px;">➕ ADD-ON STATIC ISP</div>' +
            '<div style="font-weight:900;font-size:1.02rem;color:#090D16;">Add +1 Dedicated ISP</div>' +
            '<div style="font-size:0.76rem;color:#475569;margin-top:4px;">Select from 10 global regions and bind immediately to your rack</div>' +
          '</div>' +
          '<div style="margin-top:10px;font-weight:900;font-size:0.84rem;color:#2563EB;">+$19 / 30 Days →</div>' +
        '</div>';

      grid.innerHTML = html;
    }

    function renderStreamLanes(tierLv) {
      var grid = document.getElementById('streamsGrid3');
      if (!grid) return;
      var unlockedStreams = tierLv === 0 ? 0 : (tierLv <= 2 ? 1 : 3);
      var html = '';

      for (var i = 0; i < 3; i++) {
        var laneNo = i + 1;
        var cCode = activeCountries[i] || activeCountries[0] || 'US';
        var lanePostsCnt = allPostsRaw.filter(function(p){ return parseInt(p.laneIndex || '1', 10) === laneNo; }).length;
        var laneAccCnt = allAccountsRaw.filter(function(a){ return parseInt(a.laneIndex || '1', 10) === laneNo; }).length;
        var isSelected = (laneNo === selectedLane && i < unlockedStreams);

        if (i < unlockedStreams) {
          html +=
            '<div class="stream-lane-card active-lane' + (isSelected ? ' selected-lane' : '') + '" onclick="selectActiveLane(' + laneNo + ')">' +
              '<div>' +
                '<div class="lane-header">' +
                  '<span style="font-weight:900;font-size:1.05rem;color:#090D16;">🚀 STREAM LANE #0' + laneNo + '</span>' +
                  (isSelected
                    ? '<span class="lane-tag on" style="background:#2563EB;color:#FFFFFF;">🎯 EDITING NOW</span>'
                    : '<span class="lane-tag on">🟢 ACTIVE</span>') +
                '</div>' +
                '<div class="lane-metric-row"><span>Bound Static ISP</span><strong>🌍 ' + cCode + ' Static ISP #' + laneNo + '</strong></div>' +
                '<div class="lane-metric-row"><span>Saved Templates</span><strong>📝 ' + lanePostsCnt + ' / 100 Patterns</strong></div>' +
                '<div class="lane-metric-row"><span>account Queue</span><strong>🗂️ ' + laneAccCnt + ' / ' + (maxStandbyPerLane + 1) + ' accounts</strong></div>' +
     '<div class="lane-metric-row"><span>Next Post & Standby</span><strong>' + formatNextPostCountdown(laneNo) + '</strong></div>' +
   '<div class="lane-metric-row"><span>Running Modes</span><strong>' +
     ((allLanesConfig[laneNo] && allLanesConfig[laneNo].autoPostMode === false) ? '<span style="color:#94A3B8;">📢Post:OFF</span>' : '<span style="color:#16A34A;">📢Post:ON</span>') + ' / ' +
     ((allLanesConfig[laneNo] && allLanesConfig[laneNo].aiReplyMode === true && tierLv >= 4) ? '<span style="color:#7C3AED;">🤖AI:ON(専有)</span>' : '<span style="color:#94A3B8;">🤖AI:OFF</span>') +
   '</strong></div>' +
              '</div>' +
              '<div style="margin-top:14px;padding:10px 12px;border-radius:10px;background:' + (isSelected ? '#2563EB' : '#EFF6FF') + ';color:' + (isSelected ? '#FFFFFF' : '#1D4ED8') + ';font-size:0.8rem;font-weight:800;text-align:center;">' +
                (isSelected ? '✓ Currently Selected — Editing Below ↓' : '👆 Click to Switch & Edit Lane #0' + laneNo) +
              '</div>' +
            '</div>';
        } else {
          var targetPlan = i === 0 ? 'starter' : 'pro';
          var unlockMsg = i === 0
            ? '🔓 Unlock Edition to Activate Stream #1 →'
            : '🔓 Unlock Stream #' + laneNo + ' with Agency Pro ($179) →';
          html +=
            '<div class="stream-lane-card locked-lane" data-plan="' + targetPlan + '" onclick="openUnlockModal(this.dataset.plan)">' +
              '<div>' +
                '<div class="lane-header">' +
                  '<span style="font-weight:900;font-size:1.05rem;color:#475569;">🔒 STREAM LANE #0' + laneNo + '</span>' +
                  '<span class="lane-tag off">LOCKED</span>' +
                '</div>' +
                '<div class="lane-metric-row"><span>Bound Static ISP</span><span>🔒 Locked (ISP #' + laneNo + ')</span></div>' +
                '<div class="lane-metric-row"><span>Saved Templates</span><span>🔒 Independent 100 Patterns</span></div>' +
                '<div class="lane-metric-row"><span>account Queue</span><span>🔒 Up to 15 Standby accounts</span></div>' +
              '</div>' +
              '<button type="button" class="lane-unlock-btn">' + unlockMsg + '</button>' +
            '</div>';
        }
      }
      grid.innerHTML = html;
    }

    function renderAiDualEngineCard(tierLv) {
      var card = document.getElementById('aiDualCard');
      var badge = document.getElementById('aiCardBadge');
      var btn = document.getElementById('btnUnlockAiPro');
      var pillAi = document.getElementById('pillAiReply');
      var boxAi = document.getElementById('modeBoxAiReply');
      if (!card || !badge || !btn || !pillAi || !boxAi) return;

      if (tierLv >= 4) {
        card.className = 'ai-dual-card unlocked-ai';
        badge.innerText = '👑 Lv.4 AI AUTOPILOT PRO — DUAL ENGINE UNLOCKED';
        btn.style.display = 'none';
        boxAi.className = dualModes.aireply ? 'mode-switch-box active-ai-mode' : 'mode-switch-box';
        pillAi.className = dualModes.aireply ? 'toggle-pill on-ai' : 'toggle-pill';
        pillAi.innerText = dualModes.aireply ? 'ON ACTIVE' : 'PAUSED';
      } else {
        card.className = 'ai-dual-card locked-ai';
        badge.innerText = '🔒 Lv.4 AI AUTOPILOT PRO ($399) EXCLUSIVE';
        btn.style.display = 'inline-block';
        boxAi.className = 'mode-switch-box';
        pillAi.className = 'toggle-pill';
        pillAi.innerText = '🔒 Unlock ($399)';
      }
    }

    function applyKeywordPreset(presetKey, e) {
      if (e) e.stopPropagation();
      if (activeTierLevel < 4) {
        openUnlockModal('business');
        showDynamicToast('👑 AI Keyword Presets & Auto-Judge Reply are unlocked on the $399 AI Autopilot Pro edition!', 'good');
        return;
      }
      var map = {
        aff: 'al.dmm.com, dmm.co.jp, amzn.to, a.r10.to, #PR, #ad, affiliate',
        info: 'note.com, brmk.io, tips.jp, gumroad.com, patreon.com',
        global: 'linktr.ee, beacons.ai, onlyfans.com, OFM traffic, affiliate marketing',
        crypto: 'airdrop, web3, DEX, memecoin, presale, crypto alpha'
      };
      var input = document.getElementById('proAiKeywords');
      if (input && map[presetKey]) {
        input.value = map[presetKey];
        saveDualModeSettingsQuietly();
        showDynamicToast('🎯 AI target keywords updated and saved!', 'good');
      }
    }

    async function saveDualModeSettingsQuietly() {
      var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
      if (!uid) return;
      var aiKeywords = (allLanesConfig[selectedLane] && allLanesConfig[selectedLane].aiKeywords) ? allLanesConfig[selectedLane].aiKeywords : '';
      try {
        await fetch('/api/funnel/update-dual-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: uid,
            laneIndex: selectedLane,
            autoPostMode: dualModes.autopost,
            aiReplyMode: dualModes.aireply && activeTierLevel >= 4,
            aiKeywords: aiKeywords
          })
        });
      } catch (e) {}
    }

    function handleAiCardClick(e) {
      if (activeTierLevel < 4) {
        e.preventDefault();
        openUnlockModal('business');
        showDynamicToast('👑 Select the $399 AI Autopilot Pro edition to unlock Dual-Engine AI Auto-Judge Reply + 3-Stream Auto-Posting!', 'good');
      }
    }

    async function toggleDualMode(modeKey, e) {
      if (e) e.stopPropagation();
      if (activeTierLevel < 4 && modeKey === 'aireply') {
        openUnlockModal('business');
        showDynamicToast('👑 AI自動判別返信モードは $399 プランでアンロックされます！', 'good');
        return;
      }
      if (activeTierLevel === 0) {
        openUnlockModal('starter');
        return;
      }
      dualModes[modeKey] = !dualModes[modeKey];
      if (!allLanesConfig[selectedLane]) allLanesConfig[selectedLane] = {};
      allLanesConfig[selectedLane].autoPostMode = dualModes.autopost;
      allLanesConfig[selectedLane].aiReplyMode = dualModes.aireply;

      // クライアント側でもAIリプライをONにした場合は他レーンをOFFに同期
      var switchedOffLanes = [];
      if (modeKey === 'aireply' && dualModes.aireply === true) {
        for (var k = 1; k <= 3; k++) {
          if (k !== selectedLane && allLanesConfig[k] && allLanesConfig[k].aiReplyMode === true) {
            allLanesConfig[k].aiReplyMode = false;
            switchedOffLanes.push('#0' + k);
          }
        }
      }

      var pillAuto = document.getElementById('pillAutoPost');
      var boxAuto = document.getElementById('modeBoxAutoPost');
      boxAuto.className = dualModes.autopost ? 'mode-switch-box active-mode' : 'mode-switch-box';
      pillAuto.className = dualModes.autopost ? 'toggle-pill on' : 'toggle-pill';
      pillAuto.innerText = dualModes.autopost ? 'ON ACTIVE' : 'PAUSED';

      renderAiDualEngineCard(activeTierLevel);
      updateAiActiveLaneBadgeUi();
      renderStreamLanes(activeTierLevel);
      await saveDualModeSettingsQuietly();

      if (modeKey === 'aireply' && dualModes.aireply === true) {
        if (switchedOffLanes.length > 0) {
          showDynamicToast('🤖 [STREAM LANE #0' + selectedLane + '] でAI返信をONにしました！（※AIリプライは1-Lane Exclusiveのため、Lane ' + switchedOffLanes.join(', ') + ' のAIリプライは自動的にOFFに切り替わりました）', 'good');
        } else {
          showDynamicToast('🤖 [STREAM LANE #0' + selectedLane + '] でAI返信モードをONにしました！（1-Lane Exclusive稼働）', 'good');
        }
      } else {
        showDynamicToast('⚡ [STREAM LANE #0' + selectedLane + '] モード更新 — 自動投稿: ' + (dualModes.autopost ? 'ON' : 'OFF') + ' / AIリプライ: ' + (dualModes.aireply ? 'ON' : 'OFF'), 'good');
      }
    }

    function openAddonIspPurchase() {
      openUnlockModal('addon_isp');
    }

    function handleLockedPanelClick(e) {
      if (activeTierLevel === 0) {
        e.preventDefault();
        openUnlockModal('starter');
        showDynamicToast('💡 Select an edition in Step 1 to unlock your command cockpit!', 'good');
      }
    }

    function openUnlockModal(preselectPlanId) {
      var modal = document.getElementById('unlockModal');
      if (modal) modal.classList.add('open');
      choosePlan(preselectPlanId || 'pro');
    }
    function closeUnlockModal() {
      var modal = document.getElementById('unlockModal');
      if (modal) modal.classList.remove('open');
    }

    function choosePlan(planId) {
      if (!planId || !PLAN_META[planId]) planId = 'pro';
      currentPlanId = planId;
      window.currentPlanId = planId;
      window.currentPlan = planId;
      var meta = PLAN_META[planId];
      var isEn = (typeof currentLandingLang !== 'undefined') ? currentLandingLang === 'en' : (localStorage.getItem('velox_lang') === 'en');
      var currency = typeof currentCurrency !== 'undefined' ? currentCurrency : (isEn ? 'usd' : 'jpy');
      var currencyUnit = currency === 'jpy'
        ? (isEn ? ' / month (tax included)' : ' / 月（税込）')
        : (isEn ? ' / month' : ' / 月');

      var ids = ['starter', 'pro', 'business'];
      for (var i = 0; i < ids.length; i++) {
        var pid = ids[i];
        var c = document.getElementById('pcard_' + pid);
        var b = document.getElementById('pbtn_' + pid);
        var pMeta = PLAN_META[pid] || {};
        var pName = (isEn && pMeta.displayNameEn) ? pMeta.displayNameEn : (pMeta.displayName || pid);
        var priceEl = document.getElementById('modal_price_' + pid);
        if (priceEl) {
          var priceValue = currency === 'jpy'
            ? '¥' + pMeta.jpy.toLocaleString()
            : '$' + pMeta.usd;
          priceEl.innerText = priceValue + currencyUnit;
        }

        if (pid === planId) {
          if (c) {
            c.classList.add('selected');
            c.style.borderColor = '#2563EB';
            c.style.borderWidth = '2.5px';
            c.style.borderStyle = 'solid';
            c.style.background = '#EFF6FF';
            c.style.boxShadow = '0 12px 28px -6px rgba(37,99,235,0.25)';
          }
          if (b) {
            b.style.background = '#2563EB';
            b.style.color = '#FFFFFF';
            b.style.borderColor = '#2563EB';
            b.style.boxShadow = '0 4px 14px rgba(37,99,235,0.35)';
            b.innerText = pName + (isEn ? ' Selected ✓' : ' を選択中 ✓');
          }
        } else {
          if (c) {
            c.classList.remove('selected');
            c.style.borderColor = '#E2E8F0';
            c.style.borderWidth = '1.5px';
            c.style.borderStyle = 'solid';
            c.style.background = '#FFFFFF';
            c.style.boxShadow = 'none';
          }
          if (b) {
            b.style.background = '#FFFFFF';
            b.style.color = '#0F172A';
            b.style.borderColor = '#CBD5E1';
            b.style.boxShadow = 'none';
            b.innerText = pName + (isEn ? ' Select' : ' を選択');
          }
        }
      }

      var planTextEl = document.getElementById('modalSelectedPlanText');
      if (planTextEl) {
        var icon = (planId === 'starter') ? '👤' : (planId === 'pro') ? '🥈' : '👑';
        var selectedName = (isEn && meta.displayNameEn) ? meta.displayNameEn : meta.displayName;
        var selectedPrice = currency === 'jpy' ? '¥' + meta.jpy.toLocaleString() : '$' + meta.usd;
        planTextEl.innerText = (isEn ? 'Selected: ' : '選択中: ')
          + icon + ' ' + selectedName + ' (' + selectedPrice + currencyUnit
          + (isEn ? ' · 14-day free trial)' : '・14日間無料トライアル)');
      }

      var btnPay = document.getElementById('btnStripeModalPay');
      if (btnPay) {
        btnPay.innerHTML = isEn 
          ? '💳 Start 14-Day Free Trial →' 
          : '💳 14日間無料トライアルを開始 →';
      }
    }

    function renderCountryButtons() {
      var meta = PLAN_META[currentPlanId];
      var grid = document.getElementById('countryGrid');
      var html = '';
      for (var i = 0; i < COUNTRIES.length; i++) {
        var c = COUNTRIES[i];
        var isRestricted = meta.onlyUsJp && (c.code !== 'US' && c.code !== 'JP');
        var countPicked = pickedCountries.filter(function(x) { return x === c.code; }).length;
        var cls = 'c-btn';
        if (isRestricted) cls += ' restricted';
        else if (countPicked > 0) cls += ' picked';

        var rightBadge = '';
        if (isRestricted) rightBadge = '<span style="font-size:0.72rem;">🔒$79+</span>';
        else if (countPicked > 0) rightBadge = '<span style="background:#fff;color:#1D4ED8;padding:2px 8px;border-radius:999px;font-size:0.75rem;">×' + countPicked + '</span>';
        else rightBadge = '<span style="font-size:0.75rem;opacity:0.6;">+Select</span>';

        html += '<button type="button" class="' + cls + '" data-code="' + c.code + '" onclick="tapCountry(this.dataset.code)">' +
          '<span>' + c.flag + ' ' + c.name + '</span>' + rightBadge +
        '</button>';
      }
      grid.innerHTML = html;
    }

    function tapCountry(code) {
      if (!currentPlanId) return;
      var meta = PLAN_META[currentPlanId];

      if (meta.onlyUsJp && code !== 'US' && code !== 'JP') {
        showDynamicToast('⚠️ The $7 Test Drive supports 🇺🇸 US or 🇯🇵 JP only. Select Solo Starter ($79+) above to unlock all 10 global regions!', 'error');
        return;
      }

      if (meta.ispQuota === 1) {
        pickedCountries = [code];
        showDynamicToast('🎉 Dedicated ISP (' + code + ') configured! Proceed to Step 3 below.', 'good');
      } else {
        if (pickedCountries.length >= meta.ispQuota) {
          pickedCountries.shift();
        }
        pickedCountries.push(code);
        var rem = meta.ispQuota - pickedCountries.length;
        if (rem > 0) {
          showDynamicToast('👍 (' + pickedCountries.length + '/' + meta.ispQuota + ' selected) Select ' + rem + ' more ISP region(s)!', 'good');
        } else {
          showDynamicToast('🔥 All 3 Dedicated Static ISPs configured! Proceed to checkout below.', 'good');
        }
      }

      renderCountryButtons();
      updateSlotsAndCheckoutState();
    }

    function removeSlotAt(idx) {
      pickedCountries.splice(idx, 1);
      renderCountryButtons();
      updateSlotsAndCheckoutState();
    }

    function autoFillRecommendedIsps() {
      pickedCountries = ['US', 'JP', 'GB'];
      renderCountryButtons();
      updateSlotsAndCheckoutState();
      showDynamicToast('⚡ Auto-filled US + JP + GB static ISP slots!', 'good');
    }

    function updateSlotsAndCheckoutState() {
      var meta = PLAN_META[currentPlanId];
      if (!meta) return;

      var qBadge = document.getElementById('quotaBadge');
      qBadge.innerText = 'Selected: ' + pickedCountries.length + ' / ' + meta.ispQuota + ' IP';
      if (pickedCountries.length === meta.ispQuota) qBadge.classList.add('complete');
      else qBadge.classList.remove('complete');

      var bar = document.getElementById('selectedSlotsBar');
      if (pickedCountries.length === 0) {
        bar.innerHTML = '<span style="font-size:0.84rem;font-weight:700;color:#64748B;">Assigned Static ISP Slots: None selected yet</span>';
      } else {
        var chips = '<span style="font-size:0.84rem;font-weight:800;color:#090D16;">Configured Static ISPs:</span>';
        for (var i = 0; i < pickedCountries.length; i++) {
          var cCode = pickedCountries[i];
          chips += '<span class="slot-chip">ISP #' + (i + 1) + ': ' + cCode + ' <button type="button" onclick="removeSlotAt(' + i + ')">✕</button></span>';
        }
        bar.innerHTML = chips;
      }

      var chkBox = document.getElementById('checkoutStepBox');
      if (pickedCountries.length === meta.ispQuota) {
        document.getElementById('wizStep2').className = 'wiz-step done';
        document.getElementById('wizStep3').className = 'wiz-step active';
        chkBox.classList.add('open');
        var priceLabel = meta.usd;
        if (activeTierLevel === 1 && (currentPlanId === 'starter' || currentPlanId === 'pro' || currentPlanId === 'business')) {
          priceLabel = (meta.usd - 7) + ' (-$7 Trial Credit Applied!)';
        }
        document.getElementById('checkoutSummaryTitle').innerText = '③ Ready to Deploy: ' + meta.name + ' [ISP: ' + pickedCountries.join(' + ') + ']';
        document.getElementById('btnPayWiseFinal').innerText = '🏦 Unlock via Wise / Card ($' + priceLabel + ') →';
        document.getElementById('btnPayCryptoFinal').innerText = '💳 Unlock via Crypto  ($' + priceLabel + ') →';
        setTimeout(function() {
          chkBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 120);
      } else {
        document.getElementById('wizStep2').className = 'wiz-step active';
        document.getElementById('wizStep3').className = 'wiz-step';
        chkBox.classList.remove('open');
      }
    }

    function escapePreview(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function selectShowcaseLang(lang) {
      window.showcaseLang = lang === 'en' ? 'en' : 'ja';
      var ja = document.getElementById('samplePillJa');
      var en = document.getElementById('samplePillEn');
      if (ja) ja.style.background = window.showcaseLang === 'ja' ? '#EFF6FF' : '#FFFFFF';
      if (en) en.style.background = window.showcaseLang === 'en' ? '#EFF6FF' : '#FFFFFF';
      runFreeBrowserExperience();
    }

    async function runFreeBrowserExperience() {
      var btn = document.getElementById('btnRunFreeTest');
      var box = document.getElementById('expConsole');
      var isEn = window.showcaseLang ? window.showcaseLang === 'en' : (typeof currentLandingLang !== 'undefined' ? currentLandingLang === 'en' : localStorage.getItem('velox_lang') === 'en');
      if (!btn || !box) return;
      btn.disabled = true;
      btn.innerText = isEn ? 'Loading the cached sample...' : '完成見本を読み込んでいます...';
      box.style.display = 'block';
      box.style.color = '#0F172A';
      box.textContent = isEn ? 'Loading the cached production sample.' : 'キャッシュされた完成見本を表示します。';
      var resData = null;
      try {
        var response = await fetch('/api/funnel/sample-showcase?lang=' + (isEn ? 'en' : 'ja'));
        resData = await response.json();
      } catch (err) {
        resData = null;
      }
      if (!resData || !resData.ok || !resData.preview || !Array.isArray(resData.preview.tweets)) {
        box.textContent = (resData && resData.error) || (isEn ? 'No draft was written.' : '投稿案を作成できませんでした。入力内容をご確認のうえ、もう一度お試しください。');
        box.style.color = '#991B1B';
        btn.disabled = false;
        btn.innerText = isEn ? 'Try again' : 'もう一度試す';
        return;
      }
      var preview = resData.preview;
      var readableClaim = function(claim) {
        var parts = String(claim || '').split(' — ').map(function(part) { return part.trim(); }).filter(Boolean);
        var unique = [];
        parts.forEach(function(part) {
          var repeated = unique.some(function(existing) {
            return existing === part || existing.indexOf(part) !== -1 || part.indexOf(existing) !== -1;
          });
          if (!repeated) unique.push(part);
        });
        return unique.join(isEn ? '. ' : '。');
      };
      var facts = (preview.facts || []).map(function(item) {
        return '<li>' + escapePreview(readableClaim(item.claim)) + (item.audience ? ' <span style="color:#64748B;">(' + escapePreview(item.audience) + ')</span>' : '') + '</li>';
      }).join('') || '<li>' + (isEn ? 'No separate claim was extracted.' : '分けて取り出せた主張はありません。') + '</li>';
      var prices = (preview.pricing || []).map(function(item) { return '<li>' + escapePreview(item) + '</li>'; }).join('');
      var limits = (preview.constraints || []).map(function(item) { return '<li>' + escapePreview(item) + '</li>'; }).join('');
      var posts = preview.tweets.map(function(tweet, index) {
        var label = preview.tweets.length > 1 ? ((index + 1) + ' / ' + preview.tweets.length) : (isEn ? 'Post draft' : '投稿案');
        return '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px;margin-top:8px;"><div style="font-size:11px;font-weight:800;color:#64748B;margin-bottom:4px;">' + label + '</div><div style="white-space:pre-wrap;line-height:1.7;">' + escapePreview(tweet) + '</div></div>';
      }).join('');
      var account = preview.account || {};
      var card = preview.visualCardUrl
        ? '<img src="' + escapePreview(preview.visualCardUrl) + '" alt="visual card" style="border:1px solid #E2E8F0;border-radius:12px;width:100%;height:auto;margin-top:12px;background:#FFFFFF;" />'
        : '';
      box.innerHTML = '<div style="text-align:left;">' +
        '<div style="font-size:12px;font-weight:800;color:#1D4ED8;margin-bottom:8px;">' + (isEn ? 'Cached production sample generated by the live pipeline' : '本番エンジン生成の完成見本（キャッシュ表示）') + '</div>' +
        '<div style="font-size:13px;margin-bottom:8px;"><b>' + (account.handle ? ('@' + escapePreview(account.handle)) : (isEn ? 'Official sample' : '公式見本')) + '</b></div>' +
        '<div style="font-weight:900;margin-top:12px;">' + (isEn ? 'Verified page facts' : '確認できたページの事実') + '</div><ul>' + facts + '</ul>' +
        (prices ? '<div style="font-weight:900;margin-top:12px;">' + (isEn ? 'Prices' : '価格') + '</div><ul>' + prices + '</ul>' : '') +
        (limits ? '<div style="font-weight:900;margin-top:12px;">' + (isEn ? 'Limits' : '制約') + '</div><ul>' + limits + '</ul>' : '') +
        '<div style="font-weight:900;margin-top:12px;">' + (isEn ? 'Selected shape' : '選んだ形') + '</div><div>' + escapePreview(preview.shapeReason || '') + '</div>' +
        '<div style="font-weight:900;margin-top:12px;">' + (isEn ? 'Post draft' : '投稿案') + '</div>' + posts +
        card +
        '</div>';
      btn.disabled = false;
      btn.innerText = isEn ? 'Show the cached sample' : '完成見本を表示する';
    }

    async function proceedToCheckout(method) {
      if (!loggedInEmail) {
        pendingCheckoutMethod = method;
        closeUnlockModal();
        openAuthModal('register');
        showDynamicToast('🔒 Please create your account (Email + Password) first so your edition and dedicated ISPs are permanently bound to your cockpit!', 'good');
        return;
      }
      if (!currentPlanId) {
        showDynamicToast('⚠️ Please select an edition in Step 1 first.', 'error');
        return;
      }
      var meta = PLAN_META[currentPlanId];
      if (pickedCountries.length < meta.ispQuota) {
        var rem = meta.ispQuota - pickedCountries.length;
        showDynamicToast('⚠️ Please select ' + rem + ' more ISP region(s)!', 'error');
        return;
      }

      var countryStr = pickedCountries.join(',');
      localStorage.setItem('xsw_isp_country', countryStr);
      var aiKw = document.getElementById('modalAiKeywords') ? document.getElementById('modalAiKeywords').value.trim() : '';
      if (aiKw && document.getElementById('proAiKeywords')) {
        document.getElementById('proAiKeywords').value = aiKw;
      }

      var bar = document.getElementById('modalOrderBar');
      bar.style.display = 'block';
      bar.innerHTML = '⏳ Generating secure checkout link...';

      var res = await fetch('/api/funnel/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: currentPlanId,
          method: method,
          country: countryStr,
          aiKeywords: aiKw,
          userId: localStorage.getItem('xsw_uid') || '',
          refCode: localStorage.getItem('xsw_ref') || 'XSW-B334EF'
        })
      });
      var data = await res.json();
      if (!data.ok) {
        bar.innerHTML = '⚠️ Error creating order. Please try again.';
        return;
      }
      currentOrderId = data.orderId;
      localStorage.setItem('xsw_active_order_id', data.orderId);
      localStorage.setItem('xsw_uid', data.userId); if (typeof persistUserSession === 'function') persistUserSession(data.userId, localStorage.getItem('xsw_email'));

      var targetUrl = method === 'wise' ? data.wiseUrl : data.cryptoUrl;
      window.open(targetUrl, '_blank');

      showDynamicToast('🚀 Checkout opened in a new tab! Click "Verify Payment & Unlock Now" once completed.', 'good');

      bar.innerHTML =
        '<div style="margin-bottom:12px;color:#090D16;">💳 Checkout opened in a new tab (Order Ref: <code>' + data.wiseRef + '</code> / Static ISP: <strong>' + countryStr + '</strong>)</div>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
          '<a href="' + targetUrl + '" target="_blank" style="background:#2563EB;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:800;">Re-open Payment Page →</a>' +
          '<button type="button" onclick="verifyOrderNow()" style="background:#16A34A;color:#fff;border:none;padding:11px 20px;border-radius:10px;font-weight:800;cursor:pointer;">🔄 Verify Payment & Unlock Now</button>' +
        '</div>';
    }

    async function verifyOrderNow() {
      if (!currentOrderId) return;
      var bar = document.getElementById('modalOrderBar');
      bar.innerHTML = '🔍 Auditing payment settlement via Wise API / OxaPay...';
      var res = await fetch('/api/funnel/check-order?orderId=' + encodeURIComponent(currentOrderId));
      var data = await res.json();
      if (data.paid) {
        var newTier = data.tierLevel || (PLAN_META[data.planId] ? PLAN_META[data.planId].tier : 2);
        var cList = String(data.country || 'US').split(',').filter(Boolean);
        document.getElementById('topLocBadge').innerHTML = '<span class="loc-dot"></span><span>YOUR LOCATION: ' + cList.join('+') + ' (Dedicated ISP)</span>';
        applyCockpitTierView(newTier, cList);
        closeUnlockModal();
        syncViewByAuthStatus();
        loadUserCockpitState();
        showDynamicToast('🎉 Payment verified! Your command cockpit and dedicated static ISPs are now active!', 'good');
      } else {
        showDynamicToast('⏳ Settlement not detected yet. Please wait 15–30 seconds after payment and click Verify again.', 'error');
        bar.innerHTML = 'Settlement not detected yet. Please wait 15–30 seconds after completing payment and click Verify again.<br><button type="button" onclick="verifyOrderNow()" style="margin-top:10px;background:#2563EB;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-weight:800;cursor:pointer;">🔄 Verify Again</button>';
      }
    }

    function selectInt(mins, el) {
      selectedInterval = mins;
      var pills = document.querySelectorAll('.int-pill');
      for (var i = 0; i < pills.length; i++) pills[i].classList.remove('active');
      el.classList.add('active');
      showDynamicToast('👍 Posting interval set to every ' + mins + ' minutes!', 'good');
    }

    async function saveAndStartProEngine() {
      if (activeTierLevel === 0) return openUnlockModal('starter');
      var tokens = document.getElementById('proTokens').value.trim();
      var bio = (document.getElementById('proBioInput') ? document.getElementById('proBioInput').value : '').trim();
      var rawPost = (document.getElementById('proPostInput') ? document.getElementById('proPostInput').value : '').trim();
      var selfReply = (document.getElementById('proSelfReplyInput') ? document.getElementById('proSelfReplyInput').value : '').trim();
      var autoSplit = document.getElementById('autoExtractUrlChk') ? document.getElementById('autoExtractUrlChk').checked : false;
      var aiKeywords = document.getElementById('proAiKeywords') ? document.getElementById('proAiKeywords').value.trim() : '';
      var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';

      if (bio && calcXWeight(bio, false) > 160) {
        showDynamicToast('⚠️ プロフィール(BIO)が文字数オーバーです！全角80文字（半角160文字）以内にしてください。', 'error');
        return;
      }

      var post = rawPost;
      if (post && autoSplit) {
        var uMatches = post.match(/https?:\/\/[^\s]+/g);
        if (uMatches && uMatches.length > 0) {
          post = post.replace(/https?:\/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim() || '👇';
          if (!selfReply) selfReply = uMatches.join(' ');
        }
      }
      if (post && calcXWeight(post, false) > 280) {
        var z = Math.ceil(calcXWeight(post, false) / 2);
        showDynamicToast('⚠️ 投稿文が文字数オーバーです！全角140文字（半角280文字）以内に収めてください（現在: 全角換算 ' + z + '文字）', 'error');
        return;
      }

      var res = await fetch('/api/funnel/start-pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: uid,
          laneIndex: selectedLane,
          tokens: tokens,
          bio: bio,
          post: post,
          selfReplyText: selfReply,
          intervalMin: selectedInterval,
          aiKeywords: aiKeywords,
        aiProductDesc: document.getElementById('aiCampProductInput') ? document.getElementById('aiCampProductInput').value.trim() : '',
        aiAffiliateUrl: document.getElementById('aiCampUrlInput') ? document.getElementById('aiCampUrlInput').value.trim() : '',
        aiFunnelStyle: document.getElementById('aiCampStyleSelect') ? document.getElementById('aiCampStyleSelect').value : 'empathy_bridge',
        aiTargetLang: document.getElementById('aiCampLangSelect') ? document.getElementById('aiCampLangSelect').value : 'ja',
        aiReplyPersona: document.getElementById('aiCampPersonaPreview') ? document.getElementById('aiCampPersonaPreview').value.trim() : '',
          imageBase64: uploadedImageBase64,
          imageUrl: (document.getElementById('proImageUrlInput') ? document.getElementById('proImageUrlInput').value.trim() : ''),
          autoPostMode: dualModes.autopost,
          aiReplyMode: dualModes.aireply && activeTierLevel >= 4
        })
      });
      var data = await safeParseApiJson(res);
      if (!data || !data.ok) {
        showDynamicToast('⚠️ ' + ((data && data.error) || '設定の保存に失敗しました'), 'error');
        return;
      }
      if (data.ok) {
        document.getElementById('proTokens').value = '';
        if (data.skippedCrossLaneCount && data.skippedCrossLaneCount > 0) {
          showDynamicToast('⚠️ 異国IP同時ログイン凍結を防ぐため、既に別レーンに登録されているトークン ' + data.skippedCrossLaneCount + '件 (' + (data.crossLaneWarnings || []).join(', ') + ') を自動除外して保存しました！', 'error');
        } else {
          window._bioDirty = false; window._aiKwDirty = false;
          showDynamicToast('🟢 Stream Lane #0' + selectedLane + ' の設定を保存し、24/7自動運用へ反映しました！', 'good');
        }
        loadUserCockpitState();
      }
    }

    async function requestRemoteDelete(histId) {
      var uid = (typeof getPersistedUid === 'function' ? getPersistedUid() : localStorage.getItem('xsw_uid')) || 'USR-MVUA1GLP-D640';
      showDynamicToast('⏳ Launching Stealth Browser with bound auth_token to delete post safely from X...', 'good');
      loadUserCockpitState();
      var r = await fetch('/api/funnel/request-delete-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, historyId: histId })
      });
      var d = await r.json().catch(function(){ return {}; });
      if (d && d.deleted) {
        showDynamicToast('✅ Post safely deleted from X!', 'good');
      } else {
        showDynamicToast('🗑️ Remote deletion in progress — refreshing status...', 'good');
      }
      loadUserCockpitState();
      setTimeout(loadUserCockpitState, 4000);
    }

    async function loadUserCockpitState() {
      if (localStorage.getItem('xsw_signed_out') === '1') return;
      if (!loggedInEmail) return;
      try {
        var r = await fetch('/api/funnel/user-state');
        var d = await safeParseApiJson(r);
        if (!d || !d.ok) return;
        if (d.guest) {
          loggedInEmail = '';
          localStorage.removeItem('xsw_email');
          localStorage.removeItem('xsw_uid');
          syncViewByAuthStatus();
          return;
        }
        var uid = d.userId || localStorage.getItem('xsw_uid');
        var realTier = (d.planStatus === 'active' && d.tierLevel) ? parseInt(d.tierLevel, 10) : (loggedInEmail === 'hank3jones@gmail.com' ? 4 : 0);
        var cArr = String(d.ispCountry || 'US,JP,GB').split(',').filter(Boolean);

        allLanesConfig = d.lanes || { 1: {}, 2: {}, 3: {} };
    userHasAiRadarAddon = !!(d.hasAiRadarAddon || d.planId === 'enterprise' || d.planId === 'business' || d.tierLevel >= 4);
    var radBadge = document.getElementById('aiRadarStatusBadge');
    if (radBadge) {
      if (userHasAiRadarAddon) {
        radBadge.style.background = '#ECFDF5';
        radBadge.style.color = '#047857';
        radBadge.style.borderColor = '#6EE7B7';
        radBadge.innerText = '🟢 UNLOCKED';
      } else {
        radBadge.style.background = '#FEF3C7';
        radBadge.style.color = '#B45309';
        radBadge.style.borderColor = '#FDE68A';
        radBadge.innerText = '🔓 Unlock (+$49/30d)';
      }
    }
        allAccountsRaw = Array.isArray(d.accounts) ? d.accounts : [];
        allPostsRaw = Array.isArray(d.posts) ? d.posts : [];
        allHistoryRaw = Array.isArray(d.history) ? d.history : [];

        applyCockpitTierView(realTier, cArr);
        if (d.myRefCode && document.getElementById('myCockpitRefUrl')) {
          document.getElementById('myCockpitRefUrl').value = 'https://appflowsystem.com/studio?ref=' + d.myRefCode;
        }
        if (document.getElementById('cockpitToAffPortalLink') && uid && loggedInEmail) {
          document.getElementById('cockpitToAffPortalLink').href = '/affiliate?uid=' + encodeURIComponent(uid) + '&email=' + encodeURIComponent(loggedInEmail);
        }

        applySelectedLaneToFormUi();
        renderFilteredHistoryList();
      } catch (e) {
        console.error('[loadUserCockpitState Error]:', e);
      }
    }

    syncViewByAuthStatus();
    if (loggedInEmail) loadUserCockpitState();

// Pro Scroll-Reveal Animation
document.addEventListener('DOMContentLoaded', function() {
  var secs = document.querySelectorAll('#guestShowcaseView > section');
  for (var i = 0; i < secs.length; i++) {
    if (i > 0) secs[i].classList.add('reveal-sec');
  }
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.08 });
    for (var j = 1; j < secs.length; j++) obs.observe(secs[j]);
  } else {
    for (var k = 1; k < secs.length; k++) secs[k].classList.add('visible');
  }
});

// 15秒ごとにコックピットの稼働ステータスと履歴を自動同期（入力中のフォームは上書きしない安全設計）
// 4秒ごとにバックグラウンドで全動的要素（カード・状態・履歴）をリアルタイム同期（F5リロード完全不要）
if (window._cockpitAutoPollTimer) clearInterval(window._cockpitAutoPollTimer);
window._cockpitAutoPollTimer = setInterval(function() {
  if (loggedInEmail && document.visibilityState === 'visible') {
    loadUserCockpitState();
  }
}, 4000);

// 1秒ごとに各レーンカードの次回投稿カウントダウン (mm:ss) と経過時間をリアルタイム更新
if (window._cockpitOneSecTicker) clearInterval(window._cockpitOneSecTicker);
window._cockpitOneSecTicker = setInterval(function() {
  if (loggedInEmail && document.visibilityState === 'visible' && activeTierLevel > 0) {
    renderStreamLanes(activeTierLevel);
  }
}, 1000);

// 別タブ（YouTubeやX画面）からコックピットに戻った瞬間に0秒で最新状態へ自動同期
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && loggedInEmail) {
    loadUserCockpitState();
    pollLaneTerminalLogs();
  }
});

window.proposeAiAnglesChat = proposeAiAnglesChat;
window.selectAndGenerateAiAngle = selectAndGenerateAiAngle;

document.addEventListener('DOMContentLoaded', function() { setTimeout(function(){ switchComposerCreationMode('ai'); }, 300); });
setTimeout(function(){ if (typeof switchComposerCreationMode === 'function') switchComposerCreationMode('ai'); }, 500);


function relocateTerminalAndSmallLaneBar() {
  try {
    var termBox = document.getElementById('laneLiveTerminalBox');
    var smallLaneBar = document.getElementById('activeLaneWorkspaceBar');
    var histBox = document.getElementById('tenantHistoryBox');
    if (!termBox || !histBox || !histBox.parentElement) return;
    var parent = histBox.parentElement;
    if (termBox.parentElement !== parent && !termBox.parentElement.contains(histBox)) {
      return; // 既にHTML上で #tenantHistoryBox の直前にラッパー配置済み
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', function() {
  relocateTerminalAndSmallLaneBar();
  setTimeout(relocateTerminalAndSmallLaneBar, 250);
});
setTimeout(relocateTerminalAndSmallLaneBar, 100);

setInterval(relocateTerminalAndSmallLaneBar, 1500);

function openRequestedLogin() {
  var hash = window.location.hash || '';
  var query = window.location.search || '';
  var wantsLogin = hash === '#login-box' || /(?:^|[?&])login=1(?:&|$)/.test(query);
  if (!wantsLogin || loggedInEmail) return;
  if (typeof openAuthModal === 'function') openAuthModal('login');
}
window.addEventListener('hashchange', openRequestedLogin);

// GUARANTEED_BOOT_LOAD_COCKPIT with Server Session Authority Verification
document.addEventListener('DOMContentLoaded', function() {
  fetch('/api/funnel/me', { cache: 'no-store', credentials: 'same-origin' }).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function(d) {
    if (!d || d.ok !== true) throw new Error((d && d.error) || 'Session status unavailable');
    if (d.loggedIn && d.user) {
      loggedInEmail = d.user.email;
      activeTierLevel = parseInt(d.user.tierLevel || '0', 10);
      localStorage.setItem('xsw_email', d.user.email);
      localStorage.setItem('xsw_uid', d.user.userId);
      localStorage.removeItem('xsw_signed_out');
      syncViewByAuthStatus();
      if (typeof loadUserCockpitState === 'function') loadUserCockpitState();
    } else {
      // Server session is invalid or not logged in -> synchronize frontend state
      loggedInEmail = '';
      activeTierLevel = 0;
      localStorage.removeItem('xsw_email');
      localStorage.removeItem('xsw_uid');
      localStorage.removeItem('xsw_token');
      syncViewByAuthStatus();
      openRequestedLogin();
    }
  }).catch(function(error) {
    loggedInEmail = '';
    activeTierLevel = 0;
    syncViewByAuthStatus();
    openRequestedLogin();
    console.warn('[AuthStatus Warning]:', error && error.message ? error.message : error);
    var sessionIsEn = (typeof currentLandingLang !== 'undefined') ? currentLandingLang === 'en' : (localStorage.getItem('velox_lang') === 'en');
    showDynamicToast(sessionIsEn ? 'We could not confirm your login. Check your connection and reload the page.' : 'ログイン状態を確認できません。通信を確認してページを再読み込みしてください。', 'error');
  });
});
/* === PHASE 5 RUNTIME STABILIZER & CLICK/PERSONA ENGINE === */
(function() {
  if (window.__xswPhase5Booted) return;
  window.__xswPhase5Booted = true;

  var nativeInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  window._xswLockedLangByLane = window._xswLockedLangByLane || {};
  window._xswLatestUserState = null;
  window._xswCurrentUserId = null;
  window._p5PendingAvatarUrl = '';
  var _lastObservedSelectedLane = null;

  function getActiveLaneSafe() {
    var l = (typeof selectedLane !== 'undefined') ? parseInt(selectedLane, 10) : 1;
    return (l >= 1 && l <= 3) ? l : 1;
  }

  function syncElementAttributes(oldEl, newEl) {
    var oldAttrs = oldEl.attributes;
    var newAttrs = newEl.attributes;
    for (var i = oldAttrs.length - 1; i >= 0; i--) {
      var name = oldAttrs[i].name;
      if (!newEl.hasAttribute(name)) {
        oldEl.removeAttribute(name);
      }
    }
    for (var j = 0; j < newAttrs.length; j++) {
      var nName = newAttrs[j].name;
      var nVal = newAttrs[j].value;
      if (nName === 'value' && document.activeElement === oldEl) continue;
      if (oldEl.getAttribute(nName) !== nVal) {
        oldEl.setAttribute(nName, nVal);
      }
    }
    if (oldEl.tagName === 'INPUT' || oldEl.tagName === 'TEXTAREA' || oldEl.tagName === 'SELECT') {
      if (document.activeElement !== oldEl && oldEl.id !== 'aiCampLangSelect') {
        if (oldEl.type === 'checkbox' || oldEl.type === 'radio') {
          if (oldEl.checked !== newEl.checked) oldEl.checked = newEl.checked;
        } else if (oldEl.value !== newEl.value && newEl.getAttribute('value') !== null) {
          oldEl.value = newEl.value;
        }
      }
    }
  }

  function morphDomChildren(oldParent, newParent) {
    var oldNodes = Array.prototype.slice.call(oldParent.childNodes);
    var newNodes = Array.prototype.slice.call(newParent.childNodes);
    var maxLen = Math.max(oldNodes.length, newNodes.length);

    for (var i = 0; i < maxLen; i++) {
      var oNode = oldNodes[i];
      var nNode = newNodes[i];

      if (!oNode && nNode) {
        oldParent.appendChild(nNode.cloneNode(true));
        continue;
      }
      if (oNode && !nNode) {
        if (oNode.nodeType === 1 && oNode.classList && oNode.classList.contains('xsw-lane-click-pill')) {
          continue;
        }
        if (oNode.parentNode === oldParent) oldParent.removeChild(oNode);
        continue;
      }
      if (oNode.nodeType !== nNode.nodeType || oNode.nodeName !== nNode.nodeName) {
        oldParent.replaceChild(nNode.cloneNode(true), oNode);
        continue;
      }
      if (oNode.nodeType === 3 || oNode.nodeType === 8) {
        if (oNode.nodeValue !== nNode.nodeValue) {
          oNode.nodeValue = nNode.nodeValue;
        }
        continue;
      }
      if (oNode.nodeType === 1) {
        if (oNode.id && nNode.id && oNode.id !== nNode.id) {
          oldParent.replaceChild(nNode.cloneNode(true), oNode);
          continue;
        }
        syncElementAttributes(oNode, nNode);
        morphDomChildren(oNode, nNode);
      }
    }
  }

  function installSmoothMorphOnElement(el) {
    if (!el || el.__xswMorphInstalled || !nativeInnerHTML) return;
    el.__xswMorphInstalled = true;
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get: function() {
        return nativeInnerHTML.get.call(this);
      },
      set: function(val) {
        var str = String(val == null ? '' : val);
        if (this.__xswLastHtml === str) return;
        this.__xswLastHtml = str;
        if (!this.firstElementChild || str === '') {
          nativeInnerHTML.set.call(this, str);
          return;
        }
        var tpl = document.createElement('template');
        nativeInnerHTML.set.call(tpl, str);
        morphDomChildren(this, tpl.content);
      }
    });
  }

  function attachSmoothMorphToCockpitContainers() {
    var targetIds = [
      'streamLanesGrid', 'lanesGrid', 'lanesContainer', 'streamLaneCards',
      'tenantAccountsList', 'accountDepletedWarningBanner', 'ispSlotsList',
      'liveTerminalOutput', 'terminalLogBox', 'funnelTerminalLogs', 'historyList', 'executionHistoryList'
    ];
    for (var i = 0; i < targetIds.length; i++) {
      var el = document.getElementById(targetIds[i]);
      if (el) installSmoothMorphOnElement(el);
    }
    var allDivs = document.querySelectorAll('div, section');
    for (var d = 0; d < allDivs.length; d++) {
      var node = allDivs[d];
      if (node.__xswMorphInstalled || node.children.length < 2 || node.children.length > 4) continue;
      var txt = node.textContent || '';
      if (txt.indexOf('STREAM LANE #01') !== -1 && txt.indexOf('STREAM LANE #02') !== -1 && node.offsetHeight < 500) {
        installSmoothMorphOnElement(node);
      }
    }
  }

  function enforceLaneLanguageLock(laneNo, serverLaneCfg) {
    var sel = document.getElementById('aiCampLangSelect');
    if (!sel) return;
    var locked = window._xswLockedLangByLane[laneNo];
    if (locked) {
      if (sel.value !== locked) sel.value = locked;
      return;
    }
    var fromServer = (serverLaneCfg && serverLaneCfg.aiTargetLang) ? String(serverLaneCfg.aiTargetLang).toLowerCase() : 'en';
    var normalized = fromServer.indexOf('ja') === 0 ? 'ja' : 'en';
    window._xswLockedLangByLane[laneNo] = normalized;
    if (sel.value !== normalized) sel.value = normalized;
  }

  window.onChangeAiCampLang = function(val) {
    var clean = String(val || 'en').toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
    var lNo = getActiveLaneSafe();
    window._xswLockedLangByLane[lNo] = clean;
    window._aiCampDirty = true;
    if (typeof showDynamicToast === 'function') {
      showDynamicToast(
        clean === 'en'
          ? '🇺🇸 Language locked to English (Global) for Stream Lane #0' + lNo
          : '🇯🇵 Language locked to Japanese (Domestic) for Stream Lane #0' + lNo,
        'good'
      );
    }
  };

  window.updateBioWeightMeter = function(rawVal) {
    var badge = document.getElementById('p5BioWeightBadge');
    if (!badge) return;
    var s = String(rawVal || '').replace(/https?:\/\/[^\s]+/g, 'xxxxxxxxxxxxxxxxxxxxxxx');
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) > 255 ? 2 : 1;
    }
    badge.textContent = w + ' / 160';
    badge.style.color = w > 160 ? '#B91C1C' : '#059669';
    badge.style.background = w > 160 ? '#FEE2E2' : '#ECFDF5';
  };

  window.togglePhase5StudioDrawer = function() {
    var body = document.getElementById('xswPromoAndPersonaBody');
    var btn = document.getElementById('btnToggleP5Studio');
    if (!body || !btn) return;
    var hidden = body.style.display === 'none';
    body.style.display = hidden ? 'grid' : 'none';
    btn.textContent = hidden ? '▲ Hide Visual & Persona Studio' : '▼ Open Visual & Persona Studio';
  };

  function decorateStreamLaneClickPills(stateData) {
    if (!stateData || !stateData.clickStats || !stateData.clickStats.byLane) return;
    var cards = document.querySelectorAll('[onclick*="selectLane"], .lane-card, .stream-lane-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var txt = card.textContent || '';
      var m = txt.match(/LANE\s*#?0?([123])/i);
      if (!m) continue;
      var lKey = m[1];
      var stat = stateData.clickStats.byLane[lKey] || { total: 0, today: 0 };
      var pill = card.querySelector('.xsw-lane-click-pill');
      var labelStr = '🎯 Clicks: ' + (stat.total || 0) + ' (Today +' + (stat.today || 0) + ')';
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'xsw-lane-click-pill notranslate';
        card.appendChild(pill);
      }
      if (pill.textContent !== labelStr) {
        pill.textContent = labelStr;
      }
    }
  }

  function syncPhase5CockpitFromState(stateData) {
    if (!stateData || typeof stateData !== 'object') return;
    window._xswLatestUserState = stateData;
    if (stateData.userId) window._xswCurrentUserId = stateData.userId;
    else if (stateData.user && stateData.user.userId) window._xswCurrentUserId = stateData.user.userId;

    var lNo = getActiveLaneSafe();
    var lKey = String(lNo);
    var lanes = stateData.lanes || {};
    var laneCfg = lanes[lKey] || {};
    var cStats = stateData.clickStats || { totalClicks: 0, clicksToday: 0, byLane: {} };
    var lStat = (cStats.byLane && cStats.byLane[lKey]) ? cStats.byLane[lKey] : { total: laneCfg.clickCount || 0, today: laneCfg.clicksToday || 0 };

    var elTotal = document.getElementById('p5TotalClicksVal');
    var elToday = document.getElementById('p5TodayClicksVal');
    var elLaneLbl = document.getElementById('p5ActiveLaneLabel');
    var elLaneVal = document.getElementById('p5LaneClicksVal');
    var elLaneToday = document.getElementById('p5LaneTodayClicksVal');

    if (elTotal) elTotal.textContent = String(cStats.totalClicks || 0);
    if (elToday) elToday.textContent = 'Today +' + String(cStats.clicksToday || 0);
    if (elLaneLbl) elLaneLbl.textContent = 'LANE #0' + lNo;
    if (elLaneVal) elLaneVal.textContent = String(lStat.total || 0);
    if (elLaneToday) elLaneToday.textContent = 'Today +' + String(lStat.today || 0);

    var chkTracker = document.getElementById('p5ClickTrackerToggle');
    if (chkTracker && document.activeElement !== chkTracker) {
      chkTracker.checked = Boolean(laneCfg.useClickTracker);
    }
    var shortDisp = document.getElementById('p5ShortUrlDisplay');
    if (shortDisp) {
      shortDisp.textContent = laneCfg.trackingShortUrl
        ? laneCfg.trackingShortUrl
        : (laneCfg.aiAffiliateUrl ? 'Click toggle to issue /go/ link' : 'Set Q2 URL to issue /go/ link');
    }

    var thumb = document.getElementById('p5PromoImgThumb');
    if (thumb) {
      var pImg = laneCfg.defaultPromoImageUrl || '';
      if (thumb.getAttribute('data-img') !== pImg) {
        thumb.setAttribute('data-img', pImg);
        nativeInnerHTML.set.call(
          thumb,
          pImg
            ? '<img src="' + pImg + '" alt="Promo" />'
            : 'No Promo<br>Image'
        );
      }
    }

    var laneSwitched = (_lastObservedSelectedLane !== lNo);
    if (laneSwitched) {
      _lastObservedSelectedLane = lNo;
      window._p5PersonaDirty = false;
      window._p5PendingAvatarUrl = laneCfg.personaAvatarUrl || '';
    }

    enforceLaneLanguageLock(lNo, laneCfg);

    if (laneSwitched || !window._p5PersonaDirty) {
      var nameIn = document.getElementById('p5PersonaNameInput');
      var locIn = document.getElementById('p5PersonaLocationInput');
      var bioIn = document.getElementById('p5QuickBioInput');
      if (nameIn && document.activeElement !== nameIn) nameIn.value = laneCfg.personaName || '';
      if (locIn && document.activeElement !== locIn) locIn.value = laneCfg.personaLocation || '';
      if (bioIn && document.activeElement !== bioIn) {
        bioIn.value = laneCfg.profileBio || '';
        window.updateBioWeightMeter(bioIn.value);
      }
      var avBtn = document.getElementById('btnUploadPersonaAvatar');
      if (avBtn) {
        avBtn.textContent = (laneCfg.personaAvatarUrl || window._p5PendingAvatarUrl) ? '✅ Avatar Ready' : '👤 Avatar';
      }
    }

    attachSmoothMorphToCockpitContainers();
    decorateStreamLaneClickPills(stateData);
  }

  function renderEnhancedStep3Preview(genData) {
    if (!genData || typeof genData !== 'object') return;
    var listEl = document.getElementById('aiWizardPostsPreviewList');
    var kwIn = document.getElementById('p5WizardAiKeywordsInput');
    var segBadge = document.getElementById('p5TargetSegmentBadge');
    var quickBio = document.getElementById('p5QuickBioInput');
    var wizBio = document.getElementById('aiWizardBioConfirmInput');

    if (kwIn && genData.aiKeywords) kwIn.value = genData.aiKeywords;
    if (segBadge && genData.targetSegment) {
      segBadge.textContent = genData.targetSegment === 'b2b_operator'
        ? '🎯 Segment: B2B / Marketers'
        : '🎯 Segment: B2C / Everyday Buyers (-filter:links)';
    }
    if (wizBio && quickBio && wizBio.value) {
      quickBio.value = wizBio.value;
      window.updateBioWeightMeter(quickBio.value);
    }

    if (!listEl || !Array.isArray(genData.posts) || genData.posts.length === 0) return;
    var esc = (typeof escapeHtmlSafe === 'function')
      ? escapeHtmlSafe
      : function(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    var htmlParts = [];
    if (genData.pinnedPost && genData.pinnedPost.mainText) {
      htmlParts.push(
        '<div style="background:linear-gradient(135deg,#FEF3C7,#ECFDF5);border:2px solid #10B981;border-radius:10px;padding:10px 12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="font-size:0.72rem;font-weight:900;color:#065F46;">📌 FLAGSHIP PINNED BILLBOARD (Auto-Pinned to Profile Top)</span>' +
            '<span style="font-size:0.68rem;font-weight:800;background:#059669;color:#FFF;padding:2px 8px;border-radius:999px;">High-CTR Billboard</span>' +
          '</div>' +
          '<div style="font-size:0.78rem;color:#0F172A;white-space:pre-line;line-height:1.45;">' + esc(genData.pinnedPost.mainText) + '</div>' +
          (genData.pinnedPost.selfReplyText ? '<div style="margin-top:5px;padding-top:5px;border-top:1px dashed #6EE7B7;font-size:0.72rem;color:#047857;font-weight:700;white-space:pre-line;">↳ ' + esc(genData.pinnedPost.selfReplyText) + '</div>' : '') +
        '</div>'
      );
    }

    for (var i = 0; i < genData.posts.length; i++) {
      var p = genData.posts[i] || {};
      var mTxt = p.mainText || p.text || '';
      var sRep = p.selfReplyText || '';
      var isPureReach = !sRep;
      var badgeHtml = isPureReach
        ? '<span style="font-size:0.67rem;font-weight:800;background:#DBEAFE;color:#1E40AF;padding:2px 8px;border-radius:999px;">📌 Pure Reach Booster (Zero-Link -> Pin Bridge)</span>'
        : '<span style="font-size:0.67rem;font-weight:800;background:#EEF2FF;color:#4338CA;padding:2px 8px;border-radius:999px;">🔗 2-Step Self-Reply Link</span>';

      htmlParts.push(
        '<div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:10px;padding:9px 12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;">' +
            '<span style="font-size:0.72rem;font-weight:900;color:#334155;">Pattern #' + (i + 1) + ' / ' + genData.posts.length + '</span>' +
            badgeHtml +
          '</div>' +
          '<div style="font-size:0.77rem;color:#0F172A;white-space:pre-line;line-height:1.42;">' + esc(mTxt) + '</div>' +
          (sRep ? '<div style="margin-top:5px;padding-top:4px;border-top:1px dashed #E2E8F0;font-size:0.71rem;color:#4F46E5;font-weight:700;white-space:pre-line;">↳ ' + esc(sRep) + '</div>' : '') +
        '</div>'
      );
    }
    nativeInnerHTML.set.call(listEl, htmlParts.join(''));
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (init && typeof init.body === 'string' && urlStr.indexOf('/api/funnel/') !== -1) {
      try {
        var parsedBody = JSON.parse(init.body);
        if (parsedBody && parsedBody.userId && !window._xswCurrentUserId) {
          window._xswCurrentUserId = parsedBody.userId;
        }
        var lNo = getActiveLaneSafe();
        if (urlStr.indexOf('ai-propose-angles') !== -1 || urlStr.indexOf('ai-generate-campaign') !== -1) {
          var langSel = document.getElementById('aiCampLangSelect');
          var enforcedLang = window._xswLockedLangByLane[lNo] || (langSel ? langSel.value : 'en');
          parsedBody.targetLang = String(enforcedLang || 'en').toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
          window._xswLockedLangByLane[lNo] = parsedBody.targetLang;
          init = Object.assign({}, init, { body: JSON.stringify(parsedBody) });
        } else if (urlStr.indexOf('ai-launch-wizard') !== -1) {
          var kwEl = document.getElementById('p5WizardAiKeywordsInput');
          if (kwEl && kwEl.value.trim()) {
            parsedBody.aiKeywords = kwEl.value.trim();
            init = Object.assign({}, init, { body: JSON.stringify(parsedBody) });
          }
        }
      } catch (e) {}
    }

    return origFetch(input, init).then(function(res) {
      try {
        if (urlStr.indexOf('/api/funnel/user-state') !== -1 && res.ok) {
          res.clone().json().then(function(d) {
            setTimeout(function() { syncPhase5CockpitFromState(d); }, 15);
          }).catch(function() {});
        } else if (urlStr.indexOf('/api/funnel/ai-generate-campaign') !== -1 && res.ok) {
          res.clone().json().then(function(d) {
            setTimeout(function() { renderEnhancedStep3Preview(d); }, 80);
          }).catch(function() {});
        }
      } catch (e) {}
      return res;
    });
  };

  function postFunnelJson(endpoint, payload) {
    var bodyObj = Object.assign({}, payload || {});
    var uid = window._xswCurrentUserId || localStorage.getItem('xsw_user_id') || localStorage.getItem('funnelUserId') || '';
    if (uid && !bodyObj.userId) bodyObj.userId = uid;
    var headers = { 'Content-Type': 'application/json' };
    if (uid) headers['X-User-Id'] = uid;
    return window.fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: JSON.stringify(bodyObj)
    }).then(function(r) { return r.json(); });
  }

  window.handlePhase5MediaSelect = function(inputEl, kind) {
    if (!inputEl || !inputEl.files || !inputEl.files[0]) return;
    var file = inputEl.files[0];
    var lNo = getActiveLaneSafe();
    var uid = window._xswCurrentUserId || localStorage.getItem('xsw_user_id') || localStorage.getItem('funnelUserId') || '';
    if (typeof showDynamicToast === 'function') {
      showDynamicToast('⏳ Uploading & optimizing ' + (kind === 'avatar' ? 'persona avatar' : 'eye-catch promo image') + '...', 'good');
    }

    var uploadUrl = '/api/funnel/upload-media?kind=' + encodeURIComponent(kind) + (uid ? '&userId=' + encodeURIComponent(uid) : '');
    var headers = { 'Content-Type': file.type || 'application/octet-stream' };
    if (uid) headers['X-User-Id'] = uid;

    window.fetch(uploadUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: file
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        inputEl.value = '';
        if (!d || !d.ok || !d.imageUrl) {
          if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ Upload failed: ' + ((d && d.error) || 'Unknown error'), 'error');
          return;
        }
        if (kind === 'avatar') {
          window._p5PendingAvatarUrl = d.imageUrl;
          var avBtn = document.getElementById('btnUploadPersonaAvatar');
          if (avBtn) avBtn.textContent = '✅ Avatar Ready';
          if (typeof showDynamicToast === 'function') {
            showDynamicToast('✅ Avatar uploaded! Click [⚡ Lock BIO Now] to apply it to X immediately.', 'good');
          }
          return;
        }
        return postFunnelJson('/api/funnel/apply-lane-promo-image', {
          laneIndex: lNo,
          imageUrl: d.imageUrl,
          applyToAllPosts: true
        }).then(function(ap) {
          var thumb = document.getElementById('p5PromoImgThumb');
          if (thumb) {
            thumb.setAttribute('data-img', d.imageUrl);
            nativeInnerHTML.set.call(thumb, '<img src="' + d.imageUrl + '" alt="Promo" />');
          }
          if (typeof showDynamicToast === 'function') {
            showDynamicToast('📸 Promo image applied across ' + ((ap && ap.updatedPostsCount) || 0) + ' post templates, Pinned Post & OGP card!', 'good');
          }
        });
      })
      .catch(function(err) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ Upload error: ' + err.message, 'error');
      });
  };

  window.clearPhase5PromoImage = function() {
    var lNo = getActiveLaneSafe();
    postFunnelJson('/api/funnel/apply-lane-promo-image', {
      laneIndex: lNo,
      imageUrl: '',
      applyToAllPosts: true
    }).then(function() {
      var thumb = document.getElementById('p5PromoImgThumb');
      if (thumb) {
        thumb.setAttribute('data-img', '');
        nativeInnerHTML.set.call(thumb, 'No Promo<br>Image');
      }
      if (typeof showDynamicToast === 'function') {
        showDynamicToast('🧹 Cleared promo image from Stream Lane #0' + lNo + ' templates.', 'good');
      }
    });
  };

  window.toggleLaneClickTracker = function(enabled) {
    var lNo = getActiveLaneSafe();
    var urlIn = document.getElementById('aiCampUrlInput');
    var destUrl = urlIn && urlIn.value.trim() ? urlIn.value.trim() : '';
    postFunnelJson('/api/funnel/toggle-click-tracker', {
      laneIndex: lNo,
      enabled: Boolean(enabled),
      destinationUrl: destUrl
    }).then(function(d) {
      if (!d || !d.ok) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ ' + ((d && d.error) || 'Failed to update click tracker.'), 'error');
        return;
      }
      var disp = document.getElementById('p5ShortUrlDisplay');
      if (disp && d.trackingShortUrl) disp.textContent = d.trackingShortUrl;
      if (typeof showDynamicToast === 'function') {
        showDynamicToast(
          d.useClickTracker
            ? '📊 Smart Large-OGP Click Tracker ENABLED (' + (d.trackingShortUrl || '/go/') + ')'
            : '⚪ Click Tracker disabled (using raw destination URL directly).',
          'good'
        );
      }
    });
  };

  window.copyPhase5TrackingUrl = function() {
    var disp = document.getElementById('p5ShortUrlDisplay');
    var txt = disp ? disp.textContent.trim() : '';
    if (!txt || txt.indexOf('http') !== 0) {
      if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ Enter Q2 Destination URL and toggle Click Tracker ON first.', 'error');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt);
    }
    if (typeof showDynamicToast === 'function') showDynamicToast('📋 Copied tracking link: ' + txt, 'good');
  };

  window.testPhase5TrackingUrl = function() {
    var disp = document.getElementById('p5ShortUrlDisplay');
    var txt = disp ? disp.textContent.trim() : '';
    if (!txt || txt.indexOf('http') !== 0) {
      if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ Enter Q2 Destination URL and toggle Click Tracker ON first.', 'error');
      return;
    }
    window.open(txt + '?s=dashboard_test', '_blank', 'noopener');
  };

  window.triggerInstantBioAndPersonaSync = function(triggerPin) {
    var lNo = getActiveLaneSafe();
    var quickBioEl = document.getElementById('p5QuickBioInput');
    var wizBioEl = document.getElementById('aiWizardBioConfirmInput');
    var bioVal = (quickBioEl && quickBioEl.value.trim())
      ? quickBioEl.value.trim()
      : ((wizBioEl && wizBioEl.value.trim()) ? wizBioEl.value.trim() : '');
    var nameVal = (document.getElementById('p5PersonaNameInput') || {}).value || '';
    var locVal = (document.getElementById('p5PersonaLocationInput') || {}).value || '';

    if (!bioVal && !nameVal && !locVal && !window._p5PendingAvatarUrl && !triggerPin) {
      if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ Enter a Profile BIO, Display Name, Location, or Avatar first.', 'error');
      return;
    }

    postFunnelJson('/api/funnel/instant-sync-persona', {
      laneIndex: lNo,
      profileBio: bioVal,
      personaName: nameVal.trim(),
      personaLocation: locVal.trim(),
      personaAvatarUrl: window._p5PendingAvatarUrl || undefined,
      triggerPinNow: Boolean(triggerPin)
    }).then(function(d) {
      if (!d || !d.ok) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ ' + ((d && d.error) || 'Failed to queue instant sync.'), 'error');
        return;
      }
      window._p5PersonaDirty = false;
      if (typeof showDynamicToast === 'function') {
        showDynamicToast(
          triggerPin
            ? '📌 Publishing & pinning Flagship Billboard Post + locking BIO on Lane #0' + lNo + ' now (~5–15s)!'
            : '⚡ Applying & locking Profile BIO/Persona on Lane #0' + lNo + ' right now (~3–8s)!',
          'good'
        );
      }
    });
  };

  window.triggerLiveOutreachNow = function(outreachType) {
    var lNo = getActiveLaneSafe();
    var kwEl = document.getElementById('p5WizardAiKeywordsInput');
    var customKw = kwEl && kwEl.value.trim() ? kwEl.value.trim() : undefined;

    postFunnelJson('/api/funnel/trigger-outreach-now', {
      laneIndex: lNo,
      outreachType: outreachType || 'reply',
      aiKeywords: customKw
    }).then(function(d) {
      if (!d || !d.ok) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ ' + ((d && d.error) || 'Could not trigger outreach.'), 'error');
        return;
      }
      if (typeof showDynamicToast === 'function') {
        showDynamicToast(
          outreachType === 'quote_rt'
            ? '🔁 Firing live quote Piggyback on @' + (d.targetUsername || 'account') + ' within ~3s! Watch Live Terminal below.'
            : '💬 Firing live AI Prospect Search & Reply on @' + (d.targetUsername || 'account') + ' within ~3s! Watch Live Terminal below.',
          'good'
        );
      }
    });
  };

  window.triggerManual20PostRefresh = function() {
    var lNo = getActiveLaneSafe();
    if (typeof showDynamicToast === 'function') {
      showDynamicToast('🔄 Regenerating 20 fresh high-view AI post patterns for Lane #0' + lNo + ' (~5–8s)...', 'good');
    }
    postFunnelJson('/api/funnel/refresh-campaign-now', { laneIndex: lNo }).then(function(d) {
      if (!d || !d.ok) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ ' + ((d && d.error) || 'Could not refresh posts.'), 'error');
        return;
      }
      if (typeof showDynamicToast === 'function') {
        showDynamicToast('✅ Rotated in ' + (d.count || 20) + ' fresh ' + String(d.lang || 'en').toUpperCase() + ' patterns (Angle #' + d.angleNumber + ') on Lane #0' + lNo + '!', 'good');
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachSmoothMorphToCockpitContainers);
  } else {
    attachSmoothMorphToCockpitContainers();
  }
})();

/* === PHASE 6.1 LANE PERSISTENCE & POWER CONTROLLER === */
(function() {
  if (window.__xswPowerCtrlInstalled) return;
  window.__xswPowerCtrlInstalled = true;

  function currentLaneNum() {
    var l = (typeof selectedLane !== 'undefined') ? parseInt(selectedLane, 10) : 2;
    return (l >= 1 && l <= 3) ? l : 2;
  }

  function persistSelectedLaneChoice(lNo) {
    var clean = Math.min(3, Math.max(1, parseInt(lNo || 2, 10)));
    try {
      localStorage.setItem('xsw_selected_lane', String(clean));
      // 🛡️ 旧URLハッシュ (#lane=...) はトップページのクリーンなURLを汚すため完全に付与禁止＆存在する場合は除去
      if (window.history && window.history.replaceState && location.hash && location.hash.includes('lane')) {
        window.history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (e) {}
  }

  // 既存のレーン切替関数 (selectLane / switchStreamLane / selectStreamLane) をすべてフックして localStorage に永続保存
  ['selectLane', 'switchStreamLane', 'selectStreamLane', 'changeLane'].forEach(function(fnName) {
    if (typeof window[fnName] === 'function' && !window[fnName].__xswWrapped) {
      var origFn = window[fnName];
      var wrapped = function(laneNo) {
        persistSelectedLaneChoice(laneNo);
        var res = origFn.apply(this, arguments);
        setTimeout(refreshPowerBarFromLatestState, 30);
        return res;
      };
      wrapped.__xswWrapped = true;
      window[fnName] = wrapped;
    }
  });

  // 定期監視でも selectedLane の変更を確実にキャッチし、初期ロード時のヘッダー表記 (STREAM LANE #01 ハードコード) も同期
  var _lastTrackedLane = null;
  function syncWorkspaceBannerText(lNo) {
    var ispLabels = { 1: '🌍 US Static ISP #1', 2: '🌍 Dedicated Stream #2 (@VeloxPostApp)', 3: '🌍 GB Static ISP #3' };
    var nodes = document.querySelectorAll('div, span, strong, h2, h3, h4');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.children && el.children.length > 1) continue;
      var t = el.textContent || '';
      if (t.indexOf('Currently Editing:') !== -1 && t.indexOf('STREAM LANE #0') !== -1) {
        el.textContent = 'Currently Editing: 🚀 STREAM LANE #0' + lNo + ' (' + (ispLabels[lNo] || ('Stream #' + lNo)) + ')';
      }
    }
  }

  setInterval(function() {
    var cur = currentLaneNum();
    if (_lastTrackedLane !== cur) {
      _lastTrackedLane = cur;
      persistSelectedLaneChoice(cur);
      syncWorkspaceBannerText(cur);
      refreshPowerBarFromLatestState();
    }
  }, 350);

  function postPowerApi(endpoint, payload) {
    var bodyObj = Object.assign({}, payload || {});
    var uid = window._xswCurrentUserId || localStorage.getItem('xsw_user_id') || localStorage.getItem('funnelUserId') || '';
    if (uid && !bodyObj.userId) bodyObj.userId = uid;
    var headers = { 'Content-Type': 'application/json' };
    if (uid) headers['X-User-Id'] = uid;
    return window.fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: JSON.stringify(bodyObj)
    }).then(function(r) { return r.json(); });
  }

  function isLaneCurrentlyRunning(state, lKey) {
    if (!state || !state.lanes || !state.lanes[lKey]) return false;
    var lc = state.lanes[lKey];
    if (typeof lc.isLaneRunning === 'boolean') return lc.isLaneRunning;
    var topRun = state.user ? (state.user.isEngineRunning !== false) : (state.isEngineRunning !== false);
    return Boolean(topRun && lc.isEngineRunning !== false && (lc.autoPostMode === true || lc.aiReplyMode === true));
  }

  function refreshPowerBarFromLatestState() {
    var st = window._xswLatestUserState;
    var lNo = currentLaneNum();
    var lKey = String(lNo);
    syncWorkspaceBannerText(lNo);

    var badge = document.getElementById('xswLanePowerBadge');
    var sub = document.getElementById('xswLanePowerSubtext');
    var btn = document.getElementById('btnToggleLanePower');
    if (!st || !badge || !btn) return;

    var running = isLaneCurrentlyRunning(st, lKey);
    var lc = (st.lanes && st.lanes[lKey]) ? st.lanes[lKey] : {};
    window._xswCurrentLaneRunning = running;

    if (running) {
      badge.className = 'xsw-power-status-badge running';
      badge.textContent = '🟢 LANE #0' + lNo + ': RUNNING (Every ' + (lc.postIntervalMin || 30) + 'm | AI Reply: ' + (lc.aiReplyMode ? 'ON' : 'OFF') + ')';
      if (sub) sub.textContent = 'Engine is actively posting & prospecting on Stream Lane #0' + lNo + '.';
      btn.className = 'xsw-btn-stop-lane';
      btn.textContent = '⏹️ Stop Lane #0' + lNo + ' Now';
    } else {
      badge.className = 'xsw-power-status-badge stopped';
      badge.textContent = '⏹️ LANE #0' + lNo + ': STOPPED (IDLE)';
      if (sub) sub.textContent = 'Stream Lane #0' + lNo + ' is paused — zero browser or proxy consumption.';
      btn.className = 'xsw-btn-start-lane';
      btn.textContent = '▶️ Start Lane #0' + lNo + ' Autopilot';
    }

    // 上部3つのレーンカード内のピルにもミニ [⏹️ Stop] / [▶️ Start] ボタンを表示
    var cards = document.querySelectorAll('[onclick*="selectLane"], .lane-card, .stream-lane-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var m = (card.textContent || '').match(/LANE\s*#?0?([123])/i);
      if (!m) continue;
      var ck = m[1];
      var cRun = isLaneCurrentlyRunning(st, ck);
      var pill = card.querySelector('.xsw-lane-click-pill');
      if (pill) {
        var cStat = (st.clickStats && st.clickStats.byLane && st.clickStats.byLane[ck]) ? st.clickStats.byLane[ck] : { total: 0, today: 0 };
        var desiredStateAttr = ck + ':' + (cRun ? '1' : '0') + ':' + (cStat.total || 0) + ':' + (cStat.today || 0);
        if (pill.getAttribute('data-p6') !== desiredStateAttr) {
          pill.setAttribute('data-p6', desiredStateAttr);
          pill.innerHTML =
            '<span>🎯 Clicks: ' + (cStat.total || 0) + ' (+' + (cStat.today || 0) + ')</span>' +
            (cRun
              ? '<button type="button" class="xsw-card-mini-power stop" onclick="event.stopPropagation();stopSpecificLaneNow(' + ck + ')">⏹️ Stop #0' + ck + '</button>'
              : '<button type="button" class="xsw-card-mini-power start" onclick="event.stopPropagation();resumeSpecificLaneNow(' + ck + ')">▶️ Start #0' + ck + '</button>');
        }
      }
    }
  }

  setInterval(refreshPowerBarFromLatestState, 800);

  window.stopSpecificLaneNow = function(laneNo) {
    var lNo = Math.min(3, Math.max(1, parseInt(laneNo || currentLaneNum(), 10)));
    postPowerApi('/api/funnel/stop-lane', { laneIndex: lNo }).then(function(d) {
      if (!d || !d.ok) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ ' + ((d && d.error) || 'Failed to stop lane.'), 'error');
        return;
      }
      if (window._xswLatestUserState && window._xswLatestUserState.lanes && window._xswLatestUserState.lanes[String(lNo)]) {
        window._xswLatestUserState.lanes[String(lNo)].isLaneRunning = false;
        window._xswLatestUserState.lanes[String(lNo)].isEngineRunning = false;
        window._xswLatestUserState.lanes[String(lNo)].autoPostMode = false;
        window._xswLatestUserState.lanes[String(lNo)].aiReplyMode = false;
      }
      refreshPowerBarFromLatestState();
      if (typeof loadUserCockpitState === 'function') loadUserCockpitState();
      if (typeof showDynamicToast === 'function') {
        showDynamicToast('⏹️ Stopped Stream Lane #0' + lNo + ' immediately!', 'good');
      }
    });
  };

  window.resumeSpecificLaneNow = function(laneNo) {
    var lNo = Math.min(3, Math.max(1, parseInt(laneNo || currentLaneNum(), 10)));
    postPowerApi('/api/funnel/resume-lane', { laneIndex: lNo }).then(function(d) {
      if (!d || !d.ok) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ ' + ((d && d.error) || 'Failed to start lane.'), 'error');
        return;
      }
      if (window._xswLatestUserState && window._xswLatestUserState.lanes && window._xswLatestUserState.lanes[String(lNo)]) {
        window._xswLatestUserState.lanes[String(lNo)].isLaneRunning = true;
        window._xswLatestUserState.lanes[String(lNo)].isEngineRunning = true;
        window._xswLatestUserState.lanes[String(lNo)].autoPostMode = true;
      }
      refreshPowerBarFromLatestState();
      if (typeof loadUserCockpitState === 'function') loadUserCockpitState();
      if (typeof showDynamicToast === 'function') {
        showDynamicToast('▶️ Resumed Stream Lane #0' + lNo + ' Autopilot!', 'good');
      }
    });
  };

  window.toggleActiveLanePower = function() {
    var lNo = currentLaneNum();
    if (window._xswCurrentLaneRunning) {
      window.stopSpecificLaneNow(lNo);
    } else {
      window.resumeSpecificLaneNow(lNo);
    }
  };

  window.stopAllStreamLanesNow = function() {
    postPowerApi('/api/funnel/stop-all-lanes', {}).then(function(d) {
      if (!d || !d.ok) {
        if (typeof showDynamicToast === 'function') showDynamicToast('⚠️ Failed to stop all lanes.', 'error');
        return;
      }
      if (window._xswLatestUserState && window._xswLatestUserState.lanes) {
        ['1', '2', '3'].forEach(function(k) {
          if (window._xswLatestUserState.lanes[k]) {
            window._xswLatestUserState.lanes[k].isLaneRunning = false;
            window._xswLatestUserState.lanes[k].isEngineRunning = false;
          }
        });
      }
      refreshPowerBarFromLatestState();
      if (typeof loadUserCockpitState === 'function') loadUserCockpitState();
      if (typeof showDynamicToast === 'function') {
        showDynamicToast('🛑 All 3 Stream Lanes paused immediately!', 'good');
      }
    });
  };

  window.clearActiveLaneTerminalNow = function() {
    var lNo = currentLaneNum();
    postPowerApi('/api/funnel/clear-terminal-log', { laneIndex: lNo }).then(function() {
      if (typeof showDynamicToast === 'function') {
        showDynamicToast('🧹 Cleared Terminal Log for Stream Lane #0' + lNo + '.', 'good');
      }
    });
  };

  // 初回ロード時に旧レーンURLハッシュを先行除去
  function applyInitialSavedLaneOnBoot() {
    try {
      if (window.history && window.history.replaceState && location.hash && location.hash.includes('lane')) {
        window.history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (e) {}
    if (typeof loadUserCockpitState === 'function') {
      loadUserCockpitState();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(applyInitialSavedLaneOnBoot, 60); });
  } else {
    setTimeout(applyInitialSavedLaneOnBoot, 60);
  }
})();
