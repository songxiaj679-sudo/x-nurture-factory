'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

function scores(content) {
  return { ok: true, async text() { return JSON.stringify({ choices: [{ message: { content } }] }); } };
}

test('the critic asks OpenAI first and falls back to Grok in the same attempt', async () => {
  const previous = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_MODEL_CRITIC;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_MODEL_CRITIC = 'gpt-4.1';
  let opens = 0;
  let grokCalls = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    extractJson(text) { return JSON.parse(text); },
    async completeText(options) {
      grokCalls += 1;
      return { modelName: options.model, text: '{"scores":[{"id":"a","score":77,"scrollStopHook":15,"saveUtility":16,"strangerClarity":17,"craftAndTruth":18,"weakness":""}]}' };
    }
  });
  delete require.cache[require.resolve('../src/llm_router')];
  try {
    const { completeCritic, criticJsonSchema } = require('../src/llm_router');
    let sent = null;
    const first = await completeCritic({
      prompt: 'score',
      writerProvider: 'anthropic',
      fetchImpl: async (_url, options) => {
        opens += 1;
        sent = JSON.parse(options.body);
        return scores('{"scores":[{"id":"a","score":90,"scrollStopHook":20,"saveUtility":20,"strangerClarity":20,"craftAndTruth":20,"weakness":""}]}');
      }
    });
    assert.equal(first.provider, 'openai');
    assert.equal(first.model, 'gpt-4.1');
    assert.equal(sent.model, 'gpt-4.1');
    assert.equal(sent.response_format.json_schema.strict, true);
    assert.deepEqual(sent.response_format.json_schema.schema, criticJsonSchema);
    assert.equal(grokCalls, 0);
    const failed = await completeCritic({
      prompt: 'score',
      writerProvider: 'xai',
      fetchImpl: async () => {
        opens += 1;
        throw new Error('timeout');
      }
    });
    assert.equal(failed.provider, 'xai');
    assert.equal(grokCalls, 1);
    assert.equal(opens, 2);
    assert.equal(failed.parsed.scores[0].scrollStopHook, 15);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL_CRITIC;
    else process.env.OPENAI_MODEL_CRITIC = previousModel;
    restore();
    delete require.cache[require.resolve('../src/llm_router')];
  }
});

test('an outbound reply score leaves the critic schema at its default', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/outbound_reply_queue.js', 'utf8');
  const fn = source.slice(source.indexOf('async function scoreOutboundReply'), source.indexOf('function outboundUnsafeCode'));
  assert.match(fn, /completeCritic\(/);
  assert.equal(fn.includes('jsonSchema'), false);
  assert.equal(fn.includes('schemaName'), false);
});
