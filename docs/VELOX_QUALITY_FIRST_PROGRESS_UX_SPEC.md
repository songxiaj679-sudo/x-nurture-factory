# GROK 実装仕様書：品質最優先モデル維持（`grok-4.7` 十分な推論枠）＋「止まって見えない」待機UX強化

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
ユーザー方針（**「クオリティ高い投稿作るためなら時間かけたっていい。止まったと思われなければいい。さっさとインスタントに出てくる文章に価値はない」**）に基づき、現在 `PID 2276682` で導入された **段階進捗（`60%→74%→86%→92%→96%→100%`）と `uiLang` 完全分離を維持したまま**、`brief` / `candidates` / `repair` の品質妥協（`fast`/`nurture` 降格と 45秒打切り）を撤回し、**真剣に作っている過程が見える誠実な進捗UX** へ仕上げる。

---

## 🔍 現状コード（`PID 2276682`）の課題 4点

1. **`src/next_post_draft.js` L486（`candidates` の 45秒打切り）**:
   - 前回の本番実測（`@VeloxSystemsV4`）で `grok-4.7` の候補生成は **`71.9秒`** で成功していた。現行の `Math.min(timeoutMs, 45000)` では 46秒以上考える高品質生成を途中で中断し、`fast`（`grok-4.20-0309-non-reasoning`・インスタント文）へ落としてしまう。
2. **`src/next_post_draft.js` L465（`brief` の `fast` 化）＆ L558（`repair` の `nurture` 化）**:
   - `brief` は投稿の核となる `everydayAssumption` / `underlyingMechanism` を組み立てる工程だが `fast` に落とされている。
   - `repair` は `critic` で 72点未満だったときに「構造と対比・仕組みを深く直し切る」工程だが、`reasoning_effort: 'none'` の `nurture`（上限25秒）に落とされている。
   - 一方、LP上の無料体験デモ（`src/luxury_web_funnel.js` L392-398）は明示的に `tier: 'fast', timeoutMs: 18000` / `tier: 'quality', timeoutMs: 20000` を渡しているため、`Math.min(timeoutMs, ...)` により従来の高速性は維持できる。
3. **`src/autonomous_promo_ai.js` L2880-2885（`draft_candidates` / `draft_critic` / `draft_repair` の `detail` が空文字 `''`）**:
   - `detail` が空文字のため、`views/dashboard_view.html` L2929（`if (subDisp && subStatus) subDisp.innerText = subStatus;`）が直前ステップの文言を残したままになり、60〜90秒の深い推論中に「今なにを真剣に確認しているのか」が画面に伝わらない。
4. **`src/hybrid_saas_routes.js` L1911（多重起動ガード `elapsedSec < 120`）**:
   - 品質優先で 120〜180秒かかる正常稼働中に再クリックされると別実行と競合するため、`240` 秒へ戻す必要がある。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **日英UI完全分離の維持**:
   - `uiLang`（画面言語）と `lang` / `aiTargetLang`（X投稿生成言語）の分離、および `customerFacingReason` の日本語混入防止は現行どおり維持する。
   - 新たに追加するすべての `stepDetail`・安心メッセージは **必ず JA / EN 両方** 用意し、`isEnProgress` / `checkIsEn()` で出し分ける。
2. **LP無料体験（`/api/funnel/free-experience`）への影響ゼロ**:
   - `src/luxury_web_funnel.js` から渡される明示的な `tier` / `timeoutMs`（18s/20s）は `Math.min(timeoutMs, ...)` によりそのまま尊重し、トップページデモが遅くならないようにする。

---

## 実装仕様

### 1. `src/next_post_draft.js` — 品質モデル（`quality`）と十分な推論時間の確保

1. **デフォルト `timeoutMs` 復元（L27, L28, L414）**:
   - `generateDraft`（L27-28）と `draftNextPostWithMeta`（L414）のデフォルト `timeoutMs` を **`95000`**（95秒）、`retryTimeout` の既定上限を `Math.min(options.timeoutMs || 95000, 30000)` に戻す（明示的に `options.retryTimeoutMs` が渡された場合はそれを優先）。
   - ※ `brief` 等での無限ハング防止と、95秒超での確実なフォールバックを両立する。
2. **`brief`（L462-470）**:
   - `tier: tier`（呼び出し元が `'quality'` のときは `grok-4.7`、`'fast'` の無料体験初回は `'fast'` のまま）に戻し、`timeoutMs: Math.min(timeoutMs, 45000)`、`retryTimeoutMs: Math.min(timeoutMs, 20000)` とする。
3. **`candidates`（L484-490）**:
   - `tier` のまま、**`timeoutMs: Math.min(timeoutMs, 95000)`**（`71.9秒` 等が途中で切れない十分な推論枠）、`retryTimeoutMs: Math.min(timeoutMs, 30000)` とする。
4. **`critic`（L505-511）**:
   - 採点専用のため `tier: tier === 'fast' ? 'fast' : 'nurture'`（実測約3秒）のまま、`timeoutMs: Math.min(timeoutMs, 25000)`、`retryTimeoutMs: Math.min(timeoutMs, 15000)` とする。
5. **`repair`（L555-564）**:
   - `tier: tier === 'fast' ? 'fast' : tier`（本番運用の `'quality'` 指定時は **`grok-4.7`** で構造・仕組みまで妥協なく修正する）、**`timeoutMs: Math.min(timeoutMs, 90000)`**、`retryTimeoutMs: Math.min(timeoutMs, 25000)` に戻す。

---

### 2. `src/autonomous_promo_ai.js` — 「真剣に作っている」内容が伝わる各段階の説明文

`prepareNextPost`（L2863-2886）および `saving`（L3039-3043）の `report(...)` について、空文字 `''` をやめ、現在どの品質チェックを行っているか正直に伝える `detail` を渡す（日英完全対応）:

- `draft_brief`（L2867-2871）: 現行どおり `customerReason` を表示。
- `draft_candidates`（L2880）:
  - EN: `'Writing multiple distinct angles from verified page facts, recent reactions, and your voice (quality model may take 30–90s).'`
  - JA: `'ページの事実・過去反応・文体を照合しながら、切り口の異なる複数案を推論モデルで深く練っています（30〜90秒ほどかかることがあります）。'`
- `draft_critic`（L2882）:
  - EN: `'Scoring originality, causal depth, factual grounding, and fit with recent posts to select the strongest draft.'`
  - JA: `'表面的な一般論や過去投稿との重複がないか、事実の正確さと独自性を1案ずつ審査しています。'`
- `draft_repair`（L2884）:
  - EN: `'Refining the draft logic, structure, and length limits with full quality reasoning before saving.'`
  - JA: `'審査基準を満たすまで、因果の具体性と文字数・規約条件を高精度モデルで磨き直しています。'`
- `saving`（L3040-3042）:
  - 現行 `${zone} / ${timeSlot}`（例: `America/New_York / morning`）を維持。

---

### 3. `src/hybrid_saas_routes.js` — 品質生成時間に合わせた重複起動ロック復元

- `POST /api/autopilot/launch`（L1911）:
  `if (elapsedSec < 120)` → **`if (elapsedSec < 240)`** に戻し、120〜180秒の本気生成中に再実行が衝突しないようにする。

---

### 4. `views/dashboard_view.html` — 深い推論中に「止まった」と感じさせない表示改善

`startPollingLaunchStatus`（L3053-3064）において、`st.status === 'running'` の間のサブ文言と状態表示を改善する（フェイクの進捗バーやフェイクログは一切作らない）:

1. `st.elapsedSec >= 90` のときは既存メッセージに品質優先である旨を自然な1文で示す：
   - EN: `'Crafting carefully for post quality. You can close this modal—preparation continues in the background and appears in the list once ready.'`
   - JA: `'品質を優先して丁寧に推敲しています（完了まであと少し）。閉じても裏で続き、完成すると予約一覧に出ます。'`
2. `st.elapsedSec >= 30 && st.elapsedSec < 90` かつ `st.stepDetail` があるときは、`st.stepDetail` の末尾に待機目安を控えめに添えてもよい（または `st.stepDetail` が上記の丁寧な説明文へ毎段階切り替わるため、`sub = st.stepDetail` をそのまま表示しつつ、バッジ表記 `aiCouncilBadgeText` をそのまま明確に保ち、`elapsedSec` タイマーと合わせて稼働中であることが一目で分かるようにする）。
3. ※ 必ず `setAiCouncilProgress(pct, st.stepTitle || ..., sub)` の引数順・`subDisp` 更新を維持し、空文字で上書きされないよう `sub` を常時意味のある文にする。

---

## テスト・検証要件

1. **`tests/launch_progress_and_uilang.test.js` の更新**:
   - L53-57 のアサーションを品質優先構成へ更新する：
     - `calls.map(call => call.tier)` が `['quality', 'quality', 'nurture', 'quality']` であること（`tier: 'quality'` 指定時）
     - `calls[0].timeoutMs <= 45000`、`calls[1].timeoutMs <= 95000`、`calls[2].timeoutMs <= 25000`、`calls[3].timeoutMs <= 90000` であること
     - `tier: 'fast', timeoutMs: 18000` のような無料体験呼出しでは `calls` がすべて `'fast'`・`<= 18000` のままであることも1件テスト追加する
     - `prepareNextPost` または出力文言（JA/EN）で `draft_candidates` / `draft_critic` / `draft_repair` の `detail` が空文字でないことも検証する
2. **必須検証コマンド（最終編集後すべて実行）**:
   - 編集した全 `.js` ファイルの `node --check`
   - `views/dashboard_view.html` と `views/funnel_index.html` の全インライン `<script>` への `vm.Script` 構文チェック
   - `tests/launch_progress_and_uilang.test.js` を含む指定19スイートの `node --test --test-force-exit` 全件成功（fail 0 / skip 0）
   - `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後、2秒待って `GET /` (200)・`GET /?lang=en` (200)・`GET /dashboard` (302) 確認
