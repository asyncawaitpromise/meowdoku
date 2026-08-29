import {
  makeRng, shuffle, findPlacement, PALETTE, STRATEGY_NAMES,
} from '../client/src/lib/levelGen/index'
import type { GeneratedLevel, SolveResult, Difficulty } from '../client/src/lib/levelGen/types'

export const N = 10

export { makeRng, shuffle, findPlacement, PALETTE }

export function makeSeedSeeds(N: number, rng: () => number): { r: number; c: number }[] {
  const cols = findPlacement(N, rng)
  return cols.map((c, r) => ({ r, c }))
}

export function getRegionSizes(regions: number[][], N: number): number[] {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      sizes[regions[r][c]]++
  return sizes
}

export function isGridComplete(regions: number[][], N: number): boolean {
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (regions[r][c] < 0 || regions[r][c] >= N) return false
  return true
}

export function allRegionsConnected(regions: number[][], N: number): boolean {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (let reg = 0; reg < N; reg++) {
    let start: { r: number; c: number } | null = null
    let total = 0
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (regions[r][c] === reg) { total++; if (!start) start = { r, c } }
    if (total === 0 || !start) continue
    const visited = new Set([start.r * N + start.c])
    const queue = [start.r * N + start.c]
    while (queue.length > 0) {
      const cur = queue.shift()!
      const cr = Math.floor(cur / N), cc = cur % N
      for (const [dr, dc] of DIRS) {
        const nr = cr + dr, nc = cc + dc
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
        const nidx = nr * N + nc
        if (!visited.has(nidx) && regions[nr][nc] === reg) {
          visited.add(nidx); queue.push(nidx)
        }
      }
    }
    if (visited.size !== total) return false
  }
  return true
}

export function allRegionsNonEmpty(regions: number[][], N: number): boolean {
  const seen = new Set<number>()
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      seen.add(regions[r][c])
  return seen.size === N
}

export function checkCatAdjacency(
  solution: { r: number; c: number }[],
  N: number
): boolean {
  const placed = new Set(solution.map(s => s.r * N + s.c))
  for (const { r, c } of solution) {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
        if (placed.has(nr * N + nc)) return false
      }
  }
  return true
}

export function checkCatRowCol(solution: { r: number; c: number }[]): boolean {
  const rows = new Set<number>()
  const cols = new Set<number>()
  for (const { r, c } of solution) {
    if (rows.has(r) || cols.has(c)) return false
    rows.add(r); cols.add(c)
  }
  return rows.size === solution.length && cols.size === solution.length
}

export function printGrid(regions: number[][], N: number, solution?: { r: number; c: number }[]): string {
  const solSet = solution ? new Set(solution.map(s => s.r * N + s.c)) : null
  const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return regions.map((row, r) =>
    row.map((id, c) => solSet?.has(r * N + c) ? `[${CHARS[id]}]` : ` ${CHARS[id]} `).join('')
  ).join('\n')
}

export type PuzzleQuality = {
  solved: boolean
  difficultyScore: number
  strategiesUsed: number
  easySteps: number
  hardSteps: number
  rounds: number
  unsolvedCount: number
  minRegionSize: number
  maxRegionSize: number
  avgRegionSize: number
  boundaryCount: number
  strategyHits: Record<string, boolean>
}

export const STRAT_BITS = STRATEGY_NAMES