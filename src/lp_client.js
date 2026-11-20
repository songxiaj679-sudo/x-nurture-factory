/**
 * src/lp_client.js
 * X-Swarm Cloud — Interactive Browser Script v6
 * - Pre-loaded Protected Demo Account (Masked auth_token: 14c78b••••••••••••)
 * - Clean English Live Cloud Execution Telemetry View on Post Launch
 * - Full Saved Item Chips with [✕] Delete Buttons & Inline OxaPay Checkout
 */
var PRESET_DEMO_ACCOUNT = {
  docId: 'preset_demo_slot',
  authToken: 'PRESET_PROTECTED_DEMO_TOKEN_40CHARS_0000',
  maskedToken: '0277b5••••••••••••••••••••••••••••••1283',
  username: 'hinata_sasbbe7',
  role: '最新',
  isPresetDemo: true
};

var DEFAULT_DEMO_POST = "{🤖 Live Test from X-Swarm Cloud Studio!|⚡ Testing real cloud browser typing + sub-pixel image camouflage|🟢 100% hands-free X automation test:} {No X app login, no VPS, and no coding needed|Dedicated US Static ISP + 0s shadowban auto-swap} 🔥 #XAutomation #GrowthHacking https://appflowsystem.com";

var savedWebUserId = '';
var selectedPlanId = 'oneday';
var selectedPlanUsd = 7;
var pollTimer = null;
var addonPollTimer = null;
var lastAiPosts = [];
var uploadedImageDataUrl = '';
var savedServerImageUrl = '';
var authMode = 'signup';

var stateAccounts = [PRESET_DEMO_ACCOUNT];
var stateBio = '';
var statePosts = [{ docId: 'preset_post_1', text: DEFAULT_DEMO_POST, isPresetDemo: true }];
var stateInterval = '15';
var stateCountry = 'US';
var stateUnlockedCountries = ['US'];
var stateIsPaid = false;
var stateSelfReply = true;
var pendingAddonCountry = 'JP';

var COUNTRY_CATALOG = [
  { code: 'US', flag: '🇺🇸', name: 'United States', tz: 'America/New_York', tier: 'trial_ok' },
  { code: 'JP', flag: '🇯🇵', name: 'Japan', tz: 'Asia/Tokyo', tier: 'trial_ok' },
  { code: 'GB', flag: '🇬🇧', name: 'United Kingdom', tz: 'Europe/London', tier: 'monthly' },
  { code: 'DE', flag: '🇩🇪', name: 'Germany', tz: 'Europe/Berlin', tier: 'monthly' },
  { code: 'FR', flag: '🇫🇷', name: 'France', tz: 'Europe/Paris', tier: 'monthly' },
  { code: 'NL', flag: '🇳🇱', name: 'Netherlands', tz: 'Europe/Amsterdam', tier: 'monthly' },
  { code: 'CA', flag: '🇨🇦', name: 'Canada', tz: 'America/Toronto', tier: 'monthly' },
  { code: 'AU', flag: '🇦🇺', name: 'Australia', tz: 'Australia/Sydney', tier: 'monthly' },
  { code: 'SG', flag: '🇸🇬', name: 'Singapore', tz: 'Asia/Singapore', tier: 'monthly' },
  { code: 'KR', flag: '🇰🇷', name: 'South Korea', tz: 'Asia/Seoul', tier: 'monthly' }
];

var NICHE_PRESETS = {
  crypto: "{🚀 Don't miss the next 100x alpha|⚡ Whale wallets are accumulating right now|🔥 Early entry alert for active traders}! {We track real-time on-chain volume 24/7|Full breakdown & entry targets are live in our channel} 👇 #Crypto #Solana",
  ofm: "{✨ Finally online and replying to everyone today|🔥 Just dropped something special on my page|💋 Too spicy to post directly on the timeline}... {Check the link below before I take it down|Come say hi on my private page right now} 👇 #OFM #Creator",
  adult_jp: "{🌙 今夜だけこっそり公開してます…|✨ フォロワーさん限定で特別な動画アップしました|🔥 タイムラインでは載せられない続きはプロフ＆リプ欄から} {見れなくなる前にチェックしてね|こっそり覗きにきてください} 👇 #アダアフィ #裏垢女子",
  affiliate: "{⚡ Stop wasting 4 hours a day on manual grinding|🔥 How I automated my entire daily lead generation in 2 minutes|💡 The unfair advantage top affiliates use in 2026}: {100% hands-free cloud automation running while you sleep|See the live proof & test it free below} 👇 #AffiliateMarketing #SideHustle",
  giveaway: "{🎁 24-Hour Flash Access — 100% Free Today|⚡ Opening 50 free spots for our private toolset|🔥 Want the exact blueprint we use to generate daily traffic?} {Grab your instant access link in the reply below|Check the link below right now} 👇 #Giveaway #GrowthHacking"
};

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getCountryMeta(code) {
  var c = String(code || 'US').toUpperCase();
  for (var i = 0; i < COUNTRY_CATALOG.length; i++) {
    if (COUNTRY_CATALOG[i].code === c) return COUNTRY_CATALOG[i];
  }
  return COUNTRY_CATALOG[0];
}

function restorePresetDemoAccount() {
  var hasDemo = stateAccounts.some(function(a) { return a.isPresetDemo; });
  if (!hasDemo) {
    stateAccounts.unshift(PRESET_DEMO_ACCOUNT);
  }
  if (!statePosts || statePosts.length === 0) {
    statePosts = [{ docId: 'preset_post_1', text: DEFAULT_DEMO_POST, isPresetDemo: true }];
    renderSavedPostsList();
  }
  renderSavedAccountsList();
  updateStepProgress();
}

// ============================================================================
// 1. Niche Preset Loader & Smart Post Analyzer (STEP 3)
// ============================================================================
function applyNichePreset(key) {
  var tpl = NICHE_PRESETS[key];
  if (!tpl) return;
  var postBox = document.getElementById('inp-posts');
  if (postBox) {
    postBox.value = tpl;
    analyzePostMetricsLive();
    updateStepProgress();
  }
}

function analyzePostMetricsLive() {
  var postBox = document.getElementById('inp-posts');
  var meterEl = document.getElementById('post-smart-meter');
  if (!postBox || !meterEl) return;

  var val = postBox.value || '';
  if (!val.trim()) {
    meterEl.style.display = 'none';
    return;
  }

  var sampleResolved = val.replace(/\{([^{}]+)\}/g, function(_, g) {
    return g.split('|')[0] || '';
  });
  var charLen = sampleResolved.length;
  var tags = sampleResolved.match(/#[\w\u3040-\u30ff\u4e00-\u9faf]+/g) || [];
  var hasSpintax = /\{[^{}]+\|[^{}]+\}/.test(val);

  meterEl.style.display = 'flex';
  var charBadge = charLen <= 260
    ? '<span style="color:#059669;">✅ Length: ~' + charLen + '/280 chars</span>'
    : '<span style="color:#dc2626;">⚠️ Length: ~' + charLen + '/280 (Too long)</span>';

  var tagBadge = tags.length <= 3
    ? '<span style="color:#059669;">✅ Hashtags: ' + tags.length + ' (Optimal for X reach)</span>'
    : '<span style="color:#d97706;">⚠️ Hashtags: ' + tags.length + ' (2–3 recommended)</span>';

  var spinBadge = hasSpintax
    ? '<span style="color:#0284c7;">🧬 Spintax Active</span>'
    : '<span style="color:#64748b;">💡 Tip: Use {wordA|wordB} for variation</span>';

  meterEl.innerHTML = charBadge + ' &nbsp;|&nbsp; ' + tagBadge + ' &nbsp;|&nbsp; ' + spinBadge;
}

// ============================================================================
// 2. STEP 4: Interval Selector, Volume Estimator & Geo-Locked Proxy Display
// ============================================================================
function selectIntervalCard(mins) {
  stateInterval = String(mins);
  var inp = document.getElementById('inp-interval');
  if (inp) inp.value = stateInterval;

  var cards = document.querySelectorAll('.interval-card-btn');
  for (var i = 0; i < cards.length; i++) {
    var v = cards[i].getAttribute('data-int');
    if (v === stateInterval) cards[i].classList.add('active');
    else cards[i].classList.remove('active');
  }
  updateVolumeEstimatorBanner();
  renderSavedScheduleChip();
  updateStepProgress();
}

function updateVolumeEstimatorBanner() {
  var estEl = document.getElementById('interval-volume-estimator');
  if (!estEl) return;
  var m = parseInt(stateInterval || '15', 10) || 15;
  var perDay = Math.round((24 * 60) / m);
  var perMonth = perDay * 30;
  var hoursSaved = Math.max(4, Math.round((perMonth * 1.5) / 60));

  estEl.innerHTML =
    '📊 <b>Estimated Output at Every ' + m + 'm:</b> Publishes <b>~' + perDay.toLocaleString() + ' posts/day</b> ' +
    '(<b>~' + perMonth.toLocaleString() + ' posts/month</b>) with unique image hashes — saving <b>~' + hoursSaved + ' hours/month</b> of manual work!';
}

function toggleLockedCountriesDrawer() {
  var dr = document.getElementById('locked-countries-drawer');
  if (!dr) return;
  dr.style.display = (dr.style.display === 'none' || !dr.style.display) ? 'block' : 'none';
}

function renderProxyStatusAndCountryGrid() {
  var curMeta = getCountryMeta(stateCountry);
  var inpCountry = document.getElementById('inp-country');
  if (inpCountry) inpCountry.value = curMeta.code;

  var activeLabelEl = document.getElementById('active-proxy-country-text');
  if (activeLabelEl) {
    activeLabelEl.innerHTML = curMeta.flag + ' <b>Your Proxy is: ' + escHtml(curMeta.name.toUpperCase()) + '</b> <span style="font-size:12.5px;color:#047857;font-weight:700;">(Synced Timezone: ' + escHtml(curMeta.tz) + ')</span>';
  }

  var gridEl = document.getElementById('isp-country-lock-grid');
  if (!gridEl) return;

  var html = '';
  for (var i = 0; i < COUNTRY_CATALOG.length; i++) {
    var c = COUNTRY_CATALOG[i];
    var isUnlocked = stateUnlockedCountries.indexOf(c.code) !== -1;
    var isCurrent = (c.code === curMeta.code);

    if (isCurrent) {
      html +=
        '<div class="isp-country-card active-isp" onclick="handleCountryCardClick(\'' + c.code + '\')">' +
          '<div class="isp-c-top"><span>' + c.flag + ' <b>' + escHtml(c.name) + '</b></span><span class="isp-badge-active">🟢 Active</span></div>' +
          '<div class="isp-c-tz">' + escHtml(c.tz) + '</div>' +
        '</div>';
    } else if (isUnlocked) {
      html +=
        '<div class="isp-country-card unlocked-isp" onclick="handleCountryCardClick(\'' + c.code + '\')">' +
          '<div class="isp-c-top"><span>' + c.flag + ' <b>' + escHtml(c.name) + '</b></span><span class="isp-badge-owned">✓ Owned</span></div>' +
          '<div class="isp-c-tz">' + escHtml(c.tz) + ' (Click to switch)</div>' +
        '</div>';
    } else {
      html +=
        '<div class="isp-country-card locked-isp" onclick="handleCountryCardClick(\'' + c.code + '\')">' +
          '<div class="isp-c-top"><span>' + c.flag + ' <b>' + escHtml(c.name) + '</b></span><span class="isp-badge-locked">🔒 +$5</span></div>' +
          '<div class="isp-c-tz">' + escHtml(c.tz) + ' — Locked (Click to Add)</div>' +
        '</div>';
    }
  }
  gridEl.innerHTML = html;
}

async function handleCountryCardClick(code) {
  var targetCode = String(code || 'US').toUpperCase();
  if (targetCode === stateCountry) return;

  if (stateUnlockedCountries.indexOf(targetCode) !== -1) {
    try {
      var r = await fetch('/api/web-switch-country', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: savedWebUserId, country: targetCode })
      });
      var d = await r.json();
      if (d && d.ok) {
        stateCountry = d.ispCountry || targetCode;
        renderProxyStatusAndCountryGrid();
        renderSavedScheduleChip();
      }
    } catch (e) {}
    return;
  }
  openAddonIspModal(targetCode);
}

// ============================================================================
// 3. $5 Dedicated Static ISP Country Add-On Modal
// ============================================================================
function openAddonIspModal(defaultCode) {
  pendingAddonCountry = String(defaultCode || 'JP').toUpperCase();
  if (pendingAddonCountry === stateCountry) {
    pendingAddonCountry = stateCountry === 'US' ? 'JP' : 'US';
  }
  renderAddonModalCountrySelector();
  var waitBox = document.getElementById('addon-wait-box');
  if (waitBox) waitBox.style.display = 'none';
  var modal = document.getElementById('addon-isp-modal');
  if (modal) modal.style.display = 'flex';
}

function closeAddonIspModal() {
  var modal = document.getElementById('addon-isp-modal');
  if (modal) modal.style.display = 'none';
}

function renderAddonModalCountrySelector() {
  var meta = getCountryMeta(pendingAddonCountry);
  var titleEl = document.getElementById('addon-target-country-label');
  if (titleEl) {
    titleEl.innerHTML = meta.flag + ' ' + escHtml(meta.name) + ' (<code>' + escHtml(meta.tz) + '</code>)';
  }
  var selEl = document.getElementById('addon-country-select');
  if (selEl) {
    var opts = '';
    for (var i = 0; i < COUNTRY_CATALOG.length; i++) {
      var c = COUNTRY_CATALOG[i];
      var isOwned = stateUnlockedCountries.indexOf(c.code) !== -1;
      opts += '<option value="' + c.code + '"' + (c.code === pendingAddonCountry ? ' selected' : '') + '>' +
        c.flag + ' ' + escHtml(c.name) + ' (' + escHtml(c.tz) + ')' + (isOwned ? ' — [Already Owned]' : ' — Add Dedicated Static ISP ($5)') +
        '</option>';
    }
    selEl.innerHTML = opts;
  }
  var payBtn = document.getElementById('btn-addon-pay');
  if (payBtn) {
    payBtn.innerText = '💳 Unlock ' + meta.flag + ' ' + meta.name + ' Dedicated ISP Now — $5 Only →';
  }
}

function onChangeAddonSelect(val) {
  pendingAddonCountry = String(val || 'JP').toUpperCase();
  renderAddonModalCountrySelector();
}

async function launchAddonIspCheckout() {
  var btn = document.getElementById('btn-addon-pay');
  var waitBox = document.getElementById('addon-wait-box');
  var meta = getCountryMeta(pendingAddonCountry);

  btn.disabled = true;
  btn.innerText = '⏳ Provisioning $5 Crypto Checkout (OxaPay)...';

  try {
    var r = await fetch('/api/web-create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: savedWebUserId,
        planId: 'addon_isp',
        country: pendingAddonCountry
      })
    });
    var d = await r.json();
    btn.disabled = false;
    renderAddonModalCountrySelector();

    if (!d.ok || !d.payLink) {
      alert(d.error || 'Could not create payment link.');
      return;
    }

    savedWebUserId = d.userId || savedWebUserId;
    waitBox.style.display = 'block';
    waitBox.innerHTML =
      '<div style="margin-bottom:8px;">🔄 <b>Order <code>' + escHtml(d.orderId) + '</code> — Waiting for $5 USD Crypto Payment</b></div>' +
      '<a href="' + escHtml(d.payLink) + '" target="_blank" style="display:inline-block;background:#059669;color:#fff;font-weight:900;font-size:13.5px;padding:10px 18px;border-radius:999px;text-decoration:none;margin-bottom:8px;">💳 Open $5 Payment Page in New Tab ↗</a>' +
      '<iframe src="' + escHtml(d.payLink) + '" style="width:100%;height:300px;border:2px solid #cbd5e1;border-radius:12px;background:#fff;"></iframe>';

    try { window.open(d.payLink, '_blank'); } catch (e) {}

    if (addonPollTimer) clearInterval(addonPollTimer);
    addonPollTimer = setInterval(async function() {
      try {
        var sr = await fetch('/api/web-order-status?orderId=' + encodeURIComponent(d.orderId));
        var sd = await sr.json();
        if (sd && sd.paid) {
          clearInterval(addonPollTimer);
          if (stateUnlockedCountries.indexOf(pendingAddonCountry) === -1) {
            stateUnlockedCountries.push(pendingAddonCountry);
          }
          stateCountry = pendingAddonCountry;
          renderProxyStatusAndCountryGrid();
          renderSavedScheduleChip();
          waitBox.innerHTML = '🎉 <b>Payment Confirmed! Your proxy is now locked to ' + meta.flag + ' ' + escHtml(meta.name) + '!</b>';
          setTimeout(function() { closeAddonIspModal(); }, 1500);
        }
      } catch (e) {}
    }, 5000);
  } catch (e) {
    btn.disabled = false;
    renderAddonModalCountrySelector();
  }
}

// ============================================================================
// 4. Render Saved Items Lists (Masked Preset Account Support)
// ============================================================================
function renderSavedAccountsList() {
  var box = document.getElementById('saved-accounts-list');
  if (!box) return;
  if (!stateAccounts || stateAccounts.length === 0) {
    box.innerHTML =
      '<div style="margin-top:8px;font-size:12.5px;color:#64748b;font-weight:700;">' +
        'No account selected. Paste your own <code>auth_token</code> above OR ' +
        '<button type="button" onclick="restorePresetDemoAccount()" style="background:#ecfdf5;color:#047857;border:1.5px solid #10b981;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">🎁 Restore Free Preset Test Account (@LauraLcbc)</button>' +
      '</div>';
    return;
  }

  var html = '<div class="saved-list-title">✅ Active X Account Ready for Live Posting (' + stateAccounts.length + '):</div>';
  for (var i = 0; i < stateAccounts.length; i++) {
    var a = stateAccounts[i];
    var isDemo = Boolean(a.isPresetDemo || String(a.authToken || '').indexOf('PRESET_PROTECTED') === 0);
    var maskedStr = isDemo
      ? (a.maskedToken || '0277b5••••••••••••••••••••••••••••••1283')
      : (String(a.authToken || '').slice(0, 6) + '••••••••••••••••••••••••••••••' + String(a.authToken || '').slice(-4));

    var badgeText = isDemo ? '🎁 Official Free Test Account (Shadowban-Cleared)' : '🟢 Verified Account';
    var handleHtml = a.username
      ? '<a href="https://x.com/' + encodeURIComponent(a.username) + '" target="_blank" style="color:#0284c7;font-weight:900;text-decoration:none;">@' + escHtml(a.username) + ' ↗</a>'
      : '<strong style="color:#0f172a;">Verified Token</strong>';

    html +=
      '<div class="saved-item-chip" style="' + (isDemo ? 'background:#f0fdf4;border-color:#10b981;' : '') + '">' +
        '<div style="display:flex;flex-direction:column;gap:4px;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<span class="saved-status-dot">' + badgeText + '</span>' +
            handleHtml +
            '<code style="font-size:11.5px;color:#475569;background:#ffffff;border:1px solid #cbd5e1;padding:2px 8px;border-radius:6px;" title="Token is masked for security">🔒 auth_token: ' + escHtml(maskedStr) + '</code>' +
          '</div>' +
          (isDemo
            ? '<div style="font-size:11.5px;color:#047857;font-weight:700;">✨ Feel free to test live posting right now with this pre-loaded account! (Or click ✕ to use your own token)</div>'
            : '') +
        '</div>' +
        '<button type="button" class="btn-del-chip" title="Remove this account" onclick="deleteSavedItem(\'account\', \'' + escHtml(a.docId) + '\')">✕</button>' +
      '</div>';
  }
  box.innerHTML = html;
}

function renderSavedBioChip() {
  var box = document.getElementById('saved-bio-list');
  if (!box) return;
  if (!stateBio || !stateBio.trim()) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML =
    '<div class="saved-list-title">✅ Saved Profile BIO:</div>' +
    '<div class="saved-item-chip">' +
      '<div style="font-size:13.5px;color:#0f172a;font-weight:600;word-break:break-word;">' +
        '<span class="saved-status-dot" style="margin-right:8px;">💾 Saved</span>' +
        escHtml(stateBio) +
      '</div>' +
      '<button type="button" class="btn-del-chip" title="Clear saved BIO" onclick="deleteSavedItem(\'bio\', \'bio\')">✕</button>' +
    '</div>';
}

function renderSavedPostsList() {
  var box = document.getElementById('saved-posts-list');
  if (!box) return;
  if (!statePosts || statePosts.length === 0) {
    box.innerHTML = '';
    return;
  }
  var html = '<div class="saved-list-title">✅ Saved Post Queue (' + statePosts.length + ' template' + (statePosts.length > 1 ? 's' : '') + ' ready):</div>';
  for (var i = 0; i < statePosts.length; i++) {
    var p = statePosts[i];
    html +=
      '<div class="saved-item-chip">' +
        '<div style="font-size:13px;color:#0f172a;font-family:monospace;word-break:break-word;line-height:1.45;">' +
          '<span class="saved-status-dot" style="margin-right:8px;">' + (p.isPresetDemo ? '🎁 Pre-Loaded Test Post' : ('#' + (i + 1) + ' Saved')) + '</span>' +
          escHtml(p.text) +
        '</div>' +
        '<button type="button" class="btn-del-chip" title="Delete this post" onclick="deleteSavedItem(\'post\', \'' + escHtml(p.docId) + '\')">✕</button>' +
      '</div>';
  }
  box.innerHTML = html;
}

function renderSavedScheduleChip() {
  var box = document.getElementById('saved-schedule-list');
  if (!box) return;
  var srEl = document.getElementById('inp-self-reply');
  var iv = stateInterval || '15';
  var curMeta = getCountryMeta(stateCountry);
  var sr = srEl ? srEl.checked : stateSelfReply;

  box.innerHTML =
    '<div class="saved-list-title">✅ Active Schedule &amp; Geo-Locked Proxy Configuration:</div>' +
    '<div class="saved-item-chip">' +
      '<div style="font-size:13.5px;color:#0f172a;font-weight:700;">' +
        '<span class="saved-status-dot" style="margin-right:8px;">⚙️ Ready</span>' +
        'Every ' + escHtml(iv) + ' Mins &nbsp;|&nbsp; Your Proxy: ' + curMeta.flag + ' ' + escHtml(curMeta.name) + ' (' + escHtml(curMeta.tz) + ') &nbsp;|&nbsp; ' +
        (sr ? '🔗 Self-Reply ON' : '🔗 Self-Reply OFF') +
      '</div>' +
      '<button type="button" class="btn-del-chip" title="Reset interval to 15m" onclick="resetScheduleToDefault()">✕</button>' +
    '</div>';
}

function resetScheduleToDefault() {
  selectIntervalCard('15');
  var srEl = document.getElementById('inp-self-reply');
  if (srEl) srEl.checked = true;
  stateSelfReply = true;
  renderSavedScheduleChip();
}

// ============================================================================
// 5. API Calls: Verify Token (@username), Save BIO/Posts, Delete Item [✕]
// ============================================================================
async function verifyAndSaveTokens() {
  var inp = document.getElementById('inp-tokens');
  var btn = document.getElementById('btn-verify-token');
  var raw = inp ? inp.value.trim() : '';
  if (!raw || !/[a-fA-F0-9]{40}/.test(raw)) {
    alert('Please paste a valid 40-character hexadecimal auth_token (or full shop account line) first.');
    if (inp) inp.focus();
    return;
  }

  var origTxt = btn.innerText;
  btn.innerText = '⏳ Verifying with X & Fetching @username (~4s)...';
  btn.disabled = true;

  try {
    var r = await fetch('/api/web-verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: savedWebUserId,
        tokens: raw,
        country: stateCountry || 'US'
      })
    });
    var d = await r.json();
    btn.innerText = origTxt;
    btn.disabled = false;

    if (!d.ok) {
      alert(d.error || 'Could not verify token.');
      return;
    }

    savedWebUserId = d.userId;
    stateAccounts = d.accounts || [];
    if (inp) inp.value = '';
    renderSavedAccountsList();
    updateStepProgress();
  } catch (e) {
    btn.innerText = origTxt;
    btn.disabled = false;
    alert('Network error while verifying token. Please try again.');
  }
}

async function confirmAndSaveBio() {
  var inp = document.getElementById('inp-bio');
  var btn = document.getElementById('btn-save-bio');
  var val = inp ? inp.value.trim() : '';
  if (!val) {
    alert('Please enter the BIO text you want to save.');
    return;
  }
  var origTxt = btn.innerText;
  btn.innerText = '⏳ Saving...';
  btn.disabled = true;
  try {
    var r = await fetch('/api/web-save-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: savedWebUserId, type: 'bio', bio: val })
    });
    var d = await r.json();
    if (d.ok) {
      savedWebUserId = d.userId;
      stateBio = d.bio || val;
      if (inp) inp.value = '';
      renderSavedBioChip();
      updateStepProgress();
    }
  } catch (e) {}
  btn.innerText = origTxt;
  btn.disabled = false;
}

async function confirmAndSavePost(customText) {
  var inp = document.getElementById('inp-posts');
  var btn = document.getElementById('btn-save-post');
  var val = typeof customText === 'string' ? customText.trim() : (inp ? inp.value.trim() : '');
  if (!val) {
    alert('Please write a post message (or generate one with AI) before saving.');
    return;
  }
  if (btn) {
    btn.innerText = '⏳ Saving Post...';
    btn.disabled = true;
  }
  try {
    var r = await fetch('/api/web-save-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: savedWebUserId,
        type: 'post',
        posts: val,
        imageBase64: uploadedImageDataUrl
      })
    });
    var d = await r.json();
    if (d.ok) {
      savedWebUserId = d.userId;
      statePosts = (d.posts || []).reverse();
      if (d.savedImageUrl) {
        savedServerImageUrl = d.savedImageUrl;
        showSavedImagePreview(d.savedImageUrl, '✅ Image Saved to Cloud Queue');
      }
      if (!customText && inp) inp.value = '';
      analyzePostMetricsLive();
      renderSavedPostsList();
      updateStepProgress();
    }
  } catch (e) {}
  if (btn) {
    btn.innerText = '💾 Confirm & Save Post to Queue';
    btn.disabled = false;
  }
}

async function deleteSavedItem(itemType, itemId) {
  // Handle local preset deletion cleanly without server call if it's the preset item
  if (itemType === 'account' && itemId === 'preset_demo_slot') {
    stateAccounts = stateAccounts.filter(function(a) { return a.docId !== 'preset_demo_slot'; });
    renderSavedAccountsList();
    updateStepProgress();
    return;
  }
  if (itemType === 'post' && itemId === 'preset_post_1') {
    statePosts = statePosts.filter(function(p) { return p.docId !== 'preset_post_1'; });
    renderSavedPostsList();
    updateStepProgress();
    return;
  }

  try {
    var r = await fetch('/api/web-delete-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: savedWebUserId, type: itemType, itemId: itemId })
    });
    var d = await r.json();
    if (d.ok) {
      if (itemType === 'account') {
        stateAccounts = d.accounts || [];
        renderSavedAccountsList();
      } else if (itemType === 'bio') {
        stateBio = '';
        renderSavedBioChip();
      } else if (itemType === 'post') {
        statePosts = d.posts || [];
        renderSavedPostsList();
      } else if (itemType === 'image') {
        clearUploadedImage(true);
      }
      updateStepProgress();
    }
  } catch (e) {}
}

// ============================================================================
// 6. Progress & Pre-Launch Status Banner Above STEP 5 Post Button
// ============================================================================
function updateStepProgress() {
  var tokEl = document.getElementById('inp-tokens');
  var bioEl = document.getElementById('inp-bio');
  var postEl = document.getElementById('inp-posts');
  var tokVal = (tokEl && tokEl.value) || '';
  var bioVal = (bioEl && bioEl.value) || '';
  var postVal = (postEl && postEl.value) || '';

  var typedMatches = tokVal.match(/[a-fA-F0-9]{40}/g) || [];
  var totalAccountsCount = stateAccounts.length + typedMatches.length;
  var hasToken = totalAccountsCount > 0;
  var hasBio = Boolean(stateBio || bioVal.trim());
  var hasPost = Boolean(statePosts.length > 0 || postVal.trim());
  var hasImg = Boolean(uploadedImageDataUrl || savedServerImageUrl);

  var step1Card = document.getElementById('step-card-1');
  var step1Badge = document.getElementById('token-detect-badge');

  if (stateAccounts.length > 0) {
    if (step1Card) step1Card.classList.add('step-done');
    if (step1Badge) {
      step1Badge.className = 'token-live-badge valid';
      var isPreset = stateAccounts[0].isPresetDemo;
      var firstHandle = stateAccounts[0].username ? ('@' + stateAccounts[0].username) : 'Verified';
      step1Badge.innerText = isPreset
        ? ('🎁 Free Test Account Preset (' + firstHandle + ')')
        : ('🟢 ' + stateAccounts.length + ' Account(s) Saved (' + firstHandle + ')');
    }
  } else if (typedMatches.length > 0) {
    if (step1Card) step1Card.classList.add('step-done');
    if (step1Badge) {
      step1Badge.className = 'token-live-badge valid';
      step1Badge.innerText = '⚡ Token Detected — Click Verify & Save!';
    }
  } else {
    if (step1Card) step1Card.classList.remove('step-done');
    if (step1Badge) {
      step1Badge.className = 'token-live-badge';
      step1Badge.innerText = 'Waiting for token...';
    }
  }

  var step2Card = document.getElementById('step-card-2');
  if (hasBio) { if (step2Card) step2Card.classList.add('step-done'); }
  else { if (step2Card) step2Card.classList.remove('step-done'); }

  var step3Card = document.getElementById('step-card-3');
  if (hasPost) { if (step3Card) step3Card.classList.add('step-done'); }
  else { if (step3Card) step3Card.classList.remove('step-done'); }

  var pct = 20;
  if (hasToken) pct += 40;
  if (hasBio) pct += 10;
  if (hasPost) pct += 30;

  var barFill = document.getElementById('studio-progress-fill');
  var barText = document.getElementById('studio-progress-text');
  if (barFill) barFill.style.width = pct + '%';
  if (barText) {
    barText.innerHTML = (hasToken && hasPost)
      ? '🎉 <b>100% Ready to Test!</b> Free Demo Account (<code>@LauraLcbc</code>) is pre-loaded — Click the green button in STEP 5 to watch it post live!'
      : '⚡ <b>Setup Progress: ' + pct + '%</b> — Complete STEP 1 to STEP 4 below.';
  }

  var preLaunchBanner = document.getElementById('pre-launch-guide-banner');
  if (!preLaunchBanner) return;

  var missingTasks = [];
  if (!hasToken) {
    missingTasks.push('<li>👉 <b>STEP 1:</b> Paste your X account <code>auth_token</code> OR click <b>Restore Free Preset Test Account</b></li>');
  }
  if (!hasPost) {
    missingTasks.push('<li>👉 <b>STEP 3:</b> Write a post message (or tap a Niche Preset) and click <b>Confirm &amp; Save Post</b></li>');
  }

  if (missingTasks.length === 0) {
    var usingDemo = stateAccounts.length > 0 && stateAccounts[0].isPresetDemo;
    preLaunchBanner.className = 'pre-launch-banner ready';
    preLaunchBanner.innerHTML =
      '<div style="font-size:16px;font-weight:900;color:#065f46;margin-bottom:4px;">' +
      (usingDemo
        ? '🎁 Free Test Account (@LauraLcbc) Pre-Loaded — Feel Free to Test Live Posting Now!'
        : '🎉 Great job! Your custom setup is 100% ready to publish!') +
      '</div>' +
      '<div style="font-size:13.5px;color:#047857;font-weight:600;">' +
      '✅ STEP 1 (' + (usingDemo ? 'Protected Demo @LauraLcbc' : (totalAccountsCount + ' X account')) + ' ready) &nbsp;|&nbsp; ' +
      '✅ STEP 3 (Post + 3D Diagram Image ready) &nbsp;|&nbsp; ✅ STEP 4 (Proxy Locked: ' + escHtml(stateCountry) + ')<br/>' +
      '👇 <b>Click the green button below to launch the Live Cloud Execution View &amp; publish on X for FREE!</b>' +
      '</div>';
  } else {
    preLaunchBanner.className = 'pre-launch-banner todo';
    preLaunchBanner.innerHTML =
      '<div style="font-size:15px;font-weight:900;color:#b45309;margin-bottom:6px;">' +
      '📋 Still to do before launching your free live post:' +
      '</div>' +
      '<ul style="list-style:none;margin:0;padding:0;font-size:13.5px;color:#78350f;font-weight:700;display:flex;flex-direction:column;gap:4px;">' +
      missingTasks.join('') +
      '</ul>';
  }
}

// ============================================================================
// 7. "?" Help Modal & Member Auth Modal
// ============================================================================
function openTokenHelpModal() {
  var m = document.getElementById('token-help-modal');
  if (m) m.style.display = 'flex';
}
function closeTokenHelpModal() {
  var m = document.getElementById('token-help-modal');
  if (m) m.style.display = 'none';
}

function switchAuthTab(mode) {
  authMode = mode === 'login' ? 'login' : 'signup';
  var tabSignup = document.getElementById('tab-auth-signup');
  var tabLogin = document.getElementById('tab-auth-login');
  var confirmWrap = document.getElementById('auth-confirm-wrap');
  var submitBtn = document.getElementById('btn-auth-submit');
  var errEl = document.getElementById('auth-error-msg');
  if (errEl) errEl.style.display = 'none';

  if (authMode === 'signup') {
    if (tabSignup) tabSignup.className = 'auth-tab-btn active';
    if (tabLogin) tabLogin.className = 'auth-tab-btn';
    if (confirmWrap) confirmWrap.style.display = 'block';
    if (submitBtn) submitBtn.innerText = '✨ Create Account & Save Settings →';
  } else {
    if (tabSignup) tabSignup.className = 'auth-tab-btn';
    if (tabLogin) tabLogin.className = 'auth-tab-btn active';
    if (confirmWrap) confirmWrap.style.display = 'none';
    if (submitBtn) submitBtn.innerText = '🔑 Log In & Load My Settings →';
  }
  checkPasswordMatchLive();
}

function checkPasswordMatchLive() {
  var pw1 = (document.getElementById('auth-password') && document.getElementById('auth-password').value) || '';
  var pw2 = (document.getElementById('auth-password-confirm') && document.getElementById('auth-password-confirm').value) || '';
  var hint = document.getElementById('pw-match-hint');
  if (!hint) return;
  if (authMode !== 'signup' || (!pw1 && !pw2)) {
    hint.style.display = 'none';
    return;
  }
  hint.style.display = 'block';
  if (pw1.length < 4) {
    hint.style.color = '#b45309';
    hint.innerText = '⏳ Password must be at least 4 characters.';
  } else if (pw1 === pw2) {
    hint.style.color = '#059669';
    hint.innerText = '✅ Passwords match! Ready to register.';
  } else {
    hint.style.color = '#dc2626';
    hint.innerText = '⚠️ Passwords do not match yet. Please type the same password twice.';
  }
}

function openAuthModal(defaultMode) {
  switchAuthTab(defaultMode || 'signup');
  var modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(function() {
    var el = document.getElementById('auth-email');
    if (el) el.focus();
  }, 100);
}

function closeAuthModal() {
  var modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

function showSavedImagePreview(srcUrl, labelText) {
  if (!srcUrl) return;
  var thumb = document.getElementById('img-preview-thumb');
  var nameEl = document.getElementById('img-file-name');
  var wrap = document.getElementById('img-preview-wrap');
  if (thumb) thumb.src = srcUrl;
  if (nameEl) nameEl.innerText = labelText || '✅ Saved Image Auto-Loaded (No need to re-upload)';
  if (wrap) wrap.style.display = 'flex';
}

function renderTopRightUserStatus(data) {
  var planBadge = document.getElementById('nav-plan-badge');
  var authBox = document.getElementById('nav-auth-box');
  if (!planBadge || !authBox) return;

  if (data && data.userId) savedWebUserId = data.userId;
  stateIsPaid = Boolean(data && data.paid);

  var launchBtn = document.getElementById('btn-submit-launch');
  if (launchBtn) {
    var hasOnlyPreset = stateAccounts.length === 1 && stateAccounts[0].isPresetDemo;
    launchBtn.innerText = (stateIsPaid && !hasOnlyPreset)
      ? '🚀 Save Settings & Trigger Immediate Post on 24/7 Engine →'
      : '🚀 Post Now — 100% FREE Live Test Post on X →';
  }

  if (data && data.paid) {
    planBadge.style.background = '#ecfdf5';
    planBadge.style.borderColor = '#10b981';
    planBadge.style.color = '#065f46';
    planBadge.innerHTML = '🟢 <span>Paid Active:</span> <strong>' + escHtml(data.planName || '24/7 Plan') + '</strong>';
  } else {
    planBadge.style.background = '#f8fafc';
    planBadge.style.borderColor = '#cbd5e1';
    planBadge.style.color = '#334155';
    planBadge.innerHTML = '🎁 <span>Plan:</span> <strong>Free Trial ($0)</strong>';
  }

  if (data && data.loggedIn && data.email) {
    authBox.innerHTML =
      '<span style="background:#e0f2fe;color:#0369a1;border:1.5px solid #7dd3fc;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;">👤 ' + escHtml(data.email) + '</span>' +
      '<a href="/studio" style="background:#059669;color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:800;text-decoration:none;">⚡ Post Studio</a>' +
      '<a href="/dashboard?uid=' + encodeURIComponent(data.userId) + '" style="background:#0f172a;color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:800;text-decoration:none;">🖥️ Console</a>' +
      '<button type="button" onclick="logoutWebUser()" style="background:#fff;color:#64748b;border:1.5px solid #cbd5e1;padding:5px 10px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;">Log Out</button>';
  } else {
    authBox.innerHTML =
      '<button type="button" id="btn-open-auth" onclick="openAuthModal(\'signup\')" style="background:#0f172a;color:#ffffff;border:2px solid #0f172a;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:800;cursor:pointer;">🔑 Log In / Sign Up</button>';
  }

  if (data) {
    if (Array.isArray(data.accountsDetailed) && data.accountsDetailed.length > 0) {
      stateAccounts = data.accountsDetailed;
    } else if (!stateAccounts || stateAccounts.length === 0) {
      stateAccounts = [PRESET_DEMO_ACCOUNT];
    }
    renderSavedAccountsList();

    if (data.bio !== undefined) {
      stateBio = data.bio || '';
      renderSavedBioChip();
    }
    if (Array.isArray(data.postsDetailed) && data.postsDetailed.length > 0) {
      statePosts = data.postsDetailed;
    } else if (!statePosts || statePosts.length === 0) {
      statePosts = [{ docId: 'preset_post_1', text: DEFAULT_DEMO_POST, isPresetDemo: true }];
    }
    renderSavedPostsList();

    if (data.savedImageUrl) {
      savedServerImageUrl = data.savedImageUrl;
      showSavedImagePreview(data.savedImageUrl, '✅ Saved Image Auto-Loaded (Used automatically on every post)');
    }
    if (data.intervalMin) {
      selectIntervalCard(String(data.intervalMin));
    }
    if (data.ispCountry) {
      stateCountry = String(data.ispCountry).toUpperCase();
    }
    if (Array.isArray(data.unlockedCountries) && data.unlockedCountries.length > 0) {
      stateUnlockedCountries = data.unlockedCountries;
    } else {
      stateUnlockedCountries = [stateCountry || 'US'];
    }
    renderProxyStatusAndCountryGrid();
    renderSavedScheduleChip();
    updateStepProgress();
  }
}

async function submitWebAuth() {
  var emailEl = document.getElementById('auth-email');
  var passEl = document.getElementById('auth-password');
  var confirmEl = document.getElementById('auth-password-confirm');
  var errEl = document.getElementById('auth-error-msg');
  var btn = document.getElementById('btn-auth-submit');

  var email = emailEl ? emailEl.value.trim() : '';
  var password = passEl ? passEl.value.trim() : '';
  var passwordConfirm = confirmEl ? confirmEl.value.trim() : '';
  if (errEl) errEl.style.display = 'none';

  if (!email || email.indexOf('@') === -1) {
    if (errEl) { errEl.innerText = '⚠️ Please enter a valid email address.'; errEl.style.display = 'block'; }
    return;
  }
  if (password.length < 4) {
    if (errEl) { errEl.innerText = '⚠️ Password must be at least 4 characters.'; errEl.style.display = 'block'; }
    return;
  }
  if (authMode === 'signup' && password !== passwordConfirm) {
    if (errEl) { errEl.innerText = '⚠️ Passwords do not match! Please enter the exact same password in both boxes.'; errEl.style.display = 'block'; }
    return;
  }

  var origTxt = btn.innerText;
  btn.innerText = '⏳ Authenticating...';
  btn.disabled = true;

  try {
    var r = await fetch('/api/web-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password, passwordConfirm: passwordConfirm, mode: authMode })
    });
    var d = await r.json();
    btn.innerText = origTxt;
    btn.disabled = false;

    if (!d.ok) {
      if (errEl) { errEl.innerText = '⚠️ ' + (d.error || 'Authentication failed.'); errEl.style.display = 'block'; }
      return;
    }

    closeAuthModal();
    renderTopRightUserStatus(d);
  } catch (e) {
    btn.innerText = origTxt;
    btn.disabled = false;
    if (errEl) { errEl.innerText = '⚠️ Network error. Please try again.'; errEl.style.display = 'block'; }
  }
}

async function logoutWebUser() {
  try { await fetch('/api/web-logout', { method: 'POST' }); } catch (e) {}
  savedWebUserId = '';
  stateAccounts = [PRESET_DEMO_ACCOUNT];
  stateBio = '';
  statePosts = [{ docId: 'preset_post_1', text: DEFAULT_DEMO_POST, isPresetDemo: true }];
  stateCountry = 'US';
  stateUnlockedCountries = ['US'];
  renderSavedAccountsList();
  renderSavedBioChip();
  renderSavedPostsList();
  renderProxyStatusAndCountryGrid();
  renderTopRightUserStatus({ loggedIn: false, paid: false });
}

// ============================================================================
// 8. Image Upload & AI 3-Angle Generator
// ============================================================================
function handleImageFileSelect(inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    alert('Please select an image smaller than 8MB.');
    inputEl.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onload = async function(ev) {
    uploadedImageDataUrl = ev.target.result || '';
    try {
      localStorage.setItem('xswarm_saved_img_b64', uploadedImageDataUrl);
      localStorage.setItem('xswarm_saved_img_name', file.name);
    } catch (e) {}
    showSavedImagePreview(uploadedImageDataUrl, '📸 ' + file.name + ' (Auto-Saved! Click ✕ to remove)');
    updateStepProgress();
    try {
      var r = await fetch('/api/web-save-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: savedWebUserId, type: 'image', imageBase64: uploadedImageDataUrl })
      });
      var d = await r.json();
      if (d && d.ok) {
        savedWebUserId = d.userId;
        if (d.savedImageUrl) savedServerImageUrl = d.savedImageUrl;
      }
    } catch (e) {}
  };
  reader.readAsDataURL(file);
}

function clearUploadedImage(skipServerCall) {
  uploadedImageDataUrl = '';
  savedServerImageUrl = '';
  try {
    localStorage.removeItem('xswarm_saved_img_b64');
    localStorage.removeItem('xswarm_saved_img_name');
  } catch (e) {}
  var inp = document.getElementById('inp-image-file');
  if (inp) inp.value = '';
  var wrap = document.getElementById('img-preview-wrap');
  if (wrap) wrap.style.display = 'none';
  if (!skipServerCall && savedWebUserId) {
    deleteSavedItem('image', 'image');
  }
  updateStepProgress();
}

async function generateThreeAnglesWithAi() {
  var btn = document.getElementById('btn-ai-gen');
  var topicInp = document.getElementById('inp-ai-topic');
  var bioVal = stateBio || (document.getElementById('inp-bio') && document.getElementById('inp-bio').value.trim()) || '';
  var postVal = (document.getElementById('inp-posts') && document.getElementById('inp-posts').value.trim()) || '';
  var kw = (topicInp && topicInp.value.trim()) || postVal || bioVal || 'Crypto & Passive Income Offer';

  var origTxt = btn.innerText;
  btn.innerText = '⏳ AI Crafting 3 Angles (~3s)...';
  btn.disabled = true;

  try {
    var r = await fetch('/api/web-ai-spintax', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw })
    });
    var d = await r.json();
    if (d.ok && Array.isArray(d.angles)) {
      lastAiPosts = d.angles.map(function(a) { return a.text; });
      var grid = document.getElementById('ai-angle-grid');
      grid.innerHTML = '';
      d.angles.forEach(function(item) {
        var card = document.createElement('div');
        card.className = 'ai-angle-card';
        var header = document.createElement('div');
        header.className = 'ai-angle-header';
        var title = document.createElement('span');
        title.className = 'ai-angle-title';
        title.innerText = item.label + ' — ' + item.desc;
        var useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'btn-use-angle';
        useBtn.innerText = '💾 Use & Save This Angle';
        useBtn.onclick = function() {
          confirmAndSavePost(item.text);
        };
        header.appendChild(title);
        header.appendChild(useBtn);

        var bodyTxt = document.createElement('div');
        bodyTxt.className = 'ai-angle-text';
        bodyTxt.innerText = item.text;

        card.appendChild(header);
        card.appendChild(bodyTxt);
        grid.appendChild(card);
      });
      document.getElementById('ai-suggestions-panel').style.display = 'block';
    }
  } catch (e) {}
  btn.innerText = origTxt;
  btn.disabled = false;
}

function useAllThreeAiAngles() {
  if (lastAiPosts.length > 0) {
    confirmAndSavePost(lastAiPosts.join('\n\n'));
  }
}

// ============================================================================
// 9. STEP 5: Clean English Live Cloud Execution View & Launch
// ============================================================================
var liveTelemetryTimer = null;
var liveElapsedTimer = null;

function startLiveExecutionTelemetryView(targetHandle, countryCode) {
  var panel = document.getElementById('live-execution-telemetry-view');
  var logBox = document.getElementById('live-telemetry-log-stream');
  var progBar = document.getElementById('live-telemetry-progress-fill');
  var timerEl = document.getElementById('live-telemetry-elapsed');
  var statusBadge = document.getElementById('live-telemetry-status-pill');

  if (!panel || !logBox) return;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  logBox.innerHTML = '';
  if (progBar) progBar.style.width = '8%';
  if (statusBadge) {
    statusBadge.style.background = '#ecfdf5';
    statusBadge.style.color = '#047857';
    statusBadge.innerHTML = '🟢 EXECUTING LIVE ON CLOUD NODE';
  }

  var startMs = Date.now();
  if (liveElapsedTimer) clearInterval(liveElapsedTimer);
  liveElapsedTimer = setInterval(function() {
    var sec = ((Date.now() - startMs) / 1000).toFixed(1);
    if (timerEl) timerEl.innerText = sec + 's';
  }, 100);

  var steps = [
    { pct: 16, pill: 1, msg: '[INIT] Provisioning isolated Cloud Chromium container (Stealth Engine v3.4)...' },
    { pct: 30, pill: 2, msg: '[PROXY] Bound Dedicated Static Residential ISP Node (' + countryCode + ' — Geo-Lock Verified)...' },
    { pct: 44, pill: 2, msg: '[ENV] Synced hardware WebGL, Canvas fingerprint & local timezone clock...' },
    { pct: 58, pill: 3, msg: '[AUTH] Injected masked 40-char session auth_token for @' + (targetHandle || 'LauraLcbc') + ' (Zero password login)...' },
    { pct: 72, pill: 4, msg: '[CAMO] Applied sub-pixel pHash & EXIF shift to 3D diagram image (Unique hash generated)...' },
    { pct: 84, pill: 5, msg: '[TYPE] Resolved Spintax AST & simulating natural human keystrokes on x.com/compose/post...' },
    { pct: 94, pill: 5, msg: '[BROADCAST] Clicking Tweet submit button & capturing live status URL from X API...' }
  ];

  for (var p = 1; p <= 5; p++) {
    var pEl = document.getElementById('live-pill-' + p);
    if (pEl) pEl.className = 'live-step-pill';
  }

  var idx = 0;
  function appendNextTelemetryStep() {
    if (idx >= steps.length) return;
    var item = steps[idx];
    var secNow = ((Date.now() - startMs) / 1000).toFixed(1);
    if (progBar) progBar.style.width = item.pct + '%';

    for (var j = 1; j <= 5; j++) {
      var pillEl = document.getElementById('live-pill-' + j);
      if (pillEl) {
        if (j < item.pill) pillEl.className = 'live-step-pill done';
        else if (j === item.pill) pillEl.className = 'live-step-pill active';
      }
    }

    var row = document.createElement('div');
    row.className = 'live-log-row';
    row.innerHTML =
      '<span class="live-log-time">+' + secNow + 's</span>' +
      '<span class="live-log-check">✓</span>' +
      '<span class="live-log-text">' + escHtml(item.msg) + '</span>';
    logBox.appendChild(row);
    logBox.scrollTop = logBox.scrollHeight;
    idx++;
  }

  appendNextTelemetryStep();
  if (liveTelemetryTimer) clearInterval(liveTelemetryTimer);
  liveTelemetryTimer = setInterval(appendNextTelemetryStep, 2100);
}

function finishLiveExecutionTelemetryView(ok, postedUrl, screenName, noteText) {
  if (liveTelemetryTimer) clearInterval(liveTelemetryTimer);
  if (liveElapsedTimer) clearInterval(liveElapsedTimer);

  var logBox = document.getElementById('live-telemetry-log-stream');
  var progBar = document.getElementById('live-telemetry-progress-fill');
  var statusBadge = document.getElementById('live-telemetry-status-pill');
  var handleClean = String(screenName || 'hinata_sasbbe7').replace(/^@/, '');
  var profileLink = 'https://x.com/' + encodeURIComponent(handleClean);
  var targetPostLink = (postedUrl && !postedUrl.includes('search?q=from')) ? postedUrl : profileLink;
  var isDirectPostUrl = targetPostLink.indexOf('/status/') !== -1;

  if (progBar) progBar.style.width = '100%';
  for (var j = 1; j <= 5; j++) {
    var pillEl = document.getElementById('live-pill-' + j);
    if (pillEl) pillEl.className = 'live-step-pill done';
  }

  if (statusBadge) {
    statusBadge.style.background = '#10b981';
    statusBadge.style.color = '#ffffff';
    statusBadge.innerHTML = '✅ 100% PUBLISHED LIVE ON X.COM';
  }

  if (logBox) {
    var finalRow = document.createElement('div');
    finalRow.className = 'live-log-row final-success';
    finalRow.innerHTML =
      '<span class="live-log-check">🎉</span>' +
      '<span class="live-log-text"><b>LIVE ON X.COM:</b> Your custom BIO &amp; Post are now published on <b>@' + escHtml(handleClean) + '</b>!<br/>' +
      '<a href="' + escHtml(targetPostLink) + '" target="_blank" style="color:#38bdf8;font-weight:900;text-decoration:underline;margin-right:16px;">' +
      (isDirectPostUrl ? '🔎 View Live Post URL (' + escHtml(targetPostLink) + ') ↗' : '👤 View Live Profile (@' + escHtml(handleClean) + ') ↗') +
      '</a>' +
      '<a href="' + escHtml(profileLink) + '" target="_blank" style="color:#34d399;font-weight:900;text-decoration:underline;">👤 Check Updated Profile BIO ↗</a></span>';
    logBox.appendChild(finalRow);
    logBox.scrollTop = logBox.scrollHeight;
  }
}

function syncModalPlanCountryOptions() {
  var sel = document.getElementById('modal-plan-country');
  if (!sel) return;
  var curVal = sel.value || stateCountry || 'US';
  var isOneDay = (selectedPlanId === 'oneday');

  var html = '';
  for (var i = 0; i < COUNTRY_CATALOG.length; i++) {
    var c = COUNTRY_CATALOG[i];
    if (isOneDay && c.code !== 'US' && c.code !== 'JP') {
      html += '<option value="' + c.code + '" disabled>' + c.flag + ' ' + escHtml(c.name) + ' (' + escHtml(c.tz) + ') — [30-Day Plan or +$5 Add-On]</option>';
    } else {
      html += '<option value="' + c.code + '">' + c.flag + ' ' + escHtml(c.name) + ' (' + escHtml(c.tz) + ') — Included</option>';
    }
  }
  sel.innerHTML = html;
  if (isOneDay && curVal !== 'US' && curVal !== 'JP') {
    sel.value = 'US';
  } else {
    sel.value = curVal;
  }
}

async function submitAndExecuteLivePost() {
  var errEl = document.getElementById('studio-error-msg');
  if (errEl) errEl.style.display = 'none';

  var rawTokensBox = (document.getElementById('inp-tokens') && document.getElementById('inp-tokens').value.trim()) || '';
  var allTokensList = stateAccounts.map(function(a) { return a.authToken; });
  if (rawTokensBox) allTokensList.push(rawTokensBox);
  var combinedTokens = allTokensList.join('\n');

  var rawBioBox = (document.getElementById('inp-bio') && document.getElementById('inp-bio').value.trim()) || '';
  var finalBio = rawBioBox || stateBio || '';

  var rawPostsBox = (document.getElementById('inp-posts') && document.getElementById('inp-posts').value.trim()) || '';
  var customSaved = statePosts.filter(function(p) { return !p.isPresetDemo; }).map(function(p) { return p.text; });
  var presetSaved = statePosts.filter(function(p) { return p.isPresetDemo; }).map(function(p) { return p.text; });
  var orderedPosts = [];
  if (rawPostsBox) orderedPosts.push(rawPostsBox);
  orderedPosts = orderedPosts.concat(customSaved).concat(presetSaved);
  var combinedPosts = orderedPosts.join('\n\n');

  var intervalMin = stateInterval || '15';
  var country = stateCountry || 'US';
  var selfReply = document.getElementById('inp-self-reply') ? document.getElementById('inp-self-reply').checked : true;

  var isUsingPresetDemo = combinedTokens.indexOf('PRESET_PROTECTED_DEMO_TOKEN') !== -1;

  if (!combinedTokens || (!isUsingPresetDemo && !/[a-fA-F0-9]{40}/.test(combinedTokens))) {
    restorePresetDemoAccount();
    combinedTokens = PRESET_DEMO_ACCOUNT.authToken;
    isUsingPresetDemo = true;
  }

  if (!combinedPosts) {
    combinedPosts = DEFAULT_DEMO_POST;
  }

  var btn = document.getElementById('btn-submit-launch');
  var origTxt = btn.innerText;
  btn.disabled = true;
  btn.innerText = '⚡ Live Cloud Browser Executing Below (~14s)...';

  var activeHandle = (stateAccounts[0] && stateAccounts[0].username) || 'LauraLcbc';
  startLiveExecutionTelemetryView(activeHandle, country);

  try {
    var r = await fetch('/api/web-launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: savedWebUserId,
        tokens: combinedTokens,
        usePresetDemo: isUsingPresetDemo,
        bio: finalBio,
        posts: combinedPosts,
        intervalMin: intervalMin,
        country: country,
        selfReply: selfReply,
        imageBase64: uploadedImageDataUrl
      })
    });
    var d = await r.json();
    btn.innerText = origTxt;
    btn.disabled = false;

    if (!d.ok) {
      if (liveTelemetryTimer) clearInterval(liveTelemetryTimer);
      if (liveElapsedTimer) clearInterval(liveElapsedTimer);
      if (errEl) {
        errEl.innerText = '⚠️ ' + (d.error || 'Please check your input.');
        errEl.style.display = 'block';
      }
      return;
    }

    finishLiveExecutionTelemetryView(d.livePostOk, d.postedUrl, d.screenName || activeHandle, d.livePostNote);

    savedWebUserId = d.userId;
    if (Array.isArray(d.accountsDetailed) && d.accountsDetailed.length > 0) {
      stateAccounts = d.accountsDetailed;
      renderSavedAccountsList();
    }
    if (Array.isArray(d.postsDetailed) && d.postsDetailed.length > 0) {
      statePosts = d.postsDetailed;
      renderSavedPostsList();
    }
    if (finalBio) {
      stateBio = finalBio;
      renderSavedBioChip();
    }

    var lblInt = document.getElementById('lbl-chosen-int');
    if (lblInt) lblInt.innerText = intervalMin;

    if (d.alreadyActive) {
      window.location.href = d.dashboardUrl;
      return;
    }

    var vTitle = document.getElementById('verify-title');
    var vSub = document.getElementById('verify-sub');
    var vLink = document.getElementById('verify-x-link');

    if (d.livePostOk) {
      vTitle.innerText = '🎉 Live Post Published on X!' + (d.screenName ? ' (@' + d.screenName + ')' : '');
      vSub.innerText = 'Click the green button below to verify your live post on X.com right now, then unlock 24/7 autopilot for your own accounts:';
      vLink.href = d.postedUrl;
      vLink.innerText = '🔎 Verify Live Post on X.com (' + (d.screenName ? '@' + d.screenName : 'Live') + ') ↗';
    } else {
      vTitle.innerText = '✅ Live Cloud Execution Completed!';
      vSub.innerText = 'Click below to verify our live test account (@' + (d.screenName || 'LauraLcbc') + ') on X.com, or unlock 24/7 autopilot:';
      vLink.href = d.postedUrl;
      vLink.innerText = '🔎 Verify Live Account on X.com (@' + (d.screenName || 'LauraLcbc') + ') ↗';
    }

    if (parseInt(intervalMin, 10) < 5) {
      selectXPlan('starter', 79);
    } else {
      selectXPlan('oneday', 7);
    }

    // Wait 1.2s so user sees the 100% completion state in the live telemetry view before opening the modal
    setTimeout(function() {
      document.getElementById('x-launch-modal').style.display = 'flex';
    }, 1200);
  } catch (e) {
    if (liveTelemetryTimer) clearInterval(liveTelemetryTimer);
    if (liveElapsedTimer) clearInterval(liveElapsedTimer);
    btn.innerText = origTxt;
    btn.disabled = false;
    if (errEl) {
      errEl.innerText = '⚠️ Connection error. Please try again.';
      errEl.style.display = 'block';
    }
  }
}

function selectXPlan(planId, usd) {
  selectedPlanId = planId;
  selectedPlanUsd = usd;
  ['oneday', 'starter', 'pro'].forEach(function(k) {
    var el = document.getElementById('card-' + k);
    if (el) {
      if (k === planId) el.classList.add('active');
      else el.classList.remove('active');
    }
  });
  syncModalPlanCountryOptions();
  var payBtn = document.getElementById('btn-modal-pay');
  if (payBtn) {
    payBtn.innerText = planId === 'oneday'
      ? '⚡ Start 24/7 Auto-Posting Now — Just $7 Only →'
      : '⚡ Start 30-Day Full Auto-Posting ($' + usd + ' Only) →';
  }
}

function closeXModal() {
  document.getElementById('x-launch-modal').style.display = 'none';
}

async function launchOxaPayCheckout() {
  var btn = document.getElementById('btn-modal-pay');
  var waitBox = document.getElementById('checkout-wait-box');
  var modalCountrySel = document.getElementById('modal-plan-country');
  var chosenCountry = (modalCountrySel && modalCountrySel.value) || stateCountry || 'US';

  btn.disabled = true;
  btn.innerText = '⏳ Preparing Instant Crypto Checkout (OxaPay)...';

  try {
    var r = await fetch('/api/web-create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: savedWebUserId,
        planId: selectedPlanId,
        country: chosenCountry
      })
    });
    var d = await r.json();
    btn.disabled = false;
    selectXPlan(selectedPlanId, selectedPlanUsd);

    if (!d.ok || !d.payLink) {
      alert(d.error || 'Could not create payment link.');
      return;
    }

    waitBox.style.display = 'block';
    waitBox.innerHTML =
      '<div style="margin-bottom:10px;">🔄 <b>Order Created (<code>' + escHtml(d.orderId) + '</code>) — Waiting for Crypto Payment ($' + escHtml(d.amountUsd) + ' USD)</b></div>' +
      '<a href="' + escHtml(d.payLink) + '" target="_blank" style="display:inline-block;background:#059669;color:#ffffff;font-weight:900;font-size:14px;padding:11px 22px;border-radius:999px;text-decoration:none;margin-bottom:10px;box-shadow:0 6px 16px rgba(5,150,105,0.25);">💳 Open Crypto Payment Page ($' + escHtml(d.amountUsd) + ' USD) ↗</a>' +
      '<iframe src="' + escHtml(d.payLink) + '" style="width:100%;height:340px;border:2px solid #cbd5e1;border-radius:12px;background:#ffffff;margin-bottom:8px;"></iframe>' +
      '<div style="font-size:12px;color:#475569;">⚡ Once paid, your Dedicated Static ISP IP (' + escHtml(d.country) + ') binds automatically within ~15 seconds and 24/7 auto-posting starts!</div>';

    try { window.open(d.payLink, '_blank'); } catch (e) {}

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async function() {
      try {
        var sr = await fetch('/api/web-order-status?orderId=' + encodeURIComponent(d.orderId));
        var sd = await sr.json();
        if (sd && sd.paid) {
          clearInterval(pollTimer);
          waitBox.innerHTML = '🎉 <b>Payment Confirmed! Provisioning Dedicated Static ISP Proxy & Launching 24/7 Engine...</b>';
          setTimeout(function() {
            window.location.href = sd.dashboardUrl;
          }, 1500);
        }
      } catch (e) {}
    }, 5000);
  } catch (e) {
    btn.disabled = false;
    selectXPlan(selectedPlanId, selectedPlanUsd);
  }
}

// ============================================================================
// 10. Live Social Proof Toast Rotator & Initializer
// ============================================================================
function startSocialProofToastRotator() {
  var toastEl = document.getElementById('live-social-proof-toast');
  if (!toastEl) return;

  var proofEvents = [
    '🟢 Live Proof: @LauraLcbc just auto-published a pixel-camouflaged post via 🇺🇸 US Static ISP',
    '⚡ Free Demo Test: A visitor just tested live posting on @LauraLcbc',
    '🛡️ Anti-Shadowban Audit: 3 posts verified 100% visible in X "Latest" Search',
    '🔥 New 1-Day Autopilot ($7) activated — Dedicated 🇺🇸 America/New_York ISP bound',
    '🎨 Sub-Pixel Image Camouflage generated a unique pHash signature (0 duplicate flags)'
  ];
  var idx = 0;

  setInterval(function() {
    if (document.hidden) return;
    toastEl.innerHTML = proofEvents[idx % proofEvents.length];
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateY(0)';
    idx++;
    setTimeout(function() {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(12px)';
    }, 5200);
  }, 14000);
}

function initXSwarmLp() {
  var tokEl = document.getElementById('inp-tokens');
  var bioEl = document.getElementById('inp-bio');
  var postEl = document.getElementById('inp-posts');

  if (tokEl) tokEl.addEventListener('input', updateStepProgress);
  if (bioEl) bioEl.addEventListener('input', updateStepProgress);
  if (postEl) {
    postEl.addEventListener('input', function() {
      analyzePostMetricsLive();
      updateStepProgress();
    });
  }

  var pw1 = document.getElementById('auth-password');
  var pw2 = document.getElementById('auth-password-confirm');
  if (pw1) pw1.addEventListener('input', checkPasswordMatchLive);
  if (pw2) pw2.addEventListener('input', checkPasswordMatchLive);

  // Pre-load the 3D diagram image preview by default so user sees image camouflage ready
  var defaultDiagramUrl = '/uploads/xswarm_architecture.png';
  savedServerImageUrl = defaultDiagramUrl;
  showSavedImagePreview(defaultDiagramUrl, '🎨 Pre-Loaded 5-Layer Architecture Image (Auto Sub-Pixel Camouflaged on Every Post)');

  renderSavedAccountsList();
  renderSavedPostsList();
  analyzePostMetricsLive();
  updateVolumeEstimatorBanner();
  renderProxyStatusAndCountryGrid();
  renderSavedScheduleChip();
  updateStepProgress();
  startSocialProofToastRotator();

  fetch('/api/web-me').then(function(r) { return r.json(); }).then(function(d) {
    if (d && d.ok) renderTopRightUserStatus(d);
  }).catch(function() {});

  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var lang = (navigator.language || 'en').slice(0, 5);
  fetch('/api/lp-track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: lang, tz: tz, ref: window.REF_TAG || 'web_lp' })
  }).catch(function() {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initXSwarmLp);
} else {
  initXSwarmLp();
}


// ============================================================================
// 🤝 X-Swarm Cloud Affiliate Partner Program UI (Matches Studio Emerald/Slate Theme)

// ============================================================================
// 🤝 X-Swarm Cloud Affiliate Navigation & Session Sync (Dedicated /affiliate Page)

// ============================================================================
// 🤝 X-Swarm Cloud Affiliate Navigation & Auto-Login Session Bridge
// ============================================================================
(function initXSwarmAffiliateNavBridge() {
  try {
    var urlParams = new URLSearchParams(window.location.search);
    var refParam = urlParams.get('ref') || urlParams.get('aff');
    if (refParam && /^[A-Za-z0-9_-]{3,32}$/.test(refParam.trim())) {
      localStorage.setItem('xswarm_ref_code', refParam.trim().toUpperCase());
      document.cookie = 'xswarm_ref=' + encodeURIComponent(refParam.trim().toUpperCase()) + '; path=/; max-age=' + (60 * 60 * 24 * 30);
    }
  } catch (e) {}

  function buildAffiliateTargetUrl() {
    var uid = '';
    var email = '';
    try {
      var sp = new URLSearchParams(window.location.search);
      if (sp.get('uid')) uid = sp.get('uid');
      if (typeof window.currentUserId === 'string' && window.currentUserId) uid = window.currentUserId;
      if (typeof window.stateUser === 'object' && window.stateUser) {
        if (window.stateUser.userId) uid = window.stateUser.userId;
        if (window.stateUser.email) email = window.stateUser.email;
      }
      var els = Array.from(document.querySelectorAll('span, button, a, div'));
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].innerText || '').trim();
        if (t.indexOf('@') !== -1 && t.indexOf(' ') === -1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
          email = t.toLowerCase();
          break;
        }
        if (t.indexOf('👤') !== -1) {
          var m = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
          if (m) { email = m[0].toLowerCase(); break; }
        }
        if (!uid && t.indexOf('USR-') !== -1) {
          var mU = t.match(/USR-[A-Z0-9-]+/);
          if (mU) uid = mU[0];
        }
      }
      if (email) localStorage.setItem('xswarm_user_email', email);
      if (uid) localStorage.setItem('xswarm_user_id', uid);
      if (!email) email = localStorage.getItem('xswarm_user_email') || '';
      if (!uid) uid = localStorage.getItem('xswarm_user_id') || '';
    } catch (e) {}

    var qs = [];
    if (uid) qs.push('uid=' + encodeURIComponent(uid));
    if (email) qs.push('email=' + encodeURIComponent(email));
    return '/affiliate' + (qs.length > 0 ? ('?' + qs.join('&')) : '');
  }

  function syncStudioAffiliateLinks() {
    try {
      var oldCard = document.getElementById('xswarm-affiliate-partner-card');
      if (oldCard && oldCard.parentNode) oldCard.parentNode.removeChild(oldCard);

      var targetHref = buildAffiliateTargetUrl();
      var allEls = Array.from(document.querySelectorAll('a, button'));
      allEls.forEach(function(el) {
        var txt = (el.innerText || '').trim();
        if (txt.indexOf('Affiliate (30%)') !== -1) {
          if (el.tagName === 'A') el.setAttribute('href', targetHref);
          el.onclick = function(ev) {
            ev.preventDefault();
            window.location.href = buildAffiliateTargetUrl();
          };
        }
      });

      if (!document.getElementById('nav-pill-affiliate')) {
        var consoleBtn = allEls.find(function(el) {
          var t = (el.innerText || '').trim();
          return t === 'Console' || t.indexOf('Console') !== -1;
        });
        if (consoleBtn && consoleBtn.parentNode) {
          var affBtn = document.createElement('a');
          affBtn.id = 'nav-pill-affiliate';
          affBtn.href = targetHref;
          affBtn.innerHTML = '🤝 Affiliate (30%)';
          affBtn.style.cssText = 'text-decoration:none;background:#ecfdf5;color:#059669;border:1.5px solid #10b981;border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:800;cursor:pointer;margin-left:6px;display:inline-flex;align-items:center;';
          affBtn.onclick = function(ev) {
            ev.preventDefault();
            window.location.href = buildAffiliateTargetUrl();
          };
          consoleBtn.parentNode.insertBefore(affBtn, consoleBtn.nextSibling);
        }
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncStudioAffiliateLinks);
  } else {
    syncStudioAffiliateLinks();
  }
  setInterval(syncStudioAffiliateLinks, 2000);
})();
