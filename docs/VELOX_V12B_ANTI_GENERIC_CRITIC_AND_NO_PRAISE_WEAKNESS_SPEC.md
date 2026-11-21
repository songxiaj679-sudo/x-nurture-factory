# VELOX V12-B: Anti-Generic Critic Overhaul (Brand-Swap Penalty & No-Praise Weakness) Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）
- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、API キー、トークン、顧客メール、HQ の `targetUrl`、収集記事の生 URL はログ・ドキュメントへ出力しない。
- 明示指示なく `git push` しない。UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域
- 採点呼び出し側の固定文言（`subject opened on line 1`、`unexplained product rule`、`closing sentence contradicts the example`、`strangerClarity below 14 or scrollStopHook below 12`）は変えない。`×/○` と `①②③` は入れない。
- `judgeCriticRow()` の既定合否（72 / 14 / 12）は変えない。
- `criticSystemRules(false)` は 400 字未満。`accountRole` と `トレードオフ` を含まない。次の文言は残す。`1行目の主語が結びまで続く`、`自然な口語`、`空行がなく文字が詰まる`、`一度で場面が浮かぶ平易な言葉か`、`熟語が続くときは下げる`、`保存したくなる具体`。
- `src/outbound_reply_queue.js`、受信メンションワーカー、`src/llm_router.js`、Bandit 報酬計算式は変えない。
- 待機予約 `job_next_eebd4cef-7b1f-4de6-a665-298b6a2133f7` は上書きしない。`prepareNextPost` は呼ばない。

## 1. 採点規則
日本語の `criticSystemRules(false)` に、同業でも言える一般メモは綺麗でも 72 未満、`weakness` は褒め言葉を書かず削る弱点を 1 点だけ書く、を入れる。

英語の `criticSystemRules(true)` にも、brand-swappable generic advice は 72 未満、`weakness` は具体的な弱点か一般論の箇所を 1 つ書き、賞賛は書かない、を入れる。

`tests/v11c`、`tests/v11d`、`tests/v11e` の長さ固定 `=== 353` は `< 400` へ更新する。

## 2. 無採点の修復と指示の引き算
- 最初の候補が監査で全滅して修復へ進んだときも、呼び出し残数がある限り採点を実行する。修復を作ったときは `repairCount` を 1 にする。採点できないときだけ `criticDegraded` を true にし、点数なしの通常採用はしない。
- 勝ちフックがあるとき、候補へ渡す brief から `scene` と `thisPost` を外す。brief は、入力に無い夕方や経過時間を作らない。候補へ渡す brief は tension、持ち帰り、仕組みの一点、避けることに限る。
- 外部メモは出典、核の 1 事実、実践の 1 点だけにする。3 つ以上の読点で並ぶ一覧は先頭の 1 点だけ残す。記事にある数字は残す。

## 3. 候補プロンプトの残り重複
- 候補プロンプトから、brief がすでに受け取っている知識 JSON と学習メモを外す。店舗見本の固定文は残す。
- 持ち帰り、型、編集指示は1か所にまとめる。通常の空行指示は電話レイアウトの1回だけにする。一覧型のときだけ型の指示を残す。
- Hook Duel は、入力に無い朝・夕方・夜や経過時間を作らない。

## 4. 検証
- `tests/v12b_anti_generic_critic_and_no_praise_weakness.test.js`
- 編集した `.js` の `node --check`
- funnel と dashboard のインライン script を `vm.Script` で検証
- 非エミュレータの全スイート
- `x-shop` のみ再起動し、`/` 200、`/?lang=en` 200、`/dashboard` 302、未認証 3 API は 401
- 待機予約が `pending` のまま同じ `updatedAt` であることを確認
- 本番 DB へ書かず、V4 の条件で `draftNextPostWithMeta()` を 1 回だけ試す
