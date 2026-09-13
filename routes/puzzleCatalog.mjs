import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import { puzzleCatalogLimiter } from '../middlewares/rateLimit.mjs';

const router = Router();

router.use(requireAuth);

// Every visitor already has at least a guest account (see /api/auth/guest,
// bootstrapped on app load), so requiring auth here doesn't gate who can
// contribute — it just gives every stored puzzle a contributor to attribute
// generation load to, without that contributor being required for the row
// to remain useful (see generated_puzzles' nullable FK in db.mjs).
router.post('/', puzzleCatalogLimiter, (req, res) => {
  const { shareCode, difficulty, gateMet } = req.body;
  if (!shareCode) return res.status(400).json({ error: 'shareCode is required' });

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO generated_puzzles (id, share_code, difficulty, gate_met, contributor_user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, shareCode, difficulty ?? null, gateMet === undefined ? null : (gateMet ? 1 : 0), req.user.id);

  res.status(202).end();
});

export default router;
