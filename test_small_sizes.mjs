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

// Grow small regions to exactly `smallSize` cells using horizontal-first BFS
function growWithSmallSize(N, seeds, rng, NSingleton, NSmall, smallSize) {
  const sortedByRow = seeds.map((s, id) => ({ id, row: s.r })).sort((a,b)=>a.row-b.row)
  const isSingleton = new Set()
  const isSmall = new Set()
  sortedByRow.forEach(({id}, idx) => {
    if (idx < NSingleton) isSingleton.add(id)
    else if (idx < NSingleton + NSmall) isSmall.add(id)
  })
  
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })
  
  // Phase 1: small regions – grow to exactly smallSize cells using BFS
  for (const id of isSmall) {
    const { r: sr, c: sc } = seeds[id]
    const q = [{r: sr, c: sc}]
    let count = 1
    for (let qi = 0; qi < q.length && count < smallSize; qi++) {
      const {r, c} = q[qi]
      for (const [dr, dc] of shuffle([...DIRS], rng)) {
        if (count >= smallSize) break
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; count++; q.push({r: nr, c: nc})
        }
      }
    }
  }
  
  // Phase 2: large regions BFS
  const queue = []
  seeds.forEach((s, id) => {
    if (!isSingleton.has(id) && !isSmall.has(id)) queue.push({ ...s, id })
  })
  for (let qi = 0; qi < queue.length; qi++) {
    const { r, c, id } = queue[qi]
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; queue.push({ r: nr, c: nc, id })
      }
    }
  }
  
  // Phase 3: leftover
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
const TOTAL_ATTEMPTS = 500

function test(NSingleton, NSmall, smallSize) {
  let solvable = 0
  let firstSizes = null
  for (let levelNum = 1; levelNum <= 5; levelNum++) {
    const BASE = levelNum * 100003 + 17
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const regions = growWithSmallSize(N, solution, rng, NSingleton, NSmall, smallSize)
      if (levelNum === 1 && attempt === 0) {
        const sz = Array(N).fill(0)
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sz[regions[r][c]]++
        firstSizes = sz
      }
      if (canSolveLogically(regions, N)) solvable++
    }
  }
  const rate = solvable / TOTAL_ATTEMPTS
  const NLarge = N - NSingleton - NSmall
  const avgLargeSize = NLarge > 0 ? ((N*N - NSingleton - NSmall*smallSize) / NLarge).toFixed(1) : '-'
  console.log(`${NSingleton}S + ${NSmall}×${smallSize}cell + ${NLarge}BFS(~${avgLargeSize}): ${solvable}/${TOTAL_ATTEMPTS} = ${(rate*100).toFixed(1)}% ${rate >= 0.30 ? 'PASS' : 'fail'} sizes:[${firstSizes.join(',')}]`)
}

console.log('Testing different small-region sizes (NSingleton=4):\n')
test(4, 5, 2)  // 4S + 5×2 + 1BFS(86)
test(4, 5, 3)  // 4S + 5×3 + 1BFS(81)
test(4, 5, 4)  // 4S + 5×4 + 1BFS(76)
test(4, 5, 5)  // 4S + 5×5 + 1BFS(71)
test(4, 5, 6)  // 4S + 5×6 + 1BFS(66)
test(4, 5, 8)  // 4S + 5×8 + 1BFS(56)
test(4, 5, 10) // 4S + 5×10 + 1BFS(46)
test(4, 5, 15) // 4S + 5×15 + 1BFS(21)
test(4, 5, 16) // 4S + 5×16 + 1BFS(16)
test(4, 5, 18) // 4S + 5×18 + 1BFS(6)
test(4, 4, 16) // 4S + 4×16 + 2BFS 
test(4, 6, 16) // 4S + 6×16 + 0BFS (pure)
