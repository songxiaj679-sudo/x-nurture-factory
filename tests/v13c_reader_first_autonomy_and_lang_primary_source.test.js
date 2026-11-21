'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrimarySource, selectArticleUrls, formatTopicSourceAsDossier } = require('../src/topic_source_vault');
const { systemRules, candidatePrompt, criticSystemRules } = require('../src/next_post_draft');

test('a Japanese official source passes without the word paper, and a roundup still fails', () => {
  assert.equal(isPrimarySource({ url: 'https://news.example.co.jp/hours', sourceName: '公式ブログ' }), true);
  assert.equal(isPrimarySource({ url: 'https://docs.example.jp/hours', sourceName: '営業時間' }), true);
  assert.equal(isPrimarySource({ url: 'https://assoc.example.or.jp/2024', sourceName: '業界の調査レポート' }), true);
  assert.equal(isPrimarySource({ url: 'https://journal.example.org/item', sourceName: '論文' }), false);
  assert.equal(isPrimarySource({ url: 'https://blog.example/seven', sourceName: 'コツ7選' }), false);
  assert.equal(isPrimarySource({ url: 'https://arxiv.org/abs/1', sourceName: '原典' }), true);
});

test('one host contributes at most one candidate', async () => {
  const chosen = await selectArticleUrls({
    outputLang: 'ja',
    ownUrls: [],
    completeText: async () => ({ text: JSON.stringify({ items: [
      { url: 'https://docs.example.com/spec/a', sourceName: '公式ドキュメント' },
      { url: 'https://docs.example.com/spec/b', sourceName: '公式ドキュメント' },
      { url: 'https://arxiv.org/abs/1', sourceName: '関連論文' }
    ] }) }),
    assertUrl: () => {}
  });
  assert.deepEqual(chosen.map(row => row.url), [
    'https://docs.example.com/spec/a',
    'https://arxiv.org/abs/1'
  ]);
  const five = await selectArticleUrls({
    outputLang: 'ja',
    ownUrls: [],
    completeText: async () => ({ text: JSON.stringify({ items: [
      { url: 'https://docs.example.com/spec/a', sourceName: '公式ドキュメント' },
      { url: 'https://arxiv.org/abs/1', sourceName: '関連論文' },
      { url: 'https://github.com/example/repo', sourceName: '公開リポジトリ' },
      { url: 'https://developer.example.org/docs/c', sourceName: '公式ドキュメント' },
      { url: 'https://stats.example.gov/report', sourceName: '統計' }
    ] }) }),
    assertUrl: () => {}
  });
  assert.equal(five.length, 3);
});

test('the search prefers a source the reader can open in that language', async () => {
  const seen = [];
  await selectArticleUrls({
    outputLang: 'ja',
    brandKnowledge: { icpSummary: '店主', domainProblems: ['紙が古い'] },
    ownUrls: [],
    completeText: async options => {
      seen.push(options.prompt);
      return { text: '{"items":[]}' };
    },
    assertUrl: () => {}
  });
  assert.match(seen[0], /言語を問わず3〜5件、別ドメインから1件ずつ返す/);
  assert.match(seen[0], /事業領域から外れた無関係な論文は選ばない/);
  const english = [];
  await selectArticleUrls({
    outputLang: 'en',
    ownUrls: [],
    completeText: async options => {
      english.push(options.prompt);
      return { text: '{"items":[]}' };
    },
    assertUrl: () => {}
  });
  assert.match(english[0], /Return 3 to 5 primary sources/);
  assert.match(english[0], /unrelated paper from another field/);
});

test('the writer and the critic drop the conflicting rules and keep one reader test', () => {
  const rules = systemRules(false);
  const prompt = candidatePrompt({
    isEn: false,
    isolateLpContext: true,
    topicSource: { sourceName: '公式ブログ', coreFact: '紙は予定と別に替わる。', plainTranslation: '店の予定を直しても入口の紙は遅れる。' },
    masterPlan: { topicRing: 'ring1_craft' },
    accountState: { maxChars: 280 },
    shape: { count: 1 }
  });
  const critic = criticSystemRules(false);
  const note = formatTopicSourceAsDossier({
    sourceName: '公式ブログ',
    coreFact: '紙は予定と別に替わる。',
    plainTranslation: '店の予定を直しても入口の紙は遅れる。'
  }, false, 700);
  for (const text of [rules, prompt, critic]) {
    assert.equal(text.includes('中学生が一度読んだだけで'), false);
    assert.equal(text.includes('熟語が続くときは下げる'), false);
    assert.equal(text.includes('学問名の前置きは本文に出さない'), false);
    assert.equal(text.includes('出典名と、誰が何を調べたかを省かない'), false);
  }
  assert.equal(prompt.includes('平易な言葉で書く'), false);
  assert.equal(note.includes('出典名を本文に残し'), false);
  assert.match(rules, /子ども向けに言い換えず/);
  assert.match(prompt, /子ども向けに言い換えず/);
  assert.match(critic, /手順の羅列や直訳で止まらず/);
  assert.equal(critic.length < 400, true);
  assert.match(critic, /1行目の主語が結びまで続く/);
  assert.match(critic, /自然な口語/);
  assert.match(critic, /空行がなく文字が詰まる/);
  assert.match(critic, /保存したくなる具体/);
});
