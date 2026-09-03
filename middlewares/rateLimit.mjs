import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Rate limiting for the open / high-churn endpoints.
//
// Two kinds exist here:
//   - Unauthenticated endpoints (guest signup, credentials login) can only be
//     keyed by IP — there's no user yet.
//   - Authenticated endpoints (shares, match events, placements) key by user id
//     when available so a shared NAT IP doesn't tank a whole household, and
//     falls back to IP.
//
// Limits are deliberately generous for this app's traffic — they exist to cap
// *open* abuse (unlimited guest rows, puzzle-share spam, move flooding), not to
// meter normal play. RATE_LIMIT_SCALE (used by tests) multiplies every limit.
//
// req.ip only means the real client IP when trust proxy is set (index.mjs does
// this for the CapRover nginx hop); ipKeyGenerator also normalizes IPv6 so a
// v6 client can't dodge a limit by switching address forms.

const LIMIT_SCALE = Math.max(1, Number(process.env.RATE_LIMIT_SCALE) || 1);

const ipKey = (req) => ipKeyGenerator(req.ip);
const byUserOrIp = (req) => req.user?.id ?? ipKeyGenerator(req.ip);

export function createLimiter({ windowMs, limit, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator: keyGenerator ?? ipKey,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message || 'Too many requests, please try again later' },
  });
}

// POST /api/auth/guest — every guest signup creates a row, so an unauthenticated
// flooder can grow the users table without bound. 10 per IP per 15 minutes is
// well past a single user's bootstrap traffic (the client fires one), while a
// few devices behind one IP still fit.
export const guestLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10 * LIMIT_SCALE,
  message: 'Too many guest sessions from this connection. Try again in a few minutes.',
});

// POST /api/auth/signup|signin|promote — cheap credential attempts to brute
// force. Same shape as guest: tight per-IP, generous in aggregate.
export const credentialLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10 * LIMIT_SCALE,
  message: 'Too many login attempts. Try again in a few minutes.',
});

// POST /api/shares — wrote a puzzle_share row for every send; a loop keyed by
// user can grow that table arbitrarily.
export const shareLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 30 * LIMIT_SCALE,
  keyGenerator: byUserOrIp,
  message: 'Too many puzzles shared. Try again later.',
});

// POST /api/friends/requests — social spam is mild, but the inbox grows per row.
export const friendRequestLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 30 * LIMIT_SCALE,
  keyGenerator: byUserOrIp,
  message: 'Too many friend requests. Try again later.',
});

// POST /api/matches — one row + one player row each; also free puzzle storage.
export const matchCreateLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 30 * LIMIT_SCALE,
  keyGenerator: byUserOrIp,
  message: 'Too many matches created. Try again later.',
});

// POST /api/matches/:id/events and /:id/place — the h2h move stream and the
// co-op shared board. Human play lands a move every few seconds; these ceilings
// stop a client that "forgot to stop tapping" (or an event-flooding cheater)
// from dominating a session's row count or event log.
export const matchEventLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 120 * LIMIT_SCALE,
  keyGenerator: byUserOrIp,
  message: 'Too many match events. Slow down.',
});

export const matchPlaceLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 240 * LIMIT_SCALE,
  keyGenerator: byUserOrIp,
  message: 'Too many placements. Slow down.',
});