// Quick full-pipeline benchmark: 30 level seeds
// Mirrors the actual generateLevel() logic from levelGen.ts exactly.
// Reports Phase 1 vs Phase 2 win rate, blob rate, and strategy distribution.

function makeRng(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle(arr, rng) {
  const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}; return a
}
function combinations(arr,k){if(k===0)return[[]];;if(k>arr.length)return[];const r=[];for(let i=0;i<=arr.length-k;i++)for(const rest of combinations(arr.slice(i+1),k-1))r.push([arr[i],...rest]);return r}
function findPlacement(N,rng){
  const cols=[],used=new Set()
  function s(row){if(row===N)return true;const c=shuffle(Array.from({length:N},(_,i)=>i).filter(c=>{if(used.has(c))return false;if(row>0&&Math.abs(c-cols[row-1])<2)return false;return true}),rng);for(const cc of c){cols[row]=cc;used.add(cc);if(s(row+1))return true;cols.pop();used.delete(cc)}return false}
  s(0);return cols
}
function isConnectedWithout(grid,N,skipR,skipC,reg){
  const D=[[-1,0],[1,0],[0,-1],[0,1]];let st=-1,sz=0
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]!==reg)continue;sz++;if(!(r===skipR&&c===skipC)&&st===-1)st=r*N+c}
  if(sz<=1||st===-1)return false
  const vis=new Set([st]),q=[st]
  while(q.length>0){const cur=q.shift(),r=Math.floor(cur/N),c=cur%N;for(const[dr,dc]of D){const nr=r+dr,nc=c+dc;if(nr<0||nr>=N||nc<0||nc>=N)continue;const ni=nr*N+nc;if(!vis.has(ni)&&grid[nr][nc]===reg&&!(nr===skipR&&nc===skipC)){vis.add(ni);q.push(ni)}}}
  return vis.size===sz-1
}

function canSolveLogically(regions,N){
  const cands=Array.from({length:N},()=>[])
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)cands[regions[r][c]].push(r*N+c)
  const ROW=cell=>Math.floor(cell/N),COL=cell=>cell%N
  let anyChange=true,strategiesUsed=0
  while(anyChange){
    anyChange=false
    for(let reg=0;reg<N;reg++){
      if(cands[reg].length===0)return{solved:false,strategiesUsed,unsolvedCount:N}
      if(cands[reg].length!==1)continue
      const cr=ROW(cands[reg][0]),cc=COL(cands[reg][0])
      for(let o=0;o<N;o++){if(o===reg)continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>{const r2=ROW(cell),c2=COL(cell);return r2!==cr&&c2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2-cc)<=1)});if(cands[o].length<b){anyChange=true;strategiesUsed|=1}}
    }
    const rS=cands.map(cs=>new Set(cs.map(ROW))),cS=cands.map(cs=>new Set(cs.map(COL)))
    const rIR=Array.from({length:N},()=>[]),rIC=Array.from({length:N},()=>[])
    for(let reg=0;reg<N;reg++){if(cands[reg].length<=1)continue;for(const r of rS[reg])rIR[r].push(reg);for(const c of cS[reg])rIC[c].push(reg)}
    const unp=Array.from({length:N},(_,i)=>i).filter(r=>cands[r].length>1)
    for(const axis of[0,1]){
      const sp=axis===0?rS:cS,rIA=axis===0?rIR:rIC,aOf=axis===0?ROW:COL
      for(let k=1;k<unp.length;k++){for(const sub of combinations(unp,k)){const uK=new Set(sub.flatMap(reg=>[...sp[reg]]));if(uK.size!==k)continue;const sS=new Set(sub);for(let o=0;o<N;o++){if(sS.has(o))continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>!uK.has(aOf(cell)));if(cands[o].length<b){anyChange=true;strategiesUsed|=2}}}}
      const aA=Array.from({length:N},(_,i)=>i).filter(a=>rIA[a].length>0)
      for(let k=1;k<unp.length;k++){for(const aS of combinations(aA,k)){const rIn=[...new Set(aS.flatMap(a=>rIA[a]))];if(rIn.length!==k)continue;const aSet=new Set(aS);for(const reg of rIn){const b=cands[reg].length;cands[reg]=cands[reg].filter(cell=>aSet.has(aOf(cell)));if(cands[reg].length<b){anyChange=true;strategiesUsed|=4}}}}
    }
    if(anyChange)continue
    for(let reg=0;reg<N;reg++){if(cands[reg].length===0)continue;const rows=cands[reg].map(ROW),cols=cands[reg].map(COL);const mR=Math.min(...rows),MR=Math.max(...rows),mC=Math.min(...cols),MC=Math.max(...cols);if(MR-mR>1||MC-mC>1)continue;for(let o=0;o<N;o++){if(o===reg)continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>{const r=ROW(cell),c=COL(cell);return!(r>=mR&&r<=MR&&c>=mC&&c<=MC)});if(cands[o].length<b){anyChange=true;strategiesUsed|=8}}}
    if(anyChange)continue
    for(let reg=0;reg<N&&!anyChange;reg++){for(let ci=0;ci<cands[reg].length&&!anyChange;ci++){const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell);for(let o=0;o<N&&!anyChange;o++){if(o===reg||cands[o].length===0)continue;const surv=cands[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==cr&&c2c!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2c-cc)<=1)});if(surv.length===0){cands[reg]=cands[reg].filter(c=>c!==cell);anyChange=true;strategiesUsed|=16}}}}
    // Strategy 6: forcing chains
    if(!anyChange){
      for(let reg=0;reg<N&&!anyChange;reg++){
        if(cands[reg].length<=1)continue
        for(let ci=cands[reg].length-1;ci>=0&&!anyChange;ci--){
          const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell)
          const sim=cands.map(c=>[...c])
          sim[reg]=[cell];let contra=false
          for(let o=0;o<N;o++){if(o===reg)continue;sim[o]=sim[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==cr&&c2c!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2c-cc)<=1)});if(sim[o].length===0){contra=true;break}}
          if(contra)continue
          // run strat 1-5 in sim
          let sC=true,sContra=false
          while(sC&&!sContra){
            sC=false
            for(let sr=0;sr<N&&!sContra;sr++){if(sim[sr].length===0){sContra=true;break};if(sim[sr].length!==1)continue;const scr=ROW(sim[sr][0]),scc=COL(sim[sr][0]);for(let o=0;o<N;o++){if(o===sr)continue;const b=sim[o].length;sim[o]=sim[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==scr&&c2c!==scc&&!(Math.abs(r2-scr)<=1&&Math.abs(c2c-scc)<=1)});if(sim[o].length===0){sContra=true;break};if(sim[o].length<b)sC=true}}
            if(sContra||sC)continue
            const srS=sim.map(cs=>new Set(cs.map(ROW))),scS=sim.map(cs=>new Set(cs.map(COL)))
            const srIR=Array.from({length:N},()=>[]),srIC=Array.from({length:N},()=>[])
            for(let r=0;r<N;r++)for(let sR=0;sR<N;sR++){if(sim[sR].length<=1)continue;if(srS[sR].has(r))srIR[r].push(sR);if(scS[sR].has(r))srIC[r].push(sR)}
            const sUp=Array.from({length:N},(_,i)=>i).filter(r=>sim[r].length>1)
            for(const axis of[0,1]){
              const sp=axis===0?srS:scS,rIA=axis===0?srIR:srIC,aOf=axis===0?ROW:COL
              for(let k=1;k<sUp.length&&!sC&&!sContra;k++){
                for(const sub of combinations(sUp,k)){const uK=new Set(sub.flatMap(r=>[...sp[r]]));if(uK.size!==k)continue;const sS=new Set(sub);for(let o=0;o<N;o++){if(sS.has(o))continue;const b=sim[o].length;sim[o]=sim[o].filter(c2=>!uK.has(aOf(c2)));if(sim[o].length===0){sContra=true;break};if(sim[o].length<b)sC=true};if(sContra||sC)break}
                if(sContra||sC)break
                const aA=Array.from({length:N},(_,i)=>i).filter(a=>rIA[a].length>0)
                for(const aS of combinations(aA,k)){const rIn=[...new Set(aS.flatMap(a=>rIA[a]))];if(rIn.length!==k)continue;const aSet=new Set(aS);for(const r of rIn){const b=sim[r].length;sim[r]=sim[r].filter(c2=>aSet.has(aOf(c2)));if(sim[r].length===0){sContra=true;break};if(sim[r].length<b)sC=true};if(sContra||sC)break}
                if(sContra||sC)break
              }
              if(sContra||sC)break
            }
          }
          if(sContra){cands[reg]=cands[reg].filter(c=>c!==cell);anyChange=true;strategiesUsed|=32}
        }
      }
    }
  }
  const unsolvedCount=cands.filter(c=>c.length>1).length
  return{solved:cands.every(c=>c.length===1),strategiesUsed,unsolvedCount}
}

function difficultyScore(s){const W=[1,3,6,4,10,15];let sc=0;for(let i=0;i<W.length;i++)if(s&(1<<i))sc+=W[i];return sc}
function targetDifficulty(levelNum){if(levelNum<=3)return{min:1,max:6};if(levelNum<=8)return{min:4,max:14};if(levelNum<=15)return{min:7,max:35};return{min:12,max:100}}

function spanScore(grid,N){const rows=Array.from({length:N},()=>new Set()),cols=Array.from({length:N},()=>new Set());for(let r=0;r<N;r++)for(let c=0;c<N;c++){rows[grid[r][c]].add(r);cols[grid[r][c]].add(c)};let s=0;for(let reg=0;reg<N;reg++)s+=rows[reg].size+cols[reg].size;return s}

function growVoronoi(N,seeds,rng){
  const D=[[-1,0],[1,0],[0,-1],[0,1]];const grid=Array.from({length:N},()=>Array(N).fill(-1))
  seeds.forEach(({r,c},id)=>{grid[r][c]=id});let frontier=shuffle(seeds.map((s,id)=>({...s,id})),rng)
  while(frontier.length>0){const idx=Math.floor(rng()*frontier.length);const e=frontier[idx];frontier[idx]=frontier[frontier.length-1];frontier.pop();const{r,c,id}=e;for(const[dr,dc]of shuffle([...D],rng)){const nr=r+dr,nc=c+dc;if(nr<0||nr>=N||nc<0||nc>=N||grid[nr][nc]!==-1)continue;grid[nr][nc]=id;frontier.push({r:nr,c:nc,id})}}
  return grid
}

function hillClimbRegions(initialGrid,solution,N,rng){
  const D=[[-1,0],[1,0],[0,-1],[0,1]];const MAX=5000,TS=8,TM=0.05,CO=0.9985
  const grid=initialGrid.map(r=>[...r]);let score=spanScore(grid,N),best=score,bestG=grid.map(r=>[...r]),T=TS
  for(let i=0;i<MAX;i++){
    T=Math.max(TM,T*CO)
    if(i%200===0&&i>0){const r=canSolveLogically(bestG,N);const sc=r.strategiesUsed.toString(2).split('1').length-1;if(r.solved&&sc>=2)return bestG}
    const r=Math.floor(rng()*N),c=Math.floor(rng()*N);const from=grid[r][c]
    if(solution[from].r===r&&solution[from].c===c)continue
    const[dr,dc]=D[Math.floor(rng()*4)];const nr=r+dr,nc=c+dc
    if(nr<0||nr>=N||nc<0||nc>=N)continue;const to=grid[nr][nc];if(to===from)continue
    if(!isConnectedWithout(grid,N,r,c,from))continue
    grid[r][c]=to;const ns=spanScore(grid,N);const delta=ns-score
    if(delta<=0||rng()<Math.exp(-delta/T)){score=ns;if(score<best){best=score;bestG=grid.map(r=>[...r])}}else grid[r][c]=from
  }
  return bestG
}

function growBalanced(N,seeds,rng){
  const D=[[-1,0],[1,0],[0,-1],[0,1]];const grid=Array.from({length:N},()=>Array(N).fill(-1))
  seeds.forEach(({r,c},id)=>{grid[r][c]=id})
  const sIds=shuffle(Array.from({length:N},(_,i)=>i),rng)
  const iS=new Set(sIds.slice(0,2)),iD=new Set(sIds.slice(2,5)),iT=new Set(sIds.slice(5,9)),lId=sIds[9]
  for(const id of iD){const{r:sr,c:sc}=seeds[id];for(const[dr,dc]of shuffle([...D],rng)){const nr=sr+dr,nc=sc+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;break}}}
  for(const id of iT){const{r:sr,c:sc}=seeds[id];const q=[{r:sr,c:sc}];let g=0;for(let qi=0;qi<q.length&&g<2;qi++){const{r,c}=q[qi];for(const[dr,dc]of shuffle([...D],rng)){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1){grid[nr][nc]=id;q.push({r:nr,c:nc});g++;break}}}}
  const bS=seeds[lId];const bF=[];for(const[dr,dc]of D){const nr=bS.r+dr,nc=bS.c+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1)bF.push({r:nr,c:nc,dist:Math.abs(nr-bS.r)+Math.abs(nc-bS.c)})}
  while(bF.length>0){const s=bF.sort((a,b)=>b.dist-a.dist);const pi=Math.floor(rng()*Math.max(1,Math.ceil(s.length*0.4)));const{r:br,c:bc}=s.splice(pi,1)[0];if(grid[br][bc]!==-1)continue;grid[br][bc]=lId;for(const[dr,dc]of D){const nr=br+dr,nc=bc+dc;if(nr>=0&&nr<N&&nc>=0&&nc<N&&grid[nr][nc]===-1)bF.push({r:nr,c:nc,dist:Math.abs(nr-bS.r)+Math.abs(nc-bS.c)})}}
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(grid[r][c]!==-1)continue;let b=-1,bD=Infinity;seeds.forEach(({r:sr,c:sc},sid)=>{const d=Math.abs(r-sr)+Math.abs(c-sc);if(d<bD){bD=d;b=sid}});grid[r][c]=b}
  return grid
}

function maxRegionSize(grid,N){const sz=Array(N).fill(0);for(let r=0;r<N;r++)for(let c=0;c<N;c++)sz[grid[r][c]]++;return Math.max(...sz)}

// ── Full pipeline simulation ───────────────────────────────────────────────────
const N=10
const LEVELS=30

let p1wins=0,p2wins=0,p3wins=0,failures=0
let blobLevels=0,totalTime=0
const stratDist={}

console.log(`Simulating ${LEVELS} levels (mirrors generateLevel exactly)...\n`)

for(let levelNum=1;levelNum<=LEVELS;levelNum++){
  const BASE=levelNum*100003+17
  const{min:minScore,max:maxScore}=targetDifficulty(levelNum)
  let found=false,foundRegions=null,foundScore=0,usedBlob=false
  const t0=Date.now()

  // Phase 1: Voronoi + SA, 50 attempts
  for(let a=0;a<50&&!found;a++){
    const rng=makeRng(BASE+a*6271)
    const catCols=findPlacement(N,rng)
    const solution=catCols.map((c,r)=>({r,c}))
    const regions=hillClimbRegions(growVoronoi(N,solution,rng),solution,N,rng)
    const result=canSolveLogically(regions,N)
    const score=difficultyScore(result.strategiesUsed)
    if(result.solved&&score>=minScore&&score<=maxScore){
      found=true;p1wins++;foundRegions=regions;foundScore=score
      const mx=maxRegionSize(regions,N);if(mx>30)usedBlob=true
    }
  }

  // Phase 2: growBalanced, 500 attempts
  if(!found){
    for(let a=0;a<500&&!found;a++){
      const rng=makeRng(BASE+a*6271+1_000_000)
      const catCols=findPlacement(N,rng)
      const solution=catCols.map((c,r)=>({r,c}))
      const regions=growBalanced(N,solution,rng)
      const result=canSolveLogically(regions,N)
      const score=difficultyScore(result.strategiesUsed)
      if(result.solved&&score>=minScore&&score<=maxScore){
        found=true;p2wins++;foundRegions=regions;foundScore=score;usedBlob=true
      }
    }
  }

  // Phase 3: fallback, score>=4 only
  if(!found){
    for(let a=0;a<200&&!found;a++){
      const rng=makeRng(BASE+a*6271+2_000_000)
      const catCols=findPlacement(N,rng)
      const solution=catCols.map((c,r)=>({r,c}))
      const regions=growBalanced(N,solution,rng)
      const result=canSolveLogically(regions,N)
      const score=difficultyScore(result.strategiesUsed)
      if(result.solved&&score>=4){found=true;p3wins++;foundRegions=regions;foundScore=score;usedBlob=true}
    }
  }

  if(!found)failures++
  else{
    const mx=maxRegionSize(foundRegions,N);if(mx>30)blobLevels++
  }

  totalTime+=Date.now()-t0
  const tag=found?(usedBlob?'B':'V'):'F'
  process.stdout.write(`L${levelNum.toString().padStart(2)}[${tag}] `)
  if(levelNum%10===0)console.log()
}

console.log(`\n${'─'.repeat(50)}`)
console.log(`Phase 1 wins (Voronoi+SA): ${p1wins}/${LEVELS} (${(100*p1wins/LEVELS).toFixed(0)}%)`)
console.log(`Phase 2 wins (growBalanced): ${p2wins}/${LEVELS} (${(100*p2wins/LEVELS).toFixed(0)}%)`)
console.log(`Phase 3 wins (fallback):     ${p3wins}/${LEVELS} (${(100*p3wins/LEVELS).toFixed(0)}%)`)
console.log(`Failures:                    ${failures}/${LEVELS}`)
console.log(`Blob rate (maxSize>30):      ${blobLevels}/${LEVELS-failures} (${(100*blobLevels/Math.max(1,LEVELS-failures)).toFixed(0)}%)`)
console.log(`Avg time per level:          ${(totalTime/LEVELS).toFixed(0)}ms`)
