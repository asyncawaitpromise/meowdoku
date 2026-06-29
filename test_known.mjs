// Test: create a known-solvable puzzle manually (N=4 for simplicity, but let's do N=4)
// Then see if solver solves it

function canSolveLogically(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[regions[r][c]].push(r*N+c)
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
  
  let anyChange = true, iter = 0
  while (anyChange) {
    anyChange = false; iter++
    
    // 1. Singleton
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
        if (cands[other].length < before) { anyChange = true; console.log(`  Iter ${iter}: singleton reg ${reg} at (${cr},${cc}) elim ${before-cands[other].length} from ${other}`) }
      }
    }
    
    // 1b. Hidden single row/col
    const rowSpan = cands.map(cs => new Set(cs.map(ROW)))
    const colSpan = cands.map(cs => new Set(cs.map(COL)))
    const regsInRow = Array.from({ length: N }, () => [])
    const regsInCol = Array.from({ length: N }, () => [])
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length <= 1) continue
      for (const r of rowSpan[reg]) regsInRow[r].push(reg)
      for (const c of colSpan[reg]) regsInCol[c].push(reg)
    }
    for (let a = 0; a < N; a++) {
      if (regsInRow[a].length === 1) {
        const [reg] = regsInRow[a]
        const outside = cands[reg].filter(cell => ROW(cell) !== a)
        if (outside.length > 0) {
          console.log(`  Iter ${iter}: hidden row single: row ${a} only has reg ${reg}, elim ${outside.length} outside cells`)
          cands[reg] = cands[reg].filter(cell => ROW(cell) === a)
          anyChange = true
        }
      }
      if (regsInCol[a].length === 1) {
        const [reg] = regsInCol[a]
        const outside = cands[reg].filter(cell => COL(cell) !== a)
        if (outside.length > 0) {
          console.log(`  Iter ${iter}: hidden col single: col ${a} only has reg ${reg}, elim ${outside.length} outside cells`)
          cands[reg] = cands[reg].filter(cell => COL(cell) === a)
          anyChange = true
        }
      }
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
              if (cands[other].length < before) { anyChange = true; console.log(`  Iter ${iter}: naked pair ${axis===0?'row':'col'} [${[...union2]}] from regs ${unplaced[i]},${unplaced[j]} elim ${before-cands[other].length} from ${other}`) }
            }
          }
        }
      }
    }
  }
  console.log('Final cand sizes:', cands.map((c,i) => `${i}:${c.length}`).join(' '))
  return cands.every(c => c.length === 1)
}

// N=4 example:
// Solution: cats at (0,2),(1,0),(2,3),(3,1)
// Regions designed to be solvable:
// Region 0: (0,2),(0,3) — only 2 cells
// Region 1: (1,0),(1,1),(2,0),(3,0) — L-shape
// Region 2: (0,0),(0,1),(2,1),(2,2) — other L-shape  
// Region 3: (1,2),(1,3),(2,3),(3,1),(3,2),(3,3) — bottom right

const N = 4
const regions4 = [
  [2, 2, 0, 0],
  [1, 1, 3, 3],
  [1, 2, 2, 3],
  [1, 3, 3, 3]
]

console.log('N=4 test:')
console.log('Solvable:', canSolveLogically(regions4, N))

// Simpler N=4: 
// Region 0: cols 0,1 → row 0 only (just 2 cells)
// Region 1: cols 2,3 → rows 0,1
// Region 2: cols 0,1 → rows 1,2,3 (left half minus top)  
// Region 3: cols 2,3 → rows 2,3 (bottom right)
const r2 = [
  [0, 0, 1, 1],
  [2, 2, 1, 1],
  [2, 2, 3, 3],
  [2, 2, 3, 3]
]
console.log('\nN=4 test 2 (2-col bands):')
console.log('Solvable:', canSolveLogically(r2, N))

// Test where region has 1 cell in unique row+col:
// Cat at (0,2): region 0 = cells (0,2) only → SINGLETON!
// Cat at (1,0): region 1 = cells in row 1 only
// etc.
const r3 = [
  [1, 1, 0, 1],  // row 0: reg 0 has 1 cell at (0,2)!
  [1, 1, 1, 1],  // row 1: all reg 1
  [2, 2, 2, 3],  // row 2
  [2, 2, 3, 3]   // row 3
]
console.log('\nN=4 test 3 (singleton region):')
console.log('Cats: (0,2),(1,0),(2,3),(3,1)') // cat in reg 0 must be at (0,2)
console.log('Solvable:', canSolveLogically(r3, N))
