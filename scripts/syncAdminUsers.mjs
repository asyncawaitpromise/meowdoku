/**
 * Syncs seeded admin accounts from the ADMIN_USERS env var, called on every
 * server startup. ADMIN_USERS is a JSON array of {email, password} objects:
 * each one is upserted as an admin, then any DB admin whose email is in
 * neither ADMIN_USERS nor config/admins.json is demoted.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createRequire } from 'module';

export async function syncAdminUsers() {
  if (!process.env.ADMIN_USERS) return;

  const require = createRequire(import.meta.url);
  const adminEmailAllowlist = new Set(require('../config/admins.json').map(e => e.toLowerCase()));

  let adminUsers;
  try {
    adminUsers = JSON.parse(process.env.ADMIN_USERS);
  } catch {
    console.error('⚠️  ADMIN_USERS is not valid JSON — skipping admin sync');
    return;
  }

  const { default: db } = await import('../db.mjs');
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
