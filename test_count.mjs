function makeRng(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
function findPlacement(N, rng) {
  const cols = []
  const usedCols = new Set()
  function solve(row) {
    if (row === N) return true
    const candidates = shuffle(Array.from({ length: N }, (_, i) => i).filter(c => {
      if (usedCols.has(c)) return false
      if (row > 0 && Math.abs(c - cols[row - 1]) < 2) return false
      return true
    }), rng)
    for (const c of candidates) { cols[row] = c; usedCols.add(c); if (solve(row + 1)) return true; cols.pop(); usedCols.delete(c) }
    return false
  }
  solve(0); return cols
}
function growOriginal(N, seeds, rng) {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  const queue = []
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id; queue.push({ r, c, id }) })
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  while (queue.length > 0) {
    const idx = Math.floor(rng() * queue.length)
    const { r, c, id } = queue[idx]; queue.splice(idx, 1)
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) { grid[nr][nc] = id; queue.push({ r: nr, c: nc, id }) }
    }
  }
  return grid
}

function countSolutions(regions, N) {
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
  const initCands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) initCands[regions[r][c]].push(r*N+c)

  function propagate(cands) {
    let anyChange = true
    while (anyChange) {
      anyChange = false
      for (let reg = 0; reg < N; reg++) {
        if (cands[reg].length === 0) return false
        if (cands[reg].length !== 1) continue
        const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
        for (let other = 0; other < N; other++) {
          if (other === reg) continue
          const before = cands[other].length
          cands[other] = cands[other].filter(cell => {
            const r2 = ROW(cell), c2 = COL(cell)
            return r2 !== cr && c2 !== cc && !(Math.abs(r2-cr) <= 1 && Math.abs(c2-cc) <= 1)
          })
          if (cands[other].length < before) anyChange = true
        }
      }
    }
    return true
  }

  let count = 0
  const MAX_COUNT = 20  // stop counting after this many

  function search(cands, regIdx) {
    if (count >= MAX_COUNT) return
    if (regIdx === N) { count++; return }
    if (cands[regIdx].length === 0) return
    for (const cell of cands[regIdx]) {
      if (count >= MAX_COUNT) return
      const newCands = cands.map(c => [...c])
      newCands[regIdx] = [cell]
      const cr = ROW(cell), cc = COL(cell)
      for (let other = 0; other < N; other++) {
        if (other === regIdx) continue
        newCands[other] = newCands[other].filter(c => {
          const r2 = ROW(c), c2 = COL(c)
          return r2 !== cr && c2 !== cc && !(Math.abs(r2-cr) <= 1 && Math.abs(c2-cc) <= 1)
        })
      }
      if (propagate(newCands)) search(newCands, regIdx + 1)
    }
  }

  if (!propagate(initCands)) return 0
  search(initCands, 0)
  return count
}

const N = 10
const rng = makeRng(100003 + 17)
const catCols = findPlacement(N, rng)
const solution = catCols.map((c, r) => ({ r, c }))
const regions = growOriginal(N, solution, rng)
console.log('Solutions found (max 20):', countSolutions(regions, N))
