# VeloxPost Cloud V6 Re-Evaluation & Next-Wave Discussion Spec (Antigravity + Grok Joint Review)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - This document serves TWO purposes:
>   1. **Urgent V6.1 Production Fixes** (P0/P1 defects caught in live post-reconnect & multi-account audit that MUST be fixed before scaling customer acquisition).
>   2. **Joint Antigravity × Grok Discussion on V7 Priorities** (evaluating from first principles what moves customer conversion, retention, and real X growth next, plus surfacing any Owner Action Items).

---

## Part 1: Urgent V6.1 Production Bugs Caught in Live Audit (Must Fix Immediately)

### P0 [CRITICAL DATA LOSS]: X OAuth Reconnect Wipes Customer `targetUrl`, `aiTargetLang`, `scheduleTimeZone`, and `userPrompt`!
- **Observed Live at `2026-11-19T23:50:29Z`**: When `@VeloxSystemsV4` (`WEB-GOOGLE-D12E2479A76266AEA2B4`) clicked "再連携" to grant `media.write`, Firestore was immediately overwritten with:
  - `targetUrl: ""` (wiped `"https://veloxpostapp.com"`!)
  - `aiTargetLang: "en"` (overwrote `"ja"`!)
  - `scheduleTimeZone: "America/New_York"` (overwrote `"Asia/Tokyo"`!)
  - `userPrompt: "Use only the public profile and registered page, and leave one practical point a reader can use."`
  *(Antigravity manually restored `@VeloxSystemsV4` in Firestore immediately so `03:34Z` won't fail, but the bug affects EVERY customer who ever reconnects X!)*
- **Exact Root Cause (`src/twitter_auth.js:282-291, 482-486` + `src/autonomous_strategy_architect.js:40-73`)**:
  1. `upsertTwitterUser` (`src/twitter_auth.js:282-291`) returns a sparse session summary `{ userId, email, xUsername, ... }` WITHOUT `targetUrl`, `userPrompt`, `aiTargetLang`, `scheduleTimeZone`, `strategyLockByUser`, `xOfficialCredentials`, or `voiceProfile`.
  2. `src/twitter_auth.js:483` passes that sparse object directly into `maybeAutofillStrategy(db, user)`.
  3. `maybeAutofillStrategy` (`src/autonomous_strategy_architect.js:40-73`) never reloads the full `saas_users/{userId}` document from Firestore, sees `targetUrl/userPrompt/aiTargetLang/bio` all empty, decides `japanese = false`, and overwrites the existing user's saved settings via `.set(proposal, { merge: true })`!
  4. Additionally, `src/autonomous_strategy_architect.js:47` still assigns `creds.userId = user.userId` (SaaS ID) instead of preserving numeric `twitterId` via `bindOfficialCreds`.
- **Required Fix**:
  - Inside `maybeAutofillStrategy(db, user)`:
    1. Always load the full current `saas_users/{user.userId}` document from `db` first (merging cleanly so existing fields are authoritative).
    2. **NEVER overwrite existing settings** if `existing.targetUrl`, `existing.userPrompt`, `existing.aiTargetLang`, `existing.scheduleTimeZone`, or `existing.strategyLockByUser === true` is already set! Only autofill missing fields on genuinely brand-new unconfigured accounts (and never write `targetUrl: ''` when a `targetUrl` already exists!).
    3. Use `bindOfficialCreds` (preserve numeric `twitterId`, set `creds.saasUserId = user.userId`) before calling `getUserProfileAndRecentTweets`.

### P1 [CUSTOMER BRANDING & RENDERING]: Visual Card Leaks `"VELOX"` Watermark, Double-Escapes XML, and Clips Footer/Border (`src/visual_card.js`)
- **Observed**:
  1. `src/visual_card.js:26` hardcodes `badge: 'VELOX'` for **every** customer! When a paying customer (e.g. Acme Corp / a clinic / an EC shop) connects their URL, their X card should NOT stamp a giant blue `"VELOX"` pill onto their brand image — it should display the customer's own concise brand/category badge (e.g. `brandKnowledge.productName` or `focusPlaybook.topic` category, clipped `<= 20` chars, falling back to neutral `'POINT'` / `'KEY CHECK'`).
  2. `src/visual_card.js:56-61` calls `escapeXml(...)` before passing strings to Satori JSX children — Satori escapes JSX text natively, so `&`, `'`, `"` would render literally as `&amp;` / `&#39;` on PNGs! Remove `escapeXml` inside `cardMarkup` (keep `escapeXml` only in `renderGroundedCard` raw SVG fallback).
  3. `src/visual_card.js:85` hard-slices `footer` at `42` chars mid-word (`その設定を入れているかどうか`), and the inner white card border (`width: 1120` inside `width: 1200, padding: 40`) slightly clips on the right/bottom edge. Allow clean 2-line footer wrapping (`<= 76` chars, `lineHeight: 1.4`) and ensure `boxSizing: 'border-box'` / balanced `height` so all 4 rounded corners frame symmetrically.

### P1 [MULTI-ACCOUNT / EN COVERAGE]: Old `brandKnowledge` & Cold-Start Benchmark Cache Bugs
1. **Stale Pre-V6 Cache on Existing Accounts (`@VeloxSystemsHQ` EN Account)**:
   - Live Firestore shows `@VeloxSystemsHQ` (`USR-MVUA1GLP-D640`) still has `playbooksCount: 0`, `bkSchema: undefined`, `alignmentOk: undefined`, `hasCard: false`, and an older pre-V6 EN draft (`job_next_3ca4dbdb...`).
   - Verify `lp_knowledge_extractor.js:368` (`cached.schemaVersion === 3`) triggers clean automatic re-extraction for English accounts (`outputLang: 'en'`) with `domainPlaybooks` in natural English (not Japanese!), and verify EN `visual_card.js` renders crisp English cards (check font metrics for Latin + Japanese).
2. **`x_benchmark_radar.js` Never Hydrates Firestore Cache on Restart (`src/x_benchmark_radar.js:38-95`)**:
   - Currently `scheduleNicheBenchmark` only reads the in-memory `Map` (`peekNicheBenchmark`) — after `x-shop` restarts, even though `collective_intelligence/niche_benchmarks_v1` already has `x_ai_saas_ja` in Firestore, RAM is empty so cold-start hints are missed and a slow `x_search` fires again!
   - Fix: Read `collective_intelligence/niche_benchmarks_v1` into memory (lazy hydration once per slug/process) BEFORE triggering a background refresh, and note that `grok_client.js:118` forces `modelForTier('quality')` on `search: true` (verify whether `grok-4.20-0309-non-reasoning` or higher timeout `30s` finishes cleanly in the background).
3. **Eliminate Double LLM Call on `extractBrandKnowledge` (`src/lp_knowledge_extractor.js:381-425`)**:
   - Grok noted the first extraction call sometimes omits `domainPlaybooks` requiring a second call; tighten `inputSchema.required` (`['productName', 'category', 'icpSummary', 'verifiedClaims', 'domainProblems', 'domainPlaybooks']`) and prompt instructions so 1 Claude call returns everything cleanly on the first shot.

---

## Part 2: V7 Next-Wave Product & Growth Architecture (Antigravity's Proposal — For Joint Discussion With Grok)

Now that the core autonomous V6 engine works end-to-end (`36.8s`, Claude Sonnet 5.5 + Grok non-reasoning Critic + Firecrawl v2 + Langfuse JP + Noto Sans JP 1200×675 PNG + X `media.write`), here are the **5 highest-leverage V7 initiatives** ranked by business impact (conversion, retention, and real X growth):

1. **V7-1: Live Visual Card Preview & Per-Job Card Toggle in Dashboard + Upgrade Top-Page Free Demo (`/`) to V6 Quality**
   - **Why**: Today customers can't SEE the crisp 1200×675 visual card inside `/dashboard` before it publishes, and `/` free live demo (`src/luxury_web_funnel.js:392`) runs fast-tier text only (`timeoutMs: 18000`) without showing the V6 Claude quality or a sample visual card!
   - **Impact**: Seeing a sharp, non-brochure post + publication-grade branded diagram card generated live from just their URL on `/` and in `/dashboard` is the single strongest conversion lever for the 14-day trial.
2. **V7-2: Live Media-Upload End-to-End Verification + Real Account Growth Loop (`@VeloxSystemsV4` JA + `@VeloxSystemsHQ` EN)**
   - Verify the FIRST real live `api.x.com/2/media/upload` -> `api.twitter.com/2/tweets` publish on `@VeloxSystemsV4`, monitor real 24h bookmarks/impressions in `generation_traces` + Langfuse JP over 7 days, and empirically tune Critic rubric weights based on actual bookmark lift (not guesswork!).
3. **V7-3: Autonomous Engagement & Pinned-Asset Growth Flywheel (Not Just Passive Broadcasting)**
   - Accounts with `< 200` followers grow 3–5× faster when **high-value posts** are paired with:
     - **Smart Pinned-Post Generator & Audit**: One-click generated flagship pinned thread/post tailored to `brandKnowledge` + bio alignment (currently `profile_checklist` only gives short bio tips).
     - **Autonomous Inbound Mention & High-Signal Reply Drafts**: Upgrade the existing opt-in reply assist (`確認制の返信支援`) to use `claude-sonnet-5-5` + `brandKnowledge` so replies are sharp, human, and zero-spam.
4. **V7-4: Autonomous Multi-Template Visual Variety (`editorial_split` + `checklist_3` + `flow_3step`)**
   - Posting the exact same 2-column blue box template on every visual slot eventually causes visual fatigue. Rotating 3 clean, restrained editorial templates (split contrast / 3-point check card / 3-step decision boundary) matched to `genes.format` keeps feeds fresh.
5. **V7-5: Production Resilience, Cost Guardrails & Billing/Security Polish**
   - Per-tenant monthly AI/crawl spend telemetry & soft guardrails (Anthropic/Firecrawl token & credit accounting per `userId` in `generation_traces` -> ensures margins stay >85% on ¥4,980 Starter / ¥9,800 Pro / ¥19,800 Business plans!).
   - Clean up legacy/unrelated PM2 scripts if unused (`auto_post_v3`, `autpost2`), fix the parallel `--test-force-exit` flakiness permanently in `tests/post_constraint_stop_isolation.test.js`, and rotate the 5 API keys pasted during setup.

---

## Mandatory Joint Discussion Questions for Grok (Before Writing Any V6.1 / V7 Code)

**Grok**: Please review Part 1 (V6.1 urgent fixes) and Part 2 (V7 roadmap) critically and reply with your honest engineering & product opinions before we lock the next implementation spec:

1. **P0 Reconnect Wipe Fix**: Are there ANY other code paths (e.g., Google login, `/api/autopilot/save-setup`, workspace switching, or `syncSiblingXCredentials`) that can similarly overwrite an existing user's `targetUrl`, `aiTargetLang`, or `scheduleTimeZone`?
2. **Visual Card & Live Media Upload**: Now that `@VeloxSystemsV4` has `oauth2Scope: 'offline.access tweet.write media.write users.read tweet.read'`, what is the safest way to verify `api.x.com/2/media/upload` -> `api.twitter.com/2/tweets` on the first real post (and should we fix `escapeXml`, customer badge, and 2-line footer BEFORE that `03:34Z` / `12:34 JST` post fires in ~3.5 hours)?
3. **V7 Prioritization**: Among V7-1 through V7-5 (or something we missed completely!), what do YOU think delivers the biggest real jump in **paying customer delight & X follower/bookmark growth**, and in what exact order should we implement them?
4. **Technical Blind Spots**: What hidden risks do you see in (a) upgrading `/` live demo to V6 within fast latency (<15s), (b) Firestore `niche_benchmarks_v1` hydration, (c) English (`@VeloxSystemsHQ`) quality parity on Claude + Satori, or (d) per-tenant unit economics on `claude-sonnet-5-5`?
5. **Owner Action Items**: List any specific actions the founder needs to take right now or before V7 rollout.
