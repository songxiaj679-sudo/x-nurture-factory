# VeloxPost Cloud — System Audit & Hardening Fix Spec (for Grok)

> **Before writing any code, strictly follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–4**:
> - Keep **UI language** (`uiLang`) strictly separated from **post generation language** (`aiTargetLang`), and ensure complete JA/EN parity for any customer-facing text.
> - Preserve existing passing behavior & `"initial simple UX"`.
> - Run all verification steps (`node --check`, `vm.Script`, `node --test --test-force-exit`, PM2 restart/health checks) before reporting done.

---

## Scope & Prioritized Issues Found in Live Audit

### 1. [Critical / Security] Close Unauthenticated Admin Email Endpoint & Legacy Auth/Webhook Gaps (`src/shop.js`)
1. **`POST /api/admin/trigger-weekly-report` (`src/shop.js:3100-3120`)**:
   - Currently has **zero authentication**, can trigger bulk `sendWeeklyRoiEmail(...)` calls across all `saas_users`, and returns every user's `email` in `results`.
   - **Fix**:
     - Protect with `requireAdminAuth` middleware (`app.post('/api/admin/trigger-weekly-report', requireAdminAuth, ...)`).
     - Redact raw email addresses from logs/responses if not needed, or return masked/summary counts only when unmasked output isn't required.
2. **Legacy Signatureless Webhooks (`/webhook/oxapay` at `src/shop.js:4047-4059`, `/webhook/kyc` at `src/shop.js:2528-2545`)**:
   - Currently accept spoofed JSON POSTs with no cryptographic HMAC verification, allowing unauthenticated order completion (`completeSaaSOrder` -> `saas_contracts` / `provisionTenantDedicatedVm`) and arbitrary `kycStatus: 'verified'` updates.
   - **Fix (Fail-Closed)**:
     - Read webhook secrets from `process.env` / `sysConfig` (`OXAPAY_MERCHANT_API_KEY` / HMAC header `hmac`, `DIDIT_WEBHOOK_SECRET` / `x-signature`).
     - If the corresponding secret is unset OR HMAC verification fails (using raw request body + timing-safe comparison `crypto.timingSafeEqual`), return `401` / `403` and **never** mutate Firestore or call `completeSaaSOrder()`.
     - Note: Capture raw body cleanly for those routes (same pattern as Stripe `verify` hook at `src/shop.js:55-62`) without altering Stripe `/api/webhooks/stripe` behavior.
3. **Admin Auth Localhost Bypass & Default Voucher (`src/shop.js:363-375`, `L3645`)**:
   - In `requireAdminAuth` (`src/shop.js:363-375`), do **not** trust spoofable `req.headers.host.startsWith('localhost')`. If keeping a loopback bypass at all, require BOTH loopback peer socket (`['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)`) AND absence of proxy forwarding headers (`!req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for']`).
   - In `redeemVoucherCodeIfValid` (`src/shop.js:3645`), remove `if (clean === ADMIN_PASS.toUpperCase()) return true;` so the admin password cannot be used as an infinite free subscription coupon.
   - Clean up or remove the dead shadowed `app.get('/contract', ...)` handler at `src/shop.js:3125` (shadowed by line `2938`).

---

### 2. [High / Live Post Safety] Enforce Pre-Publish `runDeterministicAudit` Gate & Fix Noisy Page Hypotheses (`src/hybrid_saas_routes.js`, `src/bandit_optimization_engine.js`, `src/draft_verifier.js`)
1. **Enforce `runDeterministicAudit` before publishing stored `next_post` drafts (`src/hybrid_saas_routes.js:525-561`)**:
   - Currently `executeAutopilotJob` only checks URLs, `assertPostThreadUnambiguous`, `assertEnglishPost`, and `inspectPostCompliance` for stored `next_post` jobs (`!scheduledContent.isJit`), bypassing `runDeterministicAudit` (`src/draft_verifier.js:103-148`). As a result, pre-deploy broken drafts (such as `job_next_d53011e5-fb35-4c6f-9681-d8e9ae64129a` with `"The rule is input the URL."` / `BROKEN_EN`) would still post live.
   - **Fix**:
     - When `!job.isHumanOverride` in `executeAutopilotJob`, run `runDeterministicAudit({ tweets: postTexts }, auditContext)` before posting to X (`auditContext` should include `lang: isEn ? 'en' : 'ja'`, `ngTopics: userDoc.data().ngTopics`, `brandKnowledge: userDoc.data().brandKnowledge`, `userPrompt: userDoc.data().userPrompt`, `brandContextNotes: userDoc.data().brandContextNotes`, `accountState` derived from `job.accountStateSnapshot` or `describeAccountState({ ok: false }, userDoc.data())`, `portfolioPlan: { allowPromoUrl: Boolean(job.allowPromoUrl || isPromotion) }`, `timeSlot: job.timeSlot`).
     - Wait carefully for `similarity` (`too_similar_to_recent` / `hook_too_similar`): for stored already-generated `next_post` drafts (`!scheduledContent.isJit && !options.forceJit`), pass `recentTexts: []` or skip duplicate check if needed so the draft's own pre-check doesn't self-collide, while strictly enforcing **`too_short`**, **`ai_slop` (`BROKEN_EN` / `SLOP`)**, **`shape_mismatch`**, **`japanese_in_english`**, **`ungrounded_number`**, **`ng_topic`**, and **`compliance:*`**.
     - If `!audit.ok`, do **not** post to X: mark the job `status: 'failed'` (e.g., `error: 'pre_publish_audit_failed:' + audit.reasons.join(',')`) and return `{ ok: false, error: ... }`.
2. **Stop Footer Legal Text & UI Card Text from Entering `pageHypotheses` / `customerReason` (`src/bandit_optimization_engine.js:248-295`)**:
   - Even after `PID 2372779`, landing-page chrome leaked into `job_next_86601d65...` (`hypothesisWho: "「あなたの声」と信用段階の設計 今の自己紹介と固定ポストを見て、誰向けか・何を出すか・導線の助言を出します"`, `hypothesisWhy: "解約・更新条件の詳細は特定商取引法に基づく表記をご確認ください"`).
   - **Fix**:
     - Expand `isPageDisclaimer` (`src/bandit_optimization_engine.js:248`) to filter out footer legal/policy notices (`/特定商取引法|フッター|法務ページ|解約・更新条件|データの取り扱い|提供条件|プライバシーポリシー|privacy policy|legal notice/i`).
     - Expand `isPricingOrNavNoise` / `namesAReader` (`src/bandit_optimization_engine.js:267-270`) so UI meta/feature copy mentioning `"誰向けか"` or step-card titles (`「あなたの声」と信用段階の設計`, `Webサイトの精密読解と事実検証`) are NOT matched as target readers (`who`) or time-limited offer conditions (`why`).
     - Keep all existing tests in `tests/bandit_optimization_engine.test.js` (`L126-189`) passing.
3. **Catch Paraphrased AI Slop (`src/draft_verifier.js:8`)**:
   - Extend `SLOP` in `src/draft_verifier.js` to reject close variations such as `を支える核心|が核心です|これが核心` without falsely rejecting normal product explanations.

---

### 3. [High / Scheduler Spin & PM2 Ops] Stop Paused-User 60s Spin-Loop & Clean Up Rogue `init_profiles` (`src/hybrid_saas_routes.js`, `src/autonomous_promo_ai.js`, PM2)
1. **Prevent Paused/Suspended Overdue Jobs From Spinning Every 60 Seconds (`src/hybrid_saas_routes.js:400-404`, `src/autonomous_promo_ai.js:2118-2127`)**:
   - Currently `executeAutopilotJob` resets paused users' due jobs back to `{ status: 'pending', error: 'paused' }` (`L402`), causing `startAutopilotJobRunner` (`L1193-1239`) to re-claim and skip `job_next_38c41b3c...` (`USR-MVUPC3CT-CFD4`, 545m overdue) every 60 seconds forever.
   - **Fix (Preserving `tests/autopilot_worker_capacity.test.js`)**:
     - Keep `job.isHumanOverride` consent checks (`L412-415`, `L568-573`) compatible with `tests/autopilot_worker_capacity.test.js:167-170` (`error: 'consent_required'` / `'paused_or_consent_changed'`).
     - In `executeAutopilotJob` at `L400-404` (`autopilotPaused && !options.force`): when `!job.isHumanOverride`, update the overdue AI job to `status: 'cancelled'` (`error: 'paused'`, `cancelReason: 'autopilot_paused'`) instead of leaving it `'pending'`.
     - When auto-pausing suspended accounts (`src/autonomous_promo_ai.js:2118-2127`) or pausing via `/api/autopilot/toggle-pause` (`src/hybrid_saas_routes.js:2144-2210`), cancel existing non-manual `'pending'` jobs (`!job.isHumanOverride`) cleanly so suspended/paused accounts have zero dangling overdue `pending` jobs.
     - In live Firestore during verification/deploy cleanup: cancel `job_next_38c41b3c-6cc6-457a-93a7-bed113c9185f` (`USR-MVUPC3CT-CFD4`), and check/regenerate or cancel the two live `@VeloxSystemsHQ` / `@VeloxSystemsV4` pending jobs (`job_next_d53011e5...` and `job_next_86601d65...`) if still stale before their scheduled times (`13:40Z` / `13:27Z`).
2. **Stop PM2 `init_profiles` Infinite Exit-Restart Loop**:
   - `init_profiles` (`src/init_profiles.js`) is not in `ecosystem.config.js` and has exceeded `36,150` restarts exiting immediately (`✅ 現在、初期設定待ち(standby)のアカウントはありません。`).
   - Stop and delete `init_profiles` from PM2 (`pm2 stop init_profiles && pm2 delete init_profiles && pm2 save`) or only run on demand when needed.
   - Restart all `ecosystem.config.js` apps (`x-admin-ui`, `x-batch-engine`, `x-shop`, `x-reply-engine`) so older PIDs (`1239053`, `1279644`, `1254658`) do not keep executing stale `official_api_client.js` / `autonomous_promo_ai.js` code in memory.

---

### 4. [Medium-High / Identity & UI Language] Fix `creds.userId` Overwrite & `customerReason` Language Leak (`src/autonomous_promo_ai.js`)
1. **Preserve Numeric X `twitterId` Instead of Clobbering `creds.userId` (`src/autonomous_promo_ai.js:308`, `L559`, `L1766`)**:
   - Update all three locations (`retargetNextPendingJob` `L306-310`, `diagnoseTargetAccount` `L558-560`, `redraftPendingJob` `L1764-1768`) to match `executeAutopilotJob` (`src/hybrid_saas_routes.js:416-419`):
     ```js
     if (!creds.id && creds.userId) creds.id = creds.userId;
     const xNumeric = /^\d+$/.test(String(creds.userId || '')) ? creds.userId : (user.twitterId || '');
     creds.saasUserId = userId;
     if (xNumeric) creds.userId = xNumeric;
     ```
2. **Respect `user.uiLang` in `retargetNextPendingJob` (`src/autonomous_promo_ai.js:439`)**:
   - Resolve `uiLang = String(user.uiLang || accountState.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja'` and pass `uiLang` to `customerFacingReason(choice, uiLang)`. Do **not** fall back to `accountState.lang` ahead of `user.uiLang`.

---

### 5. [Medium / Broken Regression Tests] Restore Full Non-Emulator Test Suite to `0 fail` (`tests/post_constraints_validation.test.js`, `tests/prompt_variant_isolation.test.js`)
- Currently running `grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit` reports `353 tests: 351 pass, 2 fail`:
  1. `tests/post_constraints_validation.test.js:73`: expects `/誰に、なぜ今、どの根拠の3つだけを書く/` while line `140` of the same file AND `src/autonomous_promo_ai.js:1027` use `誰に・なぜ今・どの根拠か、この3つだけを書く。`. Reconcile line `73` with `140` (and confirm whether `prompt` intentionally omits slot matrix + past winner examples).
  2. `tests/prompt_variant_isolation.test.js:79`: fails with `AssertionError: treatment is missing episode reference unique`, contradicting `tests/post_constraints_validation.test.js:121-141` (`4. stored DPO pairs stay out of the next writing prompt`) and `src/autonomous_promo_ai.js:1027` (`過去の勝ち文は渡していないので、それを真似しない`). Reconcile this test (plus check how `tests/emulator_integration_lifecycle.test.js` and `tests/evolution_data_loop_integration.test.js` use `buildCouncilWritingPrompt`) according to the single intended design so every non-emulator test passes cleanly (`0 fail`).

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/shop.js`, `src/hybrid_saas_routes.js`, `src/bandit_optimization_engine.js`, `src/draft_verifier.js`, `src/autonomous_promo_ai.js`, and any touched test files).
2. Inline `<script>` `vm.Script` syntax check on `views/funnel_index.html` and `views/dashboard_view.html` (if HTML touched, verify both cleanly).
3. Full non-emulator test run:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit
   ```
   -> Must report **0 failures / 0 skipped**.
4. New unit tests added covering:
   - `/api/admin/trigger-weekly-report` requires admin auth (`401` without auth).
   - `/webhook/oxapay` & `/webhook/kyc` reject missing/invalid signatures (`401`/`403`) and do not complete orders or verify KYC without valid signature; `ADMIN_PASS.toUpperCase()` is rejected as a voucher code.
   - `executeAutopilotJob` rejects broken `next_post` draft (`BROKEN_EN` / `ai_slop` / `too_short`) via `runDeterministicAudit` before posting to X.
   - `executeAutopilotJob` transitions overdue non-manual (`!isHumanOverride`) `paused` jobs out of `'pending'` while preserving `tests/autopilot_worker_capacity.test.js`.
   - `extractPageHypotheses` ignores `特定商取引法` / `解約・更新条件` / `誰向けか` UI & footer chrome.
   - `retargetNextPendingJob` preserves numeric `creds.userId` and renders `customerReason` in `user.uiLang` even when `aiTargetLang !== uiLang`.
5. PM2 ops & HTTP check:
   - Delete rogue `init_profiles` from PM2 (`pm2 stop init_profiles && pm2 delete init_profiles && pm2 save`).
   - Restart ecosystem workers (`pm2 startOrRestart ecosystem.config.js --update-env && pm2 save`).
   - Verify HTTP responses after 2s warmup (`GET /` 200, `GET /?lang=en` 200, `GET /dashboard` 302, `POST /api/admin/trigger-weekly-report` 401 without auth).
