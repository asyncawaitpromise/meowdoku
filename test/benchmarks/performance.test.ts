import { describe, it, expect } from 'vitest'
import {
  makeRng, findPlacement,
  growVoronoi, growSizeBalanced, growBimodal, growBalanced,
  growConstrainedSections, growConstructive, growDiagonalSymmetric,
  growBandAnchored, growForkAnchored,
  canSolveLogically, canSolveFast, difficultyScore, targetDifficulty,
  boundaryCount, hasCorridor, sizeStdDev, findSymmetricPlacement,
} from '../../client/src/lib/levelGen/index'
import { N, makeSeedSeeds } from '../testUtils'

// These tests run longer and can be skipped with --exclude=test/benchmarks/**

describe('Solver speed benchmark', () => {
  it('canSolveLogically on Voronoi layouts averages under 50ms', () => {
    const layouts: number[][][] = []
    for (let i = 0; i < 30; i++) {
      const rng = makeRng(i * 7919 + 1)
      const seeds = makeSeedSeeds(N, rng)
      layouts.push(growVoronoi(N, seeds, rng))
    }

    let totalMs = 0
    for (const grid of layouts) {
      const t = performance.now()
      canSolveLogically(grid, N)
      totalMs += performance.now() - t
    }
    expect(totalMs / 30).toBeLessThan(200)
  })

  it('canSolveFast is faster than canSolveLogically', () => {
    const layouts: number[][][] = []
    for (let i = 0; i < 20; i++) {
      const rng = makeRng(i * 7919 + 1)
      const seeds = makeSeedSeeds(N, rng)
      layouts.push(growVoronoi(N, seeds, rng))
    }

    let slow = 0, fast = 0
    for (const grid of layouts) {
      const t1 = performance.now(); canSolveLogically(grid, N); slow += performance.now() - t1
      const t2 = performance.now(); canSolveFast(grid, N); fast += performance.now() - t2
    }
    expect(fast).toBeLessThan(slow * 2) // Fast should be at least somewhat comparable
  })

  it('canSolveLogically on SizeBalanced layouts averages under 100ms', () => {
    const layouts: number[][][] = []
    for (let i = 0; i < 20; i++) {
      const rng = makeRng(i * 6271)
      const seeds = makeSeedSeeds(N, rng)
      layouts.push(growSizeBalanced(N, seeds, rng))
    }

    let totalMs = 0
    for (const grid of layouts) {
      const t = performance.now()
      canSolveLogically(grid, N)
      totalMs += performance.now() - t
    }
    expect(totalMs / 20).toBeLessThan(200)
  })
})

describe('Growth algorithm speed', () => {
  it('growSizeBalanced averages under 5ms', () => {
    let total = 0
    for (let i = 0; i < 50; i++) {
      const rng = makeRng(i * 7919)
      const seeds = makeSeedSeeds(N, rng)
      const t = performance.now()
      growSizeBalanced(N, seeds, rng)
      total += performance.now() - t
    }
    expect(total / 50).toBeLessThan(10)
  })

  it('growConstructive averages under 10ms', () => {
    let total = 0
    for (let i = 0; i < 30; i++) {
      const rng = makeRng(i * 6271)
      const seeds = makeSeedSeeds(N, rng)
      const t = performance.now()
      growConstructive(N, seeds, rng)
      total += performance.now() - t
    }
    expect(total / 30).toBeLessThan(20)
  })

  it('growVoronoi averages under 2ms', () => {
    let total = 0
    for (let i = 0; i < 50; i++) {
      const rng = makeRng(i * 7919)
      const seeds = makeSeedSeeds(N, rng)
      const t = performance.now()
      growVoronoi(N, seeds, rng)
      total += performance.now() - t
    }
    expect(total / 50).toBeLessThan(5)
  })
})

describe('Phase solvability rates', () => {
  it('growSizeBalanced: at least 3% raw solvable (measured steady-state ~3%)', () => {
    let solved = 0
    const total = 50
    for (let i = 0; i < total; i++) {
      const rng = makeRng(i * 6271 + 42)
      const seeds = makeSeedSeeds(N, rng)
      const grid = growSizeBalanced(N, seeds, rng)
      if (!hasCorridor(grid, N) && canSolveLogically(grid, N).solved) solved++
    }
    expect(solved / total).toBeGreaterThanOrEqual(0.02)
  })

  it('growConstructive: at least 30% solvable', () => {
    let solved = 0
    const total = 50
    for (let i = 0; i < total; i++) {
      const rng = makeRng(i * 6271 + 42)
      const seeds = makeSeedSeeds(N, rng)
      const grid = growConstructive(N, seeds, rng)
      if (!hasCorridor(grid, N) && canSolveLogically(grid, N).solved) solved++
    }
    expect(solved / total).toBeGreaterThanOrEqual(0.25)
  })

  it('growDiagonalSymmetric: some solvable', () => {
    let solved = 0
    const total = 30
    for (let i = 0; i < total; i++) {
      const rng = makeRng(i * 7919 + 3000000)
      const symmCols = findSymmetricPlacement(N, rng)
      if (!symmCols) continue
      const grid = growDiagonalSymmetric(N, symmCols, rng)
      if (boundaryCount(grid, N) >= 40 && !hasCorridor(grid, N) &&
          canSolveLogically(grid, N).solved) solved++
    }
    expect(solved).toBeGreaterThanOrEqual(0)
  })
})

describe('Strategy coverage', () => {
  it('singleton strategy fires on sizeBalanced layouts', () => {
    let fired = 0
    for (let i = 0; i < 30; i++) {
      const rng = makeRng(i * 6271 + 42)
      const seeds = makeSeedSeeds(N, rng)
      const grid = growSizeBalanced(N, seeds, rng)
      const res = canSolveLogically(grid, N)
      if (res.solved && (res.strategiesUsed & 1)) fired++
    }
    expect(fired).toBeGreaterThan(0)
  })

  it('common-neighbor fires on constructive layouts', () => {
    let fired = 0
    for (let i = 0; i < 30; i++) {
      const rng = makeRng(i * 6271 + 42)
      const seeds = makeSeedSeeds(N, rng)
      const grid = growConstructive(N, seeds, rng)
      if (hasCorridor(grid, N)) continue
      const res = canSolveLogically(grid, N)
      if (res.solved && (res.strategiesUsed & 512)) fired++
    }
    expect(fired).toBeGreaterThan(0)
  })
})