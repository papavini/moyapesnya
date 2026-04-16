# Codebase Concerns

**Analysis Date:** 2026-04-16

---

## Tech Debt

**In-memory session store — data lost on every restart:**
- Issue: All user sessions and payment records live in two `Map` objects in RAM (`sessions`, `payments`). Any `sudo systemctl restart podari-bot` wipes all in-flight conversations and unconfirmed payments.
- Files: `src/store.js:4-5`
- Impact: Users mid-flow (e.g., in `awaiting_wishes`, `awaiting_payment`, or actively `generating`) get silently reset. They restart from `/start` with no indication of what happened. Payments confirmed by Robokassa webhook after a restart will find `getPayment(invId)` returning `null` and the song will never be delivered.
- Fix approach: Replace both `Map` objects with SQLite (`better-sqlite3`) or Redis. Session keys are already namespaced as `platform:userId` — drop-in replacement. Payments table is critical for production Robokassa.

**Access codes hardcoded in source — lost on restart:**
- Issue: 20 beta-test access codes and their activation state (`userId → code` mapping) are a plain object literal in `src/access-codes.js:12-33`. They are bundled into the running process, not persisted.
- Files: `src/access-codes.js:1-68`
- Impact: A restart of `podari-bot` resets all activations — previously verified users must re-enter their code. If a code was given to one user and another enters it after restart, it will be accepted again.
- Fix approach: Write activations to a file (`access-codes.json`) on each `checkAndUseCode` call, load on startup. Or migrate to the same SQLite store as sessions.

**`invCounter` payment ID generator is in-memory:**
- Issue: `invCounter` in `src/payment/robokassa.js:55` starts at 0 on every process start. Invoice IDs are computed as `Date.now() % 1000000 + invCounter`. Collisions are possible if the bot restarts within the same second of a previous run.
- Files: `src/payment/robokassa.js:55-59`
- Impact: Two separate invoice IDs could collide, causing Robokassa to reject or misroute a payment.
- Fix approach: Use a monotonic persistent counter (SQLite sequence, or just `Date.now()` alone which gives enough entropy without `% 1000000`).

**Test/debug scripts polluting the project root:**
- Issue: 20+ throwaway investigation scripts (`test_*.mjs`, `get_*.mjs`, `scan_*.mjs`, `intercept_*.mjs`, `check_*.mjs`, `clean_and_capture.mjs`, `capture_turnstile_params.mjs`) are committed to the root of the repository.
- Files: All `*.mjs` files in project root (e.g., `test_full_flow.mjs`, `get_token_direct.mjs`, `find_passkey_endpoint.mjs`, `intercept_generate.mjs`, etc.)
- Impact: Bloats the repository, confuses contributors, and may contain credentials or hardcoded server paths. Some scripts reference live server infrastructure.
- Fix approach: Move to a `scripts/debug/` directory and add to `.gitignore`, or delete entirely.

**`do-cookie-refresh.mjs` referenced in systemd wrapper but not present in `src/`:**
- Issue: `CONTINUITY.md` mentions `/home/alexander/projects/do-cookie-refresh.mjs` as a wrapper called by `refresh-cookies.sh`. This file is not tracked in the repository — it exists only on the production server.
- Files: Referenced in `CONTINUITY.md:71` and `docs/progress.md:136`
- Impact: If the server is reprovisioned or the file is lost, the manual cookie recovery path silently breaks.
- Fix approach: Add `do-cookie-refresh.mjs` to the repository under `scripts/`.

---

## Known Bugs

**SUNO transient errors: `status=error`, `audio_url: cdn1.suno.ai/None.mp3`:**
- Symptoms: SUNO server-side failure — the clip is returned with `status=error` and a junk audio URL. Credits are consumed. `waitForClips` counts this as a terminal failure for the affected clips.
- Files: `src/suno/client.js:165-167`, `src/flow/generate.js:79-88`
- Trigger: Non-deterministic; occurs a small percentage of the time. More likely under high server load.
- Workaround: User must retry from `/start`. No automatic retry exists.
- Note: Open question in `CONTINUITY.md:110` — "Стоит ли добавить авто-ретрай при SUNO transient error?"

**Voice message STT is a stub — users are told to type:**
- Symptoms: Any voice message received while in `awaiting_wishes`, `awaiting_occasion_custom`, or `editing_lyrics` states returns "Голосовые сообщения скоро будут поддерживаются! Пока напишите текстом 📝". The feature is advertised in the UI ("надиктуйте голосом 🎙") but silently unimplemented.
- Files: `src/bots/telegram.js:546-554`
- Trigger: User sends voice message anywhere in the flow.
- Workaround: User must type instead.

**`generateByDescription` in `client.js` calls `handleSunoError` without `fills` — passkey refresh uses dummy data:**
- Symptoms: If `generateByDescription` (description mode, not custom) hits a 422 token error, it calls `handleSunoError(e)` without the `fills` parameter. `refreshPasskeyToken` receives `undefined`, which falls back to `DEFAULT_FILLS` (generic English birthday content), creating a junk song in the SUNO account.
- Files: `src/suno/client.js:83`, `src/suno/client.js:86`, `src/suno/refresh-passkey.js:29`
- Impact: Low (description mode is unused in production Telegram flow; only used in VK bot). But description mode could be reactivated.
- Fix approach: Pass the `prompt` string as a single-element fills array in `generateByDescription`.

---

## Security Considerations

**`/codes` command is accessible to all users, not just admins:**
- Risk: Any Telegram user can type `/codes` and see the full list of all 20 access codes (even unused ones) along with the Telegram user IDs of who activated each one.
- Files: `src/bots/telegram.js:573-589`
- Current mitigation: None — no admin check.
- Recommendations: Add a guard: `if (ctx.from.id !== ADMIN_TG_ID) return;`. Store the admin ID in `.env`.

**Robokassa `pass1` and `pass2` only validated for presence, not format:**
- Risk: If `.env` contains wrong/transposed passwords, signatures will silently fail. Robokassa will reject all webhook callbacks and paid users will never receive their songs. There is no startup check beyond `config.robokassa.merchantId` existing.
- Files: `src/index.js:40`, `src/payment/robokassa.js:15-37`, `src/payment/robokassa.js:45-49`
- Current mitigation: `PAYWALL_ENABLED=false` protects against this while disabled.
- Recommendations: Log a warning on startup if `PAYWALL_ENABLED=true` but any Robokassa credential is empty.

**`refreshCookie` calls `execSync('sudo systemctl restart suno-api')` — requires passwordless sudo:**
- Risk: The Node.js process running as user `alexander` must have passwordless `sudo` for `systemctl restart suno-api`. This is a permanent privilege escalation that can be abused if the bot process is ever compromised.
- Files: `src/suno/refresh-cookie.js:98`
- Current mitigation: Only `suno-api` restart is granted (presumably via `/etc/sudoers.d/`).
- Recommendations: Verify the sudoers rule is scoped to exactly `systemctl restart suno-api` and nothing broader.

**CDP port 9223 bound to `127.0.0.1` — assume not exposed:**
- Risk: If the RDP Chromium CDP port (`localhost:9223`) were exposed externally (firewall misconfiguration), anyone could execute arbitrary JavaScript in the authenticated SUNO browser session.
- Files: `src/suno/refresh-cookie.js:21`, `src/suno/refresh-passkey.js:17`
- Current mitigation: Bound to `127.0.0.1` per configuration; Cloudflare Tunnel only forwards `:8080`.
- Recommendations: Confirm with `ss -tlnp | grep 9223` that the port is not externally reachable.

---

## Performance Bottlenecks

**Serial generation queue — one 4-minute job blocks all users:**
- Problem: `src/queue.js` enforces a single global generation slot. Every user waits in a FIFO queue. With even 3 simultaneous users, the third waits ~8 minutes.
- Files: `src/queue.js:1-54`
- Cause: Intentional constraint to avoid P1_ token race conditions. With the finding that P1_ is not strictly required, this constraint may be over-cautious.
- Improvement path: Allow 2 parallel generations once confirmed the cookie is the only real auth. Or provide per-user position ETA display (currently shows `~${waitMin} мин` based on `position * 4`).

**`isUserVerified` is O(n) over all codes:**
- Problem: `isUserVerified` in `src/access-codes.js:55` calls `Object.values(CODES).includes(userId)` — a linear scan over all codes on every message received from an unverified user.
- Files: `src/access-codes.js:55-57`
- Cause: Codes stored as `{code → userId}`, but the lookup is inverted (find userId in values).
- Improvement path: Maintain a reverse `Set<userId>` that is populated at load time and updated on each activation. O(1) lookup.

**`waitForClips` polls every 5 seconds for up to 240 seconds — no exponential backoff:**
- Problem: During generation, `waitForClips` fires a `GET /api/get?ids=...` request every 5 seconds unconditionally, for up to 4 minutes per generation.
- Files: `src/suno/client.js:146-180`
- Cause: Fixed `pollIntervalSec` with no backoff. Early seconds of generation can never return `complete`, but polling starts immediately.
- Improvement path: Start polling at 30 seconds (typical minimum generation time), then poll every 5 seconds. Reduces unnecessary requests by ~6 per generation.

---

## Fragile Areas

**`refresh-passkey.js` — 300-second nuclear operation that controls the CDP browser:**
- Files: `src/suno/refresh-passkey.js:1-325`
- Why fragile: The function navigates the real user's Chromium session to `suno.com/create`, fills forms via React fiber introspection, clicks buttons, and intercepts network requests. Any SUNO UI change (React fiber key names, button text, dialog structure) silently breaks it. The 60-second CF Turnstile wait is a hardcoded heuristic.
- Safe modification: Test all changes against a live SUNO session before deploying. The `v(r)` helper (`src/suno/refresh-passkey.js:169`) makes CDP response reading invisible — add explicit error logging if `cdpEval` returns `null`.
- Test coverage: None.

**`refreshCookie` — depends on RDP Chromium always having a page open:**
- Files: `src/suno/refresh-cookie.js:41-43`
- Why fragile: `tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl)` — if the user closed all tabs in the RDP Chromium session, `tab` is `undefined` and the function throws. The Chromium watchdog (`chromium-watchdog.timer`) may not reopen tabs.
- Safe modification: Before throwing, check if tabs exist and add a descriptive error message distinguishing "no tabs" from "CDP unreachable".
- Test coverage: None.

**`telegram.js` — `_handlePaidGeneration` is a monkey-patched method on the bot instance:**
- Files: `src/bots/telegram.js:597`, `src/index.js:42`
- Why fragile: `tg._handlePaidGeneration = async (payment) => {...}` assigned outside the class, then called with `tg._handlePaidGeneration`. If grammY is upgraded and `Bot` becomes a sealed class, or if `createTelegramBot()` is refactored, this silently breaks the payment→generation pipeline.
- Safe modification: Export `handlePaidGeneration` as a named function from `telegram.js` instead of attaching it to the bot object.

**`config.js` — `AI_MODEL` defaults to `anthropic/claude-sonnet-4-5`, not the intended model:**
- Files: `src/config.js:29`
- Why fragile: The `.env`-configured model (currently `google/gemini-2.5-pro` per `CONTINUITY.md`) diverges from the hardcoded fallback `anthropic/claude-sonnet-4-5`. If the `.env` on the server is lost or corrupted, the wrong model is used silently — no startup error, and output quality degrades without any log warning.
- Safe modification: Remove the default or change it to an empty string that triggers an assertion.

**`buildPrompt` function generates a SUNO description prompt but is never called:**
- Files: `src/bots/telegram.js:113-123`
- Why fragile: The `buildPrompt` function constructs a human-readable SUNO description from 5-question answers, but the actual flow uses `generateLyrics` (AI lyrics → custom mode). `buildPrompt` is dead code. If someone adds a "quick description mode" path and calls `buildPrompt`, it generates a weak SUNO prompt rather than AI lyrics.
- Safe modification: Delete `buildPrompt` or mark it `// UNUSED`.

---

## Scaling Limits

**SUNO credits: 2040/2500 remaining (as of 2026-04-14):**
- Current capacity: ~460 credits remaining at analysis date. Each generation consumes ~10 credits (2 clips × 5 credits each). Approximately 46 more generations before hitting the limit.
- Limit: When credits reach 0, all generations return an error. No monitoring or alerting exists.
- Scaling path: Add a low-credits warning in `/ping` output and consider a `console.warn` in `ensureTokenAlive` when credits drop below a threshold.

**Single SUNO account — no failover:**
- Current capacity: One Clerk session, one cookie file, one suno-api instance on localhost:3000.
- Limit: If the Clerk session expires and auto-refresh fails (e.g., RDP Chromium is closed), the bot is fully down until a human manually logs in via the browser.
- Scaling path: Document a manual recovery runbook (partially exists in `CONTINUITY.md:129-145`). Consider periodic health checks that alert (Telegram message to admin) when credits drop or suno-api is unreachable.

---

## Dependencies at Risk

**`gcui-art/suno-api` — unofficial third-party reverse-engineered proxy:**
- Risk: This is not an official SUNO API. SUNO can change their internal API at any time (endpoints, auth headers, response schema). The project already patches `.next/chunks/669.js` to hardcode `studio-api-prod.suno.com`. Each suno-api update may break the patch.
- Impact: Entire generation pipeline goes down until the patch is reapplied.
- Migration plan: No official API exists. Monitor `gcui-art/suno-api` releases. Keep the patched URL in version control alongside the patch instructions.

**`vk-io@^4.9.0` — VK bot not used in production:**
- Risk: `vk-io` is an installed dependency for a feature (`src/bots/vk.js`) that is currently disabled (no `VK_GROUP_TOKEN` set). The VK flow is significantly simpler than Telegram (no 5-question flow, no AI lyrics, no access codes) — it is functionally mismatched.
- Impact: Dead weight in `node_modules`; if VK is reactivated without updating the flow, users get a degraded experience.
- Migration plan: Either remove `vk.js` and `vk-io` until VK is a real roadmap item, or bring it up to parity with the Telegram flow.

---

## Missing Critical Features

**No admin alerting when something breaks:**
- Problem: There is no mechanism to notify the bot owner when: cookie expires and auto-refresh fails, SUNO credits fall below a threshold, the generation queue stalls, or the process crashes and systemd restarts it.
- Blocks: Silent failures go undetected until a user complains.
- Recommended: Add a Telegram admin notification (bot sends message to hardcoded admin `chat_id`) for critical errors in `bot.catch`, `ensureTokenAlive` returning false, and `refreshCookie` throwing.

**No retry on SUNO transient error (None.mp3):**
- Problem: When SUNO returns clips with `status=error` (server-side failure), the bot reports failure to the user and consumes their credits. There is no automatic retry.
- Blocks: Users lose credits on non-deterministic SUNO failures.
- Recommended: In `runGeneration`, if `done.length === 0` and `failed.length > 0` and all failures have `audioUrl` containing `None.mp3`, automatically retry the full generation once before reporting failure.

---

## Test Coverage Gaps

**Zero automated tests across the entire codebase:**
- What is not tested: All business logic — session state machine, queue behavior, Robokassa signature verification, SUNO error classification (`isTokenError`, `isSessionError`), AI JSON parsing and fallback, `extractTitle` regex, `checkAndUseCode` logic.
- Files: Every file in `src/`
- Risk: Any refactoring or dependency update can break core flows silently. The `package.json:check` script only runs `node --check` (syntax check), not logic.
- Priority: High. At minimum: unit tests for `src/store.js`, `src/queue.js`, `src/access-codes.js`, `src/payment/robokassa.js` (`verifyResult`, `generateInvId`), and `isTokenError`/`isSessionError` in `src/suno/client.js`.

---

*Concerns audit: 2026-04-16*
