'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('empty playbooks stay empty and keep the card field names', () => {
  const { fallbackPlaybooks, groundKnowledge } = require('../src/lp_knowledge_extractor');
  assert.deepEqual(fallbackPlaybooks(['その場の印象'], [], ''), []);
  const empty = groundKnowledge({ domainPlaybooks: [] }, 'メニュー写真だけ', 'メニュー写真だけ');
  assert.deepEqual(empty.domainPlaybooks, []);
  const kept = groundKnowledge({
    domainPlaybooks: [{
      topic: '朝の一杯',
      readerSituation: '起きてすぐ苦い一杯が欲しい',
      commonMistake: '熱いうちに急いで飲みきる',
      concreteTradeoff: '少し置くと香りが残る',
      checkCriteria: '香りが残っているか一口で見る',
      boundaryCondition: '冷めた杯には使わない'
    }]
  }, '朝の一杯は香りが残っているか一口で見る', '朝の一杯は香りが残っているか一口で見る');
  assert.equal(kept.domainPlaybooks.length, 1);
  assert.equal(kept.domainPlaybooks[0].checkCriteria.includes('香り'), true);
  assert.equal(typeof kept.domainPlaybooks[0].concreteTradeoff, 'string');
  assert.equal(typeof kept.domainPlaybooks[0].boundaryCondition, 'string');
});

test('an empty industry does not become a business search', async () => {
  const { industryQuery, fetchSituationalContext } = require('../src/context_radar');
  assert.equal(industryQuery({ category: '', icpSummary: '' }), '');
  assert.equal(industryQuery({ category: 'ab' }), '');
  assert.equal(industryQuery({ category: '' }).includes('B2B SaaS運用'), false);
  const radar = fs.readFileSync('src/context_radar.js', 'utf8');
  const dossier = fs.readFileSync('src/source_dossier_engine.js', 'utf8');
  assert.equal(radar.includes('operators in this field'), false);
  assert.equal(radar.includes('B2B SaaS運用'), false);
  assert.equal(dossier.includes('実務メモ'), false);
  assert.match(dossier, /currentDebate/);
  assert.equal(await fetchSituationalContext({ category: '', lang: 'ja' }), null);
});

test('brain generation stops until one reader clue exists', async () => {
  const { ensureAudienceKnowledge } = require('../src/audience_knowledge_engine');
  let called = false;
  const stopped = await ensureAudienceKnowledge({
    brandKnowledge: { category: '', icpSummary: '' },
    userPrompt: '   ',
    lang: 'ja',
    now: new Date('2026-11-20T00:00:00.000Z'),
    completeWriter: async () => { called = true; return { parsed: {} }; }
  });
  assert.equal(called, false);
  assert.equal(stopped.needsReaderHint, true);
  assert.equal(stopped.reason, 'missing_reader_context');
  assert.equal(stopped.budgetRecorded, false);
  const passed = await ensureAudienceKnowledge({
    brandKnowledge: { category: '自家焙煎カフェ', icpSummary: '' },
    userPrompt: '',
    lang: 'ja',
    now: new Date('2026-11-20T00:00:00.000Z'),
    completeWriter: async () => ({ parsed: { audienceTopics: [] } })
  });
  assert.equal(passed.needsReaderHint, undefined);
});

test('a thin page without a reader throws before a generic draft', () => {
  const { pageHasSubstance } = require('../src/autonomous_promo_ai');
  const source = fs.readFileSync('src/autonomous_promo_ai.js', 'utf8');
  assert.equal(pageHasSubstance({ title: 'Home', snippet: '' }), false);
  assert.equal(pageHasSubstance({ snippet: '朝に淹れた一杯の香りが、店の奥まで残っている。席は窓際です。' }), true);
  const start = source.indexOf('const hadAudience');
  const gate = source.slice(start, source.indexOf('const { decideNextPostMission }', start));
  assert.match(gate, /needsReaderHint === true/);
  assert.match(gate, /pageHasSubstance\(pageSummary\)/);
  assert.match(gate, /err\.code = 'MISSING_READER_CONTEXT'/);
  assert.match(gate, /err\.reason = 'missing_reader_context'/);
  assert.match(source, /budget_degraded_audit_failed/);
});
