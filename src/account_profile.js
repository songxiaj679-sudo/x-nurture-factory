'use strict';

const crypto = require('crypto');
const path = require('path');

const PROFILES_BASE_DIR = path.join(__dirname, '../.profiles');

function getProfileDirectoryPath(token) {
  const hash = crypto.createHash('md5').update(String(token || '').trim()).digest('hex').slice(0, 12);
  return path.join(PROFILES_BASE_DIR, `prof_${hash}`);
}

module.exports = { getProfileDirectoryPath };
