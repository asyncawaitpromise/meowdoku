import { shuffle } from '../rng'
import { DIRS } from './directions'

// Targets the size distribution found in real tier-3 10×10 puzzles:
//   nAnchors tiny regions (capped at anchorCap cells) — these drive constraint cascade
//   N-nAnchors-2 medium regions (capped at medCap cells)
//   2 large regions (no cap — absorb everything remaining, targeting ~20 cells)
//
// medCap=9 leaves ~40 cells for the 2 large regions (≈20 each), matching external puzzles.
// Anchors get 5× weight so they claim territory before mediums crowd them out.
// Fallback uses BFS propagation (not distance) to prevent corridor shapes.
export function growBimodal(
  N: number,
  seeds: { r: number; c: number }[],
  rng: () => number,
  nAnchors = 2,
  anchorCap = 3,
  medCap = 9,
): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const anchorSet = new Set(shuffledIds.slice(0, nAnchors))
  const largeSet = new Set(shuffledIds.slice(N - 2, N))

  const capOf = (id: number) =>
    anchorSet.has(id) ? anchorCap : largeSet.has(id) ? Infinity : medCap

  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  const sizes = Array(N).fill(1)
  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] === -1) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        frontierMaps[grid[r][c]].set(nr * N + nc, cellPrio[nr * N + nc])
    }
  }

  let remaining = N * N - N

  while (remaining > 0) {
    const weights = Array.from({ length: N }, (_, id) =>
      frontierMaps[id].size > 0 && sizes[id] < capOf(id)
        ? (anchorSet.has(id) ? 5 : 1) / (sizes[id] ** 2)
        : 0
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
    for (const [dr, dc] of DIRS) {
      const nr = cr + dr, nc = cc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        const cell = nr * N + nc
        if (!frontierMaps[chosen].has(cell)) frontierMaps[chosen].set(cell, cellPrio[cell])
      }
    }
  }

  // Fallback: BFS expansion from claimed cells — assigns unclaimed cells to an adjacent
  // claimed region, preferring large regions. Prevents thin-arm corridors that form
  // when using distance-based fallback to reach isolated pockets.
  let absorbed = true
  while (absorbed && remaining > 0) {
    absorbed = false
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (grid[r][c] !== -1) continue
        let chosen = -1
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc] === -1) continue
          const adj = grid[nr][nc]
          if (chosen === -1 || largeSet.has(adj)) chosen = adj
        }
        if (chosen !== -1) {
          grid[r][c] = chosen; sizes[chosen]++; remaining--; absorbed = true
        }
      }
    }
  }

  return grid
}
