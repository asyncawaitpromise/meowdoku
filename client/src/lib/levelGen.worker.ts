import { generateLevelPhased, generateLevelByDifficultyPhased, searchTierStream } from './levelGen'
import type { Difficulty, GeneratedLevel, SearchTier } from './levelGen'

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

// Hard/expert on-device generation: search until a puzzle clears the tier's whole bar — never settles
// for less. Runs to completion in one go (the coordinator terminates the worker when any worker wins),
// reporting progress as it goes.
function searchTier(tier: SearchTier, firstSeed: number, stride: number, steps?: number) {
  const stream = searchTierStream(tier, firstSeed, stride, steps)
  let next = stream.next()
  while (!next.done) {
    progress(`Searching for a ${tier} puzzle… ${next.value.attempts} layouts tried`)
    next = stream.next()
  }
  self.postMessage({ type: 'result', level: next.value.level })
}

self.onmessage = (e: MessageEvent) => {
  const { type, levelNum, puzzleSeed, difficulty, puzzleIndex, globalSeed, salt, budgetDivisor } = e.data
  if (type === 'generateLevel') {
    gen = generateLevelPhased(levelNum as number, puzzleSeed as number, progress, (salt as number) ?? 0, (budgetDivisor as number) ?? 1)
    step()
  } else if (type === 'generateLevelByDifficulty') {
    gen = generateLevelByDifficultyPhased(difficulty as Difficulty, puzzleIndex as number, globalSeed as number, progress, (salt as number) ?? 0, (budgetDivisor as number) ?? 1)
    step()
  } else if (type === 'searchTier') {
    searchTier(e.data.tier as SearchTier, e.data.firstSeed as number, (e.data.stride as number) ?? 1, e.data.steps as number | undefined)
  } else if (type === 'advance') {
    step()
  }
}
