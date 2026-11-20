'use strict';

const ARCHETYPES = [
  'before_after_rewrite',
  'actionable_checklist',
  'failure_autopsy',
  'live_trend_brief',
  'contrarian_sharp'
];

function followersOf(accountState) {
  const value = Number(accountState && accountState.followers);
  return Number.isFinite(value) ? value : 0;
}

function matureCount(jobs) {
  return (Array.isArray(jobs) ? jobs : []).filter(job => job && job.metrics24hSnapshot && job.metrics24hSnapshot.isFrozen === true).length;
}

function phaseFor(accountState, jobs) {
  const followers = followersOf(accountState);
  const mature = matureCount(jobs);
  if (followers < 500 || mature < 15) return 'trust_building';
  if (followers >= 3000) return 'conversion_ready';
  return 'authority_growth';
}

function bridgeShare(phase) {
  if (phase === 'authority_growth') return 0.25;
  if (phase === 'conversion_ready') return 0.30;
  return 0.15;
}

function bridgeCap(phase) {
  if (phase === 'trust_building') return 1;
  return 2;
}

function jobTime(job, index) {
  const raw = job && (job.postedAt || job.scheduledAt || job.updatedAt || job.createdAt);
  const date = raw && typeof raw.toDate === 'function' ? raw.toDate() : (raw ? new Date(raw) : null);
  const ms = date ? date.getTime() : NaN;
  return Number.isFinite(ms) ? ms : (Number.MAX_SAFE_INTEGER - index);
}

function recentJobsOf(jobs) {
  return (Array.isArray(jobs) ? jobs : [])
    .map((job, index) => ({ job, index }))
    .filter(row => row.job)
    .sort((a, b) => jobTime(b.job, b.index) - jobTime(a.job, a.index) || a.index - b.index);
}

function missionOf(job) {
  return String(job && (job.masterMission || job.mission) || '');
}

function cleanQuery(text, productName) {
  let query = String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const product = String(productName || '').trim();
  if (product.length >= 2) query = query.split(product).join(' ');
  query = query.replace(/\s+/g, ' ').trim();
  return query.slice(0, 120);
}

function topicsFor(audienceKnowledge, ring) {
  return (audienceKnowledge && Array.isArray(audienceKnowledge.audienceTopics) ? audienceKnowledge.audienceTopics : [])
    .filter(topic => topic && topic.exampleKind === 'illustrative' && topic.topicRing === ring && topic.topicDomain);
}

function domainFallback(audienceKnowledge, ring) {
  const tree = audienceKnowledge && audienceKnowledge.broadTopicDomains;
  const rows = tree && Array.isArray(tree[ring]) ? tree[ring] : [];
  return rows.map(item => String(item || '').trim()).filter(Boolean);
}

function pickArchetype(recent, random) {
  const blocked = recent.slice(0, 2).map(job => job && job.archetype).filter(Boolean);
  const pool = ARCHETYPES.filter(name => !blocked.includes(name));
  const roll = random();
  return (pool.length ? pool : ARCHETYPES)[Math.floor(roll * (pool.length || ARCHETYPES.length)) % (pool.length || ARCHETYPES.length)];
}

function pickTopic(audienceKnowledge, ring, recent, random) {
  const blocked = new Set(recent.slice(0, 2).map(job => `${job && job.topicRing || ''}|${job && (job.selectedTopicDomain || job.topicDomain) || ''}`));
  const cards = topicsFor(audienceKnowledge, ring).filter(topic => !blocked.has(`${ring}|${topic.topicDomain}`));
  const pool = cards.length ? cards : topicsFor(audienceKnowledge, ring);
  if (pool.length) return pool[Math.floor(random() * pool.length) % pool.length];
  const domains = domainFallback(audienceKnowledge, ring).filter(domain => !blocked.has(`${ring}|${domain}`));
  const domain = (domains.length ? domains : domainFallback(audienceKnowledge, ring))[0] || '';
  return domain ? { topicDomain: domain, topicRing: ring, exampleKind: 'illustrative' } : null;
}

function decideNextPostMission({
  accountState = null,
  brandKnowledge = null,
  audienceKnowledge = null,
  recentJobs = [],
  portfolioPlan = null,
  random = Math.random
} = {}) {
  const ordered = recentJobsOf(recentJobs).map(row => row.job);
  const phase = phaseFor(accountState, ordered);
  const promo = Boolean(portfolioPlan && (portfolioPlan.allowPromoUrl === true || portfolioPlan.portfolioRole === 'explicit_promo_offer'));
  const recentMissions = ordered.slice(0, 6).map(missionOf).filter(Boolean);
  let mission = 'trust_value_external';
  if (promo) mission = 'product_bridge';
  else if (recentMissions[0] === 'product_bridge') mission = 'trust_value_external';
  else if (random() < bridgeShare(phase) && recentMissions.filter(item => item === 'product_bridge').length < bridgeCap(phase)) {
    mission = 'product_bridge';
  }
  const isolateLpContext = mission === 'trust_value_external';
  const lastRing = ordered.map(job => job && job.topicRing).find(Boolean);
  const topicRing = mission === 'product_bridge'
    ? 'ring3_product_bridge'
    : (lastRing === 'ring1_craft' ? 'ring2_broad_adjacent' : 'ring1_craft');
  const archetype = pickArchetype(ordered, random);
  const focusTopic = topicRing === 'ring3_product_bridge' ? null : pickTopic(audienceKnowledge, topicRing, ordered, random);
  const selectedTopicDomain = focusTopic && (focusTopic.topicDomain || focusTopic.topic) || '';
  const sourceQuery = cleanQuery(selectedTopicDomain, brandKnowledge && brandKnowledge.productName);
  return {
    phase,
    mission,
    isolateLpContext,
    topicRing,
    selectedTopicDomain,
    archetype,
    focusTopic,
    sourceQuery,
    maxApiCalls: 5
  };
}

module.exports = {
  decideNextPostMission,
  phaseFor,
  cleanQuery,
  ARCHETYPES
};
