# GROK 実装仕様書：「この助言を方針に反映する」混乱の解消・`次はこう舵を切ります` 尻切れ修正・英語アカウント予約カードの日英混在修正

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
`@VeloxSystemsHQ` の実ダッシュボード表示からご指摘いただいた、
1. **「VELOX AI がすでに裏で自動学習を反映しているのに『この助言を方針に反映する』ボタンは何のため？」という設計矛盾**
2. **「次はこう舵を切ります」で尻切れになる `advisoryNote`（`src/growth_phase.js` L181）**
3. **英語投稿アカウント（`@VeloxSystemsHQ`）の日本語UI画面で `今回の切り口:` に英語文が露出し、`回復向けの投稿構成` が「誰に:」に誤抽出されている問題**
を解消する。

---

## 🔍 実コードで確認された問題点

1. **「この助言を方針に反映する」ボタン（`views/dashboard_view.html` L4746-4750 / `src/hybrid_saas_routes.js` L2237-2241）**:
   - ボタンを押すと `userPrompt` に「`実測で残った対比を次の1本の軸にする`」等の抽象文を追記し、同時に **`strategyLockByUser: true`（方針固定 50%/50% ロック）** へ切り替えてしまう。
   - しかし VELOX AI はすでに `draftNextPostWithMeta` / `decideEditorialPlan` 内で DPOペア・`domainLexicon`（勝ち表現/避ける表現）・`moveScores` を自動反映しているため、「ボタンを押さないと学習が反映されない」ような誤解と逆効果のロックを生んでいる。
2. **`advisoryNote` の尻切れと不自然な連結（`src/growth_phase.js` L178-182）**:
   - `実測で残った切り口は…です。避ける表現は…です。次はこう舵を切ります` で文が終わっており、尻切れになっている。また `winner.whyWon` や `retired` がカギカッコ無しで地の文に溶けて読みづらい。
3. **`@VeloxSystemsHQ` 予約カードの日英混在＆誤抽出（`views/dashboard_view.html` L4752-4786 / `src/bandit_optimization_engine.js` L267）**:
   - `draftBriefSummary.scene` / `readerPayoff` は投稿言語（英語）で保存されるため、日本語ダッシュボード上でも `今回の切り口: solo operators manually curating posts...` のまま出てしまう（`AGENTS.md` Rule 1 違反）。
   - `回復向けの投稿構成` が「〜向け」という部分文字列により `namesReader`（`/向け|.../`）へ誤ヒットし、「`誰に: 到達率が直近の水準から大きく下がった場合は、無理に攻めず回復向けの投稿構成へ自動調整します。`」と表示されている。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **API後方互換維持（`tests/velox_weights_and_coaching.test.js` 保護）**:
   - `src/growth_phase.js` の `buildAdvisoryCoaching` 戻り値フィールド `suggestedPromptAddition`（L124: EN `'Keep the next post on the measured contrast'`）および `POST /api/autopilot/apply-advice` エンドポイント（L171-215）はバックエンド互換テストのため残す。ただし **ダッシュボード UI 上に紛らわしい「この助言を方針に反映する」ボタンは表示しない**。
2. **日英完全分離（JA/EN テスト全通過）**:
   - UI ラベル・本文は `checkIsEn()` / `I18N.ja` / `I18N.en` で厳格に分離し、海外言語投稿アカウントの英語サマリーを日本語UIへ混ぜない。

---

## 実装仕様

### 1. `src/growth_phase.js`（L167-182 `buildAdvisoryCoaching`）— 「次はこう舵を切ります」尻切れ修正と自動反映の明記

- `matureCount >= 5`（L178-182）の `advisoryNote` を、尻切れのない自然な「**VELOX AIが次回自動で反映している内容**」の報告文へ改める：
  - EN:
    ```js
    const focus = String(winner.whyWon || winning || 'the measured contrast').slice(0, 90);
    const avoid = retired.length ? retired.map(item => `"${item}"`).join(', ') : 'repetitive phrasing';
    advisoryNote = `VELOX AI automatically leans into "${focus}" while avoiding ${avoid} in the next draft.`;
    ```
  - JA:
    ```js
    const focus = String(winner.whyWon || winning || '実測で反応が残った対比').slice(0, 70);
    const avoid = retired.length ? `「${retired.join('」「')}」` : '反応が伸びなかった言い回し';
    advisoryNote = `VELOX AIが自動学習として「${focus}」を次回に活かし、${avoid}は自動で避けて作成します。`;
    ```
- `matureCount < 5` かつ `!brandContextNotes` の文面（L172）も「設定欄へ入力すると効果が上がる」提案として現行どおり維持する。

---

### 2. `views/dashboard_view.html` — 誤解を招くボタン撤去・ラベル明確化・カード言語保護

1. **運用サマリーの「次の助言」ラベルと「この助言を方針に反映する」ボタン整理（L1310-1315, L1553-1558, L4744-4750）**:
   - `renderOperatingSummary`（L4744）:
     - 見出しラベル: `[uiEn ? 'Auto-applied learnings' : '実測の自動反映', summary.advisoryNote]`（`ops_advice_label` / `I18N.ja` / `I18N.en` も合わせて更新）。
     - **L4746-4750 の `<button ... onclick="applyVeloxAdvice(...)">この助言を方針に反映する</button>` を削除する**（VELOX AI は自動で学習を反映するため不要なボタン＋意図しない `strategyLockByUser` ロックを UI から無くす）。
     - 代わりに、`summary.guidancePhase === 'observing'` 等で **実務メモが未入力** の場合のみ、もし誘導を出すなら単に高度な設定の実務メモ欄（`#advancedSettingsDetails`）を開く補助リンクにするか、文面内の案内だけにする（ボタンを押すとAI方針が固定ロックされる操作は置かない）。

2. **`renderNextPostFacts` の日英分離 ＆ `回復向け` 誤抽出防止（L4752-4787）**:
   - `hasJa` 判定を追加する：
     ```js
     const hasJa = value => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(String(value || ''));
     ```
   - `briefLine`（`brief.scene / brief.readerPayoff`）が UI言語と不一致な場合（例: 日本語画面 `!isEn` で `!hasJa(briefLine)`、または英語画面 `isEn` で `hasJa(briefLine)`）は **UI に生表示しない**（`usableBriefLine = ''` とし、日本語画面に `solo operators manually curating...` が出ないようにする）。
   - `namesReader`（L4757）から `回復向け` / `...向けの(投稿|構成|設計|画面|機能|運用)` を除外する：
     ```js
     const namesReader = value => {
       const text = String(value || '');
       if (/回復向け|向けの(?:投稿|構成|設計|画面|機能|設定)/.test(text)) return false;
       return /向け|の方|担当者|経営者|開発者|solo|operator|team/i.test(text);
     };
     ```
   - `storedLooksBroken`（L4766）も `/誰に:\s*\S*(手順|設計|回復向け|投稿構成)/` に広げ、過去の誤抽出キャッシュもUIで隠す。

---

### 3. `src/bandit_optimization_engine.js`（L267-269 `extractPageHypotheses`）— `回復向けの投稿構成` 誤抽出防止

- `isBareProcessHeading` / `namesAReader` を `dashboard_view.html` と同じ基準で強化する：
  - `const namesAReader = line => !/回復向け|向けの(?:投稿|構成|設計|画面|機能|設定)/.test(line) && /向け|の方|担当者|経営者|開発者|solo|operator|team/i.test(line);`
  - これにより今後の新しいページ読解・仮説保存でも「回復向けの投稿構成…」が `who` に入らなくなる。

---

## テスト・検証要件

1. **テスト更新・追加**:
   - `tests/velox_weights_and_coaching.test.js`:
     - `matureCount >= 5` の `advisoryNote` に尻切れ「次はこう舵を切ります」が含まれず、自動反映である旨（JA/EN）になることを検証する（`suggestedPromptAddition` の既存バックエンド単体検証・`apply-advice` API テストは維持）。
   - `tests/dashboard_language.test.js`（または `tests/launch_progress_and_uilang.test.js`）:
     - `views/dashboard_view.html` の `renderOperatingSummary` が `applyVeloxAdvice` ボタンを描画しないこと。
     - `renderNextPostFacts` が日本語UIで英語 `draftBriefSummary` を露出せず、`回復向けの投稿構成` を `誰に:` として出さないこと。
   - `tests/bandit_optimization_engine.test.js`:
     - `回復向けの投稿構成へ自動調整します` を含むページから `extractPageHypotheses` がそれを `who` に選ばないこと。
2. **必須検証コマンド（最終編集後すべて実行）**:
   - 編集した全 `.js` ファイルへの `node --check`
   - `views/dashboard_view.html` および `views/funnel_index.html` のインライン `<script>` に対する `vm.Script` 構文チェック
   - 全関連テスト＋更新テストの `node --test --test-force-exit` 全件成功（fail 0 / skip 0）
   - `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後、2秒待機して `GET /` (200)・`GET /?lang=en` (200)・`GET /dashboard` (302) 確認
