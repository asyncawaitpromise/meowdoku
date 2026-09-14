// Same DFS backtracking (MRV heuristic + singleton propagation) as
// countSolutions, but returns the actual placement instead of just a count —
// used by share.ts's compact codec to recover `solution` from `regions`
// alone, since a valid puzzle always has exactly one. Returns null if the
// regions grid doesn't have exactly one solution (also catching hand-edited
// or corrupted share codes, since those decode to malformed region grids).
export function solveUnique(regions: number[][], N: number): { r: number; c: number }[] | null {
  const initCands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      initCands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  const propagate = (cands: number[][]): boolean => {
    let changed = true
    while (changed) {
      changed = false
      for (let reg = 0; reg < N; reg++) {
        if (cands[reg].length === 0) return false
        if (cands[reg].length !== 1) continue
        const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
        for (let o = 0; o < N; o++) {
          if (o === reg) continue
          const prev = cands[o].length
          cands[o] = cands[o].filter(cell => {
            const r2 = ROW(cell), c2 = COL(cell)
            return r2 !== cr && c2 !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
          })
          if (cands[o].length === 0) return false
          if (cands[o].length < prev) changed = true
        }
      }
    }
    return true
  }

  let found: number[] | null = null
  let count = 0

  const dfs = (cands: number[][]): void => {
    if (count >= 2) return
    let minLen = Infinity, minReg = -1
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return
      if (cands[reg].length === 1) continue
      if (cands[reg].length < minLen) { minLen = cands[reg].length; minReg = reg }
    }
    if (minReg === -1) {
      count++
      if (count === 1) found = cands.map(c => c[0])
      return
    }
    for (const cell of cands[minReg]) {
      if (count >= 2) return
      const cr = ROW(cell), cc = COL(cell)
      const next = cands.map(c => [...c])
      next[minReg] = [cell]
      let ok = true
      for (let o = 0; o < N; o++) {
        if (o === minReg) continue
        next[o] = next[o].filter(c2 => {
          const r2 = ROW(c2), c2c = COL(c2)
          return r2 !== cr && c2c !== cc && !(Math.abs(r2 - cr) <= 1 && Math.abs(c2c - cc) <= 1)
        })
        if (next[o].length === 0) { ok = false; break }
      }
      if (ok && propagate(next)) dfs(next)
    }
  }

  if (!propagate(initCands)) return null
  dfs(initCands)
  if (count !== 1 || !found) return null
  return (found as number[]).map(cell => ({ r: ROW(cell), c: COL(cell) }))
}
