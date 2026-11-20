'use strict';

const BASE_ROLES = ['utility_save', 'conversation_debate', 'story_observation', 'profile_asset_bridge'];

function roleOf(job) {
  return job && (job.portfolioRole || (job.genes && job.genes.portfolioRole)) || '';
}

function weekdayInZone(zone, now = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone || 'Asia/Tokyo', weekday: 'short' }).format(now);
    const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
    return index >= 0 ? index : now.getDay();
  } catch (err) {
    return now.getDay();
  }
}

function planSlotPortfolio({
  growthPhase = 'unknown',
  timeSlot = 'evening',
  dayOfWeek = 1,
  recentPostedJobs = [],
  userPrompt = '',
  accountState = {},
  plan = '',
  recoveryMode = false,
  lang = 'ja'
} = {}) {
  const en = String(lang || 'ja').toLowerCase().startsWith('en');
  const say = {
    recovery: en
      ? 'Reach has dropped, so this slot stops promotion and links and uses a short conversation.'
      : '到達率が落ちているので、宣伝とリンクを止めて短い会話にします。',
    promo: en
      ? 'This account has an open offer slot, so one link goes after the post.'
      : '信用目標を満たしたアカウントの、宣伝が空いている枠なので、本文のあとにリンクを1つ付けます。',
    value: en
      ? 'This slot matches the time of day and does not add a promotion link.'
      : '宣伝リンクは付けず、この時間帯に合う役割で書きます。'
  };
  if (recoveryMode) {
    return {
      portfolioRole: 'conversation_debate',
      allowPromoUrl: false,
      requireDisclosure: false,
      preferredFormats: ['micro_punch'],
      allowedCtaModes: ['zero_cta'],
      rationale: say.recovery
    };
  }
  const roles = (Array.isArray(recentPostedJobs) ? recentPostedJobs : []).map(roleOf).filter(Boolean);
  const prompt = String(userPrompt || '');
  const promoBlocked = /PR禁止|宣伝なし|宣伝しない|認知重視/i.test(prompt);
  const promoRequested = /リード獲得|案内を増やす/.test(prompt);
  const slotAllowsPromo = timeSlot === 'evening' || timeSlot === 'noon' || (timeSlot === 'morning' && plan === 'starter');
  const promoOpen = growthPhase === 'advanced'
    && !accountState.singleOnly
    && !promoBlocked
    && slotAllowsPromo
    && !roles.slice(0, 4).includes('explicit_promo_offer');

  const scoreOf = role => {
    if (roles[0] === role) return -100;
    let score = 1 - roles.slice(0, 3).filter(item => item === role).length * 2;
    if (dayOfWeek === 1 && timeSlot === 'morning' && role === 'utility_save') score += 3;
    if ((dayOfWeek === 5 || dayOfWeek === 0) && (timeSlot === 'evening' || timeSlot === 'night') && (role === 'story_observation' || role === 'conversation_debate')) score += 3;
    if (timeSlot === 'morning' && role === 'utility_save') score += 1;
    if (timeSlot === 'noon' && role === 'conversation_debate') score += 1;
    if ((timeSlot === 'evening' || timeSlot === 'night') && role === 'story_observation') score += 1;
    if (timeSlot === 'afternoon' && role === 'profile_asset_bridge') score += 1;
    if (role === 'explicit_promo_offer') score = promoOpen ? score + (promoRequested ? 4 : 1) : -100;
    return score;
  };

  const candidates = promoOpen ? [...BASE_ROLES, 'explicit_promo_offer'] : BASE_ROLES;
  const portfolioRole = candidates.slice().sort((a, b) => scoreOf(b) - scoreOf(a) || a.localeCompare(b))[0];
  const allowPromoUrl = portfolioRole === 'explicit_promo_offer' && growthPhase === 'advanced' && !accountState.singleOnly;
  const formats = {
    utility_save: ['structured_breakdown', 'checklist_framework'],
    conversation_debate: ['reflective_question', 'tradeoffs'],
    story_observation: ['narrative_insight', 'field_observation'],
    profile_asset_bridge: ['narrative_insight'],
    explicit_promo_offer: ['soft_offer']
  };
  const ctas = {
    utility_save: ['bookmark_anchor'],
    conversation_debate: ['open_question'],
    story_observation: ['zero_cta'],
    profile_asset_bridge: ['zero_cta'],
    explicit_promo_offer: ['explicit_pr_reply']
  };
  return {
    portfolioRole,
    allowPromoUrl,
    requireDisclosure: allowPromoUrl,
    preferredFormats: formats[portfolioRole] || [],
    allowedCtaModes: ctas[portfolioRole] || ['zero_cta'],
    rationale: allowPromoUrl ? say.promo : say.value
  };
}

module.exports = { planSlotPortfolio, weekdayInZone };
