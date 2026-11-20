const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dateAtTimeInZone,
  dateFromLocalDateTimeInZone,
  isValidTimeZone
} = require('../src/autonomous_promo_ai');

test('campaign slots are stored as instants matching their Tokyo wall-clock time', () => {
  const referenceDate = new Date('2026-11-14T03:00:00.000Z');

  assert.equal(
    dateAtTimeInZone(referenceDate, 'Asia/Tokyo', 12, 17).toISOString(),
    '2026-11-14T03:17:00.000Z'
  );
  assert.equal(
    dateAtTimeInZone(referenceDate, 'Asia/Tokyo', 21, 16).toISOString(),
    '2026-11-14T12:16:00.000Z'
  );
});

test('campaign slot day offsets use the target timezone calendar date', () => {
  const referenceDate = new Date('2026-11-14T03:00:00.000Z');

  assert.equal(
    dateAtTimeInZone(referenceDate, 'Asia/Tokyo', 21, 16, 1).toISOString(),
    '2026-11-15T12:16:00.000Z'
  );
});

test('campaign slots respect regional offsets and daylight-saving changes', () => {
  assert.equal(
    dateAtTimeInZone(new Date('2026-01-15T12:00:00.000Z'), 'America/New_York', 12, 10).toISOString(),
    '2026-01-15T17:10:00.000Z'
  );
  assert.equal(
    dateAtTimeInZone(new Date('2026-07-15T12:00:00.000Z'), 'America/New_York', 12, 10).toISOString(),
    '2026-07-15T16:10:00.000Z'
  );
  assert.equal(
    dateAtTimeInZone(new Date('2026-07-15T12:00:00.000Z'), 'Asia/Kolkata', 12, 17).toISOString(),
    '2026-07-15T06:47:00.000Z'
  );
  assert.equal(
    dateAtTimeInZone(new Date('2026-03-07T17:00:00.000Z'), 'America/New_York', 8, 30, 1).toISOString(),
    '2026-03-08T12:30:00.000Z'
  );
});

test('time zone input must be a recognized IANA zone', () => {
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
});

test('AI wall-clock recommendations are interpreted in the selected campaign timezone', () => {
  assert.equal(
    dateFromLocalDateTimeInZone(2026, 11, 14, 20, 30, 'America/New_York').toISOString(),
    '2026-11-15T01:30:00.000Z'
  );
});
