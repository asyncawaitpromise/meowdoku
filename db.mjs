import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

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
    friend_code   TEXT UNIQUE,
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

  CREATE TABLE IF NOT EXISTS progress (
    user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    completed_levels  TEXT NOT NULL DEFAULT '[]',
    completed_puzzles TEXT NOT NULL DEFAULT '{}',
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_games (
    user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
    game_id    TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game_id)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id           TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(requester_id, addressee_id)
  );

  CREATE TABLE IF NOT EXISTS puzzle_shares (
    id           TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_code   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function hasColumn(table, column) {
  return db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column) !== undefined;
}

// Base32-ish alphabet with ambiguous characters (0/O, 1/I/L) removed, so a code
// is easy to read aloud or retype by hand.
const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateFriendCode() {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += FRIEND_CODE_ALPHABET[crypto.randomInt(FRIEND_CODE_ALPHABET.length)];
  }
  return code;
}

// Inserts/updates are expected to retry on a UNIQUE collision themselves (astronomically
// rare at 8 chars from a 32-symbol alphabet, but cheap to guard against).
export function withUniqueFriendCode(assign, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      return assign(generateFriendCode());
    } catch (err) {
      if (i === attempts - 1 || !String(err.message).includes('UNIQUE constraint failed')) throw err;
    }
  }
}

// --- Migrations for databases created before is_anon / nullable email / oauth promotion existed ---

if (!hasColumn('users', 'is_anon')) {
  db.exec(`ALTER TABLE users ADD COLUMN is_anon INTEGER NOT NULL DEFAULT 0`);
}

if (!hasColumn('oauth_state', 'promote_user_id')) {
  db.exec(`ALTER TABLE oauth_state ADD COLUMN promote_user_id TEXT REFERENCES users(id) ON DELETE CASCADE`);
}

if (!hasColumn('users', 'friend_code')) {
  db.exec(`ALTER TABLE users ADD COLUMN friend_code TEXT UNIQUE`);
  const backfillOne = db.prepare(`UPDATE users SET friend_code = ? WHERE id = ?`);
  for (const { id } of db.prepare(`SELECT id FROM users WHERE friend_code IS NULL`).all()) {
    withUniqueFriendCode(code => backfillOne.run(code, id));
  }
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
        friend_code   TEXT UNIQUE,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, password_hash, name, is_admin, is_anon, theme, friend_code, created_at, updated_at)
        SELECT id, email, password_hash, name, is_admin, is_anon, theme, friend_code, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  })();
}

// Purge stale OAuth states older than 10 minutes
db.prepare(`DELETE FROM oauth_state WHERE created_at < datetime('now', '-10 minutes')`).run();

export default db;
