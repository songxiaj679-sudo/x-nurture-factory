# VELOX V11-B: Weekly Wildcard and Dynamic Arm Promotion

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。挑戦稿でも文字数上限、はみ出し分割禁止、直近投稿との類似禁止、架空の数字と URL の禁止は維持する。
- Bandit の 0〜1 残差と重みは変えない。別の alpha 文書は作らない。
- 外向け返信、受信メンション、週次収集、`llm_router.js`、`criticSystemRules(false)` は変えない。
- 待機予約は上書きしない。`prepareNextPost` は本番で呼ばない。

## 1. レシピ
- `wc_cross_domain_analogy`、`wc_sacred_cow_inversion`、`wc_failure_autopsy`、`wc_reverse_metric_lens`。
- 各レシピは id と日英の短い指針を持つ。

## 2. 週 1 本
- 検索収載済み、ring1 または ring2、直近 7 日の `isWildcard` が 0 件、凍結済みが 1 件以上または直近 7 日の通常投稿が 2 件以上のときだけ発動する。
- 未昇格かつ使用回数が少ないレシピを選ぶ。
- ジョブと `generation_traces` に `isWildcard` と `wildcardRecipe` を残す。

## 3. 昇格
- `outcome24h.residualReward` の中央値が 0 を超える凍結が 2 本揃ったレシピだけを `saas_users.promotedDynamicArms` へ入れる。最大 4 件。
- 昇格後、直近 3 本の中央値が 0 未満なら外す。
- `chooseGenesForPost()` は定数を書き換えず、呼び出し時の候補にだけ足す。
