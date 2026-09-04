import { Router } from 'express';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const progress = db.prepare('SELECT * FROM progress WHERE user_id = ?').get(req.user.id);
  const savedGameRows = db.prepare('SELECT game_id, data FROM saved_games WHERE user_id = ?').all(req.user.id);

  const savedGames = {};
  for (const row of savedGameRows) savedGames[row.game_id] = JSON.parse(row.data);

  res.json({
    completedLevels: progress ? JSON.parse(progress.completed_levels) : [],
    completedPuzzles: progress ? JSON.parse(progress.completed_puzzles) : {},
    savedGames,
  });
});

// The client sends completedLevels (array of puzzle indices) and completedPuzzles
// (object keyed by difficulty -> array of indices). Values are persisted verbatim and
// later JSON.parse'd back, so reject anything that isn't the shape the client owns —
// otherwise a malformed payload would surface later as confusing friend progress.
function isValidIndexList(value) {
  return Array.isArray(value) && value.every(v => Number.isInteger(v) && v >= 0);
}

function isValidCompletedPuzzles(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(isValidIndexList);
}

router.patch('/', (req, res) => {
  const { completedLevels, completedPuzzles } = req.body;

  if (completedLevels !== undefined && !isValidIndexList(completedLevels)) {
    return res.status(400).json({ error: 'completedLevels must be an array of non-negative integers' });
  }
  if (completedPuzzles !== undefined && !isValidCompletedPuzzles(completedPuzzles)) {
    return res.status(400).json({ error: 'completedPuzzles must be an object of difficulty -> array of non-negative integers' });
  }

  const existing = db.prepare('SELECT * FROM progress WHERE user_id = ?').get(req.user.id);
  const nextLevels = completedLevels !== undefined ? JSON.stringify(completedLevels) : (existing?.completed_levels ?? '[]');
  const nextPuzzles = completedPuzzles !== undefined ? JSON.stringify(completedPuzzles) : (existing?.completed_puzzles ?? '{}');

  db.prepare(`
    INSERT INTO progress (user_id, completed_levels, completed_puzzles)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      completed_levels = excluded.completed_levels,
      completed_puzzles = excluded.completed_puzzles,
      updated_at = datetime('now')
  `).run(req.user.id, nextLevels, nextPuzzles);

  res.json({
    completedLevels: JSON.parse(nextLevels),
    completedPuzzles: JSON.parse(nextPuzzles),
  });
});

router.put('/games/:gameId', (req, res) => {
  db.prepare(`
    INSERT INTO saved_games (user_id, game_id, data)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, game_id) DO UPDATE SET
      data = excluded.data,
      updated_at = datetime('now')
  `).run(req.user.id, req.params.gameId, JSON.stringify(req.body));

  res.json(req.body);
});

router.delete('/games/:gameId', (req, res) => {
  db.prepare('DELETE FROM saved_games WHERE user_id = ? AND game_id = ?').run(req.user.id, req.params.gameId);
  res.status(204).end();
});

router.post('/reset', (req, res) => {
  db.prepare('DELETE FROM progress WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM saved_games WHERE user_id = ?').run(req.user.id);
  res.json({});
});

export default router;
