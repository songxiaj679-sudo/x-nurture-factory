# VeloxPost Cloud — Autonomous Editorial Quality & URL-Only Customer Upgrade Spec (for Grok)

> **Before writing any code, strictly follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–4**:
> - Keep **UI language** (`uiLang`) strictly separated from **post generation language** (`aiTargetLang`), and ensure complete JA/EN parity across all customer-facing strings (`customerReason`, dashboard banners, error messages).
> - Never reintroduce fake statistics, invented diary stories/times, or retired claims (`9割`, `月100時間`, `3.2倍`, `3.4倍`, `凍結リスクゼロ`). Grounded truth remains non-negotiable.
> - Autonomous operation is mandatory: everything MUST work cleanly when a customer provides **only a target URL** (or only a short account goal) with zero manual `brandContextNotes`.

---

## Verified Root Causes Blocking Growth & Quality Today

Observed directly in live Firestore (`WEB-GOOGLE-D12E2479A76266AEA2B4` / `@VeloxSystemsV4`), `collective_intelligence/editorial_lexicon_v1`, and production modules:

1. **Critic-Rejected Garbage Ships via `draft_repair` Fallback (`src/next_post_draft.js:580-635`)**:
   - In `editorial_lexicon_v1.rejectionSignals` (`2026-11-19T15:01:47Z`), the Critic properly rejected bland brochure drafts at `score: 42–51` (`< 72`).
   - However, `next_post_draft.js:631-632` accepts `repairedCandidates.find(passesDraft)` **without re-scoring repaired candidates with the Critic**, and falls back to `fallbackAccepted` (an un-repaired `< 72` draft already rejected by Critic).
2. **"Product Brochure Syndrome" on Every Value Slot (`src/lp_knowledge_extractor.js`, `src/next_post_draft.js:219-225, 373-376, 516-518`)**:
   - For URL-only users, `extractBrandKnowledge` only extracts `verifiedClaims` describing the product itself (`VELOX AI reads 3 pages`, `1日1〜5枠`, `Developer Exhibit`).
   - `next_post_draft.js` picks one of those `verifiedClaims` (`focusClaim`) and instructs Grok `"今回の主軸はこの未消化の柱にする"`, even on non-promo educational slots (`utility_save`, `conversation_debate`, `story_observation`).
   - Result: every post reads like a third-person product brochure repeating the same 5 landing-page feature bullets in abstract corporate prose (`"VELOX AIは〜設計しています"`, `"チームはこれを解明し..."`) with 0 Likes / 0 Bookmarks across 7 straight posts (`11/18–11/19`).
3. **Echo-Chamber `Context Radar` & Locked `VoiceProfile` (`src/context_radar.js`, `src/account_voice_profiler.js`)**:
   - `context_radar.js:22` receives `brandKnowledge.terminology` (`"2段階設計と投稿審査"`, `"ACCOUNT VOICE"`, `"QUALITY & SHAPE"`, `"PAGE FACTS ONLY"`). In live Firestore (`contextRadarCache`), this literally echoed back `topic: "ACCOUNT VOICE, QUALITY & SHAPE"` instead of real practitioner pains/debates in the user's industry, and frequently hits the `18000ms` timeout (`[Context Radar] This operation was aborted`).
   - `account_voice_profiler.js` cached `voiceProfile` with `thinkingLens: "unpacks every hard idea by converting it into a repeatable measurement-and-redesign loop..."` + legacy `sampleHooks` (`月100時間...`, `3.4倍...`), forcing every single topic into the exact same repetitive self-referential loop.
4. **Monolithic Unformatted Prose on Structured Slots (`src/next_post_draft.js:312-313, 365-366`)**:
   - Even when `genes.format` is `structured_breakdown` / `checklist_framework` on a Paid/Premium account (`maxChars: 900`), posts render as one dense unformatted 200-char corporate paragraph with boilerplate endings (`"〜効率的な運用が可能です"` bypassing `SLOP`'s `"これにより.{0,24}が可能です"`).
5. **Footer Cancellation Text Still Leaking into `customerReason` + Empty `moveScores` (`src/bandit_optimization_engine.js:248-295`, `src/editorial_lexicon_engine.js:391-394`)**:
   - Live pending job `job_next_54af88b9` (`2026/11/20 08:24 JST`) still displays:
     `hypothesisWho: "対象はページに無い"` and `hypothesisWhy: "不要になったときはボタン1つでいつでも停止・解約できます（規約条件の詳細は利用規約に記載）"`.
   - `evolveAccountLexiconAndLessons` (`src/editorial_lexicon_engine.js:391-394`) keeps `{}` when Grok returns an empty `moveScores` object instead of falling back to `fallback.domainLexicon.moveScores`.

---

## Required Changes (Exact Files & Behavior)

### 1. Gate Repaired Drafts Through Critic & Block Brochure Clichés (`src/next_post_draft.js`, `src/draft_verifier.js`)
1. **`src/next_post_draft.js:580-635`**:
   - When Critic ran (`!skipCriticScore && hasXaiKey()`), score repaired candidates that pass `passesDraft` with the Critic as well (or if `accepted` already scored `< 72`, do **not** fall back to un-scored `fallbackAccepted` when `repairedCandidates` pass/fail). Only accept candidates scoring `>= 72` (when Critic returns valid scores for repairs) or throw `PostConstraintError` if neither initial nor repaired candidates pass quality checks (recording failure feedback). Preserve unit tests where `hasXaiKey()` is false or `skipCriticScore: true`.
2. **`src/next_post_draft.js` Formatting & `src/draft_verifier.js` `SLOP`**:
   - On `structured_breakdown` and `checklist_framework` formats, explicitly instruct `candidatePrompt` / `draftPrompt` to format cleanly for X readers (`1-line crisp hook` -> blank line -> `2–3 scannable boundary checks / contrast steps` -> `clear closing line`, using `\n`) instead of a monolithic single paragraph, while staying strictly within `accountState.maxChars` and containing zero invented numbers.
   - Tighten `SLOP` in `src/draft_verifier.js:8` and Critic scoring rubric in `src/next_post_draft.js:568` to penalize/reject robotic corporate brochure phrasing (`チームはこれを解明し`, `(?:効率的な|持続可能な)運用が可能です`, `一つの仕組みで管理できるように設計`).

### 2. Separate "Domain Value Topics" From "Product Promo Claims" (`src/lp_knowledge_extractor.js`, `src/next_post_draft.js`, `src/autonomous_promo_ai.js`)
1. **`src/lp_knowledge_extractor.js:179-218, 270`**:
   - Extend `extractBrandKnowledge` schema (with backward-compatible optional defaults & strict `groundKnowledge` sanitization) to also extract:
     - `domainProblems` (4–8 concise practitioner problems, common operational mistakes, decision tradeoffs, and non-numeric workflows faced by `icpSummary` in `category` — derived directly from the page's problem space, e.g. for an X-ops SaaS: *separating short-term reach variance from saved bookmarks*, *avoiding spammy bulk automation traps*, *when pre-written schedules drift from live audience feedback*).
     - Strictly forbid invented percentages, counts, or case-study claims inside `domainProblems` (`extractNumberTokens` / grounded checks still apply).
   - Ensure `terminology` focuses on domain nouns relevant to customers rather than internal UI badge strings if mixed.
2. **`src/next_post_draft.js` Slot Separation (`L219-225, L373-387, L501-518`)**:
   - Determine whether the current slot is a **Product Slot** (`promo === true` OR `portfolioPlan.portfolioRole === 'profile_asset_bridge'` OR `portfolioPlan.portfolioRole === 'explicit_promo_offer'`) vs a **Domain Value Slot** (`utility_save`, `conversation_debate`, `story_observation`).
   - On **Domain Value Slots**:
     - Do **NOT** force `brandKnowledge.verifiedClaims` (`focusClaim`) as `"今回の主軸"`, and explicitly tell Grok: *"Teach a concrete operational tradeoff, diagnostic check, or reader mistake from `domainProblems` / `contextSignals` / `questions`. Do NOT pitch or mention `productName` unless strictly necessary for context."*
     - Pick the least-recently-used topic from `domainProblems` (analogous to `selectFreshClaimIndex`) so consecutive posts cover distinct angles instead of repeating the same product loop 5 times a day.
   - On **Product Slots** (`profile_asset_bridge`, `explicit_promo_offer`):
     - Keep using `selectFreshClaimIndex(claims, memory)` grounded strictly in `verifiedClaims`, showing one concrete mechanism/contrast before inviting readers to inspect the pinned/linked details.

### 3. Fix `Context Radar` & `Account Voice Profiler` (`src/context_radar.js`, `src/autonomous_promo_ai.js`, `src/account_voice_profiler.js`)
1. **`src/context_radar.js` & `src/autonomous_promo_ai.js:2844-2850`**:
   - Filter out internal/English UI jargon or capitalized system labels (`PAGE FACTS ONLY`, `ACCOUNT VOICE`, `QUALITY & SHAPE`, `ADAPTIVE LOOP SYSTEM`, `2段階設計と投稿審査`) before passing hints to `fetchSituationalContext`.
   - Prompt `context_radar.js` to return **external industry challenges, recurring practitioner questions, and current workflow debates** in `category` / `icpSummary` — explicitly instructing: *"Never repeat product names, UI labels, or marketing slogans from the company site; return broader problems operators in this field discuss this week."*
   - Increase `timeoutMs` gracefully (e.g. `26000`) or use non-search fast synthesis fallback when web search aborts so `contextRadarCache` reliably refreshes with real practitioner topics.
2. **`src/account_voice_profiler.js`**:
   - Bump `schemaVersion` (`2` -> `3`) and check `profile.schemaVersion === 3` in `cacheFresh` (`L52`) so stale cached `v2` profiles refresh cleanly.
   - Filter legacy banned phrases (`9割`, `月100時間`, `3\.2倍`, `3\.4倍`, `保存して後で見返`, `シャドウバン`) out of `sampleHooks` (`L109`, `L129`).
   - In the voice prompt (`L119-120`), clarify `thinkingLens` should capture **tone and analytical lens across varied industry topics** (e.g. for an official SaaS account sharing dev/verification insights: *"concrete builder tradeoffs and operational checks"*) — **NOT** lock every post onto repeating one product workflow (`"converting every idea into a 2-6h measurement-and-redesign loop"`).

### 4. Clean `extractPageHypotheses` / `customerReason` & `domainLexicon.moveScores` (`src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`, `src/editorial_lexicon_engine.js`)
1. **`src/bandit_optimization_engine.js:248-303` & `customerFacingReason`**:
   - Expand `isPageDisclaimer` to filter `/利用規約|停止・解約|ボタン1つ|自動更新|無料トライアル終了|規約条件|terms of service|cancel anytime/i`.
   - Pass optional `brandKnowledge` into `extractPageHypotheses(pageSummary, brandKnowledge)` (backward-compatible second arg!) so when `whos` or `whys` heuristics match nothing on the raw DOM snippet, `brandKnowledge.icpSummary` / `brandKnowledge.verifiedClaims` (`audience`, `painScene`, `mechanism`) provide real grounded `who` / `why` values instead of falling back to `'対象はページに無い'` and footer legal copy!
   - Keep `tests/bandit_optimization_engine.test.js` (`L126-189`) 100% passing.
2. **`src/editorial_lexicon_engine.js:391-394`**:
   - Guard empty `moveScores`: if `!lexicon.moveScores || !Object.keys(lexicon.moveScores).length`, inherit `fallback.domainLexicon.moveScores`.

### 5. Live Refresh on Deployment
- After passing tests & restarting PM2 workers (`pm2 startOrRestart ecosystem.config.js --update-env && pm2 save`), cancel/regenerate tomorrow's bland pending draft on `@VeloxSystemsV4` (`job_next_54af88b9-2664-4810-8cd1-fedf586af8be` if still `pending`, plus clear stale `contextRadarCache` on `@VeloxSystemsV4` / `@VeloxSystemsHQ` if it contains `ACCOUNT VOICE`) and trigger fresh `prepareNextPost` (or `replenish`) verification so the very next queued post demonstrates the upgraded quality immediately without any manual hints.

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file.
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html` (if untouched, confirm still valid).
3. Full non-emulator unit test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit
   ```
   -> Must report **0 fail / 0 skip**.
4. Add unit tests covering:
   - `next_post_draft`: critic-rejected `< 72` draft is NOT emitted via un-scored repair fallback; Domain Value Slots (`utility_save` / `conversation_debate`) draw from `domainProblems` without pitching `productName`.
   - `context_radar` & `account_voice_profiler`: branded UI terminology / banned legacy `sampleHooks` (`月100時間`, `3.4倍`, `ACCOUNT VOICE`) are filtered out, and `schemaVersion === 3` invalidates stale `v2` cache.
   - `extractPageHypotheses`: rejects `利用規約` / `ボタン1つでいつでも停止・解約` and uses clean `brandKnowledge` fallback when provided rather than leaking legal terms into `customerReason`.
   - `evolveAccountLexiconAndLessons`: empty LLM `moveScores` inherits fallback `moveScores`.
5. `pm2 startOrRestart ecosystem.config.js --update-env && pm2 save` + verify `GET /`, `GET /?lang=en`, `GET /dashboard`, `POST /api/admin/trigger-weekly-report` (`401`).
6. Inspect the freshly regenerated `pending` draft for `@VeloxSystemsV4` (`WEB-GOOGLE-D12E2479A76266AEA2B4`) to confirm it is structured, non-brochure, free of fake stats/clichés, and has clean `customerReason`.
