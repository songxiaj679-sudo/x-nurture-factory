# VELOX V10-A: Core Prompt Overhaul and Reader-Focused Topic Sourcing

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。秘密、API キー、メール、トークン、記事 URL は出さない。
- `git push` と本番 `prepareNextPost` は行わない。待機予約は上書きしない。
- 架空の数字・日時・引用、無断 URL、公式アカウントの個人日記、敬体と常体の混在、廃止表現は残す。
- `llm_router.js`、`outbound_reply_queue.js`、`context_radar.js`、`source_dossier_engine.js` は変更しない。

## 1. 記事選定
- `collectTopicSourceForUser` は、読者の日々の課題・専門の仕組み・失敗原因・実践ノウハウを狙う。
- 同業のツール比較、競合の操作マニュアル、料金比較、導入手順、製品レビュー、アフィリエイトまとめは除外する。
- カード抽出も、使い方と料金比較ではなく、仕組みとすぐ使える判断基準にする。

## 2. プロンプト
- `systemRules(false)` から重複した翻訳調の禁止列を外し、1,204 字より短くする。固定の最小文言は残す。
- 一次記事カードか外部メモがあるときは、要約ではなく、詳しい知人が噛み砕く口語で書く。
- 1 行目の直後と 2〜3 文ごとに空行を置き、`「」`、`・`、`1.` `2.` は控えめに使う。本文に `▼` は使わない。
- `criticSystemRules(false)` は 400 字未満、`1行目の主語が結びまで続く` を維持し、硬い解説調と詰まった文章を下げる。

## 3. sourceType
- `topic_source`、`dossier`、`brand_only` を生成結果、予約ジョブ、`generation_traces` に残す。

## 4. 検証
- `tests/v10a_core_prompt_overhaul_and_reader_topic.test.js`、構文、`vm.Script`、全スイート、`x-shop` 再起動、HTTP、予約保護、改行を残した dry-run 1 本。
