import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env.local' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Local dev: seed DB and auto-generate JWT secret
if (process.env.LOCAL_DEV === 'true') {
  const { setup } = await import('./scripts/localDev.mjs');
  await setup();
}

// Sync seeded admin accounts from ADMIN_USERS env var.
// Format: JSON array of {email, password} objects.
// On each startup: upserts each admin account, then demotes any DB admin
// whose email is no longer in the list (and isn't in config/admins.json).
if (process.env.ADMIN_USERS) {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const adminEmailAllowlist = new Set(require('./config/admins.json').map(e => e.toLowerCase()));

  let adminUsers;
  try {
    adminUsers = JSON.parse(process.env.ADMIN_USERS);
  } catch {
    console.error('⚠️  ADMIN_USERS is not valid JSON — skipping admin sync');
    adminUsers = null;
  }

  if (adminUsers) {
    const { default: db } = await import('./db.mjs');
    const envAdminEmails = new Set(adminUsers.map(a => a.email.toLowerCase()));

    for (const { email, password } of adminUsers) {
      const emailLower = email.toLowerCase();
      const passwordHash = await bcrypt.hash(password, 12);
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(emailLower);
      if (existing) {
        db.prepare(`UPDATE users SET password_hash = ?, is_admin = 1, updated_at = datetime('now') WHERE email = ?`)
          .run(passwordHash, emailLower);
      } else {
        db.prepare('INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, 1)')
          .run(crypto.randomUUID(), emailLower, passwordHash);
      }
    }

    const keepAdminEmails = new Set([...envAdminEmails, ...adminEmailAllowlist]);
    const currentAdmins = db.prepare(`SELECT email FROM users WHERE is_admin = 1`).all();
    for (const { email } of currentAdmins) {
      if (!keepAdminEmails.has(email.toLowerCase())) {
        db.prepare(`UPDATE users SET is_admin = 0, updated_at = datetime('now') WHERE email = ?`).run(email);
        console.log(`🔒 Revoked admin from ${email} (removed from ADMIN_USERS)`);
      }
    }

    console.log(`✅ Admin users synced: ${[...envAdminEmails].join(', ')}`);
  }
}

const app = express();

// CORS origins: set CORS_ORIGINS env var as a comma-separated list for production.
// Falls back to localhost dev origins when not set.
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : [
      'http://127.0.0.1:3000', 'http://localhost:3000',
      'http://127.0.0.1:5173', 'http://localhost:5173',
    ];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());

// Serve built frontend
app.use(express.static(path.join(__dirname, 'dist')));

// --- API routes ---
import authRouter from './routes/auth.mjs';
import sseRouter from './routes/sse.mjs';

app.use('/api/auth', authRouter);
app.use('/api/sse', sseRouter);

// Add your own routes here:
//   import widgetsRouter from './routes/widgets.mjs';
//   app.use('/api/widgets', widgetsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// SPA catch-all — must come after all API routes
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Global error handler — must be last middleware.
// Express 5 automatically forwards thrown/rejected errors here.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
