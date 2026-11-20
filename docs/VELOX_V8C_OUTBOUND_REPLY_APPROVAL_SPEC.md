# VELOX V8-C: Outbound Reply Discovery, Quality Gate & Human Approval Queue Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` はログ・レスポンス・ドキュメントへ出力しない。
- 明示指示がない限り `git commit` / `git push` は行わない。
- UI 言語（`checkIsEn()` / `currentLang` / `uiLang` / cookie `velox_lang` / `resolveUiLang()`）と、投稿・返信本文の言語（`aiTargetLang` / `outputLang` / `replyLanguage()`）を混ぜない。
- 廃止表現（7名、合議制、凍結リスクゼロ、バズ保証、98.4%、9割、月100時間、3.2倍、3.4倍、シャドウバン）を UI や API 文言に戻さない。
- `X_MEDIA_WRITE_ENABLED` は変更しない。
- 他の pm2 アプリは停止・削除しない（再起動対象は `x-shop` のみ）。

### 触ってはいけない本番データ

- `job_next_1f84f876-6a5a-400d-b382-42f57ea3508b`（`@VeloxSystemsHQ`、22:24 JST、EN、`pending`）を上書きしない。検証で `prepareNextPost` を呼ばない。
- 停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。

## 1. 目的と非変更領域

未承諾の外向け返信は、公式 API による候補発見、Ring 1 / Ring 2 の実務メモに基づく下書き、`lp_meta_leak` と 4軸 Critic、承認キュー投入までを自動にする。X への送信はダッシュボードの 1 件承認だけである。

次の経路は無変更とし、承認キューを接続しない。

- `src/reply_promo_engine.js`
- `src/saas_outreach_worker.js` の `executeInterleavedOutreachCycle()`
- `src/official_api_client.js` の `runOfficialAutonomousEngagement()` と `POST /api/autopilot/boost-conversations`
- 受信コレクション `saas_users/{userId}/inbound_mentions/{tweetId}`
- `autoReplyPhase2Allowed()`、`composeInboundReply()`、`POST /api/autopilot/auto-reply-settings`、`GET /api/autopilot/mentions`、`POST /api/autopilot/mentions/:tweetId/draft-replies`、`POST /api/autopilot/mentions/:tweetId/send-reply`
- `views/dashboard_view.html` の Phase 1 / Phase 2 受信メンション一覧
- `src/llm_router.js` の `usableScores()`（軸 `null` の後方互換）

公式検索が使えないときはブラウザ送信へ戻さず、候補ゼロで止める。

## 2. データモデル

保存先は `saas_users/{userId}/outbound_reply_candidates/{tweetId}`。

フィールドは `tweetId`、`authorId`、`username`、`sourceText`、`sourceCreatedAt`、`replyLang`、`matchedRing`、`matchedCardId`、`matchedTopic`、`draftText`、`status`（`pending_approval` / `held` / `approved_sent` / `rejected`）、`critic`、`repliedTweetId`、`repliedAt`、`heldAt`、`rejectedAt`、`createdAt`、`updatedAt`。

## 3. 発見と下書き

`searchRecentPublicTweets()` を `src/official_api_client.js` に追加する。401、403、429、ネットワークエラーは空配列を返し、例外でプロセスを落とさない。

自己投稿、既存候補、`detectOptOut`、`blocked_reply_authors`、24時間以内に返信した著者は除外する。

`audienceKnowledge.schemaVersion === 2` の `ring1_craft` または `ring2_broad_adjacent` だけを使う。相手本文にその話題語が含まれるときだけ候補にする。`ring3_product_bridge`、フォロー営業、相互フォロー、DM 誘導は作らない。

下書きは `composeOutboundReply()`。`composeInboundReply()` は使わない。プロンプトに LP 本文、`verifiedClaims`、LP 由来 `focusPlaybook`、製品名、登録ページ、URL を渡さない。本文言語は `replyLanguage(sourceText)`。

## 4. 投入前ゲート

`replyPassesSafety`、`inspectPostCompliance`、`runDeterministicAudit`（`isolateLpContext: true` で `lp_meta_leak`）、製品名と URL の拒否を通す。

4軸のどれかが有限の数値でなければ、その1件だけ採点をやり直す。再度揃わなければ保存しない。`usableScores()` は変えない。

- 4軸が数値で `score >= 72`、`strangerClarity >= 14`、`scrollStopHook >= 12` なら `pending_approval`
- `60 <= score <= 71` は1回だけ修復し、再検査する。修復後に合格線へ乗れば `pending_approval`。修復後も 60–71 で4軸が数値かつ `criticDegraded: true` のときだけ `held`
- `score < 60`、漏洩、軸欠損は保存しない

## 5. API

`src/hybrid_saas_routes.js` に受信ルートとは別に追加する。エラーは `resolveUiLang()`。

- `GET /api/autopilot/outbound-replies` は `pending_approval` と `held` を返す。未認証は 401。
- `POST /api/autopilot/outbound-replies/:tweetId/approve` は `detectOptOut`、`blocked_reply_authors`、`replyAllowedNow` のあとだけ `postOfficialTweet(creds, text, [], tweetId)` を呼ぶ。成功時に `approved_sent` と日次カウント、著者クールダウンを受信返信と共有して更新する。
- `POST /api/autopilot/outbound-replies/:tweetId/reject` は `rejected`。
- `POST /api/autopilot/outbound-replies/:tweetId/hold` は `held`。

## 6. 画面

`views/dashboard_view.html` の受信一覧とは別セクションに、相手、元投稿、Ring、話題、返信案、承認、保留、却下を置く。ラベルは `checkIsEn()` と `data-i18n` で日英を分ける。返信本文は `replyLang` のまま表示する。

## 7. 検証

編集した `.js` は1ファイルずつ `node --check`。`views/funnel_index.html` と `views/dashboard_view.html` のインライン script は `vm.Script`。

`tests/v8c_outbound_reply_approval.test.js` で、検索失敗時の候補ゼロ、受信関数を呼ばないこと、LP 隔離と `lp_meta_leak`、軸欠損の1回再採点、60未満の破棄、60–71 の1回修復後の `held`、承認時だけ `postOfficialTweet` が呼ばれること、日英文言の存在を確かめる。

全スイートは次を `required_permissions: all` で実行する。

```bash
grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
```

`tests/post_constraint_stop_isolation.test.js` が deserialize で落ちたら、そのファイルだけ単体再実行する。

再起動は `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`。`/` と `/?lang=en` は 200、`/dashboard` は 302、未認証の visual-card、weekly-report、outbound-replies は 401。対象ジョブは `pending` のままにし、`prepareNextPost` は呼ばない。

## 8. 追補（V8-C.1）：候補発見の空振り可視化とログ

### 8.1 目的とガードレール

- `processOutboundReplyDiscovery()` の実行結果が `401` / `403` / `429` / 通信エラーで空振りした場合に、無言のまま空一覧になり原因不明に見える状態を防ぐ。
- 送信は引き続きダッシュボードの 1件承認（`POST /api/autopilot/outbound-replies/:tweetId/approve`）のみとする。
- 手動検索トリガーは追加しない。10分間隔の定期実行のみを維持する。
- 失敗時に `src/reply_promo_engine.js` や `executeInterleavedOutreachCycle()` へフォールバックしない。
- `inbound_mentions`、Phase 1 / Phase 2、`composeInboundReply()`、`usableScores()` は無変更とする。

### 8.2 保存先とデータ構造

保存先は `saas_users/{userId}.outboundReplyDiscovery`。サブコレクションには分けない。`autoReplySettings` と同じく `set({ outboundReplyDiscovery }, { merge: true })` で書き、利用者ドキュメントの他フィールドは触らない。

| フィールド | 型 | 値・制約 |
| --- | --- | --- |
| `lastRunAt` | string | 実行完了日時（ISO 8601） |
| `lastStatus` | string | `ok` / `no_match` / `auth_error` / `rate_limited` / `network_error` |
| `lastHttpStatus` | number \| null | HTTP ステータスコード。応答が無いときは `null` |

エラー応答本文、トークン、秘密情報、顧客メールは Firestore にもログにも残さない。

### 8.3 ステータス分類とサーバログ

- `401` / `403`、またはトークンが無いとき: `auth_error`
- `429`: `rate_limited`
- その他の HTTP エラー、通信エラー、タイムアウト: `network_error`。HTTP 応答があればその数値、無ければ `null`
- 検索成功かつ新規候補保存あり: `ok`
- 検索成功かつ品質ゲート通過候補 0 件: `no_match`
- `[Outbound Reply Discovery]` には `user`、`status`、`http` だけを出す。

### 8.4 API

`GET /api/autopilot/outbound-replies` は親ドキュメントの `outboundReplyDiscovery` を `discoveryStatus` として返す。未実行なら `null`。この取得は公式検索を呼ばない。

### 8.5 ダッシュボード

候補が 0 件のとき、`auth_error` / `rate_limited` / `network_error` だけ次を出す。

- JA: 「直近の候補検索を実行できませんでした（X API の検索権限または一時的な制限の可能性があります）。」
- EN: "Could not run the latest candidate search (X API search permission or temporary rate limit)."

`no_match` / `ok` / 未実行は「承認待ちの外向け返信はありません。」のまま。切替は `checkIsEn()`。HTTP `400` の出し分けは Section 9.5 が優先する。

### 8.6 検証

`merge: true` で他フィールドが残ること。状態と HTTP 数値以外を保存しないこと。GET が `discoveryStatus` を返し検索関数を呼ばないこと。空状態の日英出し分け。Section 7 の再起動と pending 維持も行う。commit は指示があるまで行わない。Section 9 で `lastMatchCount` と `nextCardCursor` を同じオブジェクトへ追加する。

## 9. 追補（V8-C.2）：HTTP 400 分離・検索クエリ安全化・カードローテーション・ヒット数記録

### 9.1 目的とガードレール
- HTTP `400`（検索条件拒否）を `network_error` と分離し、英語トピック内の `and` 等による演算子誤解釈（HTTP 400）および長文句の完全一致による 0 件連発を解消する。
- `searchRecentPublicTweets()` は変更せず、クエリ生成修正は `src/outbound_reply_queue.js` の `searchQueryFor()` に閉じる。
- 送信は引き続き 1 件承認のみ、手動検索トリガーなし、ブラウザ経路へのフォールバックなし、`inbound_mentions`・Phase 1/2 自動返信・`composeInboundReply()`・`usableScores()`・`matchAudienceCard()` は無変更。
- `job_next_1f84f876-6a5a-400d-b382-42f57ea3508b` は上書きしない、`prepareNextPost` は呼ばない。

### 9.2 `searchQueryFor()` の安全なクエリ生成（`OR` 禁止）
- `topicDomain`（空なら `topic`）から X 検索演算子と衝突する記号（`"` `(` `)` `:` `-` `/` `|` 等）を空白へ置換する。
- `OR` 演算子は使用しない。
- **英語（`lang === 'en'`）**:
  - 演算子語・機能語（`and`, `or`, `not`, `for`, `the`, `a`, `an`, `of`, `in`, `on`, `to`, `with`, `by`, `from`, `about`, `into`、大文字小文字無視）を除去する。
  - 残った実質語の先頭 2〜3 語を空白でつなぐ（例: `Opening lines hooks`）。
  - 実質語が残らない場合のみ、記号除去後の句を `"..."` で囲んでフォールバックする。
- **日本語（`lang === 'ja'`）**:
  - 助詞・区切り（`の`、`と`、`・`、`、`、空白等）で区切った主要語から最大 2 語を空白でつなぐ（例: `投稿 文章設計`、`文体 一貫性`）。分割できない場合はそのまま 1 語を使う。
- 末尾に既存の `lang:${lang} -is:retweet -is:reply` を付与する。

### 9.3 カードローテーション（`outbound_reply_queue.js` + `hybrid_saas_routes.js`）
- `src/outbound_reply_queue.js` に Ring 1 / Ring 2 カード（`topicRing === 'ring1_craft' || topicRing === 'ring2_broad_adjacent'`）を順に選ぶ関数 `selectDiscoveryCard(topics, cursor)` を追加する。
- `src/hybrid_saas_routes.js` の `processOutboundReplyDiscovery()` 内の先頭固定取り出しを上記関数へ置き換え、`outboundReplyDiscovery.nextCardCursor`（初期値 `0`）を参照して毎周期 1 つ進める（対象カード数で剰余ループ）。

### 9.4 ステータス分類・記録拡張・ログ
- `saas_users/{userId}.outboundReplyDiscovery`（`saveOutboundDiscovery()` による `merge: true`）の項目を以下へ拡張する:
  - `lastRunAt`: string（ISO 8601）
  - `lastStatus`: `'ok'` / `'no_match'` / `'invalid_query'` / `'auth_error'` / `'rate_limited'` / `'network_error'`
  - `lastHttpStatus`: number | null
  - `lastMatchCount`: number | null（HTTP 200 のときは `tweets.length`、エラー時は `null`）
  - `nextCardCursor`: number（次回使用するカード位置）
- HTTP ステータス分類:
  - `400` → `'invalid_query'`
  - `401` / `403` → `'auth_error'`
  - `429` → `'rate_limited'`
  - 通信失敗・その他エラー → `'network_error'`
  - 検索成功（HTTP 200）→ 保存あり `'ok'` / 保存 0 件 `'no_match'`
- ログ出力: `[Outbound Reply Discovery] user=... status=... http=... matches=...`（応答本文・トークン・メールは出力しない）。

### 9.5 ダッシュボード表示（`views/dashboard_view.html`）
- 候補 0 件かつ `discoveryStatus.lastStatus === 'invalid_query'` のとき、`checkIsEn()` で以下を出し分ける（廃止表現禁止）:
  - JA: 「直近の候補検索は検索条件が受け付けられませんでした。」
  - EN: "The latest candidate search query was rejected by X API."
- `auth_error` / `rate_limited` / `network_error` の表示および `no_match` / `ok` / 未実行の表示は Section 8.5 のまま維持する。

### 9.6 検証項目
- `searchQueryFor()` が `@VeloxSystemsHQ` の `Opening lines and hooks for short posts` から `and` を含まない安全なクエリを作り、`OR` を含まないこと。
- カードローテーションが `nextCardCursor` を進めて Ring 1 / Ring 2 を巡回すること。
- HTTP `400` が `invalid_query` に分類され、`lastMatchCount` が記録され、`views/dashboard_view.html` で日英出し分けされること。
- 既存の検証手順一式（`node --check`、インライン script の `vm.Script`、全スイート + 隔離テスト単体、`x-shop` のみ再起動、`127.0.0.1:3001` の `curl`、`job_next_1f84f876-6a5a-400d-b382-42f57ea3508b` の `pending` 維持、`prepareNextPost` 非実行）を通すこと。

## 10. 追補（V8-C.3）：返信文字数下限の分離・実質語マッチ・不合格件数ログ

### 10.1 目的とガードレール
- 通常投稿向けの 70 字下限（`too_short`）で良質な短め返信が Critic 前に落ちる問題を解消し、かつ機能語（`and` / `for` 等）による無関係ツイートへの誤一致と LLM 無駄打ちを防ぐ。
- 80分巡回（20件ページング）、1件承認送信、手動検索トリガーなし、ブラウザ経路非接続、`inbound_mentions`・Phase 1/2 自動返信・`composeInboundReply()`・`usableScores()`・`searchRecentPublicTweets()`・通常投稿向け `runDeterministicAudit()` の挙動は無変更。
- `prepareNextPost` は呼ばない。

### 10.2 返信文字数下限の分離（`passesOutboundSafety`）
- `passesOutboundSafety()` では、返信の長さ判定を `replyPassesSafety()` の 8〜280 字に合わせる。
- `runDeterministicAudit()` 由来の通常投稿向け 70 字未満（`too_short`）だけを外部返信の不合格理由から外し、他の監査項目（禁止表現・安全性・URL・製品名・`lp_meta_leak` 等）は維持する。

### 10.3 `matchAudienceCard()` の実質語一致
- 英語の演算子語・機能語（`and`, `or`, `not`, `for`, `the`, `a`, `an`, `of`, `in`, `on`, `to`, `with`, `by`, `from`, `about`, `into`、大文字小文字無視）および記号・日本語の助詞区切りを一致候補語から除外する。
- Ring 1 / Ring 2 カードの実質語（英語は 3 文字以上の実質語、日本語は区切り後の実質語）が相手投稿本文に含まれるときだけ一致とする。

### 10.4 試行上限と不合格件数ログ
- 1アカウント1周期あたり `composeOutboundReply()` を試行するツイートは最大 3 件までとし、1件保存した時点で即終了する。
- `[Outbound Reply Discovery]` ログに、投稿本文や機密を含めない件数内訳のみを追記する（例: `matches=... skipped=... noCard=... safety=... critic=...`）。

### 10.5 検証
- V8-C テストに以下を追加する。
  - 20〜60字の良質な返信案が `too_short` で落ちず Critic へ進むこと（8字未満・280字超・`lp_meta_leak` は従来どおり拒否）。
  - 英語投稿が `and` / `for` だけでは `matchAudienceCard()` に一致せず、実質語があるときだけ一致すること。
  - 1周期の試行上限（最大3件）と件数内訳の集計。
- `node --check`、インライン script の `vm.Script`、全スイートと隔離テスト、`x-shop` のみ再起動、`127.0.0.1:3001` の curl を通す。V8-C.3 の差分は commit / push しない。
