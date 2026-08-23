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
  maxSubsetSize: number                // largest naked/hidden subset (k) the solve required, 0 if neither fired
  symmetric: boolean                   // true if the region layout has 180° half-turn (point) rotational symmetry
  strategiesUsed: number                // bitmask of solver strategies the solve required (see SolveResult) — carried through so a parallel-generation coordinator can rank candidates from other workers without resolving the whole puzzle again
}

export interface SolveResult { solved: boolean; strategiesUsed: number; unsolvedCount: number; easySteps: number; hardSteps: number; rounds: number; unsolvedRegions: number[]; maxSubsetSize: number }

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

export type HintPart = { type: 'text'; text: string } | { type: 'region'; regionId: number }

export interface Hint {
  parts: HintPart[]
}
