import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { canSolveLogically, countSolutions } from '../../client/src/lib/levelGen/index'

// Regression test against real external reference puzzles (external-resources/,
// tuple-v3-summary encoding — see the memory doc "external-reference-profile"
// for the format: each puzzle tuple is [seed, regionsFlat, solutionCols, grade,
// logicScore, boundaryCount, regionSizeStdDev, metaObject]). Supersedes the old
// root-level test_external.ts (removed in favor of the vitest suite, but never
// actually replaced here) — this is the only place our solver gets checked
// against puzzles we didn't generate ourselves. It matters because
// canSolveLogically's hypothesis-based techniques (branch-rule, forcing-chain)
// only ever get exercised by our own fork-anchored/band-anchored growth output
// otherwise, which is a much narrower slice of possible region geometry than
// what a real puzzle designer's tool produces.
function flatToGrid(flat: number[], n: number): number[][] {
  const grid: number[][] = []
  for (let r = 0; r < n; r++) grid.push(flat.slice(r * n, r * n + n))
  return grid
}

type ExternalPuzzle = [number, number[], number[], number, number, number, number, { techniqueCounts?: Record<string, number>; maxHypothesisDepth?: number }]

function loadPuzzles(path: string): { size: number; tier: number; puzzles: ExternalPuzzle[] } {
  const raw = JSON.parse(readFileSync(path, 'utf-8'))
  return { size: raw.size, tier: raw.tier, puzzles: raw.puzzles }
}

function checkAll(path: string) {
  const { size: N, puzzles } = loadPuzzles(path)
  let solved = 0, unique = 0
  const unsolvedIds: number[] = []
  for (const [id, flatGrid] of puzzles) {
    const grid = flatToGrid(flatGrid, N)
    if (canSolveLogically(grid, N).solved) solved++
    else unsolvedIds.push(id)
    if (countSolutions(grid, N, 2) === 1) unique++
  }
  return { total: puzzles.length, solved, unique, unsolvedIds }
}

describe('external reference puzzles (real puzzles we did not generate)', () => {
  it('puzzles1 (size 7, external tier 2): our solver solves all of them with a unique solution', () => {
    const r = checkAll('external-resources/puzzles1')
    expect(r.unsolvedIds).toEqual([])
    expect(r.solved).toBe(r.total)
    expect(r.unique).toBe(r.total)
  }, 60000)

  it('puzzles2 (size 10, external tier 3): our solver solves all of them with a unique solution', () => {
    const r = checkAll('external-resources/puzzles2')
    expect(r.unsolvedIds).toEqual([])
    expect(r.solved).toBe(r.total)
    expect(r.unique).toBe(r.total)
  }, 60000)

  // puzzles3-hard (external tier 4, added 2026-08-24): every puzzle in this
  // set requires the external tool's "contradiction-long" technique (100% —
  // see its metaObject.techniqueCounts), which isn't a technique name our
  // solver tracks directly. It's still solvable by our existing forcing-chain
  // (bit 32) / branch-rule (bit 64) hypothesis simulation as long as that
  // simulation's inner propagation loop runs to a fixed point rather than
  // stopping after one round — which it does (see canSolveLogically's
  // runProp/simCands `while` loops) — so "long" chains resolve the same way
  // "depth-1" ones do, just with more propagation rounds inside the same
  // single hypothesis. Confirmed empirically: all 97 solve.
  it('puzzles3-hard (size 10, external tier 4): our solver solves all of them with a unique solution', () => {
    const r = checkAll('external-resources/puzzles3-hard')
    expect(r.unsolvedIds).toEqual([])
    expect(r.solved).toBe(r.total)
    expect(r.unique).toBe(r.total)
  }, 60000)
})
