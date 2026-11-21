# VELOX V9-A.5: Natural Spoken Craft & Ring 3 Fact Slimming Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、URL は出さない。
- 明示指示なく `git commit` / `git push` しない。
- `criticSystemRules(false)` と `src/llm_router.js` は変えない。禁止語は足さない。
- 待機中の `job_next_d09ffd34-10de-46fd-9563-bbf50b5365b0` と `job_next_6f6f2a33-ac9d-4e84-9f39-36b15a890f74` は上書きしない。`prepareNextPost` は呼ばない。
- 既存テストが固定している口語の文言、`readerLine`、`parent_self_reply` の分担文、矢印の役割文は残す。

## 1. ring3 の素材

`topicRing === 'ring3_product_bridge'` のとき、`briefPrompt()` はページ全文の JSON を渡さない。`description`、無ければ先頭の見出しを 140 字以内の 1 文として渡す。業種の語では選ばない。`isolateLpContext === true` のときは、これまでどおりページを渡さない。

## 2. 見本 1 組

執筆プロンプトに、店舗の営業と休みを題材にした硬い 3 行と口に出す 1 文を、日英で 1 組ずつ置く。IT や SaaS の語は使わない。

## 3. 重複

固定文言は `systemRules()` に残す。同じ口語の締めが `candidatePrompt()` にもう一度ある部分だけを外す。

## 4. 検証

`tests/v9a5_natural_spoken_craft_and_ring3_slim.test.js`、構文、インライン script、全スイート、`x-shop` 再起動、HTTP、待機 2 件、V4 の ring3・single オフライン試作 1 本。保存しない。
