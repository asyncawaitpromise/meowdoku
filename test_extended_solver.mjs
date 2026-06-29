// Test: extended solver (subsets up to size 5) with various region configs

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

function* combinations(arr, k) {
  if (k === 0) { yield []; return }
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      yield [arr[i], ...rest]
}

function canSolveLogicallyExtended(regions, N, MAX_K = 5) {
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

      // Naked subsets up to MAX_K
      for (let k = 2; k <= Math.min(MAX_K, unplaced.length); k++) {
        for (const subset of combinations(unplaced, k)) {
          const union = new Set(subset.flatMap(reg => [...span[reg]]))
          if (union.size === k) {
            for (let other = 0; other < N; other++) {
              if (subset.includes(other)) continue
              const before = cands[other].length
              cands[other] = cands[other].filter(cell => !union.has(axisOf(cell)))
              if (cands[other].length < before) anyChange = true
            }
          }
        }
      }

      // Hidden subsets up to MAX_K
      const activeAxis = Array.from({ length: N }, (_, i) => i).filter(a => regsInAxis[a].length > 0)
      for (let k = 2; k <= Math.min(MAX_K, activeAxis.length); k++) {
        for (const axisSub of combinations(activeAxis, k)) {
          const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
          if (regsIn.length === k) {
            const axisSet = new Set(axisSub)
            for (const reg of regsIn) {
              const before = cands[reg].length
              cands[reg] = cands[reg].filter(cell => axisSet.has(axisOf(cell)))
              if (cands[reg].length < before) anyChange = true
            }
          }
        }
      }
    }
  }
  return cands.every(c => c.length === 1)
}

function growRegionsMix(N, seeds, rng, nSingleton, nSmall, smallTarget, useEdge) {
  let sorted
  if (useEdge) {
    const edgeScore = (r, c) => Math.min(r, N-1-r) + Math.min(c, N-1-c)
    sorted = seeds.map((s, id) => ({ id, score: edgeScore(s.r, s.c) })).sort((a, b) => a.score - b.score)
  } else {
    sorted = seeds.map((s, id) => ({ id, col: s.c })).sort((a, b) => a.col - b.col)
  }

  const isSingleton = new Set()
  const isSmall = new Set()
  sorted.forEach(({ id }, idx) => {
    if (idx < nSingleton) isSingleton.add(id)
    else if (idx < nSingleton + nSmall) isSmall.add(id)
  })

  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]
  for (const id of isSmall) {
    const q = [seeds[id]]
    let qi = 0, size = 1
    while (size < smallTarget && qi < q.length) {
      const { r, c } = q[qi++]
      const dirs = shuffle([...DIRS], rng)
      for (const [dr, dc] of dirs) {
        if (size >= smallTarget) break
        const nr = r+dr, nc = c+dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; size++; q.push({ r: nr, c: nc })
        }
      }
    }
  }

  const largeQ = []
  seeds.forEach((s, id) => { if (!isSingleton.has(id) && !isSmall.has(id)) largeQ.push({ ...s, id }) })
  let qi = 0
  while (qi < largeQ.length) {
    const { r, c, id } = largeQ[qi++]
    const dirs = shuffle([...DIRS], rng)
    for (const [dr, dc] of dirs) {
      const nr = r+dr, nc = c+dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; largeQ.push({ r: nr, c: nc, id })
      }
    }
  }

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

// Test whether extended solver (MAX_K=5) helps with fewer singletons
console.log('=== Extended solver (MAX_K=5) ===')
const configs = [
  { nS: 5, nSm: 3, nL: 2, st: 2, edge: true, label: '5s+3sm(2)+2L EDGE' },
  { nS: 5, nSm: 4, nL: 1, st: 2, edge: true, label: '5s+4sm(2)+1L EDGE' },
  { nS: 5, nSm: 5, nL: 0, st: 2, edge: true, label: '5s+5sm(2)+0L EDGE' },
  { nS: 6, nSm: 3, nL: 1, st: 2, edge: true, label: '6s+3sm(2)+1L EDGE' },
  { nS: 6, nSm: 4, nL: 0, st: 2, edge: true, label: '6s+4sm(2)+0L EDGE' },
  { nS: 7, nSm: 2, nL: 1, st: 2, edge: true, label: '7s+2sm(2)+1L EDGE' },
  { nS: 7, nSm: 3, nL: 0, st: 2, edge: true, label: '7s+3sm(2)+0L EDGE' },
]

for (const { nS, nSm, nL, st, edge, label } of configs) {
  let total3 = 0, total5 = 0
  for (let level = 1; level <= 5; level++) {
    const BASE = level * 100003 + 17
    for (let attempt = 0; attempt < 200; attempt++) {
      const rng = makeRng(BASE + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const grid = growRegionsMix(N, solution, rng, nS, nSm, st, edge)
      if (canSolveLogicallyExtended(grid, N, 3)) total3++
      if (canSolveLogicallyExtended(grid, N, 5)) total5++
    }
  }
  const pass3 = total3 >= 500 ? '✓' : ''
  const pass5 = total5 >= 500 ? '✓' : ''
  console.log(`${label}: k≤3=${total3/10}%${pass3} k≤5=${total5/10}%${pass5}`)
}
