import { GeneratedLevel, Difficulty, SolveResult } from './types'
import { makeRng, shuffle, PALETTE } from './rng'
import { findPlacement, findHalfTurnPlacement } from './placement'
import { canSolveLogically, canSolveFast, difficultyScore, techniqueVariety } from './solver'
import { boundaryCount, hasCorridor, maxRegionSize, sizeStdDev, growHalfTurnSymmetric, growVoronoi, growSizeBalanced, growBalanced, growConstructive, growBandAnchored, growForkAnchored, isConnectedWithout } from './growth'

// ── Boundary maximization ────────────────────────────────────────────────────
// Hill-climbs to increase boundary count (more interleaved region shapes).
// Swaps cells at region boundaries while maintaining connectivity and solvability.

function maximizeBoundaries(
  regions: number[][], N: number, rng: () => number,
  solution: { r: number; c: number }[],
  maxSwaps = 80,
  onIter?: (iter: number, max: number) => void,
): number[][] {
  let current = regions.map(row => [...row])
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]] as const
  let currentBC = boundaryCount(current, N)

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

// Applies maximizeBoundaries to a candidate that already passed some acceptance
// check (a required strategy bit, a full tier gate, ...) and re-verifies that
// check still holds afterward, falling back to the pre-maximization candidate
// if not. Needed specifically for Phase 0.8 (fork-anchored) and Phase 1.5
// (band-anchored): unlike every other phase, both of those only succeed by
// constructing a fragile, deliberate geometry (a 2-hop contradiction trap; a
// naked-pair confinement — see growForkAnchored/growBandAnchored's own
// comments), and maximizeBoundaries' swap-acceptance only checks that a swap
// keeps the puzzle *solvable*, not that it keeps needing the specific technique
// the candidate was selected for. Blindly reusing it the way Phase 1/3 do could
// silently swap away the exact cells that made the trap fire, downgrading an
// expert-caliber puzzle to a merely-solvable one without anyone noticing. Every
// other phase's boundary-maximization stays unconditional (see Phase 1/3/bestRef)
// since those don't depend on any single load-bearing cell placement.
function maximizeIfStillPasses(
  regions: number[][], N: number, rng: () => number,
  solution: { r: number; c: number }[],
  passes: (result: SolveResult) => boolean,
): { regions: number[][]; result: SolveResult; boundaries: number } | null {
  const maximized = maximizeBoundaries(regions, N, rng, solution)
  const result = canSolveLogically(maximized, N)
  if (!passes(result)) return null
  return { regions: maximized, result, boundaries: boundaryCount(maximized, N) }
}

// ── Difficulty tiers ─────────────────────────────────────────────────────────

// Smallest N in each tier's pickSize pool — the size all of this file's minScore/
// minSteps calibration comments above are actually measured against (band/fork
// growth is N=10-only; the generic phases were tuned by running them at whatever
// size a tier draws most often, which is its pool's floor). See targetDifficulty's
// N-scaling for why this matters.
function refSize(levelNum: number): number {
  return levelNum <= 3 ? 5 : levelNum <= 8 ? 6 : levelNum <= 15 ? 8 : 10
}

export function targetDifficulty(levelNum: number, N: number): { minScore: number; maxScore: number; minSteps: number; minHardSteps: number; minRounds: number; minStratBit: number; minVariety: number; maxSubsetSize: number } {
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
  // guaranteeing expert scores ≥ 60 while hard (no hypothesis) tops out lower.
  //
  // Tiers shifted up one notch (Aug 2026): comparing generateLevel() output
  // against external-resources/puzzles1 showed our old "easy" was solved by
  // singleton propagation alone ~60% of the time (common-neighbor fired only
  // 40%), far shallower than the external set's easiest tier, which uses
  // common-neighbor/locked-pair/unit-intersection 95%+ of the time. Every
  // tier below now requires strictly more than the last: easy must exercise
  // common-neighbor (bit 512), medium must exercise naked/hidden-pair (bit 6,
  // previously hard's own bar), hard keeps that bar but demands more rounds
  // and a wider ceiling so it can also catch the rare hypothesis-based finds,
  // and expert's floor is raised so a bare-minimum forcing-chain puzzle no
  // longer just barely qualifies.
  //
  // minVariety: minimum count of distinct strategy bits (techniqueVariety) that
  // must have fired. Stops a puzzle from passing on step-count alone while
  // leaning on only one or two techniques — reuse across a broader mix of the
  // solver's strategies is the point, not just clearing a score number.
  // Note on medium: naked/hidden-pair (bit 6) is only reliably produced by
  // growBandAnchored, which is itself only calibrated (and only runs) at
  // N=10 — see FORK_ATTEMPTS/BAND_ATTEMPTS below. Medium's board-size pool
  // (pickSize) favors smaller boards (6-8), where that technique is
  // structurally unreachable, so mandating it here would starve medium down
  // to the slow bestRef fallback almost every time. Medium instead demands
  // more of the size-generic techniques (common-neighbor, more rounds, more
  // step volume, more variety) than easy — genuinely harder, but achievable
  // at every size medium can draw. Hard keeps the naked/hidden-pair mandate
  // since its pool stays mostly at N=10.
  //
  // maxSubsetSize: caps how large a naked/hidden subset (k regions/axis-values at
  // once) the solve is allowed to need. A k=2 pair ("these two columns only hold
  // two colors between them, so no other color can go there — and vice versa") is
  // the common, easy-to-spot case. k=3/4 (triples/quads) is the identical technique
  // but meaningfully harder for a human to hold in their head simultaneously.
  // Reported by the user as something that should be reined in for easy/medium —
  // uncapped there, a puzzle could clear every other gate while quietly requiring
  // a quad. Hard/expert are uncapped (Infinity): players at that tier are expected
  // to handle triples/quads, and hard's minStratBit=6 already requires naked/hidden
  // subset to fire at all, so there's no reason to also suppress the harder sizes.
  const base =
    levelNum <= 3  ? { minScore: 8,  maxScore: 22,  minSteps: 12, minHardSteps: 0, minRounds: 1, minStratBit: 512, minVariety: 2, maxSubsetSize: 2 } // easy: common-neighbor must fire, no more pure-singleton puzzles
  : levelNum <= 8  ? { minScore: 18, maxScore: 40,  minSteps: 24, minHardSteps: 0, minRounds: 3, minStratBit: 512, minVariety: 3, maxSubsetSize: 2 } // medium: more rounds/steps/variety than easy, still size-generic
  // minScore stays close to the original 16: measuring growBandAnchored directly
  // (4000 raw attempts, boundary>=59) shows naked/hidden-pair hits top out around
  // score 20.4 (the technique itself is only worth 3-6 pts; band-anchored puzzles
  // are short so they get little step-count bonus) — a higher floor here would
  // make the gate technically satisfy minStratBit but never actually be reachable,
  // silently forcing every hard puzzle to the slow bestRef fallback instead.
  // minStratBit=6 (naked/hidden-pair), not the score number, is what actually
  // makes a hard puzzle harder than medium.
  : levelNum <= 15 ? { minScore: 17, maxScore: 62,  minSteps: 20, minHardSteps: 0, minRounds: 2, minStratBit: 6,   minVariety: 3, maxSubsetSize: Infinity } // hard: naked/hidden-pair must fire
                     : { minScore: 60, maxScore: 320, minSteps: 24, minHardSteps: 0, minRounds: 3, minStratBit: 96,  minVariety: 3, maxSubsetSize: Infinity } // expert: forcing chain or branch rule must fire

  // Size scaling: every minScore/minSteps above is calibrated against refSize(levelNum),
  // the smallest (and most commonly drawn) board in this tier's pickSize pool. A bigger
  // board naturally produces more propagation steps and rounds from sheer cell/region
  // volume even when no single deduction is any harder — canSolveLogically's rounds and
  // step counts scale with N, not with per-cell reasoning difficulty (see solver.ts's
  // difficultyScore). Left unscaled, a tier's floor is trivial to clear by dilution at
  // its larger sizes (e.g. hard's occasional N=8 draw vs its usual N=10) while remaining
  // a genuine bar at its smallest size — this was reported as "smaller puzzles are
  // noticeably higher quality than larger ones at the same tier". Scaling the floor up
  // proportionally with N keeps larger draws honest without touching the (already
  // hard-won, see comments above) calibration at each tier's reference size.
  // maxScore/minStratBit/minVariety are left unscaled: maxScore is a ceiling that stays
  // safely above the scaled floor at every N this pool can draw, and strategy-presence/
  // variety are boolean checks that scaling wouldn't meaningfully affect.
  //
  // sqrt, not linear: a first pass at linear (score *= N/refN) pushed medium's bar too
  // high at its own dominant sizes (7/8 — 75% of medium's pool) and regressed a real
  // test (medium puzzles losing technique variety). sqrt alone wasn't enough either —
  // debugging the regression (generateLevel(6, seed) for seed 0-3) showed medium's
  // *unscaled* score already sits right at its own floor at every size in its pool
  // (18.3@N6, 20@N7, 18.4@N7, 17.7@N8 on master, all clustered near minScore=18 with no
  // real upward trend against N) — growBalanced's ~4% hit rate is chronically marginal
  // there, not size-diluted, so medium is exempted below rather than forced through a
  // scaling correction that only destabilizes an already-thin generator without fixing
  // a pattern that isn't actually present at that tier.
  const scale = levelNum <= 8 ? 1 : Math.sqrt(N / refSize(levelNum))
  return {
    ...base,
    minScore: Math.round(base.minScore * scale * 10) / 10,
    minSteps: Math.round(base.minSteps * scale),
  }
}

// Checks every condition a solved candidate must clear for a given tier:
// required strategy bit, score band, step/round minimums, and technique variety.
// Centralizing this (rather than repeating the same six-line check per phase)
// means the variety requirement above can't accidentally be skipped in one phase.
function meetsGate(result: SolveResult, tgt: ReturnType<typeof targetDifficulty>): boolean {
  if (!result.solved) return false
  if (tgt.minStratBit !== 0 && (result.strategiesUsed & tgt.minStratBit) === 0) return false
  const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
  if (score < tgt.minScore || score > tgt.maxScore) return false
  if (result.easySteps + result.hardSteps < tgt.minSteps) return false
  if (result.hardSteps < tgt.minHardSteps) return false
  if (result.rounds < tgt.minRounds) return false
  if (techniqueVariety(result.strategiesUsed) < tgt.minVariety) return false
  if (result.maxSubsetSize > tgt.maxSubsetSize) return false
  return true
}

// Mirrors generateLevel's internal candidateRank so the parallel coordinator
// (levelGenCoordinator.ts) can pick the best of several workers' fallback
// results (level.gateMet === false on all of them) the same way a
// single-threaded run picks its own bestRef.
//
// There is deliberately no GeneratedLevel-shaped counterpart of meetsGate
// here. An earlier version tried to re-derive "did this worker land an
// outright win" by reapplying targetDifficulty's full score/step/round/
// variety gate to the returned level — but phase 0.8 (fork-anchored, the
// only path to expert's forcing-chain/branch-rule bar) accepts on the bit
// check alone, bypassing that full gate by design (see its own comment
// above). Reapplying the full gate externally silently rejected genuine
// phase-0.8 hits whenever they didn't also clear minSteps/minRounds/
// minVariety, which stalled the coordinator's early-exit for exactly the
// tier (expert) that most needed it — every worker ran to completion before
// any race outcome was decided. Use level.gateMet instead: it's exactly
// what generateLevel itself decided when returning this candidate.
export function rankGeneratedLevel(levelNum: number, level: GeneratedLevel): number {
  const { minStratBit, minVariety, maxSubsetSize } = targetDifficulty(levelNum, level.size)
  const stratOk = minStratBit === 0 || (level.strategiesUsed & minStratBit) !== 0
  const varietyOk = techniqueVariety(level.strategiesUsed) >= minVariety
  const subsetOk = level.maxSubsetSize <= maxSubsetSize
  return level.rounds * 10000 + (stratOk ? 5000 : 0) + (varietyOk ? 2500 : 0) + (subsetOk ? 1250 : 0) + level.difficulty
}

function minBoundaries(levelNum: number, N: number): number {
  // Calibrated against external-resources/ (puzzles1 size 7 tier 2: boundaryCount
  // mean 32.2 of a possible 84; puzzles2 size 10 tier 3: mean 65 of a possible
  // 180 — both ~0.36 of the maximum edge count). Scales that same ratio to any
  // board size rather than hardcoding per-size constants, so 5/6/8/11 boards
  // get a sensible floor without their own reference data.
  const maxEdges = 2 * N * (N - 1)
  const frac = levelNum <= 3 ? 0.29 : 0.33
  return Math.round(frac * maxEdges)
}

function minSizeStdDev(N: number): number {
  // Rejects near-uniform region-size layouts. Linearly interpolated between
  // the two sizes with external reference data (N=7 -> 2.5, N=10 -> 5), then
  // clamped so small boards (5x5, 6x6) don't get an unreachably low floor.
  return Math.max(1.5, 2.5 + (N - 7) * (5 - 2.5) / (10 - 7))
}

// Per-tier board-size pool: easy/medium favor the smaller sizes (shorter scans,
// tighter deduction chains); hard/expert stay mostly at N=10 since fork/band
// -anchored growth — their only reliable route to naked-pair and hypothesis
// geometry — is calibrated specifically for it and is skipped entirely at any
// other size (see FORK_ATTEMPTS/BAND_ATTEMPTS below). The occasional N=8 hard
// or N=11 expert draw therefore falls back to the generic phases and often
// lands on the bestRef safety net below its tier's normal score bar — still a
// valid, solvable puzzle, just softer than a same-tier N=10 one.
export function pickSize(levelNum: number, rng: () => number): number {
  const pools: [number, number][] = // [size, weight]
    levelNum <= 3  ? [[5, 0.35], [6, 0.35], [7, 0.30]] :
    levelNum <= 8  ? [[6, 0.25], [7, 0.45], [8, 0.30]] :
    levelNum <= 15 ? [[8, 0.25], [10, 0.75]] :
                      [[10, 0.7], [11, 0.3]]
  const total = pools.reduce((a, [, w]) => a + w, 0)
  let rv = rng() * total
  for (const [size, w] of pools) { rv -= w; if (rv <= 0) return size }
  return pools[pools.length - 1][0]
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

// ── Public API ───────────────────────────────────────────────────────────────

export const DIFFICULTY_LEVEL: Record<Difficulty, number> = {
  easy:   2,
  medium: 6,
  hard:   12,
  expert: 18,
}

export function generateLevelByDifficulty(difficulty: Difficulty, puzzleIndex: number, globalSeed = 0, onProgress?: (msg: string) => void, salt = 0, budgetDivisor = 1): GeneratedLevel {
  return generateLevel(DIFFICULTY_LEVEL[difficulty], puzzleIndex + globalSeed * 10007, onProgress, salt, budgetDivisor)
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
// before the coordinator can fall back. Reported directly: 4 workers each
// independently exhausting a full 10,000-attempt budget with nothing to show
// for it, taking as long as a single worker would have.
export function generateLevel(levelNum: number, puzzleSeed = 0, onProgress?: (msg: string) => void, salt = 0, budgetDivisor = 1): GeneratedLevel {
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983 + salt * 7_919_191
  const budget = (n: number) => n === 0 ? 0 : Math.max(1, Math.round(n / budgetDivisor))
  // Board size is drawn from a per-tier pool (see pickSize) — easy/medium
  // skew toward smaller boards, hard/expert stay mostly at N=10 since their
  // difficulty tuning (fork-gadget geometry, band-anchored naked-pair
  // contention) is calibrated to it specifically, with room for 8 and 11 as
  // occasional variety. Seeded off BASE so the same (levelNum, puzzleSeed)
  // always picks the same size.
  const sizeRng = makeRng(BASE + 42_000_000)
  const N = pickSize(levelNum, sizeRng)

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
    const { minStratBit, minVariety, maxSubsetSize } = targetDifficulty(levelNum, N)
    const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    // Variety used to be missing from this ranking entirely, so when no phase reached
    // the full gate for a given seed, bestRef could pick a lower-variety candidate over
    // a higher-variety one purely because it scored a bit higher on rounds/score —
    // producing a puzzle that fails a tier's own minVariety bar even in the fallback
    // path. Rank it just below stratOk (both are "must clear" gate conditions) so a
    // candidate that already satisfies variety is preferred over one that doesn't,
    // before score/rounds break the tie.
    const varietyOk = techniqueVariety(result.strategiesUsed) >= minVariety
    // Same reasoning for the naked/hidden subset size cap (easy/medium exclude
    // triples/quads) — without this, bestRef could hand back an easy/medium puzzle
    // that needs a quad just because it scored a bit higher otherwise.
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

  // Phase 0: Half-turn symmetric growth (replaces diagonal symmetric which had 0% solvability).
  // 180° rotational symmetry drives symmetry-propagation, a useful technique across all tiers.
  // Analysis of external-resources/ puzzles: only 6% of tier-3 10×10 are half-turn symmetric,
  // so expert should not over-invest here — fork-anchored (Phase 0.8) is the right expert path.
  // Medium/easy get a larger budget since symmetric layouts are genuinely nice at those levels.
  // Each failed attempt costs only ~5ms (quick solver fail), not the 70ms full-solve estimate.
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
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc0, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: true, strategiesUsed: result.strategiesUsed, gateMet: true }
    }
  }

  // Phase 0.5: Constructive growth — 3-primary cascade chain gives 84% solvability.
  // Only runs for easy levels (rounds=0 always); skipped for medium/hard/expert which
  // need hard strategies that the cascade chain can't produce.
  //
  // Disabled (0 attempts): by design its 3 "primary" regions are permanently
  // frozen at exactly 1 cell (canGrow() always returns false for them) and
  // every other cell not claimed by a chain doublet piles onto a single
  // uncapped "blob" region — there's no random variation that escapes this
  // shape. Reported as "a ton of single cells and one really large grid":
  // easy's low difficulty bar lets this phase's very first solvable attempt
  // win outright, so essentially every easy puzzle had this exact layout.
  // growSizeBalanced (Phase 1 below) already reliably meets easy's bar
  // without ever producing a literal 1-cell region.
  for (let attempt = 0; attempt < 0; attempt++) {
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
    if (meetsGate(result, targetDifficulty(levelNum, N))) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, gateMet: true }
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
  //   Expert(10000): P ≈ 77.5% — vs 36% at 3000.
  //   Cost correction (2026-08-25, profiled directly against this phase — see the
  //   "worker looks stuck" investigation): growForkAnchored's own growth call really
  //   is ~0.13ms/attempt on a fast fail, matching the original estimate below, but
  //   that estimate silently assumed every attempt fails fast. In practice ~63% of
  //   attempts clear the 40-boundary/no-corridor filter and reach a real
  //   canSolveLogically call, which measured ~9.6ms average (up to ~100ms) on this
  //   phase's own candidates — so the true blended cost is ~6ms/attempt, not
  //   ~0.11ms, roughly 50x this comment used to claim. At budgetDivisor=WORKER_COUNT
  //   (the parallel coordinator's normal path), that's ~4.6s/worker for hard's 750
  //   attempts and ~15s/worker for expert's 2500 — real, deliberate latency for a
  //   rare (1/6700) geometric target, not a hang. See canSolveLogically's own
  //   SOLVE_TIME_BUDGET_MS comment for why a single call can never run away, and the
  //   bestRef safety-net phase below (now progress-reported) for the other half of
  //   what "looks stuck" turned out to be: a silent fallback phase, not a slow one.
  // Like growBandAnchored, this gadget's row/column geometry is calibrated to
  // N=10 specifically — skip it off N=10 rather than risk an ungrown cell.
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
    if ((result.strategiesUsed & (32 | 64)) === 0) continue  // didn't land the fork — not worth keeping over Phase 1's reliable naked-pair puzzles

    // Try to break up the fork gadget's leftover "5 doublets + big free blobs"
    // texture with the same boundary-maximizing hill-climb every other phase
    // gets, but only keep it if branch-rule/forcing-chain still fires afterward
    // (see maximizeIfStillPasses' comment) — otherwise ship the raw fork layout.
    const maxed = maximizeIfStillPasses(regions, N, rng, solution, r => r.solved && (r.strategiesUsed & (32 | 64)) !== 0)
    const final = maxed ?? { regions, result, boundaries: bc08 }
    const score = difficultyScore(final.result.strategiesUsed, final.result.easySteps, final.result.hardSteps, final.result.rounds)
    return { size: N, regions: final.regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: final.result.easySteps, hardSteps: final.result.hardSteps, boundaries: final.boundaries, rounds: final.result.rounds, maxSubsetSize: final.result.maxSubsetSize, symmetric: false, strategiesUsed: final.result.strategiesUsed, gateMet: true }
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
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, gateMet: true }
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
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: difficultyScore(res2.strategiesUsed, res2.easySteps, res2.hardSteps, res2.rounds), easySteps: res2.easySteps, hardSteps: res2.hardSteps, boundaries: bc1r, rounds: res2.rounds, maxSubsetSize: res2.maxSubsetSize, symmetric: false, strategiesUsed: res2.strategiesUsed, gateMet: true }
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
  // designed for N=10 specifically (band width, contention geometry) — at other
  // sizes it can leave cells unfilled and crash hasCorridor downstream, so this
  // phase is skipped entirely off N=10 (hard/expert's occasional N=8/11 draw
  // falls through to Phase 1/2/3 and the bestRef safety net instead).
  // Hard/expert get 4000 attempts (needed to satisfy their minStratBit=6/96 gates).
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
      // Same boundary-maximizing hill-climb Phase 1 gets, gated on the full tier
      // check still passing afterward (see maximizeIfStillPasses) — band-anchored's
      // near-identical "6 doublets + 2 giant free blobs" skeleton is what made hard/
      // expert puzzles look repetitive; this breaks it up when it's safe to.
      const maxed = maximizeIfStillPasses(regions, N, rng, solution, r => meetsGate(r, tgt15))
      const final = maxed ?? { regions, result, boundaries: bc15 }
      const score = difficultyScore(final.result.strategiesUsed, final.result.easySteps, final.result.hardSteps, final.result.rounds)
      return { size: N, regions: final.regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: final.result.easySteps, hardSteps: final.result.hardSteps, boundaries: final.boundaries, rounds: final.result.rounds, maxSubsetSize: final.result.maxSubsetSize, symmetric: false, strategiesUsed: final.result.strategiesUsed, gateMet: true }
    }
  }

  // Phase 2: Random-role balanced growth.
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
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc3, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, gateMet: true }
    }
  }

  // Phase 3: fallback — accept any solvable puzzle regardless of target difficulty.
  //
  // gateMet here must reflect the tier's REAL gate (meetsGate), not just this
  // phase's own deliberately-relaxed "score >= 4" acceptance bar. This phase
  // exists specifically to return a low-effort puzzle when nothing better was
  // found — for hard/expert that near-always means a puzzle scoring well
  // below the tier's real minScore and missing its required strategy bit
  // entirely (e.g. singleton + common-neighbor only, with no naked/hidden
  // pair or branch/forcing). Bug found via generation-quality investigation
  // (2026-08-24): this used to hardcode gateMet: true unconditionally, which
  // is the exact flag the parallel coordinator (levelGenCoordinator.ts) uses
  // to decide a worker found an outright win and cancel every other worker
  // immediately (see rankGeneratedLevel's comment) — so a single worker
  // landing here with a trivial score-4 puzzle could silently cancel a
  // sibling worker that was still searching fork-anchored/band-anchored for
  // a genuine expert/hard-caliber puzzle, without either the worker or the
  // player ever knowing a stronger candidate was in reach. Every other
  // early-return phase in this file only ever sets gateMet: true after
  // actually passing meetsGate (or, for phase 0.8, its own documented
  // narrower bit-check bar) — this phase was the one inconsistent case.
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
      return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, gateMet: meetsGate(result, targetDifficulty(levelNum, N)) }
    }
  }

  // Safety net: no phase found a candidate meeting this tier's full bar. Rather
  // than fall through to an unverified (possibly unsolvable) Voronoi layout,
  // return the best verified-solvable candidate seen across all phases above —
  // it may undershoot the tier's difficulty target, but it is guaranteed solvable.
  if (bestRef.current !== null) {
    const { regions, solution, result, symmetric } = bestRef.current
    const rng = makeRng(BASE)
    const finalRegions = maximizeBoundaries(regions, N, rng, solution, 80,
      (iter, max) => onProgress?.(`Polishing best puzzle found… (step ${iter}/${max})`))
    const finalBC = boundaryCount(finalRegions, N)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    return { size: N, regions: finalRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: finalBC, rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric, strategiesUsed: result.strategiesUsed, gateMet: false }
  }

  // Rescue phase: defensive only — every prior phase failed to produce even one
  // solvable layout that passed the boundary/corridor quality filters. Try once
  // more with no filters beyond solvability itself.
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
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: boundaryCount(regions, N), rounds: result.rounds, maxSubsetSize: result.maxSubsetSize, symmetric: false, strategiesUsed: result.strategiesUsed, gateMet: false }
    }
  }

  // Last resort: every phase, including the unfiltered rescue search, failed to
  // produce a solvable layout. Return a Voronoi layout without a solvability
  // guarantee — this should be unreachable in practice; log so it's noticed if not.
  onProgress?.('Falling back to a basic layout…')
  console.warn(`generateLevel: exhausted all phases without finding a solvable puzzle (levelNum=${levelNum}, puzzleSeed=${puzzleSeed})`)
  const rng = makeRng(BASE)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  const voronoiRegions = growVoronoi(N, solution, rng)
  return { size: N, regions: voronoiRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: 0, easySteps: 0, hardSteps: 0, boundaries: boundaryCount(voronoiRegions, N), rounds: 0, maxSubsetSize: 0, symmetric: false, strategiesUsed: 0, gateMet: false }
}
