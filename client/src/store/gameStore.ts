import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GameStore {
  lastLevel: number
  puzzleSeed: number
  setLastLevel: (level: number) => void
  resetProgress: () => void
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      lastLevel: 1,
      puzzleSeed: 0,
      setLastLevel: (level) => set({ lastLevel: level }),
      resetProgress: () => set({ lastLevel: 1, puzzleSeed: Math.floor(Math.random() * 1_000_000) }),
    }),
    { name: 'meowdoku-game' }
  )
)
