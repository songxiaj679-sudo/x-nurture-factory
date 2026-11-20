# VELOX V8-E.2: Cross-Industry Extraction, Radar & Thin-Site Safety Guard Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` は出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域

- 待機中の `@VeloxSystemsHQ` pending ジョブ（`job_next_dacb20d2-f697-42cf-835f-102281c95457`、02:36 JST 予定）を上書きしない。本番アカウントへの `prepareNextPost` は呼ばない。
- 停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。
- `domainPlaybooks` のフィールド名、`context_radar.js` の `topic` / `pain` / `angleHint` と `collective_intelligence/live_radar_v1`（`category|lang`、TTL 6 時間）、`source_dossier_engine.js` の `currentDebate` / `concreteAngles` / `specialistInsight` / `avoidCliches`（`topicDomain|lang` ハッシュ、TTL 12 時間、数値・引用の除去）は維持する。
- `decideNextPostMission()`、`usableScores()`、`visual_card.js`、受信メンション、V8-C 外向け返信キュー、V8-E.1 の 3 ファイルは原則無変更。

## 1. LP 抽出

`src/lp_knowledge_extractor.js` は、ページの事実から実用カードを 0〜6 枚にする。`minItems` は 0。空のときの 6〜8 枚再生成は止める。`fallbackPlaybooks()` は空配列を返す。キー名と、禁止表現・根拠のない数値の除去は維持する。

## 2. レーダー

`src/context_radar.js` のプロンプトを業種中立にする。`industryQuery()` は短い業種文字列を `B2B SaaS運用` にしない。手がかりが空なら検索せず `null` を返す。キャッシュキーと TTL は維持する。

## 3. 外部ソース

`src/source_dossier_engine.js` のプロンプトを、生活者の疑問、見分け方、季節や日常、専門家のやさしい視点も拾える文言にする。出力キー、キャッシュ、失敗時の `null`、数値・引用の除去は維持する。

## 4. 薄いサイト

`category`、`icpSummary`、`userPrompt` がすべて空なら、`ensureAudienceKnowledge()` は LLM を呼ばず `{ ok: false, audienceKnowledge: null, needsReaderHint: true, reason: 'missing_reader_context' }` を返す。1 つでもあれば従来どおり作る。

`prepareNextPost()` は、既存の audience が無く、Brain 2 が `needsReaderHint` を返し、ページ本文も空のとき、早期リターンではなく例外を投げる。`code` は `MISSING_READER_CONTEXT`、`needsReaderHint` は true、`reason` は `missing_reader_context`。起動処理、自動補充の 1 日 3 回上限、再検討 API の既存の例外処理に乗せる。`budget_degraded_audit_failed` の戻り値は変えない。V4 と HQ のように手がかりがあるアカウントは変えない。

## 5. 検証

`tests/v8e2_extraction_radar_and_thin_site_guard.test.js` を追加する。`node --check`、インライン script、全スイート、`x-shop` のみ再起動、curl、HQ pending の未変更、空サイトの停止と架空カフェの話題確認を行う。本番アカウントの `prepareNextPost` は呼ばない。
