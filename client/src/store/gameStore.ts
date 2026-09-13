import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GeneratedLevel } from '../lib/levelGen'
import { defaultEzXsRules, type EzXsRules } from '../lib/ezXs'

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

export type CellState = 'empty' | 'marker' | 'cat' | 'question'

export type CatAnimation = 'draw' | 'pop' | 'shatter' | 'none'

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
  catAnimation: CatAnimation
  syncedUserId: string | null
  // Accessibility: quick double-tap commits a cat immediately, which clumsy
  // fingers can trigger by accident. The tap-and-hold radial picker is always
  // available regardless of this flag — this only gates the faster gesture.
  doubleTapToPlaceCat: boolean
  // Ez X's: auto-places X's for cells a just-placed cat rules out.
  // Off by default so it never changes the puzzle-solving feel for existing
  // players; each sub-rule can be toggled independently once the master
  // switch is on. The toggle itself is local (like catAnimation) — in
  // multiplayer only the player with it on triggers new marks, but the
  // resulting X's are shared board state both players see.
  ezXsMode: boolean
  ezXsRules: EzXsRules
  setLastLevel: (level: number) => void
  markLevelComplete: (level: number) => void
  markPuzzleComplete: (d: Difficulty, index: number) => void
  saveGame: (id: string, game: SavedGame) => void
  loadGame: (id: string) => SavedGame | undefined
  clearSavedGame: (id: string) => void
  cacheLevel: (id: string, level: GeneratedLevel) => void
  getCachedLevel: (id: string) => GeneratedLevel | undefined
  setCatAnimation: (a: CatAnimation) => void
  setDoubleTapToPlaceCat: (v: boolean) => void
  setEzXsMode: (v: boolean) => void
  setEzXsRule: (rule: keyof EzXsRules, v: boolean) => void
  resetProgress: () => void
  hydrateProgress: (progress: {
    completedLevels: number[]
    completedPuzzles: Record<Difficulty, number[]>
    savedGames: Record<string, SavedGame>
  }, userId: string) => void
}

const emptyCompletedPuzzles = (): Record<Difficulty, number[]> => ({
  easy: [], medium: [], hard: [], expert: [],
})

// progressSync.ts registers into this so gameStore doesn't need to import it
// (that would be circular: progressSync needs useGameStore to watch/read state).
interface ProgressSyncHooks {
  onClearSavedGame: (id: string) => void
  onResetProgress: () => void
}

let progressSyncHooks: ProgressSyncHooks | null = null

export function registerProgressSyncHooks(hooks: ProgressSyncHooks) {
  progressSyncHooks = hooks
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      lastLevel: 1,
      // Randomized per-device so different devices don't generate identical
      // puzzles for the same (difficulty, puzzleIndex) — a fresh install used
      // to default to 0 for everyone, making every client-side generation
      // redundant with every other client's. resetProgress() re-rolls this
      // the same way for an existing install that wants a clean slate.
      puzzleSeed: Math.floor(Math.random() * 1_000_000),
      completedLevels: [],
      completedPuzzles: emptyCompletedPuzzles(),
      savedGames: {},
      levelCache: {},
      catAnimation: 'shatter',
      syncedUserId: null,
      doubleTapToPlaceCat: true,
      ezXsMode: false,
      ezXsRules: defaultEzXsRules,
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
      clearSavedGame: (id) => {
        set(s => {
          const { [id]: _removed, ...rest } = s.savedGames
          return { savedGames: rest }
        })
        progressSyncHooks?.onClearSavedGame(id)
      },
      cacheLevel: (id, level) => set(s => ({ levelCache: { ...s.levelCache, [id]: level } })),
      getCachedLevel: (id) => get().levelCache[id],
      setCatAnimation: (a) => set({ catAnimation: a }),
      setDoubleTapToPlaceCat: (v) => set({ doubleTapToPlaceCat: v }),
      setEzXsMode: (v) => set({ ezXsMode: v }),
      setEzXsRule: (rule, v) => set(s => ({ ezXsRules: { ...s.ezXsRules, [rule]: v } })),
      resetProgress: () => {
        set({
          lastLevel: 1,
          puzzleSeed: Math.floor(Math.random() * 1_000_000),
          completedLevels: [],
          completedPuzzles: emptyCompletedPuzzles(),
          savedGames: {},
          levelCache: {},
        })
        progressSyncHooks?.onResetProgress()
      },
      hydrateProgress: (progress, userId) => set({
        completedLevels: progress.completedLevels,
        completedPuzzles: progress.completedPuzzles,
        savedGames: progress.savedGames,
        syncedUserId: userId,
      }),
    }),
    { name: 'meowdoku-game' }
  )
)