const PALETTE = [
  '#f080b0', '#a07858', '#9888d8', '#f0d878', '#40b8c8',
  '#3d8b5a', '#88c870', '#6888c0', '#c0a820', '#d08888',
]

export interface GeneratedLevel {
  size: number
  regions: number[][]               // regions[r][c] = regionId
  solution: { r: number; c: number }[] // solution[regionId] = correct cat cell
  colors: string[]                  // colors[regionId] = hex
}

// Seeded RNG (mulberry32)
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

// Backtracking: place one cat per row, one per column, no two cats in adjacent rows
// can be in adjacent columns (the "no touching" rule for row-adjacent pairs).
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

  // Fallback to a known-valid diagonal if backtracking somehow fails
  if (!solve(0)) {
    for (let r = 0; r < N; r++) cols[r] = (r * 2) % N || (r * 2 + 1) % N
  }
  return cols
}

// Randomized BFS region growth from cat seeds
function growRegions(
  N: number,
  seeds: { r: number; c: number }[],
  rng: () => number
): number[][] {
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

export function generateLevel(levelNum: number): GeneratedLevel {
  const N = 10
  const rng = makeRng(levelNum * 100003 + 17)

  const catCols = findPlacement(N, rng)
  // solution[regionId] = {r, c}; region i is seeded from cat in row i
  const solution = catCols.map((c, r) => ({ r, c }))
  const regions = growRegions(N, solution, rng)
  const colors = shuffle([...PALETTE], rng)

  return { size: N, regions, solution, colors }
}
