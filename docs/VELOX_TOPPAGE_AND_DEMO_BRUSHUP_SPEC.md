# GROK 実装指示書：TOPページ（`/`）・無料ライブデモ・UI/文体ブラッシュアップ

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
本番スクリーンショット（1280px）および実コード精査で判明した **TOPページ（`views/funnel_index.html`）・無料ライブデモ（`src/luxury_web_funnel.js`, `src/lp_knowledge_extractor.js`, `src/next_post_draft.js`, `public/funnel/funnel_client.js`）・CSS余白/改行崩れ** を一掃し、信頼感・可読性・最新機能訴求（超シンプル設定・Bio助言・AI思考の見える化）を磨き上げる。

---

## ⚠️ 絶対厳守ルール（作業前に必ず `/home/songxiaj679/x-nurture-factory/AGENTS.md` を熟読すること）

1. **日英混在ゼロ（Zero-Tolerance Bilingual Rule）**:
   - `views/funnel_index.html` で変更・追加するすべての `data-i18n` / `data-i18n-ph` キーおよび `EXPLORER_I18N_DATA` は **必ず `ja` と `en` の両方を同時に更新** すること（`tests/homepage_v51_copy.test.js` の全キー 2重登録チェックを必ず通過させること）。
   - `public/funnel/funnel_client.js` 内の動的文言は必ず `window.currentLandingLang === 'en'` で JA / EN 分岐すること。
2. **禁止ワード・ヘッダー予算・既存契約の維持**:
   - `tests/homepage_v51_copy.test.js` L12 の禁止正規表現（`7名`, `合議`, `凍結リスクゼロ`, `98.4%`, `複数アカウント` 等）を絶対に混入させないこと。
   - `.flagship-nav`（1280px ヘッダー）の現時点での綺麗な収まり（`🚀 ダッシュボード`・`🚪 ログアウト`）は一切崩さないこと。
   - `tests/homepage_v51_copy.test.js` L27-35 が期待する `previewFactsFromClaims()` の戻り値構造（`painScene — mechanism — proofQuote` と `audience`）はテスト互換を保つこと。
   - `tests/compliance_and_topnav_i18n.test.js` L62-66 が検証する `pipe_f2_desc`, `pipe_f2_badge`, `faq_a8` の整合表記を維持すること。

---

## Workstream A: 無料ライブデモの「途中切れバグ」＆「AI論文調の堅苦しい投稿案」を修正

### 確認済みの不具合原因（実コード＆本番スクリーンショットより）
1. **文字数の強制 `.slice(0, 80)` による途中切断バグ**：
   - 本番デモ結果で `...自動いいね・自動フォロー・自動返信は一切行` のように **語尾の途中でブツ切れ** が発生している。
   - 原因：`src/lp_knowledge_extractor.js` L158 および L180 で `proofQuote` を無条件に `.slice(0, 80)` しており、さらに `src/luxury_web_funnel.js` L1645 (`previewFactsFromClaims`) で `painScene — mechanism — proofQuote` をそのまま連結して表示しているため、同じ主張が二重になりつつ末尾が途中で切れている。
2. **論文調の硬い二重質問締め**：
   - 自分のサービスサイトでデモを試した際、投稿案の末尾が *「…どのような示唆を現場の運用者に与えるでしょうか。…どのような工夫が有効だと感じますか？」* のように、X の自然な投稿ではなく「論文のまとめ＋質問2連発」になってしまう。
3. **デモ実行後のボタン表記が紛らわしい**：
   - `public/funnel/funnel_client.js` L2578 が `'別のページで試す'` (`Try another page`) となっており、「外部リンクに飛ぶのか？」と誤解される。

### 実装要件
1. **`src/lp_knowledge_extractor.js`**:
   - 語尾途中で切れないヘルパー `clipCleanText(text, max)` を実装する（例：最大長以内に句点 `。` / `.` がある場合はそこまでの完全な文で切る。無ければ単語・読点 `、` や空白、または語尾の自然境界までとし、少なくとも途中で日本語動詞が切れる 80文字上限を撤廃して `proofQuote` 上限は `140` 文字程度に余裕を持たせる）。
   - `L158`, `L177-180` の `audience`, `painScene`, `mechanism`, `proofQuote` に適用する。
2. **`public/funnel/funnel_client.js` (`L2554-2579`)**:
   - `facts` の描画時、もし `item.claim` 内で同じ文やフレーズが重なる場合や `—` で3節連結されて長くなりすぎる場合でも、視認性良く 1 項目として読めるよう整形する（`previewFactsFromClaims()` 自体の返り値は `tests/homepage_v51_copy.test.js` と互換維持）。
   - L2578 のボタン文字を **`isEn ? 'Generate another draft' : '条件を変えてもう一度試す'`** に変更する。
3. **`src/next_post_draft.js` (`draftPrompt` / `candidatePrompt` / `systemRules`)**:
   - X の実運用アカウントとして自然な文章にするため、以下の品質ルールを追加（JA / EN 両方）：
     - **禁止**：レポート・小論文風の抽象的な締め（「〜はどのような示唆を与えるでしょうか」「〜すべきか、どのような工夫が有効だと感じますか」のような評論家口調）および **1投稿の中に疑問文（？ / ?）を 2 つ以上並べること**。
     - **推奨**：現場の運用者が X でそのまま読まれる自然なリズム・具体的な着眼点 1 つで言い切る、または問いかけを入れる場合でも最後の 1 文だけに絞る。

---

## Workstream B: TOP ページ内の「自動返信記述の自己矛盾」を完全統一

### 確認済みの矛盾箇所（実ファイル＆本番スクリーンショット）
現在、`views/funnel_index.html` の中だけで説明が食い違っている：
- **矛盾側**：
  - `EXPLORER_I18N_DATA.ja[0]`（L211, L217 周辺）＆ `EXPLORER_I18N_DATA.en[0]`：「`自動いいね・自動フォロー・自動返信などの挙動は一切行いません`」「`禁止された挙動: 自動いいね・自動返信なし`」
  - `#secSpecs` `spec_c1_desc`（L460 および EN 辞書）：「`自動いいね・自動返信等のスパム的挙動は行いません`」
- **正しい仕様側（`pipe_f2_desc` L266 / `faq_a8` L649 / 利用規約 / 管理画面）**：
  - 「無差別な自動いいね・自動フォロー・無差別一斉リプライは行いません（受信メンションへの返信支援は確認制・オプトインおよび X の Automated ラベル準拠のみ対応）」

### 実装要件 (`views/funnel_index.html`)
- 上記の Tab 0 (`etab_0` 初期表示 HTML L211, L217 ＋ `EXPLORER_I18N_DATA.ja[0]` ＋ `EXPLORER_I18N_DATA.en[0]`) および `spec_c1_desc`（HTML＋JA＋EN）をすべて、**「無差別な自動いいね・自動フォロー・一斉リプライは行いません（受信メンション返信は確認制・オプトイン中心）」** へ統一する。
- `spec` 表の 4 行目も **`禁止された挙動: 無差別自動いいね・一斉リプなし`** / **`Disallowed behavior: No unsolicited likes or mass replies`** へ揃える（管理画面や利用規約第3条と 100% 一致させる）。

---

## Workstream C: 最新のプロダクト価値を TOP ページへ反映 ＋ 見出しの改行崩れ・余白・重複整理

### 本番スクリーンショットから見つかった改善点
1. **見出しの文字途中改行（1〜2文字落ち）がダサい**：
   - `pipe_h2`（L241）：「根拠抽出から配信・学習ま」／「で、ひとつの画面で完結。」（「で、」だけ次行落ち）
   - `outreach_title`（L333）：「公開後の反応を、次の投稿案に即座にフィードバ」／「ック」（「ック」だけ次行落ち）
2. **「とにかくカンタン＆透明性」の強みが TOP ページにまだ十分載っていない**：
   - 管理画面で実装した「X連携して URL または人物像を入れるだけ」「現在のアカウントの Bio・固定ポスト改善助言」「AI が今なぜこのテーマ・切り口を選んだか理由と現在地が見える」魅力が、旧来の「次の1本を毎回作り直す」の繰り返しに埋もれている。
3. **セクション文章の重複と長さ**：
   - `secReviews`（L147-166 開発思想 4 カード）が各 7〜10 行と文字がぎっしりで読み飛ばされやすい。
   - `secSpecs`（`.glance-thumb-wrap` `public/funnel/funnel.css` L546-554）のアイコン画像周囲の白余白が大きすぎて間延びしている。
   - `secEditions` プランリストの `✓` とテキストの間隔（L509 等 `<span class="chk-svg">✓</span> <strong>...`）が詰まって見える箇所を少し整える。
   - FAQ（L581-670 全 10 問）が長いので、内容を落とさずに文章を簡潔・明快に整え、ユーザーが疑問に思いやすい「初期設定の簡単さ・Bio 助言・AI が考えている理由の可視化」も分かりやすく反映する。

### 実装要件 (`views/funnel_index.html` & `public/funnel/funnel.css`)
1. **見出しの文字落ち修正（JA / EN 両対応＋CSS保護）**：
   - `pipe_h2`: 例 JA「**設定ひとつで、執筆から学習まで完結。**」（または `根拠抽出から配信・学習までを、ひとつの画面で。` 等、中途半端な「で、」落ちが起きない自然な日本語＋バランス良い長さに調整）。
   - `outreach_title`: 例 JA「**公開後の反応を、すぐ次の投稿案へ。**」（長カタカナ「フィードバック」が 1280px カラム幅で割れるのを防ぐ）。
   - `public/funnel/funnel.css`: `.sec-h2`, `.soft-feature-card h3`, `.story-split-row h3` 等に適切に `word-break: keep-all; overflow-wrap: anywhere;` / `line-height` 調整を行い（英数字長URL等は折り返しつつ日本語文節割れを軽減）、見出し崩れを防ぐ。
2. **最新UX訴求のアップデート（JA / EN 両方、誇張・禁止ワードなし）**：
   - **Hero（`hero_desc` 等）**: 「URL か理想のアカウント像を入力するだけ。あとは投稿作成・予約・反応学習をおまかせし、**現在のアカウント状態・Bio改善の助言・AIが『なぜこの投稿を選んだか』の運用方針までひとつの画面で確認**できます」という一目で伝わる魅力にブラッシュアップ。
   - **開発思想 4 カード (`philo_card1〜4_desc`)**: 各カード **3〜4行程度** の読みやすい長さに簡潔化しつつ、02/03 周辺で「Bio・固定ポストの助言や、毎回『誰に・なぜ今届けるか』の理由まで提示する」強みを明確に伝える。
   - **`EXPLORER_I18N_DATA`（タブ 1〜3）**: 長文説明をスッキリ整理し、管理画面で見える **「現在のアカウント状態」「Bio・プロフィール改善アドバイス」「次投稿の狙いの見える化」** を仕様として自然に組み込む（初期から全プラン共通）。
3. **見た目・余白の洗練 (`public/funnel/funnel.css` & `views/funnel_index.html`)**：
   - `.glance-thumb-wrap`（L546-554）の高さ・パディングをコンパクトに整え（例：`height: 112px; padding: 10px;` あるいはカードのバランス統一）、アイコン周りがスカスカに見えないようにする。
   - `.p-feats li` 内の `.chk-svg` と本文の間に適切な余白（例：`gap: 8px` / `margin-right`）を確保し、`✓1日1件` とくっついて見えないように整える。
   - 計画上重要：既存のアンカー ID（`#secReviews`, `#secExplorer`, `#secPerformance`, `#secMultiStream`, `#secSecurity`, `#liveDemoSection`, `#secSpecs`, `#secEditions`, `#secFaq`）とヘッダーリンク 8 個（`1280px` 幅収まり確認済み）、および `#unlockModal` / `#authModal` の構造・ID はすべて維持する。

---

## 検証要件（完了報告前に必ず実行・実測出力を確認すること）

1. `node --check`: `src/lp_knowledge_extractor.js`, `src/luxury_web_funnel.js`, `src/next_post_draft.js`, `public/funnel/funnel_client.js`
2. `vm.Script` 構文検査: `views/funnel_index.html`（全インライン `<script>`）および `views/dashboard_view.html`
3. 関連テスト実行 (`node --test --test-force-exit`):
   - `tests/homepage_v51_copy.test.js`
   - `tests/compliance_and_topnav_i18n.test.js`
   - `tests/free_experience_and_consent.test.js`
   - `tests/simple_autopilot_transparency.test.js`
   - `tests/dashboard_language.test.js`
   - `tests/phase3_portfolio_verifier.test.js`
   - `tests/velox_polish_and_scaling.test.js`
   - 加えて今回新設または拡充する単体テスト（`proofQuote` が語尾途中で切れないこと、TOPページに「自動返信なし」矛盾表記がないこと、`funnel_client.js` のボタン文言、JA/EN 全キー揃い）
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`curl` で `https://veloxpostapp.com/` および `https://veloxpostapp.com/?lang=en` が 200 を返すことを確認すること。
