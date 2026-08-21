import { describe, it, expect } from 'vitest'
import {
  makeRng, shuffle,
  findPlacement, findHalfTurnPlacement, findSymmetricPlacement,
} from '../../client/src/lib/levelGen/index'
import { targetDifficulty, difficultyScore } from '../../client/src/lib/levelGen/index'
import { N, checkCatAdjacency, checkCatRowCol } from '../testUtils'

// ── RNG ───────────────────────────────────────────────────────────────────────

describe('makeRng', () => {
  it('produces deterministic output', () => {
    const rng1 = makeRng(42)
    const rng2 = makeRng(42)
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2())
    }
  })

  it('produces different output for different seeds', () => {
    const rng1 = makeRng(42)
    const rng2 = makeRng(43)
    const vals1 = Array.from({ length: 20 }, () => rng1())
    const vals2 = Array.from({ length: 20 }, () => rng2())
    expect(vals1).not.toEqual(vals2)
  })

  it('produces values in [0, 1)', () => {
    const rng = makeRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

// ── shuffle ───────────────────────────────────────────────────────────────────

describe('shuffle', () => {
  it('returns array of same length and elements', () => {
    const rng = makeRng(42)
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const shuffled = shuffle(arr, rng)
    expect(shuffled).toHaveLength(arr.length)
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...arr].sort((a, b) => a - b))
  })

  it('does not mutate the original array', () => {
    const rng = makeRng(42)
    const arr = [1, 2, 3, 4, 5]
    const copy = [...arr]
    shuffle(arr, rng)
    expect(arr).toEqual(copy)
  })

  it('is deterministic with same seed', () => {
    const rng1 = makeRng(42)
    const rng2 = makeRng(42)
    const arr = [1, 2, 3, 4, 5]
    expect(shuffle(arr, rng1)).toEqual(shuffle(arr, rng2))
  })
})

// ── findPlacement (cat placement) ─────────────────────────────────────────────

describe('findPlacement', () => {
  it('places exactly N cats', () => {
    for (const n of [4, 7, 10, 12]) {
      const rng = makeRng(42)
      const cols = findPlacement(n, rng)
      expect(cols).toHaveLength(n)
    }
  })

  it('all cats are in distinct rows and columns', () => {
    const rng = makeRng(42)
    const cols = findPlacement(N, rng)
    const solution = cols.map((c, r) => ({ r, c }))
    expect(checkCatRowCol(solution)).toBe(true)
  })

  it('no two cats are adjacent (king moves)', () => {
    const rng = makeRng(42)
    const cols = findPlacement(N, rng)
    const solution = cols.map((c, r) => ({ r, c }))
    expect(checkCatAdjacency(solution, N)).toBe(true)
  })

  it('returns different placements for different seeds', () => {
    const cols1 = findPlacement(N, makeRng(42))
    const cols2 = findPlacement(N, makeRng(43))
    const same = cols1.every((c, i) => c === cols2[i])
    expect(same).toBe(false)
  })

it('works for various small N', () => {
    for (const n of [4, 5, 6, 7, 8, 9, 10, 12, 15]) {
      const rng = makeRng(n * 100)
      const cols = findPlacement(n, rng)
      expect(cols).toHaveLength(n)
      for (const c of cols) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThan(n)
      }
    }
  })
})

// ── findHalfTurnPlacement ─────────────────────────────────────────────────────

describe('findHalfTurnPlacement', () => {
  it('returns 180-degree symmetric placement for even N', () => {
    for (const n of [4, 6, 8, 10]) {
      const rng = makeRng(42 + n)
      const cols = findHalfTurnPlacement(n, rng)
      expect(cols).not.toBeNull()
      if (cols) {
        // cols[r] = c => cols[n-1-r] = n-1-c
        for (let r = 0; r < n; r++) {
          expect(cols[r] + cols[n - 1 - r]).toBe(n - 1)
        }
      }
    }
  })

  it('returns null for odd N', () => {
    for (const n of [3, 5, 7, 9]) {
      const rng = makeRng(42)
      expect(findHalfTurnPlacement(n, rng)).toBeNull()
    }
  })
})

// ── findSymmetricPlacement ────────────────────────────────────────────────────

describe('findSymmetricPlacement', () => {
  it('returns an involution for even N (when successful)', () => {
    for (const n of [6, 8, 10]) {
      let cols: number[] | null = null
      for (let s = 0; s < 200 && cols === null; s++) {
        const rng = makeRng(42 * 7919 + n * 1000 + s * 127)
        cols = findSymmetricPlacement(n, rng)
      }
      expect(cols).not.toBeNull()
      if (cols) {
        for (let r = 0; r < n; r++) {
          expect(cols[cols[r]]).toBe(r)
        }
      }
    }
  })

  it('returns null for odd N', () => {
    for (const n of [3, 5, 7]) {
      const rng = makeRng(42)
      expect(findSymmetricPlacement(n, rng)).toBeNull()
    }
  })
})

// ── targetDifficulty ──────────────────────────────────────────────────────────

describe('targetDifficulty', () => {
  it('easy: level 1-3', () => {
    for (const level of [1, 2, 3]) {
      const tgt = targetDifficulty(level)
      expect(tgt.minScore).toBe(1)
      expect(tgt.maxScore).toBe(14)
      expect(tgt.minStratBit).toBe(0)
    }
  })

  it('medium: level 4-8', () => {
    for (const level of [4, 5, 7, 8]) {
      const tgt = targetDifficulty(level)
      expect(tgt.minScore).toBe(14)
      expect(tgt.maxScore).toBe(30)
      expect(tgt.minRounds).toBe(2)
    }
  })

  it('hard: level 9-15', () => {
    for (const level of [9, 10, 12, 15]) {
      const tgt = targetDifficulty(level)
      expect(tgt.minScore).toBe(16)
      expect(tgt.maxScore).toBe(54)
      expect(tgt.minStratBit).toBe(6) // naked/hidden pair
    }
  })

  it('expert: level 16+', () => {
    for (const level of [16, 18, 20]) {
      const tgt = targetDifficulty(level)
      expect(tgt.minScore).toBe(50)
      expect(tgt.minStratBit).toBe(96) // forcing chain or branch
    }
  })
})

// ── difficultyScore ───────────────────────────────────────────────────────────

describe('difficultyScore', () => {
  it('returns 0 for empty strategies', () => {
    expect(difficultyScore(0, 0, 0, 0)).toBe(0)
  })

  it('monotonically increases with strategy bits', () => {
    const bits = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
    let prev = -1
    for (let i = 0; i < bits.length; i++) {
      const combined = bits.slice(0, i + 1).reduce((a, b) => a | b, 0)
      const score = difficultyScore(combined, 5, 2, 1)
      expect(score).toBeGreaterThanOrEqual(prev)
      prev = score
    }
  })

  it('includes step-count and round bonuses', () => {
    const base = difficultyScore(1, 0, 0, 0)
    const withSteps = difficultyScore(1, 10, 0, 1)
    const withRounds = difficultyScore(1, 10, 5, 3)
    expect(withSteps).toBeGreaterThan(base)
    expect(withRounds).toBeGreaterThanOrEqual(withSteps)
  })
})