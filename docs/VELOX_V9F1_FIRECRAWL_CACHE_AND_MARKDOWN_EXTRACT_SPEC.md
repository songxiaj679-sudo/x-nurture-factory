# VELOX V9-F.1: Firecrawl Pre-Crawl 7-Day Cache & Markdown/Metadata Extraction Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）
- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、API キー、トークン、顧客メール、HQ の `targetUrl` は出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語と本文言語を混ぜない。廃止表現を戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域（厳守）
- 既存の安全制限（日次 20 ページ上限 `DAILY_PAGE_CAP`、下層最大 4 ページ `EXTRA_PAGE_CAP`・合計 5 ページ以下、プライベートアドレス／規約・`note_` 除外、`checkTenantAiBudget({ kind: 'crawl' })`）は一切緩めない。
- `readerVisibleFact()`（`src/next_post_draft.js` 125–133 行）の参照順（`page.description` → 先頭見出し → `brandKnowledge.oneLineMechanism`）および `tests/v9a5`・`tests/v9a6` の固定挙動は変更しない。
- `brandKnowledge.oneLineMechanism` は説明文で上書きしない。全文 Markdown は `knowledgeLine()` へ追加しない（プロンプト肥大化防止）。
- `src/context_radar.js`、`src/source_dossier_engine.js`、`src/outbound_reply_queue.js`、`src/llm_router.js`、`criticSystemRules(false)`（391 字）は無変更。
- 待機中の予約ジョブは一切上書きしない。本番アカウントへの `prepareNextPost` は呼ばない。

---

## 1. Firecrawl メタデータと Markdown の正確な抽出（`src/site_crawler.js` / `src/lp_knowledge_extractor.js`）

### 1.1 `src/site_crawler.js`
- `/v2/scrape`（入口、下層）の結果から `data.markdown`（入口のみフォールバック `data.html`）に加え、`data.metadata`（`title`、`description`、`ogDescription` 等）が存在すれば一緒に保持して返す（`{ url, text, via, format, meta }`）。
- `data.metadata` が存在しないモック・レスポンスでも壊れずフォールバックできること（`tests/v6_phase2_crawler_and_playbooks.test.js` 完全互換）。
- 下層上限（`EXTRA_PAGE_CAP = 4`、合計 5 ページ以下）とローカル取得フォールバックは維持する。

### 1.2 `src/lp_knowledge_extractor.js`
- `extractBrandKnowledge()` で、`format === 'markdown'` のページを `pageFromHtml()` に渡さない。
- `pageFromMarkdown()` を追加し、以下を抽出する:
  - `title`: `meta.title` → なければ Markdown の先頭 `# ` 見出し
  - `description`: `meta.description` / `meta.ogDescription` → なければ見出し・箇条書き・画像記法を除いた先頭の本文段落（最大 240 字）
  - `headings`: Markdown の `#`〜`###` 見出し配列
- ローカル HTTP 取得の生 HTML ページは従来どおり `pageFromHtml()` で処理する。

---

## 2. 7 日キャッシュのクロール前移動と短い `pageSummary` 永続化（`src/lp_knowledge_extractor.js`）

### 2.1 クロール前の 7 日キャッシュ判定
- `crawlSite()` の前に、次をすべて満たすときクロールも LLM 再抽出もせず即返却する:
  1. `!forceRefresh`
  2. `cached.schemaVersion === 3`
  3. `cached.outputLang === outputLang`
  4. `cached.sourceUrl` が今回対象 URL（正規化後）と一致
  5. `cached.extractedAt` から 7 日以内（`CACHE_MS`）
  6. `pageTitle` / `pageDescription` / `pageHeadings` がすでに保持されている（未保存の既存ユーザーは初回 1 回だけクロールして埋める）
- URL が変わった場合、または `forceRefresh === true` の場合は、7 日以内でもクロールし直す。

### 2.2 短い 3 項目の `saas_users.brandKnowledge` 保存とキャッシュ返却時の復元
- `pageTitle`（最大 120 字）、`pageDescription`（最大 240 字）、`pageHeadings`（最大 5 件・各 100 字）だけを追加保存する。全文 Markdown は保存しない。
- クロール前キャッシュヒット時は、この 3 項目から `pageSummary` を組み立てて返し、`readerVisibleFact()` が従来の順で使えるようにする。
- クロール後に本文ハッシュが一致してもページ要約が未保存なら、LLM は再実行せず 3 項目だけを既存知識へ足して保存する。`oneLineMechanism` は置き換えない。

---

## 3. 検証手順（必須チェック）

1. `tests/v6_phase2_crawler_and_playbooks.test.js`、`tests/lp_voice_phase2.test.js`、`tests/v6_1_hardening_and_cards.test.js`、`tests/v9a5_natural_spoken_craft_and_ring3_slim.test.js`、`tests/v9a6_natural_register_and_fact_fallback.test.js` は変更せず通す。
2. `tests/v9f1_firecrawl_cache_and_markdown_extract.test.js` で、metadata あり、Markdown のみ、キャッシュヒット、URL 変更、`forceRefresh` を検証する。
3. 編集した `.js` の `node --check`、インライン `<script>` の `vm.Script`、全スイート、`x-shop` のみ再起動、HTTP 確認、待機予約の未変更確認。
