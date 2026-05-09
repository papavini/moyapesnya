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
  const guestRes = await app.inject({ method: 'GET', url: '/api/auth/me' });
  const oldSid = extractCookie(guestRes.headers['set-cookie']);

  const now = Date.now();
  const songId = '01TEST' + 'A'.repeat(20);
  dbModule.db.prepare(`
    INSERT INTO songs (id, session_id, user_id, state, created_at, updated_at, occasion, wishes)
    VALUES (?, ?, NULL, 'wizard_in_progress', ?, ?, 'bd', 'тестовая')
  `).run(songId, oldSid, now, now);

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
