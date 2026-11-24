# V13-F プロバイダ障害と当日ロックの分離

執筆品質の不通過と、LLM 提供者側の障害を分ける。対象は `src/provider_error.js`、`src/llm_router.js` の `completeWriter`、`src/next_post_draft.js` の `draftNextPostWithMeta`、`src/autonomous_promo_ai.js` の `ensureNextPost`、`src/hybrid_saas_routes.js` の `nextPostState`、`views/dashboard_view.html` の予約欄。

## 分類

HTTP 応答から次の4種だけを取る。本文やキーは残さない。

- `provider_billing_error`: 残高不足、課金上限、HTTP 402、`credit balance is too low`
- `provider_auth_error`: HTTP 401 / 403、鍵の拒否
- `provider_rate_limit`: HTTP 429
- `provider_outage`: HTTP 5xx / 529、タイムアウト

Anthropic の通常の 400（tool_choice 非対応など）はこの分類に入れない。候補が検証で落ちたときは従来どおり `検証を通る投稿案が無かったため停止しました。` と `ensureNextPostFailures` の加算を維持する。

## 伝播

`completeWriter` は残高不足と認証失敗を Grok へ逃がさず `providerStop` で投げる。429 と 5xx は従来どおり Grok へ一度だけ逃がし、そこも同種の障害ならそこで止める。`draftNextPostWithMeta` は brief / hook / candidates / repair の catch でこのエラーを握りつぶさず、空の候補として「投稿案が無かった」に変換しない。

顧客向けの保存文は「文章の生成サービスが回復するまで、次の新規作成を待っています。回復後の次の周期から自動で再開します。」だけにする。英語画面は同じ意味の英文を出す。

## 当日ロックとクールダウン

プロバイダ障害では `ensureNextPostFailures` を増やさない。プロセス内のクールダウンは 12 分（`COOLDOWN_MS`）。その間 `ensureNextPost` は投稿生成を呼ばず、失敗件数も書かない。12 分後の次の周期で再試行する。まだ障害なら同じ分類でもう 12 分待つ。

ログは `[CRITICAL] provider=... class=... http=... cooldown_until=...` の1行。同じ分類の継続中は繰り返さない。Discord / Slack / メールの新しい送信先は足さない。既存のジョブ一覧 JSON `nextPostState.providerPause` とダッシュボードの黄帯で見えるようにする。

## 触らないもの

17:29 の pending ジョブは更新しない。`git push`、手動の `prepareNextPost`、実送信、`X_MEDIA_WRITE_ENABLED` は行わない。
