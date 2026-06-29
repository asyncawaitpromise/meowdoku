// Compare different approaches for puzzle generation
// Tests what combination actually produces solvable puzzles quickly

function makeRng(seed) {
  let s = seed | 0
  return () => { s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return((t^(t>>>14))>>>0)/4294967296 }
}
function shuffle(arr, rng) { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}; return a }
function findPlacement(N, rng) {
  const cols=[],usedCols=new Set()
  function solve(row){if(row===N)return true;const c2=shuffle(Array.from({length:N},(_,i)=>i).filter(c=>{if(usedCols.has(c))return false;if(row>0&&Math.abs(c-cols[row-1])<2)return false;return true}),rng);for(const c of c2){cols[row]=c;usedCols.add(c);if(solve(row+1))return true;cols.pop();usedCols.delete(c)}return false}
  solve(0);return cols
}
function isConnectedWithout(grid,N,skipR,skipC,reg){
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]];let start=-1,size=0
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]!==reg)continue;size++;if(!(r===skipR&&c===skipC)&&start===-1)start=r*N+c}
  if(size<=2||start===-1)return false
  const visited=new Set([start]),queue=[start]
  while(queue.length>0){const cur=queue.shift(),r=Math.floor(cur/N),c=cur%N;for(const[dr,dc]of DIRS){const nr=r+dr,nc=c+dc;if(nr<0||nr>=N||nc<0||nc>=N)continue;const nidx=nr*N+nc;if(!visited.has(nidx)&&grid[nr][nc]===reg&&!(nr===skipR&&nc===skipC)){visited.add(nidx);queue.push(nidx)}}}
  return visited.size===size-1
}
function combinations(arr,k){if(k===0)return[[]];if(k>arr.length)return[];const r=[];for(let i=0;i<=arr.length-k;i++)for(const rest of combinations(arr.slice(i+1),k-1))r.push([arr[i],...rest]);return r}
function canSolveLogically(regions,N){
  const cands=Array.from({length:N},()=>[])
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)cands[regions[r][c]].push(r*N+c)
  const ROW=cell=>Math.floor(cell/N),COL=cell=>cell%N
  let anyChange=true,strategiesUsed=0
  while(anyChange){
    anyChange=false
    for(let reg=0;reg<N;reg++){if(cands[reg].length===0)return{solved:false,strategiesUsed,unsolvedCount:N};if(cands[reg].length!==1)continue;const cr=ROW(cands[reg][0]),cc=COL(cands[reg][0]);for(let other=0;other<N;other++){if(other===reg)continue;const before=cands[other].length;cands[other]=cands[other].filter(cell=>{const r2=ROW(cell),c2=COL(cell);return r2!==cr&&c2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2-cc)<=1)});if(cands[other].length<before){anyChange=true;strategiesUsed|=1}}}
    const rowSpan=cands.map(cs=>new Set(cs.map(ROW))),colSpan=cands.map(cs=>new Set(cs.map(COL)))
    const regsInRow=Array.from({length:N},()=>[]),regsInCol=Array.from({length:N},()=>[])
    for(let reg=0;reg<N;reg++){if(cands[reg].length<=1)continue;for(const r of rowSpan[reg])regsInRow[r].push(reg);for(const c of colSpan[reg])regsInCol[c].push(reg)}
    const unplaced=Array.from({length:N},(_,i)=>i).filter(r=>cands[r].length>1)
    for(const axis of[0,1]){const span=axis===0?rowSpan:colSpan,regsInAxis=axis===0?regsInRow:regsInCol,axisOf=axis===0?ROW:COL;for(let k=2;k<unplaced.length;k++)for(const subset of combinations(unplaced,k)){const unionK=new Set(subset.flatMap(reg=>[...span[reg]]));if(unionK.size!==k)continue;const subSet=new Set(subset);for(let other=0;other<N;other++){if(subSet.has(other))continue;const before=cands[other].length;cands[other]=cands[other].filter(cell=>!unionK.has(axisOf(cell)));if(cands[other].length<before){anyChange=true;strategiesUsed|=2}}};const activeAxis=Array.from({length:N},(_,i)=>i).filter(a=>regsInAxis[a].length>0);for(let k=2;k<unplaced.length;k++)for(const axisSub of combinations(activeAxis,k)){const regsIn=[...new Set(axisSub.flatMap(a=>regsInAxis[a]))];if(regsIn.length!==k)continue;const axisSet=new Set(axisSub);for(const reg of regsIn){const before=cands[reg].length;cands[reg]=cands[reg].filter(cell=>axisSet.has(axisOf(cell)));if(cands[reg].length<before){anyChange=true;strategiesUsed|=4}}}}
    if(anyChange)continue
    for(let reg=0;reg<N;reg++){if(cands[reg].length===0)continue;const rows=cands[reg].map(ROW),cols=cands[reg].map(COL);const minR=Math.min(...rows),maxR=Math.max(...rows),minC=Math.min(...cols),maxC=Math.max(...cols);if(maxR-minR>1||maxC-minC>1)continue;for(let other=0;other<N;other++){if(other===reg)continue;const before=cands[other].length;cands[other]=cands[other].filter(cell=>{const r=ROW(cell),c=COL(cell);return!(r>=minR&&r<=maxR&&c>=minC&&c<=maxC)});if(cands[other].length<before){anyChange=true;strategiesUsed|=8}}}
    if(anyChange)continue
    for(let reg=0;reg<N&&!anyChange;reg++)for(let ci=0;ci<cands[reg].length&&!anyChange;ci++){const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell);for(let other=0;other<N&&!anyChange;other++){if(other===reg||cands[other].length===0)continue;const survivors=cands[other].filter(c2=>{const r2=ROW(c2),col2=COL(c2);return r2!==cr&&col2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(col2-cc)<=1)});if(survivors.length===0){const before=cands[reg].length;cands[reg]=cands[reg].filter(c=>c!==cell);if(cands[reg].length<before){anyChange=true;strategiesUsed|=16}}}}
  }
  return{solved:cands.every(c=>c.length===1),strategiesUsed,unsolvedCount:cands.filter(c=>c.length>1).length}
}
function spanScore(grid,N){const rows=Array.from({length:N},()=>new Set()),cols=Array.from({length:N},()=>new Set());for(let r=0;r<N;r++)for(let c=0;c<N;c++){rows[grid[r][c]].add(r);cols[grid[r][c]].add(c)};let s=0;for(let reg=0;reg<N;reg++)s+=rows[reg].size+cols[reg].size;return s}
function growRegionsBalanced(N,seeds,rng){
  const smallCap=Math.floor(N*0.6),largeCap=Math.floor(N*1.8)
  const shuffledIds=shuffle(Array.from({length:N},(_,i)=>i),rng)
  const isSmall=new Set(shuffledIds.slice(0,Math.floor(N/2)))
  const constraintType=new Array(N),minRow=new Array(N).fill(0),maxRow=new Array(N).fill(N-1),minCol=new Array(N).fill(0),maxCol=new Array(N).fill(N-1)
  const bandWidth=Math.floor(N*0.6)
  for(let id=0;id<N;id++){const roll=rng();if(roll<0.25){constraintType[id]='row';const h=Math.floor(bandWidth/2);minRow[id]=Math.max(0,seeds[id].r-h);maxRow[id]=Math.min(N-1,seeds[id].r+h)}else if(roll<0.5){constraintType[id]='col';const h=Math.floor(bandWidth/2);minCol[id]=Math.max(0,seeds[id].c-h);maxCol[id]=Math.min(N-1,seeds[id].c+h)}else constraintType[id]='none'}
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]],grid=Array.from({length:N},()=>Array(N).fill(-1)),sizes=Array(N).fill(1)
  seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  let frontier=shuffle(seeds.map((s,id)=>({...s,id})),rng)
  while(frontier.length>0){const idx=Math.floor(rng()*frontier.length),entry=frontier[idx];frontier[idx]=frontier[frontier.length-1];frontier.pop();const{r,c,id}=entry;for(const[dr,dc]of shuffle([...DIRS],rng)){const nr=r+dr,nc=c+dc;if(nr<0||nr>=N||nc<0||nc>=N||grid[nr][nc]!==-1)continue;const cap=isSmall.has(id)?smallCap:largeCap;if(sizes[id]>=cap)continue;if(constraintType[id]==='row'&&(nr<minRow[id]||nr>maxRow[id]))continue;if(constraintType[id]==='col'&&(nc<minCol[id]||nc>maxCol[id]))continue;grid[nr][nc]=id;sizes[id]++;frontier.push({r:nr,c:nc,id})}}
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]!==-1)continue;let best=0,bestDist=Infinity;for(let id=0;id<N;id++){const d=Math.abs(r-seeds[id].r)+Math.abs(c-seeds[id].c);if(d<bestDist){bestDist=d;best=id}}grid[r][c]=best;sizes[best]++}
  return grid
}

// SA with optional size cap
function runSA(initialGrid,solution,N,rng,maxIter,maxRegionSize){
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]],T_START=6.0,T_MIN=0.05,COOLING=0.998
  const grid=initialGrid.map(row=>[...row])
  const sizes=Array(N).fill(0);for(let r=0;r<N;r++)for(let c=0;c<N;c++)sizes[grid[r][c]]++
  let score=spanScore(grid,N),bestScore=score,bestGrid=grid.map(r=>[...r]),T=T_START
  for(let iter=0;iter<maxIter;iter++){
    T=Math.max(T_MIN,T*COOLING)
    const r=Math.floor(rng()*N),c=Math.floor(rng()*N),from=grid[r][c]
    if(solution[from].r===r&&solution[from].c===c)continue
    const[dr,dc]=DIRS[Math.floor(rng()*4)];const nr=r+dr,nc=c+dc
    if(nr<0||nr>=N||nc<0||nc>=N)continue
    const to=grid[nr][nc];if(to===from)continue
    if(maxRegionSize&&sizes[to]>=maxRegionSize)continue
    if(!isConnectedWithout(grid,N,r,c,from))continue
    grid[r][c]=to;sizes[from]--;sizes[to]++
    const ns=spanScore(grid,N),delta=ns-score
    if(delta<=0||rng()<Math.exp(-delta/T)){score=ns;if(score<bestScore){bestScore=score;bestGrid=grid.map(r=>[...r])}}
    else{grid[r][c]=from;sizes[from]++;sizes[to]--}
  }
  return bestGrid
}

const N=10,TRIALS=200
function test(label, fn) {
  let solved=0,strat2=0;const t0=Date.now()
  for(let i=0;i<TRIALS;i++){const r=fn(i);if(r&&r.solved){solved++;if(r.sc>=2)strat2++}}
  console.log(`${label}: solved=${solved}/${TRIALS} strat2=${strat2}/${TRIALS} time=${Date.now()-t0}ms`)
}

// A: balanced flood-fill only (baseline)
test('A: balanced flood-fill only', i=>{
  const rng=makeRng(i*6271+17);const cats=findPlacement(N,rng).map((c,r)=>({r,c}))
  const g=growRegionsBalanced(N,cats,rng);const res=canSolveLogically(g,N)
  return{solved:res.solved,sc:res.strategiesUsed.toString(2).split('1').length-1}
})

// B: balanced + SA 3000 steps no cap
test('B: balanced + SA(3000 no cap)', i=>{
  const rng=makeRng(i*6271+17);const cats=findPlacement(N,rng).map((c,r)=>({r,c}))
  const g=growRegionsBalanced(N,cats,rng);const g2=runSA(g,cats,N,rng,3000,null)
  const res=canSolveLogically(g2,N);return{solved:res.solved,sc:res.strategiesUsed.toString(2).split('1').length-1}
})

// C: balanced + SA 3000 steps cap=30
test('C: balanced + SA(3000 cap=30)', i=>{
  const rng=makeRng(i*6271+17);const cats=findPlacement(N,rng).map((c,r)=>({r,c}))
  const g=growRegionsBalanced(N,cats,rng);const g2=runSA(g,cats,N,rng,3000,30)
  const res=canSolveLogically(g2,N);return{solved:res.solved,sc:res.strategiesUsed.toString(2).split('1').length-1}
})

// D: plain voronoi + SA 3000 steps no cap (old approach)
function growVoronoi(N,seeds,rng){
  const grid=Array.from({length:N},()=>Array(N).fill(-1));seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]];let frontier=seeds.map((s,id)=>({...s,id}))
  while(frontier.length>0){const idx=Math.floor(rng()*frontier.length),e=frontier[idx];frontier[idx]=frontier[frontier.length-1];frontier.pop();const{r,c,id}=e;for(const[dr,dc]of shuffle([...DIRS],rng)){const nr=r+dr,nc=c+dc;if(nr<0||nr>=N||nc<0||nc>=N||grid[nr][nc]!==-1)continue;grid[nr][nc]=id;frontier.push({r:nr,c:nc,id})}}
  return grid
}
test('D: voronoi + SA(3000 no cap) [old]', i=>{
  const rng=makeRng(i*6271+17);const cats=findPlacement(N,rng).map((c,r)=>({r,c}))
  const g=growVoronoi(N,cats,rng);const g2=runSA(g,cats,N,rng,3000,null)
  const res=canSolveLogically(g2,N);return{solved:res.solved,sc:res.strategiesUsed.toString(2).split('1').length-1}
})

// E: balanced + SA 3000 steps cap=25
test('E: balanced + SA(3000 cap=25)', i=>{
  const rng=makeRng(i*6271+17);const cats=findPlacement(N,rng).map((c,r)=>({r,c}))
  const g=growRegionsBalanced(N,cats,rng);const g2=runSA(g,cats,N,rng,3000,25)
  const res=canSolveLogically(g2,N);return{solved:res.solved,sc:res.strategiesUsed.toString(2).split('1').length-1}
})
