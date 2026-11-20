const test = require('node:test');
const assert = require('node:assert/strict');
const { maybeAutofillStrategy } = require('../src/autonomous_strategy_architect');
const { planVisualCard, cardMarkup, renderVisualCardPng } = require('../src/visual_card');
const { uploadOfficialMedia } = require('../src/official_api_client');
const { refreshNicheBenchmark, categorySlug } = require('../src/x_benchmark_radar');

function memoryDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  return {
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              return { exists: docs.has(id), data: () => docs.get(id) };
            },
            async set(data, options) {
              const prev = options && options.merge ? (docs.get(id) || {}) : {};
              docs.set(id, { ...prev, ...data });
            }
          };
        }
      };
    },
    read(id) { return docs.get(id); }
  };
}

test('a sparse reconnect object does not overwrite saved account settings', async () => {
  const db = memoryDb({
    'user-1': {
      userId: 'user-1',
      targetUrl: 'https://veloxpostapp.com',
      aiTargetLang: 'ja',
      scheduleTimeZone: 'Asia/Tokyo',
      userPrompt: '日本語で実務の確認を残す'
    }
  });
  const result = await maybeAutofillStrategy(db, { userId: 'user-1', xUsername: 'VeloxSystemsV4' });
  const saved = db.read('user-1');
  assert.equal(result, null);
  assert.equal(saved.targetUrl, 'https://veloxpostapp.com');
  assert.equal(saved.aiTargetLang, 'ja');
  assert.equal(saved.scheduleTimeZone, 'Asia/Tokyo');
  assert.equal(saved.userPrompt, '日本語で実務の確認を残す');
});

test('customer cards use the brand name and do not pre-escape satori text', async () => {
  const plan = planVisualCard({
    portfolioRole: 'utility_save',
    lang: 'ja',
    brandKnowledge: { productName: '鈴木歯科' },
    focusPlaybook: {
      id: 'pb_3',
      topic: '文体と宣伝の混ぜ方',
      commonMistake: "反応が安定する前の宣伝",
      checkCriteria: "口調と宣伝の理由が合うか",
      boundaryCondition: '紹介を明示的に希望する場合は例外として宣伝が混ざるため、その設定を入れているかどうかで挙動が変わる。'
    }
  });
  assert.equal(plan.badge, '鈴木歯科');
  assert.ok(plan.footerCheck.length > 42);
  assert.ok(plan.footerCheck.length <= 76);
  const markup = JSON.stringify(cardMarkup({ ...plan, title: "今日の確認 & 次の一手", leftText: "it's ready" }));
  assert.equal(markup.includes('&amp;'), false);
  assert.equal(markup.includes('&#39;'), false);
  assert.match(markup, /今日の確認 & 次の一手/);
  const png = await renderVisualCardPng(plan);
  assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  const english = planVisualCard({
    portfolioRole: 'profile_asset_bridge',
    lang: 'en',
    brandKnowledge: { productName: 'Acme Clinic' },
    focusPlaybook: {
      topic: "Today's check & next step",
      commonMistake: "Adding an offer before the voice is stable",
      checkCriteria: "The tone still matches the last posts",
      boundaryCondition: "Use the offer only when the reader asked for the page."
    }
  });
  assert.equal(english.badge, 'Acme Clinic');
  const englishPng = await renderVisualCardPng({ ...english, title: "Today's check & next step" });
  assert.equal(englishPng[0], 0x89);
});

test('media upload times out cleanly and does not throw', async () => {
  const seen = [];
  const result = await uploadOfficialMedia({ oauth2AccessToken: 'token', oauth2Scope: 'media.write' }, Buffer.from('png'), {
    fetchImpl: async (_url, options) => {
      seen.push(Boolean(options && options.signal));
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
  });
  assert.equal(seen[0], true);
  assert.equal(result.ok, false);
  assert.match(result.error, /^media_upload_error:/);
});

test('english knowledge cache is separate and a stored benchmark skips x_search', async () => {
  const slug = categorySlug('x_ai_saas', 'ja');
  let searches = 0;
  const db = {
    collection() {
      return {
        doc() {
          return {
            async get() {
              return {
                exists: true,
                data: () => ({
                  [slug]: {
                    categorySlug: slug,
                    patterns: [{ hookPattern: '対比を置く', cadence: '空行のあと境界', whyBookmarked: '翌日の確認に使える' }],
                    expiresAt: new Date(Date.now() + 86400000).toISOString()
                  }
                })
              };
            }
          };
        }
      };
    }
  };
  const row = await refreshNicheBenchmark({
    category: 'x_ai_saas',
    lang: 'ja',
    db,
    completeTextImpl: async () => {
      searches += 1;
      return { text: '{}' };
    }
  });
  assert.equal(searches, 0);
  assert.equal(row.patterns[0].hookPattern, '対比を置く');
  const { extractBrandKnowledge } = require('../src/lp_knowledge_extractor');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/lp_knowledge_extractor.js'), 'utf8');
  assert.match(source, /cached\.outputLang \|\| 'ja'\) === outputLang/);
  assert.equal(typeof extractBrandKnowledge, 'function');
});
