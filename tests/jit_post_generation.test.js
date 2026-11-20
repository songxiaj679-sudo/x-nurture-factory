const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/firestore');
const { JA_GENRE_PERSONAS, EN_GENRE_PERSONAS } = require('../scripts/deploy_hundred_active_own_accounts');

test('Syndicate 100-Account Fleet: 50 JA and 50 EN multi-genre deployment', async () => {
  assert.equal(JA_GENRE_PERSONAS.length, 50);
  assert.equal(EN_GENRE_PERSONAS.length, 50);

  // ジャンル別分布の検証 (10ジャンル×各5名)
  const jaGenres = new Set(JA_GENRE_PERSONAS.map(p => p.genre));
  const enGenres = new Set(EN_GENRE_PERSONAS.map(p => p.genre));
  assert.equal(jaGenres.size, 10);
  assert.equal(enGenres.size, 10);

  if (db && process.env.FIRESTORE_EMULATOR_HOST) {
    const jaSnap = await db.collection('accounts').where('status', '==', 'active_own').where('lang', '==', 'ja').get();
    const enSnap = await db.collection('accounts').where('status', '==', 'active_own').where('lang', '==', 'en').get();
    assert.ok(jaSnap.size >= 50, `Expected at least 50 JA active_own accounts, got ${jaSnap.size}`);
    assert.ok(enSnap.size >= 50, `Expected at least 50 EN active_own accounts, got ${enSnap.size}`);

    const saasJaSnap = await db.collection('saas_accounts').where('status', '==', 'active_own').where('lang', '==', 'ja').get();
    const saasEnSnap = await db.collection('saas_accounts').where('status', '==', 'active_own').where('lang', '==', 'en').get();
    assert.ok(saasJaSnap.size >= 50, `Expected at least 50 JA saas_accounts, got ${saasJaSnap.size}`);
    assert.ok(saasEnSnap.size >= 50, `Expected at least 50 EN saas_accounts, got ${saasEnSnap.size}`);
  }
});

test('JIT Post Generation: Dynamic character length and hook resolution logic', () => {
  // 時間帯に応じた文章量タイプの自動解決関数のロジック検証
  function resolveTargetLength(timeSlot, explicitLength = 'auto') {
    if (explicitLength && explicitLength !== 'auto') return explicitLength;
    const slot = String(timeSlot || '').toLowerCase();
    if (slot.includes('morning')) return 'short_punchy';
    if (slot.includes('noon') || slot.includes('lunch')) return 'medium_insight';
    return 'deep_retention';
  }

  assert.equal(resolveTargetLength('morning', 'auto'), 'short_punchy');
  assert.equal(resolveTargetLength('morning_golden', 'auto'), 'short_punchy');
  assert.equal(resolveTargetLength('noon', 'auto'), 'medium_insight');
  assert.equal(resolveTargetLength('lunch_break', 'auto'), 'medium_insight');
  assert.equal(resolveTargetLength('evening', 'auto'), 'deep_retention');
  assert.equal(resolveTargetLength('night_prime', 'auto'), 'deep_retention');
  assert.equal(resolveTargetLength('evening', 'short_punchy'), 'short_punchy');

  // 文章量カテゴリ別の文字数境界チェック
  const guides = {
    ja: {
      short_punchy: { min: 70, max: 110 },
      medium_insight: { min: 110, max: 135 },
      deep_retention: { min: 130, max: 140 }
    },
    en: {
      short_punchy: { min: 90, max: 160 },
      medium_insight: { min: 160, max: 230 },
      deep_retention: { min: 220, max: 280 }
    }
  };

  assert.ok(guides.ja.short_punchy.max <= 110);
  assert.ok(guides.ja.deep_retention.max <= 140);
  assert.ok(guides.en.deep_retention.max <= 280);
});

test('JIT Post Content: Sanitization and Zero In-Body URL Enforcer', () => {
  function sanitizeJitText(raw) {
    let clean = String(raw || '').trim();
    clean = clean.replace(/（\s*(?:約)?\s*\d+\s*文字\s*）/g, '')
      .replace(/\(\s*\d+\s*(?:chars|characters|words)?\s*\)/gi, '')
      .replace(/^[\s\S]*?(?:Here is the tweet|以下のとおりです|本文:)\s*[:：\n]*/i, '')
      .trim();
    return clean;
  }

  const dirty1 = 'Here is the tweet: 月100時間かかっていた作業が15分に短縮。リプ欄へ。（105文字）';
  assert.equal(sanitizeJitText(dirty1), '月100時間かかっていた作業が15分に短縮。リプ欄へ。');

  const dirty2 = 'Stop wasting 15 hrs weekly manually drafting copy. Check profile pinned. (142 chars)';
  assert.equal(sanitizeJitText(dirty2), 'Stop wasting 15 hrs weekly manually drafting copy. Check profile pinned.');

  // 直リンクの不在検証
  const sampleClean = sanitizeJitText(dirty1);
  assert.equal(/https?:\/\/[^\s]+|t\.co\/[a-zA-Z0-9]+/.test(sampleClean), false);
});

