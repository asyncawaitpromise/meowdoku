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

const router = Router();

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

  // Heartbeat every 30 seconds to keep the connection alive through proxies
  const heartbeat = setInterval(() => send('heartbeat', { ts: Date.now() }), 30_000);

  // Listen for app events targeted at this user
  const eventKey = `update:${req.user.id}`;
  const listener = (data) => send('update', data);
  appEvents.on(eventKey, listener);

  req.on('close', () => {
    clearInterval(heartbeat);
    appEvents.off(eventKey, listener);
  });
});

// Example: emit an update to a user from anywhere in the app:
//   import appEvents from '../events.mjs';
//   appEvents.emit(`update:${userId}`, { type: 'notification', message: 'Hello!' });

export default router;
