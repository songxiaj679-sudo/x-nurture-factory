require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const { db } = require('./firestore');
const { getResidentialProxy } = require('./iproyal');
const {
  safeCloseBrowser,
  applyInheritedDeviceAndUa,
  checkReachRestrictedOrLocked
} = require('./v3_post_executor');
const {
  CACHE_DIR,
  acquireTokenLock,
  releaseTokenLock,
  prepareLockedProfileDir,
  slimBrowserCache
} = require('./token_mutex');
const {
  inferNicheProfile,
  generateEmpathyBridgeReply,
  generateQuoteRtCommentary
} = require('./ai_campaign_builder');
const { applyTrackingUrlToReplyText } = require('./funnel_click_tracker');
const { decryptCredentials } = require('./official_api_client');

function resolveAccountAuthToken(accData) {
  if (!accData) return '';
  if (accData.encryptedAuthToken) {
    try {
      const dec = decryptCredentials(accData.encryptedAuthToken);
      if (dec && dec.authToken) return String(dec.authToken).trim();
    } catch (e) {}
  }
  return String(accData.authToken || '').trim();
}
const { recordTokenAction } = require('./saas_rate_and_rotation');
const {
  resolveHealthyProxy,
  markProxyUnhealthy,
  installCreateTweetInterceptor,
  resetCapturedTweetsInPage,
  getSelfUserIdFromCookies,
  captureConfirmedTweetId,
  dismissXOverlays,
  openComposerOnHomeOrFallback,
  openReplyComposerReliable
} = require('./x_browser_helpers');

const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// User rest_id (core.user_results) を誤取得せず、生成された Tweet / Reply 本体の rest_id のみを厳密抽出
function extractTweetIdFromCreateTweetBody(rawTxt) {
  if (!rawTxt) return { tweetId: null, errorMsg: null };
  try {
    const json = typeof rawTxt === 'string' ? JSON.parse(rawTxt) : rawTxt;
    const rawRes = json?.data?.create_tweet?.tweet_results?.result;
    if (rawRes) {
      const tweetNode = (rawRes.__typename === 'TweetWithVisibilityResults' && rawRes.tweet)
        ? rawRes.tweet
        : rawRes;
      if (tweetNode && tweetNode.__typename !== 'User') {
        const id = tweetNode.rest_id || (tweetNode.legacy && tweetNode.legacy.id_str);
        if (id && /^\d{15,22}$/.test(String(id))) {
          return { tweetId: String(id), errorMsg: null };
        }
      }
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      const msg = json.errors.map(e => `${e.message || 'error'}${e.code ? '(' + e.code + ')' : ''}`).join('; ');
      return { tweetId: null, errorMsg: msg };
    }
  } catch (e) {}
  return { tweetId: null, errorMsg: null };
}

// 送信ボタンクリック前にセットし、CreateTweet 通信の完了を最大 timeoutMs 待機して確実に捕捉する
function createCreateTweetWaiter(page, timeoutMs = 9500) {
  let settled = false;
  let resolveFn = null;
  let timer = null;

  const onResponse = async (res) => {
    try {
      if (settled) return;
      const u = res.url();
      if (!u.includes('CreateTweet')) return;
      const rawTxt = await res.text().catch(() => '');
      const parsed = extractTweetIdFromCreateTweetBody(rawTxt);
      if (parsed.tweetId || parsed.errorMsg) {
        settled = true;
        if (timer) clearTimeout(timer);
        page.off('response', onResponse);
        resolveFn(parsed);
      }
    } catch (e) {}
  };

  const promise = new Promise((resolve) => {
    resolveFn = resolve;
    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        page.off('response', onResponse);
        resolve({ tweetId: null, errorMsg: null });
      }
    }, timeoutMs);
  });

  page.on('response', onResponse);
  return {
    wait: () => promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        page.off('response', onResponse);
      }
    }
  };
}

// ネットワーク傍受で取り逃した場合の多段フォールバック (1: Toast通知 -> 2: 会話内DOM -> 3: /with_replies またはプロフィール先頭)
async function resolveFallbackTweetId(page, cleanUsername, { isReply = false, excludeIds = [] } = {}) {
  const excluded = new Set((excludeIds || []).filter(Boolean).map(String));
  const uLower = String(cleanUsername || '').replace(/^@/, '').toLowerCase();
  if (!uLower) return null;

  // Stage A: 画面下部トースト ("Your post was sent. View") のリンク
  try {
    const toastLink = await page.waitForSelector('div[data-testid="toast"] a[href*="/status/"]', { timeout: 3000 }).catch(() => null);
    if (toastLink) {
      const href = await page.evaluate(el => el.getAttribute('href') || el.href || '', toastLink).catch(() => '');
      const m = String(href).match(/status\/(\d{15,22})/);
      if (m && m[1] && !excluded.has(m[1])) return m[1];
    }
  } catch (e) {}

  // Stage B: 現在開いているページ（返信直後のスレッド内DOM）から自分の最新ステータスIDを検索
  const scanPageDomForUserStatus = async (skipPinned) => {
    return await page.evaluate((targetUserLower, exclArr, skipPin) => {
      const excl = new Set(exclArr);
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      for (const art of articles) {
        if (skipPin) {
          const soc = art.querySelector('[data-testid="socialContext"]');
          if (soc && /pinned|固定/i.test(soc.innerText || '')) continue;
        }
        const links = Array.from(art.querySelectorAll('a[href*="/status/"]'));
        for (const a of links) {
          const rawHref = String(a.getAttribute('href') || '');
          const m = rawHref.match(/^\/([^/]+)\/status\/(\d{15,22})/i);
          if (m && m[1].toLowerCase() === targetUserLower && !excl.has(m[2])) {
            return m[2];
          }
        }
      }
      return null;
    }, uLower, Array.from(excluded), Boolean(skipPinned)).catch(() => null);
  };

  if (isReply) {
    const inlineId = await scanPageDomForUserStatus(false);
    if (inlineId) return inlineId;
  }

  // Stage C: リプライなら /with_replies タブ、通常/引用/ピン留めならメインプロフィールから取得
  const profileUrl = isReply
    ? `https://x.com/${cleanUsername}/with_replies`
    : `https://x.com/${cleanUsername}`;
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  return await scanPageDomForUserStatus(!isReply);
}

function loadRepliedLedger(userId) {
  const cleanUid = String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  const file = `/tmp/xsw_replied_${cleanUid}.json`;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        file,
        tweetIds: new Set(Array.isArray(parsed.tweetIds) ? parsed.tweetIds : []),
        usernames: new Set(Array.isArray(parsed.usernames) ? parsed.usernames : [])
      };
    }
  } catch (e) {}
  return { file, tweetIds: new Set(), usernames: new Set() };
}

function saveRepliedLedger(ledger, tweetId, username) {
  try {
    if (tweetId) ledger.tweetIds.add(String(tweetId));
    if (username) ledger.usernames.add(String(username).toLowerCase());
    const tArr = Array.from(ledger.tweetIds).slice(-600);
    const uArr = Array.from(ledger.usernames).slice(-400);
    fs.writeFileSync(ledger.file, JSON.stringify({ tweetIds: tArr, usernames: uArr }), 'utf8');
  } catch (e) {}
}

function extractTweetsFromGraphqlPayload(obj, outList = []) {
  if (!obj || typeof obj !== 'object') return outList;
  if (Array.isArray(obj)) {
    for (const item of obj) extractTweetsFromGraphqlPayload(item, outList);
    return outList;
  }
  if (obj.__typename === 'Tweet' || (obj.rest_id && obj.legacy && obj.legacy.full_text)) {
    const leg = obj.legacy || {};
    const userLeg = obj.core?.user_results?.result?.legacy || obj.core?.user_results?.result?.core || {};
    const screenName = userLeg.screen_name || '';
    const restId = String(obj.rest_id || leg.id_str || '');
    const fullText = String(leg.full_text || '');
    // conversation_control が設定されている投稿（返信制限あり）は最初から除外
    const replyRestricted = Boolean(leg.conversation_control || obj.conversation_control);
    if (restId && screenName && fullText && !replyRestricted) {
      outList.push({
        tweetId: restId,
        username: screenName,
        text: fullText,
        likes: parseInt(leg.favorite_count || '0', 10),
        replies: parseInt(leg.reply_count || '0', 10),
        retweets: parseInt(leg.retweet_count || '0', 10),
        hasUrl: Array.isArray(leg.entities?.urls) && leg.entities.urls.length > 0
      });
    }
  }
  for (const k of Object.keys(obj)) {
    if (k === 'retweeted_status_result' || k === 'quoted_status_result') continue;
    extractTweetsFromGraphqlPayload(obj[k], outList);
  }
  return outList;
}

function scoreProspectCandidate(cand, { selfUsername, lang, segment, ledger, preferViralForQuote }) {
  if (!cand || !cand.tweetId || !cand.username || !cand.text) return -999;
  const uLower = cand.username.toLowerCase();
  if (uLower === String(selfUsername || '').toLowerCase() || uLower === 'veloxpostapp') return -999;
  if (ledger.tweetIds.has(String(cand.tweetId))) return -999;
  if (!preferViralForQuote && ledger.usernames.has(uLower)) return -999;

  const txt = String(cand.text || '').trim();
  if (txt.length < 18 || txt.startsWith('RT @')) return -999;

  const hasJa = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(txt);
  const hasKana = /[\u3040-\u309f\u30a0-\u30ff]/.test(txt);
  const hasNonLatinHeavy = /[\u0600-\u06FF\u0400-\u04FF\u0E00-\u0E7F]/.test(txt);
  if (lang === 'en') {
    if (hasKana || hasNonLatinHeavy) return -999;
  } else {
    if (!hasJa) return -999;
  }

  const hashtagCount = (txt.match(/#[^\s#]+/g) || []).length;
  if (hashtagCount > 4) return -999;

  const lower = txt.toLowerCase();
  const giveawaySpam = /プレゼント企画|抽選で|配布します|全員に配布|airdrop|free giveaway|drop your wallet|rt & follow/i.test(lower);
  if (giveawaySpam) return -999;

  let score = 50;

  if (segment === 'b2c_consumer') {
    const promoSignals = /#pr\b|#ad\b|amzn\.to|al\.dmm\.com|lin\.ee|t\.me\/|bit\.ly|プロフ見て|固ツイ|固定ポスト|詳細はリプ|dmください|稼げる副業/i.test(lower);
    if (promoSignals || cand.hasUrl) return -500;
    if (/\?|？|たい|ほしい|つらい|辞めたい|足りない|勝てない|溶けた|迷う|おすすめ|誰か|need|tired|wish|anyone|struggling|help|how do|looking for/i.test(lower)) {
      score += 35;
    }
    if (hashtagCount === 0) score += 12;
  } else {
    if (/shadowban|impression|traffic|affiliate|agency|ofm|saas|automation|linktr\.ee|beacons\.ai|シャドウバン|インプ|アフィ|運用|自動化|手作業|複数垢/i.test(lower)) {
      score += 30;
    }
  }

  if (preferViralForQuote) {
    score += Math.min(45, (cand.likes || 0) * 2 + (cand.replies || 0) * 4);
  } else {
    if (cand.likes >= 1 && cand.likes <= 250) score += 15;
    if (cand.likes > 1500) score -= 25;
    if (cand.replies >= 1 && cand.replies <= 40) score += 10;
  }

  return score;
}

// ============================================================================
// 📌 1. 看板ポスト（Flagship Billboard Post）の投稿 ＆ プロフィール最上部への自動ピン留め
// ============================================================================
async function executeAutoPinBillboardPost(ctx) {
  const { tenantUser, targetDoc, accData, laneNo, laneCfg, userProxies, helpers } = ctx;
  const {
    logSaaS, parseProxyString, getResidentialProxy, acquireGlobalChromeLock, releaseGlobalChromeLock,
    getFixedUserAgent, getFixedViewport, humanTyping, obfuscateText,
    checkRobotOrLocked, checkActionBlock, inspectAccountViaInternalApi,
    syncProfileFastAndLock, _applySafeMediaAndUpdateBlocker
  } = helpers;

  const token = resolveAccountAuthToken(accData);
  const fullUid = tenantUser.userId;
  const tenantTag = `${fullUid.slice(0, 8)}:L${laneNo}`;
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, laneNo);
  const isOwnerAcc = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(fullUid) || tenantUser.email === 'hank3jones@gmail.com';
  const pinSpec = laneCfg.pinnedPost;
  if (!pinSpec || !pinSpec.mainText) return 'skipped';

  let tokLock = null;
  let heldLock = null;
  let browser = null;
  let userDir = null;
  let proxy = null;

  try {
    proxy = await resolveHealthyProxy({
      rawProxyStr: accData.proxy,
      userProxies,
      token,
      isOwner: isOwnerAcc,
      getResidentialProxy,
      account: accData,
      logFn: _log
    });
    if (!proxy || !proxy.host) return 'system_error';
    tokLock = await acquireTokenLock(token, `pin_${tenantTag}`, 12000);
    if (!tokLock) return 'system_error';
    heldLock = await acquireGlobalChromeLock(`pin_${tenantTag}`);
    if (!heldLock) return 'system_error';

    userDir = prepareLockedProfileDir('main', token);
    const isEnLane = String(laneCfg.aiTargetLang || 'ja').toLowerCase().startsWith('en');
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', isEnLane ? '--lang=en-US' : '--lang=ja-JP'];
    if (proxy && proxy.host) browserArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);

    _log(`📌 [Billboard Pin] Launching browser on healthy proxy (${proxy.host}) to publish & pin flagship post on @${accData.username || token.slice(0, 6)}...`);
    browser = await puppeteer.launch({ headless: 'new', args: browserArgs, ignoreDefaultArgs: ['--enable-automation'], userDataDir: userDir, protocolTimeout: 45000 });
    const page = await browser.newPage();
    await _applySafeMediaAndUpdateBlocker(page);
    await installCreateTweetInterceptor(page);
    page.setDefaultNavigationTimeout(32000);

    await page.setUserAgent(getFixedUserAgent(token));
    await page.setViewport(getFixedViewport(token));
    await applyInheritedDeviceAndUa(page, token, accData.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': isEnLane ? 'en-US,en;q=0.9' : 'ja,en-US;q=0.9,en;q=0.8' });
    if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'lang', value: isEnLane ? 'en' : 'ja', domain: '.x.com', path: '/' }
    );

    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 32000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    const landed = String(page.url() || '').toLowerCase();
    if (landed.startsWith('chrome-error://') || landed === 'about:blank' || !landed.includes('x.com')) {
      markProxyUnhealthy(proxy);
      return 'system_error';
    }
    if (await checkRobotOrLocked(page)) return 'robot';

    const selfUserId = await getSelfUserIdFromCookies(page);
    const apiHealth = await inspectAccountViaInternalApi(page);
    if (apiHealth.apiChecked && apiHealth.status !== 'ok') return apiHealth.status;
    const cleanUsername = apiHealth.screenName || accData.username || '';
    if (!cleanUsername) return 'system_error';

    if (await checkReachRestrictedOrLocked(page) === 'REACH_RESTRICTED') return 'shadowban';

    const rawBio = String(laneCfg.profileBio || '').trim();
    if ((rawBio && accData.lastSyncedBio !== rawBio) || laneCfg.bioSyncPending === true) {
      const bOk = await syncProfileFastAndLock(
        page,
        { bio: rawBio, name: laneCfg.personaName || '', location: laneCfg.personaLocation || '', avatarUrl: laneCfg.personaAvatarUrl || '' },
        apiHealth.currentBio,
        tenantTag,
        fullUid,
        laneNo
      );
      if (bOk) await targetDoc.ref.update({ lastSyncedBio: rawBio }).catch(() => {});
      if (!String(page.url() || '').includes('/home')) {
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2200));
      }
    }

    const { textbox, scopeSelector } = await openComposerOnHomeOrFallback(page, _log);
    if (!textbox) {
      markProxyUnhealthy(proxy, 5 * 60 * 1000);
      return 'system_error';
    }

    let tempImagePath = null;
    const promoImg = String(pinSpec.imageUrl || laneCfg.defaultPromoImageUrl || '').trim();
    if (promoImg) {
      try {
        const localTarget = promoImg.startsWith('/uploads/') ? path.join(__dirname, '..', promoImg) : promoImg;
        if (localTarget.startsWith('/') && fs.existsSync(localTarget)) {
          tempImagePath = path.join(CACHE_DIR, `pin_img_${Date.now()}.jpg`);
          await require('sharp')(fs.readFileSync(localTarget))
            .flatten({ background: '#ffffff' })
            .modulate({ brightness: 1.0 + (Math.random() * 0.02 - 0.01) })
            .jpeg({ quality: 92 })
            .toFile(tempImagePath);
          const fileInput = (scopeSelector ? await page.$(scopeSelector + 'input[type="file"]') : null) || await page.$('input[type="file"]');
          if (fileInput) {
            await fileInput.uploadFile(tempImagePath);
            await new Promise(r => setTimeout(r, 3500));
          }
        }
      } catch (e) {}
    }

    await page.evaluate(el => el.focus(), textbox);
    await textbox.click();
    await new Promise(r => setTimeout(r, 600));

    const mainPayload = obfuscateText(pinSpec.mainText);
    await humanTyping(page, mainPayload, isEnLane);
    await new Promise(r => setTimeout(r, 1500));

    await resetCapturedTweetsInPage(page);
    await page.evaluate((scope) => {
      const sel = (scope ? scope + '[data-testid="tweetButton"], ' + scope + '[data-testid="tweetButtonInline"], ' : '') +
        '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
      const btns = Array.from(document.querySelectorAll(sel));
      for (const b of btns) { if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; } }
    }, scopeSelector);

    const pinCap = await captureConfirmedTweetId(page, {
      cleanUsername,
      selfUserId,
      isReply: false,
      excludeIds: [accData.pinnedPostTweetId],
      timeoutMs: 10500
    });
    if (await checkActionBlock(page)) return 'unavailable';

    if (tempImagePath && fs.existsSync(tempImagePath)) {
      try { fs.unlinkSync(tempImagePath); } catch (e) {}
    }

    const capturedTweetId = pinCap.tweetId;
    if (!capturedTweetId) {
      _log(`⚠️ Could not confirm new Billboard Tweet ID (${pinCap.errorMsg || 'timeout'}).`);
      return 'system_error';
    }

    const pinnedUrl = `https://x.com/${cleanUsername}/status/${capturedTweetId}`;

    // 2段目の自己リプライ計測URLを正確な看板ポストIDへ接続
    const selfReplyUrlText = applyTrackingUrlToReplyText(String(pinSpec.selfReplyText || laneCfg.aiAffiliateUrl || '').trim(), laneCfg, 'pin');
    if (selfReplyUrlText) {
      await new Promise(r => setTimeout(r, 5000));
      await page.goto(pinnedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2800));
      const rBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 8000 }).catch(() => null);
      if (rBox) {
        await page.evaluate(el => el.focus(), rBox);
        await rBox.click();
        await new Promise(r => setTimeout(r, 400));
        await humanTyping(page, obfuscateText(selfReplyUrlText), isEnLane);
        await new Promise(r => setTimeout(r, 1000));
        const srWaiter = createCreateTweetWaiter(page, 8500);
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'));
          for (const b of btns) { if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; } }
        });
        await srWaiter.wait();
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // プロフィール最上部へのピン留め実行（内部API + UIメニューの2段構え）
    const cookies = await page.cookies().catch(() => []);
    const ct0 = cookies.find(c => c.name === 'ct0')?.value || '';
    let pinnedSuccess = false;

    if (ct0) {
      const apiPinStatus = await page.evaluate(async (bearer, csrf, tid) => {
        try {
          const r = await fetch('https://x.com/i/api/1.1/account/pin_tweet.json', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'authorization': 'Bearer ' + bearer,
              'x-csrf-token': csrf,
              'x-twitter-active-user': 'yes',
              'x-twitter-auth-type': 'OAuth2Session',
              'content-type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ tweet_mode: 'extended', id: String(tid) }).toString()
          });
          return r.status;
        } catch (e) { return 0; }
      }, X_WEB_BEARER, ct0, capturedTweetId).catch(() => 0);
      if (apiPinStatus === 200) pinnedSuccess = true;
    }

    if (!pinnedSuccess) {
      await page.goto(pinnedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2500));
      const clickedCaret = await page.evaluate(() => {
        const c = document.querySelector('article[data-testid="tweet"] [data-testid="caret"]');
        if (c) { c.click(); return true; }
        return false;
      }).catch(() => false);
      if (clickedCaret) {
        await new Promise(r => setTimeout(r, 900));
        const clickedPinItem = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
          const pItem = items.find(el => /pin to your profile|pin|プロフィールに固定|固定表示/i.test(el.innerText || ''));
          if (pItem) { pItem.click(); return true; }
          return false;
        }).catch(() => false);
        if (clickedPinItem) {
          await new Promise(r => setTimeout(r, 900));
          await page.evaluate(() => {
            const cBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (cBtn) cBtn.click();
          }).catch(() => {});
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    const stamp = String(laneCfg.aiLastRefreshedAtMs || Date.now());
    recordTokenAction(token, 'post');
    await targetDoc.ref.update({
      username: cleanUsername,
      pinnedPostTweetId: capturedTweetId,
      pinnedCampaignStamp: stamp,
      nextPostAt: new Date(Date.now() + 120 * 1000),
      nextOutreachAt: new Date(Date.now() + 90 * 1000),
      lastActionAt: new Date(),
      updatedAt: new Date()
    }).catch(() => {});

    const uRef = db.collection('saas_users').doc(fullUid);
    const uSnap = await uRef.get().catch(() => null);
    if (uSnap && uSnap.exists) {
      const lanes = uSnap.data().lanes || {};
      const lKey = String(laneNo);
      if (lanes[lKey]) {
        lanes[lKey].pinSyncPending = false;
        lanes[lKey].bioSyncPending = false;
        await uRef.set({ lanes, updatedAt: new Date() }, { merge: true }).catch(() => {});
      }
    }

    await db.collection('saas_history').add({
      ownerUserId: fullUid,
      laneIndex: laneNo,
      threadNo: laneNo,
      accountDocId: targetDoc.id,
      authToken: token,
      username: cleanUsername,
      tweetId: capturedTweetId,
      mode: 'pinned_post',
      text: '📌 [Pinned Billboard] ' + pinSpec.mainText.slice(0, 48),
      url: pinnedUrl,
      deleted: false,
      createdAt: new Date()
    }).catch(() => {});

    _log(`📌 [Billboard Pinned] Flagship post & self-reply link pinned on @${cleanUsername}: ${pinnedUrl}`);
    return 'success';
  } catch (e) {
    _log(`⚠️ Auto-pin warning: ${e.message}`);
    return 'system_error';
  } finally {
    if (browser) await safeCloseBrowser(browser);
    if (userDir) slimBrowserCache(userDir);
    if (heldLock) releaseGlobalChromeLock(heldLock);
    if (tokLock) releaseTokenLock(tokLock);
  }
}

// ============================================================================
// 🎯 2. 1アカウント交互稼働：見込み客検索 ➔ いいね＋共感リプライ(75%) / 引用RT＋自己リプURL(25%)
// ============================================================================
async function executeInterleavedOutreachCycle(ctx) {
  const { tenantUser, targetDoc, accData, laneNo, laneCfg, userProxies, helpers } = ctx;
  const {
    logSaaS, parseProxyString, acquireGlobalChromeLock, releaseGlobalChromeLock,
    getFixedUserAgent, getFixedViewport, humanTyping, obfuscateText,
    checkRobotOrLocked, checkActionBlock, inspectAccountViaInternalApi,
    _applySafeMediaAndUpdateBlocker
  } = helpers;

  const token = resolveAccountAuthToken(accData);
  const fullUid = tenantUser.userId;
  const tenantTag = `${fullUid.slice(0, 8)}:L${laneNo}`;
  const _log = (msg) => logSaaS(tenantTag, msg, fullUid, laneNo);
  const isOwnerAcc = ['USR-MVUA1GLP-D640', 'TG-8401260325'].includes(fullUid) || tenantUser.email === 'hank3jones@gmail.com';
  

  const lang = String(laneCfg.aiTargetLang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const isEnLane = (lang === 'en');
  const niche = inferNicheProfile(laneCfg.aiProductDesc || laneCfg.profileBio || '', lang);
  const segment = laneCfg.aiTargetSegment || niche.segment || 'b2c_consumer';

  let queries = String(laneCfg.aiKeywords || tenantUser.aiKeywords || '')
    .split(/[,\n、]/)
    .map(s => s.trim())
    .filter(Boolean);
  if (queries.length === 0) queries = niche.queries;

  const outreachCount = parseInt(accData.outreachCount || '0', 10);
  const isQuoteRtTurn = ((outreachCount + 1) % 4 === 0);
  const ledger = loadRepliedLedger(fullUid);

  let tokLock = null;
  let heldLock = null;
  let browser = null;
  let userDir = null;
  let proxy = null;

  try {
    proxy = await resolveHealthyProxy({
      rawProxyStr: accData.proxy,
      userProxies,
      token,
      isOwner: isOwnerAcc,
      getResidentialProxy,
      account: accData,
      logFn: _log
    });
    if (!proxy || !proxy.host) return 'system_error';
    tokLock = await acquireTokenLock(token, `outreach_${tenantTag}`, 12000);
    if (!tokLock) return 'system_error';
    heldLock = await acquireGlobalChromeLock(`outreach_${tenantTag}`);
    if (!heldLock) return 'system_error';

    userDir = prepareLockedProfileDir('main', token);
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', isEnLane ? '--lang=en-US' : '--lang=ja-JP'];
    if (proxy && proxy.host) browserArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);

    browser = await puppeteer.launch({ headless: 'new', args: browserArgs, ignoreDefaultArgs: ['--enable-automation'], userDataDir: userDir, protocolTimeout: 45000 });
    const page = await browser.newPage();
    await _applySafeMediaAndUpdateBlocker(page);
    await installCreateTweetInterceptor(page);
    page.setDefaultNavigationTimeout(32000);

    const interceptedCandidates = [];
    page.on('response', async (res) => {
      try {
        const u = res.url();
        if ((u.includes('SearchTimeline') || u.includes('adaptive.json')) && res.status() === 200) {
          const json = await res.json().catch(() => null);
          if (json) extractTweetsFromGraphqlPayload(json, interceptedCandidates);
        }
      } catch (e) {}
    });

    await page.setUserAgent(getFixedUserAgent(token));
    await page.setViewport(getFixedViewport(token));
    await applyInheritedDeviceAndUa(page, token, accData.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': isEnLane ? 'en-US,en;q=0.9' : 'ja,en-US;q=0.9,en;q=0.8' });
    if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setCookie(
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
      { name: 'lang', value: isEnLane ? 'en' : 'ja', domain: '.x.com', path: '/' }
    );

    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 32000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    const landedHome = String(page.url() || '').toLowerCase();
    if (landedHome.startsWith('chrome-error://') || landedHome === 'about:blank' || !landedHome.includes('x.com')) {
      markProxyUnhealthy(proxy);
      _log(`⚠️ Proxy ${proxy.host} stalled on /home during outreach -> switching proxy...`);
      return 'system_error';
    }
    if (await checkRobotOrLocked(page)) return 'robot';

    const selfUserId = await getSelfUserIdFromCookies(page);
    const apiHealth = await inspectAccountViaInternalApi(page);
    if (apiHealth.apiChecked && apiHealth.status !== 'ok') return apiHealth.status;
    const cleanUsername = apiHealth.screenName || accData.username || '';
    if (!cleanUsername) return 'system_error';

    if (await checkReachRestrictedOrLocked(page) === 'REACH_RESTRICTED') return 'shadowban';

    const startKwIdx = parseInt(accData.lastOutreachKwIdx || '0', 10);
    let bestTarget = null;
    let matchedQuery = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      const rawQ = queries[(startKwIdx + attempt) % queries.length];
      const effectiveQ = (attempt === 1) ? rawQ.replace(/"/g, '') : rawQ;
      const searchModeParam = isQuoteRtTurn ? '' : '&f=live';
      const searchUrl = `https://x.com/search?q=${encodeURIComponent(effectiveQ)}${searchModeParam}`;

      interceptedCandidates.length = 0;
      _log(`🔍 [${isQuoteRtTurn ? 'Quote-RT Hunt' : 'AI Prospecting'}] Searching X (${segment}): "${effectiveQ}"...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3400));
      await page.evaluate(() => window.scrollBy(0, 420)).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const domCandidates = await page.evaluate(() => {
        const out = [];
        const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        for (const art of arts) {
          const txtEl = art.querySelector('[data-testid="tweetText"]');
          const linkEl = art.querySelector('time')?.closest('a') || art.querySelector('a[href*="/status/"]');
          if (!txtEl || !linkEl) continue;
          const href = String(linkEl.getAttribute('href') || '');
          const m = href.match(/^\/([^/]+)\/status\/(\d{15,22})/);
          if (!m) continue;
          const hasExtLink = !!art.querySelector('[data-testid="card.wrapper"], a[href*="t.co"]');
          out.push({
            username: m[1],
            tweetId: m[2],
            text: txtEl.innerText || '',
            likes: 2,
            replies: 1,
            retweets: 0,
            hasUrl: hasExtLink
          });
        }
        return out;
      }).catch(() => []);

      const combinedMap = new Map();
      for (const c of [...interceptedCandidates, ...domCandidates]) {
        if (c && c.tweetId && !combinedMap.has(c.tweetId)) combinedMap.set(c.tweetId, c);
      }

      const scored = [];
      for (const cand of combinedMap.values()) {
        const sc = scoreProspectCandidate(cand, {
          selfUsername: cleanUsername,
          lang,
          segment,
          ledger,
          preferViralForQuote: isQuoteRtTurn
        });
        if (sc > 0) scored.push({ ...cand, score: sc });
      }

      scored.sort((a, b) => b.score - a.score);
      if (scored.length > 0) {
        bestTarget = scored[0];
        matchedQuery = effectiveQ;
        break;
      }
    }

    await targetDoc.ref.update({ lastOutreachKwIdx: startKwIdx + 1 }).catch(() => {});

    if (!bestTarget) {
      _log('ℹ️ No fresh qualified prospects matched this search window; rotating to next keyword shortly.');
      return 'no_target';
    }

    const targetUrl = `https://x.com/${bestTarget.username}/status/${bestTarget.tweetId}`;
    _log(`🎯 Locked onto @${bestTarget.username} (Score: ${bestTarget.score}) -> Opening post...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 38000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2800 + Math.random() * 1400));

    // 対象ツイートが存在するか・返信制限がかかっていないかを事前確認
    const targetPageCheck = await page.evaluate((isQuote) => {
      const art = document.querySelector('article[data-testid="tweet"]');
      if (!art) return 'MISSING_TWEET';
      if (!isQuote && document.querySelector('[data-testid="limitedActionsPrompt"]')) return 'REPLY_RESTRICTED';
      return 'OK';
    }, isQuoteRtTurn).catch(() => 'MISSING_TWEET');

    if (targetPageCheck !== 'OK') {
      saveRepliedLedger(ledger, bestTarget.tweetId, null);
      _log(`⏭️ Target post unavailable or reply-restricted (${targetPageCheck}); moving to next prospect.`);
      return 'no_target';
    }

    // ❤️ いいねを押して通知を送る
    await page.evaluate(() => {
      const likeBtn = document.querySelector('article[data-testid="tweet"] [data-testid="like"]');
      if (likeBtn) likeBtn.click();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));

    if (isQuoteRtTurn) {
      // 🔥 25% サイクル: 引用リポスト（Quote RT）相乗り拡散 ＋ 2段目自己リプライ計測URL
      const quoteComment = await generateQuoteRtCommentary({
        targetTweetText: bestTarget.text,
        productDesc: laneCfg.aiProductDesc || laneCfg.profileBio || '',
        targetLang: lang
      });

      let openedQuoteModal = false;
      const clickedRetweetBtn = await page.evaluate(() => {
        const rtBtn = document.querySelector('article[data-testid="tweet"] [data-testid="retweet"]');
        if (rtBtn) { rtBtn.click(); return true; }
        return false;
      }).catch(() => false);

      if (clickedRetweetBtn) {
        await new Promise(r => setTimeout(r, 900));
        openedQuoteModal = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitem"], [data-testid="Dropdown"] a'));
          const qItem = items.find(el => /quote|引用/i.test(el.innerText || '') || String(el.getAttribute('href') || '').includes('/compose/post'));
          if (qItem) { qItem.click(); return true; }
          return false;
        }).catch(() => false);
        await new Promise(r => setTimeout(r, 2200));
      }

      let qBox = await page.$('[data-testid="tweetTextarea_0"]');
      let finalQuotePayload = obfuscateText(quoteComment);

      if (!openedQuoteModal || !qBox) {
        await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2800));
        qBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 }).catch(() => null);
        finalQuotePayload = `${obfuscateText(quoteComment)}\n${targetUrl}`;
      }

      if (qBox) {
        await page.evaluate(el => el.focus(), qBox);
        await qBox.click();
        await new Promise(r => setTimeout(r, 500));
        await humanTyping(page, finalQuotePayload, isEnLane);
        await new Promise(r => setTimeout(r, 1400));

        await resetCapturedTweetsInPage(page);
        await page.evaluate(() => {
          const sel = '[role="dialog"] [data-testid="tweetButton"], [data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
          const btns = Array.from(document.querySelectorAll(sel));
          for (const b of btns) { if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; } }
        });
        const qCap = await captureConfirmedTweetId(page, {
          cleanUsername,
          selfUserId,
          isReply: false,
          excludeIds: [bestTarget.tweetId, accData.pinnedPostTweetId],
          timeoutMs: 10500
        });
        if (await checkActionBlock(page)) return 'unavailable';

        const quoteTweetId = qCap.tweetId;
        if (!quoteTweetId) {
          saveRepliedLedger(ledger, bestTarget.tweetId, null);
          _log(`⏭️ Quote-RT rejected or unconfirmed (${qCap.errorMsg || 'no_id'}); skipping cleanly.`);
          return 'no_target';
        }

        const liveQuoteUrl = `https://x.com/${cleanUsername}/status/${quoteTweetId}`;

        // 引用ポストの2段目に誘導URLを自己リプライ付与
        const rawDest = String(laneCfg.aiAffiliateUrl || '').trim();
        const destUrl = (laneCfg.useClickTracker === true && laneCfg.trackingShortUrl) ? (laneCfg.trackingShortUrl + '?s=qrt') : rawDest;
        if (destUrl) {
          const quoteSelfReply = lang === 'en'
            ? `👆 Full live setup & direct access right here:\n${destUrl}`
            : `👆 実際に使っている仕組み・公式ページはこちら👇\n${destUrl}`;
          await new Promise(r => setTimeout(r, 5000));
          await page.goto(liveQuoteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 2500));
          const srBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 8000 }).catch(() => null);
          if (srBox) {
            await page.evaluate(el => el.focus(), srBox);
            await srBox.click();
            await new Promise(r => setTimeout(r, 400));
            await humanTyping(page, obfuscateText(quoteSelfReply), isEnLane);
            await new Promise(r => setTimeout(r, 1000));
            const qSrWaiter = createCreateTweetWaiter(page, 8500);
            await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'));
              for (const b of btns) { if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); break; } }
            });
            await qSrWaiter.wait();
            await new Promise(r => setTimeout(r, 1500));
          }
        }

        recordTokenAction(token, 'quote_rt');
        saveRepliedLedger(ledger, bestTarget.tweetId, bestTarget.username);
        await targetDoc.ref.update({ outreachCount: outreachCount + 1, lastOutreachAt: new Date(), lastActionAt: new Date() }).catch(() => {});

        await db.collection('saas_history').add({
          ownerUserId: fullUid,
          laneIndex: laneNo,
          threadNo: laneNo,
          accountDocId: targetDoc.id,
          authToken: token,
          username: cleanUsername,
          tweetId: quoteTweetId,
          mode: 'quote_rt',
          text: `🔁 [Quote-RT -> @${bestTarget.username}] ${quoteComment.slice(0, 44)}`,
          url: liveQuoteUrl,
          deleted: false,
          createdAt: new Date()
        }).catch(() => {});

        _log(`🔥 [Quote-RT Published] Piggybacked on @${bestTarget.username}'s post + attached link -> ${liveQuoteUrl}`);
        return 'success';
      }
    } else {
      // 💬 75% サイクル: 見込み客への1対1「いいね＋共感ブリッジリプライ」
      const replyText = await generateEmpathyBridgeReply({
        targetTweetText: bestTarget.text,
        targetUsername: bestTarget.username,
        keyword: matchedQuery,
        productDesc: laneCfg.aiProductDesc || '',
        funnelStyle: laneCfg.aiFunnelStyle || 'empathy_bridge',
        targetLang: lang,
        aiReplyPersona: laneCfg.aiReplyPersona || '',
        profileBio: laneCfg.profileBio || ''
      });

      const { textbox: rBox, scopeSelector: rScope } = await openReplyComposerReliable(page);
      if (rBox) {
        await page.evaluate(el => el.focus(), rBox);
        await rBox.click();
        await new Promise(r => setTimeout(r, 550));
        _log(`✍️ Typing ${lang.toUpperCase()} outreach reply to @${bestTarget.username}: "${replyText.slice(0, 46)}..."`);
        await humanTyping(page, obfuscateText(replyText), isEnLane);
        await new Promise(r => setTimeout(r, 1400));

        await resetCapturedTweetsInPage(page);
        const sent = await page.evaluate((scope) => {
          const sel = (scope ? scope + '[data-testid="tweetButton"], ' + scope + '[data-testid="tweetButtonInline"], ' : '') +
            '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';
          const btns = Array.from(document.querySelectorAll(sel));
          for (const b of btns) {
            if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return true; }
          }
          return false;
        }, rScope);

        if (!sent) {
          saveRepliedLedger(ledger, bestTarget.tweetId, null);
          return 'no_target';
        }

        const repCap = await captureConfirmedTweetId(page, {
          cleanUsername,
          selfUserId,
          isReply: true,
          excludeIds: [bestTarget.tweetId, accData.pinnedPostTweetId],
          timeoutMs: 11000
        });
        if (await checkActionBlock(page)) return 'unavailable';

        if (!repCap.tweetId) {
          saveRepliedLedger(ledger, bestTarget.tweetId, bestTarget.username);
          _log(`⏭️ Reply rejected or unconfirmed (${repCap.errorMsg || 'no_id'}); skipping history log to prevent dead link.`);
          return 'no_target';
        }

        const realReplyId = repCap.tweetId;
        const liveReplyUrl = `https://x.com/${cleanUsername}/status/${realReplyId}`;
        recordTokenAction(token, 'reply');
        saveRepliedLedger(ledger, bestTarget.tweetId, bestTarget.username);
        await targetDoc.ref.update({ outreachCount: outreachCount + 1, lastOutreachAt: new Date(), lastActionAt: new Date() }).catch(() => {});

        await db.collection('saas_history').add({
          ownerUserId: fullUid,
          laneIndex: laneNo,
          threadNo: laneNo,
          accountDocId: targetDoc.id,
          authToken: token,
          username: cleanUsername,
          tweetId: realReplyId,
          mode: 'ai_reply',
          text: `💬 [AI Reply -> @${bestTarget.username}] ${replyText.slice(0, 48)}`,
          url: liveReplyUrl,
          deleted: false,
          createdAt: new Date()
        }).catch(() => {});

        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 22000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));

        _log(`✅ [AI Reply Sent] Liked & replied to @${bestTarget.username} -> ${liveReplyUrl}`);
        return 'success';
      }
    }

    return 'no_target';
  } catch (e) {
    _log(`⚠️ Outreach worker error: ${e.message}`);
    if (e && e.message && e.message.includes('ACTION_BLOCKED')) return 'unavailable';
    return 'system_error';
  } finally {
    if (browser) await safeCloseBrowser(browser);
    if (userDir) slimBrowserCache(userDir);
    if (heldLock) releaseGlobalChromeLock(heldLock);
    if (tokLock) releaseTokenLock(tokLock);
  }
}

module.exports = {
  extractTweetIdFromCreateTweetBody,
  executeAutoPinBillboardPost,
  executeInterleavedOutreachCycle
};
