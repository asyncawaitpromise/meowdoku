import { GeneratedLevel } from '../types'
import { PALETTE } from '../rng'
import { canSolveLogically, difficultyScore, detectHalfTurnSymmetry } from '../solver'
import { boundaryCount } from '../growth'

// Original share codec ("mwd1." prefix) — decode-only. No longer produced
// (see v2.ts), but kept indefinitely so links shared before the v2 switch
// keep working; see share/index.ts for the version dispatch.
const VERSION = 'mwd1'
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

function fromDigit(ch: string): number {
  return BASE36.indexOf(ch)
}

export function decodeShareCodeV1(code: string): GeneratedLevel | null {
  const parts = code.trim().split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) return null

  const N = Number(parts[1])
  if (!Number.isInteger(N) || N < 4 || N > 11) return null

  const [, , regionsStr, colsStr, colorsStr] = parts
  if (regionsStr.length !== N * N || colsStr.length !== N || colorsStr.length !== PALETTE.length) return null

  const regions: number[][] = []
  for (let r = 0; r < N; r++) {
    const row: number[] = []
    for (let c = 0; c < N; c++) {
      const v = fromDigit(regionsStr[r * N + c])
      if (v < 0 || v >= N) return null
      row.push(v)
    }
    regions.push(row)
  }

  const solution: { r: number; c: number }[] = []
  for (let r = 0; r < N; r++) {
    const c = fromDigit(colsStr[r])
    if (c < 0 || c >= N) return null
    solution.push({ r, c })
  }
  // Every region must claim exactly its own designated solution cell.
  for (let r = 0; r < N; r++) {
    if (regions[r][solution[r].c] !== r) return null
  }

  const colors = colorsStr.split('').map(ch => {
    const idx = fromDigit(ch)
    return PALETTE[idx] ?? PALETTE[0]
  })

  const result = canSolveLogically(regions, N)
  const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)

  return {
    size: N,
    regions,
    solution,
    colors,
    difficulty: score,
    easySteps: result.easySteps,
    hardSteps: result.hardSteps,
    boundaries: boundaryCount(regions, N),
    rounds: result.rounds,
    maxSubsetSize: result.maxSubsetSize,
    symmetric: detectHalfTurnSymmetry(regions, N),
    strategiesUsed: result.strategiesUsed,
    techniqueCounts: result.techniqueCounts ?? {},
    gateMet: result.solved,
  }
}
