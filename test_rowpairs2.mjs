// Test: strict 2-row-per-pair regions + trace solver
// Each pair of adjacent rows (0,1), (2,3), (4,5), (6,7), (8,9) gets 2 regions.
// Each region covers ALL cells in its pair's 2 rows (split vertically between the 2 regions).
// The split: cells with col <= split_col go to region with lower cat col, rest to other.

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

// Region for cat at row r is region r.
// Pair: rows (2k, 2k+1). Cats at (2k, c_a) and (2k+1, c_b).
// Region 2k: covers rows {2k, 2k+1} × {cols left of split}
// Region 2k+1: covers rows {2k, 2k+1} × {cols right of split}
// Split: median of c_a and c_b
// We must ensure cat's cell is in its own region.
function makeRowPairRegions(N, catCols) {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  for (let band = 0; band < N/2; band++) {
    const r0 = band * 2, r1 = band * 2 + 1
    const c0 = catCols[r0], c1 = catCols[r1]  // cat cols for the two rows
    // We need cat at (r0, c0) to be in region r0, cat at (r1, c1) in region r1.
    // Split at: some column boundary. Simplest: c0 < c1? Then cols 0..c1-1 → r0, cols c1..N-1 → r1.
    // But we need (r0, c0) in region r0: c0 must be in "left" part.
    // And (r1, c1) in region r1: c1 must be in "right" part.
    let splitCol  // cols 0..splitCol → region r0, cols splitCol+1..N-1 → region r1
    if (c0 < c1) {
      // c0 left of c1: split anywhere between c0 and c1
      splitCol = Math.floor((c0 + c1) / 2)
      // Verify: c0 <= splitCol (in r0) and c1 > splitCol (in r1)
      if (c0 > splitCol || c1 <= splitCol) {
        splitCol = c0  // fallback: everything up to c0 in r0
      }
    } else {
      // c0 right of c1: split so c1 is left, c0 is right → but we want c0 in r0!
      // Use: cols {c1..c0-1} → r1, cols {c0..N-1} ∪ {0..c1-1} → r0? No, must be contiguous.
      // Simple fix: cols 0..c0-1 → r1 (region r1 contains c1 which is < c0), cols c0..N-1 → r0
      splitCol = c0 - 1  // cols 0..c0-1 → r1, cols c0..N-1 → r0
      // r0 gets cols c0..N-1: c0 is included ✓
      // r1 gets cols 0..c0-1: c1 < c0 is included ✓
      // BUT: need to distinguish which col subset goes where.
      // Let me use a different scheme:
    }
    // Simpler scheme: assign based on distance to each cat's column
    for (let r = r0; r <= r1; r++) {
      for (let c = 0; c < N; c++) {
        const d0 = Math.abs(c - c0), d1 = Math.abs(c - c1)
        if (d0 < d1) grid[r][c] = r0
        else if (d1 < d0) grid[r][c] = r1
        else grid[r][c] = (c <= (c0 + c1) / 2) ? r0 : r1  // tie-break
      }
    }
    // Ensure cats are in correct regions
    // (They should be by Voronoi distance)
  }
  return grid
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

const N = 10

let total = 0
for (let level = 1; level <= 5; level++) {
  let solvable = 0
  const BASE = level * 100003 + 17
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const grid = makeRowPairRegions(N, catCols)
    if (canSolveLogically(grid, N)) solvable++
  }
  console.log(`RowPair Level ${level}: ${solvable}/200 (${(solvable/2).toFixed(1)}%)`)
  total += solvable
}
console.log(`RowPair Total: ${total}/1000 (${(total/10).toFixed(1)}%)`)

// Debug one instance
{
  const rng = makeRng(100003 + 17)
  const catCols = findPlacement(N, rng)
  console.log('\nCat cols:', catCols)
  const grid = makeRowPairRegions(N, catCols)
  console.log('Grid:')
  for (let r = 0; r < N; r++) console.log(grid[r].map(v => v.toString().padStart(2)).join(' '))
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)
  cands.forEach((cs, id) => {
    console.log(`  Reg ${id}: rows=${[...new Set(cs.map(ROW))].sort().join(',')} cols=${[...new Set(cs.map(COL))].sort().join(',')}`)
  })
  console.log('Solvable:', canSolveLogically(grid, N))
}
