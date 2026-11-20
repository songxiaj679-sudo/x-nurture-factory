# VeloxPost Cloud V6 — Autonomous High-Quality Editorial Engine Blueprint & Phased Spec

> **Mandatory Rules (`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6)**:
> - **Complete Autonomy**: Every customer who enters **only a single URL** (or short account goal) MUST receive genuinely bookmark-worthy, industry-native X posts from Day 1 — zero manual hand-holding, zero repetitive product brochures, zero fake stats.
> - **Zero-Tolerance Bilingual Parity**: UI language (`uiLang`) stays strictly separated from post generation language (`aiTargetLang`); JA/EN parity across all customer-facing strings.
> - **Copy & Legal Integrity**: Never reintroduce retired claims (`7名`, `合議制`, `月100時間`, `3.4倍`, `9割`, `凍結リスクゼロ`). Whenever external AI/crawl processors are added, update `views/compliance_company.html` & `views/compliance_privacy.html` (JA/EN) and keep all compliance tests green.
> - **Mandatory Grok Peer Review**: **Before writing code**, Grok is explicitly requested to review every phase below and provide independent supplemental opinions, blind-spot critiques, cost/latency trade-offs, and better alternatives (see Section "Request for Grok's Supplemental Opinions" at the end).

---

## Executive Summary: Why Single-Model Grok Hits a Ceiling & What V6 Changes

Observed live in `@VeloxSystemsV4` (`job_next_92ffac88` on `grok-4.7`):
1. **Self-Grading Blind Spot**: `grok-4.7` writes candidates and the same `grok-4.7` (`reasoning_effort: low` in `src/grok_client.js:133`) scores them `>= 72`, letting stiff brochure essays pass.
2. **Information Poverty (3 Static Pages + 30-Char Problem Labels)**: `src/lp_knowledge_extractor.js` reads at most 3 non-JS HTML pages (`10,000` chars) and produces 5 product claims + 8 short labels (`domainProblems`). Without rich practitioner playbooks or external X context, strict anti-hallucination forces safe, empty platitudes.
3. **Echo-Chamber Radar & Missed `x_search`**: `src/grok_client.js:122` only calls `{ type: 'web_search' }` and never uses xAI's native `{ type: 'x_search' }`. `src/context_radar.js` feeds product-flavored `icpSummary` back in, producing self-referential VELOX topics (`Bio改善案`, `投稿審査`).
4. **Prompt & Format Leaks**: `profile_asset_bridge` still triggers `productSlot` (`src/next_post_draft.js:550`), `logical_thread` / `narrative_insight` bypass the line-break gate (`L599`), and `systemRules` (`L389`) is ~1,400 chars of negative bans with no positive structural anchors.
5. **Text-Only Posts on Small Accounts**: `src/visual_card.js` is disabled (`media_write_not_enabled`), `src/twitter_auth.js:32` omits `media.write`, and `src/official_api_client.js` lacks X API v2 chunked media upload (`POST /2/media/upload/initialize|append|finalize`).

---

## External Services & New Capabilities Evaluation (Build vs. Buy Matrix)

| Layer | Recommended Service / Tool | Role in VELOX V6 | Why Needed (First Principles) | Estimated Cost / Scale | Env Var(s) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Writer LLM** | **Anthropic Claude API** (`POST /v1/messages`, Sonnet-class flagship + Prompt Caching) | Primary prose writer (JA & EN) | Eliminates Japanese corporate translationese (`〜が可能です`, `判断軸となります`); Prompt Caching cuts repeated tenant knowledge input costs by ~90%. | ~$2/$10 per MTok (or current Sonnet tier); pennies/user/mo | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_WRITER` |
| **Adversarial Critic & Grounding Judge** | **OpenAI API** (or **xAI Grok** at `reasoning_effort: medium/high` when `WRITER=claude`) | Independent cross-provider editorial & fact judge | **Writer ≠ Critic** eliminates self-preference bias; ruthlessly scores platitudes `<= 55`. | Pennies/user/mo | `OPENAI_API_KEY`, `OPENAI_MODEL_CRITIC`, `XAI_REASONING_EFFORT_CRITIC` |
| **Live X Culture & Niche Radar** | **xAI Responses API (`x_search` + `web_search`)** *(existing `XAI_API_KEY`)* | External practitioner debates & niche hook-rhythm observation | xAI is uniquely native to live X discourse; `excluded_x_handles` guarantees zero self-echo. | Existing xAI account | `XAI_API_KEY`, `XAI_MODEL_RESEARCH` |
| **Deep Site / SPA Crawler** | **Firecrawl API** (`/v1/map`, `/v1/scrape`) + **Jina Reader** (`r.jina.ai`) / `fetchPublicText` fallback | JS-rendered SPA reading + `/blog`, `/faq`, `/docs`, `/cases`, `sitemap.xml` discovery | Modern SaaS/EC sites (Next.js/React/Wix/Shopify) break static HTML `fetch`; rich subpages give real grounded cases/objections without manual input. | Firecrawl Hobby $19/mo (5k pages) or Standard $99/mo (100k pages) | `FIRECRAWL_API_KEY`, `JINA_API_KEY` (optional) |
| **RSS / Blog Auto-Ingest** | **`rss-parser`** *(already installed in `package.json`)* | Auto-discover & ingest customer `/feed`, note, Zenn, blog RSS | Turns every new customer article/changelog into fresh grounded post material automatically. | $0 (code only) | — |
| **Editorial Visual Cards** | **`satori` + `@resvg/resvg-js`** (or `puppeteer` fallback already installed) + **X API v2 Media Upload** | 1200×675 crisp Japanese/English PNG comparison/checklist cards | Native Japanese typography with **zero AI image garbled kanji**; multiplies dwell time & bookmarks for `< 500` follower accounts. | $0 runtime (self-rendered PNG) | `X_MEDIA_WRITE_ENABLED=true` |
| **Quality & Cost Telemetry** | Firestore `generation_traces` + optional **Langfuse** | Track Writer/Critic scores, rejection reasons, token cost, and 24h X bookmark correlation | Lets us empirically verify whether Critic 80+ posts actually earn higher real X bookmarks across customers. | $0 (Firestore) or Langfuse free/cloud tier | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (optional) |

> **Zero-Breakage Design Principle**: Every external service (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `X_MEDIA_WRITE_ENABLED`, `LANGFUSE_*`) MUST activate automatically when configured and degrade gracefully to existing providers (`XAI_API_KEY`, `fetchPublicText`, text-only posting) when absent.

---

## Phased Architecture & Implementation Roadmap

### Phase 1: Multi-Model Router, Adversarial Critic, `x_search` Radar & Prompt/Slot Overhaul (Highest Immediate Quality Jump)
**Target files**: NEW `src/llm_router.js`, `src/grok_client.js`, `src/next_post_draft.js`, `src/context_radar.js`, `src/draft_verifier.js`, `src/slot_portfolio_planner.js`, `tests/post_constraint_stop_isolation.test.js`, `views/compliance_company.html`, `views/compliance_privacy.html`

1. **Create `src/llm_router.js` (Provider-Agnostic Role Router)**:
   - Expose unified role functions:
     - `completeWriter({ prompt, systemPrompt, json, timeoutMs, cacheSystemPrefix })`: Uses Anthropic Messages API (`POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, `cache_control: { type: 'ephemeral' }` on stable system/knowledge prefix, env `ANTHROPIC_MODEL_WRITER`) when `ANTHROPIC_API_KEY` is set; gracefully falls back to `grok_client.completeText({ tier: 'quality' })`.
     - `completeCritic({ prompt, systemPrompt, json, timeoutMs })`: **Strictly enforces Writer ≠ Critic** when 2+ providers are configured:
       - If Writer is Anthropic -> Critic uses OpenAI (`OPENAI_API_KEY`, `OPENAI_MODEL_CRITIC`) or xAI Grok (`grok-4.7` with `XAI_REASONING_EFFORT_CRITIC=medium`).
       - If Writer is xAI Grok -> Critic uses Anthropic or OpenAI (or Grok with elevated reasoning effort if single-key mode).
     - `completeResearch({ prompt, systemPrompt, xSearch, excludedXHandles, timeoutMs })`: Uses xAI `/v1/responses` (`src/grok_client.js`) with `tools: [{ type: 'x_search', ...(excludedXHandles?.length ? { excluded_x_handles: excludedXHandles } : {}) }, { type: 'web_search' }]` when `xSearch: true`.
   - Record exact `{ role, provider, model, ms, inputTokens, outputTokens, cachedTokens, ok, reason }` in `qualityAudit` for full observability.
2. **Fix `src/context_radar.js` to Use Native `x_search` & Generic Industry Queries**:
   - Strip product names, brand handles, and LP slogans before querying; pass ONLY generic industry/audience lens (e.g., `"B2B SaaS・X広報運用担当者"` rather than `"AI-Assisted X Posting Workflow / 根拠限定で投稿審査"`).
   - Pass `excludedXHandles: [ownHandle]` to `x_search` so the radar discovers **real external X discussions, practitioner mistakes, and workflow debates from this week**.
   - Cache per `(normalizedIndustryCategory, lang)` for 8h so multiple accounts in the same vertical even share cost cleanly without cross-tenant data leaks.
3. **Overhaul `src/next_post_draft.js` (Stop Brochure Output & Dense Walls)**:
   - **Slot Reclassification (`L550`)**: Move `profile_asset_bridge` out of forced `productSlot` — only `explicit_promo_offer` (and `promo === true`) forces a product `verifiedClaims` focus. Value slots (`utility_save`, `conversation_debate`, `story_observation`, `profile_asset_bridge`) lead with `domainPlaybooks` / `domainProblems` / `contextSignals` (with `profile_asset_bridge` allowed at most 1 subtle closing pointer without product-brochure pitch).
   - **Universal Scannable X Formatting Gate (`L599`)**: Do NOT restrict `needsBreaks` only to `structured_breakdown` / `checklist_framework`. Any Japanese post `>= 110` chars (or English post `>= 180` chars) that isn't `micro_punch` MUST have clean visual breathing room (`\n\n` separating hook, core contrast/checks, and concise ending).
   - **Positive Craft Blueprints (Replacing Bloated Negative Walls)**: Compact `systemRules` to crisp invariants + inject 2 short **domain-agnostic positive craft skeletons** (illustrating rhythm, concrete boundary condition, and sharp contrast — using an unrelated craft domain like coffee roasting or database migrations so the writer absorbs *cadence and concreteness*, never copying words or numbers).
   - **Ruthless Cross-Provider Critic Rubric**: Explicitly score empty corporate platitudes (`根拠に基づく判断が重要です`, `質向上と保護を実現する判断軸となります`, `〜が可能です`) `<= 55`, require a **non-obvious operational tradeoff or concrete decision check** to score `>= 75`, and keep strict `>= 72` re-scoring on repairs.
4. **Test Runner Hygiene (`tests/post_constraint_stop_isolation.test.js`)**:
   - Fix the unclosed timer/handle/mock teardown that triggers Node `--test-force-exit` IPC deserialization error (`Unable to deserialize cloned data due to invalid or unsupported version`) so the entire non-emulator suite runs **0 fail** reliably under `node --test --test-force-exit`.
5. **Legal & Privacy Sync (`AGENTS.md` §2)**:
   - Update `views/compliance_company.html` & `views/compliance_privacy.html` (JA/EN) to accurately reflect multi-provider AI/crawl processors (e.g. xAI / Anthropic / OpenAI / web extraction APIs as configured) without breaking `tests/compliance_and_topnav_i18n.test.js`.

---

### Phase 2: Deep Domain Knowledge Graph & SPA/RSS Auto-Ingestion (Solving URL-Only Material Depth)
**Target files**: `src/lp_knowledge_extractor.js`, NEW `src/site_crawler.js`, `src/autonomous_promo_ai.js`, `src/bandit_optimization_engine.js`

1. **Multi-Page JS-Capable Site Crawler (`src/site_crawler.js`)**:
   - Always validate entry URL + discovered links through `assertPublicHttpUrl` (`src/url_fetch_guard.js`) BEFORE external fetch (strict SSRF protection).
   - Priority crawl chain:
     1) If `FIRECRAWL_API_KEY` is configured: call Firecrawl `/v1/map` (limit 25 same-origin URLs), prioritize high-signal paths (`/about`, `/features`, `/use-cases`, `/cases`, `/faq`, `/docs`, `/blog`, `/changelog`, `/pricing`), and `/v1/scrape` up to **8 pages** as clean Markdown (`maxChars ~ 30,000`).
     2) Else if `JINA_API_KEY` (or thin SPA detected `isThinSpa === true`): fallback to Jina Reader (`https://r.jina.ai/<url>`) or local `fetchPublicText` + `sitemap.xml` discovery (up to 6 pages).
     3) Auto-detect RSS/Atom feeds (`<link rel="alternate" type="application/rss+xml">`, `/feed`, `/rss.xml`) via `rss-parser` (already installed!) to pull the latest 5 article titles & summaries.
2. **Rich 4-Layer Knowledge Pack (`brandKnowledge` schema v2)**:
   - `productTruth`: verified claims, constraints, pricing, verified numbers ONLY.
   - `domainPlaybooks` (**12–20 structured cards**): `{ id, topic, readerSituation, commonMistake, concreteTradeoff, checkCriteria, boundaryCondition }` — rich enough that writers have concrete operational substance without inventing fake stats!
   - `objectionBank` (**5–8 cards**): honest buyer/operator hesitations & when NOT to use a tool/approach.
   - `externalIndustryLens`: `{ broadCategoryJa, broadCategoryEn, genericSearchQueries[] }` — strictly free of brand names and UI labels, fed directly into Phase 1's `x_search` Radar!
3. **Autonomous Weekly Refresh + Non-Repeating Rotation**:
   - Track used `playbookId` across recent 20 posts in Firestore so consecutive days never repeat the same argument in different words.

---

### Phase 3: Editorial Visual Cards & X API v2 `media.write` Upload
**Target files**: `src/twitter_auth.js`, `src/official_api_client.js`, `src/visual_card.js`, `src/hybrid_saas_routes.js`, `views/dashboard_view.html`

1. **X OAuth 2.0 `media.write` Scope with Zero-Breakage Migration (`src/twitter_auth.js:32`)**:
   - Update `buildTwitterAuthorizationUrl` scope from `'tweet.read tweet.write offline.access users.read'` to `'tweet.read tweet.write media.write offline.access users.read'`.
   - Store granted scope list (`oauth2Scope`) in encrypted `xOfficialCredentials` on callback so we know per-account whether `media.write` is active.
   - If an existing user hasn't reconnected yet (token lacks `media.write`) or X returns `403`, gracefully post text-only without failing the job, and display a clean bilingual (JA/EN) non-blocking tip in Dashboard ("再連携すると図解カード付き投稿が有効になります" / "Reconnect X to enable editorial visual cards").
2. **X API v2 Chunked Media Upload (`src/official_api_client.js`)**:
   - Implement `uploadOfficialMedia(credentials, buffer, mimeType = 'image/png', mediaCategory = 'tweet_image')`:
     - Validate size (`<= 5 MB`), refresh OAuth2 token if needed.
     - Step 1: `POST https://api.x.com/2/media/upload/initialize` (`JSON`: `{ total_bytes, media_type, media_category }`) -> `media_id`.
     - Step 2: `POST https://api.x.com/2/media/upload/{media_id}/append` (`multipart/form-data`: `segment_index: '0'`, `media: Blob(buffer)`).
     - Step 3: `POST https://api.x.com/2/media/upload/{media_id}/finalize` -> verify ready -> return `media_id`.
   - Wire into `executeAutopilotJob` (`src/hybrid_saas_routes.js`) to pass `[mediaId]` to `postOfficialTweet` / `postOfficialThread` when `X_MEDIA_WRITE_ENABLED === 'true'` and card generation succeeds.
3. **Publication-Grade Visual Card Renderer (`src/visual_card.js`)**:
   - Replace raw unwrapped SVG `<text>` with a clean editorial renderer (`satori` + `@resvg/resvg-js` with bundled Noto Sans JP + Inter font, or Puppeteer HTML-to-PNG fallback).
   - 3 grounded templates (1200×675, matching clean bright editorial aesthetic, 100% text derived from the post's verified structure — zero ungrounded numbers!):
     - `contrast_card`: Left ("ありがちな前提") vs Right ("実務の境界条件")
     - `checklist_card`: Title + 3 crisp check items
     - `mechanism_card`: 3-step visual flow diagram
   - Attach cards selectively (~40–50% of slots, e.g. `utility_save` & `profile_asset_bridge`) so the timeline looks natural, not spammy.

---

### Phase 4: Closed-Loop Learning Acceleration & Empirical Quality Telemetry
**Target files**: `src/editorial_lexicon_engine.js`, NEW `src/x_benchmark_radar.js`, `src/autonomous_promo_ai.js`, `src/hybrid_saas_routes.js`

1. **Niche Structural Benchmark Library (`src/x_benchmark_radar.js`)**:
   - Weekly per-industry `x_search` analysis extracting **abstract structural craft patterns only** (hook patterns, line-break ratios, contrast moves that earn bookmarks in that vertical — zero copied prose/numbers) to warm-start new accounts with `matureCount < 5`.
2. **Two-Speed Autonomous Learning**:
   - **Fast loop (2–6h early snapshots)**: Soft bandit exploration weight on hook/format/visual-card presence so poor patterns stop repeating within 24 hours.
   - **Slow truth loop (24–36h frozen snapshots)**: Authoritative `domainLexicon`, `endingMoves` rotation (fix `verdict_cut` 11/11 skew), and `MAP-Elites` promotion.
3. **End-to-End Generation Telemetry (`generation_traces` + optional Langfuse)**:
   - Log `{ jobId, userId, writerProvider, writerModel, criticProvider, criticModel, initialScore, finalScore, repairCount, hasVisualCard, slotRole, tokenCostUsd }` on draft creation, and back-fill actual `24h` `{ impressions, bookmarks, bookmarkRate, likes, replies }` after snapshot freeze so we continuously measure **Critic Score → Real X Engagement** correlation!

---

## Request for Grok's Supplemental Opinions (Mandatory Peer-Review Before Coding)

**Grok**: Before beginning Phase 1 implementation, please review this blueprint critically from an implementation & production-ops perspective and answer these 5 points briefly to the user + Antigravity:

1. **Model & Provider Trade-offs**: Given current API latency, rate limits, Japanese X prose naturalness, and cost-per-post, do you agree with **Anthropic Claude (Writer) + OpenAI or Grok-high (Critic) + xAI `x_search` (Radar)**, or do you recommend any specific model adjustments / timeouts / JSON-schema enforcement tips (e.g., Anthropic `tool_use` vs JSON prompt, or Gemini Flash/Pro role)?
2. **Site Ingestion Edge Cases**: For `Firecrawl` + `Jina` + `rss-parser`, are there concrete SSRF, cost-runaway (large sites), or Japanese encoding/SPA traps we should guard tightly in `src/site_crawler.js`?
3. **X API v2 Media Upload & Scopes**: Have you spotted any quirks in `src/official_api_client.js` / `src/twitter_auth.js` (e.g., OAuth 2.0 `api.x.com` vs `api.twitter.com` host consistency, token refresh race, or `multipart/form-data` boundary handling in Node 22 native `fetch` / `FormData`)?
4. **Existing Test & Codebase Simplification**: Are there dormant legacy modules in `src/` (e.g., `ai_deliberation_council.js` vs `next_post_draft.js`, `post_constraint_stop_isolation.test.js` teardown issue) that we should simplify or clean up while implementing Phase 1 so the codebase stays fast and maintainable?
5. **Phase 1 Scope Check**: Is there anything missing from Phase 1 that would give an even bigger immediate jump in real X bookmarks/likes for URL-only customers?
