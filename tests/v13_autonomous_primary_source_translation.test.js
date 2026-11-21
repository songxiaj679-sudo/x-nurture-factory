'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { selectArticleUrls, isPrimarySource, safeArticleUrl, collectTopicSourceForUser, formatTopicSourceAsDossier } = require('../src/topic_source_vault');

test('the search asks for one rumor and keeps only a primary source', async () => {
  const source = fs.readFileSync('src/topic_source_vault.js', 'utf8');
  assert.match(source, /噂や思い込みで困っている具体的な疑問を1つだけ自律的に選ぶ/);
  assert.match(source, /初心者向けまとめ・SEO解説ブログ/);
  assert.match(source, /公式仕様、公的統計、業界ガイドライン、論文、公開コード、リリースノート、調査報告/);
  const seen = [];
  const chosen = await selectArticleUrls({
    brandKnowledge: { icpSummary: '店主', domainProblems: ['紙が古い'] },
    outputLang: 'ja',
    ownUrls: [],
    completeText: async options => {
      seen.push(options.prompt);
      return { text: JSON.stringify({ items: [
        { url: 'https://blog.example/tips', sourceName: '初心者向け完全ガイド' },
        { url: 'https://docs.example.com/spec/hours', sourceName: '営業時間の仕様' }
      ] }) };
    },
    assertUrl: () => {}
  });
  assert.match(seen[0], /噂や思い込みで困っている/);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].url, 'https://docs.example.com/spec/hours');
  assert.equal(isPrimarySource({ url: 'https://blog.example/seven', sourceName: 'コツ7選' }), false);
  const none = await selectArticleUrls({
    outputLang: 'ja',
    ownUrls: [],
    completeText: async () => ({ text: JSON.stringify({ items: [{ url: 'https://blog.example/guide', sourceName: '基本設計の解説' }] }) }),
    assertUrl: () => {}
  });
  assert.equal(none.length, 0);
  assert.equal(safeArticleUrl('https://docs.x.com/x-api/posts', [], null).includes('docs.x.com'), true);
  assert.equal(safeArticleUrl('https://x.com/someone/status/1', [], null), '');
  const spread = await selectArticleUrls({
    outputLang: 'ja',
    ownUrls: [],
    completeText: async () => ({ text: JSON.stringify({ items: [
      { url: 'https://docs.example.com/spec/a', sourceName: '公式仕様' },
      { url: 'https://docs.example.com/spec/b', sourceName: '公式仕様' },
      { url: 'https://developer.example.org/docs/c', sourceName: '公式ドキュメント' },
      { url: 'https://arxiv.org/paper/d', sourceName: '論文' }
    ] }) }),
    assertUrl: () => {}
  });
  assert.deepEqual(spread.map(row => row.url), [
    'https://docs.example.com/spec/a',
    'https://developer.example.org/docs/c',
    'https://arxiv.org/paper/d'
  ]);
});

test('a 403 on the first primary source falls through to the next one', async () => {
  process.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'test-key';
  const fetched = [];
  const card = await collectTopicSourceForUser({
    dryRun: true,
    outputLang: 'ja',
    brandKnowledge: { icpSummary: '店主', domainProblems: ['紙が古い'] },
    completeText: async () => ({ text: JSON.stringify({ items: [
      { url: 'https://docs.example.com/spec/closed', sourceName: '公式仕様' },
      { url: 'https://arxiv.org/paper/open', sourceName: '論文' }
    ] }) }),
    completeJson: async () => ({ parsed: {
      readerQuestion: '表示はいつ入れ替わるのか。',
      coreFact: '論文では更新が14日以内。',
      mechanism: '表示は予定と別に更新される。',
      plainTranslation: '手元の予定を直しても、表示は別の日に入れ替わる。'
    } }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      fetched.push(body.url);
      if (String(body.url).includes('closed')) return { ok: false, status: 403, async text() { return '{"success":false}'; } };
      return { ok: true, async text() { return JSON.stringify({ success: true, data: { markdown: '論文では更新が14日以内。' } }); } };
    },
    assertUrl: () => {}
  });
  assert.deepEqual(fetched, ['https://docs.example.com/spec/closed', 'https://arxiv.org/paper/open']);
  assert.equal(card.sourceUrl, 'https://arxiv.org/paper/open');
  assert.match(card.plainTranslation, /入れ替わる/);
});

test('a translation card stands without a task, and an old card still reads', async () => {
  process.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'test-key';
  const card = await collectTopicSourceForUser({
    dryRun: true,
    outputLang: 'ja',
    brandKnowledge: { icpSummary: '店主', domainProblems: ['紙が古い'] },
    completeText: async () => ({ text: JSON.stringify({ items: [{ url: 'https://docs.example.com/spec/hours', sourceName: '公式仕様' }] }) }),
    completeJson: async () => ({ parsed: {
      sourceName: '公式仕様',
      readerQuestion: '休みの紙は、いつ直るのか。',
      coreFact: '仕様では表示の更新が14日以内。',
      mechanism: '表示は手元の予定と別に更新される。',
      plainTranslation: '店の予定を直しても、入口の紙は別のタイミングで入れ替わる。'
    } }),
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify({ success: true, data: { markdown: '仕様では表示の更新が14日以内。' } }); } }),
    assertUrl: () => {}
  });
  assert.equal(card.actionableTakeaway, '');
  assert.match(card.plainTranslation, /入口の紙/);
  const note = formatTopicSourceAsDossier(card, false, 700);
  assert.match(note, /入口の紙/);
  assert.equal(note.includes('訳:'), false);
  assert.equal(note.includes('一手'), false);
  const legacy = formatTopicSourceAsDossier({
    sourceName: '現場ノート',
    coreFact: '14日ごとに見る。',
    mechanism: '間隔を固定する。',
    actionableTakeaway: '日付を書く。'
  }, false, 700);
  assert.match(legacy, /日付を書く/);
  assert.match(legacy, /要点:/);
  assert.equal(legacy.includes('一手'), false);
});

test('the writer keeps the source name and does not close on a fix list', () => {
  const { candidatePrompt } = require('../src/next_post_draft');
  const note = formatTopicSourceAsDossier({
    sourceName: '公的な調査',
    readerQuestion: '正確な発信は、なぜ広がらないのか。',
    coreFact: '調査主体は反応の多い投稿を先に見せていた。',
    mechanism: '目立つ場所は、感情が動いた投稿から埋まっていく。',
    plainTranslation: '正確な投稿でも、感情が動く投稿のあとまわしになる。'
  }, false, 700);
  assert.match(note, /出典名を本文に残し/);
  assert.match(note, /公的な調査/);
  assert.equal(note.includes('一手'), false);
  const prompt = candidatePrompt({
    isEn: false,
    isolateLpContext: true,
    topicSource: { sourceName: '公的な調査', coreFact: '調査主体は反応の多い投稿を先に見せていた。', mechanism: '目立つ場所は感情が動いた投稿から埋まる。', plainTranslation: '正確な投稿はあとまわしになる。' },
    masterPlan: { topicRing: 'ring1_craft' },
    accountState: { maxChars: 280 },
    shape: { count: 1 },
    voiceProfile: { accountRole: 'official_brand' }
  });
  assert.match(prompt, /直しどころを決める、では終えない/);
  assert.match(prompt, /何の研究か誰の話かを消さない/);
  assert.match(prompt, /誰の話か分からない主語にはしない/);
});
