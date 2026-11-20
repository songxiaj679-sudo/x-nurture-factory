/**
 * @file tests/post_constraints_validation.test.js
 * @description 投稿文生成プロンプトおよび投稿テキストの制約検証テスト
 * 
 * 【検証対象】
 * 1. スロット別アングル排他マトリクス（ワンパターン禁止・テーマ差別化）
 * 2. 禁止ワードプール（月30時間、白紙の画面等の完全排除）
 * 3. 本文内URL直貼り禁止（プロフ固定遷移・2段目リプライ誘導）
 * 4. アカウント現在地・ステージ制約（Stage 1 背伸び検閲・インフルエンサー気取り排除）
 * 5. A/B実験バリアント介入差分（A群: 除外 / B群: 注入）
 * 6. 事後バリデーション＆サニタイザー（ガードレール）の文面破壊防止・URL第2ツイート自動移行
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  buildCouncilWritingPrompt
} = require('../src/autonomous_promo_ai');
const {
  commitDeliberationToSchedule
} = require('../src/ai_deliberation_council');
const {
  FORBIDDEN_WORDS_JA,
  validateAndEnforcePostConstraints,
  enforcePostThreadConstraints
} = require('../src/post_constraint_guard');

describe('Post Constraints & Prompt Directives Validation', () => {
  const mockCouncilPlan = {
    postPlan: [
      {
        step: 1,
        timeSlot: 'morning',
        angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示',
        format: 'single_empathy',
        rationale: { reason: '現場ルーティン改善', objective: '集中力確保' }
      },
      {
        step: 2,
        timeSlot: 'noon',
        angle: '常識の逆張り・引用RT議論惹起型ディベートトラップ',
        format: 'quote_debate_trap',
        rationale: { reason: 'アルゴリズム防衛', objective: 'インプ減衰回避' }
      },
      {
        step: 3,
        timeSlot: 'night',
        angle: 'プロフ固定記事誘導・ステルス型成約ノウハウ',
        format: 'profile_pinned_funnel',
        rationale: { reason: '成約心理', objective: '商談化' }
      }
    ]
  };

  const mockMarketAnalysis = {
    serviceName: 'Velox B2B Automation',
    targetAudience: 'B2B SaaS 創業者・マーケ責任者',
    coreAppealAngle: '自律進化型SNS運用エンジン'
  };

  // 1. スロット別アングル排他マトリクスと禁止ワードプール
  test('1. Prompt mandates slot-based exclusive angle matrix and forbidden words', async () => {
    const { prompt } = await buildCouncilWritingPrompt({
      marketAnalysis: mockMarketAnalysis,
      targetUrl: 'https://x.com/VeloxSystemsV4',
      councilPlan: mockCouncilPlan,
      userPrompt: 'テスト指示',
      experimentVariant: 'A'
    });

    assert.match(prompt, /このアカウントで今回使う仮説/);
    assert.match(prompt, /誰に・なぜ今・どの根拠か、この3つだけを書く/);
    assert.doesNotMatch(prompt, /スロット別アングル排他マトリクス|朝枠 \(morning\) ─/);

    assert.match(prompt, /【禁止ワードプール（全投稿で一切使用禁止）】/);
    for (const word of FORBIDDEN_WORDS_JA) {
      assert.ok(prompt.includes(word), `Prompt must include forbidden word "${word}" in restriction pool`);
    }
  });

  // 2. 本文内URL直貼り禁止指示の検証
  test('2. Prompt mandates zero direct URLs in main body', async () => {
    const { prompt } = await buildCouncilWritingPrompt({
      marketAnalysis: mockMarketAnalysis,
      targetUrl: 'https://x.com/VeloxSystemsV4',
      councilPlan: mockCouncilPlan,
      userPrompt: 'テスト指示',
      experimentVariant: 'A'
    });

    assert.match(prompt, /本文内に直接URLは貼らず、読後のプロフ固定遷移を促すこと/);
  });

  // 3. アカウント現在地・ステージ制約（背伸び検閲）のプロンプト注入
  test('3. Stage 1 account diagnosis injects anti-arrogance censorship directives', async () => {
    const mockDiagnosis = {
      username: 'founder_zero',
      followers: 120,
      stage: 'STAGE_1_TRUST_BUILDING',
      stageName: '信用構築・ゼロイチ初期フェーズ',
      strictDonts: ['上から目線の持論・オピニオンの禁止', '誇大な権威性の誇張の禁止', '本文URL直貼りの禁止'],
      strictDos: ['等身大の失敗談・一次検証データ', '保存誘発型のチェックリスト', 'リプライ2段目の安全配置']
    };

    const { prompt } = await buildCouncilWritingPrompt({
      marketAnalysis: mockMarketAnalysis,
      targetUrl: 'https://x.com/VeloxSystemsV4',
      councilPlan: mockCouncilPlan,
      accountDiagnosis: mockDiagnosis,
      experimentVariant: 'A'
    });

    assert.match(prompt, /【🚨 最重要監査：アカウント現在地・背伸び検閲（インフルエンサー気取りの完全排除）】/);
    assert.match(prompt, /フォロワー: 120名 \/ ステージ: 信用構築・ゼロイチ初期フェーズ/);
    assert.match(prompt, /『〜が真実だ』『まだ〜やってるの？』といった偉そうな上から目線/);
    assert.match(prompt, /上から目線の持論・オピニオンの禁止/);
    assert.match(prompt, /等身大の失敗談・一次検証データ/);
  });

  test('4. stored DPO pairs stay out of the next writing prompt', async () => {
    const mockUserKnowledge = {
      dpoPreferencePairs: [
        {
          winner: { text: '勝ち構文: 一次データと検証結果に基づく生々しい現場ログ', whyWon: '高ブクマ' },
          loser: { text: '負け構文: 抽象的な精神論とありきたりな格言', whyLost: '低エンゲージ' }
        }
      ]
    };

    const resB = await buildCouncilWritingPrompt({
      marketAnalysis: mockMarketAnalysis,
      targetUrl: 'https://x.com/VeloxSystemsV4',
      councilPlan: mockCouncilPlan,
      userKnowledge: mockUserKnowledge,
      experimentVariant: 'B'
    });
    assert.doesNotMatch(resB.prompt, /オンラインDPO対比学習/);
    assert.doesNotMatch(resB.prompt, /勝ち構文: 一次データ/);
    assert.match(resB.prompt, /誰に・なぜ今・どの根拠か/);
  });

  // 6. 文面破壊防止の検査（Copilot指摘バグの完全解消検証）
  test('6. avoids grammar destruction: correctly replaces 溶かしていた and 月130時間 without corruption', () => {
    // 指摘ケース1: "体験を溶かしていた。" が "消費してしまっていたいた。" にならないこと
    const text1 = '過去のSNS運用では、大切な体験を溶かしていた。無駄でした。';
    const res1 = validateAndEnforcePostConstraints(text1);
    assert.strictEqual(
      res1.sanitizedText,
      '過去のSNS運用では、大切な体験を消費してしまっていた。無駄でした。'
    );
    assert.ok(!res1.sanitizedText.includes('いたいた'));

    // 指摘ケース2: "月130時間かかった。" が "月1日々の手作業工程かかった。" にならないこと
    const text2 = '手動の投稿作業に月130時間かかった。仕組み化が必要。';
    const res2 = validateAndEnforcePostConstraints(text2);
    assert.strictEqual(
      res2.sanitizedText,
      '手動の投稿作業に多くの手作業工数かかった。仕組み化が必要。'
    );
    assert.ok(!res2.sanitizedText.includes('月1'));
  });

  // 7. 改行の維持およびURL単体投稿の安全フォールバック
  test('7. preserves line breaks and provides safe fallback for url-only posts', () => {
    // 改行が空白に潰されず維持されること
    const multilineText = '1行目の本文。\n\n2行目の知見。詳細: https://example.com/asset\n\n3行目の結論。';
    const resMultiline = validateAndEnforcePostConstraints(multilineText);
    assert.doesNotMatch(resMultiline.sanitizedText, /https?:\/\//);
    assert.ok(resMultiline.sanitizedText.includes('\n'), 'Line breaks must be preserved');
    assert.ok(resMultiline.sanitizedText.includes('1行目の本文。'));
    assert.ok(resMultiline.sanitizedText.includes('3行目の結論。'));

    // URLのみの場合、空文字にならずフォールバック文が入ること
    const urlOnly = 'https://example.com/single-link';
    const resUrlOnly = validateAndEnforcePostConstraints(urlOnly);
    assert.ok(resUrlOnly.sanitizedText.length > 10, 'URL-only post must receive safe fallback text');
    assert.doesNotMatch(resUrlOnly.sanitizedText, /https?:\/\//);
  });

  // 8. 本文URLの第2ツイート（2段目リプライ）への確実な自動移行
  test('8. enforcePostThreadConstraints safely migrates extracted URL from main tweet to 2nd reply slot', () => {
    // 2段目リプライがない場合 -> 自動新設されてURLが格納される
    const singleTweet = ['始業直後のルーティン改善。詳細はこちら https://x.com/velox/status/999 です。'];
    const guarded1 = enforcePostThreadConstraints(singleTweet, { lang: 'ja' });

    assert.strictEqual(guarded1.tweets.length, 2, 'Must create 2nd reply slot for extracted URL');
    assert.doesNotMatch(guarded1.tweets[0], /https?:\/\//, 'Main body must have zero direct URLs');
    assert.ok(guarded1.tweets[1].includes('https://x.com/velox/status/999'), '2nd reply must contain the extracted URL');

    // すでに2段目リプライがある場合 -> 2段目の末尾に追記される
    const existingThread = [
      '本文の重要知見。 https://x.com/velox/asset を参照。',
      '2段目リプライの既存補足テキスト。'
    ];
    const guarded2 = enforcePostThreadConstraints(existingThread, { lang: 'ja' });

    assert.strictEqual(guarded2.tweets.length, 2);
    assert.doesNotMatch(guarded2.tweets[0], /https?:\/\//);
    assert.ok(guarded2.tweets[1].includes('2段目リプライの既存補足テキスト。'));
    assert.ok(guarded2.tweets[1].includes('https://x.com/velox/asset'));
  });

  // 9. 英語文（English）の制約遵守とURL移行
  test('9. stops English posts that would require ambiguous rewriting', () => {
    const enDraft = [
      'Burning 45 minutes staring at a blank screen. Check https://velox.io/enterprise for details.'
    ];
    assert.throws(() => enforcePostThreadConstraints(enDraft, { lang: 'en' }), { code: 'post_constraint_ambiguous' });
  });

  // 11. 複雑なLLMドラフト（URL複数・改行・禁止語句混在）に対する網羅的サニタイズ検証
  test('11. stops complex LLM output instead of rewriting its meaning', () => {
    const rawLlmPost = [
      '【実務Tips】朝から白紙の画面を睨み、月130時間かかっていたSNS運用。\n\n現場の体験を溶かしていた運用を辞めて、型化しました。\n公式資料: https://velox.ai/whitepaper を参照。',
      '続きの補足ノウハウです。'
    ];

    assert.throws(() => enforcePostThreadConstraints(rawLlmPost, { lang: 'ja', timeSlot: 'morning' }), { code: 'post_constraint_ambiguous' });
  });

  // 12. 相対時間表現（「10分前」「10分 前」「5分後」「3分以内」「2時間半」等）の文脈保護テスト
  test('12. preserves relative time expressions (10分前, 10分 前, 5分後, 3分以内, 2時間半) without converting to clichés', () => {
    const relativeTimeCases = [
      { input: '予約は10分前です。遅れないようご準備ください。', expected: '予約は10分前です。遅れないようご準備ください。' },
      { input: '会議は10分 前です。遅れないようご準備ください。', expected: '会議は10分 前です。遅れないようご準備ください。' },
      { input: '2時間半で到着。', expected: '2時間半で到着。' },
      { input: '開始5分前にリマインド通知をお送りします。', expected: '開始5分前にリマインド通知をお送りします。' },
      { input: '本手順は3分以内で完了します。', expected: '本手順は3分以内で完了します。' },
      { input: '2時間後のミーティングに向けて資料を準備。', expected: '2時間後のミーティングに向けて資料を準備。' }
    ];

    for (const c of relativeTimeCases) {
      const res = validateAndEnforcePostConstraints(c.input, { lang: 'ja' });
      assert.strictEqual(res.sanitizedText, c.expected, `Relative time should not be corrupted: ${c.input}`);
      assert.ok(!res.sanitizedText.includes('無駄な作業時間'), `Should not contain cliché substitute in: ${res.sanitizedText}`);
      assert.ok(!res.sanitizedText.includes('多くの手作業工数'), `Should not contain cliché substitute in: ${res.sanitizedText}`);
    }
  });

  // 13. 複数禁止表現が同一テキスト内に混在する場合の全件網羅置換テスト（else ifスキップ解消）
  test('13. sequentially replaces all distinct forbidden expressions without skipping later matches', () => {
    const multiForbiddenText = '過去の運用で大切な体験を溶かしていた。もうこれ以上、時間を溶かしてはいけない。';
    const res = validateAndEnforcePostConstraints(multiForbiddenText, { lang: 'ja' });

    // 「体験を溶かしていた」と「溶かして」の両方が置換されていること
    assert.strictEqual(
      res.sanitizedText,
      '過去の運用で大切な体験を消費してしまっていた。もうこれ以上、時間を無駄にしてはいけない。'
    );
    assert.ok(!res.sanitizedText.includes('溶かして'));
    assert.ok(!res.sanitizedText.includes('いたいた'));
  });

  // 14. 日本語句読点（。）および括弧を含むURLの正確な分離・保護テスト
  test('14. cleanly extracts URLs with trailing Japanese punctuation and parenthesized URLs', () => {
    // 句読点（。）がURL末尾に含まれず、本文の句読点が破壊されないこと
    const textWithPunct = '詳細資料はこちら https://example.com/asset。ぜひご覧ください。';
    const resPunct = validateAndEnforcePostConstraints(textWithPunct, { lang: 'ja' });
    assert.strictEqual(resPunct.extractedUrls.length, 1);
    assert.strictEqual(resPunct.extractedUrls[0], 'https://example.com/asset');
    assert.ok(resPunct.sanitizedText.includes('詳細資料はこちら。ぜひご覧ください。'));

    // Wikipedia等の正常な括弧付きURLが途中で切断されないこと
    const textWithWiki = 'ナレッジ参照: https://ja.wikipedia.org/wiki/SaaS_(Software_as_a_Service) です。';
    const resWiki = validateAndEnforcePostConstraints(textWithWiki, { lang: 'ja' });
    assert.strictEqual(resWiki.extractedUrls.length, 1);
    assert.strictEqual(resWiki.extractedUrls[0], 'https://ja.wikipedia.org/wiki/SaaS_(Software_as_a_Service)');

    // 括弧囲み (https://example.com) の外側括弧のみが除去されること
    const textWrapped = 'リンクはこちら (https://example.com/guide) です。';
    const resWrapped = validateAndEnforcePostConstraints(textWrapped, { lang: 'ja' });
    assert.strictEqual(resWrapped.extractedUrls[0], 'https://example.com/guide');
  });

  // 15. 複数URL移行時に既存URLがある場合でも後続URLが欠落しないことの検証
  test('15. migrates multiple URLs without dropping later URLs when first URL is already present in reply', () => {
    const rawThread = [
      '本文です。リンクA: https://example.com/alpha と リンクB: https://example.com/beta',
      '既存のリプライ枠です。既に https://example.com/alpha は記載済み。'
    ];

    const result = enforcePostThreadConstraints(rawThread, { lang: 'ja' });

    // 本文から両方のURLが消えていること
    assert.doesNotMatch(result.tweets[0], /https?:\/\//);
    // リプライ枠に リンクA も リンクB も両方確実に存在すること（リンクBが無視・欠落しない）
    assert.ok(result.tweets[1].includes('https://example.com/alpha'), 'Must retain existing url A');
    assert.ok(result.tweets[1].includes('https://example.com/beta'), 'Must append missing url B');
  });

  // 16. 同一URLが本文中に重複して複数回出現する場合の完全除去検証
  test('16. cleanly removes ALL duplicate occurrences of the same URL from main body', () => {
    const duplicateUrlPost = [
      'リンクはこちら https://example.com/asset と再度 https://example.com/asset です。ご覧ください。'
    ];

    const result = enforcePostThreadConstraints(duplicateUrlPost, { lang: 'ja' });

    // 本文から同一URLの2回目も含めて全件除去されていること
    assert.doesNotMatch(result.tweets[0], /https?:\/\//, 'Main body must contain zero URLs even when repeated');
    assert.ok(!result.tweets[0].includes('https://example.com/asset'));
    // 2段目リプライには重複排除されて1件のみ格納されること
    assert.strictEqual(result.tweets.length, 2);
    assert.ok(result.tweets[1].includes('https://example.com/asset'));
    const urlOccurrences = (result.tweets[1].match(/https:\/\/example\.com\/asset/g) || []).length;
    assert.strictEqual(urlOccurrences, 1, 'Reply should deduplicate the URL to exactly 1 occurrence');
  });

  // 17. URL部分一致誤判定（/a vs /ab）・同一文複数URL残骸防止・日本語文飲み込み防止・数値途中一致破壊防止
  test('17. cleanly handles /a vs /ab in same body, avoids swallowing Japanese prose, and prevents 130時間 corruption', () => {
    // 17-A: 同一本文に /a と /ab がある場合、長いURLから順に除去されて本文に残骸 "b" が残らないこと
    const prefixThread = [
      'リンク1: https://example.com/a と リンク2: https://example.com/ab です。'
    ];
    const prefixResult = enforcePostThreadConstraints(prefixThread, { lang: 'ja' });
    assert.doesNotMatch(prefixResult.tweets[0], /https?:\/\//);
    assert.ok(!prefixResult.tweets[0].includes(' b '), 'Must not leave orphaned "b" in body text');
    assert.ok(prefixResult.tweets[0].includes('リンク1: と リンク2: です。'));
    assert.ok(prefixResult.tweets[1].includes('https://example.com/a'));
    assert.ok(prefixResult.tweets[1].includes('https://example.com/ab'));

    // 17-B: URL直後に日本語文が続く場合（https://example.com/guideをご覧ください。）、日本語文がURLに飲み込まれないこと
    const prosePost = [
      '詳細はこちら https://example.com/guideをご覧ください。ぜひチェックしてください。'
    ];
    assert.throws(() => enforcePostThreadConstraints(prosePost, { lang: 'ja' }), { code: 'post_constraint_ambiguous' });

    // 17-C: 数値の途中一致破壊の防止（「会議は130時間続いた。」が「1多くの手作業工数」に破壊されないこと）
    const durationText = '本日の会議は130時間続いた。タフな議論でした。';
    const durationResult = validateAndEnforcePostConstraints(durationText, { lang: 'ja' });
    assert.ok(!durationResult.sanitizedText.includes('1多くの手作業工数'), 'Must not match "30時間" inside "130時間"');
    assert.strictEqual(durationResult.sanitizedText, '本日の会議は130時間続いた。タフな議論でした。');
  });

  // 18. commitDeliberationToSchedule の手動指定尊重およびAIプラン自動ガード検証
  test('18. commitDeliberationToSchedule respects manual overrideTweets without AI alteration', async (t) => {
    t.mock.method(Date, 'now', () => 123456789);
    // インメモリMock Firestore
    const mockStorage = {
      ai_council_sessions: new Map(),
      autopilot_jobs: new Map()
    };

    const mockTargetDb = {
      collection: (colName) => ({
        doc: (docId) => {
          const ref = { colName, docId };
          ref.get = async () => {
            const data = mockStorage[colName]?.get(docId);
            return {
              exists: Boolean(data),
              data: () => data,
              ref,
              updateTime: 'mock-update-time'
            };
          };
          return ref;
        }
      }),
      batch: () => {
        const writes = [];
        return {
          create(ref, data) { writes.push(() => {
            if (mockStorage[ref.colName].has(ref.docId)) throw new Error('document already exists');
            mockStorage[ref.colName].set(ref.docId, data);
          }); },
          update(ref, data) { writes.push(() => Object.assign(mockStorage[ref.colName].get(ref.docId), data)); },
          async commit() { writes.forEach(write => write()); }
        };
      }
    };

    // セッションデータのシード
    const testDelibId = 'delib_test_override_123';
    mockStorage.ai_council_sessions.set(testDelibId, {
      userId: 'test_user_override',
      targetUrl: 'https://example.com/seed',
      lang: 'ja',
      recommendedSchedule: {
        scheduledAt: new Date('2026-11-15T15:00:00Z'),
        scheduleTimeZone: 'Asia/Tokyo',
        timeSlot: 'afternoon'
      },
      proposedPost: {
        planA: {
          tweets: [
            'AI生成プランAの本文。詳細: https://example.com/asset です。',
            '補足リプライ'
          ],
          format: 'two_tier_reply_link',
          angle: 'AI推奨アングル'
        }
      }
    });
    const humanDelibId = `${testDelibId}_human`;
    mockStorage.ai_council_sessions.set(humanDelibId, structuredClone(mockStorage.ai_council_sessions.get(testDelibId)));

    // Case 1: 人間が手動で overrideTweets を指定した場合 -> AIガードを適用せず原文を100%尊重
    const humanTweets = ['会議は10分 前です。人間が意図して書いた原文。'];
    const humanCommit = await commitDeliberationToSchedule({
      userId: 'test_user_override',
      deliberationId: humanDelibId,
      selectedPlan: 'planA',
      overrideTweets: humanTweets,
      targetDb: mockTargetDb
    });

    assert.strictEqual(humanCommit.ok, true);
    assert.deepStrictEqual(humanCommit.tweets, humanTweets, 'Human override tweets must be preserved exactly as-is');
    const savedJobData1 = mockStorage.autopilot_jobs.get(humanCommit.jobId);
    assert.strictEqual(savedJobData1.text, '会議は10分 前です。人間が意図して書いた原文。');
    assert.strictEqual(savedJobData1.isHumanOverride, true);

    // Case 2: overrideTweets がない場合（AI生成プランのコミット） -> enforcePostThreadConstraints が適用される
    const aiCommit = await commitDeliberationToSchedule({
      userId: 'test_user_override',
      deliberationId: testDelibId,
      selectedPlan: 'planA',
      overrideTweets: null,
      targetDb: mockTargetDb
    });

    assert.strictEqual(aiCommit.ok, true);
    assert.notStrictEqual(humanCommit.jobId, aiCommit.jobId);
    assert.strictEqual(mockStorage.autopilot_jobs.size, 2);
    // AIプラン本文のURLが除去されリプライへ移行されていること
    assert.doesNotMatch(aiCommit.tweets[0], /https?:\/\//, 'AI-generated plan must enforce zero URLs in body');
    assert.ok(aiCommit.tweets[1].includes('https://example.com/asset'), 'Extracted URL must be migrated to reply');
  });

  test('19. stops ambiguous URLs and metrics instead of changing their meaning', () => {
    for (const text of [
      '会議は30時間続いた。',
      '参照 https://ja.wikipedia.org/wiki/人工知能 を確認。',
      '詳細 https://example.com/guideをご覧ください。',
      'https://example.com/'
    ]) {
      assert.throws(() => enforcePostThreadConstraints([text]), { code: 'post_constraint_ambiguous' });
    }

    const original = '会議は2時間半で終了しました。';
    assert.deepStrictEqual(enforcePostThreadConstraints([original]).tweets, [original]);
  });
});
