import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import { puzzleCatalogLimiter } from '../middlewares/rateLimit.mjs';
import { DIFFICULTIES, NEXT_SEQ_SQL } from '../scripts/ingestPuzzles.mjs';

const router = Router();

const DIFFICULTY_SET = new Set(DIFFICULTIES);
const BATCH_DEFAULT = 20;
const BATCH_MAX = 50;

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
    INSERT OR IGNORE INTO generated_puzzles (id, share_code, difficulty, gate_met, contributor_user_id, seq)
    VALUES (?, ?, ?, ?, ?, ${NEXT_SEQ_SQL})
  `).run(id, shareCode, difficulty ?? null, gateMet === undefined ? null : (gateMet ? 1 : 0), req.user.id);

  res.status(202).end();
});

// A per-player shuffled walk over the curated puzzles, in batches. The order is
// hash(userId, puzzleId): different for every player (so what you get is yours to compare
// with a friend), stable as the store grows, and needs no per-player state on the server —
// the client just remembers where it got to.
//
//   cursor  position in this player's shuffled order (the last key delivered; -1 to start)
//   since   highest `seq` (insertion order) the client has already been offered
//
// A puzzle added after the client's last visit may land *behind* its cursor in the shuffled
// order, where the walk would never reach it. So each batch first catches the client up on
// anything with seq > since that sits at or behind the cursor, then continues forward.
function shuffleKey(userId, puzzleId) {
  // FNV-1a, 32-bit: cheap, deterministic, well spread — not a security boundary.
  let h = 0x811c9dc5;
  const input = `${userId}:${puzzleId}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

router.get('/batch', (req, res) => {
  const difficulty = String(req.query.difficulty ?? '');
  if (!DIFFICULTY_SET.has(difficulty)) return res.status(400).json({ error: 'Invalid difficulty' });
  const limit = req.query.limit === undefined ? BATCH_DEFAULT : Number(req.query.limit);
  const cursor = req.query.cursor === undefined ? -1 : Number(req.query.cursor);
  const since = req.query.since === undefined ? 0 : Number(req.query.since);
  if (!Number.isInteger(limit) || limit < 1 || limit > BATCH_MAX) return res.status(400).json({ error: `limit must be 1-${BATCH_MAX}` });
  if (!Number.isInteger(cursor) || cursor < -1 || cursor > 0xffffffff) return res.status(400).json({ error: 'Invalid cursor' });
  if (!Number.isInteger(since) || since < 0) return res.status(400).json({ error: 'Invalid since' });

  const rows = db.prepare(`
    SELECT id, share_code, seq FROM generated_puzzles WHERE source = 'curated' AND difficulty = ?
  `).all(difficulty).map(r => ({ id: r.id, shareCode: r.share_code, seq: r.seq, key: shuffleKey(req.user.id, r.id) }));
  const storeMaxSeq = rows.reduce((m, r) => Math.max(m, r.seq), 0);

  // `since` of 0 means a first visit: nothing is "new since last time", the forward walk covers everything.
  const catchUp = since > 0 ? rows.filter(r => r.key <= cursor && r.seq > since).sort((a, b) => a.seq - b.seq) : [];
  const forward = rows.filter(r => r.key > cursor).sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1));

  const catchUpPart = catchUp.slice(0, limit);
  let forwardEnd = Math.min(forward.length, limit - catchUpPart.length);
  // The cursor is a single number, so a page must never end between two puzzles that share a
  // key: the next walk (key > cursor) would skip the second. Extend the page over the whole group.
  while (forwardEnd > 0 && forwardEnd < forward.length && forward[forwardEnd].key === forward[forwardEnd - 1].key) forwardEnd++;
  const forwardPart = forward.slice(0, forwardEnd);
  const catchUpDone = catchUpPart.length === catchUp.length;

  res.json({
    puzzles: [...catchUpPart, ...forwardPart].map(r => ({ id: r.id, shareCode: r.shareCode })),
    cursor: forwardPart.length ? forwardPart[forwardPart.length - 1].key : cursor,
    // Only jump `since` to the store's newest once every catch-up puzzle has gone out.
    since: catchUpDone ? Math.max(since, storeMaxSeq) : catchUpPart[catchUpPart.length - 1].seq,
    exhausted: catchUpDone && forwardPart.length === forward.length,
  });
});

export default router;
