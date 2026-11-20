'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { archetypePromptLines } = require('../src/editorial_archetypes');

test('an arrow is a change of state, not a label beside an example', () => {
  const ja = archetypePromptLines({ archetype: 'before_after_rewrite', isEn: false });
  const en = archetypePromptLines({ archetype: 'before_after_rewrite', isEn: true });
  assert.match(ja, /矢印は、前の状態が次の状態へ変わるときだけ使う/);
  assert.match(ja, /見出しと例のあいだには置かない/);
  assert.match(en, /An arrow only shows one state becoming the next/);
  assert.match(en, /not a label next to an example/);
  assert.match(ja, /内容に合わせて選ぶ/);
  assert.match(en, /Choose the layout/);
});
