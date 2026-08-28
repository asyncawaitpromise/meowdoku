import { GeneratedLevel, SolveResult } from '../types'
import { difficultyScore, techniqueVariety } from '../solver'
import { targetDifficulty } from './targetDifficulty'

// Checks every condition a solved candidate must clear for a given tier:
// required strategy bit, score band, step/round minimums, and technique variety.
// Centralizing this (rather than repeating the same six-line check per phase)
// means the variety requirement above can't accidentally be skipped in one phase.
export function meetsGate(result: SolveResult, tgt: ReturnType<typeof targetDifficulty>): boolean {
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

// Mirrors generateLevelPhased's internal candidateRank so the parallel
// coordinator (levelGenCoordinator.ts) can pick the best of several workers'
// fallback results (level.gateMet === false on all of them) the same way a
// single-threaded run picks its own bestRef.
//
// There is deliberately no GeneratedLevel-shaped counterpart of meetsGate
// here: phase 0.8 (fork-anchored, the only path to expert's forcing-chain/
// branch-rule bar) accepts on the bit check alone, bypassing the full
// score/step/round/variety gate by design. Reapplying the full gate
// externally would silently reject genuine phase-0.8 hits whenever they
// didn't also clear minSteps/minRounds/minVariety. Use level.gateMet
// instead: it's exactly what generateLevel itself decided when returning
// this candidate.
export function rankGeneratedLevel(levelNum: number, level: GeneratedLevel): number {
  const { minStratBit, minVariety, maxSubsetSize } = targetDifficulty(levelNum, level.size)
  const stratOk = minStratBit === 0 || (level.strategiesUsed & minStratBit) !== 0
  const varietyOk = techniqueVariety(level.strategiesUsed) >= minVariety
  const subsetOk = level.maxSubsetSize <= maxSubsetSize
  return level.rounds * 10000 + (stratOk ? 5000 : 0) + (varietyOk ? 2500 : 0) + (subsetOk ? 1250 : 0) + level.difficulty
}

export function minBoundaries(levelNum: number, N: number): number {
  // Calibrated against external-resources/ (puzzles1 size 7 tier 2: boundaryCount
  // mean 32.2 of a possible 84; puzzles2 size 10 tier 3: mean 65 of a possible
  // 180 — both ~0.36 of the maximum edge count). Scales that same ratio to any
  // board size rather than hardcoding per-size constants, so 5/6/8/11 boards
  // get a sensible floor without their own reference data.
  const maxEdges = 2 * N * (N - 1)
  const frac = levelNum <= 3 ? 0.29 : 0.33
  return Math.round(frac * maxEdges)
}

export function minSizeStdDev(N: number): number {
  // Rejects near-uniform region-size layouts. Linearly interpolated between
  // the two sizes with external reference data (N=7 -> 2.5, N=10 -> 5), then
  // clamped so small boards (5x5, 6x6) don't get an unreachably low floor.
  return Math.max(1.5, 2.5 + (N - 7) * (5 - 2.5) / (10 - 7))
}
