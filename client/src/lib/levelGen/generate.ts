import { GeneratedLevel, Difficulty, SolveResult } from './types'
import { makeRng, shuffle, PALETTE } from './rng'
import { findPlacement, findHalfTurnPlacement } from './placement'
import { canSolveLogically, canSolveFast, difficultyScore } from './solver'
import { boundaryCount, hasCorridor, maxRegionSize, sizeStdDev, growHalfTurnSymmetric, growVoronoi, growSizeBalanced, growBalanced, growConstructive, growBandAnchored, isConnectedWithout } from './growth'

// ── Difficulty tiers ─────────────────────────────────────────────────────────

export function targetDifficulty(levelNum: number): { minScore: number; maxScore: number; minSteps: number; minHardSteps: number; minRounds: number; minStratBit: number } {
  // minStratBit: bitwise OR of strategy bits that MUST fire (any one is enough).
  //
  // Bit 4 (16, region crowding) and bit 3 (8, trap 2×2) can never fire on a
  // solved puzzle: both reduce to "eliminate X from region B because every
  // candidate of some region A conflicts with X" — exactly what common-neighbor
  // (bit 512) already checks, unconditionally, every round, before either of
  // them gets a turn. So they can only ever "fire" by eliminating a region's
  // last remaining candidate, which reports as unsolvable, not as progress.
  // Do not gate a tier on either bit — see docs/puzzle-quality-improvements.md
  // and the solver.ts history for the full argument.
  //
  // Bit 2 (naked-pair) / bit 4 (hidden-pair) are the cheapest *genuinely*
  // non-redundant techniques: they reason about the joint row/col span of
  // multiple regions at once, which a single pairwise common-neighbor check
  // structurally cannot replicate. growBandAnchored is the only growth
  // algorithm that reliably (if rarely — see its own comment) produces this
  // geometry, so hard/expert require it explicitly.
  if (levelNum <= 3)  return { minScore: 1,  maxScore: 14,  minSteps: 10, minHardSteps: 0, minRounds: 0, minStratBit: 0 }  // easy: pure deduction ok (rounds=0)
  if (levelNum <= 8)  return { minScore: 6,  maxScore: 25,  minSteps: 20, minHardSteps: 0, minRounds: 1, minStratBit: 0 }  // medium: at least 1 hard round
  if (levelNum <= 15) return { minScore: 13, maxScore: 50,  minSteps: 20, minHardSteps: 0, minRounds: 2, minStratBit: 6 }  // hard: naked/hidden-pair must fire
  return             { minScore: 14, maxScore: 300, minSteps: 20, minHardSteps: 0, minRounds: 3, minStratBit: 6 }          // expert: same technique, deeper cascade
}

function minBoundaries(levelNum: number): number {
  if (levelNum <= 3)  return 50
  // Hard/expert's difficulty comes from requiring naked/hidden-pair (see
  // targetDifficulty) rather than from a stricter shape bar — that geometry
  // is already rare (growBandAnchored only produces it ~0.1% of attempts),
  // so a boundary bar higher than medium's would starve the pool further
  // for no real quality gain.
  return 60
}

// Hill-climbing refinement: uses canSolveFast to track unsolved-region count and
// accepts any swap that reduces it, rather than random-walking toward the full check.
// Only calls the expensive `check` (canSolveLogically + difficulty filter) when
// canSolveFast reports the puzzle is fully solved.
function refineZones(
  regions: number[][], N: number, rng: () => number,
  check: (r: number[][]) => boolean,
  maxSwaps = 120,
  targetRegions?: Set<number>,
  onIter?: (iter: number, max: number) => void
): number[][] | null {
  let current = regions.map(row => [...row])
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]] as const
  let currentUnsolved = canSolveFast(current, N).unsolvedCount

  for (let iter = 0; iter < maxSwaps; iter++) {
    onIter?.(iter + 1, maxSwaps)
    const boundary: Array<{r: number; c: number; from: number; to: number}> = []
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
          if (current[nr][nc] !== current[r][c]) {
            if (!targetRegions || targetRegions.has(current[r][c]) || targetRegions.has(current[nr][nc])) {
              boundary.push({r, c, from: current[r][c], to: current[nr][nc]})
            }
          }
        }
      }
    }
    if (boundary.length === 0) return null

    const {r, c, from, to} = boundary[Math.floor(rng() * boundary.length)]
    if (!isConnectedWithout(current, N, r, c, from)) continue

    const candidate = current.map(row => [...row])
    candidate[r][c] = to

    const newUnsolved = canSolveFast(candidate, N).unsolvedCount

    // When canSolveFast says fully solved, run the expensive full check
    if (newUnsolved === 0 && check(candidate)) return candidate

    // Hill-climb: accept if it reduces unsolved regions; else 15% random walk
    if (newUnsolved < currentUnsolved || rng() < 0.15) {
      current = candidate
      currentUnsolved = newUnsolved
    }
  }
  return null
}

// ── Public API ───────────────────────────────────────────────────────────────

export const DIFFICULTY_LEVEL: Record<Difficulty, number> = {
  easy:   2,
  medium: 6,
  hard:   12,
  expert: 18,
}

export function generateLevelByDifficulty(difficulty: Difficulty, puzzleIndex: number, globalSeed = 0, onProgress?: (msg: string) => void): GeneratedLevel {
  return generateLevel(DIFFICULTY_LEVEL[difficulty], puzzleIndex + globalSeed * 10007, onProgress)
}

export function generateLevel(levelNum: number, puzzleSeed = 0, onProgress?: (msg: string) => void): GeneratedLevel {
  const N = 10
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983

  // Safety net: every phase below only returns early once it finds a candidate
  // meeting this tier's full score/round/step bar. If none ever does — which
  // currently happens for hard/expert, since no growth algorithm reliably
  // produces trap-2×2/crowding/X-Wing/branch-rule/forcing-chain geometry yet —
  // we must never fall through to an unverified layout. So every solved
  // candidate seen along the way is remembered here, ranked by how close it
  // got to the tier's bar, and returned as a last resort instead of the raw
  // (possibly unsolvable) Voronoi fallback.
  type BestCandidate = { regions: number[][]; solution: { r: number; c: number }[]; result: SolveResult; boundaries: number; symmetric: boolean }
  const bestRef: { current: BestCandidate | null } = { current: null }

  const candidateRank = (result: SolveResult): number => {
    const { minStratBit } = targetDifficulty(levelNum)
    const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    return result.rounds * 10000 + (stratOk ? 5000 : 0) + score
  }

  const considerCandidate = (regions: number[][], solution: { r: number; c: number }[], result: SolveResult, boundaries: number, symmetric: boolean) => {
    if (!result.solved) return
    if (bestRef.current === null || candidateRank(result) > candidateRank(bestRef.current.result)) {
      bestRef.current = { regions, solution, result, boundaries, symmetric }
    }
  }

  // Phase 0: Half-turn symmetric growth (replaces diagonal symmetric which had 0% solvability).
  // 180° rotational symmetry matches the structure of all external tier-3 puzzles.
  // 5 attempts only — ~2% solvability means ~10% chance of finding one here,
  // and expensive solver calls (forcing chains) make each attempt ~70ms on mobile.
  for (let attempt = 0; attempt < 5; attempt++) {
    onProgress?.(`Trying symmetric layout… (attempt ${attempt + 1}/5)`)
    const rng = makeRng(BASE + attempt * 7919 + 3_000_000)
    const halfTurnCols = findHalfTurnPlacement(N, rng)
    if (halfTurnCols === null) continue
    const solution = halfTurnCols.map((c, r) => ({ r, c }))
    const regions = growHalfTurnSymmetric(N, halfTurnCols, rng)

    const bc0 = boundaryCount(regions, N)
    if (bc0 < minBoundaries(levelNum)) continue
    if (maxRegionSize(regions, N) > 25) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    if (!result.solved) continue
    considerCandidate(regions, solution, result, bc0, true)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk0 = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (stratOk0 && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc0, rounds: result.rounds, symmetric: true }
    }
  }

  // Phase 0.5: Constructive growth — 3-primary cascade chain gives 84% solvability.
  // Only runs for easy levels (rounds=0 always); skipped for medium/hard/expert which
  // need hard strategies that the cascade chain can't produce.
  for (let attempt = 0; attempt < (levelNum <= 3 ? 200 : 0); attempt++) {
    onProgress?.(`Constructive layout… (attempt ${attempt + 1}/200)`)
    const rng = makeRng(BASE + attempt * 5003 + 4_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growConstructive(N, solution, rng)

    const bc = boundaryCount(regions, N)
    if (bc < minBoundaries(levelNum)) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (result.solved && stratOk && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc, rounds: result.rounds, symmetric: false }
    }
  }

  // Phase 1: Hybrid size-balanced growth (8 tiny anchors + 2 medium).
  // The 8 anchors (singletons/doublets/triples) drive constraint cascade; 2 medium
  // regions absorb the remaining ~80 cells. Fixed fallback keeps anchors at their
  // capped sizes so they stay tiny.
  for (let attempt = 0; attempt < 500; attempt++) {
    onProgress?.(`Growing regions… (attempt ${attempt + 1}/500)`)
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growSizeBalanced(N, solution, rng)

    const bc1 = boundaryCount(regions, N)
    if (bc1 < minBoundaries(levelNum)) continue
    if (sizeStdDev(regions, N) < 5) continue  // reject near-uniform layouts (external avg is 7.12)
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc1, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (result.solved && stratOk && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc1, rounds: result.rounds, symmetric: false }
    }

    // Hill-climbing refinement targeting unsolved regions, guided by canSolveFast.
    const targetReg = result.unsolvedRegions.length > 0 ? new Set(result.unsolvedRegions) : undefined
    const refined = refineZones(regions, N, rng, (r) => {
      if (boundaryCount(r, N) < minBoundaries(levelNum)) return false
      if (hasCorridor(r, N)) return false
      const res = canSolveLogically(r, N)
      const s = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
      const sOk = minStratBit === 0 || (res.strategiesUsed & minStratBit) !== 0
      return res.solved && sOk && s >= minScore && s <= maxScore && res.easySteps + res.hardSteps >= minSteps && res.hardSteps >= minHardSteps && res.rounds >= minRounds
    }, 120, targetReg, (iter, max) => onProgress?.(`Refining boundaries… (attempt ${attempt + 1}/500, step ${iter}/${max})`)  )
    if (refined !== null) {
      const res2 = canSolveLogically(refined, N)
      const bc1r = boundaryCount(refined, N)
      considerCandidate(refined, solution, res2, bc1r, false)
      return { size: N, regions: refined, solution, colors: shuffle([...PALETTE], rng), difficulty: difficultyScore(res2.strategiesUsed, res2.easySteps, res2.hardSteps, res2.rounds), easySteps: res2.easySteps, hardSteps: res2.hardSteps, boundaries: bc1r, rounds: res2.rounds, symmetric: false }
    }
  }

  // Phase 1.5: Band-anchored growth — 2 regions confined to a shared 2-row band,
  // deliberately contested by their bordering neighbors (see growBandAnchored's
  // own comment for why that contention is necessary). This is the only growth
  // algorithm that can produce naked-pair/hidden-pair (bits 2/4), which hard/
  // expert now require — but that geometry is rare even when it does solve
  // (~0.1% of attempts at N=10), so this phase only runs for hard+ and needs a
  // much larger attempt budget than the other phases to find one reliably.
  // Only runs for hard/expert (levelNum > 8) — medium doesn't need it and easy
  // is already reliably solved by Phase 0/0.5.
  const BAND_ATTEMPTS = levelNum > 8 ? 4000 : 0
  for (let attempt = 0; attempt < BAND_ATTEMPTS; attempt++) {
    if (attempt % 200 === 0) onProgress?.(`Band-anchored layout… (attempt ${attempt + 1}/${BAND_ATTEMPTS})`)
    const rng = makeRng(BASE + attempt * 4999 + 5_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBandAnchored(N, solution, rng)
    if (regions === null) continue

    const bc15 = boundaryCount(regions, N)
    if (bc15 < minBoundaries(levelNum)) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc15, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk15 = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (result.solved && stratOk15 && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc15, rounds: result.rounds, symmetric: false }
    }
  }

  // Phase 2: Random-role balanced growth.
  for (let attempt = 0; attempt < 500; attempt++) {
    onProgress?.(`Trying alternate layout… (attempt ${attempt + 1}/500)`)
    const rng = makeRng(BASE + attempt * 6271 + 1_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const bc3 = boundaryCount(regions, N)
    if (bc3 < minBoundaries(levelNum)) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bc3, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk3 = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (result.solved && stratOk3 && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc3, rounds: result.rounds, symmetric: false }
    }
  }

  // Phase 3: fallback — accept any solvable puzzle regardless of target difficulty.
  for (let attempt = 0; attempt < 200; attempt++) {
    onProgress?.(`Searching harder… (attempt ${attempt + 1}/200)`)
    const rng = makeRng(BASE + attempt * 6271 + 2_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const bcFb = boundaryCount(regions, N)
    if (bcFb < minBoundaries(levelNum)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bcFb, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    if (result.solved && score >= 4) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bcFb, rounds: result.rounds, symmetric: false }
    }
  }

  // Safety net: no phase found a candidate meeting this tier's full bar. Rather
  // than fall through to an unverified (possibly unsolvable) Voronoi layout,
  // return the best verified-solvable candidate seen across all phases above —
  // it may undershoot the tier's difficulty target, but it is guaranteed solvable.
  if (bestRef.current !== null) {
    const { regions, solution, result, boundaries, symmetric } = bestRef.current
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const rng = makeRng(BASE)
    return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries, rounds: result.rounds, symmetric }
  }

  // Rescue phase: defensive only — every prior phase failed to produce even one
  // solvable layout that passed the boundary/corridor quality filters. Try once
  // more with no filters beyond solvability itself.
  for (let attempt = 0; attempt < 300; attempt++) {
    onProgress?.(`Final solvability search… (attempt ${attempt + 1}/300)`)
    const rng = makeRng(BASE + attempt * 8191 + 9_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growSizeBalanced(N, solution, rng)
    const result = canSolveLogically(regions, N)
    if (result.solved) {
      const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: boundaryCount(regions, N), rounds: result.rounds, symmetric: false }
    }
  }

  // Last resort: every phase, including the unfiltered rescue search, failed to
  // produce a solvable layout. Return a Voronoi layout without a solvability
  // guarantee — this should be unreachable in practice; log so it's noticed if not.
  console.warn(`generateLevel: exhausted all phases without finding a solvable puzzle (levelNum=${levelNum}, puzzleSeed=${puzzleSeed})`)
  const rng = makeRng(BASE)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  const voronoiRegions = growVoronoi(N, solution, rng)
  return { size: N, regions: voronoiRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: 0, easySteps: 0, hardSteps: 0, boundaries: boundaryCount(voronoiRegions, N), rounds: 0, symmetric: false }
}
