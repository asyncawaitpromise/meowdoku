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
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
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

function growRegions(N, seeds, rng, singletonRowIndices, smallRowIndices) {
  // singletonRowIndices: indices into sortedByRow that are singletons
  // smallRowIndices: indices into sortedByRow that are 2-cell horizontal
  const sortedByRow = seeds.map((s, id) => ({ id, row: s.r })).sort((a,b)=>a.row-b.row)
  const isSingleton = new Set(singletonRowIndices.map(i => sortedByRow[i].id))
  const isSmall = new Set(smallRowIndices.map(i => sortedByRow[i].id))
  
  const HDIRS = [[0,-1],[0,1]]
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })
  
  for (const id of isSmall) {
    const { r: sr, c: sc } = seeds[id]
    let grew = false
    for (const [, dc] of shuffle([...HDIRS], rng)) {
      const nc = sc + dc
      if (nc >= 0 && nc < N && grid[sr][nc] === -1) { grid[sr][nc] = id; grew = true; break }
    }
    if (!grew) {
      for (const [dr, dc] of shuffle([...DIRS], rng)) {
        const nr = sr + dr, nc = sc + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) { grid[nr][nc] = id; break }
      }
    }
  }
  
  const queue = []
  seeds.forEach((s, id) => {
    if (!isSingleton.has(id) && !isSmall.has(id)) queue.push({ ...s, id })
  })
  for (let qi = 0; qi < queue.length; qi++) {
    const { r, c, id } = queue[qi]
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; queue.push({ r: nr, c: nc, id })
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
      if (best === -1) seeds.forEach(({ r: sr, c: sc }, id) => {
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      })
      grid[r][c] = best
    }
  }
  return grid
}

function canSolveLogically(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)
  const ROW = (cell) => Math.floor(cell / N)
  const COL = (cell) => cell % N
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
          return r2 !== cr && c2 !== cc && !(Math.abs(r2-cr)<=1 && Math.abs(c2-cc)<=1)
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
          for (let k = j + 1; k < unplaced.length; k++) {
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
        for (let b = a + 1; b < N; b++) {
          const pair = [...new Set([...regsInAxis[a], ...regsInAxis[b]])]
          if (pair.length === 2) {
            const axisSet2 = new Set([a, b])
            for (const reg of pair) {
              const before = cands[reg].length
              cands[reg] = cands[reg].filter(cell => axisSet2.has(axisOf(cell)))
              if (cands[reg].length < before) anyChange = true
            }
          }
          for (let c = b + 1; c < N; c++) {
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
const TOTAL = 500

function test(label, singIdx, smallIdx) {
  let solvable = 0
  for (let levelNum = 1; levelNum <= 5; levelNum++) {
    const BASE = levelNum * 100003 + 17
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const regions = growRegions(N, solution, rng, singIdx, smallIdx)
      if (canSolveLogically(regions, N)) solvable++
    }
  }
  const rate = solvable / TOTAL
  console.log(`${label}: ${solvable}/${TOTAL} = ${(rate*100).toFixed(1)}% ${rate >= 0.30 ? 'PASS' : 'fail'}`)
}

// All indices: 0-9, choose 4 singletons from sorted-by-row, remaining 5 are small, 1 is large
// Try different positions for singletons
console.log('4 singletons + 5×2cell + 1 large BFS:\n')
test('sing=[0,1,2,3] sm=[4,5,6,7,8]', [0,1,2,3], [4,5,6,7,8])  // first 4 rows as singletons
test('sing=[6,7,8,9] sm=[0,1,2,3,4]', [6,7,8,9], [0,1,2,3,4])  // last 4 rows as singletons
test('sing=[0,1,8,9] sm=[2,3,4,5,6]', [0,1,8,9], [2,3,4,5,6])  // top 2 + bottom 2
test('sing=[2,3,4,5] sm=[0,1,6,7,8]', [2,3,4,5], [0,1,6,7,8])  // middle 4
test('sing=[0,3,5,8] sm=[1,2,4,6,7]', [0,3,5,8], [1,2,4,6,7])  // spread
test('sing=[1,2,7,8] sm=[0,3,4,5,6]', [1,2,7,8], [0,3,4,5,6])  // near-top + near-bottom
test('sing=[0,2,7,9] sm=[1,3,4,5,6]', [0,2,7,9], [1,3,4,5,6])

// What about 5S + 4×2cell + 1BFS?
console.log('\n5 singletons + 4×2cell + 1 large BFS:\n')
test('5S top: sing=[0,1,2,3,4] sm=[5,6,7,8]', [0,1,2,3,4], [5,6,7,8])
test('5S bot: sing=[5,6,7,8,9] sm=[0,1,2,3]', [5,6,7,8,9], [0,1,2,3])
test('5S mid: sing=[2,3,4,5,6] sm=[0,1,7,8]', [2,3,4,5,6], [0,1,7,8])
test('5S alt: sing=[0,2,4,6,8] sm=[1,3,5,7]', [0,2,4,6,8], [1,3,5,7])
test('5S: sing=[0,1,2,3,5] sm=[4,6,7,8,9]', [0,1,2,3,5], [4,6,7,8,9])
test('5S: sing=[0,1,2,4,6] sm=[3,5,7,8,9]', [0,1,2,4,6], [3,5,7,8,9])

// Test original BFS (no singletons, no classification)
console.log('\nOriginal BFS (all 10 regions grow via randomized BFS):')
{
  let solvable = 0
  for (let levelNum = 1; levelNum <= 5; levelNum++) {
    const BASE = levelNum * 100003 + 17
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const grid = Array.from({ length: N }, () => Array(N).fill(-1))
      const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
      const queue = []
      solution.forEach(({ r, c }, id) => { grid[r][c] = id; queue.push({ r, c, id }) })
      for (let qi = 0; qi < queue.length; qi++) {
        const { r, c, id } = queue[qi]
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
            grid[nr][nc] = id; queue.push({ r: nr, c: nc, id })
          }
        }
      }
      if (canSolveLogically(grid, N)) solvable++
    }
  }
  console.log(`Original: ${solvable}/500 = ${(solvable/5).toFixed(1)}%`)
}

// Test 4S + 6×2cell (no BFS)
console.log('\n4 singletons + 6×2cell horizontal (no BFS):')
{
  let solvable = 0
  for (let levelNum = 1; levelNum <= 5; levelNum++) {
    const BASE = levelNum * 100003 + 17
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const regions = growRegions(N, solution, rng, [0,1,2,3], [4,5,6,7,8,9])
      if (canSolveLogically(regions, N)) solvable++
    }
  }
  console.log(`4S + 6×2cell: ${solvable}/500 = ${(solvable/5).toFixed(1)}%`)
}

// Test various k-singletons + rest-2cell
for (const [ns, sm] of [
  [3, [3,4,5,6,7,8,9]],  // 3 singletons + 7×2cell
  [4, [4,5,6,7,8,9]],    // 4 singletons + 6×2cell  
  [5, [5,6,7,8,9]],      // 5 singletons + 5×2cell
  [6, [6,7,8,9]],        // 6 singletons + 4×2cell
]) {
  let solvable = 0
  const singIdx = Array.from({length: ns}, (_, i) => i)
  for (let levelNum = 1; levelNum <= 5; levelNum++) {
    const BASE = levelNum * 100003 + 17
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const regions = growRegions(N, solution, rng, singIdx, sm)
      if (canSolveLogically(regions, N)) solvable++
    }
  }
  console.log(`${ns}S + ${sm.length}×2cell + 0BFS: ${solvable}/500 = ${(solvable/5).toFixed(1)}%`)
}
