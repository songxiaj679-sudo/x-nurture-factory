# VELOX V13-B: 検証済み URL は送信時だけ付ける

## 0. 前提
正は `AGENTS.md` の Sections 1–6。生 URL は外部メモ、執筆プロンプト、ログへ出さない。`git push`、`prepareNextPost`、`X_MEDIA_WRITE_ENABLED` の変更はしない。再起動は `x-shop` だけ。検索未収載には参考リプライを付けない。スレッドは 3 段まで。日次の予約枠は増やさない。待機予約は上書きしない。

## 1. 隔離
`prepareNextPost` は、`sourceType` が `topic_source` で、一次体験でも ring3 でもないときだけ、カードの `sourceUrl` を予約の `verifiedReferenceUrl` に置く。本文と `tweets` には混ぜない。それ以外は `null`。

## 2. 送信
送信コードだけが読む。検索未収載、または URL が空なら何もしない。1 段の投稿は、親の送信成功後に `参考: ` または `Source: ` を 1 件返信する。その返信だけ失敗しても親は `posted` のまま、`referenceReplyStatus` を残す。2 段か 3 段は最終段の末尾へ足し、4 段目は作らない。URL を 23 字として足すと上限を超えるときは付けない。`enforcePostThreadConstraints()` は通さない。

## 3. 重複
外部メモは、かみ砕いた中身をラベルなしの地の文として置く。執筆側は、発見を手順の羅列にしない。
