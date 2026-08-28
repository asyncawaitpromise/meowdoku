import { shuffle } from '../rng'
import { DIRS } from './directions'

// Grows a layout satisfying grid[r][c] = σ(grid[c][r]) (σ = solution involution).
//
// All 5 involution pairs grow evenly via size-biased Prim's with a hard per-region
// cap of ~18 cells. Symmetry-propagation (not tiny anchor regions) provides the
// constraint cascade that makes puzzles logically solvable.
export function growDiagonalSymmetric(N: number, solution: number[], rng: () => number): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])

  for (let i = 0; i < N; i++) grid[i][solution[i]] = i

  // Build canonical pairs: canonical = smaller ID in each {i, solution[i]} pair
  const canonicals: number[] = []
  const seen = new Set<number>()
  for (let i = 0; i < N; i++) {
    if (seen.has(i)) continue
    seen.add(i); seen.add(solution[i])
    canonicals.push(Math.min(i, solution[i]))
  }

  // 1 doublet pair (2 cells per region) anchors constraint cascades.
  // The other 4 pairs grow evenly via size-biased Prim's, capped at ~18 cells.
  const shuffledPairs = shuffle([...canonicals], rng)
  const doubPair = shuffledPairs[0]
  const CAP_DOUB = 2, CAP_REG = Math.ceil(N * 1.8)  // ~18 for N=10
  const capOfPair = (can: number) => can === doubPair ? CAP_DOUB : CAP_REG

  const cellPrio = new Float32Array(N * N)
  for (let k = 0; k < N * N; k++) cellPrio[k] = rng()

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++

  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())

  const addToFrontier = (can: number, r: number, c: number) => {
    if (r === c) return
    const ur = Math.min(r, c), uc = Math.max(r, c)
    if (grid[ur][uc] !== -1 || grid[uc][ur] !== -1) return
    const key = ur * N + uc
    if (!frontierMaps[can].has(key))
      frontierMaps[can].set(key, cellPrio[ur * N + uc])
  }

  for (const can of canonicals) {
    const j = solution[can]
    for (const [br, bc] of [[can, j], [j, can]] as [number, number][]) {
      for (const [dr, dc] of DIRS) {
        const nr = br + dr, nc = bc + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) addToFrontier(can, nr, nc)
      }
    }
  }

  let remaining = 0
  for (let r = 0; r < N; r++) for (let c = r + 1; c < N; c++)
    if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    let total = 0
    const ws: number[] = [], cs: number[] = []
    for (const can of canonicals) {
      if (frontierMaps[can].size === 0) continue
      const cap = capOfPair(can)
      if (sizes[can] >= cap || sizes[solution[can]] >= cap) continue
      const w = 1 / (sizes[can] * sizes[can])
      ws.push(w); cs.push(can); total += w
    }
    if (total === 0) break

    let rv = rng() * total, chosen = cs[cs.length - 1]
    for (let k = 0; k < cs.length; k++) { rv -= ws[k]; if (rv <= 0) { chosen = cs[k]; break } }

    let bestKey = -1, bestPrio = -1
    for (const [key, prio] of frontierMaps[chosen]) {
      if (prio > bestPrio) { bestPrio = prio; bestKey = key }
    }
    if (bestKey === -1) { frontierMaps[chosen].clear(); continue }
    frontierMaps[chosen].delete(bestKey)

    const ur = Math.floor(bestKey / N), uc = bestKey % N
    if (grid[ur][uc] !== -1 || grid[uc][ur] !== -1) continue

    const j = solution[chosen]
    grid[ur][uc] = chosen; grid[uc][ur] = j
    sizes[chosen]++; sizes[j]++; remaining--

    for (const [br, bc] of [[ur, uc], [uc, ur]] as [number, number][]) {
      for (const [dr, dc] of DIRS) {
        const nr = br + dr, nc = bc + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) addToFrontier(chosen, nr, nc)
      }
    }
  }

  // Diagonal cells (r === c): assign to nearest region seed
  for (let r = 0; r < N; r++) {
    if (grid[r][r] !== -1) continue
    let best = -1, bestDist = Infinity
    for (let i = 0; i < N; i++) {
      const d = Math.abs(r - i) + Math.abs(r - solution[i])
      if (d < bestDist) { bestDist = d; best = i }
    }
    grid[r][r] = best; sizes[best]++
  }

  // Fallback: any unclaimed cells go to nearest seed
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    for (let i = 0; i < N; i++) {
      const d = Math.abs(r - i) + Math.abs(c - solution[i])
      if (d < bestDist) { bestDist = d; best = i }
    }
    grid[r][c] = best; sizes[best]++
  }

  return grid
}
