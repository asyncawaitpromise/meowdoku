import { GeneratedLevel } from './types'
import { PALETTE } from './rng'
import { canSolveLogically, difficultyScore, detectHalfTurnSymmetry } from './solver'
import { boundaryCount } from './growth'

// Packs a puzzle into a short version-prefixed, dot-delimited base36 string.
// solution[r].r === r always (row is implied by array position), so only
// each entry's column needs encoding.
const VERSION = 'mwd1'
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

function digit(n: number): string {
  return BASE36[n] ?? '0'
}

function fromDigit(ch: string): number {
  return BASE36.indexOf(ch)
}

export function encodeShareCode(level: GeneratedLevel): string {
  const { size: N, regions, solution, colors } = level
  const regionsStr = regions.flat().map(digit).join('')
  const colsStr = solution.map(s => digit(s.c)).join('')
  const colorsStr = colors.map(hex => digit(PALETTE.indexOf(hex))).join('')
  return `${VERSION}.${N}.${regionsStr}.${colsStr}.${colorsStr}`
}

// Rebuilds a full GeneratedLevel by re-deriving every analysis field
// (difficulty, strategies used, boundary count, ...) from the decoded
// regions/solution rather than trusting encoded values, so a hand-edited or
// corrupted code can never produce mismatched metadata. Returns null for
// anything that doesn't parse as a well-formed, internally-consistent puzzle.
export function decodeShareCode(code: string): GeneratedLevel | null {
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
