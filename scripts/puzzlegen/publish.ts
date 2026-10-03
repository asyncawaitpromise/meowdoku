// Turns puzzles/pool/<tier>.jsonl into two committed files (one share code per line):
//   puzzles/curated/<tier>.txt       loaded into the server's puzzle store at startup
//                                    (scripts/ingestPuzzles.mjs) — the main source of puzzles
//   client/public/puzzles/<tier>.txt the static pool shipped with the app (offline first run, co-op) Entries are re-profiled from their share code and checked against the
// *current* tier spec, so tightening a bar in
// search/tiers.ts and re-publishing drops puzzles that no longer qualify
// without regenerating anything.
//
// Order is the pool's append order. Clients index into the file, so only ever
// append to a pool: removing or reordering entries changes which puzzle a
// returning player gets at a given index.
//
//   pnpm puzzles:publish
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadQualifying, root, TIER_NAMES } from './qualify'

const outDirs = [path.join(root, 'puzzles/curated'), path.join(root, 'client/public/puzzles')]
for (const d of outDirs) mkdirSync(d, { recursive: true })

for (const tier of TIER_NAMES) {
  const q = loadQualifying(tier)
  if (!q) { console.log(`${tier}: no pool, skipped`); continue }
  for (const d of outDirs) writeFileSync(path.join(d, `${tier}.txt`), q.entries.map(e => e.code).join('\n') + '\n')
  console.log(`${tier}: published ${q.entries.length}/${q.total}`)
}
