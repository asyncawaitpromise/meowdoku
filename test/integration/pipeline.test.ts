import { describe, it, expect } from 'vitest'
import {
  generateLevel, generateLevelByDifficulty,
  canSolveLogically, difficultyScore, countSolutions,
  boundaryCount,
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
  }, 60000)
})

// ── Full pipeline: generateLevelByDifficulty ──────────────────────────────────

describe('generateLevelByDifficulty', () => {
  it('generates a valid easy level', () => {
    const result = generateLevelByDifficulty('easy', { puzzleIndex: 0, globalSeed: 0 })
    expect(result).not.toBeNull()
    expect(result.regions).toBeDefined()
    expect(result.colors).toBeDefined()
    expect(result.solution).toBeDefined()
    expect(result.regions).toHaveLength(result.size)
    expect(result.solution).toHaveLength(result.size)
  }, 15000)

  it('easy level is solvable', () => {
    const result = generateLevelByDifficulty('easy', { puzzleIndex: 0, globalSeed: 0 })
    const solve = canSolveLogically(result.regions, result.size)
    expect(solve.solved).toBe(true)
  }, 15000)

  it('generates a valid medium level', () => {
    const result = generateLevelByDifficulty('medium', { puzzleIndex: 0, globalSeed: 0 })
    expect(result).not.toBeNull()
    expect(result.regions).toBeDefined()
    expect(result.regions).toHaveLength(result.size)
  }, 30000)

  it('medium level is solvable', () => {
    const result = generateLevelByDifficulty('medium', { puzzleIndex: 0, globalSeed: 0 })
    const solve = canSolveLogically(result.regions, result.size)
    expect(solve.solved).toBe(true)
  }, 30000)

  it('same index + seed produces same puzzle', () => {
    const a = generateLevelByDifficulty('easy', { puzzleIndex: 5, globalSeed: 42 })
    const b = generateLevelByDifficulty('easy', { puzzleIndex: 5, globalSeed: 42 })
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
})