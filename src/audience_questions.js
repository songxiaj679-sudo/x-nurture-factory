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

function cleanAudienceVoice(text) {
  return sanitizeExternalText(String(text || ''))
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[@＠][A-Za-z0-9_]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function abstractAudiencePushbacks(mentions) {
  return (Array.isArray(mentions) ? mentions : [])
    .map(item => cleanAudienceVoice(item && (item.text || item) || ''))
    .filter(text => Array.from(text).length >= 8 && /本当|違う|嘘|意味(?:が)?ない|効かない|反論|懐疑|おかしい|doubt|wrong|does not|doesn't|not true/i.test(text))
    .slice(0, 3)
    .map(text => Array.from(text).slice(0, 200).join(''));
}

function latestAudiencePushback(cache) {
  const rows = cache && Array.isArray(cache.pushbacks) ? cache.pushbacks : [];
  const text = cleanAudienceVoice(rows.find(item => typeof item === 'string' && item.trim()) || '');
  if (Array.from(text).length < 8) return '';
  return Array.from(text).slice(0, 200).join('');
}

module.exports = { abstractAudienceQuestions, abstractAudiencePushbacks, latestAudiencePushback, audienceCacheFresh };
