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

test('writer forces the named tool and keeps the caller timeout on fallback', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'writer-key';
  let sent = null;
  let fallbackTimeout = null;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    extractJson(text) { return JSON.parse(text); },
    async completeText(options) {
      fallbackTimeout = options.timeoutMs;
      return { text: '{"tweets":["入口の紙が古い。"]}', modelName: 'grok-test' };
    }
  });
  delete require.cache[require.resolve('../src/llm_router')];
  try {
    const { completeWriter } = require('../src/llm_router');
    const forced = await completeWriter({
      prompt: 'write',
      systemPrompt: 'rules',
      schemaName: 'draft_json',
      timeoutMs: 45000,
      fetchImpl: async (_url, options) => {
        sent = JSON.parse(options.body);
        return { ok: true, async text() { return JSON.stringify({ content: [{ type: 'tool_use', name: 'draft_json', input: { tweets: ['入口の紙が古い。'] } }] }); } };
      }
    });
    assert.equal(forced.provider, 'anthropic');
    assert.deepEqual(sent.tool_choice, { type: 'tool', name: 'draft_json' });
    const fallback = await completeWriter({
      prompt: 'write',
      systemPrompt: 'rules',
      timeoutMs: 45000,
      fetchImpl: async () => { throw new Error('anthropic_tool_use_missing'); }
    });
    assert.equal(fallback.provider, 'xai');
    assert.equal(fallbackTimeout, 45000);
    const choices = [];
    const adapted = await completeWriter({
      prompt: 'write',
      systemPrompt: 'rules',
      schemaName: 'draft_json',
      timeoutMs: 45000,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        choices.push(body.tool_choice);
        if (body.tool_choice.type === 'tool') {
          return { ok: false, status: 400, async text() { return JSON.stringify({ error: { message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }); } };
        }
        return { ok: true, async text() { return JSON.stringify({ content: [{ type: 'tool_use', name: 'draft_json', input: { tweets: ['入口の紙が古い。'] } }] }); } };
      }
    });
    assert.equal(adapted.provider, 'anthropic');
    assert.equal(choices[0].type, 'tool');
    assert.equal(choices[1].type, 'auto');
  } finally {
    restore();
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
    delete require.cache[require.resolve('../src/llm_router')];
  }
});

test('a model that rejects a forced tool is skipped on the next call', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_MODEL_WRITER;
  process.env.ANTHROPIC_API_KEY = 'writer-key';
  delete require.cache[require.resolve('../src/llm_router')];
  const { completeWriter, resetWriterToolChoiceCache } = require('../src/llm_router');
  resetWriterToolChoiceCache();
  const rounds = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    rounds.push(`${body.model}:${body.tool_choice.type}`);
    if (body.tool_choice.type === 'tool') {
      return { ok: false, status: 400, async text() { return JSON.stringify({ error: { message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }); } };
    }
    return { ok: true, async text() { return JSON.stringify({ content: [{ type: 'tool_use', name: 'draft_json', input: { tweets: ['入口の紙が古い。'] } }] }); } };
  };
  try {
    process.env.ANTHROPIC_MODEL_WRITER = 'model-a';
    await completeWriter({ prompt: 'write', systemPrompt: 'rules', schemaName: 'draft_json', timeoutMs: 45000, fetchImpl });
    await completeWriter({ prompt: 'write', systemPrompt: 'rules', schemaName: 'draft_json', timeoutMs: 45000, fetchImpl });
    process.env.ANTHROPIC_MODEL_WRITER = 'model-b';
    await completeWriter({ prompt: 'write', systemPrompt: 'rules', schemaName: 'draft_json', timeoutMs: 45000, fetchImpl });
    assert.deepEqual(rounds, ['model-a:tool', 'model-a:auto', 'model-a:auto', 'model-b:tool', 'model-b:auto']);
  } finally {
    resetWriterToolChoiceCache();
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL_WRITER;
    else process.env.ANTHROPIC_MODEL_WRITER = previousModel;
    delete require.cache[require.resolve('../src/llm_router')];
  }
});
