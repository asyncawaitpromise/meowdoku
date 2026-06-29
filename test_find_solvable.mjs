// Find an actually logically solvable puzzle by trying many more configurations
// Use a different region generator that creates more constrained regions

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

// New approach: "paired BFS" - pair cats by proximity (adjacent rows),
// each pair forms a "zone" that occupies approximately 2 rows × N cols.
// Within that zone, BFS from each cat creates 2 connected regions.
// Key: by keeping regions within their zone, they automatically form naked row pairs.

function growRegionsPaired(N, seeds, rng) {
  // Sort seeds by row to pair adjacent rows
  // Pair: (row 0's cat, row 1's cat), (row 2's cat, row 3's cat), etc.
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]

  // For each pair of adjacent rows, grow BOTH regions ONLY within those 2 rows
  // This guarantees naked row pairs.
  for (let band = 0; band < N/2; band++) {
    const r0 = band * 2
    const r1 = band * 2 + 1
    const reg0 = r0  // region ID = row index
    const reg1 = r1

    // Find cat cols for this band (cat for region r is in row r)
    const c0 = seeds[r0].c
    const c1 = seeds[r1].c

    // Initialize seeds
    grid[r0][c0] = reg0
    grid[r1][c1] = reg1

    // BFS within only rows r0 and r1
    const q0 = [{ r: r0, c: c0 }]
    const q1 = [{ r: r1, c: c1 }]

    // Fill the 2-row band: alternate growing reg0 and reg1
    // until all cells in the band are claimed
    const bandCells = 2 * N  // total cells in this band
    let filled = 2  // 2 seeds placed

    let q0idx = 0, q1idx = 0
    while (filled < bandCells) {
      // Try to grow reg0
      let grew = false
      while (q0idx < q0.length) {
        const { r, c } = q0[q0idx]
        const dirs = shuffle([...DIRS], rng)
        let found = false
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc
          if ((nr === r0 || nr === r1) && nc >= 0 && nc < N && grid[nr][nc] === -1) {
            grid[nr][nc] = reg0
            q0.push({ r: nr, c: nc })
            filled++
            grew = true
            found = true
            break
          }
        }
        if (found) break
        q0idx++
      }

      // Try to grow reg1
      while (q1idx < q1.length) {
        const { r, c } = q1[q1idx]
        const dirs = shuffle([...DIRS], rng)
        let found = false
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc
          if ((nr === r0 || nr === r1) && nc >= 0 && nc < N && grid[nr][nc] === -1) {
            grid[nr][nc] = reg1
            q1.push({ r: nr, c: nc })
            filled++
            found = true
            break
          }
        }
        if (found) break
        q1idx++
      }

      // If neither grew, we're stuck (shouldn't happen)
      if (!grew && q1idx >= q1.length && q0idx >= q0.length) break
    }

    // Fill any remaining unclaimed cells in this band
    for (let c = 0; c < N; c++) {
      for (const r of [r0, r1]) {
        if (grid[r][c] !== -1) continue
        // Assign to nearest region by Manhattan distance
        const d0 = Math.abs(r - r0) + Math.abs(c - c0)
        const d1 = Math.abs(r - r1) + Math.abs(c - c1)
        grid[r][c] = d0 <= d1 ? reg0 : reg1
      }
    }
  }

  return grid
}

const N = 10

// Test the paired BFS approach
let totalSolvable = 0
for (let level = 1; level <= 5; level++) {
  let solvable = 0
  const BASE = level * 100003 + 17
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const grid = growRegionsPaired(N, solution, rng)
    if (canSolveLogically(grid, N)) solvable++
  }
  console.log(`Paired Level ${level}: ${solvable}/200 (${(solvable/2).toFixed(1)}%)`)
  totalSolvable += solvable
}
console.log(`Paired Total: ${totalSolvable}/1000 (${(totalSolvable/10).toFixed(1)}%)`)

// Debug one instance
console.log('\n--- Debug Level 1 attempt 0 ---')
{
  const rng = makeRng(100003 + 17)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  console.log('Cats:', solution.map(s => `(${s.r},${s.c})`).join(' '))
  const grid = growRegionsPaired(N, solution, rng)
  console.log('Grid:')
  for (let r = 0; r < N; r++) console.log(grid[r].map(v => v.toString().padStart(2)).join(' '))
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)
  console.log('\nRegion row/col spans:')
  cands.forEach((cs, id) => {
    const rows = [...new Set(cs.map(ROW))].sort((a,b)=>a-b)
    const cols = [...new Set(cs.map(COL))].sort((a,b)=>a-b)
    console.log(`  Reg ${id}: ${cs.length} cells, rows=${JSON.stringify(rows)}, cols=${JSON.stringify(cols)}`)
  })
  console.log('Solvable:', canSolveLogically(grid, N))
}
