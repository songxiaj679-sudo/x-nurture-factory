# GROK 実装仕様書：管理画面のデータ矛盾解消・重複UI整理・連続投稿の同ネタ化/翻訳調の解消

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
`@VeloxSystemsV4` の実ダッシュボード表示全文から見つかった **システム上の矛盾 3件・投稿文と選定理由の違和感 3件・UI文言重複/英語混在 5件** をすべて解消し、「言っていることが画面内で食い違わない・毎回の投稿が同じネタの翻訳調にならない」品質へ引き上げる。

---

## 🔍 実画面・Firestore実データ・実コードで確認された問題一覧

### A. データ・状態表示の矛盾（3件）
1. **同じページ内で「測れている / 目標84〜140回」と「まだ測れていない / 目標48〜80回」が真逆に出ている**:
   - 上段 `#secOperatingSummary`（`src/hybrid_saas_routes.js` L3126-3145 `buildOperatingSummary` + `summarizePostedMeasurements`）は実測値（平均約67回・最大121回・目標84〜140回）を表示。
   - すぐ下の `VELOX AI の現在の方針`（`views/dashboard_view.html` L5015-5023 / `src/hybrid_saas_routes.js` L3104-3108 `trustGoalStatus`）は `sample` が渡されないため「直近の表示回数はまだ測れていません」「表示48〜80回」を表示し、内容も重複している。
2. **「現在: Phase 2（自動返信中）」と「Phase 2は現在段階公開中です」が同居している**:
   - `views/dashboard_view.html` L4366 (`syncAutoReplyUiState`) が `cfg.phase2ServerEnabled`（サーバー環境変数 `X_AUTO_REPLY_PHASE2_ENABLED`）を見ずに `cfg.autoReplyEnabled === true && mode === 'auto_mentions'` だけで `現在: Phase 2（自動返信中）` と表示しているため、`banner`（L4392-4396 の「段階公開中」）と真逆になる。
3. **投稿済14件・最大121回・保存11件があるのに、週次レポートが「未測定」と見える**:
   - `src/weekly_growth_report.js` L56-62 が `measuredPosts`（`metrics24hSnapshot.isFrozen === true`）だけを見て、0件のときは `recentPosts` に累計表示数（例: `post.metrics.impressions`）があっても一律「反応の比較や評価は未測定です」としか言わず、上段の「平均67回・保存率5.6%」と矛盾した印象を与える（※ 厳密比較に 24時間凍結スナップショットを必須とする原則自体は維持しつつ、暫定実測があることを正直に並記すべき）。

### B. 投稿本文・選定理由の品質上の違和感（3件）
4. **直近4本＋次の予約案（計5本連続）がすべて同じネタ（「反応変化に追いつけない→実測で次の1本を再設計」）に偏っている**:
   - `WEB-GOOGLE-D12E2479A76266AEA2B4` の `brandKnowledge.verifiedClaims` には4つの柱（`x_official_exhibit` / `fact_based_generation` / `adaptive_learning` / `no_spam_behavior`）があるのに、`draftNextPostWithMeta` が直近投稿で消化済みの柱と未消化の柱を区別しないため、言い換えだけの同テーマが連続している（語句一致ベースの `too_similar_to_recent` だけではすり抜ける）。
5. **生成された予約文（`17:29`）が英語直訳風のAI説明テンプレートになっている**:
   - 実例: 「X上で質の高い投稿を続けたい場合、〜」「この現象の裏には、〜設計上のトレードオフがあります。解決策は、〜です。これにより信用を保ちながら継続的な運用が可能です。」
   - `systemRules` / `candidatePrompt` のメカニズム指示を直訳しすぎており、日本のXタイムラインの自然な文体になっていない。また `08:43` 投稿では `official_brand` なのに「私がX運用を続ける中で」と個人一人称が出ていた。
6. **予約カードの「この下書きの理由」と「誰に／なぜ今／根拠」が噛み合っていない**:
   - `src/bandit_optimization_engine.js` L264-280 の `extractPageHypotheses` が LP見出しを正規表現で `who` / `why` / `proof` に無理やり割り当てているため、「誰に: 『あなたの声』と信用段階の設計…」のように意味が破綻し、上の `この下書きの理由: ...`（`scene / readerPayoff`）と二重表示になっている。

### C. UI文言重複・日英混在（5件）
7. **`週次実測レポート 週次レポート`**（`views/dashboard_view.html` L425-426）→ 「週次」「レポート」の重複。
8. **`LATEST RESULTS`**（`views/dashboard_view.html` L5177）→ 日本語UIに生英語。
9. **`ワークスペースの既定値を使う / Use workspace default`**（`views/dashboard_view.html` L2686）→ スラッシュ日英混在。
10. **予約カードの「保存済み」4連発＋「DB保存済み」**（`views/dashboard_view.html` L4810, L4880, L4883, L4915）＋ `🤝` 二重表示（L1171, L1487）＋ 自己言及ヒント「上の『実務メモ・補足』〜精度が跳ね上がります」（L618）。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **日英完全分離**:
   - `views/dashboard_view.html` で編集・追加した文言は `I18N.ja`、`I18N.en`、`STATIC_TEXT_I18N.en`、および動的 JS（`checkIsEn()`）のすべてを揃え、`tests/dashboard_language.test.js` を通過させること。
2. **既存テスト契約の維持**:
   - `tests/weekly_growth_report.test.js` L43 の `/not measured/u` 契約、L27 の `councilScore: null`、および 24時間凍結スナップショット厳守（未成熟投稿でベスト/ワースト枠を比較しない）を必ず維持すること。
   - `src/next_post_draft.js` / `src/draft_verifier.js` で既存テスト（`validA` 等）が落ちないこと。

---

## 実装仕様

### 1. `src/hybrid_saas_routes.js` & `views/dashboard_view.html` — 方針・Phase 2・UI重複の解消

1. **重複・矛盾する「VELOX AI の現在の方針」カードの整理**:
   - `src/hybrid_saas_routes.js`（L3104-3108 `GET /api/autopilot/jobs`）: `summarizePostedMeasurements`（L3126）の算出を `trustGoalStatus` 呼び出しより前に移し、`trustGoalStatus` へも `recentAvgImpressions: sample.avgImpressions ?? uData.recentAvgImpressions ?? null` 等を渡して、API応答内でも矛盾しないようにする。
   - `views/dashboard_view.html`（L5015-5023）: すでに上段 `#secOperatingSummary`（`j.operatingSummary`）が表示されているときは重複カード `VELOX AI の現在の方針`（`j.trustGoal`）を描画しない（`if (!j.operatingSummary && j.trustGoal && j.trustGoal.situation)` に変更。すぐ下の `@handle · フォロワー ...` 1行サマリーはそのまま残す）。

2. **Phase 2 バッジ矛盾の解消（`views/dashboard_view.html` L4362-4400 `syncAutoReplyUiState`）**:
   - `const serverPhase2 = Boolean(cfg.phase2ServerEnabled === true);` を基準とし、ピル表示用の稼働状態は **`const activePhase2 = Boolean(serverPhase2 && cfg.autoReplyEnabled === true && mode === 'auto_mentions');`** にする。
   - `activePhase2` が `false` かつ `cfg.autoReplyEnabled === true && mode === 'auto_mentions'` のときは、ピルを「稼働中」とは見せず、次の通り正確に表示する：
     - JA: `現在: Phase 1（Phase 2は公開待ち）`
     - EN: `Active: Phase 1 (Phase 2 awaiting rollout)`
   - そうでない `false` のときは現行どおり `現在: Phase 1（確認して手動送信）` / `Active: Phase 1 (Manual approval)` とする。

3. **日本語UIのラベル重複・混在の整理（`views/dashboard_view.html`）**:
   - **週次レポートバッジ（L426 / I18N）**: `weekly_report_badge` を JA `過去7日集計` / EN `7-Day Summary` に変更し、`週次実測レポート 週次レポート` の重複を消す（`STATIC_TEXT_I18N.en` 等も同期）。
   - **`LATEST RESULTS`（L5177）**: `${isEn ? 'Latest results' : '直近の配信履歴'}` にする。
   - **タイムゾーン既定選択肢（L2686）**: `checkIsEn() ? 'Use workspace default' : 'ワークスペースの既定値を使う'` の片言語にする（設定の言語切替時も再設定または `data-i18n` 相当で切り替わるようにする）。
   - **予約カードの「保存済み」重複＆エンジニア用語（L4810, L4880, L4883, L4910-4917）**:
     - L4810: `📝 ${isEn ? 'Draft Ready' : '作成済み'}`
     - L4880: `${isEn ? (isHuman ? 'Post copy (Manual):' : 'Post copy:') : (isHuman ? '投稿本文（手動指定）：' : '投稿本文：')}`
     - L4883: `${isEn ? (isHuman ? 'LOCKED' : 'QUEUED') : (isHuman ? '手動確定' : '予約確定')}`
     - L4910-4917: 重複する `💡保存済み予約：` ボックスを削除しスッキリさせる（本文カードとラベルで十分明確なため）。
   - **予約カードの「下書き理由／誰に・なぜ今・根拠」（L4745-4774 `renderNextPostFacts` & `customerFacingReason`）**:
     - `renderNextPostFacts` で `briefLine`（`scene / readerPayoff`）と `reason`（`誰に: ... なぜ今: ... 根拠: ...`）を両方そのまま出さず整理する：
       - `briefLine` があるときは `isEn ? 'Focus: ' : '今回の切り口: '` として簡潔に1行で出し、`reason` 側で LP見出しそのままの破綻した「誰に: 〜」が重複する場合は省く、または見出しが「誰・理由」として成り立つときだけ表示する。
   - **実務メモ・補足ヒント（L618 ＆ `I18N.en` L1926）**:
     - JA: `ページの文章だけでは伝わりにくい現場の背景・想定読者・具体例を2〜3行足すと、投稿の具体性が上がります。`（`I18N.en` / `STATIC_TEXT_I18N.en` 側のキーも新しい文面に合わせて一致させる！）
   - **紹介プログラム見出しの絵文字二重（L1487 `aff_card_title`）**:
     - `aff_card_title: "公式紹介パートナープログラム（月額30%継続還元）"` のように先頭の重複 `🤝 ` を外す（L1171 にアイコン枠 `🤝` がすでにある）。

---

### 2. `src/weekly_growth_report.js` — 暫定表示数があるのに「未測定」と誤解させないサマリー文

`buildWeeklyGrowthReport`（L56-62）について、24時間凍結スナップショットが 0件（`measuredPosts.length === 0`）のときでも、`recentPosts` に累計 `metrics`（`impressions > 0`）が付いた投稿がある場合は暫定合計を添えて矛盾を無くす（比較・順位づけ自体は引き続き `measuredPosts` のみで行い、`bestSlotAnalysis` / `worstSlotAnalysis` は `null`、EN文言には `not measured` を必ず残す）:

```js
const provisionalImpressions = recentPosts.reduce((sum, p) => {
  const imp = Number(p?.metrics?.impressions ?? p?.metrics24hSnapshot?.impressions);
  return Number.isFinite(imp) && imp > 0 ? sum + imp : sum;
}, 0);
const provisionalBookmarks = recentPosts.reduce((sum, p) => {
  const bm = Number(p?.metrics?.bookmarks ?? p?.metrics24hSnapshot?.bookmarks);
  return Number.isFinite(bm) && bm >= 0 ? sum + bm : sum;
}, 0);
```
- `measuredPosts.length === 0` かつ `provisionalImpressions > 0` の場合：
  - `summary`: `` `取得した最大300件の投稿記録のうち、過去7日間の投稿は${recentPosts.length}件（累計表示 ${provisionalImpressions.toLocaleString()}件・保存 ${provisionalBookmarks.toLocaleString()}件・反映中）です。時間帯の優劣比較に使う24時間凍結スナップショットがまだ揃っていないため、比較評価は未測定です。` ``
  - `summaryEn`: `` `Among up to 300 fetched post records, ${recentPosts.length} were published in the last 7 days (${provisionalImpressions.toLocaleString()} live impressions and ${provisionalBookmarks.toLocaleString()} bookmarks so far). Slot comparisons are not measured yet because frozen 24-hour snapshots are not ready.` ``
- `provisionalImpressions === 0` のときは従来文言を維持。

---

### 3. `src/next_post_draft.js` ＆ `src/draft_verifier.js` — 連続同ネタ化（言い換えループ）と日本語翻訳調の解消

1. **未消化の柱（Claim/Pillar）ローテーション（`src/next_post_draft.js`）**:
   - ヘルパ `selectFreshClaimIndex(claims, recentTexts)` を追加する：
     - `verifiedClaims` の各要素（`mechanism` / `painScene` / `proofQuote` の語・3-gram）と `recentTexts.slice(0, 5)` の一致度をスコア化し、**直近投稿で最も使われていない主張（`focusClaim`）を1つ選ぶ**。
   - `briefPrompt`・`candidatePrompt` に次の指示を渡す：
     - **`focusClaim` を今回の主軸に優先する**（例: 今直近で「反応を見て次の1本を再設計する」話題が続いているなら、今回は `x_official_exhibit` の正規OAuth安全設計、`fact_based_generation` の根拠外数値遮断、`no_spam_behavior` の無差別自動化をしない理由、等の別柱へ明確に切り替える）。
     - 直近3件の投稿がすでに触れたテーマと同じ論点の言い換え（同じ仕組み・同じ課題の再掲）を避けるよう `briefPrompt` と `candidatePrompt` に明示する。

2. **日本語のAI翻訳調テンプレート表現の禁止（`src/next_post_draft.js` ＆ `src/draft_verifier.js`）**:
   - `src/draft_verifier.js` L8 `SLOP`（または翻訳調テンプレート検出）に以下の典型的な直訳AIフレーズを追加し、自動リジェクト→`repair` へ回す（既存テスト文字列に影響しない表現に限定）:
     - `/この現象の裏には|設計上のトレードオフがあります|これにより.{0,24}が可能です/i`
   - `src/next_post_draft.js` L316（`systemRules(false)`）および `candidatePrompt` に以下を追記する：
     - `「この現象の裏には」「設計上のトレードオフがあります」「解決策は、〜です」「これにより〜が可能です」「〜というケースに遭遇します」のような英文直訳風の解説構文は禁止。日本のXで実務家・開発者が実際に書く自然な話し口（短い言い切り、具体的な判断や失敗の場面）で書く。`
     - また `voiceProfile.accountRole === 'official_brand'` のときは、`私がX運用を続ける中で` のような個人日記調の一人称（「私が〜」「私は〜」）をシステムルールで明示禁止する（チーム・開発側・プロダクト主語「VELOX AIは」「運用設計では」等を使う）。

3. **`extractPageHypotheses` の「誰に／なぜ今」誤抽出防止（`src/bandit_optimization_engine.js` L267-280）**:
   - 見出しに `手順` や `設計` を含むだけの文を「誰に（`whos`）」「なぜ今（`whys`）」としてそのまま採用しないよう、`whos` は「〜向け／〜の方／担当者／経営者／開発者／solo／operator／team」等**読者人物を表す行**に限定し、`whys` に単なる見出しタイトルが入らないようにする（見つからなければ `'対象はページに無い'` / `'ページに今の条件は書かれていません'` として既に `customerFacingReason` が綺麗にフィルタできるよう任せる）。

---

## テスト・検証要件

1. **テスト追加・更新**:
   - `tests/weekly_growth_report.test.js`: 24時間凍結が0件でも `metrics.impressions > 0` がある場合に累計表示数と `not measured` の両方が含まれることを検証。
   - `tests/editorial_intelligence.test.js`（または `tests/velox_polish_and_scaling.test.js`）:
     - 「この現象の裏には〜設計上のトレードオフがあります」「これにより〜が可能です」を `runDeterministicAudit` が `ai_slop` として弾くこと。
     - `verifiedClaims` が複数あるときに直近投稿と被らない柱が優先されること。
   - `tests/dashboard_language.test.js`:
     - `syncAutoReplyUiState` が `phase2ServerEnabled === false` のとき `現在: Phase 2（自動返信中）` を出さないこと。
     - `operatingSummary` があるとき重複カード `VELOX AI の現在の方針` を描かないこと。
     - すべての `I18N.ja` / `I18N.en` / `STATIC_TEXT_I18N.en` が一致すること。
2. **必須検証コマンド（最終編集後すべて実行）**:
   - 編集した全 `.js` ファイルの `node --check`
   - `views/dashboard_view.html` および `views/funnel_index.html` の `vm.Script` 構文チェック
   - 関連テスト＋新規テストを含む全スイート `node --test --test-force-exit` 全件成功（fail 0 / skip 0）
   - `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後、2秒待機し `GET /` (200)・`GET /?lang=en` (200)・`GET /dashboard` (302) を確認
