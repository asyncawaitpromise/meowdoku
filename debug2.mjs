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
    for (const c of candidates) {
      cols[row] = c; usedCols.add(c)
      if (solve(row + 1)) return true
      cols.pop(); usedCols.delete(c)
    }
    return false
  }
  solve(0)
  return cols
}
function growRegions(N, seeds, rng) {
  const SMALL_BAND = 1, LARGE_BAND = 3, SMALL_TARGET = 5
  const sortedByCol = seeds.map((s, id) => ({ id, col: s.c })).sort((a, b) => a.col - b.col)
  const isSmall = new Set()
  sortedByCol.forEach(({ id }, idx) => { if (idx % 2 === 0) isSmall.add(id) })
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  const sizes = Array(seeds.length).fill(0)
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const rowMin = seeds.map(({ r }, id) => Math.max(0, r - (isSmall.has(id) ? SMALL_BAND : LARGE_BAND)))
  const rowMax = seeds.map(({ r }, id) => Math.min(N - 1, r + (isSmall.has(id) ? SMALL_BAND : LARGE_BAND)))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id; sizes[id] = 1 })
  const queues = seeds.map(({ r, c }) => [{ r, c }])
  let anyProgress = true
  while (anyProgress) {
    anyProgress = false
    for (let id = 0; id < N; id++) {
      if (isSmall.has(id) && sizes[id] >= SMALL_TARGET) continue
      const q = queues[id]
      let expanded = false, attempts = Math.min(q.length, 8)
      while (attempts-- > 0 && !expanded) {
        const idx = Math.floor(rng() * q.length)
        const { r, c } = q[idx]
        const dirs = shuffle([...DIRS], rng)
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && nr >= rowMin[id] && nr <= rowMax[id] && grid[nr][nc] === -1) {
            grid[nr][nc] = id; sizes[id]++; q.push({ r: nr, c: nc }); expanded = true; anyProgress = true; break
          }
        }
        if (!expanded) q.splice(idx, 1)
        if (q.length === 0) break
      }
    }
  }
  const largeQueue = []
  for (let id = 0; id < N; id++) {
    if (isSmall.has(id)) continue
    for (let r = rowMin[id]; r <= rowMax[id]; r++)
      for (let c = 0; c < N; c++)
        if (grid[r][c] === id) largeQueue.push({ r, c, id })
  }
  const lq = shuffle(largeQueue, rng)
  while (lq.length > 0) {
    const idx = Math.floor(rng() * lq.length)
    const { r, c, id } = lq[idx]
    lq.splice(idx, 1)
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && nr >= rowMin[id] && nr <= rowMax[id] && grid[nr][nc] === -1) {
        grid[nr][nc] = id; sizes[id]++; lq.push({ r: nr, c: nc, id })
      }
    }
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    seeds.forEach(({ r: sr, c: sc }, id) => {
      if (isSmall.has(id)) return
      const d = Math.abs(r - sr) + Math.abs(c - sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    if (best === -1) seeds.forEach(({ r: sr, c: sc }, id) => {
      const d = Math.abs(r - sr) + Math.abs(c - sc)
      if (d < bestDist) { bestDist = d; best = id }
    })
    grid[r][c] = best
  }
  return { grid, sizes, isSmall, rowMin, rowMax }
}

const N = 10
const rng = makeRng(100003 + 17)
const catCols = findPlacement(N, rng)
const solution = catCols.map((c, r) => ({ r, c }))
console.log('Seeds:', solution.map((s, i) => `[${i}](${s.r},${s.c})`).join(' '))
const { grid, sizes, isSmall, rowMin, rowMax } = growRegions(N, solution, rng)

console.log('\nRegion info:')
sizes.forEach((sz, id) => {
  console.log(`  Reg ${id} (${isSmall.has(id)?'S':'L'}): ${sz} cells, rows [${rowMin[id]}-${rowMax[id]}]`)
})

console.log('\nGrid:')
for (let r = 0; r < N; r++) console.log(grid[r].map(v => v.toString().padStart(2)).join(' '))

const ROW = cell => Math.floor(cell / N)
const COL = cell => cell % N
const cands = Array.from({ length: N }, () => [])
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[grid[r][c]].push(r*N+c)

console.log('\nCandidate spans:')
cands.forEach((cs, id) => {
  const rows = [...new Set(cs.map(ROW))].sort((a,b)=>a-b)
  const cols = [...new Set(cs.map(COL))].sort((a,b)=>a-b)
  console.log(`  Reg ${id} (${isSmall.has(id)?'S':'L'}, ${sizes[id]}c): rows=${JSON.stringify(rows)} cols=${JSON.stringify(cols)}`)
})

// Check if any unclaimed
let unclaimed = 0
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) unclaimed++
console.log('Unclaimed cells:', unclaimed)

// Run solver with trace
function solveTrace(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[regions[r][c]].push(r*N+c)
  const ROW = cell => Math.floor(cell / N)
  const COL = cell => cell % N

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
  console.log('\nFinal sizes:', cands.map((c,i) => `${i}:${c.length}`).join(' '))
  console.log('Remaining multi-cand regions:')
  cands.forEach((cs, id) => {
    if (cs.length <= 1) return
    const rows = [...new Set(cs.map(ROW))].sort((a,b)=>a-b)
    const cols = [...new Set(cs.map(COL))].sort((a,b)=>a-b)
    console.log(`  Reg ${id}: ${cs.length} cands, rows=${JSON.stringify(rows)} cols=${JSON.stringify(cols)}`)
  })
  return cands.every(c => c.length === 1)
}
console.log('\n--- Solver trace ---')
console.log('Solvable:', solveTrace(grid, N))
