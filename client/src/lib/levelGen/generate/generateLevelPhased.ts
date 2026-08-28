import { GeneratedLevel, Difficulty, SolveResult } from '../types'
import { makeRng } from '../rng'
import { difficultyScore, techniqueVariety } from '../solver'
import { targetDifficulty } from './targetDifficulty'
import { pickSize } from './pickSize'
import {
  PhaseContext, BestCandidate,
  runPhase0SymmetricGrowth, runPhase08ForkAnchored, runPhase1SizeBalanced,
  runPhase15BandAnchored, runPhase2Balanced, runPhase3Fallback,
  runBestRefFallback, runRescuePhase, runLastResortVoronoi,
} from './phases'

export const DIFFICULTY_LEVEL: Record<Difficulty, number> = {
  easy:   2,
  medium: 6,
  hard:   12,
  expert: 18,
}

export function generateLevelByDifficulty(difficulty: Difficulty, puzzleIndex: number, globalSeed = 0, onProgress?: (msg: string) => void, salt = 0, budgetDivisor = 1): GeneratedLevel {
  return generateLevel(DIFFICULTY_LEVEL[difficulty], puzzleIndex + globalSeed * 10007, onProgress, salt, budgetDivisor)
}

// Phased counterpart of generateLevelByDifficulty — see generateLevelPhased.
export function generateLevelByDifficultyPhased(difficulty: Difficulty, puzzleIndex: number, globalSeed = 0, onProgress?: (msg: string) => void, salt = 0, budgetDivisor = 1): Generator<{ phase: string }, GeneratedLevel, void> {
  return generateLevelPhased(DIFFICULTY_LEVEL[difficulty], puzzleIndex + globalSeed * 10007, onProgress, salt, budgetDivisor)
}

// `salt` perturbs the RNG stream without changing which puzzle a given
// (levelNum, puzzleSeed) "canonically" maps to for single-threaded callers
// (salt defaults to 0, reproducing the original stream exactly). The
// parallel coordinator (levelGenCoordinator.ts) runs several independent
// generateLevel calls at once, one per worker, each with a distinct salt —
// giving each worker its own uncorrelated random search rather than having
// them redundantly retread the same attempt sequence.
//
// `budgetDivisor` splits each phase's attempt budget across that many
// workers instead of giving each worker the full budget. Rejection sampling
// makes this exact, not approximate: for a fixed per-attempt hit probability
// p, running budgetDivisor independent streams of budget/budgetDivisor
// attempts each has the same combined hit probability as one stream of the
// full budget (P(≥1 hit) = 1-(1-p)^budget either way, since the streams are
// disjoint and independent) — but the worst case (nobody hits) now takes
// ~1/budgetDivisor as long, because each worker only has to exhaust its own
// smaller share before giving up, and total attempts across all workers
// stays roughly the original budget instead of multiplying by worker count.
// Giving every worker the full budget instead (budgetDivisor=1) does still
// raise the hit probability further, but pays for it with worker-count times
// the CPU/battery cost and — critically — no improvement at all to the
// worst-case latency, since every worker still has to run the whole budget
// before the coordinator can fall back.
//
// Yields once after every phase that can end generation outright, whenever
// that phase found no gate-passing candidate, so a caller driving several of
// these in lockstep (the parallel coordinator) can hold every worker on the
// same phase at once instead of letting a worker that raced through several
// cheap, unlikely-to-hit phases win with a shallow result while a sibling is
// still mid-search in a harder, more interesting phase (fork/band-anchored)
// that never got a fair chance to finish that same phase. Racing is still
// allowed *within* a phase — whichever worker clears that phase's own gate
// first legitimately wins, same rules for everyone — only cross-phase
// preemption is removed. The bestRef/rescue/last-resort tail never yields:
// none of it can ever set gateMet:true, so there is nothing for it to preempt.
export function* generateLevelPhased(levelNum: number, puzzleSeed = 0, onProgress?: (msg: string) => void, salt = 0, budgetDivisor = 1): Generator<{ phase: string }, GeneratedLevel, void> {
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983 + salt * 7_919_191
  const budget = (n: number) => n === 0 ? 0 : Math.max(1, Math.round(n / budgetDivisor))

  // Board size is drawn from a per-tier pool (see pickSize) — easy/medium
  // skew toward smaller boards, hard/expert stay mostly at N=10 since their
  // difficulty tuning (fork-gadget geometry, band-anchored naked-pair
  // contention) is calibrated to it specifically, with room for 8 and 11 as
  // occasional variety. Seeded off a salt-independent base (not BASE) so
  // every worker in a parallel generation agrees on the same N — otherwise
  // one worker could draw N=8/11 and structurally skip fork/band-anchored
  // (both N=10-only) while a sibling drawing N=10 still runs them, an unequal
  // race no attempt-budget split could fix. Single-threaded callers (salt=0)
  // see identical behavior to before, since salt*7_919_191 is 0 either way.
  const sizeBase = levelNum * 100003 + 17 + puzzleSeed * 999983
  const sizeRng = makeRng(sizeBase + 42_000_000)
  const N = pickSize(levelNum, sizeRng)

  // Safety net: every phase below only returns early once it finds a candidate
  // meeting this tier's full score/round/step bar. If none ever does — which
  // currently happens for hard/expert, since no growth algorithm reliably
  // produces trap-2×2/crowding/X-Wing/branch-rule/forcing-chain geometry yet —
  // we must never fall through to an unverified layout. So every solved
  // candidate seen along the way is remembered here, ranked by how close it
  // got to the tier's bar, and returned as a last resort instead of the raw
  // (possibly unsolvable) Voronoi fallback.
  const bestRef: { current: BestCandidate | null } = { current: null }

  const candidateRank = (result: SolveResult): number => {
    const { minStratBit, minVariety, maxSubsetSize } = targetDifficulty(levelNum, N)
    const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    // Variety and subset-size are ranked just below stratOk (both are "must
    // clear" gate conditions), so a candidate that already satisfies them is
    // preferred over one that doesn't before score/rounds break the tie —
    // otherwise bestRef could hand back a fallback candidate that fails a
    // tier's own minVariety/maxSubsetSize bar purely because it scored a bit
    // higher on rounds/score.
    const varietyOk = techniqueVariety(result.strategiesUsed) >= minVariety
    const subsetOk = result.maxSubsetSize <= maxSubsetSize
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    return result.rounds * 10000 + (stratOk ? 5000 : 0) + (varietyOk ? 2500 : 0) + (subsetOk ? 1250 : 0) + score
  }

  const considerCandidate = (regions: number[][], solution: { r: number; c: number }[], result: SolveResult, boundaries: number, symmetric: boolean) => {
    if (!result.solved) return
    if (bestRef.current === null || candidateRank(result) > candidateRank(bestRef.current.result)) {
      bestRef.current = { regions, solution, result, boundaries, symmetric }
    }
  }

  const ctx: PhaseContext = { levelNum, N, BASE, budget, onProgress, considerCandidate }

  const p0 = runPhase0SymmetricGrowth(ctx)
  if (p0) return p0
  yield { phase: 'phase0' }

  const p08 = runPhase08ForkAnchored(ctx)
  if (p08) return p08
  yield { phase: 'phase0.8' }

  const p1 = runPhase1SizeBalanced(ctx)
  if (p1) return p1
  yield { phase: 'phase1' }

  const p15 = runPhase15BandAnchored(ctx)
  if (p15) return p15
  yield { phase: 'phase1.5' }

  const p2 = runPhase2Balanced(ctx)
  if (p2) return p2
  yield { phase: 'phase2' }

  const p3 = runPhase3Fallback(ctx)
  if (p3) return p3
  yield { phase: 'phase3' }

  if (bestRef.current !== null) return runBestRefFallback(ctx, bestRef.current)

  const rescued = runRescuePhase(ctx)
  if (rescued) return rescued

  return runLastResortVoronoi(ctx, puzzleSeed)
}

// Single-threaded entry point: drives generateLevelPhased to completion in
// one call, ignoring the phase-boundary yields (they only matter to a caller
// that wants to hold multiple parallel generators in lockstep — see
// levelGenCoordinator.ts).
export function generateLevel(levelNum: number, puzzleSeed = 0, onProgress?: (msg: string) => void, salt = 0, budgetDivisor = 1): GeneratedLevel {
  const gen = generateLevelPhased(levelNum, puzzleSeed, onProgress, salt, budgetDivisor)
  let step = gen.next()
  while (!step.done) step = gen.next()
  return step.value
}
