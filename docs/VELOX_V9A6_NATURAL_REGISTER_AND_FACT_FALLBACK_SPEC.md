# VELOX V9-A.6: Natural Register, De-Overconstraining & Ring 3 Fact Fallback Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、URL は出さない。
- 明示指示なく `git commit` / `git push` しない。
- `criticSystemRules(false)` と `src/llm_router.js` は変えない。禁止語は足さない。
- 待機中の `job_next_d09ffd34-10de-46fd-9563-bbf50b5365b0` と `job_next_6f6f2a33-ac9d-4e84-9f39-36b15a890f74` は上書きしない。`prepareNextPost` は呼ばない。
- 既存テストが固定している口語の文言、`readerLine`、`parent_self_reply` の分担文、矢印の役割文は残す。

## 1. 制約を外す

`systemRules(false)` から `短い言い切り` と `熟語で名前を付けない` を外す。`中学生が一度読んだだけで場面が浮かぶ言葉にする。` は残す。

## 2. 完成例

`candidatePrompt()` は、`polite_ja` のときです・ますの完成例を 1 本だけ渡す。`plain_ja` と英語は、V9-A.5 の見本文を残したまま常体または英語の完成例を渡す。店の場面で、操作、理由、確認の順にする。

## 3. ring3 の事実

`page.description` と見出しが空のとき、`brandKnowledge.oneLineMechanism` を 140 字以内で渡す。`isolateLpContext === true` のときは渡さない。

## 4. 文体の初期値

直近投稿が無く、`accountRole === 'official_brand'` または `voice.register === 'professional_operational'` のときは `polite_ja` にする。常体の投稿が多いときは常体のままにする。判定は `decideEditorialPlan()` にある。

## 5. 検証

`tests/v9a6_natural_register_and_fact_fallback.test.js`、構文、インライン script、全スイート、再起動前のログ、`x-shop` 再起動、HTTP、待機 2 件、V4 の本番同条件オフライン試作 1 本。保存しない。
