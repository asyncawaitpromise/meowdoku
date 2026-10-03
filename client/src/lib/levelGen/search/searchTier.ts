import type { GeneratedLevel } from '../types'
import { generateLevel } from '../generate'
import { DIFFICULTY_LEVEL } from '../generate/generateLevelPhased'
import { minBoundaries } from '../generate/gating'
import { encodeShareCode, decodeShareCode } from '../share'
import { profilePuzzle, type PuzzleProfile } from '../solver/profile'
import { canonicalize, localSearch } from './localSearch'
import { TIERS, type TierSpec } from './tiers'

export type SearchTier = keyof typeof TIERS

export const DEFAULT_SEARCH_STEPS = 1500

export interface TierFind {
  code: string               // v2 share code: all a client needs
  level: GeneratedLevel      // exactly what decoding that code gives (canonical labels, code-derived colors)
  profile: PuzzleProfile
  size: number
  seed: number
}

// One attempt, fully determined by `seed`: draw a solved start layout from the existing
// generator (cheap settings — any solved layout will do, since local search does the real work),
// climb it toward the tier's technique profile, and accept only a puzzle that clears the tier's
// *whole* bar (technique mix, doublet budget, solve depth, layout) in the canonical form a client
// decodes. There is no "best effort" result: null means this seed didn't produce one.
//
// This is the single implementation behind both the offline generator (scripts/puzzlegen) and the
// on-device fallback in the browser, so a puzzle is held to the same bar wherever it was made.
export function searchTierOnce(
  tier: SearchTier, seed: number, steps = DEFAULT_SEARCH_STEPS, spec: TierSpec = TIERS[tier], levelNum = DIFFICULTY_LEVEL[tier],
): TierFind | null {
  // budgetDivisor trades start-layout quality for speed; the search repairs quality.
  const start = generateLevel(levelNum, seed, undefined, 0, 60)
  if (start.size < spec.minSize) return null

  const regions = canonicalize(start.regions, start.size)
  // canonicalizing relabels regions, so recover the cat positions in the new labelling.
  const relabel = new Map<number, number>()
  start.regions.forEach((row, r) => row.forEach((v, c) => { if (!relabel.has(v)) relabel.set(v, regions[r][c]) }))
  const solution: { r: number; c: number }[] = new Array(start.size)
  start.solution.forEach((cell, oldId) => { solution[relabel.get(oldId)!] = cell })

  let accepted = false
  const result = localSearch(regions, {
    N: start.size, solution,
    fitness: p => spec.fitness(p),
    minBoundaries: minBoundaries(levelNum, start.size),
    maxRegion: 25,
    maxSizeStdDev: spec.maxSizeStdDev,
    steps,
    seed,
    onAccept: s => {
      if (!spec.accepts(s.profile) || !spec.layoutAccepts(s.regions, start.size)) return false
      accepted = true
      return true
    },
  })
  if (!result || !accepted) return null

  // Re-verify from the share code itself — what a client will actually decode.
  const code = encodeShareCode({ ...start, regions: canonicalize(result.regions, start.size) })
  const level = decodeShareCode(code)
  if (!level) return null
  const profile = profilePuzzle(level.regions, level.size)
  if (!spec.accepts(profile) || !spec.layoutAccepts(level.regions, level.size)) return null
  return { code, level, profile, size: level.size, seed }
}

// Runs attempts over one seed stream (seed, seed+stride, …) until one clears the bar. Yields after
// every attempt so a caller can report progress or stop. Never gives up and never lowers the bar.
export function* searchTierStream(
  tier: SearchTier, firstSeed: number, stride = 1, steps = DEFAULT_SEARCH_STEPS,
): Generator<{ attempts: number }, TierFind, void> {
  let attempts = 0
  for (let seed = firstSeed; ; seed += stride) {
    const found = searchTierOnce(tier, seed, steps)
    attempts++
    if (found) return found
    yield { attempts }
  }
}

// Base seed for a (puzzleIndex, globalSeed) request, matching generateLevelByDifficulty's combined seed.
export const searchSeedFor = (puzzleIndex: number, globalSeed: number): number => puzzleIndex + globalSeed * 10007
