// DFS backtracking to count solutions up to maxCount.
// Uses MRV heuristic (pick region with fewest candidates) and singleton
// propagation at each step. Stops as soon as count reaches maxCount.
export function countSolutions(regions: number[][], N: number, maxCount = 2): number {
  const initCands: number[][] = Array.from({ length: N }, () => [])
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      initCands[regions[r][c]].push(r * N + c)

  const ROW = (cell: number) => Math.floor(cell / N)
  const COL = (cell: number) => cell % N

  const propagate = (cands: number[][]): boolean => {
    let ch = true
    while (ch) {
      ch = false
      for (let reg = 0; reg < N; reg++) {
        if (cands[reg].length === 0) return false
        if (cands[reg].length !== 1) continue
        const cr = ROW(cands[reg][0]), cc = COL(cands[reg][0])
        for (let o = 0; o < N; o++) {
          if (o === reg) continue
          const prev = cands[o].length
          cands[o] = cands[o].filter(cell => {
            const r2 = ROW(cell), c2 = COL(cell)
            return r2 !== cr && c2 !== cc &&
              !(Math.abs(r2 - cr) <= 1 && Math.abs(c2 - cc) <= 1)
          })
          if (cands[o].length === 0) return false
          if (cands[o].length < prev) ch = true
        }
      }
    }
    return true
  }

  let count = 0

  const dfs = (cands: number[][]): void => {
    if (count >= maxCount) return
    // Find region with fewest (>1) candidates — MRV heuristic
    let minLen = Infinity, minReg = -1
    for (let reg = 0; reg < N; reg++) {
      if (cands[reg].length === 0) return
      if (cands[reg].length === 1) continue
      if (cands[reg].length < minLen) { minLen = cands[reg].length; minReg = reg }
    }
    if (minReg === -1) { count++; return }  // all placed → solution

    for (const cell of cands[minReg]) {
      if (count >= maxCount) return
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

  if (!propagate(initCands)) return 0
  dfs(initCands)
  return count
}
