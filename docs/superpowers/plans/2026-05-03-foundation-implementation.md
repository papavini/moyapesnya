# Foundation (Site Backend #1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cloud-hosted backend (Fastify on Sber Cloud, subdomain `api.мояпесня.рф`) that gives the static site a brain — SQLite database, anonymous guest sessions via cookie, Telegram Login Widget authentication with HMAC verification, and atomic guest→user song migration on login. Foundation is subsystem #1 of 7; it produces no user-visible features beyond a working login button — visible flows arrive in #2 onward.

**Architecture:** Monorepo extension. New folder `src/web/` lives next to existing `src/bots/`, sharing `package.json` and `node_modules`. Fastify entrypoint at `src/web/server.js` listens on `127.0.0.1:8090`, fronted by nginx with Let's Encrypt cert on the new `api.мояпесня.рф` subdomain. SQLite database (`better-sqlite3`, single file at `data/db.sqlite`) holds 4 tables: `users`, `sessions`, `songs`, `email_login_codes` (last one prepared for subsystem #4). All routes are plain async functions importing helpers directly (no DI, no plugin scopes for our own features) — matches the project's existing minimalist style. Test discipline: TDD via `node:test`, unit tests for pure functions (HMAC verify, ULID, IP hash), integration via `fastify.inject()` with in-memory SQLite.

**Tech Stack:** Node.js 22 (ESM), Fastify 5, `@fastify/cookie` 11, `@fastify/cors` 10, `better-sqlite3` 11, `ulid` 3. No TypeScript, no bundler, no transpiler. nginx + certbot on cloud. systemd unit `podari-web.service`. Existing project conventions preserved: `dotenv/config`, named exports only, semicolons + single quotes + 2-space indent.

**Spec:** `docs/superpowers/specs/2026-05-03-foundation-design.md` (commit `886894a`).

---

## Pre-flight assumptions

The implementing engineer should verify these are still true before starting:

- Cloud server `84.54.59.163` is reachable via `wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163`.
- Mini-PC server `192.168.0.128` runs the bot via `wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128`.
- Repository root on dev machine: `C:\programirovanie\SUNO Бот Sales\` (contains `src/`, `package.json`, etc.).
- Telegram bot `@podaripesniu_bot` exists; its token lives in `C:\Vault\Projects\suno-sales\SECRETS.md`.
- BotFather `/setdomain` for `мояпесня.рф` is already done (confirmed by user 2026-05-03 22:07).
- Static site is already deployed on cloud at `/var/www/podaripesnyu/`; nginx serves `мояпесня.рф`.
- DNS provider for `мояпесня.рф` is Beget (`ns1/ns2.beget.com`).

If any of these is false, halt and surface the issue before proceeding.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/web/server.js` | Fastify entrypoint. Registers `@fastify/cookie`, `@fastify/cors`, session middleware, error handler, routes. Starts listening on `config.web.port`. Schedules cleanup-job. Handles SIGTERM. |
| `src/web/db.js` | Singleton `better-sqlite3` instance. Sets PRAGMAs. Calls `runMigrations(db)` at module load. Exports `db`. |
| `src/web/schema/001_init.sql` | Full DDL: 4 tables + indexes (per spec data model section). |
| `src/web/schema/_migrations.js` | Migration runner. Reads `*.sql` files in lex order, tracks applied set in `_migrations` table, runs pending in transactions. |
| `src/web/services/ulid.js` | One-line wrapper exporting `ulid` function from npm `ulid` package (provides isolation point). |
| `src/web/services/ip-hash.js` | `hashIp(ip)` → SHA-256 hex of `ip + IP_HASH_SALT`. Throws if salt unset. |
| `src/web/services/telegram-login.js` | `verifyTelegramHash(payload, botToken)` → boolean. Pure function implementing Telegram Login Widget HMAC algorithm. |
| `src/web/services/session-store.js` | DB-backed session helpers: `createGuestSession(req)`, `touchSession(sid)`, `rotateOnLogin(oldSid, userId, ipHash, ua)` (atomic with song migration). |
| `src/web/middleware/session.js` | `onRequest` Fastify hook. Reads `pp_sid` cookie or creates guest session. Decorates `req.session` and `req.user`. Sets cookie via `reply.setCookie`. |
| `src/web/middleware/error.js` | `setErrorHandler` for Fastify. Maps `HttpError` → response with proper status; logs internal errors to pino without leaking. |
| `src/web/lib/http-errors.js` | `HttpError` class + factory functions (`badRequest`, `unauthorized`, `notFound`, `internal`). |
| `src/web/routes/health.js` | `GET /api/health` → `{ok: true, ts: <ms>}`. No DB call. |
| `src/web/routes/auth.js` | `GET /api/auth/me`, `POST /api/auth/telegram/callback`, `POST /api/auth/logout`. |
| `src/web/tests/ulid.test.js` | Unit. ID is 26 chars, lex-sortable. |
| `src/web/tests/ip-hash.test.js` | Unit. Same IP → same hash; different → different; missing salt throws. |
| `src/web/tests/telegram-login.test.js` | Unit. Valid payload passes; tampered fails; expired auth_date fails. |
| `src/web/tests/session-store.test.js` | Unit (in-memory SQLite). `createGuestSession` writes NULL user_id row; `rotateOnLogin` migrates orphan songs and deletes old session atomically. |
| `src/web/tests/auth-flow.test.js` | Integration via `fastify.inject()`. Full guest→login→logout flow end-to-end. |
| `src/web/tests/_helpers.js` | Test fixtures: in-memory DB factory, valid HMAC payload builder, Fastify app factory. |
| `data/.gitkeep` | Ensures `data/` directory exists in checkouts (real DB file in `.gitignore`). |

### Modified files

| Path | Change |
|---|---|
| `src/config.js` | Add `web` section; add `assertWebConfig()` helper. |
| `package.json` | Add 5 dependencies; extend `check` and `test` scripts to include `src/web/`. |
| `.env.example` | Add commented `# Web backend (cloud only)` block. |
| `.gitignore` | Add `data/db.sqlite*` and `!data/.gitkeep`. |
| `site/auth.html` | Embed Telegram Login Widget script + `onTelegramAuth` callback. |
| `site/assets/app.js` | Auto-fetch `/api/auth/me` on page load; set `data-signed-in` on header element accordingly. Add `onTelegramAuth` handler that POSTs to backend and reloads. Add `logout()` helper. |

### Cloud-side artifacts (not in repo)

| Path | What |
|---|---|
| `/etc/systemd/system/podari-web.service` | systemd unit |
| `/etc/nginx/sites-enabled/podari-api.conf` | nginx server-block for `api.xn--e1anecfn9ge.xn--p1ai` (added by certbot) |
| `/etc/letsencrypt/live/api.xn--e1anecfn9ge.xn--p1ai/` | TLS cert (managed by certbot.timer) |
| `/home/user1/projects/moyapesnya/.env` | Production env (live secrets) |
| `/home/user1/projects/moyapesnya/data/db.sqlite` | SQLite DB (created on first run) |

---

## Task 1: Add new dependencies and ignore rules

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `data/.gitkeep`

- [ ] **Step 1: Add dependencies via `package.json` edit**

Replace the `dependencies` and `scripts` sections to add Fastify stack and extend `check`/`test`:

```json
"scripts": {
    "start": "node src/index.js",
    "start:tg": "node src/index.js --only=telegram",
    "start:vk": "node src/index.js --only=vk",
    "web": "node src/web/server.js",
    "check": "node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js && node --check src/ai/client.js && node --check src/ai/metrics.js && node --check src/ai/critic.js && node --check src/ai/rewriter.js && node --check src/ai/pipeline.js && node --check src/ai/analyzer.js && node --check src/ai/rhymes.js && node --check src/lyrics-archive.js && node --check src/web/server.js && node --check src/web/db.js && node --check src/web/schema/_migrations.js && node --check src/web/services/ulid.js && node --check src/web/services/ip-hash.js && node --check src/web/services/telegram-login.js && node --check src/web/services/session-store.js && node --check src/web/middleware/session.js && node --check src/web/middleware/error.js && node --check src/web/lib/http-errors.js && node --check src/web/routes/health.js && node --check src/web/routes/auth.js",
    "test": "node --test src/ai/metrics.test.js src/ai/critic.test.js src/ai/pipeline.test.js src/web/tests/ulid.test.js src/web/tests/ip-hash.test.js src/web/tests/telegram-login.test.js src/web/tests/session-store.test.js src/web/tests/auth-flow.test.js",
    "test:metrics": "node --test src/ai/metrics.test.js",
    "test:critic": "node --test src/ai/critic.test.js",
    "test:pipeline": "node --test src/ai/pipeline.test.js",
    "test:web": "node --test src/web/tests/*.test.js"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.0",
    "@fastify/cors": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.5",
    "fastify": "^5.0.0",
    "grammy": "^1.30.0",
    "ulid": "^3.0.0",
    "undici": "^6.19.8",
    "vk-io": "^4.9.0",
    "ws": "^8.20.0"
  },
```

- [ ] **Step 2: Run `npm install` and commit lockfile**

Run: `npm install`
Expected: succeeds, updates `package-lock.json`. `better-sqlite3` requires native build — on Windows requires Visual Studio Build Tools or works via prebuilt binary; on Linux just builds.

- [ ] **Step 3: Update `.gitignore`**

Append:
```
# Web backend SQLite DB (live data, never commit)
data/db.sqlite
data/db.sqlite-wal
data/db.sqlite-shm
!data/.gitkeep
```

- [ ] **Step 4: Create `data/.gitkeep`**

Empty file at `data/.gitkeep`.

Run: in terminal at repo root, create empty file (e.g. via `touch data/.gitkeep` in WSL bash, or `New-Item data/.gitkeep -ItemType File` in PowerShell).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore data/.gitkeep
git commit -m "feat(web): add fastify+sqlite deps and data/ dir"
```

---

## Task 2: Extend `src/config.js` with web section

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Add `web` block to the exported `config` object**

Insert this block in `src/config.js`, after the `paywallEnabled` line (right before the closing `}` of `export const config`):

```js
  web: {
    port:                   num(process.env.WEB_PORT, 8090),
    publicUrl:              process.env.WEB_PUBLIC_URL || 'https://мояпесня.рф',
    apiPublicUrl:           process.env.WEB_API_PUBLIC_URL || 'https://api.мояпесня.рф',
    dbPath:                 process.env.DATABASE_PATH || './data/db.sqlite',
    cookieName:             'pp_sid',
    cookieDomain:           process.env.COOKIE_DOMAIN || 'xn--e1anecfn9ge.xn--p1ai', // punycode required by RFC 6265
    cookieSecure:           bool(process.env.COOKIE_SECURE, true),
    ipHashSalt:             process.env.IP_HASH_SALT || '',
    sessionLifetimeGuestMs: 30 * 24 * 60 * 60 * 1000,
    sessionLifetimeAuthMs:  90 * 24 * 60 * 60 * 1000,
    guestSongTtlMs:         24 * 60 * 60 * 1000,
  },
```

- [ ] **Step 2: Add `assertWebConfig` helper**

After the existing `assertBotConfig` function, append:

```js
export function assertWebConfig() {
  if (!config.web.ipHashSalt) {
    throw new Error('IP_HASH_SALT не задан в .env (сгенерируй через `openssl rand -hex 32`)');
  }
  if (!config.telegram.token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан в .env (нужен для verify Telegram Login Widget HMAC)');
  }
}
```

- [ ] **Step 3: Update `.env.example`**

Append to `.env.example`:

```bash

# ─── Web backend (cloud only — для подсистемы #1 Foundation) ──────────────────
# Порт Fastify (за nginx-проксей)
WEB_PORT=8090
# Публичный URL фронтенда (для CORS allowlist + ссылок в email)
WEB_PUBLIC_URL=https://мояпесня.рф
# Публичный URL API (для отладки/документации)
WEB_API_PUBLIC_URL=https://api.мояпесня.рф
# Путь к SQLite файлу (создаётся автоматически)
DATABASE_PATH=./data/db.sqlite
# Domain для cookie (ОБЯЗАТЕЛЬНО punycode!)
COOKIE_DOMAIN=xn--e1anecfn9ge.xn--p1ai
# false только для local dev по http
COOKIE_SECURE=true
# Соль для хеширования IP (152-ФЗ, не храним сырой IP). Генерация: openssl rand -hex 32
IP_HASH_SALT=
```

- [ ] **Step 4: Run syntax check**

Run: `npm run check`
Expected: PASS for all listed files (web files don't exist yet → `node --check src/web/server.js` will fail; this step verifies only the config edit. Skip web file checks for now by temporarily commenting out web-prefixed paths in script if needed; revert before commit.)

Easier: just run `node --check src/config.js`.
Expected: silent success.

- [ ] **Step 5: Commit**

```bash
git add src/config.js .env.example
git commit -m "feat(config): add web section + assertWebConfig"
```

---

## Task 3: `src/web/lib/http-errors.js`

**Files:**
- Create: `src/web/lib/http-errors.js`

- [ ] **Step 1: Create the file with full content**

Write `src/web/lib/http-errors.js`:

```js
export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(msg, code = 'BAD_REQUEST') {
  return new HttpError(400, msg, code);
}

export function unauthorized(msg = 'Unauthorized', code = 'UNAUTHORIZED') {
  return new HttpError(401, msg, code);
}

export function notFound(msg = 'Not Found', code = 'NOT_FOUND') {
  return new HttpError(404, msg, code);
}

export function conflict(msg, code = 'CONFLICT') {
  return new HttpError(409, msg, code);
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/web/lib/http-errors.js`
Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add src/web/lib/http-errors.js
git commit -m "feat(web): HttpError class + factories"
```

---

## Task 4: `src/web/services/ulid.js` (TDD)

**Files:**
- Create: `src/web/services/ulid.js`
- Create: `src/web/tests/ulid.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/web/tests/ulid.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../services/ulid.js';

test('newId returns 26-char string', () => {
  const id = newId();
  assert.equal(typeof id, 'string');
  assert.equal(id.length, 26);
});

test('newId returns unique values', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(newId());
  assert.equal(ids.size, 1000);
});

test('newId is monotonic-ish (later id sorts after earlier id)', async () => {
  const a = newId();
  await new Promise(r => setTimeout(r, 5));
  const b = newId();
  assert.ok(b > a, `expected ${b} > ${a}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/web/tests/ulid.test.js`
Expected: FAIL with "Cannot find module '../services/ulid.js'".

- [ ] **Step 3: Implement**

Create `src/web/services/ulid.js`:

```js
import { ulid } from 'ulid';

export function newId() {
  return ulid();
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test src/web/tests/ulid.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/services/ulid.js src/web/tests/ulid.test.js
git commit -m "feat(web): ULID id generator + tests"
```

---

## Task 5: `src/web/services/ip-hash.js` (TDD)

**Files:**
- Create: `src/web/services/ip-hash.js`
- Create: `src/web/tests/ip-hash.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/web/tests/ip-hash.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('hashIp returns same hash for same IP with same salt', async () => {
  process.env.IP_HASH_SALT = 'test-salt-aaa';
  // Re-import config to pick up the env var
  const { hashIp } = await import('../services/ip-hash.js');
  const a = hashIp('1.2.3.4');
  const b = hashIp('1.2.3.4');
  assert.equal(a, b);
  assert.equal(a.length, 64); // SHA-256 hex
});

test('hashIp returns different hashes for different IPs', async () => {
  process.env.IP_HASH_SALT = 'test-salt-aaa';
  const { hashIp } = await import('../services/ip-hash.js');
  const a = hashIp('1.2.3.4');
  const b = hashIp('5.6.7.8');
  assert.notEqual(a, b);
});

test('hashIp throws when salt is empty', async () => {
  process.env.IP_HASH_SALT = '';
  // Need fresh module instance with empty salt
  const mod = await import('../services/ip-hash.js?empty=' + Date.now());
  assert.throws(() => mod.hashIp('1.2.3.4'), /IP_HASH_SALT/);
});
```

> Note: tests use `process.env.IP_HASH_SALT` directly because `config.js` reads it at module-load time. The third test uses a cache-busting query string to force re-evaluation.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/web/tests/ip-hash.test.js`
Expected: FAIL with "Cannot find module '../services/ip-hash.js'".

- [ ] **Step 3: Implement**

Create `src/web/services/ip-hash.js`:

```js
import { createHash } from 'node:crypto';

export function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || '';
  if (!salt) {
    throw new Error('IP_HASH_SALT не задан — refusing to hash IP without salt');
  }
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex');
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test src/web/tests/ip-hash.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/services/ip-hash.js src/web/tests/ip-hash.test.js
git commit -m "feat(web): IP hashing helper + tests"
```

---

## Task 6: `src/web/services/telegram-login.js` — HMAC verification (TDD)

**Files:**
- Create: `src/web/services/telegram-login.js`
- Create: `src/web/tests/telegram-login.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/web/tests/telegram-login.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { verifyTelegramHash } from '../services/telegram-login.js';

const TEST_BOT_TOKEN = '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

function buildValidPayload(userFields, botToken = TEST_BOT_TOKEN) {
  // Telegram algorithm:
  // 1. data_check_string = sorted "key=value" lines joined by \n (excluding hash)
  // 2. secret_key = SHA-256(bot_token)
  // 3. hash = HMAC-SHA256(secret_key, data_check_string)
  const dataCheckString = Object.keys(userFields).sort()
    .map(k => `${k}=${userFields[k]}`).join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...userFields, hash };
}

test('verifyTelegramHash returns true for valid payload', () => {
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: Math.floor(Date.now() / 1000),
  };
  const payload = buildValidPayload(fields);
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), true);
});

test('verifyTelegramHash returns false when hash is tampered', () => {
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: Math.floor(Date.now() / 1000),
  };
  const payload = buildValidPayload(fields);
  payload.hash = '0'.repeat(64); // wrong hash
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), false);
});

test('verifyTelegramHash returns false when payload field is tampered', () => {
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: Math.floor(Date.now() / 1000),
  };
  const payload = buildValidPayload(fields);
  payload.first_name = 'AttackerInjected';
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), false);
});

test('verifyTelegramHash returns false when auth_date is older than 24h', () => {
  const stale = Math.floor(Date.now() / 1000) - 86401; // 24h + 1s
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: stale,
  };
  const payload = buildValidPayload(fields);
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), false);
});

test('verifyTelegramHash returns false when payload missing required fields', () => {
  assert.equal(verifyTelegramHash(null, TEST_BOT_TOKEN), false);
  assert.equal(verifyTelegramHash({}, TEST_BOT_TOKEN), false);
  assert.equal(verifyTelegramHash({ id: 1 }, TEST_BOT_TOKEN), false); // no hash
  assert.equal(verifyTelegramHash({ hash: 'x', auth_date: 1 }, TEST_BOT_TOKEN), false); // no id
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/web/tests/telegram-login.test.js`
Expected: FAIL with "Cannot find module '../services/telegram-login.js'".

- [ ] **Step 3: Implement**

Create `src/web/services/telegram-login.js`:

```js
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AUTH_AGE_SEC = 86400; // 24 hours

export function verifyTelegramHash(payload, botToken) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.hash !== 'string' || payload.hash.length !== 64) return false;
  if (typeof payload.id !== 'number' && typeof payload.id !== 'string') return false;
  if (typeof payload.auth_date !== 'number' && typeof payload.auth_date !== 'string') return false;

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > MAX_AUTH_AGE_SEC) return false;

  // Build data_check_string from all fields except `hash`, sorted alphabetically.
  const keys = Object.keys(payload).filter(k => k !== 'hash').sort();
  const dataCheckString = keys.map(k => `${k}=${payload[k]}`).join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time compare to avoid timing attacks
  const expBuf = Buffer.from(expected, 'hex');
  const gotBuf = Buffer.from(payload.hash, 'hex');
  if (expBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expBuf, gotBuf);
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test src/web/tests/telegram-login.test.js`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/services/telegram-login.js src/web/tests/telegram-login.test.js
git commit -m "feat(web): Telegram Login Widget HMAC verification + tests"
```

---

## Task 7: SQL schema and migration runner

**Files:**
- Create: `src/web/schema/001_init.sql`
- Create: `src/web/schema/_migrations.js`

- [ ] **Step 1: Create the schema file**

Create `src/web/schema/001_init.sql`:

```sql
-- Foundation schema (subsystem #1 of 7)
-- See docs/superpowers/specs/2026-05-03-foundation-design.md

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

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  ip_hash       TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE songs (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- valid states (no CHECK constraint to keep future subsystems flexible):
  -- wizard_in_progress | text_generating | text_ready | text_editing |
  -- music_generating | music_ready | paid | archived | failed
  state           TEXT NOT NULL DEFAULT 'wizard_in_progress',
  occasion        TEXT,
  occasion_custom TEXT,
  genre           TEXT,
  moods_json      TEXT,
  voice           TEXT,
  wishes          TEXT,
  lyrics          TEXT,
  suno_tags       TEXT,
  title           TEXT,
  portrait_json   TEXT,
  metrics_json    TEXT,
  critique_json   TEXT,
  clips_json      TEXT,
  paid_at         INTEGER,
  order_invoice_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  extra_json      TEXT
);
CREATE INDEX idx_songs_session ON songs(session_id);
CREATE INDEX idx_songs_user    ON songs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_songs_state   ON songs(state);

CREATE TABLE email_login_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
```

- [ ] **Step 2: Create the migration runner**

Create `src/web/schema/_migrations.js`:

```js
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
  );

  const files = readdirSync(__dirname)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(__dirname, f), 'utf-8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
    tx();
    console.log(`[db] applied migration ${f}`);
  }
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check src/web/schema/_migrations.js`
Expected: silent success.

- [ ] **Step 4: Commit**

```bash
git add src/web/schema/001_init.sql src/web/schema/_migrations.js
git commit -m "feat(web): initial DB schema + migration runner"
```

---

## Task 8: `src/web/db.js`

**Files:**
- Create: `src/web/db.js`

- [ ] **Step 1: Implement**

Create `src/web/db.js`:

```js
import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';
import { runMigrations } from './schema/_migrations.js';

// Ensure parent dir exists (data/ may be missing on fresh checkout)
mkdirSync(dirname(config.web.dbPath), { recursive: true });

export const db = new Database(config.web.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

runMigrations(db);
```

- [ ] **Step 2: Smoke test the module loads and creates the DB**

Run: `node -e "import('./src/web/db.js').then(m => console.log('OK', m.db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\"').all()))"`

Expected: prints `OK [ { name: 'users' }, { name: 'sqlite_autoindex_users_1' }, ... ]` including `_migrations`, `users`, `sessions`, `songs`, `email_login_codes`.

Verify: `data/db.sqlite` now exists (`ls -la data/`).

- [ ] **Step 3: Commit**

```bash
git add src/web/db.js
git commit -m "feat(web): DB singleton with PRAGMAs + migration auto-run"
```

---

## Task 9: `src/web/services/session-store.js` — session CRUD + atomic migration (TDD)

**Files:**
- Create: `src/web/services/session-store.js`
- Create: `src/web/tests/_helpers.js`
- Create: `src/web/tests/session-store.test.js`

- [ ] **Step 1: Create test helpers**

Create `src/web/tests/_helpers.js`:

```js
import Database from 'better-sqlite3';
import { runMigrations } from '../schema/_migrations.js';

export function makeTestDb() {
  // Use a unique filename per process to allow WAL but make cleanup easy.
  // For absolute isolation use ':memory:' (no WAL but fine for tests).
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function insertGuestSong(db, sessionId, fields = {}) {
  const now = Date.now();
  const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV' + String(now % 10);
  db.prepare(`
    INSERT INTO songs (id, session_id, user_id, state, created_at, updated_at, occasion, wishes)
    VALUES (?, ?, NULL, 'wizard_in_progress', ?, ?, ?, ?)
  `).run(id, sessionId, now, now, fields.occasion || 'bd', fields.wishes || 'для теста');
  return id;
}
```

- [ ] **Step 2: Write failing tests**

Create `src/web/tests/session-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, insertGuestSong } from './_helpers.js';
import {
  createGuestSession, touchSession, rotateOnLogin, deleteSession, findSession,
} from '../services/session-store.js';

const ATTRS = { userAgent: 'Mozilla/5.0', ipHash: 'abc123' };

test('createGuestSession writes row with NULL user_id', () => {
  const db = makeTestDb();
  const sid = createGuestSession(db, ATTRS);
  assert.equal(typeof sid, 'string');
  assert.equal(sid.length, 26);
  const row = findSession(db, sid);
  assert.equal(row.user_id, null);
  assert.equal(row.user_agent, 'Mozilla/5.0');
  assert.equal(row.ip_hash, 'abc123');
  assert.ok(row.expires_at > Date.now());
});

test('touchSession updates last_seen_at; for auth sessions also extends expires_at (sliding)', async () => {
  const db = makeTestDb();
  // Create a user + auth session manually
  const now = Date.now();
  const userInfo = db.prepare('INSERT INTO users (created_at, last_seen_at, telegram_id, display_name) VALUES (?, ?, ?, ?)').run(now, now, 999, 'Test');
  const userId = userInfo.lastInsertRowid;
  const sid = createGuestSession(db, ATTRS);
  // Manually upgrade to auth (rotateOnLogin would create a new sid; here we test touchSession on existing)
  db.prepare('UPDATE sessions SET user_id = ?, expires_at = ? WHERE id = ?').run(userId, now + 1000, sid);
  await new Promise(r => setTimeout(r, 5));
  touchSession(db, sid);
  const row = findSession(db, sid);
  assert.ok(row.last_seen_at > now, 'last_seen_at should advance');
  // For auth session, expires_at should be extended by sessionLifetimeAuthMs (90 days)
  assert.ok(row.expires_at > now + 89 * 24 * 60 * 60 * 1000, 'auth session should slide forward');
});

test('touchSession does NOT extend expires_at for guest sessions', async () => {
  const db = makeTestDb();
  const sid = createGuestSession(db, ATTRS);
  const before = findSession(db, sid).expires_at;
  await new Promise(r => setTimeout(r, 5));
  touchSession(db, sid);
  const after = findSession(db, sid).expires_at;
  assert.equal(before, after, 'guest session expires_at must be fixed');
});

test('rotateOnLogin creates new session, migrates orphan songs, deletes old session, atomically', () => {
  const db = makeTestDb();
  const oldSid = createGuestSession(db, ATTRS);
  insertGuestSong(db, oldSid, { occasion: 'bd' });
  insertGuestSong(db, oldSid, { occasion: 'jub' });
  // Create a user
  const now = Date.now();
  const userId = db.prepare('INSERT INTO users (created_at, last_seen_at, telegram_id, display_name) VALUES (?, ?, ?, ?)').run(now, now, 1234, 'Маша').lastInsertRowid;

  const result = rotateOnLogin(db, oldSid, userId, ATTRS);

  assert.equal(typeof result.newSid, 'string');
  assert.equal(result.newSid.length, 26);
  assert.notEqual(result.newSid, oldSid);
  assert.equal(result.migratedSongsCount, 2);

  // Old session must be gone
  assert.equal(findSession(db, oldSid), undefined);

  // New session exists, attached to user, with auth lifetime
  const newRow = findSession(db, result.newSid);
  assert.equal(newRow.user_id, userId);
  assert.ok(newRow.expires_at > now + 89 * 24 * 60 * 60 * 1000);

  // Songs reattached to new session and user
  const songs = db.prepare('SELECT session_id, user_id FROM songs ORDER BY created_at').all();
  assert.equal(songs.length, 2);
  assert.ok(songs.every(s => s.session_id === result.newSid && s.user_id === userId));
});

test('rotateOnLogin migration count is 0 when no orphan songs', () => {
  const db = makeTestDb();
  const oldSid = createGuestSession(db, ATTRS);
  const now = Date.now();
  const userId = db.prepare('INSERT INTO users (created_at, last_seen_at, telegram_id, display_name) VALUES (?, ?, ?, ?)').run(now, now, 1234, 'Маша').lastInsertRowid;
  const result = rotateOnLogin(db, oldSid, userId, ATTRS);
  assert.equal(result.migratedSongsCount, 0);
});

test('deleteSession removes the row', () => {
  const db = makeTestDb();
  const sid = createGuestSession(db, ATTRS);
  deleteSession(db, sid);
  assert.equal(findSession(db, sid), undefined);
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `node --test src/web/tests/session-store.test.js`
Expected: FAIL with "Cannot find module '../services/session-store.js'".

- [ ] **Step 4: Implement**

Create `src/web/services/session-store.js`:

```js
import { newId } from './ulid.js';
import { config } from '../../config.js';

export function findSession(db, sid) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid);
}

export function createGuestSession(db, { userAgent = null, ipHash = null } = {}) {
  const id = newId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip_hash)
    VALUES (?, NULL, ?, ?, ?, ?, ?)
  `).run(id, now, now + config.web.sessionLifetimeGuestMs, now, userAgent, ipHash);
  return id;
}

export function touchSession(db, sid) {
  const row = findSession(db, sid);
  if (!row) return;
  const now = Date.now();
  // Sliding expiration only for authenticated sessions
  if (row.user_id != null) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now, now + config.web.sessionLifetimeAuthMs, sid);
  } else {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, sid);
  }
}

export function deleteSession(db, sid) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
}

/**
 * Atomically: create new session for user, migrate orphan songs from old session,
 * delete old session. Returns { newSid, migratedSongsCount }.
 */
export function rotateOnLogin(db, oldSid, userId, { userAgent = null, ipHash = null } = {}) {
  const newSid = newId();
  const now = Date.now();

  let migratedSongsCount = 0;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(newSid, userId, now, now + config.web.sessionLifetimeAuthMs, now, userAgent, ipHash);

    const result = db.prepare(`
      UPDATE songs SET session_id = ?, user_id = ?, updated_at = ?
      WHERE session_id = ? AND user_id IS NULL
    `).run(newSid, userId, now, oldSid);
    migratedSongsCount = result.changes;

    db.prepare('DELETE FROM sessions WHERE id = ?').run(oldSid);
  });
  tx();

  return { newSid, migratedSongsCount };
}

export function deleteExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
}

export function deleteOrphanGuestSongs(db) {
  // Songs whose session has been deleted are auto-removed by FK CASCADE.
  // This function exists for songs that survived (e.g. session still alive but song stale beyond TTL).
  // For Foundation we don't need it yet — kept here as no-op to clarify intent.
  return 0;
}
```

> Note: `IP_HASH_SALT` must be set in env before importing `session-store.js`'s callers. Tests set it themselves; production reads from `.env` via `dotenv/config`.

- [ ] **Step 5: Run tests, verify all pass**

Run: `IP_HASH_SALT=test-salt-aaa node --test src/web/tests/session-store.test.js`

(On Windows PowerShell: `$env:IP_HASH_SALT='test-salt-aaa'; node --test src/web/tests/session-store.test.js`.)

Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/services/session-store.js src/web/tests/session-store.test.js src/web/tests/_helpers.js
git commit -m "feat(web): session store with atomic guest→user migration + tests"
```

---

## Task 10: `src/web/middleware/error.js`

**Files:**
- Create: `src/web/middleware/error.js`

- [ ] **Step 1: Implement**

Create `src/web/middleware/error.js`:

```js
import { HttpError } from '../lib/http-errors.js';

export function registerErrorHandler(app) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send({ ok: false, error: err.message, code: err.code });
      return;
    }
    // Unknown errors: log full detail, return generic 500 (don't leak internals)
    req.log.error({ err }, 'unhandled error');
    reply.code(500).send({ ok: false, error: 'Internal Server Error', code: 'INTERNAL' });
  });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/web/middleware/error.js`
Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add src/web/middleware/error.js
git commit -m "feat(web): error handler middleware"
```

---

## Task 11: `src/web/middleware/session.js`

**Files:**
- Create: `src/web/middleware/session.js`

- [ ] **Step 1: Implement**

Create `src/web/middleware/session.js`:

```js
import { config } from '../../config.js';
import { db } from '../db.js';
import { findSession, createGuestSession, touchSession } from '../services/session-store.js';
import { hashIp } from '../services/ip-hash.js';

const COOKIE_OPTS = {
  domain: config.web.cookieDomain,
  httpOnly: true,
  secure: config.web.cookieSecure,
  sameSite: 'lax',
  path: '/',
};

function cookieMaxAge(isAuth) {
  const ms = isAuth ? config.web.sessionLifetimeAuthMs : config.web.sessionLifetimeGuestMs;
  return Math.floor(ms / 1000);
}

export function registerSessionMiddleware(app) {
  app.addHook('onRequest', async (req, reply) => {
    const sidFromCookie = req.cookies[config.web.cookieName];
    let session = sidFromCookie ? findSession(db, sidFromCookie) : null;

    // Expired? Treat as missing
    if (session && session.expires_at < Date.now()) {
      session = null;
    }

    if (!session) {
      const ua = req.headers['user-agent'] || null;
      const ipHash = req.ip ? hashIp(req.ip) : null;
      const newSid = createGuestSession(db, { userAgent: ua, ipHash });
      session = findSession(db, newSid);
      reply.setCookie(config.web.cookieName, newSid, {
        ...COOKIE_OPTS,
        maxAge: cookieMaxAge(false),
      });
    } else {
      touchSession(db, session.id);
      // Re-set cookie to keep maxAge sliding for auth sessions in browser
      if (session.user_id != null) {
        reply.setCookie(config.web.cookieName, session.id, {
          ...COOKIE_OPTS,
          maxAge: cookieMaxAge(true),
        });
      }
    }

    req.session = session;
    req.user = null;
    if (session.user_id != null) {
      req.user = db.prepare('SELECT id, telegram_id, email, display_name, avatar_initials FROM users WHERE id = ?').get(session.user_id);
    }
  });
}

export function clearSessionCookie(reply) {
  reply.setCookie(config.web.cookieName, '', {
    ...COOKIE_OPTS,
    maxAge: 0,
  });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/web/middleware/session.js`
Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add src/web/middleware/session.js
git commit -m "feat(web): session middleware (guest creation + sliding auth)"
```

---

## Task 12: `src/web/routes/health.js`

**Files:**
- Create: `src/web/routes/health.js`

- [ ] **Step 1: Implement**

Create `src/web/routes/health.js`:

```js
export async function registerHealthRoutes(app) {
  app.get('/api/health', async () => {
    return { ok: true, ts: Date.now() };
  });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/web/routes/health.js`
Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add src/web/routes/health.js
git commit -m "feat(web): /api/health route"
```

---

## Task 13: `src/web/routes/auth.js`

**Files:**
- Create: `src/web/routes/auth.js`

- [ ] **Step 1: Implement**

Create `src/web/routes/auth.js`:

```js
import { config } from '../../config.js';
import { db } from '../db.js';
import { verifyTelegramHash } from '../services/telegram-login.js';
import { rotateOnLogin, deleteSession } from '../services/session-store.js';
import { hashIp } from '../services/ip-hash.js';
import { unauthorized, badRequest } from '../lib/http-errors.js';
import { clearSessionCookie } from '../middleware/session.js';

function avatarInitials(firstName = '', lastName = '') {
  const a = (firstName.trim()[0] || '').toUpperCase();
  const b = (lastName.trim()[0] || '').toUpperCase();
  return (a + b) || '??';
}

const callbackBodySchema = {
  type: 'object',
  required: ['id', 'first_name', 'auth_date', 'hash'],
  properties: {
    id:         { type: ['integer', 'string'] },
    first_name: { type: 'string', maxLength: 200 },
    last_name:  { type: 'string', maxLength: 200 },
    username:   { type: 'string', maxLength: 200 },
    photo_url:  { type: 'string', maxLength: 500 },
    auth_date:  { type: ['integer', 'string'] },
    hash:       { type: 'string', minLength: 64, maxLength: 64 },
  },
  additionalProperties: false,
};

export async function registerAuthRoutes(app) {
  app.get('/api/auth/me', async (req) => {
    if (req.user) {
      return {
        guest: false,
        user: {
          display_name:    req.user.display_name,
          avatar_initials: req.user.avatar_initials,
        },
      };
    }
    return { guest: true };
  });

  app.post('/api/auth/telegram/callback', { schema: { body: callbackBodySchema } }, async (req, reply) => {
    const payload = req.body;
    if (!verifyTelegramHash(payload, config.telegram.token)) {
      throw unauthorized('Invalid Telegram signature', 'TELEGRAM_HMAC_INVALID');
    }

    const telegramId = Number(payload.id);
    if (!Number.isFinite(telegramId)) {
      throw badRequest('Invalid Telegram id', 'TELEGRAM_ID_INVALID');
    }

    const displayName = payload.first_name + (payload.last_name ? ' ' + payload.last_name : '');
    const initials = avatarInitials(payload.first_name, payload.last_name || '');
    const now = Date.now();

    // Upsert user
    db.prepare(`
      INSERT INTO users (telegram_id, display_name, avatar_initials, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        display_name    = excluded.display_name,
        avatar_initials = excluded.avatar_initials,
        last_seen_at    = excluded.last_seen_at
    `).run(telegramId, displayName, initials, now, now);

    const user = db.prepare('SELECT id, display_name, avatar_initials FROM users WHERE telegram_id = ?').get(telegramId);

    const ipHash = req.ip ? hashIp(req.ip) : null;
    const ua = req.headers['user-agent'] || null;
    const { newSid, migratedSongsCount } = rotateOnLogin(db, req.session.id, user.id, { userAgent: ua, ipHash });

    reply.setCookie(config.web.cookieName, newSid, {
      domain: config.web.cookieDomain,
      httpOnly: true,
      secure: config.web.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(config.web.sessionLifetimeAuthMs / 1000),
    });

    return {
      ok: true,
      user: {
        display_name:    user.display_name,
        avatar_initials: user.avatar_initials,
      },
      migrated_songs_count: migratedSongsCount,
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.session) deleteSession(db, req.session.id);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/web/routes/auth.js`
Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add src/web/routes/auth.js
git commit -m "feat(web): auth routes (me, telegram callback, logout)"
```

---

## Task 14: `src/web/server.js` — wire everything

**Files:**
- Create: `src/web/server.js`

- [ ] **Step 1: Implement**

Create `src/web/server.js`:

```js
import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { config, assertWebConfig } from '../config.js';
import { db } from './db.js';
import { registerErrorHandler } from './middleware/error.js';
import { registerSessionMiddleware } from './middleware/session.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';

assertWebConfig();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  trustProxy: true, // we sit behind nginx
});

await app.register(cookie);
await app.register(cors, {
  origin: config.web.publicUrl,
  credentials: true,
});

registerErrorHandler(app);
registerSessionMiddleware(app);

await registerHealthRoutes(app);
await registerAuthRoutes(app);

// Cleanup job: every hour delete expired sessions (guest songs CASCADE-drop with them)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const cleanupTimer = setInterval(() => {
  try {
    const expired = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
    if (expired > 0) {
      app.log.info({ expired_sessions: expired }, '[cleanup] removed expired sessions');
    }
  } catch (e) {
    app.log.error({ err: e }, '[cleanup] failed');
  }
}, CLEANUP_INTERVAL_MS);

async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  clearInterval(cleanupTimer);
  await app.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ port: config.web.port, host: '127.0.0.1' });
  app.log.info({ port: config.web.port, apiPublicUrl: config.web.apiPublicUrl }, 'podari-web ready');
} catch (e) {
  app.log.error({ err: e }, 'failed to start');
  process.exit(1);
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/web/server.js`
Expected: silent success.

- [ ] **Step 3: Local smoke test**

Set up env temporarily and start server:

PowerShell:
```powershell
$env:IP_HASH_SALT='test-salt-local-aaaaaa'
$env:TELEGRAM_BOT_TOKEN='123456789:test_dummy_for_smoke_only'
$env:COOKIE_SECURE='false'
$env:WEB_PORT='8090'
node src/web/server.js
```

Bash:
```bash
IP_HASH_SALT=test-salt-local-aaaaaa TELEGRAM_BOT_TOKEN=123456789:test_dummy_for_smoke_only COOKIE_SECURE=false WEB_PORT=8090 node src/web/server.js
```

In another terminal:
```bash
curl -i http://127.0.0.1:8090/api/health
```

Expected: HTTP 200, body `{"ok":true,"ts":<number>}`. Server log shows `incoming request` + `request completed`.

Then:
```bash
curl -i -c cookies.txt http://127.0.0.1:8090/api/auth/me
```
Expected: 200 with `{"guest":true}` and a `Set-Cookie: pp_sid=...` header.

```bash
curl -i -b cookies.txt http://127.0.0.1:8090/api/auth/me
```
Expected: 200, same `{"guest":true}`, no new Set-Cookie (or the same sid because session still valid).

Stop server (Ctrl+C). Verify clean shutdown log.

- [ ] **Step 4: Commit**

```bash
git add src/web/server.js
git commit -m "feat(web): Fastify server entrypoint with cleanup job + signals"
```

---

## Task 15: Integration test for full auth flow

**Files:**
- Create: `src/web/tests/auth-flow.test.js`

- [ ] **Step 1: Write the test**

Create `src/web/tests/auth-flow.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

// Set env BEFORE importing modules that read config
process.env.IP_HASH_SALT = 'integration-test-salt';
process.env.TELEGRAM_BOT_TOKEN = '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_DOMAIN = 'localhost';
process.env.DATABASE_PATH = ':memory:';

const TEST_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function buildValidPayload(userFields, botToken = TEST_BOT_TOKEN) {
  const dataCheckString = Object.keys(userFields).sort()
    .map(k => `${k}=${userFields[k]}`).join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...userFields, hash };
}

let app;
let dbModule;

before(async () => {
  // Dynamic import after env is set
  const { registerErrorHandler } = await import('../middleware/error.js');
  const { registerSessionMiddleware } = await import('../middleware/session.js');
  const { registerHealthRoutes } = await import('../routes/health.js');
  const { registerAuthRoutes } = await import('../routes/auth.js');
  dbModule = await import('../db.js');

  app = Fastify({ logger: false });
  await app.register(cookie);
  registerErrorHandler(app);
  registerSessionMiddleware(app);
  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await app.ready();
});

after(async () => {
  if (app) await app.close();
});

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of arr) {
    const m = c.match(/pp_sid=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

test('GET /api/health returns ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.ts, 'number');
});

test('GET /api/auth/me without cookie returns guest + sets cookie', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { guest: true });
  const sid = extractCookie(res.headers['set-cookie']);
  assert.ok(sid, 'expected pp_sid cookie to be set');
  assert.equal(sid.length, 26, 'sid should be a ULID');
});

test('GET /api/auth/me with existing cookie returns guest, reuses session', async () => {
  const first = await app.inject({ method: 'GET', url: '/api/auth/me' });
  const sid = extractCookie(first.headers['set-cookie']);
  const second = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: `pp_sid=${sid}` },
  });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), { guest: true });
  // Verify session still exists with same id
  const row = dbModule.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sid);
  assert.equal(row.id, sid);
});

test('POST /api/auth/telegram/callback with invalid HMAC returns 401', async () => {
  const payload = buildValidPayload({
    id: 99999,
    first_name: 'Bad',
    auth_date: Math.floor(Date.now() / 1000),
  });
  payload.hash = '0'.repeat(64);
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/telegram/callback',
    payload,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'TELEGRAM_HMAC_INVALID');
});

test('POST /api/auth/telegram/callback with valid HMAC creates user, rotates session, migrates songs', async () => {
  // Step 1: get a guest session
  const guestRes = await app.inject({ method: 'GET', url: '/api/auth/me' });
  const oldSid = extractCookie(guestRes.headers['set-cookie']);

  // Step 2: insert a guest song attached to this session
  const now = Date.now();
  dbModule.db.prepare(`
    INSERT INTO songs (id, session_id, user_id, state, created_at, updated_at, occasion, wishes)
    VALUES (?, ?, NULL, 'wizard_in_progress', ?, ?, 'bd', 'тестовая')
  `).run('01TEST' + 'A'.repeat(20), oldSid, now, now);

  // Step 3: log in
  const userFields = {
    id: 12345678,
    first_name: 'Маша',
    last_name: 'Тест',
    auth_date: Math.floor(Date.now() / 1000),
  };
  const payload = buildValidPayload(userFields);

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/telegram/callback',
    payload,
    headers: {
      'content-type': 'application/json',
      cookie: `pp_sid=${oldSid}`,
    },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.display_name, 'Маша Тест');
  assert.equal(body.user.avatar_initials, 'МТ');
  assert.equal(body.migrated_songs_count, 1);

  const newSid = extractCookie(res.headers['set-cookie']);
  assert.ok(newSid);
  assert.notEqual(newSid, oldSid);

  // Old session must be gone
  const oldRow = dbModule.db.prepare('SELECT id FROM sessions WHERE id = ?').get(oldSid);
  assert.equal(oldRow, undefined);

  // New session attached to new user
  const newRow = dbModule.db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(newSid);
  assert.ok(newRow.user_id);

  // Song migrated
  const songRow = dbModule.db.prepare('SELECT session_id, user_id FROM songs WHERE session_id = ?').get(newSid);
  assert.equal(songRow.session_id, newSid);
  assert.equal(songRow.user_id, newRow.user_id);

  // GET /me with the new cookie now returns user
  const meRes = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: `pp_sid=${newSid}` },
  });
  assert.equal(meRes.statusCode, 200);
  const meBody = meRes.json();
  assert.equal(meBody.guest, false);
  assert.equal(meBody.user.display_name, 'Маша Тест');
});

test('POST /api/auth/logout removes session and clears cookie', async () => {
  // Get a session first
  const r1 = await app.inject({ method: 'GET', url: '/api/auth/me' });
  const sid = extractCookie(r1.headers['set-cookie']);

  const r2 = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: `pp_sid=${sid}` },
  });
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.json().ok, true);

  // Cookie cleared (Max-Age=0)
  const setCookie = r2.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  assert.ok(arr.some(c => /pp_sid=/.test(c) && /Max-Age=0/.test(c)));

  // Session row is gone
  const row = dbModule.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sid);
  assert.equal(row, undefined);
});
```

- [ ] **Step 2: Run integration tests**

Run: `node --test src/web/tests/auth-flow.test.js`
Expected: 6 tests PASS.

If any fail: read the assertion error carefully, fix the corresponding production file, re-run.

- [ ] **Step 3: Run the full test suite to ensure no regression**

Run: `npm test`
Expected: ALL tests pass — pre-existing AI tests + new web tests.

- [ ] **Step 4: Run full check script**

Run: `npm run check`
Expected: silent success for every file in the list.

- [ ] **Step 5: Commit**

```bash
git add src/web/tests/auth-flow.test.js
git commit -m "test(web): integration tests for full auth flow"
```

---

## Task 16: Frontend wiring — `auth.html` + `app.js` updates

**Files:**
- Modify: `site/auth.html`
- Modify: `site/assets/app.js`

> Context: The existing `auth.html` is a static mock from the prototype. We add the Telegram Login Widget and a small JS handler. The existing `app.js` `renderHeader({signedIn})` rendering already supports a `signedIn` flag — we make it auto-detect by calling `/api/auth/me`.

- [ ] **Step 1: Read current `site/auth.html` to find the right insertion point**

Run: open `site/auth.html` in editor.

Look for the section labeled (in Russian) «Войти через Telegram» — it likely contains a placeholder button. Note the structure (probably a `<form>` or `<div class="auth-card">` with a login button).

- [ ] **Step 2: Replace the Telegram login button with the official widget**

In `site/auth.html`, find the current "Войти через Telegram" button (likely a `<button>` or `<a>` with that text) and replace its inner content with the Telegram Login Widget script tag plus a fallback button.

Insert (adjust selector based on actual auth.html structure):

```html
<!-- Telegram Login Widget -->
<script async src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login="podaripesniu_bot"
        data-size="large"
        data-radius="12"
        data-onauth="onTelegramAuth(user)"
        data-request-access="write"></script>
<noscript>
  <p>Для входа через Telegram требуется JavaScript.</p>
</noscript>
```

- [ ] **Step 3: Add `onTelegramAuth` and `/api/auth/me` integration to `site/assets/app.js`**

Append to the end of `site/assets/app.js`:

```js
// === Foundation backend integration (subsystem #1) ===

PT.api = 'https://api.xn--e1anecfn9ge.xn--p1ai';

PT.fetchMe = async function() {
  try {
    const r = await fetch(PT.api + '/api/auth/me', { credentials: 'include' });
    if (!r.ok) return { guest: true };
    return await r.json();
  } catch (e) {
    console.warn('[PT] /me failed:', e);
    return { guest: true };
  }
};

PT.logout = async function() {
  try {
    await fetch(PT.api + '/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (e) {
    console.warn('[PT] logout failed:', e);
  }
  location.href = 'landing.html';
};

// Global callback for Telegram Login Widget
window.onTelegramAuth = async function(user) {
  try {
    const r = await fetch(PT.api + '/api/auth/telegram/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(user),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert('Не удалось войти через Telegram: ' + (err.error || r.status));
      return;
    }
    const data = await r.json();
    if (data.migrated_songs_count > 0) {
      sessionStorage.setItem('pt_migrated', String(data.migrated_songs_count));
    }
    location.href = 'cabinet.html';
  } catch (e) {
    alert('Сбой соединения с сервером: ' + e.message);
  }
};

// Auto-detect signed-in state for any header rendered with [data-pt-header]
// (overrides static data-signed-in attribute by re-rendering after fetch)
document.addEventListener('DOMContentLoaded', async () => {
  const me = await PT.fetchMe();
  document.querySelectorAll('header.site-header').forEach(el => {
    const isSignedIn = !me.guest;
    // Re-render header by replacing it
    const active = el.dataset.active || '';
    el.outerHTML = PT.renderHeader({ signedIn: isSignedIn, active });
  });
  // Show "migrated N drafts" toast on cabinet page
  if (location.pathname.endsWith('/cabinet.html')) {
    const n = sessionStorage.getItem('pt_migrated');
    if (n) {
      sessionStorage.removeItem('pt_migrated');
      // Minimal toast — tweak styling later
      const toast = document.createElement('div');
      toast.textContent = `✨ Перенесли ${n} черновик(ов) в твой кабинет`;
      toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#10b981;color:#fff;padding:14px 20px;border-radius:12px;font-family:var(--font-display);z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }
  }
});
```

> Note: this re-rendering after fetch is intentional — it overrides the static `data-signed-in` attribute (which the existing DOMContentLoaded listener uses) with the actual server state. There may be a brief flash of the unauthenticated header for ~50-200ms while `/api/auth/me` resolves; acceptable for Foundation. A more polished approach (skeleton header) belongs in subsystem #3 (cabinet UX polish).

- [ ] **Step 4: Local browser smoke test (optional but useful)**

Open `site/auth.html` directly in a browser (file:// or local static server). Confirm: page renders without JS errors. The Telegram widget will fail to load against a `localhost` domain (BotFather domain is `мояпесня.рф`), but the page should not crash.

- [ ] **Step 5: Commit**

```bash
git add site/auth.html site/assets/app.js
git commit -m "feat(site): wire Telegram Login Widget + /api/auth/me autodetect"
```

---

## Task 17: Cloud one-time setup — DNS + nginx + cert + secrets + systemd

> This task is executed on the cloud server (`84.54.59.163`), not locally. Each step is a single command or a single config edit. The implementing engineer should have SSH access to `user1@84.54.59.163` and Beget control panel access.

**Pre-requisite check:**

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 'node --version 2>/dev/null || echo MISSING'
```

If output is `MISSING`, do Step 1. If `v22.x` or higher, skip to Step 2.

- [ ] **Step 1: Install Node.js 22 on cloud (skip if already present)**

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs && node --version'
```

Expected: prints `v22.x.y`.

- [ ] **Step 2: Add DNS A-record in Beget control panel**

Login to Beget → Управление DNS → `мояпесня.рф` → Add record:
- Type: `A`
- Name: `api`
- Value: `84.54.59.163`
- TTL: 3600

Verify (wait ~1 minute for propagation):

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 'dig +short api.xn--e1anecfn9ge.xn--p1ai @1.1.1.1'
```

Expected: prints `84.54.59.163`.

- [ ] **Step 3: Generate IP_HASH_SALT and store**

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 'openssl rand -hex 32'
```

Output is the salt. **Save this value to:**
- Cloud `.env` (Step 4 below)
- `C:\Vault\Projects\suno-sales\SECRETS.md` (locally, append a line `IP_HASH_SALT=<value>`)

- [ ] **Step 4: Update cloud `.env` with web settings**

SSH in:
```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163
```

Then on the cloud:
```bash
cd ~/projects/moyapesnya
# Append to existing .env (do NOT overwrite — it has SUNO_API_BASE, OPENROUTER_API_KEY, AI_*, TELEGRAM_BOT_TOKEN already)
cat >> .env <<'EOF'

# Web backend (subsystem #1 Foundation)
WEB_PORT=8090
WEB_PUBLIC_URL=https://мояпесня.рф
WEB_API_PUBLIC_URL=https://api.мояпесня.рф
DATABASE_PATH=/home/user1/projects/moyapesnya/data/db.sqlite
COOKIE_SECURE=true
COOKIE_DOMAIN=xn--e1anecfn9ge.xn--p1ai
IP_HASH_SALT=<paste the salt from Step 3 here>
EOF
chmod 600 .env
```

Verify TELEGRAM_BOT_TOKEN already present:
```bash
grep ^TELEGRAM_BOT_TOKEN= .env && echo OK || echo MISSING_NEED_TO_ADD
```

If `MISSING_NEED_TO_ADD`: read `TELEGRAM_BOT_TOKEN` value from mini-PC `.env` (`wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'grep ^TELEGRAM_BOT_TOKEN= ~/projects/moyapesnya/.env'`) and append to cloud `.env`.

- [ ] **Step 5: Pull latest code on cloud, install deps**

Still SSH'd into cloud:
```bash
cd ~/projects/moyapesnya
git pull
mkdir -p data
npm install
# Verify the syntax check passes including web files
npm run check
```

Expected: silent success (every checked file). If `node-gyp` errors during `better-sqlite3` build: install build tools `sudo apt-get install -y python3 build-essential` and re-run `npm install`.

- [ ] **Step 6: Test locally on cloud (without nginx, against 127.0.0.1)**

```bash
node src/web/server.js &
sleep 3
curl -s http://127.0.0.1:8090/api/health
kill %1
```

Expected: `{"ok":true,"ts":<num>}`. If error about missing env: check `.env` contents.

- [ ] **Step 7: Create nginx server-block**

Still on cloud:
```bash
sudo tee /etc/nginx/sites-available/podari-api.conf > /dev/null <<'EOF'
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
EOF
sudo ln -sf /etc/nginx/sites-available/podari-api.conf /etc/nginx/sites-enabled/podari-api.conf
sudo nginx -t
sudo systemctl reload nginx
```

Expected: `nginx: configuration file ... test is successful`.

- [ ] **Step 8: Issue Let's Encrypt cert via certbot**

```bash
sudo certbot --nginx -d api.xn--e1anecfn9ge.xn--p1ai --non-interactive --agree-tos --email arkestrator@yandex.com --redirect
```

Expected: cert issued, nginx config auto-rewritten to listen 443 + redirect 80→443. Verify:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://api.мояпесня.рф/api/health
```

Wait — `api.мояпесня.рф` may not resolve via `curl` until DNS prop. Use punycode if needed:

```bash
curl -sI https://api.xn--e1anecfn9ge.xn--p1ai/api/health
```

Expected: `HTTP/2 502 Bad Gateway` (because we haven't started the systemd unit yet). That's fine — proves nginx + cert work.

- [ ] **Step 9: Install systemd unit**

```bash
sudo tee /etc/systemd/system/podari-web.service > /dev/null <<'EOF'
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
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now podari-web
sleep 3
sudo systemctl status podari-web --no-pager
```

Expected: status shows `active (running)`. Logs show `podari-web ready` line.

- [ ] **Step 10: Verify end-to-end**

```bash
curl -i https://api.xn--e1anecfn9ge.xn--p1ai/api/health
```

Expected: `HTTP/2 200`, body `{"ok":true,"ts":<num>}`.

- [ ] **Step 11: Commit nothing (no repo changes for cloud setup)**

This task only modifies the cloud server, not the repo. Document what was done in CONTINUITY.md (next task).

---

## Task 18: Update CONTINUITY.md with deploy outcome

**Files:**
- Modify: `CONTINUITY.md`

- [ ] **Step 1: Read current CONTINUITY.md**

Run: `cat CONTINUITY.md | head -80`

Find the section for Site Backend / Foundation deploy. Add an entry under the existing "Done (2026-05-03) — Site Backend подпроект запущен" section (or create a new dated section if implementation happens on a later date).

- [ ] **Step 2: Append deployment note**

In CONTINUITY.md, under the relevant `Done` section, add:

```markdown
### Foundation deployed to cloud (commit `<head sha>`)

- DNS: `api.мояпесня.рф A 84.54.59.163` (Beget) — propagated
- TLS: Let's Encrypt cert via `certbot --nginx -d api.xn--e1anecfn9ge.xn--p1ai`
- nginx: `/etc/nginx/sites-enabled/podari-api.conf` proxies `/` → `127.0.0.1:8090`
- systemd: `podari-web.service` enabled + active. Logs via `journalctl -u podari-web`
- DB: `/home/user1/projects/moyapesnya/data/db.sqlite` created, all 4 tables present
- Secrets: `IP_HASH_SALT` generated via `openssl rand -hex 32` → cloud `.env` + Vault SECRETS.md
- Smoke tests PASS: `/api/health`, `/api/auth/me` (guest cookie issued), live Telegram login flow
```

- [ ] **Step 3: Commit**

```bash
git add CONTINUITY.md
git commit -m "docs(continuity): foundation backend deployed to cloud"
```

---

## Task 19: Live smoke tests (acceptance criteria from spec)

> Run AFTER Task 17 deploy is complete. These verify the spec's 10 acceptance criteria.

- [ ] **AC1: `/api/health` returns ok**

```bash
curl -s https://api.xn--e1anecfn9ge.xn--p1ai/api/health
```
Expected: `{"ok":true,"ts":<num>}`.

- [ ] **AC2: First visit to auth.html issues `pp_sid` cookie**

In a fresh incognito browser window: navigate to `https://мояпесня.рф/auth.html`. Open DevTools → Application → Cookies → `мояпесня.рф`. Verify `pp_sid` exists with `HttpOnly`, `Secure`, `Domain=.xn--e1anecfn9ge.xn--p1ai`, `Path=/`.

- [ ] **AC3: Telegram login button works end-to-end**

In the same browser: click the Telegram Login Widget button. Complete the login in Telegram (mobile or QR). Should redirect to `cabinet.html`. Header should show user avatar/name instead of «Войти». DevTools → Network → check `/api/auth/telegram/callback` returned 200 and `/api/auth/me` returned `{guest: false, user: {...}}`.

- [ ] **AC4: `/api/auth/me` returns user after login**

In DevTools console:
```js
fetch('https://api.xn--e1anecfn9ge.xn--p1ai/api/auth/me', { credentials: 'include' }).then(r => r.json()).then(console.log);
```
Expected: `{guest: false, user: {display_name: '...', avatar_initials: '...'}}`.

- [ ] **AC5: Guest song migration verifiable in DB**

On cloud:
```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163
sudo apt-get install -y sqlite3  # if missing
cd ~/projects/moyapesnya
sqlite3 data/db.sqlite "SELECT id, session_id, user_id, state FROM songs ORDER BY created_at DESC LIMIT 5;"
```

If user just logged in, songs created during their guest period should now have non-NULL `user_id`. (For Foundation we don't insert songs via UI — to test, manually insert a row before login: `sqlite3 data/db.sqlite "INSERT INTO songs (id, session_id, user_id, state, created_at, updated_at) VALUES ('01TESTAAAAAAAAAAAAAAAAAAAAA', '<your guest sid from cookie>', NULL, 'wizard_in_progress', strftime('%s','now')*1000, strftime('%s','now')*1000);"` — then log in — then re-query and confirm `user_id` populated.)

- [ ] **AC6: Logout removes session**

In browser: trigger `PT.logout()` from DevTools console. Expected: redirected to landing.html. Re-fetch `/api/auth/me` → `{guest: true}`. New `pp_sid` cookie issued.

- [ ] **AC7: systemd auto-restart works**

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 'sudo systemctl kill --signal=SIGKILL podari-web; sleep 6; sudo systemctl status podari-web --no-pager | head -5'
```

Expected: status shows `active (running)` again — Restart=always picked it up within 5s.

- [ ] **AC8: `npm test` is green**

Locally on dev machine:
```bash
npm test
```
Expected: ALL pre-existing AI tests + 6+5+3+3+6 = 23 web tests PASS.

- [ ] **AC9: Static site continues to work**

Navigate `https://мояпесня.рф/landing.html`, then `cabinet.html`. Pages render without JS errors. (`cabinet.html` shows mock data — that's fine, real data lives in subsystem #3.)

- [ ] **AC10: SQLite has all tables + migration record**

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 'cd ~/projects/moyapesnya && sqlite3 data/db.sqlite ".tables" && sqlite3 data/db.sqlite "SELECT * FROM _migrations"'
```

Expected: tables list includes `_migrations`, `users`, `sessions`, `songs`, `email_login_codes`. `_migrations` has row with `name='001_init.sql'` and `applied_at=<unix ms>`.

- [ ] **Final: Mark Foundation as complete**

Update CONTINUITY.md: move Foundation from "in progress" to "Done" with summary of what works. Move to subsystem #2 in Next.

```bash
git add CONTINUITY.md
git commit -m "docs(continuity): foundation acceptance criteria met"
```

---

## Notes for the implementing engineer

- **Dependency native build:** `better-sqlite3` requires a native build. On Linux it's automatic. On Windows it requires Visual Studio Build Tools (`npm install --global windows-build-tools` or install via VS installer). On the cloud (Ubuntu 24.04) it works out of the box.
- **ESM `import` paths:** all imports must include `.js` extension explicitly (e.g. `from '../config.js'`). Node.js ESM doesn't auto-resolve.
- **No TypeScript:** the project intentionally uses plain JS. Don't add tsconfig or .d.ts files.
- **Logs go through pino:** Fastify's logger is pino under the hood. Use `req.log.info({field: value}, 'message')` — structured logs, not string concatenation.
- **`req.cookies` parser:** `@fastify/cookie` populates `req.cookies` automatically after registration. Don't manually parse cookie headers.
- **Punycode in cookie domain:** `Set-Cookie: ... Domain=мояпесня.рф` will be silently ignored by some browsers. Always use `xn--e1anecfn9ge.xn--p1ai`.
- **In-memory SQLite for tests:** `new Database(':memory:')` is fast, isolated, and discards on close. Real WAL mode is tested implicitly via the cloud smoke tests.
- **First task before any code change:** verify pre-flight assumptions at top of plan. If any is false, flag and halt.

---

## Quick reference — what each file does (for cold-start review)

| File | One-line purpose |
|---|---|
| `package.json` | Adds 5 deps + extends scripts. |
| `src/config.js` | New `web` section + `assertWebConfig()`. |
| `src/web/lib/http-errors.js` | `HttpError` + factories. |
| `src/web/services/ulid.js` | `newId()` → ULID string. |
| `src/web/services/ip-hash.js` | `hashIp(ip)` → SHA-256 hex with salt. |
| `src/web/services/telegram-login.js` | `verifyTelegramHash(payload, token)` → boolean. |
| `src/web/schema/001_init.sql` | DDL for 4 tables + indexes. |
| `src/web/schema/_migrations.js` | `runMigrations(db)`. |
| `src/web/db.js` | better-sqlite3 singleton + PRAGMAs + auto-migrate. |
| `src/web/services/session-store.js` | `createGuestSession`, `touchSession`, `rotateOnLogin`, `deleteSession`, `findSession`. |
| `src/web/middleware/error.js` | `registerErrorHandler(app)`. |
| `src/web/middleware/session.js` | `registerSessionMiddleware(app)` + `clearSessionCookie(reply)`. |
| `src/web/routes/health.js` | `registerHealthRoutes(app)`. |
| `src/web/routes/auth.js` | `registerAuthRoutes(app)`. |
| `src/web/server.js` | Fastify entrypoint, cleanup-job, signal handlers. |
| `src/web/tests/_helpers.js` | `makeTestDb()`, `insertGuestSong()`. |
| `src/web/tests/*.test.js` | Unit + integration tests. |
| `site/auth.html` | Telegram Login Widget embed. |
| `site/assets/app.js` | `PT.fetchMe`, `PT.logout`, `window.onTelegramAuth`, header auto-detect. |
