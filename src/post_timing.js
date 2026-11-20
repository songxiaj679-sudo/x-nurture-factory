'use strict';

function jitterMinutes(seed) {
  let hash = 0;
  for (const char of String(seed || 'slot')) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return -6 + (hash % 20);
}

function applySlotJitter(scheduledAt, seed, now = new Date()) {
  const base = scheduledAt instanceof Date ? new Date(scheduledAt.getTime()) : new Date(scheduledAt);
  const shifted = new Date(base.getTime() + jitterMinutes(seed) * 60 * 1000);
  const earliest = now.getTime() + 15 * 60 * 1000;
  if (shifted.getTime() < earliest) return base.getTime() < earliest ? new Date(earliest) : base;
  return shifted;
}

function localHour(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC',
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(date);
  } catch (err) {
    return null;
  }
}

module.exports = { jitterMinutes, applySlotJitter, localHour };
