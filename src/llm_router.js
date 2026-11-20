'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function pushAudit(audit, entry) {
  if (Array.isArray(audit)) audit.push({ cost: null, cachedTokens: null, ...entry });
}

function keyValue(name) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : '';
}

function retryable(error) {
  const message = String(error && error.message || '');
  return /429|5\d\d|529|timeout|aborted|Timeout/i.test(message);
}

function axisOrNull(row, key) {
  if (!row || row[key] == null || row[key] === '') return null;
  const value = Number(row[key]);
  return Number.isFinite(value) && value >= 0 && value <= 25 ? value : null;
}

function usableScores(parsed) {
  const rows = parsed && Array.isArray(parsed.scores) ? parsed.scores : null;
  if (!rows || !rows.length) return null;
  const clean = rows.filter(row => row && String(row.id || '').trim() && Number.isFinite(Number(row.score)) && Number(row.score) >= 0 && Number(row.score) <= 100);
  if (clean.length !== rows.length) return null;
  return clean.map(row => ({
    id: String(row.id).trim(),
    score: Number(row.score),
    weakness: String(row.weakness || ''),
    scrollStopHook: axisOrNull(row, 'scrollStopHook'),
    saveUtility: axisOrNull(row, 'saveUtility'),
    strangerClarity: axisOrNull(row, 'strangerClarity'),
    craftAndTruth: axisOrNull(row, 'craftAndTruth')
  }));
}

const criticJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scores'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'scrollStopHook', 'saveUtility', 'strangerClarity', 'craftAndTruth', 'score', 'weakness'],
        properties: {
          id: { type: 'string' },
          scrollStopHook: { type: 'number' },
          saveUtility: { type: 'number' },
          strangerClarity: { type: 'number' },
          craftAndTruth: { type: 'number' },
          score: { type: 'number' },
          weakness: { type: 'string' }
        }
      }
    }
  }
};

async function postJson(url, { headers, body, timeoutMs, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const response = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 20000))
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (_err) { parsed = null; }
  if (!response.ok) {
    const error = new Error(`${response.status} ${parsed && parsed.error && (parsed.error.message || parsed.error.type) || raw.slice(0, 180)}`);
    error.status = response.status;
    throw error;
  }
  return parsed || {};
}

async function grokText({ prompt, systemPrompt, timeoutMs, reasoningEffort, tier, model }) {
  const grok = require('./grok_client');
  return grok.completeText({
    tier: tier || 'quality',
    model,
    prompt,
    systemPrompt: systemPrompt || '',
    json: true,
    reasoningEffort,
    timeoutMs
  });
}

async function completeWriter({
  prompt,
  systemPrompt = '',
  schemaName = 'draft_json',
  inputSchema = { type: 'object', additionalProperties: true },
  maxTokens = 800,
  timeoutMs = 35000,
  cacheSystemPrompt = true,
  toolDescription = '',
  qualityAudit = null,
  fetchImpl = null,
  tier = 'quality'
} = {}) {
  const started = Date.now();
  const anthropicKey = keyValue('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    const grok = await grokText({ prompt, systemPrompt, timeoutMs, reasoningEffort: 'low', tier });
    pushAudit(qualityAudit, { role: 'writer', provider: 'xai', model: grok.modelName, ms: Date.now() - started, ok: true, reason: 'anthropic_key_missing', cachedTokens: null });
    return { ok: true, provider: 'xai', model: grok.modelName, text: grok.text, parsed: null, cachedTokens: null };
  }
  const model = keyValue('ANTHROPIC_MODEL_WRITER') || 'claude-sonnet-5-5';
  const system = cacheSystemPrompt && systemPrompt
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : (systemPrompt || undefined);
  try {
    const data = await postJson(ANTHROPIC_URL, {
      fetchImpl,
      timeoutMs,
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: {
        model,
        max_tokens: Math.max(3200, Number(maxTokens) || 3200),
        system,
        tools: [{ name: schemaName, description: toolDescription || 'Return the structured draft JSON.', input_schema: inputSchema }],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: prompt }]
      }
    });
    const tool = (data.content || []).find(block => block && block.type === 'tool_use');
    if (!tool || !tool.input) throw new Error('anthropic_tool_use_missing');
    const cachedTokens = data.usage && (data.usage.cache_read_input_tokens || data.usage.cache_creation_input_tokens) || null;
    const text = JSON.stringify(tool.input);
    pushAudit(qualityAudit, { role: 'writer', provider: 'anthropic', model, ms: Date.now() - started, ok: true, reason: '', cachedTokens });
    return { ok: true, provider: 'anthropic', model, text, parsed: tool.input, cachedTokens };
  } catch (error) {
    console.warn(`[LLM Router] anthropic writer failed: ${String(error.message || '').slice(0, 180)}`);
    pushAudit(qualityAudit, { role: 'writer', provider: 'anthropic', model, ms: Date.now() - started, ok: false, reason: error.message, cachedTokens: null });
    if (!retryable(error) && !/tool_use_missing/i.test(error.message || '')) throw error;
    const grok = await grokText({ prompt, systemPrompt, timeoutMs: Math.min(timeoutMs, 20000), reasoningEffort: 'low', tier });
    pushAudit(qualityAudit, { role: 'writer', provider: 'xai', model: grok.modelName, ms: Date.now() - started, ok: true, reason: 'anthropic_fallback', cachedTokens: null });
    return { ok: true, provider: 'xai', model: grok.modelName, text: grok.text, parsed: null, cachedTokens: null };
  }
}

async function scoreWithGrok({ prompt, systemPrompt, timeoutMs, qualityAudit }) {
  const started = Date.now();
  const model = keyValue('XAI_MODEL_CRITIC') || keyValue('XAI_MODEL_FAST') || 'grok-4.20-0309-non-reasoning';
  const grok = await grokText({
    prompt,
    systemPrompt,
    model,
    timeoutMs: Math.min(Number(timeoutMs) || 8000, 8000),
    tier: 'fast'
  });
  let parsed = null;
  try { parsed = require('./grok_client').extractJson(grok.text); } catch (_err) { parsed = null; }
  pushAudit(qualityAudit, { role: 'critic', provider: 'xai', model: grok.modelName, ms: Date.now() - started, ok: Boolean(usableScores(parsed)), reason: 'fast', cachedTokens: null });
  return { provider: 'xai', model: grok.modelName, parsed, effort: 'fast' };
}

async function scoreWithOpenAI({ prompt, systemPrompt, timeoutMs, jsonSchema, schemaName, qualityAudit, fetchImpl }) {
  const started = Date.now();
  const openaiKey = keyValue('OPENAI_API_KEY');
  if (!openaiKey) {
    const error = new Error('openai_key_missing');
    error.code = 'NO_OPENAI_KEY';
    throw error;
  }
  const model = keyValue('OPENAI_MODEL_CRITIC') || 'gpt-4.1';
  const data = await postJson(OPENAI_URL, {
    fetchImpl,
    timeoutMs,
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'content-type': 'application/json'
    },
    body: {
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName || 'score_candidates', strict: true, schema: jsonSchema }
      }
    }
  });
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const parsed = JSON.parse(text || '{}');
  pushAudit(qualityAudit, { role: 'critic', provider: 'openai', model, ms: Date.now() - started, ok: Boolean(usableScores(parsed)), reason: '', cachedTokens: null });
  return { provider: 'openai', model, parsed };
}

async function completeCritic({
  prompt,
  systemPrompt = '',
  schemaName = 'score_candidates',
  jsonSchema = criticJsonSchema,
  timeoutMs = 20000,
  writerProvider = 'anthropic',
  qualityAudit = null,
  fetchImpl = null
} = {}) {
  const started = Date.now();
  const attempt = async () => {
    if (writerProvider === 'xai') {
      try {
        return await scoreWithOpenAI({ prompt, systemPrompt, timeoutMs, jsonSchema, schemaName, qualityAudit, fetchImpl });
      } catch (error) {
        if (error && error.code === 'NO_OPENAI_KEY') return scoreWithGrok({ prompt, systemPrompt, timeoutMs, qualityAudit });
        throw error;
      }
    }
    try {
      return await scoreWithGrok({ prompt, systemPrompt, timeoutMs, qualityAudit });
    } catch (error) {
      console.warn(`[LLM Router] grok critic failed: ${String(error && error.message || '').slice(0, 180)}`);
      return scoreWithOpenAI({ prompt, systemPrompt, timeoutMs, jsonSchema, schemaName, qualityAudit, fetchImpl });
    }
  };
  let last = null;
  for (let i = 0; i < 2; i += 1) {
    if (Date.now() - started > timeoutMs && i > 0) break;
    try {
      last = await attempt();
      if (usableScores(last && last.parsed)) {
        return { ok: true, unparseable: false, provider: last.provider, model: last.model, parsed: { scores: usableScores(last.parsed) } };
      }
    } catch (error) {
      last = { error };
    }
  }
  pushAudit(qualityAudit, { role: 'critic', provider: last && last.provider || 'unknown', model: last && last.model || '', ms: Date.now() - started, ok: false, reason: 'critic_unparseable', cachedTokens: null });
  return { ok: false, unparseable: true, provider: last && last.provider || '', model: last && last.model || '', parsed: null, reason: 'critic_unparseable' };
}

module.exports = { completeWriter, completeCritic, usableScores, criticJsonSchema };
