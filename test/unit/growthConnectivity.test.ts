import { describe, it, expect } from 'vitest'
import {
  makeRng, growSizeBalanced, growBalanced, growConstrainedSections,
  growConstructive, growBandAnchored, growForkAnchored,
} from '../../client/src/lib/levelGen/index'
import { makeSeedSeeds, N, allRegionsConnected } from '../testUtils'

// Regression coverage for a disconnected-region bug: the single-seed checks in
// growth.test.ts weren't enough to catch a "nearest seed by distance" fallback
// that could weld a boxed-in cell onto a region it never actually touches. Runs
// many seeds per grower since the failure only shows up for specific geometries.
const TRIALS = 500

describe('grow* fallback assignment stays connected', () => {
  it('growSizeBalanced stays connected across many seeds', () => {
    for (let i = 0; i < TRIALS; i++) {
      const rng = makeRng(i * 104729 + 1)
      const grid = growSizeBalanced(N, makeSeedSeeds(N, rng), rng)
      expect(allRegionsConnected(grid, N)).toBe(true)
    }
  })
  it('growBalanced stays connected across many seeds', () => {
    for (let i = 0; i < TRIALS; i++) {
      const rng = makeRng(i * 104729 + 2)
      const grid = growBalanced(N, makeSeedSeeds(N, rng), rng)
      expect(allRegionsConnected(grid, N)).toBe(true)
    }
  })
  it('growConstrainedSections stays connected across many seeds', () => {
    for (let i = 0; i < TRIALS; i++) {
      const rng = makeRng(i * 104729 + 3)
      const grid = growConstrainedSections(N, makeSeedSeeds(N, rng), rng)
      if (grid !== null) expect(allRegionsConnected(grid, N)).toBe(true)
    }
  })
  it('growConstructive stays connected across many seeds', () => {
    for (let i = 0; i < TRIALS; i++) {
      const rng = makeRng(i * 104729 + 4)
      const grid = growConstructive(N, makeSeedSeeds(N, rng), rng)
      expect(allRegionsConnected(grid, N)).toBe(true)
    }
  })
  it('growBandAnchored stays connected across many seeds', () => {
    for (let i = 0; i < TRIALS; i++) {
      const rng = makeRng(i * 104729 + 5)
      const grid = growBandAnchored(N, makeSeedSeeds(N, rng), rng)
      if (grid !== null) expect(allRegionsConnected(grid, N)).toBe(true)
    }
  })
  it('growForkAnchored stays connected across many seeds', () => {
    for (let i = 0; i < TRIALS; i++) {
      const rng = makeRng(i * 104729 + 6)
      const grid = growForkAnchored(N, makeSeedSeeds(N, rng), rng)
      if (grid !== null) expect(allRegionsConnected(grid, N)).toBe(true)
    }
  })
})
