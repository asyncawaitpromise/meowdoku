// Count of distinct strategy bits that fired while solving a puzzle. Used to
// reject puzzles that only ever lean on one or two techniques (e.g. pure
// singleton-chain "easy" puzzles) even when their raw difficultyScore clears
// a tier's bar on step count alone.
export function techniqueVariety(strategiesUsed: number): number {
  let x = strategiesUsed, count = 0
  while (x) { count += x & 1; x >>= 1 }
  return count
}

// Weights each strategy bit by approximate difficulty:
// Bit 0 (1): singleton propagation = 1 pt
// Bit 1 (2): naked subsets = 3 pts
// Bit 2 (4): hidden subsets = 6 pts
// Bit 3 (8): trap 2x2 = 4 pts (dead — common-neighbor pre-empts it)
// Bit 4 (16): region crowding = 10 pts (dead — common-neighbor pre-empts it)
// Bit 5 (32): forcing chains = 50 pts — hypothesis-based, categorically harder
// Bit 6 (64): branch rule = 40 pts — also hypothesis-based
// Bit 7 (128): X-wing = 7 pts
// Bit 8 (256): symmetry-propagation = 2 pts
// Bit 9 (512): common-neighbor = 8 pts
//
// External tier-2 (7x7) uses common-neighbor + locked-pair + unit-intersection
// with no hypothesis (pure deduction) — those puzzles score ~14-28 with these weights.
// External tier-3 (10x10) requires hypothesis (contradiction-depth-1) in 100% of
// puzzles — forcing chains alone add 50 pts, making hypothesis puzzles score 55+.
// This creates a clear gap: hard (no hypothesis) ≈ 16-54, expert (hypothesis) ≈ 55+.
const WEIGHTS = [1, 3, 6, 4, 10, 50, 40, 7, 2, 8]

export function difficultyScore(strategiesUsed: number, easySteps: number, hardSteps: number, rounds: number): number {
  let score = 0
  for (let i = 0; i < WEIGHTS.length; i++)
    if (strategiesUsed & (1 << i)) score += WEIGHTS[i]
  // Step-count bonuses: hard steps (from hypothesis strategies) weighted higher
  score += Math.log2(easySteps + 1) * 0.3
  score += Math.log2(hardSteps + 1) * 1.2
  score += rounds * 0.8
  return Math.round(score * 10) / 10
}
