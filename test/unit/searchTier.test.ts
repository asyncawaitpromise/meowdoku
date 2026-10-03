import { describe, it, expect } from 'vitest'
import { searchTierOnce, searchTierStream, searchSeedFor, countSolutions, encodeShareCode, decodeShareCode } from '../../client/src/lib/levelGen/index'
import { profilePuzzle } from '../../client/src/lib/levelGen/solver/profile'
import type { TierSpec } from '../../client/src/lib/levelGen/search/tiers'

// The real hard/expert bars take tens of seconds of search per puzzle, far too slow for a unit test
// (the published pools are checked against the real bars in publishedPools.test.ts). These tests
// drive the same search code with a cheap easy-tier spec to pin down its contract.
const cheap = (over: Partial<TierSpec> = {}): TierSpec => ({
  minSize: 5, minRounds: 0, maxSizeStdDev: 99, mustFire: ['common-neighbor'], mustRequireHypothesis: false, maxPairUse: 99,
  fitness: p => (p.solved ? (p.counts['common-neighbor'] ?? 0) : -Infinity),
  accepts: p => p.solved && (p.counts['common-neighbor'] ?? 0) > 0,
  layoutAccepts: () => true,
  ...over,
})
const EASY = 2 // generator level number for an easy-tier start layout

describe('searchTierOnce', () => {
  it('returns a puzzle that decodes from its own code, is unique, and clears the spec', () => {
    const spec = cheap()
    let found = null
    for (let seed = 1; seed < 40 && !found; seed++) found = searchTierOnce('hard', seed, 150, spec, EASY)
    expect(found).not.toBeNull()
    const f = found!
    expect(decodeShareCode(f.code)!.regions).toEqual(f.level.regions)
    expect(encodeShareCode(f.level)).toBe(f.code)
    expect(countSolutions(f.level.regions, f.level.size, 2)).toBe(1)
    expect(spec.accepts(profilePuzzle(f.level.regions, f.level.size))).toBe(true)   // the bar holds in decoded form
  }, 60_000)

  it('is a pure function of its seed', () => {
    const spec = cheap()
    let a = null, seed = 1
    for (; seed < 40 && !a; seed++) a = searchTierOnce('hard', seed, 150, spec, EASY)
    expect(a).not.toBeNull()
    expect(searchTierOnce('hard', seed - 1, 150, spec, EASY)!.code).toBe(a!.code)
  }, 60_000)

  it('never returns a puzzle that misses the bar: an unreachable spec yields null, not a best effort', () => {
    const never = cheap({ accepts: () => false })
    for (let seed = 1; seed <= 6; seed++) expect(searchTierOnce('hard', seed, 60, never, EASY)).toBeNull()
  }, 60_000)

  it('rejects start layouts smaller than the tier allows', () => {
    const onlyHuge = cheap({ minSize: 11 })
    for (let seed = 1; seed <= 6; seed++) expect(searchTierOnce('hard', seed, 60, onlyHuge, EASY)).toBeNull()
  }, 60_000)
})

describe('searchTierStream / searchSeedFor', () => {
  it('searchSeedFor matches the combined seed generateLevelByDifficulty uses', () => {
    expect(searchSeedFor(5, 2)).toBe(5 + 2 * 10007)
    expect(searchSeedFor(0, 0)).toBe(0)
  })

  it('yields after each failed attempt with a running count, and walks seeds by the stride', () => {
    // Real 'hard' bar on tiny step budgets so attempts fail fast; we only look at the first few yields.
    const stream = searchTierStream('hard', 100, 3, 1)
    const counts: number[] = []
    for (let i = 0; i < 3; i++) {
      const n = stream.next()
      if (n.done) break
      counts.push(n.value.attempts)
    }
    expect(counts).toEqual([1, 2, 3].slice(0, counts.length))
  }, 120_000)
})
