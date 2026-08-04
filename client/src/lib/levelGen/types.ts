export interface GeneratedLevel {
  size: number
  regions: number[][]                  // regions[r][c] = regionId
  solution: { r: number; c: number }[] // solution[regionId] = correct cat cell
  colors: string[]                     // colors[regionId] = hex
  difficulty: number                   // weighted strategy score
  easySteps: number                    // eliminations from strategies 1–3 (singleton, naked, hidden subsets)
  hardSteps: number                    // eliminations from strategies 4–7 (trap 2×2, crowding, branch, forcing chains)
  boundaries: number                   // number of region boundary edges
  rounds: number                       // number of solver passes that made progress
  symmetric: boolean                   // true if the region layout has diagonal (transpose) reflection symmetry
}

export interface SolveResult { solved: boolean; strategiesUsed: number; unsolvedCount: number; easySteps: number; hardSteps: number; rounds: number; unsolvedRegions: number[] }

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

export type HintPart = { type: 'text'; text: string } | { type: 'region'; regionId: number }

export interface Hint {
  parts: HintPart[]
}
