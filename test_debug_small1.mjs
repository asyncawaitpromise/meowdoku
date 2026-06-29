// Debug: why do SMALL_TARGET=1 singletons not produce solvable puzzles?
// These should work because singleton propagation fires immediately.

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

function growRegionsSmallLarge(N, seeds, rng, SMALL_TARGET) {
  const sortedByCol = seeds.map((s, id) => ({ id, col: s.c })).sort((a, b) => a.col - b.col)
  const isSmall = new Set()
  sortedByCol.forEach(({ id }, idx) => { if (idx % 2 === 0) isSmall.add(id) })

  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  const sizes = Array(N).fill(0)
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]

  seeds.forEach(({ r, c }, id) => { grid[r][c] = id; sizes[id] = 1 })

  // Grow small regions to SMALL_TARGET cells using BFS
  for (const id of isSmall) {
    const { r: sr, c: sc } = seeds[id]
    const q = [{ r: sr, c: sc }]
    let qi = 0
    while (sizes[id] < SMALL_TARGET && qi < q.length) {
      const { r, c } = q[qi]
      const dirs = shuffle([...DIRS], rng)
      for (const [dr, dc] of dirs) {
        if (sizes[id] >= SMALL_TARGET) break
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; sizes[id]++; q.push({ r: nr, c: nc })
        }
      }
      qi++
    }
  }

  // Large regions: BFS fill
  const q = []
  seeds.forEach(({ r, c }, id) => { if (!isSmall.has(id)) q.push({ r, c, id }) })
  let qi = 0
  while (qi < q.length) {
    const { r, c, id } = q[qi++]
    const dirs = shuffle([...DIRS], rng)
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; q.push({ r: nr, c: nc, id })
      }
    }
  }

  // Cleanup
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    seeds.forEach(({ r: sr, c: sc }, id) => {
      if (isSmall.has(id)) return
      const d = Math.abs(r - sr) + Math.abs(c - sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    if (best === -1) seeds.forEach(({ r: sr, c: sc }, id) => {
      const d = Math.abs(r - sr) + Math.abs(c - sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    grid[r][c] = best
  }

  return { grid, isSmall }
}

const N = 10
const rng = makeRng(100003 + 17)
const catCols = findPlacement(N, rng)
const solution = catCols.map((c, r) => ({ r, c }))
console.log('Cats:', solution.map(s => `(${s.r},${s.c})`).join(' '))
const { grid, isSmall } = growRegionsSmallLarge(N, solution, rng, 1)

console.log('\nSmall regions (singletons):', [...isSmall])
console.log('Grid:')
for (let r = 0; r < N; r++) console.log(grid[r].map(v => v.toString().padStart(2)).join(' '))

const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
const cands = Array.from({ length: N }, () => [])
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)

console.log('\nRegion info:')
cands.forEach((cs, id) => {
  const rows = [...new Set(cs.map(ROW))].sort((a,b)=>a-b)
  const cols = [...new Set(cs.map(COL))].sort((a,b)=>a-b)
  const type = isSmall.has(id) ? 'SMALL' : 'LARGE'
  console.log(`  Reg ${id} [${type}]: ${cs.length} cells, rows=${JSON.stringify(rows)}, cols=${JSON.stringify(cols)}`)
})

// Trace solver step by step
console.log('\n--- Solver trace ---')
const cands2 = Array.from({ length: N }, () => [])
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands2[grid[r][c]].push(r*N+c)

let iter = 0
let anyChange = true
while (anyChange) {
  anyChange = false
  iter++

  // Singleton propagation
  for (let reg = 0; reg < N; reg++) {
    if (cands2[reg].length === 0) { console.log(`CONTRADICTION at reg ${reg}`); break }
    if (cands2[reg].length !== 1) continue
    const cell = cands2[reg][0]
    const cr = ROW(cell), cc = COL(cell)
    console.log(`  Iter ${iter}: singleton reg ${reg} at (${cr},${cc})`)
    for (let other = 0; other < N; other++) {
      if (other === reg) continue
      const before = cands2[other].length
      cands2[other] = cands2[other].filter(c2 => {
        const r2 = ROW(c2), col2 = COL(c2)
        return r2 !== cr && col2 !== cc && !(Math.abs(r2-cr) <= 1 && Math.abs(col2-cc) <= 1)
      })
      if (cands2[other].length < before) {
        anyChange = true
        console.log(`    → reg ${other}: ${before} → ${cands2[other].length} (rows: ${[...new Set(cands2[other].map(ROW))].sort().join(',')}, cols: ${[...new Set(cands2[other].map(COL))].sort().join(',')})`)
      }
    }
  }

  if (iter > 30) { console.log('Too many iterations, stopping'); break }
}

const result = cands2.every(c => c.length === 1)
console.log(`\nFinal: ${result ? 'SOLVED' : 'NOT SOLVED'}`)
console.log('Final cand counts:', cands2.map((c,i) => `${i}:${c.length}`).join(' '))
