// Canonical bit -> technique-name mapping for SolveResult.strategiesUsed.
// Shared by canSolveLogically (to build techniqueCounts) and anything that
// needs to render a strategiesUsed bitmask as human-readable names (tests,
// generation-cache snapshots).
export const STRATEGY_NAMES: [number, string][] = [
  [1, 'singleton'],
  [2, 'naked'],
  [4, 'hidden'],
  [8, 'trap'],
  [16, 'crowding'],
  [32, 'forcing-chain'],
  [64, 'branch'],
  [128, 'xwing'],
  [256, 'symmetry'],
  [512, 'common-neighbor'],
]
