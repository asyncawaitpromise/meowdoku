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
import { markOnline, markOffline } from '../presence.mjs';
import { getFriendIds } from './friends.mjs';
import { emitPendingInvites, applyCoopPlacement, emitActiveSessionSnapshots } from './matches.mjs';

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

function notifyFriendsOfPresence(userId, online) {
  for (const friendId of getFriendIds(userId)) {
    appEvents.emit(`update:${friendId}`, { type: 'presence', userId, online });
  }
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

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

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
          appEvents.emit(`update:${player.id}`, {
            type: 'match_placement',
            sessionId,
            row,
            col,
            state,
            byUserId: user.id,
          });
        }
      }
    });

    ws.on('close', () => {
      appEvents.off(eventKey, listener);
      if (markOffline(user.id)) notifyFriendsOfPresence(user.id, false);
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
