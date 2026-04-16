# Technology Stack

**Analysis Date:** 2026-04-16

## Languages

**Primary:**
- JavaScript (ESM) — entire codebase, Node.js native modules only
- No TypeScript — plain `.js` throughout `src/`

## Runtime

**Environment:**
- Node.js >= 20 (engines field), deployed on Node.js 22
- ESM modules (`"type": "module"` in `package.json`)
- Entry point: `src/index.js`

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- `grammy` ^1.30.0 — Telegram bot framework (`src/bots/telegram.js`)
- `vk-io` ^4.9.0 — VK bot framework (`src/bots/vk.js`)

**HTTP / Networking:**
- `undici` ^6.19.8 — HTTP client used in `src/suno/client.js` (`import { fetch } from 'undici'`)
- `ws` ^8.20.0 — WebSocket client used in `src/suno/refresh-cookie.js` and `src/suno/refresh-passkey.js` for CDP connections
- Node.js built-in `http` module — used in CDP tab listing and webhook server (`src/server/webhook.js`)

**Build/Dev:**
- No bundler (no webpack, esbuild, vite)
- No transpiler (no Babel, TypeScript)
- `dotenv` ^16.4.5 — env loading (`import 'dotenv/config'` in `src/config.js`)

## Key Dependencies

**Critical:**
- `grammy` ^1.30.0 — entire Telegram bot interaction surface (`Bot`, `InlineKeyboard`, `InputFile`)
- `vk-io` ^4.9.0 — VK long-polling bot (`VK`, `Keyboard`)
- `undici` ^6.19.8 — HTTP fetch for SUNO API calls (explicit import, NOT Node built-in fetch)
- `ws` ^8.20.0 — WebSocket for Chrome DevTools Protocol (CDP) connections to Chromium instances

**Infrastructure:**
- `dotenv` ^16.4.5 — environment variable loading from `.env` file

## Configuration

**Environment:**
- Loaded via `dotenv/config` at `src/config.js` line 1
- All config exported as `config` object from `src/config.js`
- `.env.example` documents all required variables

**Key env vars:**

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

**Build:**
- No build step — run directly with `node src/index.js`
- Start scripts in `package.json`: `start`, `start:tg`, `start:vk`, `check`
- Syntax check script: `node --check` on all main files

## Platform Requirements

**Development:**
- Node.js >= 20 (ideally 22 to match production)
- `.env` file populated from `.env.example`

**Production:**
- Debian 13, mini PC at 192.168.0.128
- systemd service `podari-bot` — runs `node src/index.js`
- Self-hosted `suno-api` (gcui-art/suno-api, Next.js) on port 3000
- Self-hosted `passkey-server` on port 3099 (stores P1_ tokens)
- Two Chromium instances for CDP:
  - Bot Chromium: `DISPLAY=:1001`, CDP port 9222
  - RDP Chromium: CDP port 9223 (used for cookie/passkey refresh)
- Cloudflare Tunnel (`cloudflared`) → `pay.vrodnikah.ru` → `:8080` (webhook)
- Cookie file: `/home/alexander/projects/suno_cookie.txt`
- Passkey file: `/home/alexander/projects/suno_passkey.txt`

## State Storage

- In-memory only (`src/store.js`) — `Map` for sessions and payments
- No database, no Redis
- All state lost on bot restart (intentional for MVP)

---

*Stack analysis: 2026-04-16*
