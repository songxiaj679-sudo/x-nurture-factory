# GROK 実装指示書：X プラン表記の簡素化（名称ズレ解消）＋ `grok-4.7` 遅延解消

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
1. **X プラン表記の誤解解消**：xAI/X 統合請求画面の名称（`Plus / Premium / Super / Ultra`）と X API v2 `subscription_type`（`Basic / Premium / PremiumPlus`）が食い違うため、`X Premium+` 等の細かいティア名表示を廃止し、実機能に即した **「通常プラン / X有料プラン（長文対応）」** へ日英とも統一する。
2. **次投稿生成の 4 分待ち（120 秒タイムアウト連鎖）解消**：`src/grok_client.js` の `tier === 'quality'`（`grok-4.7`）に `reasoning_effort: 'low'` を設定する（未指定だと 12 秒〜120 秒超タイムアウトして毎回 `fast` へフォールバックしていた一方、`reasoning_effort: 'low'` 指定時は約 4.5 秒で応答することを本番 API で実測確認済み）。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` 準拠）

1. **日英混在ゼロ**：`views/dashboard_view.html` の静的テキスト（`L350`）を変える場合は `STATIC_TEXT_I18N.en`（`L1943`）の日本語キー文字を 1 文字も違えず連動更新すること。`data-i18n` キーも `ja` / `en` 両方を揃えること。
2. **`views/funnel_index.html` の禁止語・テスト維持**：既存の文言検査を通すこと。

---

## Workstream A: X プラン表記の簡素化・機能ベース統一

### 対象ファイル
- `src/growth_phase.js`（L91-101）
- `src/profile_checklist.js`（L159）
- `views/dashboard_view.html`（L350, L610, L1304, L1543, L1943, L4969）
- `views/funnel_index.html`（L508, L1842, L2124）
- `tests/simple_autopilot_transparency.test.js`

### 実装要件

1. **`src/growth_phase.js`（L91-101 `formatPlanLabel`）**：
   細かい `X Basic` / `X Premium` / `X Premium+` を廃止し、以下に統一する：
   - `none` / `free` → JA: `'通常プラン'` / EN: `'Standard plan'`
   - `basic` → JA: `'通常プラン（短文枠）'` / EN: `'Standard-length X plan'`
   - `premium` / `premium_plus` / `premiumplus` / `premium+` / `super` / `paid` → JA: `'X有料プラン（長文対応）'` / EN: `'Paid X plan (long posts)'`
   - 未取得（`null`, `undefined`, `unknown` 等）→ JA: `'Xプランは未取得'` / EN: `'X plan not measured'`

2. **`src/profile_checklist.js`（L159）**：
   - `'X Premium をご利用中のため、...'` → `'X有料プランをご利用中のため、固定ポストを入口案内に保ちつつ、特に反応が良かった実用投稿を「ハイライト」にまとめておけます。'`（EN L158 はすでに `'This account is on a paid X plan...'` で統一済み）。

3. **`views/dashboard_view.html`**：
   - **L350（静的HTML）および L1943（`STATIC_TEXT_I18N.en` の完全一致キー）**：
     - `X Premium（有料プラン）` → `X有料プラン（長文対応）`
     - EN 訳（L1943）も `'X Premium uses one longer post'` → `'A paid X plan uses one longer post'` に変更。
   - **L610 / L1304（`profile_guide_highlights` JA）・L1543（EN）**：
     - JA: `'X有料プランでは、重要な投稿をハイライトに置けます。'`
     - EN: `'On a paid X plan, keep important posts in Highlights.'`
   - **L4969（診断サマリー 1 行表示）**：
     - `${isEn ? 'X Premium' : 'X有料プラン'}: ${xLabel}` → `${isEn ? 'Paid X plan' : 'X有料プラン'}: ${xLabel}`

4. **`views/funnel_index.html`（L508, L1842 JA, L2124 EN）**：
   - `spec_c2_desc` 内の `（無料／X Premium）` → `（通常／X有料プラン）`
   - EN（L2124）の `(free or X Premium)` → `(standard or paid X plan)`

---

## Workstream B: `grok-4.7`（`quality`）120 秒ハング解消

### 対象ファイル
- `src/grok_client.js`（L126-139）
- `tests/grok_client.test.js`

### 実装要件
1. `src/grok_client.js` L132 付近（`CHAT_URL` 用リクエスト `body` 組み立て箇所）：
   - 現在：`if (tier === 'nurture') body.reasoning_effort = 'none';`
   - 変更後：
     ```javascript
     if (tier === 'nurture') body.reasoning_effort = 'none';
     else if (tier === 'quality') body.reasoning_effort = (process.env.XAI_REASONING_EFFORT_QUALITY || 'low').trim() || 'low';
     ```
2. テスト追加：
   - `tests/simple_autopilot_transparency.test.js` に、`formatPlanLabel('PremiumPlus', false)` が `'X有料プラン（長文対応）'`、`formatPlanLabel('PremiumPlus', true)` が `'Paid X plan (long posts)'` を返し、`X Premium+` 等のティア名が出ないことを検証追加。
   - `tests/grok_client.test.js` に、グローバル `fetch` モック等で `completeText({ tier: 'quality', prompt: 'hi' })` が `reasoning_effort: 'low'` を送信することを検証追加。

---

## 検証要件（完了報告前に必ず実測確認）

1. `node --check src/growth_phase.js src/profile_checklist.js src/grok_client.js tests/grok_client.test.js tests/simple_autopilot_transparency.test.js`
2. `vm.Script` 構文検査：`views/dashboard_view.html`・`views/funnel_index.html`
3. `node --test --test-force-exit`：関連全テスト（`tests/grok_client.test.js` を加えた計 10 スイート以上すべて pass / 0 fail）
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`/`、`/?lang=en`、`/dashboard`、`pm2 pid x-shop` を確認して報告すること。
