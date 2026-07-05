import { generateLevel, generateLevelByDifficulty } from './levelGen'
import type { Difficulty } from './levelGen'

self.onmessage = (e: MessageEvent) => {
  const { type, levelNum, puzzleSeed, difficulty, puzzleIndex, globalSeed } = e.data
  if (type === 'generateLevel') {
    self.postMessage(generateLevel(levelNum as number, puzzleSeed as number))
  } else if (type === 'generateLevelByDifficulty') {
    self.postMessage(generateLevelByDifficulty(difficulty as Difficulty, puzzleIndex as number, globalSeed as number))
  }
}
