import { SolveResult } from '../types'
import { detectHalfTurnSymmetry } from './symmetry'
import { combinations } from './combinations'

export function canSolveFast(regions: number[][], N: number): SolveResult {
  const cands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      cands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  const halfTurn = detectHalfTurnSymmetry(regions, N)

  let anyChange = true
  let strategiesUsed = 0
  let easySteps = 0
  let hardSteps = 0
  let rounds = 0
  let maxSubsetSize = 0

  while (anyChange) {
    anyChange = false

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

    // Half-turn symmetry propagation (same logic as in canSolveLogically).
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
        if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 256; easySteps += before - cands[reg].length }
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
            if (cands[other].length < before) { anyChange = true; strategiesUsed |= 2; easySteps += before - cands[other].length; maxSubsetSize = Math.max(maxSubsetSize, k); break subsetLoop }
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
            if (cands[reg].length < before) { anyChange = true; strategiesUsed |= 4; easySteps += before - cands[reg].length; maxSubsetSize = Math.max(maxSubsetSize, k); break subsetLoop }
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
  return { solved: cands.every(c => c.length === 1), strategiesUsed, unsolvedCount, easySteps, hardSteps, rounds, unsolvedRegions: [], maxSubsetSize }
}
