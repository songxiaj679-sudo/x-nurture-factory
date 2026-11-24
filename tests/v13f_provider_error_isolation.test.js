'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PostConstraintError } = require('../src/post_constraint_guard');
const provider = require('../src/provider_error');

function billingError() {
  const error = new Error('400 Your credit balance is too low to access the Anthropic API.');
  error.status = 400;
  return error;
}

describe('provider errors stay out of the daily lock', { concurrency: 1 }, () => {
test('a low Anthropic balance stays a billing error and does not become an empty draft', () => {
  provider.clearProviderCooldown();
  const classified = provider.classifyProviderError(billingError(), 'anthropic');
  assert.equal(classified.class, 'provider_billing_error');
  assert.equal(classified.provider, 'anthropic');
  assert.equal(classified.status, 400);
  const stop = provider.providerStop(billingError(), 'anthropic');
  assert.equal(stop.code, 'provider_billing_error');
  assert.equal(stop.message.includes(provider.QUALITY_STOP), false);
  const decision = provider.ensureFailureDecision(stop, { failures: 2, lang: 'ja' });
  assert.equal(decision.lock, false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision.update, 'ensureNextPostFailures'), false);
  assert.equal(decision.update.lastEnsureNextErrorCode, 'provider_billing_error');
  assert.equal(decision.update.lastEnsureNextError.includes(provider.QUALITY_STOP), false);
  provider.clearProviderCooldown();
});

test('a real rejected draft still counts toward the daily lock', () => {
  provider.clearProviderCooldown();
  const err = new PostConstraintError(provider.QUALITY_STOP);
  err.rejectReasons = ['ungrounded_number:88%'];
  const decision = provider.ensureFailureDecision(err, { failures: 2, lang: 'ja' });
  assert.equal(decision.lock, true);
  assert.equal(decision.update.ensureNextPostFailures, 3);
  assert.equal(decision.update.lastEnsureNextError, provider.QUALITY_STOP);
  assert.deepEqual(decision.update.lastEnsureNextRejectReasons, ['ungrounded_number:88%']);
  provider.clearProviderCooldown();
});

test('the cooldown blocks another attempt and then lets the next cycle run', () => {
  provider.clearProviderCooldown();
  const lines = [];
  const previous = console.error;
  console.error = line => lines.push(String(line));
  try {
    const start = Date.parse('2026-11-24T04:00:00.000Z');
    provider.noteProviderFailure({ class: 'provider_billing_error', provider: 'anthropic', status: 400 }, start);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[CRITICAL\] provider=anthropic class=provider_billing_error http=400 cooldown_until=/);
    assert.equal(lines[0].includes('credit balance'), false);
    const during = provider.pauseError(start + 60 * 1000);
    assert.equal(during.code, 'provider_billing_error');
    provider.noteProviderFailure({ class: 'provider_billing_error', provider: 'anthropic', status: 400 }, start + 60 * 1000);
    assert.equal(lines.length, 1);
    const openedAgain = start + 60 * 1000;
    assert.equal(provider.providerCooldown(openedAgain + provider.COOLDOWN_MS - 1) === null, false);
    assert.equal(provider.providerCooldown(openedAgain + provider.COOLDOWN_MS), null);
    assert.equal(provider.pauseError(openedAgain + provider.COOLDOWN_MS), null);
    assert.equal(provider.COOLDOWN_MS, 12 * 60 * 1000);
  } finally {
    console.error = previous;
    provider.clearProviderCooldown();
  }
});

test('writer billing failure is thrown before a fallback and the draft catch does not swallow it', async () => {
  provider.clearProviderCooldown();
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'writer-key';
  let fallback = 0;
  const filename = require.resolve('../src/grok_client');
  const prev = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: {
      hasXaiKey: () => true,
      extractJson(text) { return JSON.parse(text); },
      async completeText() { fallback += 1; return { text: '{}', modelName: 'grok-test' }; }
    }
  };
  delete require.cache[require.resolve('../src/llm_router')];
  try {
    const { completeWriter } = require('../src/llm_router');
    await assert.rejects(
      () => completeWriter({
        prompt: 'write',
        systemPrompt: 'rules',
        schemaName: 'draft_json',
        timeoutMs: 5000,
        fetchImpl: async () => ({
          ok: false,
          status: 400,
          async text() { return JSON.stringify({ error: { message: 'Your credit balance is too low to access the Anthropic API.' } }); }
        })
      }),
      error => error.code === 'provider_billing_error' && !String(error.message).includes(provider.QUALITY_STOP)
    );
    assert.equal(fallback, 0);
    const draft = fs.readFileSync(path.join(__dirname, '../src/next_post_draft.js'), 'utf8');
    const candidates = draft.slice(draft.indexOf('emitStage(\'draft_candidates\')'), draft.indexOf('const selectionContext'));
    assert.match(candidates, /providerStop\(err\)/);
    assert.match(candidates, /if \(stop\) throw stop/);
    const dashboard = fs.readFileSync(path.join(__dirname, '../views/dashboard_view.html'), 'utf8');
    assert.match(dashboard, /文章の生成サービスが回復するまで/);
    assert.match(dashboard, /Draft generation is waiting for the language service to recover/);
  } finally {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
    delete require.cache[require.resolve('../src/llm_router')];
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
    provider.clearProviderCooldown();
  }
});
});
