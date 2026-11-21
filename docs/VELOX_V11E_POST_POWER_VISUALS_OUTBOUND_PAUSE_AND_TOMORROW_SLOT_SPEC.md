# VELOX V11-E: Visual Contrast, Outbound Send Pause, and Tomorrow's First Slot

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。`X_MEDIA_WRITE_ENABLED` は読み取りだけにする。
- 発見側の `X_OUTBOUND_REPLY_DISCOVERY` と受信メンションの4分間隔は変えない。
- `nextPlanSlot()` が当日枠を使い切ったときに `null` を返す挙動は変えない。
- 本番から `prepareNextPost` を直接呼ばない。

## 1. 投稿
- 既存3テンプレートに加え、`myth_vs_reality_card` を追加する。
- 画像化は `X_MEDIA_WRITE_ENABLED === 'true'` のときだけ `ready`。
- ring3 以外の結びは、判断の境界か再現できる確認を1つ置く。いいねやコメントの依頼は書かない。

## 2. 外向け送信
- `X_OUTBOUND_REPLY_SEND_ENABLED === 'false'` のとき、承認送信の直前で止め、`403` と `outbound_reply_send_paused` を返す。
- 未設定のときは今までどおり送る。

## 3. 翌日の先頭枠
- `pending` が0件で、当日の `nextPlanSlot()` が `null` のときだけ、翌日の先頭枠を1件予約する。
- `pending` が1件でもあれば作らない。当日の投稿上限は増えない。
