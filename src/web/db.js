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
