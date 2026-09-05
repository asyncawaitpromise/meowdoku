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
    username      TEXT,
    password_hash TEXT,
    name          TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    is_anon       INTEGER NOT NULL DEFAULT 0,
    theme         TEXT NOT NULL DEFAULT 'meowdoku',
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

  -- "Sign in on another device": a short-lived, single-use code minted by an
  -- already-signed-in device that a second device redeems to log into the
  -- *same* account (sharing progress) without email/SSO. used_at is set on
  -- redemption rather than deleting the row, so a reused/expired code can
  -- still be told apart from one that never existed.
  CREATE TABLE IF NOT EXISTS device_links (
    code       TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    used_at    TEXT
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

  CREATE TABLE IF NOT EXISTS game_sessions (
    id          TEXT PRIMARY KEY,
    mode        TEXT NOT NULL,
    difficulty  TEXT NOT NULL,
    puzzle_seed INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'waiting',
    board_state TEXT,
    created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The friend a 'waiting' session was created to invite. Offline friends
    -- miss the live SSE invite, so this persists it as an inbox entry they
    -- pick up on their next visit/reconnect (see /api/matches/invites).
    invitee_id  TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_session_players (
    session_id      TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    -- Head-to-head scorecard: counts of life_lost/cat_found/x_placed events
    -- accepted for this player so the server can validate that meta-events stay
    -- monotonic and bounded (a cheater shouldn't be able to lamp the opponent's
    -- HUD with a hundred "cats found" before a single board is even solved).
    life_lost_count INTEGER NOT NULL DEFAULT 0,
    cat_found_count INTEGER NOT NULL DEFAULT 0,
    x_placed_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, user_id)
  );

  -- Abandoned-session sweep in matches.mjs filters on status + created_at.
  CREATE INDEX IF NOT EXISTS idx_game_sessions_status_created
    ON game_sessions(status, created_at);

  CREATE TABLE IF NOT EXISTS game_session_events (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    payload    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Head-to-head event log queries (read in order + capped-delete) filter on session_id.
  CREATE INDEX IF NOT EXISTS idx_game_session_events_session
    ON game_session_events(session_id);
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

if (!hasColumn('users', 'username')) {
  db.exec(`ALTER TABLE users ADD COLUMN username TEXT`);
}

if (!hasColumn('game_sessions', 'board_state')) {
  db.exec(`ALTER TABLE game_sessions ADD COLUMN board_state TEXT`);
}

// Head-to-head scorecard columns on game_session_players; a CREATE TABLE
// re-run can't grow an existing table, so pre-existing DBs get them here.
for (const col of ['life_lost_count', 'cat_found_count', 'x_placed_count']) {
  if (!hasColumn('game_session_players', col)) {
    db.exec(`ALTER TABLE game_session_players ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
  }
}

if (!hasColumn('game_sessions', 'invitee_id')) {
  db.exec(`ALTER TABLE game_sessions ADD COLUMN invitee_id TEXT REFERENCES users(id) ON DELETE CASCADE`);
}

if (!hasColumn('users', 'friend_code')) {
  // SQLite rejects "ALTER TABLE ADD COLUMN ... UNIQUE" outright ("Cannot add a
  // UNIQUE column"), so the column is added constraint-free and the uniqueness
  // is enforced by a separate index — which also allows the multiple NULLs that
  // a default-less add produces before the backfill below.
  db.exec(`ALTER TABLE users ADD COLUMN friend_code TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_friend_code_uniq ON users(friend_code)`);
  const backfillOne = db.prepare(`UPDATE users SET friend_code = ? WHERE id = ?`);
  for (const { id } of db.prepare(`SELECT id FROM users WHERE friend_code IS NULL`).all()) {
    withUniqueFriendCode(code => backfillOne.run(code, id));
  }
}

// SQLite has no ALTER COLUMN to drop NOT NULL, so an already-deployed `email NOT NULL`
// table has to be rebuilt: create the new shape, copy rows across, swap it in.
//
// foreign_keys is disabled around the rebuild: with it ON, DROP TABLE users
// performs an implicit DELETE whose ON DELETE CASCADE action would silently
// wipe every oauth_accounts row referencing the old users table. (PRAGMA
// foreign_keys is a no-op inside a transaction, so it has to toggle outside.)
const emailColumn = db.prepare(`SELECT "notnull" FROM pragma_table_info('users') WHERE name = 'email'`).get();
if (emailColumn.notnull) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id            TEXT PRIMARY KEY,
          email         TEXT UNIQUE,
          username      TEXT,
          password_hash TEXT,
          name          TEXT,
          is_admin      INTEGER NOT NULL DEFAULT 0,
          is_anon       INTEGER NOT NULL DEFAULT 0,
          theme         TEXT NOT NULL DEFAULT 'meowdoku',
          friend_code   TEXT UNIQUE,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_new (id, email, username, password_hash, name, is_admin, is_anon, theme, friend_code, created_at, updated_at)
          SELECT id, email, username, password_hash, name, is_admin, is_anon, theme, friend_code, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// Case-insensitive uniqueness for username (an expression index rather than a
// UNIQUE column constraint, since two names differing only in case would
// otherwise both be accepted). Deferred to here, after both the column-add
// migration and the legacy users-table rebuild above, so it only runs once
// `username` is guaranteed to exist on whichever `users` table is current.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_uniq ON users (lower(username))`);

// Purge stale OAuth states older than 10 minutes
db.prepare(`DELETE FROM oauth_state WHERE created_at < datetime('now', '-10 minutes')`).run();

// Device-link codes expire quickly by design (see /api/auth/device-link) —
// sweep stale ones so the table doesn't grow with dead codes.
db.prepare(`DELETE FROM device_links WHERE created_at < datetime('now', '-30 minutes')`).run();

// --- One-off named migrations (persist a marker so they run exactly once) ---

db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// The default theme changed from 'night' to the custom warm 'meowdoku'
// palette. Users who never switched off the old default were indistinguishable
// from intentional dark-mode adopters, so this one-time run brings everyone on
// 'night' over to the warm look; anyone who re-picks 'night' afterwards (in
// Settings) is left alone by the marker.
if (!db.prepare(`SELECT 1 FROM app_meta WHERE key = 'theme_default_meowdoku'`).get()) {
  db.exec(`UPDATE users SET theme = 'meowdoku' WHERE theme = 'night'`);
  db.prepare(`INSERT INTO app_meta (key, value) VALUES ('theme_default_meowdoku', '1')`).run();
}

export default db;
