// Test different singleton selection strategies for solvability

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

// ORIGINAL BFS: simple randomized BFS from all seeds simultaneously
function growOriginalBFS(N, seeds, rng, singletonIds) {
  const isSingleton = new Set(singletonIds)
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  
  // Plant singletons first
  seeds.forEach(({ r, c }, id) => { if (isSingleton.has(id)) grid[r][c] = id })
  
  // BFS queue for large regions
  const queue = []
  seeds.forEach(({ r, c }, id) => {
    if (!isSingleton.has(id)) { grid[r][c] = id; queue.push({ r, c, id }) }
  })
  
  while (queue.length > 0) {
    const idx = Math.floor(rng() * queue.length)
    const { r, c, id } = queue[idx]
    queue.splice(idx, 1)
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id
        queue.push({ r: nr, c: nc, id })
      }
    }
  }
  
  // Phase 3: assign leftover cells
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      seeds.forEach(({ r: sr, c: sc }, id) => {
        if (isSingleton.has(id)) return
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
const ATTEMPTS = 30

// Strategy: N singletons from sortedByRow at given indices
function testStrategy(name, singletonIndices, levels = [1,2,3,4,5]) {
  let totalSolvable = 0, totalAttempts = 0
  for (const levelNum of levels) {
    let solvable = 0
    const BASE = levelNum * 100003 + 17
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      
      // Pick singletons by sorted-by-row index
      const sortedByRow = solution.map((s, id) => ({ id, row: s.r })).sort((a,b)=>a.row-b.row)
      const singletonIds = singletonIndices.map(i => sortedByRow[i].id)
      
      const regions = growOriginalBFS(N, solution, rng, singletonIds)
      if (canSolveLogically(regions, N)) solvable++
    }
    totalSolvable += solvable
    totalAttempts += ATTEMPTS
  }
  const rate = totalSolvable / totalAttempts
  console.log(`${name}: ${totalSolvable}/${totalAttempts} = ${(rate*100).toFixed(1)}% ${rate >= 0.30 ? 'PASS' : 'fail'}`)
}

// Test various singleton selection strategies
console.log('Testing strategies with original BFS + singleton classification:\n')

// Original (broken): 6 singletons + 3 small + 1 large
testStrategy('6 singletons [0,1,2,3,4,5] (original)', [0,1,2,3,4,5])

// Proposed: 4 singletons, spread
testStrategy('4 singletons [0,2,5,7]', [0,2,5,7])
testStrategy('4 singletons [0,3,6,9]', [0,3,6,9])
testStrategy('4 singletons [1,3,6,8]', [1,3,6,8])
testStrategy('4 singletons [0,2,6,8]', [0,2,6,8])
testStrategy('4 singletons [0,3,5,8]', [0,3,5,8])

// 5 singletons
testStrategy('5 singletons [0,2,4,6,8]', [0,2,4,6,8])
testStrategy('5 singletons [0,2,5,7,9]', [0,2,5,7,9])
testStrategy('5 singletons [0,2,4,7,9]', [0,2,4,7,9])

// Even more
testStrategy('6 singletons [0,2,4,5,7,9]', [0,2,4,5,7,9])
testStrategy('7 singletons [0,1,3,5,7,8,9]', [0,1,3,5,7,8,9])
