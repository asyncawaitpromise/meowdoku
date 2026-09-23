import type { GeneratedLevel } from './levelGen'

// A fixed, hand-authored 4x4 puzzle used only by the tutorial screen — four
// quadrant regions, one cat each, no two touching (incl. diagonally), one per
// row and column. Never runs through the generator/solver.
export const TUTORIAL_LEVEL: GeneratedLevel = {
  size: 4,
  regions: [
    [0, 0, 1, 1],
    [0, 0, 1, 1],
    [2, 2, 3, 3],
    [2, 2, 3, 3],
  ],
  solution: [
    { r: 1, c: 0 },
    { r: 0, c: 2 },
    { r: 3, c: 1 },
    { r: 2, c: 3 },
  ],
  colors: ['#f4c05a', '#7fb8d9', '#e88a8a', '#8fcf9f'],
  difficulty: 0,
  easySteps: 0,
  hardSteps: 0,
  boundaries: 4,
  rounds: 0,
  maxSubsetSize: 0,
  symmetric: false,
  strategiesUsed: 0,
  techniqueCounts: {},
  gateMet: true,
}
