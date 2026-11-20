# VELOX V9-A: Autonomous Delivery Strategy, 80/20 Exploration & Learning Loop Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` は出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域

- 待機中の `@VeloxSystemsHQ` pending ジョブ（`job_next_dacb20d2-f697-42cf-835f-102281c95457`、02:36 JST 予定）を上書きしない。本番アカウントへの `prepareNextPost` は呼ばない。
- 停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。
- `postOfficialThread()`、`src/visual_card.js`、`auditReadability()`、`decideNextPostMission()`、`usableScores()`、受信メンション、V8-C 外向け返信キュー、V8-E.1/E.2 の脱バイアス仕様は無変更。
- `singleOnly` の短い 1 本保護と、`strategyLockByUser` 時の週次メモ非書き込みは維持する。

## 1. `delivery` の学習と 8 割活用・2 割探索

`chooseGenesForPost()` の戻り値と保存する `genes` に `delivery`（`single` または `parent_self_reply`）を足す。`singleOnly` は `single` のみ。課金アカウントは両方を候補にし、選択直前に 80% は Bandit の優位側、20% は探索にする。`angle` / `hookType` / `format` の学習は残す。過去投稿の `genes.delivery` も同じ更新ループで学ぶ。

## 2. 課金アカウントの 1 本固定解除

`writingShape(state, options)` は `delivery` を受ける。

- `singleOnly`: `{ thread: false, count: 1, minCount: 1, maxCount: 1 }`
- 課金かつ `parent_self_reply`: `{ thread: true, count: 2, minCount: 2, maxCount: 3 }`
- 課金かつ `single` または未指定: `{ thread: false, count: 1, minCount: 1, maxCount: 1 }`。`allowPromoReply` の 2 本目は維持する。
- 未課金: `{ thread: true, count: 2, minCount: 2, maxCount: 2 }`

`formatAccountState()`、`accountShapeLine()`、`draftPrompt()`、`fitsAccountState()`、`draft_verifier.js`、`editorial_archetypes.js` をこの本数に合わせる。英語の `honest two-tweet thread` は残す。保存直前の切り詰めは `maxCount` までにする。

## 3. 構造ヒントと週次メモ

`editorialContext.nicheHint` は、キャッシュにヒントがある限り成熟件数で切らない。`strategyDecisionLog` の最新 `memo` から数値・件数・パーセントを除き、残った文を `editorialContext.weeklyStrategyHint` として執筆へ渡す。空なら渡さない。

## 4. 検証

`tests/v9a_autonomous_strategy_and_delivery.test.js` を追加する。既存の本数テストは、`delivery` 未指定のとき従来どおりになるよう合わせる。`node --check`、インライン script、全スイート、`x-shop` のみ再起動、curl、HQ pending の未変更、V4 の `parent_self_reply` オフライン試作を行う。本番の `prepareNextPost` は呼ばない。
