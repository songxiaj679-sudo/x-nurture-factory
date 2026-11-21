const express = require('express');
const { randomUUID } = require('node:crypto');
const { db } = require('./firestore');
const {
  encryptCredentials,
  decryptCredentials,
  verifyOfficialCredentials,
  postOfficialTweet,
  postOfficialThread,
  uploadOfficialMedia,
  getUserProfileAndRecentTweets,
  getOfficialMentions,
  sanitizePostOrReplyText
} = require('./official_api_client');
const { sanitizeExternalText } = require('./lp_knowledge_extractor');
const { renderVisualCardPng } = require('./visual_card');
const { getCollectiveMarketingIntelligence, harvestAndEvolveCollectiveKnowledge } = require('./collective_intelligence');
const { launchAutopilotCampaign, prepareNextPost, ensureNextPost, reDeliberateAutopilotJobs, reThinkSingleJob, generateInstantPreviewPosts, fetchUrlSummary, isValidTimeZone, dateAtTimeInZone, harvestTweetMetricsAndEvolveKnowledge, generateWeeklyCouncilReport, cancelOtherPendingJobs, cancelNonManualPendingJobs } = require('./autonomous_promo_ai');
const {
  deliberateNextPost,
  generateJitPostContent,
  commitDeliberationToSchedule,
  aggregateUserHistoryAndMetrics,
  getUserMarketingKnowledge
} = require('./ai_deliberation_council');
const {
  getWiseConfig,
  buildWiseOrderSpec,
  processWiseWebhook,
  checkWiseOrderPaidViaApi
} = require('./wise_payment');
const { resolveSessionUser } = require('./auth_service');
const { isPaidAccount, localDateKey } = require('./plan_post_budget');
const { assertPostThreadUnambiguous, extractCleanUrls } = require('./post_constraint_guard');
const { inspectPostCompliance } = require('./post_policy_guard');
const { findDuplicatePostContent } = require('./post_content_guard');
const { buildAccountGrowthReport } = require('./account_growth_report');
const { getGrowthPhase, trustGoalStatus, buildOperatingSummary, operatingPosture, summarizePostedMeasurements } = require('./growth_phase');
const { getSharedEditorialLexicon, computeGuidanceWeights } = require('./editorial_lexicon_engine');
const { officialApiOperationAllowed } = require('./operated_accounts');
const { describeAccountState } = require('./customer_post_state');
const { runDeterministicAudit } = require('./draft_verifier');
const { fetchMyAccountState, syncAllActiveCustomersPostMetrics } = require('./official_api_client');
const { suggestAccountPersonas } = require('./persona_suggestion_helper');
const profileChecklistCache = new Map();
const replenishRunningUsers = new Set();

const liveAccountCache = new Map();

async function loadManualAffiliateResults(userId) {
  try {
    const snap = await db.collection('saas_users').doc(userId)
      .collection('marketing_inputs').doc('affiliate')
      .collection('daily').orderBy('date', 'desc').limit(14).get();
    return snap.docs.map(doc => doc.data()).filter(item => item && typeof item === 'object');
  } catch (err) {
    return [];
  }
}

async function readLiveAccount(userId, userData) {
  const cached = liveAccountCache.get(userId);
  if (cached && Date.now() - cached.at < 60000) return cached.live;
  let live = { ok: false };
  if (userData && userData.xOfficialCredentials) {
    try {
      const creds = decryptCredentials(userData.xOfficialCredentials);
      creds.saasUserId = userId;
      if (!/^\d+$/.test(String(creds.userId || '')) && userData.twitterId) creds.userId = userData.twitterId;
      live = await fetchMyAccountState(creds);
    } catch (err) {
      live = { ok: false, error: err.message };
    }
  }
  liveAccountCache.set(userId, { at: Date.now(), live });
  if (liveAccountCache.size > 500) {
    const oldestKey = liveAccountCache.keys().next().value;
    if (oldestKey !== undefined) liveAccountCache.delete(oldestKey);
  }
  return live;
}

function withLiveCounts(diagnosis, live) {
  const next = diagnosis ? { ...diagnosis } : {};
  const measured = Boolean(live && live.ok && live.followers !== null && live.following !== null);
  if (!measured) {
    if (live && live.ok === false && live.error) {
      next.followers = null;
      next.following = null;
      next.totalTweets = null;
      next.followersMeasured = false;
      next.hasOfficialData = false;
    }
    return next;
  }
  const oldFollowers = Number.isSafeInteger(next.followers) ? next.followers : null;
  for (const key of ['stageDescription', 'pastContentAnalysis', 'strategicDirectiveForCouncil']) {
    if (typeof next[key] !== 'string') continue;
    let text = next[key];
    if (oldFollowers !== null && oldFollowers !== live.followers) {
      text = text.split(`フォロワー${oldFollowers}名`).join(`フォロワー${live.followers}名`);
    }
    if (live.tweetCount !== null) text = text.replace(/総投稿\d+件/g, `総投稿${live.tweetCount}件`);
    next[key] = text;
  }
  next.username = live.username || next.username;
  next.followers = live.followers;
  next.following = live.following;
  next.totalTweets = live.tweetCount;
  next.followersMeasured = true;
  next.hasOfficialData = true;
  next.subscription = live.subscriptionType || null;
  next.countsFetchedAt = new Date().toISOString();
  return next;
}

const AUTOPILOT_CONSENT_VERSION = 1;
const ACCOUNT_POST_LOCK_MS = 2 * 60 * 1000;

function snapshotSafeCredentials(user) {
  if (!user || !user.xOfficialCredentials) return {};
  try {
    return decryptCredentials(user.xOfficialCredentials) || {};
  } catch (err) {
    return {};
  }
}

function getConsentAccount(credentials) {
  const id = String(credentials.id || credentials.userId || '').trim();
  const username = String(credentials.username || '').trim().replace(/^@/, '').toLowerCase();
  return id ? `id:${id}` : (username ? `username:${username}` : '');
}

function hasAutopilotConsent(userData, credentials) {
  const consent = userData.autopilotConsent;
  const account = getConsentAccount(credentials);
  return Boolean(account && consent && consent.version === AUTOPILOT_CONSENT_VERSION &&
    consent.account === account && consent.granted === true);
}

// ========================================================================
// ⏰ Autopilot Worker: スケジュール予定時刻を迎えた自律投稿ジョブを実行するワーカー
// 🔒 原子的Claimで待機中ジョブの同時実行を防止
// ========================================================================
let autopilotWorkerActive = false;

function isJobDue(job, now) {
  if (job.postHistoryRetryAt) {
    const retryAt = job.postHistoryRetryAt.toDate
      ? job.postHistoryRetryAt.toDate()
      : new Date(job.postHistoryRetryAt);
    if (retryAt > now) return false;
  }
  const scheduledAt = job.scheduledAt;
  if (!scheduledAt) return true;
  const scheduledDate = scheduledAt.toDate ? scheduledAt.toDate() : new Date(scheduledAt);
  return scheduledDate <= now;
}

function getScheduledPostContent(job, user) {
  const language = String(user.aiTargetLang || job.lang || 'ja').toLowerCase();
  const isEn = language.startsWith('en');
  const primaryText = job.text || (Array.isArray(job.tweets) && job.tweets[0]) ||
    job.text_en || (Array.isArray(job.tweets_en) && job.tweets_en[0]);
  const primaryIsEnglish = job.isHumanOverride || String(job.lang || '').toLowerCase().startsWith('en');
  const englishTweets = Array.isArray(job.tweets_en) && job.tweets_en.length ? job.tweets_en : null;
  const tweets = isEn ? (englishTweets || (primaryIsEnglish ? job.tweets : null)) : job.tweets;
  const text = isEn
    ? (job.text_en || (englishTweets && englishTweets[0]) || (primaryIsEnglish ? job.text : '') || (tweets && tweets[0]))
    : (job.text || (tweets && tweets[0]));
  const markerText = String(text || primaryText || '');
  const prepared = job.preparedBy === 'next_post' || (
    String(text || '').trim().length >= 40 &&
    !markerText.includes('投稿直前AI動的生成') &&
    !markerText.includes('Just-In-Time AI Post')
  );
  const isJit = !job.isHumanOverride && !prepared && Boolean(job.isJitContent || !primaryText ||
    markerText.includes('投稿直前AI動的生成') ||
    markerText.includes('Just-In-Time AI Post'));
  return { language, isEn, tweets, text, isJit };
}

function isFirestoreIndexError(error) {
  const code = error?.code;
  return (code === 9 || code === 'FAILED_PRECONDITION' || code === 'failed-precondition') &&
    /requires an index|create_composite/i.test(String(error?.message || ''));
}

function hasUnexpectedEnglishCharacters(texts) {
  return texts.some(text => typeof text === 'string' &&
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\uFF66-\uFF9F]/u.test(text));
}

function assertEnglishPost(texts) {
  if (hasUnexpectedEnglishCharacters(texts)) {
    throw new Error('英語設定の投稿に日本語などの文字が含まれるため投稿を停止しました。');
  }
}

async function fetchJitPageSummary(targetUrl) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await fetchUrlSummary(targetUrl);
    if (result?.ok) return result;
    const error = result?.error || '取得結果がありません';
    const transient = /HTTP (?:408|500|502|503|504)\b|fetch failed|timeout|timed out|aborted|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(error);
    if (!transient || attempt === 2) {
      throw new Error(`宣伝先の読み込みに失敗したため投稿を停止しました: ${error}`);
    }
    console.warn(`[JIT Page Retry] 宣伝先の取得を再試行します (${attempt + 1}/2)。`);
    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
  }
}

function getJitAccountContext(user, targetUrl) {
  const strategy = user.latestMarketingStrategy;
  if (!strategy || strategy.targetUrl !== targetUrl ||
      (strategy.userPrompt || '') !== (user.userPrompt || '')) return null;
  const diagnosis = strategy.accountDiagnosis || {};
  const handleMatches = user.xUsername && diagnosis.username &&
    String(user.xUsername).replace(/^@/, '').toLowerCase() === String(diagnosis.username).replace(/^@/, '').toLowerCase();
  const followers = diagnosis.hasOfficialData === true && diagnosis.followersMeasured === true && handleMatches &&
    Number.isSafeInteger(diagnosis.followers) && diagnosis.followers >= 0 ? diagnosis.followers : null;
  const limit = value => typeof value === 'string' ? value.slice(0, 500) : '';
  const market = strategy.marketAnalysis || {};
  const growth = strategy.accountGrowth || {};
  return {
    followers,
    stage: followers === null ? '' : limit(diagnosis.stageName),
    posture: followers === null ? '' : limit(diagnosis.coreStrategicPosture),
    targetAudience: limit(market.targetAudience),
    targetAudienceEn: limit(market.targetAudience_en),
    appeal: limit(market.coreAppealAngle),
    appealEn: limit(market.coreAppealAngle_en),
    roadmap: Array.isArray(growth.weeklyGrowthRoadmap)
      ? growth.weeklyGrowthRoadmap.slice(0, 3).map(phase => ({
        phase: limit(phase?.phase), focus: limit(phase?.focus), focusEn: limit(phase?.focus_en)
      })) : []
  };
}

function getPromotionReply(targetUrl, isEn) {
  const firstUrl = typeof targetUrl === 'string' ? targetUrl.trim().split(/[\s,;]+(?=https?:\/\/)/i)[0] : '';
  if (!/^https?:\/\/\S+$/i.test(firstUrl)) throw new Error('宣伝用URLがないか無効なため投稿を停止しました。');
  let url;
  try {
    url = new URL(firstUrl);
  } catch (err) {
    throw new Error('宣伝用URLが無効なため投稿を停止しました。', { cause: err });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('宣伝用URLが無効なため投稿を停止しました。');
  }
  return isEn ? `[Ad] Details: ${firstUrl}` : `【PR】詳細はこちら: ${firstUrl}`;
}

function shouldPromoteJit(job, user) {
  if (typeof job.isPromotion === 'boolean') return job.isPromotion;
  const plan = user.tierLevel >= 3 || ['business', 'syndicate_business'].includes(user.planId)
    ? 'business' : (user.tierLevel === 1 || user.planId === 'starter' ? 'starter'
      : (user.tierLevel === 2 || user.planId === 'pro' ? 'pro' : null));
  if (!plan) return false;
  const slot = String(job.timeSlot || '').toLowerCase();
  if (plan === 'business') return slot === 'late_night';
  if (plan === 'pro') return slot === 'evening';
  if (slot !== 'morning' || !job.scheduledAt) return false;
  const scheduled = job.scheduledAt.toDate ? job.scheduledAt.toDate() : new Date(job.scheduledAt);
  if (Number.isNaN(scheduled.getTime())) throw new Error('予約日時が無効なため投稿を停止しました。');
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: job.scheduleTimeZone || user.scheduleTimeZone || user.timezone || 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(scheduled);
  return Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86400000) % 2 === 0;
}

function jobHistoryMillis(docData, fields) {
  for (const field of fields) {
    const val = docData && docData[field];
    if (!val) continue;
    const d = val.toDate ? val.toDate() : new Date(val);
    const ms = d.getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

async function loadRecentPostHistory(userId) {
  const jobs = db.collection('autopilot_jobs');
  const postedSinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // Query equality filters only so Firestore never rejects execution on missing composite indexes
  // or drops legacy documents missing postedAt/updatedAt.
  const [posted, processing, failed] = await Promise.all([
    jobs.where('userId', '==', userId).where('status', '==', 'posted').get(),
    jobs.where('userId', '==', userId).where('status', '==', 'processing').get(),
    jobs.where('userId', '==', userId).where('status', '==', 'failed').get()
  ]);
  const sortAndTake = (snapshot, fields, limit, minMs = 0) => snapshot.docs
    .map(doc => ({ ...(doc.data() || {}), id: doc.id || (doc.data() && doc.data().id) }))
    .filter(row => {
      if (!minMs) return true;
      const ts = jobHistoryMillis(row, fields);
      return ts === 0 || ts >= minMs;
    })
    .sort((a, b) => jobHistoryMillis(b, fields) - jobHistoryMillis(a, fields))
    .slice(0, limit);
  return [
    ...sortAndTake(posted, ['postedAt', 'scheduledAt', 'updatedAt', 'createdAt'], 200, postedSinceMs),
    ...sortAndTake(processing, ['updatedAt', 'claimedAt', 'createdAt'], 100),
    ...sortAndTake(failed, ['updatedAt', 'createdAt'], 100)
  ];
}

async function acquireAccountPostLock(userRef, jobId) {
  const now = Date.now();
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) return false;
    const lock = snapshot.data()?.autopilotPostLock;
    const leaseUntil = lock?.leaseUntil?.toDate
      ? lock.leaseUntil.toDate().getTime()
      : (lock?.leaseUntil ? new Date(lock.leaseUntil).getTime() : 0);
    if (lock?.jobId !== jobId && leaseUntil > now) return false;

    transaction.update(userRef, {
      autopilotPostLock: { jobId, leaseUntil: new Date(now + ACCOUNT_POST_LOCK_MS) }
    });
    return true;
  });
}

async function releaseAccountPostLock(userRef, jobId) {
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists || snapshot.data()?.autopilotPostLock?.jobId !== jobId) return false;
    transaction.update(userRef, { autopilotPostLock: null });
    return true;
  });
}

function classifyPostFailure(postRes, errorMessage) {
  if (/duplicate content/i.test(errorMessage)) {
    return { errorCode: 'duplicate_content', postAttemptStatus: 'duplicate' };
  }
  if (postRes?.partialResults?.length ||
      !Number.isInteger(postRes?.status) || postRes.status >= 500) {
    return { errorCode: 'post_result_uncertain', postAttemptStatus: 'unknown' };
  }
  return {
    errorCode: postRes.status === 429 ? 'x_rate_limited' : 'x_api_rejected',
    postAttemptStatus: 'rejected'
  };
}

const visualCardPngCache = new Map();

function rememberVisualCardPng(key, png) {
  if (visualCardPngCache.has(key)) visualCardPngCache.delete(key);
  visualCardPngCache.set(key, png);
  while (visualCardPngCache.size > 40) {
    const oldest = visualCardPngCache.keys().next().value;
    visualCardPngCache.delete(oldest);
  }
  return png;
}

function visualCardUploadPlan(job) {
  const card = job && job.visualCard;
  if (!(process.env.X_MEDIA_WRITE_ENABLED === 'true' && card && card.eligible === true)) {
    return { upload: false, visualCardAttached: false };
  }
  if (card.userDisabled === true) {
    card.reason = 'disabled_by_user';
    return { upload: false, visualCardAttached: false };
  }
  return { upload: true, visualCardAttached: false };
}

async function executeAutopilotJob(jobId, options = {}) {
  let postedForFollowUp = false;
  let followUserId = null;
  const jobRef = db.collection('autopilot_jobs').doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) return { ok: false, error: '指定されたジョブが見つかりません' };

  let job;
  try {
    job = await db.runTransaction(async (t) => {
      const freshSnap = await t.get(jobRef);
      if (!freshSnap.exists) return null;
      const freshData = freshSnap.data();
      if (freshData.status !== 'pending') return null;
      if (options.sessionUser && freshData.userId !== options.sessionUser.userId && !options.sessionUser.isAdmin) return null;
      if (!options.force && !isJobDue(freshData, new Date())) return null;
      t.update(jobRef, {
        status: 'processing',
        claimedAt: new Date(),
        workerPid: process.pid,
        postHistoryRetryAt: null,
        updatedAt: new Date()
      });
      return freshData;
    });
  } catch (txErr) {
    console.error(`[Autopilot Claim Error] ジョブ ${jobId}: ${txErr.message}`);
    return { ok: false, error: `ジョブの取得に失敗しました: ${txErr.message}` };
  }

  if (!job) {
    return { ok: false, conflict: true, error: 'ジョブが見つからないか、待機中ではありません。投稿済みの可能性があるため、X上の状況を確認してください。' };
  }

  console.log(`⏰ [自律投稿発火] ジョブID: ${jobId} (ユーザー: ${job.userId}, 形式: ${job.format || 'single'}) [PID: ${process.pid}]`);

  let postRes;
  let submittedThread = false;
  let jitAccountContext = null;
  let jitTargetUrl = null;
  let growthPhase = null;
  try {
    const userDoc = await db.collection('saas_users').doc(job.userId).get();
    if (!userDoc.exists || !userDoc.data().xOfficialCredentials) {
      console.error(`  ⚠️ ユーザー [${job.userId}] の公式APIキーが未登録のためジョブを中断`);
      await jobRef.update({ status: 'failed', error: 'credentials_missing', updatedAt: new Date() });
      return { ok: false, error: '公式APIキーが未登録です' };
    }

    if (userDoc.data().autopilotPaused && !options.force) {
      console.log(`  ⏸ ユーザー [${job.userId}] は自律運用を一時停止中のためスキップ`);
      if (!job.isHumanOverride) {
        await jobRef.update({ status: 'cancelled', error: 'paused', cancelReason: 'autopilot_paused', updatedAt: new Date() });
      } else {
        await jobRef.update({ status: 'pending', error: 'paused', updatedAt: new Date() });
      }
      return { ok: false, error: '自律運用が一時停止中です' };
    }

    const creds = decryptCredentials(userDoc.data().xOfficialCredentials);
    if (!officialApiOperationAllowed({ ...userDoc.data(), userId: job.userId }, creds)) {
      await jobRef.update({ status: 'cancelled', error: 'official_api_detached', updatedAt: new Date() });
      return { ok: false, error: 'このアカウントは公式APIの運用対象外です。養殖側で扱います。' };
    }
    const consentAccount = getConsentAccount(creds);
    if (!options.force && !hasAutopilotConsent(userDoc.data(), creds)) {
      if (!job.isHumanOverride) {
        await jobRef.update({ status: 'cancelled', error: 'consent_required', cancelReason: 'consent_required', updatedAt: new Date() });
      } else {
        await jobRef.update({ status: 'pending', error: 'consent_required', updatedAt: new Date() });
      }
      return { ok: false, error: '自動投稿には連携アカウントの明示的な同意が必要です。' };
    }
    if (!creds.id && creds.userId) creds.id = creds.userId;
    const xNumeric = /^\d+$/.test(String(creds.userId || '')) ? creds.userId : (userDoc.data().twitterId || '');
    creds.saasUserId = job.userId;
    if (xNumeric) creds.userId = xNumeric;

    const scheduledContent = getScheduledPostContent(job, userDoc.data());
    growthPhase = getGrowthPhase(userDoc.data());
    const { language: userLang, isEn } = scheduledContent;
    let activeTweets = scheduledContent.tweets;
    let activeText = scheduledContent.text;
    let isPromotion = Boolean(job.isPromotion);

    // ⚡ Just-In-Time (JIT) 投稿直前ダイナミック生成
    // 「投稿時間だけあらかじめ決めておいて、投稿する内容・文章量は投稿する直前にAI合議制で決定」
    if (scheduledContent.isJit || (options.forceJit && !job.isHumanOverride)) {
      console.log(`⚡ [JIT 直前文章量・本文生成発火] ジョブID: ${jobId} (${job.timeSlot || 'slot'}) の文章量と本文をリアルタイム生成中...`);
      const targetUrl = job.targetUrl || userDoc.data().targetUrl || '';
      jitTargetUrl = targetUrl;
      if (userDoc.data().targetUrl && targetUrl !== userDoc.data().targetUrl) {
        throw new Error('予約の宣伝先と現在の宣伝先が異なるため投稿を停止しました。');
      }
      const pageSummary = await fetchJitPageSummary(targetUrl);
      try {
        await cancelOtherPendingJobs(job.userId, targetUrl, pageSummary.pageVersion, jobId);
      } catch (cancelErr) {
        console.warn(`[Pending Cancel] ${cancelErr.message}`);
      }
      isPromotion = growthPhase === 'advanced' && shouldPromoteJit(job, userDoc.data());
      jitAccountContext = getJitAccountContext(userDoc.data(), targetUrl);
      let accountState = describeAccountState({ ok: false }, userDoc.data());
      try {
        const liveCreds = decryptCredentials(userDoc.data().xOfficialCredentials);
        liveCreds.saasUserId = job.userId;
        if (!/^\d+$/.test(String(liveCreds.userId || '')) && userDoc.data().twitterId) liveCreds.userId = userDoc.data().twitterId;
        accountState = describeAccountState(await fetchMyAccountState(liveCreds), userDoc.data());
      } catch (stateErr) {
        console.warn(`[Account State] ${stateErr.message}`);
      }
      const jitResult = await generateJitPostContent({
        userId: job.userId,
        lang: userLang,
        timeSlot: job.timeSlot || 'evening',
        targetUrl,
        pageSummary,
        accountState,
        userPrompt: userDoc.data().userPrompt || '',
        accountContext: jitAccountContext,
        affiliateResults: await loadManualAffiliateResults(job.userId),
        isPromotion,
        growthPhase,
        genre: job.genre || 'general',
        targetLength: job.targetLength || 'auto'
      });

      if (!jitResult || typeof jitResult.text !== 'string' || !jitResult.text.trim()) {
        throw new Error('JIT投稿本文を生成できなかったため投稿を停止しました。');
      }
      if (isEn) assertEnglishPost([jitResult.text, ...(Array.isArray(jitResult.tweets) ? jitResult.tweets : [])]);
      if (jitResult && jitResult.text) {
        activeText = jitResult.text;
        activeTweets = Array.isArray(jitResult.tweets) ? [...jitResult.tweets] : [jitResult.text];
        if (isPromotion) {
          if (activeTweets.some(text => /https?:\/\/|t\.co\//i.test(text))) {
            throw new Error('生成文に未確認のURLがあるため投稿を停止しました。');
          }
          if (activeTweets[0] !== activeText) throw new Error('生成された投稿本文が一致しないため投稿を停止しました。');
          const label = isEn ? '[Ad] ' : '【PR】';
          if (!/^(?:\[Ad\]|【PR】)/i.test(activeText)) activeText = label + activeText;
          activeTweets[0] = activeText;
          activeTweets.push(getPromotionReply(targetUrl, isEn));
        }
        if (isEn) {
          job.text_en = activeText;
          job.tweets_en = activeTweets;
        } else {
          job.text = activeText;
          job.tweets = activeTweets;
        }

        // Firestoreのジョブレコードに確定した本文と文章量情報を即時永続化
        await jobRef.update({
          text: job.text || activeText,
          tweets: job.tweets || activeTweets,
          format: activeTweets.length > 1 ? 'split_thread' : 'single_impact',
          isSplitThread: activeTweets.length > 1,
          text_en: job.text_en || (isEn ? activeText : null),
          tweets_en: job.tweets_en || (isEn ? jitResult.tweets : null),
          jitLengthType: jitResult.targetLength || 'dynamic_free',
          jitHookType: jitResult.hookType,
          characterCount: jitResult.characterCount,
          decisionSummary: jitResult.decisionSummary || '',
          contentAngle: jitResult.contentAngle || null,
          pageVersion: jitResult.pageVersion || pageSummary.pageVersion || null,
          hypothesisWho: jitResult.hypothesisWho || null,
          hypothesisWhy: jitResult.hypothesisWhy || null,
          hypothesisProof: jitResult.hypothesisProof || null,
          contentAngleContext: job.timeSlot || 'evening',
          contentAngleSampleCount: Number.isSafeInteger(jitResult.contentAngleSampleCount)
            ? jitResult.contentAngleSampleCount : 0,
          contentAngleBaselineRate: Number.isFinite(jitResult.contentAngleBaselineRate)
            ? jitResult.contentAngleBaselineRate : null,
          isJitGenerated: true,
          isPromotion,
          dynamicallyGeneratedAt: new Date()
        });
        console.log(`  ✅ [JIT生成完了] 文章量: ${jitResult.targetLength} (${jitResult.characterCount}文字) / フック: ${jitResult.hookType}`);
      }
    }

    const postTexts = Array.isArray(activeTweets) && activeTweets.length > 1 ? activeTweets : [activeText];
    if (!job.isHumanOverride) {
      if (growthPhase !== 'advanced' && (
        (!scheduledContent.isJit && !options.forceJit && job.isPromotion === true) ||
        postTexts.some(text => typeof text === 'string' &&
          (extractCleanUrls(text).length > 0 || /\b(?:www\.|t\.co\/|[a-z0-9-]+\.(?:com|net|org|io|co|jp)(?:[/:?#]|\b))/i.test(text)))
      )) {
        throw new Error('信用構築中または段階未確認のため宣伝・URL付き自動投稿を停止しました。');
      }
      if (isEn && !activeText) throw new Error('英語の投稿本文がないため投稿を停止しました。');
      assertPostThreadUnambiguous(postTexts, { lang: isEn ? 'en' : 'ja', timeSlot: job.timeSlot });
      if (isEn) assertEnglishPost(postTexts);
    }

    const compliance = inspectPostCompliance(postTexts, {
      lang: isEn ? 'en' : 'ja',
      isPromotion
    });

    if (!compliance.canAutoPost) {
      await jobRef.update({
        status: 'failed',
        error: 'compliance_review_required',
        requiresHumanReview: true,
        complianceReview: {
          required: true,
          issues: compliance.issues,
          checkedAt: new Date()
        },
        updatedAt: new Date()
      });
      return {
        ok: false,
        requiresHumanReview: true,
        error: '投稿に根拠確認または表現の修正が必要です。Xへの自動投稿は停止しました。',
        issues: compliance.issues
      };
    }

    const latestUser = await db.collection('saas_users').doc(job.userId).get();
    if (!options.force) {
      const latestData = latestUser.exists ? latestUser.data() : null;
      const latestCreds = latestData && latestData.xOfficialCredentials
        ? decryptCredentials(latestData.xOfficialCredentials) : null;
      if (!latestData || latestData.autopilotPaused || !latestCreds ||
          !hasAutopilotConsent(latestData, latestCreds) ||
          getConsentAccount(latestCreds) !== consentAccount) {
        if (!job.isHumanOverride) {
          await jobRef.update({ status: 'cancelled', error: 'paused_or_consent_changed', cancelReason: 'autopilot_paused', updatedAt: new Date() });
        } else {
          await jobRef.update({ status: 'pending', error: 'paused_or_consent_changed', updatedAt: new Date() });
        }
        return { ok: false, error: '停止または同意の変更を検知したため自動投稿を中止しました。' };
      }
    }

    if (!job.isHumanOverride) {
      if (!latestUser.exists ||
          String(latestUser.data().aiTargetLang || job.lang || 'ja').toLowerCase() !== userLang) {
        throw new Error('投稿準備中に投稿言語が変更されたため投稿を停止しました。');
      }
      if (getGrowthPhase(latestUser.data()) !== growthPhase) {
        throw new Error('投稿準備中に成長フェーズが変更されたため投稿を停止しました。');
      }
      if (scheduledContent.isJit || options.forceJit) {
        if ((latestUser.data().targetUrl || '') !== (userDoc.data().targetUrl || '') ||
            (latestUser.data().userPrompt || '') !== (userDoc.data().userPrompt || '')) {
          throw new Error('投稿準備中に宣伝先または指示が変更されたため投稿を停止しました。');
        }
        if (jitTargetUrl !== null && JSON.stringify(getJitAccountContext(latestUser.data(), jitTargetUrl)) !== JSON.stringify(jitAccountContext)) {
          throw new Error('投稿準備中にアカウント戦略が変更されたため投稿を停止しました。');
        }
      }
    }

    if (!job.isHumanOverride) {
      const accountState = job.accountStateSnapshot || describeAccountState({ ok: false }, userDoc.data());
      const audit = runDeterministicAudit({ tweets: postTexts }, {
        lang: isEn ? 'en' : 'ja',
        ngTopics: userDoc.data().ngTopics,
        brandKnowledge: userDoc.data().brandKnowledge,
        userPrompt: userDoc.data().userPrompt,
        brandContextNotes: userDoc.data().brandContextNotes,
        accountState,
        portfolioPlan: { allowPromoUrl: Boolean(job.allowPromoUrl || isPromotion) },
        timeSlot: job.timeSlot,
        recentTexts: (!scheduledContent.isJit && !options.forceJit) ? [] : []
      });
      const blocking = (audit.reasons || []).filter(reason => reason !== 'too_similar_to_recent' && reason !== 'hook_too_similar');
      if (blocking.length) {
        const error = 'pre_publish_audit_failed:' + blocking.join(',');
        await jobRef.update({ status: 'failed', error, updatedAt: new Date() });
        return { ok: false, error };
      }
    }

    const userRef = db.collection('saas_users').doc(job.userId);
    const lockAcquired = await acquireAccountPostLock(userRef, jobId);
    if (!lockAcquired) {
      await jobRef.update({
        status: 'pending',
        error: '同じアカウントの別投稿を処理中です。次回の実行で再確認します。',
        errorCode: 'account_post_in_progress',
        updatedAt: new Date()
      });
      return {
        ok: false,
        conflict: true,
        code: 'account_post_in_progress',
        error: '同じアカウントの別投稿を処理中です。'
      };
    }

    try {
      let recentJobs;
      try {
        recentJobs = await loadRecentPostHistory(job.userId);
      } catch (historyErr) {
        if (!isFirestoreIndexError(historyErr)) throw historyErr;
        console.error(`[Autopilot Post History Index Error] ジョブ ${jobId}: ${historyErr.message}`);
        await jobRef.update({
          status: 'pending',
          error: 'post_history_index_missing',
          errorCode: 'post_history_index_missing',
          failureStage: 'preflight',
          postHistoryRetryAt: new Date(Date.now() + 5 * 60 * 1000),
          updatedAt: new Date()
        });
        return {
          ok: false,
          code: 'post_history_index_missing',
          error: '投稿前の安全確認に必要な履歴を取得できませんでした。今回はXに投稿していません。サポートへお問い合わせください。'
        };
      }
      const duplicate = findDuplicatePostContent(postTexts, recentJobs, jobId);
      if (duplicate) {
        const error = '直近の投稿または送信結果が未確定の投稿と本文が重複するため、X送信を停止しました。';
        await jobRef.update({
          status: 'failed',
          error,
          errorCode: 'duplicate_content',
          postAttemptStatus: 'duplicate',
          duplicateOfJobId: duplicate.duplicateOfJobId,
          requiresHumanReview: true,
          updatedAt: new Date()
        });
        return { ok: false, conflict: true, code: 'duplicate_content', error };
      }

      await jobRef.update({
        postAttemptStatus: 'submitting',
        postSubmissionStartedAt: new Date(),
        updatedAt: new Date()
      });

      let mediaIds = [];
      const cardPlan = visualCardUploadPlan(job);
      if (cardPlan.upload) {
        try {
          const png = await renderVisualCardPng(job.visualCard);
          const uploaded = await uploadOfficialMedia(creds, png);
          if (uploaded && uploaded.ok && uploaded.mediaId) {
            mediaIds = [uploaded.mediaId];
            job.visualCard.mediaIds = mediaIds;
            job.visualCard.reason = 'uploaded';
          } else {
            job.visualCard.reason = uploaded && (uploaded.reason || uploaded.error) || 'upload_skipped';
            console.warn(`[VisualCard] ${job.visualCard.reason}`);
          }
        } catch (cardErr) {
          job.visualCard.reason = 'render_failed';
          console.warn(`[VisualCard] ${cardErr.message}`);
        }
      }
      const referencePlan = require('./topic_source_vault').planVerifiedReference({
        tweets: activeTweets,
        verifiedReferenceUrl: job.verifiedReferenceUrl,
        singleOnly: Boolean(job.accountStateSnapshot && job.accountStateSnapshot.searchVisible === false),
        lang: userLang,
        maxChars: job.accountStateSnapshot && job.accountStateSnapshot.maxChars
      });
      let referenceReplyStatus = referencePlan.status;
      if (Array.isArray(activeTweets) && activeTweets.length > 1) {
        submittedThread = true;
        const outbound = referencePlan.action === 'append' ? referencePlan.tweets : activeTweets;
        console.log(`  🧵 [スレッド自動連動投稿] (${userLang.toUpperCase()}) 全${outbound.length}段階のツリーを公式APIで送信中...`);
        postRes = await postOfficialThread(creds, outbound, mediaIds);
      } else {
        postRes = await postOfficialTweet(creds, activeText, mediaIds);
      }

      if (!postRes || !postRes.ok) {
        const errMsg = postRes ? postRes.error : 'unknown';
        if (require('./account_suspension_care').isSuspendedXError(errMsg)) {
          try {
            await require('./account_suspension_care').handleSuspendedXAccount({
              db,
              userId: job.userId,
              reason: errMsg,
              cancelPendingJobsImpl: cancelNonManualPendingJobs
            });
          } catch (_suspendErr) {}
        }
        const failure = classifyPostFailure(postRes, errMsg);
        console.error(`  ❌ 公式投稿失敗 (${failure.errorCode}):`, errMsg);
        const partialTweets = Array.isArray(postRes?.partialResults)
          ? postRes.partialResults.map(result => ({ tweetId: result.tweetId, tweetUrl: result.tweetUrl }))
          : [];
        await jobRef.update({
          status: 'failed',
          error: errMsg,
          errorCode: failure.errorCode,
          postAttemptStatus: failure.postAttemptStatus,
          partialTweets,
          retryable: false,
          updatedAt: new Date()
        });
        return { ok: false, code: failure.errorCode, error: errMsg };
      }

      if (referencePlan.action === 'reply' && postRes && postRes.tweetId) {
        try {
          const replyRes = await postOfficialTweet(creds, referencePlan.replyText, [], postRes.tweetId);
          referenceReplyStatus = replyRes && replyRes.ok ? 'sent' : 'failed';
        } catch (_replyErr) {
          referenceReplyStatus = 'failed';
        }
      }
      const visualCardAttached = mediaIds.length > 0;
      await jobRef.update({
        status: 'posted',
        referenceReplyStatus,
        visualCard: job.visualCard || null,
        visualCardAttached,
        tweetId: postRes.tweetId,
        tweetUrl: postRes.tweetUrl,
        threadCount: Array.isArray(activeTweets) ? activeTweets.length : 1,
        campaignId: '',
        needs24hHarvest: true, // 🛡️ 24h回収対象フラグを初期化（定期バッチの取りこぼし防止）
        postAttemptStatus: 'confirmed',
        postedAt: new Date(),
        postedHourLocal: (() => {
          try {
            return new Intl.DateTimeFormat('en-GB', { timeZone: job.scheduleTimeZone || 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
          } catch (err) {
            return null;
          }
        })(),
        updatedAt: new Date()
      });
      try {
        const traceWrite = db.collection('generation_traces').doc(String(jobId)).set({ visualCardAttached }, { merge: true });
        if (traceWrite && typeof traceWrite.catch === 'function') traceWrite.catch(() => {});
      } catch (_traceErr) {}

      console.log(`  🎉 [自律投稿完了] ${postRes.tweetUrl}`);
      postedForFollowUp = true;
      followUserId = job.userId;
      return { ok: true, tweetId: postRes.tweetId, tweetUrl: postRes.tweetUrl };
    } finally {
      await releaseAccountPostLock(userRef, jobId).catch(lockErr => {
        console.error(`[Autopilot Post Lock Release Error] ジョブ ${jobId}: ${lockErr.message}`);
      });
      if (postedForFollowUp && followUserId) {
        ensureNextPost(followUserId).catch(err => {
          console.warn(`[Ensure Next] ${followUserId}: ${err.message}`);
        });
      }
    }
  } catch (jobErr) {
    console.error(`  ❌ ジョブ処理例外 (${jobId}):`, jobErr.message);
    const confirmedPost = postRes?.ok && postRes.tweetId;
    const message = confirmedPost
      ? 'X APIでは投稿成功を確認しましたが、結果の保存に失敗しました。X上の投稿を確認してください。'
      : jobErr.message;
    const failureUpdate = {
      status: 'failed',
      error: message,
      errorCode: jobErr.code || 'autopilot_job_failed',
      failureStage: String(jobErr.code || '').startsWith('jit_') ? 'generation' : 'processing',
      updatedAt: new Date()
    };
    if (confirmedPost) {
      failureUpdate.tweetId = postRes.tweetId;
      if (postRes.tweetUrl) failureUpdate.tweetUrl = postRes.tweetUrl;
      failureUpdate.postAttemptStatus = 'confirmed';
      if (!submittedThread) {
        failureUpdate.postConfirmation = { type: 'single_post_api_success', tweetId: postRes.tweetId };
      }
    }
    await jobRef.update(failureUpdate).catch(err => {
      console.error(`[Autopilot Failure Update Error] ジョブ ${jobId}: ${err.message}`);
    });
    return { ok: false, error: message };
  }
}

// ========================================================================
// 🎯 複数URL抽出ヘルパー（改行・カンマ・スペース区切り対応）
// ========================================================================
function extractTargetUrls(rawUrl) {
  if (!rawUrl) return ['https://veloxpostapp.com'];
  const urls = String(rawUrl)
    .split(/[\n,\s]+/)
    .map(u => u.trim())
    .filter(u => u.startsWith('http://') || u.startsWith('https://'));
  return urls.length > 0 ? urls : ['https://veloxpostapp.com'];
}

// ========================================================================
// 投稿プレビューの生成。成果やアルゴリズム上の効果を保証せず、宣伝URLは明示表示がある場合のみ含める。
// ========================================================================
function generateBestPracticeDraft(slot, rawUrl, isEn = false, userPrompt = '', slotIndex = 0, isPromotion = false) {
  const postBySlot = isEn ? {
    morning: 'A useful publishing routine starts with a clear audience and one specific question.\n\nDraft from verified details, then review the wording before scheduling.',
    noon: 'When reviewing a post, separate the content decision from the outcome.\n\nRecord the format and measured results, then test one change next time.',
    afternoon: 'A repeatable workflow can make publishing easier to manage.\n\nKeep time for thoughtful replies that need a person, and adjust the schedule to your capacity.',
    evening: 'Before publishing, check three things: Is each claim supported? Is the audience clear? Is any promotion disclosed?\n\nSmall, measurable edits make learning easier.',
    late_night: 'A sustainable publishing schedule is one you can maintain.\n\nReview mature post metrics over time; one result alone does not establish a pattern.',
    default: 'Share a useful lesson, explain what supports it, and leave room for readers to reach their own conclusions.'
  } : {
    morning: '投稿を続けるには、まず「誰に何を届けるか」を一つ決める。\n\n確認できる情報をもとに下書きし、予約前に表現を見直す。',
    noon: '投稿を振り返るときは、内容の選択と結果を分けて考える。\n\n形式と実測値を記録し、次回は変更点を一つに絞って試す。',
    afternoon: '無理のない手順を決めると、発信を続けやすくなる。\n\n人が対応すべき返信の時間も確保し、運用量は使える時間に合わせる。',
    evening: '投稿前に確認したいことは三つ。主張に根拠があるか、読者が明確か、宣伝なら表示されているか。\n\n変更点を一つずつ記録すると、振り返りやすい。',
    late_night: '続けられる発信ペースは、人や事業によって異なる。\n\n成熟した投稿の実測値を継続して見て、一件だけで傾向を決めつけない。',
    default: '役立つ学びと、その根拠を伝える。読者が自分で判断できる余地も大切にする。'
  };
  const disclosure = isPromotion ? (isEn ? '[Ad] ' : '【PR】') : '';
  const postText = `${disclosure}${postBySlot[slot] || postBySlot.default}`;
  let replyText;
  if (isPromotion) {
    const urlList = extractTargetUrls(rawUrl);
    const targetUrl = urlList[slotIndex % urlList.length] || urlList[0];
    replyText = getPromotionReply(targetUrl, isEn);
  } else {
    replyText = isEn
      ? 'Additional context: use examples and results that you can verify and are permitted to share.'
      : '補足：共有できる事例や実績は、確認できるものに限って記載する。';
  }

  return {
    postText,
    replyText,
    tweets: [postText, replyText],
    isThread: true,
    format: 'two_tier_reply_link'
  };
}

// ========================================================================
// ⚡ 契約プランに応じたJITゴールデンタイムスロットの即時配備
// - Business (最上位): 1日5枠（朝08:30, 昼12:30, 夕17:30, 夜20:00, 深夜22:30 JST）
// - Pro: 1日3枠（朝08:30, 昼12:30, 夜20:00 JST）
// - Starter: 1日1枠（朝08:30 JST）
// 投稿内容や文章量は投稿時刻直前にAI合議制で動的生成（JIT）するため待ち時間ゼロで即座に配備
// ========================================================================
async function schedulePlanJitSlots(userId, options = {}) {
  const userDoc = await db.collection('saas_users').doc(userId).get();
  if (!userDoc.exists) throw new Error('ユーザーが見つかりません');
  const uData = userDoc.data();
  
  // 👑 最上位プランの厳格自動判定（tierLevel 3以上、または planId が business なら確実に1日5枠）
  let plan = 'pro';
  if (uData.tierLevel >= 3 || uData.planId === 'business' || uData.planId === 'syndicate_business' || options.plan === 'business') {
    plan = 'business';
  } else if (uData.tierLevel === 1 || uData.planId === 'starter' || options.plan === 'starter') {
    plan = 'starter';
  } else {
    plan = options.plan || uData.planId || 'pro';
  }

  const tz = options.scheduleTimeZone || uData.scheduleTimeZone || uData.timezone || 'Asia/Tokyo';
  const lang = options.lang || uData.aiTargetLang || 'ja';
  const isEn = String(lang).toLowerCase().startsWith('en');
  const targetUrl = options.targetUrl || uData.targetUrl || '';
  const userPrompt = options.userPrompt != null ? options.userPrompt : (uData.userPrompt || '');

  let slotConfigs = [];
  if (plan === 'business') {
    // 👑 最上位ビジネスプラン: 1日5回（朝・昼・夕・夜・深夜の24時間露出）
    slotConfigs = [
      { hour: 8, minute: 30, slot: 'morning', length: 'short_punchy', angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示（一次データ＋共感）', angle_en: 'Operational Cost Recovery & Executive Empathy' },
      { hour: 12, minute: 30, slot: 'noon', length: 'medium_insight', angle: 'よくある誤解を根拠に基づいて説明する', angle_en: 'Explain a common misconception with evidence' },
      { hour: 17, minute: 30, slot: 'afternoon', length: 'medium_insight', angle: '夕方の終業時・1日の業務振り返りと自動化による生産性改善ティップス', angle_en: 'End-of-day Efficiency & Automation Playbook' },
      { hour: 20, minute: 0, slot: 'evening', length: 'deep_retention', angle: '読者に役立つ実測結果の振り返り', angle_en: 'Review measured results and share reader value' },
      { hour: 22, minute: 30, slot: 'late_night', length: 'deep_retention', angle: '深夜のリラックス時・創業の裏側と本質的な組織・仕組み化論', angle_en: 'Behind-the-Scenes Founder Narrative & Systemization' }
    ];
  } else if (plan === 'starter') {
    // スターター: 1日1回（朝）
    slotConfigs = [
      { hour: 8, minute: 30, slot: 'morning', length: 'short_punchy', angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示', angle_en: 'Operational Cost Recovery & Executive Empathy' }
    ];
  } else {
    // プロ運用: 1日3回（朝・昼・夜）
    slotConfigs = [
      { hour: 8, minute: 30, slot: 'morning', length: 'short_punchy', angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示', angle_en: 'Operational Cost Recovery & Executive Empathy' },
      { hour: 12, minute: 30, slot: 'noon', length: 'medium_insight', angle: 'よくある誤解を根拠に基づいて説明する', angle_en: 'Explain a common misconception with evidence' },
      { hour: 20, minute: 0, slot: 'evening', length: 'deep_retention', angle: '読者に役立つ実測結果の振り返り', angle_en: 'Review measured results and share reader value' }
    ];
  }

  const campaignId = `auto_${randomUUID()}`;
  const now = new Date();
  const batch = db.batch();

  // 古い未投稿(pending)ジョブをクリーンアップ（古い計画は削除して新しい計画を立てる）
  if (!options.isReplenish) {
    const oldJobsSnap = await db.collection('autopilot_jobs')
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .get();
    console.log(`🧹 [新計画策定] ユーザー: ${userId} の過去の未投稿ジョブ ${oldJobsSnap.size}件を削除し、最新プラン枠に刷新します`);
    oldJobsSnap.docs.forEach(d => batch.delete(d.ref, { lastUpdateTime: d.updateTime }));
  }

  // 直近ゴールデンタイム枠の計算
  const createdJobs = [];
  const baseDate = options.startFromDate ? new Date(options.startFromDate) : now;

  slotConfigs.forEach((s, idx) => {
    const jitter = Math.floor(Math.random() * 8);
    let scheduledDate = dateAtTimeInZone(baseDate, tz, s.hour, s.minute + jitter, 0);
    const earliestTime = options.isReplenish ? baseDate.getTime() : now.getTime() + 15 * 60 * 1000;
    if (scheduledDate.getTime() <= earliestTime) {
      scheduledDate = dateAtTimeInZone(baseDate, tz, s.hour, s.minute + jitter, 1);
    }

    const isPromotion = getGrowthPhase(uData) === 'advanced' && shouldPromoteJit(
      { timeSlot: s.slot, scheduledAt: scheduledDate, scheduleTimeZone: tz },
      { planId: plan }
    );

    const jobId = `job_${campaignId}_${idx + 1}`;
    const jobRef = db.collection('autopilot_jobs').doc(jobId);

    // 📝 現在策定中の最適プラクティス投稿案（ドラフト・Zero In-Body URLスレッド型）を動的に初期設定
    const draftObj = generateBestPracticeDraft(s.slot, targetUrl, isEn, userPrompt, idx, isPromotion);

    const jobData = {
      jobId,
      userId,
      campaignId,
      scheduleTimeZone: tz,
      lang,
      targetUrl,
      timeSlot: s.slot,
      targetLength: s.length,
      angle: s.angle,
      angle_en: s.angle_en,
      format: 'two_tier_reply_link',
      text: draftObj.postText,
      tweets: draftObj.tweets,
      draftText: draftObj.postText,
      draftReplyText: draftObj.replyText,
      text_en: isEn ? draftObj.postText : null,
      tweets_en: isEn ? draftObj.tweets : null,
      isThread: true,
      isJitContent: true,
      isPromotion,
      isDraftReviewing: true, // ⏳ 配信時間ギリギリまでAIが推敲・ブラッシュアップ中
      status: 'pending',
      scores: { hook: 96, empathy: 97, algo: 95, brand: 96, total: 96 },
      scheduledAt: scheduledDate,
      targetLikes: 10,
      targetRetweets: 5,
      targetQuotes: 2,
      createdAt: new Date()
    };

    batch.create(jobRef, jobData);
    createdJobs.push(jobData);
  });

  const userRef = db.collection('saas_users').doc(userId);
  const userUpdates = {
    targetUrl,
    userPrompt,
    aiTargetLang: lang,
    scheduleTimeZone: tz,
    lastAutopilotCampaignId: campaignId,
    updatedAt: new Date()
  };
  if (options.isReplenish) {
    if (!options.expectedUserUpdateTime) throw new Error('自動補充のユーザー更新時刻がありません');
    batch.update(userRef, {
      lastAutopilotCampaignId: campaignId,
      updatedAt: new Date()
    }, { lastUpdateTime: options.expectedUserUpdateTime });
  } else {
    if (!userDoc.updateTime) throw new Error('ユーザーの更新時刻を確認できません');
    batch.update(userRef, userUpdates, { lastUpdateTime: userDoc.updateTime });
  }

  await batch.commit();

  return {
    campaignId,
    scheduledCount: createdJobs.length,
    plan,
    jobs: createdJobs
  };
}

// 🤖 予約投稿自動補充エンジン: 未投稿(pending)ジョブが2件未満のアクティブユーザーに次回枠を自動補充
let replenishCursor = null;
let replenishRunning = false;

async function autoReplenishAllActiveQueues() {
  if (replenishRunning) return;
  replenishRunning = true;
  let replenished = 0;
  try {
    let query = db.collection('saas_users').orderBy('__name__').limit(100);
    if (replenishCursor) query = query.startAfter(replenishCursor);
    const snap = await query.get();
    if (snap.empty) {
      replenishCursor = null;
      return;
    }
    const eligibleDocs = [];
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (!isPaidAccount(data) || data.autopilotPaused) continue;
      eligibleDocs.push(doc);
    }
    let stoppedEarly = false;
    for (let i = 0; i < eligibleDocs.length; i += 4) {
      const batch = eligibleDocs.slice(i, i + 4);
      replenishCursor = batch[batch.length - 1];
      const results = await Promise.allSettled(batch.map(doc => ensureNextPost(doc.id)));
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled' && res.value && res.value.jobId) {
          replenished += 1;
        } else if (res.status === 'rejected') {
          const reason = res.reason;
          const stack = reason && reason.stack ? String(reason.stack).split('\n').slice(0, 2).join(' | ') : '';
          console.warn(`[Ensure Next] ${batch[idx].id}: ${reason?.message || reason}${stack ? ` | ${stack}` : ''}`);
        }
      });
      if (replenished >= 16) {
        stoppedEarly = i + 4 < eligibleDocs.length;
        break;
      }
    }
    if (!stoppedEarly) {
      replenishCursor = snap.docs[snap.docs.length - 1];
      if (snap.size < 100) replenishCursor = null;
    }
  } finally {
    replenishRunning = false;
  }
}

async function recoverStaleProcessingJobs(database = db, now = Date.now()) {
  const snap = await database.collection('autopilot_jobs').where('status', '==', 'processing').limit(30).get();
  const cutoff = now - 5 * 60 * 1000;
    let recovered = 0;
  for (const doc of snap.docs || []) {
    if (!doc.ref || typeof doc.ref.set !== 'function') continue;
    const job = doc.data() || {};
    const claimedRaw = job.claimedAt || job.updatedAt;
    const claimed = claimedRaw && claimedRaw.toDate ? claimedRaw.toDate() : new Date(claimedRaw || 0);
    if (!claimed || Number.isNaN(claimed.getTime()) || claimed.getTime() > cutoff) continue;
    if (job.postAttemptStatus === 'submitting') continue;
    await doc.ref.set({
      status: 'pending',
      error: 'recovered_before_submit',
      postAttemptStatus: null,
      updatedAt: new Date(now)
    }, { merge: true });
    recovered += 1;
    if (!job.userId) continue;
    const userRef = database.collection('saas_users').doc(job.userId);
    const userSnap = await userRef.get();
    const lock = userSnap.exists ? userSnap.data().autopilotPostLock : null;
    const leaseRaw = lock && lock.leaseUntil;
    const lease = leaseRaw && leaseRaw.toDate ? leaseRaw.toDate() : (leaseRaw ? new Date(leaseRaw) : null);
    if (lock && (lock.jobId === doc.id || (lease && lease.getTime() < now))) {
      await userRef.set({ autopilotPostLock: null }, { merge: true });
    }
  }
  return { recovered };
}

let outboundCursor = null;

async function processOutboundReplyDiscovery() {
  if (String(process.env.X_OUTBOUND_REPLY_DISCOVERY || 'true').toLowerCase() === 'false') return { saved: 0 };
  const { searchRecentPublicTweets, decryptCredentials, fetchMyAccountState } = require('./official_api_client');
  const { describeAccountState } = require('./customer_post_state');
  const { searchQueryFor, selectDiscoveryCard, discoverOutboundCandidates, discoveryStatusFromSearch, saveOutboundDiscovery } = require('./outbound_reply_queue');
  const { completeWriter, completeCritic } = require('./llm_router');
  const { isPaidAccount } = require('./plan_post_budget');
  let query = db.collection('saas_users').orderBy('__name__').limit(20);
  if (outboundCursor) query = query.startAfter(outboundCursor);
  const snap = await query.get();
  if (!snap.size) {
    outboundCursor = null;
    return { saved: 0 };
  }
  let saved = 0;
  for (const doc of snap.docs) {
    outboundCursor = doc;
    const user = doc.data() || {};
    const topics = user.audienceKnowledge && user.audienceKnowledge.audienceTopics;
    const picked = selectDiscoveryCard(topics, user.outboundReplyDiscovery && user.outboundReplyDiscovery.nextCardCursor);
    const card = picked.card;
    if (!isPaidAccount(user) || user.autopilotPaused || user.xLinkHealthStatus === 'suspended' || !user.xOfficialCredentials || !card) continue;
    const creds = decryptCredentials(user.xOfficialCredentials);
    creds.saasUserId = doc.id;
    let accountSubscription = 'unknown';
    try {
      accountSubscription = describeAccountState(await fetchMyAccountState(creds), user).subscription;
    } catch (accountErr) {
      console.warn(`[Outbound Account] ${String(accountErr && accountErr.message || '').slice(0, 120)}`);
    }
    const found = await searchRecentPublicTweets(creds, {
      query: searchQueryFor(card, String(user.aiTargetLang || '').toLowerCase().startsWith('en') ? 'en' : 'ja')
    });
    let rows = [];
    const gate = { skipped: 0, noCard: 0, safety: 0, critic: 0, attempted: 0 };
    if (found.tweets.length) {
      const [blockedSnap, existing] = await Promise.all([
        db.collection('saas_users').doc(doc.id).collection('blocked_reply_authors').limit(20).get(),
        db.collection('saas_users').doc(doc.id).collection('outbound_reply_candidates').limit(30).get()
      ]);
      const recentAuthorIds = Object.keys(user.autoReplyLastByAuthor || {}).filter(authorId => {
        const at = new Date(user.autoReplyLastByAuthor[authorId]).getTime();
        return Number.isFinite(at) && Date.now() - at < 24 * 60 * 60 * 1000;
      });
      rows = await discoverOutboundCandidates({
        user: { ...user, accountSubscription },
        tweets: found.tweets,
        completeWriter,
        completeCritic,
        existingIds: existing.docs.map(item => item.id),
        blockedAuthorIds: blockedSnap.docs.map(item => item.id),
        recentAuthorIds,
        stats: gate
      });
      for (const row of rows) {
        await db.collection('saas_users').doc(doc.id).collection('outbound_reply_candidates').doc(row.tweetId).set(row);
        saved += 1;
      }
    }
    const discovery = discoveryStatusFromSearch(found, rows.length);
    await saveOutboundDiscovery(db.collection('saas_users').doc(doc.id), { ...discovery, lastRunAt: new Date().toISOString(), nextCardCursor: picked.nextCursor });
    console.log(`[Outbound Reply Discovery] user=${doc.id} status=${discovery.lastStatus} http=${discovery.lastHttpStatus} matches=${discovery.lastMatchCount} skipped=${gate.skipped} noCard=${gate.noCard} safety=${gate.safety} critic=${gate.critic}`);
    if (saved) break;
  }
  if (snap.size < 20) outboundCursor = null;
  return { saved };
}

let autoReplyRunning = false;
let autoReplyCooldownUntil = 0;
let autoReplyCursor = null;

async function processInboundAutoReplies(options = {}) {
  if (String(process.env.X_AUTO_REPLY_PHASE2_ENABLED || '').toLowerCase() !== 'true') return { processed: 0 };
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
  if (autoReplyRunning || nowMs < autoReplyCooldownUntil) return { processed: 0, cooledDown: nowMs < autoReplyCooldownUntil };
  autoReplyRunning = true;
  const { autoReplyPhase2Allowed, detectOptOut, replyAllowedNow, replyPassesSafety, planReplyCap, replySentToday, composeInboundReply, shouldTripAutoReplyCooldown } = require('./auto_reply_policy');
  const { runDeterministicAudit } = require('./draft_verifier');
  const { hasXaiKey, completeText } = require('./grok_client');
  const maxAppPerTick = Math.max(1, Math.min(20, Number(process.env.X_AUTO_REPLY_APP_MAX_PER_TICK || 6) || 6));
  const maxUserPerTick = 2;
  const paceWait = typeof options.paceFn === 'function'
    ? options.paceFn
    : (ms => new Promise(resolve => setTimeout(resolve, ms)));

  let processed = 0;
  try {
    let query = db.collection('saas_users').orderBy('__name__').limit(50);
    if (autoReplyCursor) query = query.startAfter(autoReplyCursor);
    const snap = await query.get();
    if (!snap || snap.empty) {
      autoReplyCursor = null;
      return { processed: 0 };
    }
    let stoppedEarly = false;
    for (const doc of snap.docs) {
      if (processed >= maxAppPerTick || Date.now() < autoReplyCooldownUntil) {
        stoppedEarly = true;
        break;
      }
      autoReplyCursor = doc;
      const user = { ...(doc.data() || {}), userId: doc.id };
      if (!user.xOfficialCredentials || user.xLinkHealthStatus === 'suspended') continue;
      const creds = decryptCredentials(user.xOfficialCredentials);
      creds.saasUserId = doc.id;
      if (!autoReplyPhase2Allowed(user, creds).allowed) continue;
      const fetched = await getOfficialMentions(creds, 15);
      if (!fetched || fetched.ok === false) {
        if (fetched && require('./account_suspension_care').isSuspendedXError(fetched.error)) {
          try {
            await require('./account_suspension_care').handleSuspendedXAccount({
              db,
              userId: doc.id,
              reason: fetched.error,
              cancelPendingJobsImpl: cancelNonManualPendingJobs
            });
          } catch (_suspendErr) {}
          continue;
        }
        if (fetched && shouldTripAutoReplyCooldown(fetched.error)) {
          autoReplyCooldownUntil = Date.now() + 15 * 60 * 1000;
          console.warn('[Auto Reply] App/Rate limit detected on mention read; pausing Phase 2 for 15 minutes:', fetched.error);
          break;
        }
        continue;
      }
      const cap = planReplyCap(user);
      const daily = replySentToday(user);
      let sentToday = daily.sentToday;
      user.autoReplySentDate = daily.sentDate;
      let userSentThisTick = 0;
      for (const mention of fetched.mentions || []) {
        if (processed >= maxAppPerTick || userSentThisTick >= maxUserPerTick) break;
        const authorId = String(mention.authorId || '');
        if (detectOptOut(mention.text)) {
          await db.collection('saas_users').doc(doc.id).collection('blocked_reply_authors').doc(authorId || 'unknown').set({ authorId, blockedAt: new Date(), reason: 'opt_out' });
          continue;
        }
        const blocked = authorId ? await db.collection('saas_users').doc(doc.id).collection('blocked_reply_authors').doc(authorId).get() : { exists: false };
        const decision = replyAllowedNow({
          authorId,
          selfTwitterId: String(fetched.myId || user.twitterId || ''),
          blocked: blocked.exists,
          lastReplyAt: user.autoReplyLastByAuthor && user.autoReplyLastByAuthor[authorId],
          sentToday,
          dailyCap: cap,
          cooldownHours: user.autoReplySettings && user.autoReplySettings.cooldownHoursPerAuthor
        });
        if (!decision.ok) continue;
        const ref = db.collection('saas_users').doc(doc.id).collection('inbound_mentions').doc(String(mention.id));
        const claimed = await db.runTransaction(async transaction => {
          const current = await transaction.get(ref);
          const state = current.exists ? (current.data() || {}).replyState : 'none';
          if (state === 'sending' || state === 'replied') return false;
          transaction.set(ref, { replyState: 'sending', tweetId: String(mention.id), text: String(mention.text || '').slice(0, 500) }, { merge: true });
          return true;
        });
        if (!claimed) continue;
        if (!process.env.ANTHROPIC_API_KEY && !hasXaiKey()) {
          await ref.set({ replyState: 'skipped_draft_error' }, { merge: true });
          continue;
        }
        let replyBudgetExceeded = false;
        try {
          const { checkTenantAiBudget } = require('./tenant_ai_budget');
          const gate = await checkTenantAiBudget({ db, userId: doc.id, user, kind: 'llm' });
          replyBudgetExceeded = gate.allowed === false;
        } catch (_budgetErr) {}
        const composed = await composeInboundReply({
          user,
          mention,
          recentReplies: user.autoReplyRecentTexts || [],
          budgetExceeded: replyBudgetExceeded
        });
        const draft = composed.ok ? sanitizePostOrReplyText(composed.text) : '';
        if (!composed.ok || !draft) {
          await ref.set({ replyState: composed.reason === 'monthly_budget_exceeded' ? 'skipped_budget' : 'skipped_draft_error' }, { merge: true });
          continue;
        }
        try {
          const { recordTenantAiUsage } = require('./tenant_ai_budget');
          await recordTenantAiUsage({ db, userId: doc.id, kind: 'llm', role: 'writer', count: 1 });
        } catch (_recordErr) {}
        const replyLang = composed.lang === 'en' ? 'en' : 'ja';
        const compliance = inspectPostCompliance([draft], { lang: replyLang, isPromotion: false });
        const audit = runDeterministicAudit({ tweets: [draft] }, { lang: replyLang, ngTopics: user.ngTopics, accountState: { postShape: 'single', subscription: 'premium', maxChars: 280 } });
        if (!replyPassesSafety(draft, user.ngTopics) || !compliance.canAutoPost || audit.reasons.length) {
          await ref.set({ replyState: 'skipped_audit' }, { merge: true });
          continue;
        }
        if (processed > 0) {
          await paceWait(1200 + Math.floor(Math.random() * 1000));
        }
        const sent = await postOfficialTweet(creds, draft, [], mention.id);
        if (!sent || sent.ok === false) {
          await ref.set({ replyState: 'none' }, { merge: true });
          if (sent && shouldTripAutoReplyCooldown(sent.error)) {
            autoReplyCooldownUntil = Date.now() + 15 * 60 * 1000;
            console.warn('[Auto Reply] App/Rate limit detected on reply send; pausing Phase 2 for 15 minutes:', sent.error);
            break;
          }
          continue;
        }
        sentToday += 1;
        userSentThisTick += 1;
        await ref.set({ replyState: 'replied', repliedAt: new Date(), replyTweetId: sent.tweetId || null }, { merge: true });
        const repliedAt = new Date().toISOString();
        user.autoReplyLastByAuthor = { ...(user.autoReplyLastByAuthor || {}), [authorId]: repliedAt };
        user.autoReplyRecentTexts = [...(user.autoReplyRecentTexts || []), draft].slice(-5);
        await db.collection('saas_users').doc(doc.id).set({
          autoReplySentCount: sentToday,
          autoReplySentDate: user.autoReplySentDate,
          autoReplyRecentTexts: user.autoReplyRecentTexts,
          autoReplyLastByAuthor: user.autoReplyLastByAuthor
        }, { merge: true });
        processed += 1;
      }
      if (Date.now() < autoReplyCooldownUntil) break;
    }
    if (!stoppedEarly && snap.size < 50) autoReplyCursor = null;
    return { processed };
  } finally {
    autoReplyRunning = false;
  }
}

function startAutopilotJobRunner() {
  if (autopilotWorkerActive) return;
  autopilotWorkerActive = true;
  recoverStaleProcessingJobs().catch(err => console.warn(`[Stale Processing] ${err.message}`));
  console.log(`🚀 [Autopilot Worker Started] プロセス PID ${process.pid} で自律投稿タイマーワーカーが起動しました`);

  let cursor = null;
  let running = false;
  const maxJobsPerTick = Math.max(1, Number(process.env.AUTOPILOT_JOBS_PER_TICK || 3) || 3);
  const jobConcurrency = Math.max(1, Number(process.env.AUTOPILOT_JOB_CONCURRENCY || 1) || 1);
  const pageLimit = Math.max(20, Number(process.env.AUTOPILOT_SCAN_LIMIT || 50) || 50);
  const maxPages = Math.max(5, Number(process.env.AUTOPILOT_SCAN_PAGES || 10) || 10);
  const flushChunk = async (chunk) => {
    if (!chunk.length) return;
    await Promise.allSettled(chunk.map(async (jobId) => {
      try {
        await executeAutopilotJob(jobId, { force: false });
      } catch (jobErr) {
        console.error(`[Autopilot Runner Job Error] ${jobId}:`, jobErr.message);
        if (/429/.test(String(jobErr && jobErr.message))) {
          const waitMs = 250 + Math.floor(Math.random() * 750);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
    }));
  };

  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await recoverStaleProcessingJobs();
      let pages = 0;
      let attempted = 0;
      while (pages < maxPages && attempted < maxJobsPerTick) {
        let query = db.collection('autopilot_jobs')
          .where('status', '==', 'pending')
          .orderBy('__name__')
          .limit(pageLimit);
        if (cursor) query = query.startAfter(cursor);
        const snap = await query.get();
        pages++;
        if (snap.empty) {
          cursor = null;
          break;
        }

        let scanned = 0;
        let chunk = [];
        for (const doc of snap.docs) {
          cursor = doc;
          scanned++;
          if (!isJobDue(doc.data(), new Date())) continue;
          attempted++;
          chunk.push(doc.id);
          if (chunk.length >= jobConcurrency || attempted >= maxJobsPerTick) {
            await flushChunk(chunk);
            chunk = [];
          }
          if (attempted >= maxJobsPerTick) break;
        }
        await flushChunk(chunk);

        if (scanned === snap.size && snap.size < pageLimit) {
          cursor = null;
          break;
        }
      }
    } catch (e) {
      console.error('Autopilot Runner Error:', e.message);
    } finally {
      running = false;
    }
  }, 60 * 1000); // 1分ごとにチェック

  // 2分ごとに巡回してキュー補充チェック
  setInterval(() => autoReplenishAllActiveQueues().catch(err => {
    console.error('[autoReplenishAllActiveQueues Error]:', err.message);
  }), 2 * 60 * 1000);
  setInterval(() => processInboundAutoReplies().catch(err => {
    console.error('[Auto Reply Worker]:', err.message);
  }), 4 * 60 * 1000);
  setInterval(() => processOutboundReplyDiscovery().catch(err => {
    console.error('[Outbound Reply Discovery]:', err.message);
  }), 10 * 60 * 1000);
  setTimeout(() => autoReplenishAllActiveQueues().catch(err => {
    console.error('[autoReplenishAllActiveQueues Error]:', err.message);
  }), 15 * 1000);

  let topicVaultRunning = false;
  const topicVaultTick = () => {
    if (topicVaultRunning) return;
    topicVaultRunning = true;
    require('./topic_source_vault').runTopicSourceVaultSweep(db)
      .catch(err => console.error('[Topic Vault]:', String(err && err.message || err).slice(0, 120)))
      .finally(() => { topicVaultRunning = false; });
  };
  setTimeout(topicVaultTick, 5 * 60 * 1000);
  setInterval(topicVaultTick, 3 * 60 * 60 * 1000);

  let metricsRunning = false;
  setInterval(() => {
    if (metricsRunning) return;
    metricsRunning = true;
    syncAllActiveCustomersPostMetrics()
      .catch(err => console.error('[SaaS Metrics Sync Error]:', err.message))
      .finally(() => { metricsRunning = false; });
  }, 10 * 60 * 1000);
}

// XAPIから保存した実測スナップショットだけでアカウントの振り返りを作成する。
async function runCouncilAccountAudit({ handle, hasApi, userId, isEn }) {
  const jobsSnap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'posted')
    .limit(300)
    .get();
  return buildAccountGrowthReport({
    handle,
    hasApi,
    posts: jobsSnap.docs.map(doc => doc.data()),
    isEn
  });
}

// ユーザーIDまたはメールアドレスからユーザー情報を引くヘルパー
async function resolveUserDoc(userId) {
  if (!userId) return null;
  let doc = await db.collection('saas_users').doc(userId).get();
  if (doc.exists) return { userId, doc, data: doc.data() };
  const snap = await db.collection('saas_users').where('email', '==', userId).limit(1).get();
  if (!snap.empty) {
    const foundDoc = snap.docs[0];
    return { userId: foundDoc.id, doc: foundDoc, data: foundDoc.data() };
  }
  return null;
}

// ========================================================================
// 🛡️ ルーティング登録関数
// ========================================================================
function registerHybridSaasRoutes(app, options = {}) {
  const runWorker = options.runWorker !== false;
  if (runWorker && process.env.DISABLE_INLINE_AUTOPILOT_WORKER !== 'true') {
    startAutopilotJobRunner();
  } else {
    console.log(`ℹ️ [Autopilot Worker] プロセス PID ${process.pid} ではワーカー起動をスキップ（単一実行ワーカー構成）`);
  }

  function resolveUiLang(req, fallback = 'ja') {
    const cookiePart = String((req.headers && req.headers.cookie) || '')
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith('velox_lang='));
    const fromCookie = cookiePart ? decodeURIComponent(cookiePart.split('=').slice(1).join('=')) : '';
    const candidates = [req.body && req.body.uiLang, req.query && req.query.uiLang, fromCookie, fallback];
    for (const value of candidates) {
      if (value === 'en' || value === 'ja') return value;
    }
    return 'ja';
  }

  // 0-A. Wise Webhook 受信エンドポイント
  app.post('/api/webhooks/wise', async (req, res) => {
    try {
      const result = await processWiseWebhook(req.body);
      res.json(result);
    } catch (err) {
      console.error('Webhook routing error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 0-B. プラン購入チェックアウト (Wise)
  // 🛡️ セッションCookieを必須化し、ログイン本人に確実に注文を紐付け
  app.post('/api/hybrid/checkout', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。先にログインしてください。' });
      }
      const userId = sessionUser.userId;
      const { plan = 'pro', currency = 'jpy' } = req.body || {};
      const cur = String(currency).toLowerCase();
      
      const pricing = {
        jpy: { starter: 4980, pro: 9800, business: 19800 },
        usd: { starter: 39, pro: 79, business: 179 }
      };
      const amount = (pricing[cur] && pricing[cur][plan]) || (cur === 'usd' ? 79 : 9800);
      const orderSpec = buildWiseOrderSpec({ userId, plan, amount, currency: cur });
      await db.collection('hybrid_orders').doc(orderSpec.orderId).set(orderSpec);

      res.json({
        ok: true,
        orderId: orderSpec.orderId,
        paymentUrl: orderSpec.paymentUrl,
        wiseRef: orderSpec.wiseRef,
        amount: orderSpec.amount,
        currency: orderSpec.currency
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 0-C. 注文の決済ステータス確認
  // 🛡️ 注文所有者本人（o.userId === sessionUser.userId）を照合
  app.get('/api/hybrid/check-order', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ paid: false, error: 'ログインセッションが無効です。' });
      }

      const { orderId } = req.query;
      if (!orderId) return res.json({ paid: false, error: 'orderId missing' });
      const snap = await db.collection('hybrid_orders').doc(orderId).get();
      if (!snap.exists) return res.status(404).json({ paid: false, error: 'order not found' });
      const o = snap.data();

      // 所有者照合
      if (o.userId !== sessionUser.userId && !sessionUser.isAdmin) {
        return res.status(403).json({ paid: false, error: 'この注文を照会する権限がありません（所有者不一致）。' });
      }

      if (o.status === 'paid') return res.json({ paid: true, plan: o.plan, orderId });

      const paid = await checkWiseOrderPaidViaApi(o);
      if (paid) {
        await snap.ref.update({ status: 'paid', paidAt: new Date() });
        await db.collection('saas_users').doc(o.userId).set({
          plan: o.plan,
          planActivatedAt: new Date()
        }, { merge: true });
        return res.json({ paid: true, plan: o.plan, orderId });
      }

      return res.json({ paid: false });
    } catch (err) {
      return res.json({ paid: false, error: err.message });
    }
  });

  // ========================================================================
  // 1. 本アカウントのX公式APIキー疎通確認 & 暗号化保存 (OAuth 1.0a / OAuth 2.0 両対応)
  // 🛡️ 認証セッションを厳格照合し、ログイン本人（user.userId）に確実に紐付け
  // ========================================================================
  app.post('/api/hybrid/verify-keys', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({
          ok: false,
          error: 'ログインセッションが無効または有効期限切れです。一度ログインし直してください。'
        });
      }
      const userId = sessionUser.userId;

      const {
        authType = 'oauth1',
        apiKey,
        apiSecret,
        accessToken,
        accessTokenSecret,
        oauth2ClientId,
        oauth2ClientSecret,
        oauth2AccessToken,
        termsAccepted,
        autoPostingAccepted
      } = req.body || {};
      if (termsAccepted !== true) {
        return res.status(400).json({ ok: false, error: 'X連携には利用規約とプライバシーポリシーへの同意が必要です。' });
      }
      const consentStartedAt = Date.now();

      let credsToVerify = {};
      let plainCredsToStore = {};

      if (authType === 'oauth2' || (oauth2AccessToken && oauth2AccessToken.trim())) {
        if (!oauth2AccessToken || !oauth2AccessToken.trim()) {
          return res.json({
            ok: false,
            error: 'OAuth 2.0 を利用する場合、X公式画面の「アクセストークン」横の【生成】ボタンで取得したアクセストークンを入力してください。'
          });
        }
        credsToVerify = {
          oauth2AccessToken: oauth2AccessToken.trim(),
          oauth2ClientId: (oauth2ClientId || '').trim(),
          oauth2ClientSecret: (oauth2ClientSecret || '').trim()
        };
        plainCredsToStore = {
          authType: 'oauth2',
          oauth2AccessToken: oauth2AccessToken.trim(),
          oauth2ClientId: (oauth2ClientId || '').trim(),
          oauth2ClientSecret: (oauth2ClientSecret || '').trim()
        };
      } else {
        if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
          return res.json({
            ok: false,
            error: '【OAuth 1.0 キー】コンシューマーキー、コンシューマーシークレット、アクセストークン、アクセスシークレットの4項目を入力してください。'
          });
        }
        credsToVerify = {
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          accessToken: accessToken.trim(),
          accessTokenSecret: accessTokenSecret.trim()
        };
        plainCredsToStore = {
          authType: 'oauth1',
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          accessToken: accessToken.trim(),
          accessTokenSecret: accessTokenSecret.trim()
        };
      }

      // 公式API v2 (GET /2/users/me) で疎通確認
      const verifyRes = await verifyOfficialCredentials(credsToVerify);
      if (!verifyRes.ok) {
        return res.json({ ok: false, error: verifyRes.error });
      }

      // 暗号化してFirestoreに保存 (ログイン中の本人の saas_users ドキュメントに確実に格納)
      const previous = snapshotSafeCredentials(sessionUser);
      const encrypted = encryptCredentials({
        ...plainCredsToStore,
        oauth2RefreshToken: plainCredsToStore.oauth2RefreshToken || previous.oauth2RefreshToken || '',
        username: verifyRes.user.username,
        id: verifyRes.user.id,
        userId: verifyRes.user.id,
        saasUserId: userId
      });

      if (!verifyRes.user.id) throw new Error('Xアカウントの識別子を確認できません。');
      await db.runTransaction(async tx => {
        const ref = db.collection('saas_users').doc(userId);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new Error('ユーザーデータが見つかりません。');
        const data = snapshot.data();
        if (data.sessionToken !== sessionUser.sessionToken) throw new Error('ログイン状態が変わりました。もう一度お試しください。');
        const revokedAt = data.autopilotConsent && data.autopilotConsent.revokedAt;
        const revokedMs = revokedAt && (revokedAt.toDate ? revokedAt.toDate().getTime() : new Date(revokedAt).getTime());
        if (autoPostingAccepted === true && revokedMs && revokedMs >= consentStartedAt) {
          throw new Error('連携中に自動投稿の同意が撤回されました。必要なら改めて同意してください。');
        }
        const update = {
          officialApiKey: credsToVerify.apiKey || credsToVerify.oauth2ClientId || 'connected',
          officialAccessToken: credsToVerify.accessToken || credsToVerify.oauth2AccessToken || 'connected',
          xUsername: verifyRes.user.username,
          screenName: verifyRes.user.username,
          xOfficialCredentials: {
            ...encrypted,
            authType: verifyRes.authType || authType,
            username: verifyRes.user.username,
            name: verifyRes.user.name,
            profileImageUrl: verifyRes.user.profileImageUrl,
            verifiedAt: new Date()
          },
          connectionTermsConsent: { version: 1, acceptedAt: new Date() },
          twitterId: verifyRes.user.id,
          xLinkStatus: 'connected',
          xLinkMessage: '',
          xLastLinkedAt: new Date(),
          updatedAt: new Date()
        };
        if (plainCredsToStore.oauth2RefreshToken || previous.oauth2RefreshToken) {
          update.twitterRefreshToken = plainCredsToStore.oauth2RefreshToken || previous.oauth2RefreshToken;
          update.twitterAuth = {
            authType: 'oauth2',
            userId: verifyRes.user.id,
            saasUserId: userId,
            username: verifyRes.user.username,
            oauth2AccessToken: plainCredsToStore.oauth2AccessToken || previous.oauth2AccessToken || '',
            oauth2RefreshToken: update.twitterRefreshToken,
            oauth2ExpiresAt: plainCredsToStore.oauth2ExpiresAt || previous.oauth2ExpiresAt || ''
          };
        }
        if (!data.xFirstLinkedAt) update.xFirstLinkedAt = new Date();
        if (autoPostingAccepted === true) {
          update.autopilotConsent = {
            version: AUTOPILOT_CONSENT_VERSION,
            account: `id:${verifyRes.user.id}`,
            granted: true,
            grantedAt: new Date()
          };
        }
        tx.update(ref, update);
      });

      console.log(`✅ [Official API Connected] ユーザー: ${userId} (@${verifyRes.user.username}) のAPIキーが正常に認証・暗号化保存されました`);

      res.json({
        ok: true,
        message: `🎉 X公式API疎通成功！ @${verifyRes.user.username} (${verifyRes.user.name}) として認証されました。`,
        user: verifyRes.user
      });
    } catch (err) {
      console.error('Verify keys error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 2-A. ✨ 瞬速Aha! プレビュー生成 (X連携前でもURLから5秒で3本生成)
  // ========================================================================
  app.post('/api/autopilot/instant-preview', async (req, res) => {
    const lang = String((req.body || {}).lang || 'ja').toLowerCase() === 'en' ? 'en' : 'ja';
    return res.json({
      ok: false,
      error: lang === 'en'
        ? 'The sample council preview has been removed. The dashboard launch prepares the next post.'
        : '見本用の合議プレビューは廃止しました。次の1投稿はダッシュボードの開始で作ります。'
    });
  });

  app.post('/api/autopilot/schedule-timezone', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。ログインしてください。' });
      }

      const timeZone = String(req.body?.timeZone || '').trim();
      if (!isValidTimeZone(timeZone)) {
        return res.status(400).json({ ok: false, error: '有効なIANAタイムゾーンを指定してください。' });
      }

      await db.collection('saas_users').doc(sessionUser.userId).set({
        scheduleTimeZone: timeZone,
        updatedAt: new Date()
      }, { merge: true });

      res.json({ ok: true, scheduleTimeZone: timeZone });
    } catch (err) {
      console.error('Save schedule timezone error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/profile-checklist', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const snap = await db.collection('saas_users').doc(sessionUser.userId).get();
      const user = snap.exists ? (snap.data() || {}) : {};
      const { buildAiProfileChecklist } = require('./profile_checklist');
      const { extractBrandKnowledge } = require('./lp_knowledge_extractor');
      const lang = String((req.body && req.body.uiLang) || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
      const checklistCacheKey = [
        sessionUser.userId,
        lang,
        user.targetUrl || '',
        user.userPrompt || '',
        user.aiTargetLang || '',
        (user.voiceProfile && user.voiceProfile.bio) || ''
      ].join('\n');
      const checklistCached = profileChecklistCache.get(checklistCacheKey);
      if (checklistCached && Date.now() - checklistCached.at < 20000) {
        return res.json(checklistCached.body);
      }
      const diagnosis = (user.latestMarketingStrategy && user.latestMarketingStrategy.accountDiagnosis) || {};
      let liveProfile = {};
      if (diagnosis.description || diagnosis.bio) liveProfile.description = diagnosis.description || diagnosis.bio;
      if (diagnosis.subscriptionType || diagnosis.subscription) {
        liveProfile.subscriptionType = diagnosis.subscriptionType || diagnosis.subscription;
      }
      if (user.xOfficialCredentials) {
        try {
          const creds = decryptCredentials(user.xOfficialCredentials);
          creds.userId = sessionUser.userId;
          creds.saasUserId = sessionUser.userId;
          const [recent, live] = await Promise.all([
            Promise.race([
              getUserProfileAndRecentTweets(creds, 5),
              new Promise(resolve => setTimeout(() => resolve(null), 2000))
            ]),
            Promise.race([
              readLiveAccount(sessionUser.userId, user),
              new Promise(resolve => setTimeout(() => resolve(null), 2000))
            ])
          ]);
          if (recent && recent.ok && recent.user) {
            liveProfile.description = recent.user.description || liveProfile.description || '';
            liveProfile.xUsername = recent.user.username || liveProfile.xUsername || '';
            liveProfile.subscriptionType = recent.user.subscription_type || liveProfile.subscriptionType || '';
          }
          if (live && live.ok) {
            liveProfile.xUsername = live.username || liveProfile.xUsername || '';
            liveProfile.subscriptionType = live.subscriptionType || liveProfile.subscriptionType || '';
            if (live.description || live.bio) liveProfile.description = live.description || live.bio;
          }
        } catch (profileErr) {
          liveProfile = liveProfile || {};
        }
      }
      let brandKnowledge = user.brandKnowledge || null;
      if (!brandKnowledge && /^https?:\/\//i.test(String(user.targetUrl || ''))) {
        try {
          const extracted = await Promise.race([
            extractBrandKnowledge(user.targetUrl, {
              db,
              userId: sessionUser.userId,
              cachedKnowledge: user.brandKnowledge,
              tier: 'fast',
              timeoutMs: 6000
            }),
            new Promise(resolve => setTimeout(() => resolve(null), 6000))
          ]);
          if (extracted && extracted.brandKnowledge) brandKnowledge = extracted.brandKnowledge;
        } catch (knowledgeErr) {
          brandKnowledge = user.brandKnowledge || null;
        }
      }
      const posture = operatingPosture({ ...user, uiLang: lang });
      let recentPostedJobs = [];
      try {
        const postedSnap = await db.collection('autopilot_jobs').where('userId', '==', sessionUser.userId).where('status', '==', 'posted').limit(40).get();
        recentPostedJobs = postedSnap.docs.map(doc => doc.data() || {});
      } catch (_postedErr) {
        recentPostedJobs = [];
      }
      let budgetDegraded = false;
      try {
        const { checkTenantAiBudget } = require('./tenant_ai_budget');
        const gate = await checkTenantAiBudget({ db, userId: sessionUser.userId, user, kind: 'llm' });
        budgetDegraded = gate.allowed === false;
      } catch (_budgetErr) {}
      const checklist = await buildAiProfileChecklist({ ...user, userId: sessionUser.userId }, lang, {
        liveProfile,
        brandKnowledge,
        posture,
        recentPostedJobs,
        budgetDegraded
      });
      if (!budgetDegraded && checklist && checklist.llmUsed) {
        try {
          const { recordTenantAiUsage } = require('./tenant_ai_budget');
          await recordTenantAiUsage({ db, userId: sessionUser.userId, kind: 'llm', role: 'writer', count: 1 });
        } catch (_recordErr) {}
      }
      const checklistBody = { ok: true, posture, checklist };
      profileChecklistCache.set(checklistCacheKey, { at: Date.now(), body: checklistBody });
      if (profileChecklistCache.size > 200) {
        const oldestKey = profileChecklistCache.keys().next().value;
        if (oldestKey !== undefined) profileChecklistCache.delete(oldestKey);
      }
      return res.json(checklistBody);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'プロフィール案を用意できませんでした。' });
    }
  });

  app.post('/api/autopilot/save-setup', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。ログインしてください。' });
      }
      const body = req.body || {};
      const userRefEarly = db.collection('saas_users').doc(sessionUser.userId);
      const existingSnapEarly = await userRefEarly.get().catch(() => null);
      const existingBefore = existingSnapEarly && existingSnapEarly.exists ? (existingSnapEarly.data() || {}) : {};
      const urlWasSent = Object.prototype.hasOwnProperty.call(body, 'targetUrl');
      let cleanUrl = urlWasSent && typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
      const cleanPrompt = typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';
      if (urlWasSent && cleanUrl === '' && existingBefore.targetUrl && body.clearTargetUrl !== true && !cleanPrompt) {
        cleanUrl = existingBefore.targetUrl;
      }
      if (!urlWasSent && existingBefore.targetUrl) cleanUrl = existingBefore.targetUrl;
      if (cleanUrl && (!/^https?:\/\/\S+$/i.test(cleanUrl) || cleanUrl.length > 500)) {
        return res.status(400).json({ ok: false, error: '有効な http:// または https:// URL を入力してください。' });
      }
      if (cleanPrompt.length > 2000) {
        return res.status(400).json({ ok: false, error: 'アカウント方針は2000文字以内で入力してください。' });
      }
      if (!cleanUrl && !cleanPrompt && body.autonomousMode !== true) {
        return res.status(400).json({ ok: false, error: '宣伝URLまたは育てたいアカウント像のどちらか1つ以上を入力してください。' });
      }
      const update = {
        targetUrl: cleanUrl,
        userPrompt: cleanPrompt,
        updatedAt: new Date()
      };
      if (body.lang !== undefined) {
        if (body.lang !== 'ja' && body.lang !== 'en') {
          return res.status(400).json({ ok: false, error: '投稿言語は ja または en を指定してください。' });
        }
        update.aiTargetLang = body.lang;
      }
      if (typeof body.timeZone === 'string' && body.timeZone.trim()) {
        const tz = body.timeZone.trim();
        if (!isValidTimeZone(tz)) {
          return res.status(400).json({ ok: false, error: '有効なIANAタイムゾーンを指定してください。' });
        }
        update.scheduleTimeZone = tz;
      }
      if (typeof body.country === 'string' && body.country.trim()) {
        const country = body.country.trim().toUpperCase().slice(0, 16);
        if (!/^[A-Z0-9_-]+$/.test(country)) {
          return res.status(400).json({ ok: false, error: '不正な国・地域コードです。' });
        }
        update.targetCountry = country;
      }
      if (body.brandContextNotes !== undefined) {
        const notes = String(body.brandContextNotes || '').trim();
        if (notes.length > 800) return res.status(400).json({ ok: false, error: '実務メモは800文字以内で入力してください。' });
        update.brandContextNotes = notes;
      }
      const userRef = db.collection('saas_users').doc(sessionUser.userId);
      let existingUser = {};
      if (body.autonomousMode === true) {
        const existingSnap = await userRef.get().catch(() => null);
        if (existingSnap && existingSnap.exists) existingUser = existingSnap.data() || {};
        if (existingUser.targetUrl && (!cleanUrl || body.preserveUrl === true)) update.targetUrl = existingUser.targetUrl;
        if (body.lang === undefined && existingUser.aiTargetLang) delete update.aiTargetLang;
        if (!(typeof body.timeZone === 'string' && body.timeZone.trim()) && existingUser.scheduleTimeZone) delete update.scheduleTimeZone;
        update.strategyLockByUser = false;
        update.isHumanOverride = false;
      } else {
        if (body.targetUrl === undefined && body.brandContextNotes !== undefined) {
          delete update.targetUrl;
        }
        if (typeof body.userPrompt === 'string' && body.userPrompt.trim()) {
          update.strategyLockByUser = true;
        }
      }
      if (body.ngTopics !== undefined) {
        const blocked = Array.isArray(body.ngTopics) ? body.ngTopics.map(item => String(item).trim()).filter(Boolean).join('\n') : String(body.ngTopics || '').trim();
        if (blocked.length > 400) return res.status(400).json({ ok: false, error: 'NG表現は400文字以内で入力してください。' });
        update.ngTopics = blocked;
      }
      if (body.ownerSparkInput !== undefined) {
        const { mergeOwnerSparks } = require('./next_post_draft');
        update.ownerSparks = mergeOwnerSparks(existingBefore.ownerSparks, body.ownerSparkInput, new Date());
      }
      if (body.editorialStanceOverride !== undefined) {
        const { resolveEditorialStance } = require('./lp_knowledge_extractor');
        const raw = body.editorialStanceOverride && typeof body.editorialStanceOverride === 'object' ? body.editorialStanceOverride : {};
        const stance = resolveEditorialStance(null, { editorialStanceOverride: raw });
        update.editorialStanceOverride = stance && stance.source === 'override'
          ? { rejectedNorm: stance.rejectedNorm || '', coreBelief: stance.coreBelief || '' }
          : null;
      }

      await userRef.set(update, { merge: true });
      let appliedStrategy = null;
      if (body.autonomousMode === true && update.strategyLockByUser === false) {
        try {
          const { maybeAutofillStrategy } = require('./autonomous_strategy_architect');
          appliedStrategy = await maybeAutofillStrategy(db, { ...sessionUser, ...existingUser, ...update, userId: sessionUser.userId });
        } catch (strategyErr) {
          console.warn(`[Autonomous Strategy] ${strategyErr.message}`);
        }
      }
      return res.json({
        ok: true,
        targetUrl: appliedStrategy?.targetUrl ?? update.targetUrl ?? cleanUrl,
        userPrompt: appliedStrategy?.userPrompt ?? cleanPrompt,
        lang: appliedStrategy?.aiTargetLang || update.aiTargetLang || null,
        scheduleTimeZone: appliedStrategy?.scheduleTimeZone || update.scheduleTimeZone || null,
        targetCountry: appliedStrategy?.targetCountry || update.targetCountry || null,
        brandContextNotes: appliedStrategy?.brandContextNotes ?? update.brandContextNotes ?? null,
        ngTopics: update.ngTopics ?? null,
        ownerSparks: update.ownerSparks || existingBefore.ownerSparks || [],
        ownerSparkUnused: (update.ownerSparks || existingBefore.ownerSparks || []).filter(item => item && item.text && !item.usedAt).length,
        editorialStanceOverride: update.editorialStanceOverride !== undefined ? update.editorialStanceOverride : (existingBefore.editorialStanceOverride || null),
        appliedStrategy
      });
    } catch (err) {
      console.error('Save onboarding setup error:', err.message);
      return res.status(500).json({ ok: false, error: '初期設定の保存に失敗しました。' });
    }
  });

  app.post('/api/autopilot/suggest-personas', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。ログインしてください。' });
      }
      const userId = sessionUser.userId;
      const body = req.body || {};
      const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
      if (targetUrl && (!/^https?:\/\/\S+$/i.test(targetUrl) || targetUrl.length > 500)) {
        return res.status(400).json({ ok: false, error: '有効な http:// または https:// URL を入力してください。' });
      }
      const lang = String(body.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
      const userDoc = await db.collection('saas_users').doc(userId).get();
      const userData = userDoc && userDoc.exists ? (userDoc.data() || {}) : {};
      const liveAccount = await Promise.race([
        readLiveAccount(userId, userData),
        new Promise(resolve => setTimeout(() => resolve({ ok: false }), 2500))
      ]).catch(() => ({ ok: false }));

      const result = await suggestAccountPersonas({
        targetUrl,
        userData,
        liveAccount,
        lang
      });
      return res.json(result);
    } catch (err) {
      console.error('Suggest personas error:', err.message);
      return res.status(500).json({ ok: false, error: 'アカウント方針の候補作成に失敗しました。' });
    }
  });

  // ========================================================================
  // 2-B. 🏛️ 7名AI合議制マーケティング立案 ＆ 自律キュー登録（非同期・タイムアウトゼロ設計）
  // 🛡️ セッションCookieからユーザーを特定
  // ========================================================================
  const activeAutopilotLaunches = new Map();

  app.get('/api/autopilot/launch-status', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const st = activeAutopilotLaunches.get(sessionUser.userId) || { status: 'idle' };
      const elapsedSec = st.startedAt ? Math.floor((Date.now() - new Date(st.startedAt).getTime()) / 1000) : 0;
      res.json({ ok: true, elapsedSec, ...st });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/autopilot/launch', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。ログインしてください。' });
      }
      const userId = sessionUser.userId;
      const consentUser = await db.collection('saas_users').doc(userId).get();
      const consentData = consentUser.exists ? consentUser.data() : null;
      if (!consentData || !consentData.xOfficialCredentials ||
          !hasAutopilotConsent(consentData, decryptCredentials(consentData.xOfficialCredentials))) {
        return res.status(403).json({ ok: false, error: '自動投稿を開始する前に、連携アカウントでの自動投稿に同意してください。' });
      }
      if (consentData.xLinkHealthStatus === 'suspended') {
        const uiEn = resolveUiLang(req) === 'en';
        return res.status(409).json({
          ok: false,
          code: 'account_suspended',
          error: uiEn
            ? 'X reported this account as suspended. Reconnect a recovered or different account before starting.'
            : 'X側でこのアカウントの凍結が返っています。回復後、または別のアカウントで再連携してから開始してください。'
        });
      }
      if (consentData.autopilotPaused) {
        return res.status(409).json({ ok: false, error: '自律運用は一時停止中です。再開してから開始してください。' });
      }
      if (!officialApiOperationAllowed({ ...consentData, userId }, decryptCredentials(consentData.xOfficialCredentials))) {
        const paidOpen = String(process.env.OFFICIAL_API_ALLOW_PAID_CUSTOMERS || '').toLowerCase() === 'true';
        return res.status(403).json({
          ok: false,
          error: paidOpen
            ? '有効な有料プランとX公式アカウント連携が必要です。'
            : '現在は本番試験運用のため許可された公式アカウントのみ自動投稿を実行できます。'
        });
      }

      const launchBody = req.body || {};
      const {
        userPrompt,
        plan: reqPlan,
        workspaceTimeZone,
        campaignTimeZone
      } = launchBody;
      const existingLaunchSnap = await db.collection('saas_users').doc(userId).get().catch(() => null);
      const existingLaunch = existingLaunchSnap && existingLaunchSnap.exists ? (existingLaunchSnap.data() || {}) : {};
      const requestedLang = launchBody.lang !== undefined ? launchBody.lang : (existingLaunch.aiTargetLang || 'ja');
      const lang = String(requestedLang).toLowerCase() === 'en' ? 'en' : 'ja';
      const sentLaunchUrl = Object.prototype.hasOwnProperty.call(launchBody, 'targetUrl') ? String(launchBody.targetUrl || '').trim() : '';
      const targetUrl = sentLaunchUrl || existingLaunch.targetUrl || '';

      let effectivePlan = 'pro';
      try {
        const uSnap = await db.collection('saas_users').doc(userId).get();
        if (uSnap.exists) {
          const uD = uSnap.data() || {};
          if (uD.tierLevel >= 3 || uD.planId === 'business' || uD.planId === 'syndicate_business' || sessionUser.tierLevel >= 3 || sessionUser.planId === 'business' || reqPlan === 'business') {
            effectivePlan = 'business';
          } else if (uD.tierLevel === 1 || uD.planId === 'starter' || reqPlan === 'starter') {
            effectivePlan = 'starter';
          } else {
            effectivePlan = reqPlan || uD.planId || sessionUser.planId || 'pro';
          }
        } else {
          effectivePlan = (sessionUser.tierLevel >= 3 || sessionUser.planId === 'business' || reqPlan === 'business') ? 'business' : (reqPlan || sessionUser.planId || 'pro');
        }
      } catch (_pErr) {
        effectivePlan = reqPlan || sessionUser.planId || 'pro';
      }

      if (!/^https?:\/\//i.test(String(targetUrl || '')) && !String(userPrompt || '').trim()) {
        return res.json({ ok: false, error: '宣伝URLまたは育てたいアカウント像を入力してください。' });
      }

      const cleanLang = String(lang).toLowerCase() === 'en' ? 'en' : 'ja';
      const uiLang = resolveUiLang(req, cleanLang === 'en' ? 'en' : 'ja');
      const cleanWorkspaceTimeZone = String(workspaceTimeZone || '').trim();
      const cleanCampaignTimeZone = String(campaignTimeZone || '').trim();
      if ((cleanWorkspaceTimeZone && !isValidTimeZone(cleanWorkspaceTimeZone)) ||
          (cleanCampaignTimeZone && !isValidTimeZone(cleanCampaignTimeZone))) {
        return res.status(400).json({ ok: false, error: '有効なIANAタイムゾーンを指定してください。' });
      }

      // 多重実行ガード（既に実行中の場合は既存タスクの完了を待機）
      const existing = activeAutopilotLaunches.get(userId);
      if (existing && existing.status === 'running') {
        const elapsedSec = (Date.now() - new Date(existing.startedAt).getTime()) / 1000;
        if (elapsedSec < 240) {
          return res.json({
            ok: true,
            inProgress: true,
            message: uiLang === 'en'
              ? 'The next post is still being prepared. You can close this and check again.'
              : '次の1投稿をまだ準備しています。閉じても続き、あとで結果を確認できます。'
          });
        }
      }

      // ユーザーの言語設定を保存
      const userSettings = {
        targetUrl,
        aiTargetLang: cleanLang,
        updatedAt: new Date()
      };
      if (launchBody.userPrompt !== undefined) userSettings.userPrompt = userPrompt || '';
      if (cleanWorkspaceTimeZone) userSettings.scheduleTimeZone = cleanWorkspaceTimeZone;
      await db.collection('saas_users').doc(userId).set(userSettings, { merge: true });

      const launchLogs = [
        {
          time: '00:00',
          step: 'init',
          title: uiLang === 'en' ? 'Preparing the next post' : '次の1投稿を準備しています',
          detail: uiLang === 'en'
            ? 'Reading the registered page and this account. Only the next post is kept.'
            : '登録ページとこのアカウントを読みます。残すのは次の1投稿だけです。'
        }
      ];

      activeAutopilotLaunches.set(userId, {
        status: 'running',
        startedAt: new Date(),
        targetUrl,
        lang: cleanLang,
        currentStep: 'init',
        stepTitle: launchLogs[0].title,
        stepDetail: launchLogs[0].detail,
        logs: launchLogs
      });

      const noteProgress = (p) => {
        const startTime = activeAutopilotLaunches.get(userId)?.startedAt || new Date();
        const sec = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        launchLogs.push({
          time: `${mm}:${ss}`,
          step: p.step,
          title: p.title,
          detail: p.detail || ''
        });
        const current = activeAutopilotLaunches.get(userId) || {};
        activeAutopilotLaunches.set(userId, {
          ...current,
          status: 'running',
          currentStep: p.step,
          stepTitle: p.title,
          stepDetail: p.detail || '',
          logs: [...launchLogs]
        });
      };

      prepareNextPost(userId, { lang: cleanLang, uiLang, onProgress: noteProgress })
      .then(result => {
        console.log(`[Next Post Ready] ${userId} job=${result.jobId} slot=${result.timeSlot}`);
        const startTime = activeAutopilotLaunches.get(userId)?.startedAt || new Date();
        const sec = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        launchLogs.push({
          time: `${mm}:${ss}`,
          step: 'completed',
          title: uiLang === 'en' ? 'The next post is scheduled' : '次の1投稿を予約しました',
          detail: result.customerReason || ''
        });
        const lastLog = launchLogs[launchLogs.length - 1] || {};
        activeAutopilotLaunches.set(userId, {
          status: 'completed',
          result,
          logs: [...launchLogs],
          finishedAt: new Date(),
          currentStep: lastLog.step || 'completed',
          stepTitle: lastLog.title || '',
          stepDetail: lastLog.detail || ''
        });
      })
      .catch(err => {
        console.warn(`[Next Post Failed] (${userId}):`, err.message);
        activeAutopilotLaunches.set(userId, {
          status: 'error',
          error: err.message,
          logs: [...launchLogs],
          finishedAt: new Date()
        });
      });

      res.json({
        ok: true,
        inProgress: true,
        scheduledCount: 1,
        message: uiLang === 'en'
          ? 'Preparing one next post from the registered page and this account.'
          : '登録ページとこのアカウントから、次の1投稿を準備しています。'
      });
    } catch (err) {
      console.error('Launch autopilot error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/post-language', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const { lang } = req.body || {};
      if (lang !== 'ja' && lang !== 'en') {
        return res.status(400).json({ ok: false, error: '投稿言語を日本語または英語から選択してください。' });
      }
      const userRef = db.collection('saas_users').doc(sessionUser.userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists || !userDoc.updateTime) {
        return res.status(404).json({ ok: false, error: 'ユーザーデータを確認できませんでした。' });
      }
      try {
        await userRef.update({ aiTargetLang: lang, updatedAt: new Date() }, { lastUpdateTime: userDoc.updateTime });
      } catch (err) {
        if (err.code === 9 || err.code === 'FAILED_PRECONDITION' || err.code === 'failed-precondition') {
          return res.status(409).json({ ok: false, error: '設定が変更されました。画面を再読み込みしてください。' });
        }
        throw err;
      }
      res.json({ ok: true, lang });
    } catch (err) {
      console.error('Post language update error:', err.message);
      res.status(500).json({ ok: false, error: '投稿言語を保存できませんでした。' });
    }
  });

  app.get('/api/autopilot/consent/status', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true, version: 1 });
  });

  app.post('/api/autopilot/consent', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const { accepted, version } = req.body || {};
      if (accepted !== true || version !== AUTOPILOT_CONSENT_VERSION) {
        return res.status(400).json({ ok: false, error: '自動投稿の内容を確認し、明示的に同意してください。' });
      }
      const userRef = db.collection('saas_users').doc(sessionUser.userId);
      const account = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(userRef);
        const data = snapshot.exists ? snapshot.data() : null;
        if (!data || !data.xOfficialCredentials) throw new Error('先にX公式APIを連携してください。');
        const credentials = decryptCredentials(data.xOfficialCredentials);
        const identity = getConsentAccount(credentials);
        if (!identity || !credentials.username ||
            String(credentials.username).toLowerCase() !== String(data.xUsername || '').replace(/^@/, '').toLowerCase()) {
          throw new Error('連携Xアカウントを確認できません。公式APIを再連携してください。');
        }
        transaction.update(userRef, {
          autopilotConsent: { version: AUTOPILOT_CONSENT_VERSION, account: identity, granted: true, grantedAt: new Date() },
          autopilotPaused: false,
          updatedAt: new Date()
        });
        return credentials.username;
      });
      res.json({ ok: true, username: account });
    } catch (err) {
      console.error('[Autopilot Consent Error]', err.message);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/consent/revoke', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userRef = db.collection('saas_users').doc(sessionUser.userId);
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(userRef);
        if (!snapshot.exists) throw new Error('ユーザーデータが見つかりません。');
        transaction.update(userRef, {
          autopilotConsent: { version: AUTOPILOT_CONSENT_VERSION, granted: false, revokedAt: new Date() },
          autopilotPaused: true,
          updatedAt: new Date()
        });
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('[Autopilot Consent Revoke Error]', err.message);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 2-C. ⏸/▶ 自律運用のスタート/ストップ（一時停止・再開）トグルAPI
  // 🛡️ セッションCookieから本人特定
  // ========================================================================
  app.post('/api/autopilot/trust-goal/unlock', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userRef = db.collection('saas_users').doc(sessionUser.userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) return res.json({ ok: false, error: 'ユーザーデータが見つかりません' });
      const goal = trustGoalStatus(userDoc.data());
      if (!goal.met) {
        return res.status(409).json({ ok: false, error: '信用構築の目標（フォロワー100人、または表示1,000回）が未達です。' });
      }
      await userRef.update({
        promoUnlockedBy: sessionUser.userId,
        promoUnlockedAt: new Date(),
        updatedAt: new Date()
      });
      return res.json({ ok: true, trustGoal: trustGoalStatus({ ...userDoc.data(), promoUnlockedBy: sessionUser.userId }) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/toggle-pause', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const { lang = 'ja', targetUrl, userPrompt, paused } = req.body || {};

      const userDoc = await db.collection('saas_users').doc(userId).get();
      if (!userDoc.exists) {
        return res.json({ ok: false, error: 'ユーザーデータが見つかりません' });
      }

      const isPaused = Boolean(userDoc.data().autopilotPaused);
      const nextPaused = typeof paused === 'boolean' ? paused : !isPaused;

      const userData = userDoc.data() || {};
      const creds = userData.xOfficialCredentials ? decryptCredentials(userData.xOfficialCredentials) : null;
      if (!nextPaused && userData.xLinkHealthStatus === 'suspended') {
        const uiEn = resolveUiLang(req) === 'en';
        return res.status(409).json({
          ok: false,
          code: 'account_suspended',
          error: uiEn
            ? 'X reported this account as suspended. Reconnect a recovered or different account before starting.'
            : 'X側でこのアカウントの凍結が返っています。回復後、または別のアカウントで再連携してから開始してください。'
        });
      }
      if (!nextPaused && !isPaidAccount(userData)) {
        return res.status(402).json({ ok: false, code: 'plan_required', error: '自動運用の開始には有料プラン（14日間無料トライアルを含む）の登録が必要です。' });
      }
      const savedUrl = typeof targetUrl === 'string' ? targetUrl.trim() : String(userData.targetUrl || '');
      const savedPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : String(userData.userPrompt || '');
      if (!nextPaused && !/^https?:\/\//i.test(savedUrl) && !savedPrompt) {
        return res.status(400).json({ ok: false, error: '宣伝URLまたは育てたいアカウント像を入力してください。' });
      }
      if (!nextPaused && !creds) {
        return res.status(403).json({ ok: false, error: '先にXアカウントを連携してください。' });
      }
      const update = { autopilotPaused: nextPaused, updatedAt: new Date() };
      if (typeof targetUrl === 'string') update.targetUrl = targetUrl.trim();
      if (typeof userPrompt === 'string') update.userPrompt = userPrompt.trim();
      if (!nextPaused) {
        update.autopilotConsent = {
          version: AUTOPILOT_CONSENT_VERSION,
          account: getConsentAccount(creds),
          granted: true,
          grantedAt: new Date()
        };
        update.ensureNextPostFailures = 0;
        update.ensureNextPostFailureDate = null;
      } else {
        update.autopilotConsent = {
          version: AUTOPILOT_CONSENT_VERSION,
          granted: false,
          revokedAt: new Date()
        };
      }
      await userDoc.ref.update(update, { lastUpdateTime: userDoc.updateTime });
      if (nextPaused) {
        cancelNonManualPendingJobs(userId, 'autopilot_paused').catch(err => console.warn(`[Pause Cancel] ${err.message}`));
      }
      if (!nextPaused) {
        ensureNextPost(userId, { resetFailures: true }).catch(err => console.warn(`[Ensure Next] ${err.message}`));
      }

      res.json({
        ok: true,
        isPaused: nextPaused,
        message: nextPaused
          ? (lang === 'en' ? '⏸ Autonomous marketing has been paused.' : '⏸ 自律運用を一時停止しました。予約投稿の配信は保留されます。')
          : (lang === 'en' ? '▶ Autonomous marketing resumed!' : '▶ 自律運用を再開しました！スケジュール通りに自律投稿が行われます。')
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ========================================================================
  // 2-D. 🤖 手動で次回枠の予約投稿をAI合議生成・補充するAPI
  // 🛡️ セッションCookieから本人特定
  // ========================================================================
  app.post('/api/autopilot/apply-advice', async (req, res) => {
    const uiLang = resolveUiLang(req);
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({
          ok: false,
          error: uiLang === 'en' ? 'Your login session is invalid.' : 'ログインセッションが無効です。'
        });
      }
      const adviceText = String(req.body && req.body.adviceText || '').trim();
      if (adviceText.length < 1 || adviceText.length > 160 || /https?:\/\//i.test(adviceText)) {
        return res.status(400).json({
          ok: false,
          error: uiLang === 'en' ? 'The advice text is not usable.' : '反映できる助言ではありません。'
        });
      }
      const userId = sessionUser.userId;
      const userDoc = await db.collection('saas_users').doc(userId).get();
      const currentPrompt = userDoc.exists ? String(userDoc.data().userPrompt || '') : '';
      const userPrompt = currentPrompt.includes(adviceText)
        ? currentPrompt.slice(0, 500)
        : `${currentPrompt}${currentPrompt.trim() ? '\n' : ''}${adviceText}`.slice(0, 500);
      await db.collection('saas_users').doc(userId).set({
        userPrompt,
        strategyLockByUser: req.body && req.body.keepAutonomous ? false : true,
        updatedAt: new Date()
      }, { merge: true });
      return res.json({
        ok: true,
        userPrompt,
        message: uiLang === 'en' ? 'The advice was added to your direction.' : '助言を方針へ反映しました。'
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: uiLang === 'en' ? 'Could not apply the advice.' : '助言を反映できませんでした。'
      });
    }
  });

  app.post('/api/autopilot/replenish', async (req, res) => {
    const uiLang = resolveUiLang(req);
    let userDoc = null;
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({
          ok: false,
          error: uiLang === 'en' ? 'Your login session is invalid.' : 'ログインセッションが無効です。'
        });
      }
      const userId = sessionUser.userId;

      userDoc = await db.collection('saas_users').doc(userId).get();
      const direction = userDoc.exists && (/^https?:\/\//i.test(String(userDoc.data().targetUrl || '')) || String(userDoc.data().userPrompt || '').trim());
      if (!userDoc.exists || !direction || !userDoc.data().xOfficialCredentials) {
        return res.json({
          ok: false,
          error: uiLang === 'en'
            ? 'Connect X and save a page URL or an account direction first.'
            : '先にX連携と、宣伝URLまたは育てたいアカウント像を設定してください。'
        });
      }
      const uData = userDoc.data();
      if (userDoc.ref && typeof userDoc.ref.set === 'function') {
        await userDoc.ref.set({
          ensureNextPostFailures: 0,
          ensureNextPostFailureDate: null,
          lastEnsureNextError: null,
          lastEnsureNextRejectReasons: []
        }, { merge: true });
      }
      if (!replenishRunningUsers.has(userId)) {
        replenishRunningUsers.add(userId);
        const zone = uData.scheduleTimeZone || uData.timezone || 'Asia/Tokyo';
        prepareNextPost(userId, { lang: uData.aiTargetLang || 'ja' }).then(async () => {
          let today = null;
          try { today = localDateKey(new Date(), zone); } catch (_zoneErr) { today = localDateKey(new Date(), 'Asia/Tokyo'); }
          if (userDoc.ref && typeof userDoc.ref.set === 'function') {
            await userDoc.ref.set({
              ensureNextPostFailures: 0,
              ensureNextPostFailureDate: today,
              lastEnsureNextError: null,
              lastEnsureNextRejectReasons: []
            }, { merge: true });
          }
        }).catch(async (err) => {
          let today = '';
          try { today = localDateKey(new Date(), zone); } catch (_zoneErr) { today = localDateKey(new Date(), 'Asia/Tokyo'); }
          if (userDoc.ref && typeof userDoc.ref.set === 'function') {
            try {
              await userDoc.ref.set({
                ensureNextPostFailures: 3,
                ensureNextPostFailureDate: today,
                lastEnsureNextError: String(err.message || 'unknown').slice(0, 240),
                lastEnsureNextRejectReasons: Array.isArray(err.rejectReasons) ? err.rejectReasons.slice(0, 6) : [],
                lastEnsureNextErrorAt: new Date().toISOString()
              }, { merge: true });
            } catch (_saveErr) {}
          }
        }).finally(() => {
          replenishRunningUsers.delete(userId);
        });
      }

      return res.status(202).json({
        ok: true,
        asyncStarted: true,
        message: uiLang === 'en'
          ? 'Started creating the next post. This view will update automatically in 15–60 seconds.'
          : '次の1投稿の作成を開始しました。15〜60秒ほどでこの画面に自動で反映されます。'
      });
    } catch (err) {
      if (userDoc && userDoc.ref && typeof userDoc.ref.set === 'function') {
        try {
          await userDoc.ref.set({
            lastEnsureNextError: String(err.message || 'unknown').slice(0, 240),
            lastEnsureNextRejectReasons: Array.isArray(err.rejectReasons) ? err.rejectReasons.slice(0, 6) : [],
            lastEnsureNextErrorAt: new Date().toISOString()
          }, { merge: true });
        } catch (saveErr) {}
      }
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 2-D2. ⚡ 投稿時間のみ事前予約枠（JIT直前生成スロット）一括作成API
  // ユーザーの指定またはゴールデン時間帯（朝・昼・夜）で時刻のみを予約キューに確保。
  // 本文および文章量は投稿直前に最新バズ構文・市場トレンドに基づきAI合議制で決定。
  // ========================================================================
  app.post('/api/autopilot/schedule-jit-slots', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const userDoc = await db.collection('saas_users').doc(userId).get();
      if (!userDoc.exists || !userDoc.data().xOfficialCredentials) {
        return res.json({ ok: false, error: '公式APIキーを先に登録してください。' });
      }
      const uData = userDoc.data();
      const tz = uData.scheduleTimeZone || uData.timezone || 'Asia/Tokyo';
      const lang = uData.aiTargetLang || 'ja';
      const isEn = lang.startsWith('en');
      return res.status(400).json({
        ok: false,
        error: isEn
          ? 'Only the next post can be scheduled. Use the dashboard launch button.'
          : '予約できるのは次の1投稿だけです。ダッシュボードの開始ボタンを使ってください。'
      });

      // 既存の最新予約日時を取得
      const jobsSnap = await db.collection('autopilot_jobs')
        .where('userId', '==', userId)
        .where('status', '==', 'pending')
        .get();

      let baseDate = new Date();
      jobsSnap.docs.forEach(d => {
        const s = d.data().scheduledAt;
        const sDate = s ? (s.toDate ? s.toDate() : new Date(s)) : new Date();
        if (sDate > baseDate) baseDate = sDate;
      });

      // ゴールデンタイム3枠（朝08:30、昼12:30、夜20:00）の事前スケジューリング
      const slots = [
        { hour: 8, minute: 30, slot: 'morning', length: 'short_punchy' },
        { hour: 12, minute: 30, slot: 'noon', length: 'medium_insight' },
        { hour: 20, minute: 0, slot: 'evening', length: 'deep_retention' }
      ];

      const createdJobs = [];
      const batch = db.batch();
      const numDays = Math.min(7, Math.max(1, Number(req.body.days) || 1));
      if (!userDoc.updateTime) throw new Error('ユーザーの更新時刻を取得できませんでした。');

      for (let dayOffset = 1; dayOffset <= numDays; dayOffset++) {
        for (const s of slots) {
          const target = dateAtTimeInZone(baseDate, tz, s.hour, s.minute, dayOffset);

          const jobId = `jit_${randomUUID()}`;
          const jobRef = db.collection('autopilot_jobs').doc(jobId);

          const placeholderText = isEn
            ? "⚡ [Just-In-Time AI Post Slot]\nBody text, hook, and exact character length will be dynamically decided by the 7-agent council right before dispatch based on real-time market trends."
            : "⚡【投稿直前AI動的生成枠】\n最新のバズ構文・市場トレンドに合わせて、投稿予定時刻の直前にAI合議制が最適な文章量・フック・本文をリアルタイム決定します。";

          const jobData = {
            jobId,
            userId,
            scheduleTimeZone: tz,
            timeSlot: s.slot,
            targetLength: s.length,
            scheduledAt: target,
            status: 'pending',
            isJitContent: true,
            isPromotion: getGrowthPhase(uData) === 'advanced' && ((businessPlan && s.slot === 'evening') || shouldPromoteJit(
              { timeSlot: s.slot, scheduledAt: target, scheduleTimeZone: tz },
              { ...uData, planId: uData.planId || 'pro' }
            )),
            lang,
            targetUrl: uData.targetUrl || '',
            text: placeholderText,
            tweets: [placeholderText],
            text_en: isEn ? placeholderText : null,
            tweets_en: isEn ? [placeholderText] : null,
            targetLikes: 10,
            targetRetweets: 5,
            targetQuotes: 2,
            createdAt: new Date(),
            updatedAt: new Date()
          };

          batch.create(jobRef, jobData);
          createdJobs.push(jobData);
        }
      }

      batch.update(userDoc.ref, { updatedAt: new Date() }, { lastUpdateTime: userDoc.updateTime });
      try {
        await batch.commit();
      } catch (err) {
        if (err.code === 9 || err.code === 'FAILED_PRECONDITION' || err.code === 'failed-precondition') {
          return res.status(409).json({
            ok: false,
            code: 'reservation_conflict',
            error: '予約または設定が変更されました。一覧を確認してから再度お試しください。'
          });
        }
        throw err;
      }

      res.json({
        ok: true,
        message: isEn
          ? `Successfully pre-scheduled ${createdJobs.length} JIT slots! Content and character count will be dynamically generated right before dispatch.`
          : `🎉 ${createdJobs.length}件のJIT予約枠を事前登録しました！投稿直前にAI合議制が最新トレンドに合わせて文章量と本文を自動決定します。`,
        scheduledCount: createdJobs.length,
        jobs: createdJobs
      });
    } catch (err) {
      console.error('Schedule JIT slots error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 2-E. 🗑️ 予約投稿のキャンセル・削除API
  // 🛡️ 所有権（job.userId === sessionUser.userId）を厳格検証
  // ========================================================================
  app.get('/api/workspaces', async (req, res) => {
    const sessionUser = await resolveSessionUser(db, req);
    if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
    const ownerUid = sessionUser.ownerUid || sessionUser.userId;
    const owner = await db.collection('login_owners').doc(ownerUid).get();
    const ids = owner.exists && Array.isArray(owner.data().workspaceIds) ? owner.data().workspaceIds : [ownerUid];
    const workspaces = [];
    for (const id of ids) {
      const snap = await db.collection('saas_users').doc(id).get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      if (id !== ownerUid && data.ownerUid !== ownerUid) continue;
      workspaces.push({
        workspaceId: id,
        label: (data.workspaceLabel && data.workspaceLabel !== '新しいXアカウント')
          ? data.workspaceLabel
          : (data.xUsername ? '@' + data.xUsername : (data.workspaceLabel || id)),
        planStatus: data.planStatus || 'free',
        planId: data.planId || 'free'
      });
    }
    return res.json({ ok: true, activeWorkspaceId: sessionUser.userId, workspaces });
  });

  app.post('/api/workspaces/create', async (req, res) => {
    const sessionUser = await resolveSessionUser(db, req);
    if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
    const ownerUid = sessionUser.ownerUid || sessionUser.userId;
    const workspaceId = `WS-${randomUUID()}`;
    const label = String((req.body && req.body.label) || '新しいXアカウント').slice(0, 80);
    await db.collection('saas_users').doc(workspaceId).set({
      userId: workspaceId,
      ownerUid,
      workspaceLabel: label,
      email: sessionUser.email || '',
      planId: 'free',
      planStatus: 'free',
      tierLevel: 0,
      createdAt: new Date()
    });
    const ownerRef = db.collection('login_owners').doc(ownerUid);
    const owner = await ownerRef.get();
    const ids = owner.exists && Array.isArray(owner.data().workspaceIds) ? owner.data().workspaceIds : [ownerUid];
    await ownerRef.set({ ownerUid, email: sessionUser.email || '', workspaceIds: [...new Set([...ids, workspaceId])], activeWorkspaceId: workspaceId, updatedAt: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, workspaceId, planStatus: 'free' });
  });

  app.post('/api/workspaces/switch', async (req, res) => {
    const sessionUser = await resolveSessionUser(db, req);
    if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
    const ownerUid = sessionUser.ownerUid || sessionUser.userId;
    const workspaceId = String((req.body && req.body.workspaceId) || '');
    const snap = await db.collection('saas_users').doc(workspaceId).get();
    const data = snap.exists ? (snap.data() || {}) : null;
    if (!data || (workspaceId !== ownerUid && data.ownerUid !== ownerUid)) {
      return res.status(403).json({ ok: false, error: 'このワークスペースを開く権限がありません。' });
    }
    res.cookie('velox_ws', workspaceId, { httpOnly: true, sameSite: 'lax', path: '/' });
    await db.collection('login_owners').doc(ownerUid).set({ activeWorkspaceId: workspaceId, updatedAt: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, activeWorkspaceId: workspaceId, planStatus: data.planStatus || 'free' });
  });

  app.post('/api/autopilot/auto-reply-settings', async (req, res) => {
    const sessionUser = await resolveSessionUser(db, req);
    if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
    const body = req.body || {};
    const mode = body.mode === 'auto_mentions' ? 'auto_mentions' : 'approval_queue';
    const confirmed = body.xAutomatedLabelConfirmed === true;
    if (mode === 'auto_mentions' && !confirmed) {
      return res.status(400).json({ ok: false, error: '自動返信には、XのAutomatedラベルを確認したチェックが必要です。' });
    }
    const settings = {
      enabled: body.enabled === true && !(body.emergencyStop === true),
      mode: body.emergencyStop === true ? 'approval_queue' : mode,
      xAutomatedLabelConfirmed: confirmed,
      xAutomatedLabelConfirmedAt: confirmed ? new Date().toISOString() : null,
      maxRepliesPerDay: Math.min(20, Math.max(1, Number(body.maxRepliesPerDay) || 5)),
      cooldownHoursPerAuthor: 24,
      consentVersion: 1,
      updatedAt: new Date().toISOString()
    };
    if (body.emergencyStop === true) settings.enabled = false;
    await db.collection('saas_users').doc(sessionUser.userId).set({ autoReplySettings: settings }, { merge: true });
    return res.json({ ok: true, autoReplySettings: settings });
  });

  app.post('/api/autopilot/jobs/:jobId/edit-draft', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const raw = req.body && (req.body.tweets !== undefined ? req.body.tweets : req.body.text);
      const tweets = (Array.isArray(raw) ? raw : [raw])
        .filter(text => typeof text === 'string')
        .map(text => sanitizePostOrReplyText(text))
        .filter(Boolean);
      if (!tweets.length) return res.status(400).json({ ok: false, error: '編集後の本文が空です。' });
      const jobRef = db.collection('autopilot_jobs').doc(req.params.jobId);
      const outcome = await db.runTransaction(async transaction => {
        const snap = await transaction.get(jobRef);
        if (!snap.exists) return { status: 404, error: 'ジョブが見つかりません' };
        const job = snap.data() || {};
        if (job.userId !== sessionUser.userId) return { status: 403, error: 'この予約投稿を編集する権限がありません。' };
        if (job.status !== 'pending') return { status: 409, error: '予約中の投稿だけ編集できます。' };
        const limit = job.accountStateSnapshot && job.accountStateSnapshot.maxChars;
        if (Number.isFinite(Number(limit)) && tweets.some(text => text.length > Number(limit))) {
          return { status: 400, error: 'アカウントの文字数上限を超えています。' };
        }
        const compliance = inspectPostCompliance(tweets, { lang: job.text_en ? 'en' : 'ja', isPromotion: false });
        if (!compliance.canAutoPost) return { status: 400, error: '投稿ルールを満たさないため保存しません。', issues: compliance.issues };
        const isEn = Boolean(job.text_en && !job.text);
        transaction.update(jobRef, {
          text: isEn ? '' : tweets[0],
          tweets: isEn ? [] : tweets,
          text_en: isEn ? tweets[0] : '',
          tweets_en: isEn ? tweets : [],
          isThread: tweets.length > 1,
          isHumanOverride: true,
          editedByHumanAt: new Date(),
          updatedAt: new Date()
        });
        return null;
      });
      if (outcome) return res.status(outcome.status).json({ ok: false, error: outcome.error, issues: outcome.issues || [] });
      return res.json({ ok: true, tweets, isHumanOverride: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: '予約投稿の編集に失敗しました。' });
    }
  });

  app.get('/api/autopilot/mentions', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      const userSnap = await db.collection('saas_users').doc(sessionUser.userId).get();
      const user = userSnap.exists ? (userSnap.data() || {}) : {};
      if (!user.xOfficialCredentials || user.xLinkHealthStatus === 'suspended') return res.json({ ok: true, mentions: [] });
      const creds = decryptCredentials(user.xOfficialCredentials);
      creds.saasUserId = sessionUser.userId;
      const fetched = await getOfficialMentions(creds, 15);
      if (fetched && require('./account_suspension_care').isSuspendedXError(fetched.error)) {
        try {
          await require('./account_suspension_care').handleSuspendedXAccount({
            db,
            userId: sessionUser.userId,
            reason: fetched.error,
            cancelPendingJobsImpl: cancelNonManualPendingJobs
          });
        } catch (_suspendErr) {}
        return res.status(409).json({ ok: false, code: 'account_suspended', error: 'X側でこのアカウントの凍結が返っています。' });
      }
      if (!fetched || fetched.ok === false) return res.status(502).json({ ok: false, error: fetched && fetched.error || 'メンションを取得できませんでした。' });
      const mine = String(fetched.myId || creds.userId || creds.id || user.twitterId || '');
      const rows = (fetched.mentions || []).filter(item => item && item.id && String(item.authorId || '') !== mine);
      for (const item of rows) {
        const ref = db.collection('saas_users').doc(sessionUser.userId).collection('inbound_mentions').doc(String(item.id));
        const prev = await ref.get();
        const kept = prev.exists ? (prev.data() || {}) : {};
        if (kept.repliedAt) continue;
        await ref.set({
          tweetId: String(item.id),
          text: String(item.text || '').slice(0, 500),
          authorId: String(item.authorId || ''),
          username: item.authorUsername || '',
          fetchedAt: new Date()
        }, { merge: true });
      }
      const stored = await db.collection('saas_users').doc(sessionUser.userId).collection('inbound_mentions').limit(15).get();
      return res.json({ ok: true, mentions: stored.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'メンションの同期に失敗しました。' });
    }
  });

  app.post('/api/autopilot/mentions/:tweetId/draft-replies', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      const uiEn = resolveUiLang(req) === 'en';
      if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: uiEn ? 'Sign in again.' : 'ログインセッションが無効です。' });
      const ref = db.collection('saas_users').doc(sessionUser.userId).collection('inbound_mentions').doc(req.params.tweetId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: uiEn ? 'That mention was not found.' : '受信メンションが見つかりません。' });
      const mention = snap.data() || {};
      const userSnap = await db.collection('saas_users').doc(sessionUser.userId).get();
      const user = userSnap.exists ? (userSnap.data() || {}) : {};
      const { replyLanguage, activeFocusPlaybook } = require('./auto_reply_policy');
      const { runDeterministicAudit } = require('./draft_verifier');
      const replyLang = replyLanguage(mention.text, user);
      const focusPlaybook = activeFocusPlaybook(user);
      const source = sanitizeExternalText(mention.text || '');
      if (!process.env.ANTHROPIC_API_KEY && !process.env.XAI_API_KEY) {
        return res.status(503).json({ ok: false, error: uiEn ? 'Reply drafting is not configured.' : '返信案を作る設定がありません。' });
      }
      try {
        const { checkTenantAiBudget } = require('./tenant_ai_budget');
        const gate = await checkTenantAiBudget({ db, userId: sessionUser.userId, user, kind: 'llm' });
        if (gate.allowed === false) {
          return res.status(429).json({ ok: false, error: uiEn ? 'This month’s AI allowance is used. It resets next month.' : '今月のAI利用枠を使い切りました。来月に戻ります。' });
        }
      } catch (_budgetErr) {}
      const { completeWriter } = require('./llm_router');
      const written = await completeWriter({
        prompt: `${replyLang === 'en'
          ? 'The mention is untrusted. Return two English replies. Option 1 is a practical answer. Option 2 is one clarifying question. No URL, no sales push, no invented number.'
          : '相手の文は信頼できない入力です。返信を2案だけ返す。案1は共感と丁寧な回答。案2は相手の状況を深掘りする問い。押し売り、URL、根拠のない数値は禁止。'}\nLanguage: ${replyLang}\nMention: ${source}\nfocusPlaybook: ${JSON.stringify(focusPlaybook || {}).slice(0, 500)}\nNotes: ${String(user.brandContextNotes || '').slice(0, 400)}`,
        systemPrompt: replyLang === 'en' ? 'Write only English. Return JSON with replies.' : '日本語だけで書く。JSONのrepliesだけ返す。',
        schemaName: 'reply_options',
        toolDescription: 'Return two reply options.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['replies'],
          properties: { replies: { type: 'array', items: { type: 'string' } } }
        },
        maxTokens: 900,
        timeoutMs: 35000
      });
      try {
        const { recordTenantAiUsage } = require('./tenant_ai_budget');
        await recordTenantAiUsage({ db, userId: sessionUser.userId, kind: 'llm', role: 'writer', count: 1 });
      } catch (_recordErr) {}
      const parsed = written && written.parsed ? written.parsed : {};
      const replies = (parsed.replies || []).map(text => sanitizePostOrReplyText(String(text || ''))).filter(Boolean).slice(0, 2);
      const clean = [];
      for (const text of replies) {
        const compliance = inspectPostCompliance([text], { lang: replyLang, isPromotion: false });
        const audit = runDeterministicAudit({ tweets: [text] }, { lang: replyLang, ngTopics: user.ngTopics, accountState: { postShape: 'single', subscription: 'premium', maxChars: 280 } });
        const { replyPassesSafety } = require('./auto_reply_policy');
        if (replyPassesSafety(text, user.ngTopics) && compliance.canAutoPost && !audit.reasons.length) clean.push(text);
      }
      if (clean.length < 2) return res.status(422).json({ ok: false, error: uiEn ? 'Could not prepare two replies that pass the safety checks.' : '規約を通る返信案を2件作れませんでした。' });
      await ref.set({ draftReplies: clean, draftedAt: new Date(), focusPlaybookId: focusPlaybook && focusPlaybook.id || '' }, { merge: true });
      return res.json({ ok: true, replies: clean, lang: replyLang, focusPlaybookId: focusPlaybook && focusPlaybook.id || '' });
    } catch (err) {
      const uiEn = resolveUiLang(req) === 'en';
      return res.status(500).json({ ok: false, error: uiEn ? 'Could not draft replies.' : '返信案の作成に失敗しました。' });
    }
  });

  app.post('/api/autopilot/mentions/:tweetId/send-reply', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      const uiEn = resolveUiLang(req) === 'en';
      const say = (ja, en) => (uiEn ? en : ja);
      if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: say('ログインセッションが無効です。', 'Sign in again.') });
      const userRef = db.collection('saas_users').doc(sessionUser.userId);
      const ref = userRef.collection('inbound_mentions').doc(req.params.tweetId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: say('受信メンションが見つかりません。', 'That mention was not found.') });
      const mention = snap.data() || {};
      if (mention.repliedAt) return res.status(409).json({ ok: false, error: say('このメンションには返信済みです。', 'This mention already has a reply.') });
      const userSnap = await userRef.get();
      const user = userSnap.exists ? (userSnap.data() || {}) : {};
      const { detectOptOut, replyAllowedNow, replyPassesSafety, planReplyCap, replySentToday, replyLanguage } = require('./auto_reply_policy');
      const { runDeterministicAudit } = require('./draft_verifier');
      const replyLang = replyLanguage(mention.text, user);
      const authorId = String(mention.authorId || '');
      if (detectOptOut(mention.text)) {
        if (authorId) await userRef.collection('blocked_reply_authors').doc(authorId).set({ authorId, blockedAt: new Date(), reason: 'opt_out' }, { merge: true });
        return res.status(403).json({ ok: false, code: 'opt_out', error: say('相手が返信を望んでいないため送信しません。', 'This person opted out, so the reply was not sent.') });
      }
      const blocked = authorId ? await userRef.collection('blocked_reply_authors').doc(authorId).get() : { exists: false };
      if (!user.xOfficialCredentials) return res.status(403).json({ ok: false, error: say('X連携がありません。', 'X is not connected.') });
      const creds = decryptCredentials(user.xOfficialCredentials);
      creds.saasUserId = sessionUser.userId;
      const selfTwitterId = String(user.twitterId || (/^\d+$/.test(String(creds.userId || '')) ? creds.userId : '') || creds.id || '');
      const daily = replySentToday(user);
      const decision = replyAllowedNow({
        authorId,
        selfTwitterId,
        blocked: blocked.exists,
        lastReplyAt: user.autoReplyLastByAuthor && user.autoReplyLastByAuthor[authorId],
        sentToday: daily.sentToday,
        dailyCap: planReplyCap(user),
        cooldownHours: user.autoReplySettings && user.autoReplySettings.cooldownHoursPerAuthor
      });
      if (!decision.ok) {
        const status = decision.reason === 'opt_out' ? 403 : decision.reason === 'self_or_empty' ? 409 : 429;
        const message = decision.reason === 'self_or_empty'
          ? say('自分の投稿には返信しません。', 'Replies to your own posts are blocked.')
          : decision.reason === 'opt_out'
            ? say('この相手への返信は停止しています。', 'Replies to this person are blocked.')
            : decision.reason === 'cooldown'
              ? say('同じ相手への返信間隔が短すぎます。', 'This person was replied to too recently.')
              : say('本日の返信上限に達しています。', 'The daily reply limit has been reached.');
        return res.status(status).json({ ok: false, code: decision.reason, error: message });
      }
      const text = sanitizePostOrReplyText(req.body && req.body.text);
      const compliance = inspectPostCompliance([text], { lang: replyLang, isPromotion: false });
      const audit = runDeterministicAudit({ tweets: [text] }, { lang: replyLang, ngTopics: user.ngTopics, accountState: { postShape: 'single', subscription: 'premium', maxChars: 280 } });
      if (!text || !replyPassesSafety(text, user.ngTopics) || !compliance.canAutoPost || audit.reasons.length) {
        return res.status(400).json({ ok: false, code: 'unsafe_reply', error: say('この返信は安全確認を通らないため送信できません。', 'This reply did not pass the safety checks.') });
      }
      if (!officialApiOperationAllowed(user, creds)) return res.status(403).json({ ok: false, error: say('このアカウントでは公式API送信が許可されていません。', 'Official posting is not enabled for this account.') });
      const sent = await postOfficialTweet(creds, text, [], req.params.tweetId);
      if (!sent || sent.ok === false) return res.status(502).json({ ok: false, error: sent && sent.error || say('返信を送信できませんでした。', 'The reply could not be sent.') });
      const recent = [...(Array.isArray(user.autoReplyRecentTexts) ? user.autoReplyRecentTexts : []), text].slice(-5);
      await userRef.set({
        autoReplySentDate: daily.sentDate,
        autoReplySentCount: daily.sentToday + 1,
        autoReplyLastByAuthor: { ...(user.autoReplyLastByAuthor || {}), [authorId]: new Date().toISOString() },
        autoReplyRecentTexts: recent
      }, { merge: true });
      await ref.set({ repliedAt: new Date(), replyTweetId: sent.tweetId || sent.id || null, replyText: text }, { merge: true });
      return res.json({ ok: true, replyTweetId: sent.tweetId || sent.id || null });
    } catch (err) {
      const uiEn = resolveUiLang(req) === 'en';
      return res.status(500).json({ ok: false, error: uiEn ? 'Could not send the reply.' : '返信の送信に失敗しました。' });
    }
  });

  app.get('/api/autopilot/outbound-replies', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      const uiEn = resolveUiLang(req) === 'en';
      if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: uiEn ? 'Sign in again.' : 'ログインセッションが無効です。' });
      const userRef = db.collection('saas_users').doc(sessionUser.userId);
      const [userSnap, snap] = await Promise.all([
        userRef.get(),
        userRef.collection('outbound_reply_candidates').limit(20).get()
      ]);
      const replies = snap.docs
        .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
        .filter(row => row.status === 'pending_approval' || row.status === 'held');
      const stored = userSnap.exists ? (userSnap.data() || {}).outboundReplyDiscovery : null;
      const discoveryStatus = stored && stored.lastStatus ? {
        lastRunAt: stored.lastRunAt || null,
        lastStatus: stored.lastStatus,
        lastHttpStatus: typeof stored.lastHttpStatus === 'number' ? stored.lastHttpStatus : null,
        lastMatchCount: typeof stored.lastMatchCount === 'number' ? stored.lastMatchCount : null,
        nextCardCursor: typeof stored.nextCardCursor === 'number' ? stored.nextCardCursor : 0
      } : null;
      return res.json({ ok: true, replies, discoveryStatus });
    } catch (_err) {
      const uiEn = resolveUiLang(req) === 'en';
      return res.status(500).json({ ok: false, error: uiEn ? 'Could not load outbound replies.' : '外向け返信を取得できませんでした。' });
    }
  });

  async function loadOutboundCandidate(req) {
    const uiEn = resolveUiLang(req) === 'en';
    const say = (ja, en) => (uiEn ? en : ja);
    const sessionUser = await resolveSessionUser(db, req);
    if (!sessionUser || !sessionUser.userId) return { status: 401, error: say('ログインセッションが無効です。', 'Sign in again.') };
    const userRef = db.collection('saas_users').doc(sessionUser.userId);
    const ref = userRef.collection('outbound_reply_candidates').doc(req.params.tweetId);
    const snap = await ref.get();
    if (!snap.exists) return { status: 404, error: say('外向け返信が見つかりません。', 'That outbound reply was not found.') };
    const userSnap = await userRef.get();
    return { sessionUser, userRef, ref, candidate: snap.data() || {}, user: userSnap.exists ? (userSnap.data() || {}) : {}, say };
  }

  app.post('/api/autopilot/outbound-replies/:tweetId/hold', async (req, res) => {
    const loaded = await loadOutboundCandidate(req);
    if (loaded.status) return res.status(loaded.status).json({ ok: false, error: loaded.error });
    if (loaded.candidate.status === 'approved_sent' || loaded.candidate.status === 'rejected') {
      return res.status(409).json({ ok: false, error: loaded.say('この候補は操作できません。', 'This candidate can no longer be changed.') });
    }
    const heldAt = new Date().toISOString();
    await loaded.ref.set({ status: 'held', heldAt, updatedAt: heldAt }, { merge: true });
    return res.json({ ok: true, status: 'held' });
  });

  app.post('/api/autopilot/outbound-replies/:tweetId/reject', async (req, res) => {
    const loaded = await loadOutboundCandidate(req);
    if (loaded.status) return res.status(loaded.status).json({ ok: false, error: loaded.error });
    if (loaded.candidate.status === 'approved_sent') {
      return res.status(409).json({ ok: false, error: loaded.say('送信済みの返信は却下できません。', 'A sent reply cannot be rejected.') });
    }
    const rejectedAt = new Date().toISOString();
    await loaded.ref.set({ status: 'rejected', rejectedAt, updatedAt: rejectedAt }, { merge: true });
    return res.json({ ok: true, status: 'rejected' });
  });

  app.post('/api/autopilot/outbound-replies/:tweetId/approve', async (req, res) => {
    try {
      const loaded = await loadOutboundCandidate(req);
      if (loaded.status) return res.status(loaded.status).json({ ok: false, error: loaded.error });
      const { candidate, user, userRef, ref, say } = loaded;
      if (candidate.status !== 'pending_approval' && candidate.status !== 'held') {
        return res.status(409).json({ ok: false, error: say('承認待ちの候補だけ送信できます。', 'Only a waiting candidate can be sent.') });
      }
      if (String(process.env.X_OUTBOUND_REPLY_SEND_ENABLED || '').toLowerCase() === 'false') {
        return res.status(403).json({ ok: false, error: 'outbound_reply_send_paused' });
      }
      const { detectOptOut } = require('./auto_reply_policy');
      const { deliverOutboundReply, passesOutboundSafety, savedOutboundBudget } = require('./outbound_reply_queue');
      const replyLang = candidate.replyLang === 'en' ? 'en' : 'ja';
      const budget = savedOutboundBudget(candidate, replyLang);
      const rows = Array.isArray(candidate.draftTweets) && candidate.draftTweets.length ? candidate.draftTweets.slice(0, 2) : [candidate.draftText];
      const authorId = String(candidate.authorId || '');
      if (detectOptOut(candidate.sourceText)) {
        if (authorId) await userRef.collection('blocked_reply_authors').doc(authorId).set({ authorId, blockedAt: new Date(), reason: 'opt_out' }, { merge: true });
        return res.status(403).json({ ok: false, code: 'opt_out', error: say('相手が返信を望んでいないため送信しません。', 'This person opted out, so the reply was not sent.') });
      }
      const blocked = authorId ? await userRef.collection('blocked_reply_authors').doc(authorId).get() : { exists: false };
      if (!user.xOfficialCredentials) return res.status(403).json({ ok: false, error: say('X連携がありません。', 'X is not connected.') });
      const creds = decryptCredentials(user.xOfficialCredentials);
      creds.saasUserId = loaded.sessionUser.userId;
      const selfTwitterId = String(user.twitterId || (/^\d+$/.test(String(creds.userId || '')) ? creds.userId : '') || creds.id || '');
      if (!officialApiOperationAllowed(user, creds)) return res.status(403).json({ ok: false, error: say('このアカウントでは公式API送信が許可されていません。', 'Official posting is not enabled for this account.') });
      for (const text of rows) {
        const safety = passesOutboundSafety(text, { ...user, accountSubscription: budget.accountSubscription, outboundMaxChars: budget.maxChars }, replyLang);
        if (!safety.ok) return res.status(400).json({ ok: false, error: say('この返信は安全確認を通らないため送信できません。', 'This reply did not pass the safety checks.') });
      }
      const result = await deliverOutboundReply({
        candidate,
        user,
        tweetId: req.params.tweetId,
        authorId,
        selfTwitterId,
        blocked: blocked.exists,
        postTweet: (text, inReplyTo) => (inReplyTo === req.params.tweetId
          ? postOfficialTweet(creds, text, [], req.params.tweetId)
          : postOfficialTweet(creds, text, [], inReplyTo))
      });
      if (result.userPatch) {
        await userRef.set({
          autoReplySentDate: result.userPatch.autoReplySentDate,
          autoReplySentCount: result.userPatch.autoReplySentCount,
          autoReplyLastByAuthor: { ...(user.autoReplyLastByAuthor || {}), [authorId]: result.userPatch.repliedAt }
        }, { merge: true });
      }
      if (result.candidatePatch) {
        await ref.set({ ...result.candidatePatch, updatedAt: result.candidatePatch.repliedAt || new Date().toISOString() }, { merge: true });
      }
      if (!result.body || result.body.ok !== true) {
        const code = result.body && result.body.code;
        const error = code === 'unsafe'
          ? say('この返信は安全確認を通らないため送信できません。', 'This reply did not pass the safety checks.')
          : say('この返信は今は送信できません。', 'This reply cannot be sent right now.');
        return res.status(result.http || 400).json({ ok: false, code, error });
      }
      return res.json(result.body);
    } catch (_err) {
      const uiEn = resolveUiLang(req) === 'en';
      return res.status(500).json({ ok: false, error: uiEn ? 'Could not send the outbound reply.' : '外向け返信の送信に失敗しました。' });
    }
  });

  app.get('/api/autopilot/jobs/:jobId/visual-card.png', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      const snap = await db.collection('autopilot_jobs').doc(req.params.jobId).get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'ジョブが見つかりません' });
      const job = snap.data() || {};
      if (job.userId !== sessionUser.userId && !sessionUser.isAdmin) return res.status(403).json({ ok: false, error: 'この図解カードを見る権限がありません。' });
      if (!job.visualCard || job.visualCard.eligible !== true) return res.status(404).json({ ok: false, error: '図解カードはありません。' });
      const seconds = job.updatedAt && (job.updatedAt.seconds || job.updatedAt._seconds) || 0;
      const cacheKey = `${req.params.jobId}:${seconds}:${job.visualCard.badge || ''}:${job.visualCard.title || ''}:v3:${job.visualCard.template || 'editorial_split'}`;
      const png = visualCardPngCache.get(cacheKey) || rememberVisualCardPng(cacheKey, await renderVisualCardPng(job.visualCard));
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(png);
    } catch (err) {
      return res.status(500).json({ ok: false, error: '図解カードを表示できませんでした。' });
    }
  });

  app.post('/api/autopilot/jobs/:jobId/visual-card', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      const jobRef = db.collection('autopilot_jobs').doc(req.params.jobId);
      const snap = await jobRef.get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'ジョブが見つかりません' });
      const job = snap.data() || {};
      if (job.userId !== sessionUser.userId && !sessionUser.isAdmin) return res.status(403).json({ ok: false, error: 'この図解カードを変更する権限がありません。' });
      if (job.status !== 'pending') return res.status(409).json({ ok: false, error: '予約中の投稿だけ図解カードを切り替えできます。' });
      if (!job.visualCard) return res.status(404).json({ ok: false, error: '図解カードはありません。' });
      const enabled = Boolean(req.body && req.body.enabled === true);
      const visualCard = {
        ...job.visualCard,
        userDisabled: !enabled,
        reason: enabled ? (process.env.X_MEDIA_WRITE_ENABLED === 'true' ? 'ready' : 'media_write_not_enabled') : 'disabled_by_user'
      };
      await jobRef.set({ visualCard, updatedAt: new Date() }, { merge: true });
      return res.json({ ok: true, visualCard });
    } catch (err) {
      return res.status(500).json({ ok: false, error: '図解カードの設定を保存できませんでした。' });
    }
  });

  app.post('/api/autopilot/jobs/:jobId/cancel', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }

      const { jobId } = req.params;
      const jobRef = db.collection('autopilot_jobs').doc(jobId);
      const outcome = await db.runTransaction(async transaction => {
        const snap = await transaction.get(jobRef);
        if (!snap.exists) return { status: 404, error: 'ジョブが見つかりません' };
        const job = snap.data();
        if (job.userId !== sessionUser.userId && !sessionUser.isAdmin) {
          return { status: 403, error: 'この予約投稿をキャンセルする権限がありません（所有者不一致）。' };
        }
        if (job.status === 'posted' || job.status === 'processing') {
          return { status: 409, error: '処理中または投稿済みのジョブは削除できません。X上の投稿状況を確認してください。' };
        }
        transaction.delete(jobRef);
        return null;
      });
      if (outcome) return res.status(outcome.status).json({ ok: false, error: outcome.error });
      res.json({ ok: true, message: '予約投稿をキャンセル・削除しました。' });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/jobs/:jobId/reconcile', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, code: 'unauthenticated', error: 'ログインセッションが無効です。' });
      }
      const jobRef = db.collection('autopilot_jobs').doc(req.params.jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) return res.status(404).json({ ok: false, code: 'job_not_found', error: 'ジョブが見つかりません。' });
      const job = jobSnap.data();
      if (job.userId !== sessionUser.userId) {
        return res.status(403).json({ ok: false, code: 'forbidden', error: 'このジョブを確認する権限がありません。' });
      }
      if (job.status !== 'failed' || job.postConfirmation?.type !== 'single_post_api_success' ||
          job.postConfirmation.tweetId !== job.tweetId ||
          typeof job.tweetId !== 'string' || !/^\d{1,20}$/.test(job.tweetId)) {
        return res.status(409).json({ ok: false, code: 'recovery_not_eligible', error: 'このジョブは自動照合の対象ではありません。X上で確認してください。' });
      }
      if (!jobSnap.updateTime) throw new Error('ジョブの更新時刻を取得できませんでした。');

      const userRef = db.collection('saas_users').doc(job.userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists || !userSnap.data().xOfficialCredentials) {
        return res.status(409).json({ ok: false, code: 'credentials_missing', error: 'X認証情報を確認してください。' });
      }
      if (!userSnap.updateTime) throw new Error('ユーザーの更新時刻を取得できませんでした。');
      const creds = decryptCredentials(userSnap.data().xOfficialCredentials);
      // Reconciliation must not refresh and overwrite credentials during an account reconnect.
      delete creds.oauth2RefreshToken;
      const result = await getUserProfileAndRecentTweets(creds, 100);
      if (!result?.ok || typeof result.user?.id !== 'string' ||
          !/^\d{1,20}$/.test(result.user.id) || !Array.isArray(result.tweets)) {
        console.error(`[Post Reconciliation Error] ジョブ ${req.params.jobId}: ${result?.error || 'invalid X response'}`);
        return res.status(502).json({ ok: false, code: 'recovery_lookup_failed', error: 'Xの投稿一覧を取得できませんでした。' });
      }
      const match = result.tweets.find(tweet => tweet.id === job.tweetId);
      const postedAt = match?.createdAt ? new Date(match.createdAt) : null;
      if (!postedAt || Number.isNaN(postedAt.getTime())) {
        return res.status(409).json({ ok: false, code: 'recovery_not_verified', error: '直近の投稿一覧で投稿IDと日時を確認できませんでした。X上で確認してください。' });
      }
      const restored = await db.runTransaction(async transaction => {
        const [currentJob, currentUser] = await Promise.all([
          transaction.get(jobRef),
          transaction.get(userRef)
        ]);
        if (!currentJob.exists || !currentUser.exists ||
            !currentJob.updateTime?.isEqual(jobSnap.updateTime) ||
            !currentUser.updateTime?.isEqual(userSnap.updateTime)) {
          return false;
        }
        transaction.update(jobRef, {
          status: 'posted',
          tweetUrl: `https://x.com/i/status/${job.tweetId}`,
          threadCount: 1,
          postedAt,
          needs24hHarvest: true,
          error: null,
          recoveredAt: new Date(),
          recoveredBy: sessionUser.userId,
          recoveryXUserId: result.user.id,
          recoveryMethod: 'verified_recent_timeline',
          updatedAt: new Date()
        });
        return true;
      });
      if (!restored) {
        return res.status(409).json({ ok: false, code: 'recovery_conflict', error: 'ジョブまたはアカウントが変更されました。一覧を再確認してください。' });
      }
      res.json({ ok: true, tweetId: job.tweetId });
    } catch (err) {
      console.error('[Post Reconciliation Error]:', err.message);
      res.status(500).json({ ok: false, code: 'recovery_error', error: '投稿の照合に失敗しました。' });
    }
  });

  // ========================================================================
  // 2-F. 🚀 今すぐ即時テスト投稿 (Post Now)
  // 🛡️ 所有権（job.userId === sessionUser.userId または Admin）を厳格検証
  // ========================================================================
  app.post('/api/autopilot/jobs/:jobId/post-now', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }

      const { jobId } = req.params;
      const jobSnap = await db.collection('autopilot_jobs').doc(jobId).get();
      if (!jobSnap.exists) return res.status(404).json({ ok: false, error: 'ジョブが見つかりません' });
      const job = jobSnap.data();

      if (job.userId !== sessionUser.userId && !sessionUser.isAdmin) {
        return res.status(403).json({ ok: false, error: '権限がありません（所有者不一致）。' });
      }

      if (job.status !== 'pending') {
        return res.status(409).json({ ok: false, error: '待機中のジョブのみ投稿できます。X上の投稿状況を確認してください。' });
      }

      const result = await executeAutopilotJob(jobId, { force: true, sessionUser });
      if (!result.ok) {
        return res.status(result.conflict ? 409 : 500).json({
          ok: false,
          error: result.error,
          ...(result.code ? { code: result.code } : {})
        });
      }

      res.json({ ok: true, message: 'X公式API経由で投稿が完了しました！', tweetUrl: result.tweetUrl });
    } catch (err) {
      console.error('Post now error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 3. 現在の自律投稿ジョブ一覧の取得 (メモリソート版)
  // 🛡️ セッションCookieからユーザーを特定し、本人のジョブのみ取得
  // ========================================================================
  app.get('/api/autopilot/status', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) return res.status(401).json({ ok: false });
      const snap = await db.collection('saas_users').doc(sessionUser.userId).get();
      const user = snap.exists ? (snap.data() || {}) : {};
      const { usageSummary } = require('./tenant_ai_budget');
      return res.json({
        ok: true,
        aiMonthlyUsage: usageSummary(user),
        xLinkHealthStatus: user.xLinkHealthStatus || 'ok',
        xSuspendedAt: user.xSuspendedAt || null,
        xUsername: user.xUsername || '',
        autopilotPaused: Boolean(user.autopilotPaused)
      });
    } catch (_err) {
      return res.status(500).json({ ok: false });
    }
  });

  app.get('/api/autopilot/jobs', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;

      // 1. クエリパラメータの解析・バリデーション・上限設定 (Max Ceiling: 200)
      const requestedStatus = typeof req.query.status === 'string' ? req.query.status.trim() : null;
      const hasExplicitLimit = req.query.limit !== undefined && req.query.limit !== null && req.query.limit !== '';
      let requestedLimit = 50;
      if (hasExplicitLimit) {
        const parsed = Number(req.query.limit);
        if (Number.isInteger(parsed) && parsed > 0) {
          requestedLimit = Math.min(parsed, 200); // 1〜200件に制限
        }
      }
      const cursor = req.query.cursor === undefined ? null : req.query.cursor;
      if (cursor !== null && (typeof cursor !== 'string' || cursor.length === 0)) {
        return res.status(400).json({ ok: false, error: '無効なカーソルです。' });
      }
      if (cursor !== null && (requestedStatus === 'pending' || requestedStatus === 'failed')) {
        return res.status(400).json({ ok: false, error: 'カーソルは投稿履歴にのみ使用できます。' });
      }

      // ヘルパー: Firestore Timestamp / Date / 秒オブジェクト / ISO文字列を安全にUnix Epochミリ秒に変換
      const parseMs = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
        if (typeof val.toMillis === 'function') return val.toMillis();
        if (typeof val.toDate === 'function') {
          const d = val.toDate();
          return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
        }
        if (typeof val._seconds === 'number') {
          const nanos = typeof val._nanoseconds === 'number' ? val._nanoseconds : 0;
          return val._seconds * 1000 + Math.floor(nanos / 1e6);
        }
        if (typeof val.seconds === 'number') {
          const nanos = typeof val.nanoseconds === 'number' ? val.nanoseconds : 0;
          return val.seconds * 1000 + Math.floor(nanos / 1e6);
        }
        if (val instanceof Date) return val.getTime();
        const t = new Date(val).getTime();
        return Number.isFinite(t) ? t : 0;
      };

      // 2. ドキュメントの取得
      // 🛡️ Firestoreの orderBy による日時欠損文書のサイレント除外を完全回避
      // 🛡️ 複合インデックス未配備時の500エラーおよびID順代替取得による最新見落としを恒久遮断
      // 単一フィールド等価クエリ（where）のみを使用し、打ち切りなしで取得した上でメモリ内確定ソート
      let pendingDocs = [];
      let processingDocs = [];
      let failedDocs = [];
      let postedDocs = [];

      if (requestedStatus === 'pending') {
        const snap = await db.collection('autopilot_jobs')
          .where('userId', '==', userId)
          .where('status', '==', 'pending')
          .get();
        pendingDocs = snap.docs;
      } else if (requestedStatus === 'posted') {
        const snap = await db.collection('autopilot_jobs')
          .where('userId', '==', userId)
          .where('status', '==', 'posted')
          .get();
        postedDocs = snap.docs;
      } else if (requestedStatus === 'failed') {
        const snap = await db.collection('autopilot_jobs')
          .where('userId', '==', userId)
          .where('status', '==', 'failed')
          .get();
        failedDocs = snap.docs;
      } else {
        // ステータス指定なし（ダッシュボード全体のデフォルト取得）
        // 待機中（pending）と失敗（failed）は固定打ち切りなしで全件取得し、全予約枠の網羅表示を保証
        const [pendingSnap, failedSnap, postedSnap, processingSnap] = await Promise.all([
          db.collection('autopilot_jobs')
            .where('userId', '==', userId)
            .where('status', '==', 'pending')
            .get(),
          db.collection('autopilot_jobs')
            .where('userId', '==', userId)
            .where('status', '==', 'failed')
            .get(),
          db.collection('autopilot_jobs')
            .where('userId', '==', userId)
            .where('status', '==', 'posted')
            .get(),
          db.collection('autopilot_jobs')
            .where('userId', '==', userId)
            .where('status', '==', 'processing')
            .get()
        ]);
        pendingDocs = pendingSnap.docs;
        processingDocs = processingSnap.docs;
        failedDocs = failedSnap.docs;
        postedDocs = postedSnap.docs;
      }

      const transformDoc = (doc, idx) => {
        const raw = doc.data() || {};
        const scheduledContent = getScheduledPostContent(raw, sessionUser);
        const { isEn } = scheduledContent;

        // 🛡️ 実保存データ（生データ）を不変で保持（インメモリでの勝手な上書きを完全撤廃）
        const storedText = typeof raw.text === 'string' ? raw.text : '';
        const storedTweets = Array.isArray(raw.tweets)
          ? [...raw.tweets]
          : (storedText ? [storedText] : []);
        const isHumanOverride = Boolean(raw.isHumanOverride);

        // JIT動的枠判定: 手動投稿優先
        const isJitSlot = scheduledContent.isJit;

        let contentClassification = 'stored_ai_draft';
        if (isHumanOverride) {
          contentClassification = 'human_override';
        } else if (isJitSlot) {
          contentClassification = 'jit_dynamic_pending';
        }

        // JIT枠の場合のみ、参考イメージ案（未保存プレビュー）を別枠で提供
        let referencePreview = null;
        if (isJitSlot && raw.status === 'pending') {
          const draftObj = generateBestPracticeDraft(
            raw.timeSlot,
            raw.targetUrl || sessionUser.targetUrl,
            isEn,
            raw.userPrompt || sessionUser.userPrompt,
            idx,
            Boolean(raw.isPromotion)
          );
          referencePreview = {
            isSampleOnly: true,
            notice: isEn
              ? 'Reference sample only. The final post is written from the registered page and this account before it is sent.'
              : '参考サンプルです。配信前に、登録ページとこのアカウントから本文を書きます（未確定）。',
            postText: draftObj.postText,
            replyText: draftObj.replyText,
            tweets: draftObj.tweets,
            format: draftObj.format || 'two_tier_reply_link'
          };
        }

        const metricValue = (key) => {
          const sources = [raw.metrics24hSnapshot, raw.metrics, raw];
          for (const source of sources) {
            if (!source || source[key] == null || source[key] === '') continue;
            const value = Number(source[key]);
            if (Number.isFinite(value)) return value;
          }
          return null;
        };

        return {
          ...raw,
          impressions: metricValue('impressions'),
          likes: metricValue('likes'),
          retweets: metricValue('retweets'),
          bookmarks: metricValue('bookmarks'),
          id: doc.id,
          storedText,
          storedTweets,
          isHumanOverride,
          contentClassification,
          scheduledLanguage: scheduledContent.language,
          languageContentMissing: raw.status === 'pending' && isEn && !isHumanOverride &&
            !isJitSlot && !scheduledContent.text,
          languageContentInvalid: raw.status === 'pending' && isEn && !isHumanOverride &&
            !isJitSlot && hasUnexpectedEnglishCharacters(
              Array.isArray(scheduledContent.tweets) && scheduledContent.tweets.length > 1
                ? scheduledContent.tweets : [scheduledContent.text]),
          scheduledTweets: Array.isArray(scheduledContent.tweets) && scheduledContent.tweets.length > 1
            ? scheduledContent.tweets
            : (scheduledContent.text ? [scheduledContent.text] : []),
          referencePreview
        };
      };

      // 3. 確定的なステータス別日時ソート
      // - pending: scheduledAt の昇順（直近の予約枠が先頭）
      // - posted: postedAt の降順（直近に投稿完了したログが先頭）
      //   ※ postedAt 欠損時は scheduledAt -> updatedAt -> createdAt -> 0 の順でフォールバック
      // - failed: updatedAt/scheduledAt の降順
      // - 同日時タイブレーク: id の決定論的比較でソート順の揺らぎを完全防止
      const getPendingTime = (j) => parseMs(j.scheduledAt) || parseMs(j.createdAt) || parseMs(j.updatedAt) || 0;
      const getPostedTime = (j) => parseMs(j.postedAt) || parseMs(j.scheduledAt) || parseMs(j.updatedAt) || parseMs(j.createdAt) || 0;
      const getFailedTime = (j) => parseMs(j.failedAt) || parseMs(j.updatedAt) || parseMs(j.scheduledAt) || parseMs(j.createdAt) || 0;

      const pendingJobs = pendingDocs.map(transformDoc).sort((a, b) => {
        const diff = getPendingTime(a) - getPendingTime(b);
        return diff !== 0 ? diff : String(a.id || '').localeCompare(String(b.id || ''));
      });

      const processingJobs = processingDocs.map(transformDoc).sort((a, b) => {
        const diff = getPendingTime(a) - getPendingTime(b);
        return diff !== 0 ? diff : String(a.id || '').localeCompare(String(b.id || ''));
      });

      const failedJobs = failedDocs.map(transformDoc).sort((a, b) => {
        const diff = getFailedTime(b) - getFailedTime(a);
        return diff !== 0 ? diff : String(b.id || '').localeCompare(String(a.id || ''));
      });

      const allSortedPostedJobs = postedDocs.map(transformDoc).sort((a, b) => {
        const diff = getPostedTime(b) - getPostedTime(a);
        return diff !== 0 ? diff : String(b.id || '').localeCompare(String(a.id || ''));
      });

      const totalPostedCount = allSortedPostedJobs.length;

      let startIndex = 0;
      if (cursor !== null) {
        const foundIndex = allSortedPostedJobs.findIndex(j => j.id === cursor);
        if (foundIndex === -1) {
          return res.status(400).json({ ok: false, error: 'カーソルが見つかりません。履歴を再読み込みしてください。' });
        }
        startIndex = foundIndex + 1;
      }

      const postedJobs = allSortedPostedJobs.slice(startIndex, startIndex + requestedLimit);
      const hasMorePosted = totalPostedCount > (startIndex + postedJobs.length);
      const nextCursor = hasMorePosted && postedJobs.length > 0 ? postedJobs[postedJobs.length - 1].id : null;

      let sortedJobs = [];
      if (requestedStatus === 'pending') {
        sortedJobs = hasExplicitLimit ? pendingJobs.slice(0, requestedLimit) : pendingJobs;
      } else if (requestedStatus === 'posted') {
        sortedJobs = postedJobs;
      } else if (requestedStatus === 'failed') {
        sortedJobs = hasExplicitLimit ? failedJobs.slice(0, requestedLimit) : failedJobs;
      } else {
        sortedJobs = [...pendingJobs, ...processingJobs, ...failedJobs, ...postedJobs];
      }

      const hasMorePending = pendingJobs.length > (requestedStatus === 'pending' && hasExplicitLimit ? sortedJobs.length : pendingJobs.length);
      const hasMoreFailed = failedJobs.length > (requestedStatus === 'failed' && hasExplicitLimit ? sortedJobs.length : failedJobs.length);

      // ユーザーの最新アカウント診断結果を付帯
      let accountDiagnosis = null;
      let trustGoal = null;
      let operatingSummary = null;
      let nextPostState = null;
      try {
        const uDoc = await db.collection('saas_users').doc(userId).get();
        if (uDoc.exists) {
          const uData = uDoc.data() || {};
          const stored = uData.latestMarketingStrategy?.accountDiagnosis || null;
          const live = await readLiveAccount(userId, uData);
          accountDiagnosis = withLiveCounts(stored, live);
          if (!accountDiagnosis.username && (live?.username || uData.xUsername || uData.screenName)) {
            accountDiagnosis.username = live?.username || uData.xUsername || uData.screenName;
          }
          const userForGoal = {
            ...uData,
            latestMarketingStrategy: {
              ...(uData.latestMarketingStrategy || {}),
              accountDiagnosis
            }
          };
          const uiLang = req.query.uiLang === 'en' ? 'en' : (req.query.uiLang === 'ja' ? 'ja' : undefined);
          const measuredSample = summarizePostedMeasurements(
            allSortedPostedJobs,
            accountDiagnosis && accountDiagnosis.followers != null
              ? accountDiagnosis.followers
              : (userForGoal.officialFollowerCount ?? null)
          );
          trustGoal = {
            ...trustGoalStatus({
              ...(uiLang ? { ...userForGoal, uiLang } : userForGoal),
              recentAvgImpressions: measuredSample.avgImpressions ?? uData.recentAvgImpressions ?? null,
              recentMaxImpressions: measuredSample.maxImpressions ?? uData.recentMaxImpressions ?? null,
              recentBookmarkRate: measuredSample.bookmarkRate ?? uData.recentBookmarkRate ?? null
            }),
            recentAvgImpressions: measuredSample.avgImpressions ?? uData.recentAvgImpressions ?? null,
            recentMaxImpressions: measuredSample.maxImpressions ?? uData.recentMaxImpressions ?? null
          };
          const zone = uData.scheduleTimeZone || uData.timezone || 'Asia/Tokyo';
          let today = '';
          try { today = localDateKey(new Date(), zone); } catch (zoneErr) { today = localDateKey(new Date(), 'Asia/Tokyo'); }
          const sameDay = uData.ensureNextPostFailureDate === today;
          nextPostState = {
            retryLimitReached: sameDay && Number(uData.ensureNextPostFailures || 0) >= 3,
            failuresToday: sameDay ? Number(uData.ensureNextPostFailures || 0) : 0,
            lastError: uData.lastEnsureNextError || null,
            rejectReasons: Array.isArray(uData.lastEnsureNextRejectReasons) ? uData.lastEnsureNextRejectReasons : []
          };
          let coachingKnowledge = null;
          let sharedLexicon = null;
          try {
            coachingKnowledge = await getUserMarketingKnowledge(userId);
            sharedLexicon = await getSharedEditorialLexicon();
          } catch (_coachErr) {}
          const matureCount = allSortedPostedJobs.filter(job => job && job.metrics24hSnapshot && job.metrics24hSnapshot.isFrozen === true).length;
          const sample = measuredSample;
          operatingSummary = buildOperatingSummary(userForGoal, {
            uiLang: uiLang || 'ja',
            subscription: accountDiagnosis && (accountDiagnosis.subscriptionType || accountDiagnosis.subscription),
            searchVisible: accountDiagnosis && accountDiagnosis.searchVisible,
            recoveryMode: pendingJobs.some(job => job.recoveryMode === true),
            lastAction: pendingJobs[0] && pendingJobs[0].retargetAction,
            sample,
            matureCount,
            weights: computeGuidanceWeights({ matureCount, strategyLocked: userForGoal.strategyLockByUser === true }),
            domainLexicon: coachingKnowledge && coachingKnowledge.domainLexicon,
            dpoPairs: coachingKnowledge && coachingKnowledge.dpoPreferencePairs,
            sharedLexicon,
            nextJob: pendingJobs[0] || null
          });
        }
      } catch (_uErr) {}

      res.json({
        ok: true,
        jobs: sortedJobs,
        counts: {
          pending: pendingJobs.length,
          processing: processingJobs.length,
          failed: failedJobs.length,
          posted: totalPostedCount
        },
        hasMorePosted,
        hasMorePending,
        hasMoreFailed,
        nextCursor,
        accountDiagnosis,
        trustGoal,
        operatingSummary,
        nextPostState
      });
    } catch (err) {
      console.error('Get jobs error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 4. 最新のAI戦略レポート（Bio案、固定Post案、ディベート議事録）取得API
  // 🛡️ セッションCookieを必須化
  // ========================================================================
  app.get('/api/autopilot/strategy-report', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;

      const userObj = await resolveUserDoc(userId);
      if (!userObj) {
        return res.json({ ok: true, report: null });
      }
      const report = userObj.data.latestMarketingStrategy || null;
      res.json({ ok: true, report });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 4-B. 🏛️ 週次AI評議会 エグゼクティブ週報 取得 ＆ 再生成API
  // ========================================================================
  app.get('/api/autopilot/weekly-report', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const genRes = await generateWeeklyCouncilReport(userId, { persist: false });
      res.json({ ok: true, report: genRes.report });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/weekly-report/refresh', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const genRes = await generateWeeklyCouncilReport(userId);
      res.json({ ok: true, report: genRes.report });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 4-C. 🔄 X公式API 投稿実績メトリクス回収 ＆ ナレッジ自己進化API
  // ========================================================================
  app.post('/api/autopilot/sync-metrics', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const syncRes = await harvestTweetMetricsAndEvolveKnowledge(userId);
      res.json({ ok: true, ...syncRes });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 4-D. 💬 X Heavy Ranker 逆算ハック（リプ返自動会話成立エンジン / 重み150倍ブースター）
  // ========================================================================
  app.post('/api/autopilot/boost-conversations', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const { runOfficialAutonomousEngagement } = require('./official_api_client');
      const boostRes = await runOfficialAutonomousEngagement(userId);
      res.json({ ok: true, ...boostRes });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 5. アカウント診断API (過去1ヶ月分析)
  // 🛡️ セッションCookieを必須化し、本人の資格情報のみ参照
  // ========================================================================
  app.get('/api/autopilot/account-audit', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;

      const userObj = await resolveUserDoc(userId);
      if (!userObj || !userObj.data.xOfficialCredentials) {
        return res.json({ ok: false, hasCredentials: false, error: '公式APIキーが未連携です。Step 1で設定してください。' });
      }

      const creds = decryptCredentials(userObj.data.xOfficialCredentials);
      creds.saasUserId = userId;
      if (!/^\d+$/.test(String(creds.userId || '')) && userObj.data.twitterId) creds.userId = userObj.data.twitterId;
      const officialData = await getUserProfileAndRecentTweets(creds, 10);
      if (!officialData || !officialData.ok) {
        return res.json({ ok: false, error: officialData?.error || '本アカウントのAPI照会に失敗しました' });
      }

      res.json({
        ok: true,
        hasCredentials: true,
        user: officialData.user,
        recentTweets: officialData.tweets,
        tweetCount: officialData.tweets.length
      });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 6. ナレッジ同期 & 集合知更新
  // 🛡️ セッションCookieを必須化
  // ========================================================================
  app.post('/api/autopilot/sync-knowledge', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const evolved = await harvestAndEvolveCollectiveKnowledge(userId);
      res.json({ ok: true, evolved });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 7. AI評議会による戦略再合議・動的アジャスト
  // 🛡️ セッションCookieからユーザー特定
  // ========================================================================
  app.post('/api/autopilot/re-deliberate', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const { userPrompt } = req.body || {};
      if (userPrompt != null && typeof userPrompt !== 'string') {
        return res.status(400).json({ ok: false, error: '再検討の指示は文字列で指定してください。' });
      }

      if (typeof userPrompt === 'string' && userPrompt.trim()) {
        await db.collection('saas_users').doc(userId).set({
          userPrompt: userPrompt.trim(),
          updatedAt: new Date()
        }, { merge: true });
      }
      const result = await prepareNextPost(userId, { lang: (req.body || {}).lang || 'ja' });
      res.json({ ok: true, updatedJobsCount: 1, ...result });
    } catch (err) {
      console.error('Re-deliberate error:', err.message);
      if (err.code === 'redeliberation_conflict') {
        return res.status(409).json({ ok: false, code: err.code, error: err.message });
      }
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 8. 個別ジョブの再考・ブラッシュアップ
  // 🛡️ 所有権検証
  // ========================================================================
  app.post('/api/autopilot/jobs/:jobId/re-think', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }

      const { jobId } = req.params;
      const { userPrompt, lang = 'ja' } = req.body || {};

      // ジョブ所有者確認
      const jobSnap = await db.collection('autopilot_jobs').doc(jobId).get();
      if (!jobSnap.exists) return res.status(404).json({ ok: false, error: 'ジョブが見つかりません' });
      if (jobSnap.data().userId !== sessionUser.userId && !sessionUser.isAdmin) {
        return res.status(403).json({ ok: false, error: 'このジョブを変更する権限がありません（所有者不一致）。' });
      }

      const result = await reThinkSingleJob(jobId, { userPrompt, lang });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('Re-think job error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 9. AI合議制評議会コアAPI
  // 🛡️ セッションCookieを必須化し、契約（引数）を完全一致化
  // ========================================================================
  app.get('/api/autopilot/council/knowledge', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const knowledge = await getUserMarketingKnowledge(userId);
      res.json({ ok: true, knowledge });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/council/deliberate', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const { targetUrl, userPrompt, slot, plan = 'pro', campaignTimeZone } = req.body || {};
      const userSnap = await db.collection('saas_users').doc(userId).get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const workspaceTimeZone = userData.scheduleTimeZone || userData.timezone || 'Asia/Tokyo';
      const scheduleTimeZone = String(campaignTimeZone || workspaceTimeZone).trim();
      if (!isValidTimeZone(scheduleTimeZone)) {
        return res.status(400).json({ ok: false, error: '有効なIANAタイムゾーンを指定してください。' });
      }
      const result = await deliberateNextPost({ userId, targetUrl, userPrompt, slot, plan, scheduleTimeZone });
      res.json({ ok: true, result });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/autopilot/council/commit', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。' });
      }
      const userId = sessionUser.userId;
      const { deliberationId, deliberationResult, selectedPlan = 'planA', scheduledAt, overrideTweets } = req.body || {};
      const targetSessionId = deliberationId || (deliberationResult && (deliberationResult.sessionId || deliberationResult.deliberationId));
      if (!targetSessionId) {
        return res.status(400).json({ ok: false, error: 'deliberationId が指定されていません。' });
      }

      // 手動指定 overrideTweets の入力バリデーション
      let safeOverrideTweets = null;
      if (overrideTweets !== undefined && overrideTweets !== null) {
        if (!Array.isArray(overrideTweets)) {
          return res.status(400).json({ ok: false, error: 'overrideTweets は配列形式で指定してください。' });
        }
        safeOverrideTweets = overrideTweets
          .map(t => String(t || '').trim())
          .filter(t => t.length > 0);
        if (safeOverrideTweets.length === 0) {
          return res.status(400).json({ ok: false, error: 'overrideTweets に有効な投稿文が含まれていません。' });
        }
      }

      const schedDate = scheduledAt ? new Date(scheduledAt) : null;
      const job = await commitDeliberationToSchedule({
        userId,
        deliberationId: targetSessionId,
        selectedPlan,
        overrideScheduledAt: schedDate,
        overrideTweets: safeOverrideTweets
      });
      res.json({ ok: true, job });
    } catch (err) {
      if (err.code === 'council_forbidden') {
        return res.status(403).json({ ok: false, code: err.code, error: err.message });
      }
      if (err.code === 'council_conflict' || err.code === 'council_already_approved') {
        return res.status(409).json({ ok: false, code: err.code, error: err.message });
      }
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 10. サテライト応援キャンペーン一覧 & プール統計
  // ========================================================================
  app.get('/api/hybrid/campaigns', async (req, res) => {
    try {
      const snap = await db.collection('boost_campaigns').orderBy('createdAt', 'desc').limit(20).get();
      const campaigns = [];
      snap.forEach(d => campaigns.push({ id: d.id, ...d.data() }));
      res.json({ ok: true, campaigns });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.get('/api/hybrid/pool-stats', async (req, res) => {
    try {
      const usersSnap = await db.collection('saas_users').get();
      const campSnap = await db.collection('boost_campaigns').where('status', '==', 'active').get();
      res.json({
        ok: true,
        stats: {
          totalSubscribers: usersSnap.size,
          activeCampaigns: campSnap.size,
          activeNodes: usersSnap.size * 5 + 25,
          totalAssistedPosts: campSnap.size * 18 + 120
        }
      });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ========================================================================
  // 11. アカウント診断実行API
  // 🛡️ 認証済みユーザーのみ自社APIキー使用を許可（他人のAPIキー横取りを防止）
  // ========================================================================
  app.post('/api/account/diagnose', async (req, res) => {
    try {
      const sessionUser = await resolveSessionUser(db, req);
      if (!sessionUser || !sessionUser.userId) {
        return res.status(401).json({ ok: false, error: 'ログインセッションが無効です。先にログインしてください。' });
      }
      let { username, useApi, lang } = req.body || {};
      username = String(username || '').trim().replace(/^@/, '');

      // ユーザーIDは必ずサーバー側セッションから確定（クライアントからの偽装・なりすましを完全排除）
      const effectiveUserId = sessionUser.userId;

      let hasApi = false;
      let connectedHandle = '';
      let userAiTargetLang = 'ja';

      if (effectiveUserId) {
        const uDoc = await db.collection('saas_users').doc(effectiveUserId).get();
        if (uDoc.exists) {
          const uData = uDoc.data();
          userAiTargetLang = uData.aiTargetLang || 'ja';
          if ((uData.officialApiKey && uData.officialAccessToken) || uData.xOfficialCredentials) {
            hasApi = true;
            connectedHandle = uData.xUsername || uData.screenName || '';
          }
        }
      }

      const isEn = (lang === 'en') || (userAiTargetLang === 'en');
      const targetHandle = username || connectedHandle || 'b2b_growth';
      const isConnectedAccount = Boolean(hasApi && (!username || (connectedHandle && username.toLowerCase() === connectedHandle.toLowerCase())));

      const diagnosis = await runCouncilAccountAudit({
        handle: targetHandle,
        hasApi: isConnectedAccount,
        userId: effectiveUserId,
        isEn
      });

      // 英語モード時はすべてのテキストプロパティを英語で統一し、言語不一致を完全撲滅
      if (isEn && diagnosis && diagnosis.council) {
        for (const [k, auditor] of Object.entries(diagnosis.council)) {
          if (auditor.comment_en) auditor.comment = auditor.comment_en;
          if (auditor.verdict_en) auditor.verdict = auditor.verdict_en;
          if (auditor.name_en) auditor.name = auditor.name_en;
          if (auditor.role_en) auditor.role = auditor.role_en;
        }
        if (diagnosis.actionPrescription && Array.isArray(diagnosis.actionPrescription)) {
          for (const item of diagnosis.actionPrescription) {
            if (item.title_en) item.title = item.title_en;
            if (item.desc_en) item.desc = item.desc_en;
          }
        }
      }
      diagnosis.lang = isEn ? 'en' : 'ja';

      res.json({
        ok: true,
        handle: targetHandle,
        hasApi: Boolean(hasApi && useApi),
        ...diagnosis
      });
    } catch (err) {
      console.error('Account diagnosis error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  app.get('/hybrid-console', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X Autopilot AI - URLを入れるだけで市場リサーチから拡散まで全自動</title>
  <style>
    :root {
      --bg: #090d16; --card: #131b2e; --border: #1e2942;
      --primary: #3b82f6; --accent: #10b981; --gold: #f59e0b;
      --text: #f8fafc; --text-sub: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; }
    .container { max-width: 960px; margin: 0 auto; }
    .hero { text-align: center; margin-bottom: 28px; padding: 24px 16px; background: radial-gradient(circle at top, rgba(59,130,246,0.15), transparent 70%); border-radius: 16px; border: 1px solid var(--border); }
    .hero h1 { font-size: 26px; font-weight: 800; color: #fff; margin-bottom: 8px; letter-spacing: -0.5px; }
    .hero p { color: var(--text-sub); font-size: 14px; max-width: 600px; margin: 0 auto; }
    .badge { display: inline-block; background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid #10b981; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    .step-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 22px; margin-bottom: 20px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
    .step-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .step-num { width: 28px; height: 28px; background: var(--primary); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
    .step-title { font-size: 16px; font-weight: 700; color: #fff; }
    label { display: block; font-size: 13px; color: var(--text-sub); margin-bottom: 6px; font-weight: 500; }
    input, textarea, select { width: 100%; background: #0a0f1d; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; color: #fff; font-size: 14px; margin-bottom: 14px; outline: none; transition: 0.2s; }
    input:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(59,130,246,0.25); }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media(max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
    
    /* 料金プランの選択カード */
    .plans-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 16px; }
    @media(max-width: 680px) { .plans-grid { grid-template-columns: 1fr; } }
    .plan-box { background: #0c1322; border: 2px solid var(--border); border-radius: 10px; padding: 16px; cursor: pointer; transition: 0.2s; text-align: center; position: relative; }
    .plan-box:hover { border-color: #3b82f6; }
    .plan-box.selected { border-color: var(--accent); background: rgba(16,185,129,0.06); }
    .plan-box .popular { position: absolute; top: -10px; right: 12px; background: var(--gold); color: #000; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; }
    .plan-name { font-size: 14px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px; }
    .plan-price { font-size: 20px; font-weight: 800; color: #fff; margin-bottom: 8px; }
    .plan-desc { font-size: 11px; color: var(--text-sub); line-height: 1.4; }

    button.btn-main { background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; border-radius: 10px; padding: 16px; font-size: 16px; font-weight: 800; cursor: pointer; width: 100%; transition: 0.2s; box-shadow: 0 4px 20px rgba(16,185,129,0.3); }
    button.btn-main:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(16,185,129,0.4); }
    .status-msg { margin-top: 14px; font-size: 13px; padding: 12px; border-radius: 8px; display: none; line-height: 1.5; }
    .status-msg.ok { background: rgba(16,185,129,0.15); border: 1px solid #10b981; color: #34d399; }
    .status-msg.err { background: rgba(239,68,68,0.15); border: 1px solid #ef4444; color: #f87171; }
    .job-item { background: #0a0f1d; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    .plan-pay-btn { display: inline-block; margin-top: 12px; padding: 8px 14px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; color: #fff; font-size: 12px; font-weight: 700; text-align: center; text-decoration: none; transition: 0.2s; width: 100%; }
    .plan-pay-btn:hover { background: rgba(59, 130, 246, 0.25); border-color: #38bdf8; color: #38bdf8; }
    .plan-pay-btn.primary { background: #2563eb; border-color: #3b82f6; color: #fff; box-shadow: 0 2px 10px rgba(37,99,235,0.3); }
    .plan-pay-btn.primary:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <div class="badge">🚀 運用完全自動化 & 初速ブースト搭載</div>
      <h1>URLを入れるだけで、AIが市場リサーチから拡散まで全自動</h1>
      <p>あなたがやることは「宣伝URL」を入力するだけ。裏側でAIが競合・市場をリサーチし、売れる文章を作成して公式APIから自動投稿。さらにデータベースのサテライト軍団が自然に応援・拡散します。</p>
    </div>

    <!-- ステップ1: 本アカウント公式API設定 -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-num">1</div>
        <div class="step-title">本アカウント 公式APIキーの接続（初回1回のみ）</div>
      </div>
      <p style="font-size:12px;color:var(--text-sub);margin-bottom:12px;">公式APIのキーは暗号化して保存します。アカウント制限をなくすものではありません。</p>
      
      <div class="grid-2">
        <div>
          <label>API Key</label>
          <input type="text" id="inpApiKey" placeholder="API Key">
        </div>
        <div>
          <label>API Key Secret</label>
          <input type="password" id="inpApiSecret" placeholder="API Key Secret">
        </div>
        <div>
          <label>Access Token</label>
          <input type="text" id="inpAccessToken" placeholder="Access Token">
        </div>
        <div>
          <label>Access Token Secret</label>
          <input type="password" id="inpAccessTokenSecret" placeholder="Access Token Secret">
        </div>
      </div>

      <button onclick="verifyKeys()" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;">
        🛡️ 公式APIキーを認証して接続
      </button>
      <div id="keyMsg" class="status-msg"></div>
    </div>

    <!-- ステップ2 & 3: 宣伝URL ＆ プラン選択 -->
    <div class="step-card">
      <div class="step-header">
        <div class="step-num">2</div>
        <div class="step-title">宣伝・集客したいURLを入力</div>
      </div>
      <label>対象のWebページURL (自社LP、Brain、Tips、ブログ、ショップ等)</label>
      <input type="url" id="inpTargetUrl" placeholder="https://your-service-lp.com/product" style="font-size:15px;border-color:#38bdf8;">

      <div class="step-header" style="margin-top:20px;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="step-num" style="background:#10b981;">3</div>
          <div class="step-title">マーケティング強度（プラン）を選択</div>
        </div>
        <div style="display:flex;gap:6px;background:rgba(255,255,255,0.06);padding:3px;border-radius:8px;">
          <button id="btnCurJpy" onclick="switchCurrency('jpy')" style="background:#3b82f6;color:#fff;border:none;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">🇯🇵 JPY (日本円)</button>
          <button id="btnCurUsd" onclick="switchCurrency('usd')" style="background:transparent;color:#94a3b8;border:none;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">🇺🇸 USD (米ドル)</button>
        </div>
      </div>

      <div class="plans-grid">
        <div class="plan-box" id="planBox_starter" onclick="selectPlan('starter', this)">
          <div class="plan-name">🥉 スターター</div>
          <div class="plan-price" id="price_starter">¥4,980<span style="font-size:12px;color:var(--text-sub);">/月</span></div>
          <div class="plan-desc">1日1投稿 (月30本)<br>サテライト応援 5台</div>
          <a id="btnPay_starter" href="https://wise.com/pay/r/kXYnWl-m6k8WVOY" target="_blank" onclick="handlePayClick('starter', event)" class="plan-pay-btn">
            💳 ¥4,980 で決済 ↗
          </a>
        </div>

        <div class="plan-box selected" id="planBox_pro" onclick="selectPlan('pro', this)">
          <div class="popular">一番人気 ★</div>
          <div class="plan-name" style="color:#60a5fa;">🥈 プロ運用</div>
          <div class="plan-price" id="price_pro" style="color:#38bdf8;">¥9,800<span style="font-size:12px;color:var(--text-sub);">/月</span></div>
          <div class="plan-desc">1日3投稿 (朝昼夜)<br>サテライト応援 12台 + 引用RT</div>
          <a id="btnPay_pro" href="https://wise.com/pay/r/V_tnc7azl63ng3w" target="_blank" onclick="handlePayClick('pro', event)" class="plan-pay-btn primary">
            💳 ¥9,800 で決済 ↗
          </a>
        </div>

        <div class="plan-box" id="planBox_business" onclick="selectPlan('business', this)">
          <div class="plan-name">🥇 ビジネス</div>
          <div class="plan-price" id="price_business">¥19,800<span style="font-size:12px;color:var(--text-sub);">/月</span></div>
          <div class="plan-desc">1日5投稿 (月150本)<br>強力サテライト 25台 + リプ営業</div>
          <a id="btnPay_business" href="https://wise.com/pay/r/HEO5qptIIPhwhVQ" target="_blank" onclick="handlePayClick('business', event)" class="plan-pay-btn">
            💳 ¥19,800 で決済 ↗
          </a>
        </div>
      </div>

      <!-- 決済案内ボックス (リアルタイム連動) -->
      <div id="checkoutBox" style="margin-top:14px;padding:12px 16px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.3);border-radius:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <div id="selectedPlanLabel" style="font-size:13px;font-weight:700;color:#93c5fd;">現在選択中: 🥈 プロ運用プラン (¥9,800 / 月)</div>
          <div style="font-size:12px;color:#cbd5e1;margin-top:2px;">💳 クレジットカード・デビットカード・銀行振込（Wise公式）対応。入金は即時自動検知されます。</div>
        </div>
        <a id="btnPayDirect" href="https://wise.com/pay/r/V_tnc7azl63ng3w" target="_blank" onclick="handlePayClick(currentPlan, event)" style="background:#2563eb;color:#fff;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;text-decoration:none;display:inline-block;box-shadow:0 2px 8px rgba(37,99,235,0.4);">
          💳 選択中のプランを決済する ↗
        </a>
      </div>
      <div id="checkoutStatus" class="status-msg"></div>

      <button class="btn-main" onclick="launchAutopilot()" style="margin-top:16px;">
        🤖 AI自律マーケティング ＆ シンジケート初速加速を開始する
      </button>
      <div id="launchMsg" class="status-msg"></div>
    </div>

    <!-- 稼働中のスケジュールジョブ -->
    <div class="step-card">
      <div class="step-header" style="justify-content:space-between;">
        <div class="step-title">📅 AIが自動作成した投稿スケジュール</div>
        <button onclick="loadJobs()" style="background:transparent;border:1px solid var(--border);color:var(--text-sub);padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;">最新に更新</button>
      </div>
      <div id="jobsContainer">
        <p style="color:var(--text-sub);font-size:13px;">まだ自律投稿がスケジュールされていません。</p>
      </div>
    </div>
  </div>

  <script>
    let currentPlan = 'pro';
    let currentCurrency = 'jpy';
    let pollOrderTimer = null;

    const WISE_LINKS = {
      jpy: {
        starter: 'https://wise.com/pay/r/kXYnWl-m6k8WVOY',
        pro: 'https://wise.com/pay/r/V_tnc7azl63ng3w',
        business: 'https://wise.com/pay/r/HEO5qptIIPhwhVQ'
      },
      usd: {
        starter: 'https://wise.com/pay/r/1OUW9iJBEMfwiN4',
        pro: 'https://wise.com/pay/r/WQRO5dMpUa7145g',
        business: 'https://wise.com/pay/r/h1yv3kXIvvcbh08'
      }
    };

    const PLAN_NAMES = {
      starter: '🥉 スタータープラン',
      pro: '🥈 プロ運用プラン',
      business: '🥇 ビジネスプラン'
    };

    const PLAN_PRICES = {
      jpy: { starter: '¥4,980', pro: '¥9,800', business: '¥19,800' },
      usd: { starter: '$39', pro: '$79', business: '$179' }
    };

    function selectPlan(p, el) {
      currentPlan = p;
      document.querySelectorAll('.plan-box').forEach(b => b.classList.remove('selected'));
      document.querySelectorAll('.plan-pay-btn').forEach(b => b.classList.remove('primary'));
      
      const box = document.getElementById('planBox_' + p);
      if (box) box.classList.add('selected');
      const btn = document.getElementById('btnPay_' + p);
      if (btn) btn.classList.add('primary');

      updateBottomPayBar();
    }

    function updateBottomPayBar() {
      const url = WISE_LINKS[currentCurrency]?.[currentPlan] || WISE_LINKS.jpy.pro;
      const price = PLAN_PRICES[currentCurrency]?.[currentPlan] || '¥9,800';
      const label = document.getElementById('selectedPlanLabel');
      const directBtn = document.getElementById('btnPayDirect');
      
      if (label) {
        label.innerText = '現在選択中: ' + PLAN_NAMES[currentPlan] + ' (' + price + ' / 月)';
      }
      if (directBtn) {
        directBtn.href = url;
        directBtn.innerText = '💳 ' + price + ' で決済する (Wise公式) ↗';
      }
    }

    function switchCurrency(cur) {
      currentCurrency = cur;
      const btnJpy = document.getElementById('btnCurJpy');
      const btnUsd = document.getElementById('btnCurUsd');
      if (cur === 'jpy') {
        btnJpy.style.background = '#3b82f6';
        btnJpy.style.color = '#fff';
        btnUsd.style.background = 'transparent';
        btnUsd.style.color = '#94a3b8';
      } else {
        btnUsd.style.background = '#3b82f6';
        btnUsd.style.color = '#fff';
        btnJpy.style.background = 'transparent';
        btnJpy.style.color = '#94a3b8';
      }

      ['starter', 'pro', 'business'].forEach(p => {
        const pr = PLAN_PRICES[cur][p];
        const unit = cur === 'jpy' ? '/月' : '/mo';
        const priceEl = document.getElementById('price_' + p);
        if (priceEl) priceEl.innerHTML = pr + '<span style="font-size:12px;color:var(--text-sub);">' + unit + '</span>';
        const b = document.getElementById('btnPay_' + p);
        if (b) {
          b.href = WISE_LINKS[cur][p];
          b.innerText = '💳 ' + pr + ' で決済 ↗';
        }
      });

      updateBottomPayBar();
    }

    function handlePayClick(p, e) {
      // 決済ボタンを押した瞬間に、裏で自動監視を開始
      fetch('/api/hybrid/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: p, currency: currentCurrency })
      }).then(r => r.json()).then(j => {
        if (j.ok && j.orderId) {
          const msg = document.getElementById('checkoutStatus');
          msg.style.display = 'block';
          msg.className = 'status-msg ok';
          msg.innerHTML = '⏳ <b>Wise決済ページを開きました (照合ID: ' + j.wiseRef + ')</b><br><small style="color:#cbd5e1;">決済完了後、約10〜20秒で自動的にアカウント枠が解放されます...</small>';
          
          if (pollOrderTimer) clearInterval(pollOrderTimer);
          pollOrderTimer = setInterval(async () => {
            try {
              const chk = await fetch('/api/hybrid/check-order?orderId=' + encodeURIComponent(j.orderId));
              const res = await chk.json();
              if (res.paid) {
                clearInterval(pollOrderTimer);
                msg.className = 'status-msg ok';
                msg.innerHTML = '🎉 <b>入金が確認されました！' + PLAN_NAMES[p] + ' が即時有効化されました！</b>';
              }
            } catch (err) {}
          }, 8000);
        }
      }).catch(() => {});
    }

    async function verifyKeys() {
      const msg = document.getElementById('keyMsg');
      msg.style.display = 'block';
      msg.className = 'status-msg';
      msg.innerText = '⏳ 公式APIキーを検証中...';

      const body = {
        apiKey: document.getElementById('inpApiKey').value,
        apiSecret: document.getElementById('inpApiSecret').value,
        accessToken: document.getElementById('inpAccessToken').value,
        accessTokenSecret: document.getElementById('inpAccessTokenSecret').value
      };

      try {
        const res = await fetch('/api/hybrid/verify-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = await res.json();
        if (j.ok) {
          msg.className = 'status-msg ok';
          msg.innerHTML = j.message;
        } else {
          msg.className = 'status-msg err';
          msg.innerText = '❌ ' + j.error;
        }
      } catch (e) {
        msg.className = 'status-msg err';
        msg.innerText = '❌ 通信エラー: ' + e.message;
      }
    }

    async function launchAutopilot() {
      const msg = document.getElementById('launchMsg');
      msg.style.display = 'block';
      msg.className = 'status-msg';
      msg.innerHTML = '🔍 <b>AIがURL先をスクレイピングし、市場・ペルソナ分析中...</b> (約10〜15秒かかります)';

      const body = {
        targetUrl: document.getElementById('inpTargetUrl').value,
        plan: currentPlan
      };

      try {
        const res = await fetch('/api/autopilot/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = await res.json();
        if (j.ok) {
          msg.className = 'status-msg ok';
          msg.innerHTML = j.message + '<br><small style="color:#cbd5e1;">🎯 分析対象: ' + (j.marketAnalysis ? j.marketAnalysis.serviceName : '') + ' / ターゲット: ' + (j.marketAnalysis ? j.marketAnalysis.targetAudience : '') + '</small>';
          loadJobs();
        } else {
          msg.className = 'status-msg err';
          msg.innerText = '❌ ' + j.error;
        }
      } catch (e) {
        msg.className = 'status-msg err';
        msg.innerText = '❌ ' + e.message;
      }
    }

    function getFormatBadge(fmt, isThread, threadLen) {
      if (fmt === 'multi_thread_story' || (isThread && threadLen >= 3)) {
        return '<span style="background:rgba(168,85,247,0.2);color:#c084fc;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;">🧵 ' + (threadLen || '3-4') + '段スレッド</span>';
      }
      if (fmt === 'two_tier_reply_link' || (isThread && threadLen === 2)) {
        return '<span style="background:rgba(59,130,246,0.2);color:#60a5fa;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;">💬 2段リプ誘導</span>';
      }
      if (fmt === 'single_empathy') {
        return '<span style="background:rgba(245,158,11,0.2);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;">☕ 単発共感</span>';
      }
      return '<span style="background:rgba(16,185,129,0.2);color:#34d399;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;">📌 単発ノウハウ</span>';
    }

    async function loadJobs() {
      const cont = document.getElementById('jobsContainer');
      try {
        const res = await fetch('/api/autopilot/jobs');
        const j = await res.json();
        if (j.ok && Array.isArray(j.jobs) && j.jobs.length > 0) {
          let html = '';
          j.jobs.forEach((job, idx) => {
            const isDone = job.status === 'posted';
            const timeZone = job.scheduleTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const dateStr = job.scheduledAt
              ? new Date(job.scheduledAt._seconds ? job.scheduledAt._seconds * 1000 : job.scheduledAt).toLocaleString('ja-JP', { timeZone }) + ' (' + timeZone + ')'
              : '';
            const tweets = Array.isArray(job.tweets) && job.tweets.length > 0 ? job.tweets : [job.text || ''];
            const badge = getFormatBadge(job.format, job.isThread, tweets.length);

            let tweetHtml = '<div style="font-size:13px;color:#e2e8f0;line-height:1.4;white-space:pre-wrap;">' + tweets[0] + '</div>';
            if (tweets.length > 1) {
              tweetHtml += '<details style="margin-top:8px;font-size:12px;color:#94a3b8;cursor:pointer;">' +
                '<summary style="color:#38bdf8;font-weight:600;">▼ 連動ツリーを表示（全' + tweets.length + '件）</summary>' +
                '<div style="margin-top:6px;padding-left:10px;border-left:2px solid #38bdf8;">';
              for (let t = 1; t < tweets.length; t++) {
                tweetHtml += '<div style="margin-top:6px;color:#cbd5e1;white-space:pre-wrap;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:4px;"><b>(' + (t + 1) + '/' + tweets.length + ')</b> ' + tweets[t] + '</div>';
              }
              tweetHtml += '</div></details>';
            }

            html += '<div class="job-item">' +
              '<div style="max-width:75%;">' +
                '<div style="display:flex;align-items:center;margin-bottom:6px;">' +
                  badge +
                  '<span style="font-size:12px;color:#94a3b8;font-weight:600;">[' + (job.angle || '自動最適化') + '] ' + dateStr + '</span>' +
                '</div>' +
                tweetHtml +
              '</div>' +
              '<div>' +
                (isDone
                  ? '<a href="' + job.tweetUrl + '" target="_blank" style="background:#059669;color:#fff;padding:4px 10px;border-radius:6px;font-size:12px;text-decoration:none;font-weight:600;">✅ 投稿済 ↗</a>'
                  : '<span style="background:rgba(255,255,255,0.08);color:#94a3b8;padding:4px 10px;border-radius:6px;font-size:12px;">⏳ 待機中</span>'
                ) +
              '</div>' +
            '</div>';
          });
          cont.innerHTML = html;
        }
      } catch (e) {}
    }

    loadJobs();
  </script>
</body>
</html>`);
  });
}

module.exports = {
  getScheduledPostContent,
  isJobDue,
  isFirestoreIndexError,
  loadRecentPostHistory,
  recoverStaleProcessingJobs,
  startAutopilotJobRunner,
  registerHybridSaasRoutes,
  visualCardUploadPlan
};
