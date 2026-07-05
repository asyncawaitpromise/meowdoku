// Test modified SA cost function that penalizes large (blob) regions.
// Hypothesis: size-weighted span discourages blobs and yields more solvable
// balanced layouts from Phase 1.

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
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]] }
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
    const candidates = shuffle(Array.from({length:N},(_,i)=>i).filter(c => {
      if (usedCols.has(c)) return false
      if (row > 0 && Math.abs(c - cols[row-1]) < 2) return false
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
function isConnectedWithout(grid, N, skipR, skipC, reg) {
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]
  let start = -1, size = 0
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== reg) continue
    size++
    if (!(r===skipR&&c===skipC) && start===-1) start=r*N+c
  }
  if (size <= 1 || start === -1) return false
  const visited = new Set([start]), queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift(), r = Math.floor(cur/N), c = cur%N
    for (const [dr,dc] of DIRS) {
      const nr=r+dr,nc=c+dc
      if (nr<0||nr>=N||nc<0||nc>=N) continue
      const nidx=nr*N+nc
      if (!visited.has(nidx)&&grid[nr][nc]===reg&&!(nr===skipR&&nc===skipC)){visited.add(nidx);queue.push(nidx)}
    }
  }
  return visited.size === size - 1
}

// ── Solver (strategies 1-5, no FC) ───────────────────────────────────────────
function canSolveLogically(regions, N) {
  const cands = Array.from({length:N}, ()=>[])
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) cands[regions[r][c]].push(r*N+c)
  const ROW=cell=>Math.floor(cell/N), COL=cell=>cell%N
  let anyChange=true, strategiesUsed=0
  while (anyChange) {
    anyChange = false
    for (let reg=0;reg<N;reg++) {
      if (cands[reg].length===0) return {solved:false,strategiesUsed,unsolvedCount:N}
      if (cands[reg].length!==1) continue
      const cr=ROW(cands[reg][0]),cc=COL(cands[reg][0])
      for (let o=0;o<N;o++) {
        if (o===reg) continue
        const before=cands[o].length
        cands[o]=cands[o].filter(cell=>{const r2=ROW(cell),c2=COL(cell);return r2!==cr&&c2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2-cc)<=1)})
        if (cands[o].length<before){anyChange=true;strategiesUsed|=1}
      }
    }
    const rowSpan=cands.map(cs=>new Set(cs.map(ROW)))
    const colSpan=cands.map(cs=>new Set(cs.map(COL)))
    const regsInRow=Array.from({length:N},()=>[]),regsInCol=Array.from({length:N},()=>[])
    for (let reg=0;reg<N;reg++) {
      if (cands[reg].length<=1) continue
      for (const r of rowSpan[reg]) regsInRow[r].push(reg)
      for (const c of colSpan[reg]) regsInCol[c].push(reg)
    }
    const unplaced=Array.from({length:N},(_,i)=>i).filter(r=>cands[r].length>1)
    for (const axis of [0,1]) {
      const span=axis===0?rowSpan:colSpan, regsInAxis=axis===0?regsInRow:regsInCol, axisOf=axis===0?ROW:COL
      for (let k=1;k<unplaced.length;k++) {
        for (const subset of combinations(unplaced,k)) {
          const unionK=new Set(subset.flatMap(reg=>[...span[reg]]))
          if (unionK.size!==k) continue
          const subSet=new Set(subset)
          for (let o=0;o<N;o++) {
            if (subSet.has(o)) continue
            const before=cands[o].length
            cands[o]=cands[o].filter(cell=>!unionK.has(axisOf(cell)))
            if (cands[o].length<before){anyChange=true;strategiesUsed|=2}
          }
        }
      }
      const activeAxis=Array.from({length:N},(_,i)=>i).filter(a=>regsInAxis[a].length>0)
      for (let k=1;k<unplaced.length;k++) {
        for (const axisSub of combinations(activeAxis,k)) {
          const regsIn=[...new Set(axisSub.flatMap(a=>regsInAxis[a]))]
          if (regsIn.length!==k) continue
          const axisSet=new Set(axisSub)
          for (const reg of regsIn) {
            const before=cands[reg].length
            cands[reg]=cands[reg].filter(cell=>axisSet.has(axisOf(cell)))
            if (cands[reg].length<before){anyChange=true;strategiesUsed|=4}
          }
        }
      }
    }
    if (anyChange) continue
    for (let reg=0;reg<N;reg++) {
      if (cands[reg].length===0) continue
      const rows=cands[reg].map(ROW),cols=cands[reg].map(COL)
      const minR=Math.min(...rows),maxR=Math.max(...rows),minC=Math.min(...cols),maxC=Math.max(...cols)
      if (maxR-minR>1||maxC-minC>1) continue
      for (let o=0;o<N;o++) {
        if (o===reg) continue
        const before=cands[o].length
        cands[o]=cands[o].filter(cell=>{const r=ROW(cell),c=COL(cell);return!(r>=minR&&r<=maxR&&c>=minC&&c<=maxC)})
        if (cands[o].length<before){anyChange=true;strategiesUsed|=8}
      }
    }
    if (anyChange) continue
    for (let reg=0;reg<N&&!anyChange;reg++) {
      for (let ci=0;ci<cands[reg].length&&!anyChange;ci++) {
        const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell)
        for (let o=0;o<N&&!anyChange;o++) {
          if (o===reg||cands[o].length===0) continue
          const surv=cands[o].filter(c2=>{const r2=ROW(c2),col2=COL(c2);return r2!==cr&&col2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(col2-cc)<=1)})
          if (surv.length===0){cands[reg]=cands[reg].filter(c=>c!==cell);anyChange=true;strategiesUsed|=16}
        }
      }
    }
  }
  const unsolvedCount=cands.filter(c=>c.length>1).length
  return {solved:cands.every(c=>c.length===1),strategiesUsed,unsolvedCount}
}

// ── Voronoi growth ────────────────────────────────────────────────────────────
function growVoronoi(N, seeds, rng) {
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]]
  const grid=Array.from({length:N},()=>Array(N).fill(-1))
  seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  let frontier=shuffle(seeds.map((s,id)=>({...s,id})),rng)
  while (frontier.length>0) {
    const idx=Math.floor(rng()*frontier.length)
    const entry=frontier[idx];frontier[idx]=frontier[frontier.length-1];frontier.pop()
    const {r,c,id}=entry
    for (const [dr,dc] of shuffle([...DIRS],rng)) {
      const nr=r+dr,nc=c+dc
      if (nr<0||nr>=N||nc<0||nc>=N||grid[nr][nc]!==-1) continue
      grid[nr][nc]=id;frontier.push({r:nr,c:nc,id})
    }
  }
  return grid
}

// ── SA with CURRENT cost: plain spanScore ─────────────────────────────────────
function spanScorePlain(grid, N) {
  const rows=Array.from({length:N},()=>new Set()),cols=Array.from({length:N},()=>new Set())
  for (let r=0;r<N;r++) for (let c=0;c<N;c++){rows[grid[r][c]].add(r);cols[grid[r][c]].add(c)}
  let s=0
  for (let reg=0;reg<N;reg++) s+=rows[reg].size+cols[reg].size
  return s
}

// ── SA with MODIFIED cost: size-penalised span ────────────────────────────────
// Each region's span is multiplied by (1 + size/N) so large regions pay more.
function spanScoreBalanced(grid, N) {
  const rows=Array.from({length:N},()=>new Set()),cols=Array.from({length:N},()=>new Set())
  const sizes=Array(N).fill(0)
  for (let r=0;r<N;r++) for (let c=0;c<N;c++){rows[grid[r][c]].add(r);cols[grid[r][c]].add(c);sizes[grid[r][c]]++}
  let s=0
  for (let reg=0;reg<N;reg++) {
    const span=rows[reg].size+cols[reg].size
    s+=span*(1+sizes[reg]/N)
  }
  return s
}

// ── SA runner (parameterised cost function) ───────────────────────────────────
function hillClimb(initialGrid, solution, N, rng, scoreFn) {
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]]
  const MAX_ITER=5000, T_START=8.0, T_MIN=0.05, COOLING=0.9985
  const grid=initialGrid.map(row=>[...row])
  let score=scoreFn(grid,N), bestScore=score, bestGrid=grid.map(r=>[...r]), T=T_START
  for (let iter=0;iter<MAX_ITER;iter++) {
    T=Math.max(T_MIN,T*COOLING)
    if (iter%200===0&&iter>0) {
      const r=canSolveLogically(bestGrid,N)
      const sc=r.strategiesUsed.toString(2).split('1').length-1
      if (r.solved&&sc>=2) return bestGrid
    }
    const r=Math.floor(rng()*N),c=Math.floor(rng()*N)
    const from=grid[r][c]
    if (solution[from].r===r&&solution[from].c===c) continue
    const [dr,dc]=DIRS[Math.floor(rng()*4)]
    const nr=r+dr,nc=c+dc
    if (nr<0||nr>=N||nc<0||nc>=N) continue
    const to=grid[nr][nc]
    if (to===from) continue
    if (!isConnectedWithout(grid,N,r,c,from)) continue
    grid[r][c]=to
    const ns=scoreFn(grid,N)
    const delta=ns-score
    if (delta<=0||rng()<Math.exp(-delta/T)){score=ns;if(score<bestScore){bestScore=score;bestGrid=grid.map(row=>[...row])}}
    else grid[r][c]=from
  }
  return bestGrid
}

// ── Max region size helper ────────────────────────────────────────────────────
function maxRegionSize(grid, N) {
  const sizes=Array(N).fill(0)
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) sizes[grid[r][c]]++
  return Math.max(...sizes)
}

// ── Benchmark ─────────────────────────────────────────────────────────────────
const N=10, TRIALS=100

function bench(label, scoreFn) {
  let solved=0, multi=0, blobCount=0, totalMaxSize=0
  const t0=Date.now()
  for (let i=0;i<TRIALS;i++) {
    const rng=makeRng(i*6271+42)
    const catCols=findPlacement(N,rng)
    const solution=catCols.map((c,r)=>({r,c}))
    const voronoi=growVoronoi(N,solution,rng)
    const regions=hillClimb(voronoi,solution,N,rng,scoreFn)
    const mx=maxRegionSize(regions,N)
    totalMaxSize+=mx
    if (mx>30) blobCount++
    const result=canSolveLogically(regions,N)
    if (result.solved) {
      solved++
      const bits=result.strategiesUsed.toString(2).split('1').length-1
      if (bits>=2) multi++
    }
  }
  const ms=Date.now()-t0
  const pct=n=>(100*n/TRIALS).toFixed(1)
  console.log(`\n${label}`)
  console.log(`  solved: ${solved}/${TRIALS} (${pct(solved)}%)  multi-strat: ${multi}/${TRIALS} (${pct(multi)}%)`)
  console.log(`  blob rate (maxSize>30): ${blobCount}/${TRIALS} (${pct(blobCount)}%)  avg max region: ${(totalMaxSize/TRIALS).toFixed(1)} cells`)
  console.log(`  time: ${ms}ms (${(ms/TRIALS).toFixed(0)}ms/trial)`)
  return {solved,multi,blobCount}
}

console.log(`=== Balanced SA Cost Function Test (N=${N}, ${TRIALS} trials) ===`)
const plain = bench('CURRENT: plain spanScore (baseline)', spanScorePlain)
const balanced = bench('NEW: size-penalised spanScore (1 + size/N)', spanScoreBalanced)

console.log(`\n=== Summary ===`)
console.log(`Plain      - multi-strat: ${(100*plain.multi/TRIALS).toFixed(1)}%  blob: ${(100*plain.blobCount/TRIALS).toFixed(1)}%`)
console.log(`Balanced   - multi-strat: ${(100*balanced.multi/TRIALS).toFixed(1)}%  blob: ${(100*balanced.blobCount/TRIALS).toFixed(1)}%`)
