import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GameStore {
  lastLevel: number
  puzzleSeed: number
  completedLevels: number[]
  setLastLevel: (level: number) => void
  markLevelComplete: (level: number) => void
  resetProgress: () => void
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      lastLevel: 1,
      puzzleSeed: 0,
      completedLevels: [],
      setLastLevel: (level) => set({ lastLevel: level }),
      markLevelComplete: (level) => set(s =>
        s.completedLevels.includes(level)
          ? {}
          : { completedLevels: [...s.completedLevels, level] }
      ),
      resetProgress: () => set({ lastLevel: 1, puzzleSeed: Math.floor(Math.random() * 1_000_000), completedLevels: [] }),
    }),
    { name: 'meowdoku-game' }
  )
)
