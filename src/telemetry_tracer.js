'use strict';

const { randomBytes, randomUUID } = require('node:crypto');

function isTestProcess() {
  return process.env.NODE_ENV === 'test'
    || Boolean(process.env.NODE_TEST_CONTEXT)
    || (process.argv || []).some(arg => String(arg).includes('test'));
}

function alignmentCheck({ domainSlot = false, focusPlaybookId = '', hypothesisPlaybookId = '', customerReason = '', playbook = null, visualCard = null } = {}) {
  if (!domainSlot) return { alignmentOk: true, reason: 'not_domain_slot' };
  const id = String(focusPlaybookId || '');
  if (!id) return { alignmentOk: false, reason: 'missing_focus_playbook' };
  if (String(hypothesisPlaybookId || '') !== id) return { alignmentOk: false, reason: 'customer_reason_mismatch' };
  const why = String(playbook && playbook.readerSituation || '');
  const proof = String(playbook && playbook.checkCriteria || '');
  const reason = String(customerReason || '');
  if ((why && !reason.includes(why)) || (proof && !reason.includes(proof))) {
    return { alignmentOk: false, reason: 'customer_reason_text_mismatch' };
  }
  if (visualCard && visualCard.eligible === true && String(visualCard.focusPlaybookId || '') !== id) {
    return { alignmentOk: false, reason: 'visual_card_mismatch' };
  }
  return { alignmentOk: true, reason: 'aligned' };
}

function buildIngestionBatch(trace = {}) {
  const now = new Date().toISOString();
  const jobId = String(trace.jobId || randomUUID());
  const events = [{
    id: randomUUID(),
    type: 'trace-create',
    timestamp: now,
    body: {
      id: jobId,
      name: 'velox_next_post',
      userId: String(trace.userId || ''),
      metadata: {
        portfolioRole: trace.portfolioRole || '',
        slot: trace.timeSlot || '',
        lang: trace.lang || '',
        elapsedMs: Number(trace.elapsedMs) || 0,
        alignmentOk: trace.alignmentOk === true,
        focusPlaybookId: trace.focusPlaybookId || '',
        hasVisualCard: trace.hasVisualCard === true,
        masterPhase: trace.masterPhase || '',
        masterMission: trace.masterMission || '',
        topicRing: trace.topicRing || '',
        selectedTopicDomain: trace.selectedTopicDomain || '',
        visualCardTemplate: trace.visualCardTemplate || ''
      }
    }
  }];
  for (const row of Array.isArray(trace.qualityAudit) ? trace.qualityAudit : []) {
    if (!row || (row.role !== 'writer' && row.role !== 'critic')) continue;
    events.push({
      id: randomUUID(),
      type: 'generation-create',
      timestamp: now,
      body: {
        id: randomUUID(),
        traceId: jobId,
        name: row.role,
        model: row.model || '',
        metadata: {
          provider: row.provider || '',
          latencyMs: Number(row.ms) || 0,
          cachedTokens: row.cachedTokens || null,
          ok: row.ok === true,
          reason: String(row.reason || '').slice(0, 120)
        }
      }
    });
  }
  return { batch: events };
}

function langfuseConfig() {
  const base = String(process.env.LANGFUSE_BASE_URL || '').trim().replace(/\/$/, '');
  const publicKey = String(process.env.LANGFUSE_PUBLIC_KEY || '').trim();
  const secretKey = String(process.env.LANGFUSE_SECRET_KEY || '').trim();
  if (!base || !publicKey || !secretKey) return null;
  return { base, publicKey, secretKey };
}

function otelAttribute(key, value) {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') return { key, value: { intValue: String(Math.round(value)) } };
  return { key, value: { stringValue: String(value ?? '').slice(0, 200) } };
}

function buildOtelPayload(trace = {}) {
  const nowNs = String(Date.now()) + '000000';
  const traceId = randomBytes(16).toString('hex');
  const rootSpanId = randomBytes(8).toString('hex');
  const spans = [{
    traceId,
    spanId: rootSpanId,
    name: 'velox_next_post',
    kind: 1,
    startTimeUnixNano: nowNs,
    endTimeUnixNano: nowNs,
    attributes: [
      otelAttribute('langfuse.trace.name', 'velox_next_post'),
      otelAttribute('langfuse.observation.type', 'span'),
      otelAttribute('user.id', trace.userId || ''),
      otelAttribute('langfuse.trace.metadata.portfolioRole', trace.portfolioRole || ''),
      otelAttribute('langfuse.trace.metadata.slot', trace.timeSlot || ''),
      otelAttribute('langfuse.trace.metadata.lang', trace.lang || ''),
      otelAttribute('langfuse.trace.metadata.elapsedMs', Number(trace.elapsedMs) || 0),
      otelAttribute('langfuse.trace.metadata.alignmentOk', trace.alignmentOk === true),
      otelAttribute('langfuse.trace.metadata.focusPlaybookId', trace.focusPlaybookId || ''),
      otelAttribute('langfuse.trace.metadata.hasVisualCard', trace.hasVisualCard === true),
      otelAttribute('langfuse.trace.metadata.masterMission', trace.masterMission || ''),
      otelAttribute('langfuse.trace.metadata.topicRing', trace.topicRing || ''),
      otelAttribute('langfuse.trace.metadata.selectedTopicDomain', trace.selectedTopicDomain || ''),
      otelAttribute('langfuse.trace.metadata.visualCardTemplate', trace.visualCardTemplate || '')
    ]
  }];
  for (const row of Array.isArray(trace.qualityAudit) ? trace.qualityAudit : []) {
    if (!row || (row.role !== 'writer' && row.role !== 'critic')) continue;
    spans.push({
      traceId,
      spanId: randomBytes(8).toString('hex'),
      parentSpanId: rootSpanId,
      name: row.role,
      kind: 1,
      startTimeUnixNano: nowNs,
      endTimeUnixNano: nowNs,
      attributes: [
        otelAttribute('langfuse.observation.type', 'generation'),
        otelAttribute('langfuse.observation.model.name', row.model || ''),
        otelAttribute('langfuse.observation.metadata.provider', row.provider || ''),
        otelAttribute('langfuse.observation.metadata.latencyMs', Number(row.ms) || 0),
        otelAttribute('langfuse.observation.metadata.ok', row.ok === true),
        otelAttribute('langfuse.observation.metadata.reason', row.reason || '')
      ]
    });
  }
  return { resourceSpans: [{ resource: { attributes: [otelAttribute('service.name', 'velox')] }, scopeSpans: [{ scope: { name: 'velox-telemetry' }, spans }] }] };
}

async function emitGenerationTrace(trace, options = {}) {
  if (!options.fetchImpl && isTestProcess()) return { ok: false, skipped: true, reason: 'test' };
  const config = langfuseConfig();
  if (!config) return { ok: false, skipped: true, reason: 'unconfigured' };
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`${config.base}/api/public/otel/v1/traces`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'x-langfuse-ingestion-version': '4'
      },
      body: JSON.stringify(buildOtelPayload(trace)),
      signal: AbortSignal.timeout(4000)
    });
    return { ok: response.ok || response.status === 207, status: response.status };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error).slice(0, 160) };
  }
}

function scheduleGenerationTrace(trace, options = {}) {
  if (!options.fetchImpl && isTestProcess()) return { scheduled: false, reason: 'test' };
  emitGenerationTrace(trace, options).then(result => {
    if (result && result.status) console.log(`[Telemetry] langfuse ${result.status}`);
    else if (result && result.skipped) console.log(`[Telemetry] langfuse skipped ${result.reason}`);
  }).catch(error => {
    console.warn(`[Telemetry] ${String(error && error.message || error).slice(0, 160)}`);
  });
  return { scheduled: true };
}

module.exports = {
  alignmentCheck,
  buildIngestionBatch,
  emitGenerationTrace,
  scheduleGenerationTrace
};
