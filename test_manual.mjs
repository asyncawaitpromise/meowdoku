// Test: manually create a clearly solvable puzzle
// Cats: one per row 0-9, one per col 0-9
// Simple arrangement: cat i at (i, i) — but this would have diagonal adjacency!
// Let's use: cat i at (i, (i*3) % 10) — no adjacency guaranteed...

// Actually, let's use a known-valid placement from findPlacement
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

const N = 10
const rng = makeRng(12345)
const catCols = findPlacement(N, rng)
const cats = catCols.map((c, r) => ({ r, c }))
console.log('Cats:', cats.map(c => `(${c.r},${c.c})`).join(' '))

// Create a VERY simple solvable puzzle:
// Each region = exactly the cells in its cat's ROW and CAT's COLUMN
// i.e., an L-shape or cross that uniquely identifies the cat position

// Even simpler: each region = its cat's entire row
// (gives 10 equal regions of size 10, each in 1 row)
const gridStripes = Array.from({ length: N }, () => Array(N).fill(-1))
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) gridStripes[r][c] = r

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
  const finalSizes = cands.map((c,i) => `${i}:${c.length}`)
  console.log('Final sizes:', finalSizes.join(' '))
  return cands.every(c => c.length === 1)
}

console.log('\n1. Horizontal stripes (region i = all of row i):')
console.log('Solvable:', canSolveLogically(gridStripes, N))

// Create a puzzle where each region has only 1 possible column (the cat's column)
// Region i = column i (vertical stripe) → region i's cat at (catRow[i], i)
// catRow[i] = the row where cat is in column i
const colToRow = {}
cats.forEach(({ r, c }) => { colToRow[c] = r })
const gridVertStripes = Array.from({ length: N }, () => Array(N).fill(-1))
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) gridVertStripes[r][c] = c  // region = column

console.log('\n2. Vertical stripes (region i = all of col i):')
console.log('Solvable:', canSolveLogically(gridVertStripes, N))

// Create a puzzle where each region = single cell (the cat's cell)
// But then most of the grid is unassigned... 
// Actually: use L-shape: cat's row AND cat's column together
const gridLshape = Array.from({ length: N }, () => Array(N).fill(-1))
cats.forEach(({ r: cr, c: cc }, id) => {
  // Claim entire row and column for this region, but only if not yet claimed
  for (let c = 0; c < N; c++) if (gridLshape[cr][c] === -1) gridLshape[cr][c] = id
  for (let r = 0; r < N; r++) if (gridLshape[r][cc] === -1) gridLshape[r][cc] = id
})
// Fill remaining cells by nearest cat
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  if (gridLshape[r][c] !== -1) continue
  let best = -1, bestDist = Infinity
  cats.forEach(({ r: cr, c: cc }, id) => {
    const d = Math.abs(r - cr) + Math.abs(c - cc); if (d < bestDist) { bestDist = d; best = id }
  })
  gridLshape[r][c] = best
}

console.log('\n3. L-shape regions (cat row + cat col):')
console.log('Solvable:', canSolveLogically(gridLshape, N))
