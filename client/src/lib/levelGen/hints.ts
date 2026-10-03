import { GeneratedLevel, HintPart, Hint } from './types'
import { combinations } from './solver'
import { applyPlacement as simApplyPlacement, simulateWeakPropagation, simulateStrongPropagation } from './solver/simulation'

// ── Hint engine ──────────────────────────────────────────────────────────────

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
  // Where each placed cat sits. A placed region's `cands` is emptied below, but the
  // what-if simulations treat an empty region as a contradiction, so they need the
  // placed cat's real cell instead.
  const placedCell = new Map<number, number>()

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
    placedCell.set(regId, cr * N + cc)
    applyPlacement(cr, cc)
  }

  const simState = (): number[][] => cands.map((c, i) => (placedCell.has(i) ? [placedCell.get(i)!] : [...c]))

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
      placedCell.set(reg, cell)
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
                  parts: k === 1
                    ? [T('The '), R(subset[0]), T(` region is entirely in row ${rows[0]}. Cross out every other color's cells in that row.`)]
                    : k === 2
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
                  parts: k === 1
                    ? [T('The '), R(subset[0]), T(` region is entirely in column ${cols[0]}. Cross out every other color's cells in that column.`)]
                    : k === 2
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
                  parts: k === 1
                    ? [T(`Row ${rows[0]} is the only row with `), R(regsIn[0]), T(` cells. That cat must stay in this row — cross out its cells in every other row.`)]
                    : k === 2
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
                  parts: k === 1
                    ? [T(`Column ${cols[0]} is the only column with `), R(regsIn[0]), T(` cells. That cat must stay in this column — cross out its cells in every other column.`)]
                    : k === 2
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

    // Branch rule: a region with exactly two cells left. Try each; any cell that
    // is crossed out in BOTH worlds can be crossed out for real. (A world that
    // contradicts on its own is a forcing chain, handled just below.)
    {
      let found = false
      for (const reg of unplacedMulti) {
        if (found) break
        if (cands[reg].length !== 2) continue
        const [a, b] = cands[reg]
        const simA = simState()
        const simB = simState()
        const okA = simApplyPlacement(simA, N, ROW, COL, reg, a) && simulateWeakPropagation(simA, N, ROW, COL)
        const okB = simApplyPlacement(simB, N, ROW, COL, reg, b) && simulateWeakPropagation(simB, N, ROW, COL)
        if (!okA || !okB) continue
        for (const other of unplacedMulti) {
          if (other === reg) continue
          const gone = cands[other].filter(cell => !simA[other].includes(cell) && !simB[other].includes(cell))
          if (gone.length === 0) continue
          if (isNew(gone)) {
            const cell = gone[0]
            return {
              parts: [
                T('The '), R(reg),
                T(` region has just two cells left: row ${ROW(a) + 1}, column ${COL(a) + 1} or row ${ROW(b) + 1}, column ${COL(b) + 1}. Try each one — either way, row ${ROW(cell) + 1}, column ${COL(cell) + 1} ends up crossed out for the `),
                R(other), T(' region. Cross it out.'),
              ],
            }
          }
          cands[other] = cands[other].filter(cell => !gone.includes(cell))
          anyChange = true; found = true
          break
        }
      }
    }
    if (anyChange) continue

    // Forcing chain ("what if"): pretend a cat sits in a cell and follow what that
    // forces. If some region is left with no cell, the cell is impossible. Cheap
    // contradictions (singletons + common neighbours only) are offered first,
    // since they are the ones a person can actually follow.
    {
      let found = false
      const byFewest = [...unplacedMulti].sort((x, y) => cands[x].length - cands[y].length)
      for (const pass of ['weak', 'strong'] as const) {
        if (found) break
        for (const reg of byFewest) {
          if (found) break
          for (const cell of cands[reg]) {
            const sim = simState()
            const ok = simApplyPlacement(sim, N, ROW, COL, reg, cell) &&
              (pass === 'weak' ? simulateWeakPropagation(sim, N, ROW, COL) : simulateStrongPropagation(sim, N, ROW, COL))
            if (ok) continue
            if (!isNew([cell])) {
              cands[reg] = cands[reg].filter(c => c !== cell)
              anyChange = true; found = true
              break
            }
            const dead = sim.findIndex(c => c.length === 0)
            const where = `row ${ROW(cell) + 1}, column ${COL(cell) + 1}`
            return {
              parts: pass === 'weak' && dead >= 0
                ? [
                  T(`What if the `), R(reg), T(` cat were at ${where}? Crossing out its row, column and neighbors, and then everything that forces, leaves the `),
                  R(dead), T(' region with no cell at all. So that cell is wrong — cross it out.'),
                ]
                : [
                  T(`What if the `), R(reg), T(` cat were at ${where}? Keep following what that forces — each forced cat crosses out its row, column and neighbors, and regions that get squeezed lose cells — and you reach a region with no cell left`),
                  ...(dead >= 0 ? [T(' ('), R(dead), T(')')] : []),
                  T('. So that cell is wrong — cross it out.'),
                ],
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
