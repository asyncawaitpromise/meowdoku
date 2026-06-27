import jwt from 'jsonwebtoken';
import db from '../db.mjs';

export function requireAuth(req, res, next) {
  // Accept token from Authorization header or ?token= query param (needed for EventSource)
  const header = req.headers['authorization'] || '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : '') || req.query.token;

  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
