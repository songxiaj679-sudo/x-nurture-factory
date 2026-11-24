# V13-G 旧テンプレートの引き算

一次原典がある投稿は、事実と仕組みをそのまま語る。確認手順や「ただし」で着地させない。禁止語は足さない。対象は `src/next_post_draft.js`、`src/editorial_lexicon_engine.js`、`src/editorial_archetypes.js`。

## ブリーフ

`briefPrompt()` と `angleLine()` は、`topicSource` の事実・仕組み・見方の転換があるとき、`readerPayoff` と `offer` にそれだけを置く。小さな工夫、確認手順、振り返りの儀式は作らない。原典が無いときだけ、従来の切り口を残す。

## 2段と結び

`parent_self_reply` は、1段目を前提か違和感と核心の入口、2段目を一次事実と仕組みにする。1段目の言い換えと、取って付けた1手は禁止する。`threadSecondMove` と `thread_restatement` の「確認手順を一つ足す」は外す。`contrarian_sharp` は通念の訂正と仕組みの核心で締める。

`decideEditorialPlan()` は一次原典があるとき `condition_edge` を候補から外す。修復指示はその結果の結びだけを渡す。

## Critic

`draftNextPostWithMeta` の英語採点文は、`saveUtility` を「原典の事実が見方の構造を変えるか」で見る。取って付けた手順と、要点を打ち消す「ただし」は 60 未満にする。`criticSystemRules(false)` は 400 字未満のまま変えない。

## 触らないもの

17:29 の破損予約は `logic_drift_legacy_template` でキャンセルする。カードの `usedCount` は変えない。commit、push、手動の `prepareNextPost`、実送信はしない。
