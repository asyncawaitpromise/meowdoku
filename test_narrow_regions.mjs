// Test: narrow regions (constrained row or col span)
// Each region is grown with BFS but STOPS expanding if it would exceed max_row_span rows
// OR max_col_span cols. Remaining cells assigned by nearest.

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

function canSolveLogically(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[regions[r][c]].push(r*N+c)
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N

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
    const rowSpan = cands.map(cs => new Set(cs.map(ROW)))
    const colSpan = cands.map(cs => new Set(cs.map(COL)))
    const regsInRow = Array.from({ length: N }, () => [])
    const regsInCol = Array.from({ length: N }, () => [])
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length <= 1) continue
      for (const r of rowSpan[reg]) regsInRow[r].push(reg)
      for (const c of colSpan[reg]) regsInCol[c].push(reg)
    }
    const unplaced = Array.from({ length: N }, (_, i) => i).filter(r => cands[r].length > 1)
    for (const axis of [0, 1]) {
      const span = axis === 0 ? rowSpan : colSpan
      const regsInAxis = axis === 0 ? regsInRow : regsInCol
      const axisOf = axis === 0 ? ROW : COL
      for (let i = 0; i < unplaced.length; i++) {
        for (let j = i + 1; j < unplaced.length; j++) {
          const union2 = new Set([...span[unplaced[i]], ...span[unplaced[j]]])
          if (union2.size === 2) {
            for (let other = 0; other < N; other++) {
              if (other === unplaced[i] || other === unplaced[j]) continue
              const before = cands[other].length
              cands[other] = cands[other].filter(cell => !union2.has(axisOf(cell)))
              if (cands[other].length < before) anyChange = true
            }
          }
          for (let k = j+1; k < unplaced.length; k++) {
            const union3 = new Set([...union2, ...span[unplaced[k]]])
            if (union3.size === 3) {
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
      for (let a = 0; a < N; a++) {
        for (let b = a+1; b < N; b++) {
          const pair = [...new Set([...regsInAxis[a], ...regsInAxis[b]])]
          if (pair.length === 2) {
            const axisSet2 = new Set([a, b])
            for (const reg of pair) {
              const before = cands[reg].length
              cands[reg] = cands[reg].filter(cell => axisSet2.has(axisOf(cell)))
              if (cands[reg].length < before) anyChange = true
            }
          }
          for (let c = b+1; c < N; c++) {
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

// BFS with max row span OR max col span constraint
function growRegionsNarrow(N, seeds, rng, maxSpan, minSize, maxSize) {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]

  // Round-robin BFS with span constraints
  const queues = seeds.map(({ r, c }) => [{ r, c }])
  const rowSets = seeds.map(({ r }) => new Set([r]))
  const colSets = seeds.map(({ c }) => new Set([c]))
  const sizes = Array(N).fill(1)

  let anyProgress = true
  while (anyProgress) {
    anyProgress = false
    for (let id = 0; id < N; id++) {
      if (sizes[id] >= maxSize) continue
      const q = queues[id]
      for (let attempt = 0; attempt < q.length; attempt++) {
        const idx = Math.floor(rng() * q.length)
        const { r, c } = q[idx]
        let grew = false
        for (const [dr, dc] of shuffle([...DIRS], rng)) {
          const nr = r+dr, nc = c+dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc] !== -1) continue
          // Check span constraint
          const newRowSet = new Set([...rowSets[id], nr])
          const newColSet = new Set([...colSets[id], nc])
          // Allow if row span ≤ maxSpan OR col span ≤ maxSpan (at least one axis is narrow)
          if (newRowSet.size <= maxSpan || newColSet.size <= maxSpan) {
            grid[nr][nc] = id; sizes[id]++
            rowSets[id] = newRowSet; colSets[id] = newColSet
            q.push({ r: nr, c: nc }); grew = true; anyProgress = true; break
          }
        }
        if (grew) break
        if (!grew && attempt === q.length - 1) {
          // Stuck: remove this cell from queue
          q.splice(idx, 1)
          break
        }
      }
    }
  }

  // Cleanup: assign unclaimed cells
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    seeds.forEach(({ r: sr, c: sc }, id) => {
      const d = Math.abs(r-sr)+Math.abs(c-sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    grid[r][c] = best
  }
  return grid
}

const N = 10
const configs = [
  { maxSpan: 2, min: 5, max: 20, label: 'maxSpan=2 BFS' },
  { maxSpan: 3, min: 5, max: 20, label: 'maxSpan=3 BFS' },
  { maxSpan: 4, min: 5, max: 15, label: 'maxSpan=4 BFS max15' },
  { maxSpan: 3, min: 5, max: 15, label: 'maxSpan=3 BFS max15' },
]

for (const { maxSpan, min, max, label } of configs) {
  let total = 0
  let solvableByLevel = []
  for (let level = 1; level <= 5; level++) {
    let solvable = 0
    const BASE = level * 100003 + 17
    for (let attempt = 0; attempt < 200; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const grid = growRegionsNarrow(N, solution, rng, maxSpan, min, max)
      if (canSolveLogically(grid, N)) solvable++
    }
    solvableByLevel.push(solvable)
    total += solvable
  }
  console.log(`${label}: ${total}/1000 (${(total/10).toFixed(1)}%) [${solvableByLevel.join(',')}] ${total>=500?'✓':''}`)
}

// Debug one instance with maxSpan=3
{
  const rng = makeRng(100003 + 17)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  const grid = growRegionsNarrow(N, solution, rng, 3, 5, 20)
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)
  console.log('\nmaxSpan=3 Debug Level 1 attempt 0:')
  cands.forEach((cs, id) => {
    const rows = [...new Set(cs.map(ROW))].sort((a,b)=>a-b)
    const cols = [...new Set(cs.map(COL))].sort((a,b)=>a-b)
    console.log(`  Reg ${id}: ${cs.length} cells, rows=${rows.length}/${JSON.stringify(rows)}, cols=${cols.length}/${JSON.stringify(cols)}`)
  })
}
