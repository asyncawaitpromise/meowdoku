// Quick benchmark: growMultiBlob solvability rate
// 1 singleton + 2 doublets + 4 triples + 3 medium regions (competitive BFS)

function makeRng(seed) {
  let s=seed|0;return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}
}
function shuffle(arr,rng){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]};return a}
function combinations(arr,k){if(k===0)return[[]];;if(k>arr.length)return[];const r=[];for(let i=0;i<=arr.length-k;i++)for(const rest of combinations(arr.slice(i+1),k-1))r.push([arr[i],...rest]);return r}
function findPlacement(N,rng){const cols=[],used=new Set();function s(row){if(row===N)return true;const c=shuffle(Array.from({length:N},(_,i)=>i).filter(c=>{if(used.has(c))return false;if(row>0&&Math.abs(c-cols[row-1])<2)return false;return true}),rng);for(const cc of c){cols[row]=cc;used.add(cc);if(s(row+1))return true;cols.pop();used.delete(cc)}return false};s(0);return cols}

function canSolve(regions,N,useFC){
  const cands=Array.from({length:N},()=>[])
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)cands[regions[r][c]].push(r*N+c)
  const ROW=cell=>Math.floor(cell/N),COL=cell=>cell%N
  let anyChange=true,used=0
  const runStrats=()=>{
    let ch=true
    while(ch){
      ch=false
      for(let reg=0;reg<N;reg++){if(cands[reg].length===0)return false;if(cands[reg].length!==1)continue;const cr=ROW(cands[reg][0]),cc=COL(cands[reg][0]);for(let o=0;o<N;o++){if(o===reg)continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>{const r2=ROW(cell),c2=COL(cell);return r2!==cr&&c2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2-cc)<=1)});if(cands[o].length<b){ch=true;used|=1}}}
      const rS=cands.map(cs=>new Set(cs.map(ROW))),cS=cands.map(cs=>new Set(cs.map(COL)))
      const rIR=Array.from({length:N},()=>[]),rIC=Array.from({length:N},()=>[])
      for(let reg=0;reg<N;reg++){if(cands[reg].length<=1)continue;for(const r of rS[reg])rIR[r].push(reg);for(const c of cS[reg])rIC[c].push(reg)}
      const unp=Array.from({length:N},(_,i)=>i).filter(r=>cands[r].length>1)
      for(const axis of[0,1]){const sp=axis===0?rS:cS,rIA=axis===0?rIR:rIC,aOf=axis===0?ROW:COL
        for(let k=1;k<unp.length&&!ch;k++){for(const sub of combinations(unp,k)){const uK=new Set(sub.flatMap(r=>[...sp[r]]));if(uK.size!==k)continue;const sS=new Set(sub);for(let o=0;o<N;o++){if(sS.has(o))continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>!uK.has(aOf(cell)));if(cands[o].length<b){ch=true;used|=2}}}}
        const aA=Array.from({length:N},(_,i)=>i).filter(a=>rIA[a].length>0)
        for(let k=1;k<unp.length&&!ch;k++){for(const aS of combinations(aA,k)){const rIn=[...new Set(aS.flatMap(a=>rIA[a]))];if(rIn.length!==k)continue;const aSet=new Set(aS);for(const reg of rIn){const b=cands[reg].length;cands[reg]=cands[reg].filter(cell=>aSet.has(aOf(cell)));if(cands[reg].length<b){ch=true;used|=4}}}}
      }
      if(ch)continue
      for(let reg=0;reg<N;reg++){if(cands[reg].length===0)continue;const rows=cands[reg].map(ROW),cols=cands[reg].map(COL);const mR=Math.min(...rows),MR=Math.max(...rows),mC=Math.min(...cols),MC=Math.max(...cols);if(MR-mR>1||MC-mC>1)continue;for(let o=0;o<N;o++){if(o===reg)continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>{const r=ROW(cell),c=COL(cell);return!(r>=mR&&r<=MR&&c>=mC&&c<=MC)});if(cands[o].length<b){ch=true;used|=8}}}
      if(ch)continue
      for(let reg=0;reg<N&&!ch;reg++){for(let ci=0;ci<cands[reg].length&&!ch;ci++){const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell);for(let o=0;o<N&&!ch;o++){if(o===reg||cands[o].length===0)continue;const surv=cands[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==cr&&c2c!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2c-cc)<=1)});if(surv.length===0){cands[reg]=cands[reg].filter(c=>c!==cell);ch=true;used|=16}}}}
    }
    return true
  }
  runStrats()
  if(cands.every(c=>c.length===1))return{solved:true,used}
  if(!useFC)return{solved:false,used}

  // FC
  let fcAny=true
  while(fcAny){
    fcAny=false
    runStrats()
    if(cands.every(c=>c.length===1))break
    for(let reg=0;reg<N&&!fcAny;reg++){
      if(cands[reg].length<=1)continue
      for(let ci=cands[reg].length-1;ci>=0&&!fcAny;ci--){
        const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell)
        const sim=cands.map(c=>[...c]);sim[reg]=[cell];let contra=false
        for(let o=0;o<N;o++){if(o===reg)continue;sim[o]=sim[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==cr&&c2c!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2c-cc)<=1)});if(sim[o].length===0){contra=true;break}}
        if(contra)continue
        // Run strats 1-5 in sim
        const savedCands=cands.map(c=>[...c])
        const tempCands=sim
        // Simplified: just run strategy 1 in sim for speed
        let sCh=true,sContra=false
        while(sCh&&!sContra){sCh=false;for(let sr=0;sr<N&&!sContra;sr++){if(tempCands[sr].length===0){sContra=true;break};if(tempCands[sr].length!==1)continue;const scr=ROW(tempCands[sr][0]),scc=COL(tempCands[sr][0]);for(let o=0;o<N;o++){if(o===sr)continue;const b=tempCands[o].length;tempCands[o]=tempCands[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==scr&&c2c!==scc&&!(Math.abs(r2-scr)<=1&&Math.abs(c2c-scc)<=1)});if(tempCands[o].length===0){sContra=true;break};if(tempCands[o].length<b)sCh=true}}}
        if(sContra){cands[reg]=cands[reg].filter(c=>c!==cell);fcAny=true;used|=32}
      }
    }
  }
  return{solved:cands.every(c=>c.length===1),used}
}

function maxSize(grid,N){const sz=Array(N).fill(0);for(let r=0;r<N;r++)for(let c=0;c<N;c++)sz[grid[r][c]]++;return Math.max(...sz)}

// growBalanced (blob) - current Phase 2
function growBlob(N,seeds,rng){
  const D=[[-1,0],[1,0],[0,-1],[0,1]];const grid=Array.from({length:N},()=>Array(N).fill(-1))
  seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  const sIds=shuffle(Array.from({length:N},(_,i)=>i),rng)
  const iD=new Set(sIds.slice(2,5)),iT=new Set(sIds.slice(5,9)),lId=sIds[9]
  for(const id of iD){const{r:sr,c:sc}=seeds[id];for(const[dr,dc]of shuffle([...D],rng)){const nr=sr+dr,nc=sc+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;break}}}
  for(const id of iT){const{r:sr,c:sc}=seeds[id];const q=[{r:sr,c:sc}];let g=0;for(let qi=0;qi<q.length&&g<2;qi++){const{r,c}=q[qi];for(const[dr,dc]of shuffle([...D],rng)){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;q.push({r:nr,c:nc});g++;break}}}}
  const bq=[{...seeds[lId]}];for(let qi=0;qi<bq.length;qi++){const{r,c}=bq[qi];for(const[dr,dc]of shuffle([...D],rng)){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=lId;bq.push({r:nr,c:nc})}}}
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]!==-1)continue;let b=-1,bD=Infinity;seeds.forEach(({r:sr,c:sc},sid)=>{const d=Math.abs(r-sr)+Math.abs(c-sc);if(d<bD){bD=d;b=sid}});grid[r][c]=b}
  return grid
}

// growMultiBlob - new Phase 2 attempt
function growMultiBlob(N,seeds,rng){
  const D=[[-1,0],[1,0],[0,-1],[0,1]];const grid=Array.from({length:N},()=>Array(N).fill(-1))
  seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  const N_SING=1,N_DOUB=2,N_TRIP=4
  const sIds=shuffle(Array.from({length:N},(_,i)=>i),rng)
  // isSing=sIds[0], isDoub=sIds[1..2], isTrip=sIds[3..6], mediumIds=sIds[7..9]
  const isDoub=new Set(sIds.slice(N_SING,N_SING+N_DOUB))
  const isTrip=new Set(sIds.slice(N_SING+N_DOUB,N_SING+N_DOUB+N_TRIP))
  const mediumIds=sIds.slice(N_SING+N_DOUB+N_TRIP)  // 3 medium seeds
  for(const id of isDoub){const{r:sr,c:sc}=seeds[id];for(const[dr,dc]of shuffle([...D],rng)){const nr=sr+dr,nc=sc+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;break}}}
  for(const id of isTrip){const{r:sr,c:sc}=seeds[id];const q=[{r:sr,c:sc}];let g=0;for(let qi=0;qi<q.length&&g<2;qi++){const{r,c}=q[qi];for(const[dr,dc]of shuffle([...D],rng)){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;q.push({r:nr,c:nc});g++;break}}}}
  // Competitive BFS for 3 mediums
  const frontiers=mediumIds.map(id=>[{...seeds[id]}])
  let anyF=true
  while(anyF){anyF=false;for(let mi=0;mi<mediumIds.length;mi++){const id=mediumIds[mi];const f=frontiers[mi];if(f.length===0)continue;const idx=Math.floor(rng()*f.length);const{r,c}=f[idx];f[idx]=f[f.length-1];f.pop();if(grid[r][c]!==-1)continue;grid[r][c]=id;anyF=true;for(const[dr,dc]of D){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1)f.push({r:nr,c:nc})}}}
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]!==-1)continue;let b=-1,bD=Infinity;seeds.forEach(({r:sr,c:sc},sid)=>{const d=Math.abs(r-sr)+Math.abs(c-sc);if(d<bD){bD=d;b=sid}});grid[r][c]=b}
  return grid
}

const N=10,TRIALS=300
function bench(label,growFn,useFC){
  let solved=0,multi=0,totalMaxSz=0;const t0=Date.now()
  for(let i=0;i<TRIALS;i++){
    const rng=makeRng(i*6271+42)
    const catCols=findPlacement(N,rng);const solution=catCols.map((c,r)=>({r,c}))
    const regions=growFn(N,solution,rng)
    totalMaxSz+=maxSize(regions,N)
    const res=canSolve(regions,N,useFC)
    if(res.solved){solved++;if((res.used&~1)!==0)multi++}  // multi = uses more than singleton
  }
  const ms=Date.now()-t0
  const p=n=>(100*n/TRIALS).toFixed(1)
  console.log(`${label}`)
  console.log(`  solved: ${solved}/${TRIALS} (${p(solved)}%)  multi-strat: ${multi}/${TRIALS} (${p(multi)}%)  avg max region: ${(totalMaxSz/TRIALS).toFixed(1)} cells  ${ms}ms`)
  return{solved,multi}
}

console.log(`=== MultiBlob Benchmark (N=${N}, ${TRIALS} trials) ===\n`)
const a=bench('Blob (current Phase 2)   + strats 1-5', growBlob, false)
const b=bench('Blob (current Phase 2)   + FC (strat 1 in sim)', growBlob, true)
const c=bench('MultiBlob (new)          + strats 1-5', growMultiBlob, false)
const d=bench('MultiBlob (new)          + FC (strat 1 in sim)', growMultiBlob, true)
console.log(`\nBlob multi-strat:      ${(100*a.multi/TRIALS).toFixed(1)}%  (${(100*b.multi/TRIALS).toFixed(1)}% with FC)`)
console.log(`MultiBlob multi-strat: ${(100*c.multi/TRIALS).toFixed(1)}%  (${(100*d.multi/TRIALS).toFixed(1)}% with FC)`)
