import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { canSolveLogically } from '../../client/src/lib/levelGen/index'
import { profilePuzzle, CORE_TECHNIQUES } from '../../client/src/lib/levelGen/solver/profile'
import { TIERS } from '../../client/src/lib/levelGen/search/tiers'

function loadExternal(file: string, count: number) {
  const raw = JSON.parse(readFileSync(`external-resources/${file}`, 'utf-8'))
  const N: number = raw.size
  return raw.puzzles.slice(0, count).map((p: any) => ({ N, regions: Array.from({ length: N }, (_, r) => (p[1] as number[]).slice(r * N, r * N + N)) }))
}

describe('tier layout bar', () => {
  it('rejects lopsided boards (giant blobs + tiny anchors) and corridors', () => {
    const N = 10
    // 9 single-cell regions along the top row + one giant region: stddev way over the ceiling
    const lopsided = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => (r === 0 ? Math.min(c, 8) : 9)))
    expect(TIERS.expert.layoutAccepts(lopsided, N)).toBe(false)
    // ten equal rows: no corridor (fill ratio 1), no giant region, zero spread
    const rows = Array.from({ length: N }, (_, r) => Array.from({ length: N }, () => r))
    expect(TIERS.hard.layoutAccepts(rows, N)).toBe(true)
  })
})

describe('profilePuzzle', () => {
  it('canSolveLogically with nothing disabled matches the default call', () => {
    for (const { regions, N } of loadExternal('puzzles1', 5)) {
      expect(canSolveLogically(regions, N, 0)).toEqual(canSolveLogically(regions, N))
    }
  })

  it('disabling a technique that fired stops it firing', () => {
    for (const { regions, N } of loadExternal('puzzles1', 20)) {
      const base = canSolveLogically(regions, N)
      if (!base.techniqueCounts?.naked) continue
      expect(canSolveLogically(regions, N, 2).techniqueCounts?.naked ?? 0).toBe(0)
      return
    }
    throw new Error('no puzzle in the sample used naked pairs')
  })

  it('profiles solved reference puzzles consistently', () => {
    for (const { regions, N } of loadExternal('puzzles2', 8)) {
      const p = profilePuzzle(regions, N)
      expect(p.solved).toBe(true)
      expect(p.pairUse).toBe((p.counts.naked ?? 0) + (p.counts.hidden ?? 0))
      // a puzzle flagged as needing hypothesis must actually not solve without it
      if (p.required.includes('hypothesis')) expect(canSolveLogically(regions, N, 32 | 64).solved).toBe(false)
      else expect(canSolveLogically(regions, N, 32 | 64).solved).toBe(true)
    }
  }, 60_000)

  it('tier specs: expert is strictly stronger than hard', () => {
    expect(TIERS.expert.mustFire).toEqual(expect.arrayContaining(TIERS.hard.mustFire))
    expect(TIERS.expert.mustFire).toEqual(CORE_TECHNIQUES)
    expect(TIERS.expert.mustRequireHypothesis).toBe(true)
    expect(TIERS.expert.maxPairUse).toBeLessThanOrEqual(TIERS.hard.maxPairUse)
    expect(TIERS.expert.minRounds).toBeGreaterThanOrEqual(TIERS.hard.minRounds)
  })

  it('tier accepts() demands every listed technique and the pair budget', () => {
    const base = { solved: true, fired: [], required: ['hypothesis'], rounds: 3, maxSubsetSize: 2 }
    const good = { ...base, rounds: 20, counts: { 'common-neighbor': 9, naked: 2, branch: 1, 'forcing-chain': 1 }, pairUse: 2 }
    expect(TIERS.expert.accepts(good)).toBe(true)
    expect(TIERS.expert.accepts({ ...good, counts: { ...good.counts, 'forcing-chain': 0 } })).toBe(false)
    expect(TIERS.expert.accepts({ ...good, pairUse: TIERS.expert.maxPairUse + 1 })).toBe(false)
    expect(TIERS.expert.accepts({ ...good, required: [] })).toBe(false)
    expect(TIERS.hard.accepts({ ...good, counts: { 'common-neighbor': 9, naked: 2, branch: 1 } })).toBe(true)
    expect(TIERS.expert.accepts({ ...good, solved: false })).toBe(false)
    expect(TIERS.expert.accepts({ ...good, rounds: TIERS.expert.minRounds - 1 })).toBe(false)   // too shallow
  })
})
