# V13-I 週次枠の対象と季節行事の分離

一次原典の在庫が空でも、使えないカードで週次枠を埋めない。`business` は 1 日 1 枚のペースまで取れるようにする。一次原典の投稿へ、原典に無い季節行事を足さない。対象は `src/topic_source_vault.js` と `src/next_post_draft.js`。

実装は AGENTS.md の 1〜4 に従う。画面文言は足さない。commit、push、手動の `prepareNextPost`、実送信はしない。

## 週次カウント

`topicVaultEligibility()` が `weekly_cap` に数えるのは、直近 7 日で `plainTranslation` があり、`audienceFitForCard()` が `mismatch` でないカードだけ。`audienceFit: 'mismatch'` のカードと、`plainTranslation` の無い旧カードは数えない。

未使用在庫が 0 のときの 3 時間間隔と、在庫があるときのプラン別間隔はそのまま。間隔の起点は、これまで通り最後に取得したカードの時刻。1 回のスイープで取る顧客数も変えない。

## 上限

`free` 1、`starter` 2、`pro` 3 はそのまま。`business` だけ 3 から 7 にする。週 35 枠に対して、一次原典を 1 日 1 枚まで用意できる数。

## 季節行事

`topicSource` があるときの `briefPrompt()` と `candidatePrompt()` に、一次原典に無い季節行事や年中行事（年末、お正月、連休など）を足さない一文を置く。原典が無い枠には置かない。`criticSystemRules(false)` は変えない。
