import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import { matchCreateLimiter, matchEventLimiter, matchPlaceLimiter } from '../middlewares/rateLimit.mjs';
import appEvents from '../events.mjs';
import { getFriendIds, publicFriend } from './friends.mjs';
import { notifySpectators } from '../presence.mjs';

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
    const event = {
      type: 'match_update',
      sessionId: updated.id,
      status: updated.status,
      players: getPlayers(sessionId),
    };
    appEvents.emit(`update:${other.id}`, event);
    notifySpectators(other.id, event);
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

// Invitations parked in the inbox for a user: waiting sessions created with
// that user as the invitee. Offline friends miss the live SSE invite (or never
// get it at all), so this is the durable source of truth used both by
// sse.mjs (re-emit on connect) and GET /api/matches/invites.
// gs.id is aliased because `u.*` also carries an `id` column (the creator's
// user id) — left unaliased for the last-wins object the JOIN produces, the
// session id would be silently shadowed by the user's id.
const INVITES_QUERY = `
  SELECT gs.id AS session_id, gs.mode, gs.difficulty, gs.status, gs.created_at, u.*
  FROM game_sessions gs
  JOIN users u ON u.id = gs.created_by
  WHERE gs.invitee_id = ? AND gs.status = 'waiting'
  ORDER BY gs.created_at DESC
`;

function pendingInviteRows(userId) {
  return db.prepare(INVITES_QUERY).all(userId);
}

function serializeInvite(row) {
  return {
    sessionId: row.session_id,
    mode: row.mode,
    difficulty: row.difficulty,
    createdAt: row.created_at,
    from: publicFriend(row),
  };
}

export function emitPendingInvites(userId) {
  for (const row of pendingInviteRows(userId)) {
    appEvents.emit(`update:${userId}`, {
      type: 'match_invite',
      ...serializeInvite(row),
    });
  }
}

router.post('/', matchCreateLimiter, (req, res) => {
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
    INSERT INTO game_sessions (id, mode, difficulty, puzzle_seed, created_by, invitee_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, mode, difficulty, puzzleSeed, req.user.id, inviteFriendId ?? null);
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

// The invite inbox: every challenge/co-op session currently aimed at this user.
// The client fetches this on login and after every SSE reconnect so a friend
// who was offline when the invite was sent still sees it.
router.get('/invites', (req, res) => {
  res.json({ invites: pendingInviteRows(req.user.id).map(serializeInvite) });
});

// Turning down a pending invite removes the waiting session outright — the
// host is parked on a match/coop screen waiting, so a declined session that
// lingers until the 30-minute sweep would leave them staring at a void for no
// reason. The host learns immediately via match_update({ status: 'declined' }).
router.post('/:id/decline', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.status !== 'waiting' || session.invitee_id !== req.user.id) {
    return res.status(403).json({ error: 'This invite is not pending for you' });
  }

  db.prepare('DELETE FROM game_sessions WHERE id = ?').run(session.id);

  appEvents.emit(`update:${session.created_by}`, {
    type: 'match_update',
    sessionId: session.id,
    status: 'declined',
    players: [],
  });

  res.status(204).end();
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
    const event = {
      type: 'match_update',
      sessionId: updatedSession.id,
      status: updatedSession.status,
      players: updatedPlayers,
    };
    appEvents.emit(`update:${other.id}`, event);
    notifySpectators(other.id, event);
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
      const event = {
        type: 'match_update',
        sessionId: session.id,
        status: session.status,
        players: getPlayers(session.id),
      };
      appEvents.emit(`update:${other.id}`, event);
      notifySpectators(other.id, event);
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

router.post('/:id/events', matchEventLimiter, (req, res) => {
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
    const pushed = {
      type: 'match_event',
      sessionId: event.sessionId,
      fromUserId: event.fromUserId,
      eventType: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    };
    appEvents.emit(`update:${other.id}`, pushed);
    notifySpectators(other.id, pushed);
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

const CELL_STATES = ['empty', 'marker', 'cat', 'question'];

// The server never learns a puzzle's board size (that's client-side levelGen),
// so it can't validate coordinates against a real board — but it can bound the
// sparse map so a malicious/glitched client can't grow board_state without
// limit. levelGen boards top out well under 32, and 1024 distinct cells is far
// past any real puzzle.
const MAX_BOARD_INDEX = 31;
const MAX_BOARD_CELLS = 1024;

// Shared by both the legacy REST endpoint below and the WebSocket 'place'
// message handler (routes/ws.mjs) — one validation/persistence path so the
// two transports can't drift. Returns every participant (not just "the
// other one") because the two callers notify differently: the REST route
// already has an HTTP response for its own caller and only needs to push to
// the other player, while the WS handler broadcasts to everyone (including
// the sender) so the sender's own optimistic write gets an authoritative
// echo back down the same connection — see coopStore.ts's placeCell.
export function applyCoopPlacement({ sessionId, userId, row, col, state }) {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(sessionId);
  if (!session) return { ok: false, error: 'Session not found', status: 404 };

  if (session.mode !== 'coop') {
    return { ok: false, error: 'Only coop sessions have a shared board', status: 400 };
  }

  if (session.status === 'finished') {
    return { ok: false, error: 'Session has ended', status: 409 };
  }

  const players = getPlayers(session.id);
  if (!players.some(p => p.id === userId)) {
    return { ok: false, error: 'Not a participant in this session', status: 403 };
  }

  if (!Number.isInteger(row) || row < 0 || row > MAX_BOARD_INDEX
    || !Number.isInteger(col) || col < 0 || col > MAX_BOARD_INDEX
    || !CELL_STATES.includes(state)) {
    return { ok: false, error: `row and col must be integers in [0, ${MAX_BOARD_INDEX}], state must be empty/marker/cat/question`, status: 400 };
  }

  const board = parseBoardState(session);
  const key = `${row},${col}`;
  if (!(key in board) && Object.keys(board).length >= MAX_BOARD_CELLS) {
    return { ok: false, error: 'Board is full', status: 400 };
  }

  board[key] = state;
  db.prepare('UPDATE game_sessions SET board_state = ? WHERE id = ?').run(JSON.stringify(board), session.id);

  const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id);
  return { ok: true, session: serializeSession(updatedSession), players };
}

// Kept as a fallback/back-compat path (and what the integration tests drive)
// now that the live client sends placements over the WebSocket connection
// instead — see routes/ws.mjs's 'place' message handler for the primary path.
router.post('/:id/place', matchPlaceLimiter, (req, res) => {
  const { row, col, state } = req.body;
  const result = applyCoopPlacement({ sessionId: req.params.id, userId: req.user.id, row, col, state });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  const other = result.players.find(p => p.id !== req.user.id);
  if (other) {
    const event = {
      type: 'match_placement',
      sessionId: req.params.id,
      row,
      col,
      state,
      byUserId: req.user.id,
    };
    appEvents.emit(`update:${other.id}`, event);
    notifySpectators(other.id, event);
  }

  res.json(result.session);
});

// A user's open (waiting/active) sessions, re-pushed as full authoritative
// snapshots whenever their live connection (re)establishes — see
// routes/ws.mjs. Without this, a match_update/match_placement emitted while
// that user had no live listener (a dropped connection that hadn't yet
// reconnected, or hadn't connected at all yet) is gone for good: appEvents
// has no memory, so the client would be stuck showing stale status/board
// until something else (a manual refresh) happened to re-fetch it.
export function emitActiveSessionSnapshots(userId) {
  const rows = db.prepare(`
    SELECT gs.* FROM game_sessions gs
    JOIN game_session_players gsp ON gsp.session_id = gs.id
    WHERE gsp.user_id = ? AND gs.status IN ('waiting', 'active')
  `).all(userId);

  for (const session of rows) {
    const event = { type: 'match_resync', session: serializeSession(session) };
    appEvents.emit(`update:${userId}`, event);
    notifySpectators(userId, event);
  }
}

export default router;
