import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import appEvents from '../events.mjs';
import { getFriendIds, publicFriend } from './friends.mjs';

const router = Router();

router.use(requireAuth);

router.post('/', (req, res) => {
  const { toUserId, shareCode } = req.body;
  if (!toUserId || !shareCode) return res.status(400).json({ error: 'toUserId and shareCode are required' });

  if (!getFriendIds(req.user.id).includes(toUserId)) {
    return res.status(403).json({ error: 'You can only share puzzles with friends' });
  }

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO puzzle_shares (id, from_user_id, to_user_id, share_code) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, toUserId, shareCode);

  const share = { id, shareCode, from: publicFriend(req.user), createdAt: new Date().toISOString() };
  appEvents.emit(`update:${toUserId}`, { type: 'puzzle_shared', share });

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
