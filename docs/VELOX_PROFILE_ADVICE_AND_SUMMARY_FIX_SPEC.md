# GROK 実装指示書：固定ポスト例文の抜本修正・AIによる具体的Bio/プロフィール提案・日英混在(`Xプラン: None.`)修正

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
お客様が実際の管理画面を見て指摘された以下の致命的な違和感・不具合を完全に解消する。
1. **`「固定ポスト案」` に `[コピー]` ボタンがあるのに中身がルール説明書（`固定ポストは〜置きます。ページに無い数値は入れません`）になっており、そのまま X に貼れる肝心の固定ポスト例文が書かれていない！** しかも投稿言語が英語（`aiTargetLang: 'en'`）のときでも `pin` だけ日本語が出ていた。
2. **現在のプロフィール診断＆Bio提案が薄い定型文字列の連結に留まっている**（例：今の Bio に `7-agent AI council` 等の旧表記や URL 抜けがあっても指摘できず、`改善Bio案` も `VELOX AI: Practical notes for the reader.` のような中身のない短文になってしまう）。
3. **「現在のアカウント状態」に英語 `Xプラン: None.` と半角ピリオド `.` が日本語文へ混入**しており、「実測からの考察」も `順位は予測しません。` という言い訳調で考察になっていない。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` 準拠）

1. **日英混在ゼロ**：管理画面のラベル・見出し・診断コメント・運用サマリーは `uiLang` / `checkIsEn()` に従い、X API からの生値（`None` 等）や半角 `.` をそのまま日本語文に混ぜないこと。
2. **UI 言語と投稿生成言語の厳密分離**：
   - `displayName`（表示名案）、`bio`（改善Bio案）、`pin`（そのまま投稿して固定できる固定ポスト例文）の **3つはすべて「そのアカウントで実際に X に貼る文章」なので、必ず `copyLang`（`user.aiTargetLang || uiLang`）の言語で生成すること**。
   - `currentBioReview`（現在の自己紹介への診断コメント）、`pinNote`（固定ポストの確認ポイント）、`highlights`、`automated` は管理画面の解説なので **`uiLang`** で返すこと。
3. **誇張・未確認数値ゼロ**：登録ページ（`brandKnowledge`）・保存済みプロフィール・実測数値に無い％や人数・成果保証は絶対に捏造しない。

---

## Workstream A: `Xプラン: None.` 混入と言い訳調文言の修正 (`src/growth_phase.js` & `src/profile_checklist.js`)

### 1. `src/growth_phase.js` (`buildOperatingSummary`, L91-132)
- `plan` の人間向け日本語・英語正規化ヘルパー `formatPlanLabel(rawPlan, en)` を追加する：
  - `'none'` / `'free'` → `en ? 'Standard (Free)' : '通常プラン'`
  - `'basic'` → `'X Basic'`
  - `'premium'` → `'X Premium'`
  - `'premium_plus'` / `'premiumplus'` → `'X Premium+'`
  - 空欄・未取得 → `en ? 'X plan not measured' : 'Xプランは未取得'`
  - （**絶対に生文字列 `'None'` や半角 `.` を日本語に出さない**。日本語文の区切りは必ず `'。'` を使うこと）
- `insights`（`L117-124`、`実測からの考察`）を機械的な「`順位は予測しません。`」から、お客様にとって意味のある自然な考察へ改善する：
  - 例（表示回数実測あり・目標未達段階の JA）：
    `直近の平均表示はおよそ${avg}回です（当面の目安 ${low}〜${high}回）。まだ立ち上がりデータが少ないため、保存・共感を得やすい投稿形を試しながら反応傾向を蓄積しています。`
  - `bookmarkRate` が数値である場合は小数そのまま（`0.02` 等）ではなく `${(rate * 100).toFixed(1)}%` 形式で読みやすく整形し、「データが増え次第、伸びやすい時間帯とテーマの差を整理します」と自然な日本語にする。

### 2. `src/profile_checklist.js` (`highlights`, L75-82)
- 不自然な「`ハイライトが使えるとは断定しません。`」を止め、自然な助言に直す：
  - 通常・不明アカウント（JA）：`通常の X アカウントにはハイライトタブが無いため、まずはプロフィールの「固定ポスト1本」を入口として丁寧に整えるのが最も効果的です。`
  - 有料アカウント（JA）：`X Premium をご利用中のため、固定ポストを入口案内に保ちつつ、特に反応が良かった実用投稿を「ハイライト」にまとめておけます。`
  - EN も同趣旨の自然な英語に揃える。

---

## Workstream B: 「固定ポスト完成例文」と「AI＋実態ベースのプロ向け Bio／プロフィール助言」の実装

### 1. `src/profile_checklist.js`
既存の同期関数 `buildProfileChecklist(user, lang, context)`（既存テスト・フォールバック兼用）を大幅強化した上で、本番用の非同期関数 **`buildAiProfileChecklist(user, lang, context)`**（`grok_client` の `hasXaiKey()` / `completeJson` 利用、`tier: 'fast'`, `timeoutMs: 18000`）を追加する。

#### A. 同期フォールバック版 `buildProfileChecklist(user, lang, context)` の必須改善
1. **`reviewCurrentBio(bio, uiEn, url, knowledge)` の具体性強化**：
   - 従来の 4 チェック（`1. 誰向けか / 2. 何を発信するか / 3. 次の導線 / 4. 長さ`）を維持しつつ、以下を実際に検出して明確に助言する：
     - もし `bio` に **`7-agent` / `council` / `zero-link` / `stealth` / `guarantee` / `100%`** など古い誇張・不自然な表現が残っている場合：`5. 見直し推奨表現: 現在の仕組みとズレやすい表現（例: 7-agent / stealth 等）が含まれているため、実務価値がストレートに伝わる表現への更新をおすすめします。`
     - もし登録済み `targetUrl` があるのに、そのホスト名（例 `veloxpostapp.com`）が `bio` 本文内に書かれていない場合：`3. 次の導線` に「自己紹介文の中にも公式URL（または導線案内）を直接書いておくとプロフィール訪問者が迷いません」と具体的に追記する。
     - `2. 何を発信するか` も、`発信/手順/紹介/notes/guide` の単語一致だけでなく、技術・設計・実務・SaaS・自動化等の具体ワード（`algorithm|ai|saas|automation|workflow|tool|運用|開発|自動化`）を正しく認識して判定する。
2. **`pin`（固定ポスト例文）は必ず `copyEn`（投稿言語）で「そのまま貼れる完成例文」を返す**：
   - ルール説明（「固定ポストは〜置きます」）を `pin` に入れるのを **完全に禁止**！
   - 登録された `brandKnowledge`（`productName`, `oneLineMechanism`, `icpSummary`, `verifiedClaims[0]`）や `userPrompt`、`targetUrl` を使って、**そのまま X に投稿して固定できる 2〜3 段落の具体的例文**（JA / EN それぞれ自然な文体）を組み立てる。
   - ルール・確認ポイントは別フィールド **`pinNote`**（`uiLang` で返却）に分ける。
3. **`bio`（160文字以内）と `displayName`（50文字以内）の充実**：
   - 仮に `userPrompt` が日本語で投稿言語が英語（`copyEn = true`）であっても、`Practical notes for the reader.` のような空っぽ文に逃げるのを禁止し、`brandKnowledge`（英日問わず概要・仕組み・読者像）または製品名/ドメインから具体的な中身のある Bio 例文（100〜160文字前後）を組む。

#### B. 本番 AI 生成版 `buildAiProfileChecklist(user, lang, context)`（`src/profile_checklist.js` 新設・エクスポート）
- `hasXaiKey()` が `true` のときは、`completeJson({ tier: 'fast', timeoutMs: 18000, json: true, ... })` を呼び出し、以下を実際に生成する（失敗・タイムアウト時は即座に強化版 `buildProfileChecklist` へフォールバック）：
  - **入力データ**: `currentBio`, `xUsername`, `targetUrl`, `brandKnowledge`（`productName`, `oneLineMechanism`, `icpSummary`, `verifiedClaims` 先頭3件, `verifiedConstraints`）, `userPrompt`, `brandContextNotes`, `voiceProfile`（`accountRole`, `voiceSummary`）, `copyLang`（投稿言語）, `uiLang`（管理画面言語）
  - **出力 JSON 仕様**:
    - `currentBioReview`（言語=`uiLang`）：実際の `currentBio` を1文字ずつ読んだうえでの具体的な診断コメント（今のBioの強み、旧表記・抽象表現・URL有無・文字数の具体的な改善ポイント、番号付きで読みやすく）
    - `displayName`（言語=`copyLang`, 50文字以内）：そのままXの表示名欄に貼れる洗練された肩書き付き名前
    - `bio`（言語=`copyLang`, 160文字以内厳守）：そのままXの自己紹介欄に貼れる具体的なBio（`targetUrl` があれば必ず含め、URLの途中で切れないように組む）
    - `pin`（言語=`copyLang`, 280文字以内でX通常アカウントでもそのまま投稿・固定できる完成文）：アカウントの立場・読者のどんな悩みを助けるか・何を発信しているか・`targetUrl` を盛り込んだ、実際にそのままXに投稿して固定できる具体的な例文（誇張や未確認数値はゼロ！）
    - `pinNote`（言語=`uiLang`）：この固定ポストを使う際の簡単な補足（「公開前に自社表記に合うかご確認の上、X に投稿して「プロフィールに固定」してください」）
  - 生成後は必ず：
    - `bio` を 160文字以内に安全クリップ（もし URL ありなら URL が途中で切れないよう本文側を詰めて末尾に URL を残す）
    - `displayName` 50文字・`pin` 280文字制限・`sanitizePostOrReplyText` を適用し、根拠外数字チェック等で破損していれば `buildProfileChecklist()` にフォールバックする。

### 2. `src/hybrid_saas_routes.js` (`POST /api/autopilot/profile-checklist`, L1578-1622)
- `brandKnowledge` が `user` に未保存でも `user.targetUrl` が設定されている場合は、`extractBrandKnowledge(user.targetUrl, { db, userId: sessionUser.userId, cachedKnowledge: user.brandKnowledge, tier: 'fast', timeoutMs: 6000 })` を安全に試みてから渡す（失敗してもエラーにしない）。
- `liveProfile` 取得時も `user.voiceProfile.bio` の有無だけでスキップせず、`readLiveAccount(sessionUser.userId, user)` 相当またはキャッシュされた `accountDiagnosis` から `subscriptionType` や最新 `bio` を正しく補完する。
- `buildAiProfileChecklist()` を呼び出し、`{ ok: true, posture, checklist }` を返す。

### 3. `views/dashboard_view.html` (`loadProfileChecklist()`, L4241-4285)
- 取得中はボタンを無効化し、`profileChecklistOut` にローディング状態（「現在のプロフィールと登録ページを読み込んで、改善案を作成しています...」 / EN）を表示する。
- 各カードの役割とボタンを明確化：
  1. `現在のプロフィールへの助言`（`item.currentBioReview`、コピーボタンなし）
  2. `表示名（推奨例）` ＋ `[コピー]` ボタン（`item.displayName`）
  3. `改善Bio案（N/160文字）` ＋ `[コピー]` ボタン（`item.bio`）
  4. `固定ポスト例文（このまま X に投稿して固定できます）` ＋ `[コピー]` ボタン（`item.pin`）＋ 下部に `item.pinNote`（薄グレー補足テキスト、コピー対象には含めない！）
  5. `ハイライトについて`（`item.highlights`、コピーボタンなし）

---

## 検証要件（完了報告前に必ず実測確認）

1. `node --check`：`src/growth_phase.js`, `src/profile_checklist.js`, `src/hybrid_saas_routes.js`
2. `vm.Script`：`views/dashboard_view.html` と `views/funnel_index.html` の全インライン `<script>`
3. `node --test --test-force-exit`：
   - `tests/growth_phase.test.js`
   - `tests/simple_autopilot_transparency.test.js`（以下を追加検証するよう更新：`Xプラン: None.` や半角 `.` が日本語サマリーに出ないこと、`pin` がルール説明ではなく具体的な固定ポスト例文＋`pinNote` で返ること、`copyEn: true` なら `pin` も英語になること、旧表記 `7-agent` や `zero-link stealth` がある現在 Bio に対して改善指摘が返ること）
   - `tests/dashboard_language.test.js`
   - `tests/compliance_and_topnav_i18n.test.js`
   - `tests/homepage_v51_copy.test.js`
   - `tests/autopilot_setup_save.test.js`
   - `tests/autopilot_jobs_separation.test.js`
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`/dashboard`・`/` の HTTP ステータス確認、および `POST /api/autopilot/profile-checklist`（またはノード経由で `buildProfileChecklist` / `buildOperatingSummary`）を実データ例（`@VeloxSystemsHQ` 相当）で実行して出力例を目視確認・報告すること。
