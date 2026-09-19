// WebSocket transport for live multiplayer push + coop placement input.
//
// Replaces SSE (routes/sse.mjs, kept mounted only for its existing test
// coverage — the live client no longer opens it) as the delivery mechanism
// for the same appEvents-based pub/sub every other route already emits
// through (`appEvents.emit('update:<userId>', {...})`); a WS connection's
// only job on the receive side is to forward whatever arrives on that key
// straight to the socket. The one thing WS also carries client -> server:
// coop board placements, previously a POST per touched cell (see
// routes/matches.mjs's applyCoopPlacement).
//
// Auth happens once, at the upgrade handshake (`?token=`, same JWT as
// requireAuth), since a WS connection has no per-message header to attach a
// bearer token to.

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import db from '../db.mjs';
import appEvents from '../events.mjs';
import {
  markOnline, markOffline, isInvisible, isVisible,
  setActiveGame, clearActiveGame, getActiveGame,
  addSpectator, stopSpectating, getSpectators, notifySpectators,
} from '../presence.mjs';
import { getFriendIds } from './friends.mjs';
import { emitPendingInvites, applyCoopPlacement, emitActiveSessionSnapshots, getCoopPartnerIds } from './matches.mjs';

const WS_PATH = '/api/ws';

// A dead peer (network drop, laptop sleep, phone backgrounded hard enough to
// kill the socket without a clean close frame) never fires 'close' on its
// own — nothing here would ever notice without probing. Ping every 25s and
// terminate anything that didn't pong since the last probe; that failure
// then fires 'close' for real, which is what tells the client to reconnect.
const HEARTBEAT_INTERVAL_MS = 25_000;

// A generous backstop against a broken/looping client, not a real ceiling on
// play — a shared 2-player board is self-limiting (only 2 authors, capped by
// MAX_BOARD_CELLS), so this only exists to bound a client gone haywire.
const PLACE_WINDOW_MS = 60_000;
const PLACE_MAX_PER_WINDOW = 600;

// Cursor positions stream far faster than placements (clients send ~20/s
// while moving), so they get their own, larger budget.
const CURSOR_WINDOW_MS = 1_000;
const CURSOR_MAX_PER_WINDOW = 60;

function isCursorCoordinate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

// Exported so auth.mjs can re-announce presence the moment a user flips their
// "invisible" setting, instead of waiting for their next connect/disconnect.
export function notifyFriendsOfPresence(userId, online) {
  // A caller reporting a real online edge (not the deliberate "I just went
  // invisible" false below) is silently dropped if the user is invisible —
  // friends should never see them come online while that's set.
  if (online && isInvisible(userId)) return;
  for (const friendId of getFriendIds(userId)) {
    appEvents.emit(`update:${friendId}`, { type: 'presence', userId, online });
  }
}

// Tells a user's friends what they're currently playing (or that they've
// stopped), gated the same way the online dot is: invisible or offline both
// collapse to "not in a game" from a friend's point of view.
export function notifyFriendsOfGameStatus(userId) {
  const inGame = isVisible(userId) ? getActiveGame(userId) : null;
  for (const friendId of getFriendIds(userId)) {
    appEvents.emit(`update:${friendId}`, { type: 'friend_game_status', userId, inGame });
  }
}

const SPECTATE_BOARD_MAX_INDEX = 31;
const SPECTATE_BOARD_MAX_CELLS = 1024;
const SPECTATE_CELL_STATES = new Set(['empty', 'marker', 'cat', 'question']);

// Loose validation for a solo board snapshot: it's ephemeral (never written to
// the DB) and only ever reaches a friend who was already granted spectate
// access, but a malformed/oversized payload shouldn't be relayed as-is.
function isValidSoloBoard(board) {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return false;
  const entries = Object.entries(board);
  if (entries.length > SPECTATE_BOARD_MAX_CELLS) return false;
  return entries.every(([key, state]) => {
    const [r, c] = key.split(',').map(Number);
    return Number.isInteger(r) && r >= 0 && r <= SPECTATE_BOARD_MAX_INDEX
      && Number.isInteger(c) && c >= 0 && c <= SPECTATE_BOARD_MAX_INDEX
      && SPECTATE_CELL_STATES.has(state);
  });
}

function authenticate(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId) || null;
  } catch {
    return null;
  }
}

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const user = authenticate(url.searchParams.get('token'));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, user);
    });
  });

  wss.on('connection', (ws, user) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const eventKey = `update:${user.id}`;
    const listener = (data) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
    };
    appEvents.on(eventKey, listener);

    // Only broadcast presence on an actual online/offline edge (mirrors
    // sse.mjs) — a second tab/connection shouldn't flip a friend's status.
    if (markOnline(user.id)) {
      notifyFriendsOfPresence(user.id, true);
      emitPendingInvites(user.id);
    }
    // Unlike the presence edge above, this runs on *every* connection —
    // including a second tab, and including a reconnect of an already-"online"
    // user — since each one is a fresh chance to catch up on anything the
    // client's last connection missed.
    emitActiveSessionSnapshots(user.id);

    let placeCount = 0;
    let placeWindowStart = Date.now();
    let cursorCount = 0;
    let cursorWindowStart = Date.now();

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      // Live pointer/finger position for the co-op partner's overlay, as
      // fractions of the sender's game screen. x/y null means "pointer left".
      if (msg.type === 'cursor') {
        const now = Date.now();
        if (now - cursorWindowStart > CURSOR_WINDOW_MS) {
          cursorWindowStart = now;
          cursorCount = 0;
        }
        cursorCount += 1;
        if (cursorCount > CURSOR_MAX_PER_WINDOW) return;

        const { sessionId, x, y } = msg;
        const isHidden = x === null && y === null;
        if (!isHidden && !(isCursorCoordinate(x) && isCursorCoordinate(y))) return;

        for (const partnerId of getCoopPartnerIds(sessionId, user.id)) {
          appEvents.emit(`update:${partnerId}`, { type: 'coop_cursor', sessionId, userId: user.id, x, y });
        }
        return;
      }

      if (msg.type === 'place') {
        const now = Date.now();
        if (now - placeWindowStart > PLACE_WINDOW_MS) {
          placeWindowStart = now;
          placeCount = 0;
        }
        placeCount += 1;
        if (placeCount > PLACE_MAX_PER_WINDOW) return;

        const { sessionId, row, col, state } = msg;
        const result = applyCoopPlacement({ sessionId, userId: user.id, row, col, state });
        if (!result.ok) return;

        for (const player of result.players) {
          const event = {
            type: 'match_placement',
            sessionId,
            row,
            col,
            state,
            byUserId: user.id,
          };
          appEvents.emit(`update:${player.id}`, event);
          notifySpectators(player.id, event);
        }
        return;
      }

      // Announces (or retracts) what this connection's user is currently
      // playing, for the friends-list eye icon. `info` is opaque to the
      // server beyond what spectate handshakes need — see presence.mjs. For
      // solo play, `puzzleCode` is the finished puzzle itself (the same
      // compact encoding as a share link — see client/src/lib/levelGen/share.ts),
      // not a seed to regenerate from, so it's capped rather than trusted.
      if (msg.type === 'game_status') {
        if (msg.active) {
          const { mode, sessionId, difficulty } = msg;
          const puzzleCode = typeof msg.puzzleCode === 'string' && msg.puzzleCode.length <= 300 ? msg.puzzleCode : undefined;
          setActiveGame(user.id, { mode, sessionId, difficulty, puzzleCode });
        } else {
          clearActiveGame(user.id);
          for (const spectatorId of getSpectators(user.id)) {
            appEvents.emit(`update:${spectatorId}`, { type: 'spectate_ended', hostId: user.id });
            stopSpectating(spectatorId);
          }
        }
        notifyFriendsOfGameStatus(user.id);
        return;
      }

      // A friend asking to watch this user's live game. Access is capped to
      // "currently a friend, currently visible, currently in a game" — all
      // three re-checked here rather than trusted from the client.
      if (msg.type === 'spectate_start') {
        const targetUserId = msg.targetUserId;
        if (typeof targetUserId !== 'string' || !getFriendIds(user.id).includes(targetUserId)) {
          ws.send(JSON.stringify({ type: 'spectate_error', targetUserId, error: 'not_friends' }));
          return;
        }
        if (!isVisible(targetUserId)) {
          ws.send(JSON.stringify({ type: 'spectate_error', targetUserId, error: 'offline' }));
          return;
        }
        const info = getActiveGame(targetUserId);
        if (!info) {
          ws.send(JSON.stringify({ type: 'spectate_error', targetUserId, error: 'not_in_game' }));
          return;
        }
        addSpectator(targetUserId, user.id);
        ws.send(JSON.stringify({ type: 'spectate_started', hostId: targetUserId, info }));
        // Lets the host start streaming (solo) or nudges it to know it's being
        // watched at all — the host's own connection is listening on this
        // same generic channel (see `listener` above).
        appEvents.emit(`update:${targetUserId}`, { type: 'spectator_joined', spectatorId: user.id });
        return;
      }

      if (msg.type === 'spectate_stop') {
        const hostId = stopSpectating(user.id);
        if (hostId) appEvents.emit(`update:${hostId}`, { type: 'spectator_left', spectatorId: user.id });
        return;
      }

      // A solo host's full board (sparse map, same shape as coop's
      // board_state), pushed out to whoever's currently spectating them.
      // Never persisted — solo play has no server-side session to persist to.
      if (msg.type === 'solo_snapshot') {
        if (!isValidSoloBoard(msg.board)) return;
        notifySpectators(user.id, { type: 'solo_snapshot', board: msg.board });
      }
    });

    ws.on('close', () => {
      appEvents.off(eventKey, listener);

      const wentOffline = markOffline(user.id);
      if (wentOffline) {
        notifyFriendsOfPresence(user.id, false);
        if (getActiveGame(user.id)) {
          clearActiveGame(user.id);
          notifyFriendsOfGameStatus(user.id);
        }
        for (const spectatorId of getSpectators(user.id)) {
          appEvents.emit(`update:${spectatorId}`, { type: 'spectate_ended', hostId: user.id });
          stopSpectating(spectatorId);
        }
      }

      // Drop our own spectate subscription regardless of remaining tabs —
      // this specific connection is the one that asked to watch.
      const watchedHost = stopSpectating(user.id);
      if (watchedHost) appEvents.emit(`update:${watchedHost}`, { type: 'spectator_left', spectatorId: user.id });
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return wss;
}
