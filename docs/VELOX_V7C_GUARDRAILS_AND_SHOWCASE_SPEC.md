# VeloxPost Cloud V7-C Implementation Spec: Claude Tool Budget Fix + Unified Tenant AI Cost Guardrails + Fast Cached Homepage Showcase (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Synthesized by Antigravity from our independent V7-B audit (`401 pass / 0 fail`), code inspection of `src/llm_router.js` / `src/profile_checklist.js` / `src/auto_reply_policy.js` / `src/luxury_web_funnel.js`, and Grok's V7-C recommendations.
> - **Visual Card Measurement Discipline**: Keep `editorial_split` as the sole template until frozen 24h metrics accumulate >= 7 days and sufficient `visualCardAttached` true/false pairs to isolate visual lift from playbook variance. Do NOT add new card templates in V7-C.
> - **Zero-Tolerance Bilingual Rule (`AGENTS.md` §1)** & **Design Palette Harmony (`AGENTS.md` §3)**: Every new/updated string on `/` and `/dashboard` must have matching JA/EN entries (passing `tests/homepage_v51_copy.test.js` and `tests/dashboard_language.test.js`) and match the bright editorial SaaS palette (`#FFFFFF`, `#F5F6F8`, `#E2E8F0`, `#2563EB`).
> - **Mandatory Peer-Review Note**: At completion, report any blind spots and your recommendations for **V7-D / V8 (Post-7-Day Data Audit, Multi-Template Visual Cards if lift is proven, and SaaS Acquisition/Retention Levers)**.

---

## Scope (3 High-ROI Production Hardening Deliverables)

### 1. Fix `claude-sonnet-5-5` `tool_use` Token Starvation & Enforce Registered URL in Pinned Posts (`src/llm_router.js`, `src/profile_checklist.js`, `src/auto_reply_policy.js`, `src/hybrid_saas_routes.js`)
- **Root Cause Found in Code Audit**:
  - `src/profile_checklist.js:265` (`maxTokens: 1600`), `src/auto_reply_policy.js:96` (`maxTokens: 600`), and `src/hybrid_saas_routes.js:2776` (`/draft-replies`, `maxTokens: 900`) pass small `max_tokens` budgets to `completeWriter`.
  - Because `claude-sonnet-5-5` consumes internal reasoning tokens before emitting `tool_use`, budgets under `3200` trigger `anthropic_tool_use_missing` — wasting latency & Claude input tokens before falling back to Grok (directly observed during V7-B live checklist verification!).
  - Additionally, `src/profile_checklist.js:358` checks `if (url && !bio.includes(url))` but does **not** verify `pin.includes(url)`, allowing `@VeloxSystemsHQ`'s LLM pinned post to drop `https://veloxpostapp.com`.
- **Fixes**:
  1. In `src/llm_router.js` (`completeWriter`, `L92-100`), enforce an Anthropic `max_tokens` floor of `Math.max(3200, Number(maxTokens) || 3200)` when calling Anthropic so `tool_use` blocks never starve mid-thought. (Keep prompt conciseness rules unchanged so actual output stays compact.)
  2. In `src/profile_checklist.js`:
     - On `L358`: reject any LLM checklist output where a registered `url` is missing from `pin` (`if (url && (!bio.includes(url) || !pin.includes(url))) return withCard;`), falling back cleanly to the deterministic `focusPlaybook` + `url` copy (`withCard`), as Grok recommended.
     - On `L311`: pass `pinMax` (`450` for paid/premium accounts, `280` for standard) instead of hardcoded `280` when constructing the deterministic `anchored` fallback so paid accounts get clean, complete playbook-anchored pins when degrading.

---

### 2. Unified Per-Tenant Monthly AI & Firecrawl Cost Guardrails (`src/tenant_ai_budget.js` [new], wired into `src/llm_router.js`, `src/lp_knowledge_extractor.js`, `src/site_crawler.js`, `src/profile_checklist.js`, `src/auto_reply_policy.js`, `src/hybrid_saas_routes.js`, `src/autonomous_promo_ai.js`, `src/telemetry_tracer.js`)
Adopting Grok's unified-counter architecture:
1. **Single Monthly Counter Per Tenant (`src/tenant_ai_budget.js`)**:
   - Store under `saas_users/{userId}.aiMonthlyUsage`:
     ```js
     {
       monthKey: 'YYYY-MM', // UTC YYYY-MM
       llmCalls: 0,         // Unified counter: post drafts + knowledge extraction + profile checklist + reply drafts
       writerCalls: 0,
       criticCalls: 0,
       crawlPages: 0,       // Firecrawl pages used this month
       updatedAt: Date
     }
     ```
   - Plan-tier monthly ceilings (via `resolvePlan(user)` from `src/plan_post_budget.js`, overridable by env vars `AI_MONTHLY_CALL_CAP_STARTER`, `AI_MONTHLY_CALL_CAP_PRO`, `AI_MONTHLY_CALL_CAP_BUSINESS`, `AI_MONTHLY_CALL_CAP_FREE`):
     - `free` / unpaid: `llmCalls: 20`, `crawlPages: 10`
     - `starter`: `llmCalls: 140`, `crawlPages: 40`
     - `pro`: `llmCalls: 380`, `crawlPages: 80`
     - `business`: `llmCalls: 750`, `crawlPages: 160`
   - Provide clean, testable helpers:
     - `monthlyLimitsForUser(user, env = process.env)`
     - `checkTenantAiBudget({ db, userId, user, kind = 'llm', count = 1, now = new Date() })` -> `{ allowed, degraded, remaining, limit, used, monthKey }`
     - `recordTenantAiUsage({ db, userId, kind = 'llm', role = 'writer', count = 1, now = new Date() })` (atomic Firestore `FieldValue.increment` when `monthKey` matches, or clean month rollover reset when `monthKey` changes; fail-open on transient Firestore errors so a DB hiccup never crashes posting).
2. **Unified Enforcement & Graceful Degradation (Never Stall Scheduled Posting)**:
   - **Knowledge Extraction (`src/lp_knowledge_extractor.js` & `src/site_crawler.js`)**:
     - Pass `{ db, userId, user }` through; before calling Claude/Firecrawl, check `checkTenantAiBudget`.
     - If over monthly `crawlPages`, skip Firecrawl (keep direct HTTP/RSS fetch only).
     - If over monthly `llmCalls`, reuse existing saved `brandKnowledge` (if `schemaVersion >= 2`) or fall back to deterministic offline extraction (zero LLM cost). Record every actual LLM extraction call (including the 2nd playbook-only retry call!) against the unified counter.
   - **Profile Checklist (`POST /api/autopilot/profile-checklist` & `src/profile_checklist.js`)**:
     - Check budget before `draftProfileCopy`. If exceeded, skip LLM and immediately return the deterministic `focusPlaybook` + `url` checklist (`withCard`) with `budgetDegraded: true` and a concise bilingual (`uiLang`) note. Record usage on actual LLM call.
   - **Reply Drafting (`POST /api/autopilot/mentions/:tweetId/draft-replies` & `composeInboundReply`)**:
     - Check budget before `completeWriter`.
     - On manual `/draft-replies`: if exceeded, return `429` with clear bilingual (`resolveUiLang(req)`) message explaining the monthly AI cap resets next month.
     - On background `composeInboundReply`: skip gracefully (`{ ok: false, reason: 'monthly_budget_exceeded' }`).
   - **Scheduled Post Drafting (`src/autonomous_promo_ai.js` -> `prepareNextPost` / `reThinkSingleJob`)**:
     - Check budget before running Claude + Critic.
     - If exceeded, **do NOT fail or halt the schedule**: skip extra rethink/radar LLM calls and degrade cleanly to the deterministic `focusPlaybook`-anchored fallback draft (or fast low-cost path if explicitly allowed), marking `budgetDegraded: true` on the job and in `generation_traces` / Langfuse trace metadata (`src/telemetry_tracer.js`) so the owner sees degradation immediately without breaking customer posting cadence.
   - **Auditability**: Include `aiMonthlyUsage` summary (non-sensitive counts: `used`, `limit`, `monthKey`, `degraded`) in `/api/autopilot/status` so it can be monitored without leaking secrets.

---

### 3. Fast Cached Homepage `/` Production Sample Showcase (`src/luxury_web_funnel.js`, `views/funnel_index.html`, `public/funnel/funnel_client.js`)
Adopting Grok's recommendation to separate anonymous homepage traffic from production LLM/Firecrawl costs while showing higher-quality real output (including the 1200×675 Visual Card!):
1. **Backend Cached Showcase (`src/luxury_web_funnel.js`)**:
   - Replace live anonymous per-URL `extractBrandKnowledge` + X API lookup + `draftNextPostText` inside `POST /api/funnel/free-experience` with a **fast (`< 300ms`), zero-LLM-on-request cached showcase** (1 `ja` sample + 1 `en` sample, 6-hour in-memory TTL cache):
     - Build each language sample from our real operated official accounts in Firestore (`@VeloxSystemsV4` for `ja`, `@VeloxSystemsHQ` for `en`), pulling:
       - Real verified `brandKnowledge` (`verifiedClaims`, `verifiedPricing`, `verifiedConstraints`, `domainPlaybooks`)
       - Real latest eligible V6/V7 post draft (preferring a posted or pending `autopilot_jobs` entry with `visualCard.eligible === true` and matching `lang`; falling back cleanly to a deterministic `focusPlaybook` sample built from `brandKnowledge` if no matching job exists — NEVER exposing any third-party customer's data!)
       - Pre-rendered `1200×675` Visual Card PNG via `renderVisualCardPng(sample.visualCard)` cached in memory per language (`ja` / `en`).
     - Expose:
       - `GET /api/funnel/sample-showcase?lang=ja|en` -> returns `{ ok: true, cachedSample: true, generatedAt, preview: { account, facts, pricing, constraints, shapeReason, focusPlaybookTopic, tweets, visualCardUrl: '/api/funnel/sample-card.png?lang=...' } }`
       - `GET /api/funnel/sample-card.png?lang=ja|en` -> returns cached `image/png` (`Cache-Control: public, max-age=3600`, `X-Content-Type-Options: nosniff`; `404` if card unavailable).
       - Keep `POST /api/funnel/free-experience` working (backwards-compatible) returning the exact same cached sample for `lang: 'en' | 'ja'` with `cachedSample: true` — **zero unauthenticated Claude/Grok/Firecrawl/X API calls on anonymous POSTs**.
2. **Honest, High-Converting `/` Showcase UI (`views/funnel_index.html:447-488`, `public/funnel/funnel_client.js:2520-2593`)**:
   - Keep bright editorial palette & generous section breathing room (`AGENTS.md` §3).
   - Replace the 3 anonymous custom-URL inputs (which previously implied live arbitrary-URL crawling) with an honest, instant showcase panel:
     - Clean language-aware showcase header & lead clearly stating this is a **cached sample generated by the actual production pipeline** (`本番エンジン生成の完成見本（キャッシュ表示）` / `Cached production sample generated by the live pipeline`), and that custom URL analysis runs inside the free dashboard after sign-up.
     - Sample selector pills (`🇯🇵 日本語見本 (@VeloxSystemsV4)` / `🇺🇸 English Sample (@VeloxSystemsHQ)` synced cleanly with landing language) + primary button (`id="btnRunFreeTest"`) + secondary CTA `自分のURLで試す（無料登録）` / `Try with your own URL (Free sign-up)` triggering `openAuthModal('register')`.
     - Inside `#expConsole`, render:
       - Honest cached-sample badge
       - Account summary, Verified Page Facts, Prices/Limits, Selected Shape
       - Post Draft(s)
       - **Real 1200×675 Visual Card Preview (`<img>` from `preview.visualCardUrl`)** with clean rounded light-theme frame (`border: 1px solid #E2E8F0; border-radius: 12px; width: 100%; height: auto;`).
   - Update `I18N_LANDING.ja` / `I18N_LANDING.en` in `views/funnel_index.html` cleanly (every `data-i18n` / `data-i18n-ph` key present in BOTH `ja` and `en`, zero forbidden retired claims, `bindDemoFieldEdits` / `applyDemoLanguageDefaults` cleanly updated or null-safe).

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/llm_router.js`, `src/profile_checklist.js`, `src/auto_reply_policy.js`, `src/tenant_ai_budget.js`, `src/lp_knowledge_extractor.js`, `src/site_crawler.js`, `src/hybrid_saas_routes.js`, `src/autonomous_promo_ai.js`, `src/telemetry_tracer.js`, `src/luxury_web_funnel.js`, `public/funnel/funnel_client.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
   ```
   -> Must report **0 fail / 0 skip** (`>= 401` + new V7-C tests, including `tests/homepage_v51_copy.test.js`, `tests/dashboard_language.test.js`, and `tests/launch_progress_and_uilang.test.js`).
4. New unit tests (`tests/v7c_budget_and_showcase.test.js`):
   - `llm_router`: `completeWriter` sends `max_tokens >= 3200` to Anthropic even when caller passes `600` or `1600`.
   - `profile_checklist`: rejects an LLM `pin` that drops a registered `targetUrl` and serves the deterministic `focusPlaybook` + `url` fallback instead; respects `pinMax = 450` for paid accounts on fallback.
   - `tenant_ai_budget`: unified counter counts post draft + extraction + profile checklist + reply draft under one `aiMonthlyUsage.llmCalls` cap, resets on `monthKey` rollover, degrades checklist & scheduled posting cleanly instead of throwing, and returns `429` (bilingual JA/EN) on manual `/draft-replies` when exhausted.
   - `luxury_web_funnel`: `POST /api/funnel/free-experience` and `GET /api/funnel/sample-showcase` return cached JA/EN samples with `cachedSample: true` and `visualCardUrl` **without** invoking `extractBrandKnowledge`, `draftNextPostText`, or X API on request; `GET /api/funnel/sample-card.png` returns `200` `image/png` with PNG magic bytes.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`) + HTTP verification:
   - `GET /` -> `200`, `GET /?lang=en` -> `200`, `GET /dashboard` -> `302`
   - `GET /api/funnel/sample-showcase?lang=ja` -> `200` (`cachedSample: true`, `< 300ms` on warm cache)
   - `GET /api/funnel/sample-showcase?lang=en` -> `200` (`cachedSample: true`)
   - `GET /api/funnel/sample-card.png?lang=ja` & `?lang=en` -> `200` (`image/png`)
   - Unauthenticated `GET /api/autopilot/jobs/test/visual-card.png` -> `401`, `POST /api/admin/trigger-weekly-report` -> `401`
6. **Live Verification**:
   - Re-run `buildAiProfileChecklist` on `@VeloxSystemsHQ` (`USR-MVUA1GLP-D640`) and `@VeloxSystemsV4`: verify Claude `tool_use` succeeds directly (no `anthropic_tool_use_missing` fallback!) AND both pinned posts contain `https://veloxpostapp.com` with zero ungrounded numbers.
   - Verify `@VeloxSystemsV4`'s `12:34 JST` pending job remains untouched (or inspect posted status if past `03:34 UTC`).
   - Share your peer-review observations & recommendations for the next wave (**V7-D / V8**).
