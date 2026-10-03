/**
 * Loads the committed curated puzzles into the puzzle store at server startup.
 *
 * `puzzles/curated/<difficulty>.txt` holds one share code per line (written by
 * `pnpm puzzles:publish` from the offline generator and committed to the repo). A puzzle's
 * identity is its share code, which encodes the region layout itself, so ingesting is
 * idempotent: INSERT OR IGNORE against the UNIQUE share_code index skips what's already
 * there, and a puzzle a client had already contributed is promoted to curated instead of
 * duplicated. No upload endpoint, credentials or "already loaded" log is needed — re-running
 * on every boot costs a few milliseconds for thousands of lines.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
// Share-code shapes the client can decode: v2 ("f" + base62) and legacy v1 ("mwd1.…").
export const SHARE_CODE = /^(f[0-9A-Za-z]{4,80}|mwd1\.[0-9A-Za-z.]{4,200})$/;

const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'puzzles', 'curated');

export const NEXT_SEQ_SQL = `(SELECT COALESCE(MAX(seq), 0) + 1 FROM generated_puzzles)`;

export async function ingestCuratedPuzzles(dir = process.env.PUZZLE_CURATED_DIR || defaultDir) {
  const { default: db } = await import('../db.mjs');
  const insert = db.prepare(`
    INSERT OR IGNORE INTO generated_puzzles (id, share_code, difficulty, gate_met, contributor_user_id, source, seq)
    VALUES (?, ?, ?, 1, NULL, 'curated', ${NEXT_SEQ_SQL})
  `);
  const promote = db.prepare(`
    UPDATE generated_puzzles SET source = 'curated', difficulty = ?, gate_met = 1
    WHERE share_code = ? AND (source IS NULL OR source != 'curated')
  `);

  const totals = { inserted: 0, promoted: 0, duplicates: 0, skipped: 0 };
  for (const difficulty of DIFFICULTIES) {
    const file = path.join(dir, `${difficulty}.txt`);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    db.transaction(() => {
      for (const code of lines) {
        if (!SHARE_CODE.test(code)) { totals.skipped++; continue; }
        if (insert.run(crypto.randomUUID(), code, difficulty).changes > 0) totals.inserted++;
        else if (promote.run(difficulty, code).changes > 0) totals.promoted++;
        else totals.duplicates++;
      }
    })();
  }
  if (totals.inserted || totals.promoted || totals.skipped) {
    console.log(`puzzle store: +${totals.inserted} new, ${totals.promoted} promoted, ${totals.duplicates} already present${totals.skipped ? `, ${totals.skipped} malformed lines skipped` : ''}`);
  }
  return totals;
}
