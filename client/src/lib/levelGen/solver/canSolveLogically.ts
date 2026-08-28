import { SolveResult } from '../types'
import { detectDiagonalSymmetry, detectHalfTurnSymmetry } from './symmetry'
import { combinations } from './combinations'
import { applyPlacement, simulateWeakPropagation, simulateStrongPropagation } from './simulation'

// Defensive backstop, not a fix for an observed hang: profiling every growth
// function at N=10/11 across 15,000+ trials never produced a single call
// above ~230ms. Set generously above that so a normal solve is never cut off.
const SOLVE_TIME_BUDGET_MS = 1500
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function canSolveLogically(regions: number[][], N: number): SolveResult {
  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  // Detect symmetry types once up-front.
  const sigma = detectDiagonalSymmetry(regions, N)
  const halfTurn = detectHalfTurnSymmetry(regions, N)

  let anyChange = true
  let strategiesUsed = 0
  let easySteps = 0
  let hardSteps = 0
  let rounds = 0
  // hardFired tracks whether any technique beyond singleton propagation (bit 1) and
  // symmetry-propagation (bit 256) contributed this round. Those two are "free" —
  // they cascade directly from an already-placed cat and require no cross-region
  // reasoning. Everything else (common-neighbor and beyond) counts as a genuine
  // logical step, so `rounds` (used by generate.ts to gate difficulty tiers) only
  // increments on rounds where one of those actually fired.
  let hardFired = false
  // Largest naked/hidden subset size (k regions/axis-values) the solve actually needed.
  // A k=2 pair is the common, easy-to-follow case; k=3/4 (triples/quads) is the same
  // technique but meaningfully harder for a human to spot, so generate.ts can cap this
  // per difficulty tier independently of just "did naked/hidden subset fire at all".
  let maxSubsetSize = 0
  const deadline = now() + SOLVE_TIME_BUDGET_MS

  while (anyChange) {
    anyChange = false
    hardFired = false
    if (now() > deadline) break

    // 1. Singleton propagation
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return { solved: false, strategiesUsed, unsolvedCount: N, easySteps, hardSteps, rounds, unsolvedRegions: [], maxSubsetSize }
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

    // Diagonal symmetry propagation: if layout has σ, candidate (r,c) for A is only
    // valid when (c,r) is still a candidate for σ(A). Bit 256 (strategy).
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

    // Half-turn symmetry propagation: if layout has 180° rotational symmetry, region reg
    // and region N-1-reg are partners. Candidate (r,c) for reg is only valid when
    // (N-1-r, N-1-c) is still a candidate for N-1-reg. This is the dominant technique
    // in all external tier-3 puzzles (avg 33.6 eliminations per puzzle). Bit 256.
    if (halfTurn) {
      for (let reg = 0; reg < N; reg++) {
        const partner = N - 1 - reg
        if (cands[reg].length === 0) continue
        const partnerSet = new Set(cands[partner])
        const before = cands[reg].length
        cands[reg] = cands[reg].filter(cell => {
          const cr = ROW(cell), cc = COL(cell)
          return partnerSet.has((N - 1 - cr) * N + (N - 1 - cc))
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
            anyChange = true; hardFired = true; strategiesUsed |= 512; easySteps++
            break
          }
        }
      }
    }

    if (anyChange) { if (hardFired) rounds++; continue }  // restart before subsets if earlier strategies fired

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
            if (cands[other].length < before) { anyChange = true; hardFired = true; strategiesUsed |= 2; easySteps += before - cands[other].length; maxSubsetSize = Math.max(maxSubsetSize, k); break subsetLoop }
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
            if (cands[reg].length < before) { anyChange = true; hardFired = true; strategiesUsed |= 4; easySteps += before - cands[reg].length; maxSubsetSize = Math.max(maxSubsetSize, k); break subsetLoop }
          }
        }
      }
    }

    if (anyChange) { if (hardFired) rounds++; continue }

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
        if (cands[other].length < before) { anyChange = true; hardFired = true; strategiesUsed |= 8; hardSteps += before - cands[other].length }
      }
    }

    if (anyChange) { if (hardFired) rounds++; continue }

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
            if (cands[reg].length < before) { anyChange = true; hardFired = true; strategiesUsed |= 16; hardSteps += before - cands[reg].length }
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
                  anyChange = true; hardFired = true; strategiesUsed |= 128; hardSteps += before - cands[other].length
                }
              }
            }
          }
        }
      }
    }

    // Strategy 6: Branch Rule — for any region with exactly 2 candidates, simulate
    // placing in each (see simulateWeakPropagation). A cell can be eliminated from
    // another region if it's gone in both branches.
    if (!anyChange) {
      for (let reg = 0; reg < N && !anyChange; reg++) {
        if (cands[reg].length !== 2) continue
        if (now() > deadline) break
        const [cellA, cellB] = cands[reg]

        const simA = cands.map(c => [...c])
        const okA = applyPlacement(simA, N, ROW, COL, reg, cellA) && simulateWeakPropagation(simA, N, ROW, COL)

        const simB = cands.map(c => [...c])
        const okB = applyPlacement(simB, N, ROW, COL, reg, cellB) && simulateWeakPropagation(simB, N, ROW, COL)

        if (!okA && !okB) continue  // both contradictions — impossible state, skip
        if (!okA) {
          // branch A is contradiction → reg must be cellB
          const before = cands[reg].length
          cands[reg] = [cellB]; anyChange = true; hardFired = true; strategiesUsed |= 64; hardSteps += before - 1; continue
        }
        if (!okB) {
          // branch B is contradiction → reg must be cellA
          const before = cands[reg].length
          cands[reg] = [cellA]; anyChange = true; hardFired = true; strategiesUsed |= 64; hardSteps += before - 1; continue
        }

        // Both branches valid — eliminate cells absent from BOTH branch results
        for (let other = 0; other < N && !anyChange; other++) {
          if (other === reg) continue
          const setA = new Set(simA[other])
          const setB = new Set(simB[other])
          const before = cands[other].length
          // Keep cells present in at least one valid branch
          cands[other] = cands[other].filter(c => setA.has(c) || setB.has(c))
          if (cands[other].length < before) { anyChange = true; hardFired = true; strategiesUsed |= 64; hardSteps += before - cands[other].length }
        }
      }
    }

    // Strategy 7: Forcing chains — simulate placing each remaining candidate
    // (see simulateStrongPropagation) and eliminate it if that leads to a
    // contradiction. Only tried once every other strategy has stalled.
    if (!anyChange) {
      for (let reg = 0; reg < N && !anyChange; reg++) {
        if (cands[reg].length <= 1) continue
        if (now() > deadline) break
        for (let ci = cands[reg].length - 1; ci >= 0 && !anyChange; ci--) {
          if (now() > deadline) break
          const cell = cands[reg][ci]

          const simCands: number[][] = cands.map(c => [...c])
          const consistent = applyPlacement(simCands, N, ROW, COL, reg, cell) && simulateStrongPropagation(simCands, N, ROW, COL)
          if (consistent) continue

          const before = cands[reg].length
          cands[reg] = cands[reg].filter(c => c !== cell)
          anyChange = true; hardFired = true
          strategiesUsed |= 32
          hardSteps += before - cands[reg].length
        }
      }
    }
    if (hardFired) rounds++
  }

  const unsolvedRegions: number[] = []
  for (let reg = 0; reg < N; reg++) if (cands[reg].length > 1) unsolvedRegions.push(reg)
  const unsolvedCount = unsolvedRegions.length
  return { solved: unsolvedCount === 0, strategiesUsed, unsolvedCount, easySteps, hardSteps, rounds, unsolvedRegions, maxSubsetSize }
}
