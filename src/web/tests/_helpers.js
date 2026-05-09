import Database from 'better-sqlite3';
import { runMigrations } from '../schema/_migrations.js';
import { newId } from '../services/ulid.js';

export function makeTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function insertGuestSong(db, sessionId, fields = {}) {
  const now = Date.now();
  const id = newId();
  db.prepare(`
    INSERT INTO songs (id, session_id, user_id, state, created_at, updated_at, occasion, wishes)
    VALUES (?, ?, NULL, 'wizard_in_progress', ?, ?, ?, ?)
  `).run(id, sessionId, now, now, fields.occasion || 'bd', fields.wishes || 'для теста');
  return id;
}
