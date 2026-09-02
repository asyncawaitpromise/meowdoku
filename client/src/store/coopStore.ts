import { create } from 'zustand'
import { apiClient, ApiError } from '../services/apiClient.ts'
import { subscribeToAppEvent } from '../lib/liveEvents.ts'
import type { Difficulty, CellState } from './gameStore.ts'
import type { FriendProfile } from './friendsStore.ts'

export interface CoopSession {
  id: string
  mode: string
  difficulty: Difficulty
  puzzleSeed: number
  status: string
  players: FriendProfile[]
  boardState: Record<string, CellState>
}

export interface CoopInvite {
  sessionId: string
  difficulty: Difficulty
  from: FriendProfile
}

interface CoopState {
  session: CoopSession | null
  isLoading: boolean
  error: string | null
  invite: CoopInvite | null

  createMatch: (difficulty: Difficulty, inviteFriendId: string) => Promise<string | null>
  loadSession: (sessionId: string) => Promise<void>
  joinSession: (sessionId: string) => Promise<void>
  placeCell: (row: number, col: number, state: CellState) => void
  declineInvite: () => void
}

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong')

export const useCoopStore = create<CoopState>()((set, get) => ({
  session: null,
  isLoading: false,
  error: null,
  invite: null,

  createMatch: async (difficulty, inviteFriendId) => {
    try {
      const session = await apiClient.post<CoopSession>('/api/matches', { mode: 'coop', difficulty, inviteFriendId })
      set({ session })
      return session.id
    } catch (err) {
      set({ error: errorMessage(err) })
      return null
    }
  },

  loadSession: async (sessionId) => {
    set({ isLoading: true, error: null })
    try {
      const session = await apiClient.get<CoopSession>(`/api/matches/${sessionId}`)
      set({ session })
    } catch (err) {
      set({ error: errorMessage(err) })
    } finally {
      set({ isLoading: false })
    }
  },

  joinSession: async (sessionId) => {
    try {
      const session = await apiClient.post<CoopSession>(`/api/matches/${sessionId}/join`, {})
      set({ session, invite: null })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  // Fire-and-forget: applied to local state immediately for responsiveness
  // (see the plan's idempotent-placement model), the network call just
  // propagates it — a failure here isn't worth rolling the local cell back
  // for, since the other participant's next GET/reconnect still recovers
  // the authoritative board.
  placeCell: (row, col, state) => {
    const { session } = get()
    if (!session) return
    const key = `${row},${col}`
    set({ session: { ...session, boardState: { ...session.boardState, [key]: state } } })
    apiClient.post(`/api/matches/${session.id}/place`, { row, col, state }).catch(err => {
      set({ error: errorMessage(err) })
    })
  },

  declineInvite: () => set({ invite: null }),
}))

subscribeToAppEvent('match_invite', (data) => {
  const { sessionId, mode, difficulty, from } = data as unknown as { sessionId: string; mode: string; difficulty: Difficulty; from: FriendProfile }
  if (mode !== 'coop') return
  useCoopStore.setState({ invite: { sessionId, difficulty, from } })
})

subscribeToAppEvent('match_placement', (data) => {
  const { sessionId, row, col, state } = data as unknown as { sessionId: string; row: number; col: number; state: CellState }
  const { session } = useCoopStore.getState()
  if (!session || session.id !== sessionId) return
  const key = `${row},${col}`
  if (session.boardState[key] === state) return
  useCoopStore.setState({ session: { ...session, boardState: { ...session.boardState, [key]: state } } })
})
