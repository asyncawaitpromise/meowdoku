import { shuffle } from './rng'

// ── Cat placement (backtracking) ─────────────────────────────────────────────

export function findPlacement(N: number, rng: () => number): number[] {
  const cols: number[] = []
  const usedCols = new Set<number>()

  function solve(row: number): boolean {
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

// Self-inverse permutation (involution): solution[solution[r]] = r for all r.
// Each pair (r, solution[r]) has |r - solution[r]| >= 2 so the two cats in the
// pair don't land in adjacent rows, and all consecutive rows satisfy the
// standard non-adjacency column rule. Returns null if no valid involution is
// found in 500 attempts.
export function findSymmetricPlacement(N: number, rng: () => number): number[] | null {
  if (N % 2 !== 0) return null
  for (let attempt = 0; attempt < 500; attempt++) {
    const rows = shuffle(Array.from({ length: N }, (_, i) => i), rng)
    const solution = new Array<number>(N).fill(-1)
    let valid = true
    for (let i = 0; i < N; i += 2) {
      const r = rows[i], c = rows[i + 1]
      // The pair maps row r → col c and row c → col r.
      // If r and c are adjacent rows their cats land at (r,c) and (c,r) which
      // are diagonally adjacent — invalid.
      if (Math.abs(r - c) < 2) { valid = false; break }
      solution[r] = c
      solution[c] = r
    }
    if (!valid) continue
    let adjOk = true
    for (let r = 0; r < N - 1; r++) {
      if (Math.abs(solution[r] - solution[r + 1]) < 2) { adjOk = false; break }
    }
    if (!adjOk) continue
    return solution
  }
  return null
}
