# VELOX V11-A: Critic-to-Reality Calibration and Unified Residual Outcome

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。秘密、メール、本文、生 URL は出さない。
- `public_metrics` の欠損ルール、報酬の重み、外向け返信、受信メンション、`next_post_draft.js`、`criticSystemRules(false)`、`llm_router.js`、`topic_source_vault.js` は変えない。
- 待機予約は上書きしない。`prepareNextPost` は本番で呼ばない。

## 1. outcome24h
- 既存の `impressions`、`bookmarks`、`bookmarkRate`、`likes`、`replies`、`frozenAt` に、`quotes` と `retweets` を足す。欠けは 0。
- `compositeReward` は `compositeEngagementScore()` の `rate`（bookmark 4、reply 3.5、quote 3、retweet 2、like 0.5 を表示で割った値。表示 0 のときは既存関数と同じく 1 で割る）。
- `residualReward` は、凍結済み投稿を古い順に並べて `computeResidualRewards()` に渡し、当該ジョブの `residual` から 0.5 を引いた値。0 がそのアカウントの基準線。先行する凍結済みが無いときは `null`。
- Bandit 本体は従来どおり 0 から 1 の `residual` を使う。計算関数は共有し、式の重みは変えない。

## 2. calibration
- `criticDegraded !== true` かつ 4 軸と `score` が数値で、`residualReward` も数値のときだけ保存する。
- `score >= 80` かつ `residualReward < 0` は `false_positive_honors`。
- `score < 80` かつ `residualReward > 0` は `hidden_gem`。
- `score >= 80` かつ `residualReward >= 0` は `aligned_win`。
- `score < 80` かつ `residualReward <= 0` は `aligned_loss`。
- 条件が揃わないときは `calibration` を書かない。

## 3. 集計
- `summarizeCriticCalibration()` は対象 5 件未満で `insufficient_data` と件数だけを返す。
- 5 件以上で 4 軸と合計点の Pearson 相関、件数内訳、`falsePositiveRate`、最も相関が低い軸、最も相関が高い軸を返す。分散 0 の相関は 0。
