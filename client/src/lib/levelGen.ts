const PALETTE = [
  '#f080b0', '#a07858', '#9888d8', '#f0d878', '#40b8c8',
  '#3d8b5a', '#88c870', '#6888c0', '#c0a820', '#d08888',
]


export interface GeneratedLevel {
  size: number
  regions: number[][]                  // regions[r][c] = regionId
  solution: { r: number; c: number }[] // solution[regionId] = correct cat cell
  colors: string[]                     // colors[regionId] = hex
}

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = seed | 0
  return (): number => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Cat placement (backtracking) ─────────────────────────────────────────────

function findPlacement(N: number, rng: () => number): number[] {
  const cols: number[] = []
  const usedCols = new Set<number>()

  function solve(row: number): boolean {
    if (row === N) return true
    const candidates = shuffle(
      Array.from({ length: N }, (_, i) => i).filter(c => {
        if (usedCols.has(c)) return false
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) return false
        return true
      }),
      rng
    )
    for (const c of candidates) {
      cols[row] = c
      usedCols.add(c)
      if (solve(row + 1)) return true
      cols.pop()
      usedCols.delete(c)
    }
    return false
  }

  solve(0)
  return cols
}

// ── Connectivity check ───────────────────────────────────────────────────────

function isConnectedWithout(grid: number[][], N: number, skipR: number, skipC: number, reg: number): boolean {
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

// ── Combination helper ───────────────────────────────────────────────────────

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result: T[][] = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
}

// ── Constraint-propagation solver ────────────────────────────────────────────

interface SolveResult { solved: boolean; strategiesUsed: number; unsolvedCount: number }

function canSolveLogically(regions: number[][], N: number): SolveResult {
  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  let anyChange = true
  let strategiesUsed = 0

  while (anyChange) {
    anyChange = false

    // 1. Singleton propagation
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return { solved: false, strategiesUsed, unsolvedCount: N }
      if (cands[reg].length !== 1) continue

      const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
      for (let other = 0; other < N; other++) {
        if (other === reg) continue
        const before = cands[other].length
        cands[other] = cands[other].filter(cell => {
          const r2 = ROW(cell), c2 = COL(cell)
          return r2 !== cr && c2 !== cc &&
            !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
        })
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 1 }
      }
    }

    const rowSpan: Set<number>[] = cands.map(cs => new Set(cs.map(ROW)))
    const colSpan: Set<number>[] = cands.map(cs => new Set(cs.map(COL)))

    const regsInRow: number[][] = Array.from({ length: N }, () => [])
    const regsInCol: number[][] = Array.from({ length: N }, () => [])
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length <= 1) continue
      for (const r of rowSpan[reg]) regsInRow[r].push(reg)
      for (const c of colSpan[reg]) regsInCol[c].push(reg)
    }

    const unplaced = Array.from({ length: N }, (_, i) => i).filter(r => cands[r].length > 1)

    for (const axis of [0, 1] as const) {
      const span = axis === 0 ? rowSpan : colSpan
      const regsInAxis = axis === 0 ? regsInRow : regsInCol
      const axisOf = axis === 0 ? ROW : COL

      // 2. Naked subsets
      for (let k = 2; k < unplaced.length; k++) {
        for (const subset of combinations(unplaced, k)) {
          const unionK = new Set(subset.flatMap(reg => [...span[reg]]))
          if (unionK.size !== k) continue
          const subSet = new Set(subset)
          for (let other = 0; other < N; other++) {
            if (subSet.has(other)) continue
            const before = cands[other].length
            cands[other] = cands[other].filter(cell => !unionK.has(axisOf(cell)))
            if (cands[other].length < before) { anyChange = true; strategiesUsed |= 2 }
          }
        }
      }

      // 3. Hidden subsets
      const activeAxis = Array.from({ length: N }, (_, i) => i)
        .filter(a => regsInAxis[a].length > 0)
      for (let k = 2; k < unplaced.length; k++) {
        for (const axisSub of combinations(activeAxis, k)) {
          const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
          if (regsIn.length !== k) continue
          const axisSet = new Set(axisSub)
          for (const reg of regsIn) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(cell => axisSet.has(axisOf(cell)))
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4 }
          }
        }
      }
    }

    if (anyChange) continue

    // 4. Trap 2×2
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) continue
      const rows = cands[reg].map(ROW)
      const cols = cands[reg].map(COL)
      const minR = Math.min(...rows), maxR = Math.max(...rows)
      const minC = Math.min(...cols), maxC = Math.max(...cols)
      if (maxR - minR > 1 || maxC - minC > 1) continue
      for (let other = 0; other < N; other++) {
        if (other === reg) continue
        const before = cands[other].length
        cands[other] = cands[other].filter(cell => {
          const r = ROW(cell), c = COL(cell)
          return !(r >= minR && r <= maxR && c >= minC && c <= maxC)
        })
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 8 }
      }
    }

    if (anyChange) continue

    // 5. Region crowding
    for (let reg = 0; reg < N && !anyChange; reg++) {
      for (let ci = 0; ci < cands[reg].length && !anyChange; ci++) {
        const cell = cands[reg][ci]
        const cr = ROW(cell), cc = COL(cell)
        for (let other = 0; other < N && !anyChange; other++) {
          if (other === reg || cands[other].length === 0) continue
          const survivors = cands[other].filter(c2 => {
            const r2 = ROW(c2), col2 = COL(c2)
            return r2 !== cr && col2 !== cc &&
              !(Math.abs(r2 - cr) <= 1 && Math.abs(col2 - cc) <= 1)
          })
          if (survivors.length === 0) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(c => c !== cell)
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 16 }
          }
        }
      }
    }
  }

  const unsolvedCount = cands.filter(c => c.length > 1).length
  return { solved: cands.every(c => c.length === 1), strategiesUsed, unsolvedCount }
}

// ── Phase 1: Voronoi region growth ──────────────────────────────────────────
// Simultaneous BFS from all star seeds. Used as starting point for SA.

function growVoronoi(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
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

function spanScore(grid: number[][], N: number): number {
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

// ── Phase 1: Simulated annealing region refinement ───────────────────────────
// Minimises spanScore via SA. Never moves a cat's seed cell; verifies
// 4-connectivity before each swap. Does NOT call canSolveLogically.

function hillClimbRegions(
  initialGrid: number[][],
  solution: { r: number; c: number }[],
  N: number,
  rng: () => number
): number[][] {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const MAX_ITER = 3000
  const T_START  = 6.0
  const T_MIN    = 0.05
  const COOLING  = 0.998

  const grid = initialGrid.map(row => [...row])
  let score    = spanScore(grid, N)
  let bestScore = score
  let bestGrid  = grid.map(r => [...r])
  let T = T_START

  for (let iter = 0; iter < MAX_ITER; iter++) {
    T = Math.max(T_MIN, T * COOLING)

    const r = Math.floor(rng() * N)
    const c = Math.floor(rng() * N)
    const from = grid[r][c]
    if (solution[from].r === r && solution[from].c === c) continue

    const [dr, dc] = DIRS[Math.floor(rng() * 4)]
    const nr = r + dr, nc = c + dc
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
    const to = grid[nr][nc]
    if (to === from) continue

    if (!isConnectedWithout(grid, N, r, c, from)) continue

    grid[r][c] = to
    const ns = spanScore(grid, N)
    const delta = ns - score

    if (delta <= 0 || rng() < Math.exp(-delta / T)) {
      score = ns
      if (score < bestScore) { bestScore = score; bestGrid = grid.map(row => [...row]) }
    } else {
      grid[r][c] = from
    }
  }

  return bestGrid
}

// ── Phase 2: Engineered structured regions ───────────────────────────────────
// Structured growth that achieves high solvability rates via:
//  - N_SINGLETON forced 1-cell regions (the cat's cell): immediate cascade
//  - N_SMALL doublet regions (2 cells): tight row/col confinement
//  - N_MEDIUM triple regions (3 cells): support naked/hidden subset strategies
//  - 1 large region: fills all remaining cells via BFS
//
// Regions are assigned to seeds sorted by row so that smaller regions are
// geographically distributed and don't compete for cells.

function growRegions(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const N_SINGLETON = 2
  const N_SMALL     = 3   // doublets (2 cells)
  const N_MEDIUM    = 4   // triples  (3 cells)

  const sortedByRow = seeds
    .map((s, id) => ({ id, row: s.r }))
    .sort((a, b) => a.row - b.row)

  const isSingleton = new Set<number>()
  const isSmall     = new Set<number>()
  const isMedium    = new Set<number>()
  sortedByRow.forEach(({ id }, idx) => {
    if (idx < N_SINGLETON)                            isSingleton.add(id)
    else if (idx < N_SINGLETON + N_SMALL)             isSmall.add(id)
    else if (idx < N_SINGLETON + N_SMALL + N_MEDIUM)  isMedium.add(id)
  })

  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const

  // Doublets: grow exactly 1 extra cell
  for (const id of isSmall) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; break
      }
    }
  }

  // Triples: grow exactly 2 extra cells via BFS
  for (const id of isMedium) {
    const { r: sr, c: sc } = seeds[id]
    const q = [{ r: sr, c: sc }]
    let grown = 0
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

  // Large region: BFS to fill all unclaimed cells
  const largeQ: { r: number; c: number; id: number }[] = []
  seeds.forEach((s, id) => {
    if (!isSingleton.has(id) && !isSmall.has(id) && !isMedium.has(id)) largeQ.push({ ...s, id })
  })
  for (let qi = 0; qi < largeQ.length; qi++) {
    const { r, c, id } = largeQ[qi]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id
        largeQ.push({ r: nr, c: nc, id })
      }
    }
  }

  // Assign any remaining unclaimed cells to nearest non-singleton seed
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      seeds.forEach(({ r: sr, c: sc }, id) => {
        if (isSingleton.has(id) || isSmall.has(id) || isMedium.has(id)) return
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      })
      if (best === -1) {
        seeds.forEach(({ r: sr, c: sc }, id) => {
          const d = Math.abs(r - sr) + Math.abs(c - sc)
          if (d < bestDist) { bestDist = d; best = id }
        })
      }
      grid[r][c] = best
    }
  }

  return grid
}

// ── Public API ───────────────────────────────────────────────────────────────

export function generateLevel(levelNum: number, puzzleSeed = 0): GeneratedLevel {
  const N = 10
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983

  // Phase 1: Voronoi + SA. Produces organic varied shapes at low solve rate.
  // Runs a limited number of attempts for a chance at visual variety.
  for (let attempt = 0; attempt < 30; attempt++) {
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = hillClimbRegions(growVoronoi(N, solution, rng), solution, N, rng)

    const result = canSolveLogically(regions, N)
    const stratCount = result.strategiesUsed.toString(2).split('1').length - 1
    if (result.solved && stratCount >= 2) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng) }
    }
  }

  // Phase 2: Structured engineered regions. High solve rate via forced small
  // regions that create immediate cascade. ~5-6% effective rate for strat>=2.
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = makeRng(BASE + attempt * 6271 + 1_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growRegions(N, solution, rng)

    const result = canSolveLogically(regions, N)
    const stratCount = result.strategiesUsed.toString(2).split('1').length - 1
    if (result.solved && stratCount >= 2) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng) }
    }
  }

  // Last resort: return a Voronoi layout without guarantee of solvability.
  const rng = makeRng(BASE)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  return { size: N, regions: growVoronoi(N, solution, rng), solution, colors: shuffle([...PALETTE], rng) }
}

// ── Hint engine ──────────────────────────────────────────────────────────────

export type HintPart = { type: 'text'; text: string } | { type: 'region'; regionId: number }

export interface Hint {
  parts: HintPart[]
}

function fmtList(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

const T = (text: string): HintPart => ({ type: 'text', text })
const R = (regionId: number): HintPart => ({ type: 'region', regionId })

function fmtRegionList(ids: number[]): HintPart[] {
  if (ids.length === 1) return [R(ids[0])]
  if (ids.length === 2) return [R(ids[0]), T(' and '), R(ids[1])]
  const parts: HintPart[] = []
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) parts.push(T(i === ids.length - 1 ? ', and ' : ', '))
    parts.push(R(ids[i]))
  }
  return parts
}

export function getHint(level: GeneratedLevel, solvedRegions: Set<number>, markedCells: Set<number> = new Set()): Hint | null {
  const N = level.size
  if (solvedRegions.size === N) return null

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[level.regions[r][c]].push(r * N + c)

  const placed = new Set<number>()

  const applyPlacement = (cr: number, cc: number) => {
    for (let reg = 0; reg < N; reg++) {
      cands[reg] = cands[reg].filter(cell => {
        const r2 = ROW(cell), c2 = COL(cell)
        return r2 !== cr && c2 !== cc &&
          !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
      })
    }
  }

  for (const regId of solvedRegions) {
    placed.add(regId)
    cands[regId] = []
    const { r: cr, c: cc } = level.solution[regId]
    applyPlacement(cr, cc)
  }

  const isNew = (cells: number[]): boolean => cells.some(cell => !markedCells.has(cell))

  let anyChange = true
  while (anyChange) {
    anyChange = false

    const unplaced = Array.from({ length: N }, (_, i) => i).filter(i => !placed.has(i))
    if (unplaced.length === 0) break

    const rowSpan = cands.map(cs => new Set(cs.map(ROW)))
    const colSpan = cands.map(cs => new Set(cs.map(COL)))

    const regsInRow: Set<number>[] = Array.from({ length: N }, () => new Set())
    const regsInCol: Set<number>[] = Array.from({ length: N }, () => new Set())
    const unplacedMulti: number[] = []
    for (const reg of unplaced) {
      if (cands[reg].length === 0) return null
      if (cands[reg].length <= 1) continue
      unplacedMulti.push(reg)
      for (const r of rowSpan[reg]) regsInRow[r].add(reg)
      for (const c of colSpan[reg]) regsInCol[c].add(reg)
    }

    // Strategy 1: singleton
    for (const reg of unplaced) {
      if (cands[reg].length !== 1) continue
      const cell = cands[reg][0]

      if (!solvedRegions.has(reg)) {
        return {
          parts: [T('The '), R(reg), T(` region has only one possible cell left (row ${ROW(cell) + 1}, column ${COL(cell) + 1}). Place the cat there.`)],
        }
      }

      placed.add(reg)
      cands[reg] = []
      applyPlacement(ROW(cell), COL(cell))
      anyChange = true
      break
    }
    if (anyChange) continue

    // Strategy 1b: hidden single row/col
    {
      let found = false
      for (let a = 0; a < N && !found; a++) {
        if (regsInRow[a].size === 1) {
          const [reg] = regsInRow[a]
          const outside = cands[reg].filter(cell => ROW(cell) !== a)
          if (outside.length > 0) {
            if (isNew(outside)) {
              return {
                parts: [T(`Row ${a + 1} only has cells from the `), R(reg), T(` region. That cat must be in row ${a + 1} — cross out its cells in every other row.`)],
              }
            }
            cands[reg] = cands[reg].filter(cell => ROW(cell) === a)
            anyChange = true; found = true
          }
        }
        if (!found && regsInCol[a].size === 1) {
          const [reg] = regsInCol[a]
          const outside = cands[reg].filter(cell => COL(cell) !== a)
          if (outside.length > 0) {
            if (isNew(outside)) {
              return {
                parts: [T(`Column ${a + 1} only has cells from the `), R(reg), T(` region. That cat must be in column ${a + 1} — cross out its cells in every other column.`)],
              }
            }
            cands[reg] = cands[reg].filter(cell => COL(cell) === a)
            anyChange = true; found = true
          }
        }
      }
    }
    if (anyChange) continue

    // Naked subsets
    {
      let found = false
      for (let k = 2; k < unplacedMulti.length && !found; k++) {
        for (const subset of combinations(unplacedMulti, k)) {
          const rowU = new Set(subset.flatMap(reg => [...rowSpan[reg]]))
          if (rowU.size === k) {
            const toElim = unplacedMulti
              .filter(reg => !subset.includes(reg))
              .flatMap(reg => cands[reg].filter(cell => rowU.has(ROW(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const rows = [...rowU].sort((a, b) => a - b).map(r => r + 1)
                return {
                  parts: k === 2
                    ? [T('The '), R(subset[0]), T(' and '), R(subset[1]), T(` regions can only be in rows ${rows[0]} and ${rows[1]}. Cross out every other color's cells in those two rows.`)]
                    : [T('The '), ...fmtRegionList(subset), T(` regions are all confined to rows ${fmtList(rows.map(String))}. Cross out every other color's cells in those rows.`)],
                }
              }
              for (const other of unplacedMulti)
                if (!subset.includes(other))
                  cands[other] = cands[other].filter(cell => !rowU.has(ROW(cell)))
              anyChange = true; found = true; break
            }
          }
          if (found) break
          const colU = new Set(subset.flatMap(reg => [...colSpan[reg]]))
          if (colU.size === k) {
            const toElim = unplacedMulti
              .filter(reg => !subset.includes(reg))
              .flatMap(reg => cands[reg].filter(cell => colU.has(COL(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const cols = [...colU].sort((a, b) => a - b).map(c => c + 1)
                return {
                  parts: k === 2
                    ? [T('The '), R(subset[0]), T(' and '), R(subset[1]), T(` regions can only be in columns ${cols[0]} and ${cols[1]}. Cross out every other color's cells in those two columns.`)]
                    : [T('The '), ...fmtRegionList(subset), T(` regions are all confined to columns ${fmtList(cols.map(String))}. Cross out every other color's cells in those columns.`)],
                }
              }
              for (const other of unplacedMulti)
                if (!subset.includes(other))
                  cands[other] = cands[other].filter(cell => !colU.has(COL(cell)))
              anyChange = true; found = true; break
            }
          }
        }
      }
    }
    if (anyChange) continue

    // Hidden subsets
    {
      const activeRows = Array.from({ length: N }, (_, i) => i).filter(r => regsInRow[r].size > 0)
      const activeCols = Array.from({ length: N }, (_, i) => i).filter(c => regsInCol[c].size > 0)
      let found = false
      const maxK = Math.min(unplacedMulti.length - 1, Math.max(activeRows.length, activeCols.length))
      for (let k = 2; k <= maxK && !found; k++) {
        for (const rowSub of combinations(activeRows, k)) {
          const regsIn = [...new Set(rowSub.flatMap(r => [...regsInRow[r]]))]
          if (regsIn.length === k) {
            const axisSet = new Set(rowSub)
            const toElim = regsIn.flatMap(reg => cands[reg].filter(cell => !axisSet.has(ROW(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const rows = rowSub.map(r => r + 1)
                return {
                  parts: k === 2
                    ? [T(`Rows ${rows[0]} and ${rows[1]} are the only rows with `), R(regsIn[0]), T(' and '), R(regsIn[1]), T(` cells. Those cats must stay in those rows — cross out their cells in every other row.`)]
                    : [T(`Rows ${fmtList(rows.map(String))} are the only rows containing `), ...fmtRegionList(regsIn), T(` cells. Cross out those colors' cells outside those rows.`)],
                }
              }
              for (const reg of regsIn)
                cands[reg] = cands[reg].filter(cell => axisSet.has(ROW(cell)))
              anyChange = true; found = true; break
            }
          }
        }
        if (found) break
        for (const colSub of combinations(activeCols, k)) {
          const regsIn = [...new Set(colSub.flatMap(c => [...regsInCol[c]]))]
          if (regsIn.length === k) {
            const axisSet = new Set(colSub)
            const toElim = regsIn.flatMap(reg => cands[reg].filter(cell => !axisSet.has(COL(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const cols = colSub.map(c => c + 1)
                return {
                  parts: k === 2
                    ? [T(`Columns ${cols[0]} and ${cols[1]} are the only columns with `), R(regsIn[0]), T(' and '), R(regsIn[1]), T(` cells. Those cats must stay in those columns — cross out their cells in every other column.`)]
                    : [T(`Columns ${fmtList(cols.map(String))} are the only columns containing `), ...fmtRegionList(regsIn), T(` cells. Cross out those colors' cells outside those columns.`)],
                }
              }
              for (const reg of regsIn)
                cands[reg] = cands[reg].filter(cell => axisSet.has(COL(cell)))
              anyChange = true; found = true; break
            }
          }
        }
      }
    }
    if (anyChange) continue

    // Trap 2×2
    {
      let found = false
      for (let reg = 0; reg < N && !found; reg++) {
        if (placed.has(reg) || cands[reg].length === 0) continue
        const rows = cands[reg].map(ROW)
        const cols = cands[reg].map(COL)
        const minR = Math.min(...rows), maxR = Math.max(...rows)
        const minC = Math.min(...cols), maxC = Math.max(...cols)
        if (maxR - minR > 1 || maxC - minC > 1) continue
        for (let other = 0; other < N && !found; other++) {
          if (other === reg || placed.has(other)) continue
          const toElim = cands[other].filter(cell => {
            const r = ROW(cell), c = COL(cell)
            return r >= minR && r <= maxR && c >= minC && c <= maxC
          })
          if (toElim.length > 0) {
            if (isNew(toElim)) {
              return {
                parts: [
                  T('The '), R(reg),
                  T(` region fits entirely in a 2×2 area (rows ${minR + 1}–${maxR + 1}, columns ${minC + 1}–${maxC + 1}). No other region's cat can go there too — cross out the `),
                  R(other),
                  T(" region's cells in that area."),
                ],
              }
            }
            cands[other] = cands[other].filter(cell => !toElim.includes(cell))
            anyChange = true; found = true
          }
        }
      }
    }
    if (anyChange) continue

    // Region crowding
    {
      let found = false
      for (let reg = 0; reg < N && !found; reg++) {
        if (placed.has(reg)) continue
        for (let ci = 0; ci < cands[reg].length && !found; ci++) {
          const cell = cands[reg][ci]
          const cr = ROW(cell), cc = COL(cell)
          for (let other = 0; other < N && !found; other++) {
            if (other === reg || placed.has(other) || cands[other].length === 0) continue
            const survivors = cands[other].filter(c2 => {
              const r2 = ROW(c2), col2 = COL(c2)
              return r2 !== cr && col2 !== cc &&
                !(Math.abs(r2 - cr) <= 1 && Math.abs(col2 - cc) <= 1)
            })
            if (survivors.length === 0) {
              if (isNew([cell])) {
                return {
                  parts: [
                    T(`Placing a cat at row ${cr + 1}, column ${cc + 1} for the `), R(reg),
                    T(' region would leave no valid cells for the '), R(other),
                    T(' region. Cross out that cell.'),
                  ],
                }
              }
              cands[reg] = cands[reg].filter(c => c !== cell)
              anyChange = true; found = true
            }
          }
        }
      }
    }
    if (anyChange) continue

    break
  }

  return {
    parts: [T('Look for regions limited to just a few rows or columns, or rows/columns that only contain a few regions.')],
  }
}
