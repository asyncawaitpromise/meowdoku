// Benchmark script for meowdoku puzzle generation pipeline
// Ported from client/src/lib/levelGen.ts

const N = 10

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

// ── Connectivity check ───────────────────────────────────────────────────────
function isConnectedWithout(grid, N, skipR, skipC, reg) {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
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
    const cur = queue.shift()
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

// ── Constraint-propagation solver (strategies 1-7) ───────────────────────────
function canSolveLogically(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell) => Math.floor(cell / N)
  const COL = (cell) => cell % N

  let anyChange = true
  let strategiesUsed = 0

  while (anyChange) {
    anyChange = false

    // 1. Singleton propagation
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return { solved: false, strategiesUsed, unsolvedCount: N }
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
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 1 }
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
            if (cands[other].length < before) { anyChange = true; strategiesUsed |= 2 }
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
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4 }
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
        if (cands[other].length < before) { anyChange = true; strategiesUsed |= 8 }
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
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 16 }
          }
        }
      }
    }

    // Strategy 6: Branch Rule (bit 64)
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
          cands[reg] = [cellB]; anyChange = true; strategiesUsed |= 64; continue
        }
        if (!okB) {
          cands[reg] = [cellA]; anyChange = true; strategiesUsed |= 64; continue
        }

        for (let other = 0; other < N && !anyChange; other++) {
          if (other === reg) continue
          const setA = new Set(simA[other])
          const setB = new Set(simB[other])
          const before = cands[other].length
          cands[other] = cands[other].filter(c => setA.has(c) || setB.has(c))
          if (cands[other].length < before) { anyChange = true; strategiesUsed |= 64 }
        }
      }
    }

    // Strategy 7: Forcing chains (bit 32)
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
              return r2 !== cr && c2c !== cc &&
                !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
            })
            if (simCands[other].length === 0) { contradiction = true; break }
          }

          if (contradiction) continue

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

            // Naked/hidden subsets in sim
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

            // Trap 2x2 in sim
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

          if (contradiction) {
            cands[reg] = cands[reg].filter(c => c !== cell)
            anyChange = true
            strategiesUsed |= 32
          }
        }
      }
    }
  }

  const unsolvedCount = cands.filter(c => c.length > 1).length
  return { solved: cands.every(c => c.length === 1), strategiesUsed, unsolvedCount }
}

// ── countSolutions ───────────────────────────────────────────────────────────
function countSolutions(regions, N, maxCount = 2) {
  const initCands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      initCands[regions[r][c]].push(r * N + c)

  const ROW = (cell) => Math.floor(cell / N)
  const COL = (cell) => cell % N

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

// ── difficultyScore ──────────────────────────────────────────────────────────
function difficultyScore(strategiesUsed) {
  // Bit 0(1)=singleton=1, Bit 1(2)=naked=3, Bit 2(4)=hidden=6,
  // Bit 3(8)=trap2x2=4, Bit 4(16)=crowding=10, Bit 5(32)=forcing=15, Bit 6(64)=branch=8
  const WEIGHTS = [1, 3, 6, 4, 10, 15, 8]
  let score = 0
  for (let i = 0; i < WEIGHTS.length; i++) {
    if (strategiesUsed & (1 << i)) score += WEIGHTS[i]
  }
  return score
}

// ── targetDifficulty ─────────────────────────────────────────────────────────
function targetDifficulty(levelNum) {
  if (levelNum <= 3)  return { minScore: 1,  maxScore: 6  }
  if (levelNum <= 8)  return { minScore: 4,  maxScore: 14 }
  if (levelNum <= 15) return { minScore: 7,  maxScore: 35 }
  return             { minScore: 12, maxScore: 100 }
}

// ── growSizeBalanced ─────────────────────────────────────────────────────────
// Hybrid: 2 singletons + 3 doublets + 3 triples (anchors) + 2 medium regions.
// Medium regions use randomized Prim's (pick highest-priority frontier cell)
// creating branching arms + jagged boundaries instead of circular blobs.
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
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; break
      }
    }
  }

  for (const id of isTrip) {
    const { r: sr, c: sc } = seeds[id]
    let r1 = -1, c1 = -1
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
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
        for (const [dr, dc] of shuffle([...DIRS], rng)) {
          const nr = br + dr, nc = bc + dc
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
            grid[nr][nc] = id; found = true; break
          }
        }
        if (found) break
      }
    }
  }

  // Pre-assign random priorities for Prim's-style organic growth
  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] !== -1) sizes[grid[r][c]]++
  for (let id = 0; id < N; id++) if (sizes[id] < 1) sizes[id] = 1

  const freeSet = new Set(freeIds)
  const frontierMaps = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] === -1 || !freeSet.has(grid[r][c])) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        const cell = nr * N + nc
        frontierMaps[grid[r][c]].set(cell, cellPrio[cell])
      }
    }
  }

  let remaining = 0
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) remaining++

  while (remaining > 0) {
    const weights = freeIds.map(i => frontierMaps[i].size > 0 ? 1 / (sizes[i] * sizes[i]) : 0)
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) break

    let rv = rng() * total; let chosen = freeIds[freeIds.length - 1]
    for (let i = 0; i < freeIds.length; i++) {
      rv -= weights[i]
      if (rv <= 0) { chosen = freeIds[i]; break }
    }

    // Pick highest-priority frontier cell (Prim's style)
    let bestCell = -1, bestPrio = -1
    for (const [cell, prio] of frontierMaps[chosen]) {
      if (prio > bestPrio) { bestPrio = prio; bestCell = cell }
    }
    if (bestCell === -1) break
    frontierMaps[chosen].delete(bestCell)

    const cr = Math.floor(bestCell / N), cc = bestCell % N
    if (grid[cr][cc] !== -1) continue

    grid[cr][cc] = chosen; sizes[chosen]++; remaining--
    for (const [dr, dc] of DIRS) {
      const nr = cr + dr, nc = cc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        const cell = nr * N + nc
        if (!frontierMaps[chosen].has(cell))
          frontierMaps[chosen].set(cell, cellPrio[cell])
      }
    }
  }

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

// ── growBalanced ─────────────────────────────────────────────────────────────
function growBalanced(N, seeds, rng) {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const N_SING = 2, N_DOUB = 3, N_TRIP = 4
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const largeId = shuffledIds[N - 1]

  // Doublets: grow 1 extra cell
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
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
      for (const [dr, dc] of shuffle([...DIRS], rng)) {
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; q.push({ r: nr, c: nc }); grown++; break
        }
      }
    }
  }

  // Large blob: distance-biased BFS
  const blobSeed = seeds[largeId]
  const inBlob = new Set()
  inBlob.add(blobSeed.r * N + blobSeed.c)
  const blobFrontier = []
  for (const [dr, dc] of DIRS) {
    const nr = blobSeed.r + dr, nc = blobSeed.c + dc
    if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
      blobFrontier.push({ r: nr, c: nc, dist: Math.abs(nr - blobSeed.r) + Math.abs(nc - blobSeed.c) })
  }
  while (blobFrontier.length > 0) {
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

  // Fallback: assign remaining unclaimed cells to nearest seed
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

// ── growVoronoi (last-resort fallback) ───────────────────────────────────────
function growVoronoi(N, seeds, rng) {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  let frontier = shuffle(seeds.map((s, id) => ({ ...s, id })), rng)

  while (frontier.length > 0) {
    const idx = Math.floor(rng() * frontier.length)
    const entry = frontier[idx]
    frontier[idx] = frontier[frontier.length - 1]
    frontier.pop()
    const { r, c, id } = entry
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc] !== -1) continue
      grid[nr][nc] = id
      frontier.push({ r: nr, c: nc, id })
    }
  }

  return grid
}

// ── Helper: max region size ───────────────────────────────────────────────────
function maxRegionSize(regions, N) {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      sizes[regions[r][c]]++
  return Math.max(...sizes)
}

// ── generateLevel ─────────────────────────────────────────────────────────────
function generateLevel(levelNum, puzzleSeed = 0) {
  const BASE = levelNum * 100003 + 17 + puzzleSeed * 999983

  // Phase 1: Size-balanced growth
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growSizeBalanced(N, solution, rng)

    if (countSolutions(regions, N, 2) !== 1) continue

    const result = canSolveLogically(regions, N)
    const score = difficultyScore(result.strategiesUsed)
    const { minScore, maxScore } = targetDifficulty(levelNum)
    if (score >= minScore && score <= maxScore) {
      return { regions, solution, difficulty: score, phase: 1, attempt }
    }
  }

  // Phase 2: Structured engineered regions
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = makeRng(BASE + attempt * 6271 + 1_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const result = canSolveLogically(regions, N)
    const score = difficultyScore(result.strategiesUsed)
    const { minScore, maxScore } = targetDifficulty(levelNum)
    if (result.solved && score >= minScore && score <= maxScore) {
      return { regions, solution, difficulty: score, phase: 2, attempt }
    }
  }

  // Phase 3: Fallback — any solvable puzzle
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = makeRng(BASE + attempt * 6271 + 2_000_000)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growBalanced(N, solution, rng)

    const result = canSolveLogically(regions, N)
    const score = difficultyScore(result.strategiesUsed)
    if (result.solved && score >= 4) {
      return { regions, solution, difficulty: score, phase: 3, attempt }
    }
  }

  // Phase 4: Last resort Voronoi
  const rng = makeRng(BASE)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))
  return { regions: growVoronoi(N, solution, rng), solution, difficulty: 0, phase: 4, attempt: 0 }
}

// ── Benchmark ────────────────────────────────────────────────────────────────
const BLOB_THRESHOLD = 20
const LEVELS = 20

console.log('Benchmarking puzzle generation pipeline (levels 1-20)\n')
console.log(`${'Level'.padEnd(6)} ${'Phase'.padEnd(6)} ${'MaxSz'.padEnd(6)} ${'Blob?'.padEnd(6)} ${'Diff'.padEnd(6)} ${'Unique'.padEnd(7)} ${'Time(ms)'.padEnd(10)} Strategies`)
console.log('-'.repeat(80))

const totalStart = Date.now()
const results = []

for (let level = 1; level <= LEVELS; level++) {
  const t0 = Date.now()
  const level_result = generateLevel(level)
  const elapsed = Date.now() - t0

  const { regions, phase, difficulty } = level_result
  const maxSize = maxRegionSize(regions, N)
  const isBlob = maxSize > BLOB_THRESHOLD
  const solCount = countSolutions(regions, N, 2)
  const unique = solCount === 1

  const logResult = canSolveLogically(regions, N)
  const stratBits = logResult.strategiesUsed

  const stratNames = []
  if (stratBits & 1)  stratNames.push('singleton')
  if (stratBits & 2)  stratNames.push('naked')
  if (stratBits & 4)  stratNames.push('hidden')
  if (stratBits & 8)  stratNames.push('trap2x2')
  if (stratBits & 16) stratNames.push('crowding')
  if (stratBits & 32) stratNames.push('forcing')
  if (stratBits & 64) stratNames.push('branch')

  results.push({ level, phase, maxSize, isBlob, difficulty, unique, elapsed, stratBits })

  console.log(
    `${String(level).padEnd(6)} ` +
    `P${phase}    ` +
    `${String(maxSize).padEnd(6)} ` +
    `${(isBlob ? 'YES' : 'no').padEnd(6)} ` +
    `${String(difficulty).padEnd(6)} ` +
    `${(unique ? 'YES' : 'NO').padEnd(7)} ` +
    `${String(elapsed).padEnd(10)} ` +
    stratNames.join('+')
  )
}

const totalElapsed = Date.now() - totalStart

console.log('\n' + '='.repeat(80))
console.log('SUMMARY')
console.log('='.repeat(80))

const phase1Count = results.filter(r => r.phase === 1).length
const phase2Count = results.filter(r => r.phase === 2).length
const phase3Count = results.filter(r => r.phase === 3).length
const phase4Count = results.filter(r => r.phase === 4).length
console.log('Phase distribution:')
console.log(`  Phase 1 (growSizeBalanced): ${phase1Count}/${LEVELS} (${(phase1Count/LEVELS*100).toFixed(1)}%)`)
console.log(`  Phase 2 (growBalanced):     ${phase2Count}/${LEVELS} (${(phase2Count/LEVELS*100).toFixed(1)}%)`)
console.log(`  Phase 3 (fallback):         ${phase3Count}/${LEVELS} (${(phase3Count/LEVELS*100).toFixed(1)}%)`)
console.log(`  Phase 4 (last resort):      ${phase4Count}/${LEVELS} (${(phase4Count/LEVELS*100).toFixed(1)}%)`)

const blobCount = results.filter(r => r.isBlob).length
console.log(`\nBlob rate (maxSize > ${BLOB_THRESHOLD}): ${blobCount}/${LEVELS} (${(blobCount/LEVELS*100).toFixed(1)}%)`)
const maxSizes = results.map(r => r.maxSize)
console.log(`Max region sizes: min=${Math.min(...maxSizes)}, max=${Math.max(...maxSizes)}, avg=${(maxSizes.reduce((a,b)=>a+b,0)/LEVELS).toFixed(1)}`)

const uniqueCount = results.filter(r => r.unique).length
console.log(`\nUniqueness pass rate: ${uniqueCount}/${LEVELS} (${(uniqueCount/LEVELS*100).toFixed(1)}%)`)

const diffs = results.map(r => r.difficulty)
console.log('\nDifficulty distribution:')
console.log(`  min=${Math.min(...diffs)}, max=${Math.max(...diffs)}, avg=${(diffs.reduce((a,b)=>a+b,0)/LEVELS).toFixed(1)}`)

const easyLevels   = results.filter(r => r.level <= 3)
const medLevels    = results.filter(r => r.level > 3 && r.level <= 8)
const hardLevels   = results.filter(r => r.level > 8 && r.level <= 15)
const expertLevels = results.filter(r => r.level > 15)

const tierAvg = (arr) => arr.length ? (arr.reduce((a,b) => a + b.difficulty, 0) / arr.length).toFixed(1) : 'N/A'
console.log(`  Easy   (1-3,   target  1-6):   avg=${tierAvg(easyLevels)}`)
console.log(`  Medium (4-8,   target  4-14):  avg=${tierAvg(medLevels)}`)
console.log(`  Hard   (9-15,  target  7-35):  avg=${tierAvg(hardLevels)}`)
console.log(`  Expert (16-20, target 12-100): avg=${tierAvg(expertLevels)}`)

const stratCounts = { singleton: 0, naked: 0, hidden: 0, trap2x2: 0, crowding: 0, forcing: 0, branch: 0 }
for (const r of results) {
  if (r.stratBits & 1)  stratCounts.singleton++
  if (r.stratBits & 2)  stratCounts.naked++
  if (r.stratBits & 4)  stratCounts.hidden++
  if (r.stratBits & 8)  stratCounts.trap2x2++
  if (r.stratBits & 16) stratCounts.crowding++
  if (r.stratBits & 32) stratCounts.forcing++
  if (r.stratBits & 64) stratCounts.branch++
}
console.log(`\nStrategy usage across ${LEVELS} levels:`)
for (const [name, count] of Object.entries(stratCounts)) {
  console.log(`  ${name.padEnd(12)}: ${count}/${LEVELS} (${(count/LEVELS*100).toFixed(1)}%)`)
}

console.log(`\nTotal time: ${totalElapsed}ms (avg ${(totalElapsed/LEVELS).toFixed(0)}ms/level)`)

// Print a sample grid for a Phase 1 level to visualize region shapes
const sample = results.find(r => r.phase === 1)
if (sample) {
  const { regions, solution } = generateLevel(sample.level)
  const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  console.log(`\nSample grid (level ${sample.level}, Phase 1, maxSz=${sample.maxSize}):`)
  const solSet = new Set(solution.map(({r,c})=>r*N+c))
  for (let r = 0; r < N; r++) {
    let row = ''
    for (let c = 0; c < N; c++) {
      const id = regions[r][c]
      const ch = CHARS[id] || '?'
      row += solSet.has(r*N+c) ? `[${ch}]` : ` ${ch} `
    }
    console.log(row)
  }
  // Print region sizes
  const sz = Array(N).fill(0)
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)sz[regions[r][c]]++
  console.log('Sizes:', sz.join(' '))
}
