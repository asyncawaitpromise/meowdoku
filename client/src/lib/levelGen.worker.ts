import { generateLevelPhased, generateLevelByDifficultyPhased } from './levelGen'
import type { Difficulty, GeneratedLevel } from './levelGen'

const progress = (msg: string) => self.postMessage({ type: 'progress', msg })

// Runs exactly one phase per message, driven by the coordinator's phase
// barrier (see levelGenCoordinator.ts) — never the whole pipeline in one
// shot. `gen` persists across messages for the lifetime of this worker
// (one worker only ever serves one generation request before the
// coordinator terminates it).
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
