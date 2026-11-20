'use strict';

const { sanitizeExternalText } = require('./lp_knowledge_extractor');

const CACHE_MS = 12 * 60 * 60 * 1000;

function abstractAudienceQuestions(mentions) {
  return (Array.isArray(mentions) ? mentions : [])
    .map(item => sanitizeExternalText(String(item && (item.text || item) || '')).replace(/@\w+/g, '').trim())
    .filter(text => text.length >= 8 && /[?？]|なぜ|どうして|本当|反論|質問/.test(text))
    .slice(0, 5)
    .map(text => text.slice(0, 140));
}

function audienceCacheFresh(cache, now = new Date()) {
  if (!cache || !cache.fetchedAt) return false;
  const age = now.getTime() - new Date(cache.fetchedAt).getTime();
  return age >= 0 && age < CACHE_MS;
}

module.exports = { abstractAudienceQuestions, audienceCacheFresh };
