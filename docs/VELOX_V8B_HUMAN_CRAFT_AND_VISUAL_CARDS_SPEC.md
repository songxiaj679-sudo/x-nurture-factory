# VELOX AI V8-B Implementation Spec: Plain-Text X Visual Craft + Human-Value Critic + Archetype Visual Card Templates (`before_after_card` & `checklist_3step_card`) (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Synthesized by Antigravity from V8-Core live verification (`x-shop` PID `2757886`, 3 clean LP-isolated drafts, `4.6–4.7s` live `x_search`), Grok's V8-Core notes, and the founder's editorial philosophy:
>   - **Plain-Text X Typography**: Because X has no HTML/CSS formatting, human readability comes from the full craft of plain-text visual layout (`×`/`○` contrast lines, `・`/`①②③`/`1.2.3.` scannable lists, generous `\n\n` breaks, everyday word choice, and honest curiosity pull that makes the human *want* to read the next line or self-reply).
>   - **Human-Value Scoring First**: Judge drafts primarily on whether they are **genuinely clear, effortless to read, and practically valuable to a human reader** (not merely "doesn't look like AI").
> - **External Value Isolation Preserved**: On `trust_value_external` slots, BOTH post text AND visual cards draw strictly from Brain 2 (`focusTopic` Ring 1 / Ring 2) — **zero customer product names or registered-page instructions** inside external value cards!
> - **Zero-Tolerance Bilingual Rule (`AGENTS.md` §1)**: All new card labels, templates, and dashboard preview compatibility must work cleanly in both `ja` and `en`.

---

## Scope (4 Focused Deliverables)

### 1. Plain-Text X Visual Typography & Honest Curiosity Pull (`src/editorial_archetypes.js`, `src/next_post_draft.js`)
Upgrade `archetypePromptLines` (`src/editorial_archetypes.js`) and Writer guidance (`src/next_post_draft.js`) so drafts use **native plain-text X visual layout** instead of burying examples inside dense prose paragraphs:
1. **`before_after_rewrite`**:
   - Explicitly format the contrast on dedicated lines so a human eye scans it in 0.5 seconds:
     - JA: `×「...」\n○「...」` (or `× ... \n○ ...`) separated by blank lines `\n\n` before and after.
     - EN: `Before: "..."\nAfter: "..."` (or `Weak: "..."\nBetter: "..."`) separated by blank lines `\n\n`.
   - Line 1 states a crisp relatable hook/tension (honest curiosity pull — why the common phrasing fails), followed by `\n\n`, the `× / ○` visual contrast, `\n\n`, and a 1–2 line plain-language takeaway.
2. **`actionable_checklist`**:
   - Line 1 creates immediate reader relevance -> `\n\n` -> 3 crisp scannable lines (`・` or `① / ② / ③` in JA; `1. / 2. / 3.` in EN, each short enough to scan in 1 glance) -> `\n\n` -> clear 1-line boundary/takeaway.
3. **`failure_autopsy` & `live_trend_brief`**:
   - Line 1 opens an honest **curiosity/insight gap** (making the reader genuinely curious "why? / what should I do instead?" — strictly zero cheap clickbait like "衝撃！" or "続きはプロフへ！") -> `\n\n` -> crisp plain-language diagnosis -> `\n\n` -> concrete practical check (`→` or `・`) -> clean ending.
4. **Honest 2-Tweet Curiosity Pull (Thread Shape)**:
   - When `shape.thread === true` (standard non-paid 2-tweet posts): Tweet 1 presents the relatable problem / vivid `Before` / intriguing curiosity gap cleanly, and Tweet 2 (self-reply) immediately delivers the concrete `After` rewrite or 3-step solution — honest engagement pull with zero spammy bait!

---

### 2. Human-Value Reframed 4-Axis Critic + English Source Dossier Sentence Clip (`src/next_post_draft.js`, `src/source_dossier_engine.js`)
1. **Human-Value Critic Rubric (`src/next_post_draft.js`)**:
   - Keep the exact 4 JSON keys (`scrollStopHook`, `saveUtility`, `strangerClarity`, `craftAndTruth`, `score`, `weakness`) for 100% backward compatibility with `llm_router.js` and existing tests, while sharpening the scoring rubric toward **human reader value**:
     - `scrollStopHook` (0–25): Does line 1 pull a human reader to keep reading (natural curiosity / immediate personal relevance)?
     - `saveUtility` (0–25): **Substantive human value & significance** — does the reader gain a concrete, memorable insight, rewrite, or checklist worth bookmarking?
     - `strangerClarity` (0–25): **Effortless plain-text readability** (scannable visual structure with `\n\n`, `×/○` or `・`/`1.2.3.`, plain everyday wording, zero insider jargon).
     - `craftAndTruth` (0–25): Natural human cadence, honest tone, zero invented stats/claims.
   - Keep graduated V8-A thresholds (`72` pass, hard floors `strangerClarity >= 14` & `scrollStopHook >= 12`, `60–71` post-repair `criticDegraded: true`, `< 60` hard reject).
2. **Fix English Source Dossier Mid-Word Truncation (`src/source_dossier_engine.js`)**:
   - Adopting Grok's V8-Core catch: Replace raw `.slice(0, max)` with clean sentence/word-boundary clipping (`clipClean(value, max)`) so English `currentDebate`, `concreteAngles`, and `specialistInsight` never terminate mid-word!

---

### 3. Archetype-Matched High-Legibility Visual Cards (`src/visual_card.js`, `src/autonomous_promo_ai.js`, `src/hybrid_saas_routes.js`)
Build two new full-bleed white + top `10px` `#2563EB` cobalt accent bar templates (`1200×675`, Noto Sans JP OTF, zero double outer frame) alongside `editorial_split` v2:

1. **Template Selection inside `planVisualCard({ format, portfolioRole, archetype, focusTopic, focusPlaybook, brandKnowledge, isolateLpContext, lang })`**:
   - When `isolateLpContext === true` AND `focusTopic` is present (External Reader Value slots — **NO product name, NO registered-page text!**):
     - `archetype === 'before_after_rewrite'` (with `weakExample` & `strongExample`) -> **`template: 'before_after_card'`** (`eligible: true`)
       - `badge`: `isEn ? 'BEFORE / AFTER' : 'Before → After'`
       - `title`: `clipCard(focusTopic.topic, isEn ? 60 : 34)`
       - `beforeLabel`: `isEn ? 'Before — Easily Skipped' : '× 反応が止まる例'`
       - `beforeText`: `clipCard(focusTopic.weakExample, isEn ? 140 : 88)`
       - `afterLabel`: `isEn ? 'After — Clear & Bookmarkable' : '○ 伝わる書き換え'`
       - `afterText`: `clipCard(focusTopic.strongExample, isEn ? 140 : 88)`
       - `footerCheck`: `clipCard(focusTopic.whyItWorks, isEn ? 135 : 74)`
     - `archetype === 'actionable_checklist'` (with 3 `steps`) -> **`template: 'checklist_3step_card'`** (`eligible: true`)
       - `badge`: `isEn ? '3-STEP CHECK' : '3つの確認ポイント'`
       - `title`: `clipCard(focusTopic.topic, isEn ? 60 : 34)`
       - `steps`: `focusTopic.steps.slice(0, 3).map(s => clipCard(s, isEn ? 105 : 58))`
       - `footerCheck`: `clipCard(focusTopic.boundaryNote || focusTopic.readerPain, isEn ? 135 : 74)`
     - `archetype === 'failure_autopsy'` (with `commonTrap` & `practicalFix`) on visual-eligible slots -> **`template: 'editorial_split'`** using `focusTopic` (badge: `isEn ? 'PRACTICAL NOTE' : '実務メモ'` — zero product pitch!).
   - When `isolateLpContext !== true` (Product Bridge / legacy `focusPlaybook` fallback): preserve existing `editorial_split` behavior 100% unchanged!
   - **Visual-Slot Cadence Discipline**: Keep attaching visual cards on ~50–60% of posts (`before_after_rewrite`, `actionable_checklist`, or `utility_save` / `profile_asset_bridge`) while leaving `contrarian_sharp` / `live_trend_brief` text-only so we naturally preserve clean visual-vs-text comparison pairs in 24h frozen metrics!

2. **High-Legibility `satori` Layouts in `src/visual_card.js`**:
   - **`before_after_card`** (`1200×675`, full-bleed `#FFFFFF` + `10px` top `#2563EB` bar, padding `26px 36px 24px 36px`):
     - Header: cobalt badge pill (`20px`) + large title (`40–44px` bold `#0F172A`).
     - Stacked full-width horizontal blocks (easier to read at 560px X mobile width than narrow side-by-side columns!):
       - Top block (`Before`): `#FFF1F2` bg, `1.5px solid #FECDD3`, `borderRadius: 16`, padding `18px 24px`, `#BE123C` bold label (`20px`), `#334155` text (`26–30px` JA / `24–26px` EN).
       - Bottom block (`After`): `#EFF6FF` bg, `1.5px solid #93C5FD`, `borderRadius: 16`, padding `18px 24px`, `#1D4ED8` bold label (`20px`), `#0F172A` bold text (`26–30px` JA / `24–26px` EN).
     - Footer divider (`1.5px solid #E2E8F0`) + crisp `footerCheck` (`21–24px` `#334155`).
   - **`checklist_3step_card`** (`1200×675`, full-bleed `#FFFFFF` + `10px` top `#2563EB` bar, padding `26px 36px 24px 36px`):
     - Header: cobalt badge pill (`20px`) + large title (`40–44px` bold `#0F172A`).
     - 3 clean horizontal rows (`gap: 14`, `marginTop: 18`): each row is `#F8FAFC`, `1.5px solid #E2E8F0`, `borderRadius: 14`, `padding: '16px 22px'`, `display: 'flex', alignItems: 'center', gap: 18`:
       - Left numbered badge: `44×44` circle (`borderRadius: 999`, `#2563EB`, white bold `22px`: `01`, `02`, `03`).
       - Right step text: `#0F172A` bold (`26–29px` JA / `23–26px` EN, `lineHeight: 1.32`).
     - Footer divider (`1.5px solid #E2E8F0`) + crisp `footerCheck` (`21–24px` `#334155`).

3. **Dashboard Preview & Cache-Key Bust (`src/hybrid_saas_routes.js:2879`)**:
   - Bump `visualCardPngCache` key to include `:v3:${job.visualCard.template || 'editorial_split'}` so `GET /api/autopilot/jobs/:jobId/visual-card.png` renders all 3 templates cleanly.
   - Persist `visualCardTemplate: visualCard.template` on `generation_traces` and Langfuse metadata alongside `archetype` and `topicRing`!

---

### 4. Save Rendered Preview PNGs for Direct Antigravity Visual QA
During verification, render 4 sample PNGs to `/tmp/v8b_qa/` (or `scratch` path) from live `@VeloxSystemsV4` & `@VeloxSystemsHQ` Brain 2 topics (`before_after_ja.png`, `checklist_ja.png`, `before_after_en.png`, `checklist_en.png`) so Antigravity can visually inspect every single card for overflow, typography, and mobile legibility!

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/editorial_archetypes.js`, `src/next_post_draft.js`, `src/source_dossier_engine.js`, `src/visual_card.js`, `src/autonomous_promo_ai.js`, `src/hybrid_saas_routes.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
   ```
   PLUS standalone `node --test --test-force-exit tests/post_constraint_stop_isolation.test.js` -> **0 fail / 0 skip** (`>= 425` + new V8-B unit tests).
4. New unit tests (`tests/v8b_human_craft_and_visual_cards.test.js`):
   - `visual_card`: `planVisualCard` picks `before_after_card` for `before_after_rewrite` and `checklist_3step_card` for `actionable_checklist` on `isolateLpContext: true` with zero customer product name; both render valid `1200×675` PNGs in JA and EN with valid PNG magic bytes (`89504e47`).
   - `source_dossier_engine`: English clipping stops cleanly on sentence/word boundaries (no mid-word cutoff at 120 chars).
   - `editorial_archetypes`: emits explicit plain-text visual formatting guidance (`×`/`○` or `Before:`/`After:` for rewrites, numbered/bulleted steps for checklists, honest curiosity pull for threads).
   - `hybrid_saas_routes`: `visualCardPngCache` key includes template + `:v3`.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`) + HTTP verification (`/` 200, `/?lang=en` 200, `/dashboard` 302, unauthenticated card & weekly 401).
6. **Live Verification (Do NOT overwrite `job_next_1f84f876-6a5a-400d-b382-42f57ea3508b`!)**:
   - Render the 4 live Brain 2 PNGs (`before_after_ja.png`, `checklist_ja.png`, `before_after_en.png`, `checklist_en.png`) into `/home/songxiaj679/.gemini/antigravity/brain/dd48c31f-73bb-4356-a45e-3ffa9caf9a72/scratch/` and report byte sizes.
   - Run 2 offline dry-run drafts (`@VeloxSystemsV4` `before_after_rewrite` using `×/○` visual layout + `actionable_checklist` using scannable list layout) -> paste the **complete verbatim drafts** + 4-Axis Human-Value Critic scores so the founder and Antigravity can compare the leap in scannability & human value directly!
   - Share your peer-review assessment for **V8-C (Outbound High-Signal Conversation Discovery Assist — 1-Click Human Approval in Dashboard)**.
