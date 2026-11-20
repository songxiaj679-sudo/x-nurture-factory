# GROK 実装仕様書：英語スレッド短文スタブ（`"The rule is input the URL."`）修正・日本語語彙汚染ガード・料金カード誤抽出防止

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
`@VeloxSystemsHQ` で「`✨ 別案にする`」を実行した際に出力された以下の品質問題 4点を根本修正する。
1. **1段目26文字の壊れた英語短文（`"The rule is input the URL."`）と、2段目の使い方マニュアル文（`"Feed one URL..., let it create schedule..."`）が審査を通過した問題**
2. **英語アカウントの `domainLexicon` に残った過去の日本語スロップ表現（`9割の`・`保存して後で見返してください` 等）が英語プロンプトに混入している問題**
3. **Critic（採点）が非推論モデル `grok-4.3`（2.4秒）で上記駄文を72点以上で通してしまった問題**
4. **`誰に:` に料金プラン表（`👤 CREATOR & SOLO Solo Starter ¥4,980 / 月...`）、`なぜ今:` に括弧途切れ（`...（料金・機能・FAQなど主要な案内。`）が入った問題**

---

## 🔍 本番 Firestore ＆ 実コードで確認された事実

1. **実ジョブ（`job_next_d53011e5-fb35-4c6f-9681-d8e9ae64129a`）の `qualityAudit` と `tweets_en`**:
   - `tweets_en`: `["The rule is input the URL.", "Feed one URL or account description into VELOX AI, let it create schedule and learn, then check results after 2-6 hours and 24-36 hours."]`
   - `accountStateSnapshot.maxChars: 270` なのに通過した原因：
     - `src/draft_verifier.js` L81 `minimumLength` が **`if (thread) return 20;`**（2本目 L115 は **`length < 10`**）で、英語5語・26文字がそのまま通った。
     - `src/next_post_draft.js` L403 の `c states one stripped-down decision rule a reader would save.` に引っ張られ、極端なスローガン断片が出力された。
     - `src/next_post_draft.js` L563 の Critic が `tier: 'nurture'`（`grok-4.3`・2.4秒）かつ英語文法崩れ／短文スタブ／非プロモ枠の操作マニュアル化への減点指定が無かった。
2. **英語アカウントへの旧日本語スロップ混入（`user_marketing_knowledge/USR-MVUA1GLP-D640`）**:
   - `domainLexicon.winningExpressions` に `['9割の', '月100時間かかっていた作業が、たった15分になった', '現場で検証済み', '保存して後で見返してください']` が残っており、`src/editorial_lexicon_engine.js` L266 が言語・禁止語フィルタ無しで英語プロンプトへ注入している。
3. **料金表テキストの `who` / `why` 誤抽出**:
   - `src/bandit_optimization_engine.js` L267-270 の `/solo|個人/` や `/料金/` が LP の料金表見出し（`👤 CREATOR & SOLO Solo Starter ¥4,980 / 月...` や `（料金・機能・FAQなど主要な案内`）に誤ヒットしている。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **既存日本語テストの保護（`tests/phase3_portfolio_verifier.test.js` L144-149）**:
   - 日本語スレッドテスト `['画面の前で手順が止まったとき、最初に見る場所を一つだけ残す。', 'その続きで、ページに書いてある確認だけを出す。']`（30文字／23文字）は引き続き通過させる必要があるため、**日本語（`ja`）スレッドの `20` / `10` 文字下限は維持し、英語（`en`）スレッドだけ文字数下限を引き上げる**。
2. **日英完全分離（セクション1）**:
   - 英語投稿プロンプトへ日本語の勝ち表現・DPOペアを生のまま混ぜない。
   - ダッシュボード UI 上でも `誰に:` / `なぜ今:` に料金カードの断片を出さない。

---

## 実装仕様

### 1. `src/draft_verifier.js` — 英語スレッド最小文字数引き上げ ＆ 壊れた短文/直訳マニュアル遮断

1. **`minimumLength(context, thread)`（L80-85）**:
   - `if (thread) return context.lang === 'en' ? 65 : 20;`
2. **`runDeterministicAudit` の 2本目以降チェック（L115）**:
   - `const replyFloor = lang === 'en' ? 55 : 10;`
   - `if (tweets.slice(1).some(text => typeof text !== 'string' || text.trim().length < replyFloor)) reasons.push('too_short');`
3. **英語の壊れた直訳断片・不自然構文の拒否（L129付近）**:
   - `const BROKEN_EN = /^(?:The rule is|Feed one URL\b)|\bcreate schedule\b|\binput the URL\b/i;` を定義し、`if (lang === 'en' && tweets.some(text => BROKEN_EN.test(String(text || '').trim()))) reasons.push('ai_slop');` で必ず弾き、`repair` へ回す。

---

### 2. `src/next_post_draft.js` — `candidatePrompt` 案c刷新・品質Critic強化・`too_short` 修復指示追加

1. **`candidatePrompt`（L367-404付近）**:
   - `const minTarget = count > 1 ? (isEn ? 85 : 60) : (bodyLimit > 300 ? 150 : (isEn ? 100 : 85));`
   - 英語版の `c` 指示（L403）を刷新:
     `c delivers one concrete operational insight or failure boundary in 2 natural, complete sentences matching the target length—never write a tiny slogan fragment such as "The rule is...", and never write a setup manual telling readers to feed a URL into the tool when this post is not an explicit promotion.`
   - さらに `promo === false` のときは日英とも明記:
     - EN: `This post is NOT a product how-to manual. Give readers a genuine operational lesson grounded in the mechanism or trade-off, without awkward "input your URL into our tool" instructions.`
     - JA: `この枠はツールの使い方説明書ではありません。「URLを入力して…」といった操作案内ではなく、実務で役立つ判断基準や仕組みの本質を書くこと。`
   - `systemRules(true)`（L358）にも `Never output broken grammar such as missing articles ("create schedule", "The rule is input..."). Every tweet must read like idiomatic native English.` を1文加える。

2. **Critic（L557-568）**:
   - 使用モデルを **`tier: tier === 'fast' ? 'fast' : tier`**（本番 `'quality'` 指定時は `grok-4.7`）、`timeoutMs: Math.min(timeoutMs, 35000)`、`retryTimeoutMs: Math.min(timeoutMs, 15000)` に引き上げる（非推論 `grok-4.3` による雑な72点合格を防ぐ）。
   - Critic プロンプト（L561）の減点基準へ以下を明記する：
     - `Broken English grammar (e.g. missing articles like "create schedule" or "The rule is input..."), tiny slogan stubs under 65 characters, or product usage-manual dumps ("feed a URL into the tool...") when not a promo score below 55.`

3. **`repairHint`（L598-622）**:
   - `reasons.includes('too_short')` を追加する：
     - `CRITICAL: Previous candidate was too short or underdeveloped. Expand every tweet into 2–3 natural, complete sentences matching the target length (at least 75 characters per English tweet). Replace any slogan stub or usage manual with a concrete operational insight.`

---

### 3. `src/editorial_lexicon_engine.js` — `editorialDirective` での異言語・過去スロップ表現遮断（L254-271）

- `const containsJapanese = text => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(String(text || ''));`
- `const BANNED_LEGACY = /9割の|月100時間|3\.2倍|3\.4倍|保存して後で見返|シャドウバン/;`
- `wins`（`lexicon.winningExpressions`）から `BANNED_LEGACY` に一致する語、および **`isEn === true` のときは日本語文字を含む表現** を除外してからプロンプトへ入れる。
- 同様に `isEn === true` のとき、`pairs`（`dpoPairs`）や `hint.directive` に日本語文字が含まれる場合は英語プロンプトへそのまま混ぜない（過去の日本語知識が英語投稿を壊すのを防ぐ）。

---

### 4. `src/bandit_optimization_engine.js`（L264-295）＆ `views/dashboard_view.html`（L4752-4788）— 料金カードと途切れ括弧の `who` / `why` 混入防止

1. **`src/bandit_optimization_engine.js` `extractPageHypotheses`**:
   - 価格表・ナビ見出し判定を追加する：
     ```js
     const isPricingOrNavNoise = line => /¥|￥|\$|税込|\/\s*月|CREATOR\s*&|Starter\b|Business\b|プラン|料金・機能・FAQ/i.test(line);
     const cleanFragment = line => String(line || '').replace(/[（(][^）)]*$/, '').replace(/\s+/g, ' ').trim();
     ```
   - `namesAReader`: `!isPricingOrNavNoise(line) && !/回復向け|向けの(?:投稿|構成|設計|画面|機能|設定)/.test(line) && /向け|の方|担当者|経営者|開発者|operator|team/i.test(line)`（※ **`solo`** 単体での料金カード `Solo Starter` 誤爆を防ぐため `solo operator` または価格ノイズ除外必須）。
   - `whys`: `!isBareProcessHeading(line) && !isPricingOrNavNoise(line) && /円|価格|申込|期限|条件|日以内|price|apply|until/i.test(line)`。
   - `who` / `why` / `proof` を詰める際 `cleanFragment(...)` を通して開きっぱなしの `（...` を残さない。

2. **`views/dashboard_view.html` `renderNextPostFacts`（L4752-4788）**:
   - `namesReader` および `storedLooksBroken` に **`¥|￥|\$|CREATOR\s*&|Solo Starter|（料金・機能|Who:`** を追加し、過去キャッシュ由来の「誰に: 👤 CREATOR & SOLO...」や旧 `Who:` 混入も画面に表示しない。

---

## テスト・検証要件

1. **テスト追加・更新**:
   - `tests/launch_progress_and_uilang.test.js`: Critic が `tier: 'quality'`（`<= 35000ms`）を使うよう更新（`['quality', 'quality', 'quality', 'quality']`）。
   - `tests/velox_polish_and_scaling.test.js`（または `tests/editorial_intelligence.test.js`）:
     - 英語スレッドで `"The rule is input the URL."`（26文字／壊れた英語）が `runDeterministicAudit` で `too_short` と `ai_slop` により弾かれること。
     - 日本語スレッドテスト（30文字／23文字）が引き続き通ること。
     - `editorialDirective(..., true)` が日本語や旧スロップ `9割の`・`保存して後で見返してください` を英語プロンプトへ流さないこと。
   - `tests/bandit_optimization_engine.test.js`:
     - `👤 CREATOR & SOLO Solo Starter ¥4,980 / 月（税込・$39） 個人・1ブランドの継続発信に` や `(料金・機能・FAQなど主要な案内` を `extractPageHypotheses` が `who` / `why` に選ばないこと。
2. **必須検証コマンド（最終編集後すべて実行）**:
   - 編集した全 `.js` ファイルの `node --check`
   - `views/dashboard_view.html` と `views/funnel_index.html` の `vm.Script` 構文チェック
   - 全関連＋新規テストの `node --test --test-force-exit` 全件成功（fail 0 / skip 0）
   - `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後、2秒待って `GET /` (200)・`GET /?lang=en` (200)・`GET /dashboard` (302) 確認
