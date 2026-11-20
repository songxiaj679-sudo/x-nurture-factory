# GROK 実装仕様書：84%長時間停止（199〜222秒待ち）の解消・段階進捗化・生成中モーダルの日英UI混在修正

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
本番ログ（`x-shop` PID `2246435`）および Firestore `autopilot_jobs` の `qualityAudit` 実測値で確認された、**「84%で止まって見える（実際は199〜222秒かかっている）」問題** と **日本語UI上で英語の進行タイトル/ログ＋日本語の根拠文が混在する問題** を根本修正する。

---

## 🔍 本番ログ ＆ 実コードで確認された事実（推測なし）

### 1. 本番2件の実測タイミング（どちらも完全停止ではなく約3分半後に完了していた）
Firestore `autopilot_jobs` に記録された `qualityAudit` 実測値:
1. `@VeloxSystemsHQ`（`USR-MVUA1GLP-D640` / `job_next_d53011e5-fb35-4c6f-9681-d8e9ae64129a`）— **計 222.3秒（3分42秒）**:
   - `brief`（`grok-4.7`）: **24,178 ms（24.2秒）**
   - `candidates`（`grok-4.7`）: **120,002 ms（120秒でタイムアウト `This operation was aborted`）** → `grok-4.20-0309-non-reasoning` へリトライして計 **124,558 ms（+4.56秒）**
   - `repair`（`grok-4.7`）: **73,561 ms（73.6秒）**
2. `@VeloxSystemsV4`（`WEB-GOOGLE-D12E2479A76266AEA2B4` / `job_next_f7e49eb1-1d76-406e-9615-1fa3c1a114c6`）— **計 199.0秒（3分19秒）**:
   - `brief`（`grok-4.7`）: **18,399 ms（18.4秒）**
   - `candidates`（`grok-4.7`）: **71,925 ms（71.9秒）**
   - `critic`（`grok-4.3`）: **3,064 ms（3.1秒）**
   - `repair`（`grok-4.7`）: **105,554 ms（105.6秒）**

### 2. なぜ「84%で止まる」のか（原因3点）
1. **84%（`draft`）〜 100%（`completed`）の中間進捗がゼロ**:
   - `src/autonomous_promo_ai.js` L2858 の `prepareNextPost` が `brief`・`candidates`・`critic`・`repair`・Firestore保存のすべてが始まる前に **`report('draft', ...)` を1回だけ** 送り、完了まで一度も `onProgress` を送らない。
   - `views/dashboard_view.html` L2960 の `launchStepPercent` が `{ init: 8, account: 28, page: 48, slot: 66, draft: 84, completed: 100 }` のため、開始1〜5秒で `84%` に達したあと **3分以上バーもログも一切動かない**。
2. **直列4段LLMのうち3段が `grok-4.7`（`tier: 'quality'`）かつ各段 `timeoutMs: 120000`（2分待ち）**:
   - `src/next_post_draft.js` L447（`brief`）は短いJSON企画書を作るだけなのに `grok-4.7` で **18〜24秒** かかっている。
   - `L462`（`candidates`）は `grok-4.7` が詰まった際に **120秒丸ごと待機** してから `fast`（4.5秒）へ落ちている（しかも L43 のリトライも `options.timeoutMs` を再利用）。
   - `L524`（`repair`）も `grok-4.7`（`120秒`上限）を使うため **73〜106秒** を追加消費している。さらに `briefPrompt` が質問型フック禁止の制約（`decision.endingMove !== 'genuine_tension'` のとき）を明示しておらず、実際に `@VeloxSystemsHQ` では `hookAngle` に `"direct reflective_question hook..."` が出力された。
3. **日本語UI × 英語投稿設定アカウントで生成中モーダルが日英混在になる（`AGENTS.md` Rule 1 違反）**:
   - スクリーンショット2（`@VeloxSystemsHQ`）にて、外枠が日本語（`次の1投稿`・`準備しています`・`閉じる（バックグラウンド継続）`）なのに、見出しとログが英語（`WRITING THE NEXT POST`・`Reading this account`・`Reading the registered page`・`Choosing the next time`・`Writing the next post`）、さらにその中の根拠が日本語（`Who: 到達率が直近の水準から大きく下がった場合は…`）になっている。
   - 原因:
     - `views/dashboard_view.html` L3292 の `launchAutopilot()` が `lang`（投稿言語 `#inpPostLang`）だけ送り、`uiLang`（`isEn ? 'en' : 'ja'`）を送っていない。
     - `src/hybrid_saas_routes.js` L1922, L1962, L1972 が投稿言語 `cleanLang` で進捗タイトル/ログを作り、`prepareNextPost(userId, { lang: cleanLang, onProgress })` へ渡している。
     - `src/autonomous_promo_ai.js` L2733, L2857 が `options.lang` と `accountState.lang` から `isEnProgress` と `customerReason` を決めてしまっている。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **日英完全分離（UI言語と投稿生成言語の厳格分離）**:
   - ダッシュボードのモーダル表示（`stepTitle`・`stepDetail`・`customerReason`・処理ログ）は必ず **UI言語 `uiLang`**（`req.body.uiLang` または `velox_lang` Cookie）に従う。**X投稿の生成言語（`aiTargetLang` / `cleanLang`）と混同しないこと**。
   - `uiLang === 'en'` のとき `customerFacingReason` が日本語ページ由来の文字列を含んでいても、生日本語を `Who: 到達率が...` のように混ぜないこと。
2. **既存テスト契約・品質ゲート維持**:
   - `draftNextPostWithMeta` の呼び出し順序（1: `brief` → 2: `candidates` → 条件付き 3: `critic` → 条件付き 4: `repair`）および `runDeterministicAudit` / `closesAsLectureQuestion` の検証は一切緩めない。
   - `candidates` のデフォルト `tier`（`prepareNextPost` 経由では `'quality'`）および `/api/funnel/free-experience` の高速設定（`18s`/`20s`）は維持する。

---

## 実装仕様

### 1. `src/next_post_draft.js` — 段階タイムアウト適正化・`onStage`進捗通知・無駄な`repair`抑止

1. **`generateDraft(prompt, options = {})`（L20-52）**:
   - デフォルト `timeoutMs` を `120000` → **`45000`** に変更する（明示的に `options.timeoutMs` が渡された場合はそれを尊重する）。
   - リトライ時（L44）は `options.retryTimeoutMs` があればそちらを使い、無ければ `Math.min(options.timeoutMs || 45000, 22000)` を使うよう `run(tier, ms)` へ拡張する。これにより `grok-4.7` タイムアウト後の `fast` リトライに再び長いタイムアウトが掛かるのを防ぐ。

2. **`briefPrompt(...)`（L179-227）**:
   - `decision && decision.endingMove !== 'genuine_tension'` のとき、`hookAngle` / `thisPost` の指示に次を1文追加する（`isEn` / JA 両方）：
     - EN: `Do not choose a question hook or reflective question ending unless the plan explicitly asks for genuine_tension.`
     - JA: `hookAngle や結びの型に疑問形・問いかけは選ばないこと。`

3. **`draftNextPostWithMeta(...)`（L381-565）**:
   - 引数に `onStage = null` を追加し、デフォルト `timeoutMs = 45000` に変更する。
   - 進捗通知ヘルパを定義する：
     ```js
     const emitStage = (stage) => {
       if (typeof onStage !== 'function') return;
       try { onStage(stage); } catch (_err) {}
     };
     ```
   - 各ステージの呼出し前に `emitStage(...)` を呼び、モデル・タイムアウトを適正化する：
     1. **Brief（L446付近）**: `emitStage('draft_brief')` → `tier: 'fast'`、`timeoutMs: Math.min(timeoutMs, 18000)`、`retryTimeoutMs: Math.min(timeoutMs, 10000)`（既に `catch` で `fallbackBrief(page, isEn)` へ落ちるため安全）。
     2. **Candidates（L460付近）**: `emitStage('draft_candidates')` → `tier`（デフォルト `'quality'` = `grok-4.7`）、`timeoutMs: Math.min(timeoutMs, 45000)`、`retryTimeoutMs: Math.min(timeoutMs, 20000)`（失敗時 `grokShouldRetry` により即 `fast` へフォールバック）。
     3. **Critic（L477付近）**: `!skipCriticScore && accepted.length >= 2 && hasXaiKey()` に入ったときだけ `emitStage('draft_critic')` → `tier: tier === 'fast' ? 'fast' : 'nurture'`、`timeoutMs: Math.min(timeoutMs, 15000)`、`retryTimeoutMs: Math.min(timeoutMs, 10000)`。
     4. **Repair（L503付近）**: `!chosen` に入ったときだけ `emitStage('draft_repair')` → 既に具体的な `repairHint`（違反理由一覧）と `systemRules` を渡しているため、`tier: tier === 'fast' ? 'fast' : 'nurture'`（`grok-4.3`・約3〜6秒）、`timeoutMs: Math.min(timeoutMs, 25000)`、`retryTimeoutMs: Math.min(timeoutMs, 15000)` を使用する（なお `repair` 後も既存の `passesDraft` = `runDeterministicAudit` ＋ `closesAsLectureQuestion` を必ず通す）。

---

### 2. `src/autonomous_promo_ai.js` — `uiLang` 分離と `84%`→`100%` の段階進捗化

1. **`customerFacingReason(choice, lang)`（L2703-2730）**:
   - `const hasJa = value => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(String(value || ''));` を用意する。
   - `isEn` が `true` のとき、`who` / `why` / `proof` に日本語文字が含まれる項目はそのまま `Who: <日本語>` として連結せず除外する（すべて除外された場合は `'Written from verified facts on the registered page and this account state.'` を返す）。これにより英語UIで日本語仮説が生のまま混在しない。

2. **`prepareNextPost(userId, options = {})`（L2732-3038）**:
   - **UI言語の分離**:
     ```js
     const uiLang = String(options.uiLang || options.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
     const isEnProgress = uiLang === 'en';
     ```
   - `customerReason`（L2857）は `customerFacingReason(choice, uiLang)` を使い、画面・ログのUI言語に合わせる（アカウントの投稿言語 `accountState.lang` ではない）。
   - L2858 の単発 `report('draft', ...)` を段階的な報告へ置き換える：
     - メモリ読込＋`brief` 直前（または `onStage` の `'draft_brief'`）:
       `report('draft_brief', isEnProgress ? 'Planning angle and structure' : '切り口と構成方針を整理しています', customerReason)`
       （※ `draftNextPostWithMeta` より前の Firestore 読込開始時に `draft_brief` を出し、LLMの各フェーズは `onStage` で `draft_candidates` / `draft_critic` / `draft_repair` を発火すると待ち時間の体感が途切れない）
     - `onStage` コールバック定義:
       - `'draft_candidates'`: `report('draft_candidates', isEnProgress ? 'Writing post candidates' : '次の1投稿を複数案で作成しています', '')`
       - `'draft_critic'`: `report('draft_critic', isEnProgress ? 'Checking facts, style, and flow' : '事実整合性・文体・流れを確認しています', '')`
       - `'draft_repair'`: `report('draft_repair', isEnProgress ? 'Refining phrasing to pass checks' : '基準に合わせて表現を整えています', '')`
       （※ `draft_brief` は直前で既に報告済みなら `onStage('draft_brief')` で重複発火しない）
     - `draftNextPostWithMeta` 完了後、`autopilot_jobs` 保存直前（L2945付近）:
       `report('saving', isEnProgress ? 'Reserving the next scheduled slot' : '予約枠へ保存しています', `${zone} / ${timeSlot}`)`

---

### 3. `src/hybrid_saas_routes.js` — `resolveUiLang` 共通化と `/api/autopilot/launch` の `uiLang` 対応

1. **`resolveUiLang(req, fallback = 'ja')` ヘルパを追加**（`registerHybridSaasRoutes` 内の `apply-advice` 等と同じロジック、L2197-2205 / L2246-2254 の重複実装もこれを使うよう整理してよい）。
   - 優先順位: `req.body?.uiLang` → `req.query?.uiLang` → Cookie `velox_lang` → `fallback`。`'en'` または `'ja'` を返す。

2. **`POST /api/autopilot/launch`（L1827-2004）**:
   - 投稿言語 `cleanLang = String(lang).toLowerCase() === 'en' ? 'en' : 'ja'` とは別に、**`const uiLang = resolveUiLang(req, cleanLang === 'en' ? 'en' : 'ja');`**（ただし `views/dashboard_view.html` からは必ず `uiLang` が送られるため UI言語が優先される）を取得する。
   - 多重起動ガード（L1897）の `elapsedSec < 300` を **`elapsedSec < 120`** に短縮する（長大ロック防止）。
   - `inProgress` メッセージ（L1901）、`launchLogs[0]` の `title`/`detail`（L1922-1925）、`completed` の `launchLogs.push({ title })`（L1972）、レスポンス `message`（L1996）はすべて `uiLang` で出し分ける。
   - `prepareNextPost(userId, { lang: cleanLang, uiLang, onProgress: noteProgress })`（L1962）のように `uiLang` を渡す。

---

### 4. `views/dashboard_view.html` — 進捗パーセンテージ細分化 ＆ `uiLang` 送信

1. **`launchStepPercent(step)`（L2959-2962）**:
   次のように段階を追加する（後方互換のため `draft: 84` も残す）：
   ```js
   function launchStepPercent(step) {
     const map = {
       init: 8,
       account: 20,
       page: 34,
       slot: 48,
       draft: 84,
       draft_brief: 60,
       draft_candidates: 74,
       draft_critic: 86,
       draft_repair: 92,
       saving: 96,
       completed: 100
     };
     return Object.prototype.hasOwnProperty.call(map, step) ? map[step] : null;
   }
   ```
2. **`appendAiLog(timeStr, icon, title, detail)`（L2936）**:
   重複除外キー `logKey` を `` `${timeStr}_${title}_${detail}`.slice(0, 140) `` とし、長さ80切りによる別ステップ誤衝突を防ぐ。
3. **`launchAutopilot()`（L3287-3295）**:
   `POST /api/autopilot/launch` の送信 `body` に **`uiLang: isEn ? 'en' : 'ja'`** を追加する（`lang` は従来どおり `#inpPostLang` の投稿言語を送る）。
4. **JA/EN辞書・テキスト確認**:
   - 新規に画面表示する日本語/英語文字列がある場合、`checkIsEn()` 分岐と `I18N.ja` / `I18N.en` の両方に揃える。

---

## テスト・検証要件

1. **単体・結合テストの追加**:
   - `tests/`（例: `tests/velox_polish_and_scaling.test.js` または新規 `tests/launch_progress_and_uilang.test.js`）に以下を追加する：
     - `draftNextPostWithMeta` が `brief(fast)` → `candidates` → `critic` → `repair(nurture)` の順に実行し、`onStage` で `draft_brief` / `draft_candidates` / `draft_critic` / `draft_repair` を報告すること。
     - `generateDraft` がタイムアウト時に `retryTimeoutMs` を使って `fast` へフォールバックすること。
     - `POST /api/autopilot/launch` が `lang: 'en', uiLang: 'ja'` を受け取ったとき、`launch-status` の `launchLogs` / `stepTitle` が日本語になり、逆に `lang: 'ja', uiLang: 'en'` のときは英語になること。
     - `customerFacingReason` に英語UI (`'en'`) と日本語仮説が渡されたとき、日本語生文字が混在しないこと。
2. **必須コマンド検証（最終編集後すべて実行）**:
   - 編集した全 `.js` ファイルへの `node --check`
   - `views/dashboard_view.html` および `views/funnel_index.html` のインライン `<script>` に対する `vm.Script` 構文チェック
   - 指定18+新規テストファイルの `node --test --test-force-exit` 全件成功（0 fail / 0 skip）
   - `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後2秒待機し、`GET /`、`GET /?lang=en`（HTTP 200）、`GET /dashboard`（HTTP 302）確認
   - 本番ユーザー（または実API）への回帰悪化がないこと（`x-shop-out-2.log` / `x-shop-error-2.log` 確認）
