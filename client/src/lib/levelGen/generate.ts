import { GeneratedLevel, Difficulty, SolveResult } from './types'
import { makeRng, shuffle, PALETTE } from './rng'
import { findPlacement, findHalfTurnPlacement } from './placement'
import { canSolveLogically, canSolveFast, difficultyScore } from './solver'
import { boundaryCount, hasCorridor, maxRegionSize, sizeStdDev, growHalfTurnSymmetric, growVoronoi, growSizeBalanced, growBalanced, growConstructive, growBandAnchored, growForkAnchored, isConnectedWithout } from './growth'

// ── Boundary maximization ────────────────────────────────────────────────────
// Hill-climbs to increase boundary count (more interleaved region shapes).
// Swaps cells at region boundaries while maintaining connectivity and solvability.

function maximizeBoundaries(
  regions: number[][], N: number, rng: () => number,
  solution: { r: number; c: number }[],
  maxSwaps = 80,
): number[][] {
  let current = regions.map(row => [...row])
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]] as const
  let currentBC = boundaryCount(current, N)

  for (let iter = 0; iter < maxSwaps; iter++) {
    const sizes = Array(N).fill(0)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sizes[current[r][c]]++

    const edges: Array<{r: number; c: number; from: number; to: number}> = []
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (solution[current[r][c]].r === r && solution[current[r][c]].c === c) continue
        if (sizes[current[r][c]] <= 2) continue  // don't shrink regions below 2 cells
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
          if (current[nr][nc] !== current[r][c]) {
            edges.push({r, c, from: current[r][c], to: current[nr][nc]})
          }
        }
      }
    }
    if (edges.length === 0) break

    // Try several random edge swaps per iteration, keep the best
    let bestCandidate: number[][] | null = null
    let bestDelta = 0

    for (let attempt = 0; attempt < 5; attempt++) {
      const {r, c, from, to} = edges[Math.floor(rng() * edges.length)]
      if (!isConnectedWithout(current, N, r, c, from)) continue

      const candidate = current.map(row => [...row])
      candidate[r][c] = to

      // Quick solvability check — only continue if still solvable
      if (canSolveFast(candidate, N).unsolvedCount > 0) continue
      if (!canSolveLogically(candidate, N).solved) continue

      const newBC = boundaryCount(candidate, N)
      const delta = newBC - currentBC
      if (delta > bestDelta) {
        bestDelta = delta
        bestCandidate = candidate
      }
    }

    if (bestCandidate && bestDelta > 0) {
      current = bestCandidate
      currentBC += bestDelta
    } else if (bestDelta === 0 && rng() < 0.1) {
      // Random walk: accept a neutral swap 10% of the time to escape plateaus
      for (let attempt = 0; attempt < 5; attempt++) {
        const {r, c, from, to} = edges[Math.floor(rng() * edges.length)]
        if (!isConnectedWithout(current, N, r, c, from)) continue
        const candidate = current.map(row => [...row])
        candidate[r][c] = to
        if (canSolveFast(candidate, N).unsolvedCount > 0) continue
        if (!canSolveLogically(candidate, N).solved) continue
        if (boundaryCount(candidate, N) >= currentBC) {
          current = candidate
          break
        }
      }
    }
  }

  return current
}

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
  // Do not gate a tier on either bit.
  //
  // Bit 2 (naked-pair) / bit 4 (hidden-pair) are the cheapest *genuinely*
  // non-redundant techniques: they reason about the joint row/col span of
  // multiple regions at once, which a single pairwise common-neighbor check
  // structurally cannot replicate. growBandAnchored is the only growth
  // algorithm that reliably (if rarely) produces this geometry.
  //
  // Expert requires minStratBit=96 (= 32 | 64): forcing chains or branch rule
  // must fire. These are hypothesis-based techniques (try a placement, check for
  // contradiction) — the same "contradiction-depth-1" that all external tier-3
  // puzzles require. Forcing chains alone contribute 50 pts to difficultyScore,
  // guaranteeing expert scores ≥ 55 while hard (no hypothesis) tops out at ~54.
  //
  // Score bands (difficultyScore with current weights):
  //   Easy:   1-14  (singleton + common-neighbor, pure deduction)
  //   Medium: 14-30 (requires something beyond pure CN — naked/hidden pairs or symmetry + steps)
  //   Hard:   16-54 (naked/hidden pairs, rounds ≥ 2)
  //   Expert: 50+   (hypothesis required; 50 pts from forcing-chain bit alone)
  if (levelNum <= 3)  return { minScore: 1,  maxScore: 14,  minSteps: 10, minHardSteps: 0, minRounds: 0, minStratBit: 0 }  // easy: pure deduction ok
  if (levelNum <= 8)  return { minScore: 14, maxScore: 30,  minSteps: 20, minHardSteps: 0, minRounds: 2, minStratBit: 0 }  // medium: 2 hard rounds = multi-pass reasoning required
  if (levelNum <= 15) return { minScore: 16, maxScore: 54,  minSteps: 20, minHardSteps: 0, minRounds: 2, minStratBit: 6 }  // hard: naked/hidden-pair must fire
  return             { minScore: 50, maxScore: 300, minSteps: 20, minHardSteps: 0, minRounds: 3, minStratBit: 96 }         // expert: forcing chain or branch rule required
}

function minBoundaries(levelNum: number, N: number): number {
  if (N !== 10) {
    // Calibrated against external-resources/puzzles1 (size 7, tier 2, 200
    // puzzles): boundaryCount mean 32.2, range 26-40. A 7x7 board has far
    // fewer boundary edges available than a 10x10 one (max 84 vs 180), so
    // the N=10 bars below (tuned to puzzles2's mean 65) don't scale down
    // linearly — this uses the reference set's own observed range instead.
    return levelNum <= 3 ? 24 : 27
  }
  if (levelNum <= 3)  return 50
  // Hard/expert's difficulty comes from requiring naked/hidden-pair (see
  // targetDifficulty) rather than from a stricter shape bar — that geometry
  // is already rare (growBandAnchored only produces it ~0.1% of attempts),
  // so a boundary bar higher than medium's would starve the pool further
  // for no real quality gain.
  return 60
}

function minSizeStdDev(N: number): number {
  // Rejects near-uniform region-size layouts. N=10's bar (5) sits below
  // puzzles2's observed mean (7.12); N=7's bar mirrors that same margin
  // below puzzles1's observed mean (4.06, range 2.27-8.45).
  return N === 10 ? 5 : 2.5
}

// Hill-climbing refinement: uses canSolveFast to track unsolved-region count and
// accepts any swap that reduces it, rather than random-walking toward the full check.
// Only calls the expensive `check` (canSolveLogically + difficulty filter) when
// canSolveFast reports the puzzle is fully solved.
function refineZones(
  regions: number[][], N: number, rng: () => number,
  solution: { r: number; c: number }[],
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
        // Never reassign a region's own designated solution cell to another
        // region — canSolveLogically only checks that the resulting geometry
        // is *some* internally-consistent puzzle, not that it still matches
        // this specific `solution`, so stealing this cell away silently
        // orphans that region's true answer (the win-check compares placed
        // cats against `solution`, so an orphaned region becomes impossible
        // for the player to ever solve — this produced a real "unsolvable
        // medium puzzle" bug report).
        if (solution[current[r][c]].r === r && solution[current[r][c]].c === c) continue
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
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983
  // Easy/medium lean toward the smaller 7x7 board (75%); hard/expert always
  // stay at 10x10 since their difficulty tuning (fork-gadget geometry,
  // band-anchored naked-pair contention) is fragile and calibrated to N=10
  // specifically. Seeded off BASE so the same (levelNum, puzzleSeed) always
  // picks the same size.
  const sizeRng = makeRng(BASE + 42_000_000)
  const N = levelNum <= 8 && sizeRng() < 0.75 ? 7 : 10

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
  // 180° rotational symmetry drives symmetry-propagation, a useful technique across all tiers.
  // Analysis of external-resources/ puzzles: only 6% of tier-3 10×10 are half-turn symmetric,
  // so expert should not over-invest here — fork-anchored (Phase 0.8) is the right expert path.
  // Medium/easy get a larger budget since symmetric layouts are genuinely nice at those levels.
  // Each failed attempt costs only ~5ms (quick solver fail), not the 70ms full-solve estimate.
  const PHASE0_ATTEMPTS = levelNum > 15 ? 10 : levelNum > 8 ? 10 : levelNum > 3 ? 15 : 5
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
    if (bc < minBoundaries(levelNum, N)) continue
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

  // Phase 0.8: Fork-anchored growth — deliberately constructs a 2-hop
  // contradiction (see growForkAnchored's own comment) that only branch-rule
  // (bit 64) or forcing-chain (bit 32) can prove. No other growth strategy
  // has ever produced either bit (0 hits across 20,000+ raw attempts each),
  // so when this succeeds it's a genuinely deeper puzzle than anything else
  // the generator makes. Runs BEFORE Phase 1 deliberately: Phase 1 reliably
  // satisfies hard/expert's naked-pair gate within its own budget, so if
  // this ran after Phase 1 it would essentially never be reached in
  // practice (Phase 1 returns first almost every time). That geometry is
  // fragile against contention, so this uses a relaxed boundary floor (40,
  // vs. this tier's normal 60) and treats "found branch/forcing" as the
  // acceptance condition directly rather than the usual score/step/boundary
  // gate — empirically ~1 hit per 6,700 raw attempts at that floor (0 at
  // the normal 60-boundary floor). Budget is kept modest (not the ~6,700+
  // needed to make success likely) specifically to bound how much extra
  // latency the ~65% of generations that don't land it have to pay before
  // falling through to Phase 1's fast, reliable fallback.
  // Budget analysis: ~1 hit per 6,700 raw attempts at the 40-boundary floor.
  //   P(success in n) ≈ 1 - e^(-n/6700).
  //   Expert(10000): P ≈ 77.5% — vs 36% at 3000. The fork phase itself costs
  //   ~0.11ms/attempt (fast fails), so 10,000 adds only ~0.77s while doubling
  //   the rate of genuinely expert puzzles. Hard stays at 3000 (fork is a bonus
  //   there; band-anchored already satisfies hard's naked-pair requirement).
  const FORK_ATTEMPTS = levelNum > 15 ? 10000 : levelNum > 8 ? 3000 : 0
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
    if ((result.strategiesUsed & (32 | 64)) === 0) continue  // didn't land the fork — not worth keeping over Phase 1's reliable naked-pair puzzles

    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc08, rounds: result.rounds, symmetric: false }
  }

  // Phase 1: Hybrid size-balanced growth (8 tiny anchors + 2 medium).
  // The 8 anchors (singletons/doublets/triples) drive constraint cascade; 2 medium
  // regions absorb the remaining ~80 cells. Fixed fallback keeps anchors at their
  // capped sizes so they stay tiny.
  //
  // growSizeBalanced tops out at score ~12.6 (singleton + common-neighbor only).
  // Easy levels (minScore ≤ 12) get the full 500-attempt budget + hill-climbing.
  // Medium/hard/expert (minScore ≥ 14) can't be satisfied by this layout style —
  // 50 quick attempts seed bestRef with solvable fallback candidates, then Phase 2
  // (growBalanced, 4% medium hit rate, ~25ms expected) takes over.
  const P1_ATTEMPTS = levelNum <= 3 ? 500 : 50
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
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (result.solved && stratOk && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      const finalRegions = maximizeBoundaries(regions, N, rng, solution)
      const finalBC = boundaryCount(finalRegions, N)
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, symmetric: false }
    }

    // Hill-climbing refinement targeting unsolved regions, guided by canSolveFast.
    const targetReg = result.unsolvedRegions.length > 0 ? new Set(result.unsolvedRegions) : undefined
    const refined = refineZones(regions, N, rng, solution, (r) => {
      if (boundaryCount(r, N) < minBoundaries(levelNum, N)) return false
      if (hasCorridor(r, N)) return false
      const res = canSolveLogically(r, N)
      const s = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
      const sOk = minStratBit === 0 || (res.strategiesUsed & minStratBit) !== 0
      return res.solved && sOk && s >= minScore && s <= maxScore && res.easySteps + res.hardSteps >= minSteps && res.hardSteps >= minHardSteps && res.rounds >= minRounds
    }, 120, targetReg, (iter, max) => onProgress?.(`Refining boundaries… (attempt ${attempt + 1}/${P1_ATTEMPTS}, step ${iter}/${max})`)  )
    if (refined !== null) {
      const finalRegions = maximizeBoundaries(refined, N, rng, solution)
      const res2 = canSolveLogically(finalRegions, N)
      const bc1r = boundaryCount(finalRegions, N)
      considerCandidate(finalRegions, solution, res2, bc1r, false)
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: difficultyScore(res2.strategiesUsed, res2.easySteps, res2.hardSteps, res2.rounds), easySteps: res2.easySteps, hardSteps: res2.hardSteps, boundaries: bc1r, rounds: res2.rounds, symmetric: false }
    }
  }

  // Phase 1.5: Band-anchored growth — 2 regions confined to a shared 2-row band,
  // deliberately contested by their bordering neighbors (see growBandAnchored's
  // own comment for why that contention is necessary). This is the only growth
  // algorithm that can produce naked-pair/hidden-pair (bits 2/4).
  //
  // Medium N=10 gets 1000 attempts: external tier-2 7x7 puzzles require locked-pair
  // in 97% of cases, and band-anchored for N=10 is the reliable path to that
  // technique (hit rate ~0.1% → P(success in 1000) ≈ 63%). growBandAnchored was
  // designed for N=10; N=7 has structural parameter issues so medium N=7 skips it.
  // Hard/expert get 4000 attempts (needed to satisfy their minStratBit=6/96 gates).
  const BAND_ATTEMPTS = levelNum > 8 ? 4000 : (levelNum > 3 && N === 10) ? 1000 : 0
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
    if (bc3 < minBoundaries(levelNum, N)) continue
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
    if (bcFb < minBoundaries(levelNum, N)) continue

    const result = canSolveLogically(regions, N)
    considerCandidate(regions, solution, result, bcFb, false)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    if (result.solved && score >= 4) {
      const finalRegions = maximizeBoundaries(regions, N, rng, solution, 80)
      const finalBC = boundaryCount(finalRegions, N)
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, symmetric: false }
    }
  }

  // Safety net: no phase found a candidate meeting this tier's full bar. Rather
  // than fall through to an unverified (possibly unsolvable) Voronoi layout,
  // return the best verified-solvable candidate seen across all phases above —
  // it may undershoot the tier's difficulty target, but it is guaranteed solvable.
  if (bestRef.current !== null) {
    const { regions, solution, result, boundaries, symmetric } = bestRef.current
    const finalRegions = maximizeBoundaries(regions, N, rng, solution, 80)
    const finalBC = boundaryCount(finalRegions, N)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const rng = makeRng(BASE)
    return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, symmetric }
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
