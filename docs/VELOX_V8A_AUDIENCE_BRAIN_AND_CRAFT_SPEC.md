# VeloxPost Cloud V8-A Implementation Spec: Dual-Brain Audience Intelligence + Fast Live `x_search` Radar + 5-Archetype Anti-Monotony Engine + Graduated 4-Axis Critic (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Synthesized by Antigravity from our V8 Master Blueprint, Grok's 5-point peer-review critique, and Antigravity's live xAI Responses API benchmark (`2026-11-20`: `grok-4.20-0309-non-reasoning` completed live `x_search` in **4.99s**, `grok-4-fast-non-reasoning` in **6.94s**, while `grok-4.7` timed out at `>14s`).
> - **Visual Card Template Discipline**: Do NOT add new visual card templates in V8-A (keep `editorial_split` v2 unchanged so V8-A text-archetype gains stay cleanly separable before V8-B adds `before_after_card` / `checklist_3step_card`).
> - **Safe Migration Rule**: Keep `brandKnowledge` (`schemaVersion: 3`) and `domainPlaybooks` completely intact; place Brain 2 alongside them at `saas_users/{userId}.audienceKnowledge` (`schemaVersion: 1`). Do NOT blindly overwrite existing `pending` jobs during deployment — verify offline preview drafts first.
> - **Mandatory Peer-Review Note**: At completion, report full verification results, live V8-A offline preview drafts for `@VeloxSystemsV4` (JA) and `@VeloxSystemsHQ` (EN) with 4-axis Critic scores and live `x_search` timing, plus your recommendations before we launch **V8-B (Before/After & 3-Step Visual Cards)**.

---

## Scope (5 Surgical Deliverables — Ordered Safely)

### 1. Fix Matched Opening-Quote Stripping (`src/official_api_client.js:388`)
- **Bug**: `text.replace(/^(?:["'「『]|&quot;)+|(?:["'」』]|&quot;)+$/g, '').trim()` deletes a leading `「` even when `」` closes mid-sentence (corrupting `「数字や強い言葉を足せば…」とよく言われます。` into `数字や強い言葉を足せば…」とよく言われます。`).
- **Fix**: Replace line 388 with a matched outer-pair stripper: only strip outer quotes when the ENTIRE trimmed text is wrapped by matching quotes (`"..."`, `'...'`, `「...」`, `『...』`, `&quot;...&quot;` with no inner matching close before the end), leaving mid-sentence quoted openings 100% intact.

---

### 2. Fast Live `x_search` Radar & Prompt Wiring (`src/grok_client.js:102-159`, `src/context_radar.js`, `src/next_post_draft.js:634`)
- **Live Empirical Benchmark**:
  - `grok-4.20-0309-non-reasoning` + `tools: [{ type: 'x_search' }]` -> **4.99s (`200`, 2 live tool calls)**.
  - `grok-4-fast-non-reasoning` + `tools: [{ type: 'x_search' }]` -> **6.94s (`200`, 3 live tool calls)**.
  - `grok-4.7` -> **Timeout (`>14s`)**.
- **Fixes**:
  1. In `src/grok_client.js`:
     - In the `if (search)` branch (`L137-159`): respect `modelOverride` (or `tier === 'fast' ? modelForTier('fast') : modelForTier('quality')`, defaulting to `modelForTier('quality')` when neither is passed so existing `tests/v6_phase1_router_and_craft.test.js` & `tests/grok_client.test.js` pass unchanged!).
     - Support `xSearchOnly: true`: builds attempts as `[[{ type: 'x_search', ...(handles.length ? { excluded_x_handles: handles } : {}) }], [{ type: 'x_search' }]]` (single `x_search` tool ONLY, no `web_search` in the same budget!).
  2. In `src/context_radar.js`:
     - Use `model: process.env.XAI_MODEL_RADAR || 'grok-4.20-0309-non-reasoning'`, `tier: 'fast'`, `search: true`, `xSearch: true`, `xSearchOnly: true`, `timeoutMs: 12000`.
     - If `x_search` aborts or errors: log concisely and return `null` immediately (NO slow retry loop; caller falls back to an evergreen Brain 2 archetype so posting NEVER stalls!).
     - Scrub all Arabic digits/percentages/quotes from returned `topic`, `pain`, `angleHint` (`max 3 items`, each `<= 80` chars, strictly qualitative — prevents raw tweet stats like `0.45%` from leaking into drafts!).
     - Persist cache in Firestore `collective_intelligence/live_radar_v1` keyed by `category|lang` (6h TTL; zero product names or UI labels in key or prompt!).
  3. In `src/next_post_draft.js`:
     - Wire `contextSignals.signals` (previously discarded at `L634`!) cleanly into `briefPrompt` and `candidatePrompt` when `archetype === 'live_trend_brief'` (or as optional current context), instructing Claude to address the real public workflow debate without inventing quotes, dates, or stats.

---

### 3. Brain 2 — Autonomous Audience Intelligence Engine (`src/audience_knowledge_engine.js` [new], wired into `src/autonomous_promo_ai.js`)
Adopting Grok's truth boundary & coexistence architecture:
- **Storage & Caching**:
  - Store at `saas_users/{userId}.audienceKnowledge` (`schemaVersion: 1`, `outputLang`, `contentHash`, `extractedAt`, `readerPersona`, `internalToolJargonBlocklist`, `audienceTopics`).
  - **7-day TTL** per `contentHash + outputLang`. **Never invalidate or mutate `brandKnowledge` (`schemaVersion: 3`) or `domainPlaybooks`!**
  - Check `checkTenantAiBudget` before running; call `recordTenantAiUsage` (writer + radar) **only on successful generation**. If budget is exhausted or generation fails, fall back seamlessly to existing `domainPlaybooks` without stopping scheduled posting.
- **Strict Truth vs. Illustrative Craft Separation**:
  - Every card in `audienceTopics` MUST carry `exampleKind: 'illustrative'` and represent **general practitioner craft for the target reader (ICP)** — NEVER a product feature tutorial, NEVER fake customer results, NEVER medical/legal/tax diagnosis!
  - Synthesize 10–15 distinct reader-first cards across 5 archetypes (`before_after_rewrite`, `actionable_checklist`, `failure_autopsy`, `contrarian_sharp`, `live_trend_brief`) using `completeWriter` (Claude Sonnet 5.5, fallback Grok) from `brandKnowledge` (`category`, `icpSummary`, `oneLineMechanism`, `terminology` — excluding brand names) + optional qualitative `context_radar` snapshot:
    - `before_after_rewrite`: `{ id, archetype, exampleKind: 'illustrative', topic, context, weakExample, strongExample, whyItWorks }` (clearly illustrative rewrite of a reader's own draft/workflow — NOT "a customer who used our product").
    - `actionable_checklist`: `{ id, archetype, exampleKind: 'illustrative', topic, readerPain, steps: [s1, s2, s3], boundaryNote }`.
    - `failure_autopsy`: `{ id, archetype, exampleKind: 'illustrative', topic, commonTrap, realCause, practicalFix, boundaryNote }`.
    - `contrarian_sharp`: `{ id, archetype, exampleKind: 'illustrative', topic, lazyBelief, sharpTruth, concreteCheck }`.
    - `live_trend_brief`: `{ id, archetype, exampleKind: 'illustrative', topic, practitionerStance, evaluationCriteria }`.
  - **`internalToolJargonBlocklist`**: Auto-extracted array (10–25 strings) of the customer's `productName` + internal UI/setting phrases from their LP (e.g., `送信前ゲート`, `保存したアカウント像`, `紹介を希望する設定`, `画面の説明`, `登録ページ`, `同一ドメイン内の案内`, `VELOX AI`).
  - **Deterministic Pre-Save Scrubber**: Reject any Brain 2 card containing `productName`, pricing, ungrounded stats (`%`, `倍`, `円`, `万`, `件`, `時間`, dates/times), or fake customer/result claims (`導入後`, `売上が`, `フォロワーが増えた`, `導入事例`, `顧客が`, `customers gained`, `revenue increased`). Require `>= 4` clean cards to persist; otherwise leave existing `domainPlaybooks` active.

---

### 4. 5-Archetype Anti-Monotony Router + Deterministic Cliché & Jargon Gates + Low-Impression Bandit Guard (`src/editorial_archetypes.js` [new], `src/draft_verifier.js`, `src/next_post_draft.js`, `src/bandit_optimization_engine.js`)
1. **5-Archetype Router (`src/editorial_archetypes.js`)**:
   - Inspects the last 5 posted/pending jobs' `archetype` and `focusTopicId`.
   - **Hard Non-Repetition**: Never selects the same `archetype` as the last 2 posts.
   - Default rotation weights: `before_after_rewrite` (25%), `actionable_checklist` (25%), `failure_autopsy` (20%), `live_trend_brief` (15% — auto-falls back to `before_after_rewrite`/`actionable_checklist`/`failure_autopsy` if radar returned `null`), `contrarian_sharp` (15%, concise punchy `< 180` JA / `< 240` EN chars).
   - Provides archetype-specific structural instructions to `briefPrompt` & `candidatePrompt` in `src/next_post_draft.js` (so Candidate `a`/`b`/`c` are 3 sharp takes on that archetype — NOT 3 copies of `"〜という見方があります → ただ〜"`!).
   - Persist `archetype` and `focusTopicId` on both `autopilot_jobs` and `generation_traces` for 7-day measurement!
2. **Deterministic Gates in `src/draft_verifier.js`**:
   - **Keep `verifyNumericGrounding` strict as-is** (already allows standalone `1`/`2`/`3` and `①②③`; do NOT relax stat guards!).
   - **Ban Cliché Textbook Openers** (`cliche_opener`): reject posts opening with or leaning on `という見方があります`, `とよく言われます`, `と考えがちです`, `そう考えて運用する方がいます`, `多くの場合、`, `Many assume`, `Most operators assume`, `It is often said`. (Scope cleanly so legacy unit tests with synthetic fixtures don't falsely break; verify all existing tests!)
   - **Enforce `internalToolJargonBlocklist` + Fake Result Claims ONLY on non-promo posts (`!promo && role !== 'explicit_promo_offer'`)**:
     - When `context.audienceKnowledge` is active and `!promo`, reject drafts containing blocked internal tool/UI terms (`internal_jargon:...`) or fake customer result claims (`導入後`, `売上が`, `フォロワーが増えた`, `導入事例`, `顧客が`, `customers gained`).
     - Promo slots (`explicit_promo_offer` / `allowPromoUrl: true`) and pinned posts are **exempt** from the tool-jargon blocklist!
3. **Low-Impression Bandit Guard (`src/bandit_optimization_engine.js`)**:
   - Adopting Grok's §4 catch: ignore frozen 24h posts with **`impressions < 100`** (weight `0`) in playbook/archetype performance selection so 19-impression posts with 0 bookmarks never skew Bandit decisions!

---

### 5. Graduated 4-Axis Independent Critic (`src/llm_router.js`, `src/next_post_draft.js`)
Adopting Grok's §3 safety calibration:
- Update Grok Critic prompt AND **OpenAI strict `json_schema`** (`src/llm_router.js:171-186`) to return:
  - `id` (string)
  - `scrollStopHook` (number, 0–25)
  - `saveUtility` (number, 0–25)
  - `strangerClarity` (number, 0–25)
  - `craftAndTruth` (number, 0–25)
  - `score` (number, 0–100)
  - `weakness` (string)
- Keep `usableScores` backward-compatible when legacy unit-test stubs return only `{ id, score, weakness }` (defaulting missing axes to `null`, not rejecting legacy stubs!).
- **V8-A Graduated Adoption Thresholds** (prevents `PostConstraintError` freezes on Day 1 while enforcing real quality!):
  - Adoption score stays **`>= 72`** (will raise to `78` after 30 live posts pass >70% without repair).
  - Hard axis floors (when axes are returned by live Critic): **`strangerClarity >= 14`** AND **`scrollStopHook >= 12`**. (`saveUtility` and `craftAndTruth` are logged to `generation_traces` & Langfuse for calibration without causing premature hard stops.)
  - Max **1 targeted repair** feeding the lowest failing axis + `weakness` back to Claude.
  - **Cadence Protection**: If after the 1 repair a candidate passes **ALL deterministic checks** AND scores **`60 <= score < 72`** with `strangerClarity >= 14` and `scrollStopHook >= 12`, select the highest-scoring candidate and mark `criticDegraded: true` on the job & trace instead of halting the schedule. Scores **`< 60`** (such as `score: 40` in `tests/editorial_intelligence.test.js`) still hard-reject with `critic_below_72`!

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/official_api_client.js`, `src/grok_client.js`, `src/context_radar.js`, `src/audience_knowledge_engine.js`, `src/editorial_archetypes.js`, `src/draft_verifier.js`, `src/llm_router.js`, `src/next_post_draft.js`, `src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
   ```
   PLUS standalone `node --test --test-force-exit tests/post_constraint_stop_isolation.test.js` -> **0 fail / 0 skip** (`>= 415` + new V8-A tests; all existing tests in `editorial_intelligence.test.js`, `v6_phase1_router_and_craft.test.js`, `grok_client.test.js`, `audit_fix_verification.test.js`, `v6_phase2/3/4` updated only where needed and all green!).
4. New unit tests (`tests/v8a_audience_brain_and_craft.test.js`):
   - `sanitizePostOrReplyText`: keeps mid-sentence closing quote `「数字や強い言葉」とよく言われます` intact while still stripping full-wrapping `「全文引用」`.
   - `context_radar` + `grok_client`: `xSearchOnly: true` sends single `[{ type: 'x_search' }]` with fast model, scrubs digits/percentages from radar items, returns `null` cleanly on abort without retrying endlessly, and passes `signals` into `next_post_draft`.
   - `audience_knowledge_engine`: generates Brain 2 cards tagged `exampleKind: 'illustrative'`, scrubs any card leaking `productName`/stats/fake customer claims, leaves `brandKnowledge` (`schemaVersion: 3`) untouched, and counts budget only on success.
   - `editorial_archetypes` + `draft_verifier`: prevents repeating the same archetype in last 2 posts, rejects cliché textbook openers and internal tool jargon on non-promo posts while allowing product terms on promo posts, and keeps `impressions < 100` weight `0` in `bandit_optimization_engine`.
   - `llm_router` + `next_post_draft`: 4-axis OpenAI strict schema & Grok Critic parse cleanly, enforce `strangerClarity >= 14` & `scrollStopHook >= 12`, hard-reject `< 60`, and mark `criticDegraded: true` for `60–71` post-repair passing deterministic checks.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`) + HTTP verification (`/` 200, `/?lang=en` 200, `/dashboard` 302, unauthenticated card & weekly 401).
6. **Live Verification (NO blind overwrite of existing pending jobs!)**:
   - Build & persist `audienceKnowledge` (`schemaVersion: 1`) for `@VeloxSystemsV4` (JA) and `@VeloxSystemsHQ` (EN) -> report card counts, archetype distribution, `internalToolJargonBlocklist` sample, and live `x_search` latency (`ms`) + scrubbed topics.
   - Run **offline dry-run generation** (NOT saving over active pending jobs yet!) for `@VeloxSystemsV4` (`before_after_rewrite` & `actionable_checklist`) and `@VeloxSystemsHQ` (`before_after_rewrite`) -> paste the **full generated draft texts**, 4-axis Critic scores, and generation latency so Antigravity and the owner can directly compare V8-A vs today's V7 posts!
   - Confirm whether `job_next_1f84f876-6a5a-400d-b382-42f57ea3508b` (`@VeloxSystemsHQ` `22:24 JST` English visual card) remains untouched.
   - Share your peer-review observations before **V8-B**.
