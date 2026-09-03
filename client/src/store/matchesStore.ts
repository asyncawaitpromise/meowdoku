import { create } from 'zustand'
import { apiClient, ApiError } from '../services/apiClient.ts'
import { subscribeToAppEvent, subscribeToReconnect } from '../lib/liveEvents.ts'
import { useAuthStore } from './authStore.ts'
import type { Difficulty } from './gameStore.ts'
import type { FriendProfile } from './friendsStore.ts'

export const MAX_FISH = 3

export interface MatchSession {
  id: string
  mode: string
  difficulty: Difficulty
  puzzleSeed: number
  status: 'waiting' | 'active' | string
  players: FriendProfile[]
}

export interface MatchLogEvent {
  sessionId: string
  fromUserId: string
  type: string
  payload: unknown
  createdAt: string
}

export interface MatchInvite {
  sessionId: string
  mode: string
  difficulty: Difficulty
  from: FriendProfile
}

export interface OpponentStats {
  fishCount: number
  catsFound: number
  xPlaced: number
}

const initialOpponentStats = (): OpponentStats => ({ fishCount: MAX_FISH, catsFound: 0, xPlaced: 0 })

function applyEvent(stats: OpponentStats, type: string): OpponentStats {
  switch (type) {
    case 'life_lost': return { ...stats, fishCount: Math.max(0, stats.fishCount - 1) }
    case 'cat_found': return { ...stats, catsFound: stats.catsFound + 1 }
    case 'x_placed': return { ...stats, xPlaced: stats.xPlaced + 1 }
    default: return stats
  }
}

interface MatchesState {
  invite: MatchInvite | null
  session: MatchSession | null
  opponentStats: OpponentStats
  isLoading: boolean
  error: string | null

  createMatch: (difficulty: Difficulty, inviteFriendId: string) => Promise<MatchSession | null>
  loadMatch: (sessionId: string) => Promise<void>
  refreshMatch: (sessionId: string) => Promise<void>
  joinMatch: (sessionId: string) => Promise<MatchSession | null>
  postEvent: (sessionId: string, type: string, payload?: unknown) => Promise<void>
  finishMatch: (sessionId: string) => Promise<void>
  leaveMatch: (sessionId: string) => Promise<void>
  fetchInvites: () => Promise<void>
  declineInvite: (sessionId: string) => Promise<void>
  clearInvite: () => void
  clearMatch: () => void
}

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong')

// Defined outside the store creator so both the initial load (loading spinner)
// and the silent reconnect refresh can share it; uses setState so it doesn't
// depend on the creator's `set`.
const fetchMatch = async (sessionId: string, showLoading: boolean) => {
  if (showLoading) useMatchesStore.setState({ isLoading: true, error: null })
  try {
    const [session, log] = await Promise.all([
      apiClient.get<MatchSession>(`/api/matches/${sessionId}`),
      apiClient.get<{ events: MatchLogEvent[] }>(`/api/matches/${sessionId}/events`),
    ])
    const selfId = useAuthStore.getState().user?.id
    const opponentStats = log.events
      .filter(e => e.fromUserId !== selfId)
      .reduce((stats, e) => applyEvent(stats, e.type), initialOpponentStats())
    useMatchesStore.setState({ session, opponentStats })
  } catch (err) {
    if (showLoading) useMatchesStore.setState({ error: errorMessage(err) })
  } finally {
    if (showLoading) useMatchesStore.setState({ isLoading: false })
  }
}

export const useMatchesStore = create<MatchesState>()((set) => ({
  invite: null,
  session: null,
  opponentStats: initialOpponentStats(),
  isLoading: false,
  error: null,

  createMatch: async (difficulty, inviteFriendId) => {
    try {
      return await apiClient.post<MatchSession>('/api/matches', { mode: 'head_to_head', difficulty, inviteFriendId })
    } catch (err) {
      set({ error: errorMessage(err) })
      return null
    }
  },

  loadMatch: async (sessionId) => {
    await fetchMatch(sessionId, true)
  },

  // Silent re-fetch for SSE reconnects: re-pulls the authoritative session and
  // full event log without flashing a loading screen mid-match.
  refreshMatch: async (sessionId) => {
    await fetchMatch(sessionId, false)
  },

  joinMatch: async (sessionId) => {
    try {
      const session = await apiClient.post<MatchSession>(`/api/matches/${sessionId}/join`, {})
      set({ session })
      return session
    } catch (err) {
      set({ error: errorMessage(err) })
      return null
    }
  },

  postEvent: async (sessionId, type, payload) => {
    try {
      await apiClient.post(`/api/matches/${sessionId}/events`, { type, payload })
    } catch {
      // Best-effort telemetry: a dropped/rejected event (e.g. a 400 from the
      // server's scorecard validation or a 429 rate limit) shouldn't tear down
      // the match screen. The opponent's HUD may miss one delta; the next
      // reconnect re-pulls the authoritative log anyway.
    }
  },

  finishMatch: async (sessionId) => {
    try {
      const session = await apiClient.post<MatchSession>(`/api/matches/${sessionId}/finish`, {})
      set({ session })
    } catch {
      // If this never lands, the session just stays active until the TTL sweep;
      // that's preferable to kicking the winner out of a finished board.
    }
  },

  leaveMatch: async (sessionId) => {
    try {
      await apiClient.post(`/api/matches/${sessionId}/leave`, {})
    } catch {
      // Leaving is best-effort — a 404 just means the session already ended
      // (or another tab cleaned it up).
    }
    set({ session: null, opponentStats: initialOpponentStats(), error: null })
  },

  // Pull the invite inbox (the plan's reconnect rule applied to challenges):
  // whoever was offline while an invite was sent picks it up here. A banner
  // whose invite has vanished from the inbox is dropped so it doesn't hang
  // around forever after the host cancelled or the session aged out.
  fetchInvites: async () => {
    try {
      const { invites } = await apiClient.get<{ invites: MatchInvite[] }>('/api/matches/invites')
      const state = useMatchesStore.getState()
      const currentSessionId = state.session?.id
      const pending = invites.filter(i => i.mode === 'head_to_head' && i.sessionId !== currentSessionId)

      if (state.invite && pending.every(i => i.sessionId !== state.invite!.sessionId)) {
        set({ invite: null })
      }
      const next = pending[0]
      if (next && next.sessionId !== state.invite?.sessionId) set({ invite: next })
    } catch {
      // Offline — leave whatever invite state exists; a later fetch retries.
    }
  },

  declineInvite: async (sessionId) => {
    try {
      await apiClient.post(`/api/matches/${sessionId}/decline`, {})
    } catch {
      // The invite may have already been cleared or the session finished.
    }
    set({ invite: null })
  },

  clearInvite: () => set({ invite: null }),
  clearMatch: () => set({ session: null, opponentStats: initialOpponentStats(), error: null }),
}))

subscribeToAppEvent('match_invite', (data) => {
  const invite = data as unknown as MatchInvite
  // Co-op invites carry their own path (coopStore / CoopGame); only head-to-head
  // challenges should pop the MatchInviteBanner, or accepting a co-op invite
  // would load a shared-board session into the head-to-head screen.
  if (invite.mode !== 'head_to_head') return
  useMatchesStore.setState({ invite })
})

subscribeToAppEvent('match_update', (data) => {
  const { sessionId, status, players } = data as unknown as { sessionId: string; status: string; players: FriendProfile[] }
  useMatchesStore.setState(state =>
    state.session?.id === sessionId
      ? { session: { ...state.session, status, players } }
      : {}
  )
})

subscribeToAppEvent('match_event', (data) => {
  const event = data as unknown as { sessionId: string; fromUserId: string; eventType: string; payload: unknown }
  const selfId = useAuthStore.getState().user?.id
  if (event.fromUserId === selfId) return
  useMatchesStore.setState(state =>
    state.session?.id === event.sessionId
      ? { opponentStats: applyEvent(state.opponentStats, event.eventType) }
      : {}
  )
})

// The plan's reconnect rule: after any SSE reconnect the stream may have silently
// dropped events, so re-pull the authoritative session + full event log instead
// of trusting it to be gap-free.
subscribeToReconnect(() => {
  const session = useMatchesStore.getState().session
  if (session) void useMatchesStore.getState().refreshMatch(session.id)
})
