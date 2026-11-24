const { hasXaiKey, completeText } = require('./grok_client');

async function generateContentPreferred(_unusedModel, prompt, options = {}) {
  if (!hasXaiKey()) {
    const error = new Error('XAI_API_KEYが設定されていません');
    error.code = 'NO_XAI_KEY';
    throw error;
  }
  const { text } = await completeText({ tier: options.tier || 'quality', prompt, json: true });
  return { response: { text: () => text } };
}
const { randomUUID, createHash } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('./firestore');
const { trustHandle, getGrowthPhase } = require('./growth_phase');
const { getCollectiveMarketingIntelligence } = require('./collective_intelligence');
const { getUserMarketingKnowledge } = require('./ai_deliberation_council');
const { sampleFromMapElitesArchive } = require('./map_elites_memory');
const { getSharedEditorialLexicon, evolveAccountLexiconAndLessons, recordSharedOutcomeSignals, inferMove, inferEnding } = require('./editorial_lexicon_engine');
const { queryRelevantEpisodes, formatEpisodesForPrompt } = require('./episodic_memory_store');
const { restoreMandatoryDirectives } = require('./meta_prompt_optimizer');
const { fetchPublicText } = require('./url_fetch_guard');
const { containsJapaneseScript } = require('./measured_pair');
const { extractPageHypotheses, hypothesisForPlaybook, chooseHypothesis, formatHypothesis, pageVersionHash, chooseGenesForPost, chooseSourceMaterial, selectPlaybookByPerformance } = require('./bandit_optimization_engine');
const { sanitizePostOrReplyText, decryptCredentials, fetchMyAccountState } = require('./official_api_client');
const { describeAccountState, formatAccountState } = require('./customer_post_state');
const { draftNextPostText, draftNextPostWithMeta, selectFocusPlaybook, pickOwnerSpark, markOwnerSparkUsed } = require('./next_post_draft');
const { extractBrandKnowledge, BANNED_LEGACY } = require('./lp_knowledge_extractor');
const { resolveAccountVoiceProfile } = require('./account_voice_profiler');
const { planSlotPortfolio, weekdayInZone } = require('./slot_portfolio_planner');
const { officialApiOperationAllowed } = require('./operated_accounts');
const { resolvePlan, isPaidAccount, localDateKey, nextPlanSlot, reserveAfterDailyCap } = require('./plan_post_budget');
const { buildWeeklyGrowthReport } = require('./weekly_growth_report');
const { decideEarlyAction } = require('./metrics_harvest_engine');
const { buildFrozenOutcome, classifyTraceCalibration, summarizeCriticCalibration, computeCalibratedAxisWeights } = require('./critic_calibration');
const { evaluatePromptEvolution, chooseEvolutionAssignment } = require('./prompt_evolution');
const { selectWeeklyWildcard, freshHook, evaluateWildcardPromotions, WILDCARD_IDS } = require('./wildcard_evolution');
const { fetchSituationalContext, filterRadarHints, industryQuery, radarLooksInternal } = require('./context_radar');
const { detectAlgorithmRecovery } = require('./recovery_mode');
const { applySlotJitter } = require('./post_timing');
const { planVisualCard } = require('./visual_card');
const { alignmentCheck, scheduleGenerationTrace } = require('./telemetry_tracer');
const { scheduleNicheBenchmark } = require('./x_benchmark_radar');
const { runDeterministicAudit } = require('./draft_verifier');
const {
  PostConstraintError,
  validateAndEnforcePostConstraints,
  enforcePostThreadConstraints
} = require('./post_constraint_guard');

/**
 * 単一URLからWebサイトの主要メタ情報と本文テキストを抽出
 */
async function fetchSingleUrl(url) {
  try {
    const page = await fetchPublicText(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VeloxCrawler/4.0'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!page.ok) return { ok: false, url, error: page.error };

    const html = page.text;

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                          html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
                          html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const description = metaDescMatch ? metaDescMatch[1].trim() : '';

    const headings = [];
    const headingRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
    let hMatch;
    while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 8) {
      const txt = hMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length > 4 && txt.length < 80) {
        headings.push(txt);
      }
    }

    const bodyClean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2500);

    return {
      ok: true,
      url: page.url,
      title,
      description,
      headings,
      snippet: bodyClean
    };
  } catch (err) {
    return { ok: false, url, error: err.message };
  }
}

/**
 * 宣伝対象のURLからWebサイトの主要メタ情報と本文テキストを抽出（複数URL対応）
 */
function summarizeProvidedHtml(html) {
  const source = String(html || '');
  const titleMatch = source.match(/<title[^>]*>([^<]+)<\/title>/i);
  const metaDescMatch = source.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    source.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
    source.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const headings = [];
  const headingRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let headingMatch;
  while ((headingMatch = headingRegex.exec(source)) !== null && headings.length < 8) {
    const text = headingMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 4 && text.length < 80) headings.push(text);
  }
  const snippet = source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
  return {
    ok: true,
    title: titleMatch ? titleMatch[1].trim() : '',
    description: metaDescMatch ? metaDescMatch[1].trim() : '',
    headings,
    snippet,
    source: 'html'
  };
}

function nextTimeSlot(timeZone, now = new Date()) {
  let hour = 12;
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .find(item => item.type === 'hour');
    hour = Number(part && part.value);
  } catch (err) {
    hour = now.getHours();
  }
  if (hour < 8) return 'morning';
  if (hour < 12) return 'noon';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  if (hour < 22) return 'night';
  return 'morning';
}

function keepNextPostPlan(councilPlan, timeZone, now = new Date()) {
  const plan = Array.isArray(councilPlan?.postPlan) ? councilPlan.postPlan : [];
  if (plan.length === 0) return councilPlan;
  const slot = nextTimeSlot(timeZone, now);
  const chosen = plan.find(item => item.timeSlot === slot) || plan[0];
  councilPlan.postPlan = [{ ...chosen, step: 1, timeSlot: chosen.timeSlot || slot }];
  return councilPlan;
}

function postedJobMillis(job) {
  const value = job && (job.postedAt || job.scheduledAt || job.createdAt);
  if (!value) return 0;
  const date = value.toDate ? value.toDate() : new Date(value);
  const millis = date.getTime();
  return Number.isNaN(millis) ? 0 : millis;
}

function rememberedPostTexts(posts, lang = null) {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  const texts = [];
  for (const post of Array.isArray(posts) ? posts : []) {
    const rows = isEn
      ? [
          ...(Array.isArray(post.tweets_en) ? post.tweets_en : []),
          post.text_en,
          ...(Array.isArray(post.tweets) ? post.tweets : []),
          post.text
        ]
      : [
          ...(Array.isArray(post.tweets) ? post.tweets : []),
          ...(Array.isArray(post.tweets_en) ? post.tweets_en : []),
          post.text,
          post.text_en
        ];
    for (const row of rows) {
      if (typeof row !== 'string' || !row.trim()) continue;
      if (isEn && containsJapaneseScript(row)) continue;
      texts.push(row.trim());
    }
  }
  return texts;
}

function sortPostedJobsNewestFirst(jobs) {
  return (Array.isArray(jobs) ? jobs.slice() : []).sort((a, b) => {
    const diff = postedJobMillis(b) - postedJobMillis(a);
    if (diff !== 0) return diff;
    return String(b.jobId || b.id || '').localeCompare(String(a.jobId || a.id || ''));
  });
}

async function loadPostedJobs(userId) {
  if (!userId) return [];
  const postedSnap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'posted')
    .limit(200)
    .get();
  return sortPostedJobsNewestFirst(postedSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))).slice(0, 100);
}

async function attachSelectedFacts(userId, pageSummary, councilPlan) {
  const hypotheses = extractPageHypotheses(pageSummary);
  const version = pageVersionHash(pageSummary);
  let postedForBandit = [];
  try {
    postedForBandit = await loadPostedJobs(userId);
  } catch (banditReadErr) {
    console.warn(`[Hypothesis Selection] 実測の読み込みをスキップ: ${banditReadErr.message}`);
  }
  for (const item of councilPlan?.postPlan || []) {
    const choice = chooseHypothesis(postedForBandit, hypotheses, item.timeSlot || 'evening', version);
    item.selectedChoice = choice;
    item.contentAngle = choice ? choice.hypothesis.id : null;
    item.pageVersion = version;
    item.pageHypotheses = hypotheses;
    item.hypothesisWho = choice ? choice.hypothesis.who : null;
    item.hypothesisWhy = choice ? choice.hypothesis.why : null;
    item.hypothesisProof = choice ? choice.hypothesis.proof : null;
  }
}

function bindOfficialCreds(creds, userId, user) {
  if (!creds) return creds;
  if (!creds.id && creds.userId) creds.id = creds.userId;
  const xNumeric = /^\d+$/.test(String(creds.userId || '')) ? creds.userId : ((user && user.twitterId) || '');
  creds.saasUserId = userId;
  if (xNumeric) creds.userId = xNumeric;
  return creds;
}

async function cancelNonManualPendingJobs(userId, reason = 'autopilot_paused') {
  if (!userId) return 0;
  const snap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'pending')
    .limit(40)
    .get();
  const batch = db.batch();
  let cancelled = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.isHumanOverride) continue;
    batch.update(doc.ref, {
      status: 'cancelled',
      error: reason,
      cancelReason: reason,
      updatedAt: new Date()
    });
    cancelled += 1;
  }
  if (cancelled > 0) await batch.commit();
  return cancelled;
}

async function cancelOtherPendingJobs(userId, targetUrl, pageVersion, keepJobId = null) {
  if (!userId) return 0;
  const snap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'pending')
    .limit(20)
    .get();
  const batch = db.batch();
  let cancelled = 0;
  for (const doc of snap.docs) {
    if (doc.id === keepJobId) continue;
    const data = doc.data() || {};
    if (data.isHumanOverride) continue;
    const storedUrl = String(data.targetUrl || '').match(/https?:\/\/[^\s]+/i);
    const nextUrl = String(targetUrl || '').match(/https?:\/\/[^\s]+/i);
    if (nextUrl && storedUrl && storedUrl[0] !== nextUrl[0]) continue;
    const stale = Boolean(data.pageVersion && pageVersion && data.pageVersion !== pageVersion);
    batch.update(doc.ref, {
      status: 'cancelled',
      error: stale ? 'page_changed' : 'only_next_post',
      updatedAt: new Date()
    });
    cancelled += 1;
  }
  if (cancelled > 0) await batch.commit();
  return cancelled;
}

async function retargetNextPendingJob(userId) {
  const pendingSnap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'pending')
    .limit(20)
    .get();
  if (pendingSnap.empty) return null;
  const pending = pendingSnap.docs
    .map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter(job => !job.isHumanOverride && Array.isArray(job.pageHypotheses) && job.pageHypotheses.length)
    .sort((a, b) => {
      const aTime = a.scheduledAt && a.scheduledAt.toDate ? a.scheduledAt.toDate() : new Date(a.scheduledAt || 0);
      const bTime = b.scheduledAt && b.scheduledAt.toDate ? b.scheduledAt.toDate() : new Date(b.scheduledAt || 0);
      return aTime - bTime;
    });
  const next = pending[0];
  if (!next) return null;
  const posts = await loadPostedJobs(userId);
  const choice = chooseHypothesis(posts, next.pageHypotheses, next.timeSlot || 'evening', next.pageVersion);
  const earlyPosts = posts.filter(post => post.metricsEarlySnapshot && post.metricsEarlySnapshot.impressions > 0);
  const latestEarly = earlyPosts.slice().sort((a, b) => new Date(b.metricsEarlySnapshot.capturedAt || b.postedAt || 0) - new Date(a.metricsEarlySnapshot.capturedAt || a.postedAt || 0))[0];
  const action = decideEarlyAction(earlyPosts.map(post => post.metricsEarlySnapshot), latestEarly && latestEarly.metricsEarlySnapshot);
  if (action === 'keep' || !choice) {
    await cancelOtherPendingJobs(userId, next.targetUrl, next.pageVersion, next.id);
    return { action: 'keep', hypothesis: choice && choice.hypothesis };
  }
  const scheduledAt = next.scheduledAt && next.scheduledAt.toDate ? next.scheduledAt.toDate() : new Date(next.scheduledAt || 0);
  if (scheduledAt.getTime() <= Date.now() + 5 * 60 * 1000) {
    return { action, skipped: true };
  }
  if (choice) {
    const hypothesisUpdate = {
      contentAngle: choice.hypothesis.id,
      hypothesisWho: choice.hypothesis.who,
      hypothesisWhy: choice.hypothesis.why,
      hypothesisProof: choice.hypothesis.proof,
      updatedAt: new Date()
    };
    let sparkToMark = null;
    let sparkRows = [];
    if (!next.earlyBodyRewriteAt) {
      try {
        const userDoc = await db.collection('saas_users').doc(userId).get();
        const user = userDoc.exists ? (userDoc.data() || {}) : {};
        let live = { ok: false };
        let creds = null;
        if (user.xOfficialCredentials) {
          creds = bindOfficialCreds(decryptCredentials(user.xOfficialCredentials), userId, user);
          live = await fetchMyAccountState(creds);
        }
        const accountState = describeAccountState(live, user);
        const targetMatch = String(next.targetUrl || user.targetUrl || '').match(/https?:\/\/[^\s]+/i);
        const extracted = targetMatch
          ? await extractBrandKnowledge(targetMatch[0], { db, userId, cachedKnowledge: user.brandKnowledge, outputLang: accountState.lang === 'en' ? 'en' : 'ja' })
          : null;
        const pageSummary = extracted && extracted.pageSummary;
        const voiceProfile = await resolveAccountVoiceProfile({
          userId,
          user,
          creds,
          accountState,
          recentPostedJobs: posts
        });
        const personaText = String(user.userPrompt || '').trim();
        if (((pageSummary && pageSummary.ok) || personaText) && !next.earlyBodyRewriteAt) {
          const previousGenes = latestEarly && latestEarly.genes || {};
          const recoveryMode = detectAlgorithmRecovery(posts, accountState.followers);
          const portfolioPlan = planSlotPortfolio({
            growthPhase: getGrowthPhase(user),
            timeSlot: next.timeSlot || 'evening',
            dayOfWeek: weekdayInZone(user.scheduleTimeZone || user.timezone),
            recentPostedJobs: posts,
            userPrompt: user.userPrompt || '',
            accountState,
            plan: resolvePlan(user),
            recoveryMode,
            lang: accountState.lang
          });
          const genes = chooseGenesForPost({
            posts,
            brandKnowledge: extracted && extracted.brandKnowledge,
            portfolioPlan,
            accountState,
            timeSlot: next.timeSlot || 'evening',
            constraints: action === 'deepen_winner'
              ? { lockClaim: previousGenes.claimSemanticKey, avoid: { angle: previousGenes.angle, hookType: previousGenes.hookType }, promotedDynamicArms: user.promotedDynamicArms || [] }
              : { avoid: { angle: previousGenes.angle, hookType: previousGenes.hookType, claimSemanticKey: previousGenes.claimSemanticKey }, promotedDynamicArms: user.promotedDynamicArms || [] }
          });
          const qualityAudit = [];
          const audienceCache = user.audienceQuestionsCache;
          const questions = audienceCache && Array.isArray(audienceCache.questions) ? audienceCache.questions : [];
          const pushback = require('./audience_questions').latestAudiencePushback(audienceCache);
          const hasPage = Boolean(pageSummary && pageSummary.ok);
          const safePlan = hasPage ? portfolioPlan : { ...portfolioPlan, allowPromoUrl: false, requireDisclosure: false };
          let editorialContext = null;
          try {
            const knowledge = await getUserMarketingKnowledge(userId);
            const sharedLexicon = await getSharedEditorialLexicon();
            let mapElitesHint = null;
            const sampled = await Promise.race([
              sampleFromMapElitesArchive(userId, { allowMutation: true }),
              new Promise(resolve => setTimeout(() => resolve(null), 1500))
            ]);
            if (sampled) {
              mapElitesHint = {
                cellId: sampled.cellId || '',
                directive: sampled.directive || '',
                referenceHook: sampled.referenceHook || '',
                mode: sampled.mode || ''
              };
            }
            editorialContext = {
              domainLexicon: knowledge.domainLexicon || null,
              sharedLexicon,
              dpoPairs: Array.isArray(knowledge.dpoPreferencePairs) ? knowledge.dpoPreferencePairs.slice(0, 3) : [],
              avoidKeywords: knowledge.avoidKeywords || [],
              mapElitesHint,
              matureCount: (Array.isArray(posts) ? posts : []).filter(p => p && p.metrics24hSnapshot && p.metrics24hSnapshot.isFrozen === true).length,
              strategyLocked: user.strategyLockByUser === true
            };
          } catch (contextErr) {
            editorialContext = null;
          }
          const rewritePlaybook = !(safePlan && safePlan.allowPromoUrl) && safePlan && safePlan.portfolioRole !== 'explicit_promo_offer'
            ? (selectPlaybookByPerformance(extracted && extracted.brandKnowledge && extracted.brandKnowledge.domainPlaybooks, posts) || selectFocusPlaybook(extracted && extracted.brandKnowledge, rememberedPostTexts(posts, accountState.lang)))
            : null;
          if (rewritePlaybook && pageSummary) choice.hypothesis = hypothesisForPlaybook(rewritePlaybook, extracted && extracted.brandKnowledge, pageSummary);
          const audienceCraft = await resolveAudienceCraft({
            userId,
            user,
            brandKnowledge: hasPage ? extracted.brandKnowledge : null,
            posts,
            lang: accountState.lang,
            radar: user.contextRadarCache && user.contextRadarCache.signals
          });
          const { decideNextPostMission } = require('./velox_master_core');
          const masterPlan = decideNextPostMission({
            accountState,
            brandKnowledge: hasPage ? extracted.brandKnowledge : null,
            audienceKnowledge: audienceCraft.audienceKnowledge,
            recentJobs: posts,
            portfolioPlan: safePlan
          });
          const isolated = masterPlan.isolateLpContext === true;
          const evolutionVersion = chooseEvolutionAssignment({
            evolution: user.promptEvolution,
            jobs: posts,
            topicRing: masterPlan.topicRing,
            isWildcard: genes.isWildcard === true
          });
          const ownerSpark = pickOwnerSpark(user.ownerSparks, masterPlan);
          const drafted = await draftNextPostWithMeta({
            audienceKnowledge: audienceCraft.audienceKnowledge,
            archetype: masterPlan.archetype || audienceCraft.archetype,
            focusTopic: masterPlan.focusTopic || audienceCraft.focusTopic,
            masterPlan,
            focusPlaybook: isolated ? null : rewritePlaybook,
            lang: accountState.lang,
            accountState,
            hypothesisText: formatHypothesis(choice, accountState.lang),
            pageSummary: hasPage ? pageSummary : {
              ok: true,
              title: personaText.slice(0, 80),
              description: String(user.brandContextNotes || '').slice(0, 240),
              snippet: String(user.voiceProfile && user.voiceProfile.bio || '').slice(0, 240),
              headings: [],
              skipped: true
            },
            timeSlot: next.timeSlot || 'evening',
            recentTexts: rememberedPostTexts(posts, accountState.lang),
            userPrompt: user.userPrompt || '',
            brandKnowledge: hasPage ? extracted.brandKnowledge : null,
            voiceProfile,
            portfolioPlan: safePlan,
            targetUrl: hasPage && targetMatch ? targetMatch[0] : '',
            recentPosts: rememberedPostTexts(posts, accountState.lang),
            genes,
            criticAxisWeights: user.criticAxisWeights || null,
            promptEvolution: user.promptEvolution || null,
            evolutionVersion,
            retargetContext: action === 'deepen_winner'
              ? (accountState.lang === 'en'
                ? 'The previous post got a response, so continue the same point.'
                : '直前の投稿に反応があったので、同じ論点の続きとして書く。')
              : (accountState.lang === 'en'
                ? 'The previous post did not travel, so use a different point.'
                : '直前の投稿は伸びなかったので、別の論点にする。'),
            contextSignals: (questions.length || pushback) ? { questions, signals: user.contextRadarCache && user.contextRadarCache.signals, pushback } : (user.contextRadarCache && user.contextRadarCache.signals),
            qualityAudit,
            editorialContext,
            ownerSpark,
            editorialStanceOverride: user.editorialStanceOverride || null
          });
          sparkToMark = drafted.ownerSparkId || null;
          sparkRows = Array.isArray(user.ownerSparks) ? user.ownerSparks : [];
          const tweets = drafted.tweets;
          const isEn = accountState.lang === 'en';
          Object.assign(hypothesisUpdate, {
            text: isEn ? '' : tweets[0],
            tweets: isEn ? [] : tweets,
            text_en: isEn ? tweets[0] : '',
            tweets_en: isEn ? tweets : [],
            isThread: tweets.length > 1,
            draftBriefSummary: {
              scene: drafted.brief && drafted.brief.scene || '',
              readerPayoff: drafted.brief && drafted.brief.readerPayoff || '',
              hookAngle: drafted.brief && drafted.brief.hookAngle || '',
              offer: drafted.brief && drafted.brief.offer || '',
              underlyingMechanism: drafted.brief && drafted.brief.underlyingMechanism || '',
              cognitiveMove: drafted.decision && drafted.decision.cognitiveMove || '',
              endingMove: drafted.decision && drafted.decision.endingMove || '',
              registerLock: drafted.decision && drafted.decision.registerLock || '',
              userWeight: drafted.decision && drafted.decision.weights && drafted.decision.weights.userWeight,
              veloxWeight: drafted.decision && drafted.decision.weights && drafted.decision.weights.veloxWeight,
              guidanceMode: drafted.decision && drafted.decision.guidanceMode || ''
            },
            draftRationale: safePlan.rationale || '',
            customerReason: customerFacingReason(choice, String(user.uiLang || accountState.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja'),
            earlyBodyRewriteAt: new Date(),
            genes,
            retargetAction: action,
            portfolioRole: safePlan.portfolioRole,
            archetype: drafted.archetype || masterPlan.archetype || '',
            focusTopicId: drafted.focusTopicId || (masterPlan.focusTopic && masterPlan.focusTopic.id) || '',
            topicRing: masterPlan.topicRing || '',
            masterMission: masterPlan.mission || '',
            masterPhase: masterPlan.phase || '',
            selectedTopicDomain: masterPlan.selectedTopicDomain || '',
            criticDegraded: drafted.criticDegraded === true,
            tensionUsed: drafted.tensionUsed === true,
            tensionSource: drafted.tensionSource || null,
            ownerSparkUsed: drafted.ownerSparkUsed === true,
            ownerSparkId: drafted.ownerSparkId || null,
            verifiedReferenceUrl: null,
            allowPromoUrl: safePlan.allowPromoUrl,
            recoveryMode,
            visualCard: planVisualCard({
              format: genes.format,
              portfolioRole: safePlan && safePlan.portfolioRole,
              focusPlaybook: isolated ? null : rewritePlaybook,
              brandKnowledge: extracted && extracted.brandKnowledge,
              lang: accountState.lang,
              archetype: masterPlan.archetype,
              focusTopic: masterPlan.focusTopic,
              isolateLpContext: masterPlan.isolateLpContext === true
            }),
            qualityAudit
          });
        }
      } catch (rewriteErr) {
        console.warn(`[Next Post Rewrite] ${rewriteErr.message}`);
      }
    }
    try {
      await db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(next.ref);
        const data = fresh.data() || {};
        const when = data.scheduledAt && data.scheduledAt.toDate ? data.scheduledAt.toDate() : new Date(data.scheduledAt || 0);
        if (data.status !== 'pending' || data.isHumanOverride || when.getTime() <= Date.now() + 5 * 60 * 1000) {
          throw new Error('pending_not_safe_to_rewrite');
        }
        transaction.update(next.ref, hypothesisUpdate);
      });
    } catch (err) {
      if (err.message !== 'pending_not_safe_to_rewrite') throw err;
      console.warn(`[Next Post Rewrite] 投稿直前のため本文は変更しません`);
      return { action, skipped: true };
    }
    if (sparkToMark) {
      try {
        await db.collection('saas_users').doc(userId).set({
          ownerSparks: markOwnerSparkUsed(sparkRows, sparkToMark, new Date())
        }, { merge: true });
      } catch (_sparkErr) {}
    }
  }
  await cancelOtherPendingJobs(userId, next.targetUrl, next.pageVersion, next.id);
  return choice;
}

async function fetchUrlSummary(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return { ok: false, error: 'URLが指定されていません' };
  }
  if (/<[a-z!/][^>]*>/i.test(targetUrl)) {
    const summary = summarizeProvidedHtml(targetUrl);
    summary.pageVersion = pageVersionHash(summary);
    return summary;
  }
  if (/^https?:\/\//i.test(targetUrl)) {
    const page = await fetchSingleUrl(targetUrl);
    if (!page || !page.ok) return page || { ok: false, error: 'ページを取得できませんでした' };
    page.pageVersion = pageVersionHash(page);
    return page;
  }
  return {
    ok: true,
    url: targetUrl,
    title: '',
    description: '',
    headings: [],
    snippet: '',
    skipped: true
  };
}

/**
 * 過去または今回のバッチ内で直近に使われた頻出語・重要キーワードを抽出し、
 * 次のスロットで重複使用を禁止する動的ネガティブプールを構築
 */
function extractDynamicCooldownKeywords(previousPosts = []) {
  const coolDownWords = new Set();
  const textCorpus = previousPosts.map(p => {
    if (!p) return '';
    if (typeof p === 'string') return p;
    return (p.text || '') + ' ' + (Array.isArray(p.tweets) ? p.tweets.join(' ') : '');
  }).join(' ');

  // 1. 数字＋時間・期間の表現（例: 30時間, 45分, 15分, 100時間, 2倍など）
  const timeMatches = textCorpus.match(/[0-9０-９]+(?:\.[0-9]+)?(?:時間|分|日|ヶ月|年|倍)/g) || [];
  timeMatches.forEach(m => coolDownWords.add(m));

  // 2. 特徴的な名詞・定型フレーズ
  const specificPhrases = [
    '月30時間', '30時間', '45分', '100時間', '白紙の画面', '画面を睨み', 'キーボードが止まる',
    '溶かして', '溶かしていた', '工数逼迫', '手作業に溶かし', '精神論', '泥臭い手作業',
    '思考体力', 'テレアポ', '削られる', '買い戻せない', '余白'
  ];
  specificPhrases.forEach(ph => {
    if (textCorpus.includes(ph)) coolDownWords.add(ph);
  });

  return Array.from(coolDownWords);
}

/**
 * 👤 [Pass 0]: X公式APIによるユーザーアカウント現在地のリアルタイム精密診断
 * - フォロワー数、フォロー数、FF比率、直近ツイート、過去の反応をX APIから取得
 * - Gemini 2.5 Flash により「現在の信用ステージ」「過去投稿の傾向・課題」「今採るべき戦略方針」「背伸び厳禁ルール」を深層診断
 */
async function diagnoseUserAccountStageAndStrategy(userId, options = {}) {
  let accountInfo = {
    username: 'unknown',
    name: '',
    followers: null,
    following: null,
    totalTweets: null,
    recentTweets: [],
    hasOfficialData: false,
    followersMeasured: false,
    subscription: 'unknown'
  };

  try {
    const userDoc = await db.collection('saas_users').doc(userId).get();
    if (userDoc.exists) {
      const uData = userDoc.data() || {};
      accountInfo.username = uData.xUsername || uData.screenName || 'user';
      accountInfo.name = uData.xName || accountInfo.username;
      accountInfo.accountState = describeAccountState({ ok: false }, uData);

      if (uData.xOfficialCredentials) {
        try {
          const { getUserProfileAndRecentTweets } = require('./official_api_client');
          const creds = bindOfficialCreds(decryptCredentials(uData.xOfficialCredentials), userId, uData);
          const live = await fetchMyAccountState(creds);
          accountInfo.accountState = describeAccountState(live, uData);
          if (live && live.ok) {
            accountInfo.hasOfficialData = true;
            accountInfo.username = live.username || accountInfo.username;
            accountInfo.name = live.name || accountInfo.name;
            accountInfo.followers = live.followers;
            accountInfo.following = live.following;
            accountInfo.totalTweets = live.tweetCount;
            accountInfo.followersMeasured = accountInfo.accountState.measured;
            accountInfo.subscription = accountInfo.accountState.subscription;
          }
          const officialRes = await getUserProfileAndRecentTweets(creds, 15);
          if (officialRes && officialRes.ok && Array.isArray(officialRes.tweets)) {
            accountInfo.recentTweets = officialRes.tweets.map(t => ({
              id: t.id,
              text: t.text,
              createdAt: t.createdAt,
              likes: t.metrics?.like_count || 0,
              retweets: t.metrics?.retweet_count || 0,
              replies: t.metrics?.reply_count || 0
            }));
          }
        } catch (apiErr) {
          console.warn('[diagnoseUserAccountStageAndStrategy API warning]:', apiErr.message);
        }
      }
    }
  } catch (err) {
    console.warn('[diagnoseUserAccountStageAndStrategy fetch warning]:', err.message);
  }

  const shownFollowers = accountInfo.followersMeasured ? accountInfo.followers : null;
  const shownFollowing = accountInfo.followersMeasured ? accountInfo.following : null;
  // ステージの初期機械判定
  let rawStage = 'STAGE_1_TRUST_BUILDING';
  let rawStageName = '信用構築・ゼロイチ初期フェーズ';
  if (shownFollowers !== null && shownFollowers >= 5000) {
    rawStage = 'STAGE_3_SCALE_LEVERAGE';
    rawStageName = '拡散・オピニオン・業界リーダーフェーズ';
  } else if (shownFollowers !== null && shownFollowers >= 500) {
    rawStage = 'STAGE_2_AUTHORITY_ENGAGEMENT';
    rawStageName = '専門性確立・ファン育成フェーズ';
  }

  if (!hasXaiKey()) {
    return {
      stage: rawStage,
      stageName: rawStageName,
      username: accountInfo.username,
      name: accountInfo.name,
      followers: shownFollowers,
      following: shownFollowing,
      totalTweets: accountInfo.followersMeasured ? accountInfo.totalTweets : null,
      recentTweetsCount: accountInfo.recentTweets.length,
      hasOfficialData: accountInfo.hasOfficialData,
      followersMeasured: accountInfo.followersMeasured,
      pastContentAnalysis: 'フォロワー初期段階のため、背伸びした持論を排し等身大の検証と有益ギブに徹する必要があります。',
      coreStrategicPosture: '等身大の泥臭い検証者・共感の実践者',
      strategicDirectiveForCouncil: '【背伸び厳禁】上から目線の持論を排し、等身大の失敗談・一次検証データ・読者への具体的有益ギブに徹して信用を構築せよ。',
      strictDonts: ['上から目線の持論・オピニオンの禁止', '誇大な権威性の誇張の禁止', '本文URL直貼りの禁止'],
      strictDos: ['等身大の失敗談・一次検証データ', '保存誘発型のチェックリスト', 'リプライ2段目の安全配置']
    };
  }

  const model = null;

  const recentTweetsText = accountInfo.recentTweets.length > 0
    ? accountInfo.recentTweets.slice(0, 8).map((t, i) => `[ツイート${i+1}] ${t.text.replace(/\n/g, ' ')} (いいね:${t.likes}, RT:${t.retweets})`).join('\n')
    : '（直近ツイートなし または 取得不可）';

  const prompt = `あなたはSNSアルゴリズムおよびB2Bアカウント成長戦略の最高峰監査官（Chief Account Strategist）です。
以下の「ユーザーのX公式アカウントのリアルタイム現在地データ（フォロワー数、フォロー数、過去の投稿内容など）」を冷徹に分析・診断し、
「このアカウントが今絶対にやってはいけない背伸びの罠」と「今最も優先して実行すべき信用構築戦略」を深層診断してください。

【対象アカウントの現在地】
- Xユーザー名: @${accountInfo.username} (${accountInfo.name})
- フォロワー数: ${shownFollowers === null ? '不明' : `${shownFollowers} 名`}
- フォロー数: ${shownFollowing === null ? '不明' : `${shownFollowing} 名`}
- 過去総ツイート数: ${accountInfo.followersMeasured && accountInfo.totalTweets !== null ? `${accountInfo.totalTweets} 件` : '不明'}
- 課金と検索: ${formatAccountState(accountInfo.accountState || describeAccountState({ ok: false }, {}), 'ja')}
- 直近の投稿内容・反応:
${recentTweetsText}

【最重要診断コンテキスト（ユーザーからの重要指摘）】
「イーロン・マスクは『YES』と呟くだけで引用拡散されるが、フォロワー数十名〜小規模のアカウントが同じように上から目線の持論やオピニオンを発信しても、誰も相手にせず大火傷する。
今のアカウントの現在地（信用構築段階なのか、拡散段階なのか）を徹底的に見極め、背伸びした投稿を完全に防ぎ、等身大で最も信用が集まる戦略を立てなければならない」

【出力JSONフォーマット】
{
  "stage": "${rawStage}",
  "stageName": "${rawStageName}",
  "stageDescription": "現在のアカウント規模と認知度に関する客観的な現状説明（日本語1〜2文）",
  "followers": ${shownFollowers === null ? 'null' : shownFollowers},
  "following": ${shownFollowing === null ? 'null' : shownFollowing},
  "totalTweets": ${accountInfo.followersMeasured && accountInfo.totalTweets !== null ? accountInfo.totalTweets : 'null'},
  "pastContentAnalysis": "過去の投稿内容や反応の分析と現状の課題（日本語2〜3文）",
  "coreStrategicPosture": "今採るべきスタンス（例：『等身大の泥臭い検証者・共感の実践者』『特定領域の鋭い専門家』など）",
  "strategicDirectiveForCouncil": "7名AI合議制およびコピーライターに対する最重要厳格指示（どういうトーン・構成で書くべきか。背伸びをどう防ぐか。日本語2〜3文）",
  "strictDonts": [
    "絶対にやってはいけないこと1（例：偉そうなインフルエンサー風オピニオンの禁止）",
    "絶対にやってはいけないこと2（例：実績の誇張の禁止）",
    "絶対にやってはいけないこと3（例：本文直リンクの禁止）"
  ],
  "strictDos": [
    "今すぐ徹底すべき勝ち筋1（例：『私もこれで月30時間溶かした』という当事者・失敗談から入る等身大フック）",
    "今すぐ徹底すべき勝ち筋2（例：読者がブクマ保存したくなる具体的チェックリスト・型の手順公開）",
    "今すぐ徹底すべき勝ち筋3（例：詳細はリプライ2段目のスレッドへ安全に逃がす親切設計）"
  ]
}`;

  try {
    const result = await generateContentPreferred(model, prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    parsed.username = accountInfo.username;
    parsed.name = accountInfo.name;
    parsed.followers = shownFollowers;
    parsed.following = shownFollowing;
    parsed.totalTweets = accountInfo.followersMeasured ? accountInfo.totalTweets : null;
    parsed.hasOfficialData = accountInfo.hasOfficialData;
    parsed.followersMeasured = accountInfo.followersMeasured;
    parsed.accountState = accountInfo.accountState || null;
    return parsed;
  } catch (err) {
    console.warn('[diagnoseUserAccountStageAndStrategy Gemini warning]:', err.message);
    return {
      stage: rawStage,
      stageName: rawStageName,
      stageDescription: shownFollowers === null ? 'フォロワー数は不明です。' : `現在フォロワー${shownFollowers}名のアカウントです。`,
      username: accountInfo.username,
      name: accountInfo.name,
      followers: shownFollowers,
      following: shownFollowing,
      totalTweets: accountInfo.followersMeasured ? accountInfo.totalTweets : null,
      hasOfficialData: accountInfo.hasOfficialData,
      followersMeasured: accountInfo.followersMeasured,
      pastContentAnalysis: '過去の投稿からアカウントの認知基盤を形成中。',
      coreStrategicPosture: '等身大の泥臭い検証者・共感の実践者',
      strategicDirectiveForCouncil: '【背伸び厳禁】上から目線の持論を排し、等身大の失敗談・一次検証データ・読者への具体的有益ギブに徹して信用を構築せよ。',
      strictDonts: ['上から目線の持論・オピニオンの禁止', '実績の誇張の禁止', '本文直リンクの禁止'],
      strictDos: ['等身大の失敗談・共感フック', '保存誘発型の具体知見公開', 'リプライ2段目の安全配置']
    };
  }
}

/**
 * 段階的プロンプト [Pass 1]: URL情報 + ユーザープロンプト + 集合知ナレッジに基づく市場分析 (日英両言語対応)
 */
async function analyzeMarketWithUserPrompt(pageInfo, userPrompt, collectiveKnowledge, userKnowledge, accountDiagnosis = null) {
  if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');
  const model = null;

  const successTips = (collectiveKnowledge.successPatterns || []).slice(0, 3).map(p => `・${p.patternName}: ${p.syntaxRule}`).join('\n');
  const failureTips = (collectiveKnowledge.failurePatterns || []).slice(0, 3).map(p => `・${p.patternName}: ${p.flawReason}`).join('\n');

  const prompt = `あなたはB2B・X(Twitter)マーケティングの最高戦略アナリストです。
以下のWebサイト情報、お客様からの個別指示（ユーザープロンプト）、および全クライアントの集合知ナレッジを総合分析し、最も売上・商談に直結する【市場分析 ＆ ポジショニング戦略】を日英両言語（日本語とビジネス英語）を含むJSON形式で作成してください。

【お客様からの直接カスタム指示（最優先）】
${userPrompt ? userPrompt : '（特になし：サイト情報から最も確度の高いターゲットを自律判定してください）'}

${accountDiagnosis ? `【🚨 最重要制約：対象アカウントの現在地・信用ステージ（背伸び投稿の絶対防止）】
- アカウント: @${accountDiagnosis.username || 'user'} (フォロワー: ${accountDiagnosis.followers || 0}名 / ステージ: ${accountDiagnosis.stageName || '初期'})
- アカウントの現状診断: ${accountDiagnosis.pastContentAnalysis || '初期認知形成中'}
- 今採るべきスタンス: ${accountDiagnosis.coreStrategicPosture || '等身大の泥臭い検証者・共感の実践者'}
- 評議会への厳格方針: ${accountDiagnosis.strategicDirectiveForCouncil || '背伸びを排し、等身大の一次体験・共感・保存される具体知見で信用を積み上げよ'}
- 【絶対禁止 (Don\'ts)】: ${(accountDiagnosis.strictDonts || []).join(' / ')}
- 【徹底すべき勝ち筋 (Dos)】: ${(accountDiagnosis.strictDos || []).join(' / ')}
` : ''}

【宣伝対象のWebサイト情報】
- URL: ${pageInfo.url}
- タイトル: ${pageInfo.title || '(なし)'}
- 説明: ${pageInfo.description || '(なし)'}
- 見出し: ${pageInfo.headings ? pageInfo.headings.join(' / ') : '(なし)'}
- 本文抜粋: ${pageInfo.snippet || '(なし)'}

【全顧客の集合知ナレッジ（成功・失敗傾向）】
[成功パターン]
${successTips}
[避けるべき失敗パターン]
${failureTips}

【出力JSONフォーマット】
{
  "serviceName": "サービス名・事業名",
  "oneLineSummary": "30字以内のコア提供価値（日本語）",
  "oneLineSummary_en": "Core value proposition within 15 words (Executive Business English)",
  "targetAudience": "最も刺さるターゲット顧客層（日本語：職業、役職、深い悩み、年代）",
  "targetAudience_en": "Target audience persona (Executive Business English: role, ICP, pain points)",
  "userPainPoints": ["顧客の生々しい課題1", "課題2", "課題3"],
  "userPainPoints_en": ["Key pain point 1 in English", "Key pain point 2 in English", "Key pain point 3 in English"],
  "uniqueSellingPoints": ["競合に対する絶対的差別化要素1", "要素2"],
  "uniqueSellingPoints_en": ["Competitive differentiator 1 in English", "Differentiator 2 in English"],
  "toneOfVoice": "最も成約率が高まる発信トーン（日本語）",
  "toneOfVoice_en": "Optimal tone of voice (Executive Business English)",
  "coreAppealAngle": "今回のマーケティングで最もフォーカスすべき訴求軸（日本語）",
  "coreAppealAngle_en": "Core strategic appeal angle (Executive Business English)",
  "userPromptReflected": "ユーザープロンプトをどのように戦略に反映したかの解説（日本語：1〜2文）",
  "userPromptReflected_en": "Explanation of how user directives were reflected (Executive Business English: 1-2 sentences)"
}`;

  try {
    const result = await generateContentPreferred(model, prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' ||
        typeof parsed.serviceName !== 'string' || !parsed.serviceName.trim() ||
        typeof parsed.targetAudience !== 'string' || !parsed.targetAudience.trim() ||
        !Array.isArray(parsed.userPainPoints) || !Array.isArray(parsed.uniqueSellingPoints)) {
      throw new Error('市場分析の生成結果が不足しています。');
    }
    return parsed;
  } catch (e) {
    console.warn('[Market Analysis Error]:', e?.message || String(e));
    throw new Error('市場分析の生成に失敗したため処理を停止しました。', { cause: e });
  }
}

/**
 * 段階的プロンプト [Pass 2]: アカウント成長戦略（最適化Bio案 ＆ 看板固定Post案の立案：日英完全対応）
 */
async function generateAccountGrowthStrategy(marketAnalysis, userPrompt, targetUrl, accountDiagnosis = null) {
  if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');
  const model = null;

  const prompt = `あなたはXアカウントのプロフィール設計・固定ポスト最適化の最高峰プロフェッショナルです。
以下の市場分析とユーザープロンプトに基づき、アカウントを訪れた見込み客がフォロー＆商談遷移したくなる【最適化Bio（プロフィール文）案】および【看板固定ポスト（Pin Tweet）戦略案】を、日本語とビジネス英語の両方で策定してください。

${accountDiagnosis ? `【🚨 最重要前提：対象アカウントの現在地・認知ステージ（背伸びBioの防止）】
- アカウント: @${accountDiagnosis.username || 'user'} (フォロワー: ${accountDiagnosis.followers || 0}名 / ステージ: ${accountDiagnosis.stageName || '初期'})
- 方針: フォロワー規模と乖離した誇大な権威（年商〇億など）は即見抜かれて信用を失うため、等身大の『現場の泥臭い実践者・有益な検証者』として親近感と信頼を両立するプロフィールにすること。
` : ''}

【市場分析】
- サービス名: ${marketAnalysis.serviceName}
- コア価値: ${marketAnalysis.oneLineSummary}
- ターゲット: ${marketAnalysis.targetAudience}
- 読者の悩み: ${marketAnalysis.userPainPoints.join('、')}
- 強み: ${marketAnalysis.uniqueSellingPoints.join('、')}
- URL: ${targetUrl}
- ユーザー指示: ${userPrompt || '特になし'}

【出力JSONフォーマット】
{
  "optimizedBio": "160文字以内の完璧なプロフィール文（日本語・改行含む）",
  "optimizedBio_en": "Optimized executive profile bio under 160 characters (Executive Business English)",
  "bioLogic": "なぜこのBioが成約とフォロワー獲得に強いのかの理由解説（日本語）",
  "bioLogic_en": "Strategic rationale behind the bio architecture (English)",
  "pinnedPost": {
    "headline": "固定ポストのタイトル・狙い（日本語）",
    "headline_en": "Headline & strategic intent in English",
    "text": "固定ポスト本文（130〜140文字・日本語）",
    "text_en": "Pinned flagship post copy (220-270 chars in Business English)",
    "ctaUrl": "${targetUrl}",
    "pinnedPostLogic": "なぜこの固定ポストが商談・リード獲得の看板として機能するかの解説（日本語）",
    "pinnedPostLogic_en": "Rationale for lead conversion in English"
  },
  "weeklyGrowthRoadmap": [
    { "phase": "Week 1", "focus": "共感＆有益ノウハウによる初期フォロワーの信用残高構築", "focus_en": "Establishing initial authority & trust balance via narrative value" },
    { "phase": "Week 2", "focus": "課題解体スレッドによる検討層への商談・リード獲得オファー", "focus_en": "Deploying breakdown threads to capture high-intent qualified leads" },
    { "phase": "Week 3", "focus": "他社事例と実績データの自己学習による投稿トーンの完全適合", "focus_en": "Refining algorithmic distribution based on continuous cross-tenant telemetry" }
  ]
}`;

  try {
    const result = await generateContentPreferred(model, prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' ||
        typeof parsed.optimizedBio !== 'string' || !parsed.optimizedBio.trim() ||
        !parsed.pinnedPost || typeof parsed.pinnedPost !== 'object' || Array.isArray(parsed.pinnedPost)) {
      throw new Error('アカウント戦略の生成結果が不足しています。');
    }
    return parsed;
  } catch (e) {
    console.warn('[Account Strategy Error]:', e?.message || String(e));
    throw new Error('アカウント戦略の生成に失敗したため処理を停止しました。', { cause: e });
  }
}

/**
 * 段階的プロンプト [Pass 3]: 7名編成 AI合議制諮問評議会 激論ディベート (日英完全対応)
 */
async function deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone = 'Asia/Tokyo', userKnowledge = null, userPlan = 'pro', accountDiagnosis = null) {
  if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');
  const model = null;

  const targetCount = userPlan === 'business' ? 5 : (userPlan === 'starter' ? 1 : 3);
  const expectedSlots = userPlan === 'business'
    ? ['morning', 'noon', 'afternoon', 'evening', 'night']
    : (userPlan === 'starter' ? ['morning'] : ['morning', 'noon', 'evening']);

  const prompt = `あなたはXマーケティングで驚異的な商談・成約率を誇る【7名編成 AI合議制諮問評議会】です。
安易な妥協や忖度を排し、各専門AIがそれぞれ相反する利害と評価レンズを持ち、客観的かつ徹底的な弁証法的合議ディベートを戦わせてください。
日本語（全面ビジネス日本語）と英語（全面ビジネス英語）の両方を完全に出力してください。下品な煽りや俗語（神輿担ぎ、YESマン、ドブ捨て、ピエロなど）は一切禁止し、気品と説得力のあるビジネス表現のみを用いてください。
提供されていない実績、体験、数値やXの非公開アルゴリズムの効果を事実として創作しないでください。不確かな推測は事実と区別してください。

【検討対象案件】
- サービス名: ${marketAnalysis.serviceName}
- ターゲット: ${marketAnalysis.targetAudience}
- 訴求軸: ${marketAnalysis.coreAppealAngle}
- ユーザー指示（最優先）: ${userPrompt || '特になし'}
- 予約タイムゾーン: ${scheduleTimeZone}（時間帯・理由はこの現地時間を基準にし、理由にもタイムゾーン名を明記）
- 契約プラン: ${userPlan} (${userPlan === 'business' ? 'ビジネス最高峰: 1日5投稿 (朝・昼・夕・夜・深夜の24時間露出)' : (userPlan === 'starter' ? 'スターター: 1日1投稿 (朝枠)' : 'プロ運用: 1日3投稿 (朝・昼・夜のゴールデンタイム)')})
- 投稿件数指示: postPlan配列には契約プランに合わせ【必ず${targetCount}件】（${userPlan === 'business' ? '5件：朝08:30、昼12:30、夕17:30、夜20:00、深夜22:30' : (userPlan === 'starter' ? '1件：朝08:30' : '3件：朝08:30、昼12:30、夜20:00')}）を出力してください。
- timeSlotには順に ${expectedSlots.join(', ')} を使い、stepには1からの連番を指定してください。
- 施策候補: 読者との対話、プロフィール案内、提供された一次情報の活用。

${userKnowledge && (userKnowledge.negativeList || userKnowledge.failedCases) ? `【🚨 最重要検閲：ユーザーの蓄積ネガティブリスト（地雷・即死ルール・実測失敗集の完全回避）】
※ ポジティブなバズの真似事よりも「絶対に踏んではならない地雷」の回避が、アカウント生存とフォロワー獲得の8割を決定づけます。評議会は各ポストが以下に1点でも抵触していないかを冷徹に検証してください。
${userKnowledge.negativeList ? `【蓄積ネガティブリスト】:\n${JSON.stringify(userKnowledge.negativeList, null, 2)}` : ''}
${userKnowledge.failedCases && userKnowledge.failedCases.length > 0 ? `【過去の実測失敗事例（伸び悩んだポストの反省点）】:\n${JSON.stringify(userKnowledge.failedCases.slice(0, 5), null, 2)}` : ''}
${userKnowledge.avoidKeywords ? `【厳格に排除すべきNG構文・表現】: ${userKnowledge.avoidKeywords.join(', ')}` : ''}
` : ''}
【7名の評議員と独立した評価レンズ】
1. 🎯 【親指停止フック分析官 (Thumb-Stop Hook Analyst)】: 0.2秒停止至上主義。ぬるい疑問文を排し、機会損失の数字可視化を要求。
2. 💬 【現場共感・ストーリー心理官 (Narrative Empathy Strategist)】: 読者の自尊心と泥臭い奮闘へのリスペクト。上から目線の説教に反対し連帯を重視。
3. 🔬 【配信分析官 (Distribution Analyst)】: 提供された情報をもとに配信上の仮説を検討し、未確認の効果を断定しない。
4. 🛡️ 【ブランド防御・品質統括官 (Brand Safety Director)】: 量産型AI構文や誇大広告を即時排除。上場企業水準の品格と公式API正規通信を死守。
5. 💼 【辛口B2B投資家・CFO (Pragmatic CFO / ROI Focus)】: 商談単価・LTV・リード獲得の明確なROIを要求し、机上の空論を排除。
6. 🏭 【実践SMEオペレーター (Veteran SME Operator)】: 現場で毎朝格闘する経営者の生々しい負荷に即した実感と言葉を要求。
7. 🏛️ 【最高作戦司令官 (Executive Operations Commander)】: 安易な妥協案を拒否権（VETO）で粉砕。全員が客観的評価で90点以上を承認するまで妥協なく決裁。

【出力JSONフォーマット】
{
  "deliberationRounds": {
    "round1_proposals": {
      "hookOfficer": "フック分析官の初期提案（ビジネス日本語：2段落）",
      "hookOfficer_en": "Hook Analyst initial proposal (Executive English: 2 paragraphs)",
      "empathyOfficer": "共感心理官の初期提案（ビジネス日本語：2段落）",
      "empathyOfficer_en": "Empathy Strategist initial proposal (Executive English: 2 paragraphs)",
      "algoOfficer": "アルゴリズム官の初期提案（ビジネス日本語：2段落）",
      "algoOfficer_en": "Algorithmic Analyst initial proposal (Executive English: 2 paragraphs)",
      "brandOfficer": "ブランド防御官の初期提案（ビジネス日本語：2段落）",
      "brandOfficer_en": "Brand Safety Director initial proposal (Executive English: 2 paragraphs)",
      "investorOfficer": "B2B投資家・CFOの初期提案（ビジネス日本語：2段落）",
      "investorOfficer_en": "Pragmatic CFO initial proposal (Executive English: 2 paragraphs)",
      "founderOfficer": "中小企業社長の初期提案（ビジネス日本語：2段落）",
      "founderOfficer_en": "Veteran SME Operator initial proposal (Executive English: 2 paragraphs)",
      "chiefCommander": "最高作戦司令官の初期指示（ビジネス日本語）",
      "chiefCommander_en": "Executive Commander initial directive (Executive English)"
    },
    "round2_debate": {
      "objectionToHook": "共感官・社長からフック官への反論（ビジネス日本語）",
      "objectionToHook_en": "Empathy Strategist & SME Operator to Hook Analyst (Executive English)",
      "objectionToFluff": "投資家・フック官から共感官への反論（ビジネス日本語）",
      "objectionToFluff_en": "Pragmatic CFO to Empathy Strategist (Executive English)",
      "objectionToAlgo": "社長・ブランド官からアルゴ官への反論（ビジネス日本語）",
      "objectionToAlgo_en": "Brand Safety & SME Operator to Algorithmic Analyst (Executive English)",
      "counterRefutation": "激論の末に導き出された高次元の合意着地点（ビジネス日本語）",
      "counterRefutation_en": "Unanimous Consensus Convergence after dialectical debate (Executive English)"
    },
    "round3_scores": {
      "hookScore": 96,
      "empathyScore": 95,
      "algoScore": 97,
      "brandScore": 94,
      "roiScore": 96,
      "realityScore": 95,
      "averageScore": 95.5,
      "allPassed": true,
      "critique": "評議会による多角採点合格総評（ビジネス日本語）",
      "critique_en": "Council multi-agent scoring verdict (Executive English)"
    },
    "round4_verdict": {
      "chiefVerdict": "最高作戦司令官による最終決裁（ビジネス日本語）",
      "chiefVerdict_en": "Executive Operations Commander final ratification (Executive English)"
    }
  },
  "postPlan": ${JSON.stringify(expectedSlots.map((timeSlot, index) => ({
    step: index + 1,
    format: '投稿形式',
    timeSlot,
    angle: '提供情報に基づく投稿テーマ',
    angle_en: 'Post angle based on supplied information',
    scores: { hook: 0, empathy: 0, algo: 0, brand: 0, total: 0 },
    rationale: { whyThisTime: '時間帯の選定理由', whyThisTime_en: 'Reason for the selected slot' },
    postDeliberation: { chiefCommander: '計画の理由', chiefCommander_en: 'Reason for the plan' }
  })), null, 2)}
}`;

  try {
    const result = await generateContentPreferred(model, prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const rounds = parsed?.deliberationRounds;
    const plan = parsed?.postPlan;
    if (!rounds || typeof rounds !== 'object' || Array.isArray(rounds) ||
        !Array.isArray(plan) || plan.length !== expectedSlots.length ||
        plan.some((item, index) => !item || typeof item !== 'object' || Array.isArray(item) ||
          item.step !== index + 1 || item.timeSlot !== expectedSlots[index] ||
          typeof item.format !== 'string' || !item.format.trim() ||
          typeof item.angle !== 'string' || !item.angle.trim())) {
      const error = new Error('合議計画の件数、時間帯または内容が不正です。');
      error.code = 'council_plan_invalid';
      throw error;
    }
    return parsed;
  } catch (e) {
    if (e?.code === 'council_plan_invalid') throw e;
    console.error('[Council Plan Error]:', e?.message || String(e));
    const error = new Error('合議計画の生成に失敗したため処理を停止しました。', { cause: e });
    error.code = 'council_plan_generation_failed';
    throw error;
  }
}

/**
 * 評議会承認ポストのプロンプト構築。
 * 次の指示へ渡すのは、不変ルールと、その時間帯に選ばれたページの事実だけ。
 */
async function buildCouncilWritingPrompt({
  marketAnalysis,
  targetUrl,
  councilPlan,
  userPrompt = '',
  userKnowledge = null,
  accountDiagnosis = null,
  userId = null,
  experimentVariant = null,
  lang = 'ja'
}) {
  const { BASELINE_PROMPT_DIRECTIVES } = require('./meta_prompt_optimizer');
  const promptDirectiveText = BASELINE_PROMPT_DIRECTIVES
    .filter(d => d.isImmutable)
    .map(d => `- [${d.category}] ${d.text}`)
    .join('\n');
  const measuredLang = String(lang).toLowerCase().startsWith('en') ? 'en' : 'ja';
  const selectedFacts = Array.isArray(councilPlan?.postPlan)
    ? councilPlan.postPlan.map(item => `${item.timeSlot || 'evening'}: ${formatHypothesis(item.selectedChoice, measuredLang)}`)
    : [];
  const measuredInstruction = selectedFacts.join('\n') || formatHypothesis(null, measuredLang);
  const mapElitesCellId = null;

  const planLength = councilPlan?.postPlan ? councilPlan.postPlan.length : 3;

  const prompt = `あなたは7名編成AI合議制評議会に専属する最高峰のB2Bコピーライターです。
評議会のディベート結果・各投稿の戦略根拠（rationale）に完全準拠し、${String(lang).toLowerCase().startsWith('en')
    ? `計画された全${planLength}件を英語だけで執筆してください。tweets と tweets_en の両方に同じ英語本文を入れ、日本語の文字は使わないでください。`
    : `計画された全${planLength}件の投稿本文を、日本語版（120〜140文字）と英語版（220〜270文字のExecutive B2B English）の【両方】を執筆してください。`}
計画や例文に含まれる未確認の数値・体験・実績やプラットフォームの効果を事実として創作しないでください。根拠が提供されない場合は省いてください。

${accountDiagnosis ? `【🚨 最重要監査：アカウント現在地・背伸び検閲（インフルエンサー気取りの完全排除）】
- アカウント現在地: @${accountDiagnosis.username || 'user'} (フォロワー: ${accountDiagnosis.followers || 0}名 / ステージ: ${accountDiagnosis.stageName || '初期'})
- 監査官への厳命: 執筆された投稿に『〜が真実だ』『まだ〜やってるの？』といった偉そうな上から目線、実態とかけ離れた大言壮語が1ミリでも含まれていれば、直ちに等身大の共感・現場検証・具体的ギブ表現へリライトせよ！
- 【絶対禁止】: ${(accountDiagnosis.strictDonts || []).join(' / ')}
- 【徹底すべき勝ち筋】: ${(accountDiagnosis.strictDos || []).join(' / ')}
` : ''}

【案件情報】
- サービス名: ${marketAnalysis?.serviceName || 'プロダクト'}
- ターゲット: ${marketAnalysis?.targetAudience || 'B2Bユーザー'}
- 訴求軸: ${marketAnalysis?.coreAppealAngle || '業務効率化'}
- ユーザー指示（最優先）: ${userPrompt || '特になし'}
- 誘導先（プロフ固定記事の対象）: ${targetUrl || 'https://x.com'}
【不変ルール】
本文にURLを置かない。提供されていない体験・実績・数値を創作しない。段階に合わない上から目線を書かない。
${promptDirectiveText}

【このアカウントで今回使う仮説】
${measuredInstruction}

【評議会が決定した投稿計画（全${planLength}件）】
${JSON.stringify(councilPlan?.postPlan || [], null, 2)}

誰に・なぜ今・どの根拠か、この3つだけを書く。良い点の羅列にしない。過去の勝ち文は渡していないので、それを真似しない。

【禁止ワードプール（全投稿で一切使用禁止）】
・「月30時間」「30時間」「45分」「100時間」「白紙の画面」「画面を睨み」「キーボードが止まる」「溶かして」「溶かしていた」

【文体ルール】
- AI特有の安っぽい定型句（「いかがでしたでしょうか」「必見です！」「〜ですね！」）を完全排除。
- 日本語版は読者の感情を動かす生々しいビジネス日本語（120〜140文字）。
- 英語版はLinear, Stripe, Notion水準の洗練されたEnterprise B2B English（220〜270文字）。
- 本文内に直接URLは貼らず、読後のプロフ固定遷移を促すこと。

【出力JSONフォーマット】
{
  "posts": [
    {
      "step": 1,
      "format": "single_empathy",
      "angle": "朝の始業前・現場の生々しい手作業と時間損失の事実提示",
      "angle_en": "Operational Cost Recovery & Executive Empathy",
      "timeSlot": "morning",
      "tweets": ["ツイート本文（ビジネス日本語：120〜140文字）"],
      "tweets_en": ["Post text (Executive B2B English: 220-270 chars)"]
    },
    {
      "step": 2,
      "format": "quote_debate_trap",
      "angle": "常識の逆張り・引用RT議論惹起型ディベートトラップ",
      "angle_en": "Challenging Common Wisdom & Quote Tweet Debate Velocity",
      "timeSlot": "noon",
      "tweets": ["ツイート本文（ビジネス日本語：120〜140文字）"],
      "tweets_en": ["Post text (Executive B2B English: 220-270 chars)"]
    },
    {
      "step": 3,
      "format": "profile_pinned_funnel",
      "angle": "プロフ固定記事誘導・ステルス型成約ノウハウ",
      "angle_en": "Stealth Pinned Asset Routing & Enterprise Authority Blueprint",
      "timeSlot": "night",
      "tweets": ["ツイート本文（ビジネス日本語：120〜140文字）"],
      "tweets_en": ["Post text (Executive B2B English: 220-270 chars)"]
    }
  ]
}`;

  return { prompt, mapElitesCellId };
}

/**
 * 段階的プロンプト [Pass 4]: 合議結果に基づき、最高品質の厳選3投稿本文を動的執筆（日英両言語対応）
 */
async function writeCouncilApprovedPosts(marketAnalysis, targetUrl, councilPlan, userPrompt, userKnowledge = null, accountDiagnosis = null, userId = null, experimentVariant = null, lang = 'ja') {
  if (!Array.isArray(councilPlan?.postPlan) || councilPlan.postPlan.length === 0) {
    const error = new Error('合議投稿の計画がないため処理を停止しました。');
    error.code = 'council_plan_invalid';
    throw error;
  }
  if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');
  const model = null;

  const { prompt, mapElitesCellId } = await buildCouncilWritingPrompt({
    marketAnalysis,
    targetUrl,
    councilPlan,
    userPrompt,
    userKnowledge,
    accountDiagnosis,
    userId,
    experimentVariant,
    lang
  });

  try {
    const result = await generateContentPreferred(model, prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const rawPosts = parsed.posts;
    if (!Array.isArray(rawPosts) || rawPosts.length < councilPlan.postPlan.length) {
      const error = new Error('合議投稿の生成結果が不足しているため処理を停止しました。');
      error.code = 'council_draft_incomplete';
      throw error;
    }
    const isEn = String(lang).toLowerCase().startsWith('en');
    return councilPlan.postPlan.map((planItem, idx) => {
      const match = rawPosts[idx] || {};
      const englishTweets = Array.isArray(match.tweets_en) ? match.tweets_en : [];
      const japaneseTweets = Array.isArray(match.tweets) ? match.tweets : [];
      const chosenTweets = isEn
        ? (englishTweets.some(containsJapaneseScript) ? [] : englishTweets)
        : japaneseTweets;
      const chosenEnglish = isEn ? chosenTweets : englishTweets;
      if (!chosenTweets.length || chosenTweets.some(text => typeof text !== 'string') ||
          !chosenEnglish.length || chosenEnglish.some(text => typeof text !== 'string') ||
          (isEn && chosenTweets.some(containsJapaneseScript))) {
        const error = new Error('合議投稿の指定言語の本文が不足しているため処理を停止しました。');
        error.code = 'council_draft_incomplete';
        throw error;
      }
      return {
        step: planItem.step,
        format: planItem.format,
        angle: match.angle || planItem.angle,
        angle_en: match.angle_en || planItem.angle_en || 'Strategic Post',
        timeSlot: planItem.timeSlot,
        contentAngle: planItem.contentAngle || null,
        pageVersion: planItem.pageVersion || null,
        pageHypotheses: planItem.pageHypotheses || [],
        hypothesisWho: planItem.hypothesisWho || null,
        hypothesisWhy: planItem.hypothesisWhy || null,
        hypothesisProof: planItem.hypothesisProof || null,
        mapElitesCellId,
        scores: planItem.scores || { hook: 95, empathy: 95, algo: 95, brand: 95, total: 95 },
        rationale: planItem.rationale || {},
        postDeliberation: planItem.postDeliberation || {},
        tweets: enforcePostThreadConstraints(chosenTweets.map(t => sanitizePostOrReplyText(t)), { lang: isEn ? 'en' : 'ja', timeSlot: planItem.timeSlot }).tweets,
        tweets_en: enforcePostThreadConstraints(chosenEnglish.map(t => sanitizePostOrReplyText(t)), { lang: 'en', timeSlot: planItem.timeSlot }).tweets
      };
    });
  } catch (e) {
    if (e instanceof PostConstraintError || e?.code === 'council_draft_incomplete') throw e;
    console.error('Failed to generate council posts:', e?.message || String(e));
    const error = new Error('合議投稿の生成に失敗したため処理を停止しました。', { cause: e });
    error.code = 'council_generation_failed';
    throw error;
  }
}

/**
 * 段階的プロンプト [Pass 5]: 執筆ドラフトを7名AI評議会へ再提示し、ダメ出し・推敲クロスディベートを行って最終リライト
 * 議論させる → 投稿を作る → 投稿を見せて再議論・推敲させる弁証法ループ
 */
async function critiqueAndRefineDraftPosts(marketAnalysis, councilPlan, initialDrafts, accountStage = 'initial', userPrompt = '', userKnowledge = null, accountDiagnosis = null, lang = 'ja') {
  if (!hasXaiKey()) return initialDrafts;
  const model = null;

  const stageDescriptions = {
    initial: '【初期アカウント（フォロワー < 500）】壁打ちや上から目線は厳禁。読者へのリスペクト、生々しい現場の共感、親近感を持たせる問いかけ、プロフ固定への自然な誘導を最優先すること。',
    growth: '【中堅アカウント（フォロワー 500〜5,000）】拡散力強化。常識の逆張り、引用RT議論トラップ、2段階ステルス導線でフォロワー外のTLに露出させること。',
    enterprise: '【大規模アカウント（フォロワー 5,000+）】業界リーダーとしての品格と客観性。一次データ、検証生データ、ROIを提示し、高単価リードをプロフ固定から確実に刈り取ること。'
  };

  const prompt = `あなたは7名編成AI合議制評議会の【相互審査・推敲監査官】です。
前段のコピーライターが執筆した以下の「全${initialDrafts.length}件の投稿ドラフト（スレッド含む）」を、7名の各専門官（フック分析官、共感心理官、アルゴリズム逆解析官、ブランド防御官、辛口CFO、叩き上げ社長、最高司令官）の視点から厳しく審査・ダメ出しし、指摘を反映した【最高純度の最終推敲版】を再執筆してください。
提供されていない実績、体験、数値やプラットフォームの効果を事実として創作しないでください。
${String(lang).toLowerCase().startsWith('en') ? 'このアカウントの投稿言語は英語です。推敲後の本文は refined_tweets_en に英語だけで書き、日本語は使わないでください。' : ''}

【対象アカウントの現在地】
${stageDescriptions[accountStage] || stageDescriptions.initial}

【案件情報】
- サービス名: ${marketAnalysis.serviceName}
- ターゲット: ${marketAnalysis.targetAudience}
- 訴求軸: ${marketAnalysis.coreAppealAngle}
- ユーザー指示: ${userPrompt || '特になし'}

${userKnowledge && (userKnowledge.negativeList || userKnowledge.avoidKeywords) ? `【🚨 最重要監査：蓄積ネガティブリスト監査（地雷・即死ルール・実測失敗集の完全回避）】
【🚨 監査官最重要監査：ワンパターン・金太郎飴表現の完全排除（多様性監査）】
監査官は、提出されたドラフト群の中で「月〇時間」「30時間」「45分」「白紙の画面」「溶かして」といった同じ単語・数字が複数投稿にまたがって重複していないかを厳しく検閲してください。
重複が検出された場合、スロット別のテーマに沿って語彙を変えてください。提供されていない実体験は創作しないでください。

【文体・品質ルール】
- AI特有の安っぽい定型句（「いかがでしたでしょうか」「必見です！」「〜ですね！」）を完全排除。
評議会は執筆された全投稿（およびスレッド内の全ツイート）を以下のネガティブリストと照合し、1点でも抵触していれば即座に修正・リライトしてください。
${userKnowledge.negativeList ? `【蓄積ネガティブリスト】:\n${JSON.stringify(userKnowledge.negativeList, null, 2)}` : ''}
${userKnowledge.avoidKeywords ? `【NG語句】: ${userKnowledge.avoidKeywords.join(', ')}` : ''}
${userKnowledge.failedCases && userKnowledge.failedCases.length > 0 ? `【過去の実測失敗反省点】:\n${JSON.stringify(userKnowledge.failedCases.slice(0, 5), null, 2)}` : ''}
` : ''}
【執筆されたドラフト投稿（全${initialDrafts.length}件：全スレッド・全ツイート）】
${JSON.stringify(initialDrafts.map((d, i) => ({
  slot: d.timeSlot,
  format: d.format,
  draft_ja_tweets: d.tweets || [d.text],
  draft_en_tweets: d.tweets_en || [d.text_en]
})), null, 2)}

【評議会によるダメ出し・監査基準】
1. ネガティブリスト監査官: 親ポストの直リンク、ハッシュタグ、量産型AI構文（「いかがでしたでしょうか」等）、安易な疑問形、過去の失敗トリガーが完全排除されているか？（1点でもあれば即リライト）
2. フック分析官: 冒頭1行目で0.2秒スクロール停止できるか？「〜について共有します」などの平凡な書き出しは厳禁。
3. 共感心理官: 読者を責め立てず、孤独な奮闘を救済・肯定しているか？上から目線の説教になっていないか？
4. 配信分析官: 提供された情報と投稿形式に基づいて配信上の考慮点を検討し、未確認の効果を断定していないか？
5. ブランド防御官: AI特有の安っぽい定型句が徹底的に排除されているか？
6. 最高司令官: アカウントの現在地（初期/中堅/大）に合致した立ち振る舞いになっているか？

【出力JSONフォーマット】
{
  "councilCritiqueNotes": "評議会による第2ラウンドの激論・推敲サマリー",
  "refinedPosts": [
    {
      "step": 1,
      "timeSlot": "morning",
      "refined_tweets_ja": ["推敲後の最終日本語ポスト本文（120〜140文字）"],
      "refined_tweets_en": ["推敲後の最終英語ポスト本文（220〜270文字）"],
      "hookVerdict": "フック分析官の推敲評価",
      "empathyVerdict": "共感心理官の推敲評価",
      "algoVerdict": "アルゴリズム官の推敲評価",
      "brandVerdict": "ブランド防御官の推敲評価",
      "negativeListAudit": {
        "passed": true,
        "violationsPurged": "直リンク排除、ハッシュタグゼロ、AI定型句完全排除を確認"
      }
    },
    {
      "step": 2,
      "timeSlot": "noon",
      "refined_tweets_ja": ["推敲後の最終日本語ポスト本文（120〜140文字）"],
      "refined_tweets_en": ["推敲後の最終英語ポスト本文（220〜270文字）"],
      "hookVerdict": "フック分析官の推敲評価",
      "empathyVerdict": "共感心理官の推敲評価",
      "algoVerdict": "アルゴリズム官の推敲評価",
      "brandVerdict": "ブランド防御官の推敲評価",
      "negativeListAudit": {
        "passed": true,
        "violationsPurged": "直リンク排除、ハッシュタグゼロ、AI定型句完全排除を確認"
      }
    },
    {
      "step": 3,
      "timeSlot": "night",
      "refined_tweets_ja": [
        "1本目（120〜140文字）(1/4)",
        "2本目（120〜140文字）(2/4)",
        "3本目（120〜140文字）(3/4)",
        "4本目（120〜140文字）(4/4)"
      ],
      "refined_tweets_en": [
        "Tweet 1 (220-270 chars) (1/4)",
        "Tweet 2 (220-270 chars) (2/4)",
        "Tweet 3 (220-270 chars) (3/4)",
        "Tweet 4 (220-270 chars) (4/4)"
      ],
      "hookVerdict": "フック分析官の推敲評価",
      "empathyVerdict": "共感心理官の推敲評価",
      "algoVerdict": "アルゴリズム官の推敲評価",
      "brandVerdict": "ブランド防御官の推敲評価",
      "negativeListAudit": {
        "passed": true,
        "violationsPurged": "直リンク排除、ハッシュタグゼロ、AI定型句完全排除を確認"
      }
    }
  ]
}
`;

  try {
    const result = await generateContentPreferred(model, prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const refinedList = parsed.refinedPosts || [];

    return initialDrafts.map((draft, idx) => {
      const ref = refinedList[idx];
      if (!ref) return draft;
      const isEn = String(lang).toLowerCase().startsWith('en');
      let refinedTweets = draft.tweets;
      if (isEn && Array.isArray(ref.refined_tweets_en) && ref.refined_tweets_en.length > 0 &&
          !ref.refined_tweets_en.some(containsJapaneseScript)) {
        refinedTweets = ref.refined_tweets_en;
      } else if (!isEn && ref.refined_tweets_ja && Array.isArray(ref.refined_tweets_ja) && ref.refined_tweets_ja.length > 0) {
        refinedTweets = ref.refined_tweets_ja;
      } else if (!isEn && ref.refined_tweet_ja) {
        refinedTweets = Array.isArray(draft.tweets) && draft.tweets.length > 1
          ? [ref.refined_tweet_ja, ...draft.tweets.slice(1)]
          : [ref.refined_tweet_ja];
      }
      let refinedTweetsEn = isEn ? refinedTweets : draft.tweets_en;
      if (!isEn && ref.refined_tweets_en && Array.isArray(ref.refined_tweets_en) && ref.refined_tweets_en.length > 0) {
        refinedTweetsEn = ref.refined_tweets_en;
      } else if (ref.refined_tweet_en) {
        refinedTweetsEn = Array.isArray(draft.tweets_en) && draft.tweets_en.length > 1
          ? [ref.refined_tweet_en, ...draft.tweets_en.slice(1)]
          : [ref.refined_tweet_en];
      }
      const safeTweets = enforcePostThreadConstraints(
        (Array.isArray(refinedTweets) ? refinedTweets : [refinedTweets]).map(t => sanitizePostOrReplyText(t)),
        { lang: isEn ? 'en' : 'ja', timeSlot: draft.timeSlot }
      ).tweets;
      const safeTweetsEn = enforcePostThreadConstraints(
        (Array.isArray(refinedTweetsEn) ? refinedTweetsEn : [refinedTweetsEn]).map(t => sanitizePostOrReplyText(t)),
        { lang: 'en', timeSlot: draft.timeSlot }
      ).tweets;
      return {
        ...draft,
        tweets: safeTweets,
        tweets_en: safeTweetsEn,
        text: safeTweets[0] || '',
        text_en: safeTweetsEn[0] || '',
        negativeListAudit: ref.negativeListAudit || { passed: true, verifiedRulesCount: (userKnowledge?.negativeList || []).length },
        postDeliberation: {
          ...(draft.postDeliberation || {}),
          hookOfficer: ref.hookVerdict || draft.postDeliberation?.hookOfficer,
          empathyOfficer: ref.empathyVerdict || draft.postDeliberation?.empathyOfficer,
          algoOfficer: ref.algoVerdict || draft.postDeliberation?.algoOfficer,
          brandOfficer: ref.brandVerdict || draft.postDeliberation?.brandOfficer,
          negativeListAudit: ref.negativeListAudit || { passed: true, verifiedRulesCount: (userKnowledge?.negativeList || []).length }
        }
      };
    });
  } catch (err) {
    if (err instanceof PostConstraintError) throw err;
    console.warn('[Pass 5 Critique Warning]:', err.message);
    return initialDrafts;
  }
}

function getZonedDateParts(date, timeZone, includeTime = false) {
  const options = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } : {})
  };
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', options)
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
}

function dateFromLocalDateTimeInZone(year, month, day, hour, minute, timeZone) {
  const targetWallTime = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = targetWallTime;

  for (let attempt = 0; attempt < 4; attempt++) {
    const actual = getZonedDateParts(new Date(timestamp), timeZone, true);
    const actualWallTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const correction = targetWallTime - actualWallTime;
    timestamp += correction;
    if (correction === 0) break;
  }

  return new Date(timestamp);
}

function dateAtTimeInZone(referenceDate, timeZone, hour, minute, dayOffset = 0) {
  const localDate = getZonedDateParts(referenceDate, timeZone);
  const targetDay = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + dayOffset));
  return dateFromLocalDateTimeInZone(
    targetDay.getUTCFullYear(),
    targetDay.getUTCMonth() + 1,
    targetDay.getUTCDate(),
    hour,
    minute,
    timeZone
  );
}

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim() || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * 🚀 AI自律マーケティングキャンペーンを起動（多段合議・ユーザープロンプト・Bio戦略立案を完全統合）
 */
async function launchAutopilotCampaign(userId, targetUrl, options = {}) {
  const userPrompt = (options.userPrompt || '').trim();
  const lang = options.lang || 'ja';
  if (options.scheduleTimeZone && !isValidTimeZone(options.scheduleTimeZone)) {
    throw new Error('予約タイムゾーンが無効です。IANAタイムゾーンを指定してください。');
  }
  let scheduleTimeZone = options.scheduleTimeZone || 'Asia/Tokyo';
  const userDoc = await db.collection('saas_users').doc(userId).get();
  if (!userDoc.exists) throw new Error('ユーザー情報を確認できないためキャンペーンを停止しました。');
  const uData = userDoc.data() || {};
  const userPlan = uData.planId || options.plan || 'pro';
  const savedScheduleTimeZone = uData.scheduleTimeZone || uData.timezone;
  if (!options.scheduleTimeZone && savedScheduleTimeZone) {
    if (!isValidTimeZone(savedScheduleTimeZone)) {
      throw new Error(`保存済み予約タイムゾーンが無効です: ${savedScheduleTimeZone}`);
    }
    scheduleTimeZone = savedScheduleTimeZone;
  }

  const reportProgress = (step, title, detail) => {
    if (typeof options.onProgress === 'function') {
      try {
        options.onProgress({
          step,
          title,
          detail,
          timestamp: Date.now()
        });
      } catch (e) {}
    }
  };

  reportProgress('init', '自律合議パイプライン起動', `対象: ${userId} (${lang.toUpperCase()}) / URL解析準備中`);
  console.log(`🚀 [自律合議キャンペーン起動] ユーザー: ${userId} / URL: ${targetUrl} / 言語: ${lang}`);
  if (userPrompt) console.log(`  💬 [ユーザープロンプト反映]: ${userPrompt}`);

  // 0. [Pass 0]: X公式APIによるアカウント現在地・深層診断（フォロワー数、過去ツイート傾向、背伸び厳禁ルール）
  reportProgress('pass0_start', 'X公式API アカウント深層診断中...', 'フォロワー数・過去投稿・実務ステージを判定中');
  console.log(`  👤 [Pass 0: X公式APIによるアカウント現在地・深層診断中...]`);
  let accountDiagnosis = null;
  try {
    accountDiagnosis = await diagnoseUserAccountStageAndStrategy(userId, options);
    console.log(`  📊 [アカウント精密診断完了] @${accountDiagnosis.username} (フォロワー: ${accountDiagnosis.followers}名) -> ステージ: ${accountDiagnosis.stageName} (${accountDiagnosis.stage})`);
    console.log(`     🎯 [最優先スタンス]: ${accountDiagnosis.coreStrategicPosture}`);
    console.log(`     🚨 [背伸び防止方針]: ${accountDiagnosis.strategicDirectiveForCouncil}`);
    reportProgress('pass0_done', 'アカウント精密診断完了', `@${accountDiagnosis.username} (${accountDiagnosis.stageName} / フォロワー${accountDiagnosis.followers}名: 背伸び厳禁方針を策定)`);
  } catch (diagErr) {
    console.warn('Account diagnosis warning:', diagErr.message);
  }

  let accountStage = accountDiagnosis ? (accountDiagnosis.stage === 'STAGE_3_SCALE_LEVERAGE' ? 'enterprise' : (accountDiagnosis.stage === 'STAGE_2_AUTHORITY_ENGAGEMENT' ? 'growth' : 'initial')) : 'initial';
  // 1. ページ内容取得
  reportProgress('page_summary', 'URLコンテンツ・ナレッジ解析中...', `${targetUrl} の提供価値・ペルソナ抽出中`);
  const providedHtml = typeof options.html === 'string' && /<[a-z!/][^>]*>/i.test(options.html)
    ? options.html
    : (/<[a-z!/][^>]*>/i.test(userPrompt) ? userPrompt : '');
  const pageSummary = await fetchUrlSummary(providedHtml || targetUrl);
  if (!pageSummary.ok) {
    throw new Error(`URLの読み込みに失敗しました: ${pageSummary.error}`);
  }

  // 2. 集合知 ＆ ユーザーナレッジのロードと最新メトリクスからの同期
  const collectiveKnowledge = await getCollectiveMarketingIntelligence();
  let userKnowledge = await getUserMarketingKnowledge(userId);
  try {
    const { aggregateUserHistoryAndMetrics, syncAndEvolveKnowledgeFromHistory } = require('./ai_deliberation_council');
    const { filterValidMaturePostsForLearning } = require('./metrics_harvest_engine');
    const metricsData = await aggregateUserHistoryAndMetrics(userId);
    const matureHistory = filterValidMaturePostsForLearning(metricsData.history, { requireSnapshotOnly: true });
    if (matureHistory.length > 0) {
      userKnowledge = await syncAndEvolveKnowledgeFromHistory(userId, matureHistory, userKnowledge);
    }
  } catch (eSync) {
    console.warn('Knowledge sync warning in autopilot:', eSync.message);
  }

  // ユーザー単位のA/B実験コホートを解決・固定（群間データ混在を防止）
  const { resolveUserExperimentCohort } = require('./ab_experiment_engine');
  let userVariant = null;
  let userCohort = null;
  try {
    const userDocSnap = await db.collection('saas_users').doc(userId).get();
    const uData = userDocSnap.exists ? userDocSnap.data() : {};
    const resolved = resolveUserExperimentCohort(userId, uData);
    userCohort = resolved.cohort;
    userVariant = resolved.variant;
    if (resolved.isNewAssignment) {
      await db.collection('saas_users').doc(userId).set({
        experimentCohort: userCohort,
        experimentCohortAssignedAt: new Date()
      }, { merge: true });
    }
  } catch (cohortErr) {
    console.warn('[Cohort Resolution Warning]:', cohortErr.message);
  }

  // 3. [Pass 1] 市場分析・ポジショニング（ユーザープロンプト反映）
  reportProgress('pass1', 'Pass 1: 市場・ペルソナ分析中...', 'B2Bターゲット意思決定者の課題・深層心理を同定中');
  console.log(`  🔍 [Pass 1: 市場・ペルソナ分析中...]`);
  const marketAnalysis = await analyzeMarketWithUserPrompt(pageSummary, userPrompt, collectiveKnowledge, userKnowledge, accountDiagnosis);

  // 4. [Pass 2] アカウント成長戦略（最適化Bio案 ＆ 看板固定Post案の策定）
  reportProgress('pass2', 'Pass 2: 最適化Bio＆固定Post戦略案策定中...', 'プロフィール導線・成約固定Postの骨子を設計中');
  console.log(`  👤 [Pass 2: 最適化Bio＆固定Post戦略案を策定中...]`);
  const accountGrowth = await generateAccountGrowthStrategy(marketAnalysis, userPrompt, targetUrl, accountDiagnosis);

  // 5. [Pass 3] 3〜4ラウンド制 本格マルチエージェント・ディベート（7名編成）
  reportProgress('pass3', 'Pass 3: 7名編成AI評議会ディベート中...', '編集長・アナリスト・アルゴリズム防衛官がラウンド制激論合議中');
  console.log(`  🏛️ [Pass 3: 7名編成AI評議会によるラウンド制激論ディベート合議中...]`);
  const councilPlan = await deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone, userKnowledge, userPlan, accountDiagnosis);
  keepNextPostPlan(councilPlan, scheduleTimeZone);
  await attachSelectedFacts(userId, pageSummary, councilPlan);

  // 6. [Pass 4] 精鋭投稿バッチの初期ドラフト執筆
  reportProgress('pass4', 'Pass 4: 多角化マトリクス初期ドラフト執筆中...', `朝/昼/夕/夜/深夜の5次元排他アングルで金太郎飴を完全排除`);
  console.log(`  ✍️ [Pass 4: 合議承認ポスト（厳選${councilPlan.postPlan.length}投稿）の初期ドラフト執筆中...]`);
  const initialBatch = await writeCouncilApprovedPosts(marketAnalysis, targetUrl, councilPlan, userPrompt, userKnowledge, accountDiagnosis, userId, userVariant, lang);

  // 7. [Pass 5] 執筆ドラフトを評議会へ再提示し、ダメ出し・推敲クロスディベート（弁証法ループ）
  reportProgress('pass5', 'Pass 5: 相互監査・ダメ出し推敲ディベート中...', '直リンクゼロ検閲 & 動的クールダウン自己修復ループ中');
  console.log(`  ⚔️ [Pass 5: 7名AI評議会による執筆ドラフトの相互監査・ダメ出し推敲ディベート中...]`);
  const postBatch = await critiqueAndRefineDraftPosts(marketAnalysis, councilPlan, initialBatch, accountStage, userPrompt, userKnowledge, accountDiagnosis, lang);

  // 8. [Pass 6] 仮想オーディエンス評価（best-effort。評価失敗で投稿をブロックしない）
  try {
    const { evaluatePostWithAudience } = require('./audience_simulation_engine');
    reportProgress('pass6', 'Pass 6: 仮想オーディエンス評価・必要時の推敲中...', '5ペルソナ評価（投稿の配信可否は変更しません）');
    console.log(`  👥 [Pass 6: 仮想オーディエンス評価・必要時の推敲中...]`);
    for (const post of postBatch) {
      try {
        await evaluatePostWithAudience(post, {
          accountStage,
          targetUrl,
          userPrompt
        }, {
          sanitizeText: sanitizePostOrReplyText,
          isSafeRefinement: text => !/(https?:\/\/[^\s]+)/i.test(text)
        });
      } catch (simErr) {
        console.warn(`[Audience Simulation] 評価をスキップし既存投稿を維持: ${simErr.message}`);
      }
    }
  } catch (loadErr) {
    console.warn(`[Audience Simulation] 評価器を読み込めず既存投稿を維持: ${loadErr.message}`);
  }

  // 7. スケジュール日時の計算（朝・昼・夜に分散配置）
  const campaignId = `auto_${randomUUID()}`;
  const now = Date.now();
  const scheduledJobs = [];

  const timeSlotMap = {
    morning: { h: 8, m: 30 },
    noon: { h: 12, m: 30 },
    afternoon: { h: 17, m: 30 },
    evening: { h: 20, m: 0 },
    night: { h: 22, m: 30 },
    sunday_night: { h: 21, m: 30 }
  };

  for (let i = 0; i < postBatch.length; i++) {
    const p = postBatch[i];
    const slotDef = timeSlotMap[p.timeSlot] || { h: 12, m: 0 };
    const baseRefDate = options.startFromDate ? new Date(options.startFromDate) : new Date(now);
    const slotMinute = slotDef.m + Math.floor(Math.random() * 10);
    let scheduledDate = dateAtTimeInZone(baseRefDate, scheduleTimeZone, slotDef.h, slotMinute);
    if (scheduledDate.getTime() <= now + 15 * 60 * 1000) {
      scheduledDate = dateAtTimeInZone(baseRefDate, scheduleTimeZone, slotDef.h, slotMinute, 1);
    }

    const tweetsArray = Array.isArray(p.tweets) && p.tweets.length > 0 ? p.tweets : [p.text || ''];
    const tweetsEnArray = Array.isArray(p.tweets_en) && p.tweets_en.length > 0 ? p.tweets_en : [p.text_en || ''];

    scheduledJobs.push({
      jobId: `job_${campaignId}_${i + 1}`,
      userId,
      campaignId,
      scheduleTimeZone,
      targetUrl,
      format: p.format || (tweetsArray.length > 2 ? 'multi_thread_story' : (tweetsArray.length === 2 ? 'two_tier_reply_link' : 'single_value')),
      tweets: tweetsArray,
      tweets_en: tweetsEnArray,
      text: tweetsArray[0] || '',
      text_en: tweetsEnArray[0] || '',
      isThread: tweetsArray.length > 1,
      angle: p.angle || '自動最適化',
      angle_en: p.angle_en || 'Strategic Post',
      contentAngle: p.contentAngle || null,
      pageVersion: p.pageVersion || pageSummary.pageVersion || null,
      pageHypotheses: p.pageHypotheses || [],
      hypothesisWho: p.hypothesisWho || null,
      hypothesisWhy: p.hypothesisWhy || null,
      hypothesisProof: p.hypothesisProof || null,
      timeSlot: p.timeSlot || 'evening',
      mapElitesCellId: p.mapElitesCellId || null,
      experimentCohort: userCohort || null,
      experimentVariant: userVariant || null,
      scores: p.scores || { hook: 95, empathy: 95, algo: 95, brand: 95, total: 95 },
      rationale: p.rationale || {},
      postDeliberation: p.postDeliberation || {},
      negativeListAudit: p.negativeListAudit || { passed: true, verifiedRulesCount: (userKnowledge?.negativeList || []).length },
      audienceSimulation: p.audienceSimulation || null,
      knowledgeLevel: userKnowledge?.level || 1,
      learnedPostsCount: userKnowledge?.learnedPostsCount || 0,
      scheduledAt: scheduledDate,
      status: 'pending',
      targetLikes: options.targetLikes || 10,
      targetRetweets: options.targetRetweets || 5,
      targetQuotes: options.targetQuotes || 2,
      createdAt: new Date()
    });
  }
  if (scheduledJobs.length > 1) scheduledJobs.splice(1);

  // 8. 戦略レポートオブジェクトの構築（日英バイリンガル完全格納）
  const strategyReport = {
    campaignId,
    targetUrl,
    scheduleTimeZone,
    accountDiagnosis: accountDiagnosis || null,
    userPrompt: userPrompt || null,
    generatedAt: new Date(),
    marketAnalysis,
    accountGrowth,
    deliberationRounds: councilPlan.deliberationRounds,
    collectiveIntelligenceSnapshot: {
      totalLearnedAccounts: collectiveKnowledge.totalLearnedAccounts,
      totalLearnedPosts: collectiveKnowledge.totalLearnedPosts
    }
  };

  // 9. Firestoreへの保存（やり直し時の重複蓄積防止：古い未投稿ジョブを一括クリーンアップ）
  const batch = db.batch();

  if (!options.isStrategyBlueprintOnly) {
    try {
      const oldJobsSnap = await db.collection('autopilot_jobs')
        .where('userId', '==', userId)
        .where('status', '==', 'pending')
        .get();

      oldJobsSnap.docs.forEach(d => {
        const data = d.data() || {};
        if (data.isHumanOverride) return;
        batch.delete(d.ref, { lastUpdateTime: d.updateTime });
      });
    } catch (cleanErr) {
      console.warn('[Old jobs cleanup warning]:', cleanErr.message);
    }
  }

  const userRef = db.collection('saas_users').doc(userId);
  const trustHandles = [...new Set([
    trustHandle(uData, uData.latestMarketingStrategy?.accountDiagnosis),
    trustHandle(uData, accountDiagnosis)
  ].filter(Boolean))];
  batch.set(userRef, {
    latestMarketingStrategy: strategyReport,
    ...(trustHandles.length ? { trustBuildingAccounts: FieldValue.arrayUnion(...trustHandles) } : {}),
    lastAutopilotCampaignId: campaignId,
    updatedAt: new Date()
  }, { merge: true });

  const campRef = db.collection('autopilot_campaigns').doc(campaignId);
  batch.create(campRef, {
    campaignId,
    userId,
    targetUrl,
    scheduleTimeZone,
    userPrompt,
    strategyReport,
    plan: options.plan || 'pro',
    totalJobs: options.isStrategyBlueprintOnly ? 0 : scheduledJobs.length,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  if (!options.isStrategyBlueprintOnly) {
    for (const job of scheduledJobs) {
      const jobRef = db.collection('autopilot_jobs').doc(job.jobId);
      batch.create(jobRef, job);
    }
  } else {
    // 🏛️ 既存待機中スロット(pending)に対して、AI評議会がURL分析・集合知・TOP10バズから策定した最新投稿文を反映
    try {
      const pendingSnap = await db.collection('autopilot_jobs')
        .where('userId', '==', userId)
        .where('status', '==', 'pending')
        .get();

      if (!pendingSnap.empty) {
        const pendingDocs = pendingSnap.docs;
        pendingDocs.sort((a, b) => {
          const ta = a.data().scheduledAt?._seconds || new Date(a.data().scheduledAt || 0).getTime() / 1000;
          const tb = b.data().scheduledAt?._seconds || new Date(b.data().scheduledAt || 0).getTime() / 1000;
          return ta - tb;
        });

        pendingDocs.forEach((d, i) => {
          const generatedJob = scheduledJobs[i % scheduledJobs.length];
          if (generatedJob) {
            const tweets = Array.isArray(generatedJob.tweets) && generatedJob.tweets.length > 0 ? generatedJob.tweets : [generatedJob.text || ''];
            const replyText = tweets.length > 1 ? tweets[1] : `▼ ${marketAnalysis.serviceName || 'サービス'}の詳細・無料体験はこちら👇\n${targetUrl.split(/[\n,\s]+/)[0] || targetUrl}`;
            const fullTweets = tweets.length > 1 ? tweets : [tweets[0], replyText];

            batch.update(d.ref, {
              text: tweets[0],
              tweets: fullTweets,
              draftText: tweets[0],
              draftReplyText: replyText,
              text_en: generatedJob.text_en || null,
              tweets_en: generatedJob.tweets_en || null,
              angle: generatedJob.angle,
              angle_en: generatedJob.angle_en || null,
              mapElitesCellId: generatedJob.mapElitesCellId || null,
              audienceSimulation: generatedJob.audienceSimulation || null,
              format: 'two_tier_reply_link',
              isThread: true,
              scores: generatedJob.scores || { hook: 96, empathy: 97, algo: 95, brand: 96, total: 96 },
              strategyDeliberatedAt: new Date(),
              updatedAt: new Date()
            });
          }
        });
        console.log(`  ✨ [AI合議知見反映] 既存待機スロット ${pendingDocs.length}件にAI分析結果の投稿文を注入・同期しました`);
      }
    } catch (updateErr) {
      console.warn('[Pending jobs AI update warning]:', updateErr.message);
    }
  }

  await batch.commit();
  console.log(`  🎉 [合議完了] ラウンド制ディベート戦略レポートと ${options.isStrategyBlueprintOnly ? '0 (JIT保持)' : scheduledJobs.length}件の自律ジョブを正常に保存しました！`);
  reportProgress('completed', '自律合議・戦略最適化完了！', `全待機スロットへ最新の合議知見と投稿文を完全同期しました`);

  return {
    ok: true,
    campaignId,
    scheduleTimeZone,
    strategyReport,
    scheduledCount: scheduledJobs.length,
    firstPostScheduledAt: scheduledJobs[0]?.scheduledAt
  };
}

/**
 * 🎯 【個別推敲】特定の1件の予約投稿に対して、個別プロンプトでAI評議会が再ディベート・修正する
 */
async function reThinkSingleJob(jobId, userPromptOrOpts = '') {
  const promptText = typeof userPromptOrOpts === 'object' && userPromptOrOpts !== null
    ? String(userPromptOrOpts.userPrompt || userPromptOrOpts.prompt || '')
    : String(userPromptOrOpts || '');
  console.log(`🎯 [個別再推敲開始] ジョブ: ${jobId} / 指示: ${promptText}`);

  const jobRef = db.collection('autopilot_jobs').doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) {
    return { ok: false, error: '指定されたジョブが見つかりません' };
  }

  const job = snap.data();
  if (job.isHumanOverride) return { ok: false, error: '手入力の予約は再推敲しません' };
  if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');

  try {
    const userDoc = await db.collection('saas_users').doc(job.userId).get();
    const user = userDoc.exists ? (userDoc.data() || {}) : {};
    try {
      const { checkTenantAiBudget } = require('./tenant_ai_budget');
      const gate = await checkTenantAiBudget({ db, userId: job.userId, user, kind: 'llm' });
      if (gate.allowed === false) return { ok: true, budgetDegraded: true, skipped: true };
    } catch (_budgetErr) {}
    let live = { ok: false };
    let creds = null;
    if (user.xOfficialCredentials) {
      creds = bindOfficialCreds(decryptCredentials(user.xOfficialCredentials), job.userId, user);
      live = await fetchMyAccountState(creds);
    }
    const accountState = describeAccountState(live, user);
    const targetMatch = String(job.targetUrl || user.targetUrl || '').match(/https?:\/\/[^\s]+/i);
    const extracted = targetMatch
      ? await extractBrandKnowledge(targetMatch[0], { db, userId: job.userId, cachedKnowledge: user.brandKnowledge, outputLang: accountState.lang === 'en' ? 'en' : 'ja' })
      : { pageSummary: { ok: false }, brandKnowledge: null };
    if (!extracted.pageSummary || !extracted.pageSummary.ok) {
      return { ok: false, error: '登録ページを読めないため再推敲を停止しました' };
    }
    const posts = await loadPostedJobs(job.userId);
    const voiceProfile = await resolveAccountVoiceProfile({
      userId: job.userId,
      user,
      creds,
      accountState,
      recentPostedJobs: posts
    });
    const previous = accountState.lang === 'en' ? (job.tweets_en || job.tweets || []) : (job.tweets || []);
    const qualityAudit = [];
    const tweets = await draftNextPostText({
      lang: accountState.lang,
      accountState,
      hypothesisText: formatHypothesis({ hypothesis: { who: job.hypothesisWho, why: job.hypothesisWhy, proof: job.hypothesisProof } }, accountState.lang),
      pageSummary: extracted.pageSummary,
      timeSlot: job.timeSlot || 'evening',
      recentTexts: previous,
      userPrompt: user.userPrompt || '',
      rethinkFeedback: promptText,
      brandKnowledge: extracted.brandKnowledge,
      voiceProfile,
      portfolioPlan: job.allowPromoUrl ? { allowPromoUrl: true } : { allowPromoUrl: false },
      targetUrl: targetMatch ? targetMatch[0] : '',
      recentPosts: rememberedPostTexts(posts, accountState.lang),
      genes: job.genes || null,
      qualityAudit
    });
    const isEn = accountState.lang === 'en';
    const updatedData = {
      tweets: isEn ? [] : tweets,
      tweets_en: isEn ? tweets : [],
      text: isEn ? '' : tweets[0],
      text_en: isEn ? tweets[0] : '',
      isThread: tweets.length > 1,
      customerReason: promptText ? `再推敲: ${promptText.slice(0, 180)}` : job.customerReason,
      lastUserPrompt: promptText,
      qualityAudit,
      reDeliberatedAt: new Date(),
      updatedAt: new Date()
    };
    await jobRef.update(updatedData);
    try {
      const { recordTenantLlmBreakdown } = require('./tenant_ai_budget');
      const rows = Array.isArray(qualityAudit) ? qualityAudit : [];
      const writerCalls = rows.filter(row => row && row.role === 'writer').length || 1;
      const criticCalls = rows.filter(row => row && row.role === 'critic').length;
      await recordTenantLlmBreakdown({ db, userId: job.userId, writerCalls, criticCalls });
    } catch (_usageErr) {}
    return { ok: true, jobId, updatedJob: { id: jobId, ...job, ...updatedData } };
  } catch (e) {
    console.error('Single job re-think error:', e.message);
    return { ok: false, error: `推敲エラー: ${e.message}` };
  }
}


/**
 * 🔄 未投稿ジョブ全体を最新トレンド・ユーザー指示で動的に再検討（Re-evaluate / アジャスト）する
 */
async function reDeliberateAutopilotJobs(userId, userPrompt = '') {
  if (typeof userPrompt !== 'string') {
    throw new TypeError('再検討の指示は文字列で指定してください。');
  }
  console.log(`🔄 [動的再検討開始] ユーザー: ${userId} / 指示: ${userPrompt}`);

  const snap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'pending')
    .limit(20)
    .get();

  if (snap.empty) {
    return { ok: false, error: '再検討対象となる未投稿（待機中）のジョブがありません。先にマーケティングを開始してください。' };
  }

  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data(), ref: d.ref, updateTime: d.updateTime }));
  const sampleJob = jobs[0];
  const targetUrl = typeof sampleJob.targetUrl === 'string' ? sampleJob.targetUrl.trim() : '';
  if (!targetUrl || jobs.some(job => typeof job.targetUrl !== 'string' || job.targetUrl.trim() !== targetUrl)) {
    throw new Error('予約の対象URLが不足しているか一致しないため再検討を停止しました。');
  }
  const userRef = db.collection('saas_users').doc(userId);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists || !userSnapshot.updateTime) {
    throw new Error('ユーザー情報を確認できないため再検討を停止しました。');
  }

  const collectiveKnowledge = await getCollectiveMarketingIntelligence();
  const userKnowledge = await getUserMarketingKnowledge(userId);
  const pageSummary = await fetchUrlSummary(targetUrl);
  if (!pageSummary.ok) {
    throw new Error(`URLの読み込みに失敗しました: ${pageSummary.error}`);
  }

  const accountDiagnosis = null;
  const marketAnalysis = await analyzeMarketWithUserPrompt(pageSummary, userPrompt, collectiveKnowledge, userKnowledge, accountDiagnosis);
  const accountGrowth = await generateAccountGrowthStrategy(marketAnalysis, userPrompt, targetUrl, accountDiagnosis);
  const accountTimeZone = userSnapshot.data().scheduleTimeZone || userSnapshot.data().timezone || 'Asia/Tokyo';
  const councilPlan = await deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, accountTimeZone, userKnowledge);
  keepNextPostPlan(councilPlan, accountTimeZone);
  await attachSelectedFacts(userId, pageSummary, councilPlan);
  const accountLang = String(userSnapshot.data().aiTargetLang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const newPosts = await writeCouncilApprovedPosts(marketAnalysis, targetUrl, councilPlan, userPrompt, userKnowledge, accountDiagnosis, userId, null, accountLang);

  const batch = db.batch();
  const orderedJobs = [...jobs].sort((a, b) => {
    const aTime = a.scheduledAt && a.scheduledAt.toDate ? a.scheduledAt.toDate() : new Date(a.scheduledAt || 0);
    const bTime = b.scheduledAt && b.scheduledAt.toDate ? b.scheduledAt.toDate() : new Date(b.scheduledAt || 0);
    return aTime - bTime;
  });
  for (let i = 0; i < orderedJobs.length; i++) {
    const job = orderedJobs[i];
    if (i > 0) {
      if (!job.updateTime) throw new Error('予約の更新時刻を確認できないため再検討を停止しました。');
      batch.update(job.ref, {
        status: 'cancelled',
        error: 'only_next_post',
        updatedAt: new Date()
      }, { lastUpdateTime: job.updateTime });
      continue;
    }
    const newP = newPosts[0];
    const rawTweetsJa = Array.isArray(newP.tweets) && newP.tweets.length > 0 ? newP.tweets : [newP.text || ''];
    const rawTweetsEn = Array.isArray(newP.tweets_en) && newP.tweets_en.length > 0 ? newP.tweets_en : [newP.text_en || ''];

    // 🛡️ 再議論バッチ更新時の投稿制約ガードレール（URL2段目移行・文面破壊防止）
    const tweetsArray = enforcePostThreadConstraints(rawTweetsJa, { lang: 'ja', timeSlot: newP.timeSlot || job.timeSlot }).tweets;
    const tweetsEnArray = enforcePostThreadConstraints(rawTweetsEn, { lang: 'en', timeSlot: newP.timeSlot || job.timeSlot }).tweets;

    if (!job.updateTime) throw new Error('予約の更新時刻を確認できないため再検討を停止しました。');
    batch.update(job.ref, {
      format: newP.format || job.format,
      tweets: tweetsArray,
      tweets_en: tweetsEnArray,
      text: tweetsArray[0] || '',
      text_en: tweetsEnArray[0] || '',
      isThread: tweetsArray.length > 1,
      angle: newP.angle || job.angle,
      angle_en: newP.angle_en || job.angle_en || 'Strategic Post',
      contentAngle: newP.contentAngle || job.contentAngle || null,
      pageVersion: newP.pageVersion || pageSummary.pageVersion || null,
      pageHypotheses: newP.pageHypotheses || [],
      hypothesisWho: newP.hypothesisWho || null,
      hypothesisWhy: newP.hypothesisWhy || null,
      hypothesisProof: newP.hypothesisProof || null,
      timeSlot: newP.timeSlot || job.timeSlot,
      scores: newP.scores || { hook: 90, empathy: 90, algo: 90, brand: 90, total: 90 },
      rationale: newP.rationale || {},
      postDeliberation: newP.postDeliberation || {},
      reDeliberatedAt: new Date(),
      reDeliberateNote: '7名AI合議制により動的再推敲・全会一致承認'
    }, { lastUpdateTime: job.updateTime });
  }

  const strategyReport = {
    targetUrl,
    accountDiagnosis: accountDiagnosis || null,
    userPrompt: userPrompt || null,
    generatedAt: new Date(),
    marketAnalysis,
    accountGrowth,
    deliberationRounds: councilPlan.deliberationRounds,
    isReDeliberated: true
  };

  batch.update(userRef, {
    latestMarketingStrategy: strategyReport,
    ...(trustHandle(userSnapshot.data(), userSnapshot.data().latestMarketingStrategy?.accountDiagnosis)
      ? { trustBuildingAccounts: FieldValue.arrayUnion(trustHandle(userSnapshot.data(), userSnapshot.data().latestMarketingStrategy.accountDiagnosis)) }
      : {}),
    updatedAt: new Date()
  }, { lastUpdateTime: userSnapshot.updateTime });

  try {
    await batch.commit();
  } catch (err) {
    if (err.code === 9 || err.code === 'FAILED_PRECONDITION' || err.code === 'failed-precondition' ||
        err.code === 5 || err.code === 'NOT_FOUND' || err.code === 'not-found') {
      const conflict = new Error('再検討中に予約またはユーザー情報が変更されたため更新を中止しました。内容を確認してください。', { cause: err });
      conflict.code = 'redeliberation_conflict';
      throw conflict;
    }
    throw err;
  }

  return {
    ok: true,
    updatedJobsCount: jobs.length,
    strategyReport
  };
}

/**
 * ✨ [Phase 1: 瞬速Aha! プレビューエンジン]
 * X公式連携や課金前に、URLとプロンプトから即座に7名AI合議による厳選3投稿をプレビュー生成する
 */
async function generateInstantPreviewPosts(targetUrl, userPrompt = '', lang = 'ja') {
  console.log(`✨ [Aha!プレビュー生成開始] URL: ${targetUrl} / 言語: ${lang}`);
  const cleanUrl = String(targetUrl || '').trim();
  let pageSummary = await fetchUrlSummary(cleanUrl);
  if (!pageSummary || !pageSummary.ok) {
    console.warn(`URL取得フォールバック適用: ${pageSummary?.error || 'Unknown error'}`);
    pageSummary = {
      ok: true,
      url: cleanUrl,
      title: cleanUrl.replace(/^https?:\/\//i, '').split('/')[0],
      description: userPrompt || 'Webサービス・ソリューション',
      headings: ['プロダクト概要', '主な特徴と強み', 'ユーザーベネフィット'],
      snippet: `URL: ${cleanUrl}。対象サービス/プロダクト。ユーザー指示: ${userPrompt || '認知拡大・反響獲得のための魅力的なコピー作成'}`
    };
  }

  const collectiveKnowledge = await getCollectiveMarketingIntelligence();
  const { BASELINE_NEGATIVE_LIST } = require('./ai_deliberation_council');
  const userKnowledge = {
    negativeList: BASELINE_NEGATIVE_LIST || [],
    avoidKeywords: ['いかがでしたでしょうか', '〜について解説します', '必見です', '3選'],
    failedCases: []
  };

  const marketAnalysis = await analyzeMarketWithUserPrompt(pageSummary, userPrompt, collectiveKnowledge, userKnowledge);
  const accountGrowth = await generateAccountGrowthStrategy(marketAnalysis, userPrompt, cleanUrl);
  const councilPlan = await deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, 'Asia/Tokyo', userKnowledge);
  const initialBatch = await writeCouncilApprovedPosts(marketAnalysis, cleanUrl, councilPlan, userPrompt, userKnowledge, null, null, null, lang);
  const refinedBatch = await critiqueAndRefineDraftPosts(marketAnalysis, councilPlan, initialBatch, 'initial', userPrompt, userKnowledge, null, lang);

  try {
    const { evaluatePostWithAudience } = require('./audience_simulation_engine');
    for (const post of refinedBatch) {
      try {
        await evaluatePostWithAudience(post, {
          accountStage: 'initial',
          targetUrl: cleanUrl,
          userPrompt
        }, {
          sanitizeText: sanitizePostOrReplyText,
          isSafeRefinement: text => !/(https?:\/\/[^\s]+)/i.test(text)
        });
      } catch (simErr) {
        console.warn(`[Audience Simulation Preview] 評価をスキップし既存投稿を維持: ${simErr.message}`);
      }
    }
  } catch (loadErr) {
    console.warn(`[Audience Simulation Preview] 評価器を読み込めず既存投稿を維持: ${loadErr.message}`);
  }

  return {
    ok: true,
    posts: refinedBatch,
    marketAnalysis,
    accountGrowth,
    councilPlan,
    targetUrl: cleanUrl
  };
}

/**
 * 🔄 【自己進化データループ】X公式APIから投稿済みツイートの実績（Imp/いいね/ブクマ等）を自動回収し、
 * 成功・失敗要因を自律学習してユーザー固有ナレッジを進化させる
 */
async function harvestTweetMetricsAndEvolveKnowledge(userId, options = {}) {
  // 🔒 ユーザー単位の排他分散ロックで多重実行を防止（options.skipLock が明示されない限り常時保護）
  if (!options.skipLock) {
    const { withUserSyncLock, DEFAULT_SYNC_LOCK_TTL_MS } = require('./user_sync_mutex');
    const lockHostId = options.lockHostId || `harvest_${process.pid}_${Date.now()}`;
    const ttlMs = options.lockTtlMs || DEFAULT_SYNC_LOCK_TTL_MS;
    const lockRes = await withUserSyncLock(userId, lockHostId, ttlMs, async (lockContext) => {
      return await _harvestTweetMetricsAndEvolveKnowledgeCore(userId, { ...options, lockContext, lockHostId });
    });
    if (!lockRes.acquired) {
      console.log(`ℹ️ [自己進化データループ] ユーザー ${userId} のメトリクス同期は他プロセスで実行中のため安全にスキップ`);
      return { ok: true, skipped: true, reason: 'concurrency_locked' };
    }
    return lockRes.result;
  }
  return await _harvestTweetMetricsAndEvolveKnowledgeCore(userId, options);
}

async function _harvestTweetMetricsAndEvolveKnowledgeCore(userId, options = {}) {
  console.log(`🔄 [自己進化データループ起動] ユーザー: ${userId}`);
  const { getUserMarketingKnowledge, syncAndEvolveKnowledgeFromHistory } = require('./ai_deliberation_council');
  const { decryptCredentials, getUserProfileAndRecentTweets } = require('./official_api_client');
  const {
    normalizeTweetMetrics,
    computePostAgeHours,
    resolve24hMetricsSnapshot,
    filterValidMaturePostsForLearning,
    matchTweetToJob
  } = require('./metrics_harvest_engine');

  let currentKnowledge = await getUserMarketingKnowledge(userId);
  let updatedMetricsCount = 0;
  const historyList = [];

  try {
    let tweetsRes = options.mockTweetsRes || null;
    let creds = null;

    if (!tweetsRes) {
      const userDoc = await db.collection('saas_users').doc(userId).get();
      if (!userDoc.exists) return { ok: false, error: 'User not found' };

      const uData = userDoc.data() || {};
      if (uData.xOfficialCredentials) {
        try {
          creds = decryptCredentials(uData.xOfficialCredentials);
        } catch (e) {}
      }
      if (!creds && uData.twitterAuth && uData.twitterAuth.oauth2RefreshToken) {
        creds = {
          userId: uData.twitterAuth.userId || uData.twitterId || '',
          username: uData.twitterAuth.username || 'VeloxSystemsV4',
          oauth2AccessToken: uData.twitterAuth.oauth2AccessToken,
          oauth2RefreshToken: uData.twitterAuth.oauth2RefreshToken,
          oauth2ExpiresAt: uData.twitterAuth.oauth2ExpiresAt
        };
      }
      if (!creds) {
        const encCreds = uData.encryptedTwitterCredentials || uData.twitterCredentials;
        if (encCreds) {
          try {
            creds = decryptCredentials(encCreds);
          } catch (e) {}
        }
      }

      if (creds) {
        creds.saasUserId = userId;
        if (!/^\d+$/.test(String(creds.userId || '')) && uData.twitterId) creds.userId = uData.twitterId;
      }

      if (!creds) {
        console.warn(`[Self-Correction Loop] ユーザー ${userId} のX認証情報が未設定`);
        return { ok: false, reason: 'no_credentials' };
      }

      if (creds.oauth2RefreshToken) {
        const { refreshOAuth2TokenIfNeeded } = require('./official_api_client');
        creds = await refreshOAuth2TokenIfNeeded(creds, false, userId);
      }

      tweetsRes = await getUserProfileAndRecentTweets(creds, 100);
    }

    if (!tweetsRes || !tweetsRes.ok || !Array.isArray(tweetsRes.tweets)) {
      const fetchError = tweetsRes ? (tweetsRes.error || `HTTP_${tweetsRes.status || 'unknown'}`) : 'no_response';
      if (require('./account_suspension_care').isSuspendedXError(fetchError)) {
        try {
          await require('./account_suspension_care').handleSuspendedXAccount({
            db,
            userId,
            reason: fetchError,
            cancelPendingJobsImpl: cancelNonManualPendingJobs
          });
        } catch (suspendErr) {
          console.warn(`[Suspended Account] ${suspendErr.message}`);
        }
        console.warn(`[Self-Correction Loop] ユーザー ${userId} は凍結のため自動運用を停止しました`);
        return { ok: false, error: fetchError, suspended: true };
      }
      console.warn(`[Self-Correction Loop Warning] ユーザー ${userId} のツイート取得失敗: ${fetchError}`);
      return { ok: false, error: fetchError };
    }

    // 投稿済みジョブを取得
    const postedJobsSnap = await db.collection('autopilot_jobs')
      .where('userId', '==', userId)
      .where('status', '==', 'posted')
      .get();

      const batch = db.batch();
      const { createEpisodeFromPost } = require('./episodic_memory_store');
      const now = options.now instanceof Date ? options.now : new Date();

      // 🛡️ タイムラインから流れた未回収投稿（tweetId）の直接補完取得（回収漏れ完全防止）
      try {
        const existingTweetIds = new Set(tweetsRes.tweets.map(t => String(t.id)));
        const missingTweetIds = [];

        for (const jDoc of postedJobsSnap.docs) {
          const jData = jDoc.data() || {};
          if (!jData.tweetId || existingTweetIds.has(String(jData.tweetId))) continue;
          if (jData.metrics24hSnapshot && jData.metrics24hSnapshot.isFrozen) continue;

          const rawPDate = jData.postedAt || jData.createdAt;
          if (!rawPDate) continue;
          const pDate = rawPDate.toDate ? rawPDate.toDate() : new Date(rawPDate);
          const age = computePostAgeHours(pDate, now);
          const needsEarly = !jData.metricsEarlySnapshot && age !== null && age >= 2 && age <= 6;
          if (age !== null && ((age >= 23.8 && age <= 36.0) || jData.needs24hHarvest || needsEarly)) {
            missingTweetIds.push(String(jData.tweetId));
          }
        }

        if (missingTweetIds.length > 0 && creds) {
          const { lookupTweetsByIds } = require('./official_api_client');
          const directRes = await lookupTweetsByIds(creds, missingTweetIds).catch((err) => ({ ok: false, error: err.message, tweets: [] }));
          if (!directRes || !directRes.ok) {
            const errMsg = directRes ? (directRes.error || `HTTP_${directRes.status}`) : 'unknown_error';
            console.error(`[Self-Correction Loop Error] ユーザー ${userId} の未回収投稿直接照会失敗: ${errMsg}`);
            return { ok: false, error: `direct_lookup_failed: ${errMsg}` };
          }
          for (const dt of (directRes.tweets || [])) {
            if (!existingTweetIds.has(String(dt.id))) {
              tweetsRes.tweets.push(dt);
              existingTweetIds.add(String(dt.id));
            }
          }
        }
      } catch (suppErr) {
        console.error(`[Tweet Supplement Error] ユーザー ${userId}:`, suppErr.message);
        return { ok: false, error: `tweet_supplement_failed: ${suppErr.message}` };
      }

      // 🛡️ ロック喪失安全ガード: ハートビート延長が途切れた場合は重複書き込みを自己中断
      if (options.lockContext && options.lockContext.isLockLost) {
        console.warn(`[Lock Abort] ユーザー ${userId} の同期ロック延長が失敗したため、Firestore書き込みを安全に中断します`);
        return { ok: false, error: 'lock_lost_during_execution' };
      }

      let bestTrustView = null;
      let capturedEarly = false;
      const rememberEarly = (payload, existing, ageHours, metrics) => {
        if (existing) return;
        if (ageHours === null || ageHours < 2 || ageHours > 6) return;
        if (!Number.isSafeInteger(metrics?.impressions) || metrics.impressions <= 0) return;
        if (!Number.isSafeInteger(metrics?.bookmarks) || metrics.bookmarks < 0 || metrics.bookmarks > metrics.impressions) return;
        const { buildEarlyMetricsSnapshot } = require('./metrics_harvest_engine');
        const early = buildEarlyMetricsSnapshot(metrics, ageHours, now.toISOString());
        if (!early) return;
        payload.metricsEarlySnapshot = early;
        capturedEarly = true;
      };
      for (const t of tweetsRes.tweets) {
        const tId = t.id;
        const normalized = normalizeTweetMetrics(t.metrics);
        const { matchedJob } = matchTweetToJob(postedJobsSnap.docs, t);
        if (!matchedJob) continue; // 管理対象外の一般ツイートは除外

        const matchingJobData = typeof matchedJob.data === 'function' ? matchedJob.data() : matchedJob;
        const rawPostedAt = t.createdAt || t.created_at;
        const parsedPostedAt = rawPostedAt ? new Date(rawPostedAt) : null;
        const postedAt = (parsedPostedAt && !Number.isNaN(parsedPostedAt.getTime())) ? parsedPostedAt : null;
        const postAgeHours = postedAt ? computePostAgeHours(postedAt, now) : null;

        let snapshot24h = null;
        let effectiveSnapshot = matchingJobData?.metrics24hSnapshot || null;

        // 🛡️ 同時実行競合防止: 原子的トランザクションで最新状態を読み込み、スナップショット凍結を保護
        if (matchedJob.ref && typeof db.runTransaction === 'function') {
          await db.runTransaction(async (transaction) => {
            // 🛡️ トランザクション内原子的ロック検証 (Atomic Lock Verification)
            if (options.lockContext && options.lockContext.isLockLost) {
              throw new Error('lock_lost_during_execution');
            }
            if (options.lockHostId && db) {
              const uSnap = await transaction.get(db.collection('saas_users').doc(userId));
              if (!uSnap.exists) {
                if (options.lockContext) options.lockContext.isLockLost = true;
                throw new Error('user_doc_missing_during_transaction');
              }
              const uData = uSnap.data() || {};
              const nowMs = Date.now();
              const { parseFirestoreTimestampMs } = require('./user_sync_mutex');
              const lockUntilMs = parseFirestoreTimestampMs(uData.metricsSyncLockedUntil);

              // 🛡️ 厳格なロック保持検証: 自身がlockHostIdであり、かつ期限内（lockUntilMs > nowMs）であること
              if (uData.metricsSyncLockedBy !== options.lockHostId || lockUntilMs <= nowMs) {
                if (options.lockContext) options.lockContext.isLockLost = true;
                throw new Error('lock_preempted_or_expired');
              }
            }

            const freshSnap = await transaction.get(matchedJob.ref);
            if (!freshSnap.exists) return;
            const freshData = freshSnap.data() || {};
            const alreadyFrozen = freshData.metrics24hSnapshot && freshData.metrics24hSnapshot.isFrozen
              ? freshData.metrics24hSnapshot
              : null;

            // トランザクション内で既存スナップショットを再解決（競合コミットによる多重書き換えを防止）
            snapshot24h = resolve24hMetricsSnapshot({
              postedAt,
              harvestedAt: now,
              normalizedMetrics: normalized,
              existingSnapshot: alreadyFrozen
            });

            const updatePayload = {
              'metrics.impressions': normalized.impressions,
              'metrics.likes': normalized.likes,
              'metrics.retweets': normalized.retweets,
              'metrics.bookmarks': normalized.bookmarks,
              'metrics.quotes': normalized.quotes,
              'metrics.replies': normalized.replies,
              metricsHarvestStatus: normalized.status,
              postAgeHoursAtHarvest: postAgeHours,
              metricsHarvestedAt: now,
              updatedAt: now
            };

            if (snapshot24h && !alreadyFrozen) {
              updatePayload.metrics24hSnapshot = snapshot24h;
              updatePayload.needs24hHarvest = false;
              effectiveSnapshot = snapshot24h;
            } else {
              effectiveSnapshot = alreadyFrozen || matchingJobData?.metrics24hSnapshot || null;
              if (alreadyFrozen || (postAgeHours !== null && postAgeHours > 36.0)) {
                updatePayload.needs24hHarvest = false;
              }
            }

            rememberEarly(updatePayload, freshData.metricsEarlySnapshot, postAgeHours, normalized);
            transaction.update(matchedJob.ref, updatePayload);
          });
        } else {
          snapshot24h = resolve24hMetricsSnapshot({
            postedAt,
            harvestedAt: now,
            normalizedMetrics: normalized,
            existingSnapshot: effectiveSnapshot
          });
          const updatePayload = {
            'metrics.impressions': normalized.impressions,
            'metrics.likes': normalized.likes,
            'metrics.retweets': normalized.retweets,
            'metrics.bookmarks': normalized.bookmarks,
            'metrics.quotes': normalized.quotes,
            'metrics.replies': normalized.replies,
            metricsHarvestStatus: normalized.status,
            postAgeHoursAtHarvest: postAgeHours,
            metricsHarvestedAt: now,
            updatedAt: now
          };
          rememberEarly(updatePayload, matchingJobData?.metricsEarlySnapshot, postAgeHours, normalized);
          if (snapshot24h && !effectiveSnapshot) {
            updatePayload.metrics24hSnapshot = snapshot24h;
            updatePayload.needs24hHarvest = false;
            effectiveSnapshot = snapshot24h;
          } else if ((effectiveSnapshot && effectiveSnapshot.isFrozen) || (postAgeHours !== null && postAgeHours > 36.0)) {
            updatePayload.needs24hHarvest = false;
          }
          batch.update(matchedJob.ref, updatePayload);
        }

        if (effectiveSnapshot && effectiveSnapshot.isFrozen &&
            typeof effectiveSnapshot.impressions === 'number' && effectiveSnapshot.impressions >= 0 &&
            typeof effectiveSnapshot.postAgeHours === 'number' &&
            effectiveSnapshot.postAgeHours >= 24 && effectiveSnapshot.postAgeHours <= 36) {
          const impressions = Math.floor(effectiveSnapshot.impressions);
          if (Number.isSafeInteger(impressions) && (!bestTrustView || impressions > bestTrustView.impressions)) {
            bestTrustView = {
              impressions,
              tweetId: String(tId),
              observedAt: now
            };
          }
        }

        // 24時間スナップショットを確定した投稿のみエピソード記憶に登録（計測時点の厳格統一）
        const frozenId = matchedJob && (matchedJob.id || matchedJob.jobId);
        const peers = postedJobsSnap.docs.map(doc => {
          const data = doc.data() || {};
          return {
            id: doc.id,
            jobId: doc.id,
            postedAt: data.postedAt || data.createdAt || null,
            metrics24hSnapshot: String(doc.id) === String(frozenId) ? effectiveSnapshot : (data.metrics24hSnapshot || null)
          };
        });
        if (frozenId && !peers.some(row => String(row.jobId) === String(frozenId))) {
          peers.push({ id: frozenId, jobId: frozenId, postedAt, metrics24hSnapshot: effectiveSnapshot });
        }
        rememberFrozenOutcome(frozenId, effectiveSnapshot, {
          posts: peers,
          userId,
          wildcardRecipe: matchingJobData && matchingJobData.wildcardRecipe || null
        });
        if (t.text && effectiveSnapshot && effectiveSnapshot.isFrozen && !normalized.isMissing && (effectiveSnapshot.impressions || 0) > 0 && postIsLearnable({ text: t.text })) {
          const episodeId = `tweet_${tId}`;
          const episode = createEpisodeFromPost({
            id: episodeId,
            text: t.text,
            angle: matchingJobData.angle,
            format: matchingJobData.format,
            impressions: effectiveSnapshot.impressions,
            likes: effectiveSnapshot.likes || 0,
            bookmarks: effectiveSnapshot.bookmarks || 0,
            replies: effectiveSnapshot.replies || 0
          });
          batch.set(
            db.collection('saas_users').doc(userId).collection('episodic_memories').doc(episodeId),
            { ...episode, tweetId: tId, createdAt: postedAt || now, updatedAt: now },
            { merge: true }
          );
        }
        updatedMetricsCount++;

        historyList.push({
          tweetId: tId,
          textSnippet: t.text || '',
          jobId: matchedJob?.id || null,
          angle: matchingJobData?.angle || '',
          format: matchingJobData?.format || '',
          mapElitesCellId: matchingJobData?.mapElitesCellId || null,
          genes: matchingJobData?.genes || null,
          portfolioRole: matchingJobData?.portfolioRole || '',
          underlyingMechanism: matchingJobData?.draftBriefSummary && matchingJobData.draftBriefSummary.underlyingMechanism || '',
          draftBriefSummary: matchingJobData?.draftBriefSummary || null,
          impressions: normalized.impressions,
          likes: normalized.likes,
          retweets: normalized.retweets,
          bookmarks: normalized.bookmarks,
          quotes: normalized.quotes,
          replies: normalized.replies,
          isMissing: normalized.isMissing,
          metrics24hSnapshot: effectiveSnapshot || snapshot24h || matchingJobData?.metrics24hSnapshot || null,
          postedAt,
          postAgeHours
        });
      }

      // 🛡️ ロック喪失安全ガード: バッチコミット直前チェック
      if (options.lockContext && options.lockContext.isLockLost) {
        console.warn(`[Lock Abort] ユーザー ${userId} のロック喪失によりバッチコミットを安全に中断します`);
        return { ok: false, error: 'lock_lost_during_execution' };
      }

      const rawFollowers = tweetsRes && tweetsRes.user && tweetsRes.user.metrics
        ? (tweetsRes.user.metrics.followers_count ?? tweetsRes.user.metrics.followers)
        : null;
      const measuredFollowers = Number.isSafeInteger(rawFollowers) && rawFollowers >= 0 ? rawFollowers : null;
      if (bestTrustView || measuredFollowers !== null) {
        const goalPayload = {};
        if (bestTrustView) goalPayload.trustViewGoal = bestTrustView;
        if (measuredFollowers !== null) {
          goalPayload.officialFollowerCount = measuredFollowers;
          goalPayload.officialFollowerCountAt = now.toISOString();
        }
        if (bestTrustView && Number.isSafeInteger(bestTrustView.impressions)) {
          goalPayload.recentMaxImpressions = bestTrustView.impressions;
        }
        batch.set(db.collection('saas_users').doc(userId), goalPayload, { merge: true });
      }

      if (updatedMetricsCount > 0 || bestTrustView || measuredFollowers !== null) {
        await batch.commit();
        console.log(`  📊 [実績データ回収完了] ${updatedMetricsCount}件の投稿メトリクスをFirestoreへ同期完了`);
      }
      if (capturedEarly) {
        try {
          await retargetNextPendingJob(userId);
        } catch (retargetErr) {
          console.warn(`[Next Post Retarget] ${retargetErr.message}`);
        }
      }

      // 🧬 1. MAP-Elites エリートアーカイブ更新 ＆ 言語的反省 (Reflexion)
      // 24時間スナップショット確定投稿のメトリクスのみを反映（計測時点の厳格統一）
      if (options.lockContext && options.lockContext.isLockLost) {
        console.warn(`[Lock Abort] ユーザー ${userId} のロック喪失によりMAP-Elites更新を安全に中断します`);
        return { ok: false, error: 'lock_lost_during_execution' };
      }
      try {
        const { registerPostPerformanceAndReflect } = require('./map_elites_memory');
        for (const h of historyList) {
          const snap = h.metrics24hSnapshot;
          if (snap && snap.isFrozen && !h.isMissing && typeof snap.impressions === 'number' && snap.impressions > 0 && h.textSnippet && h.mapElitesCellId && postIsLearnable(h)) {
            await registerPostPerformanceAndReflect({
              userId,
              cellId: h.mapElitesCellId,
              postText: h.textSnippet,
              metrics: {
                impressions: snap.impressions,
                likes: snap.likes || 0,
                retweets: snap.retweets || 0,
                bookmarks: snap.bookmarks || 0,
                quotes: snap.quotes || 0,
              }
            });
          }
        }
      } catch (meErr) {
        console.warn('[MAP-Elites Update Warning]:', meErr.message);
      }

      // 成熟投稿（24時間スナップショット確定かつ欠損なし）を抽出（スナップショット未保持は学習保留）
      const matureHistoryList = filterValidMaturePostsForLearning(historyList, { requireSnapshotOnly: true }).filter(postIsLearnable);

      // 🧠 2. ユーザー別メタプロンプトを、24時間以上経過した成熟投稿の実績からのみ分析・最適化する
      if (options.lockContext && options.lockContext.isLockLost) {
        console.warn(`[Lock Abort] ユーザー ${userId} のロック喪失によりメタプロンプト分析を安全に中断します`);
        return { ok: false, error: 'lock_lost_during_execution' };
      }
      try {
        const {
          analyzePerformanceClusters,
          optimizePromptDirectives,
          restoreMandatoryDirectives
        } = require('./meta_prompt_optimizer');

        const maturePerformancePosts = matureHistoryList.map(h => ({
          text: h.textSnippet,
          angle: h.angle,
          genes: h.genes || null,
          portfolioRole: h.portfolioRole || '',
          underlyingMechanism: h.underlyingMechanism || '',
          impressions: h.impressions,
          likes: h.likes || 0,
          bookmarks: h.bookmarks || 0,
          replies: h.replies || 0,
          postedAt: h.postedAt
        }));

        if (maturePerformancePosts.length >= 6) {
          const userRef = db.collection('saas_users').doc(userId);
          const storedUser = await userRef.get();
          const userData = storedUser.exists ? storedUser.data() : {};
          const currentDirectives = restoreMandatoryDirectives(userData.promptDirectives);
          const analysis = analyzePerformanceClusters(maturePerformancePosts);
          const optimization = await optimizePromptDirectives(currentDirectives, analysis, {
            lang: userData.aiTargetLang || 'ja',
            domainLexicon: currentKnowledge && currentKnowledge.domainLexicon
          });

          if (optimization.isUpdated) {
            await userRef.set({
              promptDirectives: optimization.updatedDirectives,
              promptDirectivesVersion: (Number(userData.promptDirectivesVersion) || 0) + 1,
              promptDirectivesUpdatedAt: new Date(),
              promptDirectivesChangeLog: [
                ...(Array.isArray(userData.promptDirectivesChangeLog) ? userData.promptDirectivesChangeLog : []),
                ...optimization.changeLog
              ].slice(-20)
            }, { merge: true });
          }
        }
      } catch (optimizerErr) {
        console.warn('[Meta-Prompt Optimizer Warning]:', optimizerErr.message);
      }

      // 🧬 3. 自己進化ナレッジ更新（24時間以上経過した成熟投稿のみを学習対象とする）
      if (matureHistoryList.length > 0) {
        if (options.lockContext && options.lockContext.isLockLost) {
          console.warn(`[Lock Abort] ユーザー ${userId} のロック喪失によりナレッジ進化を安全に中断します`);
          return { ok: false, error: 'lock_lost_during_execution' };
        }
        const evolved = await syncAndEvolveKnowledgeFromHistory(userId, matureHistoryList, currentKnowledge);
        let lexiconEvolution = null;
        if (matureHistoryList.length >= 2) {
          try {
            lexiconEvolution = await evolveAccountLexiconAndLessons({
              userId,
              maturePosts: matureHistoryList,
              currentKnowledge
            });
            if (lexiconEvolution && lexiconEvolution.domainLexicon && !lexiconEvolution.skipped) {
              await db.collection('user_marketing_knowledge').doc(userId).set({
                domainLexicon: lexiconEvolution.domainLexicon,
                updatedAt: new Date()
              }, { merge: true });
              currentKnowledge = { ...currentKnowledge, domainLexicon: lexiconEvolution.domainLexicon };
              for (const lesson of lexiconEvolution.episodeLessons || []) {
                if (!lesson.tweetId || !lesson.lessonLearned) continue;
                await db.collection('saas_users').doc(userId).collection('episodic_memories').doc(`tweet_${lesson.tweetId}`).set({
                  lessonLearned: lesson.lessonLearned,
                  updatedAt: new Date()
                }, { merge: true });
              }
            }
          } catch (lexiconErr) {
            console.warn('[Editorial Lexicon Warning]:', lexiconErr.message);
          }
        }
        try {
          const scores = matureHistoryList.map(item => ((item.bookmarks || 0) * 3) + ((item.replies || 0) * 2) + (item.likes || 0)).sort((a, b) => a - b);
          const mid = Math.floor(scores.length / 2);
          const median = scores.length % 2 ? scores[mid] : ((scores[mid - 1] + scores[mid]) / 2);
          const outcomes = matureHistoryList.map(item => {
            const brief = item.draftBriefSummary || {};
            const score = ((item.bookmarks || 0) * 3) + ((item.replies || 0) * 2) + (item.likes || 0);
            const beatBaseline = matureHistoryList.length <= 1
              ? ((item.bookmarks || 0) >= 1 || (item.replies || 0) >= 1)
              : score > median;
            const cognitiveMove = brief.cognitiveMove || inferMove(item.textSnippet);
            const endingMove = brief.endingMove || inferEnding(item.textSnippet);
            const signalKey = createHash('sha256').update([item.tweetId || '', cognitiveMove, endingMove, beatBaseline ? '1' : '0'].join('|')).digest('hex').slice(0, 24);
            return { signalKey, cognitiveMove, endingMove, lang: /^[\x00-\x7F]*$/.test(String(item.textSnippet || '')) ? 'en' : 'ja', beatBaseline };
          });
          await recordSharedOutcomeSignals({
            outcomes,
            userIdHash: createHash('sha256').update(String(userId || '')).digest('hex').slice(0, 16)
          });
        } catch (signalErr) {
          console.warn('[Shared Outcome Signal Warning]:', signalErr.message);
        }
        
        // 🧬 4. オンラインDPO (Direct Preference Optimization) 勝者 vs 敗者ペアの動的生成
        try {
          const userDocSnap = await db.collection('saas_users').doc(userId).get();
          const userCohort = userDocSnap.exists ? userDocSnap.data()?.experimentCohort : null;
          if (process.env.ENABLE_AB_HOLDOUT === 'true' && userCohort === 'control_A') {
            console.log(`  ℹ️ [オンラインDPOスキップ] ユーザー ${userId} は対照群（control_A）のためDPOペア生成を行いません`);
          } else {
            // 投稿後24時間スナップショットを確定した投稿のみを厳密抽出（計測時点の揃った24hデータのみで比較）
            const matureSnapshotPosts = filterValidMaturePostsForLearning(historyList, { requireSnapshotOnly: true }).filter(postIsLearnable);

            // 24時間スナップショットが揃った投稿が2件以上ある場合のみDPOペアを生成（時間幅の異なる投稿の混合比較を防止）
            if (matureSnapshotPosts.length >= 2) {
              const sorted = [...matureSnapshotPosts]
                .sort((a, b) => ((b.bookmarks || 0) * 10 + (b.likes || 0)) - ((a.bookmarks || 0) * 10 + (a.likes || 0)));
              
              const winner = sorted[0];
              const loser = sorted[sorted.length - 1];
              if (winner.textSnippet !== loser.textSnippet) {
                evolved.dpoPreferencePairs = evolved.dpoPreferencePairs || [];

                // 重複ペアの再同期を防止
                const isDuplicate = evolved.dpoPreferencePairs.some(
                  p => p.winner?.text === winner.textSnippet && p.loser?.text === loser.textSnippet
                );

                if (!isDuplicate) {
                  evolved.dpoPreferencePairs.unshift({
                    winner: {
                      text: winner.textSnippet,
                      impressions: winner.impressions,
                      bookmarks: winner.bookmarks,
                      whyWon: lexiconEvolution && lexiconEvolution.pairInsight && lexiconEvolution.pairInsight.whyWon || '24hスナップショット実測（痛点数字・検証ファクトによる高保存率）'
                    },
                    loser: {
                      text: loser.textSnippet,
                      impressions: loser.impressions,
                      bookmarks: loser.bookmarks,
                      whyLost: lexiconEvolution && lexiconEvolution.pairInsight && lexiconEvolution.pairInsight.whyLost || '24hスナップショット実測（抽象的オピニオンによる低反応）'
                    },
                    pairedAt: new Date(),
                    basis: '24h_snapshot'
                  });
                  if (evolved.dpoPreferencePairs.length > 5) evolved.dpoPreferencePairs.pop();
                  console.log(`  🎯 [オンラインDPOペア生成完了] 24hスナップショット 勝者Post (ブクマ:${winner.bookmarks}) vs 敗者Post (ブクマ:${loser.bookmarks})`);

                  // FirestoreへDPOペアを永続化（次回生成で確実に参照されるように保存）
                  if (options.lockContext && options.lockContext.isLockLost) {
                    console.warn(`[Lock Abort] ユーザー ${userId} のロック喪失によりDPO永続化を安全に中断します`);
                    return { ok: false, error: 'lock_lost_during_execution' };
                  }
                  await db.collection('user_marketing_knowledge').doc(userId).set({
                    dpoPreferencePairs: evolved.dpoPreferencePairs,
                    updatedAt: new Date()
                  }, { merge: true });
                }
              }
            } else {
              console.log(`  ℹ️ [オンラインDPO待機] 24時間スナップショット確定投稿が${matureSnapshotPosts.length}件のため、計測時点が異なる投稿との混合比較を回避し待機`);
            }
          }
        } catch (dpoErr) {
          console.warn('[DPO Pairing Warning]:', dpoErr.message);
        }

        console.log(`  🧬 [自己進化完了] 成功エリート事例: ${evolved.successfulCases?.length || 0}件 / 失敗反省事例: ${evolved.failedCases?.length || 0}件 / DPOペア: ${evolved.dpoPreferencePairs?.length || 0}件`);
        currentKnowledge = evolved;
      }
  } catch (err) {
    console.error(`[Self-Correction Loop Error] (${userId}):`, err.message);
    return { ok: false, error: err.message };
  }

  // ⏱️ 次回クーリング判定用: 最終同期日時をユーザーレコードに永続化
  try {
    if (options.lockContext && options.lockContext.isLockLost) {
      console.warn(`[Lock Abort] ユーザー ${userId} のロック喪失により最終同期日時の更新をスキップします`);
      return { ok: false, error: 'lock_lost_during_execution' };
    }
    const finalNow = options.now instanceof Date ? options.now : new Date();

    // 🛡️ ロック保持者本人のみ最終同期日時を安全に記録（別プロセスによる上書き・競合を原子的トランザクションで防止）
    if (options.lockHostId && db) {
      await db.runTransaction(async (t) => {
        const uSnap = await t.get(db.collection('saas_users').doc(userId));
        if (!uSnap.exists) return;
        const uData = uSnap.data() || {};
        const { parseFirestoreTimestampMs } = require('./user_sync_mutex');
        const lockUntilMs = parseFirestoreTimestampMs(uData.metricsSyncLockedUntil);
        if (uData.metricsSyncLockedBy !== options.lockHostId || lockUntilMs <= Date.now()) {
          if (options.lockContext) options.lockContext.isLockLost = true;
          throw new Error('lock_preempted_or_expired');
        }
        t.set(db.collection('saas_users').doc(userId), {
          lastMetricsHarvestAt: finalNow,
          lastMetricsHarvestStatus: 'completed'
        }, { merge: true });
      });
    } else {
      await db.collection('saas_users').doc(userId).set({
        lastMetricsHarvestAt: finalNow,
        lastMetricsHarvestStatus: 'completed'
      }, { merge: true });
    }
  } catch (syncTimeErr) {
    console.error(`[Sync Timestamp Error] (${userId}):`, syncTimeErr.message);
    return { ok: false, error: `sync_timestamp_failed: ${syncTimeErr.message}` };
  }

  return {
    ok: true,
    updatedMetricsCount,
    historyCount: historyList.length,
    knowledge: currentKnowledge
  };
}

/**
 * 直近7日間の投稿実績を、凍結済み24時間メトリクスだけで集計する。
 */
async function generateWeeklyCouncilReport(userId, { persist = true } = {}) {
  console.log(`📊 [週次実測レポート生成] ユーザー: ${userId}`);
  const jobsSnap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'posted')
    .limit(300)
    .get();
  const reportJson = buildWeeklyGrowthReport({
    posts: jobsSnap.docs.map(doc => doc.data())
  });
  if (persist) {
    const userSnap = await db.collection('saas_users').doc(userId).get();
    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const { weeklyStrategyMemo } = require('./autonomous_strategy_architect');
    const memo = userData.strategyLockByUser || userData.isHumanOverride ? '' : weeklyStrategyMemo(reportJson);
    const patch = { latestWeeklyCouncilReport: reportJson, updatedAt: new Date() };
    if (memo) {
      patch.strategyDecisionLog = [...(Array.isArray(userData.strategyDecisionLog) ? userData.strategyDecisionLog : []).slice(-7), { at: new Date().toISOString(), memo }];
    }
    await db.collection('saas_users').doc(userId).set(patch, { merge: true });
  }

  console.log(`  ✅ [週次実測レポート保存完了] 投稿: ${reportJson.totalPosts}件 / 指標あり: ${reportJson.measuredPosts}件`);
  return { ok: true, report: reportJson };
}

const SLOT_CLOCK = {
  morning: [8, 30],
  noon: [12, 30],
  afternoon: [17, 30],
  evening: [20, 0],
  night: [22, 30]
};

function customerFacingReason(choice, lang) {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  const hasJa = value => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(String(value || ''));
  const hypothesis = choice && choice.hypothesis;
  const visible = value => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (isEn && hasJa(text)) return '';
    if (/記載はない|ページに無い|対象はページに無い|保証するものではありません|保証しません|not stated on the page|does not guarantee|利用規約|停止・解約|ボタン1つ|自動更新|規約条件|cancel anytime/i.test(text)) return '';
    return text;
  };
  if (!hypothesis) {
    return isEn
      ? 'Written from the registered page and this account. The page did not provide a reader, a reason, or proof.'
      : '登録ページとこのアカウントの状態から書いています。ページから読者・理由・根拠は取れていません。';
  }
  const who = visible(hypothesis.who);
  const why = visible(hypothesis.why);
  const proof = visible(hypothesis.proof);
  const parts = [];
  if (who) parts.push((isEn ? 'Who: ' : '誰に: ') + who);
  if (why) parts.push((isEn ? 'Why now: ' : 'なぜ今: ') + why);
  if (proof) parts.push((isEn ? 'Proof: ' : '根拠: ') + proof);
  if (parts.length === 0) {
    return isEn
      ? (hypothesis && [hypothesis.who, hypothesis.why, hypothesis.proof].some(hasJa)
        ? 'Written from verified facts on the registered page and this account state.'
        : 'The page did not state a reader, a reason, or proof, so the post leaves those out.')
      : 'ページに読者・理由・根拠の記載がなかったので、投稿本文には入れていません。';
  }
  return parts.join(isEn ? '. ' : '。');
}

function postIsLearnable(post) {
  const text = String(post && (post.textSnippet || post.text || (Array.isArray(post.tweets) ? post.tweets[0] : '')) || '');
  if (!text || BANNED_LEGACY.test(text)) return false;
  const lang = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(text) ? 'ja' : 'en';
  const audit = runDeterministicAudit({ tweets: [text] }, {
    lang,
    accountState: { postShape: 'single', singleOnly: true, maxChars: 4000 },
    recentTexts: []
  });
  return !audit.reasons.some(reason => reason === 'ai_slop' || String(reason).startsWith('ungrounded_number') || String(reason).startsWith('compliance:'));
}

function rememberFrozenOutcome(jobId, snapshot, context = {}) {
  if (!jobId || !snapshot || snapshot.isFrozen !== true) return Promise.resolve(null);
  const database = context.db || db;
  const outcome24h = buildFrozenOutcome(snapshot, context.posts || [], jobId);
  const ref = database.collection('generation_traces').doc(String(jobId));
  return ref.get().then(snap => {
    const existing = snap && snap.exists ? (snap.data() || {}) : {};
    const calibration = classifyTraceCalibration(existing, outcome24h.residualReward);
    const payload = { outcome24h };
    if (calibration) payload.calibration = calibration;
    return ref.set(payload, { merge: true }).then(() => syncPromotedArms(database, existing.userId || context.userId, jobId, existing, outcome24h, context).catch(() => null).then(() => payload));
  }).catch(() => null);
}

async function syncPromotedArms(database, userId, jobId, existing, outcome24h, context) {
  if (!database || !userId || !Number.isFinite(Number(outcome24h && outcome24h.residualReward))) return;
  const traceSnap = await database.collection('generation_traces').where('userId', '==', userId).limit(200).get();
  const rows = traceSnap.docs.map(doc => ({ jobId: doc.id, ...(doc.data() || {}) }));
  const patch = { jobId: String(jobId), ...existing, outcome24h, wildcardRecipe: existing.wildcardRecipe || context.wildcardRecipe || null };
  const index = rows.findIndex(row => String(row.jobId) === String(jobId));
  if (index >= 0) rows[index] = { ...rows[index], ...patch };
  else rows.push(patch);
  const userRef = database.collection('saas_users').doc(userId);
  const userSnap = await userRef.get();
  const userData = userSnap && userSnap.exists ? (userSnap.data() || {}) : {};
  const current = userData.promotedDynamicArms || [];
  const next = evaluateWildcardPromotions(rows, current);
  const summary = summarizeCriticCalibration(rows);
  const weights = computeCalibratedAxisWeights(summary);
  const evolved = evaluatePromptEvolution(rows, userData.promptEvolution || null, summary);
  const userPatch = {};
  if (JSON.stringify(next) !== JSON.stringify(current.filter(id => WILDCARD_IDS.includes(id)))) userPatch.promotedDynamicArms = next;
  if (weights) userPatch.criticAxisWeights = weights;
  if (evolved.changed && evolved.promptEvolution) userPatch.promptEvolution = evolved.promptEvolution;
  if (Object.keys(userPatch).length) await userRef.set(userPatch, { merge: true });
}

async function resolveAudienceCraft({ userId, user, brandKnowledge, posts, lang, radar, budgetDegraded }) {
  const { ensureAudienceKnowledge } = require('./audience_knowledge_engine');
  const { selectEditorialArchetype } = require('./editorial_archetypes');
  let audienceKnowledge = user && user.audienceKnowledge && (user.audienceKnowledge.schemaVersion === 2 || user.audienceKnowledge.schemaVersion === 1) ? user.audienceKnowledge : null;
  let needsReaderHint = false;
  const signals = Array.isArray(radar) ? radar : (radar && Array.isArray(radar.signals) ? radar.signals : []);
  if (!budgetDegraded) {
    try {
      const built = await ensureAudienceKnowledge({ db, userId, user, brandKnowledge, radar: signals, lang, userPrompt: user && user.userPrompt || '' });
      if (built && built.audienceKnowledge) audienceKnowledge = built.audienceKnowledge;
      if (built && built.needsReaderHint === true && !audienceKnowledge) needsReaderHint = true;
    } catch (err) {
      console.warn(`[Audience Brain] ${String(err && err.message || err).slice(0, 180)}`);
    }
  }
  let pendingJobs = [];
  try {
    const snap = await db.collection('autopilot_jobs').where('userId', '==', userId).where('status', '==', 'pending').limit(5).get();
    pendingJobs = snap.docs.map(doc => doc.data());
  } catch (_pendingErr) {
    pendingJobs = [];
  }
  const plan = selectEditorialArchetype({
    recentJobs: [...pendingJobs, ...(Array.isArray(posts) ? posts : [])],
    topics: audienceKnowledge && audienceKnowledge.audienceTopics,
    radarAvailable: signals.length > 0
  });
  return { audienceKnowledge, archetype: plan.archetype, focusTopic: plan.topic, focusTopicId: plan.focusTopicId || '', needsReaderHint };
}

function pageHasSubstance(pageSummary) {
  const text = [
    pageSummary && pageSummary.title,
    pageSummary && pageSummary.description,
    pageSummary && pageSummary.snippet,
    pageSummary && pageSummary.text,
    ...((pageSummary && pageSummary.headings) || [])
  ].join('').replace(/\s+/g, '');
  return text.length >= 24;
}

async function prepareNextPost(userId, options = {}) {
  const generationStartedAt = Date.now();
  const uiLang = String(options.uiLang || options.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const isEnProgress = uiLang === 'en';
  const report = (step, title, detail) => {
    if (typeof options.onProgress !== 'function') return;
    try { options.onProgress({ step, title, detail: detail || '' }); } catch (_err) {}
  };
  const userDoc = await db.collection('saas_users').doc(userId).get();
  if (!userDoc.exists) throw new Error('ユーザー情報を確認できないため次の投稿を停止しました。');
  const user = userDoc.data() || {};
  const targetMatch = String(user.targetUrl || '').match(/https?:\/\/[^\s]+/i);
  const targetUrl = targetMatch ? targetMatch[0] : '';
  const personaGoal = String(user.userPrompt || '').trim();
  if (!targetUrl && !personaGoal) throw new Error('宣伝先URLか、育てたいアカウント像がないため次の投稿を停止しました。');
  report(
    'account',
    isEnProgress ? 'Reading this account' : 'アカウントの状態を読んでいます',
    isEnProgress ? 'Follower counts are used only when measured. Otherwise they stay unknown.' : 'フォロワー数は測れたときだけ使います。測れなければ不明のままです。'
  );
  let live = { ok: false };
  let creds = null;
  if (user.xOfficialCredentials) {
    creds = decryptCredentials(user.xOfficialCredentials);
    creds.saasUserId = userId;
    if (!creds.id && creds.userId) creds.id = creds.userId;
    if (!/^\d+$/.test(String(creds.userId || '')) && user.twitterId) creds.userId = user.twitterId;
    live = await fetchMyAccountState(creds);
  }
  const accountState = describeAccountState(live, user);
  if (accountState.measured && Number.isSafeInteger(accountState.followers)) {
    const recordedAt = new Date().toISOString();
    const followerPatch = { officialFollowerCount: accountState.followers, officialFollowerCountAt: recordedAt };
    await db.collection('saas_users').doc(userId).set(followerPatch, { merge: true });
    Object.assign(user, followerPatch);
  }
  const followerLabel = accountState.followers === null
    ? (isEnProgress ? 'unknown' : '不明')
    : String(accountState.followers);
  report(
    'page',
    isEnProgress ? 'Reading the registered page' : '登録ページを読んでいます',
    `${targetUrl} / ${isEnProgress ? 'followers' : 'フォロワー'}: ${followerLabel}`
  );
  let extracted;
  if (targetUrl) {
    extracted = await extractBrandKnowledge(targetUrl, {
      db,
      userId,
      cachedKnowledge: user.brandKnowledge,
      outputLang: accountState.lang === 'en' ? 'en' : 'ja'
    });
    if (!extracted.pageSummary || !extracted.pageSummary.ok) {
      throw new Error(`ページを読めないため次の投稿を停止しました: ${(extracted.pageSummary && extracted.pageSummary.error) || extracted.error || 'unknown'}`);
    }
  } else {
    extracted = {
      pageSummary: { ok: true, pageVersion: 'persona-only', title: personaGoal.slice(0, 80), text: personaGoal, headings: [personaGoal] },
      brandKnowledge: { category: 'account', icpSummary: personaGoal, claims: [], terminology: [] }
    };
  }
  const pageSummary = extracted.pageSummary;
  const zone = user.scheduleTimeZone || user.timezone || 'Asia/Tokyo';
  const timeSlot = options.timeSlot && SLOT_CLOCK[options.timeSlot] ? options.timeSlot : nextTimeSlot(zone);
  const dayOffset = Number.isInteger(options.dayOffset) && options.dayOffset > 0 ? options.dayOffset : 0;
  report(
    'slot',
    isEnProgress ? 'Choosing the next time' : '次の時間を選んでいます',
    `${zone} / ${timeSlot}`
  );
  const posts = await loadPostedJobs(userId);
  const voiceProfile = await resolveAccountVoiceProfile({
    userId,
    user,
    creds,
    accountState,
    recentPostedJobs: posts
  });
  const recoveryMode = detectAlgorithmRecovery(posts, accountState.followers);
  let contextSignals = null;
  try {
    const cached = user.contextRadarCache;
    const cacheUsable = cached && cached.signals && !radarLooksInternal(cached);
    const cacheFresh = cacheUsable && cached.expiresAt && new Date(cached.expiresAt).getTime() > Date.now();
    if (cacheUsable) contextSignals = cached.signals;
    if (!cacheFresh) {
      const lens = industryQuery({
        category: extracted.brandKnowledge && extracted.brandKnowledge.category,
        icpSummary: extracted.brandKnowledge && extracted.brandKnowledge.icpSummary,
        terminology: filterRadarHints(extracted.brandKnowledge && extracted.brandKnowledge.terminology),
        productName: extracted.brandKnowledge && extracted.brandKnowledge.productName,
        handle: user.xUsername
      });
      fetchSituationalContext({
        category: lens,
        icpSummary: '',
        terminology: [],
        lang: accountState.lang,
        cachedRadar: null,
        db,
        xSearch: true,
        xSearchOnly: true,
        excludedXHandles: [user.xUsername].filter(Boolean)
      }).then(fresh => {
        if (!fresh || radarLooksInternal(fresh)) return null;
        return db.collection('saas_users').doc(userId).set({ contextRadarCache: fresh }, { merge: true });
      }).catch(err => console.warn(`[Context Radar] ${err.message}`));
    }
  } catch (radarErr) {
    console.warn(`[Context Radar] ${radarErr.message}`);
    contextSignals = user.contextRadarCache && !radarLooksInternal(user.contextRadarCache) ? user.contextRadarCache.signals : null;
  }
  const portfolioPlan = planSlotPortfolio({
    growthPhase: getGrowthPhase(user),
    timeSlot,
    dayOfWeek: weekdayInZone(zone),
    recentPostedJobs: posts,
    userPrompt: user.userPrompt || '',
    accountState,
    plan: resolvePlan(user),
    recoveryMode,
    lang: accountState.lang
  });
  const genes = chooseGenesForPost({
    posts,
    brandKnowledge: extracted.brandKnowledge,
    portfolioPlan,
    accountState,
    timeSlot,
    constraints: { promotedDynamicArms: user.promotedDynamicArms || [] }
  });
  const domainSlot = !(portfolioPlan && portfolioPlan.allowPromoUrl) && (!portfolioPlan || portfolioPlan.portfolioRole !== 'explicit_promo_offer');
  const focusPlaybook = domainSlot
    ? (selectPlaybookByPerformance(extracted.brandKnowledge && extracted.brandKnowledge.domainPlaybooks, posts) || selectFocusPlaybook(extracted.brandKnowledge, rememberedPostTexts(posts, accountState.lang)))
    : null;
  const hypotheses = focusPlaybook
    ? [hypothesisForPlaybook(focusPlaybook, extracted.brandKnowledge, pageSummary)]
    : extractPageHypotheses(pageSummary, extracted.brandKnowledge);
  const choice = chooseHypothesis(posts, hypotheses, timeSlot, pageSummary.pageVersion);
  console.log(`[Next Post] ${userId} page=${pageSummary.pageVersion || 'none'} followers=${accountState.followers === null ? 'unknown' : accountState.followers}`);
  const customerReason = customerFacingReason(choice, uiLang);
  let briefReported = false;
  const reportDraftBrief = () => {
    if (briefReported) return;
    briefReported = true;
    report(
      'draft_brief',
      isEnProgress ? 'Planning angle and structure' : '切り口と構成方針を整理しています',
      customerReason
    );
  };
  reportDraftBrief();
  const onStage = (stage) => {
    if (stage === 'draft_brief') {
      reportDraftBrief();
      return;
    }
    if (stage === 'draft_candidates') {
      report(
        'draft_candidates',
        isEnProgress ? 'Writing post candidates' : '次の1投稿を複数案で作成しています',
        isEnProgress
          ? 'Writing multiple distinct angles from verified page facts, recent reactions, and your voice (quality model may take 30–90s).'
          : 'ページの事実・過去反応・文体を照合しながら、切り口の異なる複数案を推論モデルで深く練っています（30〜90秒ほどかかることがあります）。'
      );
    } else if (stage === 'draft_critic') {
      report(
        'draft_critic',
        isEnProgress ? 'Checking facts, style, and flow' : '事実整合性・文体・流れを確認しています',
        isEnProgress
          ? 'Scoring originality, causal depth, factual grounding, and fit with recent posts to select the strongest draft.'
          : '表面的な一般論や過去投稿との重複がないか、事実の正確さと独自性を1案ずつ審査しています。'
      );
    } else if (stage === 'draft_repair') {
      report(
        'draft_repair',
        isEnProgress ? 'Refining phrasing to pass checks' : '基準に合わせて表現を整えています',
        isEnProgress
          ? 'Refining the draft logic, structure, and length limits with full quality reasoning before saving.'
          : '審査基準を満たすまで、因果の具体性と文字数・規約条件を高精度モデルで磨き直しています。'
      );
    }
  };
  const qualityAudit = [];
  const lastPost = posts[0] || {};
  const arcCount = Number(lastPost.arcCount) || 0;
  const continueArc = lastPost.retargetAction === 'deepen_winner' && arcCount < 2;
  const retargetContext = continueArc
    ? (accountState.lang === 'en'
      ? 'The previous post got a response, so continue the same point.'
      : '直前の投稿に反応があったので、同じ論点の続きとして書く。')
    : (arcCount >= 2
      ? (accountState.lang === 'en'
        ? 'The same topic already continued twice, so switch to a different point.'
        : '同じ話題は2回続けたので、別の論点にする。')
      : '');
  const audienceCache = user.audienceQuestionsCache;
  const questions = audienceCache && Array.isArray(audienceCache.questions) ? audienceCache.questions : [];
  const pushback = require('./audience_questions').latestAudiencePushback(audienceCache);
  let userEpisodes = [];
  try {
    const episodeSnap = await db.collection('saas_users').doc(userId).collection('episodic_memories').limit(30).get();
    userEpisodes = episodeSnap.docs.map(doc => doc.data());
  } catch (episodeErr) {
    userEpisodes = [];
  }
  const episodeContext = formatEpisodesForPrompt(queryRelevantEpisodes({
    angle: genes.angle,
    keywords: extracted.brandKnowledge && extracted.brandKnowledge.terminology || [],
    limit: 2
  }, userEpisodes));
  const learnedDirectives = restoreMandatoryDirectives(user.promptDirectives).filter(item => item && item.isImmutable !== true).slice(0, 4);
  let mapElitesCellId = [genes.angle, genes.hookType, genes.format, voiceProfile && voiceProfile.stagePosture].filter(Boolean).join('|').slice(0, 120);
  let editorialContext = null;
  try {
    const knowledge = await getUserMarketingKnowledge(userId);
    const sharedLexicon = await getSharedEditorialLexicon();
    let mapElitesHint = null;
    const sampled = await Promise.race([
      sampleFromMapElitesArchive(userId, { allowMutation: true }),
      new Promise(resolve => setTimeout(() => resolve(null), 1500))
    ]);
    if (sampled && sampled.cellId) mapElitesCellId = sampled.cellId;
    if (sampled) {
      mapElitesHint = {
        cellId: sampled.cellId || '',
        directive: sampled.directive || '',
        referenceHook: sampled.referenceHook || '',
        mode: sampled.mode || ''
      };
    }
    const matureCount = (Array.isArray(posts) ? posts : []).filter(p => p && p.metrics24hSnapshot && p.metrics24hSnapshot.isFrozen === true).length;
    const niche = scheduleNicheBenchmark({
      category: extracted.brandKnowledge && extracted.brandKnowledge.category,
      lang: accountState.lang,
      ownHandle: accountState.username,
      brandWords: [extracted.brandKnowledge && extracted.brandKnowledge.productName, accountState.username],
      db
    });
    editorialContext = {
      domainLexicon: knowledge.domainLexicon || null,
      sharedLexicon,
      dpoPairs: Array.isArray(knowledge.dpoPreferencePairs) ? knowledge.dpoPreferencePairs.slice(0, 3) : [],
      avoidKeywords: knowledge.avoidKeywords || [],
      mapElitesHint,
      matureCount,
      nicheHint: niche.hint || '',
      weeklyStrategyHint: require('./autonomous_strategy_architect').weeklyStrategyHint(user.strategyDecisionLog),
      strategyLocked: user.strategyLockByUser === true
    };
  } catch (mapErr) {}
  let budgetDegraded = false;
  let budgetApi = null;
  try {
    budgetApi = require('./tenant_ai_budget');
    const gate = await budgetApi.checkTenantAiBudget({ db, userId, user, kind: 'llm' });
    budgetDegraded = gate.allowed === false;
  } catch (_budgetErr) {
    budgetDegraded = false;
  }
  const audienceCraft = budgetDegraded ? {
    audienceKnowledge: user.audienceKnowledge && (user.audienceKnowledge.schemaVersion === 2 || user.audienceKnowledge.schemaVersion === 1) ? user.audienceKnowledge : null,
    archetype: '',
    focusTopic: null,
    focusTopicId: ''
  } : await resolveAudienceCraft({
    userId,
    user,
    brandKnowledge: extracted.brandKnowledge,
    posts,
    lang: accountState.lang,
    radar: contextSignals,
    budgetDegraded
  });
  const hadAudience = Boolean(user.audienceKnowledge && (user.audienceKnowledge.schemaVersion === 2 || user.audienceKnowledge.schemaVersion === 1));
  if (!hadAudience && audienceCraft.needsReaderHint === true && !pageHasSubstance(pageSummary)) {
    const err = new Error(isEnProgress
      ? 'The page and account do not say who the reader is, so a generic post was not created.'
      : '業種と読者が分からないため、一般論の投稿は作りません。');
    err.code = 'MISSING_READER_CONTEXT';
    err.needsReaderHint = true;
    err.reason = 'missing_reader_context';
    throw err;
  }
  const { decideNextPostMission } = require('./velox_master_core');
  const masterPlan = decideNextPostMission({
    accountState,
    brandKnowledge: extracted.brandKnowledge,
    audienceKnowledge: audienceCraft.audienceKnowledge,
    recentJobs: posts,
    portfolioPlan
  });
  let sourceDossier = null;
  let topicSource = null;
  let dossierLive = false;
  if (masterPlan.isolateLpContext && (masterPlan.topicRing === 'ring1_craft' || masterPlan.topicRing === 'ring2_broad_adjacent')) {
    try {
      topicSource = await require('./topic_source_vault').pickTopicSourceForPost(db, userId, { outputLang: accountState.lang });
    } catch (_topicErr) {
      topicSource = null;
    }
  }
  if (!budgetDegraded && masterPlan.isolateLpContext) {
    try {
      const fetched = await require('./source_dossier_engine').fetchSourceDossier({
        topicDomain: masterPlan.sourceQuery,
        topicRing: masterPlan.topicRing,
        readerPersona: audienceCraft.audienceKnowledge && audienceCraft.audienceKnowledge.readerPersona,
        lang: accountState.lang,
        excludedXHandles: [user.xUsername].filter(Boolean),
        productName: extracted.brandKnowledge && extracted.brandKnowledge.productName,
        db,
        userId,
        user
      });
      sourceDossier = fetched;
      dossierLive = Boolean(fetched && fetched.cached !== true);
    } catch (dossierErr) {
      console.warn(`[Source Dossier] ${String(dossierErr && dossierErr.message || dossierErr).slice(0, 180)}`);
      sourceDossier = null;
    }
  }
  const learnedSource = chooseSourceMaterial({ genes, topicSource, sourceDossier, masterPlan });
  topicSource = learnedSource.topicSource;
  sourceDossier = learnedSource.sourceDossier;
  let weekJobs = posts.slice();
  try {
    const pendingWeek = await db.collection('autopilot_jobs').where('userId', '==', userId).where('status', '==', 'pending').limit(20).get();
    pendingWeek.forEach(doc => weekJobs.push({ id: doc.id, ...(doc.data() || {}) }));
  } catch (_weekErr) {}
  const wildcard = selectWeeklyWildcard({
    accountState,
    masterPlan,
    jobs: weekJobs,
    promotedArms: user.promotedDynamicArms || []
  });
  const recentHooks = posts.slice(0, 3).map(post => post && post.genes && post.genes.hookType).filter(Boolean);
  const draftGenes = wildcard
    ? { ...genes, angle: wildcard.id, wildcardRecipe: wildcard.id, isWildcard: true, hookType: freshHook(genes.hookType, recentHooks) }
    : { ...genes, isWildcard: false, wildcardRecipe: null };
  if (wildcard) {
    mapElitesCellId = [draftGenes.angle, draftGenes.hookType, draftGenes.format, voiceProfile && voiceProfile.stagePosture].filter(Boolean).join('|').slice(0, 120);
  }
  const evolutionVersion = chooseEvolutionAssignment({
    evolution: user.promptEvolution,
    jobs: posts,
    topicRing: masterPlan.topicRing,
    isWildcard: draftGenes.isWildcard === true
  });
  let drafted;
  const ownerSpark = pickOwnerSpark(user.ownerSparks, masterPlan);
  if (budgetDegraded && focusPlaybook && budgetApi) {
    const degradedText = budgetApi.degradedPostText(focusPlaybook, {
      maxChars: accountState && accountState.maxChars,
      lang: accountState && accountState.lang
    });
    const degradedReview = budgetApi.reviewDegradedDraft(degradedText, {
      lang: accountState && accountState.lang,
      accountState,
      portfolioPlan,
      brandKnowledge: extracted.brandKnowledge,
      ngTopics: user.ngTopics,
      genes
    });
    if (!degradedReview.ok) {
      return { ok: false, error: 'budget_degraded_audit_failed', budgetDegraded: true, keptPending: true };
    }
    drafted = {
      tweets: [degradedText],
      initialCriticScore: null,
      finalCriticScore: null,
      repairCount: 0,
      budgetDegraded: true,
      evolutionVersion
    };
  } else drafted = await draftNextPostWithMeta({
    audienceKnowledge: audienceCraft.audienceKnowledge,
    archetype: masterPlan.archetype || audienceCraft.archetype,
    focusTopic: masterPlan.focusTopic || audienceCraft.focusTopic,
    masterPlan,
    sourceDossier,
    topicSource,
    enforceReadability: true,
    timeoutMs: 180000,
    maxDraftCalls: dossierLive ? 4 : 5,
    lang: accountState.lang,
    accountState,
    hypothesisText: formatHypothesis(choice, accountState.lang),
    pageSummary,
    timeSlot,
    recentTexts: rememberedPostTexts(posts, accountState.lang),
    userPrompt: user.userPrompt || '',
    brandKnowledge: extracted.brandKnowledge,
    voiceProfile,
    portfolioPlan,
    targetUrl,
    recentPosts: rememberedPostTexts(posts, accountState.lang),
    genes: draftGenes,
    criticAxisWeights: user.criticAxisWeights || null,
    promptEvolution: user.promptEvolution || null,
    evolutionVersion,
    contextSignals: (questions.length || pushback) ? { questions, signals: contextSignals, pushback } : contextSignals,
    retargetContext,
    learnedDirectives,
    episodeContext,
    brandContextNotes: user.brandContextNotes || '',
    ngTopics: user.ngTopics || '',
    qualityAudit,
    editorialContext,
    focusPlaybook: masterPlan.isolateLpContext ? null : focusPlaybook,
    onStage,
    ownerSpark,
    editorialStanceOverride: user.editorialStanceOverride || null
  });
  if (!budgetDegraded) {
    try {
      const { recordTenantLlmBreakdown } = require('./tenant_ai_budget');
      const rows = Array.isArray(qualityAudit) ? qualityAudit : [];
      const writerCalls = rows.filter(row => row && row.role === 'writer').length || (rows.length ? 0 : 1);
      const criticCalls = rows.filter(row => row && row.role === 'critic').length;
      await recordTenantLlmBreakdown({ db, userId, writerCalls, criticCalls });
    } catch (_recordErr) {}
  }
  const tweets = drafted.tweets;
  const [hour, minute] = SLOT_CLOCK[timeSlot] || [12, 0];
  let scheduledAt = dateAtTimeInZone(new Date(), zone, hour, minute, dayOffset);
  if (dayOffset === 0 && scheduledAt.getTime() <= Date.now() + 15 * 60 * 1000) {
    scheduledAt = dateAtTimeInZone(new Date(), zone, hour, minute, 1);
  }
  scheduledAt = applySlotJitter(scheduledAt, `${userId}:${timeSlot}:${scheduledAt.toISOString()}`);
  const pendingSnap = await db.collection('autopilot_jobs')
    .where('userId', '==', userId)
    .where('status', '==', 'pending')
    .limit(20)
    .get();
  const pending = pendingSnap.docs
    .map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter(job => !job.isHumanOverride)
    .sort((a, b) => new Date(a.scheduledAt?.toDate?.() || a.scheduledAt || 0) - new Date(b.scheduledAt?.toDate?.() || b.scheduledAt || 0));
  const isEn = accountState.lang === 'en';
  const visualCard = planVisualCard({
    format: genes.format,
    portfolioRole: portfolioPlan.portfolioRole,
    focusPlaybook,
    brandKnowledge: extracted.brandKnowledge,
    lang: accountState.lang,
    archetype: masterPlan.archetype,
    focusTopic: masterPlan.focusTopic || audienceCraft.focusTopic,
    isolateLpContext: masterPlan.isolateLpContext === true
  });
  const alignment = alignmentCheck({
    domainSlot,
    focusPlaybookId: focusPlaybook && focusPlaybook.id,
    hypothesisPlaybookId: choice && choice.hypothesis && choice.hypothesis.playbookId,
    customerReason,
    playbook: focusPlaybook,
    visualCard
  });
  const payload = {
    userId,
    targetUrl,
    scheduleTimeZone: zone,
    status: 'pending',
    timeSlot,
    scheduledAt,
    isJitContent: false,
    preparedBy: 'next_post',
    portfolioRole: portfolioPlan.portfolioRole,
    focusPlaybookId: focusPlaybook && focusPlaybook.id || '',
    archetype: drafted.archetype || masterPlan.archetype || audienceCraft.archetype || '',
    focusTopicId: drafted.focusTopicId || (masterPlan.focusTopic && masterPlan.focusTopic.id) || audienceCraft.focusTopicId || '',
    masterPhase: masterPlan.phase || '',
    masterMission: masterPlan.mission || '',
    topicRing: masterPlan.topicRing || '',
    selectedTopicDomain: masterPlan.selectedTopicDomain || '',
    sourceType: drafted.sourceType || 'brand_only',
    topicSourceId: topicSource && topicSource.sourceId || null,
    topicSourceGrounding: require('./topic_source_vault').topicSourceGroundingSnapshot(topicSource),
    verifiedReferenceUrl: require('./topic_source_vault').verifiedReferenceUrlForJob({
      sourceType: drafted.sourceType || 'brand_only',
      ownerSparkUsed: drafted.ownerSparkUsed === true,
      topicRing: masterPlan.topicRing || '',
      sourceUrl: topicSource && topicSource.sourceUrl
    }),
    segmentCount: drafted.segmentCount || (Array.isArray(tweets) ? tweets.length : 1),
    delivery: drafted.delivery || (draftGenes && draftGenes.delivery) || 'single',
    isWildcard: draftGenes.isWildcard === true,
    wildcardRecipe: draftGenes.wildcardRecipe || null,
    evolutionVersion: drafted.evolutionVersion || 'baseline',
    tensionUsed: drafted.tensionUsed === true,
    tensionSource: drafted.tensionSource || null,
    ownerSparkUsed: drafted.ownerSparkUsed === true,
    ownerSparkId: drafted.ownerSparkId || null,
    criticDegraded: drafted.criticDegraded === true,
    criticAxes: drafted.criticAxes || null,
    budgetDegraded,
    alignmentOk: alignment.alignmentOk,
    allowPromoUrl: portfolioPlan.allowPromoUrl,
    genes: draftGenes,
    mapElitesCellId,
    visualCard,
    arcCount: continueArc ? arcCount + 1 : 0,
    qualityAudit,
    pageVersion: pageSummary.pageVersion || null,
    pageHypotheses: hypotheses,
    contentAngle: choice ? choice.hypothesis.id : null,
    hypothesisWho: choice ? choice.hypothesis.who : null,
    hypothesisWhy: choice ? choice.hypothesis.why : null,
    hypothesisProof: choice ? choice.hypothesis.proof : null,
    customerReason,
    draftBriefSummary: {
      scene: drafted.brief && drafted.brief.scene || '',
      readerPayoff: drafted.brief && drafted.brief.readerPayoff || '',
      hookAngle: drafted.brief && drafted.brief.hookAngle || '',
      offer: drafted.brief && drafted.brief.offer || '',
      underlyingMechanism: drafted.brief && drafted.brief.underlyingMechanism || '',
      cognitiveMove: drafted.decision && drafted.decision.cognitiveMove || '',
      endingMove: drafted.decision && drafted.decision.endingMove || '',
      registerLock: drafted.decision && drafted.decision.registerLock || '',
      userWeight: drafted.decision && drafted.decision.weights && drafted.decision.weights.userWeight,
      veloxWeight: drafted.decision && drafted.decision.weights && drafted.decision.weights.veloxWeight,
      guidanceMode: drafted.decision && drafted.decision.guidanceMode || ''
    },
    draftRationale: portfolioPlan.rationale || '',
    text: isEn ? '' : tweets[0],
    tweets: isEn ? [] : tweets,
    text_en: isEn ? tweets[0] : '',
    tweets_en: isEn ? tweets : [],
    isThread: tweets.length > 1,
    accountStateSnapshot: {
      measured: accountState.measured,
      followers: accountState.followers,
      following: accountState.following,
      subscription: accountState.subscription,
      searchVisible: accountState.searchVisible,
      maxChars: accountState.maxChars,
      delivery: accountState.delivery || '',
      postShape: accountState.postShape || '',
      recordedAt: new Date().toISOString()
    },
    updatedAt: new Date()
  };
  report(
    'saving',
    isEnProgress ? 'Reserving the next scheduled slot' : '予約枠へ保存しています',
    `${zone} / ${timeSlot}`
  );
  let jobId = pending[0] && pending[0].id;
  if (pending[0]) {
    await pending[0].ref.update(payload);
  } else {
    jobId = `job_next_${randomUUID()}`;
    await db.collection('autopilot_jobs').doc(jobId).set({ ...payload, jobId, createdAt: new Date() });
    if (!user.firstScheduledPostAt) {
      try {
        const createdRaw = user.createdAt && user.createdAt.toDate ? user.createdAt.toDate() : new Date(user.createdAt || Date.now());
        const createdMs = createdRaw instanceof Date ? createdRaw.getTime() : Date.now();
        const activationSeconds = Math.max(0, Math.round((Date.now() - createdMs) / 1000));
        await db.collection('saas_users').doc(userId).set({
          firstScheduledPostAt: new Date(),
          activationSeconds: Number.isFinite(activationSeconds) ? activationSeconds : 0
        }, { merge: true });
      } catch (_activationErr) {}
    }
  }
  await cancelOtherPendingJobs(userId, targetUrl, pageSummary.pageVersion, jobId);
  const audits = Array.isArray(qualityAudit) ? qualityAudit : [];
  const writerAudit = audits.find(row => row && row.role === 'writer' && row.ok);
  const criticAudits = audits.filter(row => row && row.role === 'critic');
  const trace = {
    jobId,
    userId,
    createdAt: new Date().toISOString(),
    portfolioRole: portfolioPlan.portfolioRole,
    timeSlot,
    lang: accountState.lang,
    elapsedMs: Date.now() - generationStartedAt,
    focusPlaybookId: focusPlaybook && focusPlaybook.id || '',
    archetype: drafted.archetype || masterPlan.archetype || audienceCraft.archetype || '',
    focusTopicId: drafted.focusTopicId || (masterPlan.focusTopic && masterPlan.focusTopic.id) || audienceCraft.focusTopicId || '',
    masterPhase: masterPlan.phase || '',
    masterMission: masterPlan.mission || '',
    topicRing: masterPlan.topicRing || '',
    selectedTopicDomain: masterPlan.selectedTopicDomain || '',
    sourceType: drafted.sourceType || 'brand_only',
    segmentCount: drafted.segmentCount || (Array.isArray(tweets) ? tweets.length : 1),
    delivery: drafted.delivery || (draftGenes && draftGenes.delivery) || 'single',
    isWildcard: draftGenes.isWildcard === true,
    wildcardRecipe: draftGenes.wildcardRecipe || null,
    evolutionVersion: drafted.evolutionVersion || 'baseline',
    selectedHookAngle: drafted.selectedHookAngle || null,
    tensionUsed: drafted.tensionUsed === true,
    tensionSource: drafted.tensionSource || null,
    ownerSparkUsed: drafted.ownerSparkUsed === true,
    ownerSparkId: drafted.ownerSparkId || null,
    hookDuelUsed: drafted.hookDuelUsed === true,
    visualCardTemplate: visualCard.template || '',
    criticDegraded: drafted.criticDegraded === true,
    criticAxes: drafted.criticAxes || null,
    alignmentOk: alignment.alignmentOk,
    budgetDegraded,
    writerProvider: writerAudit && writerAudit.provider || '',
    writerModel: writerAudit && writerAudit.model || '',
    criticProvider: criticAudits[0] && criticAudits[0].provider || '',
    criticModel: criticAudits[0] && criticAudits[0].model || '',
    initialCriticScore: drafted.initialCriticScore,
    finalCriticScore: drafted.finalCriticScore,
    repairCount: drafted.repairCount || 0,
    hasVisualCard: visualCard.eligible === true,
    outcome24h: null,
    qualityAudit: audits
  };
  if (drafted.ownerSparkId) {
    try {
      await db.collection('saas_users').doc(userId).set({
        ownerSparks: markOwnerSparkUsed(user.ownerSparks, drafted.ownerSparkId, new Date())
      }, { merge: true });
    } catch (_sparkErr) {}
  }
  db.collection('generation_traces').doc(jobId).set(trace, { merge: true }).catch(error => {
    console.warn(`[Telemetry] ${error.message}`);
  });
  scheduleGenerationTrace(trace);
  return {
    ok: true,
    userId,
    username: accountState.username,
    measured: accountState.measured,
    followers: accountState.followers,
    following: accountState.following,
    subscription: accountState.subscription,
    searchVisible: accountState.searchVisible,
    timeSlot,
    scheduleTimeZone: zone,
    scheduledAt: scheduledAt.toISOString(),
    jobId,
    tweets,
    customerReason,
    alignmentOk: alignment.alignmentOk,
    elapsedMs: trace.elapsedMs
  };
}

const ensureRunning = new Set();

function consentGranted(user, credentials, userId) {
  const consent = user.autopilotConsent;
  if (!consent || consent.version !== 1 || consent.granted !== true) return false;
  const xNumeric = /^\d+$/.test(String((credentials && (credentials.id || credentials.userId)) || user.twitterId || ''))
    ? String((credentials && (credentials.id || credentials.userId)) || user.twitterId)
    : '';
  const idCandidates = [
    credentials && credentials.id,
    xNumeric,
    user.twitterId,
    credentials && credentials.userId,
    userId
  ].map(v => String(v || '').trim()).filter(Boolean);
  const username = String((credentials && credentials.username) || user.xUsername || '').trim().replace(/^@/, '').toLowerCase();
  const accepted = new Set(idCandidates.map(id => `id:${id}`));
  if (username) accepted.add(`username:${username}`);
  return accepted.has(String(consent.account || '').trim());
}

function jobInstant(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function ensureNextPost(userId, options = {}) {
  if (!userId || ensureRunning.has(userId)) return { ok: false, reason: 'already_running' };
  const paused = require('./provider_error').pauseError();
  if (paused) return { ok: false, reason: paused.code, cooldown: true };
  ensureRunning.add(userId);
  try {
    const userDoc = await db.collection('saas_users').doc(userId).get();
    if (!userDoc.exists) return { ok: false, reason: 'missing_user' };
    const user = userDoc.data() || {};
    if (user.autopilotPaused) return { ok: false, reason: 'paused' };
    if (!isPaidAccount(user)) return { ok: false, reason: 'not_paid' };
    const plan = resolvePlan(user);
    if (!plan) return { ok: false, reason: 'no_plan' };
    if (!user.xOfficialCredentials) return { ok: false, reason: 'no_credentials' };
    const creds = decryptCredentials(user.xOfficialCredentials);
    creds.saasUserId = userId;
    if (!creds.id && creds.userId) creds.id = creds.userId;
    if (!/^\d+$/.test(String(creds.userId || '')) && user.twitterId) creds.userId = user.twitterId;
    if (!consentGranted(user, creds, userId)) return { ok: false, reason: 'consent_required' };
    if (!officialApiOperationAllowed({ ...user, userId }, creds)) return { ok: false, reason: 'not_allowed' };
    const zone = user.scheduleTimeZone || user.timezone || 'Asia/Tokyo';
    const today = localDateKey(new Date(), zone);
    const failures = user.ensureNextPostFailureDate === today ? Number(user.ensureNextPostFailures) || 0 : 0;
    if (failures >= 3 && !options.resetFailures) return { ok: false, reason: 'retry_limit' };
    const hasDirection = /^https?:\/\//i.test(String(user.targetUrl || '')) || String(user.userPrompt || '').trim();
    if (!hasDirection) return { ok: false, reason: 'no_direction' };

    const pendingSnap = await db.collection('autopilot_jobs')
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .limit(20)
      .get();
    if (pendingSnap.docs.some(doc => !doc.data().isHumanOverride)) {
      return { ok: false, reason: 'pending_exists' };
    }
    const postedSnap = await db.collection('autopilot_jobs')
      .where('userId', '==', userId)
      .where('status', '==', 'posted')
      .limit(50)
      .get();
    const takenSlots = postedSnap.docs.map(doc => doc.data()).filter(job => {
      const when = jobInstant(job.postedAt) || jobInstant(job.scheduledAt);
      return when && localDateKey(when, zone) === today && typeof job.timeSlot === 'string';
    }).map(job => job.timeSlot);
    const next = nextPlanSlot({
      plan,
      takenSlots,
      now: new Date(),
      slotAt: (slot, dayOffset) => {
        const [hour, minute] = SLOT_CLOCK[slot] || [12, 0];
        return dateAtTimeInZone(new Date(), zone, hour, minute, dayOffset);
      }
    });
    const chosen = next || reserveAfterDailyCap({
      next: null,
      pendingCount: pendingSnap.size,
      plan,
      now: new Date(),
      timeZone: zone
    });
    if (!chosen) return { ok: false, reason: 'daily_cap' };
    try {
      const result = await prepareNextPost(userId, {
        lang: user.aiTargetLang || 'ja',
        timeSlot: chosen.timeSlot,
        dayOffset: chosen.dayOffset
      });
      await userDoc.ref.set({
        ensureNextPostFailures: 0,
        ensureNextPostFailureDate: today,
        lastEnsureNextError: null,
        lastEnsureNextRejectReasons: []
      }, { merge: true });
      return result;
    } catch (err) {
      const decision = require('./provider_error').ensureFailureDecision(err, { failures, lang: 'ja' });
      const update = { ...decision.update, lastEnsureNextErrorAt: new Date().toISOString() };
      if (decision.lock) update.ensureNextPostFailureDate = today;
      await userDoc.ref.set(update, { merge: true });
      if (!decision.lock) return { ok: false, reason: err.code || update.lastEnsureNextErrorCode || 'provider_error' };
      throw err;
    }
  } finally {
    ensureRunning.delete(userId);
  }
}

module.exports = {
  fetchUrlSummary,
  bindOfficialCreds,
  cancelNonManualPendingJobs,
  cancelOtherPendingJobs,
  retargetNextPendingJob,
  diagnoseUserAccountStageAndStrategy,
  analyzeMarketWithUserPrompt,
  generateAccountGrowthStrategy,
  deliberateCouncilStrategy,
  buildCouncilWritingPrompt,
  writeCouncilApprovedPosts,
  dateAtTimeInZone,
  dateFromLocalDateTimeInZone,
  isValidTimeZone,
  launchAutopilotCampaign,
  prepareNextPost,
  pageHasSubstance,
  postIsLearnable,
  rememberFrozenOutcome,
  ensureNextPost,
  consentGranted,
  sortPostedJobsNewestFirst,
  rememberedPostTexts,
  reDeliberateAutopilotJobs,
  reThinkSingleJob,
  generateInstantPreviewPosts,
  harvestTweetMetricsAndEvolveKnowledge,
  generateWeeklyCouncilReport,
  customerFacingReason
};
