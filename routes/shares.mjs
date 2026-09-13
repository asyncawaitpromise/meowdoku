import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import { shareLimiter } from '../middlewares/rateLimit.mjs';
import appEvents from '../events.mjs';
import { publicFriend } from './friends.mjs';

const router = Router();

router.use(requireAuth);

// Open to anyone with an account, not just friends — everyone gets at least a
// guest account on app load (see /api/auth/guest), so a recipient who isn't a
// friend yet can still be reached by their friend code (the same code used
// to add a friend), not just by picking from an existing friends list.
router.post('/', shareLimiter, (req, res) => {
  const { toUserId, toFriendCode, shareCode } = req.body;
  if ((!toUserId && !toFriendCode) || !shareCode) {
    return res.status(400).json({ error: 'toUserId or toFriendCode, and shareCode, are required' });
  }

  const target = toFriendCode
    ? db.prepare('SELECT id FROM users WHERE friend_code = ?').get(toFriendCode.trim().toUpperCase())
    : db.prepare('SELECT id FROM users WHERE id = ?').get(toUserId);

  if (!target) return res.status(404).json({ error: 'No user found to share with' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot share a puzzle with yourself' });

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO puzzle_shares (id, from_user_id, to_user_id, share_code) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, target.id, shareCode);

  const share = { id, shareCode, from: publicFriend(req.user), createdAt: new Date().toISOString() };
  appEvents.emit(`update:${target.id}`, { type: 'puzzle_shared', share });

  res.status(201).json({ share });
});

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT ps.id AS share_id, ps.share_code, ps.created_at, u.*
    FROM puzzle_shares ps
    JOIN users u ON u.id = ps.from_user_id
    WHERE ps.to_user_id = ?
    ORDER BY ps.rowid DESC
  `).all(req.user.id);

  const shares = rows.map(row => ({
    id: row.share_id,
    shareCode: row.share_code,
    createdAt: row.created_at,
    from: publicFriend(row),
  }));

  res.json({ shares });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM puzzle_shares WHERE id = ? AND to_user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Share not found' });
  res.status(204).end();
});

export default router;
