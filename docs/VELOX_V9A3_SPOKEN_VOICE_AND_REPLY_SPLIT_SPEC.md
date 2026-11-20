# VELOX V9-A.3: Spoken Voice & Parent/Self-Reply Split Priority Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` は出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語と本文言語を混ぜない。廃止表現は戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域

- `src/llm_router.js` のモデル割り当ては変更しない。
- `criticSystemRules(false)`（391 字）は変更しない。
- 禁止語リストは足さない。
- 待機中の `job_next_b5948bf1-9843-464b-ad2f-b84243901969` と `job_next_48460d9f-1920-42c3-863d-1c3781e88fb2` は上書きしない。
- 本番の `prepareNextPost` は呼ばない。`outbound_reply_queue.js`、`visual_card.js`、`decideNextPostMission()`、`usableScores()`、`writingShape()`、`chooseGenesForPost()` は無変更。

## 1. 口調

`systemRules(false)` と `systemRules(true)`、および同じ許可を繰り返している執筆プロンプトで、次の 2 点にする。

- 公式アカウントでも解説の先生や締めの標語にせず、その場で口に出す一文で書く。一人称の個人日記禁止と、チーム／プロダクトの主語は残す。
- 問いかけで締めない。置くなら最後の 1 文だけで、詰め寄る質問にはしない。

維持する文言: `写してよいのは間の取り方だけ`、V9-A.1 の平易化一文、英語の `Use words a teenager would say out loud`。

## 2. parent_self_reply のときだけ分担を優先

`delivery === 'parent_self_reply'` のとき、型が「本文で原因まで書く」指示より先に、1 本目は違和感や場面で止め、原因・見分け方・やり方・確認は自己リプライへ置く。`single` の `failure_autopsy` 本文は変えない。

`内容に合わせて選ぶ`、矢印の一文、英語の `honest two-tweet thread` は維持する。

## 3. 検証

- `tests/v9a3_spoken_voice_and_reply_split.test.js`
- 編集した `.js` を 1 ファイルずつ `node --check`
- `views/funnel_index.html` と `views/dashboard_view.html` のインライン script を `vm.Script`
- 非エミュレータの全スイート。必要なら隔離テストを単体再実行
- `x-shop` のみ再起動し、`/` 200、`/?lang=en` 200、`/dashboard` 302、未認証 3 API は 401
- 待機 2 件の状態確認。本番 `prepareNextPost` は呼ばない
- V4 のオフライン試作 2 本（`parent_self_reply` と `single`、どちらも `failure_autopsy`）。保存しない
