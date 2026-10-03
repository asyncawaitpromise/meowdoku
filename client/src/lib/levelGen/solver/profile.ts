import { canSolveLogically } from './canSolveLogically'
import { STRATEGY_NAMES } from './strategyNames'

// A puzzle's technique profile: not just which techniques the solver *happened*
// to reach for (it applies them in a fixed order, so cheap ones pre-empt
// expensive ones), but which ones the puzzle genuinely *requires* — found by
// ablation: switch a technique off and see whether the puzzle still solves.
export interface PuzzleProfile {
  solved: boolean
  counts: Record<string, number>      // elimination count per technique, from the normal solve
  fired: string[]                     // techniques that fired in the normal solve
  required: string[]                  // 'hypothesis' if the puzzle can't be solved without branch/forcing-chain; else the deduction techniques (common-neighbor, naked) it can't be solved without
  pairUse: number                     // naked + hidden subset eliminations — the "doublets" a tier wants few of
  rounds: number
  maxSubsetSize: number
}

// Techniques that can fire on a solvable puzzle. Singleton propagation is the base
// mechanic, not a removable "skill". Dead (never fire on a solvable puzzle, confirmed
// against the external reference sets): trap 2×2 and region crowding are pre-empted by
// common-neighbor; X-wing needs 4 regions confined to 2 rows (4 cats in 2 rows); and
// hidden subsets are the pigeonhole dual of naked subsets, which are tried first at
// every k, so a hidden subset is always preceded by its naked twin.
//
// The techniques a "uses everything" puzzle should exercise. Symmetry is
// layout-dependent rather than a skill, so it isn't part of this set.
export const CORE_TECHNIQUES: string[] = ['common-neighbor', 'naked', 'branch', 'forcing-chain']

const BIT_OF: Record<string, number> = Object.fromEntries(STRATEGY_NAMES.map(([bit, name]) => [name, bit]))
const HYPOTHESIS_BITS = BIT_OF['branch'] | BIT_OF['forcing-chain']

export function profilePuzzle(regions: number[][], N: number): PuzzleProfile {
  const base = canSolveLogically(regions, N)
  const counts = base.techniqueCounts ?? {}
  const fired = Object.keys(counts)
  const required: string[] = []
  if (base.solved) {
    // Ablating one technique alone proves little: forcing-chain subsumes every
    // other deduction, so it would rescue any puzzle. Instead, strip the
    // hypothesis techniques first, then ask what the pure-deduction solve needs.
    if (!canSolveLogically(regions, N, HYPOTHESIS_BITS).solved) {
      required.push('hypothesis')
    } else {
      for (const name of ['common-neighbor', 'naked']) {
        if (!counts[name]) continue
        if (!canSolveLogically(regions, N, HYPOTHESIS_BITS | BIT_OF[name]).solved) required.push(name)
      }
    }
  }
  return {
    solved: base.solved,
    counts,
    fired,
    required,
    pairUse: (counts.naked ?? 0) + (counts.hidden ?? 0),
    rounds: base.rounds,
    maxSubsetSize: base.maxSubsetSize,
  }
}
