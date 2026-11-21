'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

test('writer uses the x-api-key header and caches only the system prompt', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  let sent = null;
  delete require.cache[require.resolve('../src/llm_router')];
  try {
    const { completeWriter } = require('../src/llm_router');
    const result = await completeWriter({
      prompt: 'write',
      systemPrompt: 'stable rules',
      schemaName: 'draft_json',
      fetchImpl: async (_url, options) => {
        sent = { url: _url, headers: options.headers, body: JSON.parse(options.body) };
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              content: [{ type: 'tool_use', name: 'draft_json', input: { candidates: [] } }],
              usage: { cache_read_input_tokens: 12 }
            });
          }
        };
      }
    });
    assert.equal(result.provider, 'anthropic');
    assert.equal(sent.headers['x-api-key'], 'test-anthropic-key');
    assert.equal(sent.headers.Authorization, undefined);
    assert.equal(sent.body.tool_choice.type, 'tool');
    assert.equal(sent.body.tool_choice.name, 'draft_json');
    assert.equal(sent.body.tools[0].name, 'draft_json');
    assert.equal(sent.body.system[0].cache_control.type, 'ephemeral');
    assert.equal(sent.body.messages[0].cache_control, undefined);
    assert.equal(result.cachedTokens, 12);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
    delete require.cache[require.resolve('../src/llm_router')];
  }
});

test('anthropic writer selects the OpenAI critic and retries an unreadable score once', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  const calls = [];
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    extractJson(text) { return JSON.parse(text); },
    async completeText() { throw new Error('grok should stay unused'); }
  });
  delete require.cache[require.resolve('../src/llm_router')];
  try {
    const { completeCritic } = require('../src/llm_router');
    const result = await completeCritic({
      prompt: 'score',
      writerProvider: 'anthropic',
      timeoutMs: 20000,
      fetchImpl: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        const content = calls.length === 1 ? '{"nope":true}' : '{"scores":[{"id":"a","score":81,"weakness":"ok"}]}';
        return { ok: true, async text() { return JSON.stringify({ choices: [{ message: { content } }] }); } };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'openai');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].response_format.json_schema.strict, true);
    assert.equal(result.parsed.scores[0].score, 81);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    restore();
    delete require.cache[require.resolve('../src/llm_router')];
  }
});

test('two unreadable critic payloads stop as critic_unparseable', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    extractJson() { throw new Error('Grok応答のJSONを読めませんでした'); },
    async completeText() { return { modelName: 'grok-4.7', text: 'nope' }; }
  });
  delete require.cache[require.resolve('../src/llm_router')];
  try {
    const { completeCritic } = require('../src/llm_router');
    const result = await completeCritic({ prompt: 'score', writerProvider: 'anthropic' });
    assert.equal(result.ok, false);
    assert.equal(result.unparseable, true);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    restore();
    delete require.cache[require.resolve('../src/llm_router')];
  }
});

test('an xAI writer falls back to the OpenAI critic schema', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  let sent = null;
  delete require.cache[require.resolve('../src/llm_router')];
  try {
    const { completeCritic } = require('../src/llm_router');
    const result = await completeCritic({
      prompt: 'score',
      writerProvider: 'xai',
      fetchImpl: async (_url, options) => {
        sent = { headers: options.headers, body: JSON.parse(options.body) };
        return {
          ok: true,
          async text() {
            return JSON.stringify({ choices: [{ message: { content: '{"scores":[{"id":"a","score":88,"weakness":""}]}' } }] });
          }
        };
      }
    });
    assert.equal(result.provider, 'openai');
    assert.equal(sent.body.response_format.json_schema.strict, true);
    assert.match(sent.headers.Authorization, /^Bearer /);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    delete require.cache[require.resolve('../src/llm_router')];
  }
});

test('x_search falls back after a 400 and a reasoning override is forwarded', async () => {
  const previous = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = 'test-xai-key';
  const originalFetch = global.fetch;
  const tools = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    tools.push(body.tools.map(tool => tool.type));
    if (tools.length < 3) {
      return { ok: false, status: 400, async text() { return JSON.stringify({ error: { message: 'bad tool' } }); } };
    }
    return { ok: true, async text() { return JSON.stringify({ output_text: '[]' }); } };
  };
  delete require.cache[require.resolve('../src/grok_client')];
  try {
    const client = require('../src/grok_client');
    await client.completeText({ search: true, xSearch: true, excludedXHandles: ['@VeloxSystemsV4'], prompt: 'industry' });
    assert.deepEqual(tools, [['x_search', 'web_search'], ['x_search'], ['web_search']]);
    const sent = [];
    global.fetch = async (_url, options) => {
      sent.push(JSON.parse(options.body).reasoning_effort);
      return { ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: '{}' } }] }); } };
    };
    await client.completeText({ tier: 'quality', reasoningEffort: 'medium', prompt: 'score', json: true });
    assert.deepEqual(sent, ['medium']);
  } finally {
    global.fetch = originalFetch;
    if (previous === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previous;
    delete require.cache[require.resolve('../src/grok_client')];
  }
});

test('profile bridge is a domain slot and a long post without a blank line is repaired', async () => {
  const prompts = [];
  const long = '確認場所を先に固定すると、次の判断が毎回同じ入口から始まる。入口が変わるたびに手順も選び直され、現場の確認がその場でぶれる。先に残した一点だけを次の作業へ渡すと、翌日も同じ型で見直せる。記録はその一点に限る。それ以外の手順は次の確認まで持たない。';
  const repaired = '確認場所を先に固定する。\n\n次の判断が同じ入口から始まる。入口が変わるたびに手順も選び直される。先に残した一点だけを次の作業へ渡すと、翌日も同じ型で見直せる。記録はその一点に限る。それ以外の手順は次の確認まで持たない。';
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText(options) {
      prompts.push(options.prompt);
      if (prompts.length === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', thisPost: '入口を固定する' }) };
      if (prompts.length === 2) return { modelName: 'candidates', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [long] }] }) };
      return { modelName: 'repair', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [repaired] }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostWithMeta } = require('../src/next_post_draft');
    const drafted = await draftNextPostWithMeta({
      lang: 'ja',
      skipCriticScore: true,
      userPrompt: '運用の確認を短く書く',
      portfolioPlan: { portfolioRole: 'profile_asset_bridge', allowPromoUrl: false },
      brandKnowledge: { productName: 'VELOX', domainProblems: ['確認の入口が毎回変わる'] },
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true, lang: 'ja' }
    });
    assert.match(prompts[1], /文脈に不可欠なとき以外は出さない/);
    assert.match(prompts[1], /プロフィールへ戻る一言/);
    assert.doesNotMatch(prompts[1], /今回の主軸はこの未消化の柱/);
    assert.match(prompts[2], /needs_line_breaks/);
    assert.match(drafted.tweets[0], /\n\n/);
    assert.doesNotMatch(drafted.tweets.join('\n'), /挽き目|移行枠|portafilter|migration window/);
  } finally {
    restore();
    delete require.cache[draftPath];
  }
});

test('a craft-exemplar leak is rejected and the stage budget stays inside the deadline', async () => {
  const calls = [];
  const leaked = '挽き目がバスケットの抜けより細かいと、一杯は中が空洞になる。確認の入口も同じで、先に固定しないと判断がぶれる。';
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText(options) {
      calls.push(options.timeoutMs);
      if (calls.length === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', thisPost: '入口' }) };
      return { modelName: 'candidates', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [leaked] }, { id: 'b', tweets: [leaked] }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostText, systemRules } = require('../src/next_post_draft');
    assert.match(systemRules(false), /写してよいのは間の取り方だけ/);
    await assert.rejects(() => draftNextPostText({
      lang: 'ja',
      timeoutMs: 6000,
      userPrompt: '運用の確認を短く書く',
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true, lang: 'ja' }
    }), /検証を通る投稿案が無かった/);
    assert.ok(calls.every(ms => ms <= 6000));
    assert.ok(calls.length <= 3);
  } finally {
    restore();
    delete require.cache[draftPath];
  }
});

test('radar refresh does not block drafting and the query drops the product name', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/autonomous_promo_ai.js'), 'utf8');
  const start = source.indexOf('let contextSignals = null;');
  const block = source.slice(start, source.indexOf('const portfolioPlan = planSlotPortfolio', start));
  assert.equal(block.includes('await fetchSituationalContext'), false);
  assert.equal(block.includes('Promise.race'), false);
  const { industryQuery } = require('../src/context_radar');
  const query = industryQuery({
    category: 'VELOX AI の投稿審査',
    icpSummary: 'ACCOUNT VOICE を見る担当者',
    productName: 'VELOX AI',
    handle: '@VeloxSystemsV4',
    terminology: ['PAGE FACTS ONLY']
  });
  assert.equal(/VELOX|VeloxSystemsV4|ACCOUNT VOICE|PAGE FACTS ONLY/.test(query), false);
});
