'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readBrief, closesAsLectureQuestion } = require('../src/next_post_draft');
const { runDeterministicAudit, hasInternalSentenceRepetition } = require('../src/draft_verifier');
const { formatHypothesis } = require('../src/bandit_optimization_engine');

function withStub(modulePath, exports) {
  const filename = require.resolve(modulePath);
  const prev = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (prev) require.cache[filename] = prev;
    else delete require.cache[filename];
  };
}

test('a lecture check rejects only a clear question at the end of the last tweet', () => {
  const decision = { endingMove: 'verdict_cut' };
  assert.equal(closesAsLectureQuestion(['差はわずか。'], decision), false);
  assert.equal(closesAsLectureQuestion(['どこが遅れる？', '再試行は間隔を空けて止める。'], decision), false);
  assert.equal(closesAsLectureQuestion(['再試行は間隔を空けて止める。', 'この判断はどこから見直せばよいでしょうか。'], decision), true);
  assert.equal(closesAsLectureQuestion(['再試行は間隔を空けて止める？'], decision), true);
});

test('repeated long sentences are rejected and ordinary sentences stay', () => {
  const repeated = '継続的な質の高い発信を一つ成立させます。公開後の実測を次の一本へ戻します。継続的な質の高い発信を一つ成立させます。';
  const plain = '確認場所を先に残すと、次の判断が同じ型で続く。入口が変わると手順もその場で選び直される。';
  assert.equal(hasInternalSentenceRepetition([repeated], 'ja'), true);
  assert.equal(hasInternalSentenceRepetition([plain], 'ja'), false);
  assert.equal(runDeterministicAudit({ tweets: [repeated] }, { lang: 'ja', accountState: { maxChars: 280, postShape: 'single', singleOnly: true } }).reasons.includes('duplicate_sentence_in_post'), true);
});

test('a brief keeps the assumption and the mechanism', () => {
  const brief = readBrief(JSON.stringify({
    offer: 'one checkpoint',
    everydayAssumption: '整理すれば十分だと思われている',
    underlyingMechanism: '確認場所が毎回変わると判断が積み上がらない'
  }), {}, false);
  assert.equal(brief.everydayAssumption, '整理すれば十分だと思われている');
  assert.equal(brief.underlyingMechanism, '確認場所が毎回変わると判断が積み上がらない');
  assert.equal(brief.offer, 'one checkpoint');
});

test('english thread stubs are rejected while a short Japanese thread still passes', () => {
  const threadState = { maxChars: 270, postShape: 'thread', singleOnly: false, subscription: 'free' };
  const broken = runDeterministicAudit({
    tweets: ['The rule is input the URL.', 'Feed one URL or account description into VELOX AI, let it create schedule and learn, then check results after 2-6 hours and 24-36 hours.']
  }, { lang: 'en', accountState: threadState, recentTexts: [], brandKnowledge: { verifiedPricing: [], verifiedClaims: [] } });
  assert.equal(broken.reasons.includes('too_short'), true);
  assert.equal(broken.reasons.includes('ai_slop'), true);
  const japanese = runDeterministicAudit({
    tweets: ['画面の前で手順が止まったとき、最初に見る場所を一つだけ残す。', 'その続きで、ページに書いてある確認だけを出す。']
  }, { lang: 'ja', accountState: threadState, recentTexts: ['別の日の別の話を残す。'], brandKnowledge: { verifiedPricing: [], verifiedClaims: [] } });
  assert.equal(japanese.reasons.includes('too_short'), false);
  const { editorialDirective } = require('../src/editorial_lexicon_engine');
  const directive = editorialDirective({
    cognitiveMove: 'mechanism_translation',
    endingMove: 'verdict_cut',
    registerLock: 'plain',
    registerInstruction: 'Write plainly.',
    autoRetiredFromRecent: ['9割の'],
    threadSecondMove: ''
  }, {
    domainLexicon: { winningExpressions: ['9割の', '保存して後で見返してください', 'keep one checkpoint'] },
    dpoPairs: [{ winner: { whyWon: '保存が残った対比' } }],
    mapElitesHint: { directive: '月100時間かかっていた作業が、たった15分になった' }
  }, true);
  assert.match(directive, /keep one checkpoint/);
  assert.doesNotMatch(directive, /9割の|保存して後で見返|月100時間|保存が残った/);
});

test('lecture templates are flagged and unused claims are preferred', () => {
  const accountState = { maxChars: 280, postShape: 'single', singleOnly: true };
  const lecture = '現場の確認は残っています。この現象の裏には、確認場所が毎回変わる構造があります。設計上のトレードオフがあります。';
  const translated = '確認場所を先に残します。これにより次の判断が可能です。一般論の前置きは足しません。';
  assert.equal(runDeterministicAudit({ tweets: [lecture] }, { lang: 'ja', accountState }).reasons.includes('ai_slop'), true);
  assert.equal(runDeterministicAudit({ tweets: [translated] }, { lang: 'ja', accountState }).reasons.includes('ai_slop'), true);
  const { selectFreshClaimIndex } = require('../src/next_post_draft');
  const claims = [
    { mechanism: '公式展示の公開手順を先に固定する', painScene: '展示文が毎回変わる', proofQuote: '公開前に文面を固定する' },
    { mechanism: '事実に基づく生成だけを残す', painScene: '未確認の数字を足さない', proofQuote: 'ページにある事実だけを使う' }
  ];
  const recent = ['公式展示の公開手順を先に固定する。展示文が毎回変わる。公開前に文面を固定する。'];
  assert.equal(selectFreshClaimIndex(claims, recent), 1);
});

test('slop detection blocks clickbait lines and leaves ordinary technical words', () => {
  const accountState = { maxChars: 280, postShape: 'single', singleOnly: true };
  const plain = '確認場所を先に残すと、次の判断が同じ型で続く。理論と構造は、その確認の中にだけ置く。一般論の前置きは足さない。';
  const bait = '確認場所を先に残すと、次の判断が同じ型で続く。ここで深掘りします。一般論の前置きは足さない。';
  const english = 'A useful checkpoint is to keep one concrete workflow note before you publish. Theory and structure stay inside that note.';
  const englishBait = 'A useful checkpoint is to keep one concrete workflow note before you publish. Let\'s break this down before the next step.';
  assert.equal(runDeterministicAudit({ tweets: [plain] }, { lang: 'ja', accountState }).reasons.includes('ai_slop'), false);
  assert.equal(runDeterministicAudit({ tweets: [bait] }, { lang: 'ja', accountState }).reasons.includes('ai_slop'), true);
  assert.equal(runDeterministicAudit({ tweets: [english] }, { lang: 'en', accountState }).reasons.includes('ai_slop'), false);
  assert.equal(runDeterministicAudit({ tweets: [englishBait] }, { lang: 'en', accountState }).reasons.includes('ai_slop'), true);
});

test('a missing page hypothesis stays usable in both languages', () => {
  const ja = formatHypothesis(null, 'ja');
  const en = formatHypothesis(null, 'en');
  assert.match(ja, /鋭い一点を書く/);
  assert.doesNotMatch(ja, /選べません/);
  assert.match(en, /one sharp, useful insight/);
  assert.doesNotMatch(en, /No who, why, or proof is available/);
});

test('voice profile stores domain focus and refreshes a version 1 cache', async () => {
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeJson() {
      return { parsed: { domainFocus: '分散処理の遅延設計', thinkingLens: 'ボトルネックとトレードオフを具体例へ落とす', register: 'plain' } };
    }
  });
  const profilerPath = require.resolve('../src/account_voice_profiler');
  delete require.cache[profilerPath];
  try {
    const { resolveAccountVoiceProfile } = require('../src/account_voice_profiler');
    const prompt = '分散処理の判断を短く書く';
    const staleHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
    const voice = await resolveAccountVoiceProfile({
      user: {
        userPrompt: prompt,
        xUsername: 'hq',
        voiceProfile: {
          schemaVersion: 1,
          extractedAt: new Date().toISOString(),
          userPromptHash: staleHash,
          xUsername: 'hq',
          domainFocus: 'OLD'
        }
      },
      accountState: { lang: 'ja', followers: 20 }
    });
    assert.equal(voice.schemaVersion, 3);
    assert.equal(voice.domainFocus, '分散処理の遅延設計');
    assert.equal(voice.thinkingLens, 'ボトルネックとトレードオフを具体例へ落とす');
  } finally {
    restore();
    delete require.cache[profilerPath];
  }
});

test('a shape mismatch asks the repair to compress each tweet', async () => {
  const long = `入口を先に固定すると次の判断が同じ型で続く。${'あ'.repeat(150)}`;
  const short = '確認場所を先に残すと、次の判断が同じ型で続く。読者が今日見る一点を先に固定すると、手順の揺れが減り、次の投稿も同じ入口から書けるようになる。';
  let repairPrompt = '';
  let call = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt }) {
      call += 1;
      if (call === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', underlyingMechanism: '確認場所が固定される', everydayAssumption: 'その場で足りる' }) };
      if (call === 2) return { modelName: 'candidates', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [long] }] }) };
      repairPrompt = prompt;
      return { modelName: 'repair', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [short] }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostText } = require('../src/next_post_draft');
    assert.ok(long.length > 140);
    assert.ok(short.length >= 70 && short.length <= 140);
    await draftNextPostText({
      lang: 'ja',
      userPrompt: '確認手順を一つ残す',
      skipCriticScore: true,
      accountState: { maxChars: 140, postShape: 'single', singleOnly: true }
    });
    assert.match(repairPrompt, /shape_mismatch/);
    assert.match(repairPrompt, /Compress every tweet to under 116 characters/);
  } finally {
    restore();
    delete require.cache[draftPath];
  }
});

test('a low critic score asks the repair to strengthen the mechanism', async () => {
  const validA = '確認場所を先に残すと、次の判断が同じ型で続く。読者が今日見る一点を先に固定すると、手順の揺れが減り、次の投稿も同じ入口から書けるようになる。';
  const validB = '最初に見る場所が毎回変わると、正しい手順もその場の気分で選び直される。入口を一つに固定すると、確認そのものが判断の型になり、次の作業がぶれにくくなる。';
  let repairPrompt = '';
  let call = 0;
  const restore = withStub('../src/grok_client', {
    hasXaiKey: () => true,
    async completeText({ prompt }) {
      call += 1;
      if (call === 1) return { modelName: 'brief', text: JSON.stringify({ offer: '確認', underlyingMechanism: '確認場所が固定されると判断が積み上がる', everydayAssumption: 'その場で考えれば足りる' }) };
      if (call === 2) {
        return { modelName: 'candidates', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }, { id: 'b', tweets: [validB] }] }) };
      }
      if (call === 3) return { modelName: 'critic', text: JSON.stringify({ scores: [{ id: 'a', score: 40, weakness: '表面的な一般論' }] }) };
      if (call === 4) {
        repairPrompt = prompt;
        return { modelName: 'repair', text: JSON.stringify({ candidates: [{ id: 'a', tweets: [validA] }] }) };
      }
      return { modelName: 'critic-repair', text: JSON.stringify({ scores: [{ id: 'a', score: 84, weakness: '' }] }) };
    }
  });
  const draftPath = require.resolve('../src/next_post_draft');
  delete require.cache[draftPath];
  try {
    const { draftNextPostText } = require('../src/next_post_draft');
    await draftNextPostText({
      lang: 'ja',
      userPrompt: '確認手順を一つ残す',
      accountState: { maxChars: 280, postShape: 'single', singleOnly: true }
    });
    assert.match(repairPrompt, /Strengthen the underlying mechanism/);
    assert.match(repairPrompt, /critic_below_72/);
  } finally {
    restore();
    delete require.cache[draftPath];
  }
});
