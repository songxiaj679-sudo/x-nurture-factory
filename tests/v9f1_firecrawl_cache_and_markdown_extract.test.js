'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractBrandKnowledge, pageFromMarkdown } = require('../src/lp_knowledge_extractor');
const { readerVisibleFact } = require('../src/next_post_draft');

const pageUrl = 'https://example.com/shop-door';

function savedKnowledge(sourceUrl) {
  return {
    schemaVersion: 3,
    outputLang: 'ja',
    sourceUrl,
    extractedAt: new Date().toISOString(),
    oneLineMechanism: '元の仕組みの一文です。',
    pageTitle: '店の入口',
    pageDescription: '休みの紙を先に見る。',
    pageHeadings: ['入口']
  };
}

test('markdown metadata and a heading-only page both keep a visible description', () => {
  const rich = pageFromMarkdown(pageUrl, '# 入口\n\n紙の時刻が古いと、来た人は閉まった店に当たる。\n\n## 次の確認', {
    title: '店の入口',
    description: '休みの紙を先に見る。',
    ogDescription: '別の説明'
  });
  assert.equal(rich.title, '店の入口');
  assert.equal(rich.description, '休みの紙を先に見る。');
  assert.deepEqual(rich.headings.slice(0, 2), ['入口', '次の確認']);
  const bare = pageFromMarkdown(pageUrl, '# 入口\n\n紙の時刻が古いと、来た人は閉まった店に当たる。');
  assert.equal(bare.title, '入口');
  assert.match(bare.description, /紙の時刻が古い/);
  assert.equal(bare.headings[0], '入口');
});

test('a fresh stored page skips the crawl and still reaches the visible fact', async () => {
  let calls = 0;
  const cached = savedKnowledge(pageUrl);
  const result = await extractBrandKnowledge(pageUrl, {
    cachedKnowledge: cached,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, async text() { return '{"success":true,"data":{"markdown":"unused"}}'; } };
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.fromCache, true);
  assert.equal(result.pageSummary.description, '休みの紙を先に見る。');
  assert.equal(readerVisibleFact(result.pageSummary, result.brandKnowledge), '休みの紙を先に見る。');
  assert.equal(result.brandKnowledge.oneLineMechanism, '元の仕組みの一文です。');
});

test('a changed source or a forced refresh crawls again inside the same week', async () => {
  const previous = {
    firecrawl: process.env.FIRECRAWL_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    xai: process.env.XAI_API_KEY
  };
  process.env.FIRECRAWL_API_KEY = 'unit-firecrawl-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY;
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body).url);
    return { ok: true, async text() { return JSON.stringify({ success: true, data: { markdown: '# 入口\n\n紙の時刻が古いと、来た人は閉まった店に当たる。', metadata: { title: '店の入口', description: '休みの紙を先に見る。' } } }); } };
  };
  try {
    const moved = await extractBrandKnowledge('https://example.com/other-door', {
      cachedKnowledge: savedKnowledge(pageUrl),
      fetchImpl,
      assertUrl: async url => new URL(url),
      fetchText: async () => { throw new Error('local fetch'); }
    });
    assert.equal(moved.fromCache, false);
    assert.equal(moved.brandKnowledge.pageTitle, '店の入口');
    assert.equal(moved.pageSummary.description, '休みの紙を先に見る。');
    const beforeForce = calls.length;
    await extractBrandKnowledge(pageUrl, {
      cachedKnowledge: savedKnowledge(pageUrl),
      forceRefresh: true,
      fetchImpl,
      assertUrl: async url => new URL(url),
      fetchText: async () => { throw new Error('local fetch'); }
    });
    assert.equal(calls.length > beforeForce, true);
  } finally {
    if (previous.firecrawl === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previous.firecrawl;
    if (previous.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous.anthropic;
    if (previous.xai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previous.xai;
  }
});
