import { GeneratedLevel, HintPart, Hint } from './types'
import { combinations } from './solver'

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
    applyPlacement(cr, cc)
  }

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
                  parts: k === 2
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
                  parts: k === 2
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
                  parts: k === 2
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
                  parts: k === 2
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

    break
  }

  return {
    parts: [T('Look for regions limited to just a few rows or columns, or rows/columns that only contain a few regions.')],
  }
}
