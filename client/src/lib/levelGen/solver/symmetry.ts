// Returns true if the grid has 180° half-turn (point) symmetry:
//   grid[r][c] + grid[N-1-r][N-1-c] === N-1 for all cells.
// When true, region reg and region N-1-reg are partner regions: placing reg at
// (r,c) forces N-1-reg to (N-1-r, N-1-c). This is the symmetry shared by all
// external tier-3 (10×10) puzzles and exploited by half-turn propagation.
export function detectHalfTurnSymmetry(grid: number[][], N: number): boolean {
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (grid[r][c] + grid[N - 1 - r][N - 1 - c] !== N - 1) return false
  return true
}

// Returns the region permutation σ if the grid satisfies grid[r][c] = σ(grid[c][r])
// for all off-diagonal cells (r ≠ c), otherwise returns null.
// Diagonal cells (r === c) are exempt because they are their own transpose and can
// only be self-paired, which fails for even-N involutions with no fixed points.
export function detectDiagonalSymmetry(grid: number[][], N: number): number[] | null {
  const sigma = new Array<number>(N).fill(-1)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (r === c) continue
      const a = grid[r][c], b = grid[c][r]
      if (sigma[a] === -1) sigma[a] = b
      else if (sigma[a] !== b) return null
    }
  }
  if (sigma.some(v => v === -1)) return null
  const seen = new Set(sigma)
  if (seen.size !== N) return null
  return sigma
}
