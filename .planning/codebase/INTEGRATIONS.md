# External Integrations

**Analysis Date:** 2026-04-16

## APIs & External Services

**Telegram Bot API:**
- Used for: main user-facing bot (@podaripesniu_bot)
- SDK/Client: `grammy` ^1.30.0
- Transport: long-polling (not webhook)
- Auth: `TELEGRAM_BOT_TOKEN` env var
- Implementation: `src/bots/telegram.js`

**VK API:**
- Used for: secondary bot channel (VK community)
- SDK/Client: `vk-io` ^4.9.0
- Transport: long-polling via `vk.updates.start()`
- Auth: `VK_GROUP_TOKEN` + `VK_GROUP_ID` env vars
- Implementation: `src/bots/vk.js`

**OpenRouter AI:**
- Used for: AI lyrics generation (Russian songwriter)
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Current model: `google/gemini-2.5-pro` (reasoning:high, max_tokens 16000)
- Default model in config: `anthropic/claude-sonnet-4-5`
- Auth: `OPENROUTER_API_KEY` env var (Bearer token in Authorization header)
- Response format: JSON `{ lyrics: string, tags: string }`
- Reasoning mode: `{ reasoning: { max_tokens: 8000 } }` in request body
- Handles content as array of blocks (thinking + text blocks)
- Implementation: `src/ai/client.js`

**Robokassa (Payment Gateway):**
- Used for: payment processing (currently disabled, `PAYWALL_ENABLED=false`)
- Merchant: `podaripesniu` (configured via `ROBOKASSA_MERCHANT_ID`)
- Auth: `ROBOKASSA_PASSWORD1` (invoice signature), `ROBOKASSA_PASSWORD2` (result verification)
- Signature: MD5(`MerchantId:Sum:InvId:Password1`)
- Result verification: MD5(`OutSum:InvId:Password2`)
- URL: `https://auth.robokassa.ru/Merchant/Index.aspx`
- Result URL (server-to-server): `POST /robokassa/result` on webhook server
- Success/Fail redirect: both redirect to `https://t.me/podaripesniu_bot`
- Implementation: `src/payment/robokassa.js`, `src/server/webhook.js`

## Data Storage

**Databases:**
- None — no external database
- In-memory `Map` stores in `src/store.js` for sessions and payments
- State lost on process restart

**File Storage:**
- `/home/alexander/projects/suno_cookie.txt` — Clerk session cookies (5 essential cookies for SUNO auth)
- `/home/alexander/projects/suno_passkey.txt` — P1_ JWT passkey token
- `src/assets/welcome.mp4` — welcome video sent on /start
- `src/assets/.video_file_id` — cached Telegram file_id for welcome video (avoids re-uploading)

**Caching:**
- None (other than in-memory Maps and video file_id file cache)

## Authentication & Identity

**SUNO Authentication (Cookie-based):**
- Main auth: Clerk `__client` httpOnly cookie (NOT visible via `document.cookie`)
- Essential cookies: `__client`, `__client_uat`, `__client_uat_Jnxw-muT`, `__client_Jnxw-muT`, `suno_device_id`
- Cookie stored in `suno_cookie.txt`, read by self-hosted `suno-api` service
- Refresh mechanism: CDP `Network.getAllCookies` from RDP Chromium (port 9223) → write file → `sudo systemctl restart suno-api`
- Trigger: HTTP 500 with "session id" or "SUNO_COOKIE" in response body
- Implementation: `src/suno/refresh-cookie.js`

**SUNO P1_ Token (Secondary, Not Critical):**
- JWT HS256 token, ~1870-1960 chars, stored in `suno_passkey.txt`
- Obtained via CF Turnstile challenge on `https://suno.com/create`
- Capture: CDP `Fetch.enable` interception on `*generate/v2*` POST requests
- Refresh: fills form with real user data (lyrics/tags/title), clicks Create, intercepts POST body
- Token sent to `passkey-server` at `localhost:3099/token`
- Trigger: HTTP 422 from suno-api
- Implementation: `src/suno/refresh-passkey.js`

**Beta Access Control:**
- 20 hardcoded 6-digit codes in `src/access-codes.js`
- Each code binds to one Telegram userId (in-memory, resets on restart)
- Implementation: `src/access-codes.js`

## Self-Hosted Services (on 192.168.0.128)

**suno-api (`gcui-art/suno-api`):**
- Repo: https://github.com/gcui-art/suno-api (Next.js)
- Runs on: `localhost:3000`
- Systemd service: `suno-api`
- Cookie source: `~/projects/suno_cookie.txt`
- SUNO endpoint (patched): `studio-api-prod.suno.com` in `.next/chunks/669.js`
- Model: `chirp-fenix` (SUNO v5.5)
- Endpoints used:
  - `POST /api/generate` — description-based generation
  - `POST /api/custom_generate` — custom lyrics + tags + title
  - `GET /api/get?ids=...` — poll clip status
  - `GET /api/get_limit` — check credits/health

**passkey-server:**
- Runs on: `localhost:3099`
- Endpoint: `POST /token` — accepts P1_ token as plain text body
- Systemd service: `passkey-server`

**cloudflared:**
- Tunnel: `pay.vrodnikah.ru` → `localhost:8080`
- Used for Robokassa webhook callbacks

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry or equivalent

**Logs:**
- `console.log`/`console.error` to stdout
- Systemd journald captures output: `journalctl -u podari-bot -f`
- Log prefixes: `[telegram]`, `[suno]`, `[ai]`, `[cookie]`, `[passkey]`, `[webhook]`

## CI/CD & Deployment

**Hosting:**
- Mini PC 192.168.0.128 (Debian 13, systemd)
- No Docker

**Deploy process:**
```bash
git add -A && git commit -m "msg" && git push origin main
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 \
  'cd ~/projects/moyapesnya && git pull && npm install && sudo systemctl restart podari-bot'
```

**CI Pipeline:**
- None

**Repo:**
- GitHub: `papavini/moyapesnya`

## Webhooks & Callbacks

**Incoming:**
- `POST /robokassa/result` — Robokassa payment confirmation (server-to-server)
  - Signature verified via MD5 before processing
  - Responds `OK{InvId}` as required by Robokassa
- `GET /robokassa/success` — user redirect after successful payment → 302 to bot
- `GET /robokassa/fail` — user redirect after failed payment → 302 to bot
- `GET /health` — health check endpoint, returns `{"status":"ok"}`
- Server: Node.js built-in `http.createServer` on `WEBHOOK_PORT` (default 8080)
- Implementation: `src/server/webhook.js`
- Only started when `PAYWALL_ENABLED=true` AND `ROBOKASSA_MERCHANT_ID` is set

**Outgoing:**
- Telegram Bot API (long-polling, no outgoing webhook)
- VK API (long-polling, no outgoing webhook)
- OpenRouter API (`https://openrouter.ai/api/v1/chat/completions`)
- Self-hosted suno-api (`http://localhost:3000/api/*`)
- passkey-server (`http://127.0.0.1:3099/token`)

## Chrome DevTools Protocol (CDP)

Used internally for cookie/passkey refresh — not an "external" API but a key integration:

**Bot Chromium (port 9222):**
- `DISPLAY=:1001`, user `sonar`
- Not currently used by bot code (was used by deprecated cookie-refresh.sh)

**RDP Chromium (port 9223):**
- Real user session with active SUNO login
- Used by `src/suno/refresh-cookie.js`: `Network.getAllCookies`
- Used by `src/suno/refresh-passkey.js`: `Fetch.enable`, `Fetch.requestPaused`, `Page.navigate`, `Runtime.evaluate`
- Connection: `ws://127.0.0.1:9223` via `ws` npm package

---

*Integration audit: 2026-04-16*
