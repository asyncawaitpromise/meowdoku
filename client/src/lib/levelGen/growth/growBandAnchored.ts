import { shuffle } from '../rng'
import { DIRS } from './directions'

// Same 8-anchor + 2-free skeleton as growSizeBalanced (proven ~10% raw
// solvability via its singleton/doublet/triple cascade), except 2 of the
// 8 anchors are "band anchors": 4-cell regions confined to a shared 2-row
// strip instead of growing freely. That confinement is what makes naked-pair
// (bit 2) / hidden-pair (bit 4) deductions possible — common-neighbor and
// singleton propagation alone can't produce a "these 2 regions are confined
// to exactly these 2 rows" deduction, since that reasons about the union of
// 2 regions jointly, not a single pairwise conflict.
//
// Structure: 2 singletons + 4 doublets + 2 band anchors (4 cells each,
// confined to 2 shared rows) + 2 free/medium regions. No standalone triple —
// dropping it (vs. growSizeBalanced's 3 doublets + 3 triples) reduces the
// early elimination pressure on the band pair, which matters because even
// with real contention (see below), the band pair tends to get collapsed to
// a single forced candidate by singleton/common-neighbor cascading in from
// every other anchor before the naked-pair check ever gets a turn — 4-cell
// anchors with lighter surrounding pressure survive with real ambiguity far
// more often than the original 3-cell/3-triple design (empirically ~10x).
//
// Naively confining 2 anchors to a shared 2-row band fires the naked-pair
// deduction vacuously: with ~20 cells to themselves and nothing else
// contesting the space, the 2 band anchors just absorb the whole strip, so
// there's nothing left in those rows to eliminate from anyone else. To
// guarantee real contention, we pre-claim one band-row cell for each
// non-singleton anchor seeded directly above/below the band (before growth
// starts), so its candidates still reach into the band at solve time and the
// naked-pair elimination has real work to do — same fix already proven for
// medium-tier's naked-pair firing rate.
//
// Returns null if either band anchor can't reach its target size, or if no
// row pair has an available bordering region for contention (rare, since
// findPlacement forbids near-adjacent seeds in adjacent rows).
export function growBandAnchored(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] | null {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const anchorD1 = shuffledIds[0], anchorD2 = shuffledIds[1]
  const anchorSet = new Set([anchorD1, anchorD2])
  const anchorRows = new Set([seeds[anchorD1].r, seeds[anchorD2].r])

  const regionAtRow = new Array<number>(N)
  seeds.forEach((s, id) => { regionAtRow[s.r] = id })

  // Band row pair: 2 adjacent rows, neither an anchor row, with at least
  // one available bordering row (also not an anchor row) for contention.
  const bandCandidates: { r1: number; r2: number }[] = []
  for (let r = 0; r < N - 1; r++) {
    if (anchorRows.has(r) || anchorRows.has(r + 1)) continue
    const hasAbove = r - 1 >= 0 && !anchorRows.has(r - 1)
    const hasBelow = r + 2 < N && !anchorRows.has(r + 2)
    if (hasAbove || hasBelow) bandCandidates.push({ r1: r, r2: r + 1 })
  }
  if (bandCandidates.length === 0) return null

  const { r1, r2 } = bandCandidates[Math.floor(rng() * bandCandidates.length)]
  const bandId1 = regionAtRow[r1], bandId2 = regionAtRow[r2]
  const bandSet = new Set([bandId1, bandId2])
  const bandRows = new Set([r1, r2])
  const aboveId = (r1 - 1 >= 0 && !anchorRows.has(r1 - 1)) ? regionAtRow[r1 - 1] : -1
  const belowId = (r2 + 1 < N && !anchorRows.has(r2 + 1)) ? regionAtRow[r2 + 1] : -1

  // Remaining 6 ids (excluding 2-cell anchors + band anchors) get doublet/free roles.
  const rest = shuffledIds.filter(id => !anchorSet.has(id) && !bandSet.has(id))
  const N_DOUB = 4
  const isDoub = new Set(rest.slice(0, N_DOUB))
  const freeIds = rest.slice(N_DOUB)  // 2 medium/free regions

  const sizes = Array(N).fill(1)  // seed cell counted for every region

  // Grow 2-cell anchors: each gets 1 extra cell next to its seed
  for (const anchId of anchorSet) {
    const { r: sr, c: sc } = seeds[anchId]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = anchId; sizes[anchId]++; break
      }
    }
  }

  // Force one band-row cell per available bordering anchor before any other
  // growth happens, so its territory genuinely reaches into the band.
  if (aboveId !== -1) {
    const aboveCol = seeds[aboveId].c
    if (grid[r1][aboveCol] === -1) { grid[r1][aboveCol] = aboveId; sizes[aboveId]++ }
  }
  if (belowId !== -1) {
    const belowCol = seeds[belowId].c
    if (grid[r2][belowCol] === -1) { grid[r2][belowCol] = belowId; sizes[belowId]++ }
  }

  // Grows `extra` more cells for region `id`, extending from any of its
  // currently-placed cells (so a pre-claimed contention cell counts as a
  // valid growth base too), optionally confined to `rowConstraint`.
  const growCells = (id: number, extra: number, rowConstraint: Set<number> | null) => {
    for (let k = 0; k < extra; k++) {
      const cells: [number, number][] = []
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === id) cells.push([r, c])
      let placed = false
      for (const [br, bc] of shuffle(cells, rng)) {
        for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
          const nr = br + dr, nc = bc + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc] !== -1) continue
          if (rowConstraint && !rowConstraint.has(nr)) continue
          grid[nr][nc] = id; sizes[id]++; placed = true; break
        }
        if (placed) break
      }
      if (!placed) break
    }
  }

  // Band anchors: target 4 cells each, confined to the shared band rows.
  growCells(bandId1, 4 - sizes[bandId1], bandRows)
  growCells(bandId2, 4 - sizes[bandId2], bandRows)

  // Doublets: target 2 cells (a pre-claimed contention cell already counts).
  for (const id of isDoub) growCells(id, 2 - sizes[id], null)

  // Free/medium regions absorb the rest via size-biased Prim's, same as growSizeBalanced.
  const cellPrio = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) cellPrio[i] = rng()

  const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const id = grid[r][c]
    if (id === -1 || !freeIds.includes(id)) continue
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
        frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
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

  // Fallback: unclaimed cells → nearest FREE region only (anchors stay capped).
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== -1) continue
      let best = freeIds[0], bestDist = Infinity
      for (const id of freeIds) {
        const { r: sr, c: sc } = seeds[id]
        const d = Math.abs(r - sr) + Math.abs(c - sc)
        if (d < bestDist) { bestDist = d; best = id }
      }
      grid[r][c] = best; sizes[best]++
    }
  }

  if (sizes[bandId1] < 2 || sizes[bandId2] < 2) return null
  return grid
}
