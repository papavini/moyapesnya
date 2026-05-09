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
