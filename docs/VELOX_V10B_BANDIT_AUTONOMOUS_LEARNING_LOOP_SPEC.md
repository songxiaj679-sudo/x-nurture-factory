# VELOX V10-B: Bandit Learning Loop for sourceType and segmentCount

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。検索未収載は 1 段、はみ出し分割禁止、文字数上限、外向け返信、週次収集、批評ルールは変えない。
- 待機予約は上書きしない。`prepareNextPost` は本番で呼ばない。

## 1. アーム
- 既存 6 アームに `sourceType`（topic_source / dossier / brand_only）と `segmentCount`（'1' / '2' / '3'）を足す。
- 報酬は 0.94 減衰のあと `weight * residual`。未保存の過去ジョブは 2 アームをスキップする。

## 2. 還流
- `single` と検索未収載は目標 1 段。`parent_self_reply` は 2 か 3 を選び、プロンプトへ渡す。
- ring1 / ring2 でカードがあるとき、`sourceType` の選択を素材に反映する。カードが 0 枚なら dossier、無ければ brand_only。
