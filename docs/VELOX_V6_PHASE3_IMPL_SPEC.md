# VeloxPost Cloud V6 — Phase 3 Implementation Spec: Phase 2.5 Quality Polish + Editorial Visual Cards & X API v2 Media Upload (for Grok)

> **Follow `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 strictly**:
> - Complete autonomy from URL-only input, zero JA/EN UI mixing, zero retired claims/fabricated rules.
> - Incorporates **Grok's Phase 2 completion advice** (post-generation / publish-time card rendering, single `focusPlaybook` grounding, `X_MEDIA_WRITE_ENABLED` scope gate, Node 22 `FormData` without manual `Content-Type`, keeping `api.twitter.com` for posting/refresh) AND **4 live audit catches from Antigravity's Phase 2 verification**.
> - **Mandatory Peer-Review Note**: At completion, include your independent observations & supplemental recommendations for **Phase 4 (Langfuse JP Telemetry `https://jp.cloud.langfuse.com` + Two-Speed Autonomous Learning + Niche Structural Benchmarks)**.

---

## Part A: Phase 2.5 High-Impact Quality & Latency Fixes (Observed Live in Firestore)

Fix these 4 verified defects discovered during Antigravity's audit of `job_next_86f1d98e` and `brandKnowledge.domainPlaybooks`:

### A1. Fix Playbook Hallucination & Duplicate-Text Padding (`src/lp_knowledge_extractor.js`)
- **Observed**: In `@VeloxSystemsV4`'s Firestore right now, `pb_2` contained a hallucinated product rule (`"3回連続で編集した場合にのみ学習パラメータを一時停止"` — `"3"` bypassed grounding because `"最大3ページ"` was on the LP), and `pb_3`..`pb_7` were padded by `fallbackPlaybooks` (`L195-202`) copying the exact same 19-char `domainProblems` string into all 5 fields (`topic`, `readerSituation`, `commonMistake`, `concreteTradeoff`, `checkCriteria`).
- **Fix**:
  1. Remove identical-field stub padding in `fallbackPlaybooks` (`L195-202`): never duplicate one string across `topic`, `readerSituation`, `commonMistake`, `concreteTradeoff`, and `checkCriteria`. Only keep structured cards where `readerSituation !== checkCriteria` and `commonMistake !== checkCriteria` (or generate distinct minimal fields when offline).
  2. Strengthen the `domainPlaybooks` extraction prompt (`src/lp_knowledge_extractor.js`):
     - Require **6 to 8 distinct, practitioner-level playbooks** (using `completeWriter` / `claude-sonnet-5-5` if `ANTHROPIC_API_KEY` is set or structured extraction with adequate `max_tokens` so it doesn't stop after 2 playbooks!).
     - Explicitly forbid inventing software thresholds or unstated feature rules (e.g. `"do NOT invent specific edit counts, pause thresholds, percentages, or internal software parameters not explicitly stated on the page; describe universal qualitative decision boundaries in this domain"`).
     - Reject any playbook field containing digits (`/\d/`) that do NOT appear as an exact grounded phrase in the primary page corpus (don't let standalone `"3"` from `"最大3ページ"` justify `"3回連続"`!).

### A2. Unify Selected Playbook Between `customerReason` & Writer (`src/autonomous_promo_ai.js`, `src/next_post_draft.js`)
- **Observed**: On `job_next_86f1d98e`, `customerReason` displayed **`pb_1`** (`自社サイトの主要ページが5つ以上あり...`) while Writer wrote from **`pb_2`** (`手動編集の扱い`), causing a mismatch on the dashboard card!
- **Fix**:
  - Pick the single `focusPlaybook` ONCE in `prepareNextPost` (and `retargetNextPendingJob`) when `domainSlot` is true, pass that exact `focusPlaybook` into `draftNextPostWithMeta({ ..., focusPlaybook })`, AND build the `domainHypothesis` / `customerReason` (`uiLang` JA/EN) from that **exact same `focusPlaybook`**!
  - Inside `draftNextPostWithMeta`, honor `options.focusPlaybook` when passed instead of independently re-selecting a different playbook.

### A3. Fix `closesAsLectureQuestion` Period-Omission Bypass (`src/next_post_draft.js:372`)
- **Observed**: `job_next_86f1d98e` ended with `"直し方が癖になっていないか、その時に確かめてみませんか"` (no trailing `。` or `?`), bypassing `/(?:ますか|でしょうか|ませんか|ですか|だろうか)。\s*$/`!
- **Fix**: Change line `372` to:
  ```js
  return /[?？]\s*$/.test(last) || /(?:ますか|でしょうか|ませんか|ですか|だろうか)[。！!？?]?\s*$/.test(last);
  ```

### A4. Eliminate Dead 8s Grok Critic Timeout (`src/llm_router.js`)
- **Observed**: `grok-4.7` timed out at `8s` even at `reasoning_effort: low` on every run, wasting 8s before OpenAI `gpt-4.1` scored cleanly.
- **Fix**:
  - In `scoreWithGrok` (`src/llm_router.js`), use `keyValue('XAI_MODEL_CRITIC') || keyValue('XAI_MODEL_FAST') || 'grok-4.20-0309-non-reasoning'` (non-reasoning fast Grok model — ~1.5–3s!) without passing `reasoning_effort` when model is non-reasoning, OR allow `CRITIC_PRIMARY=openai|xai` with OpenAI `gpt-4.1` fallback if Grok Critic errors/times out at `8s`.
  - Target total end-to-end generation time: **35–48 seconds** (with zero wasted timeouts!).

---

## Part B: Phase 3 — Editorial Visual Cards & X API v2 Media Upload

### B1. Install & Bundle Clean Japanese Typography Rendering (`package.json`, `src/visual_card.js`)
- **Host Audit Note**: Antigravity verified `fc-list :lang=ja` returned **zero** installed Japanese fonts on this Linux server!
- **Fix**:
  - Install `satori`, `@resvg/resvg-js`, and `@fontsource/noto-sans-jp` (or download/bundle Noto Sans JP `.ttf`/`.otf`/`.woff` — note **Satori requires TTF, OTF, or WOFF, NOT WOFF2!** Verify exact file format inside `node_modules/@fontsource/noto-sans-jp/files/*.woff` or bundle a single regular + bold `.woff`/`.ttf` under `assets/fonts/` and verify with a real render test!).
  - **Do NOT use Puppeteer** in the publish path (avoids Chrome RAM/process contention per Grok review).
  - Upgrade `src/visual_card.js`:
    - `planVisualCard({ format, portfolioRole, focusPlaybook, brandKnowledge, lang })`:
      - Build card content strictly from the **selected `focusPlaybook`** (`topic`, `commonMistake`, `checkCriteria`, `boundaryCondition`) — NEVER raw landing-page copy, NEVER ungrounded numbers!
      - Selectively mark `eligible: true` for high-save slots (`utility_save` or `profile_asset_bridge`, ~40–50% of posts, NOT every single post so the timeline stays organic).
      - Return clean structured card spec `{ eligible, template, lang, badge, title, leftLabel, leftText, rightLabel, rightText, footerCheck, mediaIds: [], reason }` (**0ms latency during `prepareNextPost`!**).
      - Support both **JA** and **EN** labels cleanly (`ありがちな前提` / `実務の確認基準` vs `Common Assumption` / `Practical Check`).
    - `renderVisualCardPng(plan)` -> `Promise<Buffer>`:
      - Renders crisp **1200×675 PNG** via `satori` + `@resvg/resvg-js` using VELOX's bright editorial SaaS palette (`#FFFFFF` card, `#F5F6F8` background, `#0F172A` headings, `#475569` body, `#2563EB` accent pill, `#E2E8F0` borders, generous padding, zero text overflow).
      - Validates PNG signature (`\x89PNG`) and size (`< 5 * 1024 * 1024` bytes).

### B2. Safe Gated OAuth 2.0 `media.write` Scope (`src/twitter_auth.js`, `views/dashboard_view.html`)
- **`src/twitter_auth.js:32`**:
  - Keep base scope `'tweet.read tweet.write offline.access users.read'`.
  - Append `' media.write'` **ONLY when `process.env.X_MEDIA_WRITE_ENABLED === 'true'`** (prevents breaking X reconnects before Developer Portal app permissions are confirmed!).
- **`src/twitter_auth.js:191-199` (Callback Token Persistence)**:
  - Save `oauth2Scope: String(tokenData.scope || '').trim()` inside `oauth2Payload` (encrypted inside `xOfficialCredentials` and `twitterAuth`), and also persist `xMediaWriteEnabled: /\bmedia\.write\b/.test(String(tokenData.scope || ''))` on `saas_users/{uid}` (non-secret boolean flag for UI!).
- **Dashboard Non-Blocking Reconnect Tip (`views/dashboard_view.html`, JA & EN parity!)**:
  - When `process.env.X_MEDIA_WRITE_ENABLED === 'true'` and a connected user has `xMediaWriteEnabled === false`, show a subtle, compact bilingual info note inside the X connection card (following `AGENTS.md` §1 & §3, NO dark slabs, NO duplicate action buttons) telling them reconnecting X enables automatic editorial visual cards. (Keep hidden when `X_MEDIA_WRITE_ENABLED !== 'true'` or when already granted!)

### B3. X API v2 Media Upload at Publish Time (`src/official_api_client.js`, `src/hybrid_saas_routes.js`)
- **`uploadOfficialMedia(credentials, pngBuffer, options = {})` in `src/official_api_client.js`**:
  - **Strict Preconditions (Graceful Degradation)**:
    - If `!credentials || !credentials.oauth2AccessToken` (e.g., OAuth 1.0a credentials) -> return `{ ok: false, skipped: true, reason: 'oauth2_required' }`.
    - If `credentials.oauth2Scope && !/\bmedia\.write\b/.test(credentials.oauth2Scope)` -> return `{ ok: false, skipped: true, reason: 'media_write_scope_missing' }`.
    - If `!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0 || pngBuffer.length > 5 * 1024 * 1024` -> return `{ ok: false, skipped: true, reason: 'invalid_media_size' }`.
  - Refresh OAuth 2.0 token FIRST (`refreshOAuth2TokenIfNeeded(credentials, false, credentials.saasUserId)`) and wait for save before calling upload (single-process `x-shop` lock preserved).
  - Keep `https://api.twitter.com/2/tweets` untouched for posting & token refresh; call **`https://api.x.com/2/media/upload/...`** ONLY for the 3 upload steps:
    1. `POST https://api.x.com/2/media/upload/initialize` (`Authorization: Bearer <token>`, `Content-Type: application/json`, body `{ total_bytes: pngBuffer.length, media_type: 'image/png', media_category: 'tweet_image' }`) -> extract `media_id` (`data.data?.id || data.media_id_string || data.media_id`).
    2. `POST https://api.x.com/2/media/upload/${mediaId}/append` using Node 22 native `FormData`:
       ```js
       const form = new FormData();
       form.append('segment_index', '0');
       form.append('media', new Blob([pngBuffer], { type: 'image/png' }), 'card.png');
       ```
       Send with `Authorization: Bearer <token>` ONLY (**NEVER set `Content-Type` manually** so `fetch` generates the multipart boundary!).
    3. `POST https://api.x.com/2/media/upload/${mediaId}/finalize` (`Authorization: Bearer <token>`). If response contains `processing_info.state` in `['pending', 'in_progress']`, poll `GET https://api.x.com/2/media/upload?command=status&media_id=${mediaId}` briefly (at most 2 short polls <= 5s total).
  - Return `{ ok: true, mediaId: String(mediaId) }` (or `{ ok: false, status, error }` on 403/network error).
- **Publish-Time Integration (`executeAutopilotJob` in `src/hybrid_saas_routes.js`)**:
  - **Only render + upload PNG at publish time** right before `postOfficialTweet` / `postOfficialThread` when `process.env.X_MEDIA_WRITE_ENABLED === 'true'` and `job.visualCard && job.visualCard.eligible === true`!
  - If `renderVisualCardPng` or `uploadOfficialMedia` fails/skips (e.g., `403`, missing scope, timeout), log a warning, record `visualCard.reason`, and **still publish the text tweet cleanly** (NEVER block or fail a scheduled post because of an optional visual card!).
  - Save `visualCard.mediaIds` on the posted job doc when attached.
- **Note on Enabling in `.env`**: Leave `X_MEDIA_WRITE_ENABLED=false` by default until we verify with a single-PNG test after the user confirms X Developer Portal `media.write` permission and reconnects `@VeloxSystemsV4`, while ensuring the entire card rendering + upload pipeline is 100% implemented, unit-tested, and verified via local PNG render!

---

## Required Verification Checklist (Must All Pass After Final Edit)
1. `node --check` on every new/edited `.js` file (`src/lp_knowledge_extractor.js`, `src/next_post_draft.js`, `src/llm_router.js`, `src/autonomous_promo_ai.js`, `src/visual_card.js`, `src/twitter_auth.js`, `src/official_api_client.js`, `src/hybrid_saas_routes.js`, and tests).
2. Inline `<script>` `vm.Script` check on `views/dashboard_view.html` and `views/funnel_index.html`.
3. Full non-emulator test suite:
   ```bash
   grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-force-exit
   ```
   -> Must report **0 fail / 0 skip** (and pass count MUST be >= 373 + new tests!).
4. New unit tests (`tests/v6_phase3_visual_and_polish.test.js`):
   - `lp_knowledge_extractor`: rejects identical 5x stub padding and rejects ungrounded fabricated thresholds (`3回連続...一時停止`); `focusPlaybook` matches `customerReason`.
   - `next_post_draft`: `closesAsLectureQuestion` catches `"確かめてみませんか"` without trailing `。` or `?`.
   - `llm_router`: Critic uses fast non-reasoning Grok (`grok-4.20-0309-non-reasoning`) without 8s `grok-4.7` timeout waste.
   - `visual_card`: `renderVisualCardPng` produces valid Japanese & English PNG buffers (`\x89PNG`, `< 5MB`, non-empty) from `focusPlaybook` with zero missing-font errors.
   - `twitter_auth` & `official_api_client`: `media.write` scope is added ONLY when `X_MEDIA_WRITE_ENABLED === 'true'`; `uploadOfficialMedia` sends `initialize` -> `append` (FormData without manual Content-Type) -> `finalize` to `api.x.com`, skips cleanly on OAuth 1.0a or missing scope, and falls back to text-only on `403`.
5. PM2 restart (`pm2 startOrRestart ecosystem.config.js --update-env && pm2 save`) + HTTP verification (`GET /` 200, `GET /?lang=en` 200, `GET /dashboard` 302, unauthenticated `POST /api/admin/trigger-weekly-report` 401).
6. **Live Verification on `@VeloxSystemsV4` (`WEB-GOOGLE-D12E2479A76266AEA2B4`)**:
   - Force-refresh `brandKnowledge` (`https://veloxpostapp.com`) -> verify clean distinct `domainPlaybooks` (ZERO `"3回連続"` hallucination, ZERO 5x-duplicated stub cards).
   - Cancel `job_next_86f1d98e` (which contains the hallucinated `"3回連続で編集した場合のみ、学習パラメータを一時停止します"` rule and mismatched `customerReason`) and regenerate 1 fresh `next_post`:
     - Verify elapsed time (`~35–48s`, zero 8s Grok Critic abort!)
     - Verify `text` and `customerReason` are 100% aligned on the SAME playbook, with zero lecture-question endings (`確かめてみませんか`)
     - Render 1 sample PNG card from the job's `visualCard` plan to confirm clean Japanese rendering (size & PNG header OK)
     - Report supplemental observations for **Phase 4 (Langfuse JP Telemetry + Two-Speed Learning + Niche Benchmarks)**.
