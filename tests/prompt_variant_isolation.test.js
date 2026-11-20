'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const episodes = [{
  id: 'episode-1',
  outcome: 'WINNER',
  angle: 'workflow',
  text: 'episode reference unique',
  keywords: ['workflow'],
  compositeScore: 80
}];

const db = {
  collection(name) {
    assert.equal(name, 'saas_users');
    return {
      doc(userId) {
        assert.equal(userId, 'user-1');
        return {
          async get() { return { exists: false }; },
          collection(name) {
            assert.equal(name, 'episodic_memories');
            const query = {
              orderBy() { return query; },
              limit() { return query; },
              async get() {
                return { docs: episodes.map(episode => ({ id: episode.id, data: () => episode })) };
              }
            };
            return query;
          }
        };
      }
    };
  }
};

function stubModule(path, exports) {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule('../src/firestore', { db });
stubModule('../src/collective_intelligence', {});
stubModule('../src/ai_deliberation_council', {});
stubModule('../src/official_api_client', {});
stubModule('../src/map_elites_memory', {
  async sampleFromMapElitesArchive() {
    return {
      mode: 'explore',
      angle: { name: 'workflow', desc: 'workflow' },
      audience: { name: 'reader' },
      directive: 'shared directive'
    };
  }
});

const { buildCouncilWritingPrompt } = require('../src/autonomous_promo_ai');

test('production prompt keeps stored episodes and DPO pairs out of both variants', async () => {
  const options = {
    userId: 'user-1',
    marketAnalysis: { serviceName: 'shared service' },
    councilPlan: { postPlan: [{ angle: 'workflow', timeSlot: 'morning' }] },
    userKnowledge: {
      dpoPreferencePairs: [{
        winner: { text: 'winner reference unique' },
        loser: { text: 'loser reference unique' }
      }]
    }
  };
  const { prompt: control } = await buildCouncilWritingPrompt({ ...options, experimentVariant: 'A' });
  const { prompt: treatment } = await buildCouncilWritingPrompt({ ...options, experimentVariant: 'B' });

  for (const reference of ['episode reference unique', 'winner reference unique', 'loser reference unique']) {
    assert.ok(!control.includes(reference), `control includes ${reference}`);
    assert.ok(!treatment.includes(reference), `treatment includes ${reference}`);
  }
  assert.match(control, /過去の勝ち文は渡していない/);
  assert.match(treatment, /過去の勝ち文は渡していない/);
  for (const shared of ['shared service', '本文内に直接URLは貼らず']) {
    assert.ok(control.includes(shared));
    assert.ok(treatment.includes(shared));
  }
});
