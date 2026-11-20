'use strict';

const { createHash } = require('node:crypto');

function normalizePostContent(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function fingerprintPostContent(text) {
  const normalized = normalizePostContent(text);
  return normalized
    ? createHash('sha256').update(normalized, 'utf8').digest('hex')
    : null;
}

function getJobPostTexts(job) {
  const values = [job.text, job.text_en];
  for (const key of ['tweets', 'tweets_en']) {
    if (Array.isArray(job[key])) {
      values.push(...job[key].map(item =>
        typeof item === 'string' ? item : item?.text
      ));
    }
  }
  return values.filter(value => typeof value === 'string' && value.trim());
}

function hasConfirmedOrUncertainAttempt(job) {
  return job.status === 'posted' ||
    job.status === 'processing' ||
    (job.status === 'failed' && ['confirmed', 'duplicate', 'unknown'].includes(job.postAttemptStatus));
}

function findDuplicatePostContent(candidateTexts, existingJobs, currentJobId) {
  if (!Array.isArray(candidateTexts) || !Array.isArray(existingJobs)) return null;

  const candidateFingerprints = new Set(
    candidateTexts.map(fingerprintPostContent).filter(Boolean)
  );
  if (candidateFingerprints.size === 0) return null;

  for (const job of existingJobs) {
    if (!job || job.id === currentJobId || !hasConfirmedOrUncertainAttempt(job)) continue;
    for (const text of getJobPostTexts(job)) {
      const fingerprint = fingerprintPostContent(text);
      if (fingerprint && candidateFingerprints.has(fingerprint)) {
        return { duplicateOfJobId: job.id || null, fingerprint };
      }
    }
  }

  return null;
}

module.exports = {
  normalizePostContent,
  fingerprintPostContent,
  findDuplicatePostContent
};
