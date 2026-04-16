# Codebase Structure

**Analysis Date:** 2026-04-16

## Directory Layout

```
SUNO Бот Sales/          # Project root
├── src/                 # All application source code
│   ├── index.js         # Process entry point
│   ├── config.js        # Centralized env-var config
│   ├── store.js         # In-memory session + payment state
│   ├── queue.js         # Serial generation queue
│   ├── access-codes.js  # Beta access code gating
│   ├── bots/            # Platform bot adapters
│   │   ├── telegram.js  # Telegram bot (grammY), full wizard
│   │   └── vk.js        # VK bot (vk-io), simple flow
│   ├── flow/            # Platform-agnostic orchestration
│   │   └── generate.js  # runGeneration() entry point
│   ├── suno/            # SUNO API client + auth recovery
│   │   ├── client.js    # HTTP adapter + error recovery
│   │   ├── refresh-cookie.js   # CDP cookie capture
│   │   └── refresh-passkey.js  # CDP P1_ token capture
│   ├── ai/              # AI lyrics generation
│   │   └── client.js    # OpenRouter (Gemini/Claude) client
│   ├── payment/         # Payment integration
│   │   └── robokassa.js # Invoice URL + signature verification
│   ├── server/          # HTTP server (webhook)
│   │   └── webhook.js   # Robokassa result/success/fail endpoints
│   └── assets/          # Static binary assets
│       └── welcome.mp4  # Onboarding video sent on /start
├── emulator/            # Local development UI
│   └── index.html       # Static Telegram chat simulator
├── docs/                # Project documentation (markdown)
│   ├── architecture.md
│   ├── flow.md
│   ├── progress.md
│   └── structure.md
├── .planning/           # GSD planning workspace
│   └── codebase/        # Codebase analysis documents (this directory)
├── .claude/             # Claude project skills
├── *.mjs                # Ad-hoc debug/capture scripts (root level, ~25 files)
├── package.json
├── package-lock.json
├── CLAUDE.md            # Project instructions for Claude
├── CONTINUITY.md        # Session continuity ledger
└── README.md
```

## Directory Purposes

**`src/`:**
- Purpose: All production application code
- Contains: 14 `.js` files across 7 subdirectories
- Key files: `src/index.js` (entry), `src/config.js` (config), `src/store.js` (state)

**`src/bots/`:**
- Purpose: One file per messaging platform; each file is self-contained and handles that platform's UX completely
- Contains: Platform-specific message handlers, keyboard builders, UX copy, progress display
- Key files: `src/bots/telegram.js` (~767 lines, full wizard), `src/bots/vk.js` (~143 lines, simpler)

**`src/flow/`:**
- Purpose: Business logic that is NOT tied to any specific platform
- Contains: `src/flow/generate.js` — the single shared generation orchestrator
- Rule: Platform bots call `runGeneration()` here; they never call SUNO client directly (only for `/ping` health check)

**`src/suno/`:**
- Purpose: Everything related to interacting with the self-hosted `suno-api` service
- Contains: HTTP client, cookie recovery via CDP, P1_ token recovery via CDP
- Key files: `src/suno/client.js` (HTTP + error handling), `src/suno/refresh-cookie.js` (CDP port 9223), `src/suno/refresh-passkey.js` (CDP port 9223)

**`src/ai/`:**
- Purpose: AI text generation; isolated from SUNO so the AI model can be swapped independently
- Contains: `src/ai/client.js` — system prompt (~250 lines), `generateLyrics()`, `extractTitle()`

**`src/payment/`:**
- Purpose: Robokassa payment integration
- Contains: `src/payment/robokassa.js` — URL builder and HMAC/MD5 signature verifier

**`src/server/`:**
- Purpose: HTTP server for Robokassa webhook callbacks
- Contains: `src/server/webhook.js` — plain Node `http.createServer`, no framework

**`src/assets/`:**
- Purpose: Binary files committed to repo that bots send to users
- Contains: `welcome.mp4` (sent on `/start`); `.video_file_id` cache file written at runtime

**`emulator/`:**
- Purpose: Browser-based Telegram chat simulator for local development without real bot
- Contains: Single static `index.html` with inline CSS/JS
- Generated: No. Committed: Yes.

**Root `*.mjs` files:**
- Purpose: One-off debug/investigation scripts accumulated during development (CDP testing, passkey capture experiments)
- ~25 files: `capture_turnstile_params.mjs`, `check_p1_state.mjs`, `get_passkey.mjs`, `intercept_generate.mjs`, `test_*.mjs`, etc.
- These are NOT part of the production bot and should eventually be cleaned up
- None are imported by `src/`

## Key File Locations

**Entry Points:**
- `src/index.js`: Process entry, starts bots, optional webhook server
- `src/bots/telegram.js`: Telegram conversation logic (exported: `createTelegramBot()`)
- `src/bots/vk.js`: VK conversation logic (exported: `createVkBot()`)

**Configuration:**
- `src/config.js`: All env-var config — add new env vars here only
- `.env`: Runtime secrets (not in repo)

**Core Logic:**
- `src/flow/generate.js`: `runGeneration()` — shared generation pipeline
- `src/suno/client.js`: SUNO HTTP client, error recovery, polling
- `src/ai/client.js`: Lyrics generation with storyteller system prompt
- `src/queue.js`: Serial generation queue

**State:**
- `src/store.js`: All user session and payment state (in-memory)
- `src/access-codes.js`: Beta access code list and tracking

**Payment:**
- `src/payment/robokassa.js`: Invoice URL creation + signature verification
- `src/server/webhook.js`: HTTP endpoints for Robokassa callbacks

**Testing:**
- `emulator/index.html`: Manual browser-based flow testing (no automated tests exist)

## Naming Conventions

**Files:**
- `kebab-case.js` for all source files: `refresh-cookie.js`, `access-codes.js`, `webhook.js`
- One concept per file; no barrel index files

**Directories:**
- `lowercase/` plural noun for capability groups: `bots/`, `suno/`, `flow/`, `payment/`, `server/`, `assets/`

**Functions:**
- `camelCase` for all functions: `runGeneration`, `generateCustom`, `refreshCookie`, `checkAndUseCode`
- Factory functions prefixed with `create`: `createTelegramBot()`, `createVkBot()`
- Boolean helpers prefixed with `is`/`has`: `isUserVerified()`, `isGenerating()`, `isTokenError()`
- Event-style registrations prefixed with `on`: `onPayment(fn)`

**Variables:**
- `SCREAMING_SNAKE_CASE` for module-level constants: `PLATFORM`, `CDP_HOST`, `CDP_PORT`, `COOKIE_FILE`, `WELCOME`
- `camelCase` for local variables

**Exports:**
- Named exports only (no default exports from `src/`) except third-party library defaults
- Each file exports only what other modules need; helpers stay unexported

## Where to Add New Code

**New messaging platform (e.g., WhatsApp):**
- Create `src/bots/whatsapp.js` following the same pattern as `vk.js`
- Call `runGeneration()` from `src/flow/generate.js`
- Use `src/store.js` with a new `PLATFORM = 'wa'` constant
- Register in `src/index.js`

**New SUNO endpoint or API change:**
- Edit `src/suno/client.js` only — add a new exported function, update `normalizeClipsResponse()` if shape changes

**New AI feature or model change:**
- Edit `src/ai/client.js` — update `SYSTEM_PROMPT`, `config.ai.model`, or add a new exported function
- Do NOT add AI calls into `src/bots/` directly

**New payment provider:**
- Create `src/payment/{provider}.js` alongside `robokassa.js`
- Add a new webhook route in `src/server/webhook.js`

**New user-facing wizard step:**
- Add new state name to `src/store.js` comments
- Add handler in `src/bots/telegram.js` `bot.on('message:text')` and/or new `bot.callbackQuery()`

**New admin command:**
- Add `bot.command('name', ...)` in `src/bots/telegram.js`

**New config value:**
- Add to `src/config.js` `config` object only; read it from `config.X` everywhere else

**Utilities:**
- No `utils/` directory exists. Put helpers in the most relevant module file, or create `src/utils.js` if truly cross-cutting.

## Special Directories

**`.planning/`:**
- Purpose: GSD planning workspace — codebase analysis, phase plans
- Generated: By GSD commands
- Committed: Yes (planning artifacts are versioned)

**`.claude/`:**
- Purpose: Claude project skills and instructions
- Generated: No
- Committed: Yes

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (`npm install`)
- Committed: No

**Root `*.mjs` debug scripts:**
- Purpose: Historical CDP investigation and passkey capture experiments
- Generated: No (written by hand during debugging)
- Committed: Yes (currently), should be cleaned up

---

*Structure analysis: 2026-04-16*
