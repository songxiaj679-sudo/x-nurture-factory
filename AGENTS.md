# VeloxPost Cloud — Coding & Localization Rules (Read Before Any Edit)

These rules apply to **every** code, template, copy, or test change by **all** agents (including Grok).

## 1. Zero-Tolerance Bilingual Rule (NEVER Mix Japanese & English)
**Rule**: Every customer-facing string added or edited MUST work cleanly in **both** Japanese (`ja`) and English (`en`) when switching language. Never merge half-translated Japanese UI with English UI or leave raw Japanese strings untranslated when `EN` is selected.

Before declaring any UI change finished:
1. **`views/dashboard_view.html`**:
   - Prefer `data-i18n="<key>"` with matching keys in **both** `I18N.ja` AND `I18N.en`.
   - For any placeholder/title/aria-label, add keys to `STATIC_ATTRIBUTE_I18N.en` (or `data-i18n-ph`).
   - For dynamically rendered HTML, `alert()`, `confirm()`, error banners, or badges in `<script>`, ALWAYS branch on `checkIsEn()` (never `user.aiTargetLang`). Keep dashboard **UI language** (`currentLang`) strictly separate from **post generation language** (`aiTargetLang` — only the generated X post body uses `aiTargetLang`).
   - For any literal Japanese text left in static HTML outside `<script>` / `#wizStep_*` (which are handled by `renderOnboardingWizard()`), ensure the exact trimmed text exists in `STATIC_TEXT_I18N.en`.
2. **`views/funnel_index.html` & `public/funnel/funnel_client.js`**:
   - Every visible label/placeholder MUST have `data-i18n` / `data-i18n-ph` AND entries in **both** `I18N_LANDING.ja` AND `I18N_LANDING.en`.
   - Dynamic JS controls (such as `#topAuthBtn`, `#topUnlockBtn`, `#topDashboardBtn`, pricing, live demo results, toasts) MUST inspect `window.currentLandingLang === 'en'`.
3. **`views/compliance_*.html`**:
   - Support JA / EN switching (`?lang=en|ja`, `velox_lang` cookie, `localStorage.getItem('velox_lang')`, plus a top-right toggle button), while explicitly preserving the legally authoritative Japanese text for Japanese commercial law (`特定商取引法`) and sole-proprietor disclosures.
4. **Server responses shown in UI (`src/shop.js`, `src/hybrid_saas_routes.js`, `src/growth_phase.js`)**:
   - Accept `uiLang` (or cookie `velox_lang`) whenever returning UI-facing status/direction text. Never assume `aiTargetLang === uiLang`.

## 2. Copy Integrity & Compliance
- Never reintroduce retired claims (`7名`, `合議制`, `凍結リスクゼロ`, `バズ保証`, `98.4%`, etc.) banned by `tests/homepage_v51_copy.test.js` and `tests/dashboard_language.test.js`.
- Keep top-page claims (`funnel_index.html`), legal pages (`compliance_*.html`), dashboard copy (`dashboard_view.html`), and X Developer Exhibit consistent with what the production code actually runs.
- Preserve `"initial simple UX"` (`#advancedSettingsDetails` stays collapsed by default; avoid duplicate action buttons across banners/headers).

## 3. Header, Visual Design Harmony & Layout Audit Rules
- **1280px Header Budget**: Never let `.flagship-nav` (`/` header) or dashboard `<header>` overflow horizontally at `1280px` width or clip `ログアウト` / `Log Out`. Avoid injecting full raw user email pills alongside multiple nav links on `<= 1280px` viewports.
- **Design System & Palette Consistency**: When adding new sections or badges to `/`, match the existing bright editorial palette (`#FFFFFF`, `#F5F6F8` (`--bg-soft`), `linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 100%)`, `1px–1.5px` `#E2E8F0` / `#BFDBFE` borders, `#0F172A` headings, `#475569` body, `#2563EB` cobalt primary CTA, and soft pastel pills). NEVER introduce jarring dark navy/black theme slabs or pitch-black hero pills that clash with neighboring light SaaS sections.
- **Section & Card Spacing (No Cramped Adjacency)**: Always verify top/bottom section breathing room (`>= 48px` visual separation between adjacent bands such as Hero, `#secOfficialExhibit`, `#secQuickStart`, and `.editorial-sec`) and avoid cramming stacked upper/lower tables/cards tightly together (`くっついて見える` layout). Antigravity MUST proactively catch and flag visual theme mismatches and tight section/card adjacency during reviews and spec authoring.

## 4. Required Verification Before Reporting Done
Always run after your final edit:
- `node --check` on every edited `.js` file
- Inline `<script>` `vm.Script` check on `views/funnel_index.html` and `views/dashboard_view.html`
- Full relevant `node --test --test-force-exit` suite (including `tests/homepage_v51_copy.test.js`, `tests/dashboard_language.test.js`, `tests/velox_polish_and_scaling.test.js`, `tests/autopilot_setup_save.test.js`, `tests/autopilot_jobs_separation.test.js`, plus new i18n guard tests)
- `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` and verify HTTP status via `curl` after 2s warmup.

## 5. Grok Handoff Spec Workflow (Permanent Rule)
- **Strict Role Division**: **Grok** performs implementation/coding tasks; **Antigravity** audits, verifies (`node --check`, `vm.Script`, `node --test`, `curl`/code inspection), and authors exact specifications for Grok. Do not skip creating/updating specs when handing coding work to Grok.
- Whenever new feature development or coding changes are requested, first inspect the actual production files and write a clear, accurate, zero-hallucination specification document under `docs/` (referencing real file paths, symbols, constraints, and required JA/EN parity + verification steps), and provide a concise prompt for handing that spec to Grok.
- Every Grok spec MUST explicitly remind Grok to follow Sections 1–4 of this `AGENTS.md` so JA/EN UI mixing never recurs.

## 6. Product Autonomy, First-Principles Architecture & Grok Peer-Review Protocol (Permanent Rules)
- **VELOX AI Complete Autonomy**: VELOX AI must autonomously make all editorial, domain research, topic selection, formatting, visual-asset, and learning decisions from minimal user input (e.g., a single website URL or short account goal). Never rely on customers manually writing ongoing hints (`brandContextNotes`) to get high-quality posts.
- **First-Principles Architectural Thinking (Antigravity)**: When diagnosing quality limits or proposing improvements, do NOT stay confined to existing code patterns. Rigorously evaluate from first principles what needs to be improved or newly built—across code architecture, algorithms, multi-model routing, data loops, and external APIs/services—and present concrete trade-offs, ROI, and phased roadmaps to both the user and Grok.
- **Mandatory Grok Peer-Review & Supplemental Opinion**: Every major architecture proposal and Grok handoff spec MUST explicitly ask Grok for its independent review, blind-spot analysis, and supplemental engineering recommendations (better APIs, edge cases, latency/cost optimizations, or alternative designs) before/alongside implementation.
- **Thorough Antigravity–Grok Discussion & Proactive Owner Action Checklist**: After completing a milestone or before starting the next wave, Antigravity and Grok MUST thoroughly re-evaluate the real live product together (bugs, UX gaps, conversion bottlenecks, growth levers) and proactively surface an explicit **"Owner Action Items"** list whenever an action requires the founder (e.g., key rotation, X Developer Portal / OAuth reconnect, pricing/copy/editorial decisions, external service sign-up).
- **Chief Commander & Orchestrator Role (Antigravity)**: Antigravity acts as the technical director and orchestrator—refining ideas, synthesizing its own audit with Grok's peer-review feedback into one clear decision, authoring authoritative specs, and giving concise, actionable directives to both Grok (engineering execution) and the owner (founder actions/timing).
