const test = require('node:test');
const assert = require('node:assert/strict');
const { fallbackPlaybooks, groundKnowledge } = require('../src/lp_knowledge_extractor');
const { closesAsLectureQuestion, selectFocusPlaybook } = require('../src/next_post_draft');
const { hypothesisForPlaybook } = require('../src/bandit_optimization_engine');
const { planVisualCard, renderVisualCardPng } = require('../src/visual_card');
const { buildTwitterAuthorizationUrl } = require('../src/twitter_auth');
const { uploadOfficialMedia } = require('../src/official_api_client');

test('fallback playbooks do not invent a generic card', () => {
  const cards = fallbackPlaybooks(['確認の入口を先に固定する'], [], '確認の入口を先に固定する');
  assert.deepEqual(cards, []);
});

test('an invented numeric rule is rejected when only a lone digit is grounded', () => {
  const knowledge = groundKnowledge({
    domainPlaybooks: [{
      topic: '手動編集の扱い',
      readerSituation: '直した投稿の反応を見ている',
      commonMistake: '直し方の癖を次の1本に残さない',
      concreteTradeoff: '3回連続で編集した場合にのみ学習パラメータを一時停止する',
      checkCriteria: '直した方向が次の1本に残るか見る',
      boundaryCondition: '条件が違う日はこの基準を使わない'
    }]
  }, '入口は最大3ページまで読む', '入口は最大3ページまで読む');
  assert.equal(knowledge.domainPlaybooks.length, 0);
});

test('the same playbook feeds the customer reason', () => {
  const playbook = {
    id: 'pb_2',
    topic: '手動編集の扱い',
    readerSituation: '手で直した投稿の反応を見ている',
    commonMistake: '直し方だけを次の判断にする',
    checkCriteria: '直した方向が次の1本に残るか見る'
  };
  const chosen = selectFocusPlaybook({ domainPlaybooks: [playbook] }, []);
  const hypothesis = hypothesisForPlaybook(chosen, { icpSummary: '確認を残す担当者' }, { title: '確認' });
  assert.equal(chosen.readerSituation, hypothesis.why);
  assert.equal(chosen.checkCriteria, hypothesis.proof);
});

test('a lecture ending without punctuation is rejected', () => {
  assert.equal(closesAsLectureQuestion(['直し方が癖になっていないか、その時に確かめてみませんか'], { endingMove: 'resolution' }), true);
  assert.equal(closesAsLectureQuestion(['その差はまだ残る'], { endingMove: 'genuine_tension' }), false);
});

test('japanese and english visual cards render as png', async () => {
  const playbook = {
    id: 'pb_2',
    topic: '手動編集の扱い',
    commonMistake: '直し方だけを次の判断にする',
    checkCriteria: '直した方向が次の1本に残るか見る',
    boundaryCondition: '条件が違う日はこの基準を使わない'
  };
  for (const lang of ['ja', 'en']) {
    const plan = planVisualCard({ portfolioRole: 'utility_save', focusPlaybook: playbook, lang });
    assert.equal(plan.eligible, true);
    const png = await renderVisualCardPng(plan);
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    assert.ok(png.length < 5 * 1024 * 1024);
  }
});

test('media.write is added to the oauth scope only when the flag is on', () => {
  const previous = process.env.X_MEDIA_WRITE_ENABLED;
  const config = { clientId: 'cid', redirectUri: 'https://example.com/callback' };
  try {
    delete process.env.X_MEDIA_WRITE_ENABLED;
    assert.equal(new URL(buildTwitterAuthorizationUrl(config, 'state', 'challenge')).searchParams.get('scope').includes('media.write'), false);
    process.env.X_MEDIA_WRITE_ENABLED = 'true';
    assert.equal(new URL(buildTwitterAuthorizationUrl(config, 'state', 'challenge')).searchParams.get('scope').includes('media.write'), true);
  } finally {
    if (previous === undefined) delete process.env.X_MEDIA_WRITE_ENABLED;
    else process.env.X_MEDIA_WRITE_ENABLED = previous;
  }
});

test('media upload uses initialize append and finalize without a manual content type', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, contentType: options.headers && options.headers['Content-Type'] });
    if (String(url).endsWith('/initialize')) return { ok: true, json: async () => ({ data: { id: 'media_1' } }) };
    return { ok: true, json: async () => ({}) };
  };
  const result = await uploadOfficialMedia({ oauth2AccessToken: 'token', oauth2Scope: 'tweet.write media.write' }, Buffer.from('png'), { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.mediaId, 'media_1');
  assert.match(calls[0].url, /api\.x\.com\/2\/media\/upload\/initialize/);
  assert.match(calls[1].url, /\/media_1\/append/);
  assert.equal(calls[1].contentType, undefined);
  assert.match(calls[2].url, /\/media_1\/finalize/);
});

test('oauth1 and a missing media scope skip the upload', async () => {
  const oauth1 = await uploadOfficialMedia({ apiKey: 'k' }, Buffer.from('png'), { fetchImpl: async () => { throw new Error('called'); } });
  assert.equal(oauth1.reason, 'oauth2_required');
  const missing = await uploadOfficialMedia({ oauth2AccessToken: 'token', oauth2Scope: 'tweet.write' }, Buffer.from('png'), { fetchImpl: async () => { throw new Error('called'); } });
  assert.equal(missing.reason, 'media_write_scope_missing');
});

test('a media 403 does not look like a successful upload', async () => {
  const result = await uploadOfficialMedia({ oauth2AccessToken: 'token', oauth2Scope: 'media.write' }, Buffer.from('png'), {
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});
