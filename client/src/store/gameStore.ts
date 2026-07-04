import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

interface GameStore {
  lastLevel: number
  puzzleSeed: number
  completedLevels: number[]
  difficulty: Difficulty
  puzzleIndex: number
  setLastLevel: (level: number) => void
  markLevelComplete: (level: number) => void
  resetProgress: () => void
  setDifficulty: (d: Difficulty) => void
  nextPuzzle: () => void
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      lastLevel: 1,
      puzzleSeed: 0,
      completedLevels: [],
      difficulty: 'medium',
      puzzleIndex: 0,
      setLastLevel: (level) => set({ lastLevel: level }),
      markLevelComplete: (level) => set(s =>
        s.completedLevels.includes(level)
          ? {}
          : { completedLevels: [...s.completedLevels, level] }
      ),
      resetProgress: () => set({ lastLevel: 1, puzzleSeed: Math.floor(Math.random() * 1_000_000), completedLevels: [] }),
      setDifficulty: (d) => set({ difficulty: d }),
      nextPuzzle: () => set(s => ({ puzzleIndex: s.puzzleIndex + 1 })),
    }),
    { name: 'meowdoku-game' }
  )
)
