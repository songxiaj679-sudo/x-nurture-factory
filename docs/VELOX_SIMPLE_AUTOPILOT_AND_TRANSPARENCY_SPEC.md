# GROK 実装指示書：超シンプル運用 UX（案A）・Bio/プロフィール診断強化・AI 思考/運用状態の見える化・VELOX AI 品質ブラッシュアップ

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
ユーザー体験の軸である **「X 連携して URL や人物像を入れたら後は全部おまかせ。それでいて現在のアカウント状態・BIO 等の改善助言・AI が今どう考えて運用しているかがひと目でわかる」** 状態を実現するため、以下 4 つの Workstream を実装する。

---

## ⚠️ 絶対厳守ルール（最初に `/home/songxiaj679/x-nurture-factory/AGENTS.md` を熟読すること）

1. **日英混在ゼロ（Zero-Tolerance Bilingual Rule）**:
   - 追加・変更する **すべての画面文言・API 返却メッセージ・バッジ・ラベル・診断コメント** は、JA / EN の両方で完全に切り替わること。
   - `views/dashboard_view.html` は必ず `data-i18n`（`I18N.ja` と `I18N.en` の両方に同一キー）または `STATIC_TEXT_I18N.en`（**テキストノード用。絶対に `STATIC_ATTRIBUTE_I18N.en` に入れないこと**）を使用すること。
   - JS 動的生成 HTML はすべて `checkIsEn()` で分岐し、投稿本文言語（`aiTargetLang`）と管理画面 UI 言語（`currentLang` / `uiLang`）を絶対に混同しないこと。
2. **表現・コンプライアンス整合性**:
   - 廃止済み文言（`7名`, `合議制`, `凍結リスクゼロ`, `バズ保証`, `98.4%` など `tests/homepage_v51_copy.test.js` および `tests/dashboard_language.test.js` で禁止された文言）を復活させないこと。
   - **未取得の数値を捏造しない・X の推薦順位や伸びを断定予測しない**（実測された数字だけを表示し、未測定は「未測定」と正直に示す）。
3. **初期画面のシンプルさ & ボタン重複ゼロ**:
   - `#advancedSettingsDetails` は初期状態折りたたみ（閉じたまま）を維持。
   - 同じ機能を持つボタンを 2 箇所以上に増やさないこと。

---

## Workstream A: 案A — Phase 2（無人自動返信）と Automated ラベル説明を「上級者折りたたみ」に整理

### 背景（重要な仕様事実）
- X の `Automated`（自動アカウント）ラベルは **「別にもう 1 つ管理用の親アカウントを持っていないと設定できない（自分自身を指定できない）」** 仕様である。
- また X ルール上、**通常の予約投稿や Phase 1（確認して 1 クリック送信）のみを使う一般ユーザーには Automated ラベルも別アカウントも不要** である。
- 現状の `views/dashboard_view.html`（`#secMentions`）では Phase 2 ボタン・確認チェックボックス・管理アカウント設定手順が常に丸見えのため、1 アカウントだけで運用したいユーザーが混乱しやすい。

### 実装要件 (`views/dashboard_view.html`)
1. `#secMentions` の先頭に、分かりやすい 1 行の安心注記を追加（JA / EN 両対応）：
   - JA: `※ 通常の自動投稿と「Phase 1（確認して1クリック送信）」のみをお使いの場合、X の自動化（Automated）ラベルや別アカウントの設定は不要です。`
   - EN: `Note: No Automated label or second X account is needed if you only use regular scheduled posts and Phase 1 (review and click to send).`
2. 主画面にそのまま残す操作：
   - `取得`（`loadInboundMentions()`）と、`Phase 1: AI下書きを確認して1クリック送信（安全・初期値）` に関する説明・下書き一覧。
3. **Phase 2（無人自動返信）一式を `<details id="phase2AdvancedDetails">`（デフォルト閉じ）に格納**：
   - `<summary>`:
     - JA: `⚙️ 上級者オプション：受信メンションの完全自動返信（Phase 2 ※管理用の別 X アカウントをお持ちの場合のみ） ▶`
     - EN: `⚙️ Advanced option: Fully automatic mention replies (Phase 2 — requires a separate managing X account) ▶`
   - 中に入れる要素：
     - `btnAutoReplyPhase1` / `btnAutoReplyPhase2` / `btnAutoReplyStop`（状態維持・既存 JS `saveAutoReplyMode` / `emergencyStopAutoReply` は壊さず動作させる）
     - `#autoReplyLabelConfirmed` チェックボックス
     - X の `管理アカウント` 設定 3 ステップ（同じアカウント自身は指定できないため、別に管理している親アカウントを紐付ける説明）
4. `secXProfileGuide` 内の `profile_guide_automated` も「通常の予約投稿・確認制返信なら設定不要（無人自動返信を使う場合のみ）」へ整合させる。

---

## Workstream B: BIO・表示名・固定ポストの「実態ベース助言」強化 (`src/profile_checklist.js` + `src/hybrid_saas_routes.js` + `views/dashboard_view.html`)

### 現状の課題
- 現在の `src/profile_checklist.js`（30行）は `user.userPrompt` を単純クリップしてテンプレ文を 1 つ返すだけで、**ユーザーの実際の現在の X プロフィール（`bio`）、URL から抽出した製品知識（`brandKnowledge`）、成長ステージ（`operatingPosture`）、X プラン有無（`subscription`）を診断・反映していない**。

### 実装要件
1. **`src/profile_checklist.js` (`buildProfileChecklist(user, lang, context)`) の強化**：
   - 引数として `user` に加え、`liveProfile`（可能なら取得済みの `xUsername`, `description`/現 Bio, `subscriptionType`, `pinnedTweetId` 等）、`brandKnowledge`、`posture`（`operatingPosture()` の結果）を受け取れるようにする（後方互換のため `buildProfileChecklist(user, lang)` 単体呼び出しも必ず従来通り動く設計に保つこと）。
   - 返却オブジェクトに以下を含める（JA / EN 完全対応・誇張や未確認数値の捏造禁止・160文字以内厳守）：
     - `currentBio` / `currentBioReview`：現在保存・取得できている X の自己紹介文がある場合は、**具体的なチェック観点**（①「誰向けか」、②「何を発信・提供するか」、③「公式 URL や次の導線」、④「長すぎ/抽象的すぎないか」）に基づく **3〜4 行の改善フィードバック** を返す（未取得の場合は「まず X 再連携またはページ情報から案内を作成しました」等、正直に記載）。
     - `displayName`：アカウントの実態（`brandKnowledge.productName` や `userPrompt`）に沿った分かりやすい表示名例。
     - `bio`（160文字以内厳守）：`brandKnowledge.productName` / `oneLineMechanism` / `icpSummary` と `userPrompt`、`targetUrl` を組み合わせた、そのままコピペして使える実用的な Bio 改善案（誇張なし）。
     - `pin`：最初の来訪者が読む「固定ポストの構成テンプレート」（誰のどんな課題・何をしているアカウントか・リンク案内・記載の根拠注意点）。
     - `highlights`：X 課金種別に応じた助言（X Premium ならハイライト活用法、通常/不明なら固定ポスト集中で十分な旨）。
     - `automated`：案A に従い「通常運用なら設定不要」を明確化。
   - **重要ルール**：`uiLang`（返却説明文や `currentBioReview` 見出しの言語）と、`user.aiTargetLang`（実際に X プロフィールへ貼る `displayName` / `bio` 例文の言語を合わせるか選択できる仕組み）を意識し、ダッシュボードで JA/EN を切り替えたときに説明見出しが混ざらないようにすること。
2. **`POST /api/autopilot/profile-checklist` (`src/hybrid_saas_routes.js` L1578)**:
   - 保存済み `user` の `brandKnowledge`, `voiceProfile`（`bio`）, `latestMarketingStrategy`, `aiTargetLang` に加え、`operatingPosture({ ...user, uiLang: lang })` も計算して `{ ok: true, checklist, posture }` を返す。
   - もし `user.voiceProfile?.bio` が無く `user.xOfficialCredentials` がある場合は、タイムアウト付き（例：2秒以内）で安全に現在プロフィール取得を試み、失敗しても既存の `user` 情報で落ちずにレスポンスを返す（キャッシュ更新できれば尚可）。
3. **`views/dashboard_view.html` (`loadProfileChecklist()`)**:
   - カード表示に **「現在のプロフィールへの助言（診断ポイント）」** カードを追加し、`表示名（コピー）`・`改善 Bio 案（N/160文字＋コピー）`・`固定ポスト案（コピー）`・`ハイライトのコツ` を分かりやすく描画する（ボタンは各カード重複させない）。

---

## Workstream C: 「現在のアカウント状態」「考察分析」「VELOX AI がどう考えて運用しているか」の見える化

### 現状の課題（実ファイルから確認済み）
- `src/growth_phase.js` の `operatingPosture()` や `src/slot_portfolio_planner.js` の `rationale` / `portfolioRole`、さらに `src/next_post_draft.js` の `brief` があるにもかかわらず：
  1. ダッシュボードの見やすい位置に **「VELOX AI の現在の方針と運用判断サマリー」カード** がない。
  2. `#secJobs` の `renderNextPostFacts()`（L4645）に `story_observation` や `utility_save` など **英語の内部コード名が日本語 UI にも生表示** されている。
  3. `#secStrategyReport`（`loadStrategyReport()` L3317-3406）に「合議の議事録はありません」「評議会スコアは未測定です」といったネガティブ・旧時代プレースホルダー表示が残っている。

### 実装要件
1. **共通ラベル辞書と `rationale` の日英対応**:
   - `src/slot_portfolio_planner.js` の `planSlotPortfolio()` に optional 引数 `lang = 'ja'` を追加し、`rationale` を `ja` / `en` 両方で返せるようにする（既存テスト `slot_portfolio_planner` の既定 `'ja'` 挙動は維持）。
   - `views/dashboard_view.html` に `portfolioRole` を人間向けの分かりやすい日本語／英語へ変換する共通マップを作る（例：`utility_save` -> 「保存向けの具体手順」 / `Actionable guide`, `conversation_debate` -> 「読者への問いかけ・視点共有」 / `Discussion & perspective`, `story_observation` -> 「現場の気づき・実務ストーリー」 / `Observation & story`, `profile_asset_bridge` -> 「プロフィール・固定投稿への導線」 / `Profile bridge`, `explicit_promo_offer` -> 「【PR】登録URLの自然な案内」 / `Marked [PR] offer`）。**生コード名（`story_observation` 等）をそのまま顧客に見せないこと**。
2. **`GET /api/autopilot/overview` または `/api/autopilot/jobs` + `/api/autopilot/weekly-report` への `operatingSummary` 付与 (`src/hybrid_saas_routes.js`)**:
   - 既存 `/api/autopilot/jobs` のレスポンス（または軽量専用エンドポイント）に `uiLang` に応じた `operatingSummary` を返す：
     - `situation`: `operatingPosture({ ...sessionUser, uiLang }).situation`（今のフォロワー・直近表示回数・Xプランからの最適な文字数設定）
     - `goal`: `operatingPosture(...).goal`（今の段階での現実的な目標値）
     - `approach`: `operatingPosture(...).approach`（今は価値提供優先か、無理のない範囲で【PR】返信を混ぜる段階か、その理由）
     - `whyNextPostOnly`: 「反応を毎回見てから次の1本を組み直す」現在のサイクル状態（前回投稿の結果を受けて同テーマ深掘りか別切り口へ変更か、`recoveryMode` かどうか）
     - `insights`: 実測スナップショットがある場合は保存率の傾向や文字数・時間帯に関する客観的考察（未測定なら「これからの投稿実績が溜まり次第、自動で考察を更新します」）
3. **ダッシュボードに「🧭 現在のアカウント状態 ＆ VELOX AI の運用方針」カードを表示 (`views/dashboard_view.html`)**:
   - 初期ログイン時（有料有効中／設定完了後、`#cockpitLockedBody` 内、`#secStep3` と `#secJobs` の周辺）に、**ボタンだらけにせずスッキリした読み物カード 1 枚** として以下を表示：
     1. **アカウントの現在地**：フォロワー・検索/Xプラン状態・直近反応の事実サマリー
     2. **いまの運用方針（ベストプラクティス）**：なぜ今この投稿バランス（価値提供中心 / 適度なPR / リンク抑制等）で運転しているか
     3. **X プロフィール（Bio・固定ポスト）の改善ヒントを開くボタン**（※高度な設定内の同じボタンと機能が重ならないよう、`loadProfileChecklist()` を開く／表示する導線は役割が明快な 1 つに整理、またはここを主要窓口にして重複をなくすこと！）
   - あわせて `#secJobs` 内の次投稿カード（`renderNextPostFacts()`）では、`brief`（誰のどんな場面に・読者の持ち帰り）と人間向けロール名を自然に表示し、生コード名・`unknown` の機械出力をなくす。
   - あわせて `loadStrategyReport()` の古い「議事録はありません」「未測定です」文言を整理し、実態に合わない空パネルを表示しないこと。

---

## Workstream D: VELOX AI 生成・戦略エンジンのブラッシュアップ

コード検証で判明した実務上の弱点を改修する（既存の安全制約・数値捏造ブロック `draft_verifier.js`・`post_constraint_guard.js` は 100% 維持・強化すること）。

1. **`src/next_post_draft.js` (`brief` と選出理由の可視化メタ出力)**:
   - 既存 `draftNextPostText(params)` の戻り値（`Promise<string[]>`）は既存テストと互換維持したまま、新しく `draftNextPostWithMeta(params)` を追加し `{ tweets, brief, criticSummary }` を返す（`draftNextPostText` は `draftNextPostWithMeta` を呼んで `.tweets` のみ返す）。
   - `src/autonomous_promo_ai.js` の保存ペイロードに `draftBriefSummary`（`scene`, `readerPayoff`, `hookAngle`, `offer`）および `draftRationale` を保存し、管理画面の「なぜ AI は次の1本をこう書いたか」としてそのまま表示できるようにする。
2. **「URL なし・人物像のみ」ユーザーへの AI 思考＆初期リライト対応 (`src/autonomous_promo_ai.js`)**:
   - 現状 `src/autonomous_promo_ai.js` L314 付近の早期見直し（`Next Post Rewrite`）が `if (pageSummary && pageSummary.ok && ...)` を条件にしているため、URL を入力せず「人物像（`userPrompt`）」のみで運用しているアカウントでは再見直しがスキップされる。
   - `if ((pageSummary && pageSummary.ok) || (user.userPrompt && String(user.userPrompt).trim()))` の場合も（人物像＋`brandContextNotes`＋`voiceProfile` を根拠として）正常に見直し・役割ローテーションが回るようにする（ただし URL が無い場合は絶対に存在しない製品・リンク・PR を書かないガードを継続）。
3. **`src/autonomous_strategy_architect.js` の初期おまかせ提案精度向上 (`maybeAutofillStrategy`)**:
   - 現在 L34-36 で `posts: []` を渡しているため、X 連携直後の自動戦略生成に過去の投稿傾向が反映されていない。
   - 可能な場合は X API から取得した直近オリジナル投稿（最大20件）と `bio` を `proposeAutonomousStrategy({ bio, posts, url, lang })` へ渡し、さらに `user` に適切な初期方針・実務メモが自動で入るようにする。

---

## 検証要件（完了報告前に必ず実行・実測出力を確認すること）

変更後に以下をすべて実行し、失敗 0 を確認すること：
1. 変更した全 `.js` ファイルに対して `node --check`
2. `views/dashboard_view.html` および `views/funnel_index.html` 全 `<script>` に対して `vm.Script` 構文検査
3. 全関連テスト実行（`node --test --test-force-exit`）：
   - `tests/compliance_and_topnav_i18n.test.js`
   - `tests/dashboard_language.test.js`
   - `tests/homepage_v51_copy.test.js`
   - `tests/growth_phase.test.js`
   - `tests/velox_polish_and_scaling.test.js`
   - `tests/velox_next_level.test.js`
   - `tests/phase3_portfolio_verifier.test.js`
   - `tests/free_experience_and_consent.test.js`
   - `tests/phase2_autonomy_workspaces.test.js`
   - `tests/autopilot_setup_save.test.js`
   - `tests/autopilot_jobs_separation.test.js`
   - 今回追加する単体テスト（Phase 2 折りたたみ、Bio診断と `uiLang`/`aiTargetLang` 分離、生コード名非表示、`operatingSummary`、`draftNextPostWithMeta`、URL なし人物像運用対応）
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後 2 秒待機し、公開 URL の HTTP ステータスを `curl` で確認すること。
