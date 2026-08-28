import type { GeneratedLevel } from './levelGen'

// Dumps the exact puzzle data to the console so a bad puzzle can be captured
// and reported. `regions`/`solution` alone are enough to reproduce and
// re-check the puzzle outside the app (e.g. against canSolveLogically).
export function logPuzzleDebug(level: GeneratedLevel, meta: Record<string, unknown>) {
  console.groupCollapsed(`[meowdoku] puzzle generated — ${JSON.stringify(meta)}`)
  console.log('regions (regionId per cell):')
  console.table(level.regions)
  console.log('solution (solution[regionId] = {r, c}):', level.solution)
  console.log(
    `difficulty=${level.difficulty} easySteps=${level.easySteps} hardSteps=${level.hardSteps} ` +
    `boundaries=${level.boundaries} rounds=${level.rounds} symmetric=${level.symmetric}`
  )
  console.log('copy/paste JSON:', JSON.stringify({ regions: level.regions, solution: level.solution }))
  console.groupEnd()
}
