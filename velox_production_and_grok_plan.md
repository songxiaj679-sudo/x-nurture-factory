# VELOX AI 本番公開対応 ＆ Gemini → Grok API 完全移行 設計・実装計画書

> 本ドキュメントは `/home/songxiaj679/x-nurture-factory` の実コード照合済み実装仕様書です。  
> GROK による確認済み3判断（① 公式APIの既定許可は社内2アカウント維持＋環境変数切替で安全に段階開放、② Stripe 14日間無料トライアルはログイン必須化・`GUEST_` 排除、③ `STRIPE_WEBHOOK_SECRET` と X Developer Portal 本番公開はコード外作業）を反映しています。

---

## 0. 合意済みの全体方針と段階開放ゲート

1. **公式 X API の稼働範囲（安全設計）**:
   - **既定値（このPRのリリース直後）**: [src/operated_accounts.js](src/operated_accounts.js) の本番許可リストは現行どおり `@VeloxSystemsV4`（`WEB-GOOGLE-D12E2479A76266AEA2B4`）と `@VeloxSystemsHQ`（`USR-MVUA1GLP-D640`）のみを通す。
   - **コード再デプロイ不要の段階開放スイッチを同時実装**:
     - `process.env.OFFICIAL_API_EXTRA_HANDLES`（カンマ区切り）: 外部の第三者Xテストアカウント1件だけを `.env` 指定で疎通確認できるようにする。
     - `process.env.OFFICIAL_API_ALLOW_PAID_CUSTOMERS === 'true'`: X Developer Portal 公開設定および Stripe Webhook 確認完了後、`.env` を `true` にして `pm2 restart x-shop --update-env` するだけで、「有料契約有効＋OAuth連携済み＋同意済み（かつ養殖由来でない）全 SaaS 顧客」へ無停止で開放できるようにする。
2. **Stripe 14日間無料トライアル導線**:
   - 未ログイン客に `GUEST_` セッションを作らせず、先に Google または X でログインさせてから Checkout Session を作成する。
   - Checkout 成功戻り（`GET /dashboard?payment=success&session_id=...`）と Webhook（`POST /api/webhooks/stripe`）の両方で、共通パッチ関数により `stripeSubscriptionStatus`・`stripeSubscriptionTrialEnd`・`cancelAtPeriodEnd`・`billingEndsAt` を欠落なく保存する。
3. **LLM の 100% Grok API（xAI）統一（Gemini API 完全廃止）**:
   - 全ソース・全テストモックから `@google/generative-ai`、`@google/genai`、`generativelanguage.googleapis.com`、`GEMINI_API_KEY` 依存を撤去し、[src/grok_client.js](src/grok_client.js) へ一本化する。
   - ただし Python ランナーやワーカー等から参照されている**既存エクスポート関数名**（`generateUniquePersonaProfileViaGemini`、`analyzeUrlAndMarketViaGemini` 等）は互換維持（中身を Grok 化）し、呼び出し側を壊さない。
4. **ダッシュボード Step 3（スタート／ストップ）の UX 完結**:
   - 未契約（Free）時はスタート API で 402 を返してプラン選択を案内し、スタート成功後は約 1.5〜3 分かかる次回投稿生成の完了まで UI が自動ポーリングして一覧を更新する。

---

## 1. Workstream 1：`src/operated_accounts.js` と公式API判定の整備

### 現状の照合箇所
- [src/operated_accounts.js](src/operated_accounts.js#L1-L33): `OPERATED_HANDLES`、`OPERATED_USER_IDS`、`isOperatedOfficialAccount`、`officialApiOperationAllowed`
- 呼び出し箇所:
  - [src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L395-L398) (`executeAutopilotJob`)
  - [src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L1426-L1428) (`POST /api/autopilot/launch`)
  - [src/autonomous_promo_ai.js](src/autonomous_promo_ai.js#L2869) (`ensureNextPost`)
  - [src/official_api_client.js](src/official_api_client.js#L1093-L1094) (`syncAllActiveCustomersPostMetrics`)
- 既存テスト: [tests/operated_accounts.test.js](tests/operated_accounts.test.js#L1-L17)

### 変更仕様
1. **[src/operated_accounts.js](src/operated_accounts.js)**:
   - `extraAllowedHandles(env)` ヘルパーを追加（`env.OFFICIAL_API_EXTRA_HANDLES` を `,` 分割・小文字/`@` 除去で `Set` 化）。
   - `hasOfficialCredentials(user, credentials)` ヘルパーを追加（`credentials?.oauth2AccessToken` / OAuth1 4キー、または `user.xOfficialCredentials` の存在を確認）。
   - `officialApiOperationAllowed(user = {}, credentials = null, env = process.env)`:
     1. `/^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST || '')` → `true`
     2. `isOperatedOfficialAccount(user, credentials)` → `true`
     3. `extraAllowedHandles(env)` にハンドルのいずれかが一致、かつ `hasOfficialCredentials(user, credentials)` → `true`
     4. `String(env.OFFICIAL_API_ALLOW_PAID_CUSTOMERS || '').toLowerCase() === 'true'` かつ `user.originType !== 'imported'` かつ `(user.planStatus === 'active' || Number(user.tierLevel) >= 1)` かつ `hasOfficialCredentials(user, credentials)` → `true`
     5. 上記以外 → `false`（**既定では `env` 未設定のため社内2アカウントのみ許可のまま維持**）。
2. **[src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L1426-L1428)**:
   - `/api/autopilot/launch` の 403 文言を `OFFICIAL_API_ALLOW_PAID_CUSTOMERS === 'true'` 時にも対応できる文言へ更新（または状態に応じたメッセージ）：
     `'現在は本番試験運用のため許可された公式アカウントのみ自動投稿を実行できます。'`（フラグ有効化後に一般拒否が起きた場合は `'有効な有料プランとX公式アカウント連携が必要です。'` 等）。
3. **[src/official_api_client.js](src/official_api_client.js#L1093-L1094)**:
   - `syncAllActiveCustomersPostMetrics` で `officialApiOperationAllowed({ ...uData, userId: doc.id }, decryptCredentials(hasCreds))`（または `uData` 渡し）を呼び、将来 `OFFICIAL_API_ALLOW_PAID_CUSTOMERS=true` にした際に有料顧客の指標回収も同時に開放されるようにする。
4. **[tests/operated_accounts.test.js](tests/operated_accounts.test.js)**:
   - 既存のアサーション（既定では `some_customer` は `false`、社内2アカウントは `true`）はすべて維持しつつ、以下を追加テスト：
     - `OFFICIAL_API_EXTRA_HANDLES=trial_tester` 指定＋認証ありで `trial_tester` が `true`
     - `OFFICIAL_API_ALLOW_PAID_CUSTOMERS=true` 時に `{ planStatus: 'active', xOfficialCredentials: 'enc', xUsername: 'paid_user' }` は `true`、未契約・未連携・`originType: 'imported'` は `false`

---

## 2. Workstream 2：Stripe Checkout・14日間無料トライアル・Webhook・ログイン誘導

### 現状の照合箇所
- `POST /api/billing/create-checkout`: [src/shop.js](src/shop.js#L4424-L4481)（未ログイン時 `GUEST_` 採番）
- `GET /dashboard`: [src/shop.js](src/shop.js#L2570-L2603)（未ログイン時 `/#login-box` リダイレクト、L2577 戻り検証に `client_reference_id` 検証・`subscriptions.retrieve`・`trial_end` 保存なし）
- `POST /api/webhooks/stripe`: [src/shop.js](src/shop.js#L4503-L4604)（署名検証フェイルクローズ維持、L4551 `GUEST_` 除外、`trial_end`/`status` 同期不足）
- 解約処理・パッチ関数: [src/billing_cancel.js](src/billing_cancel.js#L1-L49)
- 決済共通ヘルパー: [src/stripe_billing_helpers.js](src/stripe_billing_helpers.js#L1-L101)
- フロント決済呼び出し: [views/funnel_index.html](views/funnel_index.html#L965-L1007)（`handlePayClick`）、[views/dashboard_view.html](views/dashboard_view.html#L1760-L1801)

### 変更仕様
1. **未ログインチェックアウト禁止（`GUEST_` 廃止）**:
   - [src/shop.js](src/shop.js#L4446-L4449): `const user = await getCurrentUser(req);` が無い、または `!user.userId` なら **HTTP 401** を返す：
     ```js
     if (!user || !user.userId) {
       return res.status(401).json({
         ok: false,
         code: 'login_required',
         error: '14日間無料トライアルの開始には、先にGoogleまたはXでログインしてください。',
         loginUrl: '/#login-box'
       });
     }
     ```
   - [src/shop.js](src/shop.js#L4453): `baseUrl` は `(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')` を使い、`success_url` / `cancel_url` が確実に `https://veloxpostapp.com/...` になるようにする。
   - [views/funnel_index.html](views/funnel_index.html#L965-L1007):
     - `handlePayClick(p, e)` がサーバーから HTTP 401 / `code === 'login_required'` を受けたとき（または `localStorage.getItem('xsw_uid')` が空・未ログイン表示のとき）、`localStorage.setItem('xsw_pending_plan', p)` と `xsw_pending_currency` を保存し、ボタンを元の表示へ戻して `/#login-box`（ログインボタン位置）へスムーズに案内・スクロールし、トースト／アラートで「先にGoogleまたはXでログインしてください。ログイン後に選択したプランのトライアルへ進めます」と表示する。
   - [views/dashboard_view.html](views/dashboard_view.html):
     - 初期化時、`!window.__DASHBOARD_CONFIG__?.isPaid` かつ `localStorage.getItem('xsw_pending_plan')` がある場合は取り出してクリアし、`selectPlan(pendingPlan)` → `togglePlanSection()` でプランモーダルを自動オープン（または「選択中のプランで14日間無料トライアルを開始」導線を見える位置に表示）する。無確認の勝手な課金リダイレクトはしない。

2. **トライアル状態・終了日時の完全永続化（戻り検証 ＆ Webhook 共通化）**:
   - [src/stripe_billing_helpers.js](src/stripe_billing_helpers.js)（または [src/billing_cancel.js](src/billing_cancel.js)）に純粋関数 `buildActiveStripePlanPatch({ plan, stripeCustomerId, stripeSubscriptionId, subscription, basePlanCatalog, now })` を追加：
     - `planId: plan`、`planStatus: 'active'`、`tierLevel: plan === 'business' ? 4 : (plan === 'pro' ? 2 : 1)`
     - `maxThreads`、`maxAccounts`、`aiReplyUnlocked: plan === 'business'`
     - `stripeCustomerId`、`stripeSubscriptionId`
     - `stripeSubscriptionStatus: subscription?.status || 'active'`（トライアル中 `'trialing'`）
     - `stripeSubscriptionTrialEnd: subscription?.trial_end ? new Date(Number(subscription.trial_end) * 1000) : null`
     - `cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end)`
     - `billingEndsAt: subscription?.current_period_end ? new Date(Number(subscription.current_period_end) * 1000) : null`
   - [src/shop.js](src/shop.js#L2577-L2603) (`GET /dashboard`):
     - `stripeSess` 取得後、**所有者一致検証**：`const sessUid = stripeSess.client_reference_id || stripeSess.metadata?.userId || '';` が `!sessUid || sessUid !== user.userId` なら適用しない。
     - `stripeSess.subscription`（文字列または `.id`）があれば `stripe.subscriptions.retrieve(subId)` を取得して `buildActiveStripePlanPatch` に渡し、DB 保存と同時にローカル変数 `user` へも `Object.assign(user, patch)` して画面バナー（残り日数表示等）へ即座に反映する。
   - [src/shop.js](src/shop.js#L4525-L4598) (`POST /api/webhooks/stripe`):
     - 署名検証（`STRIPE_WEBHOOK_SECRET` 必須）は変更せず厳格維持。
     - `checkout.session.completed` / `invoice.payment_succeeded` 時、可能なら `subscriptionId` から `stripe.subscriptions.retrieve(subscriptionId)` を取得し、`buildActiveStripePlanPatch` で `stripeSubscriptionTrialEnd` / `stripeSubscriptionStatus` まで揃えて保存する。
     - `customer.subscription.trial_will_end` を受け取っても 200 `{ received: true }` で正常応答する。
   - [src/billing_cancel.js](src/billing_cancel.js#L36-L47) (`subscriptionStatePatch`):
     - `stripeSubscriptionStatus: subscription.status || ''` と `stripeSubscriptionTrialEnd`（設定されていれば更新）も返却パッチに含める。

3. **単体テスト追加**:
   - [tests/billing_cancel.test.js](tests/billing_cancel.test.js) および [tests/stripe_billing_helpers.test.js](tests/stripe_billing_helpers.test.js) に `buildActiveStripePlanPatch`（`trialing` / `trial_end` / `cancel_at_period_end`）と `subscriptionStatePatch` の検証ケースを追加する。

---

## 3. Workstream 3：Gemini API 完全廃止 → xAI Grok API 一本化

### 方針
- [src/grok_client.js](src/grok_client.js) の `hasXaiKey()`・`completeText()`・`completeJson()` を全 LLM 呼び出しの唯一の入口とする。
- [src/grok_client.js](src/grok_client.js#L102-L144) にオプショナルな一過性エラー再試行（または呼び出し元のリトライヘルパー `completeWithRetry`）を用意し、Grok API 失敗時に Gemini へ逃がさず **Grok 内でリトライ or 安全停止** する。
- **エクスポート互換注意**: Python（`camoufox_runner.py`、`patchright_runner.py`）や `init_profiles.js`、`ai_deliberation_council.js` が `generateUniquePersonaProfileViaGemini` や `analyzeUrlAndMarketViaGemini` のシンボル名で `require` しているため、これら既存の公開関数名はエイリアスとして残し、**内部実装を 100% Grok API（`completeJson` / `completeText`）に切り替える**。

### ファイル別完全移行リスト

1. **[src/next_post_draft.js](src/next_post_draft.js#L3-L55)**
   - `@google/generative-ai` import、`grokShouldFailOver`、`generateWithGemini` を削除。
   - `generateDraft`: `!hasXaiKey()` なら `error.code = 'jit_generation_unavailable'` を throw。`completeText` が `429|5\d\d|timeout|aborted` で失敗した場合は、短い待機（400ms〜800ms）後に 1 回再試行（`quality` がタイムアウト/過負荷時は 1 回だけ `fast` でフォールバック可）し、失敗ログを `qualityAudit` に記録する。

2. **[src/ai_deliberation_council.js](src/ai_deliberation_council.js#L10-L1335)**
   - `GoogleGenerativeAI` import、すべての `GEMINI_API_KEY` 判定、`candidateModels = ['gemini-...']` ループ、L1220 `genAI`、L1326 付近の Gemini 分岐を削除。
   - `runCouncilDeliberation`（L437-670）は `if (!hasXaiKey()) throw new Error('XAI_API_KEYが設定されていません');` とし、L655 の `completeText({ tier: 'quality', prompt: councilPrompt, json: true, temperature: 0.7 })` のみを使用。
   - `generateJitWithRetry`（L1114）を `generateJitWithGrokRetry(promptText, timeoutMs = 30000)` 相当へ刷新し、`completeJson({ tier: 'quality', prompt: promptText, temperature: 0.7, timeoutMs })` を使って一過性エラー時のみリトライする。
   - `generateJitPostContent`（L1167-1333）は `!hasXaiKey()` のみで `jit_generation_unavailable` を投げ、レガシーパス（`!accountState`）も Grok のみで JSON を生成する（不正 JSON・API 失敗は `code = 'jit_generation_failed'` を投げてフェイルクローズ）。

3. **[src/autonomous_promo_ai.js](src/autonomous_promo_ai.js#L1-L1705)**
   - `GoogleGenerativeAI` import と各関数の `GEMINI_API_KEY` / `new GoogleGenerativeAI(...)` をすべて削除（L1、L461、L532、L552-553、L638-642、L715-719、L780-784、L1020-1024、L1098-1102、L1700-1701）。
   - `generateContentPreferred(_unusedModel, prompt, options = {})`（L4-10）は `!hasXaiKey()` 時にエラーを送出し、`completeText({ tier: options.tier || 'quality', prompt, json: true })` のみを実行する。
   - `analyzeUrlAndMarketViaGemini` のエクスポート名は互換のため維持しつつ（または内部名変更 + エイリアス残置）、Grok のみで実行する。

4. **[src/ai_campaign_builder.js](src/ai_campaign_builder.js#L178-L816)**
   - `https` 経由の `discoverWorkingGeminiModels`、`callGeminiJsonSafe`、`generativelanguage.googleapis.com` 呼び出しを全削除。
   - `runGeminiWithAutoDiscovery(_unusedKey, promptText)` を内部ヘルパー `runGrokCampaignJson(promptText)`（＋必要なら旧名の互換ラッパー、全呼出元 L417/556/741/792 を置換）に変更し、`!hasXaiKey()` なら `throw new Error('NO_XAI_KEY')`、真なら `completeJson({ tier: 'quality', prompt: promptText, temperature: 0.85 })` を返す。

5. **[src/meta_prompt_optimizer.js](src/meta_prompt_optimizer.js#L220-L268)**
   - `@google/genai`（`GoogleGenAI`）import と L220/258-267 の Gemini 分岐を削除。`if (forceFallback || !hasXaiKey()) return runHeuristicOptimization(...)` へ整理。

6. **[src/audience_simulation_engine.js](src/audience_simulation_engine.js#L138-L219)**
   - `@google/genai`（`GoogleGenAI`）import と L138/144/194-205 の Gemini 分岐を削除。
   - `evaluationMethod` を `'grok'` に更新（フォールバック時の `'heuristic_fallback'` は維持）。

7. **[src/official_api_client.js](src/official_api_client.js#L862-L918)**
   - `GoogleGenerativeAI` import と `GEMINI_API_KEY` / `gemini-3.8-flash` 分岐を削除し、`hasXaiKey() && mentionText` のとき `completeText({ tier: 'quality', prompt })` のみを呼ぶ。

8. **[src/reply_promo_engine.js](src/reply_promo_engine.js#L241-L294)**
   - `GoogleGenerativeAI` require と `GEMINI_API_KEY` 分岐を削除し、`hasXaiKey()` + `completeText` のみへ簡素化。

9. **[src/persona_engine.js](src/persona_engine.js#L3-L498)**
   - `GoogleGenerativeAI` require と `getGeminiClient()`（L3-11）、`callGeminiStrictJson` 内の Gemini ループ（L216-243）を削除。
   - `callGeminiStrictJson` は `!hasXaiKey()` で明確にエラー（`XAI_API_KEY が .env に設定されていません`）を投げ、Grok のみ実行する。
   - Python（`src/camoufox_runner.py`、`src/patchright_runner.py`）・ワーカー（`src/init_profiles.js`、`src/setup_worker.js`）との互換のため、公開シンボル `generateUniquePersonaProfileViaGemini` はエクスポート維持する。

10. **[src/luxury_web_funnel.js](src/luxury_web_funnel.js#L36-L925)**
    - 未使用の `@google/generative-ai` require（L36-38）を削除。L847 の課金エラー文言や L917/L924 の `'gemini'` 表記・フォールバック値を `'grok'` / `'Grok AI'` に揃える。

11. **[src/landing_page.js](src/landing_page.js#L1188-L1211)**
    - `/api/web-ai-spintax` 内の `GEMINI_API_KEY` / `@google/generative-ai` 分岐を削除し、`hasXaiKey()` での `completeText`（未設定・失敗時は既存の定型フォールバック）のみにする。

12. **運用ワーカー・管理系ファイル**
    - [src/mentor_assist.js](src/mentor_assist.js#L5-L68): `GoogleGenerativeAI` 削除、`hasXaiKey()` のみに統一。
    - [src/official_media_bot.js](src/official_media_bot.js#L6-L310): `GoogleGenerativeAI` 削除、`hasXaiKey()` のみに統一（`!hasXaiKey()` 時は明示エラー）。
    - [src/admin.js](src/admin.js#L26-L370): `GoogleGenerativeAI` と L362-369 の Gemini 画像抽出フォールバックを削除（L348-361 の Grok マルチモーダル抽出のみ利用）。
    - [src/init_profiles.js](src/init_profiles.js#L9-L45): 未使用の `GoogleGenerativeAI` / `genAI` を削除。

### テストファイルの Grok モック化（必須同時修正）
1. **[tests/post_constraint_stop_isolation.test.js](tests/post_constraint_stop_isolation.test.js#L12-L558)**
   - `GEMINI_API_KEY` → `XAI_API_KEY` へ切替。
   - `@google/generative-ai` の `stubModule` を `../src/grok_client` の `stubModule`（`hasXaiKey: () => Boolean(process.env.XAI_API_KEY)`、`completeText` / `completeJson`）へ置換し、`lastModelPrompt` 検証も維持する。
   - L191-215 と L546-557 の「AIキー欠如時に `jit_generation_unavailable` で安全停止」テストが `delete process.env.XAI_API_KEY` で通るよう合わせる。
2. **[tests/autopilot_posting_emulator.test.js](tests/autopilot_posting_emulator.test.js#L70-L575)**
   - `@google/generative-ai` stub を `../src/grok_client` stub に置き換え、`process.env.GEMINI_API_KEY` の保存・復元を `process.env.XAI_API_KEY` に更新する。
3. **[tests/promo_generation_flows_emulator.test.js](tests/promo_generation_flows_emulator.test.js#L13-L71)**
   - `process.env.GEMINI_API_KEY` → `process.env.XAI_API_KEY`、`@google/generative-ai` stub → `../src/grok_client` stub に更新する。
4. 確認コマンド:
   - `grep -rn "GoogleGenerativeAI\|GoogleGenAI\|generativelanguage\|GEMINI_API_KEY" src/ tests/` を実行し、`src/`・`tests/` ともに **0件**（`.py` のログ/変数名以外、実行呼び出しゼロ）を確認する。

---

## 4. Workstream 4：ダッシュボード Step 3「スタート／ストップ」＆ 補充改善

### 現状の照合箇所
- `POST /api/autopilot/toggle-pause`: [src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L1703-L1758)
- `POST /api/autopilot/launch`: [src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L1458-L1460)
- `autoReplenishAllActiveQueues`: [src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L941-L967)
- フロント `startOrStopAutopilot()`: [views/dashboard_view.html](views/dashboard_view.html#L2527-L2558)

### 変更仕様
1. **有料プラン未契約ガード（`POST /api/autopilot/toggle-pause`）**:
   - `!nextPaused`（開始時）に `isPaidAccount(userDoc.data() || {})` を検証し、未契約なら **HTTP 402** を返す：
     ```json
     { "ok": false, "code": "plan_required", "error": "自動運用の開始には有料プラン（14日間無料トライアルを含む）の登録が必要です。" }
     ```
   - URL（有効 `http(s)://`）も `userPrompt` も入力済み・保存済みのどちらにも無い場合は **HTTP 400**（`'宣伝URLまたは育てたいアカウント像を入力してください。'`）を返す。
2. **`/api/autopilot/launch` の URL任意整合（[src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L1458)）**:
   - `if (!targetUrl)` を `if (!/^https?:\/\//i.test(String(targetUrl || '')) && !String(userPrompt || '').trim())` に変更し、URL なし・アカウント像のみの設定とも整合させる。
3. **スタート後の UI 自動ポーリング（[views/dashboard_view.html](views/dashboard_view.html#L2527-L2558)）**:
   - `res.status === 402 || data.code === 'plan_required'` のときはメッセージを出して `togglePlanSection()` を自動で開く。
   - `!autopilotIsPaused`（スタート成功）時は、`loadJobs()` を即時 1 回実行したあと、`pending` ジョブが 1 件以上取得できるまで **5秒間隔・最大36回（3分間）** ポーリングするタイマーを張り、見つかったらタイマー停止＋`#launchMsg` を「予約が入りました」へ更新する（ストップ操作時は既存タイマーを即クリア）。
4. **`autoReplenishAllActiveQueues` の並列・上限引き上げ（[src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L941-L967)）**:
   - 1周期で 1件作っただけで `break` する制約を外し、1周期あたり最大 3〜5顧客まで補充できるよう変更する（タイムアウト防止のため上限件数は設ける）。
5. **（既存テスト保守メモ）**:
   - `recoverStaleProcessingJobs()`（[src/hybrid_saas_routes.js](src/hybrid_saas_routes.js#L979)）の `await doc.ref.set(...)` は、`doc.ref` が無い場合に例外になるため、`if (doc.ref && typeof doc.ref.set === 'function')` ガードを入れれば既存 [tests/autopilot_worker_capacity.test.js](tests/autopilot_worker_capacity.test.js) の無用なクラッシュリスクも下げられる（テスト側のモック仕様は要確認）。

---

## 5. 検証・受け入れ条件（実装完了後に実施）

1. **構文チェック**: 変更した全 `.js` と `views/` 内インライン `<script>` に構文エラーがないこと（`node --check`）。
2. **Gemini 完全除去確認**: `grep -rn "GoogleGenerativeAI\|GoogleGenAI\|generativelanguage\.googleapis\.com\|GEMINI_API_KEY" src/ tests/` が 0 件。
3. **単体テスト一式（Grok モック切替後）**:
   - `node --test` で `operated_accounts`, `billing_cancel`, `stripe_billing_helpers`, `post_constraint_stop_isolation`, `free_experience_and_consent`, `grok_client`, `lp_voice_phase2`, `autopilot_language_and_index_error`, `autopilot_jobs_separation`, `official_api_client_mock`, `phase3_portfolio_verifier`, `stale_processing_recovery`, `growth_phase`, `dashboard_language`, `homepage_v51_copy`, `x_oauth_token_continuity`, `oauth_session_cookie`, `x_connection_consent`, `audience_simulation_engine`, `meta_prompt_optimizer` 等が全件合格。
   - `node scripts/eval_velox_ai.js` 合格。
   - Firestore エミュレータ起動時は `tests/autopilot_posting_emulator.test.js`、`tests/promo_generation_flows_emulator.test.js` も実行して合格。
4. **PM2 反映 ＆ 実機確認**:
   - `pm2 restart x-shop --update-env`
   - トップページ（未ログイン時）で「14日間無料トライアル」押下 → ログイン誘導になること。
   - `/api/funnel/free-experience` が `HTTP 200` で返ること。
   - 社内2アカウントの自動投稿が引き続き正常稼働すること。

---

## 6. コード外の必須手作業（オーナー実施）

1. **Stripe 本番 Webhook 登録**:
   - Stripe ダッシュボードで Endpoint URL `https://veloxpostapp.com/api/webhooks/stripe` を作成し、`checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted` を購読。
   - 発行された `whsec_...` を `.env` の `STRIPE_WEBHOOK_SECRET=` に設定して `pm2 restart x-shop --update-env`。
2. **X Developer Portal の一般公開状態確認 & テスト**:
   - 本番で外部テストアカウント1件を用意し、`.env` の `OFFICIAL_API_EXTRA_HANDLES=<test_handle>` を一時設定のうえ「ログイン→決済→X OAuth 2.0 連携→自動投稿」が通ることを確認。
   - 確認完了後、`.env` に `OFFICIAL_API_ALLOW_PAID_CUSTOMERS=true` を設定して一般公開（`pm2 restart x-shop --update-env`）。
3. **`.env` から `GEMINI_API_KEY` を削除しても全機能が Grok のみで動く最終確認**。
