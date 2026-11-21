# VELOX V11-D: Prompt Evolution and Calibrated Critic Weights

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。安全線は進化パッチより優先する。
- `judgeCriticRow()` の既定は 72 / 14 / 12 のまま。`axisWeights` は任意引数。
- 批評規則 353 字、外向け返信、受信メンション、週次収集、`llm_router.js`、Bandit の報酬計算は変えない。
- 待機予約は上書きしない。`prepareNextPost` は本番で呼ばない。

## 1. 勝ちフック
- 候補1と候補2は、選ばれたフックを1行目として言い換えずに置く。語尾の敬体と常体だけ合わせられる。
- 候補3は別の切り口。
- `selectedHookAngle` は、先頭12字の一致、または語尾と先頭記号を除いた類似度 0.7 以上で帰属する。別の文は `null`。

## 2. 軸重み
- 凍結が5件未満、または相関がすべて0なら `null`。
- それ以外は `1 + clamp(相関 * 0.25, -0.25, 0.25)` を、合計 4.0、各軸 0.75〜1.25 に収める。
- 重みが渡されたときだけ、重み付き合計を 72 点判定に使う。生の 14 と 12 は残す。

## 3. 進化パッチ
- 保存先は `saas_users.promptEvolution` と `saas_users.criticAxisWeights`。
- 凍結5件未満は更新しない。challenger は3本未満なら継続、3本の中央値が0を超え、かつ基準以上なら active へ昇格する。届かなければ破棄する。
- パッチは `doMore` と `avoidMore` で、合計180字以内。URL、メール、安全線違反は除く。
- ring1 と ring2 の通常稿は、直前が challenger でなければ challenger、そうでなければ active か baseline を使う。
- 使った版は `evolutionVersion` としてジョブとトレースに残す。
