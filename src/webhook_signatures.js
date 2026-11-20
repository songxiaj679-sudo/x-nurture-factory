'use strict';

const crypto = require('crypto');

function hmacMatches(secret, rawBody, provided, algorithm) {
  if (!secret || !Buffer.isBuffer(rawBody) || !provided) return false;
  const expected = crypto.createHmac(algorithm, secret).update(rawBody).digest('hex');
  const got = String(provided).trim().toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]+$/.test(got) || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(got, 'utf8'));
}

module.exports = { hmacMatches };
