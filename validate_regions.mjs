// Quick validation script for growRegions solvability
// Usage: node validate_regions.mjs

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

function growRegions(N, seeds, rng) {
  const N_SINGLETON = 4
  const N_SMALL     = N - N_SINGLETON - 1  // 5

  const sortedByRow = seeds
    .map((s, id) => ({ id, row: s.r }))
    .sort((a, b) => a.row - b.row)

  const isSingleton = new Set()
  const isSmall = new Set()
  sortedByRow.forEach(({ id }, idx) => {
    if (idx < N_SINGLETON) isSingleton.add(id)
    else if (idx < N_SINGLETON + N_SMALL) isSmall.add(id)
  })

  const HDIRS = [[0, -1], [0, 1]]
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]

  const grid = Array.from({ length: N }, () => Array(N).fill(-1))
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  // Phase 1: small regions – grow exactly 1 extra cell, prefer horizontal
  for (const id of isSmall) {
    const { r: sr, c: sc } = seeds[id]
    let grew = false
    for (const [, dc] of shuffle([...HDIRS], rng)) {
      const nc = sc + dc
      if (nc >= 0 && nc < N && grid[sr][nc] === -1) {
        grid[sr][nc] = id; grew = true; break
      }
    }
    if (!grew) {
      for (const [dr, dc] of shuffle([...DIRS], rng)) {
        const nr = sr + dr, nc = sc + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
          grid[nr][nc] = id; break
        }
      }
    }
  }

  // Phase 2: large region – randomised BFS to fill unclaimed cells
  const largeQ = []
  seeds.forEach((s, id) => {
    if (!isSingleton.has(id) && !isSmall.has(id)) largeQ.push({ ...s, id })
  })
  for (let qi = 0; qi < largeQ.length; qi++) {
    const { r, c, id } = largeQ[qi]
    for (const [dr, dc] of shuffle([...DIRS], rng)) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = id
        largeQ.push({ r: nr, c: nc, id })
      }
    }
  }

  // Phase 3: assign remaining unclaimed cells to nearest non-singleton
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = -1, bestDist = Infinity
      seeds.forEach(({ r: sr, c: sc }, id) => {
        if (isSingleton.has(id)) return
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      })
      if (best === -1) {
        seeds.forEach(({ r: sr, c: sc }, id) => {
          const d = Math.abs(r - sr) + Math.abs(c - sc)
          if (d < bestDist) { bestDist = d; best = id }
        })
      }
      grid[r][c] = best
    }
  }

  return grid
}

function canSolveLogically(regions, N) {
  const cands = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell) => Math.floor(cell / N)
  const COL = (cell) => cell % N

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
          return r2 !== cr && c2 !== cc &&
            !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
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

          for (let k = j + 1; k < unplaced.length; k++) {
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

      const regsInAxis = axis === 0 ? regsInRow : regsInCol
      for (let a = 0; a < N; a++) {
        for (let b = a + 1; b < N; b++) {
          const pair = [...new Set([...regsInAxis[a], ...regsInAxis[b]])]
          if (pair.length === 2) {
            const axisSet2 = new Set([a, b])
            for (const reg of pair) {
              const before = cands[reg].length
              cands[reg] = cands[reg].filter(cell => axisSet2.has(axisOf(cell)))
              if (cands[reg].length < before) anyChange = true
            }
          }

          for (let c = b + 1; c < N; c++) {
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

// ── Run validation ────────────────────────────────────────────────────────────
const N = 10
const ATTEMPTS_PER_LEVEL = 30
const MIN_SOLVABLE_RATE = 0.30

let allPass = true

for (let levelNum = 1; levelNum <= 5; levelNum++) {
  let solvable = 0
  const BASE = levelNum * 100003 + 17

  for (let attempt = 0; attempt < ATTEMPTS_PER_LEVEL; attempt++) {
    const rng = makeRng(BASE + attempt * 6271)
    const catCols = findPlacement(N, rng)
    const solution = catCols.map((c, r) => ({ r, c }))
    const regions = growRegions(N, solution, rng)

    // Verify all cells are claimed and solution cells are in their region
    let valid = true
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (regions[r][c] === -1) { valid = false; break }
      }
    }
    for (let id = 0; id < N; id++) {
      const { r, c } = solution[id]
      if (regions[r][c] !== id) { valid = false; break }
    }

    if (!valid) {
      console.error(`Level ${levelNum} attempt ${attempt}: INVALID grid (unclaimed cells or cat outside region)`)
      continue
    }

    if (canSolveLogically(regions, N)) solvable++
  }

  const rate = solvable / ATTEMPTS_PER_LEVEL
  const pass = rate >= MIN_SOLVABLE_RATE
  if (!pass) allPass = false

  // Print region size distribution for first attempt of level 1
  if (levelNum === 1) {
    const rng0 = makeRng(BASE)
    const catCols0 = findPlacement(N, rng0)
    const sol0 = catCols0.map((c, r) => ({ r, c }))
    const reg0 = growRegions(N, sol0, rng0)
    const sizes = Array(N).fill(0)
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        sizes[reg0[r][c]]++
    console.log(`Level 1 attempt 0 region sizes: [${sizes.join(', ')}]`)
    console.log(`  min=${Math.min(...sizes)} max=${Math.max(...sizes)} sum=${sizes.reduce((a,b)=>a+b,0)}`)
  }

  console.log(`Level ${levelNum}: ${solvable}/${ATTEMPTS_PER_LEVEL} solvable (${(rate*100).toFixed(1)}%) ${pass ? 'PASS' : 'FAIL'}`)
}

console.log(allPass ? '\nAll levels PASS' : '\nSome levels FAIL')
process.exit(allPass ? 0 : 1)
