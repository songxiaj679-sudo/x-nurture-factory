# GROK 実装指示書：配信結果ログの英語本文非表示バグ修正 ＋ 準備中スタック可視化

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
本番 `@VeloxSystemsHQ`（`USR-MVUA1GLP-D640`）で確認された以下2件の不具合を修正する：
1. **配信結果ログ（`isDone`）で英語投稿の本文が真っ白になるバグ**：
   - `prepareNextPost`（`src/autonomous_promo_ai.js` L2839-2842）は `aiTargetLang === 'en'` のとき `text: ''`, `tweets: []`, `text_en: tweets[0]`, `tweets_en: tweets` を保存する。
   - 一方 `views/dashboard_view.html` L4868-4883 はダッシュボード UI 言語が日本語（`!isEn`）のとき `job.tweets` と `job.text` しか見ないため、`tweets_en` / `text_en` のみの投稿が空白で表示されている。
2. **「ただいま次の投稿を作成しています...」のまま進まない状態の可視化・再実行導線**：
   - `ensureNextPost`（`src/autonomous_promo_ai.js` L2928-2929, L2968-2974）で当日リトライ上限（`ensureNextPostFailures >= 3`）に達しても、エラー内容が `saas_users` に残らず、ダッシュボード（`views/dashboard_view.html` L5036-5055）が一律「ただいま次の投稿を作成しています...（30〜60秒ほどで表示）」を出し続けてしまう。
   - あわせて `draftNextPostWithMeta`（`src/next_post_draft.js` L457, L465）で候補が全滅した際の正確な拒否理由（`reasons`）をログ出力＆エラーメッセージへ含め、原因調査と手動再試行を即時可能にする。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` 準拠）

1. **日英混在ゼロ**：UI 言語（`checkIsEn()`）と投稿生成言語（`aiTargetLang`）を厳密に分離し、ダッシュボード UI 文字列は JA / EN 両方を完全実装すること。
2. **`POST /api/autopilot/replenish` 等の UI 応答**：`uiLang` を優先して返し、`aiTargetLang` と混同しないこと。

---

## Workstream A: `配信結果ログ` のクロス言語フォールバック修正

### 対象ファイル
- `views/dashboard_view.html`（L4868-4888）

### 実装要件
`renderJobCard` 内の `if (isDone)`（L4868-4888）を次のように修正し、UI 言語（`isEn`）にかかわらず、本文が入っている配列（`tweets` / `text` または `tweets_en` / `text_en`）へ必ずフォールバックするようにする：
```javascript
const jaTweets = Array.isArray(job.tweets) && job.tweets.length > 0
  ? job.tweets
  : (job.text ? [job.text] : []);
const enTweets = Array.isArray(job.tweets_en) && job.tweets_en.length > 0
  ? job.tweets_en
  : (job.text_en ? [job.text_en] : []);
const allDisplayTweets = isEn
  ? (enTweets.length > 0 ? enTweets : jaTweets)
  : (jaTweets.length > 0 ? jaTweets : enTweets);
const postText = allDisplayTweets[0] || '';
```
※ `tweets_en` のみの投稿を日本語ダッシュボードで開いた場合も、1本目・2本目スレッドとも必ず本文が表示されること。

---

## Workstream B: `ensureNextPost` リトライ上限・原因可視化・手動再作成ボタン

### 対象ファイル
- `src/next_post_draft.js`（L437-466）
- `src/autonomous_promo_ai.js`（L2927-2974）
- `src/hybrid_saas_routes.js`（L2194-2224, L2966-3019）
- `views/dashboard_view.html`（L4992-5055 + 手動再試行ハンドラ）

### 実装要件

1. **候補不合格時の理由記録（`src/next_post_draft.js` L437-466）**：
   - `chosen` が見つからず `PostConstraintError('検証を通る投稿案が無かったため停止しました。')` を投げる前に、直前候補・リペア後候補の `runDeterministicAudit(...).reasons` を集約し、`console.warn(\`[NextPostDraft Rejected] reasons=${summary}\`)` でログ出力するとともに `err.rejectReasons = reasons` を付与する。

2. **失敗状態の保存（`src/autonomous_promo_ai.js` L2960-2974）**：
   - `ensureNextPost` 成功時：`ensureNextPostFailures: 0, ensureNextPostFailureDate: today, lastEnsureNextError: null, lastEnsureNextRejectReasons: []` を保存。
   - `ensureNextPost` 例外時：`lastEnsureNextError: String(err.message || 'unknown').slice(0, 240)` と `lastEnsureNextRejectReasons: Array.isArray(err.rejectReasons) ? err.rejectReasons.slice(0, 6) : []`、`lastEnsureNextErrorAt: new Date().toISOString()` を `userDoc.ref.set(..., { merge: true })` で保存する。

3. **API 状態返却とリセット（`src/hybrid_saas_routes.js`）**：
   - `GET /api/autopilot/jobs`（L2970-3019）で、`uData` の `scheduleTimeZone`（なければ `Asia/Tokyo`）基準の当日日付と `uData.ensureNextPostFailureDate` が一致するとき、レスポンス JSON に `nextPostState` を追加する：
     ```javascript
     nextPostState: {
       retryLimitReached: sameDay && Number(uData.ensureNextPostFailures || 0) >= 3,
       failuresToday: sameDay ? Number(uData.ensureNextPostFailures || 0) : 0,
       lastError: uData.lastEnsureNextError || null,
       rejectReasons: Array.isArray(uData.lastEnsureNextRejectReasons) ? uData.lastEnsureNextRejectReasons : []
     }
     ```
   - `POST /api/autopilot/replenish`（L2194-2224）：
     - `uiLang`（`req.body?.uiLang` または cookie `velox_lang`、フォールバック `'ja'`）で応答 `message` を返す（`aiTargetLang` ではなく UI 言語に合わせる）。
     - 成功時に `ensureNextPostFailures: 0, ensureNextPostFailureDate: null, lastEnsureNextError: null, lastEnsureNextRejectReasons: []` をクリアする。

4. **ダッシュボード UI の無限「準備中」解消（`views/dashboard_view.html` L4992-5055）**：
   - `j.nextPostState && j.nextPostState.retryLimitReached` が `true` で `pendingJobs.length === 0` のときは、「30〜60秒ほどで表示（自動更新中）」を出さず・自動ポーリングも回し続けず、**JA / EN 切替対応の停止通知カード** を表示する：
     - JA: `次の1本の自動作成を3回連続で保留しました` ＋ 理由表示（`lastError`）＋ **`🔄 次の1本を今すぐ再作成する`** ボタン（`POST /api/autopilot/replenish` を呼び、`uiLang` を渡して完了後に `loadJobs()` を再実行）
     - EN: `Paused automatic next-post drafting after 3 failed attempts` ＋ reason ＋ **`🔄 Retry next post now`** button

5. **回帰テスト追加（`tests/autopilot_jobs_separation.test.js` 等）**：
   - 日本語ダッシュボード（`isEn === false`）で `tweets: []`, `text: null`, `tweets_en: ['First', 'Second']`, `text_en: 'First'` の投稿済みジョブを描画しても空欄にならず `First` / `Second` が描画されること。
   - `nextPostState.retryLimitReached === true` のとき無限準備中ではなくリトライボタン付きの停止通知が出ることを検証する。

---

## 検証要件（完了報告前に必ず実測確認）

1. `node --check`（編集したすべての `.js` ファイル）
2. `vm.Script` 構文検査：`views/dashboard_view.html`・`views/funnel_index.html`
3. `node --test --test-force-exit`：関連全テスト（`tests/autopilot_jobs_separation.test.js`, `tests/dashboard_language.test.js`, `tests/autopilot_setup_save.test.js`, `tests/simple_autopilot_transparency.test.js`, `tests/velox_polish_and_scaling.test.js`, `tests/homepage_v51_copy.test.js`, `tests/toppage_demo_brushup.test.js`, `tests/compliance_and_topnav_i18n.test.js`, `tests/growth_phase.test.js`）
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`/dashboard` 等への疎通確認と `pm2 pid x-shop` を報告すること。
