# VELOX V9-A.2: Arrow Role Clarity Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` は出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域

- 待機中の `@VeloxSystemsHQ` pending ジョブ（`job_next_dacb20d2-f697-42cf-835f-102281c95457`、02:36 JST 予定）を上書きしない。本番アカウントへの `prepareNextPost` は呼ばない。
- 停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。
- `→` や `↓` を禁止語にしない。`criticSystemRules`、`writingShape()`、`chooseGenesForPost()`、`decideNextPostMission()`、`usableScores()`、`visual_card.js`、受信メンション、V8-C 外向け返信キューは無変更。

## 1. 矢印の役割

`src/editorial_archetypes.js` のレイアウト案内の直後に、次を足す。

- 日本語: `矢印は、前の状態が次の状態へ変わるときだけ使う。見出しと例のあいだには置かない。`
- 英語: `An arrow only shows one state becoming the next, not a label next to an example.`

記号の強制はしない。構成は内容に合わせて選ぶ。

## 2. 検証

`tests/v9a2_arrow_role_clarity.test.js` で日英の案内を確認する。`node --check`、インライン script、全スイート、`x-shop` のみ再起動、curl、HQ pending の未変更、V4 の `before_after_rewrite` オフライン試作を行う。本番の `prepareNextPost` は呼ばない。
