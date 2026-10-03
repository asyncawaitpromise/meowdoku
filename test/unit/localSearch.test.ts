import { describe, it, expect } from 'vitest'
import { generateLevel, allRegionsConnected, countSolutions } from '../../client/src/lib/levelGen/index'
import { canonicalize, localSearch } from '../../client/src/lib/levelGen/search/localSearch'

describe('localSearch', () => {
  it('canonicalize relabels by first appearance and is idempotent', () => {
    const g = [[5, 5, 2], [5, 2, 2], [9, 9, 2]]
    expect(canonicalize(g, 3)).toEqual([[0, 0, 1], [0, 1, 1], [2, 2, 1]])
    expect(canonicalize(canonicalize(g, 3), 3)).toEqual(canonicalize(g, 3))
  })

  it('climbs without breaking the puzzle: unique, connected, cats stay put', () => {
    const start = generateLevel(2, 3)            // easy tier: fast, always solved
    const N = start.size
    const regions = canonicalize(start.regions, N)
    const relabel = new Map<number, number>()
    start.regions.forEach((row, r) => row.forEach((v, c) => { if (!relabel.has(v)) relabel.set(v, regions[r][c]) }))
    const solution: { r: number; c: number }[] = []
    start.solution.forEach((cell, id) => { solution[relabel.get(id)!] = cell })

    const fitness = (p: { solved: boolean; counts: Record<string, number> }) => p.solved ? (p.counts['common-neighbor'] ?? 0) : -Infinity
    const startFitness = fitness({ solved: true, counts: start.techniqueCounts })
    const res = localSearch(regions, { N, solution, fitness, minBoundaries: 0, maxRegion: 99, steps: 150, seed: 11 })

    expect(res).not.toBeNull()
    const out = res!
    expect(out.profile.solved).toBe(true)
    expect(out.fitness).toBeGreaterThanOrEqual(startFitness)
    expect(allRegionsConnected(out.regions, N)).toBe(true)
    expect(out.regions).toEqual(canonicalize(out.regions, N))   // always canonical, as a decoded share code is
    expect(countSolutions(out.regions, N, 2)).toBe(1)
    // every cat still sits in its own region, one per region
    const owners = solution.map(s => out.regions[s.r][s.c])
    expect(new Set(owners).size).toBe(N)
  }, 60_000)

  it('is deterministic for a fixed seed', () => {
    const start = generateLevel(2, 4)
    const N = start.size
    const regions = canonicalize(start.regions, N)
    const relabel = new Map<number, number>()
    start.regions.forEach((row, r) => row.forEach((v, c) => { if (!relabel.has(v)) relabel.set(v, regions[r][c]) }))
    const solution: { r: number; c: number }[] = []
    start.solution.forEach((cell, id) => { solution[relabel.get(id)!] = cell })
    const run = () => localSearch(regions, { N, solution, fitness: p => p.solved ? p.rounds : -Infinity, minBoundaries: 0, maxRegion: 99, steps: 80, seed: 5 })
    expect(run()!.regions).toEqual(run()!.regions)
  }, 60_000)

  it('returns null for an unsolvable start', () => {
    const N = 4
    const bad = [[0, 0, 1, 1], [0, 0, 1, 1], [2, 2, 3, 3], [2, 2, 3, 3]]
    const solution = [{ r: 0, c: 0 }, { r: 0, c: 3 }, { r: 3, c: 0 }, { r: 3, c: 3 }]
    expect(localSearch(bad, { N, solution, fitness: () => 0, minBoundaries: 0, maxRegion: 99, steps: 10, seed: 1 })).toBeNull()
  })
})
