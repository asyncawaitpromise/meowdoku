import { generateLevelPhased, generateLevelByDifficultyPhased } from './levelGen'
import type { Difficulty, GeneratedLevel } from './levelGen'

const progress = (msg: string) => self.postMessage({ type: 'progress', msg })

// Persists across messages: the coordinator drives one phase per message
// rather than letting the whole pipeline run in one shot.
let gen: Generator<{ phase: string }, GeneratedLevel, void> | null = null

function step() {
  if (!gen) return
  const result = gen.next()
  if (result.done) {
    self.postMessage({ type: 'result', level: result.value })
    gen = null
  } else {
    self.postMessage({ type: 'phaseDone', phase: result.value.phase })
  }
}

self.onmessage = (e: MessageEvent) => {
  const { type, levelNum, puzzleSeed, difficulty, puzzleIndex, globalSeed, salt, budgetDivisor } = e.data
  if (type === 'generateLevel') {
    gen = generateLevelPhased(levelNum as number, puzzleSeed as number, progress, (salt as number) ?? 0, (budgetDivisor as number) ?? 1)
    step()
  } else if (type === 'generateLevelByDifficulty') {
    gen = generateLevelByDifficultyPhased(difficulty as Difficulty, puzzleIndex as number, globalSeed as number, progress, (salt as number) ?? 0, (budgetDivisor as number) ?? 1)
    step()
  } else if (type === 'advance') {
    step()
  }
}
