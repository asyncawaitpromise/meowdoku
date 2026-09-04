// Server-Sent Events example route.
//
// The client connects once and receives a stream of events. Useful for
// pushing real-time updates (notifications, job progress, etc.) without
// polling.
//
// Client usage:
//   const token = useAuthStore.getState().token;
//   const es = new EventSource(`/api/sse/stream?token=${token}`);
//   es.addEventListener('update', (e) => console.log(JSON.parse(e.data)));
//   es.addEventListener('heartbeat', (e) => {});

import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import appEvents from '../events.mjs';
import { markOnline, markOffline } from '../presence.mjs';
import { getFriendIds } from './friends.mjs';

const router = Router();

function notifyFriendsOfPresence(userId, online) {
  for (const friendId of getFriendIds(userId)) {
    appEvents.emit(`update:${friendId}`, { type: 'presence', userId, online });
  }
}

router.get('/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send connected confirmation
  send('connected', { userId: req.user.id });

  // Only broadcast presence on an actual online/offline edge — a second tab
  // increments the refcount without flipping the status, and closing one of
  // two tabs shouldn't tell friends the user went offline.
  if (markOnline(req.user.id)) notifyFriendsOfPresence(req.user.id, true);

  // Heartbeat every 30 seconds to keep the connection alive through proxies
  const heartbeat = setInterval(() => send('heartbeat', { ts: Date.now() }), 30_000);

  // Listen for app events targeted at this user
  const eventKey = `update:${req.user.id}`;
  const listener = (data) => send('update', data);
  appEvents.on(eventKey, listener);

  req.on('close', () => {
    clearInterval(heartbeat);
    appEvents.off(eventKey, listener);
    if (markOffline(req.user.id)) notifyFriendsOfPresence(req.user.id, false);
  });
});

// Example: emit an update to a user from anywhere in the app:
//   import appEvents from '../events.mjs';
//   appEvents.emit(`update:${userId}`, { type: 'notification', message: 'Hello!' });

export default router;
