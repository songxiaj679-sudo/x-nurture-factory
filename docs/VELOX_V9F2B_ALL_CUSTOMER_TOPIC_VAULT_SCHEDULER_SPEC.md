# VELOX V9-F.2b: Reader-Problem Topic Query and Weekly Source Sweep

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。秘密、API キー、メール、トークン、記事 URL は出さない。
- `git push` と本番 `prepareNextPost` は行わない。待機予約は上書きしない。
- 月次クロールは free 10 / starter 40 / pro 80 / business 160、日次 20 ページのまま。
- `context_radar.js`、`source_dossier_engine.js`、`outbound_reply_queue.js`、`llm_router.js`、`criticSystemRules(false)` は変更しない。

## 1. 検索
- `icpSummary` と `domainProblems` だけを主軸にする。`productName` では検索しない。
- 読者の本業の専門知識、失敗パターン、判断基準、業界トレンドを狙う。
- ツール比較、操作マニュアル、料金比較に加え、ツール自体の自作・開発・自動化スクリプト実装記を除外する。
- `coreFact` の冒頭は、どの場面の何の仕組みかがわかる主語から始める。

## 2. 週次収集
- free は週 1、starter は週 2、pro と business は週 3。最小間隔は 7 日、3.5 日、2.3 日、2.3 日。
- 直近 7 日の `fetchedAt` 件数、最終収集時刻、`checkTenantAiBudget({ kind: 'crawl' })` を見る。
- 未使用カードが 6 枚以上、停止、解約、ブランド無しはスキップする。
- `runTopicSourceVaultSweep` は 1 回に最大 3 顧客、各 1 記事。投稿ジョブとは別タイマー。
- 起動 5 分後に初回、その後 3 時間ごと。ログは件数だけ。

## 3. 検証
- `tests/v9f2b_all_customer_topic_vault_scheduler.test.js`、構文、`vm.Script`、全スイート、`x-shop` 再起動、HTTP、dry-run 1 本。
