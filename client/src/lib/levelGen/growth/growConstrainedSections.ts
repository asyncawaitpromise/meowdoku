import { shuffle } from '../rng'
import { DIRS } from './directions'
import { fillUnclaimedByAdjacency } from './fillUnclaimed'

// Inspired by the Queens generator (github.com/gitars/queens-generator):
// - Designates N/2 zones as "small sections" capped at N/2 cells (size variety)
// - Picks 1-2 rows and 1-2 columns as constrained bands; zones seeded inside
//   those bands can only expand within them (shape variety, forced deductions)
// - All zones grow via size-biased Prim's for organic shapes
// Returns null if a zone ends up below MIN_ZONE_SIZE (attempt is rejected).
export function growConstrainedSections(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] | null {
  const MIN_ZONE_SIZE = 2
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  // Constrained row band: 1 to N/4 rows
  const numCR = Math.floor(rng() * Math.floor(N / 4)) + 1
  const crStart = Math.floor(rng() * (N - numCR))
  const constrainedRowSet = new Set(Array.from({ length: numCR }, (_, i) => crStart + i))

  // Constrained col band: 1 to N/4 cols
  const numCC = Math.floor(rng() * Math.floor(N / 4)) + 1
  const ccStart = Math.floor(rng() * (N - numCC))
  const constrainedColSet = new Set(Array.from({ length: numCC }, (_, i) => ccStart + i))

  // Mandatory anchors (cascade starters): 1 singleton + 2 doublets randomly assigned.
  // Fewer than the original 8 anchors — enough to start deduction cascades
  // without making the puzzle trivially easy.
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const singId = shuffledIds[0]
  const doubIds = new Set([shuffledIds[1], shuffledIds[2]])

  // Small sections (beyond anchors): 3 additional zones capped at N/2 cells
  const smallSections = new Set(shuffledIds.slice(3, 6))
  const maxSmall = Math.floor(N / 2)

  // Zone constraints: if seed lands in a constrained band, zone stays inside it
  // Anchors (singleton, doublets) are exempt from row/col constraints so they
  // can always place their fixed number of cells without getting stuck.
  const anchorIds = new Set([singId, ...doubIds])
  const rowConstrained = new Map<number, Set<number>>()
  const colConstrained = new Map<number, Set<number>>()
  for (let id = 0; id < N; id++) {
    if (anchorIds.has(id)) continue
    const { r, c } = seeds[id]
    if (constrainedRowSet.has(r)) rowConstrained.set(id, constrainedRowSet)
    if (constrainedColSet.has(c)) colConstrained.set(id, constrainedColSet)
  }

  const canAssign = (id: number, r: number, c: number): boolean => {
    const rc = rowConstrained.get(id)
    if (rc && !rc.has(r)) return false
    const cc = colConstrained.get(id)
    if (cc && !cc.has(c)) return false
    return true
  }

  const sizes = Array(N).fill(1)

  // Grow singleton anchor (stays at 1 cell — seed only)

  // Grow doublet anchors (1 extra cell each)
  for (const id of doubIds) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; sizes[id]++; break
      }
    }
  }

  // Pre-assign random priorities for Prim's-style organic growth
  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  // Build initial frontiers (anchors don't grow further)
  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let id = 0; id < N; id++) {
    if (anchorIds.has(id)) continue  // anchors are fixed
    const { r, c } = seeds[id]
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1 && canAssign(id, nr, nc))
        frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
    }
    // Also seed frontier from any doublet extra cell
  }
  // Doublets: also seed frontier from their extra cell
  for (const id of doubIds) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (grid[r][c] !== id) continue
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
          frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
      }
    }
  }

  let remaining = Array.from({ length: N * N }, (_, i) => i).filter(i => grid[Math.floor(i / N)][i % N] === -1).length

  while (remaining > 0) {
    // Size-biased selection; anchors don't grow; small sections stop once capped
    const weights = Array.from({ length: N }, (_, id) => {
      if (anchorIds.has(id)) return 0
      if (frontierMaps[id].size === 0) return 0
      if (smallSections.has(id) && sizes[id] >= maxSmall) return 0
      return 1 / (sizes[id] * sizes[id])
    })
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) break

    let rv = rng() * total, chosen = N - 1
    for (let i = 0; i < N; i++) { rv -= weights[i]; if (rv <= 0) { chosen = i; break } }

    // Prim's: pick the highest-priority frontier cell
    let bestCell = -1, bestPrio = -1
    for (const [cell, prio] of frontierMaps[chosen])
      if (prio > bestPrio) { bestPrio = prio; bestCell = cell }
    if (bestCell === -1) { frontierMaps[chosen].clear(); continue }
    frontierMaps[chosen].delete(bestCell)

    const cr = Math.floor(bestCell / N), cc = bestCell % N
    if (grid[cr][cc] !== -1) continue

    grid[cr][cc] = chosen; sizes[chosen]++; remaining--
    for (const [dr, dc] of DIRS) {
      const nr = cr + dr, nc = cc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1 && canAssign(chosen, nr, nc)) {
        const cell = nr * N + nc
        if (!frontierMaps[chosen].has(cell)) frontierMaps[chosen].set(cell, cellPrio[cell])
      }
    }
  }

  // Fallback: unclaimed cells → an adjacent zone that can accept them
  // (respecting band confinement and the small-section cap), falling back to
  // any adjacent zone if none of its neighbors qualify.
  fillUnclaimedByAdjacency(
    grid, N, rng,
    (id, r, c) => canAssign(id, r, c) && !(smallSections.has(id) && sizes[id] >= maxSmall),
    id => { sizes[id]++ },
  )

  if (sizes.some(s => s < MIN_ZONE_SIZE)) return null
  return grid
}
