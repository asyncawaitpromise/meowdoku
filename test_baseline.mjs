// Quick baseline: what % of growRegionsBalanced outputs are directly solvable?
import { readFileSync } from 'fs'

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
function findPlacement(N, rng) {
  const cols=[], usedCols=new Set()
  function solve(row) {
    if(row===N) return true
    const cands=shuffle(Array.from({length:N},(_,i)=>i).filter(c=>{if(usedCols.has(c))return false;if(row>0&&Math.abs(c-cols[row-1])<2)return false;return true}),rng)
    for(const c of cands){cols[row]=c;usedCols.add(c);if(solve(row+1))return true;cols.pop();usedCols.delete(c)}
    return false
  }
  solve(0); return cols
}
function combinations(arr, k) {
  if(k===0) return [[]]
  if(k>arr.length) return []
  const res=[]
  for(let i=0;i<=arr.length-k;i++) for(const rest of combinations(arr.slice(i+1),k-1)) res.push([arr[i],...rest])
  return res
}
function canSolveLogically(regions, N) {
  const cands=Array.from({length:N},()=>[])
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) cands[regions[r][c]].push(r*N+c)
  const ROW=cell=>Math.floor(cell/N), COL=cell=>cell%N
  let anyChange=true, strategiesUsed=0
  while(anyChange) {
    anyChange=false
    for(let reg=0;reg<N;reg++) {
      if(cands[reg].length===0) return {solved:false,strategiesUsed,unsolvedCount:N}
      if(cands[reg].length!==1) continue
      const cr=ROW(cands[reg][0]),cc=COL(cands[reg][0])
      for(let other=0;other<N;other++) {
        if(other===reg) continue
        const before=cands[other].length
        cands[other]=cands[other].filter(cell=>{const r2=ROW(cell),c2=COL(cell);return r2!==cr&&c2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2-cc)<=1)})
        if(cands[other].length<before){anyChange=true;strategiesUsed|=1}
      }
    }
    const rowSpan=cands.map(cs=>new Set(cs.map(ROW))), colSpan=cands.map(cs=>new Set(cs.map(COL)))
    const regsInRow=Array.from({length:N},()=>[]), regsInCol=Array.from({length:N},()=>[])
    for(let reg=0;reg<N;reg++){if(cands[reg].length<=1)continue;for(const r of rowSpan[reg])regsInRow[r].push(reg);for(const c of colSpan[reg])regsInCol[c].push(reg)}
    const unplaced=Array.from({length:N},(_,i)=>i).filter(r=>cands[r].length>1)
    for(const axis of [0,1]){
      const span=axis===0?rowSpan:colSpan, regsInAxis=axis===0?regsInRow:regsInCol, axisOf=axis===0?ROW:COL
      for(let k=2;k<unplaced.length;k++) for(const subset of combinations(unplaced,k)){
        const unionK=new Set(subset.flatMap(reg=>[...span[reg]]))
        if(unionK.size!==k) continue
        const subSet=new Set(subset)
        for(let other=0;other<N;other++){if(subSet.has(other))continue;const before=cands[other].length;cands[other]=cands[other].filter(cell=>!unionK.has(axisOf(cell)));if(cands[other].length<before){anyChange=true;strategiesUsed|=2}}
      }
      const activeAxis=Array.from({length:N},(_,i)=>i).filter(a=>regsInAxis[a].length>0)
      for(let k=2;k<unplaced.length;k++) for(const axisSub of combinations(activeAxis,k)){
        const regsIn=[...new Set(axisSub.flatMap(a=>regsInAxis[a]))]
        if(regsIn.length!==k) continue
        const axisSet=new Set(axisSub)
        for(const reg of regsIn){const before=cands[reg].length;cands[reg]=cands[reg].filter(cell=>axisSet.has(axisOf(cell)));if(cands[reg].length<before){anyChange=true;strategiesUsed|=4}}
      }
    }
    if(anyChange) continue
    for(let reg=0;reg<N;reg++){if(cands[reg].length===0)continue;const rows=cands[reg].map(ROW),cols=cands[reg].map(COL);const minR=Math.min(...rows),maxR=Math.max(...rows),minC=Math.min(...cols),maxC=Math.max(...cols);if(maxR-minR>1||maxC-minC>1)continue;for(let other=0;other<N;other++){if(other===reg)continue;const before=cands[other].length;cands[other]=cands[other].filter(cell=>{const r=ROW(cell),c=COL(cell);return!(r>=minR&&r<=maxR&&c>=minC&&c<=maxC)});if(cands[other].length<before){anyChange=true;strategiesUsed|=8}}}
    if(anyChange) continue
    for(let reg=0;reg<N&&!anyChange;reg++){for(let ci=0;ci<cands[reg].length&&!anyChange;ci++){const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell);for(let other=0;other<N&&!anyChange;other++){if(other===reg||cands[other].length===0)continue;const survivors=cands[other].filter(c2=>{const r2=ROW(c2),col2=COL(c2);return r2!==cr&&col2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(col2-cc)<=1)});if(survivors.length===0){const before=cands[reg].length;cands[reg]=cands[reg].filter(c=>c!==cell);if(cands[reg].length<before){anyChange=true;strategiesUsed|=16}}}}}
  }
  const unsolvedCount=cands.filter(c=>c.length>1).length
  return {solved:cands.every(c=>c.length===1),strategiesUsed,unsolvedCount}
}
function growRegionsBalanced(N, seeds, rng) {
  const smallCap=Math.floor(N*0.6), largeCap=Math.floor(N*1.8)
  const shuffledIds=shuffle(Array.from({length:N},(_,i)=>i),rng)
  const isSmall=new Set(shuffledIds.slice(0,Math.floor(N/2)))
  const constraintType=new Array(N), minRow=new Array(N).fill(0), maxRow=new Array(N).fill(N-1), minCol=new Array(N).fill(0), maxCol=new Array(N).fill(N-1)
  const bandWidth=Math.floor(N*0.6)
  for(let id=0;id<N;id++){const roll=rng();if(roll<0.25){constraintType[id]='row';const h=Math.floor(bandWidth/2);minRow[id]=Math.max(0,seeds[id].r-h);maxRow[id]=Math.min(N-1,seeds[id].r+h)}else if(roll<0.5){constraintType[id]='col';const h=Math.floor(bandWidth/2);minCol[id]=Math.max(0,seeds[id].c-h);maxCol[id]=Math.min(N-1,seeds[id].c+h)}else constraintType[id]='none'}
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]]
  const grid=Array.from({length:N},()=>Array(N).fill(-1))
  seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  const sizes=Array(N).fill(1)
  let frontier=shuffle(seeds.map((s,id)=>({...s,id})),rng)
  while(frontier.length>0){
    const idx=Math.floor(rng()*frontier.length); const entry=frontier[idx]; frontier[idx]=frontier[frontier.length-1]; frontier.pop()
    const {r,c,id}=entry
    for(const [dr,dc] of shuffle([...DIRS],rng)){
      const nr=r+dr,nc=c+dc
      if(nr<0||nr>=N||nc<0||nc>=N||grid[nr][nc]!==-1) continue
      const cap=isSmall.has(id)?smallCap:largeCap
      if(sizes[id]>=cap) continue
      if(constraintType[id]==='row'&&(nr<minRow[id]||nr>maxRow[id])) continue
      if(constraintType[id]==='col'&&(nc<minCol[id]||nc>maxCol[id])) continue
      grid[nr][nc]=id; sizes[id]++; frontier.push({r:nr,c:nc,id})
    }
  }
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){if(grid[r][c]!==-1)continue;let best=0,bestDist=Infinity;for(let id=0;id<N;id++){const d=Math.abs(r-seeds[id].r)+Math.abs(c-seeds[id].c);if(d<bestDist){bestDist=d;best=id}}grid[r][c]=best;sizes[best]++}
  return grid
}

const N=10, TRIALS=200
let solved=0, strat2=0
const t0=Date.now()
for(let i=0;i<TRIALS;i++){
  const rng=makeRng(i*6271+17)
  const cats=findPlacement(N,rng)
  const sol=cats.map((c,r)=>({r,c}))
  const grid=growRegionsBalanced(N,sol,rng)
  const res=canSolveLogically(grid,N)
  if(res.solved){solved++;const sc=res.strategiesUsed.toString(2).split('1').length-1;if(sc>=2)strat2++}
}
console.log(`${TRIALS} trials in ${Date.now()-t0}ms`)
console.log(`Solved: ${solved}/${TRIALS} (${(solved/TRIALS*100).toFixed(1)}%)`)
console.log(`Solved & strat>=2: ${strat2}/${TRIALS} (${(strat2/TRIALS*100).toFixed(1)}%)`)
