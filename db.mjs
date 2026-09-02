import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(dataDir, 'app.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE,
    password_hash TEXT,
    name          TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    is_anon       INTEGER NOT NULL DEFAULT 0,
    theme         TEXT NOT NULL DEFAULT 'night',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider, provider_user_id)
  );

  CREATE TABLE IF NOT EXISTS oauth_state (
    state            TEXT PRIMARY KEY,
    provider         TEXT NOT NULL,
    promote_user_id  TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function hasColumn(table, column) {
  return db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column) !== undefined;
}

// --- Migrations for databases created before is_anon / nullable email / oauth promotion existed ---

if (!hasColumn('users', 'is_anon')) {
  db.exec(`ALTER TABLE users ADD COLUMN is_anon INTEGER NOT NULL DEFAULT 0`);
}

if (!hasColumn('oauth_state', 'promote_user_id')) {
  db.exec(`ALTER TABLE oauth_state ADD COLUMN promote_user_id TEXT REFERENCES users(id) ON DELETE CASCADE`);
}

// SQLite has no ALTER COLUMN to drop NOT NULL, so an already-deployed `email NOT NULL`
// table has to be rebuilt: create the new shape, copy rows across, swap it in.
const emailColumn = db.prepare(`SELECT "notnull" FROM pragma_table_info('users') WHERE name = 'email'`).get();
if (emailColumn.notnull) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE,
        password_hash TEXT,
        name          TEXT,
        is_admin      INTEGER NOT NULL DEFAULT 0,
        is_anon       INTEGER NOT NULL DEFAULT 0,
        theme         TEXT NOT NULL DEFAULT 'night',
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, password_hash, name, is_admin, is_anon, theme, created_at, updated_at)
        SELECT id, email, password_hash, name, is_admin, is_anon, theme, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  })();
}

// Purge stale OAuth states older than 10 minutes
db.prepare(`DELETE FROM oauth_state WHERE created_at < datetime('now', '-10 minutes')`).run();

export default db;
