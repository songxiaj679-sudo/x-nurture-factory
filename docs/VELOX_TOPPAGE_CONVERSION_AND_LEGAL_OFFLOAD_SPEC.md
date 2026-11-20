# GROK 実装指示書：TOPページ広報コピー最適化（過剰予防線の撤去・利用規約への集約）＆導入3ステップ／AI透明性アピール追加

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
1. 現在の `views/funnel_index.html` と `public/funnel/funnel_client.js` に散在している **過剰な予防線・逃げの記述・仕様とズレた表現**（「AIは下書き支援・誤りがあるかも」「保証しません」「約束しません」の連呼）を整理し、法的免責は `views/compliance_terms.html` へしっかり集約した上で、TOPページは **「事実に基づきつつ、製品本来の価値とカンタンさがしっかり伝わる広報ページ」** に研ぎ澄ます。
2. お客様の登録〜運用イメージが3秒で伝わる **「導入3ステップ（約3分で開始）」** と、実アプリ最大の武器である **「AI の思考（なぜこの投稿か）・現在のアカウント分析・Bio改善助言がひと画面で見える透明性プレビュー」** を TOP ページに追加する。

---

## ⚠️ 絶対厳守ルール（作業前に `/home/songxiaj679/x-nurture-factory/AGENTS.md` を熟読すること）

1. **日英混在ゼロ（Zero-Tolerance Bilingual Rule）**:
   - `views/funnel_index.html` で変更・追加するすべての `data-i18n` / `data-i18n-ph` キーは **必ず `I18N_LANDING.ja` と `I18N_LANDING.en` の両方に同一キーを作成** すること（`tests/homepage_v51_copy.test.js` の全キー検証必須）。
   - `views/compliance_terms.html` も `legal-ja` と `legal-en` の両方を必ず更新すること（第1〜5条と `Automated` 関連条項、`backHomeBtn`、`legalAuthorityBanner` は維持）。
   - `public/funnel/funnel_client.js` 内の変更文字列は `isEn`（`window.currentLandingLang === 'en'`）で JA / EN 分岐すること。
2. **禁止ワード・誇張ゼロ（コンプライアンス維持）**:
   - `tests/homepage_v51_copy.test.js` L12 の禁止正規表現（`7名`, `合議`, `運用レーン`, `凍結リスクゼロ`, `98.4%`, `4.8x`, `複数アカウント`, `サスペンド`, `リプライ営業` 等）や「必ず伸びる・フォロワー増加保証」等の誇大表現は **絶対に使わない** こと。
   - あくまで「実装している実際の機能（URL/人物像からの作成・予約自動実行・実測からの再検討・Bio助言・理由可視化・いつでも編集/停止可）」を前向きかつ正確にアピールする。
3. **既存要素維持**:
   - ヘッダー `.flagship-nav`（1280px 収まり）および既存アンカー ID（`#secReviews`, `#secExplorer`, `#secPerformance`, `#secMultiStream`, `#secSecurity`, `#liveDemoSection`, `#secSpecs`, `#secEditions`, `#secFaq`）を維持する。
   - `tests/compliance_and_topnav_i18n.test.js` が検証する `pipe_f2_desc`, `pipe_f2_badge`, `faq_a8` の方針整合を維持する。

---

## Workstream A: 法的免責・非保証条項を `views/compliance_terms.html` にしっかり集約する

現在 TOP ページ各所に散らばっていた免責文言を法務ページへ預けるため、`views/compliance_terms.html` の第1〜5条を保ったまま **第6条（免責事項およびAI生成内容について） / Article 6 (Disclaimers and AI-generated content)** を追記する（JA / EN 両方）：
- 盛り込む要点（簡潔かつ法的抜け漏れなく）：
  1. **AI生成文章と運用判断**：AI が生成する投稿文やプロフィール助言は登録情報・取得データに基づく支援出力であり、正確性・完全性・最新性・特定目的適合性を保証するものではありません。公開や運用設定に関する最終判断と責任は利用者に帰属します。
  2. **成果および外部プラットフォーム依存**：投稿による表示回数・保存数・反応・売上等の成果、および X（旧 Twitter）のアカウント状態・検索表示・API 仕様変更・制限等について当サービスは保証しません（セキュリティ暗号化や公式 API 利用であっても外部プラットフォーム側の措置・不可抗力による損害について責任を負わない旨）。
- `tests/compliance_and_topnav_i18n.test.js` に第6条（`第6条` / `Article 6`）の存在確認も追記すること。

---

## Workstream B: TOPページから「仕様と乖離した逃げ・消極的な予防線」を撤去し、本来の価値・自信ある広報コピーへ刷新

以下の箇所（`views/funnel_index.html` の HTML 本文＋`I18N_LANDING.ja`＋`I18N_LANDING.en`、および `public/funnel/funnel_client.js`）を刷新する：

1. **最大の問題箇所：Section 11 (`#secReviews` 下、`edit_h2 〜 edit_p_4`, L673-696, L1859-1868, L2124-2133)**
   - 現状の文言が「`AIは下書き作成を支援、最終確認は利用者側で — AIが作成した文章には誤りや不適切な表現が含まれることがあります`」「`アカウントの利用可否や状態を保証するものではありません`」となっており、**自動運用SaaSとしての実態と真逆**で、ページ最下部でユーザーの意欲を削いでいる。
   - これを **「VELOX AI が毎日の運用で大切にしている 4 つの実用設計」** へ全面刷新（JA / EN 両方）：
     - `edit_h2`:
       - JA: `導入してから毎日続く、4つの安心設計`
       - EN: `Four practical strengths built into daily use`
     - `edit_h3_1` / `edit_p_1`（おまかせ運用＋柔軟調整）：
       - JA見出し: `普段はおまかせ、直したいときだけ1クリック調整`
       - JA本文: `X連携とURL（または人物像）を登録したら、時間枠に合わせた投稿作成から予約配信、反応の学習まで自動で進みます。気になった投稿だけ公開前に編集したり別案を作り直したりでき、人が編集した予定は上書きしません。`
     - `edit_h3_2` / `edit_p_2`（今の実仕様：プラン共通品質＋Bio/プロフィールまで助言）：
       - JA見出し: `投稿だけでなく、Bio・固定ポストまでトータル助言`
       - JA本文: `投稿づくりと同じ品質エンジン（根拠抽出・文体再現・審査ゲート）は全プラン共通です。さらに現在のプロフィールを踏まえたBio改善案や固定ポストのヒントも管理画面で提示し、フォローにつながりやすい土台づくりまで支えます。`
     - `edit_h3_3` / `edit_p_3`（AIの頭の中が見える透明性）：
       - JA見出し: `「いま何を見て、なぜこの1本か」が毎回わかる`
       - JA本文: `ブラックボックス任せにせず、現在のアカウント状態、いま優先している運用バランス（価値提供中心か自然PRか）、次の投稿の狙いまで管理画面に明示します。理由がわかるから安心して任せられます。`
     - `edit_h3_4` / `edit_p_4`（1アカウントクリーン設計・停止自由）：
       - JA見出し: `1アカウント完結・公式API準拠のクリーン運用`
       - JA本文: `無差別な自動いいね・自動フォロー・一斉リプライは行いません。通常の運用や確認制返信（Phase 1）であれば複雑な別アカウント設定も不要で、不要になったときはボタン1つでいつでも停止・解約できます（※規約条件の詳細は利用規約に記載）。`
     - 上記に対応する自然な英文を `I18N_LANDING.en` にも入れること。

2. **Section 6 (`sec_lead`, `sec_c2_title`, `sec_c2_desc`, L379-400 & JA/EN辞書)**:
   - `sec_lead` 末尾の「`暗号化やAPI連携は、アカウント停止・情報漏えい等が起きないことを保証するものではありません。`」を削除！代わりに暗号化とStripe決済・規約準拠の安心説明に整える（例 JA: `Xの認証情報は AES-256-GCM で暗号化して保管し、決済は世界標準の Stripe Checkout を採用しています。データの取り扱い方針や規約条件はフッターの各種法務ページでいつでも確認できます。`）。
   - `sec_c2_title` / `sec_c2_desc`:
     - 旧: `投稿内容は公開前にご確認ください — AIの投稿案は必ずしも自社の方針や最新情報に合うとは限りません…`
     - 新（JA）: `🤝 おまかせ中も、いつでも確認・微調整` / `自動作成された次の1本はダッシュボードでいつでも確認でき、こだわりたい時だけ自分の言葉へ修正・別案再生成・即時停止が可能です。`
     - 新（EN）: `🤝 Full visibility and 1-click edits anytime` / `Review upcoming scheduled posts on the dashboard whenever you like, tweak wording in your own voice, request a fresh angle, or pause with one click.`

3. **Section 7 ライブデモ（`demo_lead` L423 & `public/funnel/funnel_client.js` L2569）**:
   - `demo_lead`: 末尾の「`デモの出力は参考例であり、実際の成果を保証するものではありません。`」を削除し、`登録不要・保存なしで、入力したサイトURLやターゲット像から実際にどのような投稿案が作られるかすぐ体験できます。`（EN: `No sign-up needed and nothing is saved—enter your webpage or topic to preview how VELOX AI grounds facts and drafts a post in seconds.`）に改善。
   - `public/funnel/funnel_client.js` L2569:
     - 旧: `'参考です。保存されません。成果は約束しません。'` / `'Reference only. Not saved. Not a promise of results.'`
     - 新: `'ライブ生成サンプル（入力データは保存されません）'` / `'Live preview sample (inputs are not saved)'`

4. **Section 10 FAQ（`faq_a2`, `faq_a4`, `faq_a5`, L591-624 & JA/EN辞書）＆ フッター（`footer_disclosure` L710-713）**:
   - `faq_a2`（アカウント制限への配慮）：冒頭「`保証することはできません`」を止め、**実際にとっている対策を先頭に明快に記載**：「`無差別な自動いいね・自動フォロー・一斉リプライといったスパム行為を一切行わず、X公式 OAuth 2.0 連携と投稿間隔・重複ガード・根拠限定チェックによって健全なアカウント運用を徹底しています（※プラットフォーム側の仕様や規約に関する詳細は利用規約をご確認ください）。`」
   - `faq_a4`（領収書・インボイス）：末尾「`ご自身の状況に応じてご確認ください`」を削り、`Stripe Checkout の決済完了後に発行される領収書・請求書をご利用いただけます。詳細は Stripe の決済確認画面・案内をご確認ください。` と前向き・簡潔に整理。
   - `faq_a5`（ブランド信用）：末尾「`API仕様の変更、アカウント状態、閲覧数や売上などの成果自体は保証するものではありません。`」を削除し、**事実検証・文体再現・NG表現除外・Critic品質審査・公開前修正可**というブランド保護機能を堂々と伝える。
   - `footer_disclosure`：突き放し表現（`〜は利用者が確認してください`）を自然な法務リンク案内に改める（例：`VeloxPost Cloud は X 公式 API と Stripe Checkout を利用した X 運用支援 SaaS です。詳細な提供条件・免責事項・返金および解約条件は、上記の利用規約・特定商取引法に基づく表記をご確認ください。`）。

---

## Workstream C: 追加するとさらに良くなる 2 つの広報要素

1. **導入 3 ステップ（「約3分・とにかくカンタン」を伝える `#secQuickStart`）を追加**
   - 配置：Hero 下の公式アカウントバナーのすぐ後（`#secReviews` の直前）。
   - 横 3 カラムのクリーンなカード構成（スマホ時は縦 1 列）：
     - **01｜X とワンクリック連携**：公式 OAuth 2.0 で安全に接続。通常の自動投稿なら別アカウント作成や特殊な自動化ラベル設定は不要です。
     - **02｜URL か人物像を入れるだけ**：紹介したいページ URL か「育てたいアカウント像」の片方（または両方）を保存。同時に今の Bio 改善案も確認できます。
     - **03｜開始を押して、あとはおまかせ**：時間枠に合わせて作成・予約・反応学習を自動で継続。必要なときだけ「少し直す」「別案にする」で調整できます。
   - **重要**：CSS・文言はコンパクトに収め（各ステップ 2 行以内）、全要素に `data-i18n`＋`ja`/`en` 訳を付けること。

2. **「管理画面で見える AI の思考・現在地・Bio助言」サンプルパネルをわかりやすく紹介**
   - `#secMultiStream`（Section 5 後半の画面イメージエリア）に並んでいる `投稿実績の表示例` カードの隣（または上部・タブ下）をブラッシュアップするか、同カード内に **「💡 今回の狙い・Bio改善・運用方針」の見え方イメージ** を 2〜3 行追加し、「数字の集計だけでなく **なぜこの投稿か＋アカウント全体のアドバイス** まで画面に出ること」が一目で伝わるようにする！（※「画面イメージ / サンプル」であることを明記し、実在しない実績数値は入れないこと）。

---

## 検証要件（完了報告前に必ず実行・実測出力を確認すること）

1. 変更した `.js`（`public/funnel/funnel_client.js` 等）に `node --check`
2. `views/funnel_index.html`、`views/dashboard_view.html`、`views/compliance_terms.html` 全 `<script>` に対して `vm.Script` 構文検査
3. テスト実行 (`node --test --test-force-exit`)：
   - `tests/homepage_v51_copy.test.js`
   - `tests/compliance_and_topnav_i18n.test.js`
   - `tests/toppage_demo_brushup.test.js`（旧文字列 `保証するものではありません` / `成果は約束しません` / `誤りや不適切な表現が含まれることがあります` が TOP ページに残っていないこと、一方 `compliance_terms.html` に第6条免責があること、`#secQuickStart` と JA/EN キー一致も検証するよう更新！）
   - `tests/free_experience_and_consent.test.js`
   - `tests/simple_autopilot_transparency.test.js`
   - `tests/dashboard_language.test.js`
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`/`、`/?lang=en`、`/views/compliance_terms.html` の HTTP 200 と表示切り替わりを `curl` で確認すること。
