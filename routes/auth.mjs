import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRequire } from 'module';
import db, { withUniqueFriendCode } from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';
import { guestLimiter, credentialLimiter, oauthInitLimiter } from '../middlewares/rateLimit.mjs';

const require = createRequire(import.meta.url);
const adminEmails = require('../config/admins.json');

const router = Router();

// Default UI theme for new accounts (matches the app's custom daisyUI theme).
// Kept explicit in INSERTs so already-deployed DBs (whose column default may
// still be 'night') still grant new users the warm look.
const DEFAULT_THEME = 'meowdoku';

// ---------------------------------------------------------------------------
// Admin email allowlist — union of config/admins.json and ADMIN_USERS env var.
// Changes take effect on the user's next login.
// ---------------------------------------------------------------------------

const ADMIN_EMAILS = new Set(adminEmails.map(e => e.toLowerCase()));

if (process.env.ADMIN_USERS) {
  try {
    const envAdmins = JSON.parse(process.env.ADMIN_USERS);
    for (const { email } of envAdmins) ADMIN_EMAILS.add(email.toLowerCase());
  } catch {
    console.error('⚠️  ADMIN_USERS is not valid JSON — skipping in auth allowlist');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function issueToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// Sync is_admin based on the allowlist. Called after every login/signup.
function syncAdminStatus(user, forceAdmin = false) {
  const shouldBeAdmin = forceAdmin || ADMIN_EMAILS.has(user.email);
  if (!!user.is_admin !== shouldBeAdmin) {
    db.prepare(`UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(shouldBeAdmin ? 1 : 0, user.id);
    user.is_admin = shouldBeAdmin ? 1 : 0;
  }
  return user;
}

// ---------------------------------------------------------------------------
// Username / password
//
// No email/SSO for now — an account is just a username+password promoted
// from the caller's existing anon session (or, for /signup, a brand new one).
// The `email`/OAuth machinery below is kept for whenever that's revisited,
// but nothing in the client links to it.
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validateCredentials(username, password, passwordConfirm) {
  if (!username || !password) return 'Username and password required';
  if (!USERNAME_RE.test(username)) return 'Username must be 3-20 characters: letters, numbers, or underscore';
  if (password !== passwordConfirm) return 'Passwords do not match';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

// Open registration — add requireAdmin as middleware for invite-only signup.
router.post('/signup', credentialLimiter, async (req, res) => {
  const { username, password, passwordConfirm, name } = req.body;

  const validationError = validateCredentials(username, password, passwordConfirm);
  if (validationError) return res.status(400).json({ error: validationError });

  const existing = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
  if (existing) return res.status(409).json({ error: 'Username already in use' });

  const password_hash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();

  withUniqueFriendCode(code =>
    db.prepare('INSERT INTO users (id, username, password_hash, name, friend_code, theme) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, username, password_hash, name || null, code, DEFAULT_THEME
    )
  );

  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  syncAdminStatus(user);
  const token = issueToken(user);

  res.status(201).json({ token, user: publicUser(user) });
});

// Anonymous session — no credentials, promotable later via /promote or an OAuth login.
router.post('/guest', guestLimiter, (_req, res) => {
  const id = crypto.randomUUID();
  withUniqueFriendCode(code =>
    db.prepare('INSERT INTO users (id, is_anon, friend_code, theme) VALUES (?, 1, ?, ?)').run(id, code, DEFAULT_THEME)
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = issueToken(user);

  res.status(201).json({ token, user: publicUser(user) });
});

// Attaches real credentials to the calling guest account in place, so progress tied
// to its id carries over — this is not a create-and-merge flow.
router.post('/promote', credentialLimiter, requireAuth, async (req, res) => {
  if (!req.user.is_anon) return res.status(403).json({ error: 'Only guest accounts can be promoted' });

  const { username, password, passwordConfirm, name } = req.body;

  const validationError = validateCredentials(username, password, passwordConfirm);
  if (validationError) return res.status(400).json({ error: validationError });

  const existing = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?').get(username, req.user.id);
  if (existing) return res.status(409).json({ error: 'Username already in use' });

  const password_hash = await bcrypt.hash(password, 12);
  db.prepare(`UPDATE users SET username = ?, password_hash = ?, name = ?, is_anon = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(username, password_hash, name || null, req.user.id);

  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  syncAdminStatus(user);
  const token = issueToken(user);

  res.json({ token, user: publicUser(user) });
});

router.post('/signin', credentialLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  syncAdminStatus(user);
  const token = issueToken(user);
  res.json({ token, user: publicUser(user) });
});

// ---------------------------------------------------------------------------
// Sign in on another device
//
// A second way to reach an existing account without email/SSO: mint a
// short-lived, single-use 5-character code on an already-signed-in device,
// then redeem it (unauthenticated) on the other device to log into that same
// account — sharing progress without either device needing credentials.
// ---------------------------------------------------------------------------

const DEVICE_LINK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // matches friend_code's ambiguity-free set
const DEVICE_LINK_TTL_MINUTES = 10;

function generateDeviceLinkCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += DEVICE_LINK_ALPHABET[crypto.randomInt(DEVICE_LINK_ALPHABET.length)];
  return code;
}

router.post('/device-link', requireAuth, (req, res) => {
  let code;
  for (let attempt = 0; ; attempt++) {
    code = generateDeviceLinkCode();
    try {
      db.prepare('INSERT INTO device_links (code, user_id) VALUES (?, ?)').run(code, req.user.id);
      break;
    } catch (err) {
      if (attempt >= 4 || !String(err.message).includes('UNIQUE constraint failed')) throw err;
    }
  }
  res.status(201).json({ code, expiresInMinutes: DEVICE_LINK_TTL_MINUTES });
});

router.post('/device-link/:code/redeem', (req, res) => {
  const link = db.prepare(`
    SELECT * FROM device_links
    WHERE code = ? AND used_at IS NULL AND created_at > datetime('now', ?)
  `).get(req.params.code.toUpperCase(), `-${DEVICE_LINK_TTL_MINUTES} minutes`);

  if (!link) return res.status(404).json({ error: 'This link is invalid or has expired' });

  db.prepare(`UPDATE device_links SET used_at = datetime('now') WHERE code = ?`).run(link.code);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(link.user_id);
  if (!user) return res.status(404).json({ error: 'That account no longer exists' });

  syncAdminStatus(user);
  const token = issueToken(user);
  res.json({ token, user: publicUser(user) });
});

// Dev-only: passwordless login as a seeded dev user
if (process.env.NODE_ENV !== 'production') {
  router.post('/dev-login', (req, res) => {
    const DEV_EMAIL = 'dev@local';
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(DEV_EMAIL);
    if (!user) {
      const id = crypto.randomUUID();
      withUniqueFriendCode(code =>
        db.prepare('INSERT INTO users (id, email, name, friend_code, theme) VALUES (?, ?, ?, ?, ?)').run(id, DEV_EMAIL, 'Dev User', code, DEFAULT_THEME)
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }
    syncAdminStatus(user, true); // dev user is always admin
    res.json({ token: issueToken(user), user: publicUser(user) });
  });
}

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/profile', requireAuth, (req, res) => {
  const { name, theme } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (theme !== undefined) { fields.push('theme = ?'); values.push(theme); }
  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/password-reset-request', (_req, res) => {
  res.status(501).json({ error: 'Password reset is not yet implemented.' });
});

router.post('/password-reset-confirm', (_req, res) => {
  res.status(501).json({ error: 'Password reset is not yet implemented.' });
});

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    extractUser: (data) => ({ id: data.id, email: data.email, name: data.name }),
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    emailUrl: 'https://api.github.com/user/emails',
    scope: 'user:email',
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    extractUser: (data, emails) => ({
      id: String(data.id),
      email: data.email || emails?.find(e => e.primary)?.email,
      name: data.name || data.login,
    }),
  },
  discord: {
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    clientId: () => process.env.DISCORD_CLIENT_ID,
    clientSecret: () => process.env.DISCORD_CLIENT_SECRET,
    extractUser: (data) => ({ id: data.id, email: data.email, name: data.username }),
  },
};

// Initiate OAuth redirect — also writes a row to oauth_state per hit, so it's
// rate-limited despite being a redirect.
router.get('/oauth/:provider', oauthInitLimiter, (req, res) => {
  const provider = PROVIDERS[req.params.provider];
  if (!provider) return res.status(404).json({ error: 'Unknown provider' });

  const clientId = provider.clientId();
  if (!clientId) return res.status(500).json({ error: `${req.params.provider} OAuth not configured` });

  // ?token= carries "promote this guest account" through the redirect — no auth header
  // reaches us here. An invalid/expired/non-guest token just falls back to normal login.
  let promoteUserId = null;
  if (req.query.token) {
    try {
      const payload = jwt.verify(req.query.token, process.env.JWT_SECRET);
      const anonUser = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId);
      if (anonUser?.is_anon) promoteUserId = anonUser.id;
    } catch {}
  }

  const state = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO oauth_state (state, provider, promote_user_id) VALUES (?, ?, ?)').run(
    state, req.params.provider, promoteUserId
  );

  const callbackUrl = `${process.env.OAUTH_CALLBACK_BASE || ''}/api/auth/oauth/${req.params.provider}/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: provider.scope,
    state,
  });

  res.redirect(`${provider.authUrl}?${params}`);
});

// OAuth callback
router.get('/oauth/:provider/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const providerName = req.params.provider;
  const provider = PROVIDERS[providerName];

  const frontendRedirect = process.env.OAUTH_REDIRECT_URL || '/auth/callback';

  // req.query values can be arrays if the same param appears multiple times — reject those
  if (typeof code !== 'string' || typeof state !== 'string') {
    return res.redirect(`${frontendRedirect}?error=invalid_request`);
  }

  if (error || !code) {
    return res.redirect(`${frontendRedirect}?error=${encodeURIComponent(typeof error === 'string' ? error : 'oauth_denied')}`);
  }

  const storedState = db.prepare('SELECT * FROM oauth_state WHERE state = ?').get(state);
  if (!storedState || storedState.provider !== providerName) {
    return res.redirect(`${frontendRedirect}?error=invalid_state`);
  }
  db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);

  try {
    const callbackUrl = `${process.env.OAUTH_CALLBACK_BASE || ''}/api/auth/oauth/${providerName}/callback`;

    const tokenRes = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        client_id: provider.clientId(),
        client_secret: provider.clientSecret(),
        code,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token received');

    const userRes = await fetch(provider.userUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    let emails = null;
    if (providerName === 'github' && !userData.email) {
      const emailRes = await fetch(provider.emailUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      emails = await emailRes.json();
    }

    const providerUser = provider.extractUser(userData, emails);
    if (!providerUser.email) throw new Error('Could not retrieve email from provider');

    let user = null;
    const oauthAccount = db
      .prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?')
      .get(providerName, providerUser.id);

    if (oauthAccount) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(oauthAccount.user_id);
    } else if (storedState.promote_user_id) {
      const anonUser = db.prepare('SELECT * FROM users WHERE id = ? AND is_anon = 1').get(storedState.promote_user_id);
      if (!anonUser) throw new Error('Guest account no longer exists');

      const existingOwner = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(providerUser.email.toLowerCase(), anonUser.id);
      if (existingOwner) throw new Error('That account is already linked to a different user');

      user = db.transaction(() => {
        db.prepare(`UPDATE users SET email = ?, name = ?, is_anon = 0, updated_at = datetime('now') WHERE id = ?`).run(
          providerUser.email.toLowerCase(), providerUser.name || null, anonUser.id
        );
        db.prepare('INSERT OR IGNORE INTO oauth_accounts (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)').run(
          crypto.randomUUID(), anonUser.id, providerName, providerUser.id
        );
        return db.prepare('SELECT * FROM users WHERE id = ?').get(anonUser.id);
      })();
    } else {
      // Wrap in a transaction to prevent a race condition where two concurrent
      // OAuth callbacks for the same new user both attempt to INSERT.
      user = db.transaction(() => {
        let u = db.prepare('SELECT * FROM users WHERE email = ?').get(providerUser.email.toLowerCase());
        if (!u) {
          const id = crypto.randomUUID();
          withUniqueFriendCode(code =>
            db.prepare('INSERT INTO users (id, email, name, friend_code, theme) VALUES (?, ?, ?, ?, ?)').run(
              id, providerUser.email.toLowerCase(), providerUser.name || null, code, DEFAULT_THEME
            )
          );
          u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        }
        db.prepare('INSERT OR IGNORE INTO oauth_accounts (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)').run(
          crypto.randomUUID(), u.id, providerName, providerUser.id
        );
        return u;
      })();
    }

    syncAdminStatus(user);
    const token = issueToken(user);
    res.redirect(`${frontendRedirect}?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error(`OAuth ${providerName} error:`, err);
    res.redirect(`${frontendRedirect}?error=${encodeURIComponent(err.message)}`);
  }
});

export default router;
