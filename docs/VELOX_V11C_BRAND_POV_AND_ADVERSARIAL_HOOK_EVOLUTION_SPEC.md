# VELOX V11-C: Brand POV and Adversarial Hook Evolution

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。安全線、353字の批評規則、外向け返信、受信メンション、週次収集、`llm_router.js`、Bandit の報酬計算は変えない。
- 7日キャッシュは `editorialStance` が無くてもクロールしない。未保存の立場は `resolveEditorialStance()` が既存の課題と仕組みから補う。
- Hook Duel は候補本文の直前に最大1回。残りの呼び出しが4回未満、または残り時間が短いときはスキップする。
- 待機予約は上書きしない。`prepareNextPost` は本番で呼ばない。

## 1. レシピ
- 対比と解剖のレシピは、2文目までに現場の一動作へ戻す。

## 2. 立場
- `editorialStance` は `rejectedNorm`、`coreBelief`、`neverSays`。ページの課題と仕組みに重なる文だけを残す。
- ring1、ring2、挑戦稿のプロンプトに1〜2行だけ入れる。ring3 の一文制約は変えない。

## 3. フック
- 4視点を1回で作り、却下と直近24文字の類似で落とし、最大2本を候補1と2の1行目に渡す。
- 採択した視点は `selectedHookAngle`、実行したかは `hookDuelUsed` としてトレースに残す。
