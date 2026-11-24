# V13-H 読者への翻訳と要約の不合格

一次原典の主題を、そのまま投稿のテーマにしない。企画と採点の両方で、読者の実務へ翻訳できたものだけを残す。禁止語は足さない。対象は `src/next_post_draft.js`。

## ブリーフと執筆

`topicSource` があるとき、`briefPrompt()` と `candidatePrompt()` は次の3段にする。

- 入口: `brandKnowledge.icpSummary` の読者が実務で信じている通説。
- 根拠: 一次原典の事実。範囲を広げない。
- 出口: 実務の判断基準を一つ。手順、一行メモ、「ただし」では締めない。

`readerHint` は隔離投稿でも読者だけを渡す。製品ページは渡さない。

## 採点と修復

`criticSystemRules(false)` は 400 字未満のまま、原典の要約だけで実務の入口か出口が無い草稿を 60 未満にし、`saveUtility` と `scrollStopHook` を下げる。英語の採点文も同じ不合格を書く。修復は語尾を直さず、入口と出口を作り直す。事実の範囲は保つ。

## カードの適合

`audienceFitForCard()` は、デマ・誤情報・選挙・公衆衛生がカードの主軸で、`brandKnowledge` の読者実務がその領域でないとき `mismatch` を返す。`buildCard()` はその印と `excludedReason: reader_practice_gap` を付ける。収集は保存しない。`selectReusableTopicCard()` は印の有無にかかわらず、その判定で候補から外す。未使用在庫の数も、外したカードを数えない。

13:25 の推薦アルゴリズムカードにはこの印を付ける。11/22 の API 有料化カードは `usedCount: 0` のまま残す。

## 入口の落第

1行目が論文の主題のまま、または本文の解説の末尾だけ「自社でも同じ」のとき、`scrollStopHook` は 10 以下、合計は 60 未満。`weakness` は手順や「週1分」の不足を減点理由にしない。

## 触らないもの

要約に留まった 17:29 予約は `summary_without_reader_translation` でキャンセルする。カードの `usedCount` は変えない。commit、push、手動の `prepareNextPost`、実送信はしない。
