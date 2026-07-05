// Quick benchmark: does forcing chains help balanced-no-blob layouts?
// Compares: current blob layout vs balanced-free layout, both with and without forcing chains.
// Avoids pathological case (blob + forcing chains = huge candidate set + slow sub-solver).

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

function combinations(arr, k) {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
}

function findPlacement(N, rng) {
  const cols = [], usedCols = new Set()
  function solve(row) {
    if (row === N) return true
    const candidates = shuffle(
      Array.from({ length: N }, (_, i) => i).filter(c => {
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
  solve(0); return cols
}

const ROW = (cell, N) => Math.floor(cell / N)
const COL = (cell, N) => cell % N

// Solver strategies 1-5 (no forcing chains)
function runStrategies(cands, N) {
  const rowOf = cell => Math.floor(cell / N)
  const colOf = cell => cell % N
  let anyChange = true, used = 0
  while (anyChange) {
    anyChange = false
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return { contradiction: true, used }
      if (cands[reg].length !== 1) continue
      const cr = rowOf(cands[reg][0]), cc = colOf(cands[reg][0])
      for (let o = 0; o < N; o++) {
        if (o === reg) continue
        const before = cands[o].length
        cands[o] = cands[o].filter(cell => {
          const r2 = rowOf(cell), c2 = colOf(cell)
          return r2 !== cr && c2 !== cc && !(Math.abs(r2-cr)<=1 && Math.abs(c2-cc)<=1)
        })
        if (cands[o].length === 0) return { contradiction: true, used }
        if (cands[o].length < before) { anyChange = true; used |= 1 }
      }
    }
    const rowSpan = cands.map(cs => new Set(cs.map(rowOf)))
    const colSpan = cands.map(cs => new Set(cs.map(colOf)))
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
      const axisOf = axis === 0 ? rowOf : colOf
      for (let k = 1; k < unplaced.length && !anyChange; k++) {
        for (const subset of combinations(unplaced, k)) {
          const unionK = new Set(subset.flatMap(reg => [...span[reg]]))
          if (unionK.size !== k) continue
          const subSet = new Set(subset)
          for (let o = 0; o < N; o++) {
            if (subSet.has(o)) continue
            const before = cands[o].length
            cands[o] = cands[o].filter(cell => !unionK.has(axisOf(cell)))
            if (cands[o].length === 0) return { contradiction: true, used }
            if (cands[o].length < before) { anyChange = true; used |= 2 }
          }
        }
      }
      const activeAxis = Array.from({ length: N }, (_, i) => i).filter(a => regsInAxis[a].length > 0)
      for (let k = 1; k < unplaced.length && !anyChange; k++) {
        for (const axisSub of combinations(activeAxis, k)) {
          const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
          if (regsIn.length !== k) continue
          const axisSet = new Set(axisSub)
          for (const reg of regsIn) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(cell => axisSet.has(axisOf(cell)))
            if (cands[reg].length === 0) return { contradiction: true, used }
            if (cands[reg].length < before) { anyChange = true; used |= 4 }
          }
        }
      }
    }
    if (anyChange) continue
    for (let reg = 0; reg < N && !anyChange; reg++) {
      if (cands[reg].length === 0) continue
      const rows = cands[reg].map(rowOf), cols = cands[reg].map(colOf)
      const minR = Math.min(...rows), maxR = Math.max(...rows)
      const minC = Math.min(...cols), maxC = Math.max(...cols)
      if (maxR - minR > 1 || maxC - minC > 1) continue
      for (let o = 0; o < N; o++) {
        if (o === reg) continue
        const before = cands[o].length
        cands[o] = cands[o].filter(cell => {
          const r = rowOf(cell), c = colOf(cell)
          return !(r>=minR && r<=maxR && c>=minC && c<=maxC)
        })
        if (cands[o].length === 0) return { contradiction: true, used }
        if (cands[o].length < before) { anyChange = true; used |= 8 }
      }
    }
    if (anyChange) continue
    for (let reg = 0; reg < N && !anyChange; reg++) {
      for (let ci = 0; ci < cands[reg].length && !anyChange; ci++) {
        const cell = cands[reg][ci]
        const cr = rowOf(cell), cc = colOf(cell)
        for (let o = 0; o < N && !anyChange; o++) {
          if (o === reg || cands[o].length === 0) continue
          const surv = cands[o].filter(c2 => {
            const r2 = rowOf(c2), col2 = colOf(c2)
            return r2 !== cr && col2 !== cc && !(Math.abs(r2-cr)<=1 && Math.abs(col2-cc)<=1)
          })
          if (surv.length === 0) {
            cands[reg] = cands[reg].filter(c => c !== cell)
            if (cands[reg].length === 0) return { contradiction: true, used }
            anyChange = true; used |= 16
          }
        }
      }
    }
  }
  return { contradiction: false, used }
}

function canSolve(regions, N, useForcing) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const rowOf = cell => Math.floor(cell / N)
  const colOf = cell => cell % N
  let strategiesUsed = 0

  // Run strategies 1-5
  const r1 = runStrategies(cands, N)
  if (r1.contradiction) return { solved: false, strategiesUsed: r1.used }
  strategiesUsed |= r1.used

  if (!useForcing) {
    return { solved: cands.every(c => c.length === 1), strategiesUsed }
  }

  // Strategy 6: forcing chains (only on regions with <=20 candidates to stay fast)
  let anyChange = true
  while (anyChange) {
    anyChange = false
    // Re-run 1-5 first
    const rs = runStrategies(cands, N)
    if (rs.contradiction) return { solved: false, strategiesUsed: strategiesUsed | rs.used }
    strategiesUsed |= rs.used

    if (cands.every(c => c.length === 1)) break

    for (let reg = 0; reg < N && !anyChange; reg++) {
      if (cands[reg].length <= 1 || cands[reg].length > 20) continue  // skip huge regions
      for (let ci = cands[reg].length - 1; ci >= 0 && !anyChange; ci--) {
        const cell = cands[reg][ci]
        const cr = rowOf(cell), cc = colOf(cell)
        const simCands = cands.map(c => [...c])
        simCands[reg] = [cell]
        let contradiction = false
        for (let o = 0; o < N; o++) {
          if (o === reg) continue
          simCands[o] = simCands[o].filter(c2 => {
            const r2 = rowOf(c2), c2c = colOf(c2)
            return r2 !== cr && c2c !== cc && !(Math.abs(r2-cr)<=1 && Math.abs(c2c-cc)<=1)
          })
          if (simCands[o].length === 0) { contradiction = true; break }
        }
        if (contradiction) continue
        const simR = runStrategies(simCands, N)
        if (simR.contradiction) {
          cands[reg] = cands[reg].filter(c => c !== cell)
          anyChange = true
          strategiesUsed |= 32
        }
      }
    }
  }

  return { solved: cands.every(c => c.length === 1), strategiesUsed }
}

// Current production layout: 2 singletons + 3 doublets + 4 triples + 1 blob
function growBlob(N, seeds, rng) {
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isSing = new Set(shuffledIds.slice(0, 2))
  const isDoub = new Set(shuffledIds.slice(2, 5))
  const isTrip = new Set(shuffledIds.slice(5, 9))
  const largeId = shuffledIds[9]
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = sr+dr, nc = sc+dc
      if (nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1) { grid[nr][nc]=id; break }
    }
  }
  for (const id of isTrip) {
    const { r: sr, c: sc } = seeds[id]; const q=[{r:sr,c:sc}]; let g=0
    for (let qi=0;qi<q.length&&g<2;qi++) {
      const {r,c}=q[qi]
      for (const [dr,dc] of shuffle([...DIRS],rng)) {
        const nr=r+dr,nc=c+dc
        if (nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1) {grid[nr][nc]=id;q.push({r:nr,c:nc});g++;break}
      }
    }
  }
  // blob: BFS fills remaining
  const bq=[{...seeds[largeId]}]
  for (let qi=0;qi<bq.length;qi++) {
    const {r,c}=bq[qi]
    for (const [dr,dc] of shuffle([...DIRS],rng)) {
      const nr=r+dr,nc=c+dc
      if (nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1) {grid[nr][nc]=largeId;bq.push({r:nr,c:nc})}
    }
  }
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
    if (grid[r][c]!==-1) continue
    let best=-1,bestD=Infinity
    seeds.forEach(({r:sr,c:sc},sid)=>{const d=Math.abs(r-sr)+Math.abs(c-sc);if(d<bestD){bestD=d;best=sid}})
    grid[r][c]=best
  }
  return grid
}

// New layout: 2+2+2+4 balanced, no blob (all roles assigned, Voronoi fallback)
function growBalancedFree(N, seeds, rng) {
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isSing = new Set(shuffledIds.slice(0, 2))
  const isDoub = new Set(shuffledIds.slice(2, 4))
  const isTrip = new Set(shuffledIds.slice(4, 6))
  const isQuad = new Set(shuffledIds.slice(6, 10))
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr,dc] of shuffle([...DIRS],rng)) {
      const nr=sr+dr,nc=sc+dc
      if (nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;break}
    }
  }
  for (const id of isTrip) {
    const {r:sr,c:sc}=seeds[id];const q=[{r:sr,c:sc}];let g=0
    for (let qi=0;qi<q.length&&g<2;qi++){
      const {r,c}=q[qi]
      for (const [dr,dc] of shuffle([...DIRS],rng)){
        const nr=r+dr,nc=c+dc
        if (nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;q.push({r:nr,c:nc});g++;break}
      }
    }
  }
  for (const id of isQuad) {
    const {r:sr,c:sc}=seeds[id];const q=[{r:sr,c:sc}];let g=0
    for (let qi=0;qi<q.length&&g<3;qi++){
      const {r,c}=q[qi]
      for (const [dr,dc] of shuffle([...DIRS],rng)){
        const nr=r+dr,nc=c+dc
        if (nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;q.push({r:nr,c:nc});g++;break}
      }
    }
  }
  // Voronoi fallback for remaining cells
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
    if (grid[r][c]!==-1) continue
    let best=-1,bestD=Infinity
    seeds.forEach(({r:sr,c:sc},sid)=>{const d=Math.abs(r-sr)+Math.abs(c-sc);if(d<bestD){bestD=d;best=sid}})
    grid[r][c]=best
  }
  return grid
}

// ── Run benchmarks ────────────────────────────────────────────────────────────
const N = 10, TRIALS = 300

function bench(label, growFn, useForcing) {
  let solved = 0, multi = 0
  const t0 = Date.now()
  for (let i = 0; i < TRIALS; i++) {
    const rng = makeRng(i * 6271 + 42)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growFn(N, solution, rng)
    const result = canSolve(regions, N, useForcing)
    if (result.solved) {
      solved++
      const bits = result.strategiesUsed.toString(2).split('1').length - 1
      if (bits >= 2) multi++
    }
  }
  const ms = Date.now() - t0
  const pct = n => (100*n/TRIALS).toFixed(1)
  console.log(`${label}`)
  console.log(`  solved: ${solved}/${TRIALS} (${pct(solved)}%)  multi-strat: ${multi}/${TRIALS} (${pct(multi)}%)  ${ms}ms`)
  return { solved, multi }
}

console.log(`=== FC Quick Benchmark (N=${N}, ${TRIALS} trials) ===\n`)
const a = bench('Blob layout  + NO  forcing chains (current Phase 2 baseline)', growBlob, false)
const b = bench('Blob layout  + YES forcing chains (would be very slow, skip if needed)', growBlob, true)
const c = bench('Free layout  + NO  forcing chains', growBalancedFree, false)
const d = bench('Free layout  + YES forcing chains', growBalancedFree, true)

console.log(`\n=== Summary ===`)
console.log(`Blob  no-FC:  ${(100*a.multi/TRIALS).toFixed(1)}%  (baseline)`)
console.log(`Blob  yes-FC: ${(100*b.multi/TRIALS).toFixed(1)}%  (FC on blob)`)
console.log(`Free  no-FC:  ${(100*c.multi/TRIALS).toFixed(1)}%`)
console.log(`Free  yes-FC: ${(100*d.multi/TRIALS).toFixed(1)}%  (target improvement)`)
