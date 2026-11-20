# GROK 実装指示書：再作成ボタン 524 HTML エラー解消 ＋ 英語投稿 `japanese_in_english` 全滅防止

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
`@VeloxSystemsHQ`（`USR-MVUA1GLP-D640`, `aiTargetLang: 'en'`）で発生した以下 2 件の原因を根絶する：
1. **「🔄 次の1本を今すぐ再作成する」押下で `通信エラー: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` が出る不具合**：
   - `POST /api/autopilot/replenish`（`src/hybrid_saas_routes.js` L2226）が `await prepareNextPost(...)`（最大複数回の Grok API 呼び出し・各 `timeoutMs: 120000`）を同期で待ち続けるため、Cloudflare Tunnel の 100 秒プロキシタイムアウトを超えて Cloudflare が HTML（524 Error Page）を返し、`views/dashboard_view.html` L5179 の `res.json()` が落ちている。
2. **英語設定アカウント（`@VeloxSystemsHQ`）が `[NextPostDraft Rejected] reasons=japanese_in_english` で止まる不具合**：
   - `USR-MVUA1GLP-D640` では `aiTargetLang: 'en'` に対し、`userPrompt` が日本語、登録サイトが日本語（`veloxpostapp.com`）、さらに過去投稿配列 `rememberedPostTexts(posts)` と `retargetContext` が日本語のままプロンプトに渡されている。
   - その結果、英語下書きの 3 案やリペア案に日本語の語句や `「」` が紛れ込み（`repairHint` にも `japanese_in_english` 対策が未記載）、決定論的審査 `containsJapaneseScript` で全案却下されていた。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` 準拠）

1. **日英混在ゼロ**：UI エラー通知・ボタン文言は JA / EN 両方揃える。
2. **生成言語と UI 言語の分離維持**：`aiTargetLang === 'en'` の投稿本文（`tweets_en` / `text_en`）には日本語文字を一切残さないが、日本語で書かれた `userPrompt`・`targetUrl`・`brandContextNotes` 自体は削除せず「英語へ翻訳して書かせる」。

---

## Workstream A: `POST /api/autopilot/replenish` 非同期化 ＋ 非JSON安全パース

### 対象ファイル
- `src/hybrid_saas_routes.js`（L2194-2258）
- `views/dashboard_view.html`（L5165-5196）

### 実装要件

1. **サーバー側非同期実行（`src/hybrid_saas_routes.js` L2194-2258）**：
   - ユーザー単位の多重起動防止用 `Set`（例：`const replenishRunningUsers = new Set();`）を用意する。
   - 事前チェック（認証・X連携・方針存在確認）を通過したら、まず `userDoc.ref.set({ ensureNextPostFailures: 0, ensureNextPostFailureDate: null, lastEnsureNextError: null, lastEnsureNextRejectReasons: [] }, { merge: true })` で待機状態に戻す。
   - すでに `replenishRunningUsers.has(userId)` でなければ、`replenishRunningUsers.add(userId)` して背景で `prepareNextPost(userId, { lang: uData.aiTargetLang || 'ja' })` を起動する：
     - 成功時：`ensureNextPostFailures: 0, ensureNextPostFailureDate: today, lastEnsureNextError: null, lastEnsureNextRejectReasons: []` を保存。
     - 失敗時：`scheduleTimeZone || timezone || 'Asia/Tokyo'` 基準で `today = localDateKey(new Date(), zone)` を求め、`ensureNextPostFailures: 3, ensureNextPostFailureDate: today, lastEnsureNextError: String(err.message || 'unknown').slice(0, 240), lastEnsureNextRejectReasons: Array.isArray(err.rejectReasons) ? err.rejectReasons.slice(0, 6) : [], lastEnsureNextErrorAt: new Date().toISOString()` を保存する（無限リトライに陥らず、理由付きカードへ即時戻すため）。
     - `finally` で `replenishRunningUsers.delete(userId)`。
   - レスポンスはタイムアウト前に即座に **HTTP `202`**（JSON `{ ok: true, asyncStarted: true, message }`）を返す：
     - JA: `'次の1投稿の作成を開始しました。15〜60秒ほどでこの画面に自動で反映されます。'`
     - EN: `'Started creating the next post. This view will update automatically in 15–60 seconds.'`

2. **クライアント側 HTML 応答ガード（`views/dashboard_view.html` L5165-5196 `replenishJobsManually`）**：
   - `await res.json()` を直接呼ばず、`const rawText = await res.text()` を読んで `try { j = JSON.parse(rawText); } catch (_parseErr) { j = null; }` にする。
   - `!res.ok || !j`（Cloudflare 等が HTML 502/524 を返した場合や予期せぬ非JSON応答）のときは、`Unexpected token '<'` を出さず、日本語／英語の分かりやすいエラー文（例：JA `'サーバー処理が混み合っています。少し待ってから画面を更新してください。'` / EN `'The server is busy processing this request. Please refresh shortly.'`）を表示し、`await loadJobs()` を呼ぶ。

---

## Workstream B: 英語投稿生成時の日本語混入（`japanese_in_english`）根絶

### 対象ファイル
- `src/autonomous_promo_ai.js`（L168-182, L358-368, L1749, L2743-2745, L2776-2785）
- `src/next_post_draft.js`（L3, L287-328, L368-371, L439-446）
- `tests/autopilot_jobs_separation.test.js`（または関連テストへ検証追記）

### 実装要件

1. **過去投稿・方向指示の英語分離（`src/autonomous_promo_ai.js`）**：
   - `rememberedPostTexts(posts, lang = null)`（L168-182）を言語対応にし、`lang` が `'en'` のときは `tweets_en` / `text_en` のみ（あるいは `containsJapaneseScript(row)` が `false` の英文のみ）を返し、日本語の過去投稿（例：`job_auto_*` の日本語本文）を英語プロンプトへ混ぜない。
   - `launchAutopilotCampaign`（L358, L364）および `prepareNextPost`（L2776, L2782）は `rememberedPostTexts(posts, accountState.lang)` を渡す。
   - `reThinkSingleJob`（L1749）も `rememberedPostTexts(posts, accountState.lang)` を使う。
   - `retargetContext`（L366-368 および L2743-2745）も `accountState.lang === 'en'` のときは英語文にする。

2. **英訳・日本語禁止プロンプト & リペア指示（`src/next_post_draft.js`）**：
   - `containsJapaneseScript` を `./measured_pair` から `require` する。
   - `draftNextPostWithMeta`（L368-371）で `memory` を作るときも、`isEn` が `true` なら `!containsJapaneseScript(text)` で日本語文字列を除外する。
   - `systemRules(true)`（L289）および `candidatePrompt`（`isEn === true`, L304-315）に、**「`Customer instruction`, `Page`, `Brief`, `Customer notes` が日本語で書かれていても、概念をすべて自然な英語へ翻訳して出力し、ひらがな・カタカナ・漢字および全角記号（`「」`『』、。）を1文字も出力しないこと」** を明記する。
   - `repairHint`（L439-446）に `reasons.includes('japanese_in_english')` 用の修正指示を必ず追加する：
     `reasons.includes('japanese_in_english') ? 'CRITICAL: Previous output contained Japanese characters or Japanese punctuation. Rewrite 100% in natural English using ASCII characters only—zero hiragana, katakana, or kanji.' : ''`

3. **テスト追加**：
   - `rememberedPostTexts` に日英混在の投稿履歴を渡した際、`lang='en'` では日本語テキストが除外されること。
   - `draftNextPostText({ lang: 'en', userPrompt: '日本語の運用方針...', ... })` で初回候補が `japanese_in_english` で落ちても、2回目（`repairHint` 付き）が英語のみで通過すること。
   - `replenishJobsManually` がサーバーからの HTML 応答（`<!DOCTYPE html>524...`）を受け取っても `Unexpected token` 例外にならず安全に表示されること。

---

## 検証要件（完了報告前に必ず実測確認）

1. `node --check src/hybrid_saas_routes.js src/autonomous_promo_ai.js src/next_post_draft.js`（その他編集した全 `.js`）
2. `vm.Script` 構文検査：`views/dashboard_view.html`・`views/funnel_index.html`
3. `node --test --test-force-exit`：9 スイート以上（既存 57 件＋追加テスト）すべて pass
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`curl` 疎通＋`pm2 pid x-shop` を確認して報告すること。
