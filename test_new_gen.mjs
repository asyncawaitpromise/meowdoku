// Standalone benchmark for the new growConstrainedSections pipeline
// All logic is inlined (no TS imports).

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────
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

// ── Cat placement (backtracking) ─────────────────────────────────────────────
function findPlacement(N, rng) {
  const cols = []
  const usedCols = new Set()
  function solve(row) {
    if (row === N) return true
    const candidates = shuffle(
      Array.from({ length: N }, (_, i) => i).filter(c => {
        if (usedCols.has(c)) return false
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) return false
        return true
      }),
      rng
    )
    for (const c of candidates) {
      cols[row] = c
      usedCols.add(c)
      if (solve(row + 1)) return true
      cols.pop()
      usedCols.delete(c)
    }
    return false
  }
  solve(0)
  return cols
}

// ── Combination helper ───────────────────────────────────────────────────────
function combinations(arr, k) {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
}

// ── Constraint-propagation solver (full, with FC) ────────────────────────────
function canSolveLogically(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = cell => Math.floor(cell / N)
  const COL = cell => cell % N

  let anyChange = true
  let strategiesUsed = 0
  let easySteps = 0
  let hardSteps = 0
  let rounds = 0

  while (anyChange) {
    anyChange = false

    // 1. Singleton propagation
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return { solved: false, strategiesUsed, unsolvedCount: N, easySteps, hardSteps, rounds, unsolvedRegions: [] }
      if (cands[reg].length !== 1) continue
      const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
      for (let other = 0; other < N; other++) {
        if (other === reg) continue
        const before = cands[other].length
        cands[other] = cands[other].filter(cell => {
          const r2 = ROW(cell), c2 = COL(cell)
          return r2 !== cr && c2 !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
        })
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 1; easySteps += before - cands[other].length }
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

      // 2. Naked subsets
      for (let k = 1; k < unplaced.length; k++) {
        for (const subset of combinations(unplaced, k)) {
          const unionK = new Set(subset.flatMap(reg => [...span[reg]]))
          if (unionK.size !== k) continue
          const subSet = new Set(subset)
          for (let other = 0; other < N; other++) {
            if (subSet.has(other)) continue
            const before = cands[other].length
            cands[other] = cands[other].filter(cell => !unionK.has(axisOf(cell)))
            if (cands[other].length < before) { anyChange = true; strategiesUsed |= 2; easySteps += before - cands[other].length }
          }
        }
      }

      // 3. Hidden subsets
      const activeAxis = Array.from({ length: N }, (_, i) => i).filter(a => regsInAxis[a].length > 0)
      for (let k = 1; k < unplaced.length; k++) {
        for (const axisSub of combinations(activeAxis, k)) {
          const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
          if (regsIn.length !== k) continue
          const axisSet = new Set(axisSub)
          for (const reg of regsIn) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(cell => axisSet.has(axisOf(cell)))
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4; easySteps += before - cands[reg].length }
          }
        }
      }
    }

    if (anyChange) continue

    // 4. Trap 2x2
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) continue
      const rows = cands[reg].map(ROW)
      const cols = cands[reg].map(COL)
      const minR = Math.min(...rows), maxR = Math.max(...rows)
      const minC = Math.min(...cols), maxC = Math.max(...cols)
      if (maxR - minR > 1 || maxC - minC > 1) continue
      for (let other = 0; other < N; other++) {
        if (other === reg) continue
        const before = cands[other].length
        cands[other] = cands[other].filter(cell => {
          const r = ROW(cell), c = COL(cell)
          return !(r >= minR && r <= maxR && c >= minC && c <= maxC)
        })
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 8; hardSteps += before - cands[other].length }
      }
    }

    if (anyChange) continue

    // 5. Region crowding
    for (let reg = 0; reg < N && !anyChange; reg++) {
      for (let ci = 0; ci < cands[reg].length && !anyChange; ci++) {
        const cell = cands[reg][ci]
        const cr = ROW(cell), cc = COL(cell)
        for (let other = 0; other < N && !anyChange; other++) {
          if (other === reg || cands[other].length === 0) continue
          const survivors = cands[other].filter(c2 => {
            const r2 = ROW(c2), col2 = COL(c2)
            return r2 !== cr && col2 !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(col2 - cc) <= 1)
          })
          if (survivors.length === 0) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(c => c !== cell)
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 16; hardSteps += before - cands[reg].length }
          }
        }
      }
    }

    // Strategy 8: X-Wing
    if (!anyChange) {
      const unresolved = Array.from({ length: N }, (_, i) => i).filter(r => cands[r].length > 1)
      for (let ri = 0; ri < N - 1 && !anyChange; ri++) {
        for (let rj = ri + 1; rj < N && !anyChange; rj++) {
          for (let ci = 0; ci < N - 1 && !anyChange; ci++) {
            for (let cj = ci + 1; cj < N && !anyChange; cj++) {
              const intersect = new Set([ri*N+ci, ri*N+cj, rj*N+ci, rj*N+cj])
              const locked = []
              for (const reg of unresolved) {
                if (cands[reg].every(cell => intersect.has(cell))) locked.push(reg)
              }
              if (locked.length !== 4) continue
              const lockedSet = new Set(locked)
              for (let other = 0; other < N; other++) {
                if (lockedSet.has(other)) continue
                const before = cands[other].length
                cands[other] = cands[other].filter(cell => !intersect.has(cell))
                if (cands[other].length < before) { anyChange = true; strategiesUsed |= 128; hardSteps += before - cands[other].length }
              }
            }
          }
        }
      }
    }

    // Strategy 6: Branch Rule
    if (!anyChange) {
      for (let reg = 0; reg < N && !anyChange; reg++) {
        if (cands[reg].length !== 2) continue
        const [cellA, cellB] = cands[reg]

        const runProp = (sim) => {
          let ch = true
          while (ch) {
            ch = false
            for (let sreg = 0; sreg < N; sreg++) {
              if (sim[sreg].length === 0) return false
              if (sim[sreg].length !== 1) continue
              const scr = ROW(sim[sreg][0]), scc = COL(sim[sreg][0])
              for (let o = 0; o < N; o++) {
                if (o === sreg) continue
                const before = sim[o].length
                sim[o] = sim[o].filter(c2 => {
                  const r2 = ROW(c2), c2c = COL(c2)
                  return r2 !== scr && c2c !== scc && !(Math.abs(r2 - scr) <= 1 && Math.abs(c2c - scc) <= 1)
                })
                if (sim[o].length === 0) return false
                if (sim[o].length < before) ch = true
              }
            }
          }
          return true
        }

        const applyPlace = (sim, r, id, cr, cc) => {
          sim[r] = [id]
          for (let o = 0; o < N; o++) {
            if (o === r) continue
            sim[o] = sim[o].filter(c2 => {
              const r2 = ROW(c2), c2c = COL(c2)
              return r2 !== cr && c2c !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
            })
            if (sim[o].length === 0) return false
          }
          return true
        }

        const simA = cands.map(c => [...c])
        const okA = applyPlace(simA, reg, cellA, ROW(cellA), COL(cellA)) && runProp(simA)

        const simB = cands.map(c => [...c])
        const okB = applyPlace(simB, reg, cellB, ROW(cellB), COL(cellB)) && runProp(simB)

        if (!okA && !okB) continue
        if (!okA) {
          const before = cands[reg].length
          cands[reg] = [cellB]; anyChange = true; strategiesUsed |= 64; hardSteps += before - 1; continue
        }
        if (!okB) {
          const before = cands[reg].length
          cands[reg] = [cellA]; anyChange = true; strategiesUsed |= 64; hardSteps += before - 1; continue
        }
        for (let other = 0; other < N && !anyChange; other++) {
          if (other === reg) continue
          const setA = new Set(simA[other])
          const setB = new Set(simB[other])
          const before = cands[other].length
          cands[other] = cands[other].filter(c => setA.has(c) || setB.has(c))
          if (cands[other].length < before) { anyChange = true; strategiesUsed |= 64; hardSteps += before - cands[other].length }
        }
      }
    }

    // Strategy 7: Forcing chains
    if (!anyChange) {
      for (let reg = 0; reg < N && !anyChange; reg++) {
        if (cands[reg].length <= 1) continue
        for (let ci = cands[reg].length - 1; ci >= 0 && !anyChange; ci--) {
          const cell = cands[reg][ci]
          const cr = ROW(cell), cc = COL(cell)
          const simCands = cands.map(c => [...c])
          simCands[reg] = [cell]
          let contradiction = false
          for (let other = 0; other < N; other++) {
            if (other === reg) continue
            simCands[other] = simCands[other].filter(c2 => {
              const r2 = ROW(c2), c2c = COL(c2)
              return r2 !== cr && c2c !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
            })
            if (simCands[other].length === 0) { contradiction = true; break }
          }
          if (contradiction) continue

          let simAnyChange = true
          while (simAnyChange && !contradiction) {
            simAnyChange = false
            for (let sreg = 0; sreg < N && !contradiction; sreg++) {
              if (simCands[sreg].length === 0) { contradiction = true; break }
              if (simCands[sreg].length !== 1) continue
              const scr = ROW(simCands[sreg][0]), scc = COL(simCands[sreg][0])
              for (let other = 0; other < N; other++) {
                if (other === sreg) continue
                const before = simCands[other].length
                simCands[other] = simCands[other].filter(c2 => {
                  const r2 = ROW(c2), c2c = COL(c2)
                  return r2 !== scr && c2c !== scc && !(Math.abs(r2 - scr) <= 1 && Math.abs(c2c - scc) <= 1)
                })
                if (simCands[other].length === 0) { contradiction = true; break }
                if (simCands[other].length < before) simAnyChange = true
              }
            }
            if (contradiction || simAnyChange) continue

            const sRowSpan = simCands.map(cs => new Set(cs.map(ROW)))
            const sColSpan = simCands.map(cs => new Set(cs.map(COL)))
            const sRegsInRow = Array.from({ length: N }, () => [])
            const sRegsInCol = Array.from({ length: N }, () => [])
            for (let r = 0; r < N; r++) {
              for (let sReg = 0; sReg < N; sReg++) {
                if (simCands[sReg].length <= 1) continue
                if (sRowSpan[sReg].has(r)) sRegsInRow[r].push(sReg)
                if (sColSpan[sReg].has(r)) sRegsInCol[r].push(sReg)
              }
            }
            const sUnplaced = Array.from({ length: N }, (_, i) => i).filter(r => simCands[r].length > 1)

            for (const axis of [0, 1]) {
              const span = axis === 0 ? sRowSpan : sColSpan
              const regsInAxis = axis === 0 ? sRegsInRow : sRegsInCol
              const axisOf = axis === 0 ? ROW : COL

              for (let k = 1; k < sUnplaced.length && !simAnyChange; k++) {
                for (const subset of combinations(sUnplaced, k)) {
                  const unionK = new Set(subset.flatMap(r => [...span[r]]))
                  if (unionK.size !== k) continue
                  const subSet = new Set(subset)
                  for (let other = 0; other < N; other++) {
                    if (subSet.has(other)) continue
                    const before = simCands[other].length
                    simCands[other] = simCands[other].filter(c2 => !unionK.has(axisOf(c2)))
                    if (simCands[other].length === 0) { contradiction = true; break }
                    if (simCands[other].length < before) simAnyChange = true
                  }
                  if (contradiction) break
                }
                if (contradiction || simAnyChange) break

                const activeAxis = Array.from({ length: N }, (_, i) => i).filter(a => regsInAxis[a].length > 0)
                for (const axisSub of combinations(activeAxis, k)) {
                  const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
                  if (regsIn.length !== k) continue
                  const axisSet = new Set(axisSub)
                  for (const r of regsIn) {
                    const before = simCands[r].length
                    simCands[r] = simCands[r].filter(c2 => axisSet.has(axisOf(c2)))
                    if (simCands[r].length === 0) { contradiction = true; break }
                    if (simCands[r].length < before) simAnyChange = true
                  }
                  if (contradiction || simAnyChange) break
                }
                if (contradiction || simAnyChange) break
              }
            }
            if (contradiction || simAnyChange) continue

            for (let sreg = 0; sreg < N && !simAnyChange && !contradiction; sreg++) {
              if (simCands[sreg].length === 0) continue
              const rows2 = simCands[sreg].map(ROW), cols2 = simCands[sreg].map(COL)
              const minR2 = Math.min(...rows2), maxR2 = Math.max(...rows2)
              const minC2 = Math.min(...cols2), maxC2 = Math.max(...cols2)
              if (maxR2 - minR2 > 1 || maxC2 - minC2 > 1) continue
              for (let other = 0; other < N; other++) {
                if (other === sreg) continue
                const before = simCands[other].length
                simCands[other] = simCands[other].filter(c2 => {
                  const r = ROW(c2), c = COL(c2)
                  return !(r >= minR2 && r <= maxR2 && c >= minC2 && c <= maxC2)
                })
                if (simCands[other].length === 0) { contradiction = true; break }
                if (simCands[other].length < before) simAnyChange = true
              }
            }
            if (contradiction || simAnyChange) continue

            for (let sreg = 0; sreg < N && !simAnyChange && !contradiction; sreg++) {
              for (let sci = 0; sci < simCands[sreg].length && !simAnyChange && !contradiction; sci++) {
                const scell = simCands[sreg][sci]
                const scr2 = ROW(scell), scc2 = COL(scell)
                for (let other = 0; other < N && !simAnyChange && !contradiction; other++) {
                  if (other === sreg || simCands[other].length === 0) continue
                  const survivors = simCands[other].filter(c2 => {
                    const r2 = ROW(c2), c2c = COL(c2)
                    return r2 !== scr2 && c2c !== scc2 && !(Math.abs(r2 - scr2) <= 1 && Math.abs(c2c - scc2) <= 1)
                  })
                  if (survivors.length === 0) {
                    const before = simCands[sreg].length
                    simCands[sreg] = simCands[sreg].filter(c => c !== scell)
                    if (simCands[sreg].length === 0) contradiction = true
                    if (simCands[sreg].length < before) simAnyChange = true
                  }
                }
              }
            }
          }

          if (contradiction) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(c => c !== cell)
            anyChange = true
            strategiesUsed |= 32
            hardSteps += before - cands[reg].length
          }
        }
      }
    }
    if (anyChange) rounds++
  }

  const unsolvedRegions = []
  for (let reg = 0; reg < N; reg++) if (cands[reg].length > 1) unsolvedRegions.push(reg)
  const unsolvedCount = unsolvedRegions.length
  return { solved: unsolvedCount === 0, strategiesUsed, unsolvedCount, easySteps, hardSteps, rounds, unsolvedRegions }
}

// ── Fast solver (strats 1-5 only, no FC) ─────────────────────────────────────
function canSolveFast(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[regions[r][c]].push(r * N + c)
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N
  let anyChange = true, strategiesUsed = 0, easySteps = 0, hardSteps = 0, rounds = 0
  while (anyChange) {
    anyChange = false
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return { solved: false, unsolvedCount: N }
      if (cands[reg].length !== 1) continue
      const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
      for (let o = 0; o < N; o++) { if (o === reg) continue; const b = cands[o].length; cands[o] = cands[o].filter(cell => { const r2=ROW(cell),c2=COL(cell); return r2!==cr&&c2!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2-cc)<=1) }); if(cands[o].length<b){anyChange=true;strategiesUsed|=1;easySteps+=b-cands[o].length} }
    }
    const rS=cands.map(cs=>new Set(cs.map(ROW))),cS=cands.map(cs=>new Set(cs.map(COL)))
    const rIR=Array.from({length:N},()=>[]),rIC=Array.from({length:N},()=>[])
    for(let reg=0;reg<N;reg++){if(cands[reg].length<=1)continue;for(const r of rS[reg])rIR[r].push(reg);for(const c of cS[reg])rIC[c].push(reg)}
    const unp=Array.from({length:N},(_,i)=>i).filter(r=>cands[r].length>1)
    for(const axis of[0,1]){const sp=axis===0?rS:cS,rIA=axis===0?rIR:rIC,aOf=axis===0?ROW:COL
      for(let k=1;k<unp.length;k++){for(const sub of combinations(unp,k)){const uK=new Set(sub.flatMap(r=>[...sp[r]]));if(uK.size!==k)continue;const sS=new Set(sub);for(let o=0;o<N;o++){if(sS.has(o))continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>!uK.has(aOf(cell)));if(cands[o].length<b){anyChange=true;strategiesUsed|=2;easySteps+=b-cands[o].length}}}}
      const aA=Array.from({length:N},(_,i)=>i).filter(a=>rIA[a].length>0)
      for(let k=1;k<unp.length;k++){for(const aS of combinations(aA,k)){const rIn=[...new Set(aS.flatMap(a=>rIA[a]))];if(rIn.length!==k)continue;const aSet=new Set(aS);for(const reg of rIn){const b=cands[reg].length;cands[reg]=cands[reg].filter(cell=>aSet.has(aOf(cell)));if(cands[reg].length<b){anyChange=true;strategiesUsed|=4;easySteps+=b-cands[reg].length}}}}
    }
    if(anyChange)continue
    for(let reg=0;reg<N;reg++){if(cands[reg].length===0)continue;const rows=cands[reg].map(ROW),cols=cands[reg].map(COL);const mR=Math.min(...rows),MR=Math.max(...rows),mC=Math.min(...cols),MC=Math.max(...cols);if(MR-mR>1||MC-mC>1)continue;for(let o=0;o<N;o++){if(o===reg)continue;const b=cands[o].length;cands[o]=cands[o].filter(cell=>{const r=ROW(cell),c=COL(cell);return!(r>=mR&&r<=MR&&c>=mC&&c<=MC)});if(cands[o].length<b){anyChange=true;strategiesUsed|=8;hardSteps+=b-cands[o].length}}}
    if(anyChange)continue
    for(let reg=0;reg<N&&!anyChange;reg++){for(let ci=0;ci<cands[reg].length&&!anyChange;ci++){const cell=cands[reg][ci],cr=ROW(cell),cc=COL(cell);for(let o=0;o<N&&!anyChange;o++){if(o===reg||cands[o].length===0)continue;const surv=cands[o].filter(c2=>{const r2=ROW(c2),c2c=COL(c2);return r2!==cr&&c2c!==cc&&!(Math.abs(r2-cr)<=1&&Math.abs(c2c-cc)<=1)});if(surv.length===0){cands[reg]=cands[reg].filter(c=>c!==cell);anyChange=true;strategiesUsed|=16;hardSteps++}}}}
    if(anyChange)rounds++
  }
  const unsolvedCount=cands.filter(c=>c.length>1).length
  return { solved: unsolvedCount===0, unsolvedCount, strategiesUsed, easySteps, hardSteps, rounds }
}

// ── Difficulty score ─────────────────────────────────────────────────────────
function difficultyScore(strategiesUsed, easySteps, hardSteps, rounds) {
  const WEIGHTS = [1, 3, 6, 4, 10, 15, 8, 7]
  let score = 0
  for (let i = 0; i < WEIGHTS.length; i++)
    if (strategiesUsed & (1 << i)) score += WEIGHTS[i]
  score += Math.log2(easySteps + 1) * 0.3
  score += Math.log2(hardSteps + 1) * 0.8
  score += rounds * 0.4
  return Math.round(score * 10) / 10
}

// ── Boundary count ───────────────────────────────────────────────────────────
function boundaryCount(grid, N) {
  let count = 0
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      if (c + 1 < N && grid[r][c] !== grid[r][c + 1]) count++
      if (r + 1 < N && grid[r][c] !== grid[r + 1][c]) count++
    }
  return count
}

// ── Corridor check ───────────────────────────────────────────────────────────
function hasCorridor(grid, N) {
  const rows = Array.from({ length: N }, () => new Set())
  const cols = Array.from({ length: N }, () => new Set())
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const reg = grid[r][c]
      rows[reg].add(r)
      cols[reg].add(c)
      sizes[reg]++
    }
  for (let reg = 0; reg < N; reg++) {
    const rSpan = rows[reg].size
    const cSpan = cols[reg].size
    if (sizes[reg] <= 4) continue
    const fillRatio = sizes[reg] / (rSpan * cSpan)
    if (fillRatio < 0.28 && (rSpan >= 4 || cSpan >= 4)) return true
  }
  return false
}

// ── Solution count (DFS backtracking) ───────────────────────────────────────
function countSolutions(regions, N, maxCount = 2) {
  const initCands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      initCands[regions[r][c]].push(r * N + c)

  const ROW = cell => Math.floor(cell / N)
  const COL = cell => cell % N

  const propagate = (cands) => {
    let ch = true
    while (ch) {
      ch = false
      for (let reg = 0; reg < N; reg++) {
        if (cands[reg].length === 0) return false
        if (cands[reg].length !== 1) continue
        const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
        for (let o = 0; o < N; o++) {
          if (o === reg) continue
          const prev = cands[o].length
          cands[o] = cands[o].filter(cell => {
            const r2 = ROW(cell), c2 = COL(cell)
            return r2 !== cr && c2 !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
          })
          if (cands[o].length === 0) return false
          if (cands[o].length < prev) ch = true
        }
      }
    }
    return true
  }

  let count = 0

  const dfs = (cands) => {
    if (count >= maxCount) return
    let minLen = Infinity, minReg = -1
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return
      if (cands[reg].length === 1) continue
      if (cands[reg].length < minLen) { minLen = cands[reg].length; minReg = reg }
    }
    if (minReg === -1) { count++; return }

    for (const cell of cands[minReg]) {
      if (count >= maxCount) return
      const cr = ROW(cell), cc = COL(cell)
      const next = cands.map(c => [...c])
      next[minReg] = [cell]
      let ok = true
      for (let o = 0; o < N; o++) {
        if (o === minReg) continue
        next[o] = next[o].filter(c2 => {
          const r2 = ROW(c2), c2c = COL(c2)
          return r2 !== cr && c2c !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
        })
        if (next[o].length === 0) { ok = false; break }
      }
      if (ok && propagate(next)) dfs(next)
    }
  }

  if (!propagate(initCands)) return 0
  dfs(initCands)
  return count
}

// ── minBoundaries ────────────────────────────────────────────────────────────
function minBoundaries(levelNum) {
  if (levelNum <= 3)  return 40
  if (levelNum <= 8)  return 50
  return 55
}

// ── targetDifficulty ─────────────────────────────────────────────────────────
// minStratBit: any set bit in strategiesUsed & minStratBit must be non-zero.
// Bit 4 (16)=crowding, Bit 5 (32)=FC, Bit 6 (64)=Branch Rule.
function targetDifficulty(levelNum) {
  if (levelNum <= 3)  return { minScore: 1,  maxScore: 14,  minSteps: 10, minHardSteps: 0, minRounds: 0, minStratBit: 0  }
  if (levelNum <= 8)  return { minScore: 6,  maxScore: 25,  minSteps: 20, minHardSteps: 0, minRounds: 1, minStratBit: 0  }
  if (levelNum <= 15) return { minScore: 10, maxScore: 50,  minSteps: 40, minHardSteps: 1, minRounds: 1, minStratBit: 16 }
  return             { minScore: 15, maxScore: 300, minSteps: 50, minHardSteps: 2, minRounds: 1, minStratBit: 16 }
}

// ── growSizeBalanced (hybrid: 8 anchor regions + 2 free medium regions) ──────
function growSizeBalanced(N, seeds, rng) {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const N_SING = 2, N_DOUB = 3, N_TRIP = 3
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const freeIds = shuffledIds.slice(N_SING + N_DOUB + N_TRIP)

  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) { grid[nr][nc] = id; break }
    }
  }

  for (const id of isTrip) {
    const { r: sr, c: sc } = seeds[id]
    let r1 = -1, c1 = -1
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) { grid[nr][nc] = id; r1 = nr; c1 = nc; break }
    }
    if (r1 !== -1) {
      const bases = rng() < 0.6 ? [{ r: r1, c: c1 }, { r: sr, c: sc }] : [{ r: sr, c: sc }, { r: r1, c: c1 }]
      for (const { r: br, c: bc } of bases) {
        let found = false
        for (const [dr, dc] of shuffle([...DIRS], rng)) {
          const nr = br + dr, nc = bc + dc
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) { grid[nr][nc] = id; found = true; break }
        }
        if (found) break
      }
    }
  }

  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  const half = N / 2
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cellQ = (r < half ? 0 : 2) + (c < half ? 0 : 1)
      let bestDist = Infinity, bestId = -1
      for (const id of freeIds) {
        const { r: sr, c: sc } = seeds[id]
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; bestId = id }
      }
      if (bestId !== -1) {
        const { r: sr, c: sc } = seeds[bestId]
        const seedQ = (sr < half ? 0 : 2) + (sc < half ? 0 : 1)
        if (cellQ === seedQ) cellPrio[r * N + c] = Math.min(1.0, cellPrio[r * N + c] + 0.3)
      }
    }
  }

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] !== -1) sizes[grid[r][c]]++
  for (let id = 0; id < N; id++) if (sizes[id] < 1) sizes[id] = 1

  const freeSet = new Set(freeIds)
  const frontierMaps = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] === -1 || !freeSet.has(grid[r][c])) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        frontierMaps[grid[r][c]].set(nr * N + nc, cellPrio[nr * N + nc])
    }
  }

  let remaining = 0
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    const weights = freeIds.map(i => frontierMaps[i].size > 0 ? 1 / (sizes[i] * sizes[i]) : 0)
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) break

    let rv = rng() * total, chosen = freeIds[freeIds.length - 1]
    for (let i = 0; i < freeIds.length; i++) { rv -= weights[i]; if (rv <= 0) { chosen = freeIds[i]; break } }

    let bestCell = -1, bestPrio = -1
    for (const [cell, prio] of frontierMaps[chosen]) if (prio > bestPrio) { bestPrio = prio; bestCell = cell }
    if (bestCell === -1) break
    frontierMaps[chosen].delete(bestCell)

    const cr = Math.floor(bestCell / N), cc = bestCell % N
    if (grid[cr][cc] !== -1) continue
    grid[cr][cc] = chosen; sizes[chosen]++; remaining--
    for (const [dr, dc] of DIRS) {
      const nr = cr + dr, nc = cc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        const cell = nr * N + nc
        if (!frontierMaps[chosen].has(cell)) frontierMaps[chosen].set(cell, cellPrio[cell])
      }
    }
  }

  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    seeds.forEach(({ r: sr, c: sc }, sid) => {
      const d = Math.abs(r - sr) + Math.abs(c - sc)
      if (d < bestDist) { bestDist = d; best = sid }
    })
    grid[r][c] = best
  }

  return grid
}

// ── Benchmark ────────────────────────────────────────────────────────────────
const N = 10
const TIERS = [
  { name: 'easy',   levelNum: 2 },
  { name: 'medium', levelNum: 6 },
  { name: 'hard',   levelNum: 12 },
  { name: 'expert', levelNum: 18 },
]
const PUZZLES_PER_TIER = 5

const t0 = Date.now()


for (const { name, levelNum } of TIERS) {
  const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)

  let succeeded = 0
  const scores = [], roundsArr = [], hardStepsArr = []
  const maxRegSizes = []

  for (let puzzleIdx = 0; puzzleIdx < PUZZLES_PER_TIER; puzzleIdx++) {
    const puzzleSeed = puzzleIdx * 999983
    const baseSeed = levelNum * 100003 + 17 + puzzleSeed
    let found = null

    for (let attempt = 0; attempt < 500; attempt++) {
      const rng = makeRng(baseSeed + attempt * 6271)
      const catCols = findPlacement(N, rng)
      const solution = catCols.map((c, r) => ({ r, c }))
      const regions = growSizeBalanced(N, solution, rng)

      const bc = boundaryCount(regions, N)
      if (bc < minBoundaries(levelNum)) continue
      if (hasCorridor(regions, N)) continue
      const result = canSolveLogically(regions, N)
      if (!result.solved) continue

      const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
      const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
      if (stratOk && score >= minScore && score <= maxScore &&
          result.easySteps + result.hardSteps >= minSteps &&
          result.hardSteps >= minHardSteps &&
          result.rounds >= minRounds) {
        const sizeCounts = Array(N).fill(0)
        for (let r = 0; r < N; r++)
          for (let c = 0; c < N; c++)
            sizeCounts[regions[r][c]]++
        found = { score, rounds: result.rounds, hardSteps: result.hardSteps, sizes: sizeCounts }
        break
      }
    }

    if (found) {
      succeeded++
      scores.push(found.score)
      roundsArr.push(found.rounds)
      hardStepsArr.push(found.hardSteps)
      maxRegSizes.push(Math.max(...found.sizes))
    }
  }

  const avg = arr => arr.length === 0 ? 'N/A' : (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)

  console.log(`\n[${name.toUpperCase()}] levelNum=${levelNum} | score ${minScore}-${maxScore}, minSteps=${minSteps}, minHardSteps=${minHardSteps}, minRounds=${minRounds}, minStratBit=${minStratBit}`)
  console.log(`  Phase-1 success: ${succeeded}/${PUZZLES_PER_TIER}`)
  console.log(`  Avg score:       ${avg(scores)}`)
  console.log(`  Avg rounds:      ${avg(roundsArr)}`)
  console.log(`  Avg hardSteps:   ${avg(hardStepsArr)}`)
  console.log(`  Avg max region:  ${avg(maxRegSizes)}`)
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
console.log(`\nTotal time: ${elapsed}s`)
