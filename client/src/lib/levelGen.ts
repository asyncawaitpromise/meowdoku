const PALETTE = [
  '#f080b0', '#a07858', '#9888d8', '#f0d878', '#40b8c8',
  '#3d8b5a', '#88c870', '#6888c0', '#c0a820', '#d08888',
]

const PALETTE_NAMES: Record<string, string> = {
  '#f080b0': 'pink',
  '#a07858': 'brown',
  '#9888d8': 'purple',
  '#f0d878': 'yellow',
  '#40b8c8': 'teal',
  '#3d8b5a': 'dark green',
  '#88c870': 'light green',
  '#6888c0': 'blue',
  '#c0a820': 'olive',
  '#d08888': 'rose',
}

function colorName(level: GeneratedLevel, regionId: number): string {
  return PALETTE_NAMES[level.colors[regionId]] ?? `region ${regionId + 1}`
}

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
// One cat per row, one per column, no two cats in adjacent rows may be in
// adjacent columns (satisfies the "cats cannot touch" rule for row neighbours).

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

// ── Region growth (randomised BFS from cat seeds) ────────────────────────────

function growRegions(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  const queue: { r: number; c: number; id: number }[] = []

  seeds.forEach(({ r, c }, id) => {
    grid[r][c] = id
    queue.push({ r, c, id })
  })

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const

  while (queue.length > 0) {
    const idx = Math.floor(rng() * queue.length)
    const { r, c, id } = queue[idx]
    queue.splice(idx, 1)
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id
        queue.push({ r: nr, c: nc, id })
      }
    }
  }

  return grid
}

// ── Constraint-propagation solver ────────────────────────────────────────────
// Returns true only if the puzzle can be fully solved using logical deduction
// (no guessing). Uses three strategy families:
//
//  1. Singleton   – region with 1 candidate: place it, propagate row/col/
//                   adjacency eliminations to all other regions.
//
//  2. Naked subset (size 2 & 3) – N regions whose combined candidate rows
//     (or cols) span exactly N values → every other region can be removed
//     from those rows/cols.
//
//  3. Hidden subset (size 2 & 3) – N rows (or cols) that contain candidates
//     from exactly N regions → those regions must live in those rows/cols,
//     so their candidates elsewhere are removed.

function canSolveLogically(regions: number[][], N: number): boolean {
  // cands[reg] = cell indices (r*N+c) still possible for that region's cat
  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  let anyChange = true
  while (anyChange) {
    anyChange = false

    // 1. Singleton propagation ------------------------------------------------
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return false   // contradiction
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
        if (cands[other].length < before) anyChange = true
      }
    }

    // Precompute row/col span per region and reverse maps (axis → regions)
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

      // 2. Naked subsets (pairs & triples) ------------------------------------
      for (let i = 0; i < unplaced.length; i++) {
        for (let j = i + 1; j < unplaced.length; j++) {
          const union2 = new Set([...span[unplaced[i]], ...span[unplaced[j]]])

          if (union2.size === 2) {
            // Naked pair: eliminate other regions from these 2 axis values
            for (let other = 0; other < N; other++) {
              if (other === unplaced[i] || other === unplaced[j]) continue
              const before = cands[other].length
              cands[other] = cands[other].filter(cell => !union2.has(axisOf(cell)))
              if (cands[other].length < before) anyChange = true
            }
          }

          for (let k = j + 1; k < unplaced.length; k++) {
            const union3 = new Set([...union2, ...span[unplaced[k]]])
            if (union3.size === 3) {
              // Naked triple
              for (let other = 0; other < N; other++) {
                if (other === unplaced[i] || other === unplaced[j] || other === unplaced[k]) continue
                const before = cands[other].length
                cands[other] = cands[other].filter(cell => !union3.has(axisOf(cell)))
                if (cands[other].length < before) anyChange = true
              }
            }
          }
        }
      }

      // 3. Hidden subsets (pairs & triples) -----------------------------------
      for (let a = 0; a < N; a++) {
        for (let b = a + 1; b < N; b++) {
          const pair = [...new Set([...regsInAxis[a], ...regsInAxis[b]])]
          if (pair.length === 2) {
            // Hidden pair: confine these 2 regions to axis values {a, b}
            const axisSet2 = new Set([a, b])
            for (const reg of pair) {
              const before = cands[reg].length
              cands[reg] = cands[reg].filter(cell => axisSet2.has(axisOf(cell)))
              if (cands[reg].length < before) anyChange = true
            }
          }

          for (let c = b + 1; c < N; c++) {
            const triple = [...new Set([...regsInAxis[a], ...regsInAxis[b], ...regsInAxis[c]])]
            if (triple.length === 3) {
              const axisSet3 = new Set([a, b, c])
              for (const reg of triple) {
                const before = cands[reg].length
                cands[reg] = cands[reg].filter(cell => axisSet3.has(axisOf(cell)))
                if (cands[reg].length < before) anyChange = true
              }
            }
          }
        }
      }
    }
  }

  return cands.every(c => c.length === 1)
}

// ── Public API ───────────────────────────────────────────────────────────────

export function generateLevel(levelNum: number, puzzleSeed = 0): GeneratedLevel {
  const N = 10
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983

  // Try up to 200 (solution, region) combinations until we find one that is
  // fully solvable by logical deduction alone.
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growRegions(N, solution, rng)

    if (canSolveLogically(regions, N)) {
      const colors = shuffle([...PALETTE], rng)
      return { size: N, regions, solution, colors }
    }
  }

  // Fallback: return the first attempt regardless (should rarely be reached)
  const rng = makeRng(BASE)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  const regions = growRegions(N, solution, rng)
  const colors = shuffle([...PALETTE], rng)
  return { size: N, regions, solution, colors }
}

// ── Hint engine ──────────────────────────────────────────────────────────────
// Looks at the current board state and returns the next logical deduction
// the player can make, described in plain English.
//
// Uses iterative constraint propagation — mirrors canSolveLogically but tracks
// the *first* new deduction so the hint is always the earliest actionable step.

export interface Hint {
  message: string
}

function hintCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result: T[][] = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of hintCombinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
}

function fmtList(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

// markedCells: set of cell indices (r*N+c) the player has manually crossed out
//
// Key design: run the solver from FULL candidates (not the player's partial state).
// At each deduction, check if it's "new" — i.e., eliminates a cell the player
// hasn't marked yet. If new → return as hint. If already applied → apply
// internally and keep propagating. This mirrors canSolveLogically exactly.
export function getHint(level: GeneratedLevel, solvedRegions: Set<number>, markedCells: Set<number> = new Set()): Hint | null {
  const N = level.size
  if (solvedRegions.size === N) return null

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N
  const name = (r: number) => colorName(level, r)

  // Full candidates — no player marks applied yet
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

  // Seed solver with already-placed cats
  for (const regId of solvedRegions) {
    placed.add(regId)
    cands[regId] = []
    const { r: cr, c: cc } = level.solution[regId]
    applyPlacement(cr, cc)
  }

  // isNew: would this constraint eliminate any cell the player hasn't marked?
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
      if (cands[reg].length === 0) return null  // contradiction
      if (cands[reg].length <= 1) continue
      unplacedMulti.push(reg)
      for (const r of rowSpan[reg]) regsInRow[r].add(reg)
      for (const c of colSpan[reg]) regsInCol[c].add(reg)
    }

    // ── Strategy 1: singleton ─────────────────────────────────────────────────
    for (const reg of unplaced) {
      if (cands[reg].length !== 1) continue
      const cell = cands[reg][0]

      if (!solvedRegions.has(reg)) {
        // Player hasn't placed this yet — it's the hint
        return {
          message: `The ${name(reg)} region has only one possible cell left (row ${ROW(cell) + 1}, column ${COL(cell) + 1}). Place the cat there.`,
        }
      }

      // Already placed correctly — propagate
      placed.add(reg)
      cands[reg] = []
      applyPlacement(ROW(cell), COL(cell))
      anyChange = true
      break
    }
    if (anyChange) continue

    // ── Strategy 1b: hidden single row/col ───────────────────────────────────
    {
      let found = false
      for (let a = 0; a < N && !found; a++) {
        if (regsInRow[a].size === 1) {
          const [reg] = regsInRow[a]
          const outside = cands[reg].filter(cell => ROW(cell) !== a)
          if (outside.length > 0) {
            if (isNew(outside)) {
              return {
                message: `Row ${a + 1} only has cells from the ${name(reg)} region. That cat must be in row ${a + 1} — cross out its cells in every other row.`,
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
                message: `Column ${a + 1} only has cells from the ${name(reg)} region. That cat must be in column ${a + 1} — cross out its cells in every other column.`,
              }
            }
            cands[reg] = cands[reg].filter(cell => COL(cell) === a)
            anyChange = true; found = true
          }
        }
      }
    }
    if (anyChange) continue

    // ── Naked subsets (generalised) ───────────────────────────────────────────
    {
      let found = false
      for (let k = 2; k < unplacedMulti.length && !found; k++) {
        for (const subset of hintCombinations(unplacedMulti, k)) {
          const rowU = new Set(subset.flatMap(reg => [...rowSpan[reg]]))
          if (rowU.size === k) {
            const toElim = unplacedMulti
              .filter(reg => !subset.includes(reg))
              .flatMap(reg => cands[reg].filter(cell => rowU.has(ROW(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const rows = [...rowU].sort((a, b) => a - b).map(r => r + 1)
                return {
                  message: k === 2
                    ? `The ${name(subset[0])} and ${name(subset[1])} regions can only be in rows ${rows[0]} and ${rows[1]}. Cross out every other color's cells in those two rows.`
                    : `The ${fmtList(subset.map(name))} regions are all confined to rows ${fmtList(rows.map(String))}. Cross out every other color's cells in those rows.`,
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
                  message: k === 2
                    ? `The ${name(subset[0])} and ${name(subset[1])} regions can only be in columns ${cols[0]} and ${cols[1]}. Cross out every other color's cells in those two columns.`
                    : `The ${fmtList(subset.map(name))} regions are all confined to columns ${fmtList(cols.map(String))}. Cross out every other color's cells in those columns.`,
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

    // ── Hidden subsets (generalised) ──────────────────────────────────────────
    {
      const activeRows = Array.from({ length: N }, (_, i) => i).filter(r => regsInRow[r].size > 0)
      const activeCols = Array.from({ length: N }, (_, i) => i).filter(c => regsInCol[c].size > 0)
      let found = false
      const maxK = Math.min(unplacedMulti.length - 1, Math.max(activeRows.length, activeCols.length))
      for (let k = 2; k <= maxK && !found; k++) {
        for (const rowSub of hintCombinations(activeRows, k)) {
          const regsIn = [...new Set(rowSub.flatMap(r => [...regsInRow[r]]))]
          if (regsIn.length === k) {
            const axisSet = new Set(rowSub)
            const toElim = regsIn.flatMap(reg => cands[reg].filter(cell => !axisSet.has(ROW(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const rows = rowSub.map(r => r + 1)
                return {
                  message: k === 2
                    ? `Rows ${rows[0]} and ${rows[1]} are the only rows with ${name(regsIn[0])} and ${name(regsIn[1])} cells. Those cats must stay in those rows — cross out their cells in every other row.`
                    : `Rows ${fmtList(rows.map(String))} are the only rows containing ${fmtList(regsIn.map(name))} cells. Cross out those colors' cells outside those rows.`,
                }
              }
              for (const reg of regsIn)
                cands[reg] = cands[reg].filter(cell => axisSet.has(ROW(cell)))
              anyChange = true; found = true; break
            }
          }
        }
        if (found) break
        for (const colSub of hintCombinations(activeCols, k)) {
          const regsIn = [...new Set(colSub.flatMap(c => [...regsInCol[c]]))]
          if (regsIn.length === k) {
            const axisSet = new Set(colSub)
            const toElim = regsIn.flatMap(reg => cands[reg].filter(cell => !axisSet.has(COL(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const cols = colSub.map(c => c + 1)
                return {
                  message: k === 2
                    ? `Columns ${cols[0]} and ${cols[1]} are the only columns with ${name(regsIn[0])} and ${name(regsIn[1])} cells. Those cats must stay in those columns — cross out their cells in every other column.`
                    : `Columns ${fmtList(cols.map(String))} are the only columns containing ${fmtList(regsIn.map(name))} cells. Cross out those colors' cells outside those columns.`,
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

    break
  }

  return {
    message: 'Look for regions limited to just a few rows or columns, or rows/columns that only contain a few regions.',
  }
}
