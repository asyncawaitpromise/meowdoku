import { shuffle } from '../rng'
import { DIRS } from './directions'

// Random-role balanced growth — no singletons; minimum 2 cells per region.
// 2 regions grow freely (medium); the rest are split between doublets and
// triples in a 5:3 ratio, producing sizes consistent with external tier-3 puzzles.
export function growBalanced(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  // Role counts scale with N. 2 free/medium regions; rest split doublet:trip in
  // a 5:3 ratio (at N=10: 5 doublets, 3 triples, 2 medium).
  const N_FREE = 2
  const nRest = N - N_FREE
  const N_DOUB = Math.max(2, Math.round(nRest * 5 / 8))
  const N_TRIP = Math.max(0, nRest - N_DOUB)
  // RANDOMLY pick which seeds get each role
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(0, N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_DOUB, N_DOUB + N_TRIP))
  const freeIds = shuffledIds.slice(N_DOUB + N_TRIP)

  // Doublets: grow 1 extra cell. Try direct-adjacent first; BFS fallback if needed.
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    let placed = false
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; placed = true; break
      }
    }
    if (!placed) {
      const visited = new Set<number>()
      const queue = [[sr, sc]]
      visited.add(sr * N + sc)
      for (let qi = 0; qi < queue.length && !placed; qi++) {
        const [r, c] = queue[qi]
        for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
          const key = nr * N + nc
          if (visited.has(key)) continue
          visited.add(key)
          if (grid[nr][nc] === -1) {
            grid[nr][nc] = id; placed = true; break
          }
          queue.push([nr, nc])
        }
      }
    }
  }

  // Triples: grow 2 extra cells via BFS
  for (const id of isTrip) {
    const { r: sr, c: sc } = seeds[id]
    const q = [{ r: sr, c: sc }]; let grown = 0
    for (let qi = 0; qi < q.length && grown < 2; qi++) {
      const { r, c } = q[qi]
      for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; q.push({ r: nr, c: nc }); grown++; break
        }
      }
    }
  }

  // Free regions absorb remaining cells via size-biased Prim's, same as growSizeBalanced.
  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  // Boundary bonus: cells adjacent to any claimed region get priority boost.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
        if (grid[nr][nc] !== -1) {
          cellPrio[r * N + c] = Math.min(1.0, cellPrio[r * N + c] + 0.4)
          break
        }
      }
    }
  }

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++
  for (let id = 0; id < N; id++) if (sizes[id] < 1) sizes[id] = 1

  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const id = grid[r][c]
    if (id === -1 || !freeIds.includes(id)) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
    }
  }

  let remaining = 0
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    const weights = freeIds.map(i => frontierMaps[i].size > 0 ? 1 / (sizes[i] * sizes[i]) : 0)
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) break

    let rv = rng() * total, chosen = freeIds[freeIds.length - 1]
    for (let i = 0; i < freeIds.length; i++) { rv -= weights[i]; if (rv <= 0) { chosen = freeIds[i]; break } }

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

  // Fallback: unclaimed cells → nearest FREE region only (anchors stay capped).
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = freeIds[0], bestDist = Infinity
      for (const id of freeIds) {
        const { r: sr, c: sc } = seeds[id]
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      }
      grid[r][c] = best; sizes[best]++
    }
  }

  return grid
}
