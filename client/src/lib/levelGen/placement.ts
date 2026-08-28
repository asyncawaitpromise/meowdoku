import { shuffle } from './rng'

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

// Half-turn symmetric placement: catCols[r] + catCols[N-1-r] = N-1 for all r.
// This gives the 180° rotational symmetry seen in all external tier-3 puzzles.
// Only rows 0..N/2-1 are chosen freely; rows N/2..N-1 are derived as N-1-catCols[N-1-r].
export function findHalfTurnPlacement(N: number, rng: () => number): number[] | null {
  if (N % 2 !== 0) return null
  const half = N / 2
  const cols = new Array<number>(N).fill(-1)
  const usedCols = new Set<number>()

  function solve(rowIdx: number): boolean {
    if (rowIdx === half) return true
    const r = rowIdx
    const partner = N - 1 - r

    const candidates = shuffle(
      Array.from({ length: N }, (_, c) => c).filter(c => {
        const pc = N - 1 - c
        if (usedCols.has(c) || usedCols.has(pc)) return false
        if (r > 0 && Math.abs(c - cols[r - 1]) < 2) return false
        // Middle boundary: rows half-1 and half must be non-adjacent columns.
        // cols[half] = N-1-c, so |c - (N-1-c)| = |2c - (N-1)| >= 2.
        if (r === half - 1 && Math.abs(2 * c - (N - 1)) < 2) return false
        return true
      }),
      rng
    )

    for (const c of candidates) {
      const pc = N - 1 - c
      cols[r] = c; cols[partner] = pc
      usedCols.add(c); usedCols.add(pc)
      if (solve(rowIdx + 1)) return true
      cols[r] = -1; cols[partner] = -1
      usedCols.delete(c); usedCols.delete(pc)
    }
    return false
  }

  return solve(0) ? cols : null
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
