# VELOX V8-D.2: Non-Premium Two-Step Strategic Outbound Reply

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。秘密、メール、ハンドル、返信本文、URL は出さない。
- `git push` と本番 `prepareNextPost` は行わない。待機予約は上書きしない。
- 受信メンションの `replyPassesSafety()` は 280 字のまま。Premium の外向け返信は 1 段。3 連投はしない。
- `next_post_draft.js`、`editorial_archetypes.js`、`llm_router.js`、`topic_source_vault.js` は変更しない。

## 1. 生成
- `free` と `unknown` だけ 1 段か 2 段を選ぶ。2 段目は独立した補足のときだけ。はみ出し分割はしない。
- `draftText` は 1 段目。`draftTweets` は 1 本か 2 本。`replySegments` は 1 か 2。
- 各段を非 Premium の上限で確認し、超過は 1 回だけ短縮する。

## 2. 送信
- 残枠が本数に足りなければ 1 本目も送らない。
- 1 本目は元投稿へ、2 本目はその返信への自己返信。
- 両方成功で日次 +2。2 本目だけ失敗したら +1、`partial_sent`、再承認しない。

## 3. 画面
- 2 段の候補は日英の段ラベルと、日次 2 枠であることの表示を分ける。1 段は従来の本文。
