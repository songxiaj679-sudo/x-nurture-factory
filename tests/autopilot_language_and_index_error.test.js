'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getScheduledPostContent,
  isJobDue,
  isFirestoreIndexError
} = require('../src/hybrid_saas_routes');

test('selected account language takes precedence over a stale job language', () => {
  const content = getScheduledPostContent({
    lang: 'en',
    text: '日本語の保存済み下書き',
    tweets: ['日本語の保存済み下書き'],
    text_en: 'Saved English draft',
    tweets_en: ['Saved English draft'],
    isJitContent: true
  }, { aiTargetLang: 'en' });

  assert.equal(content.language, 'en');
  assert.equal(content.isEn, true);
  assert.equal(content.text, 'Saved English draft');
  assert.deepEqual(content.tweets, ['Saved English draft']);
});

test('legacy scheduled posts fall back to the current account language', () => {
  const content = getScheduledPostContent({
    text: 'Japanese draft',
    text_en: 'English draft'
  }, { aiTargetLang: 'en' });

  assert.equal(content.language, 'en');
  assert.equal(content.text, 'English draft');
});

test('Firestore missing-index failures are distinguished from other preconditions', () => {
  assert.equal(isFirestoreIndexError({
    code: 9,
    message: 'FAILED_PRECONDITION: The query requires an index.'
  }), true);
  assert.equal(isFirestoreIndexError({
    code: 'FAILED_PRECONDITION',
    message: 'Document update conflict.'
  }), false);
  assert.equal(isFirestoreIndexError({
    code: 'permission-denied',
    message: 'The query requires an index.'
  }), false);
});

test('jobs with a missing-history-index error retry only after the cooldown', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const retryAt = new Date(now.getTime() + 5 * 60 * 1000);
  const job = { postHistoryRetryAt: retryAt };

  assert.equal(isJobDue(job, now), false);
  assert.equal(isJobDue(job, retryAt), true);
});
