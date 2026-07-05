const PALETTE = [
  '#f080b0', '#a07858', '#9888d8', '#f0d878', '#40b8c8',
  '#3d8b5a', '#88c870', '#6888c0', '#c0a820', '#d08888',
]


export interface GeneratedLevel {
  size: number
  regions: number[][]                  // regions[r][c] = regionId
  solution: { r: number; c: number }[] // solution[regionId] = correct cat cell
  colors: string[]                     // colors[regionId] = hex
  difficulty: number                   // weighted strategy score
  easySteps: number                    // eliminations from strategies 1–3 (singleton, naked, hidden subsets)
  hardSteps: number                    // eliminations from strategies 4–7 (trap 2×2, crowding, branch, forcing chains)
  boundaries: number                   // number of region boundary edges
  rounds: number                       // number of solver passes that made progress
  symmetric: boolean                   // true if the region layout has diagonal (transpose) reflection symmetry
}

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = seed | 0
  return (): number => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Cat placement (backtracking) ─────────────────────────────────────────────

function findPlacement(N: number, rng: () => number): number[] {
  const cols: number[] = []
  const usedCols = new Set<number>()

  function solve(row: number): boolean {
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

// Self-inverse permutation (involution): solution[solution[r]] = r for all r.
// Each pair (r, solution[r]) has |r - solution[r]| >= 2 so the two cats in the
// pair don't land in adjacent rows, and all consecutive rows satisfy the
// standard non-adjacency column rule. Returns null if no valid involution is
// found in 500 attempts.
function findSymmetricPlacement(N: number, rng: () => number): number[] | null {
  if (N % 2 !== 0) return null
  for (let attempt = 0; attempt < 500; attempt++) {
    const rows = shuffle(Array.from({ length: N }, (_, i) => i), rng)
    const solution = new Array<number>(N).fill(-1)
    let valid = true
    for (let i = 0; i < N; i += 2) {
      const r = rows[i], c = rows[i + 1]
      // The pair maps row r → col c and row c → col r.
      // If r and c are adjacent rows their cats land at (r,c) and (c,r) which
      // are diagonally adjacent — invalid.
      if (Math.abs(r - c) < 2) { valid = false; break }
      solution[r] = c
      solution[c] = r
    }
    if (!valid) continue
    let adjOk = true
    for (let r = 0; r < N - 1; r++) {
      if (Math.abs(solution[r] - solution[r + 1]) < 2) { adjOk = false; break }
    }
    if (!adjOk) continue
    return solution
  }
  return null
}

// ── Connectivity check ───────────────────────────────────────────────────────

function isConnectedWithout(grid: number[][], N: number, skipR: number, skipC: number, reg: number): boolean {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  let start = -1, size = 0
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== reg) continue
      size++
      if (!(r === skipR && c === skipC) && start === -1) start = r * N + c
    }
  }
  if (size <= 1 || start === -1) return false
  const visited = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const r = Math.floor(cur / N), c = cur % N
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
      const nidx = nr * N + nc
      if (!visited.has(nidx) && grid[nr][nc] === reg && !(nr === skipR && nc === skipC)) {
        visited.add(nidx); queue.push(nidx)
      }
    }
  }
  return visited.size === size - 1
}

// Returns the region permutation σ if the grid satisfies grid[r][c] = σ(grid[c][r])
// for all off-diagonal cells (r ≠ c), otherwise returns null.
// Diagonal cells (r === c) are exempt because they are their own transpose and can
// only be self-paired, which fails for even-N involutions with no fixed points.
function detectDiagonalSymmetry(grid: number[][], N: number): number[] | null {
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

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result: T[][] = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
}

// ── Constraint-propagation solver ────────────────────────────────────────────

interface SolveResult { solved: boolean; strategiesUsed: number; unsolvedCount: number; easySteps: number; hardSteps: number; rounds: number; unsolvedRegions: number[] }

function canSolveLogically(regions: number[][], N: number): SolveResult {
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

    for (const axis of [0, 1] as const) {
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
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4; easySteps += before - cands[reg].length }
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

    for (const axis of [0, 1] as const) {
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
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4; easySteps += before - cands[reg].length }
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

function difficultyScore(strategiesUsed: number, easySteps: number, hardSteps: number, rounds: number): number {
  // Weight strategies by difficulty:
  // Bit 0 (1): singleton propagation = 1 pt
  // Bit 1 (2): naked subsets = 3 pts
  // Bit 2 (4): hidden subsets = 6 pts
  // Bit 3 (8): trap 2x2 = 4 pts
  // Bit 4 (16): region crowding = 10 pts
  // Bit 8 (256): symmetry-propagation = 2 pts (deterministic/free but distinctive)
  const WEIGHTS = [1, 3, 6, 4, 10, 15, 8, 7, 2]
  let score = 0
  for (let i = 0; i < WEIGHTS.length; i++)
    if (strategiesUsed & (1 << i)) score += WEIGHTS[i]
  // Add step count bonus weighted by strategy difficulty
  score += Math.log2(easySteps + 1) * 0.3
  score += Math.log2(hardSteps + 1) * 0.8
  score += rounds * 0.4
  return Math.round(score * 10) / 10
}

// ── Diagonal-symmetric region growth ────────────────────────────────────────
// Grows a layout satisfying grid[r][c] = σ(grid[c][r]) (σ = solution involution).
//
// All 5 involution pairs grow evenly via size-biased Prim's with a hard per-region
// cap of ~18 cells. Symmetry-propagation (not tiny anchor regions) provides the
// constraint cascade that makes puzzles logically solvable.
function growDiagonalSymmetric(N: number, solution: number[], rng: () => number): number[][] {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])

  for (let i = 0; i < N; i++) grid[i][solution[i]] = i

  // Build canonical pairs: canonical = smaller ID in each {i, solution[i]} pair
  const canonicals: number[] = []
  const seen = new Set<number>()
  for (let i = 0; i < N; i++) {
    if (seen.has(i)) continue
    seen.add(i); seen.add(solution[i])
    canonicals.push(Math.min(i, solution[i]))
  }

  // 1 doublet pair (2 cells per region) anchors constraint cascades.
  // The other 4 pairs grow evenly via size-biased Prim's, capped at ~18 cells.
  const shuffledPairs = shuffle([...canonicals], rng)
  const doubPair = shuffledPairs[0]
  const CAP_DOUB = 2, CAP_REG = Math.ceil(N * 1.8)  // ~18 for N=10
  const capOfPair = (can: number) => can === doubPair ? CAP_DOUB : CAP_REG

  const cellPrio = new Float32Array(N * N)
  for (let k = 0; k < N * N; k++) cellPrio[k] = rng()

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++

  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())

  const addToFrontier = (can: number, r: number, c: number) => {
    if (r === c) return
    const ur = Math.min(r, c), uc = Math.max(r, c)
    if (grid[ur][uc] !== -1 || grid[uc][ur] !== -1) return
    const key = ur * N + uc
    if (!frontierMaps[can].has(key))
      frontierMaps[can].set(key, cellPrio[ur * N + uc])
  }

  for (const can of canonicals) {
    const j = solution[can]
    for (const [br, bc] of [[can, j], [j, can]] as [number, number][]) {
      for (const [dr, dc] of DIRS) {
        const nr = br + dr, nc = bc + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) addToFrontier(can, nr, nc)
      }
    }
  }

  let remaining = 0
  for (let r = 0; r < N; r++) for (let c = r + 1; c < N; c++)
    if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    let total = 0
    const ws: number[] = [], cs: number[] = []
    for (const can of canonicals) {
      if (frontierMaps[can].size === 0) continue
      const cap = capOfPair(can)
      if (sizes[can] >= cap || sizes[solution[can]] >= cap) continue
      const w = 1 / (sizes[can] * sizes[can])
      ws.push(w); cs.push(can); total += w
    }
    if (total === 0) break

    let rv = rng() * total, chosen = cs[cs.length - 1]
    for (let k = 0; k < cs.length; k++) { rv -= ws[k]; if (rv <= 0) { chosen = cs[k]; break } }

    let bestKey = -1, bestPrio = -1
    for (const [key, prio] of frontierMaps[chosen]) {
      if (prio > bestPrio) { bestPrio = prio; bestKey = key }
    }
    if (bestKey === -1) { frontierMaps[chosen].clear(); continue }
    frontierMaps[chosen].delete(bestKey)

    const ur = Math.floor(bestKey / N), uc = bestKey % N
    if (grid[ur][uc] !== -1 || grid[uc][ur] !== -1) continue

    const j = solution[chosen]
    grid[ur][uc] = chosen; grid[uc][ur] = j
    sizes[chosen]++; sizes[j]++; remaining--

    for (const [br, bc] of [[ur, uc], [uc, ur]] as [number, number][]) {
      for (const [dr, dc] of DIRS) {
        const nr = br + dr, nc = bc + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) addToFrontier(chosen, nr, nc)
      }
    }
  }

  // Diagonal cells (r === c): assign to nearest region seed
  for (let r = 0; r < N; r++) {
    if (grid[r][r] !== -1) continue
    let best = -1, bestDist = Infinity
    for (let i = 0; i < N; i++) {
      const d = Math.abs(r - i) + Math.abs(r - solution[i])
      if (d < bestDist) { bestDist = d; best = i }
    }
    grid[r][r] = best; sizes[best]++
  }

  // Fallback: any unclaimed cells go to nearest seed
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== -1) continue
    let best = -1, bestDist = Infinity
    for (let i = 0; i < N; i++) {
      const d = Math.abs(r - i) + Math.abs(c - solution[i])
      if (d < bestDist) { bestDist = d; best = i }
    }
    grid[r][c] = best; sizes[best]++
  }

  return grid
}

// ── Phase 1: Voronoi region growth ──────────────────────────────────────────
// Simultaneous BFS from all star seeds. Used as starting point for SA.

function growVoronoi(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  type QEntry = { r: number; c: number; id: number }
  let frontier: QEntry[] = shuffle(seeds.map((s, id) => ({ ...s, id })), rng)

  while (frontier.length > 0) {
    const idx = Math.floor(rng() * frontier.length)
    const entry = frontier[idx]
    frontier[idx] = frontier[frontier.length - 1]
    frontier.pop()
    const { r, c, id } = entry
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc] !== -1) continue
      grid[nr][nc] = id
      frontier.push({ r: nr, c: nc, id })
    }
  }

  return grid
}

// ── Span score ───────────────────────────────────────────────────────────────
// Sum of (row-span + col-span) across all regions. Lower = more confined =
// more deductions possible. Used as SA cost function.

export function spanScore(grid: number[][], N: number): number {
  const rows: Set<number>[] = Array.from({ length: N }, () => new Set())
  const cols: Set<number>[] = Array.from({ length: N }, () => new Set())
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      rows[grid[r][c]].add(r)
      cols[grid[r][c]].add(c)
    }
  }
  let s = 0
  for (let reg = 0; reg < N; reg++) s += rows[reg].size + cols[reg].size
  return s
}


function boundaryCount(grid: number[][], N: number): number {
  let count = 0
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      if (c + 1 < N && grid[r][c] !== grid[r][c + 1]) count++
      if (r + 1 < N && grid[r][c] !== grid[r + 1][c]) count++
    }
  return count
}

function hasCorridor(grid: number[][], N: number): boolean {
  const rows: Set<number>[] = Array.from({ length: N }, () => new Set())
  const cols: Set<number>[] = Array.from({ length: N }, () => new Set())
  const sizes: number[] = Array(N).fill(0)

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
    if (fillRatio < 0.35 && (rSpan >= 3 || cSpan >= 3)) return true
  }
  return false
}

function maxRegionSize(regions: number[][], N: number): number {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sizes[regions[r][c]]++
  return Math.max(...sizes)
}

// Balanced region growth: 2 singletons anchor cascade propagation (performance),
// while 8 free regions grow evenly via size-biased Prim's with a hard cap of
// ~18 cells. Replaces the old 2-free-blobs (~42 cells each) with 8 evenly-sized
// regions.
// Result: sizes ~1–18 cells vs the old 1–42 cell spread.
// Solvability is maintained (singletons still start cascade instantly).
function growSizeBalanced(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  // 8 anchor regions (2 singletons + 3 doublets + 3 triples) provide cascade
  // constraints. 2 medium regions absorb remaining cells, capped to avoid blobs.
  const N_SING = 2, N_DOUB = 3, N_TRIP = 3
  const CAP_FREE = Math.ceil(N * 2.2)  // ~22 cells max for medium regions
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const freeIds = shuffledIds.slice(N_SING + N_DOUB + N_TRIP)  // 2 medium regions

  // Doublets: grow 1 extra cell
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; break
      }
    }
  }

  // Triples: grow 2 extra cells (L-shapes and bent triominoes for variety)
  for (const id of isTrip) {
    const { r: sr, c: sc } = seeds[id]
    let r1 = -1, c1 = -1
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; r1 = nr; c1 = nc; break
      }
    }
    if (r1 !== -1) {
      const bases = rng() < 0.6
        ? [{ r: r1, c: c1 }, { r: sr, c: sc }]
        : [{ r: sr, c: sc }, { r: r1, c: c1 }]
      for (const { r: br, c: bc } of bases) {
        let found = false
        for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
          const nr = br + dr, nc = bc + dc
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
            grid[nr][nc] = id; found = true; break
          }
        }
        if (found) break
      }
    }
  }

  // Pre-assign random priorities for Prim's-style growth
  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  // Quadrant affinity: boost cells in the same quadrant as their nearest free seed
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
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++
  for (let id = 0; id < N; id++) if (sizes[id] < 1) sizes[id] = 1

  const freeSet = new Set(freeIds)
  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] === -1 || !freeSet.has(grid[r][c])) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        frontierMaps[grid[r][c]].set(nr * N + nc, cellPrio[nr * N + nc])
      }
    }
  }

  let remaining = 0
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    const weights = freeIds.map(i => (frontierMaps[i].size > 0 && sizes[i] < CAP_FREE) ? 1 / (sizes[i] * sizes[i]) : 0)
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) break

    let rv = rng() * total, chosen = freeIds[freeIds.length - 1]
    for (let i = 0; i < freeIds.length; i++) { rv -= weights[i]; if (rv <= 0) { chosen = freeIds[i]; break } }

    let bestCell = -1, bestPrio = -1
    for (const [cell, prio] of frontierMaps[chosen])
      if (prio > bestPrio) { bestPrio = prio; bestCell = cell }
    if (bestCell === -1) { frontierMaps[chosen].clear(); continue }
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

  // Fallback: unclaimed cells → nearest seed (anchors absorb overflow, keeping
  // medium regions at their cap and distributing the remaining ~40 cells evenly)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      seeds.forEach(({ r: sr, c: sc }, sid) => {
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = sid }
      })
      grid[r][c] = best
    }
  }

  return grid
}

// ── Phase 1: Constrained-sections region growth ──────────────────────────────
// Inspired by the Queens generator (github.com/gitars/queens-generator):
// - Designates N/2 zones as "small sections" capped at N/2 cells (size variety)
// - Picks 1-2 rows and 1-2 columns as constrained bands; zones seeded inside
//   those bands can only expand within them (shape variety, forced deductions)
// - All zones grow via size-biased Prim's for organic shapes
// Returns null if a zone ends up below MIN_ZONE_SIZE (attempt is rejected).
export function growConstrainedSections(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] | null {
  const MIN_ZONE_SIZE = 2
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  // Constrained row band: 1 to N/4 rows
  const numCR = Math.floor(rng() * Math.floor(N / 4)) + 1
  const crStart = Math.floor(rng() * (N - numCR))
  const constrainedRowSet = new Set(Array.from({ length: numCR }, (_, i) => crStart + i))

  // Constrained col band: 1 to N/4 cols
  const numCC = Math.floor(rng() * Math.floor(N / 4)) + 1
  const ccStart = Math.floor(rng() * (N - numCC))
  const constrainedColSet = new Set(Array.from({ length: numCC }, (_, i) => ccStart + i))

  // Mandatory anchors (cascade starters): 1 singleton + 2 doublets randomly assigned.
  // Fewer than the original 8 anchors — enough to start deduction cascades
  // without making the puzzle trivially easy.
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const singId = shuffledIds[0]
  const doubIds = new Set([shuffledIds[1], shuffledIds[2]])

  // Small sections (beyond anchors): 3 additional zones capped at N/2 cells
  const smallSections = new Set(shuffledIds.slice(3, 6))
  const maxSmall = Math.floor(N / 2)

  // Zone constraints: if seed lands in a constrained band, zone stays inside it
  // Anchors (singleton, doublets) are exempt from row/col constraints so they
  // can always place their fixed number of cells without getting stuck.
  const anchorIds = new Set([singId, ...doubIds])
  const rowConstrained = new Map<number, Set<number>>()
  const colConstrained = new Map<number, Set<number>>()
  for (let id = 0; id < N; id++) {
    if (anchorIds.has(id)) continue
    const { r, c } = seeds[id]
    if (constrainedRowSet.has(r)) rowConstrained.set(id, constrainedRowSet)
    if (constrainedColSet.has(c)) colConstrained.set(id, constrainedColSet)
  }

  const canAssign = (id: number, r: number, c: number): boolean => {
    const rc = rowConstrained.get(id)
    if (rc && !rc.has(r)) return false
    const cc = colConstrained.get(id)
    if (cc && !cc.has(c)) return false
    return true
  }

  const sizes = Array(N).fill(1)

  // Grow singleton anchor (stays at 1 cell — seed only)

  // Grow doublet anchors (1 extra cell each)
  for (const id of doubIds) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; sizes[id]++; break
      }
    }
  }

  // Pre-assign random priorities for Prim's-style organic growth
  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  // Build initial frontiers (anchors don't grow further)
  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let id = 0; id < N; id++) {
    if (anchorIds.has(id)) continue  // anchors are fixed
    const { r, c } = seeds[id]
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1 && canAssign(id, nr, nc))
        frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
    }
    // Also seed frontier from any doublet extra cell
  }
  // Doublets: also seed frontier from their extra cell
  for (const id of doubIds) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (grid[r][c] !== id) continue
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
          frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
      }
    }
  }

  let remaining = Array.from({ length: N * N }, (_, i) => i).filter(i => grid[Math.floor(i / N)][i % N] === -1).length

  while (remaining > 0) {
    // Size-biased selection; anchors don't grow; small sections stop once capped
    const weights = Array.from({ length: N }, (_, id) => {
      if (anchorIds.has(id)) return 0
      if (frontierMaps[id].size === 0) return 0
      if (smallSections.has(id) && sizes[id] >= maxSmall) return 0
      return 1 / (sizes[id] * sizes[id])
    })
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) break

    let rv = rng() * total, chosen = N - 1
    for (let i = 0; i < N; i++) { rv -= weights[i]; if (rv <= 0) { chosen = i; break } }

    // Prim's: pick the highest-priority frontier cell
    let bestCell = -1, bestPrio = -1
    for (const [cell, prio] of frontierMaps[chosen])
      if (prio > bestPrio) { bestPrio = prio; bestCell = cell }
    if (bestCell === -1) { frontierMaps[chosen].clear(); continue }
    frontierMaps[chosen].delete(bestCell)

    const cr = Math.floor(bestCell / N), cc = bestCell % N
    if (grid[cr][cc] !== -1) continue

    grid[cr][cc] = chosen; sizes[chosen]++; remaining--
    for (const [dr, dc] of DIRS) {
      const nr = cr + dr, nc = cc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1 && canAssign(chosen, nr, nc)) {
        const cell = nr * N + nc
        if (!frontierMaps[chosen].has(cell)) frontierMaps[chosen].set(cell, cellPrio[cell])
      }
    }
  }

  // Fallback: unclaimed cells → nearest zone that can accept them
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      // Try constrained-valid zones first (respecting small cap)
      seeds.forEach(({ r: sr, c: sc }, sid) => {
        if (!canAssign(sid, r, c)) return
        if (smallSections.has(sid) && sizes[sid] >= maxSmall) return
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = sid }
      })
      // If nothing accepts it, use nearest without constraint
      if (best === -1) {
        seeds.forEach(({ r: sr, c: sc }, sid) => {
          const d = Math.abs(r - sr) + Math.abs(c - sc)
          if (d < bestDist) { bestDist = d; best = sid }
        })
      }
      grid[r][c] = best; sizes[best]++
    }
  }

  if (sizes.some(s => s < MIN_ZONE_SIZE)) return null
  return grid
}

// ── Phase 2: Random-role region growth ──────────────────────────────────────
// Randomly assigns roles to seeds: 2 singletons (1 cell), 3 doublets (2 cells),
// 4 triples (3 cells), 1 large blob (fills remaining ~80 cells).
// Using random assignment (not sorted-by-row) gives visual variety across levels
// while maintaining ~6% per-attempt solvability for strat>=2.

function growBalanced(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const N_SING = 2, N_DOUB = 3, N_TRIP = 4
  // RANDOMLY pick which seeds get each role (not sorted by row)
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const largeId = shuffledIds[N - 1]  // 1 large region (random seed)

  // Doublets: grow 1 extra cell in any direction
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; break
      }
    }
  }

  // Triples: grow 2 extra cells via BFS
  for (const id of isTrip) {
    const { r: sr, c: sc } = seeds[id]
    const q = [{ r: sr, c: sc }]; let grown = 0
    for (let qi = 0; qi < q.length && grown < 2; qi++) {
      const { r, c } = q[qi]
      for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; q.push({ r: nr, c: nc }); grown++; break
        }
      }
    }
  }

  // Large blob: distance-biased BFS for organic spread-out shape
  const blobSeed = seeds[largeId]
  const inBlob = new Set<number>()
  inBlob.add(blobSeed.r * N + blobSeed.c)
  // Priority frontier: [cell, dist] sorted by dist desc (grow far first)
  const blobFrontier: Array<{ r: number; c: number; dist: number }> = []
  for (const [dr, dc] of DIRS) {
    const nr = blobSeed.r + dr, nc = blobSeed.c + dc
    if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
      blobFrontier.push({ r: nr, c: nc, dist: Math.abs(nr - blobSeed.r) + Math.abs(nc - blobSeed.c) })
  }
  while (blobFrontier.length > 0) {
    // Pick randomly from top-half by distance (prefer far cells, add variety)
    const sorted = blobFrontier.sort((a, b) => b.dist - a.dist)
    const pickIdx = Math.floor(rng() * Math.max(1, Math.ceil(sorted.length * 0.4)))
    const { r: br, c: bc } = sorted.splice(pickIdx, 1)[0]
    if (grid[br][bc] !== -1) continue
    grid[br][bc] = largeId
    inBlob.add(br * N + bc)
    for (const [dr, dc] of DIRS) {
      const nr = br + dr, nc = bc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        blobFrontier.push({ r: nr, c: nc, dist: Math.abs(nr - blobSeed.r) + Math.abs(nc - blobSeed.c) })
    }
  }

  // Fallback: assign any remaining unclaimed cells to nearest seed
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      seeds.forEach(({ r: sr, c: sc }, sid) => {
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = sid }
      })
      grid[r][c] = best
    }
  }

  return grid
}

// ── Difficulty tiers ─────────────────────────────────────────────────────────

function targetDifficulty(levelNum: number): { minScore: number; maxScore: number; minSteps: number; minHardSteps: number; minRounds: number; minStratBit: number } {
  // minStratBit: bitwise OR of strategy bits that MUST fire (any one is enough).
  // Bit 4 (16) = region crowding, Bit 5 (32) = FC, Bit 6 (64) = Branch Rule.
  // This directly prevents trivially-easy puzzles reaching hard/expert tiers.
  if (levelNum <= 3)  return { minScore: 1,  maxScore: 14,  minSteps: 10, minHardSteps: 0, minRounds: 0, minStratBit: 0  }  // easy: pure deduction ok (rounds=0)
  if (levelNum <= 8)  return { minScore: 6,  maxScore: 25,  minSteps: 20, minHardSteps: 0, minRounds: 1, minStratBit: 0  }  // medium: at least 1 hard round
  if (levelNum <= 15) return { minScore: 10, maxScore: 50,  minSteps: 40, minHardSteps: 1, minRounds: 1, minStratBit: 16 }  // hard: crowding must fire
  return             { minScore: 15, maxScore: 300, minSteps: 50, minHardSteps: 2, minRounds: 1, minStratBit: 16 }           // expert: crowding must fire, high step/score bar
}

function minBoundaries(levelNum: number): number {
  if (levelNum <= 3)  return 40
  if (levelNum <= 8)  return 50
  return 55
}

function refineZones(
  regions: number[][], N: number, rng: () => number,
  check: (r: number[][]) => boolean,
  maxSwaps = 80,
  targetRegions?: Set<number>
): number[][] | null {
  let current = regions.map(row => [...row])
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]] as const

  for (let iter = 0; iter < maxSwaps; iter++) {
    const boundary: Array<{r: number; c: number; from: number; to: number}> = []
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
          if (current[nr][nc] !== current[r][c]) {
            if (!targetRegions || targetRegions.has(current[r][c]) || targetRegions.has(current[nr][nc])) {
              boundary.push({r, c, from: current[r][c], to: current[nr][nc]})
            }
          }
        }
      }
    }
    if (boundary.length === 0) return null

    const {r, c, from, to} = boundary[Math.floor(rng() * boundary.length)]

    if (!isConnectedWithout(current, N, r, c, from)) continue

    const candidate = current.map(row => [...row])
    candidate[r][c] = to

    if (check(candidate)) return candidate
    if (rng() < 0.15) current = candidate
  }
  return null
}

// ── Public API ───────────────────────────────────────────────────────────────

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

const DIFFICULTY_LEVEL: Record<Difficulty, number> = {
  easy:   2,
  medium: 6,
  hard:   12,
  expert: 18,
}

export function generateLevelByDifficulty(difficulty: Difficulty, puzzleIndex: number, globalSeed = 0): GeneratedLevel {
  return generateLevel(DIFFICULTY_LEVEL[difficulty], puzzleIndex + globalSeed * 10007)
}

export function generateLevel(levelNum: number, puzzleSeed = 0): GeneratedLevel {
  const N = 10
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983

  // Phase 0: Diagonal-symmetric growth.
  // Generates layouts where grid[r][c] = σ(grid[c][r]) using a self-inverse
  // cat placement. The solver exploits symmetry-propagation (bit 256) to
  // resolve paired regions simultaneously, producing the "reflection-symmetry"
  // solving experience.
  for (let attempt = 0; attempt < 300; attempt++) {
    const rng = makeRng(BASE + attempt * 7919 + 3_000_000)
    const symmCols = findSymmetricPlacement(N, rng)
    if (symmCols === null) continue
    const solution = symmCols.map((c, r) => ({ r, c }))
    const regions = growDiagonalSymmetric(N, symmCols, rng)

    const bc0 = boundaryCount(regions, N)
    if (bc0 < minBoundaries(levelNum)) continue
    if (maxRegionSize(regions, N) > 22) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    if (!result.solved) continue
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk0 = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (stratOk0 && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc0, rounds: result.rounds, symmetric: true }
    }
  }

  // Phase 1: Hybrid size-balanced growth. Logical solvability implies uniqueness
  // (pure deduction convergence = only one valid assignment). Refinement targets
  // unsolved regions specifically (Queens-style), no backtracking check needed.
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growSizeBalanced(N, solution, rng)

    const bc1 = boundaryCount(regions, N)
    if (bc1 < minBoundaries(levelNum)) continue
    if (maxRegionSize(regions, N) > 22) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (result.solved && stratOk && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc1, rounds: result.rounds, symmetric: false }
    }

    // Targeted refinement: focus on unsolved regions if any, else full boundary
    const targetReg = result.unsolvedRegions.length > 0 ? new Set(result.unsolvedRegions) : undefined
    const refined = refineZones(regions, N, rng, (r) => {
      if (boundaryCount(r, N) < minBoundaries(levelNum)) return false
      if (maxRegionSize(r, N) > 22) return false
      if (hasCorridor(r, N)) return false
      const res = canSolveLogically(r, N)
      const s = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
      const sOk = minStratBit === 0 || (res.strategiesUsed & minStratBit) !== 0
      return res.solved && sOk && s >= minScore && s <= maxScore && res.easySteps + res.hardSteps >= minSteps && res.hardSteps >= minHardSteps && res.rounds >= minRounds
    }, 80, targetReg)
    if (refined !== null) {
      const res2 = canSolveLogically(refined, N)
      const bc1r = boundaryCount(refined, N)
      return { size: N, regions: refined, solution, colors: shuffle([...PALETTE], rng), difficulty: difficultyScore(res2.strategiesUsed, res2.easySteps, res2.hardSteps, res2.rounds), easySteps: res2.easySteps, hardSteps: res2.hardSteps, boundaries: bc1r, rounds: res2.rounds, symmetric: false }
    }
  }

  // Phase 2: Structured engineered regions. High solve rate via forced small
  // regions that create immediate cascade. ~5-6% effective rate for strat>=2.
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = makeRng(BASE + attempt * 6271 + 1_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const bc2 = boundaryCount(regions, N)
    if (bc2 < minBoundaries(levelNum)) continue
    if (hasCorridor(regions, N)) continue

    const result = canSolveLogically(regions, N)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    const { minScore, maxScore, minSteps, minHardSteps, minRounds, minStratBit } = targetDifficulty(levelNum)
    const stratOk2 = minStratBit === 0 || (result.strategiesUsed & minStratBit) !== 0
    if (result.solved && stratOk2 && score >= minScore && score <= maxScore && result.easySteps + result.hardSteps >= minSteps && result.hardSteps >= minHardSteps && result.rounds >= minRounds) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc2, rounds: result.rounds, symmetric: false }
    }
  }

  // Phase 3: fallback — accept any solvable puzzle regardless of target difficulty.
  // Only reached if the target difficulty range is very rare (e.g., hard levels).
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = makeRng(BASE + attempt * 6271 + 2_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const bc3 = boundaryCount(regions, N)
    if (bc3 < minBoundaries(levelNum)) continue

    const result = canSolveLogically(regions, N)
    const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)
    if (result.solved && score >= 4) {
      return { size: N, regions, solution, colors: shuffle([...PALETTE], rng), difficulty: score, easySteps: result.easySteps, hardSteps: result.hardSteps, boundaries: bc3, rounds: result.rounds, symmetric: false }
    }
  }

  // Last resort: return a Voronoi layout without guarantee of solvability.
  const rng = makeRng(BASE)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  const voronoiRegions = growVoronoi(N, solution, rng)
  return { size: N, regions: voronoiRegions, solution, colors: shuffle([...PALETTE], rng), difficulty: 0, easySteps: 0, hardSteps: 0, boundaries: boundaryCount(voronoiRegions, N), rounds: 0, symmetric: false }
}

// ── Hint engine ──────────────────────────────────────────────────────────────

export type HintPart = { type: 'text'; text: string } | { type: 'region'; regionId: number }

export interface Hint {
  parts: HintPart[]
}

function fmtList(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

const T = (text: string): HintPart => ({ type: 'text', text })
const R = (regionId: number): HintPart => ({ type: 'region', regionId })

function fmtRegionList(ids: number[]): HintPart[] {
  if (ids.length === 1) return [R(ids[0])]
  if (ids.length === 2) return [R(ids[0]), T(' and '), R(ids[1])]
  const parts: HintPart[] = []
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) parts.push(T(i === ids.length - 1 ? ', and ' : ', '))
    parts.push(R(ids[i]))
  }
  return parts
}

export function getHint(level: GeneratedLevel, solvedRegions: Set<number>, markedCells: Set<number> = new Set()): Hint | null {
  const N = level.size
  if (solvedRegions.size === N) return null

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[level.regions[r][c]].push(r * N + c)

  const placed = new Set<number>()

  const applyPlacement = (cr: number, cc: number) => {
    for (let reg = 0; reg < N; reg++) {
      cands[reg] = cands[reg].filter(cell => {
        const r2 = ROW(cell), c2 = COL(cell)
        return r2 !== cr && c2 !== cc &&
          !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
      })
    }
  }

  for (const regId of solvedRegions) {
    placed.add(regId)
    cands[regId] = []
    const { r: cr, c: cc } = level.solution[regId]
    applyPlacement(cr, cc)
  }

  const isNew = (cells: number[]): boolean => cells.some(cell => !markedCells.has(cell))

  let anyChange = true
  while (anyChange) {
    anyChange = false

    const unplaced = Array.from({ length: N }, (_, i) => i).filter(i => !placed.has(i))
    if (unplaced.length === 0) break

    const rowSpan = cands.map(cs => new Set(cs.map(ROW)))
    const colSpan = cands.map(cs => new Set(cs.map(COL)))

    const regsInRow: Set<number>[] = Array.from({ length: N }, () => new Set())
    const regsInCol: Set<number>[] = Array.from({ length: N }, () => new Set())
    const unplacedMulti: number[] = []
    for (const reg of unplaced) {
      if (cands[reg].length === 0) return null
      if (cands[reg].length <= 1) continue
      unplacedMulti.push(reg)
      for (const r of rowSpan[reg]) regsInRow[r].add(reg)
      for (const c of colSpan[reg]) regsInCol[c].add(reg)
    }

    // Strategy 1: singleton
    for (const reg of unplaced) {
      if (cands[reg].length !== 1) continue
      const cell = cands[reg][0]

      if (!solvedRegions.has(reg)) {
        return {
          parts: [T('The '), R(reg), T(` region has only one possible cell left (row ${ROW(cell) + 1}, column ${COL(cell) + 1}). Place the cat there.`)],
        }
      }

      placed.add(reg)
      cands[reg] = []
      applyPlacement(ROW(cell), COL(cell))
      anyChange = true
      break
    }
    if (anyChange) continue

    // Naked subsets
    {
      let found = false
      for (let k = 1; k < unplacedMulti.length && !found; k++) {
        for (const subset of combinations(unplacedMulti, k)) {
          const rowU = new Set(subset.flatMap(reg => [...rowSpan[reg]]))
          if (rowU.size === k) {
            const toElim = unplacedMulti
              .filter(reg => !subset.includes(reg))
              .flatMap(reg => cands[reg].filter(cell => rowU.has(ROW(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const rows = [...rowU].sort((a, b) => a - b).map(r => r + 1)
                return {
                  parts: k === 2
                    ? [T('The '), R(subset[0]), T(' and '), R(subset[1]), T(` regions can only be in rows ${rows[0]} and ${rows[1]}. Cross out every other color's cells in those two rows.`)]
                    : [T('The '), ...fmtRegionList(subset), T(` regions are all confined to rows ${fmtList(rows.map(String))}. Cross out every other color's cells in those rows.`)],
                }
              }
              for (const other of unplacedMulti)
                if (!subset.includes(other))
                  cands[other] = cands[other].filter(cell => !rowU.has(ROW(cell)))
              anyChange = true; found = true; break
            }
          }
          if (found) break
          const colU = new Set(subset.flatMap(reg => [...colSpan[reg]]))
          if (colU.size === k) {
            const toElim = unplacedMulti
              .filter(reg => !subset.includes(reg))
              .flatMap(reg => cands[reg].filter(cell => colU.has(COL(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const cols = [...colU].sort((a, b) => a - b).map(c => c + 1)
                return {
                  parts: k === 2
                    ? [T('The '), R(subset[0]), T(' and '), R(subset[1]), T(` regions can only be in columns ${cols[0]} and ${cols[1]}. Cross out every other color's cells in those two columns.`)]
                    : [T('The '), ...fmtRegionList(subset), T(` regions are all confined to columns ${fmtList(cols.map(String))}. Cross out every other color's cells in those columns.`)],
                }
              }
              for (const other of unplacedMulti)
                if (!subset.includes(other))
                  cands[other] = cands[other].filter(cell => !colU.has(COL(cell)))
              anyChange = true; found = true; break
            }
          }
        }
      }
    }
    if (anyChange) continue

    // Hidden subsets
    {
      const activeRows = Array.from({ length: N }, (_, i) => i).filter(r => regsInRow[r].size > 0)
      const activeCols = Array.from({ length: N }, (_, i) => i).filter(c => regsInCol[c].size > 0)
      let found = false
      const maxK = Math.min(unplacedMulti.length - 1, Math.max(activeRows.length, activeCols.length))
      for (let k = 1; k <= maxK && !found; k++) {
        for (const rowSub of combinations(activeRows, k)) {
          const regsIn = [...new Set(rowSub.flatMap(r => [...regsInRow[r]]))]
          if (regsIn.length === k) {
            const axisSet = new Set(rowSub)
            const toElim = regsIn.flatMap(reg => cands[reg].filter(cell => !axisSet.has(ROW(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const rows = rowSub.map(r => r + 1)
                return {
                  parts: k === 2
                    ? [T(`Rows ${rows[0]} and ${rows[1]} are the only rows with `), R(regsIn[0]), T(' and '), R(regsIn[1]), T(` cells. Those cats must stay in those rows — cross out their cells in every other row.`)]
                    : [T(`Rows ${fmtList(rows.map(String))} are the only rows containing `), ...fmtRegionList(regsIn), T(` cells. Cross out those colors' cells outside those rows.`)],
                }
              }
              for (const reg of regsIn)
                cands[reg] = cands[reg].filter(cell => axisSet.has(ROW(cell)))
              anyChange = true; found = true; break
            }
          }
        }
        if (found) break
        for (const colSub of combinations(activeCols, k)) {
          const regsIn = [...new Set(colSub.flatMap(c => [...regsInCol[c]]))]
          if (regsIn.length === k) {
            const axisSet = new Set(colSub)
            const toElim = regsIn.flatMap(reg => cands[reg].filter(cell => !axisSet.has(COL(cell))))
            if (toElim.length > 0) {
              if (isNew(toElim)) {
                const cols = colSub.map(c => c + 1)
                return {
                  parts: k === 2
                    ? [T(`Columns ${cols[0]} and ${cols[1]} are the only columns with `), R(regsIn[0]), T(' and '), R(regsIn[1]), T(` cells. Those cats must stay in those columns — cross out their cells in every other column.`)]
                    : [T(`Columns ${fmtList(cols.map(String))} are the only columns containing `), ...fmtRegionList(regsIn), T(` cells. Cross out those colors' cells outside those columns.`)],
                }
              }
              for (const reg of regsIn)
                cands[reg] = cands[reg].filter(cell => axisSet.has(COL(cell)))
              anyChange = true; found = true; break
            }
          }
        }
      }
    }
    if (anyChange) continue

    // Trap 2×2
    {
      let found = false
      for (let reg = 0; reg < N && !found; reg++) {
        if (placed.has(reg) || cands[reg].length === 0) continue
        const rows = cands[reg].map(ROW)
        const cols = cands[reg].map(COL)
        const minR = Math.min(...rows), maxR = Math.max(...rows)
        const minC = Math.min(...cols), maxC = Math.max(...cols)
        if (maxR - minR > 1 || maxC - minC > 1) continue
        for (let other = 0; other < N && !found; other++) {
          if (other === reg || placed.has(other)) continue
          const toElim = cands[other].filter(cell => {
            const r = ROW(cell), c = COL(cell)
            return r >= minR && r <= maxR && c >= minC && c <= maxC
          })
          if (toElim.length > 0) {
            if (isNew(toElim)) {
              return {
                parts: [
                  T('The '), R(reg),
                  T(` region fits entirely in a 2×2 area (rows ${minR + 1}–${maxR + 1}, columns ${minC + 1}–${maxC + 1}). No other region's cat can go there too — cross out the `),
                  R(other),
                  T(" region's cells in that area."),
                ],
              }
            }
            cands[other] = cands[other].filter(cell => !toElim.includes(cell))
            anyChange = true; found = true
          }
        }
      }
    }
    if (anyChange) continue

    // Region crowding
    {
      let found = false
      for (let reg = 0; reg < N && !found; reg++) {
        if (placed.has(reg)) continue
        for (let ci = 0; ci < cands[reg].length && !found; ci++) {
          const cell = cands[reg][ci]
          const cr = ROW(cell), cc = COL(cell)
          for (let other = 0; other < N && !found; other++) {
            if (other === reg || placed.has(other) || cands[other].length === 0) continue
            const survivors = cands[other].filter(c2 => {
              const r2 = ROW(c2), col2 = COL(c2)
              return r2 !== cr && col2 !== cc &&
                !(Math.abs(r2 - cr) <= 1 && Math.abs(col2 - cc) <= 1)
            })
            if (survivors.length === 0) {
              if (isNew([cell])) {
                return {
                  parts: [
                    T(`Placing a cat at row ${cr + 1}, column ${cc + 1} for the `), R(reg),
                    T(' region would leave no valid cells for the '), R(other),
                    T(' region. Cross out that cell.'),
                  ],
                }
              }
              cands[reg] = cands[reg].filter(c => c !== cell)
              anyChange = true; found = true
            }
          }
        }
      }
    }
    if (anyChange) continue

    break
  }

  return {
    parts: [T('Look for regions limited to just a few rows or columns, or rows/columns that only contain a few regions.')],
  }
}
