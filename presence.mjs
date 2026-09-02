// Tracks which user ids currently have an open SSE connection.
//
// A refcount per user (rather than a plain Set) so a user with two tabs open
// doesn't show as offline the moment one of them closes.

const onlineCounts = new Map();

export function markOnline(userId) {
  onlineCounts.set(userId, (onlineCounts.get(userId) || 0) + 1);
}

export function markOffline(userId) {
  const remaining = (onlineCounts.get(userId) || 0) - 1;
  if (remaining > 0) onlineCounts.set(userId, remaining);
  else onlineCounts.delete(userId);
}

export function isOnline(userId) {
  return onlineCounts.has(userId);
}
