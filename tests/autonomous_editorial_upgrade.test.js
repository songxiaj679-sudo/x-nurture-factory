'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runDeterministicAudit } = require('../src/draft_verifier');
const { extractPageHypotheses } = require('../src/bandit_optimization_engine');
const { customerFacingReason } = require('../src/autonomous_promo_ai');
const { groundKnowledge } = require('../src/lp_knowledge_extractor');
const { filterRadarHints } = require('../src/context_radar');

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

const accountState = { maxChars: 280, postShape: 'single', singleOnly: true, subscription: 'premium' };
const plain = '確認場所を先に残すと、次の判断が同じ型で続く。読者が今日見る一点を先に固定すると、手順の揺れが減り、次の投稿も同じ入口から書けるようになる。';
const repaired = '最初に見る場所を一つに固定すると、確認そのものが次の判断の型になる。入口が毎回変わると、正しい手順もその場で選び直され、次の作業がぶれやすくなる。';
const structured = '確認場所を先に残すと、次の判断が同じ型で続く。\n\n入口を一つに固定する\n手順の揺れが減る\n次の確認を同じ場所に置く\n\n次の投稿も同じ入口から書ける。';

test('brochure cliches are rejected and a critic score under 72 is not published', async () => {
  const brochure = 'チームはこれを解明し、一つの仕組みで管理できるように設計している。これで効率的な運用が可能です。';
  assert.equal(runDeterministicAudit({ tweets: [brochure] }, { lang: 'ja', accountState }).reasons.includes('ai_slop'), true);
  let calls = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText() {
      calls += 1;
      if (calls === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', underlyingMechanism: '入口が固定される', everydayAssumption: 'その場で足りる' }) };
      if (calls === 2) return { modelName: 'candidates', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [plain] }, { id: 'b', tweets: [repaired] }] }) };
      if (calls === 3) return { modelName: 'critic', text: JSON.stringify({ scores: [{ id: 'a', score: 48, weakness: '製品説明' }] }) };
      if (calls === 4) return { modelName: 'repair', text: JSON.stringify({ candidates: [{ id: 'r', tweets: [repaired] }] }) };
      return { modelName: 'repair-critic', text: JSON.stringify({ scores: [{ id: 'r', score: 51, weakness: 'まだ説明文' }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostText } = require('../src/next_post_draft');
    await assert.rejects(() => draftNextPostText({
      lang: 'ja',
      userPrompt: '確認手順を一つ残す',
      accountState
    }), /検証を通る投稿案が無かった/);
  } finally {
    restore();
    delete require.cache[draftPath];
  }
});

test('a domain value slot teaches a domain problem instead of pitching the product claim', async () => {
  let candidatePrompt = '';
  let calls = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt }) {
      calls += 1;
      if (calls === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', thisPost: '判断の境界' }) };
      candidatePrompt = prompt;
      return { modelName: 'candidates', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [structured] }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostText } = require('../src/next_post_draft');
    const tweets = await draftNextPostText({
      lang: 'ja',
      skipCriticScore: true,
      accountState,
      portfolioPlan: { portfolioRole: 'utility_save', allowPromoUrl: false },
      genes: { format: 'structured_breakdown' },
      brandKnowledge: {
        productName: 'VELOX AI',
        verifiedClaims: [{ mechanism: 'VELOX AIは3ページを読んで投稿を作る', painScene: '機能説明', proofQuote: '開発者向け展示' }],
        domainProblems: ['保存と短期の表示ゆれを分けて見る', '一括自動化がスパム判定に寄る境界']
      }
    });
    assert.equal(tweets[0], structured);
    assert.match(candidatePrompt, /判断の境界/);
    assert.match(candidatePrompt, /使う事実はこの1つだけ/);
    assert.doesNotMatch(candidatePrompt, /今回の主軸はこの未消化の柱/);
    assert.doesNotMatch(candidatePrompt, /VELOX AIは3ページを読んで投稿を作る/);
  } finally {
    restore();
    delete require.cache[draftPath];
  }
});

test('domain problems drop invented numbers and UI badge terminology', () => {
  const knowledge = groundKnowledge({
    productName: 'VELOX AI',
    domainProblems: ['保存と短期の表示ゆれを分けて見る', '成功率が95%になる事例がある', 'ACCOUNT VOICE を毎投稿の主題にする'],
    terminology: ['投稿審査', 'ACCOUNT VOICE', 'PAGE FACTS ONLY']
  }, '保存と短期の表示ゆれを分けて見る');
  assert.deepEqual(knowledge.domainProblems, ['保存と短期の表示ゆれを分けて見る']);
  assert.deepEqual(knowledge.terminology, ['投稿審査']);
});

test('context radar drops UI badges and voice v2 cache refreshes without banned hooks', async () => {
  assert.deepEqual(filterRadarHints(['投稿審査', 'ACCOUNT VOICE', 'QUALITY & SHAPE', '2段階設計と投稿審査']), ['投稿審査']);
  let radarPrompt = '';
  let searchCalls = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt, search }) {
      searchCalls += 1;
      radarPrompt = prompt;
      if (search) throw new Error('This operation was aborted');
      return { modelName: 'fast', text: JSON.stringify([{ topic: '保存と表示ゆれの切り分け', pain: '短期の数字だけを見ると判断がぶれる', angleHint: '境界を先に置く' }]) };
    },
    async completeJson({ prompt }) {
      radarPrompt = prompt;
      return { parsed: { domainFocus: '運用判断', thinkingLens: '現場のトレードオフを話題ごとに見る', sampleHooks: ['月100時間を3.4倍にした', '確認場所を先に残す'] } };
    }
  });
  const radarPath = require.resolve('../src/context_radar');
  const voicePath = require.resolve('../src/account_voice_profiler');
  delete require.cache[radarPath];
  delete require.cache[voicePath];
  try {
    const { fetchSituationalContext } = require('../src/context_radar');
    const radar = await fetchSituationalContext({
      category: 'X運用',
      terminology: ['ACCOUNT VOICE', '保存'],
      cachedRadar: { queryKey: 'X運用|ja', expiresAt: new Date(Date.now() + 60000).toISOString(), signals: [{ topic: 'ACCOUNT VOICE' }] },
      now: new Date()
    });
    assert.equal(searchCalls, 1);
    assert.equal(radar, null);
    assert.doesNotMatch(radarPrompt, /ACCOUNT VOICE/);
    assert.match(radarPrompt, /Never repeat product names/);
    const { resolveAccountVoiceProfile } = require('../src/account_voice_profiler');
    const prompt = '運用判断を短く書く';
    const staleHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
    const voice = await resolveAccountVoiceProfile({
      user: {
        userPrompt: prompt,
        xUsername: 'hq',
        voiceProfile: { schemaVersion: 2, extractedAt: new Date().toISOString(), userPromptHash: staleHash, xUsername: 'hq', thinkingLens: 'OLD LOOP' }
      },
      accountState: { lang: 'ja', followers: 20 },
      recentPostedJobs: [{ text: '月100時間を3.4倍にした記録。' }, { text: '確認場所を先に残すと次の判断が続く。' }]
    });
    assert.equal(voice.schemaVersion, 3);
    assert.equal(voice.domainFocus, '運用判断');
    assert.equal(voice.sampleHooks.includes('月100時間を3.4倍にした'), false);
    assert.match(voice.sampleHooks.join('\n'), /確認場所を先に残す/);
  } finally {
    restore();
    delete require.cache[radarPath];
    delete require.cache[voicePath];
  }
});

test('legal footer stays out of hypotheses and empty move scores inherit the fallback', async () => {
  const page = {
    title: '作業記録',
    description: '不要になったときはボタン1つでいつでも停止・解約できます（規約条件の詳細は利用規約に記載）',
    headings: ['公開前の確認を残す'],
    snippet: '無料トライアル終了後は自動更新です'
  };
  const bare = extractPageHypotheses(page);
  assert.ok(bare.every(item => !/利用規約|ボタン1つ|停止・解約|自動更新/.test(`${item.who} ${item.why} ${item.proof}`)));
  const grounded = extractPageHypotheses({ title: 'メモ', description: '', headings: ['公開前の確認を残す'], snippet: '' }, {
    icpSummary: '法人の運用担当者',
    verifiedClaims: [{ audience: '法人の運用担当者', painScene: '短期の表示だけで次の投稿を決めてしまう', mechanism: '保存と表示を分けて確認する' }]
  });
  assert.equal(grounded.some(item => item.who === '対象はページに無い'), false);
  assert.match(grounded.map(item => item.who).join('\n'), /法人の運用担当者/);
  assert.doesNotMatch(grounded.map(item => `${item.why}`).join('\n'), /利用規約|ボタン1つ/);
  const reason = customerFacingReason({ hypothesis: { who: '対象はページに無い', why: '不要になったときはボタン1つでいつでも停止・解約できます', proof: '公開前の確認を残す' } }, 'ja');
  assert.doesNotMatch(reason, /ボタン1つ|利用規約|対象はページに無い/);
  const english = customerFacingReason({ hypothesis: { who: '対象はページに無い', why: 'cancel anytime in the terms of service', proof: '公開前の確認' } }, 'en');
  assert.doesNotMatch(english, /cancel anytime|対象はページに無い/);
  assert.match(english, /verified facts|did not state/);

  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeJson() {
      return { parsed: { domainTerms: ['確認'], moveScores: {}, preferredRegister: 'plain_ja' } };
    }
  });
  const lexiconPath = require.resolve('../src/editorial_lexicon_engine');
  delete require.cache[lexiconPath];
  try {
    const { evolveAccountLexiconAndLessons } = require('../src/editorial_lexicon_engine');
    const evolved = await evolveAccountLexiconAndLessons({
      maturePosts: [
        { tweetId: 'a', text: '確認場所を先に残すと次の判断が続く。', bookmarks: 3, impressions: 10 },
        { tweetId: 'b', text: '入口が変わると手順も選び直される。', bookmarks: 0, impressions: 10 }
      ]
    });
    assert.equal(Object.keys(evolved.domainLexicon.moveScores).length > 0, true);
  } finally {
    restore();
    delete require.cache[lexiconPath];
  }
});
