# VELOX V9-A.1: Plain, Immediately Readable Craft Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` は出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域

- 待機中の `@VeloxSystemsHQ` pending ジョブ（`job_next_dacb20d2-f697-42cf-835f-102281c95457`、02:36 JST 予定）を上書きしない。本番アカウントへの `prepareNextPost` は呼ばない。
- 停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。
- V9-A の配信戦略、`writingShape()`、`chooseGenesForPost()`、`decideNextPostMission()`、`usableScores()`、`visual_card.js`、受信メンション、V8-C 外向け返信キュー、V8-E.1/E.2 仕様は無変更。

## 1. 執筆プロンプト

`systemRules(false)` の末尾、`+ craft` の直前に「中学生が一度読んだだけで場面が浮かぶ言葉にする。見たこと、やったことを書き、熟語で名前を付けない。一文には場面を一つだけ置く。」を足す。`写してよいのは間の取り方だけ` は残す。`systemRules(true)` には `Use words a teenager would say out loud. One sentence, one thing a person can see.` を足す。`candidatePrompt()` 日本語から「具体的な判断や失敗の場面で書く」を消す。禁止語リストは足さない。

## 2. Critic

日本語 `criticSystemRules(false)` の `strangerClarity` を「一度で場面が浮かぶ平易な言葉か。熟語が続くときは下げる。1行目の主語が結びまで続く。」に替える。合計 391 字、`accountRole` なしを維持する。英語 Critic には、抽象語が重なり場面が見えないときに下げる旨を足す。4 軸、72 点、`strangerClarity` 14、`scrollStopHook` 12、`criticDegraded` は維持する。

## 3. 検証

`tests/v9a1_plain_readable_craft.test.js` を追加する。`node --check`、インライン script、全スイート、`x-shop` のみ再起動、curl、HQ pending の未変更、V4 のオフライン試作を行う。本番の `prepareNextPost` は呼ばない。
