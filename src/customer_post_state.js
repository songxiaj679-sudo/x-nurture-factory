'use strict';

function subscriptionClass(subscriptionType) {
  const value = String(subscriptionType || '').toLowerCase().replace(/[\s_+-]/g, '');
  if (value === 'premium' || value === 'premiumplus') return 'premium';
  if (value === 'none' || value === 'basic') return 'free';
  return 'unknown';
}

function searchVisibility(level) {
  const value = String(level || '');
  if (value === 'cleared' || value === 'latest_keyword_verified' || value === 'from_search_verified') return true;
  if (value === 'from_miss' || value === 'warming' || value === 'from_only_warming') return false;
  return null;
}

function describeAccountState(live, user = {}) {
  const measured = Boolean(live && live.ok && live.followers !== null && live.following !== null);
  const lang = String(user.aiTargetLang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const subscription = measured ? subscriptionClass(live.subscriptionType) : 'unknown';
  const visible = searchVisibility(user.searchIndexLevel);
  const premium = subscription === 'premium';
  const singleOnly = visible === false;
  const maxChars = singleOnly || !premium ? (lang === 'en' ? 270 : 140) : (lang === 'en' ? 1500 : 900);
  return {
    measured,
    username: measured ? live.username : null,
    followers: measured ? live.followers : null,
    following: measured ? live.following : null,
    tweetCount: measured ? live.tweetCount : null,
    subscription,
    searchVisible: visible,
    lang,
    singleOnly,
    maxChars,
    allowThread: !singleOnly && !premium,
    postShape: singleOnly || premium ? 'single' : 'thread'
  };
}

function writingShape(state = {}) {
  if (state.singleOnly || state.postShape === 'single' || state.subscription === 'premium') {
    return { thread: false, count: 1 };
  }
  return { thread: true, count: 2 };
}

function formatAccountState(state, lang = 'ja') {
  const isEn = String(lang).toLowerCase().startsWith('en');
  const count = value => (Number.isSafeInteger(value) ? String(value) : (isEn ? 'unknown' : '不明'));
  const pay = state.subscription === 'premium'
    ? (isEn ? 'paid' : '課金中')
    : (state.subscription === 'free' ? (isEn ? 'not paid' : '未課金') : (isEn ? 'unknown' : '不明'));
  const search = state.searchVisible === true
    ? (isEn ? 'visible in search' : '検索に出ている')
    : (state.searchVisible === false ? (isEn ? 'not visible in search' : '検索に出ていない') : (isEn ? 'unknown' : '不明'));
  const shape = writingShape(state).thread
    ? (state.subscription === 'unknown'
      ? (isEn ? 'The X plan is unknown, so write a short two-post thread. Do not call the account unpaid.' : '課金種別は不明なので、短い投稿を2本の連続ツリーにする。未課金とは断定しない。各本は上限以内。')
      : (isEn ? 'Not a paid plan, so write a two-post thread. Each post stays within the limit.' : '未課金なので、短い投稿を2本の連続ツリーにする。各本は上限以内。'))
    : (state.subscription === 'premium'
      ? (isEn ? 'Paid plan, so write one longer post. Do not split it into a thread.' : '課金中なので、長い投稿を1本だけ書く。ツリーには分けない。')
      : (isEn ? 'Write one short post only.' : '短い投稿を1本だけ書く。続きは付けない。'));
  return isEn
    ? `Account state. Followers: ${count(state.followers)}. Following: ${count(state.following)}. Payment: ${pay}. Search: ${search}. ${shape} Limit: ${state.maxChars} characters each.`
    : `アカウントの状態。フォロワー: ${count(state.followers)}。フォロー: ${count(state.following)}。課金: ${pay}。検索: ${search}。${shape} 1本の上限は${state.maxChars}文字。`;
}

function fitsAccountState(tweets, state, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0) return false;
  const promoReply = Boolean(options.allowPromoReply && state && !state.singleOnly);
  const limit = promoReply ? 2 : writingShape(state).count;
  if (tweets.length > limit) return false;
  if (!promoReply && writingShape(state).count === 1 && tweets.length > 1) return false;
  return tweets.every(text => typeof text === 'string' && text.trim() && text.length <= state.maxChars);
}

module.exports = {
  subscriptionClass,
  searchVisibility,
  describeAccountState,
  formatAccountState,
  fitsAccountState,
  writingShape
};
