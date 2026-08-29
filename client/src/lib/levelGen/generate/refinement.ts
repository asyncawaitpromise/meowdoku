import { SolveResult } from '../types'
import { canSolveLogically, canSolveFast } from '../solver'
import { boundaryCount, isConnectedWithout, sizeStdDev } from '../growth'

// Weighs a regionSizeStdDev reduction against a boundaryCount gain in
// maximizeBoundaries' combined swap score (see below), when a caller opts in
// via a nonzero `varianceWeight`. Calibrated so a meaningful variance
// improvement (a single swap typically moves stddev by ~0.05-0.3) is
// comparably attractive to the ~0-2 boundary-count swing a single swap
// typically produces — external-resources/ puzzles land at regionSizeStdDev
// 6.6-7.1 (see the "external-reference-profile" memory) while this hill
// -climb's boundary-only objective alone left successful hard/expert
// puzzles at 9.8+ (a "few giant blobs + many tiny anchors" skeleton), since
// nothing previously rewarded a swap for spreading cells more evenly even
// though the anchor-size floor below never blocks it.
//
// Defaults to 0 (pure boundary-maximization, the original behavior):
// applying this at easy/medium sizes regressed technique variety (a real
// test failure — a medium puzzle dropped below its required 3-technique
// floor), since those tiers were never the ones diagnosed with the blob
// problem and their smaller boards have much less headroom to redistribute
// cells without disturbing the specific naked/hidden-pair geometry those
// tiers depend on. Callers should only pass a nonzero weight for hard/expert
// (levelNum > 8), where the blob skeleton was actually measured.
export const DEFAULT_VARIANCE_WEIGHT = 4

// Hill-climbs to increase boundary count (more interleaved region shapes)
// and, when `varianceWeight` is nonzero, reduce region-size variance (fewer
// giant-blob-plus-tiny-anchor skeletons) via a combined score — see
// DEFAULT_VARIANCE_WEIGHT above. Swaps cells at region boundaries while
// maintaining connectivity and solvability.
export function maximizeBoundaries(
  regions: number[][], N: number, rng: () => number,
  solution: { r: number; c: number }[],
  maxSwaps = 80,
  onIter?: (iter: number, max: number) => void,
  varianceWeight = 0,
): number[][] {
  let current = regions.map(row => [...row])
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]] as const
  let currentBC = boundaryCount(current, N)
  let currentSD = sizeStdDev(current, N)

  for (let iter = 0; iter < maxSwaps; iter++) {
    onIter?.(iter + 1, maxSwaps)
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

    // Try several random edge swaps per iteration, keep the best combined
    // (boundary-gain + variance-reduction) score.
    let bestCandidate: number[][] | null = null
    let bestScore = 0
    let bestBC = currentBC
    let bestSD = currentSD

    for (let attempt = 0; attempt < 5; attempt++) {
      const {r, c, from, to} = edges[Math.floor(rng() * edges.length)]
      if (!isConnectedWithout(current, N, r, c, from)) continue

      const candidate = current.map(row => [...row])
      candidate[r][c] = to

      // Quick solvability check — only continue if still solvable
      if (canSolveFast(candidate, N).unsolvedCount > 0) continue
      if (!canSolveLogically(candidate, N).solved) continue

      const newBC = boundaryCount(candidate, N)
      const newSD = sizeStdDev(candidate, N)
      const score = (newBC - currentBC) + varianceWeight * (currentSD - newSD)
      if (score > bestScore) {
        bestScore = score
        bestCandidate = candidate
        bestBC = newBC
        bestSD = newSD
      }
    }

    if (bestCandidate && bestScore > 0) {
      current = bestCandidate
      currentBC = bestBC
      currentSD = bestSD
    } else if (bestScore === 0 && rng() < 0.1) {
      // Random walk: accept a neutral-or-better swap 10% of the time to
      // escape plateaus, but never one that makes both boundaries and
      // variance worse.
      for (let attempt = 0; attempt < 5; attempt++) {
        const {r, c, from, to} = edges[Math.floor(rng() * edges.length)]
        if (!isConnectedWithout(current, N, r, c, from)) continue
        const candidate = current.map(row => [...row])
        candidate[r][c] = to
        if (canSolveFast(candidate, N).unsolvedCount > 0) continue
        if (!canSolveLogically(candidate, N).solved) continue
        const newBC = boundaryCount(candidate, N)
        const newSD = sizeStdDev(candidate, N)
        const score = (newBC - currentBC) + varianceWeight * (currentSD - newSD)
        if (score >= 0) {
          current = candidate
          currentBC = newBC
          currentSD = newSD
          break
        }
      }
    }
  }

  return current
}

// Applies maximizeBoundaries to a candidate that already passed some acceptance
// check (a required strategy bit, a full tier gate, ...) and re-verifies that
// check still holds afterward, falling back to the pre-maximization candidate
// if not. Needed specifically for the fork-anchored and band-anchored phases:
// unlike every other phase, both of those only succeed by constructing a
// fragile, deliberate geometry (a 2-hop contradiction trap; a naked-pair
// confinement — see growForkAnchored/growBandAnchored's own comments), and
// maximizeBoundaries' swap-acceptance only checks that a swap keeps the
// puzzle *solvable*, not that it keeps needing the specific technique the
// candidate was selected for. Blindly reusing it could silently swap away the
// exact cells that made the trap fire, downgrading an expert-caliber puzzle
// to a merely-solvable one without anyone noticing. Every other phase's
// boundary-maximization stays unconditional since those don't depend on any
// single load-bearing cell placement.
export function maximizeIfStillPasses(
  regions: number[][], N: number, rng: () => number,
  solution: { r: number; c: number }[],
  passes: (result: SolveResult) => boolean,
  varianceWeight = 0,
): { regions: number[][]; result: SolveResult; boundaries: number } | null {
  const maximized = maximizeBoundaries(regions, N, rng, solution, 80, undefined, varianceWeight)
  const result = canSolveLogically(maximized, N)
  if (!passes(result)) return null
  return { regions: maximized, result, boundaries: boundaryCount(maximized, N) }
}

// Hill-climbing refinement: uses canSolveFast to track unsolved-region count and
// accepts any swap that reduces it, rather than random-walking toward the full check.
// Only calls the expensive `check` (canSolveLogically + difficulty filter) when
// canSolveFast reports the puzzle is fully solved.
export function refineZones(
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
    const sizes = Array(N).fill(0)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sizes[current[r][c]]++
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
        // Mirrors maximizeBoundaries' own floor: don't shrink a region below
        // 2 cells. Without this, hill-climbing toward solvability could — and
        // did — strip an anchor down to a literal 1-cell region, producing
        // the "ton of single cells" look reported for easy puzzles.
        if (sizes[current[r][c]] <= 2) continue
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
