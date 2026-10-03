import { CORE_TECHNIQUES, type PuzzleProfile } from '../solver/profile'
import { hasCorridor, maxRegionSize, sizeStdDev } from '../growth'

// Target technique profiles for the pre-generated tiers. Unlike the runtime
// gate (targetDifficulty: "did any one technique from a set fire, and is the
// score high enough"), these ask for breadth — every core technique appears —
// while keeping the amount of naked-pair ("doublet") reasoning low, so the
// difficulty comes from a mix of techniques instead of one repeated pair.
//
// Calibration (external reference sets, 60 puzzles each): naked-pair
// eliminations average 3.5 (7×7), 7.3 (10×10 tier 3) and 10.6 (10×10 hard),
// and our old hard/expert output averaged 7-13. The budgets below sit under that.
//
// Solve depth and shape are held to the reference sets' medians too (puzzles3-hard,
// 10×10: median 14 rounds, region-size stddev 6.4). The first generation pass
// beat the references on breadth and doublets but came out shallower (median 12
// rounds) and lopsided (median stddev 7.8 — a few giant regions plus tiny anchors),
// so rounds and size spread are part of the bar, not just the technique mix.
export interface TierSpec {
  minRounds: number           // solve depth: rounds in which a real (non-free) technique fired
  maxSizeStdDev: number       // region-size spread ceiling; keeps boards from degenerating into giant blobs + tiny anchors
  minSize: number             // smaller boards simply have less room for a rich technique mix
  mustFire: string[]          // every one of these has to fire
  mustRequireHypothesis: boolean
  maxPairUse: number          // cap on naked + hidden eliminations ("doublets")
  fitness: (p: PuzzleProfile) => number
  accepts: (p: PuzzleProfile) => boolean
  layoutAccepts: (regions: number[][], N: number) => boolean
}

function makeTier(minSize: number, minRounds: number, maxSizeStdDev: number, mustFire: string[], mustRequireHypothesis: boolean, maxPairUse: number): TierSpec {
  const accepts = (p: PuzzleProfile): boolean =>
    p.solved &&
    mustFire.every(t => (p.counts[t] ?? 0) > 0) &&
    (!mustRequireHypothesis || p.required.includes('hypothesis')) &&
    p.pairUse <= maxPairUse &&
    p.rounds >= minRounds
  const fitness = (p: PuzzleProfile): number => {
    if (!p.solved) return -Infinity
    let f = 0
    // Breadth first: each missing technique costs far more than any count bonus recovers.
    for (const t of mustFire) f += (p.counts[t] ?? 0) > 0 ? 100 : 0
    for (const t of CORE_TECHNIQUES) f += Math.min(p.counts[t] ?? 0, 3) * 4
    if (mustRequireHypothesis && p.required.includes('hypothesis')) f += 60
    f -= 5 * Math.max(0, p.pairUse - maxPairUse)   // over-budget doublets
    f -= 0.5 * p.pairUse                           // and generally fewer is better
    f += 3 * Math.min(p.rounds, minRounds) + 0.5 * p.rounds
    return f
  }
  const layoutAccepts = (regions: number[][], N: number): boolean =>
    !hasCorridor(regions, N) && maxRegionSize(regions, N) <= 25 && sizeStdDev(regions, N) <= maxSizeStdDev
  return { minRounds, maxSizeStdDev, layoutAccepts, minSize, mustFire, mustRequireHypothesis, maxPairUse, fitness, accepts }
}

export const TIERS = {
  // Hard: deduction plus a branch rule; forcing chains are optional.
  hard: makeTier(10, 10, 7.0, ['common-neighbor', 'naked', 'branch'], false, 6),
  // Expert: every core technique, and the puzzle cannot be solved without hypothesis.
  expert: makeTier(10, 14, 7.0, CORE_TECHNIQUES, true, 5),
}
