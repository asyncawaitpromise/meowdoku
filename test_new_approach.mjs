// Test: row-band region layout
// Divide the 10x10 grid into 5 horizontal bands of 2 rows each.
// findPlacement guarantees exactly 1 cat per row, so each band has exactly 2 cats.
// Assign the 2 cats in a band to 2 different regions.
// Each region covers ALL columns in its band rows, but only its own row within the band.
// This means: region for cat at (r, c) in band [r_lo, r_hi] covers ALL cells of row r.
// So each region has row span = {r} → hidden row single → cascade.
//
// Actually let's try: each region = exactly one row.
// Then check if canSolveLogically works.

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

// Row-based regions: region i covers all cells in row i
function makeRowRegions(N) {
  const grid = Array.from({ length: N }, (_, r) => Array(N).fill(r))
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

// Test 1: pure row-based regions (should always be solvable)
{
  const grid = makeRowRegions(N)
  const rng = makeRng(100003 + 17)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  const solvable = canSolveLogically(grid, N)
  console.log('Pure row regions solvable:', solvable)
}

// Now test: "row-seeded BFS" regions where each region STARTS as a full row,
// then we allow some BFS growth to make them irregular while keeping solvability.
// Actually let's first understand: what row spans do we need?

// Test 2: mixed regions
// 5 "row-pinned" regions: each covers exactly one full row (10 cells)
// 5 "BFS" regions: grown from the remaining cats, filling the rest
// But this doesn't make sense since each region must contain exactly one cat.

// Let me think differently: the regions are assigned to cats. Cat i is in row i.
// If region i covers exactly row i (all 10 cols), then it's a hidden row single.
// The 10 cats are in distinct cols, so after row-confinement, each region has 10 cells
// in 1 row × 10 cols. Then col singletons fire? No, each region spans all 10 cols.
// But naked col pairs: if cat[0] is in col c0 and cat[1] is in col c1, and
// their regions (row 0 and row 1) happen to span {c0, c1} after elimination...
// Wait, with full-row regions, after row-confinement each still has all 10 cols.
// Then naked col pair needs two regions confined to the same 2 cols. That won't happen
// unless the adjacent cats eliminate enough.

// Let's trace: after region r confined to row r, each has 10 candidates (row r, col 0-9).
// Singleton propagation: no singletons yet.
// Naked row pair: region 0 (row 0) + region 1 (row 1) → spans {0,1} size 2 → naked pair!
// But... all 10 regions are in different rows, and naked pairs just tell us those 2 rows
// are occupied by those 2 regions. Other regions are already NOT in those rows.
// So naked row pairs don't eliminate anything new.

// Hidden col singles: col c has candidates from exactly 1 region?
// After row confinement, every col 0-9 has candidates from ALL 10 regions.
// So no hidden col singles either.

// Hmm. Pure row regions might NOT be solvable by this solver.
// Let me verify by actually running it.

// Actually wait - I need to re-read: region assignment. With pure row regions,
// region 0 = all cells (0, *), region 1 = all cells (1, *), etc.
// Cat for region 0 is at (0, c0). Cat for region r is at (r, cr).
// Solver initial cands: cands[r] = all cells in row r = [(r,0), (r,1), ..., (r,9)]
// That's already row-confined, so hidden row single is trivially done.
// But then each region has 10 candidates in 1 row × 10 cols.
// Adjacent cell elimination: cat of region r is somewhere in row r. For other regions,
// we need to eliminate cells adjacent to (r, cr). But we don't know cr yet.
// Naked row pair (regs 0 and 1 both in rows {0} and {1} = size 2 pair):
// → eliminate other regions from rows 0 and 1. But other regions are already not there.
// So indeed, naked row pairs don't help.
// What helps? We need column constraint. With full-row regions, we have no column constraint.

console.log('\n--- Checking pure row regions step by step ---')
{
  const N = 10
  const grid = makeRowRegions(N)
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)
  console.log('Initial cand counts:', cands.map((c,i) => `${i}:${c.length}`).join(' '))
  // After one pass:
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
  const colSpan = cands.map(cs => new Set(cs.map(COL)))
  const regsInCol = Array.from({ length: N }, () => [])
  for (let reg = 0; reg < N; reg++) for (const c of colSpan[reg]) regsInCol[c].push(reg)
  console.log('regsInCol[0]:', regsInCol[0], '(all regions span all cols)')
  console.log('→ Pure row regions: no column constraint → NOT solvable by this solver')
}

// So we need regions that are BOTH row-constrained AND col-constrained.
// What if regions are L-shaped or cross-shaped?

// Let's try: each region = cat's cell + a few neighbors, all in the same row AND col.
// E.g., region for cat at (r, c) = cells in row r near c, plus cells in col c near r.
// This gives a "cross" shape confined to row r ∪ col c.

// Better: for each cat at (r, c), make its region span a SMALL subset of rows and cols.
// If region spans rows {r-1, r, r+1} ∩ [0,9] and cols {c-1, c, c+1} ∩ [0,9]:
// That's a 3×3 block (up to 9 cells). Row span = {r-1,r,r+1}, col span = {c-1,c,c+1}.
// If no other region has the same row or col configuration, then no naked pairs form easily.

// Let me try: define regions as 2-column vertical strips.
// 5 pairs of adjacent columns: (0,1), (2,3), (4,5), (6,7), (8,9)
// Each pair of columns has 20 cells (10 rows × 2 cols).
// Each pair is split into 2 regions based on which cat falls in that column pair.
// Cat at (r, c) goes to the pair containing c.
// But we have 10 cats in 10 cols, so each 2-col pair contains exactly 2 cats.
// For the pair (2k, 2k+1), the 2 cats are at rows r_a, r_b (r_a < r_b).
// Region for cat at r_a: rows 0..r_b-1 × cols {2k, 2k+1} (top portion)
// Region for cat at r_b: rows r_b..9 × cols {2k, 2k+1} (bottom portion)
// Wait, that's not connected necessarily.
// Simpler: region for cat at r_a: top half of the strip, r_b: bottom half.

// Actually, column-strip regions would give col span = {2k, 2k+1} for all regions in that strip.
// So naked col pair: regs in cols {2k, 2k+1} form a naked col pair → eliminate other regs from those 2 cols.
// After 5 naked col pairs fire: each region's candidates are confined to 2 cols.
// Then each region has candidates in 2 cols × ~5 rows. Now naked row pairs etc. can fire.

// Let's test this!
function makeColStripRegions(N, catCols) {
  // catCols[r] = column of cat in row r
  // We have N cats, all in different rows and cols.
  // Pair columns: (0,1), (2,3), ..., (8,9)
  // For each col pair (2k, 2k+1), find the 2 rows whose cats are in those cols.
  // Assign the row with smaller row index to "top" region, larger to "bottom" region.
  // Top region: rows 0 to midRow-1, cols 2k to 2k+1 (connected if mid makes sense)
  // But this may not create connected regions easily.
  // Simpler: just divide the strip at the midpoint between the two cats' rows.

  const grid = Array.from({ length: N }, () => Array(N).fill(-1))

  // Region ID assignment: for strip k (cols 2k, 2k+1), the cats are in rows r_a < r_b.
  // We assign region IDs so cat in row r gets region r (to match solution indexing).

  for (let k = 0; k < N/2; k++) {
    const stripCols = [2*k, 2*k+1]
    // Find which rows have cats in these cols
    const stripRows = []
    for (let r = 0; r < N; r++) {
      if (catCols[r] === 2*k || catCols[r] === 2*k+1) stripRows.push(r)
    }
    stripRows.sort((a, b) => a - b)
    const [r_a, r_b] = stripRows
    // region r_a: top part of strip (rows 0..r_b-1)
    // region r_b: bottom part (rows r_b..N-1)
    // Actually let's split at row r_b: rows < r_b → region r_a, rows >= r_b → region r_b
    // Wait, we need cat r_a to be in region r_a, and cat r_b in region r_b.
    // Cat r_a is at (r_a, catCols[r_a]) which is in strip k. r_a < r_b.
    // If we assign rows 0..r_b-1 of the strip to region r_a and rows r_b..N-1 to region r_b:
    // - Cat r_a (row r_a < r_b) → region r_a ✓
    // - Cat r_b (row r_b) → region r_b ✓
    for (let r = 0; r < N; r++) {
      for (const c of stripCols) {
        grid[r][c] = r < r_b ? r_a : r_b
      }
    }
  }

  return grid
}

{
  let totalSolvable = 0
  for (let level = 1; level <= 5; level++) {
    let solvable = 0
    const BASE = level * 100003 + 17
    for (let attempt = 0; attempt < 200; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const grid = makeColStripRegions(N, catCols)
      if (canSolveLogically(grid, N)) solvable++
    }
    console.log(`ColStrip Level ${level}: ${solvable}/200 (${(solvable/2).toFixed(1)}%)`)
    totalSolvable += solvable
  }
  console.log(`ColStrip Total: ${totalSolvable}/1000 (${(totalSolvable/10).toFixed(1)}%)`)
}
