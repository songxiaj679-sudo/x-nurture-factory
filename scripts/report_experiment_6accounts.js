#!/usr/bin/env node
'use strict';

require('dotenv').config();

const DEFAULT_USD_JPY = Number(process.env.USD_JPY_RATE || 155);
const V4_USER_ID = 'WEB-GOOGLE-D12E2479A76266AEA2B4';

function avg(nums) {
  const clean = nums.filter(n => Number.isFinite(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function summarizeAccount({ userId, user = {}, traces = [], jobs = [], usdJpy = DEFAULT_USD_JPY }) {
  const costs = traces.map(t => Number(t && t.totalCostUsd)).filter(n => Number.isFinite(n) && n >= 0);
  const scores = traces
    .filter(t => t && t.finalCriticScore != null && t.finalCriticScore !== '')
    .map(t => Number(t.finalCriticScore))
    .filter(n => Number.isFinite(n));
  const repairs = traces.filter(t => Number(t && t.repairCount) > 0).length;
  const llmCounts = traces.map(t => {
    const rows = Array.isArray(t && t.qualityAudit) ? t.qualityAudit : [];
    return rows.filter(r => r && (r.role === 'writer' || r.role === 'critic')).length;
  });
  const reviewPassCount = traces.filter(t => {
    if (!t || t.criticDegraded === true) return false;
    const rows = Array.isArray(t.qualityAudit) ? t.qualityAudit : [];
    const critics = rows.filter(r => r && r.role === 'critic');
    if (critics.length) return critics.some(c => c.ok === true);
    return Number(t.repairCount || 0) === 0;
  }).length;
  const mature = jobs.filter(j => j && j.metrics24hSnapshot && j.metrics24hSnapshot.isFrozen === true);
  const imps = mature.map(j => Number(j.metrics24hSnapshot.impressions)).filter(Number.isFinite);
  const saves = mature.map(j => Number(j.metrics24hSnapshot.bookmarks)).filter(Number.isFinite);
  const totalUsd = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  const avgUsd = avg(costs);
  const avgScore = avg(scores);
  const avgLlmCalls = avg(llmCounts);
  const avgImp = avg(imps);
  const avgSave = avg(saves);
  const latestEvo = (traces[0] && traces[0].evolutionVersion) || (user.promptEvolution && user.promptEvolution.activeVersion) || 'baseline';
  return {
    userId,
    handle: user.xUsername ? `@${String(user.xUsername).replace(/^@/, '')}` : '-',
    mode: user.contentMode || 'business',
    traceCount: traces.length,
    totalUsd,
    avgUsd,
    avgJpy: avgUsd != null ? avgUsd * usdJpy : null,
    avgLlmCalls: avgLlmCalls != null ? Math.round(avgLlmCalls * 10) / 10 : null,
    reviewPassRatePct: traces.length ? Math.round((reviewPassCount / traces.length) * 100) : null,
    repairRatePct: traces.length ? Math.round((repairs / traces.length) * 100) : null,
    failuresToday: Number(user.ensureNextPostFailures || 0),
    avgScore: avgScore != null ? Math.round(avgScore * 10) / 10 : null,
    evolutionVersion: latestEvo,
    matureCount: mature.length,
    avgImp24h: avgImp != null ? Math.round(avgImp * 10) / 10 : null,
    avgBookmarks24h: avgSave != null ? Math.round(avgSave * 10) / 10 : null
  };
}

function formatMarkdownTable(rows) {
  const fmtUsd = v => (v == null ? '-' : `$${v.toFixed(4)}`);
  const fmtJpy = v => (v == null ? '-' : `¥${v.toFixed(2)}`);
  const fmtNum = v => (v == null ? '-' : String(v));
  const header = [
    '| Account | Mode | Traces | Avg LLM | Avg Cost (USD/JPY) | Total Cost | Review Pass% | Repair% | Fails | Avg Score | Evo | 24h Mature | Avg Imp | Avg BM |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|'
  ];
  const lines = rows.map(r => (
    `| ${r.handle} (\`${r.userId.slice(0, 12)}\`) | ${r.mode} | ${r.traceCount} | ${fmtNum(r.avgLlmCalls)} | ${fmtUsd(r.avgUsd)} / ${fmtJpy(r.avgJpy)} | ${fmtUsd(r.totalUsd)} | ${r.reviewPassRatePct == null ? '-' : `${r.reviewPassRatePct}%`} | ${r.repairRatePct == null ? '-' : `${r.repairRatePct}%`} | ${r.failuresToday} | ${fmtNum(r.avgScore)} | ${r.evolutionVersion} | ${r.matureCount} | ${fmtNum(r.avgImp24h)} | ${fmtNum(r.avgBookmarks24h)} |`
  ));
  return [...header, ...lines].join('\n');
}

async function runCli() {
  const { db } = require('../src/firestore');
  const days = Math.max(1, Number(process.argv[2]) || 14);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const usersSnap = await db.collection('saas_users').limit(200).get();
  const targets = [];
  usersSnap.forEach(doc => {
    const id = doc.id;
    if (id === V4_USER_ID || id.startsWith('WS-')) {
      targets.push({ userId: id, user: doc.data() || {} });
    }
  });
  targets.sort((a, b) => (a.userId === V4_USER_ID ? -1 : b.userId === V4_USER_ID ? 1 : a.userId.localeCompare(b.userId)));

  const rows = [];
  for (const target of targets) {
    const [traceSnap, jobSnap] = await Promise.all([
      db.collection('generation_traces').where('userId', '==', target.userId).limit(100).get(),
      db.collection('autopilot_jobs').where('userId', '==', target.userId).where('status', '==', 'posted').limit(100).get()
    ]);
    const traces = [];
    traceSnap.forEach(d => {
      const row = d.data() || {};
      if (!row.createdAt || String(row.createdAt) >= sinceIso) traces.push(row);
    });
    traces.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const jobs = [];
    jobSnap.forEach(d => jobs.push(d.data() || {}));
    rows.push(summarizeAccount({ userId: target.userId, user: target.user, traces, jobs }));
  }
  console.log(`# VELOX AI Experiment Report (last ${days} days, targets=${rows.length})\n`);
  console.log(formatMarkdownTable(rows));
  process.exit(0);
}

if (require.main === module) {
  runCli().catch(err => {
    console.error('[Experiment Report Error]:', err && err.message || err);
    process.exit(1);
  });
}

module.exports = { summarizeAccount, formatMarkdownTable };
