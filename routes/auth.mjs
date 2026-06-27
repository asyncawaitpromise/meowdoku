import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRequire } from 'module';
import db from '../db.mjs';
import { requireAuth } from '../middlewares/requireAuth.mjs';

const require = createRequire(import.meta.url);
const adminEmails = require('../config/admins.json');

const router = Router();

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
    { userId: user.id, email: user.email },
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
// Email / password
// ---------------------------------------------------------------------------

// Open registration — remove the comment below and add requireAdmin as
// middleware if you want invite-only signup.
router.post('/signup', async (req, res) => {
  const { email, password, passwordConfirm, name } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password !== passwordConfirm) return res.status(400).json({ error: 'Passwords do not match' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const password_hash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();

  db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(
    id, email.toLowerCase(), password_hash, name || null
  );

  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  syncAdminStatus(user);
  const token = issueToken(user);

  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/signin', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

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
      db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run(id, DEV_EMAIL, 'Dev User');
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

// Initiate OAuth redirect
router.get('/oauth/:provider', (req, res) => {
  const provider = PROVIDERS[req.params.provider];
  if (!provider) return res.status(404).json({ error: 'Unknown provider' });

  const clientId = provider.clientId();
  if (!clientId) return res.status(500).json({ error: `${req.params.provider} OAuth not configured` });

  const state = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO oauth_state (state, provider) VALUES (?, ?)').run(state, req.params.provider);

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
    } else {
      // Wrap in a transaction to prevent a race condition where two concurrent
      // OAuth callbacks for the same new user both attempt to INSERT.
      user = db.transaction(() => {
        let u = db.prepare('SELECT * FROM users WHERE email = ?').get(providerUser.email.toLowerCase());
        if (!u) {
          const id = crypto.randomUUID();
          db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run(
            id, providerUser.email.toLowerCase(), providerUser.name || null
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
