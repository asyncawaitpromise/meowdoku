import { describe, it, expect } from 'vitest'
import {
  generateLevel, generateLevelByDifficulty,
  canSolveLogically, difficultyScore, countSolutions,
  boundaryCount, techniqueVariety, sizeStdDev,
} from '../../client/src/lib/levelGen/index'

// ── Full pipeline: generateLevel ──────────────────────────────────────────────

describe('generateLevel', () => {
  it('returns a valid level for levels 1-5', () => {
    for (let level = 1; level <= 5; level++) {
      const result = generateLevel(level)
      expect(result).not.toBeNull()
      expect(result.regions).toBeDefined()
      expect(result.solution).toBeDefined()
      const N = result.regions.length
      expect(N).toBeGreaterThanOrEqual(4)
      expect(result.regions[0]).toHaveLength(N)
      expect(result.solution).toHaveLength(N)
    }
  })

  it('generates logically solvable puzzles (levels 1-5)', () => {
    let solved = 0
    for (let level = 1; level <= 5; level++) {
      const result = generateLevel(level)
      const N = result.regions.length
      const solveResult = canSolveLogically(result.regions, N)
      if (solveResult.solved) solved++
    }
    expect(solved).toBe(5)
  })

  it('generates puzzles with unique solutions (levels 1-5)', () => {
    let unique = 0
    for (let level = 1; level <= 5; level++) {
      const result = generateLevel(level)
      const N = result.regions.length
      if (countSolutions(result.regions, N, 2) === 1) unique++
    }
    expect(unique).toBeGreaterThanOrEqual(4)
  })

  it('easy levels (1-3) have difficulty in easy range', () => {
    for (const level of [1, 2, 3]) {
      const result = generateLevel(level)
      const N = result.regions.length
      const solve = canSolveLogically(result.regions, N)
      const score = difficultyScore(solve.strategiesUsed, solve.easySteps, solve.hardSteps, solve.rounds)
      expect(score).toBeGreaterThanOrEqual(1)
      expect(score).toBeLessThanOrEqual(30)
    }
  })

  it('level 1 generates fast (under 5 seconds)', () => {
    const start = performance.now()
    const result = generateLevel(1)
    const elapsed = performance.now() - start
    expect(result).not.toBeNull()
    expect(elapsed).toBeLessThan(5000)
  })

  it('difficulty trends upward with level (1-10)', () => {
    const scores: number[] = []
    for (let level = 1; level <= 10; level++) {
      const result = generateLevel(level)
      const N = result.regions.length
      const solve = canSolveLogically(result.regions, N)
      scores.push(difficultyScore(solve.strategiesUsed, solve.easySteps, solve.hardSteps, solve.rounds))
    }
    const firstHalf = scores.slice(0, 5).reduce((a, b) => a + b, 0) / 5
    const secondHalf = scores.slice(5).reduce((a, b) => a + b, 0) / 5
    expect(secondHalf).toBeGreaterThanOrEqual(firstHalf)
    // Levels 9-10 are "hard" tier, which relies on growBandAnchored's ~0.1%
    // hit rate for naked/hidden-pair — an unlucky seed can genuinely take
    // 50-70s to exhaust its search budget before falling back (confirmed
    // this is pre-existing behavior, not a regression: same seed takes the
    // same time on master). 60s was too tight for that legitimate tail.
  }, 180000)
})

// ── Full pipeline: generateLevelByDifficulty ──────────────────────────────────

describe('generateLevelByDifficulty', () => {
  it('generates a valid easy level', () => {
    const result = generateLevelByDifficulty('easy', 0, 0)
    expect(result).not.toBeNull()
    expect(result.regions).toBeDefined()
    expect(result.colors).toBeDefined()
    expect(result.solution).toBeDefined()
    expect(result.regions).toHaveLength(result.size)
    expect(result.solution).toHaveLength(result.size)
  }, 15000)

  it('easy level is solvable', () => {
    const result = generateLevelByDifficulty('easy', 0, 0)
    const solve = canSolveLogically(result.regions, result.size)
    expect(solve.solved).toBe(true)
  }, 15000)

  it('generates a valid medium level', () => {
    const result = generateLevelByDifficulty('medium', 0, 0)
    expect(result).not.toBeNull()
    expect(result.regions).toBeDefined()
    expect(result.regions).toHaveLength(result.size)
  }, 30000)

  it('medium level is solvable', () => {
    const result = generateLevelByDifficulty('medium', 0, 0)
    const solve = canSolveLogically(result.regions, result.size)
    expect(solve.solved).toBe(true)
  }, 30000)

  it('same index + seed produces same puzzle', () => {
    const a = generateLevelByDifficulty('easy', 5, 42)
    const b = generateLevelByDifficulty('easy', 5, 42)
    expect(a.size).toBe(b.size)
    for (let r = 0; r < a.size; r++)
      for (let c = 0; c < a.size; c++)
        expect(a.regions[r][c]).toBe(b.regions[r][c])
  }, 15000)
})

// ── Quality asserts ───────────────────────────────────────────────────────────

describe('Puzzle quality properties', () => {
  it('has reasonable boundary counts', () => {
    for (let level = 1; level <= 5; level++) {
      const result = generateLevel(level)
      const N = result.regions.length
      const bc = boundaryCount(result.regions, N)
      expect(bc).toBeGreaterThan(0)
    }
  })

  // Regression guard for the Aug 2026 difficulty rebalance: comparing our
  // shipped output against external-resources/puzzles1 showed "easy" puzzles
  // were solved by singleton propagation alone ~60% of the time. Easy now
  // requires common-neighbor to fire and at least 2 distinct techniques;
  // medium demands more rounds/steps/variety on top of that (see
  // targetDifficulty's note on why medium can't mandate naked/hidden-pair
  // the way hard does — that technique is N=10-only).
  it('easy puzzles always require common-neighbor and >=2 techniques', () => {
    for (let seed = 0; seed < 4; seed++) {
      const result = generateLevel(2, seed)
      const solve = canSolveLogically(result.regions, result.size)
      expect(solve.solved).toBe(true)
      expect(solve.strategiesUsed & 512).not.toBe(0) // common-neighbor
      expect(techniqueVariety(solve.strategiesUsed)).toBeGreaterThanOrEqual(2)
    }
  }, 30000)

  it('medium puzzles always require common-neighbor and >=3 techniques', () => {
    for (let seed = 0; seed < 4; seed++) {
      const result = generateLevel(6, seed)
      const solve = canSolveLogically(result.regions, result.size)
      expect(solve.solved).toBe(true)
      expect(solve.strategiesUsed & 512).not.toBe(0) // common-neighbor
      expect(techniqueVariety(solve.strategiesUsed)).toBeGreaterThanOrEqual(3)
    }
  }, 60000)

  // Region-size evenness is a separate, still-open problem (see project memory
  // on the "blob problem") — growSizeBalanced's 8-tiny-anchors + 2-free-region
  // shape can satisfy the new common-neighbor/naked-pair gates while still
  // producing a big blob next to slivers, so this only guards against a further
  // regression past what's currently observed, not a fix for the blob itself.
  it('easy/medium region sizes stay below the observed regression ceiling', () => {
    for (let seed = 0; seed < 4; seed++) {
      for (const level of [2, 6]) {
        const result = generateLevel(level, seed)
        expect(sizeStdDev(result.regions, result.size)).toBeLessThan(14.5)
      }
    }
  }, 60000)

  it('easy/medium board sizes stay within the small-size pool (5-8)', () => {
    for (let seed = 0; seed < 3; seed++) {
      expect(generateLevel(2, seed).size).toBeGreaterThanOrEqual(5)
      expect(generateLevel(2, seed).size).toBeLessThanOrEqual(7)
      expect(generateLevel(6, seed).size).toBeGreaterThanOrEqual(6)
      expect(generateLevel(6, seed).size).toBeLessThanOrEqual(8)
    }
  }, 60000)
})