import { shuffle } from '../rng'
import { DIRS } from './directions'
import { fillUnclaimedByAdjacency } from './fillUnclaimed'

// Builds a deterministic cascade chain to maximize the fraction of cats placed
// uniquely via deduction, leaving only a small residual for the remaining regions.
//
// Cascade chain: primary singleton S fires → chain doublet D1 fires → D2 → ...
// Each chain doublet Di has exactly 2 cells: cat_i + 1 decoy adjacent to the
// cumulative eliminate zone of all prior chain members. When Di-1 fires, Di-1's
// eliminate zone removes Di's decoy → Di has 1 candidate left → Di fires.
//
// After the full chain fires (all N-1 chain members), only the blob region remains
// and is forced into the 1 remaining row × col intersection → puzzle solved!
// Chain fires completely when each cat is adjacent to the growing eliminate zone
// (~58% of random placements). When the chain breaks early, solvability degrades
// but the remaining regions are still significantly constrained.
export function growConstructive(
  N: number,
  seeds: { r: number; c: number }[],
  rng: () => number,
): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)

  // Cumulative eliminate zone: grows as each chain member fires.
  const eliminateZone = new Set<number>()
  const addToEliminateZone = (r: number, c: number) => {
    for (let i = 0; i < N; i++) {
      eliminateZone.add(i * N + c)  // entire col c
      eliminateZone.add(r * N + i)  // entire row r
    }
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N)
        eliminateZone.add(nr * N + nc)
    }
  }

  // 3 primary singletons seed the cascade: benchmarked at 84% solvability vs 22% for 1.
  const N_PRIMARY = 3
  const primaries = new Set(shuffledIds.slice(0, N_PRIMARY))
  for (const id of primaries) addToEliminateZone(seeds[id].r, seeds[id].c)

  // Greedily build the cascade chain for the remaining regions.
  // Each region tries to find 1 adjacent decoy cell in the current eliminate zone.
  // If found: region is a "chain doublet" (capped at size 2) and adds its cat
  //           position to the eliminate zone (so the next region can chain from it).
  // If not found: region grows freely (acts as medium filler / partial anchor).
  //
  // The blob (last shuffledId) is always free-growing regardless.
  const chainWithDecoy = new Set<number>()  // regions that got a decoy → capped at 2

  for (const id of shuffledIds.slice(N_PRIMARY, N - 1)) {
    const { r: cr, c: cc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = cr + dr, nc = cc + dc
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
      if (!eliminateZone.has(nr * N + nc) || grid[nr][nc] !== -1) continue
      // Claim this decoy cell
      grid[nr][nc] = id
      chainWithDecoy.add(id)
      // Add this region's cat to the eliminate zone so next doublet can chain from it
      addToEliminateZone(cr, cc)
      break
    }
  }

  // Grow via size-biased Prim's:
  // - Primary singleton: stays at size 1
  // - Chain doublets (chainWithDecoy): capped at size 2
  // - Free regions and the blob: uncapped
  const canGrow = (id: number) => {
    if (primaries.has(id)) return false
    if (chainWithDecoy.has(id) && sizes[id] >= 2) return false
    return true
  }

  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++
  for (let id = 0; id < N; id++) if (sizes[id] === 0) sizes[id] = 1

  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const id = grid[r][c]
    if (id === -1 || !canGrow(id)) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
    }
  }

  let remaining = 0
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    const weights = Array.from({ length: N }, (_, id) =>
      canGrow(id) && frontierMaps[id].size > 0 ? 1 / (sizes[id] ** 2) : 0
    )
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) break

    let rv = rng() * total, chosen = 0
    for (let i = 0; i < N; i++) { rv -= weights[i]; if (rv <= 0) { chosen = i; break } }

    let bestCell = -1, bestPrio = -1
    for (const [cell, prio] of frontierMaps[chosen])
      if (prio > bestPrio) { bestPrio = prio; bestCell = cell }
    if (bestCell === -1) { frontierMaps[chosen].clear(); continue }
    frontierMaps[chosen].delete(bestCell)

    const cr = Math.floor(bestCell / N), cc = bestCell % N
    if (grid[cr][cc] !== -1) continue

    grid[cr][cc] = chosen; sizes[chosen]++; remaining--

    if (!canGrow(chosen)) continue  // capped — don't expand frontier
    for (const [dr, dc] of DIRS) {
      const nr = cr + dr, nc = cc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        const cell = nr * N + nc
        if (!frontierMaps[chosen].has(cell)) frontierMaps[chosen].set(cell, cellPrio[cell])
      }
    }
  }

  // Fallback: unclaimed cells → an adjacent non-primary region
  fillUnclaimedByAdjacency(grid, N, rng, id => !primaries.has(id))

  return grid
}
