# VELOX V8-C.5: Outbound Reply Unsafe Breakdown Diagnostics Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、アカウント名、ハンドル、返信本文、NG 語句そのもの、`weakness`、URL はログへ出さない。
- 明示指示なく `git commit` / `git push` しない。
- `replyPassesSafety()` の戻り値は boolean のまま、合否の順も変えない。
- 外向け返信の合格点と保存条件は変えない。
- 待機中の `job_next_d09ffd34-10de-46fd-9563-bbf50b5365b0` と `job_next_6f6f2a33-ac9d-4e84-9f39-36b15a890f74` は上書きしない。`prepareNextPost` は呼ばない。
- 通常投稿パイプラインと `llm_router.js` は無変更。再起動対象は `x-shop` のみ。

## 1. ログ

`passesOutboundSafety()` が `replyPassesSafety()` の不合格を見たとき、同じ順で最初の1つだけを `reasons` に入れる。

1. `unsafe:empty`
2. `unsafe:too_short`
3. `unsafe:too_long`
4. `unsafe:url`
5. `unsafe:bait`
6. `unsafe:ng_topic`

出力例: `[Outbound Drop] stage=safety reasons=unsafe:url repaired=0`

## 2. 検証

- `tests/v8c4_outbound_drop_diagnostics.test.js` の URL 行を `unsafe:url` にする。
- `tests/v8c5_outbound_unsafe_diagnostics.test.js` で 6 種、優先順、本文・URL・NG 語句が漏れないこと、`replyPassesSafety()` が boolean のままであることを見る。
- `node --check`、インライン script の `vm.Script`、非エミュレータ全スイート。
- `x-shop` 再起動と HTTP 確認。待機 2 件が `pending` のままであること。
