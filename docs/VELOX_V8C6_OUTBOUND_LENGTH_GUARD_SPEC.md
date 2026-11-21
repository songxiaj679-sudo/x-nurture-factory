# VELOX V8-C.6: Outbound Reply 180-Char Guidance & Single Shorten Retry Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、本文、URL は出さない。
- 明示指示なく `git commit` / `git push` しない。再起動対象は `x-shop` のみ。
- `replyPassesSafety()` の 280 字上限、合格点、`[Outbound Drop]` の `unsafe:*` 形式は変えない。

## 1. 文字数

`composeOutboundReply()` の日英プロンプトに、180 字以内で書く一文を足す。結果が 280 字を超えたときだけ、同じ関数の中で 1 回書き直す。2 回目も超えたら、これまでどおり `unsafe:too_long` で落とす。

## 2. 検証

`tests/v8c6_outbound_length_guard.test.js` で、日英の 180 字指示、1 回の短縮で通過すること、2 回目も超過なら `unsafe:too_long` になることを見る。
