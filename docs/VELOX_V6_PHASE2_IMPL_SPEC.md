# VeloxPost Cloud V6 — Phase 2 Implementation Spec: Deep Site/RSS Crawler, `domainPlaybooks`, Domain `customerReason` & Critic Speedup (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Complete autonomy from URL-only input, zero JA/EN UI mixing, zero retired claims (`7名`, `合議制`, `月100時間`, `3.4倍`, `9割`, `シャドウバン`, `凍結リスクゼロ`).
> - Incorporates **all 4 Phase 1 empirical findings & Phase 2 safeguards proposed by Grok** + Antigravity's live Firecrawl `/v2` probe results.
> - **Mandatory Peer-Review Note**: At completion, include your independent engineering observations & supplemental recommendations for **Phase 3 (X API v2 Media Upload + `satori`/`resvg` 1200×675 Editorial Visual Cards)**.

---

## Live Probe Findings for Phase 2 (Already Verified Against Production Keys)

1. **`FIRECRAWL_API_KEY` (`/v2` Endpoints Verified `200 OK`)**:
   - `POST https://api.firecrawl.dev/v2/map` with `{ url, limit: 25 }` returns:
     ```json
     {
       "success": true,
       "links": [
         { "url": "https://...", "title": "...", "description": "..." }
       ]
     }
     ```
     *(Note: In `/v2/map`, `links` elements are objects `{ url, title, description }`, not plain strings — normalize `typeof item === 'string' ? item : item?.url`!)*
   - `POST https://api.firecrawl.dev/v2/scrape` with `{ url, formats: ['markdown'], onlyMainContent: true }` returns:
     ```json
     {
       "success": true,
       "data": { "markdown": "...", "metadata": { "title": "...", "description": "..." } }
     }
     ```
2. **Legacy Archive Trap on `veloxpostapp.com` Caught During `/v2/map` Probe**:
   - `/v2/map` on `https://veloxpostapp.com` discovers `/article/note_01`..`/article/note_15` (`src/shop.js:1745`), which are legacy archive pages containing banned terms (`シャドウバン`, `v1.1`).
   - Therefore, `site_crawler.js` MUST exclude `/article/note_`, `/articles`, `/lp`, `/terms`, `/privacy`, `/tokushoho`, `/company`, `/legal`, `/auth`, `/login`, `/register`, `/dashboard`, `/accounting`, `/contract`, `/order` and scrub all crawled text through `BANNED_LEGACY` and `isPageDisclaimer`!

---

## Phase 2 Scope (Exact Files & Requirements)

### 1. Cut Critic Latency From ~45s Timeout to ~2–12s (`src/llm_router.js`, `src/next_post_draft.js`)
In Phase 1 live execution, `scoreWithGrok` (`medium` reasoning effort + 1,400-char Writer `systemRules`) hit the 45s abort threshold before falling back to OpenAI `gpt-4.1` (`2.1s`).
1. **Lean Critic-Only System Prompt (`criticSystemRules(isEn)` in `src/next_post_draft.js`)**:
   - Do **not** pass Writer's 1,400-char `systemRules(isEn)` into `completeCritic`.
   - Create a concise `criticSystemRules(isEn)` (~250 chars) stating only the Critic's job: strict 0–100 JSON scoring for X timeline quality, penalizing brochure pitch, ungrounded claims, mixed register, and empty platitudes below 60.
2. **Fast, Reliable Critic Routing (`src/llm_router.js`)**:
   - When calling `scoreWithGrok`, use `reasoningEffort: keyValue('XAI_REASONING_EFFORT_CRITIC') || 'low'` (or cap Grok Critic timeout to `Math.min(timeoutMs, 16000)` so if xAI is slow, OpenAI `gpt-4.1` completes in `~2s` well inside the 20s Critic budget).
   - Update `.env` default fallback in code so `completeCritic` finishes in `2–12s` instead of burning `45s`, bringing end-to-end post generation down to **~35–50s**.

---

### 2. New Safe Multi-Page Site & RSS Crawler (`src/site_crawler.js` + `src/url_fetch_guard.js`)
Create `src/site_crawler.js` implementing all safeguards from Grok's review:
1. **Charset-Aware HTML Decoding (`src/url_fetch_guard.js` / `src/site_crawler.js`)**:
   - Inspect HTTP `Content-Type` header and first 2,048 bytes (`<meta charset="...">` / `charset=...`).
   - If `shift_jis` / `sjis` / `windows-31j` or `euc-jp` is detected, decode the buffer with `new TextDecoder('shift_jis')` or `new TextDecoder('euc-jp')` before falling back to UTF-8 so older Japanese company sites never produce mojibake facts.
2. **Double SSRF & DNS-Rebinding Guard**:
   - Call `await assertPublicHttpUrl(url)` (`src/url_fetch_guard.js`) **immediately before** every local `fetch`, every Firecrawl `/v2/map` or `/v2/scrape` request, every Jina fallback request, and every discovered subpage or RSS feed URL.
3. **Hard Cost, Time & Daily Quota Caps**:
   - Overall crawl budget: **`<= 25000 ms` total wall-clock**.
   - Map limit: **`<= 25` links**; Scrape limit: **entry page + at most `4` extra high-signal same-origin subpages** (`<= 8` pages max in any mode).
   - Per-account daily crawl quota: track `crawlQuota: { dayKey: 'YYYY-MM-DD', pagesUsed: number }` on `saas_users/{userId}` (or in-memory fallback when `db` is omitted in tests), enforcing **`<= 20` Firecrawl pages per account per day**. When daily quota is reached or `FIRECRAWL_API_KEY` is absent/offline, fall back gracefully to local `fetchPublicText` (or Jina Reader on `isThinSpa` when `JINA_API_KEY` is set) without stopping post generation.
   - Allowed subpage path hints: `/about|company-profile|features?|product|service|use-cases?|cases?|faq|help|docs?|guide|blog|column|pricing|plan|特徴|機能|事例|よくある質問|料金|サービス/i`.
   - Blocked subpage paths: `/terms|privacy|tokushoho|legal|compliance|company|login|signin|register|signup|auth|oauth|dashboard|accounting|admin|contract|order|cart|checkout|wp-admin|feed|rss|article\/note_|articles\b|^\/lp\b/i`.
4. **Safe RSS / Atom Feed Auto-Discovery (`rss-parser`)**:
   - Detect `<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>` on the entry HTML.
   - Resolve feed URL, verify via `assertPublicHttpUrl`, fetch raw XML via `fetchPublicText` with **`8000 ms` timeout** and **`512 KB` max bytes**, and parse with `new RSSParser().parseString(xml)`.
   - Extract at most the **latest 5 items** (`{ title, snippet }` plain text stripped of HTML tags, max 220 chars each).
   - **Strict Rule**: RSS items and extra subpage markdown must **NEVER** be used as a source for `verifiedPricing`; only the primary entry/pricing page (after disclaimer/nav/footer stripping) can supply `verifiedPricing`.

---

### 3. Structured `domainPlaybooks` & Strict Writer Isolation (`src/lp_knowledge_extractor.js`, `src/next_post_draft.js`)
1. **Upgrade `brandKnowledge` (`schemaVersion: 2` in `src/lp_knowledge_extractor.js`)**:
   - Strip nav, cookie consent banners, footer legal text (`isPageDisclaimer`), and `BANNED_LEGACY` (`/9割|月100時間|3\.2倍|3\.4倍|保存して後で見返|シャドウバン|7名|合議|凍結リスクゼロ/`) **before** extracting numbers or claims.
   - Alongside `verifiedClaims`, `verifiedPricing`, `verifiedConstraints`, `terminology`, and `domainProblems`, extract **`domainPlaybooks`** (6–12 structured cards):
     ```json
     {
       "id": "pb_1",
       "topic": "短い主題（30字以内）",
       "readerSituation": "読者が日常業務で迷う具体的な場面（80字以内）",
       "commonMistake": "多くの人がやりがちな誤った判断や通説（80字以内）",
       "concreteTradeoff": "裏にある仕組みやトレードオフ（100字以内）",
       "checkCriteria": "今日その場で確認できる判断基準・手順（100字以内）",
       "boundaryCondition": "その基準が成り立たない例外・見直し条件（90字以内）"
     }
     ```
   - Sanitize every card: reject any card matching `BANNED_LEGACY`, `UI_BADGE`, or containing ungrounded numbers (`extractNumberTokens` not present in the primary page corpus).
   - Provide a deterministic `fallbackPlaybooks(domainProblems, verifiedClaims)` so offline/unit tests without LLM calls still populate valid `domainPlaybooks`.
2. **Do NOT Dump Multi-Page Text Into Writer (`src/next_post_draft.js`)**:
   - Keep `pageForPrompt(pageSummary)` strictly bounded to the primary page (`<= 1,500` chars).
   - On `domainSlot` (`utility_save`, `conversation_debate`, `story_observation`, `profile_asset_bridge`), select the freshest unused playbook card (`selectFreshPlaybook(brandKnowledge.domainPlaybooks, memory)`) and pass that **single structured playbook card** (`focusPlaybook`) to Brief & Writer!
   - On `domainSlot`, omit `facts.claims` and `facts.numbers` (pricing) from `knowledgeLine` so Writer isn't tempted to turn a domain lesson into a pricing/feature brochure!

---

### 4. Domain-Grounded `customerReason` & `pageHypotheses` on Value Slots (`src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`)
Fix the mismatch Grok identified where the post body is a practitioner lesson (`下書きの数字には...`) while `customerReason` on the dashboard still says `なぜ今: OAuth 2.0準拠の公式API v2連携で予約投稿...`:
1. **`extractDomainHypotheses(brandKnowledge, pageSummary)` in `src/bandit_optimization_engine.js`**:
   - When `domainPlaybooks` (or `domainProblems`) are present and the slot is a `domainSlot` (`!portfolioPlan.allowPromoUrl && portfolioPlan.portfolioRole !== 'explicit_promo_offer'`):
     - Build hypotheses where:
       - `who`: concise target reader (`brandKnowledge.icpSummary` or playbook audience, clipped cleanly)
       - `why`: the operational problem / misconception (`playbook.readerSituation` or `playbook.commonMistake`)
       - `proof`: the concrete decision principle (`playbook.checkCriteria` or `playbook.concreteTradeoff`)
   - On `explicit_promo_offer` (`productSlot`), continue using product `extractPageHypotheses(pageSummary, brandKnowledge)`.
2. **Bilingual `customerFacingReason(choice, uiLang)`**:
   - Ensure both JA (`誰に: ... なぜ今: ... 根拠: ...`) and EN (`For: ... Why now: ... Grounding: ...`) work cleanly without leaking Japanese into English UI or vice versa.
3. **Legal Page Sync (`views/compliance_company.html`, `views/compliance_privacy.html`)**:
   - Since Phase 2 activates Firecrawl (when `FIRECRAWL_API_KEY` is configured), add `Firecrawl API（設定時）` / `Firecrawl API (when configured)` to the technical systems / external API processor disclosures in JA and EN while keeping `tests/compliance_and_topnav_i18n.test.js` green.

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on all new and edited `.js` files (`src/site_crawler.js`, `src/url_fetch_guard.js`, `src/lp_knowledge_extractor.js`, `src/llm_router.js`, `src/next_post_draft.js`, `src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit
   ```
   -> Must report **0 fail / 0 skip**.
4. New unit tests (`tests/v6_phase2_crawler_and_playbooks.test.js`):
   - `site_crawler`: double SSRF check (`assertPublicHttpUrl`) blocks private/loopback URLs in `/v2/map` links and RSS `<link>`; respects daily 20-page quota & 4-subpage cap; decodes Shift_JIS buffer cleanly; excludes `/article/note_` and `/terms`.
   - `lp_knowledge_extractor`: strips disclaimers/banned legacy terms before grounding numbers; never takes `verifiedPricing` from RSS or extra subpages; produces sanitized `domainPlaybooks` with zero ungrounded digits.
   - `next_post_draft` & `bandit_optimization_engine`: on `domainSlot`, Writer receives `focusPlaybook` (without product `claims`/`pricing` dump) and `customerReason` reflects the domain playbook (`readerSituation` / `checkCriteria`) instead of product promo claims; Critic uses lean `criticSystemRules`.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --update-env && pm2 save`) + HTTP verification (`GET /` 200, `GET /?lang=en` 200, `GET /dashboard` 302, unauthenticated `POST /api/admin/trigger-weekly-report` 401).
6. **Live Verification on `@VeloxSystemsV4` (`WEB-GOOGLE-D12E2479A76266AEA2B4`)**:
   - Force-refresh `extractBrandKnowledge` for `https://veloxpostapp.com` (confirming `domainPlaybooks` count & zero `/article/note_` or `シャドウバン` contamination).
   - Generate 1 fresh `next_post` and report:
     - Total generation time (verifying the Critic speedup from `83.6s` down to `~35–55s`)
     - `qualityAudit` entries
     - Generated post text & the new domain-aligned `customerReason` verbatim
     - Supplemental observations for **Phase 3 (Visual Cards & X API v2 Media Upload)**.
