import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import appEvents from '../events.mjs';
import { getFriendIds } from './friends.mjs';

const router = Router();

router.use(requireAuth);

const MAX_PLAYERS = 2;

// Projection for another user's data — never includes email or password_hash.
function publicFriend(user) {
  const { id, name, is_anon, friend_code, theme } = user;
  return { id, name, is_anon, friend_code, theme };
}

function getPlayers(sessionId) {
  const rows = db.prepare(`
    SELECT u.* FROM game_session_players gsp
    JOIN users u ON u.id = gsp.user_id
    WHERE gsp.session_id = ?
    ORDER BY gsp.joined_at
  `).all(sessionId);

  return rows.map(publicFriend);
}

function serializeSession(session) {
  return {
    id: session.id,
    mode: session.mode,
    difficulty: session.difficulty,
    puzzleSeed: session.puzzle_seed,
    status: session.status,
    players: getPlayers(session.id),
  };
}

router.post('/', (req, res) => {
  const { mode, difficulty, inviteFriendId } = req.body;
  if (!mode || !difficulty) return res.status(400).json({ error: 'mode and difficulty are required' });

  if (inviteFriendId && !getFriendIds(req.user.id).includes(inviteFriendId)) {
    return res.status(403).json({ error: 'Not friends with that user' });
  }

  const id = crypto.randomUUID();
  const puzzleSeed = crypto.randomInt(2 ** 31);

  db.prepare(`
    INSERT INTO game_sessions (id, mode, difficulty, puzzle_seed, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, mode, difficulty, puzzleSeed, req.user.id);
  db.prepare('INSERT INTO game_session_players (session_id, user_id) VALUES (?, ?)').run(id, req.user.id);

  if (inviteFriendId) {
    appEvents.emit(`update:${inviteFriendId}`, {
      type: 'match_invite',
      sessionId: id,
      mode,
      difficulty,
      from: publicFriend(req.user),
    });
  }

  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id);
  res.status(201).json(serializeSession(session));
});

// The session id itself is the access control, the same capability model puzzle
// sharing already uses — anyone holding the id can fetch or join it, not just an
// invited friend. Friend-invite is a convenience notification on top, not a gate,
// so two people can still race off a shared link with no friendship between them.
router.get('/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json(serializeSession(session));
});

router.post('/:id/join', (req, res) => {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const players = getPlayers(session.id);
  if (players.some(p => p.id === req.user.id)) {
    return res.json(serializeSession(session));
  }

  if (players.length >= MAX_PLAYERS) {
    return res.status(409).json({ error: 'Session is full' });
  }

  db.prepare('INSERT INTO game_session_players (session_id, user_id) VALUES (?, ?)').run(session.id, req.user.id);

  const updatedPlayers = getPlayers(session.id);
  if (updatedPlayers.length >= MAX_PLAYERS && session.status !== 'active') {
    db.prepare(`UPDATE game_sessions SET status = 'active' WHERE id = ?`).run(session.id);
  }

  const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id);
  const other = updatedPlayers.find(p => p.id !== req.user.id);
  if (other) {
    appEvents.emit(`update:${other.id}`, {
      type: 'match_update',
      sessionId: updatedSession.id,
      status: updatedSession.status,
      players: updatedPlayers,
    });
  }

  res.json(serializeSession(updatedSession));
});

export default router;
