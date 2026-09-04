import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import appEvents from '../events.mjs';
import { getFriendIds, publicFriend } from './friends.mjs';

const router = Router();

router.use(requireAuth);

const MAX_PLAYERS = 2;

// Sessions can be abandoned (host never got a second player, someone leaves
// mid-match, a win never gets reported), so this bounds the tables' growth:
// a never-started match is dropped after WAITING_TTL, anything else (active or
// finished) after FINISHED_TTL. Deleting a session cascades its players (and,
// once head-to-head events exist, its event log) via ON DELETE CASCADE.
const WAITING_TTL_MINUTES = 30;
const FINISHED_TTL_HOURS = 24;

function getPlayers(sessionId) {
  const rows = db.prepare(`
    SELECT u.* FROM game_session_players gsp
    JOIN users u ON u.id = gsp.user_id
    WHERE gsp.session_id = ?
    ORDER BY gsp.joined_at
  `).all(sessionId);

  return rows.map(publicFriend);
}

function isParticipant(sessionId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM game_session_players WHERE session_id = ? AND user_id = ?
  `).get(sessionId, userId);
}

function serializeEvent(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    fromUserId: row.user_id,
    type: row.type,
    payload: row.payload === null ? null : JSON.parse(row.payload),
    createdAt: row.created_at,
  };
}

// Head-to-head only needs enough log to rebuild the opponent's HUD on a
// reconnect, so cap each session's history instead of letting it grow without
// bound. Exported so tests can drive the cap deterministically.
export const MAX_EVENTS_PER_SESSION = 500;

export function pruneSessionEvents(sessionId) {
  db.prepare(`
    DELETE FROM game_session_events
    WHERE session_id = ?
      AND rowid NOT IN (
        SELECT rowid FROM game_session_events WHERE session_id = ? ORDER BY rowid DESC LIMIT ?
      )
  `).run(sessionId, sessionId, MAX_EVENTS_PER_SESSION);
}

// Sparse map keyed by "row,col" rather than a fixed 2D array — the server
// never needs to know a puzzle's board size (that's client-side levelGen
// territory), and an absent key just means 'empty'.
function parseBoardState(session) {
  return session.board_state ? JSON.parse(session.board_state) : {};
}

function serializeSession(session) {
  return {
    id: session.id,
    mode: session.mode,
    difficulty: session.difficulty,
    puzzleSeed: session.puzzle_seed,
    status: session.status,
    players: getPlayers(session.id),
    boardState: parseBoardState(session),
  };
}

// Set a session's status and notify every other participant so their live HUD
// can react. The creating/leaving player has already acted and doesn't need
// their own echo.
function setSessionStatus(sessionId, status, exceptUserId) {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(sessionId);
  if (!session) return null;
  if (session.status === status) return session;

  db.prepare(`UPDATE game_sessions SET status = ? WHERE id = ?`).run(status, sessionId);
  const updated = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(sessionId);

  for (const other of getPlayers(sessionId).filter(p => p.id !== exceptUserId)) {
    appEvents.emit(`update:${other.id}`, {
      type: 'match_update',
      sessionId: updated.id,
      status: updated.status,
      players: getPlayers(sessionId),
    });
  }
  return updated;
}

// Periodic sweep for abandoned sessions. Exported so integration tests can
// drive it deterministically instead of waiting on the real timer.
export function runSessionCleanup() {
  db.prepare(`DELETE FROM game_sessions WHERE status = 'waiting' AND created_at < datetime('now', ?)`)
    .run(`-${WAITING_TTL_MINUTES} minutes`);
  db.prepare(`DELETE FROM game_sessions WHERE created_at < datetime('now', ?)`)
    .run(`-${FINISHED_TTL_HOURS} hours`);
}

// .unref() so the interval doesn't keep a process alive (tests, one-off scripts).
const cleanupTimer = setInterval(runSessionCleanup, 10 * 60 * 1000);
cleanupTimer.unref();

const MATCH_MODES = new Set(['head_to_head', 'coop']);
const MATCH_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'expert']);

router.post('/', (req, res) => {
  const { mode, difficulty, inviteFriendId } = req.body;
  if (!MATCH_MODES.has(mode)) {
    return res.status(400).json({ error: `mode must be one of ${[...MATCH_MODES].join(', ')}` });
  }
  if (!MATCH_DIFFICULTIES.has(difficulty)) {
    return res.status(400).json({ error: `difficulty must be one of ${[...MATCH_DIFFICULTIES].join(', ')}` });
  }

  if (inviteFriendId && !getFriendIds(req.user.id).includes(inviteFriendId)) {
    return res.status(403).json({ error: 'Not friends with that user' });
  }

  const id = crypto.randomUUID();
  const puzzleSeed = crypto.randomInt(2 ** 31);

  db.prepare(`
    INSERT INTO game_sessions (id, mode, difficulty, puzzle_seed, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, mode, difficulty, puzzleSeed, req.user.id);
  db.prepare('INSERT INTO game_session_players (session_id, user_id) VALUES (?, ?)').run(id, req.user.id);

  if (inviteFriendId) {
    appEvents.emit(`update:${inviteFriendId}`, {
      type: 'match_invite',
      sessionId: id,
      mode,
      difficulty,
      from: publicFriend(req.user),
    });
  }

  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id);
  res.status(201).json(serializeSession(session));
});

// The session id itself is the access control, the same capability model puzzle
// sharing already uses — anyone holding the id can fetch or join it, not just an
// invited friend. Friend-invite is a convenience notification on top, not a gate,
// so two people can still race off a shared link with no friendship between them.
router.get('/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json(serializeSession(session));
});

router.post('/:id/join', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.status === 'finished') {
    return res.status(409).json({ error: 'Session has ended' });
  }

  const players = getPlayers(session.id);
  if (players.some(p => p.id === req.user.id)) {
    return res.json(serializeSession(session));
  }

  if (players.length >= MAX_PLAYERS) {
    return res.status(409).json({ error: 'Session is full' });
  }

  db.prepare('INSERT INTO game_session_players (session_id, user_id) VALUES (?, ?)').run(session.id, req.user.id);

  const updatedPlayers = getPlayers(session.id);
  if (updatedPlayers.length >= MAX_PLAYERS && session.status !== 'active') {
    db.prepare(`UPDATE game_sessions SET status = 'active' WHERE id = ?`).run(session.id);
  }

  const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id);
  const other = updatedPlayers.find(p => p.id !== req.user.id);
  if (other) {
    appEvents.emit(`update:${other.id}`, {
      type: 'match_update',
      sessionId: updatedSession.id,
      status: updatedSession.status,
      players: updatedPlayers,
    });
  }

  res.json(serializeSession(updatedSession));
});

// A player reports the match as concluded (won / out of lives) so both sides
// get a definitive 'finished' state instead of the session lingering forever.
router.post('/:id/finish', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const isPlayer = !!db.prepare('SELECT 1 FROM game_session_players WHERE session_id = ? AND user_id = ?')
    .get(session.id, req.user.id);
  if (!isPlayer) {
    return res.status(403).json({ error: 'Not a participant in this session' });
  }

  const updated = setSessionStatus(session.id, 'finished', req.user.id);
  res.json(serializeSession(updated));
});

// A participant drops out. If that empties the session, or a waiting host bails,
// the whole session is deleted (cascading players/events). If a match was in
// progress and one player leaves, the other is told it's over — a head-to-head
// or co-op match can't meaningfully continue with one player.
router.post('/:id/leave', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const isPlayer = !!db.prepare('SELECT 1 FROM game_session_players WHERE session_id = ? AND user_id = ?')
    .get(session.id, req.user.id);
  if (!isPlayer) {
    return res.status(403).json({ error: 'Not a participant in this session' });
  }

  const players = getPlayers(session.id);
  const remaining = players.filter(p => p.id !== req.user.id);

  if (remaining.length === 0 || (session.status === 'waiting' && session.created_by === req.user.id)) {
    db.prepare('DELETE FROM game_sessions WHERE id = ?').run(session.id);
    return res.status(204).end();
  }

  db.prepare('DELETE FROM game_session_players WHERE session_id = ? AND user_id = ?').run(session.id, req.user.id);

  if (session.status === 'active') {
    setSessionStatus(session.id, 'finished', req.user.id);
  } else {
    // A waiting non-creator left and the host remains — tell them so their
    // player list isn't stale (the join path already emits match_update).
    for (const other of remaining) {
      appEvents.emit(`update:${other.id}`, {
        type: 'match_update',
        sessionId: session.id,
        status: session.status,
        players: getPlayers(session.id),
      });
    }
  }

  res.status(204).end();
});

const MATCH_EVENT_TYPES = new Set(['life_lost', 'cat_found', 'x_placed']);

// The server never learns a board's size (that's client-side levelGen), so
// head-to-head meta-events stay self-reported — but they don't have to be
// unbounded. Board sizes top out at N=11 (pickSize), so a legit match can log
// at most MAX_CATS_FOUND "cats found" and MAX_LIVES "lives lost"; anything past
// those ceilings is a client that lost the plot or a cheater lamping the
// opponent's HUD. Counts are also constrained to move only forward, so a
// client can't lower its own totals to invalidate the other side's HUD.
const MAX_LIVES = 3;
const MAX_CATS_FOUND = 16;
const MAX_X_PLACED = 256;

function scorecard(sessionId, userId) {
  return db.prepare(`
    SELECT life_lost_count, cat_found_count, x_placed_count
    FROM game_session_players WHERE session_id = ? AND user_id = ?
  `).get(sessionId, userId);
}

router.post('/:id/events', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.mode !== 'head_to_head') {
    return res.status(400).json({ error: 'Events only exist for head-to-head sessions' });
  }
  if (!isParticipant(session.id, req.user.id)) {
    return res.status(403).json({ error: 'Not a participant in this session' });
  }

  const { type, payload } = req.body;
  if (!MATCH_EVENT_TYPES.has(type)) {
    return res.status(400).json({ error: `type must be one of ${[...MATCH_EVENT_TYPES].join(', ')}` });
  }

  // Validate against this player's scorecard, then record the event — all in
  // one transaction so the read-check-write can't race. The count/remaining
  // fields the client reports are its running totals: they must be sane
  // integers inside the event's ceiling, and (for count events) strictly above
  // the number of events already accepted. That floor is the scorecard count —
  // which always advances, so it can't be reset by an event with no payload —
  // while a higher out-of-order total still clears it, so a burst of fast
  // placements doesn't false-positive.
  const isPlain = payload !== undefined && payload !== null && typeof payload === 'object';
  const maxCount = type === 'life_lost' ? MAX_LIVES : type === 'cat_found' ? MAX_CATS_FOUND : MAX_X_PLACED;

  const outcome = db.transaction(() => {
    const card = scorecard(session.id, req.user.id);
    if (card[`${type}_count`] >= maxCount) {
      return { error: `No more ${type} events accepted for this session` };
    }

    if (isPlain) {
      if (type === 'life_lost' && typeof payload.remaining === 'number') {
        if (!Number.isInteger(payload.remaining) || payload.remaining < 0 || payload.remaining > MAX_LIVES) {
          return { error: `remaining must be an integer between 0 and ${MAX_LIVES}` };
        }
      }
      if (type !== 'life_lost' && typeof payload.count === 'number') {
        if (!Number.isInteger(payload.count) || payload.count > maxCount || payload.count <= card[`${type}_count`]) {
          return { error: `count must be an integer above the accepted events so far and at or below ${maxCount}` };
        }
      }
    }

    const id = crypto.randomUUID();
    db.prepare(`UPDATE game_session_players SET ${type}_count = ${type}_count + 1 WHERE session_id = ? AND user_id = ?`)
      .run(session.id, req.user.id);
    db.prepare(`
      INSERT INTO game_session_events (id, session_id, user_id, type, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, session.id, req.user.id, type, payload === undefined ? null : JSON.stringify(payload));
    return { id };
  })();

  if (outcome.error) return res.status(400).json({ error: outcome.error });

  const id = outcome.id;
  pruneSessionEvents(session.id);

  const event = serializeEvent(db.prepare('SELECT * FROM game_session_events WHERE id = ?').get(id));

  // The SSE envelope's own routing field is also called `type` (see sse.mjs's
  // `data.type` dispatch) and must read 'match_event' for clients to route it
  // correctly — so the game-specific type (life_lost/cat_found/x_placed) rides
  // along as `eventType` here instead of colliding with it. The REST shape
  // above (and the GET below) has no such envelope, so it keeps the plain `type`.
  for (const other of getPlayers(session.id).filter(p => p.id !== req.user.id)) {
    appEvents.emit(`update:${other.id}`, {
      type: 'match_event',
      sessionId: event.sessionId,
      fromUserId: event.fromUserId,
      eventType: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    });
  }

  res.status(201).json(event);
});

router.get('/:id/events', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!isParticipant(session.id, req.user.id)) {
    return res.status(403).json({ error: 'Not a participant in this session' });
  }

  // Ordered by rowid rather than created_at: created_at only has second
  // granularity, which doesn't preserve insertion order for a burst of events.
  const rows = db.prepare(`
    SELECT * FROM game_session_events WHERE session_id = ? ORDER BY rowid
  `).all(session.id);

  res.json({ events: rows.map(serializeEvent) });
});

const CELL_STATES = ['empty', 'marker', 'cat'];

// The server never learns a puzzle's board size (that's client-side levelGen),
// so it can't validate coordinates against a real board — but it can bound the
// sparse map so a malicious/glitched client can't grow board_state without
// limit. levelGen boards top out well under 32, and 1024 distinct cells is far
// past any real puzzle.
const MAX_BOARD_INDEX = 31;
const MAX_BOARD_CELLS = 1024;

// Unlike GET/join, placing a mark requires actually being a participant —
// the shared board is mutable state, not something a link-holder should be
// able to nudge without ever having joined.
router.post('/:id/place', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.mode !== 'coop') {
    return res.status(400).json({ error: 'Only coop sessions have a shared board' });
  }

  if (session.status === 'finished') {
    return res.status(409).json({ error: 'Session has ended' });
  }

  const players = getPlayers(session.id);
  if (!players.some(p => p.id === req.user.id)) {
    return res.status(403).json({ error: 'Not a participant in this session' });
  }

  const { row, col, state } = req.body;
  if (!Number.isInteger(row) || row < 0 || row > MAX_BOARD_INDEX
    || !Number.isInteger(col) || col < 0 || col > MAX_BOARD_INDEX
    || !CELL_STATES.includes(state)) {
    return res.status(400).json({ error: `row and col must be integers in [0, ${MAX_BOARD_INDEX}], state must be empty/marker/cat` });
  }

  const board = parseBoardState(session);
  const key = `${row},${col}`;
  if (!(key in board) && Object.keys(board).length >= MAX_BOARD_CELLS) {
    return res.status(400).json({ error: 'Board is full' });
  }

  board[key] = state;
  db.prepare('UPDATE game_sessions SET board_state = ? WHERE id = ?').run(JSON.stringify(board), session.id);

  const other = players.find(p => p.id !== req.user.id);
  if (other) {
    appEvents.emit(`update:${other.id}`, {
      type: 'match_placement',
      sessionId: session.id,
      row,
      col,
      state,
      byUserId: req.user.id,
    });
  }

  const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id);
  res.json(serializeSession(updatedSession));
});

export default router;
