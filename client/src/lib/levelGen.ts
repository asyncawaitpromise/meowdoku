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
