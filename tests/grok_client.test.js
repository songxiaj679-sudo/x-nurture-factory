const test = require('node:test');
const assert = require('node:assert/strict');

test('tier picks the quality and nurture models from the environment', () => {
  const previous = {
    quality: process.env.XAI_MODEL_QUALITY,
    nurture: process.env.XAI_MODEL_NURTURE,
    key: process.env.XAI_API_KEY
  };
  process.env.XAI_MODEL_QUALITY = 'grok-4.7';
  process.env.XAI_MODEL_NURTURE = 'grok-4.3';
  delete process.env.XAI_API_KEY;
  delete require.cache[require.resolve('../src/grok_client')];
  const client = require('../src/grok_client');
  assert.equal(client.modelForTier('quality'), 'grok-4.7');
  assert.equal(client.modelForTier('nurture'), 'grok-4.3');
  assert.equal(client.hasXaiKey(), false);
  assert.deepEqual(client.extractJson('```json\n{"text":"朝のコーヒー"}\n```'), { text: '朝のコーヒー' });
  if (previous.quality === undefined) delete process.env.XAI_MODEL_QUALITY;
  else process.env.XAI_MODEL_QUALITY = previous.quality;
  if (previous.nurture === undefined) delete process.env.XAI_MODEL_NURTURE;
  else process.env.XAI_MODEL_NURTURE = previous.nurture;
  if (previous.key === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = previous.key;
});

test('quality requests send reasoning_effort low', async () => {
  const previousKey = process.env.XAI_API_KEY;
  const previousEffort = process.env.XAI_REASONING_EFFORT_QUALITY;
  process.env.XAI_API_KEY = 'test-key';
  delete process.env.XAI_REASONING_EFFORT_QUALITY;
  const originalFetch = global.fetch;
  let sent = null;
  global.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return {
      ok: true,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: 'ok' } }] });
      }
    };
  };
  delete require.cache[require.resolve('../src/grok_client')];
  try {
    const client = require('../src/grok_client');
    await client.completeText({ tier: 'quality', prompt: 'hi' });
    assert.equal(sent.reasoning_effort, 'low');
    assert.equal(sent.model, client.modelForTier('quality'));
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
    if (previousEffort === undefined) delete process.env.XAI_REASONING_EFFORT_QUALITY;
    else process.env.XAI_REASONING_EFFORT_QUALITY = previousEffort;
    delete require.cache[require.resolve('../src/grok_client')];
  }
});
