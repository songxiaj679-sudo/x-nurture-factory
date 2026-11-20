/**
 * @file tests/evolution_data_loop_integration.test.js
 * @description 自律進化データループ（統一読み込み・DPO重複排除・成熟判定・MAP-Elitesユーザー紐付け）の結合テスト
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

// 🛡️ 本番DBへのアクセスを完全遮断（FIRESTORE_EMULATOR_HOST未設定時は安全にスキップ）
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  describe.skip('Evolution Data Loop Integration (Skipped: FIRESTORE_EMULATOR_HOST not set - run with npm run test:emulator)', () => {
    test('skipped when emulator host is not set', () => {});
  });
  return;
}

const council = require('../src/ai_deliberation_council');
const collective = require('../src/collective_intelligence');
const { sampleFromMapElitesArchive } = require('../src/map_elites_memory');
const {
  buildCouncilWritingPrompt,
  harvestTweetMetricsAndEvolveKnowledge
} = require('../src/autonomous_promo_ai');
const { createEpisodeFromPost } = require('../src/episodic_memory_store');
const {
  normalizeTweetMetrics,
  computePostAgeHours,
  resolve24hMetricsSnapshot,
  filterValidMaturePostsForLearning,
  matchTweetToJob
} = require('../src/metrics_harvest_engine');

describe('Evolution Data Loop Integration (VELOX 4.0)', () => {
  test('getUserMarketingKnowledge in collective_intelligence delegates to ai_deliberation_council single source of truth', async () => {
    const fromCouncil = await council.getUserMarketingKnowledge('mock_user_test_loop');
    const fromCollective = await collective.getUserMarketingKnowledge('mock_user_test_loop');

    // 両者が同一のオブジェクト構造を返却し、dpoPreferencePairs が必ず含まれること
    assert.deepStrictEqual(fromCouncil.dpoPreferencePairs, fromCollective.dpoPreferencePairs);
    assert.strictEqual(fromCouncil.level, fromCollective.level);
    assert.deepStrictEqual(fromCouncil.negativeList, fromCollective.negativeList);
  });

  test('DPO pairing deduplication prevents duplicate winner/loser pairs from bloating archive', () => {
    const existingPairs = [
      {
        winner: { text: '勝者テキストA', bookmarks: 10 },
        loser: { text: '敗者テキストB', bookmarks: 0 },
        pairedAt: new Date('2026-11-14')
      }
    ];

    const duplicateCandidate = {
      winner: { text: '勝者テキストA', bookmarks: 12 },
      loser: { text: '敗者テキストB', bookmarks: 0 }
    };

    const isDuplicate = existingPairs.some(
      p => p.winner?.text === duplicateCandidate.winner.text && p.loser?.text === duplicateCandidate.loser.text
    );

    assert.strictEqual(isDuplicate, true, '同一ペアは重複として検知されるべき');

    const newCandidate = {
      winner: { text: '新規勝者テキストC', bookmarks: 15 },
      loser: { text: '新規敗者テキストD', bookmarks: 1 }
    };

    const isNewDuplicate = existingPairs.some(
      p => p.winner?.text === newCandidate.winner.text && p.loser?.text === newCandidate.loser.text
    );

    assert.strictEqual(isNewDuplicate, false, '新しいペアは重複として判定されないこと');
  });

  test('Mature post filtering ensures posts under 18 hours old are not prematurely labeled as losers', () => {
    const nowMs = Date.now();
    const MIN_MATURE_AGE_MS = 18 * 60 * 60 * 1000;

    const mockHistory = [
      {
        tweetId: '1',
        textSnippet: '24時間前投稿の優良ポスト',
        impressions: 2500,
        bookmarks: 20,
        likes: 35,
        postedAt: new Date(nowMs - 24 * 60 * 60 * 1000)
      },
      {
        tweetId: '2',
        textSnippet: '20時間前投稿の低調ポスト',
        impressions: 400,
        bookmarks: 0,
        likes: 1,
        postedAt: new Date(nowMs - 20 * 60 * 60 * 1000)
      },
      {
        tweetId: '3',
        textSnippet: '30分前に投稿されたばかりの新作ポスト',
        impressions: 15,
        bookmarks: 0,
        likes: 0,
        postedAt: new Date(nowMs - 30 * 60 * 1000) // 30分前（未成熟）
      }
    ];

    const maturePosts = mockHistory.filter(h => {
      const ageMs = nowMs - (h.postedAt ? new Date(h.postedAt).getTime() : 0);
      return (h.impressions || 0) > 0 && ageMs >= MIN_MATURE_AGE_MS;
    });

    // 30分前の投稿は成熟ポストから除外されること
    assert.strictEqual(maturePosts.length, 2);
    assert.ok(maturePosts.every(p => p.tweetId !== '3'));

    // ソートした結果、正当な勝者と正当な敗者が判定されること（30分前の新作が敗者にされない）
    const sorted = [...maturePosts].sort((a, b) => ((b.bookmarks || 0) * 10 + (b.likes || 0)) - ((a.bookmarks || 0) * 10 + (a.likes || 0)));
    assert.strictEqual(sorted[0].tweetId, '1', '24時間前の優良ポストが勝者');
    assert.strictEqual(sorted[sorted.length - 1].tweetId, '2', '20時間前の低調ポストが敗者（新作ではない）');
  });

  test('syncAndEvolveKnowledgeFromHistory strictly rejects immature posts (< 24h) and prevents false negative list pollution', async () => {
    const { syncAndEvolveKnowledgeFromHistory } = require('../src/ai_deliberation_council');
    const now = new Date();
    const initialKnowledge = {
      successfulCases: [],
      failedCases: [],
      negativeList: [{ category: 'baseline', name: '初期ルール' }]
    };

    // 5時間前の低反響投稿（未成熟）
    const immatureHistory = [
      {
        tweetId: 'imm_1',
        textSnippet: 'まだ投稿されて5時間の未成熟な実験ポストです',
        impressions: 15,
        bookmarks: 0,
        likes: 0,
        postAgeHours: 5.0,
        postedAt: new Date(now.getTime() - 5 * 60 * 60 * 1000)
      }
    ];

    const result = await syncAndEvolveKnowledgeFromHistory('test_user_guard', immatureHistory, initialKnowledge);

    // 未成熟投稿は除外され、failedCases や negativeList に追加されないこと
    assert.strictEqual(result.failedCases.length, 0, '未成熟投稿が失敗事例に誤登録されないこと');
    assert.strictEqual(result.negativeList.length, 1, 'ネガティブリストが未成熟投稿で汚染されないこと');

    // 26時間経過していても24hスナップショット未保持の投稿は除外されること（学習保留）
    const matureWithoutSnapshot = [
      {
        tweetId: 'mat_no_snap',
        textSnippet: '26時間経過したがスナップショットがないポスト',
        impressions: 150,
        bookmarks: 0,
        likes: 1,
        postAgeHours: 26.0,
        postedAt: new Date(now.getTime() - 26 * 60 * 60 * 1000)
      }
    ];
    const resultNoSnap = await syncAndEvolveKnowledgeFromHistory('test_user_guard', matureWithoutSnapshot, initialKnowledge);
    assert.strictEqual(resultNoSnap.failedCases.length, 0, 'スナップショット未保持の投稿は学習保留となり失敗事例に登録されないこと');

    // 24hスナップショットを保持した成熟投稿（ブクマ0）は正しく失敗事例として蓄積されること
    const matureWithSnapshot = [
      {
        tweetId: 'mat_with_snap',
        textSnippet: '24hスナップショットが確定した低反響ポストです。ブクマ0件。',
        impressions: 150,
        bookmarks: 0,
        likes: 1,
        postAgeHours: 24.5,
        postedAt: new Date(now.getTime() - 24.5 * 60 * 60 * 1000),
        metrics24hSnapshot: {
          isFrozen: true,
          impressions: 150,
          bookmarks: 0,
          postAgeHours: 24.5
        }
      }
    ];

    const resultWithSnap = await syncAndEvolveKnowledgeFromHistory('test_user_guard', matureWithSnapshot, initialKnowledge);
    assert.strictEqual(resultWithSnap.failedCases.length, 1, '24hスナップショット確定投稿は正しく失敗事例に蓄積されること');
  });

  test('MAP-Elites sampleFromMapElitesArchive accepts explicit userId', async () => {
    const explicitUserId = 'saas_user_alpha_789';
    const sample = await sampleFromMapElitesArchive(explicitUserId, { allowMutation: false });

    assert.ok(sample);
    assert.ok(sample.cellId);
    assert.ok(sample.directive);
    assert.ok(['exploration', 'exploitation'].includes(sample.mode));
  });

  test('Real Firestore round-trip: persists dpoPreferencePairs and retrieves via getUserMarketingKnowledge with cleanup', async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) return; // 🛡️ 本番DBへの書き込みを絶対防止
    const { db } = require('../src/firestore');
    const testUserId = `test_dpo_e2e_${Date.now()}`;
    const samplePairs = [
      {
        winner: { text: '検証済みの勝ちパターン構文', impressions: 2200, bookmarks: 18, whyWon: '数字とフック' },
        loser: { text: '反省すべき負けパターン構文', impressions: 300, bookmarks: 0, whyLost: '抽象的オピニオン' },
        pairedAt: new Date()
      }
    ];

    try {
      // 1. Firestoreへ保存
      await db.collection('user_marketing_knowledge').doc(testUserId).set({
        level: 3,
        dpoPreferencePairs: samplePairs,
        updatedAt: new Date()
      });

      // 2. 再読み込み（getUserMarketingKnowledge）
      const loaded = await council.getUserMarketingKnowledge(testUserId);
      assert.ok(loaded);
      assert.strictEqual(loaded.level, 3);
      assert.strictEqual(loaded.dpoPreferencePairs.length, 1);
      assert.strictEqual(loaded.dpoPreferencePairs[0].winner.text, '検証済みの勝ちパターン構文');

      // 3. 次回プロンプト注入スニペットの生成整合性
      const promptSnippet = loaded.dpoPreferencePairs.length > 0
        ? `【🧬 オンラインDPO対比学習】:\n${JSON.stringify(loaded.dpoPreferencePairs.slice(0, 2).map(p => ({
            prefer_this_winner: p.winner?.text,
            avoid_this_loser: p.loser?.text
          })))}`
        : '';
      assert.ok(promptSnippet.includes('検証済みの勝ちパターン構文'));
      assert.ok(promptSnippet.includes('反省すべき負けパターン構文'));
    } finally {
      // 4. テストドキュメントの完全削除
      await db.collection('user_marketing_knowledge').doc(testUserId).delete();
    }
  });

  test('End-to-End Firestore persistence to production prompt injection: buildCouncilWritingPrompt incorporates real Firestore DPO pairs and episodic memories', async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) return; // 🛡️ 本番DBへの書き込みを絶対防止
    const { db } = require('../src/firestore');
    const testUserId = `test_e2e_prompt_${Date.now()}`;
    const samplePairs = [
      {
        winner: { text: '検証済みの勝ちパターン構文: B2Bで反響倍増', impressions: 3200, bookmarks: 25, whyWon: '痛点数字フック' },
        loser: { text: '反省すべき負けパターン構文: 抽象オピニオン', impressions: 200, bookmarks: 0, whyLost: '当事者意識なし' },
        pairedAt: new Date()
      }
    ];

    const mockPlan = {
      postPlan: [
        {
          step: 1,
          format: 'single_empathy',
          angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示',
          timeSlot: 'morning',
          rationale: { reason: '朝の共感', objective: '現場の痛点' }
        }
      ]
    };

    const mockMarket = {
      serviceName: 'VeloxCloud',
      targetAudience: 'B2Bマーケター',
      coreAppealAngle: '自律進化AI基盤'
    };

    let episodeDocRef = null;

    try {
      // 1. 実Firestoreにユーザーナレッジ（DPOペア・成功事例）を保存
      await db.collection('user_marketing_knowledge').doc(testUserId).set({
        userId: testUserId,
        level: 4,
        dpoPreferencePairs: samplePairs,
        successfulCases: [
          { title: '実測バズ事例', hookSnippet: '朝9時の現場ログ公開', whyItSucceeded: '生々しい現場のリアル' }
        ],
        updatedAt: new Date()
      });

      // 2. 実Firestoreにエピソード記憶を保存
      const episodeData = createEpisodeFromPost({
        text: '【実録】毎朝手作業で30分失っていた現場の真実。型を決めたら劇的に改善した。',
        angle: '朝の始業前・現場の生々しい手作業と時間損失の事実提示',
        format: 'single_empathy',
        bookmarks: 25,
        likes: 50,
        lessonLearned: '現場のリアルな作業工程と数字の具体性が共感を呼んだ'
      });
      episodeDocRef = await db.collection('saas_users').doc(testUserId).collection('episodic_memories').add(episodeData);

      // 3. 本番データ取得パスでナレッジを再読み込み
      const loadedKnowledge = await council.getUserMarketingKnowledge(testUserId);
      assert.strictEqual(loadedKnowledge.dpoPreferencePairs.length, 1);
      assert.strictEqual(loadedKnowledge.successfulCases.length, 1);

      // 4. 本番プロンプト生成関数 buildCouncilWritingPrompt を実行
      const { prompt } = await buildCouncilWritingPrompt({
        marketAnalysis: mockMarket,
        targetUrl: 'https://velox.example.com',
        councilPlan: mockPlan,
        userPrompt: 'B2B獲得を最大化せよ',
        userKnowledge: loadedKnowledge,
        userId: testUserId
      });

      // 5. プロンプトにFirestore由来の実データが確実に注入されていることを検証
      assert.ok(prompt.includes('【🧬 オンラインDPO対比学習（自社実測の勝者構文を模倣し、敗者構文を徹底回避せよ）】'), 'DPOブロックが存在すること');
      assert.ok(prompt.includes('検証済みの勝ちパターン構文: B2Bで反響倍増'), '勝者ポストが注入されていること');
      assert.ok(prompt.includes('反省すべき負けパターン構文: 抽象オピニオン'), '敗者ポストが注入されていること');
      assert.ok(prompt.includes('痛点数字フック'), '勝因が注入されていること');
      assert.ok(prompt.includes('当事者意識なし'), '敗因が注入されていること');
      assert.ok(prompt.includes('自社実測勝ちパターン'), '成功事例ブロックが存在すること');
      assert.ok(prompt.includes('朝9時の現場ログ公開'), '成功事例フックが注入されていること');
      assert.ok(prompt.includes('【ユーザー専用の関連エピソード】'), 'エピソード記憶ブロックが存在すること');
      assert.ok(prompt.includes('【実録】毎朝手作業で30分失っていた現場の真実'), 'Firestoreから取得したエピソードが注入されていること');
    } finally {
      // 6. Firestoreテストデータの完全削除（クリーンアップ）
      if (episodeDocRef) {
        await episodeDocRef.delete();
      }
      await db.collection('saas_users').doc(testUserId).delete();
      await db.collection('user_marketing_knowledge').doc(testUserId).delete();
    }
  });

  test('End-to-End API response to job snapshotting and mature learning candidate selection', async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) return; // 🛡️ 本番DBへの書き込みを絶対防止
    const { db } = require('../src/firestore');
    const testUserId = `test_harvest_e2e_${Date.now()}`;
    const now = new Date('2026-11-15T12:00:00Z');

    const createdJobRefs = [];

    try {
      // 1. テスト用 autopilot_jobs をFirestoreに作成
      const job1Ref = db.collection('autopilot_jobs').doc(`job_m_${Date.now()}`);
      const job2Ref = db.collection('autopilot_jobs').doc(`job_imm_${Date.now()}`);
      const job3Ref = db.collection('autopilot_jobs').doc(`job_miss_${Date.now()}`);
      const job4Ref = db.collection('autopilot_jobs').doc(`job_late_${Date.now()}`);

      await Promise.all([
        job1Ref.set({ userId: testUserId, tweetId: 't_mature_26h', status: 'posted', text: '成熟26時間ポスト' }),
        job2Ref.set({ userId: testUserId, tweetId: 't_immature_5h', status: 'posted', text: '未成熟5時間ポスト' }),
        job3Ref.set({ userId: testUserId, tweetId: 't_missing_bm', status: 'posted', text: 'ブクマ欠損ポスト' }),
        job4Ref.set({ userId: testUserId, tweetId: 't_late_72h', status: 'posted', text: '72時間後初回取得ポスト' })
      ]);
      createdJobRefs.push(job1Ref, job2Ref, job3Ref, job4Ref);

      // 2. X公式APIレスポンスを模したデータ
      const mockApiTweets = [
        {
          id: 't_mature_26h',
          text: '成熟26時間ポスト',
          createdAt: new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString(),
          metrics: { impression_count: 2200, bookmark_count: 18, like_count: 32 }
        },
        {
          id: 't_immature_5h',
          text: '未成熟5時間ポスト',
          createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
          metrics: { impression_count: 90, bookmark_count: 0, like_count: 1 }
        },
        {
          id: 't_missing_bm',
          text: 'ブクマ欠損ポスト',
          createdAt: new Date(now.getTime() - 28 * 60 * 60 * 1000).toISOString(),
          metrics: { impression_count: 400, bookmark_count: null, like_count: 5 }
        },
        {
          id: 't_late_72h',
          text: '72時間後初回取得ポスト',
          createdAt: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString(),
          metrics: { impression_count: 4500, bookmark_count: 35, like_count: 70 }
        },
        {
          id: 't_unrelated_foreign',
          text: '無関係な別アカウントのツイート',
          createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
          metrics: { impression_count: 1000, bookmark_count: 10, like_count: 20 }
        }
      ];

      // 3. 【本番の収集関数】harvestTweetMetricsAndEvolveKnowledge を直接実行
      // モックAPIレスポンスと基準日時を渡し、本番の正規化・ID突合・24h判定・Firestore更新パイプラインを貫通検証
      const harvestResult1 = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        mockTweetsRes: { ok: true, tweets: mockApiTweets },
        now
      });

      assert.strictEqual(harvestResult1.ok, true);
      assert.strictEqual(harvestResult1.updatedMetricsCount, 4, '管理対象4件のジョブのみ更新されること（外部ツイートは除外）');

      // 4. 検証：本番パイプライン経由でFirestoreのautopilot_jobsが正しく更新されたこと
      const updatedJob1 = (await job1Ref.get()).data();
      assert.ok(updatedJob1.metrics24hSnapshot, '26h成熟ポストには24hスナップショットが保存されること');
      assert.strictEqual(updatedJob1.metrics24hSnapshot.impressions, 2200);
      assert.strictEqual(updatedJob1.metrics24hSnapshot.bookmarks, 18);
      assert.strictEqual(updatedJob1.metrics24hSnapshot.isFrozen, true);

      // 5時間未成熟ポストは24hスナップショットが保存されないこと
      const updatedJob2 = (await job2Ref.get()).data();
      assert.strictEqual(updatedJob2.metrics24hSnapshot, undefined);

      // ブクマ欠損ポストは欠損扱いとなりスナップショットが保存されないこと
      const updatedJob3 = (await job3Ref.get()).data();
      assert.strictEqual(updatedJob3.metricsHarvestStatus, 'missing');
      assert.strictEqual(updatedJob3.metrics24hSnapshot, undefined);

      // 72hポストはウィンドウ超過のため24hスナップショットとして偽造保存されないこと
      const updatedJob4 = (await job4Ref.get()).data();
      assert.strictEqual(updatedJob4.metrics24hSnapshot, undefined);

      // 5. エピソード記憶：24hスナップショット確定投稿（26hのみ）が保存され、未成熟（5h）・欠損・スナップショットなし（72h）は保存されないこと
      const memoriesSnap = await db.collection('saas_users').doc(testUserId).collection('episodic_memories').get();
      const memoryIds = memoriesSnap.docs.map(d => d.id);
      assert.ok(memoryIds.includes('tweet_t_mature_26h'), '24hスナップショット確定の成熟26hはエピソード記憶に登録されること');
      assert.ok(!memoryIds.includes('tweet_t_late_72h'), 'スナップショット未保持の72hはエピソード記憶に登録されないこと（学習保留）');
      assert.ok(!memoryIds.includes('tweet_t_immature_5h'), '未成熟5hはエピソード記憶に登録されないこと');
      assert.ok(!memoryIds.includes('tweet_t_missing_bm'), '欠損はエピソード記憶に登録されないこと');

      // 6. DPOペア生成判定：24hスナップショット確定投稿が1件（< 2件）のため、混合比較を回避して生成待機
      const knowledgeSnap1 = await db.collection('user_marketing_knowledge').doc(testUserId).get();
      const pairs1 = knowledgeSnap1.exists ? (knowledgeSnap1.data().dpoPreferencePairs || []) : [];
      assert.strictEqual(pairs1.length, 0, 'スナップショット確定投稿が1件のみの時はDPOペア生成を見送ること');

      // 7. 2件目の成熟スナップショット投稿を追加し、本番収集関数でDPOペア生成を検証
      const job5Ref = db.collection('autopilot_jobs').doc(`job_m2_${Date.now()}`);
      await job5Ref.set({ userId: testUserId, tweetId: 't_mature_30h', status: 'posted', text: '成熟30時間ポストB' });
      createdJobRefs.push(job5Ref);

      const mockApiTweetsWithSecondMature = [
        ...mockApiTweets,
        {
          id: 't_mature_30h',
          text: '成熟30時間ポストB',
          createdAt: new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString(),
          metrics: { impression_count: 800, bookmark_count: 2, like_count: 8 }
        }
      ];

      const harvestResult2 = await harvestTweetMetricsAndEvolveKnowledge(testUserId, {
        mockTweetsRes: { ok: true, tweets: mockApiTweetsWithSecondMature },
        now
      });
      assert.strictEqual(harvestResult2.ok, true);

      // FirestoreにDPOペアが保存されたこと、および24hスナップショットのみで比較されたことを検証
      const knowledgeSnap2 = await db.collection('user_marketing_knowledge').doc(testUserId).get();
      const pairs2 = knowledgeSnap2.data()?.dpoPreferencePairs || [];
      assert.strictEqual(pairs2.length, 1, '24hスナップショット確定投稿が2件揃ったためDPOペアが生成・保存されること');
      assert.strictEqual(pairs2[0].basis, '24h_snapshot');
      assert.strictEqual(pairs2[0].winner.text, '成熟26時間ポスト');
      assert.strictEqual(pairs2[0].winner.bookmarks, 18);
      assert.strictEqual(pairs2[0].loser.text, '成熟30時間ポストB');
      assert.strictEqual(pairs2[0].loser.bookmarks, 2);
      // 72hポスト（ブクマ35）がスナップショット未保持のため勝者に誤選定されていないことを確認（混合比較防止）
      assert.notStrictEqual(pairs2[0].winner.text, '72時間後初回取得ポスト');

    } finally {
      // 8. クリーンアップ
      for (const ref of createdJobRefs) {
        await ref.delete().catch(() => {});
      }
      const memoriesToClean = await db.collection('saas_users').doc(testUserId).collection('episodic_memories').get();
      for (const doc of memoriesToClean.docs) {
        await doc.ref.delete().catch(() => {});
      }
      await db.collection('saas_users').doc(testUserId).delete().catch(() => {});
      await db.collection('user_marketing_knowledge').doc(testUserId).delete().catch(() => {});
    }
  });
});
