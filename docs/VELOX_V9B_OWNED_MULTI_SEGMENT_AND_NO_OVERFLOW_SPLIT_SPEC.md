# VELOX V9-B: Owned 1–3 Segment Delivery and Overflow-Split Guard

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。秘密、メール、記事 URL は出さない。
- `git push` と本番 `prepareNextPost` は行わない。待機予約は上書きしない。
- `outbound_reply_queue.js`、`topic_source_vault.js`、`context_radar.js`、`source_dossier_engine.js`、`llm_router.js`、`criticSystemRules(false)` は変更しない。
- 検索未収載は 1 本。Premium は JA 900 / EN 1500。非 Premium は JA 140 / EN 270。

## 1. 段数
- 検索収載済みの非 Premium は `single` が 1 段、`parent_self_reply` が 2〜3 段。
- Premium の `parent_self_reply` も 2〜3 段。検索未収載は `single` 固定。
- 2 段は場面、次に原因と 1 手。3 段目は独立した手順のときだけ。あふれた文の分割は禁止。

## 2. ガードと記録
- `detectOverflowSplit` は未完結の文末、短すぎる 3 段目、前段と同じ段を弾く。
- 予約ジョブと `generation_traces` に `segmentCount` と `delivery` を残す。
