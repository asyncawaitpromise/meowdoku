import { shuffle } from './rng'

// ── Connectivity check ───────────────────────────────────────────────────────

export function isConnectedWithout(grid: number[][], N: number, skipR: number, skipC: number, reg: number): boolean {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  let start = -1, size = 0
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== reg) continue
      size++
      if (!(r === skipR && c === skipC) && start === -1) start = r * N + c
    }
  }
  if (size <= 1 || start === -1) return false
  const visited = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const r = Math.floor(cur / N), c = cur % N
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
      const nidx = nr * N + nc
      if (!visited.has(nidx) && grid[nr][nc] === reg && !(nr === skipR && nc === skipC)) {
        visited.add(nidx); queue.push(nidx)
      }
    }
  }
  return visited.size === size - 1
}

// ── Diagonal-symmetric region growth ────────────────────────────────────────
// Grows a layout satisfying grid[r][c] = σ(grid[c][r]) (σ = solution involution).
//
// All 5 involution pairs grow evenly via size-biased Prim's with a hard per-region
// cap of ~18 cells. Symmetry-propagation (not tiny anchor regions) provides the
// constraint cascade that makes puzzles logically solvable.
export function growDiagonalSymmetric(N: number, solution: number[], rng: () => number): number[][] {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
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

// ── Phase 1: Voronoi region growth ──────────────────────────────────────────
// Simultaneous BFS from all star seeds. Used as starting point for SA.

export function growVoronoi(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  type QEntry = { r: number; c: number; id: number }
  let frontier: QEntry[] = shuffle(seeds.map((s, id) => ({ ...s, id })), rng)

  while (frontier.length > 0) {
    const idx = Math.floor(rng() * frontier.length)
    const entry = frontier[idx]
    frontier[idx] = frontier[frontier.length - 1]
    frontier.pop()
    const { r, c, id } = entry
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc] !== -1) continue
      grid[nr][nc] = id
      frontier.push({ r: nr, c: nc, id })
    }
  }

  return grid
}

// ── Span score ───────────────────────────────────────────────────────────────
// Sum of (row-span + col-span) across all regions. Lower = more confined =
// more deductions possible. Used as SA cost function.

export function spanScore(grid: number[][], N: number): number {
  const rows: Set<number>[] = Array.from({ length: N }, () => new Set())
  const cols: Set<number>[] = Array.from({ length: N }, () => new Set())
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      rows[grid[r][c]].add(r)
      cols[grid[r][c]].add(c)
    }
  }
  let s = 0
  for (let reg = 0; reg < N; reg++) s += rows[reg].size + cols[reg].size
  return s
}


export function boundaryCount(grid: number[][], N: number): number {
  let count = 0
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      if (c + 1 < N && grid[r][c] !== grid[r][c + 1]) count++
      if (r + 1 < N && grid[r][c] !== grid[r + 1][c]) count++
    }
  return count
}

export function hasCorridor(grid: number[][], N: number): boolean {
  const rows: Set<number>[] = Array.from({ length: N }, () => new Set())
  const cols: Set<number>[] = Array.from({ length: N }, () => new Set())
  const sizes: number[] = Array(N).fill(0)

  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const reg = grid[r][c]
      rows[reg].add(r)
      cols[reg].add(c)
      sizes[reg]++
    }

  for (let reg = 0; reg < N; reg++) {
    const rSpan = rows[reg].size
    const cSpan = cols[reg].size
    if (sizes[reg] <= 4) continue
    const fillRatio = sizes[reg] / (rSpan * cSpan)
    if (fillRatio < 0.35 && (rSpan >= 3 || cSpan >= 3)) return true
  }
  return false
}

export function maxRegionSize(regions: number[][], N: number): number {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sizes[regions[r][c]]++
  return Math.max(...sizes)
}

export function sizeStdDev(regions: number[][], N: number): number {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sizes[regions[r][c]]++
  const avg = (N * N) / N  // always N cells avg
  return Math.sqrt(sizes.reduce((s, c) => s + (c - avg) ** 2, 0) / N)
}

// Balanced region growth: 2 singletons anchor cascade propagation (performance),
// while 8 free regions grow evenly via size-biased Prim's with a hard cap of
// ~18 cells. Replaces the old 2-free-blobs (~42 cells each) with 8 evenly-sized
// regions.
// Result: sizes ~1–18 cells vs the old 1–42 cell spread.
// Solvability is maintained (singletons still start cascade instantly).
export function growSizeBalanced(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  // 8 anchor regions (2 singletons + 3 doublets + 3 triples) provide cascade
  // constraints. 2 medium regions absorb remaining ~83 cells via size-biased Prim's.
  const N_SING = 2, N_DOUB = 3, N_TRIP = 3
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const freeIds = shuffledIds.slice(N_SING + N_DOUB + N_TRIP)  // 2 medium regions

  // Doublets: grow 1 extra cell
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; break
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

// ── Phase 1: Constrained-sections region growth ──────────────────────────────
// Inspired by the Queens generator (github.com/gitars/queens-generator):
// - Designates N/2 zones as "small sections" capped at N/2 cells (size variety)
// - Picks 1-2 rows and 1-2 columns as constrained bands; zones seeded inside
//   those bands can only expand within them (shape variety, forced deductions)
// - All zones grow via size-biased Prim's for organic shapes
// Returns null if a zone ends up below MIN_ZONE_SIZE (attempt is rejected).
export function growConstrainedSections(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] | null {
  const MIN_ZONE_SIZE = 2
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
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

  // Fallback: unclaimed cells → nearest zone that can accept them
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      // Try constrained-valid zones first (respecting small cap)
      seeds.forEach(({ r: sr, c: sc }, sid) => {
        if (!canAssign(sid, r, c)) return
        if (smallSections.has(sid) && sizes[sid] >= maxSmall) return
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = sid }
      })
      // If nothing accepts it, use nearest without constraint
      if (best === -1) {
        seeds.forEach(({ r: sr, c: sc }, sid) => {
          const d = Math.abs(r - sr) + Math.abs(c - sc)
          if (d < bestDist) { bestDist = d; best = sid }
        })
      }
      grid[r][c] = best; sizes[best]++
    }
  }

  if (sizes.some(s => s < MIN_ZONE_SIZE)) return null
  return grid
}

// ── Bimodal region growth ────────────────────────────────────────────────────
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
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
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

// ── Constructive (cascade-chain) region growth ────────────────────────────────
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
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
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

  // Fallback: unclaimed cells → nearest non-primary region
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      for (let id = 0; id < N; id++) {
        if (primaries.has(id)) continue
        const { r: sr, c: sc } = seeds[id]
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      }
      if (best !== -1) grid[r][c] = best
    }
  }

  return grid
}

// ── Phase 2: Random-role region growth ──────────────────────────────────────
// Randomly assigns roles to seeds: 2 singletons (1 cell), 3 doublets (2 cells),
// 4 triples (3 cells), 1 large blob (fills remaining ~80 cells).
// Using random assignment (not sorted-by-row) gives visual variety across levels
// while maintaining ~6% per-attempt solvability for strat>=2.

export function growBalanced(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const N_SING = 2, N_DOUB = 3, N_TRIP = 4
  // RANDOMLY pick which seeds get each role (not sorted by row)
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const largeId = shuffledIds[N - 1]  // 1 large region (random seed)

  // Doublets: grow 1 extra cell in any direction
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; break
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

  // Large blob: distance-biased BFS for organic spread-out shape
  const blobSeed = seeds[largeId]
  const inBlob = new Set<number>()
  inBlob.add(blobSeed.r * N + blobSeed.c)
  // Priority frontier: [cell, dist] sorted by dist desc (grow far first)
  const blobFrontier: Array<{ r: number; c: number; dist: number }> = []
  for (const [dr, dc] of DIRS) {
    const nr = blobSeed.r + dr, nc = blobSeed.c + dc
    if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
      blobFrontier.push({ r: nr, c: nc, dist: Math.abs(nr - blobSeed.r) + Math.abs(nc - blobSeed.c) })
  }
  while (blobFrontier.length > 0) {
    // Pick randomly from top-half by distance (prefer far cells, add variety)
    const sorted = blobFrontier.sort((a, b) => b.dist - a.dist)
    const pickIdx = Math.floor(rng() * Math.max(1, Math.ceil(sorted.length * 0.4)))
    const { r: br, c: bc } = sorted.splice(pickIdx, 1)[0]
    if (grid[br][bc] !== -1) continue
    grid[br][bc] = largeId
    inBlob.add(br * N + bc)
    for (const [dr, dc] of DIRS) {
      const nr = br + dr, nc = bc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        blobFrontier.push({ r: nr, c: nc, dist: Math.abs(nr - blobSeed.r) + Math.abs(nc - blobSeed.c) })
    }
  }

  // Fallback: assign any remaining unclaimed cells to nearest seed
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      seeds.forEach(({ r: sr, c: sc }, sid) => {
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = sid }
      })
      grid[r][c] = best
    }
  }

  return grid
}
