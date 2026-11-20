# GROK 実装仕様書：VELOX AI 全顧客アカウント共通「脱AIスロップ・自律的知性プロンプト＆Critic強化」

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
X で「自動化された＝AI量産の手抜き」と敬遠される事態を防ぎ、自社アカウント（`@VeloxSystemsHQ` / `@VeloxSystemsV4`）だけでなく **VeloxPost Cloud を使う全顧客アカウント** の投稿品質を一段引き上げる。  
トピックや言い回しをハードコードするのではなく、**VELOX AI が各アカウントの領域・声・過去実績に応じて「何が本質的な仕組み（メカニズム）か」「どこに読者がハッとする逆説・具体例があるか」を自律判断し、Grok API へ的確に指示・審査させる設計** へ進化させる。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **ハードコード禁止・自律判断優先**：特定ジャンル（「心理学」「コーディング解説」等）の定型テンプレートや禁止ワードを闇雲にハードコードしない。AI の広い知見を「そのアカウントの領域に合わせて自律的に引き出し、わざとらしい権威付け（例：『〇〇学に基づいて』等のメタ前置き）なしに鋭く分かりやすく言語化する」ことをプロンプト設計で実現する。
2. **日英完全分離（JA / EN 混在ゼロ）**：すべての新規/修正プロンプト・出力・UI提案候補は日本語（`ja`）と英語（`en`）の両系統を厳格に分ける。英語モードでは `containsJapaneseScript` ゼロを維持する。
3. **根拠限定・安全制約の厳守**：架空の日時・時刻・割合・未確認数値・初心者なりきり・本文内URL直貼り禁止は一切緩めない。
4. **既存テスト互換維持**：`tests/velox_polish_and_scaling.test.js`、`tests/phase3_portfolio_verifier.test.js`、`tests/meta_prompt_optimizer.test.js`、`tests/phase2_autonomy_workspaces.test.js`、`tests/autopilot_setup_save.test.js`、`tests/bandit_optimization_engine.test.js`、`tests/lp_voice_phase2.test.js` の既存契約（関数シグネチャ・必須エラー文言・フォールバック回数）を壊さない。

---

## Workstream 1: アカウント固有の「知性・思考の切り口」自律プロファイリング（`src/account_voice_profiler.js`）

### 現状の課題
- `resolveAccountVoiceProfile`（`src/account_voice_profiler.js` L75-132）は `register`・`firstPerson`・`signatureTopics`・`antiPatterns` のみを抽出し、「そのアカウントがどの専門領域で、どういう思考の切り口・説明スタイルを持つか」を定義できていない。
- 結果として、エンジニア・デザイナー・創業者・マーケターなどあらゆる顧客の投稿が同じ「無難なビジネスコラム調」に寄りやすい。

### 実装要件
1. `voice` オブジェクト（L93-109）および `completeJson`（L112-124）へ以下を追加する（API呼び出し回数は増やさず既存の1回で同時取得）：
   - `schemaVersion: 2`
   - `domainFocus`（80文字以内）：そのアカウントの `userPrompt`・`bio`・`brandKnowledge`・過去投稿から自律特定される専門領域・知的文脈（例：「分散処理と低遅延API設計」「B2B導入判断の意思決定コスト」等。未設定時は空文字ではなく文脈から推測、材料ゼロなら `""`）。
   - `thinkingLens`（120文字以内）：そのアカウントが複雑な事象をどう噛み砕いて語るかの自律定義（例：「抽象論ではなくボトルネックや因果構造・トレードオフを平易な具体例へ落として言い切る」）。
2. `cacheFresh(profile, user, now)`（L47-54）は、既存条件に加えて `profile.schemaVersion === 2` を満たさない旧キャッシュを再抽出対象にする（12時間TTLや `userPromptHash` / `xUsername` 一致条件は維持）。
3. `completeJson` のプロンプト（L115-116）で、`OfficialBrand` か `operator` かに加えて、**「学術用語やメタ前置き（『〇〇学によると』等）を振りかざさず、専門知識を自然な思考リズムで語るための `thinkingLens` と `antiPatterns`」** を生成させる。
4. 既存エクスポート（`resolveAccountVoiceProfile`, `detectOfficialBrandAccount`, `measureStylometry`, `stagePosture`）および `tests/lp_voice_phase2.test.js` の挙動は完全維持する。

---

## Workstream 2: 企画ブリーフ・執筆プロンプトの高度化（`src/next_post_draft.js`）

### 現状の課題
- `briefPrompt`（L170-215）が「実務上の誤解や詰まりどころを1つ解き明かす」に固定されており、`draftPrompt`（L271）も一律で「現場の担当者がXでそのまま読むリズム」と指定しているため、AI の持つ広い知見（アルゴリズムの構造・認知や経済の力学・意外なトレードオフ等）が活かされず、全顧客アカウントが「当たり障りのない事務メモ風」に均一化している。

### 実装要件
1. **`knowledgeLine`（L111-152）**：
   - `voice` JSON（L130-139）に `domainFocus: voiceProfile.domainFocus || ''` と `thinkingLens: voiceProfile.thinkingLens || ''` を追加する。
2. **`systemRules(isEn)`（L288-292）**：
   - 既存の安全規約（公式品格、架空日記・時刻・未確認数値の禁止、英語出力時の `hiragana, katakana, kanji`・全角記号禁止、2連疑問文・論文調締めの禁止）をすべて維持する。
   - **自律的知性＆脱・解説臭ルール**を追加する：
     - アカウントの専門領域（`voice.domainFocus` / `voice.thinkingLens`）に応じて、表面的な一般論ではなく**現象の裏にある因果構造・仕組み・設計上のトレードオフ・人間の行動原理**まで踏み込んで分かりやすく言語化すること。
     - ただし **「〜学に基づいて」「〜理論の観点では」「専門的には〜」「結論から言うと」のようなわざとらしい学術ラベル貼り・講義調の前置きは禁止**。原理そのものを、読者が直感的にイメージできる鋭い比喩・対比・具体構造へ翻訳してそのまま書くこと。
     - すべてのアカウントを一律「現場事務担当者」口調に押し込めず、`voice.register`・`voice.thinkingLens`・`userPrompt` に自律適合させること。
3. **`briefPrompt`（L170-215）& `readBrief`（L217-233）**：
   - 出力 JSON に以下 2項目を追加（既存 8キーは完全維持）：
     - `everydayAssumption`: 世間やタイムラインで繰り返されがちな浅い常識・通説
     - `underlyingMechanism`: その裏で実際に起きている本質的な仕組み・原理・トレードオフ（学問名を出さず仕組み自体を1文で定義）
   - `L191` / `L207` の固定表現を見直し、宣伝枠以外でも「① 難解な技術・アルゴリズムや原理の直感的な噛み砕き、② 通説（`everydayAssumption`）と仕組み（`underlyingMechanism`）の鋭い対比、③ 実務上のボトルネック解消」の中から、そのアカウントと時間帯に最も刺さる切り口を自律選択させる。
   - `readBrief` で `everydayAssumption`・`underlyingMechanism` をそれぞれ最大180文字にクリップして返す（`fallbackBrief` 互換維持）。
4. **`candidatePrompt`（L294-330）**：
   - 3候補（`a`, `b`, `c`）を同系統の無難な言い換えにせず、**知的アングルの異なる3案**として生成させる：
     - `a`（**構造・メカニズム解体**）：専門領域の仕組み・設計トレードオフ・見えない因果を、平易で鋭い言葉で直感的に理解させる案。
     - `b`（**通説の逆転・対比**）：`everydayAssumption` から入り、「なぜそれでは破綻するか／本当は何が効いているか」を `underlyingMechanism` で切り返す案（架空の日時・数値は禁止）。
     - `c`（**1点凝縮の判断軸**）：読者が思わず保存したくなる、無駄を削ぎ落とした現場・思考の原則を1点で言い切る案。
   - JSON スキーマの内部用語（`everydayAssumption` 等）をそのまま本文に出さないこと・学術名付けの前置きを入れないことを明記する。
   - なお英語時の `hiragana, katakana, kanji` 文言は `tests/velox_polish_and_scaling.test.js` のアサーションと整合させるため維持する。

---

## Workstream 3: Critic 審査基準の厳格化 ＋ 最小限の明確スロップ遮断（`src/next_post_draft.js`, `src/draft_verifier.js`）

### 実装要件
1. **`src/next_post_draft.js` Critic 採点（L422-437）**：
   - 発火条件（`!skipCriticScore && accepted.length >= 2 && hasXaiKey()`）と合格閾値（`score >= 72`）は既存テスト互換のためそのまま維持する。
   - 採点ルーブリックを「無難な合格」から「X タイムラインでプロが読む水準」へ引き上げる：
     - `originalInsightAndMechanism` (30): 誰でも書ける浅い一般論ではなく、本質的な因果・仕組み・鋭い視点があるか
     - `clarityWithoutPedantry` (25): 「〇〇学によると」「解説します」等のクサい前置きなしに、難解または本質的な内容がスッと頭に入るか
     - `hookAndFlow` (20): 1行目で指が止まり、冗長なテンプレ3箇条書きに逃げず最後までリズム良く読めるか
     - `truthAndSpecificity` (15): 確認済みの事実・方針と整合し、捏造数値や架空の体験談がないか
     - `voiceFit` (10): `voiceProfile`・アカウントの立場に忠実か
   - **明確な減点命令**：薄い一般論（「目標整理が大事」「継続が重要」等）、量産AI風の整いすぎた講義調、わざとらしい学問名の権威付け（「〇〇学に基づき」）を含む案は **60点未満** にし、`weakness` に具体的改善点（例：「表面的な一般論なので、なぜそれが起きるかの因果・仕組みまで踏み込むこと」）を返させる。
   - `repairHint`（L443-449）で `critic_below_72` が含まれる場合、語尾の言い換えではなく「`underlyingMechanism` と具体コントラストを強め、講義調の前置きを削って書き直す」よう明示する。
2. **`src/draft_verifier.js`（L8 `SLOP`）**：
   - ハードコードによる誤検知を防ぐため、技術記事・専門記事でも普通に使う語（「理論」「学」「結論」単体など）は絶対に禁止しない。
   - **AI量産クリックベイト特有の明確な定型スロップのみ**を追加する：
     `深掘りします|保存必須|知っておくべき\d+選|let's break this down|here's why that matters`（既存の8表現は維持）。

---

## Workstream 4: ページ情報不足時の萎縮解消 ＋ 自律進化ループ接続（`src/bandit_optimization_engine.js`, `src/meta_prompt_optimizer.js`, `src/autonomous_promo_ai.js`）

### 実装要件
1. **`src/bandit_optimization_engine.js` `formatHypothesis`（L311-324）**：
   - `!hypothesis` の分岐（L315-318）は、従来の「選べません」という消極表現ではなく、ページ情報が無い（または `persona-only`）運用でも萎縮しない指示へ変更する：
     - JA: `ページ固有の仮説が未設定のため、顧客の方針・プロフィール・公開済みメモと検証可能なドメイン原理だけを使い、読者が実務で使える鋭い一点を書く。ページに無い成果・数値・過去投稿コピーは禁止。`
     - EN: `No page-specific hypothesis is set. Rely strictly on the customer direction, profile, field notes, and verifiable domain principles to deliver one sharp, useful insight without inventing outcomes or copying recent posts.`
   - （※`formatSelectedFact` は `tests/bandit_optimization_engine.test.js` の既存契約どおりそのまま維持）。
2. **`src/meta_prompt_optimizer.js`（L217-286 `optimizePromptDirectives`）**：
   - 既存 `MANDATORY_SAFETY_RULES`・`validateDirectivesSafety`・`runHeuristicOptimization`・戻り値形式は100%維持する（`tests/meta_prompt_optimizer.test.js` 互換）。
   - `context.lang`（`'en'` / `'ja'`）を受け取れるようにし、`completeJson` の分析プロンプト（L244-267）に **「単なる文字数だけでなく、上位投稿（保存数・返信率が高い投稿）がどの『構造の噛み砕き方・因果の鋭さ・視点の対比』で反応を得たかを抽出し、AIテンプレ化を防ぐ可変ルールへ反映すること」** を組み込む。
3. **`src/autonomous_promo_ai.js`（L394-400, L2866-2871）**：
   - `draftBriefSummary` に `underlyingMechanism: drafted.brief && drafted.brief.underlyingMechanism || ''` を追加保存する（既存 `scene`, `readerPayoff`, `hookAngle`, `offer` はそのまま保持）。

---

## Workstream 5: 顧客オンボーディングでの切り口提案強化（`src/persona_suggestion_helper.js`）

### 実装要件
1. `buildFallbackPersonaSuggestions`（L42-182）および AI 提案プロンプト（L260-272）で、全4案のうち1案（`site_tips_trust` または `acct_concise_tips` の文脈）を、単なる「無難なTips」ではなく **「専門知見・仕組みの鋭い噛み砕き（Deep Insight / 原理・構造解説）」** を軸にした方針提案へブラッシュアップする（JA / EN 両方、サービス名・対象ドメインが動的に反映される形を維持）。
2. 既存テスト（`tests/autopilot_setup_save.test.js` L125-168：`suggestions.length === 4`・`promptText` にサービス名を含む等）を必ず通過させる。

---

## 検証要件（完了報告前に必ず実測）

1. `node --check`：変更した全 `.js` ファイル（`src/account_voice_profiler.js`, `src/next_post_draft.js`, `src/draft_verifier.js`, `src/bandit_optimization_engine.js`, `src/meta_prompt_optimizer.js`, `src/autonomous_promo_ai.js`, `src/persona_suggestion_helper.js` および新規/更新テスト）。
2. `node --test --test-force-exit`：
   - 新規または拡充テスト（`brief` が `underlyingMechanism` / `everydayAssumption` を保持すること、Critic 低得点時に `repairHint` が強化されること、`voiceProfile` に `domainFocus` / `thinkingLens` が保存されること、`SLOP` が技術用語「理論」「構造」等を誤爆せず定型クリックベイトのみ遮断すること、`formatHypothesis(null)` がJA/ENで萎縮指示を出さないこと）
   - 既存テスト全関連スイート（`tests/velox_polish_and_scaling.test.js`, `tests/phase3_portfolio_verifier.test.js`, `tests/meta_prompt_optimizer.test.js`, `tests/phase2_autonomy_workspaces.test.js`, `tests/autopilot_setup_save.test.js`, `tests/bandit_optimization_engine.test.js`, `tests/lp_voice_phase2.test.js`, `tests/homepage_v51_copy.test.js`, `tests/dashboard_language.test.js`, `tests/simple_autopilot_transparency.test.js`, `tests/growth_phase.test.js`, `tests/autopilot_jobs_separation.test.js`）。
3. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後、2秒待機して本番 `POST /api/funnel/free-experience`（JA と EN、およびコーディング等の専門テーマ `userPrompt`）を `curl` で実行し、実際に **わざとらしい「〇〇学によると」やテンプレ臭のない鋭い下書き** が生成され、JA/EN混在がゼロであることを確認する。
