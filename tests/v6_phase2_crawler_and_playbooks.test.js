'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodePublicBytes } = require('../src/url_fetch_guard');
const { crawlSite } = require('../src/site_crawler');
const { groundKnowledge, scrubSource } = require('../src/lp_knowledge_extractor');
const { extractDomainHypotheses } = require('../src/bandit_optimization_engine');
const { criticSystemRules, draftNextPostWithMeta } = require('../src/next_post_draft');

test('shift_jis bytes decode before facts are read', () => {
  const bytes = Buffer.concat([
    Buffer.from('<meta charset="Shift_JIS">'),
    Buffer.from([0x8a, 0x6d])
  ]);
  assert.equal(decodePublicBytes(bytes, '').includes('確'), true);
});

test('crawl blocks private map links, legacy notes, and legal paths, and stops at the daily cap', async () => {
  const previous = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = 'test-firecrawl-key';
  const scraped = [];
  const checked = [];
  const day = new Date().toISOString().slice(0, 10);
  const store = { crawlQuota: { dayKey: day, pagesUsed: 20 } };
  const db = { collection() { return { doc() { return {
    async get() { return { exists: true, data: () => store }; },
    async set(patch) { Object.assign(store, patch); }
  }; } }; } };
  try {
    const capped = await crawlSite({
      url: 'https://veloxpostapp.com/',
      userId: 'user',
      db,
      assertUrl: async url => { checked.push(String(url)); return new URL(url); },
      fetchText: async () => ({ ok: true, url: 'https://veloxpostapp.com/', text: '<html><title>確認</title></html>' }),
      fetchImpl: async () => { scraped.push('capped'); return { ok: true, async text() { return '{"success":true,"links":[]}'; } }; }
    });
    assert.equal(capped.ok, true);
    assert.equal(scraped.length, 0);
    store.crawlQuota.pagesUsed = 0;
    const opened = await crawlSite({
      url: 'https://veloxpostapp.com/',
      userId: 'user',
      db,
      assertUrl: async url => {
        const next = new URL(url);
        if (next.hostname === '127.0.0.1' || next.hostname === '10.0.0.1') throw new Error('private');
        return next;
      },
      fetchText: async url => ({ ok: true, url, text: '<html><link rel="alternate" type="application/rss+xml" href="https://10.0.0.1/feed.xml"></html>' }),
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        scraped.push(body.url);
        if (String(options.body).includes('"limit"')) {
          return { ok: true, async text() { return JSON.stringify({ success: true, links: [
            { url: 'https://veloxpostapp.com/faq', title: 'FAQ', description: '確認' },
            { url: 'https://veloxpostapp.com/article/note_01', title: 'old', description: 'シャドウバン' },
            { url: 'https://veloxpostapp.com/terms', title: 'terms', description: '規約' },
            'https://10.0.0.1/secret',
            { url: 'https://veloxpostapp.com/features', title: '機能', description: '' },
            { url: 'https://veloxpostapp.com/pricing', title: '料金', description: '' },
            { url: 'https://veloxpostapp.com/blog', title: '記録', description: '' },
            { url: 'https://veloxpostapp.com/about', title: '概要', description: '' },
            { url: 'https://veloxpostapp.com/guide', title: '手順', description: '' }
          ] }); } };
        }
        return { ok: true, async text() { return JSON.stringify({ success: true, data: { markdown: '確認の入口を先に固定する。' } }); } };
      }
    });
    assert.equal(opened.pages.filter(page => /note_|\/terms/.test(page.url)).length, 0);
    assert.equal(opened.pages.some(page => page.url.includes('10.0.0.1')), false);
    assert.ok(opened.pages.length <= 5);
    assert.equal(opened.rssItems.length, 0);
  } finally {
    if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previous;
  }
});

test('playbooks drop banned legacy text and do not price from side pages', () => {
  const corpus = scrubSource('確認の入口を先に固定する。シャドウバンを避ければ9割伸びる。利用規約に記載。月額は¥4,980。');
  assert.equal(/シャドウバン|9割|利用規約/.test(corpus), false);
  const knowledge = groundKnowledge({
    verifiedPricing: ['¥4,980', '¥9,800'],
    domainProblems: ['確認の入口を先に固定する', 'シャドウバンを避ける手順'],
    domainPlaybooks: [{
      topic: '入口を固定する',
      readerSituation: '次の確認場所が毎回変わる',
      commonMistake: '数字を先に書いてから出どころを探す',
      concreteTradeoff: '正しさは送信後に古くなる',
      checkCriteria: 'その場で元資料を開けるか見る',
      boundaryCondition: '資料が無い日は数字を外す'
    }, {
      topic: '禁止語',
      readerSituation: 'シャドウバンを避ける',
      commonMistake: '9割伸びる書き方を探す',
      concreteTradeoff: '月100時間を削る',
      checkCriteria: '3.4倍を約束する',
      boundaryCondition: '凍結リスクゼロと書く'
    }]
  }, corpus, '月額は¥4,980。');
  assert.deepEqual(knowledge.verifiedPricing, ['¥4,980']);
  assert.equal(knowledge.domainPlaybooks.some(card => /シャドウバン|9割|月100時間|3\.4倍|凍結リスクゼロ/.test(JSON.stringify(card))), false);
  assert.equal(knowledge.domainPlaybooks.some(card => card.checkCriteria.includes('元資料')), true);
});

test('a domain slot gives the writer one playbook and a domain customer reason', async () => {
  const prompts = [];
  const playbook = {
    id: 'pb_1',
    topic: '入口を固定する',
    readerSituation: '次の確認場所が毎回変わる',
    commonMistake: '数字を先に書いてから出どころを探す',
    concreteTradeoff: '正しさは送信後に古くなる',
    checkCriteria: 'その場で元資料を開けるか見る',
    boundaryCondition: '資料が無い日は数字を外す'
  };
  const long = '確認場所を先に固定すると、次の判断が毎回同じ入口から始まる。\n\n入口が変わるたびに手順も選び直され、現場の確認がその場でぶれる。先に残した一点だけを次の作業へ渡すと、翌日も同じ型で見直せる。';
  const filename = require.resolve('../src/grok_client');
  const previous = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports: {
    hasXaiKey: () => true,
    async completeText(options) {
      prompts.push(`${options.systemPrompt}\n${options.prompt}`);
      if (prompts.length === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', thisPost: '入口を固定する' }) };
      return { modelName: 'candidates', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [long] }] }) };
    }
  } };
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostWithMeta: draft, criticSystemRules: rules } = require('../src/next_post_draft');
    assert.ok(rules(false).length < 400);
    assert.equal(rules(false).includes('accountRole'), false);
    const drafted = await draft({
      lang: 'ja',
      skipCriticScore: true,
      userPrompt: '運用の確認を短く書く',
      portfolioPlan: { portfolioRole: 'utility_save', allowPromoUrl: false },
      brandKnowledge: {
        productName: 'VELOX',
        verifiedPricing: ['¥4,980'],
        verifiedClaims: [{ mechanism: '公式APIで予約する', proofQuote: '展示記載' }],
        domainPlaybooks: [playbook]
      },
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true, lang: 'ja' }
    });
    assert.match(prompts[0], /その場で元資料を開けるか見る/);
    assert.doesNotMatch(prompts[0], /¥4,980/);
    assert.match(prompts[1], /使う事実はこの1つだけ/);
    assert.match(prompts[1], /入口を固定する/);
    assert.doesNotMatch(prompts[1], /¥4,980/);
    assert.equal(drafted.tweets[0], long);
    const choice = { hypothesis: extractDomainHypotheses({ icpSummary: '確認を残す担当者', domainPlaybooks: [playbook] }, { title: '確認' })[0] };
    const { customerFacingReason } = require('../src/autonomous_promo_ai');
    const reason = customerFacingReason(choice, 'ja');
    assert.match(reason, /誰に: 確認を残す担当者/);
    assert.match(reason, /なぜ今: 次の確認場所が毎回変わる/);
    assert.match(reason, /根拠: その場で元資料を開けるか見る/);
    assert.doesNotMatch(reason, /公式API|OAuth|凍結/);
  } finally {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
    delete require.cache[draftPath];
  }
});
