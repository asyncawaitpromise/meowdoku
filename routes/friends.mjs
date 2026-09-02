import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import { isOnline } from '../presence.mjs';
import appEvents from '../events.mjs';

const router = Router();

router.use(requireAuth);

// Projection for another user's data — never includes email or password_hash.
// publicUser() in auth.mjs is for a user's own profile only.
function publicFriend(user) {
  const { id, name, is_anon, friend_code, theme } = user;
  return { id, name, is_anon, friend_code, theme };
}

export function getFriendIds(userId) {
  const rows = db.prepare(`
    SELECT requester_id, addressee_id FROM friend_requests
    WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
  `).all(userId, userId);

  return rows.map(row => (row.requester_id === userId ? row.addressee_id : row.requester_id));
}

router.post('/requests', (req, res) => {
  const { friendCode } = req.body;
  if (!friendCode) return res.status(400).json({ error: 'friendCode is required' });

  const target = db.prepare('SELECT * FROM users WHERE friend_code = ?').get(friendCode.trim().toUpperCase());
  if (!target) return res.status(404).json({ error: 'No user with that friend code' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot friend yourself' });

  const existing = db.prepare(`
    SELECT * FROM friend_requests
    WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(req.user.id, target.id, target.id, req.user.id);

  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
    if (existing.requester_id === req.user.id) return res.status(409).json({ error: 'Request already sent' });

    // They already sent us a request — accept it instead of leaving two pending rows facing each other.
    db.prepare(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`).run(existing.id);
    appEvents.emit(`update:${existing.requester_id}`, { type: 'friend_request_accepted', userId: req.user.id });
    return res.json({ status: 'accepted' });
  }

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO friend_requests (id, requester_id, addressee_id) VALUES (?, ?, ?)').run(id, req.user.id, target.id);
  appEvents.emit(`update:${target.id}`, { type: 'friend_request', request: { id, requester: publicFriend(req.user) } });

  res.status(201).json({ status: 'pending' });
});

router.get('/requests', (req, res) => {
  const rows = db.prepare(`
    SELECT fr.id AS request_id, u.*
    FROM friend_requests fr
    JOIN users u ON u.id = fr.requester_id
    WHERE fr.addressee_id = ? AND fr.status = 'pending'
  `).all(req.user.id);

  res.json({ requests: rows.map(row => ({ id: row.request_id, requester: publicFriend(row) })) });
});

router.post('/requests/:id/accept', (req, res) => {
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
  if (!request || request.addressee_id !== req.user.id) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Request is not pending' });

  db.prepare(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`).run(request.id);
  appEvents.emit(`update:${request.requester_id}`, { type: 'friend_request_accepted', userId: req.user.id });

  res.json({ status: 'accepted' });
});

router.post('/requests/:id/decline', (req, res) => {
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
  if (!request || request.addressee_id !== req.user.id) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Request is not pending' });

  db.prepare('DELETE FROM friend_requests WHERE id = ?').run(request.id);
  res.status(204).end();
});

router.get('/', (req, res) => {
  const friendIds = getFriendIds(req.user.id);

  const friends = friendIds.map(friendId => {
    const friend = db.prepare('SELECT * FROM users WHERE id = ?').get(friendId);
    const progress = db.prepare('SELECT * FROM progress WHERE user_id = ?').get(friendId);

    return {
      ...publicFriend(friend),
      online: isOnline(friendId),
      progress: {
        completedLevels: progress ? JSON.parse(progress.completed_levels) : [],
        completedPuzzles: progress ? JSON.parse(progress.completed_puzzles) : {},
      },
    };
  });

  res.json({ friends });
});

router.delete('/:userId', (req, res) => {
  const result = db.prepare(`
    DELETE FROM friend_requests
    WHERE status = 'accepted'
      AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
  `).run(req.user.id, req.params.userId, req.params.userId, req.user.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Not friends' });
  res.status(204).end();
});

export default router;
