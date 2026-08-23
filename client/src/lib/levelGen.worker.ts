import { generateLevel, generateLevelByDifficulty } from './levelGen'
import type { Difficulty } from './levelGen'

const progress = (msg: string) => self.postMessage({ type: 'progress', msg })

self.onmessage = (e: MessageEvent) => {
  const { type, levelNum, puzzleSeed, difficulty, puzzleIndex, globalSeed, salt } = e.data
  if (type === 'generateLevel') {
    const level = generateLevel(levelNum as number, puzzleSeed as number, progress, (salt as number) ?? 0)
    self.postMessage({ type: 'result', level })
  } else if (type === 'generateLevelByDifficulty') {
    const level = generateLevelByDifficulty(difficulty as Difficulty, puzzleIndex as number, globalSeed as number, progress, (salt as number) ?? 0)
    self.postMessage({ type: 'result', level })
  }
}
