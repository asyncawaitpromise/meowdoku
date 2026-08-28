// Sum of (row-span + col-span) across all regions. Lower = more confined =
// more deductions possible. Used as SA cost function.
export function spanScore(grid: number[][], N: number): number {
  const rows: Set<number>[] = Array.from({ length: N }, () => new Set())
  const cols: Set<number>[] = Array.from({ length: N }, () => new Set())
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      rows[grid[r][c]].add(r)
      cols[grid[r][c]].add(c)
    }
  }
  let s = 0
  for (let reg = 0; reg < N; reg++) s += rows[reg].size + cols[reg].size
  return s
}

export function boundaryCount(grid: number[][], N: number): number {
  let count = 0
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      if (c + 1 < N && grid[r][c] !== grid[r][c + 1]) count++
      if (r + 1 < N && grid[r][c] !== grid[r + 1][c]) count++
    }
  return count
}

export function hasCorridor(grid: number[][], N: number): boolean {
  const rows: Set<number>[] = Array.from({ length: N }, () => new Set())
  const cols: Set<number>[] = Array.from({ length: N }, () => new Set())
  const sizes: number[] = Array(N).fill(0)

  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const reg = grid[r][c]
      rows[reg].add(r)
      cols[reg].add(c)
      sizes[reg]++
    }

  for (let reg = 0; reg < N; reg++) {
    const rSpan = rows[reg].size
    const cSpan = cols[reg].size
    if (sizes[reg] <= 4) continue
    const fillRatio = sizes[reg] / (rSpan * cSpan)
    if (fillRatio < 0.35 && (rSpan >= 3 || cSpan >= 3)) return true
  }
  return false
}

export function maxRegionSize(regions: number[][], N: number): number {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sizes[regions[r][c]]++
  return Math.max(...sizes)
}

export function sizeStdDev(regions: number[][], N: number): number {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sizes[regions[r][c]]++
  const avg = (N * N) / N  // always N cells avg
  return Math.sqrt(sizes.reduce((s, c) => s + (c - avg) ** 2, 0) / N)
}
