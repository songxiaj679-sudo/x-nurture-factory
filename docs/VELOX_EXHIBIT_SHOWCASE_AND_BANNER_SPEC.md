# GROK 実装指示書：X 公式「Developer Exhibit」掲載実績の大型ショーケース化（Hero連携 ＋ 実運用 Japan/Global カード強化）

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
`developer.x.com/exhibit/veloxpostcloud`（X社の公式 Developer Exhibit アプリ展示ページ）に掲載されている実績は、未承認の非公式ツールとの決定的な差別化・信頼根拠になるため、現在控えめな 1 行ボックスに留まっている `views/funnel_index.html` L123-135 の公式バナーを **一目で目に入る堂々としたショーケースカード** へアップグレードする。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` 準拠）

1. **日英混在ゼロ**：追加・変更するすべてのテキストは `data-i18n`（`I18N_LANDING.ja` と `I18N_LANDING.en` の両方に同一キー）を必ず定義すること。
2. **表現・事実正確性・禁止ワード**：
   - X社による「保証・認定・推薦ランク優遇」のような誤認表現は使わず、事実通り **「X公式 Developer Exhibit 掲載プロダクト（OAuth 2.0 準拠アプリ）」** として堂々と紹介する。
   - `tests/homepage_v51_copy.test.js` L12 の禁止正規表現（`7名`, `合議`, `運用レーン`, `凍結リスクゼロ`, `複数アカウント`, `multiple .*accounts`, `98.4%`, `4.8x` 等）は一切使わないこと。
3. **ボタン重複なし・ヘッダー不変**：
   - 1つの遷移先につきボタン／アクションリンクは 1 つに整理する（テキスト内リンクとボタンを二重にしない）。
   - `.flagship-nav`（1280px ヘッダー）は変更しない。

---

## Workstream A: Hero 内の小さな公式掲載バッジ連携 ＋ Hero直下 `#secOfficialExhibit` 大型ショーケースカード化

### 対象ファイル
- `views/funnel_index.html`（L100-136 および `I18N_LANDING.ja` / `.en`）
- `public/funnel/funnel.css`（ショーケース用スタイル・レスポンシブ調整）

### 実装要件

1. **Hero 内の最上部またはバッジ列（L101-113 付近）へのさりげない導線（任意・視認性UP）**：
   - Hero 右上アイキャッチ（`VELOX AI — AI-ASSISTED X WORKFLOW` の近く、またはバッジ列の先頭）に、スクロールせずにファーストビューでも気づけるクリック可能な展示バッジを配置する：
     - `<a href="https://developer.x.com/exhibit/veloxpostcloud" target="_blank" rel="noopener noreferrer" ... data-i18n="hero_exhibit_pill">🏆 X公式 Developer Exhibit 掲載アプリ ↗</a>`
     - EN: `🏆 Listed on X Developer Exhibit ↗`
   - 1280px 幅でヒーローコピー行を圧迫しないコンパクトなデザイン（`display:inline-flex; padding:5px 12px; border-radius:999px; font-size:0.75rem; font-weight:800;`）にする。

2. **Hero 直下のバナー（L123-135）を大型ショーケース `#secOfficialExhibit` へ刷新**：
   今の細い白枠（`padding:16px 18px;` だけ）から、**存在感のある 2 ペイン（左右または上下段）のショーケースカード** へアップグレードする：
   - **ビジュアル設計（`public/funnel/funnel.css` に追加し、モバイル `<860px` は 1 カラム縦積みに）**：
     - カード全体：存在感のあるダークネイビー〜ロイヤルブルーのアクセントまたは上質なハイコントラストカード（例：上部に強いブルー/スレート枠 `border: 2px solid #BFDBFE` + 深いネイビー左カードまたは左上の目立つ公式Exhibit認証バー、十分な `padding: 28px 32px; border-radius: 24px;` とソフトシャドウ）。
   - **左メイン枠（X Developer Exhibit 公式掲載のアピール — 大きく主役に！）**：
     - ラベル：`OFFICIAL X DEVELOPER DIRECTORY`（緑ドット `● developer.x.com/exhibit/veloxpostcloud`）
     - 大見出し（`font-size: clamp(1.35rem, 2.2vw, 1.75rem); font-weight: 900;`）：
       - JA (`official_banner_title`): **`X公式「Developer Exhibit」掲載アプリ`**
       - EN (`official_banner_title`): **`Featured on X's Official Developer Exhibit`**
     - 説明文（2〜3行で説得力を持たせる）：
       - JA (`official_banner_body`): **`X 公式のアプリ展示ギャラリー「Developer Exhibit」に、OAuth 2.0 準拠のコンテンツ作成・予約配信 SaaS として公開掲載されています。実運用での挙動は、日本・Global の各公式アカウント上でも日々公開しています。`**
       - EN (`official_banner_body`): **`Published in X's official Developer Exhibit as an OAuth 2.0 content drafting and scheduling platform. Live daily operations are demonstrated openly on our Japan and Global accounts.`**
     - 大きく押しやすいメイン CTA ボタン：
       - `<a href="https://developer.x.com/exhibit/veloxpostcloud" target="_blank" rel="noopener noreferrer" ... data-i18n="official_exhibit_btn">🏆 X公式 Exhibit ページを見る ↗</a>`（EN: `🏆 View on X Developer Exhibit ↗`）
   - **右サブ枠（Japan & Global 公式運用アカウントカード 2枚）**：
     - ボタン重複を避けるため、本文中には `<a href>` を置かず、各公式アカウント専用カードにボタン（またはクリック可能カード）を 1 つずつ配置する：
       - **Card 1（Japan）**：
         - `🇯🇵 Japan Official` / `@VeloxSystemsV4`
         - JA補足: `日本語・国内向けの実運用ログ` / EN補足: `Japanese live account & product logs`
         - ボタン (`official_log_jp_btn`): `@VeloxSystemsV4 を見る ↗` / `Open @VeloxSystemsV4 ↗`
       - **Card 2（Global）**：
         - `🌐 Global Official` / `@VeloxSystemsHQ`
         - JA補足: `英語・海外向けの実運用ログ` / EN補足: `English global live account`
         - ボタン (`official_log_hq_btn`): `@VeloxSystemsHQ を見る ↗` / `Open @VeloxSystemsHQ ↗`

---

## 検証要件（完了報告前に必ず実測確認）

1. `node --check`（変更した `.js` があればすべて。`tests/toppage_demo_brushup.test.js` 等にアサーションを追加したらそれも検証）
2. `vm.Script` 構文検査：`views/funnel_index.html`（全インライン `<script>`）および `views/dashboard_view.html`
3. `node --test --test-force-exit`：
   - `tests/homepage_v51_copy.test.js`
   - `tests/toppage_demo_brushup.test.js`（`secOfficialExhibit` と `developer.x.com/exhibit/veloxpostcloud` と `VeloxSystemsV4`・`VeloxSystemsHQ`・`hero_exhibit_pill`・JA/ENキー揃いを検証追記）
   - `tests/compliance_and_topnav_i18n.test.js`
   - `tests/dashboard_language.test.js`
   - `tests/simple_autopilot_transparency.test.js`
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`https://veloxpostapp.com/` と `https://veloxpostapp.com/?lang=en` が HTTP **200** で返り、HTML に `#secOfficialExhibit`、`VeloxSystemsV4`、`VeloxSystemsHQ`、`developer.x.com/exhibit/veloxpostcloud` が含まれることを `curl` で確認して報告すること。
