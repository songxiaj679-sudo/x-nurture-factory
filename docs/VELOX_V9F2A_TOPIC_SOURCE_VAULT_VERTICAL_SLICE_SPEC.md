# VELOX V9-F.2a: Per-User Topic Source Vault (Vertical Slice) Spec

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。秘密、API キー、メール、トークン、記事 URL は出さない。
- `git push` と本番 `prepareNextPost` は行わない。待機予約は上書きしない。
- `context_radar.js`、`source_dossier_engine.js`、`outbound_reply_queue.js`、`llm_router.js`、`criticSystemRules(false)` は変更しない。
- 週次の全顧客バッチはまだ入れない。

## 1. `src/topic_source_vault.js`
- `collectTopicSourceForUser` は Grok `web_search` で URL を最大 2 件選び、プライベートアドレス、ログイン、規約、SNS、顧客自身の URL を除く。
- Firecrawl `/v2/scrape` は 1 ページだけ。失敗したときだけ 2 件目を試す。`/v2/map` は使わない。
- カードは `sourceName`、`sourceUrl`、`title`、`outputLang`、`coreFact`、`whyItMatters`、`mechanism`、`actionableTakeaway`、`fetchedAt`、`usedCount`、`lastUsedAt`。記事に無い数字は落とす。`scrubField()` は通さない。
- `dryRun === false` かつ `db` があるときだけ `saas_users/{userId}/topic_sources/{sourceId}` へ保存する。
- `pickTopicSourceForPost` は同じ言語で `usedCount` が小さく、新しいカードを 1 枚返す。
- `formatTopicSourceAsDossier` は出典名と 4 項目を 700 字以内にまとめ、生 URL を含めない。

## 2. 既存 700 字枠
- `topicSource` があり、話題が `ring1_craft` または `ring2_broad_adjacent` のときだけ、既存の外部メモ枠をその 700 字に差し替える。
- それ以外は従来の `sourceDossier` のまま。新しいプロンプト欄は足さない。
- 孤立ドラフトの ring1 / ring2 でカードがあるとき、`prepareNextPost` が 1 枚引き、予約保存後に `usedCount` を 1 増やす。カードが無いアカウントは従来どおり。

## 3. 検証
- `tests/v9f2a_topic_source_vault_vertical_slice.test.js`、構文チェック、`vm.Script`、全スイート、`x-shop` 再起動、HTTP、予約未変更、本番 DB へ書かない dry-run 1 本。
