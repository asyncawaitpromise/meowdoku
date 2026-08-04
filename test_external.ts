// Test solver against imported external puzzles — run with: npx tsx test_external.ts

import { readFileSync } from 'fs'
import { canSolveLogically } from './client/src/lib/levelGen/index.ts'

function flatToGrid(flat: number[], n: number): number[][] {
  const grid: number[][] = []
  for (let r = 0; r < n; r++) grid.push(flat.slice(r * n, r * n + n))
  return grid
}

function testFile(path: string, label: string, count = 10) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'))
  const N: number = raw.size
  const puzzles = raw.puzzles.slice(0, count)

  console.log(`\n── ${label} (first ${count} puzzles) ──`)

  let solved = 0, unsolved = 0
  for (const [id, flatGrid, solution, tier, , , , meta] of puzzles) {
    const grid = flatToGrid(flatGrid, N)
    const result = canSolveLogically(grid, N)

    const status = result.solved ? 'SOLVED' : 'FAILED'
    const techniques = Object.keys(meta?.techniqueCounts ?? {}).join(', ') || 'none'
    console.log(
      `  [${id}] ${status} | tier=${tier} | strategies=0x${result.strategiesUsed.toString(16).padStart(4,'0')}` +
      ` | steps=${result.easySteps}e+${result.hardSteps}h | rounds=${result.rounds}` +
      (result.solved ? '' : ` | unsolved=${result.unsolvedCount}`)
    )
    if (!result.solved) {
      console.log(`    expected techniques: ${techniques}`)
    }
    result.solved ? solved++ : unsolved++
  }

  console.log(`\n  Result: ${solved}/${count} solved, ${unsolved} failed`)
}

const base = './external-resources'
testFile(`${base}/puzzles1`, 'puzzles1 (tier 2)')
testFile(`${base}/puzzles2`, 'puzzles2')
