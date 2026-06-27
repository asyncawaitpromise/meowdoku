import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GameStore {
  lastLevel: number
  setLastLevel: (level: number) => void
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      lastLevel: 1,
      setLastLevel: (level) => set({ lastLevel: level }),
    }),
    { name: 'meowdoku-game' }
  )
)
