import { GeneratedLevel, SolveResult } from '../types'
import { makeRng, shuffle, PALETTE } from '../rng'
import { findPlacement, findHalfTurnPlacement } from '../placement'
import { canSolveLogically, difficultyScore } from '../solver'
import {
  boundaryCount, hasCorridor, maxRegionSize, sizeStdDev,
  growHalfTurnSymmetric, growVoronoi, growSizeBalanced, growBalanced,
  growBandAnchored, growForkAnchored,
} from '../growth'
import { targetDifficulty } from './targetDifficulty'
import { meetsGate } from './gating'
import { minBoundaries, minSizeStdDev } from './gating'
import { maximizeBoundaries, maximizeIfStillPasses, refineZones } from './refinement'

export type ConsiderCandidate = (
  regions: number[][], solution: { r: number; c: number }[],
  result: SolveResult, boundaries: number, symmetric: boolean,
) => void

export interface PhaseContext {
  levelNum: number
  N: number
  BASE: number
  budget: (n: number) => number
  onProgress?: (msg: string) => void
  considerCandidate: ConsiderCandidate
}

export type BestCandidate = {
  regions: number[][]
  solution: { r: number; c: number }[]
  result: SolveResult
  boundaries: number
  symmetric: boolean
}

// Phase 0: Half-turn symmetric growth (replaces diagonal symmetric which had 0% solvability).
// 180° rotational symmetry drives symmetry-propagation, a useful technique across all tiers.
// Analysis of external-resources/ puzzles: only 6% of tier-3 10×10 are half-turn symmetric,
// so expert should not over-invest here — fork-anchored (below) is the right expert path.
// Medium/easy get a larger budget since symmetric layouts are genuinely nice at those levels.
// Each failed attempt costs only ~5ms (quick solver fail), not the 70ms full-solve estimate.
export function runPhase0SymmetricGrowth(ctx: PhaseContext): GeneratedLevel | null {
  const { levelNum, N, BASE, budget, onProgress, considerCandidate } = ctx
  const PHASE0_ATTEMPTS = budget(levelNum > 15 ? 10 : levelNum > 8 ? 10 : levelNum > 3 ? 15 : 5)
  for (let attempt = 0; attempt < PHASE0_ATTEMPTS; attempt++) {
    onProgress?.(`Trying symmetric layout… (attempt ${attempt + 1}/${PHASE0_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 7919 + 3_000_000)
    const halfTurnCols = findHalfTurnPlacement(N, rng)
    if (halfTurnCols === null) continue
    const solution = halfTurnCols.map((c, r) => ({ r, c }))
    const regions = growHalfTurnSymmetric(N, halfTurnCols, rng)

    const bc0 = boundaryCount(regions, N)
    if (bc0 < minBoundaries(levelNum, N)) continue
    if (maxRegionSize(regions, N) > 25) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    if (!result.solved) continue
    considerCandidate(regions, solution, result, bc0, true)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    if (meetsGate(result, targetDifficulty(levelNum, N))) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc0, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: true, strategiesUsed: result.strategiesUsed, techniqueCounts: result.techniqueCounts ?? {}, gateMet: true }
    }
  }
  return null
}

// Constructive (cascade-chain) growth was tried here and rejected: its 3
// "primary" regions are permanently frozen at exactly 1 cell and every other
// cell not claimed by a chain doublet piles onto a single uncapped "blob"
// region, with no random variation escaping that shape. Reported as "a ton
// of single cells and one really large grid" — easy's low difficulty bar let
// this phase's very first solvable attempt win outright, so essentially
// every easy puzzle had this exact layout. growSizeBalanced (the next phase)
// already reliably meets easy's bar without ever producing a literal
// 1-cell region, so this phase is permanently skipped.

// Phase 0.8: Fork-anchored growth — deliberately constructs a 2-hop
// contradiction (see growForkAnchored's own comment) that only branch-rule
// (bit 64) or forcing-chain (bit 32) can prove. No other growth strategy has
// ever produced either bit (0 hits across 20,000+ raw attempts each), so a
// success here is genuinely deeper than anything else the generator makes.
// Runs before the size-balanced phase deliberately: that phase reliably
// satisfies hard/expert's naked-pair gate within its own budget, so if this
// ran after it, this phase would essentially never be reached in practice.
//
// The fork geometry is fragile against contention, so this uses a relaxed
// boundary floor (40, vs. this tier's normal 60) and accepts on "found
// branch/forcing" directly rather than the usual score/step/boundary gate:
// ~1 hit per 6,700 raw attempts at that floor (0 at the normal 60-boundary
// floor). P(success in n) ≈ 1 - e^(-n/6700): expert's 10000-attempt budget
// lands ~77.5%. Budget is kept well below the ~6,700+ needed to make success
// likely, to bound the latency the ~65% of generations that miss it pay
// before falling through to the size-balanced phase's fast, reliable
// fallback. Real per-attempt cost is ~6ms blended (most attempts fail the
// boundary/corridor filter fast, but ~63% reach a full canSolveLogically
// call at ~9.6ms avg).
//
// Like growBandAnchored, this gadget's geometry is calibrated to N=10
// specifically — skip it off N=10 rather than risk an ungrown cell.
export function runPhase08ForkAnchored(ctx: PhaseContext): GeneratedLevel | null {
  const { levelNum, N, BASE, budget, onProgress, considerCandidate } = ctx
  const FORK_ATTEMPTS = budget(N !== 10 ? 0 : levelNum > 15 ? 10000 : levelNum > 8 ? 3000 : 0)
  for (let attempt = 0; attempt < FORK_ATTEMPTS; attempt++) {
    if (attempt % 200 === 0) onProgress?.(`Searching for a forced-chain puzzle… (attempt ${attempt + 1}/${FORK_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 4241 + 6_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growForkAnchored(N, solution, rng)
    if (regions === null) continue

    const bc08 = boundaryCount(regions, N)
    if (bc08 < 40) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc08, false)
    if (!result.solved) continue
    if ((result.strategiesUsed & (32 | 64)) === 0) continue  // didn't land the fork — not worth keeping over a reliable naked-pair puzzle

    // Try to break up the fork gadget's leftover "5 doublets + big free blobs"
    // texture with the same boundary-maximizing hill-climb every other phase
    // gets, but only keep it if branch-rule/forcing-chain still fires afterward
    // (see maximizeIfStillPasses' comment) — otherwise ship the raw fork layout.
    const maxed = maximizeIfStillPasses(regions, N, rng, solution, r => r.solved && (r.strategiesUsed & (32 | 64)) !== 0)
    const final = maxed ?? { regions, result, boundaries: bc08 }
    const score = difficultyScore(final.result.strategiesUsed, final.result.easySteps, final.result.hardSteps, final.result.rounds)
    return { size: N, regions: final.regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: final.result.easySteps, hardSteps: final.result.hardSteps, boundaries: final.boundaries, rounds: final.result.rounds, maxSubsetSize: final.result.maxSubsetSize, symmetric: false, strategiesUsed: final.result.strategiesUsed, techniqueCounts: final.result.techniqueCounts ?? {}, gateMet: true }
  }
  return null
}

// Phase 1: Hybrid size-balanced growth (8 tiny anchors + 2 medium).
// The 8 anchors (singletons/doublets/triples) drive constraint cascade; 2 medium
// regions absorb the remaining ~80 cells. Fixed fallback keeps anchors at their
// capped sizes so they stay tiny.
//
// growSizeBalanced tops out at score ~12.6 (singleton + common-neighbor only).
// Easy levels (minScore ≤ 12) get the full 500-attempt budget + hill-climbing.
// Medium/hard/expert (minScore ≥ 14) can't be satisfied by this layout style —
// 50 quick attempts seed bestRef with solvable fallback candidates, then the
// random-role balanced phase (growBalanced, 4% medium hit rate, ~25ms expected)
// takes over.
export function runPhase1SizeBalanced(ctx: PhaseContext): GeneratedLevel | null {
  const { levelNum, N, BASE, budget, onProgress, considerCandidate } = ctx
  const P1_ATTEMPTS = budget(levelNum <= 3 ? 500 : 50)
  for (let attempt = 0; attempt < P1_ATTEMPTS; attempt++) {
    onProgress?.(`Growing regions… (attempt ${attempt + 1}/${P1_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growSizeBalanced(N, solution, rng)

    const bc1 = boundaryCount(regions, N)
    if (bc1 < minBoundaries(levelNum, N)) continue
    if (sizeStdDev(regions, N) < minSizeStdDev(N)) continue  // reject near-uniform layouts
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc1, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const tgt1 = targetDifficulty(levelNum, N)
    if (meetsGate(result, tgt1)) {
      const finalRegions = maximizeBoundaries(regions, N, rng, solution)
      const finalBC = boundaryCount(finalRegions, N)
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, techniqueCounts: result.techniqueCounts ?? {}, gateMet: true }
    }

    // Hill-climbing refinement targeting unsolved regions, guided by canSolveFast.
    const targetReg = result.unsolvedRegions.length > 0 ? new Set(result.unsolvedRegions) : undefined
    const refined = refineZones(regions, N, rng, solution, (r) => {
      if (boundaryCount(r, N) < minBoundaries(levelNum, N)) return false
      if (hasCorridor(r, N)) return false
      return meetsGate(canSolveLogically(r, N), tgt1)
    }, 120, targetReg, (iter, max) => onProgress?.(`Refining boundaries… (attempt ${attempt + 1}/${P1_ATTEMPTS}, step ${iter}/${max})`)  )
    if (refined !== null) {
      const finalRegions = maximizeBoundaries(refined, N, rng, solution)
      const res2 = canSolveLogically(finalRegions, N)
      const bc1r = boundaryCount(finalRegions, N)
      considerCandidate(finalRegions, solution, res2, bc1r, false)
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: difficultyScore(res2.strategiesUsed, res2.easySteps, res2.hardSteps, res2.rounds), easySteps: res2.easySteps, hardSteps: res2.hardSteps, boundaries: bc1r, rounds: res2.rounds, maxSubsetSize: res2.maxSubsetSize, symmetric: false, strategiesUsed: res2.strategiesUsed, techniqueCounts: res2.techniqueCounts ?? {}, gateMet: true }
    }
  }
  return null
}

// Phase 1.5: Band-anchored growth — 2 regions confined to a shared 2-row band,
// deliberately contested by their bordering neighbors (see growBandAnchored's
// own comment for why that contention is necessary). This is the only growth
// algorithm that can produce naked-pair/hidden-pair (bits 2/4).
//
// Medium N=10 gets 1000 attempts: external tier-2 7x7 puzzles require locked-pair
// in 97% of cases, and band-anchored for N=10 is the reliable path to that
// technique (hit rate ~0.1% → P(success in 1000) ≈ 63%). growBandAnchored was
// designed for N=10 specifically (band width, contention geometry) — at other
// sizes it can leave cells unfilled and crash hasCorridor downstream, so this
// phase is skipped entirely off N=10 (hard/expert's occasional N=8/11 draw
// falls through to the later phases and the bestRef safety net instead).
// Hard/expert get 4000 attempts (needed to satisfy their minStratBit=6/96 gates).
export function runPhase15BandAnchored(ctx: PhaseContext): GeneratedLevel | null {
  const { levelNum, N, BASE, budget, onProgress, considerCandidate } = ctx
  const BAND_ATTEMPTS = budget(N !== 10 ? 0 : levelNum > 8 ? 4000 : levelNum > 3 ? 1000 : 0)
  for (let attempt = 0; attempt < BAND_ATTEMPTS; attempt++) {
    if (attempt % 200 === 0) onProgress?.(`Band-anchored layout… (attempt ${attempt + 1}/${BAND_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 4999 + 5_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBandAnchored(N, solution, rng)
    if (regions === null) continue

    const bc15 = boundaryCount(regions, N)
    if (bc15 < minBoundaries(levelNum, N)) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc15, false)
    const tgt15 = targetDifficulty(levelNum, N)
    if (meetsGate(result, tgt15)) {
      // Same boundary-maximizing hill-climb the size-balanced phase gets, gated
      // on the full tier check still passing afterward (see maximizeIfStillPasses)
      // — band-anchored's near-identical "6 doublets + 2 giant free blobs"
      // skeleton is what made hard/expert puzzles look repetitive; this breaks
      // it up when it's safe to.
      const maxed = maximizeIfStillPasses(regions, N, rng, solution, r => meetsGate(r, tgt15))
      const final = maxed ?? { regions, result, boundaries: bc15 }
      const score = difficultyScore(final.result.strategiesUsed, final.result.easySteps, final.result.hardSteps, final.result.rounds)
      return { size: N, regions: final.regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: final.result.easySteps, hardSteps: final.result.hardSteps, boundaries: final.boundaries, rounds: final.result.rounds, maxSubsetSize: final.result.maxSubsetSize, symmetric: false, strategiesUsed: final.result.strategiesUsed, techniqueCounts: final.result.techniqueCounts ?? {}, gateMet: true }
    }
  }
  return null
}

// Phase 2: Random-role balanced growth.
export function runPhase2Balanced(ctx: PhaseContext): GeneratedLevel | null {
  const { levelNum, N, BASE, budget, onProgress, considerCandidate } = ctx
  const P2_ATTEMPTS = budget(500)
  for (let attempt = 0; attempt < P2_ATTEMPTS; attempt++) {
    onProgress?.(`Trying alternate layout… (attempt ${attempt + 1}/${P2_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 6271 + 1_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const bc3 = boundaryCount(regions, N)
    if (bc3 < minBoundaries(levelNum, N)) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc3, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    if (meetsGate(result, targetDifficulty(levelNum, N))) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc3, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, techniqueCounts: result.techniqueCounts ?? {}, gateMet: true }
    }
  }
  return null
}

// Phase 3: fallback — accept any solvable puzzle regardless of target difficulty.
//
// gateMet here must reflect the tier's REAL gate (meetsGate), not just this
// phase's own deliberately-relaxed "score >= 4" acceptance bar. This phase
// exists specifically to return a low-effort puzzle when nothing better was
// found — for hard/expert that near-always means a puzzle scoring well below
// the tier's real minScore and missing its required strategy bit entirely
// (e.g. singleton + common-neighbor only, with no naked/hidden pair or
// branch/forcing). gateMet is exactly what the parallel coordinator
// (levelGenCoordinator.ts) uses to decide a worker found an outright win and
// cancel every other worker immediately (see rankGeneratedLevel's comment),
// so this must never claim true on a merely-relaxed acceptance.
export function runPhase3Fallback(ctx: PhaseContext): GeneratedLevel | null {
  const { levelNum, N, BASE, budget, onProgress, considerCandidate } = ctx
  const P3_ATTEMPTS = budget(200)
  for (let attempt = 0; attempt < P3_ATTEMPTS; attempt++) {
    onProgress?.(`Searching harder… (attempt ${attempt + 1}/${P3_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 6271 + 2_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const bcFb = boundaryCount(regions, N)
    if (bcFb < minBoundaries(levelNum, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bcFb, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    if (result.solved && score >= 4) {
      const finalRegions = maximizeBoundaries(regions, N, rng, solution, 80)
      const finalBC = boundaryCount(finalRegions, N)
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, techniqueCounts: result.techniqueCounts ?? {}, gateMet: meetsGate(result, targetDifficulty(levelNum, N)) }
    }
  }
  return null
}

// Safety net: no phase found a candidate meeting this tier's full bar. Rather
// than fall through to an unverified (possibly unsolvable) Voronoi layout,
// return the best verified-solvable candidate seen across all phases above —
// it may undershoot the tier's difficulty target, but it is guaranteed solvable.
export function runBestRefFallback(ctx: PhaseContext, bestRef: BestCandidate): GeneratedLevel {
  const { N, BASE, onProgress } = ctx
  const { regions, solution, result, symmetric } = bestRef
  const rng = makeRng(BASE)
  const finalRegions = maximizeBoundaries(regions, N, rng, solution, 80,
    (iter, max) => onProgress?.(`Polishing best puzzle found… (step ${iter}/${max})`))
  const finalBC = boundaryCount(finalRegions, N)
  const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
  return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric, strategiesUsed: result.strategiesUsed, techniqueCounts: result.techniqueCounts ?? {}, gateMet: false }
}

// Rescue phase: defensive only — every prior phase failed to produce even one
// solvable layout that passed the boundary/corridor quality filters. Try once
// more with no filters beyond solvability itself.
export function runRescuePhase(ctx: PhaseContext): GeneratedLevel | null {
  const { N, BASE, budget, onProgress } = ctx
  const RESCUE_ATTEMPTS = budget(300)
  for (let attempt = 0; attempt < RESCUE_ATTEMPTS; attempt++) {
    onProgress?.(`Final solvability search… (attempt ${attempt + 1}/${RESCUE_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 8191 + 9_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growSizeBalanced(N, solution, rng)
    const result = canSolveLogically(regions, N)
    if (result.solved) {
      const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: boundaryCount(regions, N), rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, techniqueCounts: result.techniqueCounts ?? {}, gateMet: false }
    }
  }
  return null
}

// Last resort: every phase, including the unfiltered rescue search, failed to
// produce a solvable layout. Return a Voronoi layout without a solvability
// guarantee — this should be unreachable in practice; log so it's noticed if not.
export function runLastResortVoronoi(ctx: PhaseContext, puzzleSeed: number): GeneratedLevel {
  const { levelNum, N, BASE, onProgress } = ctx
  onProgress?.('Falling back to a basic layout…')
  console.warn(`generateLevel: exhausted all phases without finding a solvable puzzle (levelNum=${levelNum}, puzzleSeed=${puzzleSeed})`)
  const rng = makeRng(BASE)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  const voronoiRegions = growVoronoi(N, solution, rng)
  return { size: N, regions: voronoiRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: 0, easySteps: 0, hardSteps: 0, boundaries: boundaryCount(voronoiRegions, N), rounds: 0, maxSubsetSize: 0, symmetric: false, strategiesUsed: 0, techniqueCounts: {}, gateMet: false }
}
