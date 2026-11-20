# VeloxPost Cloud V7-E Implementation Spec: High-Legibility X Feed Visual Cards + Suspended-Account Auto-Stop & Customer Announcement + Critic Usage Metering (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Requested directly by the founder after inspecting the live `12:34 JST` X post screenshot and `x-shop` logs.
> - **Visual Card Template Discipline**: Keep `editorial_split` as the sole template during the 7-day measurement window; this wave upgrades `editorial_split` readability (removing the double outer frame and enlarging typography so text is effortless to read on mobile & desktop X timelines).
> - **Zero-Tolerance Bilingual Rule (`AGENTS.md` §1)** & **Design Palette Harmony (`AGENTS.md` §3)**: The suspended-account dashboard banner and 1-time email notice MUST support both Japanese (`ja`) and English (`en`) cleanly (`checkIsEn()` / UI language strictly separate from `aiTargetLang`), styled in the light editorial SaaS palette (`bg-rose-50 border-rose-200 text-rose-950`, zero jarring dark blocks).
> - **Mandatory Peer-Review Note**: At completion, report all verification outputs (including inspecting the new JA/EN PNG cards and verifying `USR-MVUPC3CT-CFD4` is cleanly paused without further PM2 error spam) and share your engineering review / any remaining blind spots.

---

## Scope (3 High-Impact Deliverables)

### 1. High-Legibility `editorial_split` Visual Card Redesign (`src/visual_card.js:70-104`, `src/hybrid_saas_routes.js:2879`)
- **Problem Seen on Live X Screenshot (`@VeloxSystemsV4` `12:34 JST`)**:
  - X adds its own rounded border around attached timeline images. Because `src/visual_card.js:78-82` currently draws an outer `#F5F6F8` canvas with `padding: 36` PLUS an inner `#FFFFFF` bordered card with `padding: 36`, **144px** horizontally and vertically are lost to a "card inside a card" double frame, leaving body text (`22px`/`26px`) and footer text (`18px`) too small to read comfortably on X feeds.
- **Exact Redesign (Same `1200×675` 16:9 ratio & light editorial brand palette, dramatically easier to read)**:
  1. **Eliminate the double outer frame**:
     - Outer `1200×675` root becomes clean full-bleed `#FFFFFF` (`display: 'flex', flexDirection: 'column', width: 1200, height: 675, backgroundColor: '#FFFFFF', fontFamily: 'Noto Sans JP'`).
     - Top cobalt accent bar: `height: 10, width: '100%', backgroundColor: '#2563EB'` (crisp brand framing without eating side/bottom space).
     - Main content container: `flex: 1, padding: '26px 36px 24px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box'`.
  2. **Enlarge Typography & Contrast Hierarchy (with overflow-safe length stepping)**:
     - Badge pill: `fontSize: 20, fontWeight: 700, padding: '7px 18px', borderRadius: 999, backgroundColor: '#2563EB', color: '#FFFFFF'`.
     - Title: `fontSize: isEn ? (titleLen > 48 ? 36 : 40) : (titleLen > 24 ? 38 : 44)`, `fontWeight: 700`, `color: '#0F172A'`, `lineHeight: 1.2`, `marginTop: 14`.
     - Comparison 2-column row (`display: 'flex', gap: 22, marginTop: 20, flex: 1`):
       - **Left panel** (`Common Assumption` / `ありがちな前提`): `backgroundColor: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 18, padding: '22px 26px'`
         - Header label: `fontSize: 22, fontWeight: 700, color: '#475569'` (muted slate to contrast against the cobalt criterion on the right).
         - Body text: `fontSize: isEn ? (leftLen > 105 ? 24 : 28) : (leftLen > 62 ? 28 : 32)`, `color: '#334155'`, `lineHeight: isEn ? 1.36 : 1.44`, `marginTop: 12`.
       - **Right panel** (`Practical Check` / `実務の確認基準`): `backgroundColor: '#EFF6FF', border: '1.5px solid #93C5FD', borderRadius: 18, padding: '22px 26px'`
         - Header label: `fontSize: 22, fontWeight: 700, color: '#1D4ED8'`.
         - Body text: `fontSize: isEn ? (rightLen > 105 ? 24 : 28) : (rightLen > 62 ? 28 : 32)`, `fontWeight: 700`, `color: '#0F172A'`, `lineHeight: isEn ? 1.36 : 1.44`, `marginTop: 12`.
     - **Footer boundary check**: `borderTop: '1.5px solid #E2E8F0', paddingTop: 14, marginTop: 18`, `fontSize: isEn ? (footerLen > 105 ? 20 : 22) : (footerLen > 58 ? 21 : 24)`, `color: '#334155'`, `lineHeight: 1.36`.
  3. **Cache-Key Bust**:
     - Bump `visualCardPngCache` key in `src/hybrid_saas_routes.js:2879` with layout version `:v2` so queued job previews & homepage showcase PNGs immediately reflect the new high-legibility layout after restart.

---

### 2. Suspended-Account Complete Stop + Bilingual Dashboard Announcement + 1-Time Email Notice (`src/account_suspension_care.js` [new], wired into `src/autonomous_promo_ai.js`, `src/hybrid_saas_routes.js`, `src/official_api_client.js`, `src/twitter_auth.js`, `views/dashboard_view.html`)
- **Problem Observed**:
  - `USR-MVUPC3CT-CFD4` (`@Shahidabano19`) is suspended on X and spammed `[Self-Correction Loop Warning]` / `[Metrics Sync Error]` logs.
  - Suspension detection only lived in `harvestTweetMetricsAndEvolveKnowledge` (`src/autonomous_promo_ai.js:2158`), NOT on scheduled tweet publish failure (`src/hybrid_saas_routes.js:742`) or mention/auto-reply polling.
  - Suspended customers currently receive **zero visible announcement** in `/dashboard` and **zero email notification** telling them what happened and how to recover.
- **Exact Implementation**:
  1. **Create `src/account_suspension_care.js`**:
     - `isSuspendedXError(text)`: matches `/The user used for authentication is suspended|User has been suspended|account is suspended|permanently suspended|\bcode\s*(?:63|64)\b/i`.
     - `buildSuspendedNoticeCopy({ handle, uiLang })`: returns calm, empathetic, legally accurate `{ subject, text, bannerTitle, bannerBody, actionLabel }` in `ja` or `en` (stating X reported the account as suspended, VeloxPost Cloud automatically paused posting & cancelled auto-queued posts to stop further API attempts, and guiding the user to check X's official notice/appeal or reconnect an active X account on `/dashboard` — zero false guarantees or blame).
     - `sendSuspendedNoticeEmail({ email, handle, uiLang, sendMailImpl })`:
       - Validates basic email syntax (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) and skips non-deliverable/test placeholders (`@example.com`, `@test.local`, empty).
       - Uses existing `nodemailer` + `process.env.SMTP_HOST`, `SMTP_PORT` (`465`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (`VeloxPost Cloud <support@veloxpostapp.com>`). Fail-safe (never throws if SMTP fails or is unconfigured in tests).
     - `handleSuspendedXAccount({ db, userId, reason = '', cancelPendingJobsImpl, sendMailImpl, now = new Date() })`:
       - Reads `saas_users/{userId}` once.
       - Updates `saas_users/{userId}` (`{ merge: true }`):
         - `autopilotPaused: true`
         - `xLinkHealthStatus: 'suspended'`
         - `relinkRequired: true`
         - `xSuspendedAt: user.xSuspendedAt || now.toISOString()`
         - `xSuspendedReason: String(reason || '').slice(0, 240)`
         - `updatedAt: now`
       - Cancels non-manual pending jobs (`cancelNonManualPendingJobs(userId, 'account_suspended')`).
       - **Idempotent 1-time email**: ONLY sends email if `!user.suspendedNoticeSentAt` AND `user.email` is valid; records `suspendedNoticeSentAt: now.toISOString()` (and `suspendedNoticeEmailResult: 'sent' | 'skipped' | 'failed'`) so the customer is announced **at most once per suspension incident** (never spammed!).
  2. **Wire Everywhere X API Calls Happen (Zero Leaks)**:
     - `src/autonomous_promo_ai.js:2158` (`harvestTweetMetricsAndEvolveKnowledge`): call `handleSuspendedXAccount` whenever `isSuspendedXError(fetchError)`.
     - `src/hybrid_saas_routes.js:742` (`executeAutopilotJob` when `postOfficialTweet`/`postOfficialThread` returns `!postRes.ok`): if `isSuspendedXError(errMsg)`, call `handleSuspendedXAccount` immediately.
     - `src/hybrid_saas_routes.js` (`processInboundAutoReplies` around `L1055`): skip immediately if `data.xLinkHealthStatus === 'suspended'`; if `getOfficialMentions` returns `isSuspendedXError(...)`, call `handleSuspendedXAccount`.
     - `src/official_api_client.js:1131 & 1177` (`syncAllActiveOfficialUsersMetrics`): skip when `uData.xLinkHealthStatus === 'suspended'` (already at `L1131`), AND when `res && res.suspended` is returned on first detection, log one concise info/warn line instead of `[Metrics Sync Error]`.
     - `POST /api/autopilot/launch` & `POST /api/autopilot/toggle-pause` (`src/hybrid_saas_routes.js`): if `user.xLinkHealthStatus === 'suspended'` and user attempts to start/unpause without reconnecting a healthy X account, return `409` (`code: 'account_suspended'`) with clear bilingual (`resolveUiLang(req)`) message asking them to recover or reconnect X first.
  3. **Reset Suspension Flags Cleanly Upon Healthy OAuth Reconnect (`src/twitter_auth.js:204-235`)**:
     - When OAuth 2.0 callback succeeds with a valid X profile, include `xLinkHealthStatus: 'ok'`, `relinkRequired: false`, `xSuspendedAt: null`, `xSuspendedReason: null`, `suspendedNoticeSentAt: null` in `userUpdate` (strictly preserving V6.1 P0 rule: NEVER overwrite `targetUrl`, `aiTargetLang`, `scheduleTimeZone`, `userPrompt`, or `brandContextNotes`!).
  4. **Dashboard Bilingual Announcement Banner (`src/hybrid_saas_routes.js:3097` + `views/dashboard_view.html`)**:
     - In `GET /api/autopilot/status` (`L3104`), return:
       ```js
       {
         ok: true,
         aiMonthlyUsage: usageSummary(user),
         xLinkHealthStatus: user.xLinkHealthStatus || 'ok',
         xSuspendedAt: user.xSuspendedAt || null,
         xUsername: user.xUsername || '',
         autopilotPaused: Boolean(user.autopilotPaused)
       }
       ```
     - In `views/dashboard_view.html` (right under `{{TRIAL_PROTECTION_BANNER}}` around `L166`), add `#suspendedAccountBanner` (`style="display:none;"`, bright-editorial rose/amber alert card `mb-6 p-5 sm:p-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 shadow-xs`):
       - Shown automatically when `/api/autopilot/status` reports `xLinkHealthStatus === 'suspended'`.
       - Cleanly switches between JA and EN using `checkIsEn()` (re-rendered on language toggle as well!):
         - JA Title: `⚠️ 連携中の X アカウントの凍結を検知したため、自動運用を停止しました`
         - JA Body: `X（旧Twitter）側で @handle の凍結状態が返されたため、保護のため予約投稿・自動巡回を自動で停止し、待機中の自動予約をキャンセルしました。X 側の通知・異議申し立てをご確認いただくか、回復後または別アカウントで下の「1. X公式アカウントを連携」から再連携してください。`
         - EN Title: `⚠️ Auto-posting paused because the connected X account is suspended`
         - EN Body: `X reported @handle as suspended. To protect your workspace, VeloxPost Cloud paused scheduled posting, cancelled queued auto-posts, and stopped background syncing. Check your notice or appeal on X, then reconnect below once recovered or switch to another X account.`
         - Action button (`#btnSuspendedJumpConnect`) smoothly expands `#setupDetails` and scrolls to `#secStep1` (`X連携を再設定する` / `Reconnect X account`).

---

### 3. Accurate `criticCalls` Metering in `aiMonthlyUsage` (`src/autonomous_promo_ai.js:3114`, `src/tenant_ai_budget.js`)
- Currently `prepareNextPost` (`src/autonomous_promo_ai.js:3114`) only calls `recordTenantAiUsage({ ..., role: 'writer', count: 1 })`, leaving `aiMonthlyUsage.criticCalls` stuck at `0` even when Grok/OpenAI Critic scored candidates.
- **Fix**:
  - Add a clean helper `recordTenantLlmBreakdown({ db, userId, writerCalls = 0, criticCalls = 0, now = new Date() })` (or update `recordTenantAiUsage`) in `src/tenant_ai_budget.js` that atomically increments `writerCalls += w`, `criticCalls += c`, and `llmCalls += (w + c)` in a single Firestore transaction/write.
  - In `src/autonomous_promo_ai.js` (`prepareNextPost` around `L3114` AND `reThinkSingleJob` when LLM runs): compute `writerCalls` and `criticCalls` directly from `qualityAudit` (`role === 'writer'`, `role === 'critic'`, falling back to `writerCalls = 1` if audit empty and not degraded), and record both accurately!

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/visual_card.js`, `src/account_suspension_care.js`, `src/autonomous_promo_ai.js`, `src/hybrid_saas_routes.js`, `src/official_api_client.js`, `src/twitter_auth.js`, `src/tenant_ai_budget.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
   ```
   PLUS standalone `node --test --test-force-exit tests/post_constraint_stop_isolation.test.js` -> **0 fail / 0 skip** (`>= 410` + new V7-E unit tests).
4. New unit tests (`tests/v7e_card_legibility_and_suspension_care.test.js`):
   - `visual_card`: `cardMarkup` uses full-bleed white root (`#FFFFFF`) with top cobalt accent bar (no outer gray double-frame), enlarged body (`>= 28` EN / `>= 32` JA for normal length) and footer (`>= 22` EN / `>= 24` JA), and renders valid JA & EN PNGs (`1200×675`, valid PNG magic bytes).
   - `account_suspension_care`: `handleSuspendedXAccount` pauses autopilot, sets `xLinkHealthStatus: 'suspended'`, cancels pending jobs, sends the bilingual email notice ONCE (`suspendedNoticeSentAt` prevents duplicate emails on repeat calls), and skips invalid/placeholder emails safely.
   - `hybrid_saas_routes` & `twitter_auth`: suspended users receive `409` (`account_suspended`) when trying to launch/unpause; `/api/autopilot/status` returns `xLinkHealthStatus: 'suspended'`; healthy OAuth reconnect clears `xLinkHealthStatus: 'ok'` and `suspendedNoticeSentAt: null` without touching `targetUrl`/`aiTargetLang`/`scheduleTimeZone`.
   - `tenant_ai_budget`: `recordTenantLlmBreakdown` increments `writerCalls`, `criticCalls`, and `llmCalls = writerCalls + criticCalls` accurately across calls and resets on month rollover.
   - `views/dashboard_view.html`: `#suspendedAccountBanner` renders cleanly in both JA and EN (passing `tests/dashboard_language.test.js`).
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`) + **Live Operational Verification**:
   - Trigger `handleSuspendedXAccount` once on the already-suspended `USR-MVUPC3CT-CFD4` (confirming `xLinkHealthStatus: 'suspended'`, `autopilotPaused: true`, `suspendedNoticeSentAt` set, zero further `[Metrics Sync Error]` spam in `x-shop` logs!).
   - Verify HTTP `GET /api/funnel/sample-card.png?lang=ja` and `?lang=en` return `200` `image/png` with the new v2 high-legibility layout (confirm file size & dimensions; Antigravity will visually inspect both PNGs directly!).
   - Verify `@VeloxSystemsV4` (`17:37 JST` pending) and `@VeloxSystemsHQ` (`22:24 JST` pending with English visual card `ready`) remain intact!
   - Share your peer-review assessment and any blind spots spotted.
