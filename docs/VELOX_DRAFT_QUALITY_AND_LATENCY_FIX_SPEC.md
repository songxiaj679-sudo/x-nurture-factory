# GROK 実装仕様書（仕上げ修正）：`lecture_question` 誤判定解消・1投稿内重複遮断・無料デモ 524 圏内レイテンシ短縮

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
PID `2212905` の実機 `curl` 検証および PM2 エラーログ精査で検出された、**「`APIの遅延と再試行` の 55秒超タイムアウト／HTTP 422」「`@VeloxSystemsV4` の 128.2秒（Cloudflare 100秒 524 上限超過）」「V4 実出力内の同一フレーズ2回重複」** の 3点をピンポイントで解消し、安定して 15〜30秒台・失敗ゼロで高品質な投稿が出る状態へ仕上げる。

---

## 🔍 実測で検出された原因（すべて実コード・実ログで確認済み）

1. **`src/next_post_draft.js` L288-294 `closesAsLectureQuestion` の過剰リジェクト**:
   - `/(?:か|ますか)。\s*$/` が「〜ますか。」だけでなく、「わずか。」「確か。」「いくつか。」「なぜ〜のか。」などの非疑問文まで `lecture_question` として落としている。
   - さらに `(Array.isArray(tweets) ? tweets : []).some(...)` のため、2本ツリーの **1本目のフック（問題提起の「？」）** まで全リジェクトしていた。
   - 結果、`x-shop-error-2.log` で `[NextPostDraft Rejected] reasons=..., lecture_question` が連発し、`free-experience` が `fast`（25秒失敗）→ `quality` 再試行へ落ちて **55秒〜128.2秒（Cloudflare 524 発生圏）** を引き起こした。
   - また L531 の `!finalAudit.ok || closesAsLectureQuestion(...)` で `closesAsLectureQuestion` が落ちた場合に `reasons` 配列へ `'lecture_question'` が入っていない。
2. **`maxChars: 140`（2本ツリー）の文字数・未登録数字の落とし穴**:
   - `src/next_post_draft.js` L316 の `safeTarget` が `bodyLimit - 8`（`132`字）と 140文字ギリギリなため、`shape_mismatch` が頻発（`x-shop-error-2.log` で確認）。
   - 「API の遅延と再試行」のように技術分野の文脈でモデルが例示の「`429`」「`95`（%）」を自然に出した際、`verifyNumericGrounding` に `ungrounded_number:429` / `95` で落ち、1回目の422・長時間化につながった。
3. **長文1本（900字枠）での「同一投稿内フレーズ重複」**:
   - 実測 `curl`（`@VeloxSystemsV4` 21.2秒 HTTP 200）の本文末尾付近で、**「継続的な質の高い発信を成立させます。」が1投稿内に2回重複出現** した。現在の `draft_verifier.js` に「同一投稿内の重複文検出」がないためスルーされている。
4. **`src/draft_verifier.js` L8 `SLOP` の広すぎる一般語**:
   - `は明らかだ|が見えてくる|どう考えますか` までハードコード正規表現 `SLOP` に入っており、通常の解説文でも誤爆しうる（`は明らかだ` や `が見えてくる` は汎用日本語として技術文でも頻出）。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **既存テスト互換 100% 維持**：`tests/editorial_lexicon_engine.test.js`, `tests/editorial_intelligence.test.js`, `tests/velox_polish_and_scaling.test.js`, `tests/autonomous_evolution_core.test.js` 等、指定16スイートを最終編集後に**全件**通過させること。
2. **日英分離・数値捏造禁止**：`verifyNumericGrounding` の数値検証自体は絶対に緩めない（例示数字を出さず概念語で書くようプロンプト側を賢くする）。

---

## Workstream A: `closesAsLectureQuestion` の精密化 ＋ `SLOP` 誤爆防止

### 1. `src/next_post_draft.js`（L288-294, L530-537）
- `closesAsLectureQuestion(tweets, decision)`:
  - 検査対象は **「投稿全体（スレッドの最後のツイート `tweets[tweets.length - 1]`）」のみ** に限定し、2本スレッドの1本目フックの疑問符は許容する。
  - 正規表現から危険な単独 `か。` を外し、明確な疑問終止のみを判定する：
    ```js
    function closesAsLectureQuestion(tweets, decision) {
      if (!decision || decision.endingMove === 'genuine_tension') return false;
      const rows = Array.isArray(tweets) ? tweets.filter(Boolean) : [];
      const last = String(rows[rows.length - 1] || '').trim();
      if (!last) return false;
      return /[?？]\s*$/.test(last) || /(?:ますか|でしょうか|ませんか|ですか|だろうか)。\s*$/.test(last);
    }
    ```
  - L531-533 の拒否ログでは、`closesAsLectureQuestion(guarded.tweets, decision)` が真なら `reasons` へ `'lecture_question'` を必ず含める。

### 2. `src/draft_verifier.js`（L8 `SLOP`）
- `は明らかだ`・`が見えてくる`・`どう考えますか` をハード正規表現 `SLOP` から外し、誤爆しない定型AIスロップ・明確な講師テンプレ質問のみに絞る：
  `いかがでしたでしょうか|必見です|について解説します|ゲームチェンジャー|game-changer|unlock the power|delve into|in today's fast-paced|深掘りします|保存必須|知っておくべき\d+選|let's break this down|here's why that matters|何が変わると感じますか|仕組みがここにある|これが核心だ|どのように活用|What changes for your team|the mechanism is right here`
- （※ `tests/editorial_intelligence.test.js` の `深掘りします` と `Let's break this down` は引き続き遮断されること）。

---

## Workstream B: 同一投稿内の自己反復（重複文）遮断 ＆ 文字数・例示数値コントロール

### 1. `src/draft_verifier.js`（`runDeterministicAudit`）
- 同一投稿内の文重複を検出する軽量チェック `hasInternalSentenceRepetition(tweets, lang)` を追加する：
  - 各ツイート文字列を句点・改行・ピリオド `[。\n.!?！？]+` で文分割し、長さが 日本語18文字以上（英語40文字以上）の文が2つ以上あるとき、同じツイート内または同一スレッドの2文間で既存の `grams` + `jaccard` 類似度が **`>= 0.58`** になるペアがあれば `reasons.push('duplicate_sentence_in_post')` で落とす。
  - これにより、長文投稿で同じ主張句（「〜継続的な質の高い発信を成立させます」等）を2回繰り返す現象や、スレッド2本目での丸被り言い換えを確実に止められる。
  - （※ `phase3_portfolio_verifier.test.js` や `editorial_intelligence.test.js` の正常な短文・2本ツリーテストが誤爆しないよう、`18文字未満` の短い句は対象外とし、閾値 `0.58` で実質重複のみ捕捉すること）。

### 2. `src/next_post_draft.js`（`candidatePrompt` L313-352, `repairHint` L490-499）
- **`bodyLimit <= 140` 時の文字数余裕**：`safeTarget = bodyLimit <= 140 ? bodyLimit - 24 : Math.min(bodyLimit - 20, 380)` に改め、140文字スレッドでの `shape_mismatch` リジェクトを防ぐ。
- **長文時の引き伸ばし・重複禁止**：`bodyLimit > 300` のときも無理に引き伸ばさず「2〜4文で論旨が言い切れたらそこで止めること。同じ結論やフレーズを1投稿内で二度繰り返さないこと」を JA / EN 両方の `candidatePrompt` に明記する。
- **技術・汎用ドメインでの未登録数値回避**：「入力されたページや指示文に無いステータスコード（429 等）や割合（95% 等）など固有の数字は書かず、『レート制限応答』『高負荷時』のように概念語へ置き換えること」を `candidatePrompt` と `repairHint`（`ungrounded_number:` 発生時）へ明記する。
- `duplicate_sentence_in_post` 用の明確な修復ヒントを `repairHint` に追加する。

---

## Workstream C: `POST /api/funnel/free-experience` の Cloudflare 100秒タイムアウト（524）回避

### 対象: `src/luxury_web_funnel.js`（L390-401）
- 本番ドメインは Cloudflare 経由（100秒で HTTP 524 強制切断）のため、初回 `fast` パスの `timeoutMs` を `18000`、フォールバック `quality` 側を `20000` に抑え、もし `fast` が制約エラーになっても合計時間が 100秒を大きく下回るようにする（かつ `closesAsLectureQuestion` と `safeTarget` 改善で初回 `fast` 一発通過率を上げる）。
- また `luxury_web_funnel.js` で `tier: 'quality'` フォールバックを呼ぶ前にすでに `fast` と合わせて60秒以上経過しないよう、フォールバック実行時は `draftNextPostText({ ..., tier: 'fast', timeoutMs: 20000, rethinkFeedback: ... })` または `tier: 'quality', timeoutMs: 20000` を安全上限内に保つこと。

---

## Workstream D（PID `2218817` 検証後の追加ピンポイント修正）: 140字スレッド初回リジェクト後の修復成功率向上

- **根拠**：PID `2218817` 実測で、`V4`（20.06秒）と `HQ`（12.84秒）は高速通過したが、`APIの遅延と再試行`（140字スレッド）は初回 55秒タイムアウト（再実行は 19.39秒 HTTP 200・137字/123字）となり、`x-shop-error-2.log` 末尾に `shape_mismatch` と `compliance:claim_needs_evidence` が記録された。
- **対象**：`src/next_post_draft.js`（L502-512 `repairHint`）
- **実装要件**：
  1. `reasons.includes('shape_mismatch')` のとき、`repairHint` に **`CRITICAL: Each tweet exceeded ${accountState?.maxChars || 140} characters or exceeded ${shape.count} tweet(s). Compress every tweet to under ${Math.max(50, (accountState?.maxChars || 140) - 24)} characters (at most 2 short sentences per tweet).`** を追加する。
  2. `reasons.some(r => String(r).startsWith('compliance:claim_needs_evidence'))` のとき、`repairHint` に **`Remove absolute or superlative claim words such as 唯一 / 必ず / 絶対 / 確実 / No.1 / always / guarantee.`** を追加する。
  3. 同様に `tests/editorial_intelligence.test.js` へ `shape_mismatch` 発生時に `repairHint` が最大文字数未満への圧縮指示を含む検証を 1件追加する。

---

## 検証要件（最終編集後にすべて実測）

1. `node --check`: `src/next_post_draft.js`, `src/draft_verifier.js`, `src/luxury_web_funnel.js`, および更新テストファイル。
2. `node --test --test-force-exit`:
   - 新規/追加テスト（`closesAsLectureQuestion` が「わずか。」を誤爆せず・スレッド1本目の疑問を許し・最終文の「〜でしょうか。」「？」だけ止めること、`hasInternalSentenceRepetition` が同一投稿内の重複文を検出し通常文は通すこと）
   - 指定 **全16スイート**（途中で一部だけ再実行するのではなく、**最終編集後に全16スイートを一括実行**して全件パス確認）。
3. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後、本番 `POST /api/funnel/free-experience` で：
   - ① 日本語 `@VeloxSystemsV4`（`time_total` が大幅短縮し、同一フレーズ2回重複がないこと）
   - ② 英語 `@VeloxSystemsHQ`（2本ツリー、日本語ゼロ、2本目が反復でないこと）
   - ③ 専門テーマ `"APIの遅延と再試行の設計について、仕組みが腑に落ちる解説"`（初回で HTTP 200、タイムアウトや 422 にならないこと）
   の 3件を実測し、レスポンス時間（秒）と HTTP ステータス・本文内容をそのまま報告すること。
