'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sortPostedJobsNewestFirst, rememberedPostTexts } = require('../src/autonomous_promo_ai');

test('posted jobs used for the next post are ordered by the newest post first', () => {
  const jobs = sortPostedJobsNewestFirst([
    { id: 'old', postedAt: '2026-11-01T00:00:00Z', text: 'old' },
    { id: 'new', postedAt: '2026-11-18T00:00:00Z', text: 'new' },
    { id: 'mid', postedAt: '2026-11-10T00:00:00Z', text: 'mid' }
  ]);
  assert.deepEqual(jobs.map(job => job.id), ['new', 'mid', 'old']);
});

test('english memory drops japanese history and keeps english posts', () => {
  const texts = rememberedPostTexts([
    { tweets: ['日本語の過去投稿です'], text: '別の日本語', tweets_en: ['English history stays'], text_en: 'English history stays' },
    { tweets: ['English only body'], text: 'English only body' }
  ], 'en');
  assert.deepEqual(texts, ['English history stays', 'English history stays', 'English only body', 'English only body']);
  assert.equal(texts.some(text => /[ぁ-んァ-ン一-龠]/.test(text)), false);
});
