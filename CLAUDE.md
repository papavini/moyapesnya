## Continuity Ledger (compaction-safe)
Maintain a single Continuity Ledger for this workspace in `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)`. The ledger is the canonical session briefing designed to survive context compaction; do not rely on earlier chat text unless it’s reflected in the ledger.

### How it works
- At the start of every assistant turn: read `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)`, update it to reflect the latest goal/constraints/decisions/state, then proceed with the work.
- Update `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)` again whenever any of these change: goal, constraints/assumptions, key decisions, progress state (Done/Now/Next), or important tool outcomes.
- Keep it short and stable: facts only, no transcripts. Prefer bullets. Mark uncertainty as `UNCONFIRMED` (never guess).
- If you notice missing recall or a compaction/summary event: refresh/rebuild the ledger from visible context, mark gaps `UNCONFIRMED`, ask up to 1–3 targeted questions, then continue.

### `functions.update_plan` vs the Ledger
- `functions.update_plan` is for short-term execution scaffolding while you work (a small 3–7 step plan with pending/in_progress/completed).
- `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)` is for long-running continuity across compaction (the “what/why/current state”), not a step-by-step task list.
- Keep them consistent: when the plan or state changes, update the ledger at the intent/progress level (not every micro-step).

### In replies
- Begin with a brief “Ledger Snapshot” (Goal + Now/Next + Open Questions). Print the full ledger only when it materially changes or when the user asks.

### `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)` format (keep headings)
- Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
- Done:
- Now:
- Next:
- Open questions (UNCONFIRMED if needed):
- Working set (files/ids/commands):



# Подари Песню! — Telegram-бот

## Быстрый старт
- **Репо:** [papavini/moyapesnya](https://github.com/papavini/moyapesnya)
- **Бот:** `@podaripesniu_bot`
- **Сервер:** мини ПК 192.168.0.128 (Debian 13, SSH через WSL)

## SSH
```bash
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'команда'
```

## Деплой
```bash
git add -A && git commit -m "msg" && git push origin main
# Потом на сервере:
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'cd ~/projects/moyapesnya && git pull && npm install && sudo systemctl restart podari-bot'
```

## Сервисы на мини ПК (всё systemd, Docker НЕ используется)
- `podari-bot` — Telegram бот
- `suno-api` — SUNO proxy (cookie из файла ~/projects/suno_cookie.txt)
- `passkey-server` — HTTP :3099, принимает P1_ токены
- `cloudflared` — Cloudflare Tunnel (pay.vrodnikah.ru → :8080)
- `cookie-refresh.timer` — обновление cookies каждые 25 мин
- `chromium-watchdog.timer` — проверка Chromium каждые 5 мин

## Критические знания
1. **Docker НЕ используется** — `$` в cookies ломает Docker env_file
2. **suno-api читает cookie из файла** — не из .env
3. **Passkey P1_ token живёт ~30 мин** — при 422 бот автоматически кликает Create через CDP и повторяет
4. **SUNO endpoint:** `/api/generate/v2-web/` (не v2!)
5. **SUNO модель:** `chirp-fenix` (v5.5)
6. **AI тексты:** `google/gemini-3.1-flash-lite-preview` через OpenRouter
7. **Структура песни:** [Куплет1][Припев][Куплет2][Бридж][Припев][Финал], макс 100 слов
8. **Chromium на мини ПК:** DISPLAY=:10.0, user sonar, нужен --load-extension и --remote-debugging-port=9222
9. **Robokassa:** merchant `podaripesniu`, PAYWALL_ENABLED=false (пока выключена)

## Языки и стек
- Node.js 22, grammY 1.30, undici, ws
- Next.js (suno-api)
- OpenRouter API (Gemini)
- Robokassa (подготовлена)
- Cloudflare Tunnel + DNS

## Не делать
- Не запускать в Docker
- Не обещать "всё работает, дыр нет"
- Не говорить "2 минуты" если процесс занимает часы
- Не показывать пользователям "SUNO" в ошибках
- Не деплоить без проверки

<!-- GSD:project-start source:PROJECT.md -->
## Project

**AI Poet Pipeline — Подари Песню!**

Улучшение системы генерации текстов песен для Telegram-бота «Подари Песню!». Сейчас один LLM пишет текст за один шаг — результат технически правильный, но мёртвый: банальные рифмы, нет истории, нет эмоций. Цель — построить multi-step pipeline (generate → critique → rewrite) и найти лучшую модель для русскоязычной поэзии через OpenRouter.

**Core Value:** Когда человек слышит песню — он узнаёт себя и говорит «это точно про меня». Смеётся или плачет. Хочет отправить другу.

### Constraints

- **Latency**: Максимум 2-3 мин всего pipeline — пользователи ждут уже сейчас, дольше нельзя
- **Stack**: Node.js 22 ESM, src/ai/client.js — изменения только там
- **API**: OpenRouter (не Anthropic напрямую) — все модели через один endpoint
- **Cost**: Reasoning tokens дорогие — нужно балансировать качество vs стоимость
- **Output format**: JSON `{lyrics, tags, title}` должен сохраниться — SUNO зависит от него
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ESM) — entire codebase, Node.js native modules only
- No TypeScript — plain `.js` throughout `src/`
## Runtime
- Node.js >= 20 (engines field), deployed on Node.js 22
- ESM modules (`"type": "module"` in `package.json`)
- Entry point: `src/index.js`
- npm
- Lockfile: `package-lock.json` present
## Frameworks
- `grammy` ^1.30.0 — Telegram bot framework (`src/bots/telegram.js`)
- `vk-io` ^4.9.0 — VK bot framework (`src/bots/vk.js`)
- `undici` ^6.19.8 — HTTP client used in `src/suno/client.js` (`import { fetch } from 'undici'`)
- `ws` ^8.20.0 — WebSocket client used in `src/suno/refresh-cookie.js` and `src/suno/refresh-passkey.js` for CDP connections
- Node.js built-in `http` module — used in CDP tab listing and webhook server (`src/server/webhook.js`)
- No bundler (no webpack, esbuild, vite)
- No transpiler (no Babel, TypeScript)
- `dotenv` ^16.4.5 — env loading (`import 'dotenv/config'` in `src/config.js`)
## Key Dependencies
- `grammy` ^1.30.0 — entire Telegram bot interaction surface (`Bot`, `InlineKeyboard`, `InputFile`)
- `vk-io` ^4.9.0 — VK long-polling bot (`VK`, `Keyboard`)
- `undici` ^6.19.8 — HTTP fetch for SUNO API calls (explicit import, NOT Node built-in fetch)
- `ws` ^8.20.0 — WebSocket for Chrome DevTools Protocol (CDP) connections to Chromium instances
- `dotenv` ^16.4.5 — environment variable loading from `.env` file
## Configuration
- Loaded via `dotenv/config` at `src/config.js` line 1
- All config exported as `config` object from `src/config.js`
- `.env.example` documents all required variables
| Variable | Default | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | grammY bot token |
| `VK_GROUP_TOKEN` | — | VK bot token |
| `VK_GROUP_ID` | — | VK community ID |
| `SUNO_API_BASE` | `http://localhost:3000` | Self-hosted suno-api URL |
| `SUNO_POLL_TIMEOUT_SEC` | 240 | Max seconds to poll for clip completion |
| `SUNO_POLL_INTERVAL_SEC` | 5 | Polling interval in seconds |
| `SUNO_SEND_FIRST_ONLY` | false | Send only first of two generated clips |
| `OPENROUTER_API_KEY` | — | OpenRouter API key for AI lyrics |
| `AI_MODEL` | `anthropic/claude-sonnet-4-5` | AI model ID via OpenRouter |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter base URL |
| `ROBOKASSA_MERCHANT_ID` | — | Robokassa merchant login |
| `ROBOKASSA_PASSWORD1` | — | Robokassa signature password 1 |
| `ROBOKASSA_PASSWORD2` | — | Robokassa result verification password 2 |
| `ROBOKASSA_TEST_MODE` | true | Robokassa test vs live |
| `SONG_PRICE` | 299 | Song price in RUB |
| `WEBHOOK_PORT` | 8080 | HTTP webhook server port |
| `WEBHOOK_HOST` | — | Webhook public hostname |
| `PAYWALL_ENABLED` | false | Enable/disable paywall |
- No build step — run directly with `node src/index.js`
- Start scripts in `package.json`: `start`, `start:tg`, `start:vk`, `check`
- Syntax check script: `node --check` on all main files
## Platform Requirements
- Node.js >= 20 (ideally 22 to match production)
- `.env` file populated from `.env.example`
- Debian 13, mini PC at 192.168.0.128
- systemd service `podari-bot` — runs `node src/index.js`
- Self-hosted `suno-api` (gcui-art/suno-api, Next.js) on port 3000
- Self-hosted `passkey-server` on port 3099 (stores P1_ tokens)
- Two Chromium instances for CDP:
- Cloudflare Tunnel (`cloudflared`) → `pay.vrodnikah.ru` → `:8080` (webhook)
- Cookie file: `/home/alexander/projects/suno_cookie.txt`
- Passkey file: `/home/alexander/projects/suno_passkey.txt`
## State Storage
- In-memory only (`src/store.js`) — `Map` for sessions and payments
- No database, no Redis
- All state lost on bot restart (intentional for MVP)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Language & Module System
- **ES Modules (ESM)** throughout — `"type": "module"` in `package.json`
- All files use `import`/`export`, never `require()`
- Dynamic imports used for lazy-loading heavy modules:
- All import paths include `.js` extension explicitly (ESM requirement)
## Naming Patterns
- `camelCase.js` for all source files: `client.js`, `generate.js`, `robokassa.js`
- Grouped by domain in subdirectories: `src/suno/`, `src/bots/`, `src/ai/`, `src/flow/`, `src/payment/`, `src/server/`
- `camelCase` for all functions: `generateCustom`, `waitForClips`, `handleSunoError`, `createTelegramBot`
- `createX` prefix for factory functions that return an object: `createTelegramBot()`, `createVkBot()`
- `handleX` prefix for event handlers: `handleMessage`, `handleGenerate`, `handleSunoError`
- Boolean functions use verb prefix: `isGenerating()`, `isUserVerified()`, `pingSuno()`
- Async functions that refresh/update use verb: `refreshCookie()`, `refreshPasskeyToken()`, `ensureTokenAlive()`
- `camelCase` for all variables and constants
- SCREAMING_SNAKE_CASE only for module-level constants that are truly fixed:
- Boolean env parsing uses helper: `bool(process.env.X, fallback)`
- Numeric env parsing uses helper: `num(process.env.X, fallback)` — see `src/config.js`
- PascalCase: `SunoError` extends `Error` (only one class in the codebase)
## Code Style
- No ESLint or Prettier config files — formatting is manual/editor-driven
- Semicolons: always present at statement ends
- Quotes: single quotes for strings throughout
- Trailing commas: present in multi-line objects/arrays
- Spacing: 2-space indentation universally
- Arrow functions for callbacks: `(r) => setTimeout(r, ...)`, `(e) => console.error(...)`
- No ESLint configured
- Syntax check only via `npm run check` script (uses `node --check` flag on each source file)
- No type checking (plain JavaScript, no TypeScript or JSDoc types on most functions)
## Import Organization
- None — all imports use relative paths: `'../config.js'`, `'./refresh-cookie.js'`
## Error Handling
## Logging
- Service startup and shutdown events
- External API call failures with attempt number
- State transitions in generation flow
- Cookie/token refresh lifecycle
- User actions at key decision points (confirm, generate)
- Cookie values, tokens, or user content (PII)
- Every Telegram message received (only key state changes)
## Comments
## Function Design
## Module Design
- Named exports throughout — no default exports in `src/` files
- `export function`, `export async function`, `export const`
- Single export group per file (no barrel/index files)
## Russian Language in Code
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Single process runs both Telegram and VK bots simultaneously (or selectively via `--only=` flag)
- Shared generation pipeline — both platforms call the same `runGeneration()` function in `src/flow/generate.js`
- Shared in-memory state store — all user sessions and payments live in `src/store.js` (no database)
- Serial generation queue — one SUNO generation at a time via `src/queue.js` to prevent race conditions on auth tokens
- On-demand auth recovery — cookie/passkey refresh triggered only on error, not on timers
## Layers
- Purpose: Process startup, bot instantiation, optional webhook server
- Location: `src/index.js`
- Contains: `main()` — reads `--only=` flag, pings SUNO, starts bot(s), registers payment hook, installs SIGINT/SIGTERM handlers
- Depends on: `src/config.js`, `src/bots/telegram.js`, `src/bots/vk.js`, `src/suno/client.js`, `src/server/webhook.js`
- Used by: systemd `podari-bot` service
- Purpose: Centralizes all env-var access; no other file reads `process.env` directly
- Location: `src/config.js`
- Contains: `config` object with sections: `telegram`, `vk`, `suno`, `ai`, `robokassa`, plus `paywallEnabled`, `songPrice`, `webhookPort`
- Depends on: `dotenv`
- Used by: every other module
- Purpose: Telegram-specific and VK-specific UX — conversation state machine, button keyboards, message formatting, user verification
- Location: `src/bots/telegram.js`, `src/bots/vk.js`
- Contains: command handlers (`/start`, `/cancel`, `/ping`, `/codes`), callback query handlers, text message router, `handleGenerate()` local function, inline keyboard builders
- Depends on: `src/store.js`, `src/flow/generate.js`, `src/suno/client.js`, `src/ai/client.js`, `src/payment/robokassa.js`, `src/access-codes.js`, `src/queue.js`
- Used by: `src/index.js`
- Purpose: In-memory session and payment storage, platform-agnostic
- Location: `src/store.js`
- Contains: `sessions` Map (keyed `${platform}:${userId}`), `payments` Map (keyed by `invId`); exports `getSession`, `setState`, `resetSession`, `setPayment`, `getPayment`, `setPaymentStatus`, `findPaymentByUser`
- Session states: `idle`, `awaiting_code`, `awaiting_occasion`, `awaiting_genre`, `awaiting_mood`, `awaiting_voice`, `awaiting_wishes`, `confirm`, `review_lyrics`, `editing_lyrics`, `awaiting_payment`, `generating`
- Used by: `src/bots/telegram.js`, `src/bots/vk.js`, `src/server/webhook.js`
- Purpose: Platform-independent generation pipeline — checks auth, dispatches to SUNO client, polls for completion
- Location: `src/flow/generate.js`
- Contains: `runGeneration(opts)` — calls `ensureTokenAlive()`, calls `generateCustom()` or `generateByDescription()`, calls `waitForClips()`, returns `{ ok, clips }` or `{ ok: false, error }`
- Depends on: `src/suno/client.js`, `src/config.js`
- Used by: `src/bots/telegram.js` (via `enqueue()`), `src/bots/vk.js`
- Purpose: Ensures only one SUNO generation runs at a time; prevents P1_ token race conditions and API overload
- Location: `src/queue.js`
- Contains: `enqueue(fn)` — returns a Promise that resolves when the job completes; `getNextPosition()`, `getQueueLength()`, `isGenerating()`
- Implementation: simple in-memory FIFO, `tick()` self-schedules
- Used by: `src/bots/telegram.js` (VK bot calls `runGeneration()` directly without queuing)
- Purpose: HTTP adapter to the self-hosted `gcui-art/suno-api` (Next.js, `localhost:3000`)
- Location: `src/suno/client.js`
- Contains:
- Depends on: `undici`, `src/config.js`, lazy imports of `src/suno/refresh-cookie.js`, `src/suno/refresh-passkey.js`
- Used by: `src/flow/generate.js`, `src/bots/telegram.js` (for `/ping`), `src/index.js` (for startup ping)
- Purpose: Generates Russian lyrics + SUNO style tags via OpenRouter (Gemini / Claude)
- Location: `src/ai/client.js`
- Contains: `generateLyrics({occasion,genre,mood,voice,wishes})` — 3-attempt loop, returns `{lyrics, tags, title}`; `extractTitle()` — regex name extraction from `wishes`
- System prompt: ~250-line storyteller poet prompt with bad/good examples, song structure rules, syllable counts
- Depends on: `src/config.js`, Node built-in `fetch`
- Used by: `src/bots/telegram.js` only (on `confirm_create` and `editing_lyrics` states)
- Purpose: Restore expired SUNO auth by controlling RDP Chromium (port 9223) via Chrome DevTools Protocol
- Locations:
- Depends on: `ws`, Node built-in `http`, `child_process.execSync`
- Used by: `src/suno/client.js` (lazy import, on-demand only)
- Purpose: Robokassa invoice generation and webhook signature verification
- Location: `src/payment/robokassa.js`
- Contains: `createInvoiceUrl(invId, amount, description)`, `verifyResult(params)` (MD5 signature), `generateInvId(userId)`
- Location (webhook): `src/server/webhook.js` — HTTP server on `config.webhookPort` (default 8080); handles `/robokassa/result` (server-to-server), `/robokassa/success`, `/robokassa/fail`, `/health`
- Currently disabled: `PAYWALL_ENABLED=false`
- Used by: `src/bots/telegram.js`, `src/index.js`
- Purpose: Closed beta — 20 hardcoded 6-digit codes, one per Telegram user
- Location: `src/access-codes.js`
- Contains: `checkAndUseCode(code, userId)` → `'ok'|'invalid'|'used'`; `isUserVerified(userId)`; `getCodesStatus()` (admin `/codes` command)
- Storage: in-memory CODES object (resets on bot restart)
- Used by: `src/bots/telegram.js` only
## Data Flow
- Cookie recovery: `ensureTokenAlive()` detects `500 + "session id"` → `refreshCookie()` → CDP `Network.getAllCookies` → writes file → `systemctl restart suno-api` → verifies restart
- Passkey recovery: `handleSunoError()` detects `422` → `refreshPasskeyToken(fills)` → CDP navigate `/create` → 60s wait → React fiber fill form → `Fetch.requestPaused` intercept → extract P1_ → POST to passkey-server
- All user state lives in `src/store.js` in-memory Maps
- `key = "${platform}:${userId}"` — sessions are isolated per platform
- State is lost on bot restart — no persistence
- Session states form a linear wizard: `idle → awaiting_occasion → ... → generating → idle`
## Key Abstractions
- Purpose: Platform-agnostic generation contract; both bots call this same function
- Location: `src/flow/generate.js`
- Returns `{ ok: true, clips: [...] }` or `{ ok: false, error: string }`
- The `onStatus` callback allows the caller to push progress updates to users
- Purpose: Wraps any async function in the serial queue
- Location: `src/queue.js`
- Only Telegram uses this; VK calls `runGeneration()` directly (no queue)
- Purpose: Typed error with `status` and `body` fields for error classification
- Location: `src/suno/client.js`
- Consumed by `handleSunoError()` to decide cookie vs passkey recovery
- Purpose: Tracks where each user is in the wizard conversation
- Location: state strings in `src/store.js` comments, transitions in `src/bots/telegram.js`
- Key states: `idle`, `awaiting_code`, `awaiting_occasion/genre/mood/voice/wishes`, `confirm`, `review_lyrics`, `editing_lyrics`, `awaiting_payment`, `generating`
## Entry Points
- Location: `src/index.js`
- Triggers: `node src/index.js` (systemd `podari-bot` service)
- Responsibilities: Read `--only=` flag, ping SUNO, start bot(s), optionally start webhook server
- Location: `createTelegramBot()` in `src/bots/telegram.js`
- Triggers: grammY long-polling
- Responsibilities: Full 5-question wizard, AI lyrics generation, queue management, audio delivery
- Location: `createVkBot()` in `src/bots/vk.js`
- Triggers: vk-io long-polling
- Responsibilities: Simpler flow (description or custom lyrics), no AI, no queue, no paywall
- Location: `src/server/webhook.js`
- Triggers: Robokassa server-to-server Result URL callback
- Responsibilities: Verify payment signature, trigger `bot._handlePaidGeneration()`
- Location: `emulator/index.html`
- Triggers: Manual browser open (development only)
- Responsibilities: Static HTML UI simulating Telegram chat for local testing without real bot
## Error Handling
- `src/suno/client.js`: nested try/catch in `generateCustom()` and `generateByDescription()` — up to 3 attempts with 2 recovery cycles (500→cookie→retry→422→passkey→retry)
- `src/flow/generate.js`: single catch around generate call — returns `{ ok: false, error }` not throws
- `src/bots/telegram.js`: catches AI errors and shows user-friendly message; catches queue errors; catches `sendAudio` failures with link fallback
- `src/ai/client.js`: 3-attempt retry loop for OpenRouter; JSON parse fallback (raw text as lyrics)
- `src/suno/refresh-cookie.js` / `refresh-passkey.js`: hard timeout guards (10s CDP, 5min passkey); logged failures bubble up
- `src/bots/telegram.js`: `bot.catch()` global handler logs all uncaught grammY errors
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
