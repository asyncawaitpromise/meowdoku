// Debug: col strip regions - trace what happens in solver

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

function makeColStripRegions(N, catCols) {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  for (let k = 0; k < N/2; k++) {
    const stripCols = [2*k, 2*k+1]
    const stripRows = []
    for (let r = 0; r < N; r++) {
      if (catCols[r] === 2*k || catCols[r] === 2*k+1) stripRows.push(r)
    }
    stripRows.sort((a, b) => a - b)
    const [r_a, r_b] = stripRows
    for (let r = 0; r < N; r++) {
      for (const c of stripCols) {
        grid[r][c] = r < r_b ? r_a : r_b
      }
    }
  }
  return grid
}

const N = 10
const rng = makeRng(100003 + 17)
const catCols = findPlacement(N, rng)
console.log('Cat cols:', catCols)
const grid = makeColStripRegions(N, catCols)

// Print grid
console.log('\nGrid:')
for (let r = 0; r < N; r++) {
  console.log(grid[r].map(v => v.toString().padStart(2)).join(' '))
}

const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
const cands = Array.from({ length: N }, () => [])
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)

console.log('\nRegion candidates:')
cands.forEach((cs, id) => {
  const rows = [...new Set(cs.map(ROW))].sort((a,b)=>a-b)
  const cols = [...new Set(cs.map(COL))].sort((a,b)=>a-b)
  console.log(`  Reg ${id}: ${cs.length} cells, rows=${JSON.stringify(rows)}, cols=${JSON.stringify(cols)}`)
})

// Run one pass of solver to see what fires
console.log('\n--- Solver pass ---')
const colSpan = cands.map(cs => new Set(cs.map(COL)))
const regsInCol = Array.from({ length: N }, () => [])
for (let reg = 0; reg < N; reg++) {
  if (cands[reg].length <= 1) continue
  for (const c of colSpan[reg]) regsInCol[c].push(reg)
}

console.log('regsInCol (for col pairs):')
for (let c = 0; c < N; c++) {
  console.log(`  Col ${c}: regs=${JSON.stringify(regsInCol[c])}`)
}

// Check for naked col pairs
const unplaced = Array.from({ length: N }, (_, i) => i)
for (let i = 0; i < unplaced.length; i++) {
  for (let j = i+1; j < unplaced.length; j++) {
    const union2 = new Set([...colSpan[unplaced[i]], ...colSpan[unplaced[j]]])
    if (union2.size === 2) {
      console.log(`Naked col pair: regs ${unplaced[i]}+${unplaced[j]} confined to cols ${[...union2]}`)
    }
  }
}
