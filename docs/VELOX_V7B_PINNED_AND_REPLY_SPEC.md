# VeloxPost Cloud V7-B Implementation Spec: EN Playbook Clip Fix + Flagship Pinned-Post Architect + Claude Opt-In Reply Assist (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Synthesized by Antigravity from our V7-A verification, live `@VeloxSystemsHQ` English extraction probe, and Grok's V7-B recommendations.
> - **Template Measurement Discipline**: Do NOT add new visual card templates yet (keep `editorial_split` steady for 7 days so `visualCardAttached` bookmark lift stays statistically clean).
> - **Zero-Tolerance Bilingual Rule (`AGENTS.md` §1)**: All dashboard strings and API error messages MUST respect `uiLang` (`ja`/`en`) separately from `aiTargetLang`.
> - **Mandatory Peer-Review Note**: At completion, share your recommendations for **V7-C (Per-Tenant Monthly Cost Guardrails + `/` Cached Sample Demo + Multi-Template Cards after 7-day data)**.

---

## Scope (3 Focused Deliverables)

### 1. Fix English Playbook Mid-Sentence Truncation (`src/lp_knowledge_extractor.js:172-189`)
- **Observed Live on `@VeloxSystemsHQ` (`USR-MVUA1GLP-D640`)**: `outputLang: 'en'` now extracts 8 natural English playbooks (`schemaVersion: 3`), **but** `cleanPlaybook` (`L175-181`) clips every field at Japanese char limits (`topic: 30, readerSituation: 80, commonMistake: 80, checkCriteria: 100, boundaryCondition: 90`), chopping English sentences mid-phrase (e.g. `"...but you are"`, `"...fill gaps with"`, `"...registered page or"`).
- **Fix**:
  - Inside `cleanPlaybook(card, index, corpus)`, detect Latin/English text (`const en = !/[\u3040-\u30ff\u4e00-\u9faf]/.test(rawJoined);`) and use language-appropriate complete-sentence caps:
    - JA: `topic: 36, readerSituation: 90, commonMistake: 90, concreteTradeoff: 110, checkCriteria: 110, boundaryCondition: 96`
    - EN: `topic: 68, readerSituation: 180, commonMistake: 180, concreteTradeoff: 200, checkCriteria: 200, boundaryCondition: 180`
  - Update the English extraction prompt so Claude writes concise, complete 1-sentence fields (`<= 140` chars, ending with a period) that fit cleanly inside both `customerReason` and `visual_card.js` (`EN` card `clipCard` limits `120–140` chars with clean sentence boundaries, never chopping mid-word!).

---

### 2. Flagship Pinned-Post Auto-Architect Aligned With Top Playbook (`src/profile_checklist.js`, `src/hybrid_saas_routes.js`, `views/dashboard_view.html`)
Incorporating Grok's V7-B recommendations:
1. **Shared `focusPlaybookId` Selection (`src/profile_checklist.js:202-270`)**:
   - Pass `recentPostedJobs` (from `loadPostedJobs(userId)` in `POST /api/autopilot/profile-checklist` at `src/hybrid_saas_routes.js:1681`) into `buildAiProfileChecklist(user, uiLang, { liveProfile, brandKnowledge, recentPostedJobs })`.
   - Select **1 flagship playbook** from `brandKnowledge.domainPlaybooks`: prefer the playbook with the highest 24h frozen bookmark rate (`metrics24hSnapshot.isFrozen === true`), falling back cleanly to `domainPlaybooks[0]`.
   - Return `focusPlaybookId` and a matching `pinVisualCard` preview plan (`planVisualCard({ portfolioRole: 'utility_save', focusPlaybook, brandKnowledge, lang: copyLang })`) alongside `bio`, `pin`, and `pinNote`.
2. **Upgrade Pinned-Post & Bio Writer to `completeWriter` (Claude `claude-sonnet-5-5`, fallback Grok)**:
   - Replace `grok.completeJson({ tier: 'fast' })` (`L236`) with `completeWriter` (`src/llm_router.js`, `tool_use` schema `profile_checklist`, `maxTokens: 1600`, `timeoutMs: 28000`) when `ANTHROPIC_API_KEY` is set (gracefully falling back to Grok `completeJson` if unavailable/failing).
   - Keep `bio <= 160` chars (preserving `targetUrl` intact when present), `displayName <= 50` chars, and allow `pin` up to `450` chars for Paid/Premium accounts (or `280` chars for standard accounts) with crisp `\n\n` scannable breaks, anchored in the selected `focusPlaybook` so the pinned post matches the timeline's voice and thesis!
   - **Never auto-pin on publish**: strictly human-reviewed preview + copy (and optional card preview inside the Profile Checklist modal in `views/dashboard_view.html` with full JA/EN parity via `checkIsEn()`).
   - Preserve all existing truth guards (`hasUngroundedNumber`, `copyLang` vs `uiLang` script separation, banned legacy claim filtering) and existing unit tests in `tests/compliance_and_topnav_i18n.test.js`!

---

### 3. Claude-Upgraded Opt-In Reply Assist With Full Safety Guardrails (`src/auto_reply_policy.js`, `src/hybrid_saas_routes.js:1121-1215, 2734-2793`)
Incorporating all of Grok's safety & alignment rules:
1. **Approval Queue Remains Strict Default**:
   - Never enable unattended Phase 2 auto-replies by default (`X_AUTO_REPLY_PHASE2_ENABLED` remains opt-in).
2. **Upgrade Reply Drafting to Claude (`completeWriter`) + Account Language + Active `focusPlaybook`**:
   - In `POST /api/autopilot/mentions/:tweetId/draft-replies` (`src/hybrid_saas_routes.js:2734`) AND `composeInboundReply` (`src/auto_reply_policy.js:48`):
     - Determine reply language from `mention.text` / `user.aiTargetLang` (`en` vs `ja`, fixing the hardcoded Japanese-only prompt & `lang: 'ja'` audit at `L1212` and `L2750`!).
     - Use `completeWriter` (Claude `claude-sonnet-5-5`, fallback Grok `completeText`/`completeJson`) grounded in `user.voiceProfile`, `user.brandKnowledge` (and active `focusPlaybook` so replies share the same core stance as timeline & pinned posts!), and `mention.text` (sanitized as untrusted input).
     - Generate 2 concise, human, zero-hype reply options (Option 1: empathetic practical answer; Option 2: concise clarifying question), strictly **zero URLs, zero ungrounded numbers, zero sales push**, passing `replyPassesSafety` + `inspectPostCompliance` + `runDeterministicAudit` in the reply's actual language!
     - Return `focusPlaybookId` alongside `replies`.
3. **Enforce Full Safety Guards on Manual Approved Send (`POST /api/autopilot/mentions/:tweetId/send-reply`, `L2766-2793`)**:
   - Before calling `postOfficialTweet`, check:
     - `detectOptOut(mention.text)` and `blocked_reply_authors/{authorId}` -> `403` (`opt_out` / blocked author).
     - `replyAllowedNow({ authorId, selfTwitterId, blocked, lastReplyAt, sentToday, dailyCap, cooldownHours })`:
       - Prevent replying to own posts (`authorId === selfTwitterId` -> `409`).
       - Enforce daily plan cap (`planReplyCap` + `replySentToday` -> `429`).
       - Enforce per-author cooldown (`cooldownHoursPerAuthor`, default 24h -> `429`).
     - Enforce `replyPassesSafety(text, user.ngTopics)` + `inspectPostCompliance` + `runDeterministicAudit` (never bypass safety stops!).
     - After successful send, atomically update `autoReplySentDate`, `autoReplySentCount`, `autoReplyLastByAuthor[authorId]`, and `autoReplyRecentTexts` (last 5) on `saas_users/{userId}`!
   - Use `resolveUiLang(req)` for all error strings returned by `/mentions/*` endpoints (`JA` & `EN` parity).

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/lp_knowledge_extractor.js`, `src/profile_checklist.js`, `src/auto_reply_policy.js`, `src/hybrid_saas_routes.js`, `src/visual_card.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite (including `tests/compliance_and_topnav_i18n.test.js` and `tests/dashboard_language.test.js`):
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
   ```
   -> Must report **0 fail / 0 skip** (`>= 397` + new V7-B unit tests).
4. New unit tests (`tests/v7b_pinned_and_reply_assist.test.js`):
   - `lp_knowledge_extractor`: English playbook fields up to 180 chars stay complete (no mid-sentence truncation at 80 chars).
   - `profile_checklist`: `buildAiProfileChecklist` selects the top 24h-bookmarked playbook (`focusPlaybookId`), uses `completeWriter` when available, returns `pinVisualCard` matching `focusPlaybookId`, enforces `copyLang` vs `uiLang` separation, and blocks ungrounded numbers.
   - `auto_reply_policy` & `hybrid_saas_routes`: `/send-reply` blocks self-replies, opted-out/blocked authors, per-author cooldown violations, daily cap exhaustion, and unsafe URLs/slop; `draft-replies` respects `en` vs `ja` language and returns `focusPlaybookId`.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`) + HTTP verification (`GET /` 200, `GET /?lang=en` 200, `GET /dashboard` 302, unauthenticated `visual-card.png` 401, unauthenticated weekly report 401).
6. **Live Verification on `@VeloxSystemsHQ` (`USR-MVUA1GLP-D640`)**:
   - Force-refresh `extractBrandKnowledge` (`outputLang: 'en'`) -> verify complete, non-truncated English `domainPlaybooks`.
   - Test `buildAiProfileChecklist` for both `@VeloxSystemsV4` (JA) and `@VeloxSystemsHQ` (EN) -> report the generated flagship pinned posts & `focusPlaybookId` (confirming alignment and zero truncation/ungrounded numbers!).
   - Share your supplemental opinions for **V7-C (Cost Guardrails + `/` Fast Cached Sample Demo + Post-7-Day Multi-Template Cards)**.
