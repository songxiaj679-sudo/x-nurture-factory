# VeloxPost Cloud V6 — Phase 4 Implementation Spec: Playbook/Card Polish + Langfuse JP Telemetry + Two-Speed Learning + Niche Structural Benchmarks (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Complete autonomy from URL-only input, zero JA/EN UI mixing, zero retired claims/fabricated thresholds.
> - Incorporates **Grok's Phase 3 completion feedback** (non-blocking Langfuse JP writer/critic span sampling, excluding ungrounded/fabricated posts from learning data, scoring `text`/`customerReason`/`visualCard` alignment first) AND **2 live visual/code catches from Antigravity's Phase 3 audit**.
> - **Mandatory Peer-Review Note**: At completion, include your final end-to-end production readiness review & any remaining blind-spot recommendations across Phases 1–4.

---

## Part A: Phase 3.5 Quick Polish (Caught in Antigravity's Live Audit)

### A1. Unlock Real Claude-Authored `domainPlaybooks` (`src/lp_knowledge_extractor.js:186-187`)
- **Observed**: In Phase 3 live extraction for `@VeloxSystemsV4`, all LLM-returned playbooks were dropped by line `186-187` (`text.match(/[^\s、。]{0,16}\d+[^\s、。]{0,16}/g)` matched 32-char substrings around harmless digits like `"1つ"` / `"1本"`), leaving only the generic offline fallback (`"その場の印象だけで次の作業を決めてしまう"` repeated across `pb_1`..`pb_9`).
- **Fix**:
  1. In the playbook extraction prompt, explicitly instruct: *"Write playbooks qualitatively without Arabic numerals (`1つ` -> `ひとつ`, `2つ` -> `ふたつ`). Never invent counts, percentages, or software thresholds (such as '3 consecutive edits')."*
  2. Replace the overly wide 32-char substring check on line `186-187` with a **quantifier/threshold check**:
     - Extract numeric quantifier expressions (`/\d+(?:\.\d+)?\s*(?:回(?:連続)?|日(?:間)?|時間|分|秒|%|％|倍|件|人|名|社|ページ|枠|割|円|万|億|個|ヶ月|ヵ月|年|ステップ|選|days?|hours?|mins?|%|times?|pages?|steps?)/gi`) plus standalone numbers `>= 4`.
     - Reject a playbook ONLY if any such quantifier expression or number `>= 4` is missing from `corpus` (normalized NFKC) — so `"3回連続"` and `"95%"` stay 100% blocked, while rich unique Claude-written playbooks without fabricated thresholds pass cleanly!

### A2. Symmetric 4-Corner Editorial Framing on `visual_card.js` (`1200×675` PNG)
- **Observed**: Antigravity visually inspected the rendered `54,673`-byte PNG from `job_next_2e49bde6`. Typography (`NotoSansJP-Regular.otf` / `NotoSansJP-Bold.otf`) is crisp with zero tofu boxes, **but** the inner white card clipped its right/bottom rounded border and left a large empty vertical gap below the two columns.
- **Fix**:
  - Give the root `1200×675` container `padding: 40`, `backgroundColor: '#F5F6F8'`, `display: 'flex'` and the inner card `width: 1120`, `height: 595`, `borderRadius: 24`, `border: '1.5px solid #E2E8F0'`, `padding: 44`, `justifyContent: 'space-between'`.
  - Wrap the left column (`ありがちな前提`) in a soft `#F8FAFC` rounded box (`border: '1px solid #E2E8F0'`, `borderRadius: 16`, `padding: 28`, `flex: 1`) and the right column (`実務の確認基準`) in a soft `#EFF6FF` rounded box (`border: '1px solid #BFDBFE'`, `borderRadius: 16`, `padding: 28`, `flex: 1`) with `gap: 24`, and body font size `26–28px` (`lineHeight: 1.55`) so all 4 corners frame cleanly and the card looks publication-grade on X!

---

## Part B: Phase 4 — Telemetry, Two-Speed Learning & Niche Benchmarks

### B1. Non-Blocking Langfuse JP Telemetry + Firestore `generation_traces` (`src/telemetry_tracer.js`, `src/next_post_draft.js`, `src/autonomous_promo_ai.js`)
Create `src/telemetry_tracer.js` (zero new heavy SDK required — use Node 22 native `fetch` against Langfuse's stable REST ingestion API!):
1. **Langfuse JP Ingestion (`POST ${LANGFUSE_BASE_URL}/api/public/ingestion`)**:
   - Already configured & verified `200 OK` in `.env`: `LANGFUSE_BASE_URL=https://jp.cloud.langfuse.com`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`.
   - Authenticate via `Authorization: Basic ${Buffer.from(pk + ':' + sk).toString('base64')}`.
   - **Zero latency impact**: Call fire-and-forget (`.catch(warn)`) with `AbortSignal.timeout(4000)` AFTER `prepareNextPost` finishes — **never await** on the critical generation path, and skip entirely in unit tests (`NODE_ENV === 'test'` / `NODE_TEST_CONTEXT`) unless `fetchImpl` is injected!
   - Emit a single clean `batch` containing:
     - 1 `trace-create` event (`id: jobId`, `name: 'velox_next_post'`, `userId`, `metadata: { portfolioRole, slot, lang, elapsedMs, alignmentOk, focusPlaybookId, hasVisualCard }`)
     - 1 `generation-create` span per `qualityAudit` entry (`role: writer|critic`, `model`, `provider`, `latencyMs`, `cachedTokens`, `ok`, `reason`).
   - Do **NOT** send raw credentials/emails/PII to Langfuse.
2. **Firestore `generation_traces/{jobId}` & 24h Outcome Back-Fill**:
   - On `prepareNextPost` completion, store a lightweight trace summary doc in Firestore `generation_traces/{jobId}`:
     `{ jobId, userId, createdAt, portfolioRole, timeSlot, lang, elapsedMs, focusPlaybookId, alignmentOk, writerProvider, writerModel, criticProvider, criticModel, initialCriticScore, finalCriticScore, repairCount, hasVisualCard, outcome24h: null }`.
   - Inside `harvestTweetMetricsAndEvolveKnowledge` (`src/autonomous_promo_ai.js`), when a job's `metrics24hSnapshot.isFrozen === true`, merge `outcome24h: { impressions, bookmarks, bookmarkRate, likes, replies, frozenAt }` into `generation_traces/{jobId}` (best-effort `.catch(() => {})`) so Critic scores can be empirically correlated with real 24h X bookmarks!
3. **Legal Page Sync (`views/compliance_company.html`, `views/compliance_privacy.html`)**:
   - Add `Langfuse（設定時・運用品質計測）` / `Langfuse (when configured, operational quality telemetry)` in JA & EN now that Phase 4 activates Langfuse ingestion, keeping `tests/compliance_and_topnav_i18n.test.js` passing!

### B2. Playbook Alignment Verification & Clean Two-Speed Autonomous Learning (`src/editorial_lexicon_engine.js`, `src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`)
1. **Explicit Playbook Alignment Metric (`alignmentOk` / `alignmentCheck`)**:
   - Per Grok's recommendation, verify before saving a `domainSlot` job that:
     - `job.focusPlaybookId` is non-empty,
     - `job.customerReason` was built from that exact `focusPlaybookId`,
     - `job.visualCard` (when eligible) references the exact same `focusPlaybookId` (`visualCard.focusPlaybookId === focusPlaybookId`).
   - Store `alignmentOk: true|false` on the job & `generation_traces/{jobId}`.
2. **Learning Contamination Guard (Per Grok Review)**:
   - Before promoting any posted job into `domainLexicon`, `dpoPreferencePairs`, `episodic_memories`, or `MAP-Elites` (`src/autonomous_promo_ai.js`), reject posts that match `BANNED_LEGACY` or fail `runDeterministicAudit` slop/fabricated-threshold checks so old or flawed drafts never poison future generations.
3. **Two-Speed Learning & Balanced `endingMoves` Exploration (`src/editorial_lexicon_engine.js`, `src/bandit_optimization_engine.js`)**:
   - **Fast loop (2–6h early snapshots)**: In `computeDeconfoundedRewards` (`src/bandit_optimization_engine.js`), already handles early snapshots with smaller weight — verify early snapshots softly nudge `chooseGenesForPost` (`weight <= 0.35`) without mutating permanent `domainLexicon` or `dpoPreferencePairs`.
   - **Fix `endingMoves` `verdict_cut` 11/11 Skew (`src/editorial_lexicon_engine.js:153-160`)**:
     - Currently `decideEditorialPlan` sorts by `winScore` (default `1`) and ties always pick the first pool item, skewing samples heavily toward `verdict_cut`.
     - Add an exploration bonus for low-sample moves (`sampleCount === 0` gets a small deterministic rotation boost based on `recent.length`) so `condition_edge`, `concrete_check`, and `verdict_cut` rotate naturally (while keeping `genuine_tension` rare/gated so lecture questions never return).

### B3. Autonomous Niche Structural Benchmark Radar (`src/x_benchmark_radar.js`, `src/autonomous_promo_ai.js`)
Create `src/x_benchmark_radar.js`:
1. **Weekly Per-Industry Abstract Rhythm Observation (Zero Plagiarism, Zero Blocking Latency)**:
   - Keyed by normalized generic industry slug (`categorySlug` + `lang`, **never** containing customer brand names, handles, or UI labels!), stored in Firestore `collective_intelligence/niche_benchmarks_v1` (map or subcollection `categories/{slug}`, TTL **7 days**).
   - Uses `grok_client.completeText({ search: true, xSearch: true, excludedXHandles: [ownHandle], timeoutMs: 22000 })` **strictly in the background** (fire-and-forget refresh on cache miss/expiry — NEVER blocks `prepareNextPost`!).
   - Extracts **ONLY abstract craft structure** (never sentences, quotes, brand names, or numbers!):
     ```json
     {
       "categorySlug": "b2b_saas_x_ops_ja",
       "patterns": [
         {
           "hookPattern": "通説を1文で置き、2段落目で現場の例外条件を切る",
           "cadence": "1行フック + 空行 + 2文の対比 + 1行の境界条件",
           "whyBookmarked": "読者が翌日の実務チェックにそのまま使える判断境界がある"
         }
       ],
       "fetchedAt": "...",
       "expiresAt": "..."
     }
     ```
   - Scrub every extracted pattern with `BANNED_LEGACY`, `UI_BADGE`, and strip any Arabic numerals so zero borrowed numbers or spam clichés can enter.
2. **Cold-Start Warmup (`matureCount < 5`)**:
   - When `matureCount < 5` and a cached `nicheBenchmark` exists for the account's industry, pass 1 concise abstract craft hint into `editorialDirective` (`src/editorial_lexicon_engine.js`) so Day-1 URL-only customers immediately benefit from proven niche structure without waiting weeks for 24h frozen posts!

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every new/edited `.js` file (`src/lp_knowledge_extractor.js`, `src/visual_card.js`, `src/telemetry_tracer.js`, `src/x_benchmark_radar.js`, `src/editorial_lexicon_engine.js`, `src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`, `src/next_post_draft.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit
   ```
   -> Must report **0 fail / 0 skip** (`>= 382` + new Phase 4 tests).
4. New unit tests (`tests/v6_phase4_telemetry_learning_and_polish.test.js`):
   - `lp_knowledge_extractor`: allows natural qualitative Claude playbooks (even containing `"1つ"`) while still rejecting fabricated thresholds like `"3回連続"` / `"95%"`.
   - `visual_card`: renders 1200×675 PNG with symmetric framing and valid PNG header.
   - `telemetry_tracer`: builds valid Langfuse `/api/public/ingestion` Basic Auth batch payload, skips cleanly when unconfigured or in test mode without injected `fetchImpl`, never throws on HTTP error/timeout.
   - `editorial_lexicon_engine` & `autonomous_promo_ai`: `decideEditorialPlan` rotates low-sample `endingMoves` instead of sticking to `verdict_cut`; learning promotion rejects `BANNED_LEGACY` / contaminated drafts; `alignmentOk` catches mismatched `focusPlaybookId`.
   - `x_benchmark_radar`: strips brand/product words, never blocks on cache miss, rejects numeric/legacy spam patterns.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --update-env && pm2 save`) + HTTP verification (`GET /` 200, `GET /?lang=en` 200, `GET /dashboard` 302, unauthenticated `POST /api/admin/trigger-weekly-report` 401).
6. **Live Verification on `@VeloxSystemsV4` (`WEB-GOOGLE-D12E2479A76266AEA2B4`)**:
   - Force-refresh `brandKnowledge` (`https://veloxpostapp.com`) -> confirm **distinct, LLM-authored `domainPlaybooks`** (NOT identical generic offline fallback text, AND zero `"3回連続"` / `シャドウバン`).
   - Generate 1 fresh `next_post` (cancelling older pending if needed) and verify:
     - Elapsed time (`~35–50s`), `alignmentOk: true`, `generation_traces/{jobId}` written in Firestore, and 1 live Langfuse JP ingestion HTTP `207`/`200` confirmation!
     - Re-render the upgraded symmetric 1200×675 PNG card and report byte size + header check.
     - Share your final end-to-end peer review & any remaining production hardening recommendations!
