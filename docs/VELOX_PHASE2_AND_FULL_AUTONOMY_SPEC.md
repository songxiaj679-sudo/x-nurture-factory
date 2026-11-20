# VELOX AI 第2段階：Phase 2 自動返信・完全自律設定・不正トライアル防止・マルチXアカウント 実装仕様書（GROK 指示書）

> **作成日**: 2026-11-18  
> **前提**: [VELOX_NEXT_LEVEL_GROK_PLAN.md](file:///home/songxiaj679/x-nurture-factory/docs/VELOX_NEXT_LEVEL_GROK_PLAN.md)（Workstream A〜E）完了後の次期ステップ仕様。  
> **対象コード**: `/home/songxiaj679/x-nurture-factory`

---

## 0. GROK 厳守事項

1. **既存テスト契約・安全ロックの維持**:
   - `runOfficialAutonomousEngagement()`（[src/official_api_client.js#L1020-L1026](file:///home/songxiaj679/x-nurture-factory/src/official_api_client.js#L1020-L1026)）は従来の「無差別能動エンゲージメント」の安全停止関数として `x_approval_required` を維持し、[tests/engagement_approval_safety.test.js](file:///home/songxiaj679/x-nurture-factory/tests/engagement_approval_safety.test.js) を通すこと。
   - **能動的なキーワード検索リプライ・無差別フォロー・養殖コード参照は引き続き全面禁止**。
   - すべての自動・半自動アクションは所有権チェック（`resolveSessionUser` + 本人確認）および `officialApiOperationAllowed()` を必須とする。

---

## 1. Phase 2：安全な「受信メンション・リプライ自動返信」解放基盤の完備

X 開発者規約（Automation Rules）に違反せず、X の審査／本番アカウント規定（`Automated` ラベル運用）を満たした状態で **ON にすれば即動く Phase 2 基盤** を揃える。

### 1.1 解放ゲートとポリシーモジュール（新規 `src/auto_reply_policy.js`）
1. **環境変数フラグ（コード変更なしで段階解放可能）**:
   - `process.env.X_AUTO_REPLY_PHASE2_ENABLED === 'true'`（**既定値 `'false'`**。オーナーが X 審査・規約確認を終えて `.env` を `'true'` にしたときだけ自動送信ワーカーが動く）。
   - `process.env.X_AUTO_REPLY_ALLOWED_HANDLES`（カンマ区切り・任意）：本番全面開放前に自社テストアカウント1件だけでテストするための限定許可。
2. **顧客単位のオプトイン設定 (`saas_users/{userId}.autoReplySettings`)**:
   ```json
   {
     "enabled": false,
     "mode": "approval_queue",
     "xAutomatedLabelConfirmed": false,
     "xAutomatedLabelConfirmedAt": null,
     "maxRepliesPerDay": 5,
     "cooldownHoursPerAuthor": 24,
     "consentVersion": 1,
     "updatedAt": "ISO8601"
   }
   ```
   - `mode`: `'approval_queue'`（Phase 1: 人が1クリック送信） / `'auto_mentions'`（Phase 2: 受信メンション・自投稿リプライへの自動返信）。
   - **`xAutomatedLabelConfirmed === true` が必須**: X の自動化ルール上、自動返信を使うアカウントには公式の「Automated（自動化されたアカウント）」ラベル表示が求められるため、ダッシュボードのトグルは「Xアカウント側でAutomatedラベル/自動化表示ルールを確認した」チェックなしでは `'auto_mentions'` を有効化できないようにする。
3. **純粋判定関数 `autoReplyPhase2Allowed(user, creds, env = process.env)`**:
   - 以下をすべて満たす場合のみ `{ allowed: true }`、1つでも欠ければ `{ allowed: false, reason }` を返す：
     1. `String(env.X_AUTO_REPLY_PHASE2_ENABLED || '').toLowerCase() === 'true'`
     2. `isPaidAccount(user)` が真かつ `!user.autopilotPaused`
     3. `officialApiOperationAllowed(user, creds, env)` が真
     4. `user.autoReplySettings?.enabled === true` かつ `user.autoReplySettings?.mode === 'auto_mentions'`
     5. `user.autoReplySettings?.xAutomatedLabelConfirmed === true`
     6. `X_AUTO_REPLY_ALLOWED_HANDLES` が設定されている場合は該当ハンドルのみ許可

### 1.2 オプトアウト・スパムループ・重複返信の完全ガード
1. **停止要求（Opt-out）の自動検知と恒久ブロック**:
   - 受信本文に `/\b(stop|unsubscribe|opt[- ]?out|do not reply|bot)\b|返信不要|送らないで|連絡しないで|停止してください|スパム/i` が含まれる場合、送信を永久中止し `saas_users/{userId}/blocked_reply_authors/{authorId}` に記録する。以降、同じ `authorId` からのメンションは Phase 1 候補にも Phase 2 自動送信にも出さない。
2. **無限ループ・重複・上限ガード**:
   - **同一作者 24h クールダウン**: 同じ `authorId` に対して `cooldownHoursPerAuthor`（既定 24時間）以内に既に返信済みならスキップ。
   - **1日上限キャップ**: 当日送信数が `Math.min(20, maxRepliesPerDay)` に達したら当日は停止（プラン別上限：Starter 最大 3 / Pro 最大 10 / Business 最大 20）。
   - **同一 `tweetId` 二重送信防止**: `db.runTransaction` 内で `inbound_mentions/{tweetId}` の `replyState` を `'none'` → `'sending'` に原子遷移させてから X API を叩く。
   - **自アカウント発言の除外**: `authorId === selfTwitterId` の自分自身の投稿・リプライには絶対に応答しない。
3. **返信文の安全検証**:
   - 返信生成プロンプトは「URL記載禁止・誇大約束禁止・根拠なき数値禁止・押し売り禁止・相手への質問回答/お礼/丁寧な補足のみ」を強制。
   - 送信前に `runDeterministicAudit` 相当（URLゼロ・禁止語 `ngTopics`・文字数上限・AIスロップ除外）を通過させ、落ちた場合は送信せず `'skipped_audit'` を記録して安全にスキップする。

### 1.3 バックエンド API・ワーカー ＆ ダッシュボード UI
1. **定期ワーカー (`processInboundAutoReplies`)**:
   - `startAutopilotJobRunner()`（または `x-saas-worker`）内で 3〜5分周期で実行。`autoReplyPhase2Allowed` が真のユーザーのみ受信メンションを取得し、未処理・非オプトアウト・枠内のものへ自動返信＋監査ログ保存。
2. **ダッシュボード UI（「💬 読者からの返信・メンション」拡張）**:
   - モード切替 UI：`Phase 1: AI下書きを確認して1クリック送信（安全・初期値）` / `Phase 2: 受信メンションに自動返信（※環境許可＆X Automatedラベル確認後のみ有効化可）`。
   - **1クリック緊急停止ボタン** + 「誰に・いつ・何を自動返信したか／なぜスキップしたか」の透明ログ一覧。

---

## 2. 完全自動化：VELOX AI「ゼロ設定・自律最適化モード」

お客様が細かい設定項目に悩まず、**X 連携だけ（または URL とセット）で「あとは VELOX AI が自分で考えて戦略立案・投稿・改善を完結する」**状態を作る。

### 2.1 自律設定エンジン（新規 `src/autonomous_strategy_architect.js`）
1. **トリガー箇所**:
   - X OAuth 2.0 連携完了直後、`/api/autopilot/save-setup`（`autonomousMode: true` 時）、または有料プラン有効化直後に `userPrompt` やターゲット方針が未設定・自動おまかせ設定の場合に自動実行。
2. **入力と自動推論**:
   - 顧客の X Bio・過去オリジナル投稿（最大20件）・プロフに設定された公式サイト URL（もしお客様が URL を入力していなくても X プロフ上の URL を参考読取できる仕組みを任意選択可、入力 URL 優先）・`extractBrandKnowledge` を自動解析。
   - Grok（`tier: 'quality'`）により以下を**自動決定して保存**（手動編集があった場合は `strategyLockByUser: true` として尊重し上書きしない）：
     - `userPrompt`（アカウントの立ち位置・誰のどんな課題をどう助けるかの発信方針）
     - `aiTargetLang` / `scheduleTimeZone` / `targetCountry`（X プロフと直近投稿の言語・活動時間帯から自動判定）
     - `brandContextNotes` の初期シード（※未確認の体験談は絶対に入れない。X Bio や登録ページの検証済み特徴のみを要約）
     - 初期投稿スロット（`schedulePlanJitSlots`）＋ 即時 `ensureNextPost(userId)` 起動。
3. **継続的・自律的ピボット**:
   - `harvestTweetMetricsAndEvolveKnowledge` が 24時間後成績（インプ・保存・リプ・フォロー）と週次サマリーを評価し、お客様が手動介入しなくても **`promptDirectives`・`genes` 重み・`portfolioPlan`・成長フェーズを自律進化** させる。
   - ダッシュボードには「設定フォームの必須入力」を極力隠した上で、**「🤖 今週 VELOX AI が自動判断して更新した戦略メモ（例：手順解説より失敗回避の切り口の保存率が高いため比重を上げました）」** を1カードで提示する。

### 2.2 ダッシュボード UI（おまかせモード）
* オンボーディング／設定画面に **「✨ おまかせ自動設定（VELOX AI があなたのアカウントから戦略を自動作成）」** をデフォルト最優先オプションとして配置し、URL すら空でも X アカウント連携だけで即座に稼働開始できるようにする。

---

## 3. 無料トライアル多重悪用防止ベストプラクティス（柔らかい表現）

### 3.1 技術的防止策（`src/trial_abuse_guard.js` + `src/shop.js`）
メールアドレスを変えて新しいログイン ID を作り、同じ X アカウント（または `@ユーザー名` を変更した同一 X アカウント）で 14日間無料トライアルを繰り返す不正を、以下の**3層チェック**で防ぐ。

1. **恒久数値 `twitterId` による判定（`@ユーザー名` 変更を無効化）**:
   - X の `@username` は変更可能だが、数値ユーザーID（`twitterId`, 例 `"178291..."`）は不変。
   - トライアル開始時および `/api/billing/create-checkout` 実行時に、対象ユーザーの連携済み `twitterId` をグローバルコレクション **`trial_eligibility_claims/x_${twitterId}`** に記録・照合する（`{ firstUserId, claimedAt, stripeCustomerId }`）。
   - OAuth 連携完了時（`GET /api/auth/twitter/callback`）にもすでに別 `saasUserId` でトライアル消費済みの `twitterId` かチェックし、`trialAlreadyClaimedByXId: true` をマークする。
2. **決済手段（カード fingerprint）とメール正規化**:
   - Stripe Checkout 完了／Webhook 時、`payment_method.card.fingerprint`（国＋カード番号固有の匿名ハッシュ）を取得可能なら `trial_eligibility_claims/pm_${fingerprint}` へ記録し、別X・別メールでも同一カードの複数回トライアルをブロックする（Stripe Subscription 作成時、過去トライアル済み顧客には `trial_period_days` を付けない）。
   - Gmail のドット・`+alias` 正規化済みメール（例 `u.ser+1@gmail.com` → `user@gmail.com`）も `trial_eligibility_claims/em_${sha256}` で照合対象にする。
3. **適用動作（ブロックではなく「通常プラン開始＋元アカウント案内」）**:
   - 既利用アカウントが Stripe 決済へ進む場合、コードは自動的に **`trial_period_days: 14` なしの通常プラン開始（または事前確認モーダル表示）** に切り替える。

### 3.2 お客様へ表示する柔らかい文面（UIガイド）
絶対に「不正」「悪用」「重複登録禁止」など攻撃的な表現を使わず、**「学習データの引き継ぎ」という顧客メリット**で案内する：

> **【確認ダイアログ / バナー例（JA）】**  
> ご連携いただいた X アカウント（`@{{handle}}`）では、すでに 14日間の無料トライアルをご利用いただいています。  
> 新しいログイン ID のままご利用を始める場合は、初月から通常プランでのスタートとなります。  
> ※ 以前のアカウントで続けていただくと、これまで VELOX AI が学習した「読まれやすい切り口・過去の反応データ」をそのまま引き継げるため、元のアカウントでのログインをおすすめします。

---

## 4. 1つのログイン ID で複数の X アカウント管理（個別課金・ワークスペース分離）

代理店、複数ブランド運営者、個人＋法人アカウント保有者が、**1回のログインで複数アカウントを運用し、Xアカウントごとに個別に課金・有効化できる構造**。

### 4.1 互換性を崩さない最良データアーキテクチャ（Workspace-per-X 方式）
既存の `saas_users/{workspaceId}`、`autopilot_jobs`（`where('userId', '==', workspaceId)`）、`episodic_memories`、Stripe `metadata.userId`、X OAuth2 トークンは、すべて `workspaceId` を 1つの X 運用単位として既に完結している。したがって以下のように拡張すると既存資産を壊さない：

1. **ログインオーナーとワークスペースの分離**:
   - 新コレクション **`login_owners/{ownerUid}`**:
     ```json
     {
       "ownerUid": "WEB-GOOGLE-...",
       "email": "user@example.com",
       "workspaceIds": ["WEB-GOOGLE-...", "WS-abc123..."],
       "activeWorkspaceId": "WS-abc123...",
       "updatedAt": "ISO8601"
     }
     ```
   - 各ワークスペースの実体は現行どおり **`saas_users/{workspaceId}`** とし、`ownerUid` と `workspaceLabel`（表示名例：`@BrandAccount`）を持たせる。
2. **セッション解決 (`src/auth_service.js` / `resolveSessionUser`) の拡張**:
   - セッション Cookie（認証対象 `ownerUid`）に加え、現在選択中の `activeWorkspaceId`（Cookie `velox_ws` または `login_owners/{ownerUid}.activeWorkspaceId`）を解決。
   - **厳格な所有権ガード**: `activeWorkspaceId` が `ownerUid` 本人または `saas_users/{wsId}.ownerUid === ownerUid` に一致しない場合は 403 で拒否し、他人のワークスペースには絶対に切り替えられないようにする。
   - API レイヤー（`prepareNextPost`, `ensureNextPost`, `/api/autopilot/*`, `/api/billing/create-checkout`）は引き続き `sessionUser.userId`（= 選択中 `workspaceId`）をそのまま使うため、**データ・学習記憶・X認証・Stripe課金が完全にワークスペース単位で分離**される。
3. **Xアカウント別課金の徹底**:
   - 新しくワークスペース（`POST /api/workspaces/create`）を追加しても、初期状態は `planId: 'free', planStatus: 'free'`（未契約）。
   - そのワークスペース固有の `workspaceId`（`WS-...`）を Stripe Checkout の `client_reference_id` ＆ `metadata.userId` に渡して決済するため、**アカウントごとに独立した Stripe Subscription（個別課金）と自動解約ボタン**を持つことができる。
   - さらにワークスペース追加時にも Section 3 の `trial_eligibility_claims` チェックが働くため、同オーナーが 2アカウント目で別 X アカウントを繋ぐ場合は「別 X アカウントならそのまま管理・課金可能」、同じ X アカウントを別枠へ繋ぎ直そうとした場合も学習分離＋重複トライアル抑止が正しく動く。
4. **ダッシュボード UI**:
   - ナビゲーションヘッダーに **ワークスペース切替ピル（例：`@MainAccount (Business有効) ▾` ＋ `＋ 別Xアカウントを追加（個別契約）`）** を追加。

---

## 5. GROK へ渡す実行指示プロンプト（そのままコピー可能）

```text
あなたは /home/songxiaj679/x-nurture-factory のシニアスタッフエンジニアです。
/home/songxiaj679/x-nurture-factory/docs/VELOX_PHASE2_AND_FULL_AUTONOMY_SPEC.md を熟読し、Section 0 の絶対厳守事項を守りながら Section 1〜4 を段階的に実装してください。

【実装ステップ（各ステップごとにテスト作成＋実行）】
Step 1（Section 3：不正トライアル防止 + 優しい案内）:
- `src/trial_abuse_guard.js` を作成し、`twitterId`（不変ID）・Stripeカード指紋・メール正規化による重複トライアル判定と、柔らかい日本語/英語案内を返す仕組みを `/api/billing/create-checkout`・Stripe Webhook・OAuthコールバックへ統合してください。
- ユニットテストを追加し、ユーザー名変更（同じ twitterId での再登録）でも二重トライアルを防げることを検証してください。

Step 2（Section 2：VELOX AI ゼロ設定・自律最適化モード）:
- `src/autonomous_strategy_architect.js` を作成し、X連携やURL有無から VELOX AI が自律的にターゲット・発信方針・投稿スケジュール・成長戦略を設計・進化させる「おまかせ自動設定」と、AIの今週の戦略判断ログ表示を実装してください。
- ユーザーが明示編集した設定（`strategyLockByUser` / `isHumanOverride`）を壊さないテストを追加してください。

Step 3（Section 1：Phase 2 自動返信解放基盤）:
- `src/auto_reply_policy.js` を作成し、`X_AUTO_REPLY_PHASE2_ENABLED` フラグ・`autoReplySettings`（`xAutomatedLabelConfirmed` 必須）・オプトアウト検知・24h同一作者クールダウン・日次上限・監査送信ワーカー・緊急停止UIを実装してください。
- `runOfficialAutonomousEngagement()` は引き続き `x_approval_required` を維持し、既存 `tests/engagement_approval_safety.test.js` を絶対に壊さないでください。Phase 2 のオプトアウト・二重返信防止・未確認ラベル拒否の単体テストを追加してください。

Step 4（Section 4：1ログインID複数Xアカウント・個別課金ワークスペース）:
- `login_owners` + `saas_users/{workspaceId}` 分離、ワークスペース作成/切替エンドポイント（厳格所有権検証付き）、ヘッダー切替UIを実装し、アカウント別に Stripe 課金状態と投稿データ・学習記憶が完全分離されるテストを追加してください。

完了ごとに `node --check`、HTML インラインスクリプト `vm.Script` チェック、`node --test` 関連一式を実行して 0件失敗を確認してから報告してください。
```
