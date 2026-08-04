import { SolveResult } from './types'

// Returns the region permutation σ if the grid satisfies grid[r][c] = σ(grid[c][r])
// for all off-diagonal cells (r ≠ c), otherwise returns null.
// Diagonal cells (r === c) are exempt because they are their own transpose and can
// only be self-paired, which fails for even-N involutions with no fixed points.
export function detectDiagonalSymmetry(grid: number[][], N: number): number[] | null {
  const sigma = new Array<number>(N).fill(-1)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (r === c) continue
      const a = grid[r][c], b = grid[c][r]
      if (sigma[a] === -1) sigma[a] = b
      else if (sigma[a] !== b) return null
    }
  }
  if (sigma.some(v => v === -1)) return null
  const seen = new Set(sigma)
  if (seen.size !== N) return null
  return sigma
}

// ── Combination helper ───────────────────────────────────────────────────────

export function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result: T[][] = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
}

// ── Constraint-propagation solver ────────────────────────────────────────────

export function canSolveLogically(regions: number[][], N: number): SolveResult {
  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  // Detect diagonal symmetry once; σ[A] = partner region of A (or null if none)
  const sigma = detectDiagonalSymmetry(regions, N)

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
          return r2 !== cr && c2 !== cc &&
            !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
        })
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 1; easySteps += before - cands[other].length }
      }
    }

    // Symmetry propagation: if the layout has diagonal symmetry σ, then candidate
    // (r,c) for region A is only valid when (c,r) is still a candidate for σ(A).
    // Eliminating mismatched candidates here often cascades into singleton propagation
    // on the next round — the "symmetry-propagation" technique (strategy bit 256).
    if (sigma !== null) {
      for (let reg = 0; reg < N; reg++) {
        const partner = sigma[reg]
        if (partner === reg || cands[reg].length === 0) continue
        const partnerSet = new Set(cands[partner])
        const before = cands[reg].length
        cands[reg] = cands[reg].filter(cell => {
          const cr = ROW(cell), cc = COL(cell)
          if (cr === cc) return true  // diagonal cell: exempt from symmetry constraint
          return partnerSet.has(cc * N + cr)  // (c,r) must be a live candidate for σ(A)
        })
        if (cands[reg].length < before) {
          anyChange = true; strategiesUsed |= 256; easySteps += before - cands[reg].length
        }
      }
    }

    // Common-neighbor: for each region B, candidate X — if placing X kills all candidates
    // of any region A, then X is impossible for B. Runs eagerly alongside strategy 1.
    for (let regB = 0; regB < N; regB++) {
      if (cands[regB].length <= 1) continue
      for (let ci = cands[regB].length - 1; ci >= 0; ci--) {
        const cell = cands[regB][ci]
        const cr = ROW(cell), cc = COL(cell)
        for (let regA = 0; regA < N; regA++) {
          if (regA === regB || cands[regA].length === 0) continue
          if (cands[regA].every(c2 => {
            const r2 = ROW(c2), c2c = COL(c2)
            return r2 === cr || c2c === cc || (Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
          })) {
            cands[regB].splice(ci, 1)
            anyChange = true; strategiesUsed |= 512; easySteps++
            break
          }
        }
      }
    }

    if (anyChange) continue  // restart before subsets if earlier strategies fired

    const rowSpan: Set<number>[] = cands.map(cs => new Set(cs.map(ROW)))
    const colSpan: Set<number>[] = cands.map(cs => new Set(cs.map(COL)))

    const regsInRow: number[][] = Array.from({ length: N }, () => [])
    const regsInCol: number[][] = Array.from({ length: N }, () => [])
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length <= 1) continue
      for (const r of rowSpan[reg]) regsInRow[r].push(reg)
      for (const c of colSpan[reg]) regsInCol[c].push(reg)
    }

    const unplaced = Array.from({ length: N }, (_, i) => i).filter(r => cands[r].length > 1)

    subsetLoop: for (const axis of [0, 1] as const) {
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
            if (cands[other].length < before) { anyChange = true; strategiesUsed |= 2; easySteps += before - cands[other].length; break subsetLoop }
          }
        }
      }

      // 3. Hidden subsets
      const activeAxis = Array.from({ length: N }, (_, i) => i)
        .filter(a => regsInAxis[a].length > 0)
      for (let k = 1; k < unplaced.length; k++) {
        for (const axisSub of combinations(activeAxis, k)) {
          const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
          if (regsIn.length !== k) continue
          const axisSet = new Set(axisSub)
          for (const reg of regsIn) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(cell => axisSet.has(axisOf(cell)))
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4; easySteps += before - cands[reg].length; break subsetLoop }
          }
        }
      }
    }

    if (anyChange) continue

    // 4. Trap 2×2
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
            return r2 !== cr && col2 !== cc &&
              !(Math.abs(r2 - cr) <= 1 && Math.abs(col2 - cc) <= 1)
          })
          if (survivors.length === 0) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(c => c !== cell)
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 16; hardSteps += before - cands[reg].length }
          }
        }
      }
    }

    // Strategy 8: X-Wing (2-row × 2-col joint pigeonhole)
    // If 4 regions have all candidates within the same 2 rows AND 2 columns,
    // those 4 intersection cells are reserved — eliminate them from all other regions.
    if (!anyChange) {
      const unresolved = Array.from({ length: N }, (_, i) => i).filter(r => cands[r].length > 1)
      for (let ri = 0; ri < N - 1 && !anyChange; ri++) {
        for (let rj = ri + 1; rj < N && !anyChange; rj++) {
          for (let ci = 0; ci < N - 1 && !anyChange; ci++) {
            for (let cj = ci + 1; cj < N && !anyChange; cj++) {
              // The 4 intersection cells for rows ri,rj and cols ci,cj
              const intersect = new Set([ri*N+ci, ri*N+cj, rj*N+ci, rj*N+cj])
              // Find regions whose candidates are ALL within these 4 cells
              const locked: number[] = []
              for (const reg of unresolved) {
                if (cands[reg].every(cell => intersect.has(cell))) locked.push(reg)
              }
              if (locked.length !== 4) continue
              // Eliminate those 4 cells from all other regions
              const lockedSet = new Set(locked)
              for (let other = 0; other < N; other++) {
                if (lockedSet.has(other)) continue
                const before = cands[other].length
                cands[other] = cands[other].filter(cell => !intersect.has(cell))
                if (cands[other].length < before) {
                  anyChange = true; strategiesUsed |= 128; hardSteps += before - cands[other].length
                }
              }
            }
          }
        }
      }
    }

    // Strategy 6: Branch Rule
    // For any region with exactly 2 candidates, simulate placing in each.
    // A cell can be eliminated from another region if it's gone in BOTH branches
    // (i.e., not in survivors of branch A OR survivors of branch B).
    if (!anyChange) {
      for (let reg = 0; reg < N && !anyChange; reg++) {
        if (cands[reg].length !== 2) continue
        const [cellA, cellB] = cands[reg]

        const runProp = (sim: number[][]): boolean => {
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
                  return r2 !== scr && c2c !== scc &&
                    !(Math.abs(r2 - scr) <= 1 && Math.abs(c2c - scc) <= 1)
                })
                if (sim[o].length === 0) return false
                if (sim[o].length < before) ch = true
              }
            }
            for (let regB = 0; regB < N; regB++) {
              if (sim[regB].length <= 1) continue
              for (let ci = sim[regB].length - 1; ci >= 0; ci--) {
                const cell = sim[regB][ci]
                const cr = ROW(cell), cc = COL(cell)
                for (let regA = 0; regA < N; regA++) {
                  if (regA === regB || sim[regA].length === 0) continue
                  if (sim[regA].every(c2 => {
                    const r2 = ROW(c2), c2c = COL(c2)
                    return r2 === cr || c2c === cc || (Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
                  })) {
                    sim[regB].splice(ci, 1)
                    if (sim[regB].length === 0) return false
                    ch = true
                    break
                  }
                }
              }
            }
          }
          return true
        }

        const applyPlace = (sim: number[][], r: number, id: number, cr: number, cc: number): boolean => {
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

        if (!okA && !okB) continue  // both contradictions — impossible state, skip
        if (!okA) {
          // branch A is contradiction → reg must be cellB
          const before = cands[reg].length
          cands[reg] = [cellB]; anyChange = true; strategiesUsed |= 64; hardSteps += before - 1; continue
        }
        if (!okB) {
          // branch B is contradiction → reg must be cellA
          const before = cands[reg].length
          cands[reg] = [cellA]; anyChange = true; strategiesUsed |= 64; hardSteps += before - 1; continue
        }

        // Both branches valid — eliminate cells absent from BOTH branch results
        for (let other = 0; other < N && !anyChange; other++) {
          if (other === reg) continue
          const setA = new Set(simA[other])
          const setB = new Set(simB[other])
          const before = cands[other].length
          // Keep cells present in at least one valid branch
          cands[other] = cands[other].filter(c => setA.has(c) || setB.has(c))
          if (cands[other].length < before) { anyChange = true; strategiesUsed |= 64; hardSteps += before - cands[other].length }
        }
      }
    }

    // Strategy 7: Forcing chains
    // For each candidate cell of each region, simulate placing the cat there.
    // If the simulation leads to contradiction (any region gets 0 candidates),
    // that cell is impossible and can be eliminated.
    // Note: we only do this when no other strategy made progress (anyChange is false here).
    if (!anyChange) {
      for (let reg = 0; reg < N && !anyChange; reg++) {
        if (cands[reg].length <= 1) continue
        for (let ci = cands[reg].length - 1; ci >= 0 && !anyChange; ci--) {
          const cell = cands[reg][ci]
          const cr = ROW(cell), cc = COL(cell)

          // Clone the candidate state
          const simCands: number[][] = cands.map(c => [...c])

          // Simulate placing reg at cell: eliminate row, col, and adjacency
          simCands[reg] = [cell]
          let contradiction = false
          for (let other = 0; other < N; other++) {
            if (other === reg) continue
            simCands[other] = simCands[other].filter(c2 => {
              const r2 = ROW(c2), c2c = COL(c2)
              return r2 !== cr && c2c !== cc &&
                !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
            })
            if (simCands[other].length === 0) { contradiction = true; break }
          }

          // If immediate contradiction, skip (strategy 5 would have caught this)
          if (contradiction) continue

          // Run the full solver on the simulated state
          let simAnyChange = true
          while (simAnyChange && !contradiction) {
            simAnyChange = false

            // Strategy 1 in sim
            for (let sreg = 0; sreg < N && !contradiction; sreg++) {
              if (simCands[sreg].length === 0) { contradiction = true; break }
              if (simCands[sreg].length !== 1) continue
              const scr = ROW(simCands[sreg][0]), scc = COL(simCands[sreg][0])
              for (let other = 0; other < N; other++) {
                if (other === sreg) continue
                const before = simCands[other].length
                simCands[other] = simCands[other].filter(c2 => {
                  const r2 = ROW(c2), c2c = COL(c2)
                  return r2 !== scr && c2c !== scc &&
                    !(Math.abs(r2 - scr) <= 1 && Math.abs(c2c - scc) <= 1)
                })
                if (simCands[other].length === 0) { contradiction = true; break }
                if (simCands[other].length < before) simAnyChange = true
              }
            }
            // Common-neighbor in sim (runs alongside strategy 1 each round)
            for (let regB = 0; regB < N && !contradiction; regB++) {
              if (simCands[regB].length <= 1) continue
              for (let ci = simCands[regB].length - 1; ci >= 0; ci--) {
                const cell = simCands[regB][ci]
                const cr = ROW(cell), cc = COL(cell)
                for (let regA = 0; regA < N; regA++) {
                  if (regA === regB || simCands[regA].length === 0) continue
                  if (simCands[regA].every(c2 => {
                    const r2 = ROW(c2), c2c = COL(c2)
                    return r2 === cr || c2c === cc || (Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
                  })) {
                    simCands[regB].splice(ci, 1)
                    if (simCands[regB].length === 0) { contradiction = true }
                    else simAnyChange = true
                    break
                  }
                }
              }
            }
            if (contradiction || simAnyChange) continue

            // Naked/hidden subsets (k=1..N) in sim
            const sRowSpan = simCands.map(cs => new Set(cs.map(ROW)))
            const sColSpan = simCands.map(cs => new Set(cs.map(COL)))
            const sRegsInRow: number[][] = Array.from({ length: N }, () => [])
            const sRegsInCol: number[][] = Array.from({ length: N }, () => [])
            for (let r = 0; r < N; r++) {
              for (let sReg = 0; sReg < N; sReg++) {
                if (simCands[sReg].length <= 1) continue
                if (sRowSpan[sReg].has(r)) sRegsInRow[r].push(sReg)
                if (sColSpan[sReg].has(r)) sRegsInCol[r].push(sReg)
              }
            }
            const sUnplaced = Array.from({ length: N }, (_, i) => i).filter(r => simCands[r].length > 1)

            for (const axis of [0, 1] as const) {
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

            // Trap 2×2 in sim
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

            // Region crowding in sim
            for (let sreg = 0; sreg < N && !simAnyChange && !contradiction; sreg++) {
              for (let sci = 0; sci < simCands[sreg].length && !simAnyChange && !contradiction; sci++) {
                const scell = simCands[sreg][sci]
                const scr2 = ROW(scell), scc2 = COL(scell)
                for (let other = 0; other < N && !simAnyChange && !contradiction; other++) {
                  if (other === sreg || simCands[other].length === 0) continue
                  const survivors = simCands[other].filter(c2 => {
                    const r2 = ROW(c2), c2c = COL(c2)
                    return r2 !== scr2 && c2c !== scc2 &&
                      !(Math.abs(r2 - scr2) <= 1 && Math.abs(c2c - scc2) <= 1)
                  })
                  if (survivors.length === 0) {
                    const before = simCands[sreg].length
                    simCands[sreg] = simCands[sreg].filter(c => c !== scell)
                    if (simCands[sreg].length === 0) { contradiction = true }
                    if (simCands[sreg].length < before) simAnyChange = true
                  }
                }
              }
            }
          }

          // If simulation reached contradiction, eliminate this cell
          if (contradiction) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(c => c !== cell)
            anyChange = true
            strategiesUsed |= 32  // new bit for forcing chain
            hardSteps += before - cands[reg].length
          }
        }
      }
    }
    if (anyChange) rounds++
  }

  const unsolvedRegions: number[] = []
  for (let reg = 0; reg < N; reg++) if (cands[reg].length > 1) unsolvedRegions.push(reg)
  const unsolvedCount = unsolvedRegions.length
  return { solved: unsolvedCount === 0, strategiesUsed, unsolvedCount, easySteps, hardSteps, rounds, unsolvedRegions }
}

export function canSolveFast(regions: number[][], N: number): SolveResult {
  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

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
          return r2 !== cr && c2 !== cc &&
            !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
        })
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 1; easySteps += before - cands[other].length }
      }
    }

    for (let regB = 0; regB < N; regB++) {
      if (cands[regB].length <= 1) continue
      for (let ci = cands[regB].length - 1; ci >= 0; ci--) {
        const cell = cands[regB][ci]
        const cr = ROW(cell), cc = COL(cell)
        for (let regA = 0; regA < N; regA++) {
          if (regA === regB || cands[regA].length === 0) continue
          if (cands[regA].every(c2 => {
            const r2 = ROW(c2), c2c = COL(c2)
            return r2 === cr || c2c === cc || (Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
          })) {
            cands[regB].splice(ci, 1)
            anyChange = true; strategiesUsed |= 512; easySteps++
            break
          }
        }
      }
    }

    if (anyChange) continue  // restart before subsets if earlier strategies fired

    const rowSpan: Set<number>[] = cands.map(cs => new Set(cs.map(ROW)))
    const colSpan: Set<number>[] = cands.map(cs => new Set(cs.map(COL)))

    const regsInRow: number[][] = Array.from({ length: N }, () => [])
    const regsInCol: number[][] = Array.from({ length: N }, () => [])
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length <= 1) continue
      for (const r of rowSpan[reg]) regsInRow[r].push(reg)
      for (const c of colSpan[reg]) regsInCol[c].push(reg)
    }

    const unplaced = Array.from({ length: N }, (_, i) => i).filter(r => cands[r].length > 1)

    subsetLoop: for (const axis of [0, 1] as const) {
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
            if (cands[other].length < before) { anyChange = true; strategiesUsed |= 2; easySteps += before - cands[other].length; break subsetLoop }
          }
        }
      }

      // 3. Hidden subsets
      const activeAxis = Array.from({ length: N }, (_, i) => i)
        .filter(a => regsInAxis[a].length > 0)
      for (let k = 1; k < unplaced.length; k++) {
        for (const axisSub of combinations(activeAxis, k)) {
          const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
          if (regsIn.length !== k) continue
          const axisSet = new Set(axisSub)
          for (const reg of regsIn) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(cell => axisSet.has(axisOf(cell)))
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4; easySteps += before - cands[reg].length; break subsetLoop }
          }
        }
      }
    }

    if (anyChange) continue

    // 4. Trap 2×2
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
            return r2 !== cr && col2 !== cc &&
              !(Math.abs(r2 - cr) <= 1 && Math.abs(col2 - cc) <= 1)
          })
          if (survivors.length === 0) {
            const before = cands[reg].length
            cands[reg] = cands[reg].filter(c => c !== cell)
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 16; hardSteps += before - cands[reg].length }
          }
        }
      }
    }
    if (anyChange) rounds++
  }

  const unsolvedCount = cands.filter(c => c.length > 1).length
  return { solved: cands.every(c => c.length === 1), strategiesUsed, unsolvedCount, easySteps, hardSteps, rounds, unsolvedRegions: [] }
}

// DFS backtracking to count solutions up to maxCount.
// Uses MRV heuristic (pick region with fewest candidates) and singleton
// propagation at each step.  Stops as soon as count reaches maxCount.
export function countSolutions(regions: number[][], N: number, maxCount = 2): number {
  const initCands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      initCands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  const propagate = (cands: number[][]): boolean => {
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
            return r2 !== cr && c2 !== cc &&
              !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
          })
          if (cands[o].length === 0) return false
          if (cands[o].length < prev) ch = true
        }
      }
    }
    return true
  }

  let count = 0

  const dfs = (cands: number[][]): void => {
    if (count >= maxCount) return
    // Find region with fewest (>1) candidates — MRV heuristic
    let minLen = Infinity, minReg = -1
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return
      if (cands[reg].length === 1) continue
      if (cands[reg].length < minLen) { minLen = cands[reg].length; minReg = reg }
    }
    if (minReg === -1) { count++; return }  // all placed → solution

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

// ── Difficulty score ─────────────────────────────────────────────────────────
// Weights each strategy bit by approximate difficulty.

export function difficultyScore(strategiesUsed: number, easySteps: number, hardSteps: number, rounds: number): number {
  // Weight strategies by difficulty:
  // Bit 0 (1): singleton propagation = 1 pt
  // Bit 1 (2): naked subsets = 3 pts
  // Bit 2 (4): hidden subsets = 6 pts
  // Bit 3 (8): trap 2x2 = 4 pts
  // Bit 4 (16): region crowding = 10 pts
  // Bit 8 (256): symmetry-propagation = 2 pts (deterministic/free but distinctive)
  const WEIGHTS = [1, 3, 6, 4, 10, 15, 8, 7, 2, 8]
  let score = 0
  for (let i = 0; i < WEIGHTS.length; i++)
    if (strategiesUsed & (1 << i)) score += WEIGHTS[i]
  // Add step count bonus weighted by strategy difficulty
  score += Math.log2(easySteps + 1) * 0.3
  score += Math.log2(hardSteps + 1) * 0.8
  score += rounds * 0.4
  return Math.round(score * 10) / 10
}
