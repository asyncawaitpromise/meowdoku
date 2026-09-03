// Tracks which user ids currently have an open SSE connection.
//
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