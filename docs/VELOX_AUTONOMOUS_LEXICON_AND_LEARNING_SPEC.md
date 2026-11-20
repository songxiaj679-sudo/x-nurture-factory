# GROK 実装仕様書（推敲版 v2）：VELOX AI 自律意思決定エンジン ＆ 独自進化辞書（Living Editorial Lexicon）

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
前提: `VELOX_AUTONOMOUS_EDITORIAL_INTELLIGENCE_SPEC.md`（PID 2198193）の実装および本番実測結果を徹底検証・推敲した結果を踏まえ、**「毎回ゼロからプロンプトを当てずっぽうに頼る」段階から「VELOX AI が独自辞書と24h実績を根拠に自ら戦略・文体・結び・回避表現を決定し、投稿ごとに自己学習して賢くなる」段階** へ引き上げる。

---

## 🔍 本番実測・実コード精査で見つかった 4つの本質ギャップ（推敲理由）

1. **生成側が「すでに保存している学習データ」を読み込んでいない**：
   - `src/autonomous_promo_ai.js` の `_harvestTweetMetricsAndEvolveKnowledgeCore`（L2293-2520）は `user_marketing_knowledge`（`dpoPreferencePairs`・`avoidKeywords`・`negativeList`・`successfulCases`・`failedCases`）を保存しているが、`prepareNextPost`（L2637-2913）および `retargetNextPendingJob`（L310-415）はこれらを一切参照していない。
   - `prepareNextPost` L2798-2802 は `sampleFromMapElitesArchive` から `sampled.cellId` だけを取り出し、`sampled.directive`・`sampled.referenceHook` を捨てている。
2. **学習の中身が「ダミー文字列／空文字」で止まっている**：
   - `src/autonomous_promo_ai.js` L2296-2305 の `episodic_memories` 生成は `lessonLearned` が空文字 `''`、L2486/2492 の DPO ペア `whyWon` / `whyLost` も固定文言になっている。
   - `src/meta_prompt_optimizer.js` の `analyzePerformanceClusters`（L81-145）は「数字有無・冒頭30字以内・http有無」の3つしか分析しておらず、文体・思考型・切り口・結び方を学習していない。
3. **VELOX AI 独自の「生きている辞書（語彙・構文・回避表現）」がない**：
   - 本番 `POST /api/funnel/free-experience` の最新実測（PID 2198193）でも、以下の AI クセがまだ残った：
     - `@VeloxSystemsV4`（日本語）：本文が `"〜設計にある。"` `"〜明らかだ。"` `"仕組みがここにある。"` と翻訳エッセイ調（常体）になり、最後だけ `"この構造を自社の運用に当てはめたとき、何が変わると感じますか。"` という講義調疑問文で分裂した（文言1つを禁止すると別表現の「何が変わると感じますか」へ逃げる）。
     - `@VeloxSystemsHQ`（英語2本ツリー）：2本目が1本目の内容を別の言葉で言い換えて膨らませただけ（反復）になった。
4. **「今回の1本をどう戦うか」を VELOX AI が毎回自律決定していない**：
   - 直近投稿が「？」終わり続きか、文体（敬体/常体）がどちらか、どの語彙を直近で使いすぎているかを、生成前に VELOX AI 自身が決定して渡す機構が必要。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **トピックのハードコード禁止**：特定分野名や固定テンプレートを埋め込まず、すべてのアカウント・領域に効く**抽象構造（思考型・文体規則・辞書学習・反復抑止）**を自律稼働させる。
2. **LLM呼び出し予算の厳守**：`draftNextPostWithMeta`（`next_post_draft.js`）内の LLM 呼び出し構造（`brief` → `candidates` → `critic` → `repair`）に**追加の LLM コールを増やさない**（決定エンジン自体は 0ms 純粋ロジック、辞書蒸留は24h成熟バッチで新規投稿がある時だけ 1回実行）。
3. **既存テスト互換 100% 維持**：
   - `tests/velox_polish_and_scaling.test.js`（`callCount === 4` と `callCount === 3`）、`tests/editorial_intelligence.test.js`、`tests/autonomous_evolution_core.test.js`（`map_elites_memory.js` の `/因果関係は未検証/` アサーション）、`tests/meta_prompt_optimizer.test.js`、`tests/episodic_memory_store.test.js`、`tests/phase3_portfolio_verifier.test.js`、`tests/autopilot_setup_save.test.js`、`tests/homepage_v51_copy.test.js`、`tests/dashboard_language.test.js` を絶対に壊さない。
4. **日英完全分離**：JA/EN を厳格に分け、英語生成に日本語を1文字も混ぜない。

---

## Workstream 1: VELOX 独自進化辞書 ＆ 自律意思決定モジュール新設（`src/editorial_lexicon_engine.js`）

新規ファイル `src/editorial_lexicon_engine.js` を作成し、以下の **2階層辞書 + 自律決定エンジン + 学習蒸留** を実装する。

### 1-A. Tier 1: 全アカウント共通「表現・思考クラフト辞書（Shared Editorial Lexicon）」
Firestore `collective_intelligence/editorial_lexicon_v1`（メモリフォールバック＆ベースラインシード付き。テスト環境では `!targetDb && isTest && !FIRESTORE_EMULATOR_HOST` で本番DBを読まないこと）。

以下の構造を持つ：
1. **`styleAntiPatterns`**（禁止ワード単体ではなく「失敗構文パターン × 何がダメか × どう直すか」の辞書）：
   - 日本語エッセイ翻訳臭・文体混在（例：`〜がここにある` / `〜は明らかだ` / `これが設計の核心だ` / 敬体投稿の中に常体「だ・である」が混ざり最後だけ疑問文になる現象）
   - 逃避型の講義まとめ質問（例：`〜と感じますか` / `どう考えますか` / `What changes for your team?`）
   - スレッド2本目の同語反復（1本目と同じ論旨の言い換え拡張）
   - わざとらしい学術ラベル前置き（`〇〇学によると` 等）
2. **`cognitiveMoves`**（思考・展開の型ライブラリ）：
   - `mechanism_translation`（裏の因果・仕組みを日常のイメージへ翻訳）
   - `inversion_contrast`（よくある浅い通説 vs 実際の構造の対比）
   - `constraint_boundary`（どこから壊れるか・適用限界とトレードオフ）
   - `practitioner_rule`（迷いを切る実戦の判断基準 1点）
   - `micro_observation`（細部の実例から原理を抽出）
   ※ 各型に `winScore` / `sampleCount`（初期重み + 24h実測からの重み更新）を持たせる。
3. **`endingMoves`**（結び方のローテーション型）：
   - `verdict_cut`（余韻やまとめ文なしで核心の1文で言い切る）
   - `condition_edge`（「ただし〇〇の条件下では逆転する」といった例外・境界条件で止める）
   - `concrete_check`（読者が確認すべき具体的な1対象を示して終える）
   - `genuine_tension`（賛否・設計判断が割れる自然な問いを1文だけ置く）

### 1-B. Tier 2: アカウント固有「ドメイン生辞書（Account Domain Lexicon）」
`user_marketing_knowledge/{userId}` の `domainLexicon` フィールド（既存スキーマと完全共存）として保持・更新する：
```js
{
  schemaVersion: 1,
  domainTerms: [],         // そのアカウントのドメインで実際に機能する専門語・比喩（最大15件）
  winningExpressions: [],  // 24h上位投稿から抽出された「刺さった構造・表現メモ」（最大10件）
  retiredPhrases: [],      // 24h下位投稿・Criticリジェクト・直近反復から隔離された避けたい癖（最大15件）
  preferredRegister: '',   // 例: 'polite_ja' | 'plain_ja' | 'concise_en'
  moveScores: {},          // cognitiveMoves / endingMoves ごとの当アカウント適応スコア
  lastLexiconDigest: '',   // 再分析重複を防ぐハッシュ
  updatedAt: ''
}
```

### 1-C. 自律決定関数 `decideEditorialPlan(input)`（同期・純粋ロジック・0ms）
投稿生成の直前（`draftNextPostWithMeta` 冒頭）で **VELOX AI が自律判断を下す純粋関数** を実装する（テスト可能であること！）：

1. **文体ロック（`registerLock`）の決定**：
   - `voiceProfile.register`、`voiceProfile.accountRole`、`recentPosts` の実際の文末比率（`です/ます` 率 vs `だ/である` 率）から決定。
   - 日本語公式アカウントや過去投稿が敬体優勢なら `polite_ja` を選び、**「敬体（です・ます基調）で統一し、途中の『〜だ。』『明らかだ。』『ここにある。』混在を禁止」** と明示。常体優勢・個人短文なら `plain_ja` に統一。
2. **結び方（`endingMove`）の自律ローテーション決定**：
   - `recentPosts`（直近3本）の最終文を検査し、**直近2本のうち1本でも `?` / `？` / `か。` で終わっていれば今回は疑問文締め（`genuine_tension`）を自律的に選択肢から外し、`verdict_cut` / `condition_edge` / `concrete_check` から選ぶ**。
   - 直近の結びと被らない `endingMove` を決定する。
3. **思考の型（`cognitiveMove`）の自律決定**：
   - `genes.angle`・`portfolioPlan.portfolioRole`・`domainLexicon.moveScores`・`sharedLexicon` の勝率を参照し、直近投稿と同じ思考型を下げて最も伸びやすい型を選択する。
4. **直近過密語の自動回避リスト（`autoRetiredFromRecent`）**：
   - `recentPosts`（直近5件）と `domainLexicon.retiredPhrases` を結合し、直近3件で2回以上使われた特徴的な抽象語やAI癖（例：`トレードオフ`, `設計の核心`, `仕組みがここにある`, `見えます`, `感じますか`, `recalibrate`, `drift`）を抽出し、**今回限定で「使用回避（言い換え・別角度必須）」としてプロンプトに渡す**（ハードコード辞書ではなく、そのアカウントの直近出力から毎回動的に検出する！）。
5. **スレッド第2投稿の役割強制（`threadSecondMove`）**：
   - `shape.thread` が有効な場合、2本目に対して **「1本目の要約・同義言い換えは絶対禁止。1本目が成り立たない例外条件・具体的な失敗ケース・次の確認手順のどれか1つだけを新規追加すること」** を決定する。

### 1-D. 学習・辞書更新関数
1. **`recordSharedRejectionSignal({ reasons, texts, lang }, targetDb = null)`**（Best-effort・非同期・失敗しても生成を止めない）：
   - `draft_verifier` の `ai_slop` や Critic `< 72` が発生した際、リジェクト理由や繰り返された文末・定型癖を抽出し、個人/顧客固有情報を含めずに `collective_intelligence/editorial_lexicon_v1` の抑止シグナルへ蓄積する（テスト時はスキップ安全ガード必須）。
2. **`evolveAccountLexiconAndLessons({ userId, user, maturePosts, currentKnowledge, db })`**：
   - `_harvestTweetMetricsAndEvolveKnowledgeCore` から24hスナップショット確定投稿が2件以上あるときに呼ばれる。
   - 新しく確定した成熟投稿セットのハッシュ（`lastLexiconDigest`）が前回と同じなら **LLMを呼ばず即 return（0コスト・二重課金防止）**。
   - 差分があり `hasXaiKey()` が真のときだけ `completeJson({ tier: 'fast', timeoutMs: 15000 })` を1回呼び、当アカウントの勝者投稿 vs 敗者投稿を分析して：
     - `domainTerms`・`winningExpressions`・`retiredPhrases`・`preferredRegister`
     - 各投稿の具体的な勝因/敗因 **`pairInsight`（`whyWon` / `whyLost`）** と **`episodeLessons`**（`tweetId` ごとの1行教訓）
     を抽出・マージして返す（`user_marketing_knowledge/{userId}.domainLexicon` および `episodic_memories` の空だった `lessonLearned` に反映）。
   - API 未設定またはエラー時は決定論的フォールバック（文字数・文末疑問・直近反復からの簡易更新）で安全に動作する。

---

## Workstream 2: `next_post_draft.js` への自律決定 ＆ 文体統一 Critic 組み込み

1. `draftNextPostWithMeta` の引数に `editorialContext = null`（省略可：`domainLexicon`, `sharedLexicon`, `dpoPairs`, `avoidKeywords`, `mapElitesHint`）を追加する。
2. 冒頭で `const decision = decideEditorialPlan({ accountState, voiceProfile, portfolioPlan, genes, recentPosts: memory, domainLexicon: editorialContext?.domainLexicon, sharedLexicon: editorialContext?.sharedLexicon, shape })` を実行する（100%同期・LLM呼び出し数ゼロ増加！）。
3. `briefPrompt`・`draftPrompt`・`candidatePrompt` に `decision` の結果（`cognitiveMove`、`endingMove`、`registerLock`、`threadSecondMove`、`autoRetiredFromRecent`、および `editorialContext` にある過去の実際の勝ち/負け例 `dpoPairs` や `winningExpressions`）を注入する。
4. `systemRules(isEn)`（L292-296）へ以下を明確化：
   - 日本語・英語とも **1投稿内で文体（敬体「です/ます」と常体「だ/である」）を絶対に混在させない**。
   - `「仕組みがここにある」「〜は明らかだ」「これが核心だ」「何が変わると感じますか」「〜が見えてくる」` のような**翻訳エッセイ調の締め・講師疑問文を禁止**。
   - 2本スレッドの2本目は、1本目の言いたいことを別表現で繰り返さず、**例外・境界条件・反例・具体的手順のいずれか新しい情報だけを書く**。
5. **Critic 評価軸（L428-431）の追加**：
   - 文体一貫性（`registerConsistency`）と 2本目新規性（`threadProgression`）、および **講師質問・翻訳エッセイ文末への即 60点未満判定** を明記する。
   - `repairHint`（L447-454）でも `decision.registerLock` と `decision.endingMove` を再強調する。
   - Critic が `score < 72` でリジェクトした際、テスト環境以外で `recordSharedRejectionSignal` を非同期 best-effort 呼び出しする（`await` で失敗させない）。
   - ※ `if (!skipCriticScore && accepted.length >= 2 && hasXaiKey())` の条件と LLM 呼び出し回数は既存テストと完全互換を保つ。

---

## Workstream 3: `autonomous_promo_ai.js` の生成⇔学習サイクル完全直結

1. **`prepareNextPost`（L2780-2825）＆ `retargetNextPendingJob`（L310-415）**：
   - `getUserMarketingKnowledge(userId)` と `getSharedEditorialLexicon()` を安全に読み込み、`editorialContext` として `draftNextPostWithMeta` へ渡す。
   - `sampleFromMapElitesArchive(userId, ...)` の結果から `cellId` だけでなく **`directive`・`referenceHook`・`mode`** を `mapElitesHint` として `draftNextPostWithMeta` へ渡す（捨てない！）。
   - 生成されたジョブの `draftBriefSummary` に `cognitiveMove: decision?.cognitiveMove` / `endingMove: decision?.endingMove` / `registerLock: decision?.registerLock`（または `drafted.decision`）も記録し、後から分析できるようにする。
2. **`_harvestTweetMetricsAndEvolveKnowledgeCore`（L2293-2520）**：
   - 24h スナップショット確定投稿が2件以上揃った際、`evolveAccountLexiconAndLessons` を呼び出し：
     - `user_marketing_knowledge/{userId}` へ最新の **`domainLexicon`** を永続化。
     - `dpoPreferencePairs` の `whyWon` / `whyLost`（L2486, L2492）に、従来の固定文ではなく `evolveAccountLexiconAndLessons` が抽出した**実投稿ベースの勝因・敗因**をセットする（未抽出時のみ既存文へフォールバック）。
     - `episodic_memories` 保存時に `lessonLearned` が空にならないよう抽出教訓を書き込む。
     - `meta_prompt_optimizer` 呼び出し（L2413-2430）で `maturePerformancePosts` に `genes`・`portfolioRole`・`underlyingMechanism` を含め、`optimizePromptDirectives(currentDirectives, analysis, { lang: userData.aiTargetLang || 'ja' })` のように `lang` も渡す。

---

## Workstream 4: `meta_prompt_optimizer.js` ＆ `map_elites_memory.js`（テスト互換を守りつつ分析力向上）

1. **`src/meta_prompt_optimizer.js`**：
   - `analyzePerformanceClusters(posts)`（L81-145）で既存の3パターン抽出（`具体的数値`・`冒頭30字`・`本文内URL`）は **文言を含め100%そのまま残し**、追加で：
     - 文末疑問率の差（低反応群に疑問文締めが多い場合の失敗パターン抽出）
     - `genes.angle` / `portfolioRole` ごとの上位偏り抽出
     を追加する。
   - `optimizePromptDirectives`（L244-267）の LLM プロンプトで、`context.lang === 'en'` の場合は英語ルールを出力させ、また `context.domainLexicon` があればそれも踏まえて AI臭回避ルールを進化させる。
2. **`src/map_elites_memory.js`**：
   - `tests/autonomous_evolution_core.test.js` がアサートする **`/因果関係は未検証/` の文字列は `reflection` と `directive` に必ず残したまま**、構造上の特徴（`syntaxPrinciple`: 改行数・1行目文字数・疑問終止か断定終止か等の実データ特徴）を引数オプションまたは実テキスト計測から計算して記録する（固定文字列 `'記録済み投稿を参考に新しい表現を検討する'` の一律保存をやめる）。

---

## Workstream 5: 単体テスト・結合検証（実測必須）

1. 新規テスト追加（`tests/editorial_lexicon_engine.test.js` または `tests/editorial_intelligence.test.js` 拡充）：
   - `decideEditorialPlan` が直近投稿に疑問文締めがあるとき `endingMove` から `genuine_tension` を除外して `verdict_cut` 等を自律選択すること
   - `decideEditorialPlan` が `recentPosts` から直近反復表現を動的に `autoRetiredFromRecent` へ積むこと（ハードコード依存ではなく動的検出）
   - `decideEditorialPlan` が公式敬体アカウントで `registerLock` を `polite_ja` 相当に固定し、文体混在を抑止すること
   - `evolveAccountLexiconAndLessons` が同一 `digest` に対して再分析（無駄なLLM呼び出し）をスキップすること、および新規成熟投稿があるとき `domainLexicon` と `episodeLessons` を更新すること
   - `analyzePerformanceClusters` が既存アサーションを維持したまま `angles` / 疑問文偏りを分析すること
2. 構文チェック (`node --check`)：編集・新規作成した全 `.js` ファイル。
3. テスト実行 (`node --test --test-force-exit`)：
   - `tests/editorial_lexicon_engine.test.js`, `tests/editorial_intelligence.test.js`, `tests/velox_polish_and_scaling.test.js`, `tests/autonomous_evolution_core.test.js`, `tests/meta_prompt_optimizer.test.js`, `tests/episodic_memory_store.test.js`, `tests/phase3_portfolio_verifier.test.js`, `tests/phase2_autonomy_workspaces.test.js`, `tests/autopilot_setup_save.test.js`, `tests/bandit_optimization_engine.test.js`, `tests/lp_voice_phase2.test.js`, `tests/homepage_v51_copy.test.js`, `tests/dashboard_language.test.js`, `tests/simple_autopilot_transparency.test.js`, `tests/growth_phase.test.js`, `tests/autopilot_jobs_separation.test.js`
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後、本番 `POST /api/funnel/free-experience` で JA（`@VeloxSystemsV4`）・EN（`@VeloxSystemsHQ` 2本ツリー）・専門テーマ を再度 `curl` 検証し、**「何が変わると感じますか」「仕組みがここにある」等の文体分裂・英語2本目の重複反復が解消されていること**を確認して報告する。
