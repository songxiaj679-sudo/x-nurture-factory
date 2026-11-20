'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('plain-text archetypes ask for a chosen layout and an honest thread pull', () => {
  const { archetypePromptLines } = require('../src/editorial_archetypes');
  const rewrite = archetypePromptLines({ archetype: 'before_after_rewrite', isEn: false, thread: true });
  assert.match(rewrite, /内容に合わせて選ぶ/);
  assert.equal(rewrite.includes('なぜ後者が持つか'), false);
  assert.equal(rewrite.includes('×'), false);
  const english = archetypePromptLines({ archetype: 'before_after_rewrite', isEn: true });
  assert.match(english, /Choose the layout/);
  assert.equal(english.includes('Before:'), false);
  const checklist = archetypePromptLines({ archetype: 'actionable_checklist', isEn: false });
  assert.equal(checklist.includes('①'), false);
  const englishList = archetypePromptLines({ archetype: 'actionable_checklist', isEn: true, thread: true });
  assert.match(englishList, /honest two-tweet thread/);
  assert.equal(englishList.includes('1. '), false);
});

test('english dossier text stops on a word boundary', () => {
  const { scrubField } = require('../src/source_dossier_engine');
  const text = `${'alpha '.repeat(18)}UnfinishedTokenThatMustStayWhole and the rest of the sentence continues past the limit.`;
  const clipped = scrubField(text, 120, 'VELOX AI');
  assert.equal(clipped.includes('Unfinished'), false);
  assert.equal(clipped.endsWith('alpha'), true);
  assert.ok(clipped.length <= 120);
});

test('external value cards use the topic templates and omit the product name', async () => {
  const { planVisualCard, renderVisualCardPng } = require('../src/visual_card');
  const rewrite = {
    topic: '1行目の置き方',
    weakExample: '最近気づいたことを書きます',
    strongExample: '棚卸しは数える順番を固定すると抜けが減ります',
    whyItWorks: '前置きを消しても中身が残る'
  };
  const steps = {
    topic: '出どころを分ける',
    steps: ['原文で確認した文に印を付ける', '聞いた話は聞いた話と書く', '自分の判断だけを残す'],
    boundaryNote: '付けられない文は未確認と書く'
  };
  const japaneseBefore = planVisualCard({
    isolateLpContext: true,
    archetype: 'before_after_rewrite',
    lang: 'ja',
    brandKnowledge: { productName: 'VELOX AI' },
    focusTopic: rewrite
  });
  const japaneseList = planVisualCard({
    isolateLpContext: true,
    archetype: 'actionable_checklist',
    lang: 'ja',
    brandKnowledge: { productName: 'VELOX AI' },
    focusTopic: steps
  });
  const englishBefore = planVisualCard({
    isolateLpContext: true,
    archetype: 'before_after_rewrite',
    lang: 'en',
    brandKnowledge: { productName: 'VELOX AI' },
    focusTopic: {
      topic: 'Opening line',
      weakExample: 'I wanted to share a small update today.',
      strongExample: 'Fix the count order before you add a new item.',
      whyItWorks: 'The reader can test the line without a preface.'
    }
  });
  const englishList = planVisualCard({
    isolateLpContext: true,
    archetype: 'actionable_checklist',
    lang: 'en',
    focusTopic: {
      topic: 'Separate the source',
      steps: ['Mark what you read yourself', 'Label what you only heard', 'Keep your own judgment apart'],
      boundaryNote: 'If you cannot label a line, call it unchecked.'
    }
  });
  assert.equal(japaneseBefore.template, 'before_after_card');
  assert.equal(japaneseList.template, 'checklist_3step_card');
  assert.equal(englishBefore.badge, 'BEFORE / AFTER');
  assert.equal(englishList.badge, '3-STEP CHECK');
  for (const plan of [japaneseBefore, japaneseList, englishBefore, englishList]) {
    assert.equal(plan.eligible, true);
    assert.equal(JSON.stringify(plan).includes('VELOX AI'), false);
    assert.equal(JSON.stringify(plan).includes('登録ページ'), false);
    const png = await renderVisualCardPng(plan);
    assert.equal(png.slice(0, 4).toString('hex'), '89504e47');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 675);
  }
  const legacy = planVisualCard({
    portfolioRole: 'utility_save',
    lang: 'ja',
    focusPlaybook: { id: 'pb_1', topic: '確認', checkCriteria: '主語を揃える', commonMistake: '機能名から書く', boundaryCondition: 'ページ外は足さない' }
  });
  assert.equal(legacy.template, 'editorial_split');
  assert.equal(legacy.eligible, true);
});

test('visual card cache key includes the template version', () => {
  const source = fs.readFileSync('src/hybrid_saas_routes.js', 'utf8');
  assert.match(source, /:v3:\$\{job\.visualCard\.template \|\| 'editorial_split'\}/);
});
