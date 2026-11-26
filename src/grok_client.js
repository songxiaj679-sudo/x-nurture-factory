'use strict';

const CHAT_URL = 'https://api.x.ai/v1/chat/completions';
const RESPONSES_URL = 'https://api.x.ai/v1/responses';

function xaiKey() {
  return (process.env.XAI_API_KEY || '').trim();
}

function hasXaiKey() {
  return xaiKey().length > 0;
}

function modelForTier(tier) {
  if (tier === 'fast') {
    return (process.env.XAI_MODEL_FAST || 'grok-4.20-0309-non-reasoning').trim() || 'grok-4.20-0309-non-reasoning';
  }
  if (tier === 'quality') {
    return (process.env.XAI_MODEL_QUALITY || 'grok-4.7').trim() || 'grok-4.7';
  }
  return (process.env.XAI_MODEL_NURTURE || 'grok-4.3').trim() || 'grok-4.3';
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(raw);
  } catch (e) {}
  const slices = [];
  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  const arrStart = raw.indexOf('[');
  const arrEnd = raw.lastIndexOf(']');
  if (objStart !== -1 && objEnd > objStart) slices.push(raw.slice(objStart, objEnd + 1));
  if (arrStart !== -1 && arrEnd > arrStart) slices.push(raw.slice(arrStart, arrEnd + 1));
  for (const slice of slices) {
    try {
      return JSON.parse(slice);
    } catch (e) {}
  }
  throw new Error('Grok応答のJSONを読めませんでした');
}

function outputTextFromResponses(data) {
  if (data && typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const chunks = [];
  const output = data && Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    const parts = item && Array.isArray(item.content) ? item.content : [];
    for (const part of parts) {
      if (part && typeof part.text === 'string') chunks.push(part.text);
      else if (part && typeof part.output_text === 'string') chunks.push(part.output_text);
    }
  }
  return chunks.join('').trim();
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${xaiKey()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      data = { raw };
    }
    if (!res.ok) {
      const msg = (data.error && (data.error.message || data.error)) || raw.slice(0, 240);
      throw new Error(`Grok API ${res.status}: ${msg}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function userMessages(prompt, messages) {
  if (Array.isArray(messages) && messages.length > 0) return messages;
  return [{ role: 'user', content: String(prompt || '') }];
}

function withSystemPrompt(systemPrompt, prompt, messages) {
  const base = userMessages(prompt, messages);
  const system = String(systemPrompt || '').trim();
  if (!system) return base;
  return [{ role: 'system', content: system }, ...base.filter(message => message.role !== 'system')];
}

function searchAttempts(options) {
  const handles = (Array.isArray(options.excludedXHandles) ? options.excludedXHandles : [])
    .map(handle => String(handle || '').replace(/^@/, '').trim())
    .filter(Boolean)
    .slice(0, 10);
  const attempts = [];
  if (options.xSearch !== false) {
    const xTool = { type: 'x_search' };
    if (handles.length) xTool.excluded_x_handles = handles;
    if (options.xSearchOnly === true) {
      attempts.push([xTool]);
      attempts.push([{ type: 'x_search' }]);
      return attempts;
    }
    attempts.push([xTool, { type: 'web_search' }]);
    attempts.push([{ type: 'x_search' }]);
  }
  attempts.push([{ type: 'web_search' }]);
  return attempts;
}

async function completeText({
  tier = 'quality',
  prompt = '',
  messages = null,
  temperature,
  json = false,
  search = false,
  xSearch = true,
  xSearchOnly = false,
  excludedXHandles = [],
  reasoningEffort = '',
  model: modelOverride = '',
  systemPrompt = '',
  timeoutMs = 60000
} = {}) {
  if (!hasXaiKey()) {
    const err = new Error('XAI_API_KEY が設定されていません');
    err.code = 'NO_XAI_KEY';
    throw err;
  }
  if (search) {
    const override = String(modelOverride || '').trim();
    const model = override || (tier === 'fast' ? modelForTier('fast') : modelForTier('quality'));
    const attempts = searchAttempts({ xSearch, xSearchOnly, excludedXHandles });
    let data = null;
    let lastError = null;
    for (let i = 0; i < attempts.length; i += 1) {
      try {
        data = await postJson(RESPONSES_URL, {
          model,
          input: withSystemPrompt(systemPrompt, prompt, messages),
          tools: attempts[i],
          store: false
        }, timeoutMs);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const canStepDown = i < attempts.length - 1 && /400/.test(String(error && error.message || ''));
        if (!canStepDown) throw error;
      }
    }
    if (!data) throw lastError || new Error('x_search_failed');
    return { text: outputTextFromResponses(data), modelName: model, usage: data.usage || null };
  }
  const model = String(modelOverride || '').trim() || modelForTier(tier);
  const body = {
    model,
    messages: withSystemPrompt(systemPrompt, prompt, messages),
    temperature: typeof temperature === 'number' ? temperature : (tier === 'nurture' ? 0.95 : 0.7)
  };
  const nonReasoning = /non-reasoning/i.test(model);
  if (!nonReasoning && tier === 'nurture') body.reasoning_effort = 'none';
  else if (!nonReasoning && tier === 'quality' && !modelOverride) body.reasoning_effort = String(reasoningEffort || process.env.XAI_REASONING_EFFORT_QUALITY || 'low').trim() || 'low';
  else if (!nonReasoning && reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (json) body.response_format = { type: 'json_object' };
  const data = await postJson(CHAT_URL, body, timeoutMs);
  const choice = data.choices && data.choices[0];
  if (choice && choice.finish_reason === 'length') {
    const error = new Error('output_truncated');
    error.code = 'output_truncated';
    throw error;
  }
  const text = choice && choice.message ? choice.message.content : '';
  return { text: String(text || '').trim(), modelName: model, usage: data.usage || null };
}

async function completeJson(options) {
  const { text, modelName } = await completeText({ ...options, json: true, search: false });
  return { parsed: extractJson(text), modelName, text };
}

module.exports = {
  hasXaiKey,
  modelForTier,
  extractJson,
  withSystemPrompt,
  searchAttempts,
  completeText,
  completeJson
};
