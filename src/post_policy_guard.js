'use strict';

const DISCLOSURE_PREFIXES = {
  ja: /^(?:【PR】|【広告】|#PR\b|広告(?:・宣伝)?[:：]|プロモーション[:：])/iu,
  en: /^(?:\[Ad\]|\[Advertisement\]|#ad\b|advertisement[:：]|sponsored(?:\s+by)?[:：]|paid partnership[:：])/iu
};

const ENGAGEMENT_BAIT = {
  ja: /(?:いいね|リポスト|リツイート|RT|フォロー).{0,24}(?:抽選|当選|応募|プレゼント|参加条件)|(?:相互フォロー|フォロバ100|フォロー＆(?:いいね|RT|リポスト))/iu,
  en: /(?:like|follow|repost|retweet).{0,32}(?:to enter|to win|for a chance)|follow[- ]for[- ]follow|like[- ]for[- ]like/iu
};

const UNSUPPORTED_CLAIM = {
  ja: /(?:No\.?\s*1|No1|業界初|日本一|世界一|唯一|最安|成果を保証|売上を保証|必ず.{0,12}(?:売上|成約|成果|フォロワー|インプレッション)|絶対.{0,12}(?:売上|成約|成果|増|伸)|確実に.{0,12}(?:売上|成約|成果|増|伸)|(?:売上|成約|成果|反応|フォロワー|表示|インプレッション|リーチ|削減|増加|向上).{0,16}\d+(?:\.\d+)?\s*(?:%|倍)|\d+(?:\.\d+)?\s*(?:%|倍).{0,16}(?:売上|成約|成果|反応|フォロワー|表示|インプレッション|リーチ|削減|増加|向上))/iu,
  en: /(?:guarantee[sd]?|number one|industry[- ]first|world['’]s best|lowest price|\b(?:always|never)\s+(?:increase|grow|boost|convert)|\d+(?:\.\d+)?\s*(?:%|x).{0,32}\b(?:revenue|sales|conversions?|followers?|impressions?|reach|growth)\b)/iu
};

function inspectPostCompliance(tweets, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0 ||
      tweets.some(text => typeof text !== 'string' || !text.trim())) {
    return {
      canAutoPost: false,
      requiresHumanReview: true,
      issues: [{ code: 'invalid_post_text', action: 'review' }]
    };
  }

  const language = String(options.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const firstPost = tweets[0].trim();
  const allText = tweets.join('\n');
  const issues = [];

  if (options.isPromotion && !DISCLOSURE_PREFIXES[language].test(firstPost.slice(0, 40))) {
    issues.push({ code: 'promotion_disclosure_missing', action: 'review' });
  }
  if (ENGAGEMENT_BAIT[language].test(allText)) {
    issues.push({ code: 'incentivized_engagement', action: 'review' });
  }
  if (UNSUPPORTED_CLAIM[language].test(allText)) {
    issues.push({ code: 'claim_needs_evidence', action: 'review' });
  }

  return {
    canAutoPost: issues.length === 0,
    requiresHumanReview: issues.length > 0,
    issues
  };
}

module.exports = { inspectPostCompliance };
