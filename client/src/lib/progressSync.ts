import { useGameStore, registerProgressSyncHooks, type Difficulty, type SavedGame } from '../store/gameStore.ts'
import { apiClient } from '../services/apiClient.ts'

interface ProgressPayload {
  completedLevels: number[]
  completedPuzzles: Record<Difficulty, number[]>
  savedGames: Record<string, SavedGame>
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert']
const PROGRESS_DEBOUNCE_MS = 500
const SAVED_GAME_DEBOUNCE_MS = 800

const unionNumbers = (a: number[], b: number[]): number[] => Array.from(new Set([...a, ...b])).sort((x, y) => x - y)

const mergeCompletedPuzzles = (
  a: Record<Difficulty, number[]>,
  b: Record<Difficulty, number[]>
): Record<Difficulty, number[]> => {
  const merged = {} as Record<Difficulty, number[]>
  for (const d of DIFFICULTIES) merged[d] = unionNumbers(a[d] ?? [], b[d] ?? [])
  return merged
}

// Local state persists in localStorage across whoever is signed in on this device, so a
// naive merge on every sync would leak progress between users. syncedUserId tracks who the
// cached local progress currently belongs to: same id (or none yet) means "resuming, merge
// with the server"; a different id means a real user switch, so local state is discarded.
async function syncProgressForUser(userId: string) {
  const store = useGameStore.getState()

  let server: ProgressPayload
  try {
    server = await apiClient.get<ProgressPayload>('/api/progress')
  } catch {
    return
  }

  // Re-check syncedUserId *after* the await: if the user switched while the
  // request was in flight, the local store now belongs to the new user and
  // merging this (old user's) server payload into it would pollute their
  // progress and clobber syncedUserId.
  const stateNow = useGameStore.getState()
  if (stateNow.syncedUserId !== null && stateNow.syncedUserId !== userId) {
    suppressOutgoing(() => useGameStore.getState().hydrateProgress(server, userId))
    return
  }

  const merged: ProgressPayload = {
    completedLevels: unionNumbers(server.completedLevels, stateNow.completedLevels),
    completedPuzzles: mergeCompletedPuzzles(server.completedPuzzles, stateNow.completedPuzzles),
    savedGames: { ...server.savedGames, ...stateNow.savedGames },
  }
  suppressOutgoing(() => useGameStore.getState().hydrateProgress(merged, userId))

  apiClient.patch('/api/progress', {
    completedLevels: merged.completedLevels,
    completedPuzzles: merged.completedPuzzles,
  }).catch(() => {})

  for (const [gameId, game] of Object.entries(merged.savedGames)) {
    const onServer = server.savedGames[gameId]
    if (onServer === undefined || JSON.stringify(onServer) !== JSON.stringify(game)) {
      apiClient.put(`/api/progress/games/${gameId}`, game).catch(() => {})
    }
  }
}

let suppressed = false

function suppressOutgoing(fn: () => void) {
  suppressed = true
  try {
    fn()
  } finally {
    suppressed = false
  }
}

let progressDebounce: ReturnType<typeof setTimeout> | null = null
const savedGameDebounces = new Map<string, ReturnType<typeof setTimeout>>()

function pushProgress() {
  const { completedLevels, completedPuzzles } = useGameStore.getState()
  apiClient.patch('/api/progress', { completedLevels, completedPuzzles }).catch(() => {})
}

function pushSavedGame(gameId: string) {
  const game = useGameStore.getState().savedGames[gameId]
  if (!game) return
  apiClient.put(`/api/progress/games/${gameId}`, game).catch(() => {})
}

let outgoingWatchersStarted = false

function startOutgoingWatchers() {
  if (outgoingWatchersStarted) return
  outgoingWatchersStarted = true

  useGameStore.subscribe((state, prevState) => {
    if (suppressed) return

    if (state.completedLevels !== prevState.completedLevels || state.completedPuzzles !== prevState.completedPuzzles) {
      if (progressDebounce) clearTimeout(progressDebounce)
      progressDebounce = setTimeout(pushProgress, PROGRESS_DEBOUNCE_MS)
    }

    if (state.savedGames !== prevState.savedGames) {
      for (const [gameId, game] of Object.entries(state.savedGames)) {
        if (game === prevState.savedGames[gameId]) continue
        const pending = savedGameDebounces.get(gameId)
        if (pending) clearTimeout(pending)
        savedGameDebounces.set(gameId, setTimeout(() => {
          savedGameDebounces.delete(gameId)
          pushSavedGame(gameId)
        }, SAVED_GAME_DEBOUNCE_MS))
      }
    }
  })

  registerProgressSyncHooks({
    onClearSavedGame: (id) => {
      const pending = savedGameDebounces.get(id)
      if (pending) {
        clearTimeout(pending)
        savedGameDebounces.delete(id)
      }
      apiClient.delete(`/api/progress/games/${id}`).catch(() => {})
    },
    onResetProgress: () => {
      if (progressDebounce) {
        clearTimeout(progressDebounce)
        progressDebounce = null
      }
      for (const pending of savedGameDebounces.values()) clearTimeout(pending)
      savedGameDebounces.clear()
      apiClient.post('/api/progress/reset', {}).catch(() => {})
    },
  })
}

export function syncProgress(userId: string) {
  startOutgoingWatchers()
  void syncProgressForUser(userId)
}
