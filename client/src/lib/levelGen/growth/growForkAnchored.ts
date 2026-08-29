import { shuffle } from '../rng'
import { DIRS } from './directions'
import { fillUnclaimedByAdjacency } from './fillUnclaimed'

// Every other growth strategy produces puzzles solvable by singleton +
// common-neighbor + occasional naked/hidden-pair — never branch-rule (bit 64)
// or forcing-chain (bit 32), because those techniques are only ever NEEDED
// when a contradiction takes two dependent hops to prove, and common-neighbor
// (which runs eagerly, unconditionally, every round) already resolves any
// single-hop contradiction on its own — no amount of random "more contention"
// can manufacture a genuine two-hop fork by luck (verified empirically: 0
// hits across 20,000+ raw attempts of every other grow* strategy).
//
// This constructs that fork deliberately, using 3 doublet regions F, M, T
// seeded in 3 consecutive rows (rF, rM=rF+1, rT=rF+2):
//   F = {Q (true), P (herring)}
//   M = {M1 (true), M2 (herring)}
//   T = {T1 (true), T2 (herring)}
// placed at:
//   P  = (rM, cF)         — same row as M1: conflicts with M1, not M2
//   M2 = (rM+1, cM)       — same row as T's row: will conflict with T2
//   T2 = (rM+1, cT ± 1)   — same row as M2: conflicts with M2, not P
// which requires |cT - cF| <= 1 so T1 lands king-adjacent to P (conflicts
// with P, not M2). If F is hypothesized at P: P directly kills M1 (forcing
// M to M2) and directly kills T1; then M's forced singleton M2 kills T2 on
// the next propagation round — T empty, a contradiction only reachable by
// simulating two dependent rounds ahead, which is exactly what branch-rule/
// forcing-chain do and common-neighbor structurally cannot.
//
// This geometry is fragile: any nearby high-contention region tends to
// resolve the fork via cheaper techniques before it matters, so the hit rate
// collapses at high boundary counts (0 hits in 60,000 raw attempts at
// boundaryCount>=60, vs ~1 per 6,700 at boundaryCount>=40). Callers wanting
// this bonus geometry should use a relaxed boundary floor and a large
// attempt budget, and treat "found genuine branch/forcing" as the success
// condition rather than any boundary/score target.
export function growForkAnchored(N: number, seeds: { r: number; c: number }[], rng: () => number): number[][] | null {
  const grid = Array.from({ length: N }, () => Array(N).fill(-1) as number[])
  seeds.forEach(({ r, c }, id) => { grid[r][c] = id })

  const shuffledIds = shuffle(Array.from({ length: N }, (_, i) => i), rng)
  const anchD1 = shuffledIds[0], anchD2 = shuffledIds[1]
  const anchSet = new Set([anchD1, anchD2])
  const anchRows = new Set([seeds[anchD1].r, seeds[anchD2].r])

  // Grow 2-cell anchors: each gets 1 extra cell adjacent to its seed
  const sizes = Array(N).fill(1)
  for (const anchId of anchSet) {
    const { r: sr, c: sc } = seeds[anchId]
    for (const [dr, dc] of shuffle([...DIRS] as [number, number][], rng)) {
      const nr = sr + dr, nc = sc + dc
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) {
        grid[nr][nc] = anchId; sizes[anchId]++; break
      }
    }
  }

  const regionAtRow = new Array<number>(N)
  seeds.forEach((s, id) => { regionAtRow[s.r] = id })

  const triples: { r: number }[] = []
  for (let r = 0; r < N - 2; r++) {
    if (anchRows.has(r) || anchRows.has(r + 1) || anchRows.has(r + 2)) continue
    triples.push({ r })
  }
  shuffle(triples, rng)

  for (const { r } of triples) {
    const regF = regionAtRow[r], regM = regionAtRow[r + 1], regT = regionAtRow[r + 2]
    const cF = seeds[regF].c, cM = seeds[regM].c, cT = seeds[regT].c
    if (Math.abs(cT - cF) > 1) continue  // need T1 adjacent-conflict with P

    const P: [number, number] = [r + 1, cF]
    const M2: [number, number] = [r + 2, cM]
    // T2: same row as M2, one col off cT, choosing the direction that stays
    // >=2 cols from cF (avoid accidentally conflicting with P).
    const dirs = cT + 1 - cF >= 2 ? [1, -1] : [-1, 1]
    let T2: [number, number] | null = null
    for (const d of dirs) {
      const cand: [number, number] = [r + 2, cT + d]
      if (cand[1] < 0 || cand[1] >= N) continue
      if (Math.abs(cand[1] - cF) < 2) continue  // would conflict P — reject
      T2 = cand
      break
    }
    if (!T2) continue

    const cellsNeeded = [P, M2, T2]
    if (cellsNeeded.some(([rr, cc]) => grid[rr][cc] !== -1)) continue

    grid[P[0]][P[1]] = regF
    grid[M2[0]][M2[1]] = regM
    grid[T2[0]][T2[1]] = regT

    const gadgetSet = new Set([regF, regM, regT])
    const rest = shuffledIds.filter(id => !anchSet.has(id) && !gadgetSet.has(id))

    // Remaining regions absorb everything else via size-biased Prim's, same
    // pattern as growBandAnchored/growSizeBalanced.
    const cellPrio = new Float32Array(N * N)
    for (let i = 0; i < N * N; i++) cellPrio[i] = rng()
    sizes[regF] = 2; sizes[regM] = 2; sizes[regT] = 2

    const frontierMaps: Map<number, number>[] = Array.from({ length: N }, () => new Map())
    for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) {
      const id = grid[rr][cc]
      if (id === -1 || !rest.includes(id)) continue
      for (const [dr, dc] of DIRS) {
        const nr = rr + dr, nc = cc + dc
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1)
          frontierMaps[id].set(nr * N + nc, cellPrio[nr * N + nc])
      }
    }
    let remaining = 0
    for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) if (grid[rr][cc] === -1) remaining++
    while (remaining > 0) {
      const weights = rest.map(i => frontierMaps[i].size > 0 ? 1 / (sizes[i] * sizes[i]) : 0)
      const total = weights.reduce((a, b) => a + b, 0)
      if (total === 0) break
      let rv = rng() * total, chosen = rest[rest.length - 1]
      for (let i = 0; i < rest.length; i++) { rv -= weights[i]; if (rv <= 0) { chosen = rest[i]; break } }
      let bestCell = -1, bestPrio = -1
      for (const [cell, prio] of frontierMaps[chosen]) if (prio > bestPrio) { bestPrio = prio; bestCell = cell }
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
    fillUnclaimedByAdjacency(grid, N, rng, id => rest.includes(id))

    // A cell with no reachable `rest`-region neighbor at all (fully boxed in
    // by already-claimed anchor/gadget cells) still has to land somewhere —
    // fillUnclaimedByAdjacency's last-resort tier can only give it to
    // whatever claimed region is actually adjacent, anchor/gadget doublets
    // included. That's rare, but it silently breaks the exact 2-hop
    // contradiction geometry this function exists to construct (see the file
    // header) — measured at ~5% of raw attempts. Reject rather than ship a
    // puzzle whose fork gadget quietly isn't a fork anymore; the caller just
    // sees this as another failed attempt, same as every other continue
    // above.
    const finalSizes = Array(N).fill(0)
    for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) finalSizes[grid[rr][cc]]++
    for (const id of [...anchSet, regF, regM, regT]) if (finalSizes[id] !== 2) return null
    return grid
  }
  return null
}
