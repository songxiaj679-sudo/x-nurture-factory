# GROK 実装指示書：公式アカウントバナーの Japan (@VeloxSystemsV4) & Global (@VeloxSystemsHQ) 併記 ＋ 実装とTOPページ表記の100%整合調整

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:
1. 実コードおよび `.env` 設定（`src/operated_accounts.js`, `src/auto_reply_policy.js`, `src/lp_knowledge_extractor.js`, `views/dashboard_view.html` 等）と、ホームページ（`views/funnel_index.html`）の表現を細部まで突き合わせ、発見した微細な乖離をすべて解消する。
2. トップページの公式アカウントバナーに、Japan 公式（`@VeloxSystemsV4`）だけでなく **Global（EN）公式（`@VeloxSystemsHQ`）** もわかりやすく併記し、日本・海外どちらの訪問者も実運用アカウントを確認できるようにする。

---

## ⚠️ 絶対厳守ルール（作業前に `/home/songxiaj679/x-nurture-factory/AGENTS.md` を熟読すること）

1. **日英混在ゼロ**：`views/funnel_index.html` に追加・変更する `data-i18n` キーは **必ず `I18N_LANDING.ja` と `I18N_LANDING.en` の両方に定義** すること（`tests/homepage_v51_copy.test.js` の全キー検証を通過させること）。
2. **禁止ワード厳守（超重要）**：
   - `tests/homepage_v51_copy.test.js` L12 の禁止正規表現に **`複数アカウント|multiple .*accounts`** が含まれている。
   - 今回 `@VeloxSystemsV4`（Japan）と `@VeloxSystemsHQ`（Global）を併記する際、**「複数アカウント」「multiple accounts」という語句は絶対に使わないこと**。「日本公式（`@VeloxSystemsV4`）と Global 公式（`@VeloxSystemsHQ`）」のように個別の公式窓口名として記載すること。
3. **既存テスト句の維持**：
   - `tests/compliance_and_topnav_i18n.test.js` & `tests/toppage_demo_brushup.test.js` が検証するフレーズ（`無差別な自動いいね・自動フォロー・一斉リプライは行いません`、`No unsolicited likes or mass replies`、`受信メンションへの返信支援は確認制`、`inbound mention support is opt-in`）は保持すること。

---

## Workstream A: 公式アカウントバナーへの `@VeloxSystemsV4` (Japan) ＆ `@VeloxSystemsHQ` (Global) 併記

### 対象：`views/funnel_index.html` L123-134（HTML）および `I18N_LANDING.ja` / `.en`
現状は Japan 向けの `@VeloxSystemsV4` しか書かれていない。

1. **表示文言（JA / EN 両方）**：
   - `official_banner_title`:
     - JA: `公式アカウントの実運用ログ（Japan / Global）`
     - EN: `Official Live Accounts (Japan / Global)`
   - `official_banner_body`:
     - JA: `日本公式 <a href="https://x.com/VeloxSystemsV4" target="_blank" rel="noopener noreferrer" style="color:#1D4ED8;font-weight:800;">@VeloxSystemsV4</a> と Global（英語）公式 <a href="https://x.com/VeloxSystemsHQ" target="_blank" rel="noopener noreferrer" style="color:#1D4ED8;font-weight:800;">@VeloxSystemsHQ</a> は、どちらも登録ページの根拠と公開後の実測をもとに、次の1本を毎回組み直しています。`
     - EN: `Both Japan official <a href="https://x.com/VeloxSystemsV4" target="_blank" rel="noopener noreferrer" style="color:#1D4ED8;font-weight:800;">@VeloxSystemsV4</a> and Global (EN) official <a href="https://x.com/VeloxSystemsHQ" target="_blank" rel="noopener noreferrer" style="color:#1D4ED8;font-weight:800;">@VeloxSystemsHQ</a> rebuild each next post from registered page evidence and live post metrics.`
2. **リンクボタン配置**：
   - 従来の `official_exhibit_btn`（`X Exhibit 公式掲載ページ ↗`）と並び、X 投稿を見るリンクを日本・英語それぞれ分かりやすく配置する：
     - `<a href="https://x.com/VeloxSystemsV4" target="_blank" rel="noopener noreferrer" class="btn-nav-blue" style="padding:10px 14px;white-space:nowrap;text-decoration:none;" data-i18n="official_log_jp_btn">🇯🇵 日本公式 @VeloxSystemsV4 ↗</a>`（EN: `🇯🇵 @VeloxSystemsV4 (JP) ↗`）
     - `<a href="https://x.com/VeloxSystemsHQ" target="_blank" rel="noopener noreferrer" class="btn-hero-white" style="padding:10px 14px;white-space:nowrap;text-decoration:none;font-size:0.82rem;" data-i18n="official_log_hq_btn">🌐 Global @VeloxSystemsHQ ↗</a>`（EN: `🌐 @VeloxSystemsHQ (Global) ↗`）
   - ※ 旧キー `official_log_btn` を置き換えるか維持するかはテストと辞書一致を見て判断し、必ず JA/EN 両方に揃えること（ボタンは1画面内の役割が明確なため重複にならない：`@VeloxSystemsV4`＝日本語実運用、`@VeloxSystemsHQ`＝英語グローバル実運用、`X Exhibit`＝X公式展示）。

---

## Workstream B: 実装実態 vs TOPページ表記の微細な乖離 3 点の解消

実装・環境変数の精査で特定した 3 点の小さなズレを揃える：

1. **乖離 1：自動返信の稼働実態との一致（`.env` / `src/auto_reply_policy.js` vs `views/funnel_index.html`）**
   - 実態：現在 `.env` で `X_AUTO_REPLY_PHASE2_ENABLED` は未有効（`false` 扱い）のため、本番顧客は **Phase 1（AI下書きを確認して 1 クリック送信）** を使用し、無人自動返信（Phase 2＋Automated ラベル）は有効化設定・別管理アカウント確認時のみ動作する制限付き機能。
   - 修正（`views/funnel_index.html`: `pipe_f2_desc`, `faq_a8`, `edit_p_4`, `EXPLORER_I18N_DATA.ja[0]/.en[0]`）：
     - 確認フレーズ（`受信メンションへの返信支援は確認制` / `inbound mention support is opt-in`）を維持しつつ、**「通常の自動運用では確認制の返信下書き（1クリック送信）に対応し、完全自動返信は管理用別アカウントと X の Automated ラベル要件を満たした限定設定時のみ動作」** という実態に 100% 沿った明確な表現に揃える。
     - また `edit_p_4` の `(Phase 1)` という開発者向けラベル表現を、一般読者に分かりやすい「確認制の返信支援（1クリック送信）であれば」へ言い換える。

2. **乖離 2：「設定保存すると同時に Bio 改善案も確認できる」（`qs_2_body` vs `views/dashboard_view.html`）**
   - 実態：現在 `views/dashboard_view.html` L4185 `saveBasicSetup()` では URL/人物像を保存しても `loadProfileChecklist()` を自動実行しておらず、別途ユーザーが「Xプロフィールの改善ヒントを見る」ボタンを押す必要があった。
   - 修正：
     - **`views/dashboard_view.html` (`saveBasicSetup()`)**：基本設定の保存成功時（`if (res.ok && data.ok)` 内）、もし `#profileChecklistOut` 要素があればバックグラウンドで `loadProfileChecklist()` を自動呼び出しし、本当に「URLや人物像を保存すると同時に最新の Bio 改善助言まで画面に展開される」状態にする（`button` 自体は再診断用のまま、2重生成にならず UX が大きく向上する！）。
     - 加えて `POST /api/autopilot/profile-checklist`（`src/hybrid_saas_routes.js`）にシンプルな同一入力キャッシュ（または高速戻り）があれば連続押下でも高速に返せる（任意・安全範囲で検討、失敗しても落ちないこと）。

3. **乖離 3：Webサイト読込範囲の誠実・正確な表現（`src/lp_knowledge_extractor.js` vs `philo_card1_desc` / `EXPLORER_I18N_DATA[1]`）**
   - 実態：`src/lp_knowledge_extractor.js` L102, L234 はエントリー URL に加えて同一ドメインの関連リンク **最大 2 ページ（合計最大 3 ページまで）** の料金・機能・FAQ などを抽出する仕様。
   - 修正：`views/funnel_index.html` の `philo_card1_desc` や `EXPLORER_I18N_DATA[1]` で、「サイト内すべてのページを読む」ように誇張して誤読されないよう、「登録ページのほか、同一サイト内の関連ページ（料金・機能・FAQなど主要な案内）を参照し」という実態に沿った丁寧な表現に揃える（JA / EN 両方）。

---

## 検証要件（完了報告前に必ず実行・実測出力を確認すること）

1. `node --check`: 変更した全 `.js` ファイル
2. `vm.Script`: `views/funnel_index.html` および `views/dashboard_view.html` 全インライン `<script>`
3. `node --test --test-force-exit`:
   - `tests/homepage_v51_copy.test.js`（`@VeloxSystemsV4` と `@VeloxSystemsHQ` 併記下でも禁止ワード正規表現に触れないことを厳格検証）
   - `tests/toppage_demo_brushup.test.js`
   - `tests/compliance_and_topnav_i18n.test.js`
   - `tests/dashboard_language.test.js`
   - `tests/simple_autopilot_transparency.test.js`
   - `tests/growth_phase.test.js`
   - `tests/autopilot_setup_save.test.js`
   - `tests/velox_polish_and_scaling.test.js`
4. `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 後 2 秒待機し、`https://veloxpostapp.com/` と `https://veloxpostapp.com/?lang=en` を `curl` で確認、`VeloxSystemsV4` と `VeloxSystemsHQ` が含まれることを報告すること。
