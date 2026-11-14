import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const migrations = [
  new URL('./migrations/001-initial.sql', import.meta.url),
  new URL('./migrations/002-poll-comments.sql', import.meta.url),
  new URL('./migrations/003-google-identity.sql', import.meta.url)
];

export function openDatabase(filename = process.env.PICKSY_DB_PATH || 'data/picksy.sqlite') {
  const databasePath = filename === ':memory:' ? filename : resolve(filename);
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (databasePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');

  for (const [index, migrationPath] of migrations.entries()) {
    const version = index + 1;
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
    if (applied) continue;
    const migration = readFileSync(fileURLToPath(migrationPath), 'utf8');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(migration);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      db.close();
      throw error;
    }
  }

  return db;
}
