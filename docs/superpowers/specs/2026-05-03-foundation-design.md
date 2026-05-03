# Spec: Site Backend Foundation (Subsystem #1 of 7)

**Status:** Draft — pending user review
**Author:** Claude (brainstorming session 2026-05-03)
**Project:** «Подари Песню» — `мояпесня.рф`
**Subsystem:** #1 (Foundation) of 7

## Context

The site `мояпесня.рф` is currently a **static interactive prototype** deployed on Sber Cloud (`84.54.59.163`). All 14 HTML pages exist (`landing`, `wizard`, `preview`, `loading-text`, `loading-music`, `result`, `checkout`, `success`, `cabinet`, `song`, `profile`, `auth`, `gift`, `ui-kit`) plus `legal/*` and `assets/`. There is **no backend** — `app.js` only renders shared header/footer; nothing calls APIs; auth screens are visual mocks.

The Telegram bot `@podaripesniu_bot` runs separately on the mini-PC (`192.168.0.128`) with its own in-memory state. AI pipeline (`src/ai/*`) and SUNO client (`src/suno/*`) live in the same repo as the bot.

This spec covers the **first of seven subsystems** required to turn the prototype into a working product per `PROMPT_SITE.md`. Foundation gives the site a brain capable of recognizing users, holding sessions, and storing data. It produces no new visible UX on its own — visible features arrive in subsystems #2 (wizard→song flow), #3 (cabinet), #4 (email auth), #5 (Robokassa), #6 (bot↔site userId unification), #7 (gift packages).

## Goals

1. Cloud-hosted backend in Node.js (Fastify) responding on `https://api.мояпесня.рф/*`.
2. SQLite database storing users, sessions, songs, email login codes.
3. Anonymous (guest) sessions via cookie, lifetime 30 days.
4. Telegram Login Widget integration: HMAC-verified callback creates/updates user, rotates session, migrates guest songs to the new authenticated session, atomically.
5. Authenticated session lifetime 90 days, sliding (extends on activity).
6. Cleanup job removes expired sessions and guest-orphan songs (24h TTL per `PROMPT_SITE.md`).
7. Tests: unit for pure functions (HMAC verify, IP hash, ULID), integration for full auth flow via Fastify `inject()`.
8. Deployment as systemd service `podari-web.service` on cloud, deploys via `git pull && npm install && systemctl restart`.

## Non-goals (explicitly deferred to later subsystems)

- **Wizard submit / song generation / SUNO integration** — subsystem #2.
- **Cabinet UI with real song data** — subsystem #3.
- **Email magic-link auth** — subsystem #4 (table laid in this spec, but not used).
- **Robokassa checkout & paid flow** — subsystem #5 (`paid_at`/`order_invoice_id` columns laid in `songs`, but not populated).
- **Bot↔site userId unification** — subsystem #6 (bot continues using its in-memory store; site uses SQLite; tables exist independently for now).
- **Gift packages, promo codes** — subsystem #7.
- **Visible cabinet UI rewiring** — subsystem #3.
- **Uptime monitoring** — separate small task post-Foundation.

## Architecture overview

### Topology

```
Internet
   │
   ├── мояпесня.рф (existing) ──→ nginx ──→ /var/www/podaripesnyu/*.html (static)
   │                                        (no backend calls from static pages until subsystem #2)
   │
   └── api.мояпесня.рф (NEW)  ──→ nginx ──→ 127.0.0.1:8090 (Fastify)
                                                │
                                                ├── reads/writes SQLite at /home/user1/projects/moyapesnya/data/db.sqlite
                                                ├── verifies Telegram Login Widget HMAC locally (uses BOT_TOKEN, no network)
                                                └── (subsystem #2 onwards) calls suno-api/rhyme-sidecar via tailnet
```

### Style: functional / flat

Per Q8 decision: routes are async functions importing `db` and helpers directly. No layers, no DI, no plugin scopes for our own features. Matches existing project style (`src/bots/telegram.js`, `src/ai/client.js`).

### Code structure (`src/web/`)

```
src/web/
├── server.js                    # Fastify entrypoint; registers @fastify/cookie, @fastify/cors, routes; launches cleanup-job
├── db.js                        # better-sqlite3 singleton, PRAGMAs, runMigrations(db) call
├── schema/
│   ├── 001_init.sql             # full DDL (4 tables + indexes + check constraints)
│   └── _migrations.js           # ~30-line migration runner using _migrations table
├── routes/
│   ├── auth.js                  # POST /api/auth/telegram/callback, POST /api/auth/logout, GET /api/auth/me
│   └── health.js                # GET /api/health
├── middleware/
│   ├── session.js               # onRequest hook: parses pp_sid cookie, upserts session, decorates req with session/user
│   └── error.js                 # errorHandler: maps HttpError → response, logs internal errors via pino
├── services/
│   ├── telegram-login.js        # verifyTelegramHash(payload, botToken) — pure function
│   ├── ip-hash.js               # hashIp(ipString) — SHA-256(ip + IP_HASH_SALT)
│   ├── ulid.js                  # thin wrapper around `ulid` package
│   └── session-store.js         # createGuestSession, rotateOnLogin (atomic with song migration), touchSession
├── lib/
│   └── http-errors.js           # HttpError class + factory functions
└── tests/
    ├── telegram-login.test.js   # unit
    ├── session-store.test.js    # unit (in-memory SQLite)
    └── auth-flow.test.js        # integration via fastify.inject()
```

## Data model (SQLite, schema version 001)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;

-- 1. users — Telegram and/or email-authenticated accounts
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id     INTEGER UNIQUE,
  email           TEXT UNIQUE,
  display_name    TEXT,
  avatar_initials TEXT,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);
CREATE INDEX idx_users_telegram ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX idx_users_email    ON users(email)       WHERE email       IS NOT NULL;

-- 2. sessions — guest (user_id NULL) and authenticated
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,        -- ULID, sent in cookie pp_sid
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,        -- 30d guest, 90d auth (sliding)
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  ip_hash       TEXT                     -- SHA-256(ip + IP_HASH_SALT)
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE user_id IS NOT NULL;

-- 3. songs — main artifact, attached to session always, user after login
CREATE TABLE songs (
  id              TEXT PRIMARY KEY,      -- ULID, exposed in URL /song/<id>
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- valid states (no CHECK constraint to keep future subsystems flexible):
  -- wizard_in_progress | text_generating | text_ready | text_editing |
  -- music_generating | music_ready | paid | archived | failed
  state           TEXT NOT NULL DEFAULT 'wizard_in_progress',
  -- wizard input
  occasion        TEXT,
  occasion_custom TEXT,
  genre           TEXT,
  moods_json      TEXT,
  voice           TEXT,
  wishes          TEXT,
  -- generation results
  lyrics          TEXT,
  suno_tags       TEXT,
  title           TEXT,
  portrait_json   TEXT,
  metrics_json    TEXT,
  critique_json   TEXT,
  -- music
  clips_json      TEXT,
  -- payment (subsystem #5)
  paid_at         INTEGER,
  order_invoice_id TEXT,
  -- timestamps
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  extra_json      TEXT
);
CREATE INDEX idx_songs_session ON songs(session_id);
CREATE INDEX idx_songs_user    ON songs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_songs_state   ON songs(state);

-- 4. email_login_codes — prepared for subsystem #4, not used now
CREATE TABLE email_login_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,             -- SHA-256(code + IP_HASH_SALT)
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
```

### State machine for `songs.state`

Used in subsystem #2 onwards. Listed for completeness:

`wizard_in_progress` → `text_generating` → `text_ready` ⇄ `text_editing` → `music_generating` → `music_ready` → `paid` → (`archived`). `failed` reachable from any state.

Foundation only ever sets `wizard_in_progress` (default). Other states arrive in #2.

### Primary key choices

- `users.id`: `INTEGER AUTOINCREMENT`. Never exposed in URLs.
- `sessions.id`, `songs.id`: `ULID` (TEXT). Exposed in URLs (`/song/<id>`); ULID is time-ordered + unguessable.

### Foreign keys

- `sessions.user_id → users.id ON DELETE SET NULL` — deleting a user (rare admin op) leaves their sessions orphan rather than cascading.
- `songs.session_id → sessions.id ON DELETE CASCADE` — when a session is deleted (cleanup-job for expired sessions, or logout), guest songs attached to it are deleted automatically. This is the desired behavior: guest-orphan songs disappear when their session expires, no separate cleanup query needed for songs created within session lifetime. Authenticated songs survive because they get a new session_id during login (see migration below).
- `songs.user_id → users.id ON DELETE SET NULL` — same reasoning as sessions.

## Auth flow (Telegram Login Widget)

### One-time setup

1. **BotFather:** `/mybots → @podaripesniu_bot → Bot Settings → Domain → мояпесня.рф`. **Done 2026-05-03 22:07.**
2. **Site `auth.html`:** embed Telegram widget script:
   ```html
   <script async src="https://telegram.org/js/telegram-widget.js?22"
     data-telegram-login="podaripesniu_bot"
     data-size="large"
     data-onauth="onTelegramAuth(user)"
     data-request-access="write"></script>
   ```
   `onTelegramAuth(user)` → `fetch('https://api.мояпесня.рф/api/auth/telegram/callback', {credentials: 'include', method: 'POST', body: JSON.stringify(user)})`.

### Backend: `POST /api/auth/telegram/callback`

Body: `{id, first_name, last_name?, username?, photo_url?, auth_date, hash}`.

1. **Verify HMAC.** Reject if invalid:
   - Build `data_check_string` = sorted `key=value` lines joined by `\n`, excluding `hash`.
   - `secret_key` = SHA-256(BOT_TOKEN).
   - `expected_hash` = HMAC-SHA256(secret_key, data_check_string).
   - Reject (HTTP 401) if `expected_hash !== hash` or if `Math.floor(Date.now()/1000) - auth_date > 86400` (Telegram sends `auth_date` in seconds; reject anything older than 24h as replay protection).
2. **Upsert user** (`INSERT ... ON CONFLICT(telegram_id) DO UPDATE SET display_name=?, avatar_initials=?, last_seen_at=?`).
3. **Rotate session atomically** (single transaction):
   - `INSERT INTO sessions (id=newULID, user_id=..., expires_at=NOW+90d, ...)`.
   - `UPDATE songs SET session_id=newSid, user_id=?, updated_at=NOW WHERE session_id=oldSid AND user_id IS NULL`.
   - Capture `migrated = changes()`.
   - `DELETE FROM sessions WHERE id=oldSid`.
4. **Set new cookie** (`pp_sid=newULID; Domain=мояпесня.рф; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000`).
5. **Respond:** `{ok: true, user: {display_name, avatar_initials}, migrated_songs_count: migrated}`.

### Backend: `POST /api/auth/logout`

1. `DELETE FROM sessions WHERE id=?` (current session).
2. `Set-Cookie: pp_sid=; Max-Age=0; ...`.
3. Respond `{ok: true}`.

### Backend: `GET /api/auth/me`

- If `req.user` populated by middleware: `{user: {display_name, avatar_initials}, guest: false}`.
- If only `req.session` (no user): `{guest: true}`.

### Backend: `GET /api/health`

- Returns `{ok: true, ts: <unix_ms>}`. No DB call. For uptime checkers and smoke tests.

## Cookie & session policy

| Attribute | Value | Reason |
|---|---|---|
| Name | `pp_sid` | Branded to `@podaripesniu_bot`. |
| Value | ULID | Pointer only; no signing needed. |
| `Domain` | `xn--e1anecfn9ge.xn--p1ai` | Shared between frontend and `api.` subdomain. HTTP cookie header MUST be punycode (RFC 6265); browser decodes for display. |
| `HttpOnly` | yes | XSS protection. |
| `Secure` | yes | HTTPS-only (Let's Encrypt active on both subdomains post-setup). |
| `SameSite` | `Lax` | Allows Telegram redirect-back; blocks cross-site POST. |
| `Path` | `/` | All endpoints. |
| `Max-Age` | guest 30d, auth 90d | UX vs security tradeoff. |

### Sliding expiration (auth sessions only)

On every authenticated request: `UPDATE sessions SET expires_at = NOW + 90d, last_seen_at = NOW WHERE id = ?`. Keeps active users logged in indefinitely; inactive users expire after 90 days.

Guest sessions: `last_seen_at` updates, but `expires_at` is fixed at `created_at + 30d` (no point extending guest browsing).

## Guest→user migration (the key UX moment)

A user can wizard a song anonymously. When they log in, that song must move to their account, atomically.

```
BEGIN TRANSACTION;
  -- create new (rotated) session
  INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?);

  -- move all anonymous songs from old session to new
  UPDATE songs
     SET session_id = ?, user_id = ?, updated_at = ?
   WHERE session_id = ? AND user_id IS NULL;

  -- count for client toast
  -- (use changes() before next statement)

  -- delete old guest session (CASCADE would drop songs, but they're now reattached → safe)
  DELETE FROM sessions WHERE id = ?;
COMMIT;
```

**Why session rotation matters:** if guest cookie was sniffed (public Wi-Fi, shared computer), keeping the same session_id post-login would grant the sniffer authenticated access. Rotation invalidates the old cookie. Standard security practice (OWASP A07:2021).

**Edge case — user already has account from another browser:** the song attaches to the existing user's account. Their cabinet now shows N+1 songs. No conflict.

**Edge case — user logs in but had no anonymous songs:** `migrated = 0`. Frontend shows generic «Добро пожаловать» toast instead of «Перенесли N черновиков».

## Environment & secrets

### `.env` additions (cloud only)

```bash
# Web backend (cloud only)
WEB_PORT=8090
WEB_PUBLIC_URL=https://мояпесня.рф
WEB_API_PUBLIC_URL=https://api.мояпесня.рф
DATABASE_PATH=/home/user1/projects/moyapesnya/data/db.sqlite
COOKIE_SECURE=true
IP_HASH_SALT=<openssl rand -hex 32>

# Existing on cloud (already set per CONTINUITY/INDEX):
TELEGRAM_BOT_TOKEN=<same as bot's .env on mini-PC>
OPENROUTER_API_KEY=<same as bot's .env>
SUNO_API_BASE=http://100.103.150.29:3000
RHYME_SIDECAR_URL=http://100.103.150.29:3100
# AI_MODEL, AI_BASE_URL — same as bot
```

### Secrets storage

- Live values: cloud `.env` file at `/home/user1/projects/moyapesnya/.env` (mode 600, owner `user1`).
- Backup pointers: `C:\Vault\Projects\suno-sales\SECRETS.md` (gitignored). Add `IP_HASH_SALT` to it.
- Two `.env` files (mini-PC and cloud) maintained independently. Token rotation requires manual update in both.

### `config.js` additions

New `web` section:

```js
web: {
  port:                   num(process.env.WEB_PORT, 8090),
  publicUrl:              process.env.WEB_PUBLIC_URL || 'https://мояпесня.рф',
  apiPublicUrl:           process.env.WEB_API_PUBLIC_URL || 'https://api.мояпесня.рф',
  dbPath:                 process.env.DATABASE_PATH || './data/db.sqlite',
  cookieName:             'pp_sid',
  cookieDomain:           'xn--e1anecfn9ge.xn--p1ai',  // punycode required for Set-Cookie header (RFC 6265)
  cookieSecure:           bool(process.env.COOKIE_SECURE, true),
  ipHashSalt:             process.env.IP_HASH_SALT,    // required, throw on missing
  sessionLifetimeGuestMs: 30 * 24 * 60 * 60 * 1000,
  sessionLifetimeAuthMs:  90 * 24 * 60 * 60 * 1000,
  guestSongTtlMs:         24 * 60 * 60 * 1000,
}
```

## Deployment

### One-time setup (cloud `84.54.59.163`)

1. Install Node.js 22 (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash && sudo apt install nodejs`).
2. DNS: in Beget, add `api.мояпесня.рф A 84.54.59.163` (Punycode: `api.xn--e1anecfn9ge.xn--p1ai`).
3. nginx server-block for `api.мояпесня.рф`:
   ```nginx
   server {
       server_name api.xn--e1anecfn9ge.xn--p1ai;
       location / {
           proxy_pass http://127.0.0.1:8090;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
       listen 80;
   }
   ```
4. `sudo certbot --nginx -d api.xn--e1anecfn9ge.xn--p1ai` (issues cert, auto-rewrites server-block to listen 443).
5. Generate IP_HASH_SALT: `openssl rand -hex 32` → save to cloud `.env` and Vault SECRETS.md.
6. Copy TELEGRAM_BOT_TOKEN and OPENROUTER_API_KEY from mini-PC `.env` to cloud `.env`.
7. `mkdir -p /home/user1/projects/moyapesnya/data`.
8. systemd unit `/etc/systemd/system/podari-web.service`:
   ```ini
   [Unit]
   Description=Podari Pesnyu — web backend (Fastify)
   After=network.target

   [Service]
   Type=simple
   User=user1
   WorkingDirectory=/home/user1/projects/moyapesnya
   EnvironmentFile=/home/user1/projects/moyapesnya/.env
   ExecStart=/usr/bin/node src/web/server.js
   Restart=always
   RestartSec=5
   StandardOutput=journal
   StandardError=journal

   [Install]
   WantedBy=multi-user.target
   ```
9. `sudo systemctl daemon-reload && sudo systemctl enable --now podari-web`.

### Recurring deploy (after each code change)

```bash
# On dev machine
git push origin main

# On cloud
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 \
  'cd ~/projects/moyapesnya && git pull && npm install && sudo systemctl restart podari-web'
```

### Smoke tests after deploy

1. `curl https://api.мояпесня.рф/api/health` → `{ok:true,ts:<num>}` (<200ms).
2. Browser → `https://мояпесня.рф/auth.html` → click «Войти через Telegram» → complete flow → check `https://api.мояпесня.рф/api/auth/me` returns user (via DevTools Network).
3. DevTools → Application → Cookies → verify `pp_sid` present with HttpOnly + Secure + Domain=мояпесня.рф.
4. `journalctl -u podari-web -n 50 --no-pager` → check no errors, see request logs.

### Rollback

`git revert <sha> && git push && deploy` cycle. First deploy has no rollback target — but nothing to break (site is currently static prototype).

## Testing

### Unit tests (no DB, no network)

| Test file | What |
|---|---|
| `telegram-login.test.js` | `verifyTelegramHash` against known-good payload (built with test BOT_TOKEN); against tampered payload; against expired `auth_date` |
| `ip-hash.test.js` | Same IP → same hash; different IP → different hash; missing salt throws |
| `ulid.test.js` | Generated IDs are 26 chars, lex-sortable by time |

### Integration tests (Fastify `inject()`, in-memory SQLite)

| Test file | What |
|---|---|
| `auth-flow.test.js` | First request → guest cookie issued; second request with cookie → same session reused; POST /callback with valid HMAC → user created, cookie rotated, response includes user data; POST /callback with invalid HMAC → 401; POST /logout → session removed; GET /me before/after login |
| `session-store.test.js` | `createGuestSession` writes row with NULL user_id; `rotateOnLogin` migrates orphan songs and deletes old session in single transaction; concurrent rotations don't double-migrate |

### Test setup

- `before()`: create temp file SQLite, run migrations.
- `after()`: delete temp file.
- Test BOT_TOKEN hardcoded in test fixtures (not real one).

### Run

`npm test` (extends existing script to include `src/web/tests/*.test.js`).

## Risks & open questions

| Risk | Mitigation |
|---|---|
| Telegram changes Login Widget format | Affects only `verifyTelegramHash`; one-file fix |
| Sber Cloud blocks `telegram.org` (widget JS) | Unlikely (telegram.org is accessible in RU). If blocked: serve a self-hosted copy of widget.js. |
| SQLite WAL files in NFS-mounted /home | Not our case — `/home` is local ext4 on Sber Cloud. |
| BOT_TOKEN leak (would let attackers forge logins) | Stored in .env mode 600, not in git. Vault SECRETS.md is local-only. |
| Cookie `Domain=мояпесня.рф` makes cookie visible on all subdomains | Acceptable: only `мояпесня.рф` and `api.мояпесня.рф` exist; both are ours. |
| User clears cookies → loses guest songs | Expected behavior per PROMPT_SITE.md (guest = ephemeral). Toast on Preview reminds user to log in. |
| Testing requires real Telegram login one time | User confirmed test account available. |

## Dependencies (`package.json` additions)

```json
{
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/cookie": "^11.0.0",
    "@fastify/cors": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "ulid": "^3.0.0"
  }
}
```

`pino` ships with Fastify. JWT not used (session-table approach). Email/SMTP and Robokassa libs deferred to subsystems #4/#5.

## Acceptance criteria

Foundation is complete when ALL of these are true on the live cloud deployment:

1. `curl https://api.мояпесня.рф/api/health` returns `{"ok":true,"ts":...}`.
2. First visit to `https://мояпесня.рф/auth.html` issues `pp_sid` cookie (visible in DevTools).
3. Clicking «Войти через Telegram» on `auth.html` completes login through Telegram, returns to site, replaces «Войти» button in header with avatar/name (per `app.js` `signedIn` rendering logic — minimal frontend wiring needed).
4. `GET /api/auth/me` returns `{user: {display_name, avatar_initials}, guest: false}` after login.
5. A guest song row inserted manually into DB before login is rewritten with new session_id and user_id after login (verifiable via `sqlite3 db.sqlite "SELECT * FROM songs"`).
6. `POST /api/auth/logout` removes session row, clears cookie.
7. systemd service `podari-web` is enabled, restarts automatically on crash, logs to journal.
8. `npm test` is fully green for both pre-existing AI pipeline tests and new web tests.
9. Visiting `мояпесня.рф/auth.html`, then `cabinet.html` (still static mock for now) does not crash anything; the site continues to work as static for non-API routes.
10. SQLite file at `/home/user1/projects/moyapesnya/data/db.sqlite` exists after first request, contains all 4 tables, has `_migrations` row for `001_init.sql`.
