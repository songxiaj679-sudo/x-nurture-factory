# VeloxPost Cloud V6 — Phase 1 Final Implementation Spec (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Complete autonomy from URL-only input, zero JA/EN UI mixing, zero retired claims/fabricated numbers.
> - Incorporates **all peer-review refinements agreed between Antigravity and Grok** + live API probe verification.
> - **Mandatory Peer-Review Note**: If you discover any unexpected runtime/SDK/API edge case while implementing Phase 1 (e.g., Anthropic `tool_use` schema strictness, xAI `x_search` parameter acceptance, or `next_post_draft` latency), note your supplemental recommendations clearly in your completion report so we fold them cleanly into Phase 2.

---

## Live-Verified `.env` State (Ready Now)
All keys are already written into `/home/songxiaj679/x-nurture-factory/.env` (gitignored, mode `0600`) and verified via live HTTP 200 probes:
- `ANTHROPIC_API_KEY` (`sk-ant-usr-...` personal console key -> **MUST send via `x-api-key` header, NEVER `Authorization: Bearer`**) + `ANTHROPIC_MODEL_WRITER=claude-sonnet-5-5` (`GET /v1/models` -> `200`).
- `XAI_API_KEY` + `XAI_MODEL_QUALITY=grok-4.7` + `XAI_REASONING_EFFORT_CRITIC=medium`.
- `OPENAI_API_KEY` + `OPENAI_MODEL_CRITIC=gpt-4.1` (`GET /v1/models` -> `200`, fallback Critic only).
- *(Phase 2/4 keys already stored for later phases: `FIRECRAWL_API_KEY` — note Firecrawl warned `/v1/` is deprecated, use `/v2/` in Phase 2; `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL=https://jp.cloud.langfuse.com` — verified `200` on JP region for Phase 4.)*

---

## Phase 1 Scope (Exact Files & Requirements)

### 1. New Role-Based Multi-Model Router (`src/llm_router.js` + `src/grok_client.js`)
Create `src/llm_router.js` with zero new npm dependencies (use Node 22 native `fetch`) and clean testability:
1. **`completeWriter({ prompt, systemPrompt, schemaName, inputSchema, maxTokens, timeoutMs, cacheSystemPrompt })`**:
   - Primary when `ANTHROPIC_API_KEY` is set: `POST https://api.anthropic.com/v1/messages` with headers:
     - `'x-api-key': process.env.ANTHROPIC_API_KEY.trim()`
     - `'anthropic-version': '2023-06-01'`
     - `'content-type': 'application/json'`
   - Model: `process.env.ANTHROPIC_MODEL_WRITER || 'claude-sonnet-5-5'`.
   - **Structured output via `tool_use`** (NOT free-text JSON): pass `tools: [{ name: schemaName, description: 'Return structured JSON matching schema', input_schema: inputSchema }]` and `tool_choice: { type: 'tool', name: schemaName }`, extracting the `tool_use` block's `.input` directly.
   - **Prompt Caching ONLY on stable `system` block**: when `cacheSystemPrompt` is true and `systemPrompt` is non-empty, send `system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]`. Do NOT cache dynamic per-post user prompt content.
   - `max_tokens`: `800` for brief/single output; `1400` for 3-candidate generation so structured tool payloads never truncate mid-object.
   - Fallback: if `ANTHROPIC_API_KEY` is unset OR Anthropic returns a retryable error/timeout, fall back cleanly to `grok_client.completeText({ tier: 'quality', reasoningEffort: 'low', json: true })` + `extractJson`.
2. **`completeCritic({ prompt, systemPrompt, schemaName, jsonSchema, timeoutMs, writerProvider })`**:
   - **Independent Cross-Provider Selection (per Grok review)**:
     - When `writerProvider === 'anthropic'` (default): use **xAI Grok** (`XAI_MODEL_QUALITY || 'grok-4.7'`) with `reasoning_effort: process.env.XAI_REASONING_EFFORT_CRITIC || 'medium'` + `response_format: { type: 'json_object' }` + `extractJson`.
     - If xAI fails/unavailable OR `writerProvider === 'xai'`: use **OpenAI** (`POST https://api.openai.com/v1/chat/completions`, `OPENAI_MODEL_CRITIC || 'gpt-4.1'`) with `response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: jsonSchema } }` when `OPENAI_API_KEY` is set; otherwise fall back to Grok at `reasoning_effort: 'medium'`.
   - **Never treat missing/unparseable score as `0`**:
     - Validate that parsed `scores` is a non-empty array with finite numeric `score` (`0..100`) matching candidate IDs.
     - If unreadable/invalid, retry Critic **once** within remaining latency budget. If still unreadable, return `{ ok: false, unparseable: true }` so caller stops with `critic_unparseable` instead of burning a repair call on `critic_below_72:0`!
3. **Update `src/grok_client.js`**:
   - Allow optional `reasoningEffort` override on `completeText(...)` (defaults to `XAI_REASONING_EFFORT_QUALITY || 'low'` for `'quality'`, `'none'` for `'nurture'`).
   - Support `xSearch: true` and `excludedXHandles: []` when `search: true` on `/v1/responses`: build `tools: [{ type: 'x_search', ...(cleanHandles.length ? { excluded_x_handles: cleanHandles } : {}) }, { type: 'web_search' }]`. If xAI returns `400` rejecting `excluded_x_handles` or `x_search`, transparently retry once with `[{ type: 'x_search' }]` and then `[{ type: 'web_search' }]` without crashing.
4. Record `{ role, provider, model, ms, ok, reason, cachedTokens }` in `qualityAudit` on every LLM call.

---

### 2. Hard 110s Latency Budget, Slot Reclassification, Universal Line Breaks & Positive Craft Anchors (`src/next_post_draft.js`, `src/draft_verifier.js`)
1. **Hard 110-Second Total Deadline (`draftNextPostWithMeta`)**:
   - Track `const deadlineAt = Date.now() + Math.min(Number(timeoutMs) || 110000, 110000);` (keeping unit tests fast when custom `timeoutMs` is passed).
   - Stage budgets (each clamped to `Math.max(5000, deadlineAt - Date.now())`, skipping repair/re-score cleanly if `< 8000ms` remains):
     - Brief: `<= 18s` (fast/writer structured tool)
     - Writer Candidates: `<= 35s`
     - Critic: `<= 20s`
     - Repair Writer: `<= 35s`
     - Repair Re-Score Critic: `<= 15s`
2. **Move `profile_asset_bridge` Out of Forced `productSlot` (`src/next_post_draft.js:550`)**:
   - `const productSlot = Boolean(promo || role === 'explicit_promo_offer');`
   - `const domainSlot = !productSlot;`
   - On `domainSlot` (`utility_save`, `conversation_debate`, `story_observation`, AND `profile_asset_bridge`): center strictly on `domainProblems` / `contextSignals` / reader questions with **zero forced product pitch** (on `profile_asset_bridge`, at most a subtle non-salesy closing note pointing to deeper profile context, never a product feature essay!).
3. **Universal Scannable X Line-Break Gate (`src/next_post_draft.js:599-603`)**:
   - Require `\n\n` readable spacing on **ALL** non-`micro_punch` posts when `isEn ? joinedLen >= 180 : joinedLen >= 110` (so `logical_thread` / `narrative_insight` / `single` long posts cannot emit a dense corporate paragraph!). Update `formatGuide` so Writer always knows when breaks are required.
4. **Compact Positive Craft Skeletons (Zero Exemplar Leakage)**:
   - Trim redundant negative repetition in `systemRules` (`L386-390`), keep non-negotiable truth/no-hallucination invariants, and add 2 brief **structure-only rhythm anchors** from a completely unrelated craft domain (e.g., espresso calibration / database migration) explicitly marked: *"Copy ONLY the pacing (1-line concrete premise -> blank line -> specific boundary/tradeoff -> crisp ending). NEVER output any words from these craft examples."*
   - Add a deterministic check & unit test verifying zero exemplar terms leak into generated candidates.
5. **Tighter Platitude & Brochure Rejection (`src/draft_verifier.js` + Critic prompt)**:
   - Update Critic rubric to cap empty corporate conclusions (`根拠に基づく判断が重要です`, `判断軸となります`, `質向上とアカウント保護を実現`) at `<= 55`, requiring one concrete operational tradeoff or decision rule that a reader could apply today to score `>= 72`.
   - Add `判断軸となります` / `根拠に基づく判断が重要です` to `SLOP` (`src/draft_verifier.js:8`) only if generic standalone filler (ensure existing unit tests in `tests/draft_verifier*` / `tests/editorial_intelligence.test.js` stay green).

---

### 3. Non-Blocking `x_search` Context Radar (`src/context_radar.js`, `src/autonomous_promo_ai.js:2842-2869`)
- **Zero blocking latency during post generation**:
  - In `prepareNextPost` (`src/autonomous_promo_ai.js:2842-2869`), **never await** `fetchSituationalContext` for 4s–26s on the critical path!
  - Immediately read `user.contextRadarCache.signals` if valid (non-internal).
  - If cache is missing or expired (`> 8h`), fire `fetchSituationalContext(...)` asynchronously in the background (`.then(save to Firestore).catch(warn)`) so it warms cache for the next slot without slowing down the current post.
- **Brand-Free Industry Phrase in Phase 1**:
  - Strip `productName`, handle tokens, UI badges, and LP slogans from `category` / `icpSummary` / `terminology` before calling `fetchSituationalContext` (`xSearch: true`, `excludedXHandles: [ownHandle]`), producing a pure external industry lens (e.g., `"B2B SaaS・X運用実務"` instead of VELOX's own copy).

---

### 4. Single-Worker Process Hygiene & Test Stability (`ecosystem.config.js`, `tests/post_constraint_stop_isolation.test.js`, Legal Pages)
1. **Eliminate `x-shop` vs `x-saas-worker` Duplicate Worker Race**:
   - Currently `ecosystem.config.js` starts BOTH `x-shop` (inline worker enabled) AND `x-saas-worker` (`src/saas_worker.js`, `restarts: 79` with `x-saas-worker lock is already held`), creating OAuth2 refresh-token races and double job writes!
   - Remove the `x-saas-worker` entry from `ecosystem.config.js` (and stop/delete `x-saas-worker` from PM2 cleanly) so `x-shop` is the **sole single-instance process** running `startAutopilotJobRunner()` with one unified in-process OAuth2 token refresh lock.
   - Do **not** delete `src/ai_deliberation_council.js` (still used by JIT/legacy paths), while ensuring `next_post` slots save exclusively via `next_post_draft.js`.
2. **Fix `tests/post_constraint_stop_isolation.test.js` Teardown**:
   - Bound waits and restore `t.mock.timers` in `finally` blocks so `grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit` runs reliably with **0 fail / 0 skip** (no `Unable to deserialize cloned data` IPC crash!).
3. **Sync Legal / Privacy Disclosures (`views/compliance_company.html`, `views/compliance_privacy.html`)**:
   - In both JA and EN sections, accurately list active/configured Phase 1 AI processors: `xAI API、Anthropic API（設定時）、OpenAI API（設定時）` / `xAI API, Anthropic API (when configured), OpenAI API (when configured)`. Do NOT list Firecrawl/Langfuse yet until Phase 2/4 are enabled. Keep `tests/compliance_and_topnav_i18n.test.js` passing!

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited/added `.js` file (`src/llm_router.js`, `src/grok_client.js`, `src/next_post_draft.js`, `src/context_radar.js`, `src/draft_verifier.js`, `src/autonomous_promo_ai.js`, `ecosystem.config.js`, and touched tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator suite **including** `tests/post_constraint_stop_isolation.test.js` and `tests/compliance_and_topnav_i18n.test.js`:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit
   ```
   -> Must report **0 fail / 0 skip** (confirming IPC teardown error is gone!).
4. Add focused unit tests (`tests/v6_phase1_router_and_craft.test.js`):
   - `llm_router`: Anthropic uses `x-api-key` + `tool_use` + `cache_control` on system only; Critic enforces Writer ≠ Critic (Anthropic Writer -> Grok `medium` Critic -> OpenAI `strict` JSON schema fallback); unreadable Critic score retries once and returns `critic_unparseable` (never `0`).
   - `next_post_draft`: `profile_asset_bridge` uses `domainSlot` (no forced product feature pitch); JA `>= 110` char non-`micro_punch` post without `\n\n` triggers repair; unrelated craft exemplar vocabulary never leaks; total deadline respected.
   - `context_radar`: non-blocking cache return + brand/product tokens stripped from search query.
5. PM2 & HTTP Verification:
   - `pm2 stop x-saas-worker && pm2 delete x-saas-worker || true`
   - `pm2 startOrRestart ecosystem.config.js --update-env && pm2 save`
   - Verify `x-saas-worker` is gone, `x-shop` is online, and `GET /` `200`, `GET /?lang=en` `200`, `GET /dashboard` `302`, `POST /api/admin/trigger-weekly-report` `401`.
6. **Live Quality Proof on `@VeloxSystemsV4` (`WEB-GOOGLE-D12E2479A76266AEA2B4`)**:
   - Cancel stale `job_next_92ffac88-d91f-430f-8d13-03bea75a02ca` (if still `pending`), run `prepareNextPost` once against the live multi-model router, and report:
     - Total elapsed time (`< 110s` check)
     - `qualityAudit` providers & models (verifying Claude Sonnet 5.5 Writer + Grok 4.7 `medium` Critic)
     - Full generated post text & `customerReason` verbatim!
