import { combinations } from './combinations'

// Places `region` at `cell` in a cloned candidate array and eliminates that
// cell's row, column, and adjacency from every other region. Returns false
// if any other region is left with no candidates.
export function applyPlacement(
  sim: number[][], N: number,
  ROW: (cell: number) => number, COL: (cell: number) => number,
  region: number, cell: number,
): boolean {
  const cr = ROW(cell), cc = COL(cell)
  sim[region] = [cell]
  for (let o = 0; o < N; o++) {
    if (o === region) continue
    sim[o] = sim[o].filter(c2 => {
      const r2 = ROW(c2), c2c = COL(c2)
      return r2 !== cr && c2c !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
    })
    if (sim[o].length === 0) return false
  }
  return true
}

// Branch rule's hypothesis check: propagates singleton placement and
// common-neighbor elimination to a fixpoint. Deliberately lighter than
// simulateStrongPropagation below — cheap enough to run twice per
// two-candidate region without dominating solve time.
export function simulateWeakPropagation(
  sim: number[][], N: number,
  ROW: (cell: number) => number, COL: (cell: number) => number,
): boolean {
  let changed = true
  while (changed) {
    changed = false
    for (let reg = 0; reg < N; reg++) {
      if (sim[reg].length === 0) return false
      if (sim[reg].length !== 1) continue
      const cr = ROW(sim[reg][0]), cc = COL(sim[reg][0])
      for (let o = 0; o < N; o++) {
        if (o === reg) continue
        const before = sim[o].length
        sim[o] = sim[o].filter(c2 => {
          const r2 = ROW(c2), c2c = COL(c2)
          return r2 !== cr && c2c !== cc &&
            !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
        })
        if (sim[o].length === 0) return false
        if (sim[o].length < before) changed = true
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
            changed = true
            break
          }
        }
      }
    }
  }
  return true
}

// Forcing chains' hypothesis check: propagates the full technique set
// (singleton, common-neighbor, naked/hidden subsets, trap 2×2, region
// crowding) to a fixpoint, bailing out the instant any region is left with
// no candidates. Unlike the main solver loop, this only needs a yes/no
// consistency answer, so it can short-circuit mid-technique instead of
// waiting for the next round's singleton check.
export function simulateStrongPropagation(
  sim: number[][], N: number,
  ROW: (cell: number) => number, COL: (cell: number) => number,
): boolean {
  let contradiction = false
  let changed = true
  while (changed && !contradiction) {
    changed = false

    for (let sreg = 0; sreg < N && !contradiction; sreg++) {
      if (sim[sreg].length === 0) { contradiction = true; break }
      if (sim[sreg].length !== 1) continue
      const scr = ROW(sim[sreg][0]), scc = COL(sim[sreg][0])
      for (let other = 0; other < N; other++) {
        if (other === sreg) continue
        const before = sim[other].length
        sim[other] = sim[other].filter(c2 => {
          const r2 = ROW(c2), c2c = COL(c2)
          return r2 !== scr && c2c !== scc &&
            !(Math.abs(r2 - scr) <= 1 && Math.abs(c2c - scc) <= 1)
        })
        if (sim[other].length === 0) { contradiction = true; break }
        if (sim[other].length < before) changed = true
      }
    }
    for (let regB = 0; regB < N && !contradiction; regB++) {
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
            if (sim[regB].length === 0) { contradiction = true }
            else changed = true
            break
          }
        }
      }
    }
    if (contradiction || changed) continue

    const rowSpan = sim.map(cs => new Set(cs.map(ROW)))
    const colSpan = sim.map(cs => new Set(cs.map(COL)))
    const regsInRow: number[][] = Array.from({ length: N }, () => [])
    const regsInCol: number[][] = Array.from({ length: N }, () => [])
    for (let r = 0; r < N; r++) {
      for (let reg = 0; reg < N; reg++) {
        if (sim[reg].length <= 1) continue
        if (rowSpan[reg].has(r)) regsInRow[r].push(reg)
        if (colSpan[reg].has(r)) regsInCol[r].push(reg)
      }
    }
    const unplaced = Array.from({ length: N }, (_, i) => i).filter(r => sim[r].length > 1)

    for (const axis of [0, 1] as const) {
      const span = axis === 0 ? rowSpan : colSpan
      const regsInAxis = axis === 0 ? regsInRow : regsInCol
      const axisOf = axis === 0 ? ROW : COL

      for (let k = 1; k < unplaced.length && !changed; k++) {
        for (const subset of combinations(unplaced, k)) {
          const unionK = new Set(subset.flatMap(r => [...span[r]]))
          if (unionK.size !== k) continue
          const subSet = new Set(subset)
          for (let other = 0; other < N; other++) {
            if (subSet.has(other)) continue
            const before = sim[other].length
            sim[other] = sim[other].filter(c2 => !unionK.has(axisOf(c2)))
            if (sim[other].length === 0) { contradiction = true; break }
            if (sim[other].length < before) changed = true
          }
          if (contradiction) break
        }
        if (contradiction || changed) break

        const activeAxis = Array.from({ length: N }, (_, i) => i).filter(a => regsInAxis[a].length > 0)
        for (const axisSub of combinations(activeAxis, k)) {
          const regsIn = [...new Set(axisSub.flatMap(a => regsInAxis[a]))]
          if (regsIn.length !== k) continue
          const axisSet = new Set(axisSub)
          for (const r of regsIn) {
            const before = sim[r].length
            sim[r] = sim[r].filter(c2 => axisSet.has(axisOf(c2)))
            if (sim[r].length === 0) { contradiction = true; break }
            if (sim[r].length < before) changed = true
          }
          if (contradiction || changed) break
        }
        if (contradiction || changed) break
      }
    }
    if (contradiction || changed) continue

    for (let sreg = 0; sreg < N && !changed && !contradiction; sreg++) {
      if (sim[sreg].length === 0) continue
      const rows2 = sim[sreg].map(ROW), cols2 = sim[sreg].map(COL)
      const minR2 = Math.min(...rows2), maxR2 = Math.max(...rows2)
      const minC2 = Math.min(...cols2), maxC2 = Math.max(...cols2)
      if (maxR2 - minR2 > 1 || maxC2 - minC2 > 1) continue
      for (let other = 0; other < N; other++) {
        if (other === sreg) continue
        const before = sim[other].length
        sim[other] = sim[other].filter(c2 => {
          const r = ROW(c2), c = COL(c2)
          return !(r >= minR2 && r <= maxR2 && c >= minC2 && c <= maxC2)
        })
        if (sim[other].length === 0) { contradiction = true; break }
        if (sim[other].length < before) changed = true
      }
    }
    if (contradiction || changed) continue

    for (let sreg = 0; sreg < N && !changed && !contradiction; sreg++) {
      for (let sci = 0; sci < sim[sreg].length && !changed && !contradiction; sci++) {
        const scell = sim[sreg][sci]
        const scr2 = ROW(scell), scc2 = COL(scell)
        for (let other = 0; other < N && !changed && !contradiction; other++) {
          if (other === sreg || sim[other].length === 0) continue
          const survivors = sim[other].filter(c2 => {
            const r2 = ROW(c2), c2c = COL(c2)
            return r2 !== scr2 && c2c !== scc2 &&
              !(Math.abs(r2 - scr2) <= 1 && Math.abs(c2c - scc2) <= 1)
          })
          if (survivors.length === 0) {
            const before = sim[sreg].length
            sim[sreg] = sim[sreg].filter(c => c !== scell)
            if (sim[sreg].length === 0) { contradiction = true }
            if (sim[sreg].length < before) changed = true
          }
        }
      }
    }
  }

  return !contradiction
}
