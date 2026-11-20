# VeloxPost Cloud V6.1 — Pre-12:34 JST Urgent Hardening & Live Media Smoke Spec (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Synthesized & finalized by Antigravity from our joint V6 re-evaluation.
> - **Timing**: Must be deployed and verified **BEFORE `@VeloxSystemsV4`'s `2026-11-20T03:34:00Z` (`12:34 JST`) scheduled slot** so the first real image-attached post goes out with the clean customer-branded card, safe media upload timeouts, and zero setting-wipe risk!

---

## Scope (5 Targeted, High-Impact Fixes + Safe Live Media Verification)

### 1. [P0] Eliminate ALL Existing-User Setting Wipe Paths (`src/autonomous_strategy_architect.js`, `src/twitter_auth.js`, `src/hybrid_saas_routes.js`)
1. **`maybeAutofillStrategy(db, user)` (`src/autonomous_strategy_architect.js:40-73`)**:
   - Always load the full current `saas_users/{user.userId}` document from `db` first (if `db` is provided), merging `{ ...existingDoc, ...user }` ONLY for non-empty incoming metadata while keeping existing persisted settings (`targetUrl`, `userPrompt`, `aiTargetLang`, `scheduleTimeZone`, `targetCountry`, `strategyLockByUser`, `isHumanOverride`, `xOfficialCredentials`, `twitterId`, `voiceProfile`) authoritative!
   - **Strict No-Overwrite Guard**:
     - If `existing.strategyLockByUser === true` or `existing.isHumanOverride === true` -> return `null` immediately (never write).
     - If `existing.targetUrl` or `existing.userPrompt` is already non-empty -> NEVER overwrite `targetUrl`, `userPrompt`, `aiTargetLang`, `scheduleTimeZone`, or `targetCountry`! Only fill fields that are genuinely unset/empty on brand-new accounts.
     - Never write `targetUrl: ''` when `existing.targetUrl` is a valid URL!
   - Replace `creds.userId = user.userId` (`L47`) with `bindOfficialCreds(creds, user.userId, fullUser)` so X numeric `twitterId` is preserved when fetching profile/recent tweets.
2. **`src/twitter_auth.js:481-486`**:
   - Pass full user doc or skip calling `maybeAutofillStrategy` when `userDoc` already existed and had `targetUrl` / `aiTargetLang` / `userPrompt` set (`maybeAutofillStrategy` will also double-guard via Firestore lookup).
3. **`POST /api/autopilot/save-setup` (`src/hybrid_saas_routes.js:1744-1836`)**:
   - Never overwrite an existing `targetUrl` with `""` when `body.targetUrl === undefined` (not sent in payload) — only clear `targetUrl` if the user explicitly sends `body.targetUrl === ""` AND `body.clearTargetUrl === true` or provides a non-empty `userPrompt` explicitly replacing URL mode.
   - When `body.autonomousMode === true`, preserve `existingUser.targetUrl`, `existingUser.aiTargetLang`, and `existingUser.scheduleTimeZone` unless explicitly provided in `req.body` (never wipe a configured Japanese user into `en` / `America/New_York`!).
4. **`POST /api/autopilot/launch` (`src/hybrid_saas_routes.js:1922-1987`)**:
   - Do **not** blindly default `lang = 'ja'` (`L1926`) over an existing English account! Resolve `lang` as `req.body?.lang !== undefined ? req.body.lang : (existingUserData.aiTargetLang || 'ja')`, and preserve `existingUserData.targetUrl` if `req.body.targetUrl` is omitted.

---

### 2. [P1] Customer-Ready Visual Card Polish (`src/visual_card.js`)
1. **Remove Hardcoded `'VELOX'` Watermark (`src/visual_card.js:26`)**:
   - Derive `badge` from the customer's own brand/domain:
     - Prefer `brandKnowledge && brandKnowledge.productName` (clipped `<= 20` chars, stripped of URLs), else `book && book.topic` short category, else neutral `isEn ? 'KEY CHECK' : '実務メモ'`.
     - *(For `@VeloxSystemsV4` whose `productName` is `VELOX AI`, it naturally shows `VELOX AI`; for any customer like `Acme Corp` or `鈴木歯科クリニック`, it cleanly displays their own brand name — NEVER a `VELOX` watermark!)*
2. **Fix Double-Escaping in Satori JSX (`src/visual_card.js:56-61`)**:
   - Remove `escapeXml(...)` calls inside `cardMarkup(plan)` (Satori escapes JSX strings automatically; calling `escapeXml` prints literal `&amp;` / `&#39;` on PNGs!). Keep `escapeXml` ONLY in `renderGroundedCard` raw SVG helper.
3. **Symmetric 4-Corner Framing, 2-Line Footer & EN Font Sizing (`src/visual_card.js:62-90`)**:
   - Ensure the outer `1200×675` container (`padding: 36`, `boxSizing: 'border-box'`) and inner white card (`width: '100%'`, `height: '100%'`, `borderRadius: 24`, `border: '1.5px solid #E2E8F0'`, `padding: 36`) show **all 4 rounded borders cleanly without right/bottom clipping**.
   - Allow `footerCheck` to wrap cleanly up to **2 lines** (`clipCard(footer, isEn ? 110 : 76)` instead of hard `.slice(0, 42)`), `fontSize: 18`, `lineHeight: 1.4`.
   - Use responsive sizing for English vs Japanese so Latin text never overflows columns (`title`: `isEn ? 30 : 36`, body: `isEn ? 22 : 26`, `lineHeight: isEn ? 1.45 : 1.55`).
4. **Refresh `job_next_b8d0dcf4-df19-4343-8373-a45f36e6b4d2`'s stored `visualCard` object** (or re-plan its `visualCard` field cleanly from its existing `pb_3` playbook) so the `12:34 JST` post renders with the upgraded card!

---

### 3. [P1] Add Hard Timeouts & Error Safety to `uploadOfficialMedia` (`src/official_api_client.js:409-445`)
- Add `signal: AbortSignal.timeout(15000)` to EVERY `fetchImpl` call inside `uploadOfficialMedia` (`initialize`, `append`, `finalize`, `status`), wrapped in `try / catch` returning `{ ok: false, error: 'media_upload_error:' + err.message }` so a slow or hung `api.x.com` response NEVER blocks or fails the scheduled text tweet in `executeAutopilotJob`!

---

### 4. [P1] Fix English Account `outputLang` Extraction & `x_benchmark_radar` Firestore Hydration (`src/autonomous_promo_ai.js`, `src/lp_knowledge_extractor.js`, `src/x_benchmark_radar.js`)
1. **Pass `outputLang: accountState.lang` at all 3 `extractBrandKnowledge` call sites (`src/autonomous_promo_ai.js:349, 1809, 2848`)**:
   - Persist `outputLang: outputLang || 'ja'` on `brandKnowledge` (`src/lp_knowledge_extractor.js`), and require `(cached.outputLang || 'ja') === (outputLang || 'ja')` in the 7-day cache check (`L368`) so `@VeloxSystemsHQ` (EN) extracts & caches English `domainPlaybooks` cleanly instead of Japanese ones!
   - Keep Grok's 2nd-call playbook fallback ONLY when 1st call omits `domainPlaybooks` (keep `required` clean, no double cost when 1st call succeeds).
2. **Hydrate `x_benchmark_radar.js` from Firestore on Process Start**:
   - Before scheduling a background `x_search` refresh, lazily read `collective_intelligence/niche_benchmarks_v1` for `slug` once per process so PM2 restarts immediately reuse valid 7-day Firestore benchmarks instead of starting cold! Give background `refreshNicheBenchmark` a `35000ms` timeout (never blocks `prepareNextPost`).

---

### 5. Safe End-to-End Live Media Upload Verification (Before `12:34 JST`)
Following Grok's safe 5-step verification protocol:
1. Deploy V6.1 + `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`, confirming running `x-shop` has `X_MEDIA_WRITE_ENABLED=true`.
2. Render local PNG from `job_next_b8d0dcf4`'s updated `visualCard` (plus 1 EN test card with `&` and `'` to confirm zero `&amp;` escaping and zero Latin overflow).
3. Run **1 isolated live smoke test** using `@VeloxSystemsV4`'s OAuth 2.0 credentials (outside the `12:34 JST` job):
   - Upload PNG via `uploadOfficialMedia` (`api.x.com/2/media/upload`) -> verify `ok: true` and valid `mediaId`.
   - Post a brief verification tweet with `[mediaId]` via `postOfficialTweet` (`api.twitter.com/2/tweets`) -> verify HTTP `201` / `tweetId`.
   - **Immediately delete** that test tweet (`DELETE https://api.twitter.com/2/tweets/${tweetId}` with the same Bearer token) so `@VeloxSystemsV4`'s timeline stays clean!
   - Confirm whether `api.x.com` `mediaId` attaches seamlessly to `api.twitter.com/2/tweets`!
4. Re-check Firestore for `@VeloxSystemsV4` (`WEB-GOOGLE-D12E2479A76266AEA2B4`) confirming `targetUrl: 'https://veloxpostapp.com'`, `aiTargetLang: 'ja'`, `scheduleTimeZone: 'Asia/Tokyo'`, `xMediaWriteEnabled: true`, and `job_next_b8d0dcf4` (`03:34Z`) intact and ready!

---

## Required Verification Checklist
1. `node --check` on all edited `.js` files.
2. Inline `<script>` `vm.Script` on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator suite (`grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit`) -> **0 fail / 0 skip** (`>= 387` + new V6.1 unit tests).
4. New unit tests (`tests/v6_1_hardening_and_cards.test.js`):
   - `maybeAutofillStrategy` NEVER overwrites existing `targetUrl`, `aiTargetLang`, `scheduleTimeZone`, or `userPrompt` even when given a sparse reconnect object `{ userId, xUsername }`.
   - `save-setup` and `launch` preserve existing `targetUrl` / `aiTargetLang` (`en`) when omitted.
   - `visual_card`: customer brand name replaces hardcoded `VELOX`, `&` / `'` are NOT double-escaped as `&amp;` / `&#39;`, footer wraps >42 chars, EN & JA cards both render valid PNGs.
   - `uploadOfficialMedia`: enforces timeout (`AbortSignal.timeout`) and returns `{ ok: false }` cleanly on abort without throwing.
   - `lp_knowledge_extractor` & `x_benchmark_radar`: cache key honors `outputLang`, and `x_benchmark_radar` hydrates from Firestore without firing duplicate `x_search`.
5. Live media smoke test result (upload `mediaId` -> tweet created -> immediately deleted) + V4 Firestore integrity check + updated PNG byte size (so Antigravity can visually verify the 4-corner frame & 2-line footer!).
