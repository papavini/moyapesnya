# Architecture

**Analysis Date:** 2026-04-16

## Pattern Overview

**Overall:** Multi-platform Bot + Orchestration Layer + External Service Adapters

**Key Characteristics:**
- Single process runs both Telegram and VK bots simultaneously (or selectively via `--only=` flag)
- Shared generation pipeline — both platforms call the same `runGeneration()` function in `src/flow/generate.js`
- Shared in-memory state store — all user sessions and payments live in `src/store.js` (no database)
- Serial generation queue — one SUNO generation at a time via `src/queue.js` to prevent race conditions on auth tokens
- On-demand auth recovery — cookie/passkey refresh triggered only on error, not on timers

## Layers

**Entry Point:**
- Purpose: Process startup, bot instantiation, optional webhook server
- Location: `src/index.js`
- Contains: `main()` — reads `--only=` flag, pings SUNO, starts bot(s), registers payment hook, installs SIGINT/SIGTERM handlers
- Depends on: `src/config.js`, `src/bots/telegram.js`, `src/bots/vk.js`, `src/suno/client.js`, `src/server/webhook.js`
- Used by: systemd `podari-bot` service

**Configuration:**
- Purpose: Centralizes all env-var access; no other file reads `process.env` directly
- Location: `src/config.js`
- Contains: `config` object with sections: `telegram`, `vk`, `suno`, `ai`, `robokassa`, plus `paywallEnabled`, `songPrice`, `webhookPort`
- Depends on: `dotenv`
- Used by: every other module

**Platform Bot Layer:**
- Purpose: Telegram-specific and VK-specific UX — conversation state machine, button keyboards, message formatting, user verification
- Location: `src/bots/telegram.js`, `src/bots/vk.js`
- Contains: command handlers (`/start`, `/cancel`, `/ping`, `/codes`), callback query handlers, text message router, `handleGenerate()` local function, inline keyboard builders
- Depends on: `src/store.js`, `src/flow/generate.js`, `src/suno/client.js`, `src/ai/client.js`, `src/payment/robokassa.js`, `src/access-codes.js`, `src/queue.js`
- Used by: `src/index.js`

**Shared State:**
- Purpose: In-memory session and payment storage, platform-agnostic
- Location: `src/store.js`
- Contains: `sessions` Map (keyed `${platform}:${userId}`), `payments` Map (keyed by `invId`); exports `getSession`, `setState`, `resetSession`, `setPayment`, `getPayment`, `setPaymentStatus`, `findPaymentByUser`
- Session states: `idle`, `awaiting_code`, `awaiting_occasion`, `awaiting_genre`, `awaiting_mood`, `awaiting_voice`, `awaiting_wishes`, `confirm`, `review_lyrics`, `editing_lyrics`, `awaiting_payment`, `generating`
- Used by: `src/bots/telegram.js`, `src/bots/vk.js`, `src/server/webhook.js`

**Generation Orchestration:**
- Purpose: Platform-independent generation pipeline — checks auth, dispatches to SUNO client, polls for completion
- Location: `src/flow/generate.js`
- Contains: `runGeneration(opts)` — calls `ensureTokenAlive()`, calls `generateCustom()` or `generateByDescription()`, calls `waitForClips()`, returns `{ ok, clips }` or `{ ok: false, error }`
- Depends on: `src/suno/client.js`, `src/config.js`
- Used by: `src/bots/telegram.js` (via `enqueue()`), `src/bots/vk.js`

**Serial Queue:**
- Purpose: Ensures only one SUNO generation runs at a time; prevents P1_ token race conditions and API overload
- Location: `src/queue.js`
- Contains: `enqueue(fn)` — returns a Promise that resolves when the job completes; `getNextPosition()`, `getQueueLength()`, `isGenerating()`
- Implementation: simple in-memory FIFO, `tick()` self-schedules
- Used by: `src/bots/telegram.js` (VK bot calls `runGeneration()` directly without queuing)

**SUNO Client:**
- Purpose: HTTP adapter to the self-hosted `gcui-art/suno-api` (Next.js, `localhost:3000`)
- Location: `src/suno/client.js`
- Contains:
  - `generateByDescription(prompt)` — POST `/api/generate`
  - `generateCustom({lyrics,tags,title})` — POST `/api/custom_generate`
  - `getClips(ids)` — GET `/api/get?ids=...`
  - `waitForClips(ids, {onProgress})` — polling loop until `status=complete` or timeout
  - `ensureTokenAlive()` — pre-generation health check; triggers `refreshCookie()` only on session errors
  - `handleSunoError(e, fills)` — inline error dispatcher: 500+session → `refreshCookie()`, 422 → `refreshPasskeyToken()`
  - Both `generateCustom` and `generateByDescription` have nested try/catch with up to 3 attempts and 2 error-fix cycles
- Depends on: `undici`, `src/config.js`, lazy imports of `src/suno/refresh-cookie.js`, `src/suno/refresh-passkey.js`
- Used by: `src/flow/generate.js`, `src/bots/telegram.js` (for `/ping`), `src/index.js` (for startup ping)

**AI Client:**
- Purpose: Generates Russian lyrics + SUNO style tags via OpenRouter (Gemini / Claude)
- Location: `src/ai/client.js`
- Contains: `generateLyrics({occasion,genre,mood,voice,wishes})` — 3-attempt loop, returns `{lyrics, tags, title}`; `extractTitle()` — regex name extraction from `wishes`
- System prompt: ~250-line storyteller poet prompt with bad/good examples, song structure rules, syllable counts
- Depends on: `src/config.js`, Node built-in `fetch`
- Used by: `src/bots/telegram.js` only (on `confirm_create` and `editing_lyrics` states)

**CDP Auth Recovery:**
- Purpose: Restore expired SUNO auth by controlling RDP Chromium (port 9223) via Chrome DevTools Protocol
- Locations:
  - `src/suno/refresh-cookie.js` — `refreshCookie()`: CDP `Network.getAllCookies` → writes 5 essential cookies to `~/projects/suno_cookie.txt` → `systemctl restart suno-api`
  - `src/suno/refresh-passkey.js` — `refreshPasskeyToken(fills)`: CDP navigate `/create` → wait 60s for CF Turnstile → fill form via React fiber → intercept generate POST via `Fetch.requestPaused` → extract P1_ token → POST to `passkey-server` (`:3099`)
- Depends on: `ws`, Node built-in `http`, `child_process.execSync`
- Used by: `src/suno/client.js` (lazy import, on-demand only)

**Payment Layer:**
- Purpose: Robokassa invoice generation and webhook signature verification
- Location: `src/payment/robokassa.js`
- Contains: `createInvoiceUrl(invId, amount, description)`, `verifyResult(params)` (MD5 signature), `generateInvId(userId)`
- Location (webhook): `src/server/webhook.js` — HTTP server on `config.webhookPort` (default 8080); handles `/robokassa/result` (server-to-server), `/robokassa/success`, `/robokassa/fail`, `/health`
- Currently disabled: `PAYWALL_ENABLED=false`
- Used by: `src/bots/telegram.js`, `src/index.js`

**Access Control:**
- Purpose: Closed beta — 20 hardcoded 6-digit codes, one per Telegram user
- Location: `src/access-codes.js`
- Contains: `checkAndUseCode(code, userId)` → `'ok'|'invalid'|'used'`; `isUserVerified(userId)`; `getCodesStatus()` (admin `/codes` command)
- Storage: in-memory CODES object (resets on bot restart)
- Used by: `src/bots/telegram.js` only

## Data Flow

**Primary Flow — Telegram song generation:**

1. User sends `/start` → `src/bots/telegram.js`: checks `isUserVerified()`, shows welcome video
2. User clicks through 5-question wizard (occasion → genre → mood → voice → wishes) — each step calls `setState()` in `src/store.js`
3. On `confirm_create`: `generateLyrics()` called in `src/ai/client.js` → returns `{lyrics, tags, title}`
4. Lyrics shown to user with "Create song" / "Edit text" buttons; user edits or approves
5. On `create_song` (paywall disabled): `handleGenerate()` → `getNextPosition()` → `enqueue(async () => runGeneration(...))` in `src/queue.js`
6. `runGeneration()` in `src/flow/generate.js`:
   a. `ensureTokenAlive()` — 3x GET `/api/get_limit`; on session error triggers `refreshCookie()`
   b. `generateCustom()` in `src/suno/client.js` — POST `/api/custom_generate`; on error calls `handleSunoError()` which lazy-imports and calls `refreshCookie()` or `refreshPasskeyToken()`
   c. `waitForClips(ids)` — polls GET `/api/get?ids=...` every `pollIntervalSec` seconds until `status=complete` or `pollTimeoutSec` timeout
7. Result returned to `handleGenerate()` in telegram.js → `replyWithAudio()` sends mp3 to user

**Payment Flow (when enabled):**

1. `create_song` with paywall enabled → `createInvoiceUrl()` → Robokassa redirect URL sent to user
2. User pays → Robokassa POSTs to `src/server/webhook.js` `/robokassa/result`
3. Signature verified with `verifyResult()` → `setPaymentStatus(invId, 'paid')` → `onPaymentConfirmed(payment)` callback
4. Callback calls `bot._handlePaidGeneration(payment)` in `src/bots/telegram.js` → `runGeneration()`

**Auth Recovery Flow:**

- Cookie recovery: `ensureTokenAlive()` detects `500 + "session id"` → `refreshCookie()` → CDP `Network.getAllCookies` → writes file → `systemctl restart suno-api` → verifies restart
- Passkey recovery: `handleSunoError()` detects `422` → `refreshPasskeyToken(fills)` → CDP navigate `/create` → 60s wait → React fiber fill form → `Fetch.requestPaused` intercept → extract P1_ → POST to passkey-server

**State Management:**

- All user state lives in `src/store.js` in-memory Maps
- `key = "${platform}:${userId}"` — sessions are isolated per platform
- State is lost on bot restart — no persistence
- Session states form a linear wizard: `idle → awaiting_occasion → ... → generating → idle`

## Key Abstractions

**`runGeneration(opts)`:**
- Purpose: Platform-agnostic generation contract; both bots call this same function
- Location: `src/flow/generate.js`
- Returns `{ ok: true, clips: [...] }` or `{ ok: false, error: string }`
- The `onStatus` callback allows the caller to push progress updates to users

**`enqueue(fn)`:**
- Purpose: Wraps any async function in the serial queue
- Location: `src/queue.js`
- Only Telegram uses this; VK calls `runGeneration()` directly (no queue)

**`SunoError`:**
- Purpose: Typed error with `status` and `body` fields for error classification
- Location: `src/suno/client.js`
- Consumed by `handleSunoError()` to decide cookie vs passkey recovery

**Session State Machine:**
- Purpose: Tracks where each user is in the wizard conversation
- Location: state strings in `src/store.js` comments, transitions in `src/bots/telegram.js`
- Key states: `idle`, `awaiting_code`, `awaiting_occasion/genre/mood/voice/wishes`, `confirm`, `review_lyrics`, `editing_lyrics`, `awaiting_payment`, `generating`

## Entry Points

**Process Entry:**
- Location: `src/index.js`
- Triggers: `node src/index.js` (systemd `podari-bot` service)
- Responsibilities: Read `--only=` flag, ping SUNO, start bot(s), optionally start webhook server

**Telegram Bot:**
- Location: `createTelegramBot()` in `src/bots/telegram.js`
- Triggers: grammY long-polling
- Responsibilities: Full 5-question wizard, AI lyrics generation, queue management, audio delivery

**VK Bot:**
- Location: `createVkBot()` in `src/bots/vk.js`
- Triggers: vk-io long-polling
- Responsibilities: Simpler flow (description or custom lyrics), no AI, no queue, no paywall

**Webhook Server:**
- Location: `src/server/webhook.js`
- Triggers: Robokassa server-to-server Result URL callback
- Responsibilities: Verify payment signature, trigger `bot._handlePaidGeneration()`

**Bot Emulator:**
- Location: `emulator/index.html`
- Triggers: Manual browser open (development only)
- Responsibilities: Static HTML UI simulating Telegram chat for local testing without real bot

## Error Handling

**Strategy:** Layered catch with recovery before propagation. SUNO errors specifically classified and repaired.

**Patterns:**
- `src/suno/client.js`: nested try/catch in `generateCustom()` and `generateByDescription()` — up to 3 attempts with 2 recovery cycles (500→cookie→retry→422→passkey→retry)
- `src/flow/generate.js`: single catch around generate call — returns `{ ok: false, error }` not throws
- `src/bots/telegram.js`: catches AI errors and shows user-friendly message; catches queue errors; catches `sendAudio` failures with link fallback
- `src/ai/client.js`: 3-attempt retry loop for OpenRouter; JSON parse fallback (raw text as lyrics)
- `src/suno/refresh-cookie.js` / `refresh-passkey.js`: hard timeout guards (10s CDP, 5min passkey); logged failures bubble up
- `src/bots/telegram.js`: `bot.catch()` global handler logs all uncaught grammY errors

**User-facing errors never mention "SUNO"** — errors say "студия" (studio).

## Cross-Cutting Concerns

**Logging:** `console.log/error` with `[module]` prefix tags (e.g., `[suno]`, `[telegram]`, `[ai]`, `[cookie]`, `[passkey]`, `[webhook]`)

**Validation:** None beyond basic truthiness checks; user inputs flow through as-is to AI/SUNO

**Authentication:** Telegram: 6-digit code verification in `src/access-codes.js`. SUNO: Clerk cookie in `~/projects/suno_cookie.txt` read by `suno-api` service; P1_ JWT in `~/projects/suno_passkey.txt`

**Configuration:** All via `.env` + `dotenv`; centralized in `src/config.js`; no other module reads `process.env`

---

*Architecture analysis: 2026-04-16*
