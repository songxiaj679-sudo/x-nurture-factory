# GROK 実装仕様書：管理画面運用サマリーの表記重複修正 ＆ 実測数値（`sample`）反映

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
`@VeloxSystemsV4` の実ダッシュボード表示で確認された、運用サマリーカードの日本語二重表記 3件と「投稿済みメトリクスがあるのに『直近の表示回数はまだ測れていません』になる集計漏れ 1件」を修正する。

---

## 🔍 実画面＆実コードで確認された修正対象 4点

1. **「運用バランス」の見出し＋本文重複**（`src/growth_phase.js` L138-152）：
   - `views/dashboard_view.html` L4715 側に見出し `運用バランス` / `Control balance` があるのに、`guidanceBalance` 文字列側にも `運用バランス：` / `Control balance:` が入っているため、`運用バランス` が画面上に 2回連続表示されている。
2. **「〜の型の型」「〜の締めの締め」二重重複**（`src/growth_phase.js` L156-160）：
   - `MOVE_LABELS.ja`（L106-114）の値がすでに「〜型」「〜締め」で終わっているため、L159 の `次回は「${moveText}」の型、「${endingText}」の締めで検証します` が重複している。
3. **確定事項に対する仮定表現「空なら〜」**（`src/growth_phase.js` L169-170）：
   - `!String(user.brandContextNotes || '').trim()` が真（未入力）のときだけ出す助言なのに、「現場メモが空なら、…」という仮定表現になっている。
4. **`allSortedPostedJobs` に実測値があるのに `operatingSummary` が未測定になる漏れ**（`src/hybrid_saas_routes.js` L3123-3136）：
   - `GET /api/autopilot/jobs` は `allSortedPostedJobs` 内の各投稿に `impressions`・`bookmarks` を集計済み（L2985-3000）だが、`buildOperatingSummary` に `sample: { avgImpressions, maxImpressions, bookmarkRate }` を渡していない。また `uData.recentAvgImpressions` は Firestore に書き込まれないため、実測値があるアカウントでも `直近の表示回数はまだ測れていません` になってしまう。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **日英完全分離・既存テスト互換維持**：
   - `tests/velox_weights_and_coaching.test.js`（`立ち上げ観測期`・`Leading phase`・`仕組みを日常のイメージに落とす型`）、`tests/simple_autopilot_transparency.test.js`（日本語 `situation` / `insights` に生ピリオド `.` や内部英語コード名を含めない）、`tests/dashboard_language.test.js` をすべて通過させる。
2. **24時間凍結ルール維持**：
   - `matureCount`（ウェイト移行の判定件数）は引き続き `metrics24hSnapshot.isFrozen === true` のみで数え、未成熟投稿の数値で比較学習を歪めない。一方、表示用の `sample`（平均・最大表示回数・ブックマーク率）は `metrics24hSnapshot.isFrozen === true` があればそれを優先し、まだ無ければ `allSortedPostedJobs` 内の `Number.isFinite(job.impressions) && job.impressions >= 0` が付いた直近投稿（最大20件、0より大きいものがあればその群）から正しく集計して渡す。

---

## 実装仕様

### 1. `src/growth_phase.js`（L138-194 `buildAdvisoryCoaching`）
1. `guidanceBalance`（L138-152）：冒頭の `運用バランス：` および `Control balance: ` プレフィックスを削除し、フェーズと割合だけにする：
   - JA: `立ち上げ観測期（お客様の方針 ${balance.userWeight}% ／ VELOX基本設計 ${balance.veloxWeight}%）` / `学習検証期（...）` / `自立運用期（...）` / `方針固定の自立運用期（...）`
   - EN: `Observing phase (Your direction ${balance.userWeight}% / VELOX baseline ${balance.veloxWeight}%)` / `Calibration phase (...)` / `Leading phase (...)` / `Locked direction phase (...)`
2. `nextMovePreview`（L156-160）：
   - JA（`moveText && endingText` 両方あるとき）: `次回は「${moveText}」と「${endingText}」で検証します`
   - JA（片方のみのとき）: `次回は「${moveText || endingText}」で検証します`
   - EN: `The next post checks ${moveText || 'the prepared form'} and closes with ${endingText || 'the prepared ending'}`
3. `advisoryNote`（L169-170）：
   - JA: `現場メモが未入力のため、実務でよく見る場面を1〜2行足すと一般論が抜けて反応を測りやすくなります`
   - EN: `Your field note is empty, so adding one or two concrete lines makes the next post less generic and easier to measure`

### 2. `src/hybrid_saas_routes.js`（L3123-3136 `GET /api/autopilot/jobs`）
- `allSortedPostedJobs` から表示用 `sample` を計算し、`buildOperatingSummary` のオプションへ `sample` を渡す：
  - `frozenMeasured = allSortedPostedJobs.filter(j => j?.metrics24hSnapshot?.isFrozen === true && Number.isFinite(j.impressions) && j.impressions > 0)`
  - `anyMeasured = allSortedPostedJobs.filter(j => Number.isFinite(j?.impressions) && j.impressions > 0).slice(0, 20)`
  - 対象群 `measuredSampleRows = frozenMeasured.length ? frozenMeasured : anyMeasured`
  - `measuredSampleRows.length > 0` のとき：
    - `totalImp` = 各投稿の `metrics24hSnapshot?.impressions ?? impressions` 合計
    - `maxImp` = 最大値
    - `totalBookmarks` = 各投稿の `metrics24hSnapshot?.bookmarks ?? bookmarks ?? 0` 合計
    - `sample = { followers: accountDiagnosis?.followers ?? userForGoal.officialFollowerCount ?? null, avgImpressions: totalImp / measuredSampleRows.length, maxImpressions: maxImp, bookmarkRate: totalImp > 0 ? totalBookmarks / totalImp : null }`
  - `measuredSampleRows.length === 0` のときも `followers` だけ `sample` に渡す（未測定扱い維持）。

---

## 検証要件

1. `node --check src/growth_phase.js src/hybrid_saas_routes.js`
2. `tests/velox_weights_and_coaching.test.js` に「`guidanceBalance` に `運用バランス：` が重複しない」「`nextMovePreview` に `型の型` / `締めの締め` が出ない」「実測投稿を持つ履歴から `avgImpressions`・`maxImpressions`・`bookmarkRate` が `operatingSummary` へ反映される」アサーションを追加する。
3. 指定18スイート（＋`tests/growth_phase.test.js` ほか）一括実行し、全件パス確認。
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後、HTTP 200/302 確認。
