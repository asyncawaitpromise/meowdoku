import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

interface GameStore {
  lastLevel: number
  puzzleSeed: number
  completedLevels: number[]
  completedPuzzles: Record<Difficulty, number[]>
  setLastLevel: (level: number) => void
  markLevelComplete: (level: number) => void
  markPuzzleComplete: (d: Difficulty, index: number) => void
  resetProgress: () => void
}

const emptyCompletedPuzzles = (): Record<Difficulty, number[]> => ({
  easy: [], medium: [], hard: [], expert: [],
})

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      lastLevel: 1,
      puzzleSeed: 0,
      completedLevels: [],
      completedPuzzles: emptyCompletedPuzzles(),
      setLastLevel: (level) => set({ lastLevel: level }),
      markLevelComplete: (level) => set(s =>
        s.completedLevels.includes(level)
          ? {}
          : { completedLevels: [...s.completedLevels, level] }
      ),
      markPuzzleComplete: (d, index) => set(s =>
        s.completedPuzzles[d].includes(index)
          ? {}
          : { completedPuzzles: { ...s.completedPuzzles, [d]: [...s.completedPuzzles[d], index] } }
      ),
      resetProgress: () => set({
        lastLevel: 1,
        puzzleSeed: Math.floor(Math.random() * 1_000_000),
        completedLevels: [],
        completedPuzzles: emptyCompletedPuzzles(),
      }),
    }),
    { name: 'meowdoku-game' }
  )
)
