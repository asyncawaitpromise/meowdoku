import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GeneratedLevel } from '../lib/levelGen'

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

export type CellState = 'empty' | 'marker' | 'cat'

export interface SavedGame {
  level: GeneratedLevel
  board: CellState[][]
  solvedRegions: number[]
  fishCount: number
  wrongCells: string[]
}

interface GameStore {
  lastLevel: number
  puzzleSeed: number
  completedLevels: number[]
  completedPuzzles: Record<Difficulty, number[]>
  savedGames: Record<string, SavedGame>
  levelCache: Record<string, GeneratedLevel>
  setLastLevel: (level: number) => void
  markLevelComplete: (level: number) => void
  markPuzzleComplete: (d: Difficulty, index: number) => void
  saveGame: (id: string, game: SavedGame) => void
  loadGame: (id: string) => SavedGame | undefined
  clearSavedGame: (id: string) => void
  cacheLevel: (id: string, level: GeneratedLevel) => void
  getCachedLevel: (id: string) => GeneratedLevel | undefined
  resetProgress: () => void
}

const emptyCompletedPuzzles = (): Record<Difficulty, number[]> => ({
  easy: [], medium: [], hard: [], expert: [],
})

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      lastLevel: 1,
      puzzleSeed: 0,
      completedLevels: [],
      completedPuzzles: emptyCompletedPuzzles(),
      savedGames: {},
      levelCache: {},
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
      saveGame: (id, game) => set(s => ({ savedGames: { ...s.savedGames, [id]: game } })),
      loadGame: (id) => get().savedGames[id],
      clearSavedGame: (id) => set(s => {
        const { [id]: _removed, ...rest } = s.savedGames
        return { savedGames: rest }
      }),
      cacheLevel: (id, level) => set(s => ({ levelCache: { ...s.levelCache, [id]: level } })),
      getCachedLevel: (id) => get().levelCache[id],
      resetProgress: () => set({
        lastLevel: 1,
        puzzleSeed: Math.floor(Math.random() * 1_000_000),
        completedLevels: [],
        completedPuzzles: emptyCompletedPuzzles(),
        savedGames: {},
        levelCache: {},
      }),
    }),
    { name: 'meowdoku-game' }
  )
)