# VeloxPost Cloud V7-D Implementation Spec: Live Homepage Showcase P1 Fix + Budget Safety Hardening + Allowance UI & Activation Metric (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Synthesized by Antigravity from our independent V7-C audit (`406/406` standalone + live `curl` payload inspection of `/api/funnel/sample-showcase`) and Grok's candid V7-C engineering review.
> - **Visual Card Measurement Discipline**: Keep `editorial_split` as the sole template until >= 7 days of frozen 24h `visualCardAttached` pairs accumulate.
> - **Zero-Tolerance Bilingual Rule (`AGENTS.md` §1)** & **Bright Editorial Design System (`AGENTS.md` §3)**: Zero Japanese characters inside `lang=en` API payloads or `/?lang=en` UI pills; keep dashboard clean and uncluttered.
> - **Mandatory Peer-Review Note**: At completion, report verification results (including live `curl` excerpts of both `lang=ja` and `lang=en` showcase payloads!) and your peer-review assessment of what remains before broader customer acquisition (**V8 Growth Readiness Audit**).

---

## Scope (4 Surgical Deliverables — Priority Ordered)

### 1. [P1 Live Bug Fix] Fix Homepage Cached Showcase Selecting Ancient/Japanese Posts (`src/luxury_web_funnel.js:296-353`, `views/funnel_index.html:464-467`)
- **Observed Live Right Now**:
  - `GET /api/funnel/sample-showcase?lang=en` currently returns **Japanese text** (`"朝の投稿準備で止まる問題を解消するX運用の仕組み。..."`) to English homepage visitors (`AGENTS.md` §1 violation!).
  - `GET /api/funnel/sample-showcase?lang=ja` currently returns an ancient 59-char brochure fragment (`"VELOX AIX投稿の企画・作成・予約を、ひとつに。..."`) instead of `@VeloxSystemsV4`'s real 213-char V6/V7 post (`job_next_b8d0dcf4-df19-4343-8373-a45f36e6b4d2`).
  - Meanwhile, `@VeloxSystemsHQ` already has a clean V7 English post (`job_next_de732a76-e9fa-43c1-842e-41404cca6ada`, `text_en`: `"The safest automation boundary is whose account the action lands on..."`, `pb_3`), and `@VeloxSystemsV4` has its real V7 Japanese post (`job_next_b8d0dcf4-df19-4343-8373-a45f36e6b4d2`, `text`: `"毎回少しずつ宣伝を混ぜれば..."`, `pb_3`, `visualCard.eligible === true`).
- **Root Causes in `src/luxury_web_funnel.js:307-330`**:
  1. `.where('userId', '==', account.userId).limit(20)` reads the **oldest 20 Nov-13 docs** without sorting newest-first.
  2. Does not filter `status === 'pending' || status === 'posted'` (so cancelled/failed/ancient docs leak in).
  3. Does not enforce script purity (`en` MUST reject any text containing `/[\u3040-\u30ff\u4e00-\u9fff]/`; `ja` MUST contain Japanese script and have length `>= 80`).
  4. Always picks `knowledge.domainPlaybooks[0]` (`pb_1`) instead of aligning `focusPlaybook` to the chosen `job.focusPlaybookId` (so the visual card and post text talk about different playbooks!).
- **Exact Fixes**:
  1. In `loadCachedShowcase(lang)` (`src/luxury_web_funnel.js:296-353`):
     - Fetch `autopilot_jobs` for `account.userId` (query `where('userId', '==', account.userId)` without arbitrary unsorted `.limit(20)`), filter strictly to `status === 'pending' || status === 'posted'`, and sort **newest first** by `scheduledAt` / `createdAt` timestamp descending.
     - Extract candidate tweet array via a clean helper `extractShowcaseTweets(row, key)`:
       - For `key === 'en'`: check `row.tweets_en`, `row.tweets`, `[row.text_en]`, `[row.text]` — accept ONLY non-empty arrays where **every tweet passes `!/[\u3040-\u30ff\u4e00-\u9fff]/.test(t)`** and total length `>= 80` chars.
       - For `key === 'ja'`: check `row.tweets`, `[row.text]`, `[row.text_ja]` — accept ONLY non-empty arrays containing Japanese script (`/[\u3040-\u30ff\u4e00-\u9fff]/`) and total length `>= 80` chars (and no banned legacy claims!).
     - Prefer the newest eligible job with `row.visualCard && row.visualCard.eligible === true`, falling back to the newest language-valid job (`status === 'pending' || 'posted'`), and finally to the clean language-pure `book` fallback.
     - **Align Visual Card to the Chosen Job's Playbook**: Look up `matchedBook = (knowledge.domainPlaybooks || []).find(p => p && p.id === job.focusPlaybookId) || book`, and use `job.visualCard` (if eligible and matching `key` script!) or `planVisualCard({ portfolioRole: 'utility_save', focusPlaybook: matchedBook, brandKnowledge: knowledge, lang: key })` so the rendered PNG card matches the displayed post text!
     - Also filter `facts`, `pricing`, and `constraints` in `lang=en` so zero Japanese-script items ever appear inside the English showcase payload.
  2. In `views/funnel_index.html:464-467`:
     - Add `data-i18n="demo_pill_ja"` to `#samplePillJa` and `data-i18n="demo_pill_en"` to `#samplePillEn`, with matching entries in **both** `I18N_LANDING.ja` (`🇯🇵 日本語見本 (@VeloxSystemsV4)` / `🇺🇸 英語見本 (@VeloxSystemsHQ)`) and `I18N_LANDING.en` (`🇯🇵 Japanese Sample (@VeloxSystemsV4)` / `🇺🇸 English Sample (@VeloxSystemsHQ)`) so zero raw Japanese text appears when `/?lang=en` is active!

---

### 2. Fix Monthly Usage Over-Charging on Failed Profile Checklist Calls (`src/profile_checklist.js:354-382`, `src/hybrid_saas_routes.js:1778-1792`)
Adopting Grok's self-audit catch:
- Currently `src/hybrid_saas_routes.js:1782` calls `recordTenantAiUsage` **before** `buildAiProfileChecklist` runs, deducting quota even when the LLM call throws or returns empty/unusable JSON.
- **Fix**:
  - Have `buildAiProfileChecklist` track whether `draftProfileCopy` returned a non-null LLM response (`llmCallAttempted` / `llmSucceeded`), or accept `onLlmSuccess` callback / return non-enumerable or explicit `llmUsed: boolean`.
  - In `POST /api/autopilot/profile-checklist` (`src/hybrid_saas_routes.js:1778-1792`), call `recordTenantAiUsage` **only after** `buildAiProfileChecklist` confirms an LLM call actually succeeded (never deduct when `budgetDegraded === true` or when the LLM call failed!).

---

### 3. Enforce Deterministic Audit on Budget-Degraded Scheduled Posts (`src/autonomous_promo_ai.js:3054-3120`, `src/tenant_ai_budget.js`)
Adopting Grok's self-audit catch:
- Currently when `budgetDegraded === true`, `degradedPostText(focusPlaybook)` bypasses `runDeterministicAudit` and `inspectPostCompliance` — risking a short/thin/invalid pending draft in the schedule.
- **Fix**:
  - Strengthen `degradedPostText(focusPlaybook, { maxChars, lang })` in `src/tenant_ai_budget.js` so it builds a complete, natural post from `topic`, `readerSituation`, `checkCriteria`, and `boundaryCondition` clipped cleanly at sentence boundaries within `maxChars`.
  - In `src/autonomous_promo_ai.js` (`prepareNextPost` around `L3064`): pass the degraded candidate through `inspectPostCompliance` + `runDeterministicAudit` (same truth/script/length rules as normal posts!).
  - If the degraded candidate fails audit, do **not** write a broken draft over the schedule — keep any existing valid pending job intact (or return a clean `budget_degraded_audit_failed` status without corrupting the queue).

---

### 4. Subtle Monthly Allowance Indicator in Dashboard & Activation Timing Metric (`views/dashboard_view.html`, `src/autonomous_promo_ai.js`, `src/hybrid_saas_routes.js`)
Adopting Grok's UX & conversion measurement recommendations:
1. **Dashboard Monthly Allowance Line (`views/dashboard_view.html`)**:
   - Read `data.aiMonthlyUsage` (`{ used, limit, monthKey, degraded }`) already returned by `GET /api/autopilot/status`.
   - Render a compact, calm, bright-palette status badge/line in the dashboard overview/settings area (not an intrusive banner, preserving initial simple UX):
     - JA: `今月のAI利用枠: ${used} / ${limit}回` (when `degraded === true`: amber soft pill `今月のAI利用枠の上限に達しました（来月リセット・基本文で継続中）`)
     - EN: `Monthly AI allowance: ${used} / ${limit}` (when `degraded === true`: amber soft pill `Monthly AI allowance reached (resets next month; continuing with safe fallback)`)
   - Strictly branch on `checkIsEn()` (zero JA/EN mixing).
2. **Registration-to-First-Scheduled-Post Activation Metric (`src/autonomous_promo_ai.js`)**:
   - The first time a `pending` job is created for a user (`!user.firstScheduledPostAt`), write `firstScheduledPostAt: new Date()` and `activationSeconds` (computed from `user.createdAt` when present, rounded integer >= 0) onto `saas_users/{userId}` with `{ merge: true }` (fail-open, never blocking job creation). This lets us track real onboarding speed from sign-up to first queued post.

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/luxury_web_funnel.js`, `src/profile_checklist.js`, `src/hybrid_saas_routes.js`, `src/tenant_ai_budget.js`, `src/autonomous_promo_ai.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
   ```
   PLUS standalone `node --test --test-force-exit tests/post_constraint_stop_isolation.test.js` -> **0 fail / 0 skip** (`>= 406` + new V7-D tests).
4. New unit tests (`tests/v7d_showcase_and_budget_safety.test.js`):
   - `luxury_web_funnel`: `loadCachedShowcase('en')` picks the newest valid English `pending`/`posted` job, rejects any Japanese script in `tweets`/`facts`/`constraints`, and aligns `focusPlaybookTopic` + visual card to `job.focusPlaybookId`; `loadCachedShowcase('ja')` picks the newest V6/V7 Japanese job (>= 80 chars) over ancient Nov-13 short fragments.
   - `profile_checklist` + `hybrid_saas_routes`: failed LLM calls in `/api/autopilot/profile-checklist` do NOT increment `aiMonthlyUsage.llmCalls`.
   - `autonomous_promo_ai` + `tenant_ai_budget`: `budgetDegraded` fallback posts pass `runDeterministicAudit` and refuse to overwrite a valid pending job if audit fails.
   - `views/funnel_index.html` & `views/dashboard_view.html`: `#samplePillJa` / `#samplePillEn` have bilingual keys in both `ja` and `en` (passing `homepage_v51_copy.test.js` and `dashboard_language.test.js`).
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`) + **Live `curl` Verification (MUST report exact excerpts!)**:
   - `GET /api/funnel/sample-showcase?lang=ja` -> verify `200`, real V6/V7 Japanese post (`>= 100` chars) matching its `focusPlaybookTopic`!
   - `GET /api/funnel/sample-showcase?lang=en` -> verify `200`, real V6/V7 English post (`>= 100` chars) with **ZERO Japanese characters** anywhere in the JSON!
   - `GET /api/funnel/sample-card.png?lang=ja` & `?lang=en` -> `200` `image/png`.
   - `GET /` `200`, `GET /?lang=en` `200`, `GET /dashboard` `302`, unauthenticated `visual-card.png` `401`, unauthenticated weekly report `401`.
   - Verify `@VeloxSystemsV4` `12:34 JST` job (`job_next_b8d0dcf4-df19-4343-8373-a45f36e6b4d2`) and `@VeloxSystemsHQ` `03:31 UTC` job (`job_next_de732a76-e9fa-43c1-842e-41404cca6ada`) remain intact!
   - Share your peer-review assessment of **V8 Growth Readiness** (any remaining UX/conversion/reliability gaps before wider customer onboarding).
