import { shuffle } from '../rng'
import { DIRS } from './directions'

// Balanced region growth: replaces singletons with doublets (minimum 2 cells per
// region) to match external puzzle quality standards. All anchors are at least
// 2 cells — the cascade no longer starts from a trivially-forced singleton.
// 8 anchor regions (doublets + triples) provide constraint cascades; 2 medium
// regions absorb remaining cells via size-biased Prim's.
export function growSizeBalanced(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const N_FREE = 2
  const nAnchors = N - N_FREE
  const N_DOUB = Math.max(2, Math.round(nAnchors * 5 / 8))
  const N_TRIP = Math.max(0, nAnchors - N_DOUB)
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(0, N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_DOUB, N_DOUB + N_TRIP))
  const freeIds = shuffledIds.slice(N_DOUB + N_TRIP)

  // Doublets: grow 1 extra cell. Try direct-adjacent first; if all 4 are
  // occupied (tight board), fall back to BFS for any reachable empty cell.
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

  // Triples: grow 2 extra cells (L-shapes and bent triominoes for variety)
  for (const id of isTrip) {
    const { r: sr, c: sc } = seeds[id]
    let r1 = -1, c1 = -1
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; r1 = nr; c1 = nc; break
      }
    }
    if (r1 !== -1) {
      const bases = rng() < 0.6
        ? [{ r: r1, c: c1 }, { r: sr, c: sc }]
        : [{ r: sr, c: sc }, { r: r1, c: c1 }]
      for (const { r: br, c: bc } of bases) {
        let found = false
        for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
          const nr = br + dr, nc = bc + dc
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
            grid[nr][nc] = id; found = true; break
          }
        }
        if (found) break
      }
    }
  }

  // Pre-assign random priorities for Prim's-style growth
  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  // Boundary bonus: cells adjacent to a DIFFERENT region get priority boost.
  // This encourages interleaved shapes with higher boundary counts, matching
  // the texture of external tier-3 puzzles.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
        if (grid[nr][nc] !== -1) {
          cellPrio[r * N + c] = Math.min(1.0, cellPrio[r * N + c] + 0.4)
          break  // one boundary neighbor is enough for the bonus
        }
      }
    }
  }

  // Quadrant affinity: boost cells in the same quadrant as their nearest free seed
  const half = N / 2
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cellQ = (r < half ? 0 : 2) + (c < half ? 0 : 1)
      let bestDist = Infinity, bestId = -1
      for (const id of freeIds) {
        const { r: sr, c: sc } = seeds[id]
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; bestId = id }
      }
      if (bestId !== -1) {
        const { r: sr, c: sc } = seeds[bestId]
        const seedQ = (sr < half ? 0 : 2) + (sc < half ? 0 : 1)
        if (cellQ === seedQ) cellPrio[r * N + c] = Math.min(1.0, cellPrio[r * N + c] + 0.3)
      }
    }
  }

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++
  for (let id = 0; id < N; id++) if (sizes[id] < 1) sizes[id] = 1

  const freeSet = new Set(freeIds)
  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] === -1 || !freeSet.has(grid[r][c])) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        frontierMaps[grid[r][c]].set(nr * N + nc, cellPrio[nr * N + nc])
      }
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

  // Fallback: unclaimed cells → nearest FREE region only (never anchors).
  // Anchors must stay at their capped size so the constraint cascade fires correctly.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = freeIds[0], bestDist = Infinity
      for (const id of freeIds) {
        const { r: sr, c: sc } = seeds[id]
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      }
      grid[r][c] = best
    }
  }

  return grid
}
