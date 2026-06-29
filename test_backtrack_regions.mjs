// Test: build regions using backtracking uniqueness check
// After each cell assignment, verify the puzzle still has a unique solution.

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
function findPlacement(N, rng) {
  const cols = []
  const usedCols = new Set()
  function solve(row) {
    if (row === N) return true
    const candidates = shuffle(Array.from({ length: N }, (_, i) => i).filter(c => {
      if (usedCols.has(c)) return false
      if (row > 0 && Math.abs(c - cols[row - 1]) < 2) return false
      return true
    }), rng)
    for (const c of candidates) { cols[row] = c; usedCols.add(c); if (solve(row + 1)) return true; cols.pop(); usedCols.delete(c) }
    return false
  }
  solve(0); return cols
}

// Count solutions for a given region assignment
// Returns 0, 1, or 2 (stops at 2 for efficiency)
function countSolutions(regions, N, solution) {
  // Each region must have exactly one cat (at solution[id])
  // Valid placements: one per row, one per col, no adjacent, cat must be in its region
  const catRow = solution.map(s => s.r)
  const catCol = solution.map(s => s.c)

  let count = 0

  function backtrack(reg, usedRows, usedCols) {
    if (count >= 2) return
    if (reg === N) { count++; return }

    // Find all valid cells for region reg
    const cells = []
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (regions[r][c] !== reg) continue
        if (usedRows.has(r) || usedCols.has(c)) continue
        // Check no adjacent to already placed cats
        let adjacent = false
        for (const [pr, pc] of usedRows.entries ? [...usedRows].map((_, i) => [i, 0]) : []) { // wrong
          // Actually need placed positions
        }
        cells.push({ r, c })
      }
    }

    for (const { r, c } of cells) {
      if (usedRows.has(r) || usedCols.has(c)) continue
      // Check adjacency with all placed cats - need to track them
      usedRows.add(r); usedCols.add(c)
      backtrack(reg + 1, usedRows, usedCols)
      usedRows.delete(r); usedCols.delete(c)
    }
  }

  // Better: pass placed cats list
  function bt(reg, placedR, placedC, placedPos) {
    if (count >= 2) return
    if (reg === N) { count++; return }

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (regions[r][c] !== reg) continue
        if (placedR.has(r) || placedC.has(c)) continue
        // Check adjacency
        let ok = true
        for (const [pr, pc] of placedPos) {
          if (Math.abs(r - pr) <= 1 && Math.abs(c - pc) <= 1) { ok = false; break }
        }
        if (!ok) continue
        placedR.add(r); placedC.add(c); placedPos.push([r, c])
        bt(reg + 1, placedR, placedC, placedPos)
        placedR.delete(r); placedC.delete(c); placedPos.pop()
        if (count >= 2) return
      }
    }
  }

  bt(0, new Set(), new Set(), [])
  return count
}

function canSolveLogically(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cands[regions[r][c]].push(r*N+c)
  const ROW = cell => Math.floor(cell / N), COL = cell => cell % N

  let anyChange = true
  while (anyChange) {
    anyChange = false
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return false
      if (cands[reg].length !== 1) continue
      const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
      for (let other = 0; other < N; other++) {
        if (other === reg) continue
        const before = cands[other].length
        cands[other] = cands[other].filter(cell => {
          const r2 = ROW(cell), c2 = COL(cell)
          return r2 !== cr && c2 !== cc && !(Math.abs(r2-cr) <= 1 && Math.abs(c2-cc) <= 1)
        })
        if (cands[other].length < before) anyChange = true
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
      for (let i = 0; i < unplaced.length; i++) {
        for (let j = i + 1; j < unplaced.length; j++) {
          const union2 = new Set([...span[unplaced[i]], ...span[unplaced[j]]])
          if (union2.size === 2) {
            for (let other = 0; other < N; other++) {
              if (other === unplaced[i] || other === unplaced[j]) continue
              const before = cands[other].length
              cands[other] = cands[other].filter(cell => !union2.has(axisOf(cell)))
              if (cands[other].length < before) anyChange = true
            }
          }
          for (let k = j+1; k < unplaced.length; k++) {
            const union3 = new Set([...union2, ...span[unplaced[k]]])
            if (union3.size === 3) {
              for (let other = 0; other < N; other++) {
                if (other === unplaced[i] || other === unplaced[j] || other === unplaced[k]) continue
                const before = cands[other].length
                cands[other] = cands[other].filter(cell => !union3.has(axisOf(cell)))
                if (cands[other].length < before) anyChange = true
              }
            }
          }
        }
      }
      for (let a = 0; a < N; a++) {
        for (let b = a+1; b < N; b++) {
          const pair = [...new Set([...regsInAxis[a], ...regsInAxis[b]])]
          if (pair.length === 2) {
            const axisSet2 = new Set([a, b])
            for (const reg of pair) {
              const before = cands[reg].length
              cands[reg] = cands[reg].filter(cell => axisSet2.has(axisOf(cell)))
              if (cands[reg].length < before) anyChange = true
            }
          }
          for (let c = b+1; c < N; c++) {
            const triple = [...new Set([...regsInAxis[a], ...regsInAxis[b], ...regsInAxis[c]])]
            if (triple.length === 3) {
              const axisSet3 = new Set([a, b, c])
              for (const reg of triple) {
                const before = cands[reg].length
                cands[reg] = cands[reg].filter(cell => axisSet3.has(axisOf(cell)))
                if (cands[reg].length < before) anyChange = true
              }
            }
          }
        }
      }
    }
  }
  return cands.every(c => c.length === 1)
}

// Test: is a uniquely-solvable puzzle always logically solvable with pairs+triples?
// Start with singletons (unique solution) and see what happens as we grow regions.
// If we can grow regions while maintaining (a) uniqueness AND (b) logical solvability,
// that gives us the structure we need.

const N = 10
const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]

function testGrowWithCheck(seed) {
  const rng = makeRng(seed)
  const catCols = findPlacement(N, rng)
  const solution = catCols.map((c, r) => ({ r, c }))

  // Start: each region = just its cat cell (singleton)
  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  solution.forEach(({ r, c }, id) => { grid[r][c] = id })

  // Try to grow each region to TARGET cells while maintaining logical solvability
  const TARGET = 10
  const queues = solution.map(({ r, c }) => [{ r, c }])
  const sizes = Array(N).fill(1)

  let iterations = 0
  const maxIter = N * TARGET * 4
  let anyGrew = true
  while (anyGrew && iterations < maxIter) {
    anyGrew = false
    iterations++
    for (let id = 0; id < N; id++) {
      if (sizes[id] >= TARGET) continue
      const q = queues[id]
      if (q.length === 0) continue
      const dirs = shuffle([...DIRS], rng)
      let grew = false
      for (let qi = 0; qi < q.length && !grew; qi++) {
        const { r, c } = q[Math.floor(rng() * q.length)]
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc] !== -1) continue
          // Try assigning this cell to region id
          grid[nr][nc] = id
          sizes[id]++
          // Check if still logically solvable
          if (canSolveLogically(grid.map(row => [...row]), N)) {
            q.push({ r: nr, c: nc })
            grew = true
            anyGrew = true
            break
          } else {
            // Revert
            grid[nr][nc] = -1
            sizes[id]--
          }
        }
      }
    }
  }

  // Count unclaimed cells
  let unclaimed = 0
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) unclaimed++

  // Assign unclaimed to nearest region (may break logical solvability)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      solution.forEach(({ r: sr, c: sc }, id) => {
        const d = Math.abs(r-sr)+Math.abs(c-sc)
        if (d < bestDist) { bestDist = d; best = id }
      })
      grid[r][c] = best
    }
  }

  return { grid, sizes, unclaimed, solvable: canSolveLogically(grid.map(row => [...row]), N) }
}

// Test a few instances
console.log('Testing grow-with-logical-check:')
for (let seed = 0; seed < 5; seed++) {
  const t0 = Date.now()
  const { grid, sizes, unclaimed, solvable } = testGrowWithCheck(seed * 6271)
  const elapsed = Date.now() - t0
  console.log(`Seed ${seed}: sizes=[${sizes.join(',')}] unclaimed=${unclaimed} solvable=${solvable} (${elapsed}ms)`)
}
