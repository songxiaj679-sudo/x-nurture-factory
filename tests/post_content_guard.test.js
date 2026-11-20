'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePostContent,
  fingerprintPostContent,
  findDuplicatePostContent
} = require('../src/post_content_guard');

test('post content normalization handles Unicode width, invisible characters and whitespace', () => {
  assert.equal(normalizePostContent(' Ａ  New\u200B   POST '), 'a new post');
  assert.equal(fingerprintPostContent('Ａ post'), fingerprintPostContent('a   post'));
  assert.equal(fingerprintPostContent(''), null);
});

test('duplicate detection checks individual thread posts in confirmed or uncertain jobs only', () => {
  const jobs = [
    { id: 'posted', status: 'posted', tweets: ['An earlier post.', 'Thread continuation.'] },
    { id: 'uncertain', status: 'failed', postAttemptStatus: 'unknown', text: 'Maybe reached X.' },
    { id: 'rejected', status: 'failed', postAttemptStatus: 'rejected', text: 'Safe to correct and retry.' },
    { id: 'current', status: 'processing', text: 'Current job text.' }
  ];

  assert.equal(
    findDuplicatePostContent(['Thread continuation.'], jobs, 'current').duplicateOfJobId,
    'posted'
  );
  assert.equal(
    findDuplicatePostContent(['Maybe reached X.'], jobs, 'current').duplicateOfJobId,
    'uncertain'
  );
  assert.equal(findDuplicatePostContent(['Safe to correct and retry.'], jobs, 'current'), null);
  assert.equal(findDuplicatePostContent(['Current job text.'], jobs, 'current'), null);
  assert.equal(findDuplicatePostContent(['Different content.'], jobs, 'current'), null);
});
