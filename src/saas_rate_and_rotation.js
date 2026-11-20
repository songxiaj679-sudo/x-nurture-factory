const fs = require('fs');
const { getTokenHash } = require('./token_mutex');
const { generateAiCampaignPayload, normalizeLangCode } = require('./ai_campaign_builder');

const _rateLogDedupe = new Map();
const _pinAttemptState = new Map();
const _bioSyncAttemptAt = new Map();
const _refreshingLaneKeys = new Set();
let _lastGlobalRotationCheckMs = 0;

function getRateSpecByMode(battleMode) {
  const m = String(battleMode || 'sniper').toLowerCase();
  if (m === 'aggressive') {
    return { maxPostsPerHour: 5, maxRepliesPerHour: 7, maxTotalPerDay: 92, minGapMs: 75 * 1000 };
  }
  if (m === 'safe') {
    return { maxPostsPerHour: 2, maxRepliesPerHour: 3, maxTotalPerDay: 36, minGapMs: 120 * 1000 };
  }
  return { maxPostsPerHour: 3, maxRepliesPerHour: 5, maxTotalPerDay: 64, minGapMs: 90 * 1000 };
}

function getRateFilePath(token) {
  return `/tmp/xsw_rate_${getTokenHash(token)}.json`;
}

function loadTokenRateWindow(token) {
  const file = getRateFilePath(token);
  const cutoff24h = Date.now() - 24 * 3600 * 1000;
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const events = Array.isArray(raw.events) ? raw.events.filter(e => e && e.ts > cutoff24h) : [];
      return { file, events };
    }
  } catch (e) {}
  return { file, events: [] };
}

function recordTokenAction(token, kind = 'post') {
  if (!token) return;
  try {
    const state = loadTokenRateWindow(token);
    state.events.push({ ts: Date.now(), kind: String(kind || 'post') });
    if (state.events.length > 250) state.events = state.events.slice(-250);
    fs.writeFileSync(state.file, JSON.stringify({ events: state.events }), 'utf8');
  } catch (e) {}
}

function clearTokenRateWindowForTest(token) {
  try {
    const file = getRateFilePath(token);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) {}
}

function canExecuteAutomatedAction(token, kind = 'post', battleMode = 'sniper', manualForceAtMs = 0) {
  if (!token) return { allowed: true };
  const now = Date.now();
  const isManualBurst = manualForceAtMs && (now - Number(manualForceAtMs) < 90 * 1000);
  const spec = getRateSpecByMode(battleMode);
  const { events } = loadTokenRateWindow(token);

  const oneHourAgo = now - 3600 * 1000;
  const recentHour = events.filter(e => e.ts > oneHourAgo);

  // 手動即時トリガーの場合でも1時間14回を超える異常連打だけは保護する
  if (isManualBurst) {
    if (recentHour.length >= 14) {
      return {
        allowed: false,
        nextAllowedAtMs: recentHour[0].ts + 3600 * 1000 + 15000,
        shouldLog: true,
        reason: 'Hard safety ceiling (14 actions/hr) active to protect burner health.'
      };
    }
    return { allowed: true };
  }

  if (events.length > 0) {
    const lastEv = events[events.length - 1];
    if (now - lastEv.ts < spec.minGapMs) {
      return {
        allowed: false,
        nextAllowedAtMs: lastEv.ts + spec.minGapMs + 5000,
        shouldLog: false,
        reason: 'Spacing consecutive single-account actions.'
      };
    }
  }

  if (events.length >= spec.maxTotalPerDay) {
    const oldestDayEv = events[events.length - spec.maxTotalPerDay];
    const nextMs = Math.max(now + 10 * 60 * 1000, oldestDayEv.ts + 24 * 3600 * 1000 + 30000);
    return buildDeferredResult(token, kind, nextMs, `24h safe volume cap (${spec.maxTotalPerDay}/day) reached; cooling down.`);
  }

  const isPostGroup = (kind === 'post' || kind === 'quote_rt');
  const groupEvents = recentHour.filter(e => isPostGroup ? (e.kind === 'post' || e.kind === 'quote_rt') : (e.kind === 'reply'));
  const cap = isPostGroup ? spec.maxPostsPerHour : spec.maxRepliesPerHour;

  if (groupEvents.length >= cap) {
    const oldestInCap = groupEvents[groupEvents.length - cap];
    const nextMs = Math.max(now + 120 * 1000, oldestInCap.ts + 3600 * 1000 + 20000);
    const mins = Math.max(1, Math.round((nextMs - now) / 60000));
    const label = isPostGroup ? 'post/quote' : 'AI reply';
    return buildDeferredResult(token, kind, nextMs, `Hourly ${label} cap (${cap}/hr in ${String(battleMode || 'sniper').toUpperCase()} mode) reached; resuming in ~${mins}m.`);
  }

  return { allowed: true };
}

function buildDeferredResult(token, kind, nextAllowedAtMs, reason) {
  const key = `${getTokenHash(token)}:${kind}`;
  const now = Date.now();
  const prevLog = _rateLogDedupe.get(key) || 0;
  const shouldLog = (now - prevLog) > 10 * 60 * 1000;
  if (shouldLog) _rateLogDedupe.set(key, now);
  return { allowed: false, nextAllowedAtMs, shouldLog, reason };
}

// 看板ピン留めの連続リトライデッドロック防止ガード
function shouldDeferFailedPin(docId) {
  const st = _pinAttemptState.get(docId);
  if (!st) return false;
  return Date.now() < st.nextRetryAtMs;
}

async function markPinAttemptResult({ docId, success, userId, laneNo, expectedStamp, db, accDocRef, logSaaS, tenantTag }) {
  if (success) {
    _pinAttemptState.delete(docId);
    return;
  }
  const prev = _pinAttemptState.get(docId) || { fails: 0, nextRetryAtMs: 0 };
  const fails = prev.fails + 1;
  if (fails >= 2) {
    _pinAttemptState.delete(docId);
    if (accDocRef && expectedStamp) {
      await accDocRef.update({ pinnedCampaignStamp: expectedStamp, updatedAt: new Date() }).catch(() => {});
    }
    if (db && userId) {
      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get().catch(() => null);
      if (uSnap && uSnap.exists) {
        const lanes = uSnap.data().lanes || {};
        const lKey = String(laneNo);
        if (lanes[lKey]) {
          lanes[lKey].pinSyncPending = false;
          await uRef.set({ lanes, updatedAt: new Date() }, { merge: true }).catch(() => {});
        }
      }
    }
    if (logSaaS) logSaaS(tenantTag, 'ℹ️ Pin attempt skipped after 2 retries; proceeding directly with regular post & outreach queue.', userId, laneNo);
  } else {
    _pinAttemptState.set(docId, { fails, nextRetryAtMs: Date.now() + 90 * 1000 });
  }
}

function shouldDeferBioSync(docId) {
  const lastMs = _bioSyncAttemptAt.get(docId) || 0;
  return (Date.now() - lastMs) < 90 * 1000;
}

function markBioSyncAttempt(docId) {
  _bioSyncAttemptAt.set(docId, Date.now());
}

// 🔄 20パターン鮮度維持ローテーション（24時間経過時の自動更新 & 手動1クリック更新共通コア）
async function refreshLaneCampaignNow({ db, userId, laneNo, laneCfg, logSaaS = null }) {
  const numLane = Math.min(3, Math.max(1, parseInt(laneNo || '1', 10)));
  const lKey = String(numLane);
  const lockKey = `${userId}_L${numLane}`;
  if (_refreshingLaneKeys.has(lockKey)) return { ok: false, reason: 'already_refreshing' };

  const productDesc = String(laneCfg.aiProductDesc || '').trim();
  const affiliateUrl = String(laneCfg.aiAffiliateUrl || '').trim();
  if (!productDesc || !affiliateUrl) return { ok: false, reason: 'missing_offer_or_url' };

  _refreshingLaneKeys.add(lockKey);
  try {
    const lang = normalizeLangCode(laneCfg.aiTargetLang || 'en');
    const nextAngleNum = ((parseInt(laneCfg.lastRotationAngle || '1', 10)) % 6) + 1;
    const battleMode = String(laneCfg.aiBattleMode || 'sniper');

    const generated = await generateAiCampaignPayload({
      productDesc,
      affiliateUrl,
      funnelStyle: laneCfg.aiFunnelStyle || 'empathy_bridge',
      targetLang: lang,
      selectedAngle: { number: nextAngleNum, title: `Fresh Rotation Angle #${nextAngleNum}` },
      userFeedback: 'Generate fresh wording variations to avoid X duplicate decay while keeping high-volume search hashtags.',
      battleMode
    });

    const rawPosts = Array.isArray(generated.posts) ? generated.posts.slice(0, 20) : [];
    if (rawPosts.length === 0) return { ok: false, reason: 'empty_generation' };

    const promoImg = String(laneCfg.defaultPromoImageUrl || '').trim();
    const existingSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
    for (const d of existingSnap.docs) {
      if (parseInt(d.data().laneIndex || '1', 10) === numLane) {
        await d.ref.delete().catch(() => {});
      }
    }

    let sortOrder = Date.now();
    for (const p of rawPosts) {
      sortOrder += 10;
      const sRep = String(p.selfReplyText || '').trim();
      await db.collection('saas_posts').add({
        ownerUserId: userId,
        laneIndex: numLane,
        text: String(p.mainText || p.text || '').trim().slice(0, 265),
        selfReplyText: sRep.slice(0, 265),
        funnelType: p.funnelType || (sRep ? 'self_reply_url' : 'pinned_bridge'),
        imageUrl: promoImg,
        isEnabled: true,
        sortOrder,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    const uRef = db.collection('saas_users').doc(userId);
    const uSnap = await uRef.get().catch(() => null);
    const uData = (uSnap && uSnap.exists) ? (uSnap.data() || {}) : {};
    const lanes = uData.lanes || {};
    lanes[lKey] = {
      ...(lanes[lKey] || {}),
      laneIndex: numLane,
      aiTargetLang: lang,
      aiTargetSegment: generated.targetSegment || laneCfg.aiTargetSegment || 'b2c_consumer',
      aiKeywords: laneCfg.aiKeywords || generated.aiKeywords || '',
      lastRotationAngle: nextAngleNum,
      aiLastRefreshedAtMs: Date.now(),
      updatedAt: new Date()
    };
    await uRef.set({ lanes, updatedAt: new Date() }, { merge: true });

    const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
    for (const adoc of aSnap.docs) {
      if (parseInt(adoc.data().laneIndex || '1', 10) === numLane) {
        await adoc.ref.update({
          lastPostIdx: 0,
          pinnedCampaignStamp: String(lanes[lKey].aiLastRefreshedAtMs),
          updatedAt: new Date()
        }).catch(() => {});
      }
    }

    if (logSaaS) {
      logSaaS(
        `${userId.slice(0, 8)}:L${numLane}`,
        `🔄 [Freshness Rotation] Regenerated ${rawPosts.length} fresh ${lang.toUpperCase()} high-view patterns (Angle #${nextAngleNum})!`,
        userId,
        numLane
      );
    }

    return { ok: true, count: rawPosts.length, angleNumber: nextAngleNum, lang };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    _refreshingLaneKeys.delete(lockKey);
  }
}

function maybeRefreshLaneTemplates24h({ db, tenantUser, laneNo, laneCfg, logSaaS }) {
  const now = Date.now();
  if (now - _lastGlobalRotationCheckMs < 60 * 1000) return;
  if (!laneCfg || laneCfg.autoRefresh24h === false) return;
  if (!laneCfg.aiProductDesc || !laneCfg.aiAffiliateUrl) return;

  const lastRefMs = Number(laneCfg.aiLastRefreshedAtMs || 0);
  if (!lastRefMs || (now - lastRefMs) < 24 * 3600 * 1000) return;

  _lastGlobalRotationCheckMs = now;
  setImmediate(() => {
    refreshLaneCampaignNow({
      db,
      userId: tenantUser.userId,
      laneNo,
      laneCfg,
      logSaaS
    }).catch(() => {});
  });
}

module.exports = {
  getRateSpecByMode,
  recordTokenAction,
  clearTokenRateWindowForTest,
  canExecuteAutomatedAction,
  shouldDeferFailedPin,
  markPinAttemptResult,
  shouldDeferBioSync,
  markBioSyncAttempt,
  refreshLaneCampaignNow,
  maybeRefreshLaneTemplates24h
};
