# VELOX V12-A: Brand-Unique Tension Synthesis, Read-Only Audience Pushback & Control Hook Attribution Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）
- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、API キー、トークン、顧客メール、HQ の `targetUrl`、収集記事の生 URL はログ・ドキュメントへ出力しない。
- 明示指示なく `git commit` / `git push` しない。UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域（厳守）
- 新しい外部調査モジュールや、投稿生成の新しい LLM 呼び出しステップは追加しない（1 投稿あたり呼び出し上限：初期 5 回・外部メモ新規取得時 4 回、待ち 180,000ms を維持）。
- `src/context_radar.js`（`scrubRadarText()`）、`src/source_dossier_engine.js`（`scrubField()`）、`src/outbound_reply_queue.js`、4 分間隔の受信メンション自動返信ロジック自体は増やさない・壊さない。
- `criticSystemRules(false)`（353 字）および V11-A〜E の固定テスト（`v11c` のトレース 1 行・`v11d` の `hookAngleForChoice()` 挙動含む）は V12-A では無変更とする（Critic 刷新は V12-B で実施）。
- 安全線（架空の数字・日時・引用禁止、無断 URL 禁止、公式アカウントの個人日記化禁止、敬体/常体統一、廃止表現禁止、文字数上限、`detectOverflowSplit()`、`computeMaxSimilarity()`）は 100% 維持する。
- 本番アカウントへの `prepareNextPost` は呼ばない。既存の待機予約（あれば）は一切上書きしない。

### コード確定（隔離ドラフト）
一次記事カードは `isolateLpContext` の ring1 / ring2 でしか選ばれない。衝突主張はこの 2 リングで作る。LP 本文は従来どおり渡さない。ブランドの立場だけを短い `tensionSeed` として渡す。`ring3_product_bridge` では衝突主張を作らない。

## 1. 読み取り専用の生の反論・誤解の保持

### 1.1 `src/audience_questions.js`
- 指標同期が `audienceQuestionsCache` を書くとき、質問配列に加えて `pushbacks` を保存する。自動返信は増やさない。
- 数字と引用符は残す。URL、メール、`@` ハンドルだけ除く。1 件は 200 字まで。
- `latestAudiencePushback()` は未保存でも空文字を返す。

### 1.2 `src/topic_source_vault.js`
- 既存のカード抽出 1 回に `commonMyth`（最大 120 字）を足す。追加のクロールも API 呼び出しも無い。
- `commonMyth` が無い過去カードでも、既存の事実項目だけでカードは有効。700 字の外部メモには入れない。

## 2. `briefPrompt()` 内の `tension`

優先順は `audience_pushback`、`article_myth`、`brand_pov`（`rejectedNorm`）。相手が無いときは主張を作らない。

既存 JSON に `tension`、`tensionReversesInput`、`passesBrandSwap` を足す。新しい呼び出しは増やさない。

`sanitizeBriefTension()` は次のとき `tension` を `null` にする。
- `tensionReversesInput` か `passesBrandSwap` が true ではない
- 空である
- `coreFact` または `actionableTakeaway` との 2-gram Jaccard が 0.45 以上
- 主張の中の数字が、反論、一次記事カード、`brandKnowledge`、`editorialStance` のどれにも無い

`briefPrompt()` と `candidatePrompt()` は、反論か一次記事に既にある数字と具体事実を抽象論へ逃がさず核に使う、と1行で指示する。そこに無い数字は作らない。

残った 1 文だけを `candidatePrompt()` の別枠にする。外部メモは事実の棚のまま、700 字の枠は変えない。`tension` が `null` のときはその別枠を出さない。

## 3. `control` とトレース
- `hookAngleForChoice()` は変えない。
- トレースの `selectedHookAngle: drafted.selectedHookAngle || null` は変えない。
- `draftNextPostWithMeta()` の戻り値で、Hook Duel 済みかつ照合が `null` かつ採択が候補 `c` または 3 本目のときだけ `control` にする。
- ジョブと `generation_traces` に `tensionUsed` と `tensionSource` を保存する。

## 4. 検証
- `tests/v12a_brand_unique_tension_and_pushback.test.js`
- 編集した `.js` の `node --check`
- `views/funnel_index.html` と `views/dashboard_view.html` のインライン script を `vm.Script` で検証
- `grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit`
- `x-shop` のみ再起動し、`/` 200、`/?lang=en` 200、`/dashboard` 302、未認証 3 API は 401
- 本番 DB へ書かずに `@VeloxSystemsV4` の条件で `draftNextPostWithMeta()` を 1 回だけ試し、同業入れ替えが可能かを 1 行で判定する
