import { describe, it, expect } from 'vitest'
import {
  makeRng, shuffle,
  findPlacement, findHalfTurnPlacement, findSymmetricPlacement,
} from '../../client/src/lib/levelGen/index'
import { targetDifficulty, difficultyScore, techniqueVariety, pickSize } from '../../client/src/lib/levelGen/index'
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
  // Each tier is calibrated against refSize(levelNum) — the smallest (most
  // commonly drawn) board in that tier's pickSize pool: easy=5, medium=6,
  // hard=8, expert=10. Passing that size reproduces the original flat bars.
  it('easy: level 1-3', () => {
    for (const level of [1, 2, 3]) {
      const tgt = targetDifficulty(level, 5)
      expect(tgt.minScore).toBe(8)
      expect(tgt.maxScore).toBe(22)
      expect(tgt.minStratBit).toBe(512) // common-neighbor must fire
    }
  })

  it('medium: level 4-8', () => {
    for (const level of [4, 5, 7, 8]) {
      const tgt = targetDifficulty(level, 6)
      expect(tgt.minScore).toBe(18)
      expect(tgt.maxScore).toBe(40)
      expect(tgt.minRounds).toBe(3)
      expect(tgt.minStratBit).toBe(512) // common-neighbor (size-generic; naked/hidden-pair is N=10-only)
    }
  })

  it('hard: level 9-15', () => {
    for (const level of [9, 10, 12, 15]) {
      const tgt = targetDifficulty(level, 8)
      expect(tgt.minScore).toBe(17)
      expect(tgt.maxScore).toBe(62)
      expect(tgt.minStratBit).toBe(6) // naked/hidden pair
    }
  })

  it('expert: level 16+', () => {
    for (const level of [16, 18, 20]) {
      const tgt = targetDifficulty(level, 10)
      expect(tgt.minScore).toBe(60)
      expect(tgt.minStratBit).toBe(96) // forcing chain or branch
    }
  })

  it('scales minScore/minSteps up for boards larger than the tier reference size', () => {
    const base = targetDifficulty(12, 8)   // hard @ refSize
    const bigger = targetDifficulty(12, 10) // hard's other pool size
    expect(bigger.minScore).toBeGreaterThan(base.minScore)
    expect(bigger.minSteps).toBeGreaterThan(base.minSteps)
    // maxScore/minStratBit/minVariety stay fixed — only the floor scales
    expect(bigger.maxScore).toBe(base.maxScore)
    expect(bigger.minStratBit).toBe(base.minStratBit)
  })

  it('leaves the bar unchanged at the reference size itself', () => {
    expect(targetDifficulty(2, 5)).toEqual(targetDifficulty(2, 5))
    const tgt = targetDifficulty(2, 5)
    expect(tgt.minScore).toBe(8)
    expect(tgt.minSteps).toBe(12)
  })
})

// ── techniqueVariety ─────────────────────────────────────────────────────────

describe('techniqueVariety', () => {
  it('counts distinct strategy bits', () => {
    expect(techniqueVariety(0)).toBe(0)
    expect(techniqueVariety(1)).toBe(1) // singleton only
    expect(techniqueVariety(1 | 512)).toBe(2) // singleton + common-neighbor
    expect(techniqueVariety(1 | 2 | 4 | 512)).toBe(4)
    expect(techniqueVariety(1023)).toBe(10) // all 10 strategy bits
  })
})

// ── pickSize ─────────────────────────────────────────────────────────────────

describe('pickSize', () => {
  it('easy draws only from the small-size pool (5-7)', () => {
    const rng = makeRng(1)
    for (let i = 0; i < 200; i++) expect([5, 6, 7]).toContain(pickSize(2, rng))
  })

  it('medium draws only from 6-8', () => {
    const rng = makeRng(2)
    for (let i = 0; i < 200; i++) expect([6, 7, 8]).toContain(pickSize(6, rng))
  })

  it('hard draws only from 8 or 10', () => {
    const rng = makeRng(3)
    for (let i = 0; i < 200; i++) expect([8, 10]).toContain(pickSize(12, rng))
  })

  it('expert draws only from 10 or 11, and both actually appear', () => {
    const rng = makeRng(4)
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const s = pickSize(18, rng)
      expect([10, 11]).toContain(s)
      seen.add(s)
    }
    expect(seen.has(10)).toBe(true)
    expect(seen.has(11)).toBe(true)
  })

  it('easy sizes are not a single constant (real variety across draws)', () => {
    const rng = makeRng(5)
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(pickSize(2, rng))
    expect(seen.size).toBeGreaterThan(1)
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