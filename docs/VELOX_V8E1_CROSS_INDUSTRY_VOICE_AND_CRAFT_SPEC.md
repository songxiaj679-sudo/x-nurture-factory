# VELOX V8-E.1: Cross-Industry Voice, Archetype & Critic Debiasing Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` は出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域

- 待機中の `@VeloxSystemsHQ` pending ジョブ（`job_next_dacb20d2-f697-42cf-835f-102281c95457`）を上書きしない。`prepareNextPost` は呼ばない。
- 停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。
- V8-E.2 対象（`src/lp_knowledge_extractor.js`、`src/context_radar.js`、`src/source_dossier_engine.js`、`src/audience_knowledge_engine.js`）、`decideNextPostMission()`、`usableScores()`、`src/visual_card.js`、受信メンション、V8-C 外向け返信承認キューは無変更。

## 1. 執筆と Critic

`systemRules(isEn)` から、IT・B2B 評論に固定する前提を外す。日本語版は `写してよいのは間の取り方だけ` を残す。

`candidatePrompt()` の持ち帰りと 3 案は、読者が保存したくなる具体（見分け方、小さな工夫、確認、思い違い）へ一般化する。`audienceKnowledge.readerPersona` があるときは、`isolateLpContext: true` でも想定読者を 1 行渡す。製品名と LP 主張は渡さない。

`criticSystemRules(isEn)`、通常採点、修復採点から「具体的なトレードオフ」固定を外す。日本語の `criticSystemRules(false)` は 400 字未満、`accountRole` を含めない。V8-D の一貫性 3 観点、記号誘導の禁止、4 軸キー、合計 72、`strangerClarity >= 14`、`scrollStopHook >= 12` は維持する。

## 2. 型

`before_after_rewrite` は、カードの話題に沿った「うまくいきにくいやり方・見方」と「うまくいくやり方・見方」の対比にする。「作業文の見本」と「よくある言い方がなぜ届かないか」は残さない。V8-D の自律的な見せ方と直近パターンの回避は維持する。

## 3. 公式判定

`official_brand` は `verifiedType === 'business'`、またはバイオか表示名の公式語だけにする。丁寧語の比率、青バッジに丁寧語、URL トークン一致は使わない。`thinkingLens` の例文は業種中立にする。

## 4. 検証

`tests/v8e1_cross_industry_voice_and_craft.test.js` を追加する。`node --check`、インライン script の `vm.Script`、エミュレーター以外の全スイート、`x-shop` のみ再起動、curl、HQ pending の未変更確認を行う。

オフラインで、架空の整体院（`operator`、`before_after_rewrite`、外部テーマ）を 1 本、`@VeloxSystemsV4` の外部テーマを 1 本出す。本番予約へは書かない。
