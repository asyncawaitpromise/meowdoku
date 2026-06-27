/**
 * Local development setup — called automatically when LOCAL_DEV=true.
 * - Auto-generates JWT_SECRET if not configured
 * - Seeds a test user (test@local / testpassword)
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../db.mjs';

const TEST_EMAIL = 'test@local';
const TEST_PASSWORD = 'testpassword';

export async function setup() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🛠  LOCAL DEV MODE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Auto-generate JWT_SECRET if missing or placeholder
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'replace-with-a-random-secret') {
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    console.log('  🔑 JWT_SECRET auto-generated (session only)');
  }

  // Seed test user
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(TEST_EMAIL);
  if (!existing) {
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, password_hash, name, is_admin) VALUES (?, ?, ?, ?, 1)')
      .run(id, TEST_EMAIL, hash, 'Dev User');
    console.log('  👤 Test user created (is_admin=1)');
  } else {
    console.log('  👤 Test user exists');
  }
  console.log(`     Email:    ${TEST_EMAIL}`);
  console.log(`     Password: ${TEST_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}
