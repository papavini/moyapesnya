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
