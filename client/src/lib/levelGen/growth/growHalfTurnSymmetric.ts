import { shuffle } from '../rng'
import { DIRS } from './directions'

// Grows regions satisfying grid[r][c] = N-1-grid[N-1-r][N-1-c] (180° rotational
// symmetry). This is the symmetry pattern seen in all external tier-3 puzzles.
//
// 5 canonical pairs (can, N-1-can) for can = 0..4. When cell (r,c) is assigned
// to region `can`, cell (N-1-r, N-1-c) is simultaneously assigned to region N-1-can.
// Frontier tracks only top-half canonical cells (r < N/2) for efficiency.
// 2 "anchor" pairs grow to ≤4 cells each; 3 "body" pairs grow freely.
export function growHalfTurnSymmetric(N: number, solution: number[], rng: () => number): number[][] {
  const half = N / 2
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  for (let i = 0; i < N; i++) grid[i][solution[i]] = i

  const canonicals: number[] = Array.from({ length: half }, (_, i) => i)

  // Size-tier caps matched to external puzzle observations:
  //   N=10 (5 canonical pairs): external tier-3 never has 1-cell regions; observed
  //     distributions like 3,3,4,4,7,7,15,15,21,21. Use 3 ascending tiers + 2 bodies.
  //   N=7 (3 canonical pairs + center): 1 singleton + 1 small + 1 body — simpler
  //     board has fewer cells to distribute, singletons still help cascade.
  const shuffledCans = shuffle([...canonicals], rng)
  let capOf: (can: number) => number
  if (N >= 10) {
    // No singletons — external tier-3 minimum region is 2-3 cells. Target
    // distribution matching observed tier-3: 3,3,5,5,8,8,14,14,~21,~21.
    // With size-biased Prim's: once body1 hits cap 14, the remaining cells
    // all flow to body2, producing the asymmetric large pair naturally.
    const tinySet  = new Set(shuffledCans.slice(0, 1))  // cap 3
    const smallSet = new Set(shuffledCans.slice(1, 2))  // cap 5
    const medSet   = new Set(shuffledCans.slice(2, 3))  // cap 8
    const body1Set = new Set(shuffledCans.slice(3, 4))  // cap 14
    // body2 (last canonical) grows freely to absorb remaining ~21 cells/side
    capOf = (can: number) => tinySet.has(can) ? 3 : smallSet.has(can) ? 5 : medSet.has(can) ? 8 : body1Set.has(can) ? 14 : 40
  } else {
    const singletonSet = new Set(shuffledCans.slice(0, 1))
    const smallSet     = new Set(shuffledCans.slice(1, 2))
    capOf = (can: number) => singletonSet.has(can) ? 2 : smallSet.has(can) ? 5 : 22
  }

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++

  const cellPrio = new Float32Array(N * N)
  for (let k = 0; k < N * N; k++) cellPrio[k] = rng()

  // Frontier: canonical-half cells only (r < half), both cell and partner must be free
  const frontierMaps: Map<number, number>[] = Array.from({ length: half }, () => new Map())

  const addToFrontier = (can: number, r: number, c: number) => {
    if (r < 0 || r >= half || c < 0 || c >= N) return
    if (grid[r][c] !== -1 || grid[N - 1 - r][N - 1 - c] !== -1) return
    const key = r * N + c
    if (!frontierMaps[can].has(key)) frontierMaps[can].set(key, cellPrio[key])
  }

  // Initialize frontier from both the canonical seed and its partner seed
  for (const can of canonicals) {
    for (const [sr, sc] of [[can, solution[can]], [N - 1 - can, solution[N - 1 - can]]] as [number, number][]) {
      for (const [dr, dc] of DIRS) addToFrontier(can, sr + dr, sc + dc)
    }
  }

  let remaining = 0
  for (let r = 0; r < half; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    let total = 0
    const ws: number[] = [], cs: number[] = []
    for (const can of canonicals) {
      if (frontierMaps[can].size === 0 || sizes[can] >= capOf(can)) continue
      const w = 1 / (sizes[can] * sizes[can])
      ws.push(w); cs.push(can); total += w
    }
    if (total === 0) break

    let rv = rng() * total, chosen = cs[cs.length - 1]
    for (let k = 0; k < cs.length; k++) { rv -= ws[k]; if (rv <= 0) { chosen = cs[k]; break } }

    let bestKey = -1, bestPrio = -1
    for (const [key, prio] of frontierMaps[chosen])
      if (prio > bestPrio) { bestPrio = prio; bestKey = key }
    if (bestKey === -1) { frontierMaps[chosen].clear(); continue }
    frontierMaps[chosen].delete(bestKey)

    const ur = Math.floor(bestKey / N), uc = bestKey % N
    if (grid[ur][uc] !== -1 || grid[N - 1 - ur][N - 1 - uc] !== -1) continue

    const partnerReg = N - 1 - chosen
    grid[ur][uc] = chosen
    grid[N - 1 - ur][N - 1 - uc] = partnerReg
    sizes[chosen]++; sizes[partnerReg]++; remaining--

    // Expand frontier from both the new canonical cell and its partner cell
    for (const [dr, dc] of DIRS) {
      addToFrontier(chosen, ur + dr, uc + dc)
      addToFrontier(chosen, N - 1 - ur + dr, N - 1 - uc + dc)
    }
  }

  // Fallback: only iterate top-half cells; assign both the cell AND its bottom-half
  // mirror simultaneously to preserve half-turn symmetry (grid[r][c]+grid[N-1-r][N-1-c]=N-1).
  // Using the full-grid loop breaks symmetry when top/bottom get different nearest seeds.
  for (let r = 0; r < half; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      for (let i = 0; i < N; i++) {
        const d = Math.abs(r - i) + Math.abs(c - solution[i])
        if (d < bestDist) { bestDist = d; best = i }
      }
      const partner = N - 1 - best
      grid[r][c] = best; sizes[best]++
      grid[N - 1 - r][N - 1 - c] = partner; sizes[partner]++
    }
  }

  return grid
}
