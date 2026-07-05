// Benchmark: test solvability with forcing chains (Strategy 6)
// Tests balanced 2+2+2+4 free-region config vs original 2+3+4+1 blob config

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

function combinations(arr, k) {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
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

// ── Solver with Strategy 6 (forcing chains) ──────────────────────────────────
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
      const activeAxis = Array.from({ length: N }, (_, i) => i).filter(a => regsInAxis[a].length > 0)
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

    // Strategy 6: Forcing chains
    if (!anyChange) {
      for (let reg = 0; reg < N && !anyChange; reg++) {
        if (cands[reg].length <= 1) continue
        for (let ci = cands[reg].length - 1; ci >= 0 && !anyChange; ci--) {
          const cell = cands[reg][ci]
          const cr = ROW(cell), cc = COL(cell)

          // Clone the candidate state
          const simCands = cands.map(c => [...c])

          // Simulate placing reg at cell
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

// ── Balanced layout: 2+2+2+4 free-region config ──────────────────────────────
// 2 singletons, 2 doublets, 2 triples, 4 quads — all ~equal size, no giant blob
function growBalancedFree(N, seeds, rng) {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const N_SING = 2, N_DOUB = 2, N_TRIP = 2, N_QUAD = 4
  const isSing = new Set(shuffledIds.slice(0, N_SING))
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const isQuad = new Set(shuffledIds.slice(N_SING + N_DOUB + N_TRIP, N_SING + N_DOUB + N_TRIP + N_QUAD))
  // Remaining 0 seeds get blob treatment (fills remaining cells)

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

  // Quads: grow 3 extra cells via BFS
  for (const id of isQuad) {
    const { r: sr, c: sc } = seeds[id]
    const q = [{ r: sr, c: sc }]; let grown = 0
    for (let qi = 0; qi < q.length && grown < 3; qi++) {
      const { r, c } = q[qi]
      for (const [dr, dc] of shuffle([...DIRS], rng)) {
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; q.push({ r: nr, c: nc }); grown++; break
        }
      }
    }
  }

  // Fill remaining cells with nearest seed (Voronoi fallback)
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

// ── Original blob layout: 2+3+4+1 ────────────────────────────────────────────
function growBlobOriginal(N, seeds, rng) {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const N_SING = 2, N_DOUB = 3, N_TRIP = 4
  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const isSing = new Set(shuffledIds.slice(0, N_SING))
  const isDoub = new Set(shuffledIds.slice(N_SING, N_SING + N_DOUB))
  const isTrip = new Set(shuffledIds.slice(N_SING + N_DOUB, N_SING + N_DOUB + N_TRIP))
  const largeId = shuffledIds[N - 1]

  // Doublets
  for (const id of isDoub) {
    const { r: sr, c: sc } = seeds[id]
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id; break
      }
    }
  }

  // Triples
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

  // Large blob
  const blobSeed = seeds[largeId]
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
    for (const [dr, dc] of DIRS) {
      const nr = br + dr, nc = bc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        blobFrontier.push({ r: nr, c: nc, dist: Math.abs(nr - blobSeed.r) + Math.abs(nc - blobSeed.c) })
    }
  }

  // Fallback
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

// ── Run benchmark ─────────────────────────────────────────────────────────────
const N = 10
const TRIALS = 200

function runBenchmark(label, growFn) {
  let solved = 0
  let usedForcing = 0
  const start = Date.now()

  for (let i = 0; i < TRIALS; i++) {
    const rng = makeRng(i * 6271 + 42)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growFn(N, solution, rng)
    const result = canSolveLogically(regions, N)
    if (result.solved) {
      solved++
      if (result.strategiesUsed & 32) usedForcing++
    }
  }

  const elapsed = Date.now() - start
  const rate = ((solved / TRIALS) * 100).toFixed(1)
  const forcingRate = solved > 0 ? ((usedForcing / solved) * 100).toFixed(1) : '0.0'
  console.log(`\n${label}`)
  console.log(`  Trials:         ${TRIALS}`)
  console.log(`  Solved:         ${solved} / ${TRIALS} (${rate}%)`)
  console.log(`  Used forcing:   ${usedForcing} / ${solved} solved (${forcingRate}% of solved)`)
  console.log(`  Time:           ${elapsed}ms (${(elapsed / TRIALS).toFixed(1)}ms/trial)`)
  return { solved, usedForcing, rate, elapsed }
}

console.log('=== Forcing Chains Benchmark ===')
console.log(`N=${N}, ${TRIALS} trials each`)

const freeResult = runBenchmark('CONFIG A: Balanced free-region (2+2+2+4)', growBalancedFree)
const blobResult = runBenchmark('CONFIG B: Original blob (2+3+4+1)', growBlobOriginal)

console.log('\n=== Summary ===')
console.log(`Balanced free-region solvability: ${freeResult.rate}%`)
console.log(`Original blob solvability:        ${blobResult.rate}%`)
