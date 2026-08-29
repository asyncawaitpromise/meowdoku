// Writes a small, curated sample of real generated puzzles to a JSON fixture
// (test/fixtures/generated-cache/latest.json) every time the generation tests
// run. Committing that file to git turns each commit's diff into a quality
// log — difficulty/technique-mix drift across levels is visible without
// re-running generation, and a puzzle can be pulled out of the cache to debug
// without regenerating it.
import { writeFileSync, mkdirSync } from 'fs'
import type { GeneratedLevel } from '../client/src/lib/levelGen/types'

export type CachedPuzzle = {
  label: string
  seed: number
  size: number
  regions: number[][]
  solution: { r: number; c: number }[]
  difficulty: number
  strategiesUsed: number
  techniqueCounts: Record<string, number>
  easySteps: number
  hardSteps: number
  rounds: number
  maxSubsetSize: number
  boundaries: number
  symmetric: boolean
  gateMet: boolean
}

const CACHE_PATH = 'test/fixtures/generated-cache/latest.json'

// Keyed by label so re-recording the same label (e.g. a watch-mode re-run)
// overwrites rather than duplicates.
const entries = new Map<string, CachedPuzzle>()

export function cachePuzzle(label: string, seed: number, level: GeneratedLevel): void {
  entries.set(label, {
    label,
    seed,
    size: level.size,
    regions: level.regions,
    solution: level.solution,
    difficulty: level.difficulty,
    strategiesUsed: level.strategiesUsed,
    techniqueCounts: level.techniqueCounts,
    easySteps: level.easySteps,
    hardSteps: level.hardSteps,
    rounds: level.rounds,
    maxSubsetSize: level.maxSubsetSize,
    boundaries: level.boundaries,
    symmetric: level.symmetric,
    gateMet: level.gateMet,
  })
}

// Custom (rather than JSON.stringify(..., null, 2)) so each region row and
// the solution stay on one line instead of one number per line — a 10x10
// puzzle pretty-printed the naive way is ~250 lines of noise per puzzle,
// which would bury the fields that actually matter (difficulty, technique
// counts) in a git diff.
function formatPuzzle(p: CachedPuzzle): string {
  const regionsStr = p.regions.map(row => `      ${JSON.stringify(row)}`).join(',\n')
  const solutionStr = p.solution.map(s => JSON.stringify(s)).join(', ')
  return [
    '    {',
    `      "label": ${JSON.stringify(p.label)},`,
    `      "seed": ${p.seed},`,
    `      "size": ${p.size},`,
    `      "difficulty": ${p.difficulty},`,
    `      "strategiesUsed": ${p.strategiesUsed},`,
    `      "techniqueCounts": ${JSON.stringify(p.techniqueCounts)},`,
    `      "easySteps": ${p.easySteps},`,
    `      "hardSteps": ${p.hardSteps},`,
    `      "rounds": ${p.rounds},`,
    `      "maxSubsetSize": ${p.maxSubsetSize},`,
    `      "boundaries": ${p.boundaries},`,
    `      "symmetric": ${p.symmetric},`,
    `      "gateMet": ${p.gateMet},`,
    `      "solution": [${solutionStr}],`,
    '      "regions": [',
    regionsStr,
    '      ]',
    '    }',
  ].join('\n')
}

export function flushPuzzleCache(): void {
  if (entries.size === 0) return
  mkdirSync('test/fixtures/generated-cache', { recursive: true })
  const puzzles = [...entries.values()].sort((a, b) => a.label.localeCompare(b.label))
  const body = puzzles.map(formatPuzzle).join(',\n')
  writeFileSync(CACHE_PATH, `{\n  "puzzles": [\n${body}\n  ]\n}\n`)
}
