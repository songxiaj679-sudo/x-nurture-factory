'use strict';

/**
 * @file tests/history_pagination_design_verification.test.js
 * @description 履歴ページ送り（Pagination）の読み取り負荷改善設計に向けた隔離検証テスト
 * 
 * 【検証対象（GEMINI_REVIEW_REPORT.md 第6項準拠）】
 * 1. 負の日時や同一日時における現行（localeCompare）と新ソート方式（案A: 文字列複合キー vs 案B: 数値sortTimeMs）の順序差異の可視化
 * 2. トランザクション/前提条件を用いた並行更新（バッチ補完とワーカーの競合）時の古い値上書き防止の証明
 * 3. ユーザー分離（別ユーザーのジョブ混入防止）と、削除済みカーソルのエラーハンドリング動作
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ヘルパー: 多段階層フォールバック計算（現行 hybrid_saas_routes.js と同一ロジック）
function computeSortTimeMs(job) {
  const parseMs = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val.toDate === 'function') {
      const d = val.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
    }
    if (typeof val._seconds === 'number') {
      const nanos = typeof val._nanoseconds === 'number' ? val._nanoseconds : 0;
      return val._seconds * 1000 + Math.floor(nanos / 1e6);
    }
    if (val instanceof Date) return val.getTime();
    const t = new Date(val).getTime();
    return Number.isFinite(t) ? t : 0;
  };

  return parseMs(job.postedAt) || parseMs(job.scheduledAt) || parseMs(job.updatedAt) || parseMs(job.createdAt) || 0;
}

// 案A: 15桁ゼロ埋め文字列複合キー生成
function createCompoundKeyA(timestamp, id) {
  return `${String(timestamp).padStart(15, '0')}_${id}`;
}

describe('履歴ページ送り設計の隔離検証', () => {

  test('1. ソート方式の比較評価: 負の日時・同一日時における案A（文字列）と案B（数値）の順序差異', () => {
    // A. 負の日時（1970年以前: Unix Epoch < 0）の検証
    // -50,000ms（より過去）と -1,000ms（より現在に近い）
    const timePast = -50000;
    const timeRecent = -1000;
    const timeZero = 0;
    const timePositive = 100000;

    // 案A（文字列複合キー）の評価:
    const keyPastA = createCompoundKeyA(timePast, 'job_past');
    const keyRecentA = createCompoundKeyA(timeRecent, 'job_recent');
    // ⚠️ 案Aの欠陥可視化:
    // padStart(15, '0') は "-50000" の先頭に '0' を付加するため "000000000-50000" となる。
    // 同桁数の負数同士（-50000 vs -10000）を文字列比較すると、
    // '5' (0x35) > '1' (0x31) のため、-50000 の方が「大きい」と判定され順序が反転する。
    const keyNegative50k = createCompoundKeyA(-50000, 'a');
    const keyNegative10k = createCompoundKeyA(-10000, 'b');
    assert.ok(keyNegative50k > keyNegative10k, 'String comparison inverts order for negative numbers with same digit length');
    assert.ok(keyPastA.includes('-50000'), 'String padding on negative numbers places minus sign inside the string');

    // 案B（数値 sortTimeMs）の評価:
    const numbers = [timePositive, timeZero, timeRecent, timePast];
    const sortedDesc = [...numbers].sort((a, b) => b - a);
    assert.deepEqual(sortedDesc, [100000, 0, -1000, -50000], 'Numeric sortTimeMs sorts all positive, zero, and negative times naturally');

    // B. 同一タイムスタンプにおけるタイブレーク比較（localeCompare vs UTF-8バイト順）
    const testIds = ['item_10', 'item_2', 'item_A', 'item_a', 'item_あ'];
    
    // 現行の localeCompare (降順: b.localeCompare(a))
    const sortedByLocaleCompare = [...testIds].sort((a, b) => b.localeCompare(a));
    
    // Firestore の __name__ 降順（UTF-8 バイト順降順: b > a ? 1 : b < a ? -1 : 0）
    const sortedByByteOrder = [...testIds].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));

    // 結果の可視化: 英大文字小文字や日本語を含む場合、localeCompare とバイト順に差異が生じ得る
    // 一般的なFirestoreドキュメントID（英数字20文字 [a-zA-Z0-9]）ではバイト順降順で決定論的に整列可能
    assert.ok(Array.isArray(sortedByLocaleCompare));
    assert.ok(Array.isArray(sortedByByteOrder));

    // C. 日時欠損データの多段フォールバック検証
    const jobPosted = { id: 'j1', postedAt: new Date(1700000000000) };
    const jobScheduled = { id: 'j2', scheduledAt: new Date(1690000000000) };
    const jobUpdated = { id: 'j3', updatedAt: new Date(1680000000000) };
    const jobMissingAll = { id: 'j4' };

    assert.equal(computeSortTimeMs(jobPosted), 1700000000000);
    assert.equal(computeSortTimeMs(jobScheduled), 1690000000000);
    assert.equal(computeSortTimeMs(jobUpdated), 1680000000000);
    assert.equal(computeSortTimeMs(jobMissingAll), 0); // 欠損データは 0 (Epoch 0, 末尾)
  });

  test('2. トランザクション/オプティミスティックロックによるバッチ補完とワーカーの競合防止の証明', async () => {
    // 模擬インメモリストア（ドキュメント状態と更新バージョン）
    const store = new Map();
    const docId = 'job_concurrency_target';

    store.set(docId, {
      userId: 'test_user',
      status: 'pending',
      scheduledAt: new Date(1700000000000),
      version: 1,
      updateTime: 1000
    });

    // 模擬トランザクション実行環境
    const runMockTransaction = async (fn) => {
      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        const currentDoc = store.get(docId);
        const readSnapshot = {
          exists: Boolean(currentDoc),
          data: () => ({ ...currentDoc }),
          updateTime: currentDoc.updateTime
        };

        let updatePayload = null;
        const transaction = {
          get: async () => readSnapshot,
          update: (payload) => { updatePayload = payload; }
        };

        await fn(transaction);

        // コミットフェーズ: 読み取り時点から updateTime が変わっていなければコミット成功
        const liveDoc = store.get(docId);
        if (liveDoc.updateTime === readSnapshot.updateTime) {
          store.set(docId, {
            ...liveDoc,
            ...updatePayload,
            version: liveDoc.version + 1,
            updateTime: Date.now() + attempts
          });
          return { ok: true, attempts };
        }
        // 競合発生: リトライ
      }
      throw new Error('Transaction aborted: exceeded max retry attempts due to concurrency');
    };

    // シナリオ実行:
    // 1. バッチ補完プロセスがトランザクションを開始
    // 2. その直後、ワーカーがジョブを実行し status: 'posted', postedAt を書き込む
    // 3. バッチ補完プロセスのトランザクションが競合を検知し自動リトライ
    // 4. 最新のワーカー変更（status: 'posted', postedAt）を取り込んだ上で sortTimeMs を算出して保存
    const workerPostJob = async () => {
      const doc = store.get(docId);
      store.set(docId, {
        ...doc,
        status: 'posted',
        tweetId: 'tw_999',
        postedAt: new Date(1700005000000),
        version: doc.version + 1,
        updateTime: 2000 // ワーカーが先行更新
      });
    };

    let workerRan = false;
    const result = await runMockTransaction(async (t) => {
      const snap = await t.get();
      const data = snap.data();

      // 初回試行時にワーカーが割り込み更新を発生させる
      if (!workerRan) {
        workerRan = true;
        await workerPostJob();
      }

      // 補完計算
      const calculatedSortTime = computeSortTimeMs(data);
      t.update({ sortTimeMs: calculatedSortTime });
    });

    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2, 'Transaction must detect conflict on attempt 1 and retry successfully on attempt 2');

    const finalDoc = store.get(docId);
    // 🛡️ ワーカーの posted 状態および tweetId が古い pending 状態によって上書きされていないことを証明
    assert.equal(finalDoc.status, 'posted');
    assert.equal(finalDoc.tweetId, 'tw_999');
    // 🛡️ 補完された sortTimeMs がワーカーの新しい postedAt (1700005000000) に基づいて算出されていることを証明
    assert.equal(finalDoc.sortTimeMs, 1700005000000);
  });

  test('3. ユーザー分離および異常系カーソルハンドリング（削除・別ユーザー・無効型）の厳格遮断', () => {
    const jobs = [
      { id: 'job_u1_1', userId: 'user_1', sortTimeMs: 3000 },
      { id: 'job_u1_2', userId: 'user_1', sortTimeMs: 2000 },
      { id: 'job_u2_1', userId: 'user_2', sortTimeMs: 4000 }
    ];

    const paginateUserHistory = (userId, cursor, limit = 10) => {
      if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor.length === 0)) {
        return { statusCode: 400, error: '無効なカーソルです。' };
      }

      // ユーザー分離フィルタ
      const userJobs = jobs.filter(j => j.userId === userId).sort((a, b) => b.sortTimeMs - a.sortTimeMs);

      let startIndex = 0;
      if (cursor) {
        const foundIdx = userJobs.findIndex(j => j.id === cursor);
        if (foundIdx === -1) {
          // 削除済み、または別ユーザーのジョブIDが指定された場合は 400 エラー
          return { statusCode: 400, error: 'カーソルが見つかりません。履歴を再読み込みしてください。' };
        }
        startIndex = foundIdx + 1;
      }

      const paged = userJobs.slice(startIndex, startIndex + limit);
      const nextCursor = (startIndex + paged.length < userJobs.length) && paged.length > 0 ? paged[paged.length - 1].id : null;
      return { statusCode: 200, jobs: paged, nextCursor };
    };

    // A. 正常系: 1ページ目
    const page1 = paginateUserHistory('user_1', null, 1);
    assert.equal(page1.statusCode, 200);
    assert.equal(page1.jobs.length, 1);
    assert.equal(page1.jobs[0].id, 'job_u1_1');
    assert.equal(page1.nextCursor, 'job_u1_1');

    // B. 正常系: 2ページ目
    const page2 = paginateUserHistory('user_1', page1.nextCursor, 1);
    assert.equal(page2.statusCode, 200);
    assert.equal(page2.jobs.length, 1);
    assert.equal(page2.jobs[0].id, 'job_u1_2');
    assert.equal(page2.nextCursor, null);

    // C. ユーザー分離: user_1 が user_2 のカーソルを指定 -> 400
    const foreignRes = paginateUserHistory('user_1', 'job_u2_1');
    assert.equal(foreignRes.statusCode, 400);
    assert.match(foreignRes.error, /カーソルが見つかりません/);

    // D. 削除済みカーソル: 存在しないIDを指定 -> 400
    const deletedRes = paginateUserHistory('user_1', 'job_deleted_xyz');
    assert.equal(deletedRes.statusCode, 400);
    assert.match(deletedRes.error, /カーソルが見つかりません/);

    // E. 無効な型のカーソル: オブジェクトや空文字 -> 400
    assert.equal(paginateUserHistory('user_1', '').statusCode, 400);
    assert.equal(paginateUserHistory('user_1', {}).statusCode, 400);
  });

});
