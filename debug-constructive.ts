// Debug: inspect what growConstructive layouts look like and why solver fails
import { makeRng, findPlacement, growConstructive, canSolveLogically, countSolutions } from './client/src/lib/levelGen/index.ts'

const N = 10

for (let i = 0; i < 10; i++) {
  const rng = makeRng(i * 6271 + 42)
  const cols = findPlacement(N, rng)
  const seeds = cols.map((c, r) => ({ r, c }))
  const grid = growConstructive(N, seeds, rng)

  // Print region sizes and row coverage
  const sizes = Array(N).fill(0)
  const rows: Set<number>[] = Array.from({length: N}, () => new Set())
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    sizes[grid[r][c]]++
    rows[grid[r][c]].add(r)
  }
  console.log(`--- Layout ${i} ---`)
  for (let reg = 0; reg < N; reg++) {
    const rowList = [...rows[reg]].sort((a,b)=>a-b).join(',')
    console.log(`  Region ${reg}: size=${sizes[reg]} rows={${rowList}} cat=(${seeds[reg].r},${seeds[reg].c})`)
  }

  const nsols = countSolutions(grid, N, 2)
  const res = canSolveLogically(grid, N)
  console.log(`  Solutions: ${nsols}, Solved: ${res.solved}, Strats: ${res.strategiesUsed.toString(2)}`)
  if (!res.solved) console.log(`  Unsolved regions: ${res.unsolvedRegions}`)
  console.log()
}
