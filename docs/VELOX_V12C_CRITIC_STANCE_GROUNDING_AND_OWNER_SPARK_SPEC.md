# VELOX V12-C: Critic Brand-Stance Grounding & Owner Spark (First-Hand Input) Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）
- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、API キー、トークン、顧客メール、HQ の `targetUrl`、収集記事の生 URL はログ・ドキュメントへ出力しない。
- 明示指示なく `git commit` / `git push` しない。UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域
- 採点呼び出し側の既存固定文言と `criticSystemRules(false)`（400 字未満）の必須アンカー、`judgeCriticRow()` の 72 / 14 / 12 は変えない。
- Bandit の `sourceType`（`topic_source` / `dossier` / `brand_only`）と報酬計算式は壊さない。Owner Spark の有無は `ownerSparkUsed` に分ける。
- `/api/autopilot/save-setup` では Firecrawl を呼ばない。入力欄は折りたたみ `#advancedSettingsDetails` 内 `#secAdvancedBrand` だけに置く。
- `src/outbound_reply_queue.js`、受信メンションワーカー、`src/topic_source_vault.js`、`src/llm_router.js` は変えない。待機予約 `job_next_eebd4cef-7b1f-4de6-a665-298b6a2133f7` は上書きしない。`prepareNextPost` は呼ばない。

## 1. 採点へ立場と一次体験を渡す
- `completeCritic()` の user prompt に、`rejectedNorm` と `coreBelief`、使う一次体験の要旨を合計 180 字以内で足す。
- 立場も一次体験も無いときはその行を出さない。
- あるときだけ、「立場や固有事実が本文に無く、同業名へ入れ替えても成立する一般論は 72 未満」という 1 行を足す。

## 2. Owner Spark と立場の上書き
- `POST /api/autopilot/save-setup` は `ownerSparks`（最大 10 件、重複と URL・メールを除く）と `editorialStanceOverride` を保存する。クロールはしない。
- `resolveEditorialStance()` は上書きを、保存済みの LP 抽出とフォールバックより先に返す。
- 画面は一次体験 1 行と、否定する常識、譲れない基準の 2 行。日英ラベルを持つ。
- `ring1_craft` と `ring2_broad_adjacent` だけ未使用の 1 件を `draftNextPostWithMeta()` へ渡す。`ring3_product_bridge` では使わない。
- brief と候補には 250 字以内の指示を足す。新しい LLM 呼び出しは増やさない。
- 一次体験の数字は `sanitizeBriefTension()` の根拠に含める。
- 予約が保存できたときだけ `usedAt` を記録する。dry-run では書かない。ジョブと trace に `ownerSparkUsed` と `ownerSparkId` を残す。

## 3. 数字の許可と手順書の引き算
- 機械検査の許可数字に、`ownerSpark`、生の反論、一次記事カードにある数字を含める。そこに無い数字はこれまで通り落とす。
- `ownerSpark` がある投稿では、外部記事メモを brief にも候補プロンプトにも入れない。
- 候補プロンプトの「判断の境界を言い切る」「保存したくなる具体を1点で言い切る」は外す。代わりに、チェックリストで「〜するまで始めません」と締めず、呼びかけや疑問文の連打もしない。数字は元ネタの対象と前提を残し、無い分母は作らない。
- 一次体験メモが悪い例として引用している言い回しは、そのメモにある範囲だけ機械検査の定型句禁止から外す。メモに無い定型句はこれまで通り落とす。

## 4. 翻訳調と接着の引き算
- `systemRules(false)` から、英語の直訳調のリズム見本を外す。代わりに、直訳のような硬い言い回しを避けて自然な日本語で書く、という1文だけを置く。
- 勝ちフックを1行目へ原文のまま貼る指示と、貼り付ける処理を外す。一次体験がある投稿では、その別工程自体を走らせない。
- 候補プロンプトから、店舗の確認手順の見本を外す。投稿は最初から最後まで同じ話題、同じ文体で書く。

## 5. 検証
- `tests/v12c_critic_stance_grounding_and_owner_spark.test.js`
- 編集した `.js` の `node --check`、funnel と dashboard の `vm.Script`
- 非エミュレータの全スイート、`x-shop` 再起動、HTTP、待機予約
- 本番 DB へ書かず、固有立場だけの試作と、一次体験 1 行を足した試作を 1 回ずつ行う
