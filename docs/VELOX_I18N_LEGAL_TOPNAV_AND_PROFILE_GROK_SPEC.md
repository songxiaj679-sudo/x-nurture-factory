# GROK 実装指示書：法務ページ日英対応・トップヘッダーはみ出し修正・Xプロフィール設定アドバイス・日英混在ゼロ化ガード

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
1. 毎回アップデートで再発する「日本語・英語の混在」をシステム設計＋テストで完全に根絶する
2. トップページ（`/`）ログイン時のヘッダー右側「ログアウト」はみ出し＋重複ボタン整理を修正する
3. 法務・特定商取引法 4 ページ（`views/compliance_*.html`）を、日本の個人事業主としての法的・税務的正当性を保ったまま海外ユーザーにも読める日英対応にする（記述の矛盾・個人メール直書きも是正）
4. トップページ（`views/funnel_index.html`）に残っている旧記述（自動返信や記述矛盾）と `?lang=en|ja` 初期言語指定を整える
5. お客様が自分の X 側で設定すべき項目（推奨 BIO・固定ポスト・ハイライト・Automatedラベル等）を分かりやすく提示する「お客様向け X プロフィール設定ガイド／推奨提案」を追加する（初期画面のシンプルさは崩さない）

---

## ⚠️ 絶対厳守ルール（Rule 0：日英混在を二度と起こさない）

Grok は以降の全作業において、まず `/home/songxiaj679/x-nurture-factory/AGENTS.md` を読み、以下を徹底すること：
1. **UI に日本語を 1 文字でも追加・編集したら、同一作業内で必ず英語訳を追加すること**（`data-i18n` + `I18N.ja/en`、`STATIC_TEXT_I18N.en`、`STATIC_ATTRIBUTE_I18N.en`、`I18N_LANDING.ja/en`、および JS の `checkIsEn()` / `window.currentLandingLang === 'en'` 分岐）。
2. **`uiLang`（画面言語）と `aiTargetLang`（投稿生成言語）を絶対に混同しないこと**。管理画面のボタン・タイトル・案内文は必ず画面言語（JA/ENトグル）に従い、投稿本文プレビューだけ `aiTargetLang` に従う。
3. **本仕様書 Workstream E の「日本語取り残し自動検知テスト」を実装して pass させるまで完了としないこと**。

---

## Workstream A: トップページ（`/`）ヘッダーはみ出し解消 ＋ `?lang=en|ja` クエリ対応

### 背景・確認済みの原因
現在の本番スクリーンショット（1280px 幅、ログイン済み状態）で、`/` ヘッダー右端の `🚪 ログアウト` が画面外へ切れている。
- 原因 1: `public/funnel/funnel_client.js` L1826-1851 の `syncViewByAuthStatus()` が、ログイン時に以下を同時にすべて表示している：
  - `#topDashboardBtn`（`🚀 ダッシュボードを開く` -> `/dashboard` 遷移）
  - `#topAuthBtn`（`👤 <loggedInEmail>` -> **`onclick` が同じく `/dashboard` 遷移！役割が完全重複し、しかも長いメールアドレス幅を取る＋個人メール露出**）
  - `#topUnlockBtn`（`🚪 ログアウト`）
- 原因 2: `public/funnel/funnel.css` L81 で `.product-links`（上部8リンク）の非表示が `@media (max-width: 1120px)` のため、1280px 幅のときに 8 リンクと右ボタン群が横一列で競合している。

### 実装要件
1. **`public/funnel/funnel_client.js`（L1826-1851 `syncViewByAuthStatus()`）**:
   - ログイン済み（`loggedInEmail` あり）のとき、**`#topDashboardBtn` と `#topAuthBtn` の重複を整理**し、`#topAuthBtn` は `display = 'none'` にする（メールは管理画面でのみ確認すれば足り、LP 上で個人メールが映り込む問題と横幅圧迫を同時に解消できる）。
   - 未ログイン（`!loggedInEmail`）のときは従来通り `#topAuthBtn`（ログイン）と `#topUnlockBtn`（新規登録）を表示する（`tests/homepage_v51_copy.test.js` の ID チェック `#topAuthBtn`, `#topUnlockBtn`, `#topDashboardBtn` は維持）。
   - `#topDashboardBtn` は 1280px で収まりやすい簡潔表記（JA: `🚀 ダッシュボード` / EN: `🚀 Dashboard`）にする。
2. **`public/funnel/funnel.css`**:
   - `.flagship-nav` で 1280px〜1360px 帯でも絶対にはみ出さないよう調整する：
     - `.product-links` の gap を詰めつつ、`@media (max-width: 1260px)` で `.product-links` を非表示（または 1320px 未満でコンパクト化）にし、`.nav-right-btns` が絶対に切れないようにする。
     - `header .btn-nav-outline`, `header .btn-nav-blue`, `#topDashboardBtn` に `white-space: nowrap; flex-shrink: 0;` を維持。
3. **`views/funnel_index.html`（L2402 `initLandingLanguage()`）**:
   - URL クエリ `?lang=en` または `?lang=ja` が指定された場合は `localStorage` より優先して適用する（`@VeloxSystemsHQ` や Exhibit の英語導線 `https://veloxpostapp.com/?lang=en` がどの環境でも確実に英語で開くようにする）。

---

## Workstream B: 法務 4 ページ（`views/compliance_*.html`）の日英対応 ＋ 実態・整合性修正

### 前提方針（重要）
- 運営者は **日本の個人事業主（納税・特商法対応のため日本語表記が必須）** である。
- したがって **特商法表記・規約・プライバシー・運営者情報すべてにおいて日本語表記を維持・優先** した上で、海外ユーザー（特に `https://developer.x.com/exhibit/veloxpostcloud` の `Privacy` / `Terms` から来るユーザー）が読めるよう **JA / EN 切り替え対応＋法的正文注記** を実装する。

### 対象ファイルと具体修正
全 4 ファイル（`views/compliance_tokushoho.html`, `views/compliance_terms.html`, `views/compliance_privacy.html`, `views/compliance_company.html`）に共通スクリプト＋トグルバー（右上に `🌐 日本語 / English` ボタン）を追加する：
- 初期言語判定順序：
  1. URL クエリ `?lang=en` / `?lang=ja`
  2. `velox_lang` クッキー（`veloxpostapp.com` の `/` や `/dashboard` と共有）
  3. `localStorage.getItem('velox_lang')`
  4. `navigator.language`（`ja` 始まりなら `ja`、それ以外は `en`）
- また、**英語モード時でも「法的正文は日本語版です（For legal compliance under Japanese law, the Japanese version is authoritative; English is provided for reference.）」の1行バナーを表示**する（特に特商法・規約で重要）。
- `views/funnel_index.html` フッター（L703）や OAuth リンクでは現在 `velox_lang` クッキーが共有されているため、同一ブラウザの言語設定をそのまま引き継いで開ける。さらに `?lang=` がなくてもトグルボタンで即切り替え可能にする。

#### 各ファイルの実態是正（必須）
1. **`views/compliance_tokushoho.html`**:
   - 日本語の特定商取引法第 11 条項目（松下 駿介、所在地、電話番号、販売価格、14日間無料トライアル、いつでもボタン1つで停止可能な解約条件等）を正確に保持しつつ、英語版データ（EN テーブル）を並列実装し、JA/EN で切り替え可能にする。
   - 連絡先メールアドレス欄の `（※ songxiaj679@gmail.com でも承っております）` という個人用 Gmail 表記を削除し、公式サポート窓口 `support@veloxpostapp.com` に一本化する（`<meta name="robots" content="noindex, nofollow">` は維持）。
   - 販売価格に JPY（¥4,980 / ¥9,800 / ¥19,800・税込）と USD（$39 / $79 / $179）の両方を正確に記載（ダッシュボードの `PLAN_PRICES` と完全一致させる）。
2. **`views/compliance_terms.html`**:
   - 現行の第1条〜第4条（第3条の `Automated` ラベル・受信メンション限定・停止ワード遵守を含む）の完全な英語訳を用意し、JA / EN 切り替え対応にする。
   - 「個人事業主 松下 駿介（VeloxPost Cloud 運営者）」が提供するサービスであり、日本法（準拠法・合意管轄は日本の法令および運営者所在地管轄裁判所）に基づく条項を第5条として追記する（JA / EN 両方）。
3. **`views/compliance_privacy.html`**:
   - 全条項を JA / EN 切り替え対応にする。
   - **矛盾・誇張表現を是正**：
     - 「軍事規格であるAES-256-GCM」→「AES-256-GCM 暗号化方式」に修正。
     - 「第三者への開示・提供は一切行いません」と「法令に基づく場合」の矛盾を整理し、サービス提供に必要な外部委託・API連携（X Corp. 公式 API、Stripe 決済、Firebase / Google Cloud 基盤、AI テキスト処理 API）および法令に基づく要請を除き第三者へ提供しない旨を透明かつ正確に JA / EN 両方で明記する。
4. **`views/compliance_company.html`**:
   - 現行の `Tokyo, Japan / Global Distributed Engineering Team` や `Google Cloud / Gemini AI` 等の実態とズレた文言を修正し、`compliance_tokushoho.html` と完全に一致させる：
     - 事業者形態・代表者：個人事業主（Sole Proprietor） / 松下 駿介（Shunsuke Matsushita）
     - サービス・屋号：VeloxPost Cloud
     - 所在地・拠点：日本（兵庫県神戸市 / Hyogo, Japan）※特商法に基づく詳細表記は `compliance_tokushoho.html` へリンク
     - 主な技術基盤：X API v2 (OAuth 2.0)、xAI API、Firebase / Google Cloud、Stripe Checkout、Cloudflare
     - JA / EN 切り替え対応（`<meta name="robots" content="noindex, nofollow">` は維持）。

---

## Workstream C: トップページ（`views/funnel_index.html`）の旧記載・一貫性改善

トップページ全体を点検し、実態・利用規約・管理画面と食い違っている箇所を修復する（JA / EN 両辞書を必ず同時に更新）：
1. **L266 (`pipe_f2_desc`) / L271 (`pipe_f2_badge`) / L649 (`faq_a8`) の表現統一**:
   - 現在 LP では「自動返信は一切行いません」と書かれているが、管理画面（高度な設定内 `#secMentions`）と利用規約第 3 条・Exhibit では「受信メンションへの確認制返信（Phase 1）およびオプトイン＋X `Automated` ラベル準拠の限定機能」を備えている。
   - JA / EN ともに表現を統一する：
     - 例（JA）: `無差別な自動いいね・自動フォロー・無差別一斉リプライは行いません（受信メンションへの返信支援は確認制・オプトインおよびXのAutomatedラベル準拠のみ対応）。`
     - 例（EN）: `No unsolicited auto-likes, auto-follows, or mass keyword replies are ever performed (inbound mention support is opt-in and user-reviewed, or gated by X's Automated account label).`
2. **価格表記の一貫性（`plan1_price` / `plan2_price` / `plan3_price`）**:
   - EN 辞書側で `$39 / mo` などの英語表記を先頭に、`¥4,980` 等と明確に対応づける。
3. **`secReviews`・`secExplorer`・`secFaq` に残る未更新文言チェック**:
   - すべてのセクションが「次の1本を根拠限定で作成・配信 → 2〜6時間・24〜36時間実測 → 次の1本へ学習反映」の仕様と 100% 一致していることを確認する（`tests/homepage_v51_copy.test.js` の `forbidden` 正規表現に触れないこと）。

---

## Workstream D: お客様向け「X プロフィール最適化ガイド（推奨 Bio・固定・ハイライト案内）」

### 設計原則（「とにかく初期はシンプルに」を守る）
- VELOX は投稿作成・スケジュールまでは自動化できるが、**「X のプロフィール Bio」「表示名」「プロフURL」「固定ポスト（Pin）」「ハイライト（Highlights）」「Automated ラベル設定」はお客様本人が X 公式画面で設定するしかない領域**である。
- 初回管理画面のごちゃつきを増やさないため、**独立した巨大カードは増やさず**、以下のいずれか（または両方）のクリーンな導線で提供する：
  1. 既存の **`📘 使い方ガイド` モーダル（`#usageGuideOverlay`）** 内、または **`⚙️ 高度な設定`（`#advancedSettingsDetails`）内** に「**✨ Xプロフィール推奨設定（お客様ご自身で行う設定）**」セクションを用意する。
  2. さらに便利機能として、ボタン 1 つ（`POST /api/autopilot/profile-checklist` またはクライアント＋既存設定連動）で、**そのお客様の現在の「アカウント名・URL有無・投稿言語（JA/EN）・ターゲット像」に合わせた推奨 Bio 例文（160文字以内・誇張なし・コピーボタン付き）＋固定ポスト案＋ハイライト活用ガイド** を表示できるようにする。
  - 含めるべき必須チェックリスト項目（JA / EN 完全両対応）：
    - **表示名**: 何の人/サービスか一瞬で分かる肩書き（例：`名前｜〇〇運用ログ`）
    - **自己紹介文（Bio・160文字以内）**: 「誰向けか」「何を発信するか」「公式URL先」を事実のみで簡潔に記載（テンプレート例を日本語アカウント向け・英語グローバルアカウント向けで提示＋1クリックコピー）
    - **固定ポスト（Pin）**: 初めてプロフィールに来た人が最初に読む 1 本（アカウントの立場・提供内容・URL案内。メイン言語に合わせる）
    - **ハイライト（X Premium利用者向け）**: 重要な実績投稿や製品紹介投稿を追加（固定欄を塞がずに保管）
    - **Automated ラベル確認**: 自動返信 Phase 2 を使う場合のみ X 設定 → アカウント → 自動化 で設定

---

## Workstream E: 日英混在を機械的に防ぐ自動テストゲート（必須）

**Grok が今後変更するたびに日英混在を即時検出・失敗させるテスト** を追加すること：
1. **`tests/dashboard_language.test.js` 強化**:
   - 既存の `data-i18n` キーチェックに加えて、**`views/dashboard_view.html` の公開 `<header>` および `#cockpitLockedWorkspace` / `<main>` 内の主要要素（`<script>`, `<style>`, `wizStep_*` を除く）で、日本語文字を含むテキストノードが `data-i18n` 要素配下か、または `STATIC_TEXT_I18N.en` に完全一致キーとして登録されていることを検証**するテストを追加する。漏れがあれば即 fail させる。
2. **新規テスト `tests/compliance_and_topnav_i18n.test.js`**:
   - 4 つの `views/compliance_*.html` すべてに JA/EN 切り替え UI・`?lang=` 判定・日本語法的正文・英訳テキストが存在し、個人 Gmail アドレス（`songxiaj679@gmail.com`）や矛盾フレーズ（`軍事規格`, `Gemini AI` 等）が残っていないことを検証。
   - `public/funnel/funnel_client.js` のログイン済み表示が `#topAuthBtn` と `#topDashboardBtn` を二重表示しないこと、および `funnel.css` でヘッダーが `overflow` しないブレークポイント設計になっていることを検証。
   - `views/funnel_index.html` の `official_exhibit_btn` や `official_log_btn` や主要セクションが `forbidden` 語句を含まず、JA/EN 両辞書に全 `data-i18n` / `data-i18n-ph` キーが存在することを検証（`tests/homepage_v51_copy.test.js` 互換）。

---

## 完了条件・報告フォーマット（GROK へ）
実装完了後は必ず以下すべてを実行し、実際の出力結果のみを報告すること：
1. `node --check` による全修正 JS ファイル構文確認
2. `views/funnel_index.html`、`views/dashboard_view.html`、`views/compliance_*.html` 内すべての `<script>` ブロックに対する `vm.Script` 構文チェック
3. 既存の関連テスト（18ファイル＋新規テスト）すべてを `node --test --test-force-exit` で実行し、全件 PASS・失敗 0・スキップ 0 を確認
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後、2 秒待って `https://veloxpostapp.com/`（200）、`/dashboard`（302）、`/views/compliance_tokushoho.html`（200）、`/views/compliance_terms.html`（200）、`/views/compliance_privacy.html`（200）、`/views/compliance_company.html`（200）を確認
