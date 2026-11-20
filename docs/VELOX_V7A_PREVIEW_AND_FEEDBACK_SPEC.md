# VeloxPost Cloud V7-A Implementation Spec: Dashboard Visual Card Preview & Toggle + 24h Bookmark-to-Playbook Feedback Loop (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - **Zero-Tolerance Bilingual Rule (`AGENTS.md` §1)**: Every new button, badge, alt text, alert, and error in `views/dashboard_view.html` MUST branch cleanly on `checkIsEn()` / `isEn` (JA & EN parity, never mixing languages, never using `aiTargetLang` for UI text).
> - **Design System Harmony (`AGENTS.md` §3)**: Match the bright editorial SaaS palette (`#FFFFFF`, `#F8FAFC`, `#EFF6FF`, `#E2E8F0` borders, `#2563EB` accent). NEVER introduce dark slabs or cramped adjacency.
> - **Mandatory Peer-Review Note**: At completion, share your engineering observations & supplemental advice for **V7-B (Flagship Pinned-Post Auto-Architect + Claude-Upgraded Opt-In Reply Assist)**.

---

## Scope (3 Focused Deliverables)

### 1. Authenticated Visual Card Preview & Per-Job Toggle API (`src/hybrid_saas_routes.js`)
1. **`GET /api/autopilot/jobs/:jobId/visual-card.png`**:
   - Authenticate via `resolveSessionUser(db, req)` -> `401` if unauthenticated.
   - Fetch `autopilot_jobs/{jobId}` -> `404` if missing; verify `job.userId === sessionUser.userId || sessionUser.isAdmin` -> `403` if ownership mismatch!
   - Require `job.visualCard && job.visualCard.eligible === true` -> `404` if not eligible.
   - Render via `renderVisualCardPng(job.visualCard)` (`src/visual_card.js`) with a small bounded in-memory LRU cache (max 40 entries, key `${jobId}:${job.updatedAt?._seconds || 0}:${job.visualCard.badge}:${job.visualCard.title}`) so dashboard refreshes don't re-render PNGs repeatedly.
   - Respond with `Content-Type: image/png`, `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`.
2. **`POST /api/autopilot/jobs/:jobId/visual-card`**:
   - Authenticate via `resolveSessionUser(db, req)` -> `401`; verify ownership -> `403`; verify `job.status === 'pending'` -> `409` if already posted/processing.
   - Accept `{ enabled: boolean }` in JSON body.
   - Update `visualCard.userDisabled = !enabled` and `visualCard.reason = enabled ? (process.env.X_MEDIA_WRITE_ENABLED === 'true' ? 'ready' : 'media_write_not_enabled') : 'disabled_by_user'` (do NOT lose the card payload so toggling back ON restores the exact card cleanly!).
   - Return `{ ok: true, visualCard }`.
3. **Honor `userDisabled` at Publish Time & Track `visualCardAttached` (`src/hybrid_saas_routes.js:692-742`)**:
   - In `executeAutopilotJob` (`L692`), skip upload if `job.visualCard.userDisabled === true` (record `visualCardAttached: false`).
   - When `mediaIds.length > 0`, persist `visualCardAttached: true` on the posted `autopilot_jobs/{jobId}` doc AND merge `visualCardAttached: true` into `generation_traces/{jobId}` (best-effort `.catch(() => {})`) so 7-day telemetry directly compares **Card Attached vs. Text-Only** bookmark rates!

---

### 2. Dashboard Live Card Preview & Toggle UX (`views/dashboard_view.html`)
Inside `renderJobCard` (`views/dashboard_view.html:5128-5165`) for pending jobs:
1. When `job.visualCard && job.visualCard.eligible === true`:
   - Render a clean, compact preview block right underneath the post copy box (`bg-white border border-slate-200 rounded-xl p-3 mb-2`):
     - Header row:
       - Left badge: `🖼️ ${isEn ? 'Visual card preview (1200×675)' : '図解カードプレビュー（1200×675）'}` (or muted badge when `job.visualCard.userDisabled` is true: `${isEn ? 'Visual card disabled for this post' : 'この投稿の図解カードはオフ'}`).
       - Right 1-click toggle button calling `toggleJobVisualCard('${job.id}', ${job.visualCard.userDisabled ? 'true' : 'false'})`:
         - When active: `${isEn ? 'Remove card' : '図解を外す'}`
         - When disabled: `${isEn ? 'Attach card' : '図解を付ける'}`
     - When `!job.visualCard.userDisabled`:
       - Display `<img src="/api/autopilot/jobs/${encodeURIComponent(job.id)}/visual-card.png?v=${cardVer}" alt="${escHtml(isEn ? 'Visual card preview' : '図解カードプレビュー')}" loading="lazy" class="w-full max-w-[480px] rounded-lg border border-slate-200 shadow-2xs mt-2 block" />`.
       - If the logged-in account has `xMediaWriteEnabled === false` (exposed safely on dashboard initial state / poll payload when `X_MEDIA_WRITE_ENABLED === 'true'`), show a subtle 1-line note underneath in JA/EN:
         - JA: `※ Xを再連携すると、この図解カードが投稿時に自動添付されます。`
         - EN: `* Reconnect X once to automatically attach this visual card when posting.`
2. Implement `async function toggleJobVisualCard(jobId, enabled)` in `<script>`:
   - `POST /api/autopilot/jobs/${encodeURIComponent(jobId)}/visual-card` with `{ enabled }`, reload jobs cleanly (`loadJobs()`), and display concise JA/EN error toast/alert via `checkIsEn()` on failure.
3. Also keep **posted history cards** clean: on `posted` jobs where `job.visualCardAttached === true` (or `job.visualCard?.mediaIds?.length > 0`), display a tiny clean pill `🖼️ ${isEn ? 'With visual card' : '図解カード付'}` next to metrics so users see card-vs-text performance directly on their timeline!

---

### 3. Close the 24h Bookmark-Rate → Playbook Selection Feedback Loop (`src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`)
Per Grok's V6 re-evaluation point ("投稿後24時間の保存率を次の1本の題材選びに戻すループ"):
1. **Add `selectPlaybookByPerformance(playbooks, recentPostedJobs, options = {})` in `src/bandit_optimization_engine.js`**:
   - Input: `playbooks` (from `brandKnowledge.domainPlaybooks`), `recentPostedJobs` (with `focusPlaybookId`, `metrics24hSnapshot`, `metricsEarlySnapshot`, `postedAt`, `text`).
   - Scoring logic:
     - **Recency penalty**: strongly penalize any `playbook.id` used in the most recent 2–3 posts (so the same topic never repeats back-to-back!).
     - **24h Frozen Bookmark-Rate Reward**: for posts with `metrics24hSnapshot.isFrozen === true && post.focusPlaybookId` and `impressions > 0`, compute deconfounded bookmark+reply engagement score (`((bookmarks * 3) + (replies * 2) + likes) / impressions`) relative to account median, updating a Beta posterior `(alpha, beta)` per `focusPlaybookId` (plus soft early 2–6h weight `<= 0.35` when no 24h freeze exists yet).
     - Sample via `sampleBetaDistribution(1.5 + alpha, 1.5 + beta)` (injectable `random` for deterministic unit tests) multiplied by recency factor (`0.15` if used in last post, `0.45` if used in 2nd-last post, `1.0` otherwise).
     - Return the winning playbook object (along with `{ reason: 'explore' | 'exploit_24h', sampleCount }`).
2. **Wire into `prepareNextPost` & `retargetNextPendingJob` (`src/autonomous_promo_ai.js`)**:
   - Replace naive `selectFreshPlaybook` (text-only trigram overlap) with `selectPlaybookByPerformance(playbooks, posts)` so real 24h bookmarks actively steer which domain playbook topic gets selected next while still avoiding back-to-back repetition!
   - Keep `focusPlaybook` unified across `draftNextPostWithMeta`, `customerReason`, `visualCard`, and `alignmentOk`.

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every edited `.js` file (`src/hybrid_saas_routes.js`, `src/bandit_optimization_engine.js`, `src/autonomous_promo_ai.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator suite (including `tests/dashboard_language.test.js` & `tests/compliance_and_topnav_i18n.test.js`):
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit
   ```
   -> Must report **0 fail / 0 skip** (`>= 393` + new V7-A tests).
4. New unit tests (`tests/v7a_preview_and_playbook_bandit.test.js`):
   - `GET /api/autopilot/jobs/:jobId/visual-card.png` returns `401` unauthenticated, `403` for another user's job, and valid `image/png` (`\x89PNG`) for owner.
   - `POST /api/autopilot/jobs/:jobId/visual-card` toggles `userDisabled` without wiping card data, and `executeAutopilotJob` skips upload when `userDisabled === true`.
   - `selectPlaybookByPerformance`: prioritizes a playbook with strong 24h frozen bookmark rate over a 0-bookmark playbook, while still avoiding repeating the immediately preceding post's playbook!
   - `views/dashboard_view.html` i18n check: zero JA/EN mixing in preview block, toggle buttons, or reconnect tip.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save`) + HTTP check (`GET /` 200, `GET /?lang=en` 200, `GET /dashboard` 302, unauthenticated `GET /api/autopilot/jobs/test/visual-card.png` 401, unauthenticated `POST /api/admin/trigger-weekly-report` 401).
6. Also inspect `@VeloxSystemsHQ` (`USR-MVUA1GLP-D640`) if reconnected by the owner (or report its current EN `brandKnowledge` / `xMediaWriteEnabled` state cleanly) + share your supplemental recommendations for **V7-B (Pinned-Post Auto-Architect + Claude Reply Assist)**.
