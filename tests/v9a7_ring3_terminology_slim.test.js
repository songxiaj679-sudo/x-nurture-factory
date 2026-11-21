'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { briefPrompt, candidatePrompt } = require('../src/next_post_draft');

const brand = { terminology: ['TERMTOKEN99'], oneLineMechanism: 'MECHANISM68' };

function brief(ring) {
  return briefPrompt({
    isEn: false,
    page: { description: '', headings: [] },
    domainSlot: true,
    brandKnowledge: brand,
    masterPlan: { topicRing: ring }
  });
}

test('ring 3 drops the term list and the other rings keep it', () => {
  const ring3 = brief('ring3_product_bridge');
  const ring1 = brief('ring1_craft');
  const ring2 = brief('ring2_broad_adjacent');
  assert.equal(ring3.includes('TERMTOKEN99'), false);
  assert.match(ring3, /MECHANISM68/);
  assert.match(ring1, /TERMTOKEN99/);
  assert.match(ring2, /TERMTOKEN99/);
  const writer = candidatePrompt({
    isEn: false,
    brief: {},
    shape: { count: 1 },
    accountState: { maxChars: 280 },
    domainSlot: true,
    brandKnowledge: brand,
    masterPlan: { topicRing: 'ring3_product_bridge' }
  });
  assert.equal(writer.includes('TERMTOKEN99'), false);
  assert.match(writer, /MECHANISM68/);
  const isolated = briefPrompt({
    isEn: false,
    page: { description: '', headings: [] },
    isolateLpContext: true,
    brandKnowledge: brand,
    masterPlan: { topicRing: 'ring1_craft' }
  });
  assert.equal(isolated.includes('TERMTOKEN99'), false);
});
