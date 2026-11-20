# GROK 実装仕様書：全顧客横断フライホイール × 動的ウェイト制御 × VELOX AI 先導アドバイス

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
一般公開で新規顧客が増え始める段階に向け、  
1. **顧客数が増えるほどプラットフォーム全体の共通クラフト学習が加速する仕組み**（匿名構造メトリクスの横断還流）、  
2. **アカウントごとの 24時間凍結サンプル数に応じて「お客様方針」と「VELOX AI 自律判断」の重みを段階シフトさせる仕組み**、  
3. **VELOX AI が裏側の学習結果をもとに画面上で方針を先導・提案し、顧客が 1クリックで反映できるアドバイス機能**  
を実装し、初期状態から成長後まで安全かつ自律的に進化するプロダクトへ仕上げる。

---

## 🔍 事前実態点検で確認された事実（推測なし）

1. **全顧客横断の学習がまだ片側しか繋がっていない**：
   - 現在 `src/editorial_lexicon_engine.js` の `SHARED_LEXICON.cognitiveMoves` / `endingMoves`（`winScore: 1, sampleCount: 0`）は定義されているが、他顧客の 24時間凍結データで `winScore` / `sampleCount` を更新する呼び出しが存在しない（`recordSharedRejectionSignal` の失敗時記録のみ）。
   - `src/collective_intelligence.js` L245 の `harvestAndEvolveCollectiveKnowledge()` も単一の固定管理者ID（`WEB-GOOGLE-D12E2479A76266AEA2B4`）のみ対象だった。
2. **ユーザー方針の重みが固定**：
   - `src/next_post_draft.js` L104-110 `customerInstruction` は、サンプルが 0件でも 50件でもつねに「お客様の指示を最優先する」固定で、サンプル蓄積に応じた主導権シフトがない。
3. **アドバイスが定型集計文止まり**：
   - `src/growth_phase.js` L104-148 `buildOperatingSummary` と `views/dashboard_view.html` L380-387 / L4667-4678 `#secOperatingSummary` は、現在地・目標・考察を表示するのみで、裏で育った `domainLexicon`・`dpoPreferencePairs`・`decideEditorialPlan` を使った「先導アドバイス＆1クリック方針反映」が未実装。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **プライバシー境界の厳守（顧客間の文章・URL・固有名詞混在ゼロ）**：
   - 横断共有（`collective_intelligence/editorial_lexicon_v1`）へ書き込むのは **匿名化された「思考型・結び型・言語別の勝敗集計数値」と失敗シグナルのみ**。他顧客の投稿本文・URL・商品名・ユーザーID生値・`domainTerms` は絶対に他顧客へ混ぜない。
2. **日英完全分離（JA / EN 混在ゼロ）**：
   - `views/dashboard_view.html` の `renderOperatingSummary`・`I18N.ja` / `I18N.en`、`src/growth_phase.js`、`src/hybrid_saas_routes.js` はすべて UI 言語（`uiLang` / `checkIsEn()`）で出し分け、`aiTargetLang` と混ぜない。
3. **既存テスト契約・UX の保全**：
   - `tests/simple_autopilot_transparency.test.js` L46-84：`buildOperatingSummary` で日本語 `situation` / `insights` に生ピリオド `.` や内部コード名（`mechanism_translation`・`verdict_cut` 等）を出さない。
   - `tests/dashboard_language.test.js` L144-155：追加する `data-i18n` キーは `I18N.ja` と `I18N.en` の両方に必ず登録する。
   - `AGENTS.md` Rule 2：`#advancedSettingsDetails` は初期閉じのまま、ヘッダーやバナーに重複ボタンを置かず、既存の「🧭 現在のアカウント状態 ＆ VELOX AI の運用方針」カード内に自然に追加する。

---

## Workstream 1: 全顧客横断・匿名構造フライホイール（`src/editorial_lexicon_engine.js`, `src/autonomous_promo_ai.js`）

1. **`src/editorial_lexicon_engine.js` に `recordSharedOutcomeSignals({ outcomes = [], userIdHash = '' } = {}, targetDb = null)` を追加**：
   - テストプロセスガード（`!targetDb && isTestProcess() && !process.env.FIRESTORE_EMULATOR_HOST`）時はスキップ。
   - 入力 `outcomes` の各要素は構造情報のみ保持：`{ signalKey, cognitiveMove, endingMove, lang, beatBaseline }`（本文テキスト・URL・顧客ハンドル・`userId` 生値は受け取らず保存もしない）。
   - `collective_intelligence/editorial_lexicon_v1` 上で `processedSignalKeys`（直近 300件の `signalKey` リングバッファ）を使い重複カウントを完全防止する。
   - 未計上の `outcomes` について：
     - `cognitiveMoves[move].sampleCount += 1`、移動平均 `winScore = clamp(winScore * 0.90 + (beatBaseline ? 1.5 : 0.4) * 0.10, 0.2, 3.0)`（小数第3位丸め）。
     - `endingMoves[ending].sampleCount += 1`、同じく `winScore` を更新。
     - `totalOutcomeSamples`（累計学習投稿数）および匿名 `accountHashes`（直近最大 500 ハッシュから重複なしカウント `totalOutcomeAccounts`）を更新する。
2. **共通辞書とアカウント辞書のブレンド重みづけ（`decideEditorialPlan` 内）**：
   - `decideEditorialPlan` が `computeGuidanceWeights` の結果を受け取り、`sharedScore`（全顧客実測 `winScore`）と `accountScore`（`domainLexicon.moveScores`）をブレンドする：
     - 例：`matureCount === 0`（新規顧客の1本目）では **共通辞書の勝率 (`sharedScore`) 100%** でスタートし、顧客自身のサンプルが増えるほど固有 `moveScores` の比重を高める。これにより「他顧客が増えるほど 1人目・新規顧客の初手精度が即座に上がる」状態を実装する。
3. **`src/autonomous_promo_ai.js` `_harvestTweetMetricsAndEvolveKnowledgeCore`（L2488 以降）での連動**：
   - 24時間凍結確定投稿（`matureHistoryList`）があるとき、当アカウント内のベースライン（24h `bookmarks * 3 + replies * 2 + likes` の中央値、1件以下のときは `bookmarks >= 1 || replies >= 1`）と比較して `beatBaseline` を判定。
   - `cognitiveMove: h.draftBriefSummary?.cognitiveMove || inferMove(h.textSnippet)`・`endingMove: h.draftBriefSummary?.endingMove || inferEnding(h.textSnippet)` の匿名構造だけを `recordSharedOutcomeSignals` へ送る（`historyList` 構築時に `draftBriefSummary` も `matchingJobData` から保持させること）。
   - 例外が出てもメトリクス同期全体を止めない `try/catch`。

---

## Workstream 2: サンプル数に応じた「ユーザー方針 vs VELOX AI」動的ウェイト（`src/editorial_lexicon_engine.js`, `src/next_post_draft.js`, `src/autonomous_promo_ai.js`）

1. **`src/editorial_lexicon_engine.js` に純粋関数 `computeGuidanceWeights({ matureCount = 0, strategyLocked = false } = {})` を追加・エクスポート**：
   - `count = Math.max(0, Math.floor(Number(matureCount) || 0))`
   - `count < 5` → `{ phase: 'observe', userWeight: 80, veloxWeight: 20 }`（立ち上げ・観測期）
   - `5 <= count < 15` → `{ phase: 'calibrate', userWeight: 60, veloxWeight: 40 }`（学習・検証期）
   - `count >= 15` → `strategyLocked ? { phase: 'lead_locked', userWeight: 50, veloxWeight: 50 } : { phase: 'lead', userWeight: 35, veloxWeight: 65 }`（自立・成熟期）
2. **`decideEditorialPlan` の拡張**：
   - `input.matureCount`・`input.strategyLocked` を受け取り、`weights = computeGuidanceWeights(...)` と `guidanceMode: weights.phase` を戻り値へ含める。
3. **`src/next_post_draft.js`（L104 `customerInstruction`・`briefPrompt`）**：
   - `customerInstruction(userPrompt, isEn, decision)` とし（`decision` 省略時は従来通り後方互換）、`decision?.weights?.veloxWeight >= 40` のときは「顧客の主題・対象読者・NG話題（憲法）は厳守しつつ、切り口・因果構造・結びの型は実測学習に基づく Editorial Decision と独自辞書を優先して組む」旨を JA / EN で明示する。
   - `draftBriefSummary`（`src/autonomous_promo_ai.js` L423, L2954）に `userWeight`・`veloxWeight`・`guidanceMode` も保存する。
4. **`src/autonomous_promo_ai.js`（`prepareNextPost`, `retargetNextPendingJob`）**：
   - `posts` 内の `p?.metrics24hSnapshot?.isFrozen === true` 件数を `matureCount` として計算し、`strategyLocked: user.strategyLockByUser === true` とともに `editorialContext` へ渡す。

---

## Workstream 3: VELOX AI「先導・アドバイスエンジン」＆ ダッシュボード 1クリック反映（`src/growth_phase.js`, `src/hybrid_saas_routes.js`, `views/dashboard_view.html`）

1. **`src/growth_phase.js` に純粋関数 `buildAdvisoryCoaching({ user = {}, matureCount = 0, weights = null, domainLexicon = null, dpoPairs = [], sharedLexicon = null, nextJob = null, uiLang = 'ja' } = {})` を追加・エクスポート**：
   - 必ず **`uiLang === 'en'`** で日英を切り替える（`aiTargetLang` ではなくUI言語）。
   - 内部コード（`mechanism_translation`, `inversion_contrast`, `constraint_boundary`, `practitioner_rule`, `micro_observation`, `verdict_cut`, `condition_edge`, `concrete_check`, `genuine_tension`）はすべて顧客向け自然文へ翻訳し、生英語キーは一切返さない。
   - 返却フィールド：
     - `guidanceBalance`：ウェイト比率のわかりやすい説明（例 JA: `運用バランス：立ち上げ観測期（お客様の方針 80% ／ VELOX基本設計 20%）`、EN: `Control balance: Observing phase (Your direction 80% / VELOX baseline 20%)` など各フェーズ分）。※日本語の文字列末尾などに不要な半角 `.` を入れないこと。
     - `nextMovePreview`：`nextJob?.draftBriefSummary?.cognitiveMove` 等があれば「次回は『〜』の型・『〜』の締めで検証します」、無ければ次ステップの準備状況。
     - `advisoryNote`：
       - `matureCount < 5`：全顧客の匿名学習件数（`sharedLexicon?.totalOutcomeSamples > 0` のとき言及可、未計測時は誇張しない）＋ **「もし `brandContextNotes`（現場メモ）が空なら1〜2行足すと一般論が抜けて反応を測りやすくなる」「`targetUrl` 未登録なら知見単独運用として磨く」** など具体的先導コメント。
       - `matureCount >= 5` かつ `dpoPairs[0]` または `domainLexicon` 有り：実測勝者で機能した切り口（`dpoPairs[0].winner.whyWon` や `domainLexicon.winningExpressions[0]`）と避けるべき表現（`retiredPhrases`）を挙げ、「次はこう舵を切ります」と先導する。
     - `suggestedPromptAddition`：行動可能な具体追記案（140文字以内、すでに `user.userPrompt` に含まれるなら `''` を返す）。
   - `buildOperatingSummary(user, extras)` の戻り値に `{ guidanceBalance, nextMovePreview, advisoryNote, suggestedPromptAddition, guidancePhase }` を追加する（既存 `{ situation, goal, approach, whyNextPostOnly, insights }` の表記とテスト契約は100%維持）。
2. **`src/hybrid_saas_routes.js`**：
   - `GET /api/autopilot/jobs`（L3034-3074）：`getUserMarketingKnowledge(userId)`・`getSharedEditorialLexicon()` を並列/安全取得し、`matureCount = postedJobs.filter(j => j.metrics24hSnapshot?.isFrozen === true).length` とともに `buildOperatingSummary` へ渡す。
   - **`POST /api/autopilot/apply-advice`** を新設：
     - `resolveSessionUser(db, req)` で認証（未ログインは `uiLang` に応じ 401）。
     - `adviceText`（1〜160文字・URL禁止）を検証し、`user.userPrompt` の末尾に自然な改行で追記（すでに含まれていれば重複追記しない、全体 500文字以内へ収める）。
     - `saas_users/{userId}` へ `{ userPrompt, strategyLockByUser: body.keepAutonomous ? false : true, updatedAt: new Date() }` を保存し、`{ ok: true, userPrompt, message }` を JA / EN（`req.body.uiLang` または `velox_lang` Cookie）で返す。
3. **`views/dashboard_view.html`**：
   - `renderOperatingSummary(summary)`（L4667-4678）：
     - `guidanceBalance`（進行バランス）、`nextMovePreview`（次の一手の先導）、`advisoryNote`（VELOX AI からの助言）を `isEn` で表示する（生コード・XSSは `escHtml` で防御）。
     - `summary.suggestedPromptAddition` が非空のときだけ、カード内に小さな提案枠と **1ボタン（「この助言を方針に反映する」／「Apply advice to direction」）** を出す（他バナーやヘッダーには重複ボタンを置かない）。
   - `applyVeloxAdvice(encodedText)` 関数を追加：`POST /api/autopilot/apply-advice` を呼び、成功時は `#setupUserPrompt`（存在すれば）とトースト/ステータス表示を更新し、`await loadJobs()` で再描画する。エラー時・完了時は必ず `checkIsEn()` で JA / EN を出し分ける。
   - HTML 上に新しい `data-i18n` を追加する場合は `I18N.ja`・`I18N.en` の両方に必ず追加する（`tests/dashboard_language.test.js` 準拠）。

---

## 検証要件（最終編集後にすべて実測）

1. `node --check`：変更したすべての `.js` ファイル＋テストファイル。
2. `vm.Script`：`views/dashboard_view.html`（インライン `<script>`）と `views/funnel_index.html`。
3. 新規テスト `tests/velox_weights_and_coaching.test.js`：
   - `computeGuidanceWeights` の段階切替（`0` / `5` / `15` / `strategyLocked`）
   - `decideEditorialPlan` が `matureCount: 0` のとき共通辞書 `sharedLexicon` の勝率をそのまま活かし、`matureCount: 15` では自アカウント学習側を重視すること
   - `recordSharedOutcomeSignals` が同一 `signalKey` を重複カウントせず、本文や顧客ハンドルを一切保存せず集計のみ更新すること
   - `buildAdvisoryCoaching` / `buildOperatingSummary` が JA/EN 分離・生コード非露出・`suggestedPromptAddition` 重複抑止を守ること
   - `POST /api/autopilot/apply-advice` が未認証 401・重複追記防止・正常追記を返すこと
4. `node --test --test-force-exit`：上記新規テスト + 既存関連スイート一括実行（`dashboard_language.test.js`, `simple_autopilot_transparency.test.js`, `growth_phase.test.js`, `editorial_lexicon_engine.test.js`, `editorial_intelligence.test.js`, `velox_polish_and_scaling.test.js`, `autonomous_evolution_core.test.js`, `meta_prompt_optimizer.test.js`, `episodic_memory_store.test.js`, `phase3_portfolio_verifier.test.js`, `phase2_autonomy_workspaces.test.js`, `autopilot_setup_save.test.js`, `bandit_optimization_engine.test.js`, `lp_voice_phase2.test.js`, `homepage_v51_copy.test.js`, `autopilot_jobs_separation.test.js`, `compliance_and_topnav_i18n.test.js`）。
5. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後、本番 `/dashboard`（302）・`/`（200）・`/?lang=en`（200）・`POST /api/autopilot/apply-advice`（未ログインで 401 日英確認）を `curl` で実測して報告する。

---

## 監査後の 1点修正（PID `2238405` 実コード点検で検出）

- **根拠**：`views/dashboard_view.html` L4608 `applyVeloxAdvice` が `document.getElementById('setupUserPrompt')` を参照しているが、ダッシュボードの実 DOM に `#setupUserPrompt` は存在しない（実在 ID は L3204・L4418 等の **`inpUserPrompt`** と L953 の **`wizUserPrompt`**）。このままでは反映直後に「設定を保存」を押した際、画面上の古い `#inpUserPrompt` の値でせっかく追記した助言を上書きしてしまう恐れがある。
- **修正**：
  1. `views/dashboard_view.html` L4608-4609 で `'inpUserPrompt'` と `'wizUserPrompt'` の両方を `data.userPrompt` で更新する。
  2. （任意改善）`src/hybrid_saas_routes.js` L3123 の `matureCount` を `allSortedPostedJobs` から数え、投稿履歴が 1ページ（50件）を超えても正しい成長フェーズを判定できるようにする。
  3. 修正後に `vm.Script`、全18スイート一括テスト、`pm2 restart` を再実測する。
