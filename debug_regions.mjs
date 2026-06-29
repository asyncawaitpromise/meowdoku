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
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
function findPlacement(N, rng) {
  const cols = []
  const usedCols = new Set()
  function solve(row) {
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
function growRegions(N, seeds, rng) {
  const N_SINGLETON = 4
  const sortedByRow = seeds
    .map((s, id) => ({ id, row: s.r }))
    .sort((a, b) => a.row - b.row)
  const singletonPickIndices = [0, 2, 5, 7]
  const isSingleton = new Set()
  for (const idx of singletonPickIndices) isSingleton.add(sortedByRow[idx].id)
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { if (isSingleton.has(id)) grid[r][c] = id })
  const frontier = []
  seeds.forEach(({ r, c }, id) => {
    if (!isSingleton.has(id)) { grid[r][c] = id; frontier.push({ r, c, id }) }
  })
  while (frontier.length > 0) {
    const qi = Math.floor(rng() * frontier.length)
    const { r, c, id } = frontier[qi]
    frontier[qi] = frontier[frontier.length - 1]
    frontier.pop()
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; frontier.push({ r: nr, c: nc, id })
      }
    }
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      seeds.forEach(({ r: sr, c: sc }, id) => {
        if (isSingleton.has(id)) return
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      })
      grid[r][c] = best
    }
  }
  return grid
}

const SZ = 10
const BASE = 1 * 100003 + 17
const rng = makeRng(BASE)
const catCols = findPlacement(SZ, rng)
const solution = catCols.map((c, r) => ({ r, c }))
const regions = growRegions(SZ, solution, rng)

const sizes = Array(SZ).fill(0)
for (let r = 0; r < SZ; r++)
  for (let c = 0; c < SZ; c++)
    sizes[regions[r][c]]++

console.log('region sizes:', sizes)
console.log('solution:', solution.map((s,i)=>`${i}:r${s.r}c${s.c}`).join(' '))

const singletonIds = sizes.map((s,id) => s === 1 ? id : -1).filter(id => id >= 0)
console.log('singleton ids:', singletonIds)

const cands = Array.from({ length: SZ }, () => [])
for (let r = 0; r < SZ; r++)
  for (let c = 0; c < SZ; c++)
    cands[regions[r][c]].push(r * SZ + c)

const ROW = cell => Math.floor(cell / SZ)
const COL = cell => cell % SZ

for (const sid of singletonIds) {
  const { r: cr, c: cc } = solution[sid]
  for (let other = 0; other < SZ; other++) {
    if (other === sid) continue
    cands[other] = cands[other].filter(cell => {
      const r2 = ROW(cell), c2 = COL(cell)
      return r2 !== cr && c2 !== cc && !(Math.abs(r2-cr)<=1 && Math.abs(c2-cc)<=1)
    })
  }
}

console.log('\nAfter singleton propagation:')
for (let id = 0; id < SZ; id++) {
  if (sizes[id] === 1) { console.log(`  region ${id} (singleton): placed`); continue }
  const rows = [...new Set(cands[id].map(ROW))].sort((a,b)=>a-b)
  const cols = [...new Set(cands[id].map(COL))].sort((a,b)=>a-b)
  console.log(`  region ${id} (size ${sizes[id]}): ${cands[id].length} cands, rows: [${rows}], cols: [${cols}]`)
}
