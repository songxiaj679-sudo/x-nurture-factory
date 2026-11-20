function normalizeHandle(value) {
  const handle = typeof value === 'string' ? value.replace(/^@/, '').toLowerCase() : '';
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function isMatchingDiagnosis(user, diagnosis) {
  const handle = normalizeHandle(user.xUsername);
  return Boolean(handle && handle === normalizeHandle(diagnosis?.username) &&
    diagnosis.hasOfficialData === true && diagnosis.followersMeasured === true &&
    Number.isSafeInteger(diagnosis.followers) && diagnosis.followers >= 0);
}

function trustHandle(user, diagnosis) {
  return isMatchingDiagnosis(user, diagnosis) &&
    (diagnosis.stage === 'STAGE_1_TRUST_BUILDING' || diagnosis.followers < 100)
    ? normalizeHandle(user.xUsername) : null;
}

function measuredFollowers(user = {}) {
  if (Number.isSafeInteger(user.officialFollowerCount) && user.officialFollowerCount >= 0) return user.officialFollowerCount;
  const diagnosis = user.latestMarketingStrategy?.accountDiagnosis;
  return isMatchingDiagnosis(user, diagnosis) ? diagnosis.followers : null;
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function operatingPosture(user = {}, sample = {}) {
  const followers = finiteCount(sample.followers) != null ? finiteCount(sample.followers) : measuredFollowers(user);
  const avgViews = finiteCount(sample.avgImpressions != null ? sample.avgImpressions : user.recentAvgImpressions);
  const maxViews = finiteCount(sample.maxImpressions != null ? sample.maxImpressions : (user.recentMaxImpressions != null ? user.recentMaxImpressions : user.trustViewGoal && user.trustViewGoal.impressions));
  const bookmarkRate = finiteCount(sample.bookmarkRate != null ? sample.bookmarkRate : user.recentBookmarkRate);
  const hasUrl = /^https?:\/\//i.test(String(user.targetUrl || ''));
  const persona = String(user.userPrompt || '');
  const wantsPromo = user.promoPreference === 'include' || /【PR】|宣伝して|紹介を交/.test(persona);
  const observed = avgViews != null ? avgViews : maxViews;
  const nextViews = Math.min(800, Math.max(80, Math.ceil(((observed || 40) * 2) / 10) * 10));
  const stable = observed != null && observed >= 150;
  const allowPromo = Boolean(hasUrl && (wantsPromo || stable));
  const en = user.uiLang ? user.uiLang === 'en' : user.aiTargetLang === 'en';
  const followerText = followers == null
    ? (en ? 'follower count is not measured yet' : 'フォロワー数はまだ測れていません')
    : (en ? `${followers} followers` : `フォロワー${followers}名`);
  const viewText = observed == null
    ? (en ? 'recent views are not measured yet' : '直近の表示回数はまだ測れていません')
    : (en
      ? `recent posts average about ${Math.round(observed)} views${maxViews == null ? '' : `, with a peak of ${Math.round(maxViews)}`}`
      : `直近投稿の表示は平均およそ${Math.round(observed)}回${maxViews == null ? '' : `（最大${Math.round(maxViews)}回）`}`);
  const situation = en
    ? `This account currently has ${followerText}. ${viewText}.`
    : `現在は${followerText}。${viewText}。`;
  const goal = en
    ? `The current goal is to steady recent posts around ${Math.round(nextViews * 0.6)}–${nextViews} views and a bookmark rate of at least 2%, enough to see which angles earn saves.`
    : `当面の目標は、直近投稿で表示${Math.round(nextViews * 0.6)}〜${nextViews}回とブックマーク率2%以上を安定させ、反応が取れる切り口を見極めることです。`;
  let approach;
  if (!hasUrl) {
    approach = en
      ? 'No page URL is registered, so posts follow the account direction you wrote and do not add a PR link.'
      : '宣伝ページは未登録のため、書いたアカウント像に沿った知見の発信に絞り、PRリンクは付けません。';
  } else if (allowPromo) {
    approach = en
      ? 'A page is registered, and either recent views have settled or you asked for introductions, so a small share of posts can add a marked PR reply.'
      : 'ページは登録済みで、反応が安定しているか紹介を希望しているため、無理のない比率で【PR】の返信枠を混ぜます。';
  } else {
    approach = en
      ? 'A page is registered, but recent views are still early, so posts lead with useful notes and hold the promotion link.'
      : 'ページは登録済みですが、表示はまだ立ち上がり段階のため、実務で役立つ一次情報を中心にし、宣伝リンクは抑えます。';
  }
  return {
    allowPromo,
    hasUrl,
    followers,
    viewImpressions: maxViews,
    avgViews: observed,
    bookmarkRate,
    nextViews,
    met: allowPromo,
    unlocked: allowPromo,
    situation,
    goal,
    approach
  };
}

function trustGoalStatus(user = {}) {
  return operatingPosture(user);
}

function formatPlanLabel(rawPlan, en) {
  const raw = String(rawPlan || '').trim().toLowerCase().replace(/[.。]+$/g, '');
  if (!raw || raw === 'null' || raw === 'undefined' || raw === 'unknown' || raw === 'unmeasured') {
    return en ? 'X plan not measured' : 'Xプランは未取得';
  }
  if (raw === 'none' || raw === 'free') return en ? 'Standard plan' : '通常プラン';
  if (raw === 'basic') return en ? 'Standard-length X plan' : '通常プラン（短文枠）';
  if (raw === 'premium' || raw === 'premium_plus' || raw === 'premiumplus' || raw === 'premium+' || raw === 'super' || raw === 'paid') {
    return en ? 'Paid X plan (long posts)' : 'X有料プラン（長文対応）';
  }
  return en ? 'X plan not measured' : 'Xプランは未取得';
}

const MOVE_LABELS = {
  ja: {
    mechanism_translation: '仕組みを日常のイメージに落とす型',
    inversion_contrast: '通説と実際の構造を対比する型',
    constraint_boundary: '適用限界とトレードオフを示す型',
    practitioner_rule: '判断基準を一つに絞る型',
    micro_observation: '細部の実例から原理を出す型',
    verdict_cut: '核心を言い切る締め',
    condition_edge: '例外条件で止める締め',
    concrete_check: '確認対象を一つ示して終える締め',
    genuine_tension: '判断が割れる問いを一つ置く締め'
  },
  en: {
    mechanism_translation: 'a plain picture of the mechanism',
    inversion_contrast: 'a contrast between the usual assumption and the real structure',
    constraint_boundary: 'the boundary where the approach breaks',
    practitioner_rule: 'one decision rule',
    micro_observation: 'a principle drawn from one concrete detail',
    verdict_cut: 'a direct closing line',
    condition_edge: 'an exception that stops the rule',
    concrete_check: 'one concrete thing to check',
    genuine_tension: 'one real point of tension'
  }
};

function moveLabel(id, en) {
  const table = en ? MOVE_LABELS.en : MOVE_LABELS.ja;
  return table[id] || '';
}

function buildAdvisoryCoaching({ user = {}, matureCount = 0, weights = null, domainLexicon = null, dpoPairs = [], sharedLexicon = null, nextJob = null, uiLang = 'ja' } = {}) {
  const en = uiLang === 'en';
  const { computeGuidanceWeights } = require('./editorial_lexicon_engine');
  const balance = weights || computeGuidanceWeights({ matureCount, strategyLocked: user.strategyLockByUser === true });
  const guidanceBalance = en
    ? (balance.phase === 'calibrate'
      ? `Calibration phase (Your direction ${balance.userWeight}% / VELOX baseline ${balance.veloxWeight}%)`
      : balance.phase === 'lead'
        ? `Leading phase (Your direction ${balance.userWeight}% / VELOX baseline ${balance.veloxWeight}%)`
        : balance.phase === 'lead_locked'
          ? `Locked direction phase (Your direction ${balance.userWeight}% / VELOX baseline ${balance.veloxWeight}%)`
          : `Observing phase (Your direction ${balance.userWeight}% / VELOX baseline ${balance.veloxWeight}%)`)
    : (balance.phase === 'calibrate'
      ? `学習検証期（お客様の方針 ${balance.userWeight}% ／ VELOX基本設計 ${balance.veloxWeight}%）`
      : balance.phase === 'lead'
        ? `自立運用期（お客様の方針 ${balance.userWeight}% ／ VELOX基本設計 ${balance.veloxWeight}%）`
        : balance.phase === 'lead_locked'
          ? `方針固定の自立運用期（お客様の方針 ${balance.userWeight}% ／ VELOX基本設計 ${balance.veloxWeight}%）`
          : `立ち上げ観測期（お客様の方針 ${balance.userWeight}% ／ VELOX基本設計 ${balance.veloxWeight}%）`);
  const brief = nextJob && nextJob.draftBriefSummary || {};
  const moveText = moveLabel(brief.cognitiveMove, en);
  const endingText = moveLabel(brief.endingMove, en);
  const nextMovePreview = moveText || endingText
    ? (en
      ? `The next post checks ${moveText || 'the prepared form'} and closes with ${endingText || 'the prepared ending'}`
      : (moveText && endingText
        ? `次回は「${moveText}」と「${endingText}」で検証します`
        : `次回は「${moveText || endingText}」で検証します`))
    : (en ? 'The next move appears here once the next post is prepared' : '次の1本の準備が終わると、型と締めをここに出します');
  const samples = Number(sharedLexicon && sharedLexicon.totalOutcomeSamples) || 0;
  const winner = Array.isArray(dpoPairs) && dpoPairs[0] && dpoPairs[0].winner || {};
  const retired = domainLexicon && Array.isArray(domainLexicon.retiredPhrases) ? domainLexicon.retiredPhrases.filter(Boolean).slice(0, 2) : [];
  const winning = domainLexicon && Array.isArray(domainLexicon.winningExpressions) ? String(domainLexicon.winningExpressions[0] || '').slice(0, 80) : '';
  let advisoryNote = '';
  if (matureCount < 5) {
    const parts = [];
    if (samples > 0) parts.push(en ? `Anonymous structure samples from other accounts: ${samples}` : `他アカウントの匿名構造サンプルは${samples}件です`);
    if (!String(user.brandContextNotes || '').trim()) {
      parts.push(en ? 'Your field note is empty, so adding one or two concrete lines makes the next post less generic and easier to measure' : '現場メモが未入力のため、実務でよく見る場面を1〜2行足すと一般論が抜けて反応を測りやすくなります');
    }
    if (!String(user.targetUrl || '').trim()) {
      parts.push(en ? 'Without a page URL, the account is sharpened from its own direction' : 'ページURLが未登録なら、知見だけの運用として磨きます');
    }
    advisoryNote = parts.join(en ? '. ' : '。');
  } else if (winner.whyWon || winning || retired.length) {
    if (en) {
      const focus = String(winner.whyWon || winning || 'the measured contrast').slice(0, 90);
      const avoid = retired.length ? retired.map(item => `"${item}"`).join(', ') : 'repetitive phrasing';
      advisoryNote = `VELOX AI automatically leans into "${focus}" while avoiding ${avoid} in the next draft.`;
    } else {
      const focus = String(winner.whyWon || winning || '実測で反応が残った対比').slice(0, 70);
      const avoid = retired.length ? `「${retired.join('」「')}」` : '反応が伸びなかった言い回し';
      advisoryNote = `VELOX AIが自動学習として「${focus}」を次回に活かし、${avoid}は自動で避けて作成します。`;
    }
  }
  let suggestedPromptAddition = '';
  if (matureCount < 5 && !String(user.brandContextNotes || '').trim()) {
    suggestedPromptAddition = en ? 'Add one concrete field note before the next post' : '現場で繰り返す確認を1行で書く';
  } else if (matureCount >= 5) {
    suggestedPromptAddition = en ? 'Keep the next post on the measured contrast' : '実測で残った対比を次の1本の軸にする';
  }
  if (suggestedPromptAddition && String(user.userPrompt || '').includes(suggestedPromptAddition)) suggestedPromptAddition = '';
  return {
    guidanceBalance,
    nextMovePreview,
    advisoryNote,
    suggestedPromptAddition: suggestedPromptAddition.slice(0, 140),
    guidancePhase: balance.phase
  };
}

function summarizePostedMeasurements(postedJobs, followerCount) {
  const rows = Array.isArray(postedJobs) ? postedJobs : [];
  const frozenMeasured = rows.filter(job => job && job.metrics24hSnapshot && job.metrics24hSnapshot.isFrozen === true && Number.isFinite(job.impressions) && job.impressions > 0);
  const anyMeasured = rows.filter(job => job && Number.isFinite(job.impressions) && job.impressions > 0).slice(0, 20);
  const measuredSampleRows = frozenMeasured.length ? frozenMeasured : anyMeasured;
  const followers = followerCount == null ? null : followerCount;
  if (!measuredSampleRows.length) return { followers };
  const impressionOf = job => {
    const snap = job.metrics24hSnapshot ? job.metrics24hSnapshot.impressions : undefined;
    const value = snap ?? job.impressions;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  };
  const bookmarksOf = job => {
    const snap = job.metrics24hSnapshot ? job.metrics24hSnapshot.bookmarks : undefined;
    const value = snap ?? job.bookmarks ?? 0;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  };
  const totalImp = measuredSampleRows.reduce((sum, job) => sum + impressionOf(job), 0);
  const maxImp = measuredSampleRows.reduce((max, job) => Math.max(max, impressionOf(job)), 0);
  const totalBookmarks = measuredSampleRows.reduce((sum, job) => sum + bookmarksOf(job), 0);
  return {
    followers,
    avgImpressions: totalImp / measuredSampleRows.length,
    maxImpressions: maxImp,
    bookmarkRate: totalImp > 0 ? totalBookmarks / totalImp : null
  };
}

function buildOperatingSummary(user = {}, extras = {}) {
  const uiLang = extras.uiLang || user.uiLang;
  const en = uiLang === 'en';
  const posture = operatingPosture({ ...user, uiLang }, extras.sample || {});
  const plan = extras.subscription != null ? extras.subscription : user.xSubscription;
  const search = extras.searchVisible;
  const planLabel = formatPlanLabel(plan, en);
  const searchText = search === true
    ? (en ? 'search visibility was recorded as on' : '検索への表示は記録上オン')
    : search === false
      ? (en ? 'search visibility was recorded as off' : '検索への表示は記録上オフ')
      : (en ? 'search visibility is not measured' : '検索への表示は未測定');
  const situation = en
    ? `${posture.situation} ${planLabel}. ${searchText}.`
    : `${posture.situation}${planLabel}。${searchText}。`;
  const whyNextPostOnly = extras.recoveryMode
    ? (en
      ? 'Reach dropped, so the next single post drops links and waits for the next measurement before another one is written.'
      : '到達が落ちているため、次の1本はリンクを止めて書きます。その結果を見てから次を作ります。')
    : extras.lastAction === 'deepen_winner'
      ? (en
        ? 'The previous post had a response, so the next single post stays on the same theme. The one after that waits for the next measurement.'
        : '直前の投稿に反応があったため、次の1本は同じテーマを一段深くします。その次は実測を待ってから決めます。')
      : (en
        ? 'Only the next post is scheduled. After it is measured, the following post either stays on the theme or changes angle.'
        : '予約しているのは次の1本だけです。実測のあとで、同じテーマを続けるか別の切り口にするかを決めます。');
  const hasMeasurement = posture.avgViews != null || posture.bookmarkRate != null;
  const low = Math.round((posture.nextViews || 80) * 0.6);
  const high = posture.nextViews || 80;
  const saveRate = posture.bookmarkRate == null ? '' : `${(Number(posture.bookmarkRate) * 100).toFixed(1)}%`;
  const insights = !hasMeasurement
    ? (en
      ? 'Insights will update after measured posts accumulate.'
      : 'これからの投稿実績が溜まり次第、自動で考察を更新します。')
    : (en
      ? `${posture.avgViews == null ? 'Recent views are not measured yet' : `Recent posts average about ${Math.round(posture.avgViews)} views (current range ${low}–${high})`}.${saveRate ? ` The bookmark rate so far is ${saveRate}.` : ''} The sample is still small, so the next posts try forms that are easier to save while the response pattern builds up. As more posts are measured, the difference by time and theme will be sorted out.`
      : `${posture.avgViews == null ? '表示回数はまだ測れていません' : `直近の平均表示はおよそ${Math.round(posture.avgViews)}回です（当面の目安 ${low}〜${high}回）`}。${saveRate ? `保存率はいまのところ${saveRate}です。` : ''}まだ立ち上がりデータが少ないため、保存・共感を得やすい投稿形を試しながら反応傾向を蓄積しています。データが増え次第、伸びやすい時間帯とテーマの差を整理します。`);
  const coaching = buildAdvisoryCoaching({
    user,
    matureCount: extras.matureCount || 0,
    weights: extras.weights || null,
    domainLexicon: extras.domainLexicon || null,
    dpoPairs: extras.dpoPairs || [],
    sharedLexicon: extras.sharedLexicon || null,
    nextJob: extras.nextJob || null,
    uiLang: en ? 'en' : 'ja'
  });
  return {
    situation,
    goal: posture.goal,
    approach: posture.approach,
    whyNextPostOnly,
    insights,
    ...coaching
  };
}

function getGrowthPhase(user = {}) {
  const handle = normalizeHandle(user.xUsername);
  if (!handle) return 'unknown';
  const diagnosis = user.latestMarketingStrategy && user.latestMarketingStrategy.accountDiagnosis;
  const listed = Array.isArray(user.trustBuildingAccounts) && user.trustBuildingAccounts.includes(handle);
  if (listed) return 'trust';
  const followers = measuredFollowers(user);
  const posture = operatingPosture(user);
  const matched = isMatchingDiagnosis(user, diagnosis);
  const advancedStage = matched && ['STAGE_2_AUTHORITY_ENGAGEMENT', 'STAGE_3_SCALE_LEVERAGE'].includes(diagnosis.stage);
  if (advancedStage || (followers !== null && followers >= 100) || posture.allowPromo) return 'advanced';
  const measured = followers !== null || posture.avgViews !== null || matched;
  if (!measured && !(/【PR】|宣伝して|紹介を交/.test(String(user.userPrompt || '')) || user.promoPreference === 'include')) {
    return 'unknown';
  }
  return 'trust';
}

module.exports = { getGrowthPhase, trustHandle, trustGoalStatus, operatingPosture, summarizePostedMeasurements, buildOperatingSummary, buildAdvisoryCoaching, formatPlanLabel };
