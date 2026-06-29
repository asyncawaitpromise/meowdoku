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
function growRegions(N, seeds, rng) {
  const SMALL_TARGET = 4
  const sortedByCol = seeds.map((s, id) => ({ id, col: s.c })).sort((a, b) => a.col - b.col)
  const isSmall = new Set()
  sortedByCol.forEach(({ id }, idx) => { if (idx % 2 === 0) isSmall.add(id) })
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  const sizes = Array(N).fill(0)
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id; sizes[id] = 1 })
  const HDIRS = [[0, -1], [0, 1]]
  for (const id of isSmall) {
    const seedRow = seeds[id].r
    const q = [seeds[id].c]
    while (sizes[id] < SMALL_TARGET && q.length > 0) {
      const idx = Math.floor(rng() * q.length)
      const c = q[idx]
      let expanded = false
      for (const [, dc] of shuffle([...HDIRS], rng)) {
        const nc = c + dc
        if (nc >= 0 && nc < N && grid[seedRow][nc] === -1) { grid[seedRow][nc] = id; sizes[id]++; q.push(nc); expanded = true; break }
      }
      if (!expanded) q.splice(idx, 1)
    }
  }
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const largeQueue = []
  seeds.forEach(({ r, c }, id) => { if (!isSmall.has(id)) largeQueue.push({ r, c, id }) })
  while (largeQueue.length > 0) {
    const idx = Math.floor(rng() * largeQueue.length)
    const { r, c, id } = largeQueue[idx]; largeQueue.splice(idx, 1)
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) { grid[nr][nc] = id; sizes[id]++; largeQueue.push({ r: nr, c: nc, id }) }
    }
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    seeds.forEach(({ r: sr, c: sc }, id) => {
      if (isSmall.has(id)) return
      const d = Math.abs(r - sr) + Math.abs(c - sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    if (best === -1) seeds.forEach(({ r: sr, c: sc }, id) => {
      const d = Math.abs(r - sr) + Math.abs(c - sc); if (d < bestDist) { bestDist = d; best = id }
    })
    grid[r][c] = best
  }
  return { grid, sizes, isSmall }
}

const N = 10
const rng = makeRng(100003 + 17)
const catCols = findPlacement(N, rng)
const solution = catCols.map((c, r) => ({ r, c }))
console.log('Seeds:', solution.map((s, i) => `[${i}]r${s.r}c${s.c}`).join(' '))
const { grid, sizes, isSmall } = growRegions(N, solution, rng)
console.log('IsSmall:', [...isSmall].join(','))
console.log('\nGrid:')
for (let r = 0; r < N; r++) console.log(grid[r].map(v => v.toString().padStart(2)).join(' '))

const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
const cands = Array.from({ length: N }, () => [])
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)

console.log('\nCandidate spans:')
cands.forEach((cs, id) => {
  const rows = [...new Set(cs.map(ROW))].sort((a,b)=>a-b)
  const cols = [...new Set(cs.map(COL))].sort((a,b)=>a-b)
  console.log(`  Reg ${id} (${isSmall.has(id)?'S':'L'}, ${sizes[id]}c): rows=${JSON.stringify(rows)} cols=${JSON.stringify(cols)}`)
})

const rowSpan = cands.map(cs => new Set(cs.map(ROW)))
console.log('\nNaked pairs (rows):')
for (let i = 0; i < N; i++) for (let j = i+1; j < N; j++) {
  const u = new Set([...rowSpan[i], ...rowSpan[j]])
  if (u.size === 2) console.log(`  Reg ${i}(${isSmall.has(i)?'S':'L'}) + Reg ${j}(${isSmall.has(j)?'S':'L'}): rows=${[...u]}`)
}
