// Test hybrid configs: vary anchor count to allow multiple medium regions
// Key: nSing+nDoub+nTrip+nFree MUST equal N=10
function makeRng(seed) {
  let s=seed|0;return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}
}
function shuffle(arr,rng){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]};return a}
function findPlacement(N,rng){const cols=[],used=new Set();function s(row){if(row===N)return true;const c=shuffle(Array.from({length:N},(_,i)=>i).filter(c=>{if(used.has(c))return false;if(row>0&&Math.abs(c-cols[row-1])<2)return false;return true}),rng);for(const cc of c){cols[row]=cc;used.add(cc);if(s(row+1))return true;cols.pop();used.delete(cc)}return false};s(0);return cols}

function growConfig(N, seeds, rng, nS, nD, nT) {
  // nFree = N - nS - nD - nT; free regions grow size-balanced
  const nFree = N - nS - nD - nT
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]
  const grid = Array.from({length:N},()=>Array(N).fill(-1))
  seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  const shuffledIds = shuffle(Array.from({length:N},(_,i)=>i), rng)
  const isDoub = new Set(shuffledIds.slice(nS, nS+nD))
  const isTrip = new Set(shuffledIds.slice(nS+nD, nS+nD+nT))
  const freeIds = shuffledIds.slice(nS+nD+nT)  // exactly nFree items

  for(const id of isDoub){const{r:sr,c:sc}=seeds[id];for(const[dr,dc]of shuffle([...DIRS],rng)){const nr=sr+dr,nc=sc+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;break}}}
  for(const id of isTrip){const{r:sr,c:sc}=seeds[id];const q=[{r:sr,c:sc}];let g=0;for(let qi=0;qi<q.length&&g<2;qi++){const{r,c}=q[qi];for(const[dr,dc]of shuffle([...DIRS],rng)){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;q.push({r:nr,c:nc});g++;break}}}}

  // Initialize sizes from currently claimed cells
  const sizes = Array(N).fill(0)
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(grid[r][c]!==-1)sizes[grid[r][c]]++
  for(let id=0;id<N;id++)if(sizes[id]<1)sizes[id]=1
  const freeSet = new Set(freeIds)
  const frontiers = Array.from({length:N},()=>new Set())
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]===-1||!freeSet.has(grid[r][c]))continue;for(const[dr,dc]of DIRS){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1)frontiers[grid[r][c]].add(nr*N+nc)}}

  let remaining=0;for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(grid[r][c]===-1)remaining++
  while(remaining>0){
    const weights=freeIds.map(i=>frontiers[i].size>0?1/(sizes[i]*sizes[i]):0)
    const total=weights.reduce((a,b)=>a+b,0)
    if(total===0)break
    let rv=rng()*total;let chosen=freeIds[freeIds.length-1]
    for(let i=0;i<freeIds.length;i++){rv-=weights[i];if(rv<=0){chosen=freeIds[i];break}}
    const fArr=[...frontiers[chosen]]
    const cell=fArr[Math.floor(rng()*fArr.length)]
    frontiers[chosen].delete(cell)
    const cr=Math.floor(cell/N),cc=cell%N
    if(grid[cr][cc]!==-1)continue
    grid[cr][cc]=chosen;sizes[chosen]++;remaining--
    for(const[dr,dc]of DIRS){const nr=cr+dr,nc=cc+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1)frontiers[chosen].add(nr*N+nc)}
  }
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]!==-1)continue;let best=-1,bD=Infinity;seeds.forEach(({r:sr,c:sc},sid)=>{const d=Math.abs(r-sr)+Math.abs(c-sc);if(d<bD){bD=d;best=sid}});grid[r][c]=best}
  return grid
}

function countSolutions(regions,N,maxCount=2){
  const cands=Array.from({length:N},()=>[])
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)cands[regions[r][c]].push(r*N+c)
  const ROW=cell=>Math.floor(cell/N),COL=cell=>cell%N
  function propagate(c){let ch=true;while(ch){ch=false;for(let reg=0;reg<N;reg++){if(c[reg].length===0)return false;if(c[reg].length!==1)continue;const cr=ROW(c[reg][0]),cc=COL(c[reg][0]);for(let o=0;o<N;o++){if(o===reg)continue;const b=c[o].length;c[o]=c[o].filter(cell=>{const r2=ROW(cell),c2=COL(cell);return r2!==cr&&c2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2-cc)<=1)});if(c[o].length===0)return false;if(c[o].length<b)ch=true}}};return true}
  let count=0
  function dfs(c){if(count>=maxCount)return;let minLen=Infinity,minReg=-1;for(let reg=0;reg<N;reg++){if(c[reg].length===0)return;if(c[reg].length>1&&c[reg].length<minLen){minLen=c[reg].length;minReg=reg}};if(minReg===-1){count++;return};for(const cell of c[minReg]){const nc=c.map(x=>[...x]);nc[minReg]=[cell];const cr=ROW(cell),cc=COL(cell);let ok=true;for(let o=0;o<N;o++){if(o===minReg)continue;nc[o]=nc[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==cr&&c2c!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2c-cc)<=1)});if(nc[o].length===0){ok=false;break}};if(!ok)continue;if(propagate(nc))dfs(nc)}}
  const c=cands.map(x=>[...x]);if(!propagate(c))return 0;dfs(c);return count
}
function maxSz(regions,N){const s=Array(N).fill(0);for(let r=0;r<N;r++)for(let c=0;c<N;c++)s[regions[r][c]]++;return Math.max(...s)}

const N=10,TRIALS=300
function bench(label,nS,nD,nT){
  if(nS+nD+nT>=N){console.log(`SKIP ${label}: anchors=${nS+nD+nT} >= N`);return}
  let unique=0,totalMax=0;const t0=Date.now()
  for(let i=0;i<TRIALS;i++){
    const rng=makeRng(i*6271+42)
    const catCols=findPlacement(N,rng);const solution=catCols.map((c,r)=>({r,c}))
    const regions=growConfig(N,solution,rng,nS,nD,nT)
    totalMax+=maxSz(regions,N)
    if(countSolutions(regions,N,2)===1)unique++
  }
  const ms=Date.now()-t0
  const nFree=N-nS-nD-nT
  const anchorCells=nS+nD*2+nT*3
  const freeCells=N*N-anchorCells
  console.log(`${label} (${nFree} free, ~${(freeCells/nFree).toFixed(0)}c each): unique=${unique}/${TRIALS} (${(100*unique/TRIALS).toFixed(1)}%)  avgMaxSz=${(totalMax/TRIALS).toFixed(1)}  ${ms}ms`)
}

console.log('Anchor configs where nSing+nDoub+nTrip+nFree=10\n')
bench('2s+3d+4t+1free [baseline blob]', 2, 3, 4)    // 1 blob ~80c
bench('2s+3d+3t+2free [2 medium ~42c]', 2, 3, 3)   // 2 medium
bench('2s+3d+2t+3free [3 medium ~28c]', 2, 3, 2)   // 3 medium
bench('2s+2d+4t+2free [2 medium ~44c]', 2, 2, 4)   // 2 medium, 1 less doublet
bench('1s+2d+4t+3free [3 medium ~29c]', 1, 2, 4)   // 3 medium, 1 less sing
bench('2s+2d+3t+3free [3 medium ~31c]', 2, 2, 3)   // 3 medium
bench('1s+2d+3t+4free [4 medium ~22c]', 1, 2, 3)   // 4 medium
bench('2s+1d+4t+3free [3 medium ~30c]', 2, 1, 4)   // 3 medium
