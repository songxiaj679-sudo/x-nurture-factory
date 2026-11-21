# VELOX V8-D.1: Outbound Account-Aware Limits & Strategic Reply Tactics Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）
- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、アカウント名、ハンドル、本文、URL はログ・レスポンス・ドキュメントへ一切出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語（`checkIsEn()` / `uiLang` 等）と本文言語（`aiTargetLang` / `outputLang` / `replyLanguage()`）を混ぜない。
- 廃止表現を UI や API 文言に戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域（厳守）
- 受信メンション経路の 3 呼び出し元（自動送信・候補整理・手動送信）の `replyPassesSafety()` 挙動（デフォルト 280 字・boolean 返却）は一切変更しない。
- 外向け返信の合格点（72 / 14 / 12）、承認フロー（`pending_approval` / `held`）、日次送信上限、1 候補 1 本構造（2 段返信は Phase 2 の V8-D.2 で実施）は変更しない。
- 通常投稿パイプライン（`next_post_draft.js` / `editorial_archetypes.js` / `llm_router.js` / `visual_card.js` / `bandit_optimization_engine.js`）は無変更とする。
- 本番アカウントへの `prepareNextPost` は呼ばない。待機中の予約ジョブは一切上書きしない。

---

## 1. アカウント課金状態の取得と候補保存（`src/outbound_reply_queue.js` および探索・承認送信経路）

- 外向け探索処理（認証情報復号済み）で、自社投稿と同じ `fetchMyAccountState()` → `describeAccountState()` を呼び出し、`subscription`（`premium` / `free` / `unknown`）を取得する。
- 取得失敗・欠損時は `unknown` として扱い、非 Premium と同じ安全側（短い上限）へ倒す。
- 言語（`ja` / `en`）と `subscription` から外向け専用の上限・目安を算出する（自社投稿の Premium 上限 JA 900 / EN 1500 は他人のリプ欄には使わない）:

| `subscription` | 言語 | プロンプト目安（`targetChars`） | 物理・安全上限（`maxChars`） |
| --- | --- | --- | --- |
| `free` / `unknown` | `ja` | **120 字** | **140 字** |
| `free` / `unknown` | `en` | **220 字** | **270 字** |
| `premium` | `ja` | **320 字** | **420 字** |
| `premium` | `en` | **420 字** | **550 字** |

- 候補ドキュメントへ `accountSubscription`（`premium` / `free` / `unknown`）および外向け用 `maxChars` を保存する。
- 承認時の送信および監査は、固定の `subscription: 'premium', maxChars: 280` を廃止し、候補に保存された `accountSubscription` と `maxChars` を使う（保存値がない過去候補は `unknown` 扱いとして非 Premium 言語別上限へ安全側に倒す）。

---

## 2. `replyPassesSafety()` の第 3 引数拡張（`src/auto_reply_policy.js` / `src/outbound_reply_queue.js`）

- `replyPassesSafety(text, ngTopics, maxChars = 280)` とし、第 3 引数 `maxChars`（省略時 `280`）を追加する。戻り値型（boolean）および他の判定順（8 字未満・URL・定型煽り・NG 話題）は一切変えない。
- 受信メンションの 3 呼び出し元は第 3 引数を渡さない（現行どおり 280 字で完全維持）。
- 外向け返信の 3 箇所（生成前チェック、超過時 `unsafe:too_long` コード判定、承認送信時チェック）だけ、上記テーブルで算出したアカウント別 `maxChars` を渡す。

---

## 3. アカウント別文字数案内・短縮リトライ・戦略リプライ 3 戦術（`src/outbound_reply_queue.js`）

- `composeOutboundReply()` の日英プロンプトを以下へ更新する:
  1. **アカウント別目安**: V8-C.6 の固定「180 字以内」を廃止し、上記テーブルの `targetChars`（非 Premium: JA 120 / EN 220、Premium: JA 320 / EN 420）以内で書くよう案内する。
  2. **戦略リプライ 3 戦術の自律選択**: 単なる感想・お世辞・定型同調ではなく、相手の投稿内容に合わせて次の 3 つの狙いから最も返信や会話が生まれやすい 1 つを自律選択する:
     - **実務の補足（Add-One）**: 相手の話に同意しつつ、現場で効く具体ポイントや注意点を 1 つだけ足す。
     - **視点のずらし（Gentle Angle）**: 否定せず、別の角度から見たときの気づきを 1 つ置く。
     - **経験共有＋軽い確認（Peer Check）**: 関連する実体験・観測を 1 文添え、相手が返しやすい軽い一言で結ぶ（詰問・宣伝は厳禁）。
- **1 回短縮リトライの連動**: 初回生成がアカウント別 `maxChars` を超えた場合のみ、同じ経路内で `targetChars` 以内に収まるよう **1 回だけ** 短く書き直す。2 回目も `maxChars` を超えた場合は現行どおり `unsafe:too_long` で不採用にし、`[Outbound Drop]` を出力する。

---

## 4. 検証手順（必須チェック）

1. **既存テスト更新・新規テスト追加**
   - `tests/v8c6_outbound_length_guard.test.js` の 180 字固定文字列をアカウント別 `targetChars` / `maxChars` 仕様へ更新する。
   - `tests/v8c5_outbound_unsafe_diagnostics.test.js`（デフォルト 280 字・281 字 `unsafe:too_long`・boolean 返却）がそのまま通ることを確認する。
   - `tests/v8d1_outbound_account_limits_and_tactics.test.js` を追加し、以下を検証する:
     - `replyPassesSafety()` が第 3 引数省略時は 280 字、指定時は指定上限（140 / 270 / 420 / 550）で正しく判定すること
     - 非 Premium / `unknown` の日本語は 140 字超で 1 回短縮リトライが走り、120 字目安の指示が入ること（160 字が素通りしないこと）
     - Premium の日本語は 280 字超〜420 字以内が `unsafe:too_long` にならず通過し、421 字以上で短縮リトライに入ること
     - 候補に `accountSubscription` と `maxChars` が保存され、承認送信時監査にも固定 `premium / 280` ではなく実アカウント値が渡ること
     - 日英プロンプトに戦略リプライ 3 戦術（補足 / 別視点 / 経験共有）が含まれること
2. **構文チェック（編集した `.js` を 1 ファイルずつ）** とインライン `<script>` の `vm.Script` 検証。
3. **全スイート実行**（`grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit`、必要時のみ隔離テスト単体再実行）。
4. **`x-shop` のみ再起動**、`127.0.0.1:3001` の `curl` 確認（`/` 200、`/?lang=en` 200、`/dashboard` 302、未認証 3 API は 401）。
5. **待機予約の保護確認**（`@VeloxSystemsHQ` と `@VeloxSystemsV4` の `pending` 予約が未変更であること）。
