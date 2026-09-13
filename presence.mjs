// Tracks which user ids currently have an open SSE/WS connection, whether
// they're currently playing a game (for the friends-list "spectate" eye
// icon), and who's spectating whom. Everything here is in-memory and
// ephemeral by design — a server restart just means everyone re-announces
// their presence/game on reconnect, the same as the online/offline dot
// already did before this file grew game/spectator tracking.

import db from './db.mjs';
import appEvents from './events.mjs';

// A refcount per user (rather than a plain Set) so a user with two tabs open
// doesn't show as offline the moment one of them closes. markOnline/markOffline
// return whether the presence actually toggled (0 <-> 1 connections), so
// callers only emit presence events on a real edge — otherwise closing one of
// two tabs would broadcast a bogus "offline" while the user is still connected.
const onlineCounts = new Map();

export function markOnline(userId) {
  const wasOffline = !onlineCounts.has(userId);
  onlineCounts.set(userId, (onlineCounts.get(userId) || 0) + 1);
  return wasOffline;
}

export function markOffline(userId) {
  const remaining = (onlineCounts.get(userId) || 0) - 1;
  if (remaining > 0) {
    onlineCounts.set(userId, remaining);
    return false;
  }
  onlineCounts.delete(userId);
  return true;
}

export function isOnline(userId) {
  return onlineCounts.has(userId);
}

export function isInvisible(userId) {
  const row = db.prepare('SELECT invisible FROM users WHERE id = ?').get(userId);
  return !!row?.invisible;
}

// What a friend is allowed to see: raw connection presence, minus anyone who's
// opted into "invisible" (Settings > appear offline to friends). Gameplay
// itself never consults this — only the friends-list dot and the spectate eye do.
export function isVisible(userId) {
  return isOnline(userId) && !isInvisible(userId);
}

// --- What game (if any) a user is currently playing ------------------------
//
// Populated by a 'game_status' WebSocket message from the client (see
// routes/ws.mjs) whenever a solo/coop/head-to-head board is open, and cleared
// on leaving the screen or disconnecting. Shape: { mode: 'solo'|'coop'|
// 'head_to_head', sessionId?, difficulty?, puzzleCode? } — just enough for a
// spectator's client to either fetch the session (coop/head_to_head, by
// sessionId) or, for solo, decode the puzzle directly: `puzzleCode` is the
// finished puzzle itself in the same compact encoding as a share link, not a
// seed to regenerate from (see client/src/lib/levelGen/share.ts).
const activeGames = new Map();

export function setActiveGame(userId, info) {
  activeGames.set(userId, info);
}

export function clearActiveGame(userId) {
  activeGames.delete(userId);
}

export function getActiveGame(userId) {
  return activeGames.get(userId) || null;
}

// --- Spectators --------------------------------------------------------
//
// A viewer watches at most one host at a time. Kept as plain user-id sets
// (not socket references) — delivery to a spectator's live socket goes back
// through the same appEvents `update:<userId>` channel every other route
// already pushes through (see notifySpectators), so this module doesn't need
// to know anything about WebSocket internals.
const spectatorsByHost = new Map();
const hostBySpectator = new Map();

export function addSpectator(hostId, spectatorId) {
  stopSpectating(spectatorId);
  if (!spectatorsByHost.has(hostId)) spectatorsByHost.set(hostId, new Set());
  spectatorsByHost.get(hostId).add(spectatorId);
  hostBySpectator.set(spectatorId, hostId);
}

// Stops `spectatorId` watching whoever they were watching (a no-op if they
// weren't watching anyone). Returns the host id they were watching, if any.
export function stopSpectating(spectatorId) {
  const hostId = hostBySpectator.get(spectatorId);
  if (!hostId) return null;
  hostBySpectator.delete(spectatorId);
  const set = spectatorsByHost.get(hostId);
  if (set) {
    set.delete(spectatorId);
    if (set.size === 0) spectatorsByHost.delete(hostId);
  }
  return hostId;
}

export function getSpectators(hostId) {
  return spectatorsByHost.get(hostId) || new Set();
}

export function getWatchedHost(spectatorId) {
  return hostBySpectator.get(spectatorId) || null;
}

// Mirrors one of a host's own events out to everyone spectating them, wrapped
// so the spectator's client can tell "this is what I'm watching" apart from
// its own unrelated live-event traffic. Called both for real match/coop
// broadcasts (routes/matches.mjs, routes/ws.mjs's 'place' handler) and for
// solo board snapshots (routes/ws.mjs's 'solo_snapshot' handler).
export function notifySpectators(hostId, event) {
  for (const spectatorId of getSpectators(hostId)) {
    appEvents.emit(`update:${spectatorId}`, { type: 'spectate_event', hostId, event });
  }
}
