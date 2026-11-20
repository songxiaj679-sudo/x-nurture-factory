# GROK 実装指示書：一般公開前 徹底監査で検出された実バグ一括修正

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
一般公開前チェックで実コード・実 API・ログから検出された、課金セキュリティ・英語決済モーダル・ログインモック・英語デモ・凍結アカウントループの **5 件の実バグ** を修正し、公開品質へ仕上げる。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **日英混在ゼロ**：JA / EN のどちらを選んでも 100% 同じ言語で完結させること。
2. **禁止語・デザイン調和**：`tests/homepage_v51_copy.test.js` の禁止表現を使わず、既存のヘッダー・明るい配色・余白は触らない。

---

## Workstream A（最重要・課金抜け穴防止）: Stripe 解約・失効後に有料利用が継続してしまうバグ修正

### 対象ファイル
- `src/billing_cancel.js`（L36-49 `subscriptionStatePatch`）
- `src/plan_post_budget.js`（L16-20 `isPaidAccount`）
- `tests/billing_cancel.test.js`
- `tests/plan_post_budget.test.js`

### 実装要件
1. `src/billing_cancel.js`（L36-49 `subscriptionStatePatch`）：
   - `const terminated = deleted || ['canceled', 'unpaid', 'incomplete_expired'].includes(String(subscription.status || '').toLowerCase());`
   - `terminated` が `true` のときは、`patch.planStatus = 'cancelled'` に加えて **`patch.tierLevel = 0; patch.planId = 'free'; patch.aiReplyUnlocked = false;`** を設定する。
2. `src/plan_post_budget.js`（L16-20 `isPaidAccount`）：
   - `user.tierLevel >= 1` であっても、`planStatus === 'cancelled'` / `'free'`、または `stripeSubscriptionStatus` が `'canceled'` / `'unpaid'` / `'incomplete_expired'` のときは **`false` を返す**ようにフェイルクローズド化する（ただし既存テスト `isPaidAccount({ tierLevel: 1 })` は `true` を維持する）。
3. `tests/billing_cancel.test.js` と `tests/plan_post_budget.test.js` に、解約済み（`planStatus: 'cancelled', tierLevel: 2` 等）が `isPaidAccount` で `false` になり、`subscriptionStatePatch(..., 'customer.subscription.deleted')` が `tierLevel: 0, planId: 'free', aiReplyUnlocked: false` を返すことを検証追加する。

---

## Workstream B（重要・海外向け登録/決済の日本語残り解消）: `#unlockModal`・`handlePayClick`・Stripe 応答の完全日英対応

### 対象ファイル
- `views/funnel_index.html`（L834-873, L1006-1075, `I18N_LANDING.ja` / `.en`）
- `public/funnel/funnel_client.js`（L2323-2401 `choosePlan`）
- `src/shop.js`（L2597, L4486-4495）

### 実装要件
1. `#unlockModal`（`views/funnel_index.html` L834-873）：
   - 箇条書きの固定日本語（`✓ X公式API連携` / `✓ 登録ページやアカウント像をもとに次の1本を作成` / `✓ AI投稿案の作成・レビュー`）とボタン初期ラベル（`Solo Starter を選択` 等）すべてに `data-i18n` を付与し、`I18N_LANDING.ja` と `I18N_LANDING.en` の両方を定義する。
2. `handlePayClick`（`views/funnel_index.html` L1006-1075）：
   - `currentLandingLang === 'en'` に応じて、遷移中文言（`⏳ Redirecting to Stripe Checkout...` / `⏳ Stripe決済画面へ移動中...`）、失敗アラート（`Checkout preparation failed:` / `決済の準備に失敗しました:`）、通信エラー（`Network error:` / `通信エラーが発生しました:`）を完全に JA / EN 分岐させる。
3. `public/funnel/funnel_client.js`（L2329 `choosePlan`）：
   - `var isEn = (typeof currentLandingLang !== 'undefined') ? currentLandingLang === 'en' : (localStorage.getItem('velox_lang') === 'en');` へ修正し、言語切替直後に古い `localStorage` で誤判定しないようにする。
4. `src/shop.js`（L2597, L4488-4493）：
   - `POST /api/billing/create-checkout` の `401 login_required` エラー（L4491）を `req.body.lang === 'en'` のとき英語（`'Please sign in with Google or email first to start your 14-day free trial.'`）で返す。
   - `/dashboard` の `?payment=success` 完了メッセージ（L2597）も `isEn` で英語対応にする。

---

## Workstream C（UX 信頼性修正）: `#authModal` の永久ローディング風モック撤去 ＋ メール登録/ログイン日英統一 ＋ 旧用語 `Cockpit` 除去

### 対象ファイル
- `views/funnel_index.html`（L801-805）
- `public/funnel/funnel_client.js`（L1887-1980, L2942）
- `src/luxury_web_funnel.js`（L108-211）

### 実装要件
1. `views/funnel_index.html`（L801-805）：
   - `#captchaWrap`（`<!-- ボット検知 (Cloudflare Turnstile モックアップ表示用) -->` と永久にぐるぐる/待機中のように見える `人間による操作であることを確認しています...` ボックス）は動作しないモックのため削除する（`I18N_LANDING` に参照チェックがあれば確認し、未使用キー整理またはテストと整合させる）。
2. `public/funnel/funnel_client.js`（L1887-1980, L2942）：
   - `switchAuthTab` L1901 / L1907 の `"Continue to Cockpit"` / `"Log In to Cockpit"` を `"Continue to VELOX AI"` / `"Log In to VELOX AI"` へ改め、`submitAuthForm` の `/api/funnel/register`・`/api/funnel/login` 送信ボディに `lang: isEn ? 'en' : 'ja'` を含める。さらにバリデーション（メール不正・パスワード8文字未満・不一致・通信中・成功/失敗トースト）と L2942 のセッション警告を `isEn`（`currentLandingLang === 'en'`）で完全 JA / EN 切替にする（`"VeloxPost Cockpit"` 等も `"VELOX AI"` に統一）。
3. `src/luxury_web_funnel.js`（L108-211 `/api/funnel/register`, `/api/funnel/login`）：
   - `req.body.lang === 'en'` / `velox_lang` に応じて JA / EN エラー文を返す。
   - パスワード最低文字数をフロント側（L1920）と揃えて **8文字以上** に統一する。

---

## Workstream D（海外デモ体験）: 英語トップページ（`?lang=en`）でのライブデモ初期値・事実出力の英語対応

### 対象ファイル
- `views/funnel_index.html`（L467, L471, `selectSiteLanguage`）
- `src/lp_knowledge_extractor.js`（L219-277 `extractBrandKnowledge`）
- `src/luxury_web_funnel.js`（L305-320）

### 実装要件
1. `views/funnel_index.html`：
   - ユーザーがまだ入力欄（`#demoXUsername`・`#demoTargetUrl`）を手編集していない状態に限り、`selectSiteLanguage('en')` 時は `@VeloxSystemsHQ` / `https://veloxpostapp.com/?lang=en`、`selectSiteLanguage('ja')` 時は `@VeloxSystemsV4` / `https://veloxpostapp.com` をセットする。
2. `src/lp_knowledge_extractor.js`（L219-277） & `src/luxury_web_funnel.js`（L307）：
   - `extractBrandKnowledge(targetUrl, options = {})` で `options.outputLang === 'en'` が渡されたときは（キャッシュキーにも `outputLang` を含め）、`completeJson` へ **「URLページに記載された事実だけを根拠に、claims / audiences / pricing / constraints を自然な英語で整理すること（ページに無い数値や誇張は作らない）」** と指示し、`lang: 'en'` のライブデモ結果画面に日本語の箇条書きが混ざらないようにする（既存テスト `tests/lp_voice_phase2.test.js` 等が `outputLang` 未指定で従来通り通ることを確認）。

---

## Workstream E（運用保護・ログ健全化）: 凍結済み X アカウントの 2 分ループ自動停止

### 対象ファイル
- `src/official_api_client.js`（L1131 付近またはメトリクス同期ループ呼び出し側）
- `src/autonomous_promo_ai.js`（`selfCorrection` / `harvestTweetMetricsAndEvolveKnowledge`）

### 実装要件
- X 公式 API が `'The user used for authentication is suspended'`（HTTP 403 等）を返したユーザーは、同じエラーを毎 2 分出し続けないよう、該当ユーザードキュメントへ `autopilotPaused: true`・`xLinkHealthStatus: 'suspended'`（または `relinkRequired: true`）を保存し、定期バッチ側で次回以降スキップする。

---

## 検証要件（完了報告前に必ず実測確認）

1. `node --check`（変更したすべての `.js` ファイル）
2. `vm.Script` 構文検査：`views/funnel_index.html`（2 本）、`views/dashboard_view.html`（1 本）
3. `node --test --test-force-exit`：関連全スイート（`tests/billing_cancel.test.js`・`tests/plan_post_budget.test.js`・`tests/lp_voice_phase2.test.js` を含む計 13 スイート以上すべて pass / 0 fail）
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`/`、`/?lang=en`、`POST /api/funnel/free-experience`（`lang: 'en'` で `@VeloxSystemsHQ` ＋ `https://veloxpostapp.com/?lang=en` が日本語混入なし JSON で返ること）、`/api/auth/google`（302）を `curl` 実測して PID と結果を報告すること。
