# GROK 実装指示書：X Developer Exhibit カードの色調統一・余白調整・横並び化

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
現在の Hero バッジ（`.hero-exhibit-pill`）および `#secOfficialExhibit`（`views/funnel_index.html` L109, L124-168、`public/funnel/funnel.css` L151-165）について、以下2点のデザイン違和感を解消し、ページ全体の明るい白＋コバルトブルー SaaS トーンへ統一する：
1. **上下の詰まり・くっつき解消**：Hero 下端・`#secOfficialExhibit`・`#secQuickStart` の上下余白（`padding-top` / `padding-bottom`）を十分に確保し、さらに右側 `@VeloxSystemsV4` と `@VeloxSystemsHQ` の縦積み（「上下テーブルがくっついた見た目」）をデスクトップ幅では **左右2列カード** へ変更する。
2. **デザイン・配色の乖離解消**：真っ黒な `.hero-exhibit-pill`（`#0F172A`）と暗いネイビーグラデーションの `.exhibit-showcase` を廃止し、`#secPerformance` バナー（`views/funnel_index.html` L262）や `#secReviews`・`.explorer-stage`・Hero バッジ列と完全に調和する **明るい白＋淡青グラデーション（`#EFF6FF` → `#FFFFFF`）＋コバルトブルー（`#2563EB`）基調** へ統一する。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **日英混在ゼロ**：変更する文言（例：`official_exhibit_url`）を含め、`I18N_LANDING.ja`（`L1702-1712`）と `I18N_LANDING.en`（`L1984-1994`）の同一キー整合を必ず保つこと。
2. **ヘッダー不変**：`.flagship-nav`（1280px ヘッダー）は変更しない。
3. **禁止語・重複ボタン禁止**：`tests/homepage_v51_copy.test.js` の禁止正規表現は一切使わない。リンク／ボタンは各カード1つだけ維持する。

---

## Workstream A: 余白調整＋明るいトーン統一＋右アカウントカード横並び化

### 対象ファイル
- `views/funnel_index.html`（L9, L124, L128, L150, L1703, L1985）
- `public/funnel/funnel.css`（L151-165）
- `tests/toppage_demo_brushup.test.js`

### 実装要件

1. **CSS キャッシュバスター更新 & セクション上下余白の確保（`views/funnel_index.html`）**：
   - `L9`（ブラウザキャッシュ対策）：
     - `<link rel="stylesheet" href="/funnel-assets/funnel.css?v=20261114_5" />` → `?v=20261119_1` へ更新する。
   - `L124` (`#secOfficialExhibit`):
     - 現在: `style="max-width:1120px;margin:0 auto;padding:0 20px 28px;"`
     - 変更後: `style="max-width:1120px;margin:0 auto;padding:52px 20px 24px;"`
     （Hero のラベンダー背景下端から `52px` の白余白を確保し、くっつきを防ぐ）
   - `L150` (`#secQuickStart`):
     - 現在: `style="max-width:1120px;margin:0 auto;padding:8px 20px 36px;"`
     - 変更後: `style="max-width:1120px;margin:0 auto;padding:40px 20px 56px;"`
     （`#secOfficialExhibit` 下端と「約3分で開始する、3つの手順」の間に合計 `64px` の余白を確保し、下の `.editorial-sec` とも自然に接続する）

2. **緑ドット重複の解消（`views/funnel_index.html`）**：
   - `L128`（静的 HTML）、`L1703`（`I18N_LANDING.ja.official_exhibit_url`）、`L1985`（`I18N_LANDING.en.official_exhibit_url`）について、上の `.exhibit-kicker` にすでに `.exhibit-dot`（緑丸）があるため、先頭の `● ` を外して **`developer.x.com/exhibit/veloxpostcloud`** に統一する。

3. **`.hero-exhibit-pill` を Hero 隣接バッジと調和させる（`public/funnel/funnel.css` L151）**：
   - 現在の `#0F172A`（真っ黒背景）を廃止し、隣接する Hero パステルバッジ群（`L110-113`）と調和しつつ上質な存在感を持つ淡青×コバルトスタイルへ変更する：
     ```css
     .hero-exhibit-pill {
       display: inline-flex;
       align-items: center;
       padding: 5px 12px;
       border-radius: 999px;
       font-size: 0.75rem;
       font-weight: 800;
       text-decoration: none;
       color: #1E40AF;
       background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
       border: 1px solid #93C5FD;
       box-shadow: 0 2px 6px rgba(37, 99, 235, 0.10);
       white-space: nowrap;
       transition: all 0.2s ease;
     }
     .hero-exhibit-pill:hover {
       background: #DBEAFE;
       border-color: #2563EB;
       transform: translateY(-1px);
     }
     ```

4. **`.exhibit-showcase` を白＋淡青のブランドデザインへ統一＆右アカウントカード横並び化（`public/funnel/funnel.css` L152-165）**：
   - 暗いネイビーグラデーションを廃止し、`#secPerformance`（`L262`）と統一感のある明るいスタイル・左右バランスへ書き換える：
     ```css
     .exhibit-showcase {
       display: grid;
       grid-template-columns: 1.08fr 1.12fr;
       gap: 28px;
       align-items: center;
       padding: 34px 36px;
       border-radius: 24px;
       border: 1.5px solid #BFDBFE;
       border-top: 3px solid #2563EB;
       background: linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 58%, #F8FAFC 100%);
       box-shadow: 0 14px 36px -14px rgba(37, 99, 235, 0.12);
     }
     .exhibit-kicker {
       display: inline-flex;
       align-items: center;
       gap: 7px;
       padding: 4px 12px;
       border-radius: 999px;
       background: #DBEAFE;
       color: #1D4ED8;
       border: 1px solid #93C5FD;
       font-size: 0.72rem;
       font-weight: 900;
       letter-spacing: 0.06em;
     }
     .exhibit-dot {
       width: 8px;
       height: 8px;
       border-radius: 999px;
       background: #10B981;
       display: inline-block;
     }
     .exhibit-url {
       margin-top: 10px;
       color: #2563EB;
       font-size: 0.8rem;
       font-weight: 800;
       font-family: 'JetBrains Mono', monospace;
     }
     .exhibit-title {
       margin: 10px 0 0;
       color: #0F172A;
       font-size: clamp(1.35rem, 2.2vw, 1.72rem);
       font-weight: 900;
       line-height: 1.35;
       letter-spacing: -0.02em;
     }
     .exhibit-body {
       margin: 12px 0 0;
       color: #475569;
       font-size: 0.94rem;
       line-height: 1.72;
     }
     .exhibit-cta {
       display: inline-flex;
       align-items: center;
       margin-top: 20px;
       padding: 12px 22px;
       border-radius: 999px;
       background: #2563EB;
       color: #FFFFFF;
       font-size: 0.88rem;
       font-weight: 800;
       text-decoration: none;
       box-shadow: 0 6px 16px -4px rgba(37, 99, 235, 0.38);
       transition: all 0.2s ease;
     }
     .exhibit-cta:hover {
       background: #1D4ED8;
       transform: translateY(-1px);
     }
     .exhibit-accounts {
       display: grid;
       grid-template-columns: repeat(2, minmax(0, 1fr));
       gap: 14px;
       align-items: stretch;
     }
     .exhibit-account {
       background: #FFFFFF;
       border: 1px solid #E2E8F0;
       border-radius: 18px;
       padding: 20px 18px;
       display: flex;
       flex-direction: column;
       justify-content: space-between;
       box-shadow: 0 6px 18px -10px rgba(15, 23, 42, 0.08);
     }
     .exhibit-account-role {
       font-size: 0.74rem;
       font-weight: 900;
       color: #1D4ED8;
     }
     .exhibit-account-handle {
       margin-top: 6px;
       font-size: 1.02rem;
       font-weight: 900;
       color: #0F172A;
       word-break: break-word;
     }
     .exhibit-account p {
       margin: 8px 0 14px;
       font-size: 0.82rem;
       line-height: 1.55;
       color: #475569;
     }
     .exhibit-account a {
       display: inline-flex;
       align-items: center;
       justify-content: center;
       padding: 9px 14px;
       border-radius: 999px;
       background: #EFF6FF;
       color: #1D4ED8;
       border: 1px solid #BFDBFE;
       font-size: 0.78rem;
       font-weight: 800;
       text-decoration: none;
       transition: all 0.2s ease;
     }
     .exhibit-account a:hover {
       background: #DBEAFE;
       border-color: #2563EB;
     }
     @media (max-width: 960px) {
       .exhibit-showcase { grid-template-columns: 1fr; padding: 26px 22px; gap: 22px; }
     }
     @media (max-width: 560px) {
       .exhibit-accounts { grid-template-columns: 1fr; gap: 12px; }
       #secOfficialExhibit { padding-top: 36px !important; }
     }
     ```

5. **回帰防止テスト追記（`tests/toppage_demo_brushup.test.js`）**：
   - `public/funnel/funnel.css` を読み込み、`.exhibit-showcase` が `linear-gradient(135deg, #EFF6FF` を使用し（暗い `#0F172A` 背景へ戻らない）、`.exhibit-accounts` が `grid-template-columns: repeat(2` で横並びになっていること、および `● developer.x.com` の二重ドットがないことを検証追記する。

---

## 検証要件（完了報告前に必ず実測確認）

1. `node --check tests/toppage_demo_brushup.test.js`（その他 `.js` 変更があればすべて）
2. `vm.Script` 構文検査：`views/funnel_index.html`・`views/dashboard_view.html`
3. `node --test --test-force-exit`：
   - `tests/homepage_v51_copy.test.js`
   - `tests/toppage_demo_brushup.test.js`
   - `tests/compliance_and_topnav_i18n.test.js`
   - `tests/dashboard_language.test.js`
   - `tests/simple_autopilot_transparency.test.js`
   - `tests/growth_phase.test.js`
   - `tests/autopilot_setup_save.test.js`
   - `tests/autopilot_jobs_separation.test.js`
   - `tests/velox_polish_and_scaling.test.js`
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`https://veloxpostapp.com/`、`https://veloxpostapp.com/?lang=en`、および `https://veloxpostapp.com/funnel-assets/funnel.css?v=20261119_1` が HTTP **200** で返り、更新後の CSS・HTML が反映されていることを `curl` で確認して報告すること。
