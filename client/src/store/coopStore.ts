import { create } from 'zustand'
import { apiClient, ApiError } from '../services/apiClient.ts'
import { subscribeToAppEvent, subscribeToReconnect, sendLiveMessage } from '../lib/liveEvents.ts'
import { useAuthStore } from './authStore.ts'
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
  // Set when the partner starts the follow-up puzzle, so this side follows.
  continuation: { fromSessionId: string; sessionId: string } | null

  createMatch: (difficulty: Difficulty, inviteFriendId: string) => Promise<string | null>
  loadSession: (sessionId: string) => Promise<void>
  joinSession: (sessionId: string) => Promise<void>
  placeCell: (row: number, col: number, state: CellState) => void
  finishSession: (sessionId: string) => Promise<void>
  leaveSession: (sessionId: string) => Promise<void>
  startNextPuzzle: (sessionId: string) => Promise<string | null>
  fetchInvites: () => Promise<void>
  declineInvite: (sessionId: string) => Promise<void>
  resyncSession: (sessionId: string) => Promise<void>
}

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong')

// Optimistic placements not yet confirmed by our own echo back from the
// server, keyed `${sessionId}:${row},${col}` -> the value we sent. A single
// WebSocket connection delivers messages (including our own broadcast echo)
// in the order the server processed them, so — unlike the old HTTP
// POST-per-cell design — there's no need to guard against out-of-order
// responses across different requests; the only race left is our own local
// state having moved past what a given echo confirms (see the
// 'match_placement' handler below), which a plain "is this echo still what
// I last sent for this cell" check resolves.
const pendingPlacements = new Map<string, CellState>()

const pendingKey = (sessionId: string, row: number, col: number) => `${sessionId}:${row},${col}`

function clearPendingFor(sessionId: string) {
  const prefix = `${sessionId}:`
  for (const key of pendingPlacements.keys()) {
    if (key.startsWith(prefix)) pendingPlacements.delete(key)
  }
}

// Pull the authoritative session (status + board) fresh from the server.
// Used for the initial load, and as a fallback after anything that might
// have left local state stale — a failed/undeliverable placement, or a
// reconnect (a dropped connection means anything the server pushed while we
// had no live listener is gone for good; see also emitActiveSessionSnapshots
// server-side, which proactively re-pushes this same data on every
// (re)connect so this manual path is a backstop, not the primary mechanism).
async function resyncSession(sessionId: string) {
  try {
    const session = await apiClient.get<CoopSession>(`/api/matches/${sessionId}`)
    clearPendingFor(sessionId)
    useCoopStore.setState({ session })
  } catch {
    // GET failed — leave local state as-is; a later reconnect retries.
  }
}

export const useCoopStore = create<CoopState>()((set, get) => ({
  session: null,
  isLoading: false,
  error: null,
  invite: null,
  continuation: null,

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
      clearPendingFor(sessionId)
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
      clearPendingFor(sessionId)
      set({ session, invite: null })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  // Optimistic: applied to local state immediately for responsiveness, then
  // sent as a WebSocket message. The server broadcasts every accepted
  // placement back to *all* participants (including the sender, unlike the
  // old POST-per-cell design) — our own echo, handled in the 'match_placement'
  // subscriber below, is what confirms this pending entry rather than an
  // HTTP response.
  placeCell: (row, col, state) => {
    const { session } = get()
    if (!session) return
    const key = `${row},${col}`
    const pendingKeyStr = pendingKey(session.id, row, col)
    pendingPlacements.set(pendingKeyStr, state)
    set({ session: { ...session, boardState: { ...session.boardState, [key]: state } } })

    const sent = sendLiveMessage({ type: 'place', sessionId: session.id, row, col, state })
    if (!sent) {
      // The socket wasn't open (a rare startup/reconnect race — the live
      // connection is normally already up long before a coop board is ever
      // opened). Nothing will ever confirm this pending entry, so pull the
      // authoritative board directly instead of leaving it stuck.
      pendingPlacements.delete(pendingKeyStr)
      void resyncSession(session.id)
    }
  },

  finishSession: async (sessionId) => {
    try {
      const session = await apiClient.post<CoopSession>(`/api/matches/${sessionId}/finish`, {})
      set({ session })
    } catch {
      // Best-effort: if this doesn't land the session stays active until the
      // TTL sweep — not worth turning a solved board into an error screen.
    }
  },

  leaveSession: async (sessionId) => {
    try {
      await apiClient.post(`/api/matches/${sessionId}/leave`, {})
    } catch {
      // Best-effort: a 404 just means the session already ended or was cleaned up.
    }
    clearPendingFor(sessionId)
    set(state => (state.session?.id === sessionId ? { session: null, error: null } : {}))
  },

  startNextPuzzle: async (sessionId) => {
    try {
      const next = await apiClient.post<CoopSession>(`/api/matches/${sessionId}/next`, {})
      set({ continuation: null })
      return next.id
    } catch (err) {
      set({ error: errorMessage(err) })
      return null
    }
  },

  // Same inbox rule as head-to-head: pull parked invites on login/reconnect so
  // an invite sent while this user was offline still surfaces as a banner.
  fetchInvites: async () => {
    try {
      const { invites } = await apiClient.get<{ invites: Array<{ sessionId: string; mode: string; difficulty: Difficulty; from: FriendProfile }> }>('/api/matches/invites')
      const state = useCoopStore.getState()
      const currentSessionId = state.session?.id
      const pending = invites.filter(i => i.mode === 'coop' && i.sessionId !== currentSessionId)

      if (state.invite && pending.every(i => i.sessionId !== state.invite!.sessionId)) {
        set({ invite: null })
      }
      const next = pending[0]
      if (next && next.sessionId !== state.invite?.sessionId) {
        set({ invite: { sessionId: next.sessionId, difficulty: next.difficulty, from: next.from } })
      }
    } catch {
      // Offline — leave invite state as-is; a later fetch retries.
    }
  },

  declineInvite: async (sessionId) => {
    try {
      await apiClient.post(`/api/matches/${sessionId}/decline`, {})
    } catch {
      // Best-effort.
    }
    set({ invite: null })
  },

  resyncSession,
}))

subscribeToReconnect(() => {
  const { session } = useCoopStore.getState()
  if (session) void resyncSession(session.id)
})

subscribeToAppEvent('match_invite', (data) => {
  const { sessionId, mode, difficulty, from } = data as unknown as { sessionId: string; mode: string; difficulty: Difficulty; from: FriendProfile }
  if (mode !== 'coop') return
  useCoopStore.setState({ invite: { sessionId, difficulty, from } })
})

subscribeToAppEvent('coop_next', (data) => {
  const { fromSessionId, sessionId } = data as unknown as { fromSessionId: string; sessionId: string }
  useCoopStore.setState({ continuation: { fromSessionId, sessionId } })
})

subscribeToAppEvent('match_update', (data) => {
  const { sessionId, status, players } = data as unknown as { sessionId: string; status: string; players: FriendProfile[] }
  useCoopStore.setState(state =>
    state.session?.id === sessionId
      ? { session: { ...state.session, status, players } }
      : {}
  )
})

// A full authoritative snapshot, pushed by the server on every (re)connect
// (see emitActiveSessionSnapshots in routes/matches.mjs) — this is what
// self-heals a session stuck showing stale status/board after a connection
// gap, without needing a manual page refresh.
subscribeToAppEvent('match_resync', (data) => {
  const incoming = (data as unknown as { session: CoopSession }).session
  const { session } = useCoopStore.getState()
  if (session?.id !== incoming.id) return
  clearPendingFor(incoming.id)
  useCoopStore.setState({ session: incoming })
})

subscribeToAppEvent('match_placement', (data) => {
  const { sessionId, row, col, state, byUserId } = data as unknown as { sessionId: string; row: number; col: number; state: CellState; byUserId: string }
  const { session } = useCoopStore.getState()
  if (!session || session.id !== sessionId) return
  const key = `${row},${col}`
  const pendingKeyStr = pendingKey(sessionId, row, col)

  if (byUserId === useAuthStore.getState().user?.id) {
    // Our own broadcast echo, arriving back in the order the server
    // processed it (one WebSocket connection preserves per-connection
    // order). If it matches the value we most recently sent for this cell,
    // that write is now confirmed. If it doesn't, we've since sent a newer
    // value for the same cell that hasn't echoed yet — that pending entry is
    // the authoritative one, so this stale echo is simply dropped.
    if (pendingPlacements.get(pendingKeyStr) === state) pendingPlacements.delete(pendingKeyStr)
    return
  }

  // The other player's write. A cell we've optimistically edited locally but
  // whose own echo hasn't confirmed yet stays at our value — it settles once
  // that echo arrives.
  if (pendingPlacements.has(pendingKeyStr)) return
  if (session.boardState[key] === state) return
  useCoopStore.setState({ session: { ...session, boardState: { ...session.boardState, [key]: state } } })
})
