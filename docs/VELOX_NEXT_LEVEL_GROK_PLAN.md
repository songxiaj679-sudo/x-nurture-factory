# VELOX AI 世界最高水準ブラッシュアップ実装計画 ＆ GROK 指示書

> **作成日**: 2026-11-18  
> **対象リポジトリ**: `/home/songxiaj679/x-nurture-factory`（本番ドメイン `https://veloxpostapp.com` / PM2プロセス `x-shop`）  
> **目的**: VELOX AI を「安全に自動投稿できるツール」から、**① 読者にとって毎日保存・返信したくなる一次価値があり、② お客様にとって最小の手間で信頼・ファン・商談が増え続ける世界一の AI パートナー**へ引き上げる。  
> **前提**: 本ドキュメントの診断・設計は実コードおよびライブ PM2 ログ（`x-shop`）照合済みである。未検証の推測仕様は含めない。

---

## 0. GROK 絶対厳守事項（実装時の不変ガード）

Grok は本仕様を実装する際、以下の安全境界を**1ミリも緩めないこと**。

1. **養殖・ブラウザ自動化系コードとの完全分離**:
   - `src/admin.js`、`src/setup_worker.js`、`src/batch_engine.js`、`src/reply_promo_engine.js`、`src/account_state.js`、`src/iproyal.js`、`src/camoufox_runner.py`、`src/patchright_runner.py` 等の非公式ブラウザ／養殖系コードには一切触れない・SaaS側から import しない。
2. **X 開発者ポリシー（Automation Rules）と安全ロック維持**:
   - [src/official_api_client.js](file:///home/songxiaj679/x-nurture-factory/src/official_api_client.js#L1020-L1026) の `runOfficialAutonomousEngagement()` は引き続き **`{ ok: false, reason: 'x_approval_required' }` でフェイルクローズ維持**（[tests/engagement_approval_safety.test.js](file:///home/songxiaj679/x-nurture-factory/tests/engagement_approval_safety.test.js) を絶対に壊さない）。
   - 能動的なキーワード検索リプライ・無差別メンション・他者投稿への自動営業は一切作らない。返信支援は**「自アカウント宛て直接メンション／自投稿へのリプライ」**かつ **Phase 1＝人間最終承認1クリック送信** に限定する。
3. **非捏造・規約・所有者分離ガードの維持**:
   - [src/post_policy_guard.js](file:///home/songxiaj679/x-nurture-factory/src/post_policy_guard.js) および [src/draft_verifier.js](file:///home/songxiaj679/x-nurture-factory/src/draft_verifier.js) の数値根拠・AI定型句・URL禁止チェックを緩めない。ページ・お客様入力に存在しない数値・体験談・導入実績・成果保証を創作しない。
   - `isHumanOverride: true` の予約ジョブは `prepareNextPost`・`cancelOtherPendingJobs`・`retargetNextPendingJob` から絶対に上書き・削除しない。
   - 全 API で `resolveSessionUser(db, req)` と `userId` 所有権チェック、および [src/operated_accounts.js](file:///home/songxiaj679/x-nurture-factory/src/operated_accounts.js) の `officialApiOperationAllowed()` を必ず通す。
4. **既存テスト互換性**:
   - 既存テストを弱めたりアサーションを緩めたりして通さない。既存契約を守りながら新規テストで拡張分を検証する。

---

## 1. 実コード・ライブ稼働ログに基づく現状診断（なぜ今ここを直すか）

実ファイルおよび本番 `x-shop` ログから、以下の**5つの構造的もったいない点（配線切れ・実エラー・UX不足）**が確認されている。

| 分類 | 現状のコード事実・ログ根拠 | 読者／お客様への悪影響 |
| :--- | :--- | :--- |
| **1. メタプロンプト学習が空転** | [src/meta_prompt_optimizer.js](file:///home/songxiaj679/x-nurture-factory/src/meta_prompt_optimizer.js#L153-L263) の `validateDirectivesSafety` が不変ルール文言の一字一句一致を要求するため、LLM提案が毎回弾かれ、ログに `LLM提案が安全制約チェックに不合格のためフォールバック実行` が記録されている。さらに、保存された `saas_users/{userId}.promptDirectives` を [prepareNextPost](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2582-L2730) と [src/next_post_draft.js](file:///home/songxiaj679/x-nurture-factory/src/next_post_draft.js) が読んでいない。 | 実測から「何が伸びて何が読まれなかったか」を学習しても、次回投稿のプロンプトに一切反映されない。 |
| **2. エピソード記憶＆MAP-Elites未接続** | [src/autonomous_promo_ai.js](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2257) は `episodic_memories` を書き込み、[L2326-L2343](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2326-L2343) は `h.mapElitesCellId` がある場合に `registerPostPerformanceAndReflect` を呼ぶが、`prepareNextPost` は `queryRelevantEpisodes` / `formatEpisodesForPrompt` / `sampleFromMapElitesArchive` を呼ばず `mapElitesCellId` も保存していない。 | 自アカウントの過去の当たり構成（Few-Shot）や失敗パターンが新規生成に活きない。 |
| **3. ランタイム異常ログが残存** | 稼働エラーログで ① `[Ensure Next] USR-MVUA1GLP-D640: Cannot read properties of undefined (reading 'alpha')`、② `[Context Radar] This operation was aborted`（[context_radar.js](file:///home/songxiaj679/x-nurture-factory/src/context_radar.js#L20) の `timeoutMs: 8000` 不足）、③ `[Autopilot Post History Index Error] 9 FAILED_PRECONDITION`、④ `[FreeExperience Error]` が発生。 | 稼働ユーザーの次回予約補充失敗・生成遅延・トレンド反映漏れが起きる。 |
| **4. 読者中心の磨き込み不足** | [next_post_draft.js](file:///home/songxiaj679/x-nurture-factory/src/next_post_draft.js#L344-L363) は `audienceQuestions`（[audience_questions.js](file:///home/songxiaj679/x-nurture-factory/src/audience_questions.js)）を `briefPrompt` に組み込まず文字列化JSONで末尾添付のみ。Critic スコアも「specificity, voice fit, anti-sales」の3項目のみで「読者が保存したくなる実益・1行目フック・可読性」が明示採点されていない。 | 「悪くはないが、わざわざ保存・返信したくなる強い実益」まで届ききらないことがある。 |
| **5. 顧客の対話・編集UX・一次情報不足** | ① 予約中ジョブの本文をダッシュボードで直接微調整する `edit-draft` UI が無い。② [getOfficialMentions](file:///home/songxiaj679/x-nurture-factory/src/official_api_client.js#L1141) は裏で動くが、顧客画面で読者リプライを見て AI 提案で1クリック返信する導線が無い。③ お客様が自社の実務経験メモ・NGワードを添える欄が無い。④ [weekly_growth_report.js](file:///home/songxiaj679/x-nurture-factory/src/weekly_growth_report.js#L73-L82) の来週方針が固定テキスト。 | 「自分の分身らしい生々しい一次情報」「読者との双方向会話によるファン化・商談化」の最終ピースが欠けている。 |

---

## 2. 全体実装計画（Workstream A 〜 E）

推奨実装順序は **A → B → C → D → E**。各 Workstream 完了ごとに単体テストと構文チェックを通すこと。

---

### Workstream A（最優先 P0）：自己進化学習ループの完全接続 ＆ 実ログ障害の根絶

#### A-1. `meta_prompt_optimizer.js` の LLM最適化正常化 ＋ 本番生成への注入
* **対象**:
  * [src/meta_prompt_optimizer.js](file:///home/songxiaj679/x-nurture-factory/src/meta_prompt_optimizer.js#L153-L269)
  * [src/autonomous_promo_ai.js](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2582-L2730)
  * [src/next_post_draft.js](file:///home/songxiaj679/x-nurture-factory/src/next_post_draft.js#L153-L355)
* **実装仕様**:
  1. `validateDirectivesSafety(proposedDirectives)` の既存シグネチャ・不変ルール改ざん拒否仕様（[tests/meta_prompt_optimizer.test.js](file:///home/songxiaj679/x-nurture-factory/tests/meta_prompt_optimizer.test.js#L18-L40)）は**一切緩めない**。
  2. 新規純粋関数 `validateMutableDirectives(mutableList)` を追加し、LLM には **可変ルール（`mutableDirectives`: 最大4件）だけ**を JSON 出力させる：
     - `isImmutable` は必ず `false` とし、各ルール本文が安全禁止語（例: `URL.*直貼り|リンク.*本文|誇張|保証する表現` 等）に違反しないか検査。
     - 既存の不変ルール 3件と結合：`const assembled = restoreMandatoryDirectives(validMutables)` → 最後に既存 `validateDirectivesSafety(assembled)` を必ず通してから返す。
  3. [prepareNextPost](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2650-L2727) で `user.promptDirectives` を `restoreMandatoryDirectives(user.promptDirectives)` で読み込み、可変ルール部分（最大4件）を `draftNextPostText({ ..., learnedDirectives })` へ渡す。
  4. [next_post_draft.js](file:///home/songxiaj679/x-nurture-factory/src/next_post_draft.js) は受け取った `learnedDirectives`（信頼済み社内学習ルール）を `briefPrompt` / `candidatePrompt` の執筆ガイドへ差し込む（`promptDirectives` テキスト長は合計600文字以内にクランプ）。

#### A-2. エピソード記憶 (`episodic_memory_store.js`) ＆ `MAP-Elites` (`map_elites_memory.js`) の本番配線
* **対象**:
  * [src/autonomous_promo_ai.js](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2649-L2788)
  * [src/next_post_draft.js](file:///home/songxiaj679/x-nurture-factory/src/next_post_draft.js)
* **実装仕様**:
  1. **エピソード記憶読込**: `prepareNextPost` 内で自アカウント専用のサブコレクション `db.collection('saas_users').doc(userId).collection('episodic_memories').limit(30).get()` を読み込む（テスト時や未保存時は空配列フォールバック。他ユーザーデータは絶対に読まない）。
  2. `queryRelevantEpisodes({ angle: genes.angle, keywords: extracted.brandKnowledge?.terminology || [], limit: 2 }, userEpisodes)`（件数が 0 件のときは一般汎用テンプレートに引きずられないよう `BASELINE_EPISODES` は自動注入せず `userEpisodes` のみ使用）で自アカウントの勝ち例最大2件・失敗例最大2件を抽出し、`formatEpisodesForPrompt` で引用隔離整形して `draftNextPostText` に渡す。
  3. **`mapElitesCellId` の保存**: `prepareNextPost` が保存する `autopilot_jobs` ペイロード（[L2744-L2781](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2744-L2781)）に `mapElitesCellId` を付与する。具体的には `sampleFromMapElitesArchive(userId, { allowMutation: true })` をベストエフォート（例外時は無視・タイムアウト影響なし）で参照するか、`genes` × `voiceProfile.stagePosture` から一貫した `mapElitesCellId` を記録し、`harvestTweetMetricsAndEvolveKnowledge` の `registerPostPerformanceAndReflect`（[L2329](file:///home/songxiaj679/x-nurture-factory/src/autonomous_promo_ai.js#L2329)）が24時間凍結データ受領時に確実に発火・学習するようにする。

#### A-3. `.alpha` エラー根絶 ＆ `Context Radar` タイムアウト/遅延解消
* **対象**:
  * [src/bandit_optimization_engine.js](file:///home/songxiaj679/x-nurture-factory/src/bandit_optimization_engine.js#L355-L429)
  * [src/hybrid_saas_routes.js](file:///home/songxiaj679/x-nurture-factory/src/hybrid_saas_routes.js#L969-L976)
  * [src/context_radar.js](file:///home/songxiaj679/x-nurture-factory/src/context_radar.js)
* **実装仕様**:
  1. `chooseGenesForPost` 内の `account` と `slot` を `Object.create(null)` で生成し、`__proto__`/`constructor`/`toString` 衝突を完全に排除。`decay(store)` 内は `if (!cell || typeof cell !== 'object' || !Number.isFinite(cell.alpha) || !Number.isFinite(cell.beta)) continue;` を入れ、`touch` / `add` でも string 型変換・finite 値チェックを行う。`hybrid_saas_routes.js` の `[Ensure Next]` ログにエラーメッセージだけでなく発生行（`err.stack` 先頭2行）を出す。
  2. [src/context_radar.js](file:///home/songxiaj679/x-nurture-factory/src/context_radar.js#L20):
     - `web_search` 呼び出しの `timeoutMs` を `8000` → **`18000`** に引き上げ。
     - さらに `prepareNextPost` では、キャッシュ有効なら即利用、キャッシュ切れの場合は投稿生成のクリティカルパスを長時間ブロックしないよう **`Promise.race` 上限（または非同期バックグラウンド更新＋タイムアウト時は前回のやや古いキャッシュを許容/フォールバック）** として生成エラー・遅延を防ぐ。

---

### Workstream B（最優先 P0）：「読者に役立つ・保存される」文章生成品質の飛躍

#### B-1. 読者ベネフィット中心の ブリーフ ＆ 5軸 Critic ルーブリック
* **対象**:
  * [src/next_post_draft.js](file:///home/songxiaj679/x-nurture-factory/src/next_post_draft.js#L153-L395)
  * [src/luxury_web_funnel.js](file:///home/songxiaj679/x-nurture-factory/src/luxury_web_funnel.js#L367-L421)
* **実装仕様**:
  1. **読者質問 (`audienceQuestions`) の構造統合**:
     - `draftNextPostText` は `contextSignals.questions`（読者が実際にリプライ等で聞いてきた疑問）を受け取ったら、`candidatePrompt` 末尾に丸投げせず、`briefPrompt` の入力欄へ明確に渡す（「読者の実際の疑問があるときは、そのうちの1つに真正面から答える構成を優先する」）。
  2. **読者の「持ち帰り（Reader Payoff）」設計**:
     - `briefPrompt` の出力 JSON スキーマに `"readerPayoff"`（読者が今日から現場で使える具体的判断基準・チェックポイント・視点 1つ）と `"hookAngle"`（1行目のスクロール停止切り口）を追加（後方互換フォールバック維持）。
     - 宣伝枠（`explicit_promo_offer`）以外では「自社製品の紹介」を主目的にせず、**「読者が抱える実務上の誤解や詰まりどころを1つ解き明かす」** ことを厳格に指示する。
  3. **Critic 評価の 5軸精密化（`draftNextPostText` L361-368）**:
     - 現在の 1文採点プロンプトを以下の 5観点（合計 100点満点）＋最短改善ヒント付きにアップグレード：
       - `readerUtility`（30点）：専門外や忙しい読者でも持ち帰れる実務上の学びがあるか
       - `hookAndFlow`（25点）：1行目が抽象挨拶でなくスクロールが止まり、スマホで読みやすい改行リズムか
       - `truthAndSpecificity`（20点）：ページ事実・文脈に根ざし、根拠なき数字や一般論になっていないか
       - `voiceFit`（15点）：`accountRole`（公式ブランド品格 vs 実践者トーン）とお客様指示に完全一致するか
       - `antiPitch`（10点）：不自然な売り込み感・AI定型臭（「いかがでしたでしょうか」「保存必須」等）が無いか
     - `accepted.length >= 2` のときに各案を採点し、`score < 72` の場合は critic が返した `weakness`（例：「1行目が一般論すぎる」）を `repairHint` に合流させて 1回だけ外科的修復を行う。修復失敗時でも現行の `fallbackAccepted` を安全維持。
  4. **無料デモ (`/api/funnel/free-experience`) の 500 エラー根絶**:
     - [src/luxury_web_funnel.js](file:///home/songxiaj679/x-nurture-factory/src/luxury_web_funnel.js#L367-L390) で 1回目の `draftNextPostText({ tier: 'fast', skipCriticScore: true })` が `PostConstraintError` 等で落ちた場合、原因（例：`too_short` / `ungrounded_number`）を `rethinkFeedback` に載せて `tier: 'quality'`（timeoutMs: `30000`）で **1回自動再試行** する。それでも通らない場合のみ正直な案内メッセージ（HTTP 422/502、作り話なし）を返し、無用な 500 失敗ログを減らす。

---

### Workstream C（優先 P1）：お客様の「一次情報・NG制御・投稿前コントロール」体験の完成

#### C-1. お客様一次情報（実体験メモ・絶対NGワード）の取り込み ＆ SPA LP救済
* **対象**:
  * [src/hybrid_saas_routes.js](file:///home/songxiaj679/x-nurture-factory/src/hybrid_saas_routes.js#L1430-L1488) (`/api/autopilot/save-setup` 等)
  * [src/lp_knowledge_extractor.js](file:///home/songxiaj679/x-nurture-factory/src/lp_knowledge_extractor.js#L208-L245)
  * [src/next_post_draft.js](file:///home/songxiaj679/x-nurture-factory/src/next_post_draft.js)
  * [views/dashboard_view.html](file:///home/songxiaj679/x-nurture-factory/views/dashboard_view.html)
* **実装仕様**:
  1. **`saas_users/{userId}` 新規任意フィールド**:
     - `brandContextNotes`（文字列・最大800字）：お客様自身の現場メモ、開発裏話、よくあるお客様からの質問（**お客様本人が書いた一次事実**）。
     - `ngTopics`（文字列または配列・最大400字）：絶対に触れてほしくない他社名、価格話題、言い回し（NG表現）。
  2. `POST /api/autopilot/save-setup` および設定画面で保存できるようにし、`draftNextPostText` へ渡す。さらに `draft_verifier.js` に `ngTopics` チェック（設定された禁止語が含まれたら決定論的監査で弾いて再生成）を追加する。
  3. **LP抽出フォールバック通知（`lp_knowledge_extractor.js`）**:
     - 取得本文（`stripTags` 後）が 250文字未満の React/Next.js SPA 等では、`pageSummary.isThinSpa = true` フラグを付与する。ダッシュボードには「このページは動的表示が多いため、上の『実務メモ・補足』に特徴を2〜3行書くと精度が跳ね上がります」と誠実に案内する。

#### C-2. 予約投稿の「1タップ微調整・理由表示」UX
* **対象**:
  * 新規エンドポイント `POST /api/autopilot/jobs/:jobId/edit-draft`（[src/hybrid_saas_routes.js](file:///home/songxiaj679/x-nurture-factory/src/hybrid_saas_routes.js)）
  * [views/dashboard_view.html](file:///home/songxiaj679/x-nurture-factory/views/dashboard_view.html)（`#secJobs` 投稿予定カード）
* **実装仕様**:
  1. **バックエンド `POST /api/autopilot/jobs/:jobId/edit-draft`**:
     - `resolveSessionUser` 必須 + Firestore トランザクション内で `job.userId === sessionUser.userId` かつ `job.status === 'pending'` を検証。
     - 受け取った `tweets`（文字列または文字列配列）に対し、`sanitizePostOrReplyText`、`customer_post_state` 長さチェック、`post_policy_guard.inspectPostCompliance` を実行（違反時は理由付き 400 を返す）。
     - 合格したら `text` / `text_en` / `tweets` / `tweets_en` / `isThread` を更新し、**`isHumanOverride: true`・`editedByHumanAt: new Date()`** を設定して AI 自動上書きから保護する。
  2. **ダッシュボード UI**:
     - 予定投稿カードに「✏️ 少し直す」「✨ 別案にする」「🚀 今すぐ投稿」の整理されたアクションと、`portfolioRole` + `customerReason` に基づく **「この投稿の狙い（例：保存されやすい実務手順 × お客様の実務メモ反映）」** を 1行バッジ表示する。

---

### Workstream D（優先 P1）：X 規約 100% 準拠「読者との対話 Copilot（Phase 1：承認式メンション返信）」

> **なぜ Phase 1 から始めるか**: X のルール上、未承認のまま第三者へ自動リプライを送る仕組みはアカウント凍結リスク・審査否認リスクが高い。まず「自アカウントに届いたリプライ／メンションだけを集め、AIが返信下書きを作り、お客様が1クリックで送信確定する」方式にすれば、**追加審査なし・規約リスクゼロ**で双方向エンゲージメント（Xアルゴリズム最重視シグナル）を実現できる。

* **対象**:
  * [src/official_api_client.js](file:///home/songxiaj679/x-nurture-factory/src/official_api_client.js)（`replyToOfficialTweet` ヘルパー確認・追加、`runOfficialAutonomousEngagement` の安全ロックは絶対に触らない）
  * [src/hybrid_saas_routes.js](file:///home/songxiaj679/x-nurture-factory/src/hybrid_saas_routes.js)
  * [views/dashboard_view.html](file:///home/songxiaj679/x-nurture-factory/views/dashboard_view.html)
* **実装仕様**:
  1. **受信メンション同期 ＆ 取得 (`GET /api/autopilot/mentions`)**:
     - `resolveSessionUser` + OAuth2 資格情報がある場合に `getOfficialMentions(creds, 15)` を呼び出し、**他者からの受信メンション／自投稿へのリプライのみ**（自分自身の投稿・リポストは除外）を `saas_users/{userId}/inbound_mentions/{tweetId}` にキャッシュ（または 5分間メモリ/Firestore キャッシュ）。
  2. **返信下書き 2案生成 (`POST /api/autopilot/mentions/:tweetId/draft-replies`)**:
     - 入力元ツイート（受信メンション）を `sanitizeExternalText` でインジェクション無害化し、`brandKnowledge`・`voiceProfile`・`brandContextNotes` を踏まえて Grok（`tier: 'fast'` or `'quality'`）で **2種類の返信案** を生成：
       - 案1：**共感＋丁寧な回答**（押し売り・リンクなし）
       - 案2：**相手の状況を深掘りする優しい問いかけ**（会話継続狙い）
     - 生成物には必ず `runDeterministicAudit` / `inspectPostCompliance` 相当の文字数・規約チェック（URL禁止、捏造禁止、相手のトーンに寄り添う）を通す。
  3. **人間最終承認送信 (`POST /api/autopilot/mentions/:tweetId/send-reply`)**:
     - 本人認証＋`officialApiOperationAllowed`＋規約チェックを通した後、X 公式 API v2 (`POST https://api.twitter.com/2/tweets` body `{ text, reply: { in_reply_to_tweet_id: tweetId } }`) で 1通だけ送信し、`inbound_mentions/{tweetId}` を `repliedAt`・`replyTweetId` 付きで更新（**二重返信防止ガード**必須）。
  4. **ダッシュボード UI**:
     - 「💬 読者からの返信・メンション」セクションを追加（未返信件数バッジ・相手のコメント表示・「AIで返信案を作る」ボタン・編集可能なテキストエリア・「この内容で返信を送信」ボタン）。

---

### Workstream E（優先 P1〜P2）：週間レポート実用化・視覚化・数千社向け基盤分離

#### E-1. 週間レポートの「具体的改善アクション」提示 ([src/weekly_growth_report.js](file:///home/songxiaj679/x-nurture-factory/src/weekly_growth_report.js))
* **仕様**:
  - 既存の `totalPosts`, `measuredPosts`, `bestSlotAnalysis`, `worstSlotAnalysis`, `councilScore: null` 契約とテスト互換（[tests/dashboard_language.test.js](file:///home/songxiaj679/x-nurture-factory/tests/dashboard_language.test.js) 等）を完全維持した上で、`geneSummary`（切り口別実績）と `hourSummary`（時間帯別実績）の計測済み件数が十分な場合（例：凍結済み投稿 4件以上）、因果を断定しない誠実表現のまま **「今週反応が高かったテーマ上位・低かったテーマ」「来週の実験提案（例：『手順解説』枠を増やすか『問いかけ』を増やすか）」** を `recommendedExperiments`（JA/EN）として返し、ダッシュボードに表示する。

#### E-2. 構造化図解カード (`src/visual_card.js`) の安全ステップアップ
* **仕様**:
  - 将来 `X_MEDIA_WRITE_ENABLED=true` を使う段階向けに、[src/visual_card.js](file:///home/songxiaj679/x-nurture-factory/src/visual_card.js) の `groundedLine()` が保証した**確定テキスト・確定数値だけ**を使ってクリーンな 1200×675 SVG → PNG カード（チェックリスト / Before-After 構造図）を生成する純粋レンダラーを追加（X投稿時は `media/upload` 検証後に機能フラグで段階解放）。

#### E-3. 数千アカウント対応のプロセス分離（API × ワーカー分離）
* **対象**: [src/shop.js](file:///home/songxiaj679/x-nurture-factory/src/shop.js)、[src/hybrid_saas_routes.js](file:///home/songxiaj679/x-nurture-factory/src/hybrid_saas_routes.js#L1111-L1118)、[ecosystem.config.js](file:///home/songxiaj679/x-nurture-factory/ecosystem.config.js)
* **仕様**:
  - すでに `registerHybridSaasRoutes(app, { runWorker })` が実装されているため、将来トラフィックが急増した段階で以下へスムーズに切り替えられるようワーカーエントリー（`src/saas_worker.js`）と環境変数（`DISABLE_INLINE_AUTOPILOT_WORKER=true`）を整備：
    - `x-shop`（API・UI サーバー）：`DISABLE_INLINE_AUTOPILOT_WORKER=true` で複数インスタンス（Cluster モード）起動可。
    - `x-saas-worker`（バックグラウンド専用 1インスタンス）：`startAutopilotJobRunner()` のみを稼働＋Firestore ロックによる多重起動ガード＋顧客単位 OAuth 429 バックオフジッター。

---

## 3. 検証・受け入れ基準（各 Workstream 共通）

Grok は作業完了後、必ず以下を全て実行してパスを確認すること：
1. **構文チェック**: 変更した全 `.js` に `node --check`、HTML（`views/funnel_index.html`, `views/dashboard_view.html`）内インライン `<script>` に Node `vm.Script` チェックを実施してエラー 0 件。
2. **新規＋既存テスト全件合格**:
   - Workstream ごとに新規ユニットテスト（`node:test`）を作成し、既存テスト一式（特に `meta_prompt_optimizer.test.js`, `engagement_approval_safety.test.js`, `autopilot_worker_capacity.test.js`, `autopilot_setup_save.test.js`, `dashboard_language.test.js`, `homepage_v51_copy.test.js`, `audit_fix_verification.test.js`, `velox_polish_and_scaling.test.js` 等）が **改変・緩和なしで全件合格**すること。
3. **PM2 反映 ＆ 実機ログ監査**:
   - `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env`
   - `pm2 logs x-shop --lines 50 --nostream` で `Cannot read properties of undefined (reading 'alpha')` や `LLM提案が安全制約チェックに不合格`、`FreeExperience Error` 等の新規エラーが出ないこと。

---

## 4. GROK へ渡す実行指示プロンプト（そのままコピーして送信可）

```text
あなたは /home/songxiaj679/x-nurture-factory のシニアスタッフエンジニアです。
ワークスペース内の /home/songxiaj679/x-nurture-factory/docs/VELOX_NEXT_LEVEL_GROK_PLAN.md を熟読し、そこに定義された絶対厳守事項（Section 0）と仕様（Workstream A 〜 E）に従って順番に実装してください。

【進め方ルール】
1. まず Workstream A と B をセットで実装し、各モジュールの単体テストを追加・修正して `node --test` と構文チェックを全パスさせてください。
2. 続けて Workstream C と D（人間の最終承認1クリック型の読者返信 Copilot・予約投稿インライン編集・一次情報/NGルール設定）を実装し、所有権分離（他ユーザーアクセスは403）と X ポリシー安全ロック（runOfficialAutonomousEngagement は x_approval_required 維持）のテストを必ず通してください。
3. 最後に Workstream E（週間レポート拡充、および将来のAPI/ワーカー分離スイッチ）を実装し、全テスト・HTMLインラインスクリプト検証を通してください。
4. 既存テストのアサーションは一切緩めず、テストファイルや既存モジュールを編集する前に必ず対象コードを読んで契約を確認してください。
5. 完了したら、実際に変更したファイル・関数・実行したコマンドとその結果のみを正確に報告し、`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env` の実行案内または結果を示してください。
```

---

## 5. オーナー様（あなた）にご対応いただく作業一覧

コード外（クラウド設定・X管理画面・事業判断）でオーナー様に進めていただきたい項目は以下の通りです：

1. **【最優先・2クリックで完了】Firestore 複合インデックスの作成**
   - 本番エラーログに出ている以下 2 つのリンクを、Firebase ログイン済みブラウザで開いて「インデックスを作成」を押してください（数分で `[Autopilot Post History Index Error]` 警告が消え、検索負荷が下がります）：
     - インデックス1（`status` / `userId` / `postedAt`）：  
       `https://console.firebase.google.com/v1/r/project/tidal-airway-401213/firestore/indexes?create_composite=Clpwcm9qZWN0cy90aWRhbC1haXJ3YXktNDAxMjEzL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9hdXRvcGlsb3Rfam9icy9pbmRleGVzL18QARoKCgZzdGF0dXMQARoKCgZ1c2VySWQQARoMCghwb3N0ZWRBdBACGgwKCF9fbmFtZV9fEAI`
     - インデックス2（`status` / `userId` / `updatedAt`）：  
       `https://console.firebase.google.com/v1/r/project/tidal-airway-401213/firestore/indexes?create_composite=Clpwcm9qZWN0cy90aWRhbC1haXJ3YXktNDAxMjEzL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9hdXRvcGlsb3Rfam9icy9pbmRleGVzL18QARoKCgZzdGF0dXMQARoKCgZ1c2VySWQQARoNCgl1cGRhdGVkQXQQAhoMCghfX25hbWVfXxAC`
2. **【X Developer Portal】本番アプリ権限と Automated ラベル方針の確認**
   - OAuth 2.0 権限に `tweet.read` / `tweet.write` / `users.read` / `offline.access` が揃っていること、および本番アクセス Tier の月間投稿/取得上限（ユーザー数が急増する場合に枠引き上げが必要になるか）を確認してください。
   - **自動リプライについて**: Phase 1（AIが返信案を作り、人が管理画面で1クリック送信）は追加審査なしですぐ運用できます。将来「完全自動送信（Phase 2）」を解放したい場合は、X アカウント側での `Automated` ラベル設定方針（顧客アカウントにもラベルを付けてもらう規約説明）と、X 開発者審査用の説明文（「受信メンションに対するオプトイン顧客サポート応答であり、無差別アウトバウンドではない」）の準備が必要です。
3. **【お客様目線の自社ドッグフーディング】**
   - Workstream C（実務メモ・NGワード機能）実装後、まず自社アカウント（`@VeloxSystemsHQ` 等）で「現場で実際に体験した課題メモ 3つ」「絶対に書きたくないNG表現」を管理画面に入力し、生成される投稿が本当に「読者の役に立つリアルな投稿」になるかテストしてください。
4. **【Stripe トライアル＆ワンクリック解約の最終実機チェック】**
   - テスト用カードまたは実決済で「登録 → トライアル開始 → 管理画面からの1ボタン解約（`自動更新停止済み（次回請求なし）`）」の通し確認を 1度行うと完璧です。
