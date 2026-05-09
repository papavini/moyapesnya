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
