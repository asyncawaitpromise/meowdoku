import { decodeShareCode, type Difficulty, type GeneratedLevel } from './levelGen'

// Pre-generated puzzles (see scripts/puzzlegen): one v2 share code per line in
// /puzzles/<tier>.txt, built offline with a stricter technique profile than the
// in-browser generator can reach in reasonable time. Only the tiers that have a
// pool are listed; everything else keeps generating in workers.
export const POOLED_TIERS: ReadonlySet<Difficulty> = new Set<Difficulty>(['hard', 'expert'])

const cache = new Map<Difficulty, Promise<string[]>>()

// A missing pool file may come back as the SPA's index.html (status 200), so
// keep only lines that look like share codes rather than trusting the status.
const CODE_LINE = /^f[0-9A-Za-z]{4,}$/

export function parsePool(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => CODE_LINE.test(l))
}

export function loadPool(difficulty: Difficulty): Promise<string[]> {
  let p = cache.get(difficulty)
  if (!p) {
    p = fetch(`${import.meta.env?.BASE_URL ?? '/'}puzzles/${difficulty}.txt`)
      .then(r => (r.ok ? r.text() : ''))
      .then(parsePool)
      .catch(() => [])
    cache.set(difficulty, p)
  }
  return p
}

// Index into the pool with the same combined seed generateLevelByDifficulty
// uses, so a given (puzzleIndex, globalSeed) always maps to the same puzzle —
// co-op's two devices pick the identical board, and the share code fixes its
// colors too. New puzzles must only ever be appended to a pool file; reordering
// would hand returning players a different puzzle at the same index.
export function poolIndex(poolSize: number, puzzleIndex: number, globalSeed: number): number {
  const combined = puzzleIndex + globalSeed * 10007
  return ((combined % poolSize) + poolSize) % poolSize
}

export async function getPooledLevel(difficulty: Difficulty, puzzleIndex: number, globalSeed: number): Promise<GeneratedLevel | null> {
  if (!POOLED_TIERS.has(difficulty)) return null
  const codes = await loadPool(difficulty)
  if (codes.length === 0) return null
  return decodeShareCode(codes[poolIndex(codes.length, puzzleIndex, globalSeed)])
}
