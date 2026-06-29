// Test: band-constrained large regions
// 5 singletons + 4 small(2) horizontal + 1 large → 52.6%
// Can we split the 1 large into 2-3 smaller "large" regions while maintaining 50%+?
// Key insight: if we constrain large regions to non-overlapping row bands,
// they form naked row pairs/triples after singletons+smalls cascade.

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

// Strategy: 5 singletons (top 5 rows) + 4 horiz small(2) (next 4 rows) + 1 large (last 1 row)
// Effectively row-sorted, with the one large region being the cat in the last assigned row.
// But can we make 2 large regions that are in different row bands?

// New idea: n singletons (rows 0..n-1), m small(2) (rows n..n+m-1), rest large
// Sort by row. Large regions get BFS into remaining space, but cap them by row band.

function growRegionsBandedLarge(N, seeds, rng, nSingleton, nSmall) {
  // Row-sorted assignment
  const sorted = seeds.map((s, id) => ({ id, row: s.r })).sort((a, b) => a.row - b.row)
  const isSingleton = new Set()
  const isSmall = new Set()
  sorted.forEach(({ id }, idx) => {
    if (idx < nSingleton) isSingleton.add(id)
    else if (idx < nSingleton + nSmall) isSmall.add(id)
  })

  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const HDIRS = [[0,-1],[0,1]]
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]

  for (const id of isSmall) {
    const { r: sr, c: sc } = seeds[id]
    const hdirs = shuffle([...HDIRS], rng)
    let grew = false
    for (const [dr, dc] of hdirs) {
      const nr = sr+dr, nc = sc+dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; grew = true; break
      }
    }
    if (!grew) {
      for (const [dr, dc] of shuffle([...DIRS], rng)) {
        const nr = sr+dr, nc = sc+dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; break
        }
      }
    }
  }

  // Large regions: RESTRICT to their own "column band"
  // Each large region gets a column band of width ~(N / nLarge)
  const largeIds = sorted.filter((_, idx) => idx >= nSingleton + nSmall).map(({ id }) => id)
  const nLarge = largeIds.length

  if (nLarge === 0) {
    // cleanup only
  } else if (nLarge === 1) {
    // No band restriction - BFS everywhere
    const largeQ = largeIds.map(id => ({ ...seeds[id], id }))
    let qi = 0
    while (qi < largeQ.length) {
      const { r, c, id } = largeQ[qi++]
      for (const [dr, dc] of shuffle([...DIRS], rng)) {
        const nr = r+dr, nc = c+dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; largeQ.push({ r: nr, c: nc, id })
        }
      }
    }
  } else {
    // Sort large by their cat column, assign column bands
    const sortedLarge = largeIds.map(id => ({ id, col: seeds[id].c })).sort((a, b) => a.col - b.col)
    const bandWidth = Math.ceil(N / nLarge)
    sortedLarge.forEach(({ id }, k) => {
      const colLo = k * bandWidth
      const colHi = Math.min((k + 1) * bandWidth, N) - 1
      // BFS restricted to cols [colLo, colHi]
      const q = [{ ...seeds[id], id }]
      let qi = 0
      while (qi < q.length) {
        const { r, c } = q[qi++]
        for (const [dr, dc] of shuffle([...DIRS], rng)) {
          const nr = r+dr, nc = c+dc
          if (nr >= 0 && nr < N && nc >= colLo && nc <= colHi && grid[nr][nc] === -1) {
            grid[nr][nc] = id; q.push({ r: nr, c: nc, id })
          }
        }
      }
    })
    // Overflow: assign remaining cells (outside bands due to singleton conflicts) by nearest large
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      largeIds.forEach(id => {
        const { r: sr, c: sc } = seeds[id]
        const d = Math.abs(r-sr)+Math.abs(c-sc)
        if (d < bestDist) { bestDist = d; best = id }
      })
      grid[r][c] = best
    }
  }

  // Final cleanup
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    seeds.forEach(({ r: sr, c: sc }, id) => {
      if (isSingleton.has(id)) return
      const d = Math.abs(r-sr)+Math.abs(c-sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    if (best === -1) seeds.forEach(({ r: sr, c: sc }, id) => {
      const d = Math.abs(r-sr)+Math.abs(c-sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    grid[r][c] = best
  }
  return grid
}

const N = 10
const configs = [
  { nS: 5, nSm: 4, label: '5s+4sm(H)+1L unrestr' },  // nL=1
  { nS: 5, nSm: 3, label: '5s+3sm(H)+2L banded' },   // nL=2
  { nS: 5, nSm: 2, label: '5s+2sm(H)+3L banded' },   // nL=3
  { nS: 4, nSm: 4, label: '4s+4sm(H)+2L banded' },   // nL=2
  { nS: 4, nSm: 3, label: '4s+3sm(H)+3L banded' },   // nL=3
  { nS: 3, nSm: 5, label: '3s+5sm(H)+2L banded' },   // nL=2
  { nS: 3, nSm: 4, label: '3s+4sm(H)+3L banded' },   // nL=3
]

for (const { nS, nSm, label } of configs) {
  let total = 0
  for (let level = 1; level <= 5; level++) {
    const BASE = level * 100003 + 17
    for (let attempt = 0; attempt < 200; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const grid = growRegionsBandedLarge(N, solution, rng, nS, nSm)
      if (canSolveLogically(grid, N)) total++
    }
  }
  console.log(`${label}: ${total}/1000 (${(total/10).toFixed(1)}%) ${total>=500?'✓':''}`)
}
