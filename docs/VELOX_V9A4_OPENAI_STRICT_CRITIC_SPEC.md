# VELOX V9-A.4: OpenAI Strict Critic Priority with Grok Fallback Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、URL は出さない。
- 明示指示なく `git commit` / `git push` しない。
- 合格点、`usableScores()`、`criticSystemRules()`、`completeWriter()`、X 検索は変えない。
- 待機中の `job_next_d09ffd34-10de-46fd-9563-bbf50b5365b0` と `job_next_6f6f2a33-ac9d-4e84-9f39-36b15a890f74` は上書きしない。`prepareNextPost` は呼ばない。
- `outbound_reply_queue.js`、`next_post_draft.js`、`editorial_archetypes.js`、`visual_card.js` は無変更。再起動対象は `x-shop` のみ。

## 1. 採点

`completeCritic()` は執筆元に関係なく OpenAI `gpt-4.1` を先に呼ぶ。`json_schema` は strict で、スキーマの初期値は `criticJsonSchema`。外向け返信はスキーマを渡さないので、この初期値がそのまま使われる。

OpenAI が例外かタイムアウトのときは、外側のループへ戻さず、同じ試行の中で Grok の高速モデルを呼ぶ。キーが無いときも Grok を呼ぶ。読める点数にならない JSON は、これまでどおり OpenAI をもう 1 回だけ試す。正常時の呼び出しは OpenAI 1 回だけ。

## 2. 検証

- `tests/v6_phase1_router_and_craft.test.js` を OpenAI 優先へ更新する。
- `tests/v9a4_openai_strict_critic.test.js` を追加する。
- `node --check`、インライン script、全スイート、`x-shop` 再起動、HTTP、待機 2 件。
- V4 のオフライン試作 1 本で、採点が `openai` / `gpt-4.1` になり 4 軸が埋まることを見る。保存しない。
