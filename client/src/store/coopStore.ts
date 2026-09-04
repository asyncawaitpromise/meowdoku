import { create } from 'zustand'
import { apiClient, ApiError } from '../services/apiClient.ts'
import { subscribeToAppEvent, subscribeToReconnect } from '../lib/liveEvents.ts'
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
  finishSession: (sessionId: string) => Promise<void>
  leaveSession: (sessionId: string) => Promise<void>
  fetchInvites: () => Promise<void>
  declineInvite: (sessionId: string) => Promise<void>
}

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong')

// Optimistic placements not yet confirmed by a server response, keyed
// `${sessionId}:${row},${col}`. A monotonic seq per placement lets a response
// reconcile against newer local edits that may have raced past it.
const pendingPlacements = new Map<string, { value: CellState; seq: number }>()
let placementSeq = 0

// Highest placement seq already reconciled against a server snapshot for each
// session. Responses at or below this are stale snapshots from before a newer
// write was confirmed — applying them would revert newer state, so they're
// dropped (HTTP responses to different cells can arrive out of order).
const lastReconciledSeq = new Map<string, number>()

const pendingKey = (sessionId: string, row: number, col: number) => `${sessionId}:${row},${col}`

// Adopt an authoritative server board, keeping optimistic values for any local
// edits newer than the response being processed (seq > confirmedSeq). Marks
// every pending entry at or before that seq as settled.
function reconcilePlacements(sessionId: string, serverBoard: Record<string, CellState>, confirmedSeq: number) {
  const { session } = useCoopStore.getState()
  if (!session || session.id !== sessionId) return

  const prefix = `${sessionId}:`
  const next: Record<string, CellState> = { ...serverBoard }
  for (const [key, pending] of pendingPlacements) {
    if (!key.startsWith(prefix)) continue
    const cell = key.slice(prefix.length)
    if (pending.seq > confirmedSeq) next[cell] = pending.value
    else pendingPlacements.delete(key)
  }

  useCoopStore.setState({ session: { ...session, boardState: next } })
}

function clearPendingFor(sessionId: string) {
  const prefix = `${sessionId}:`
  for (const key of pendingPlacements.keys()) {
    if (key.startsWith(prefix)) pendingPlacements.delete(key)
  }
}

// The plan's reconnect rule applied to co-op: pull the authoritative board so
// the server state wins. Unconfirmed optimistic edits are dropped rather than
// re-sent — placements are idempotent and cheap, so the cost of a lost tap
// during a rare disconnect is a re-tap, and re-sending could otherwise stomp a
// newer peer write that the server already settled on.
async function resyncSession(sessionId: string) {
  try {
    const session = await apiClient.get<CoopSession>(`/api/matches/${sessionId}`)
    clearPendingFor(sessionId)
    lastReconciledSeq.set(sessionId, placementSeq)
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
      lastReconciledSeq.set(sessionId, placementSeq)
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
      lastReconciledSeq.set(sessionId, placementSeq)
      set({ session, invite: null })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  // Optimistic with reconciliation: applied to local state immediately for
  // responsiveness (the plan's idempotent-placement model), then the server's
  // authoritative response is merged back in — unless a newer local edit is
  // still in flight, which is exactly how a same-cell race settles on the
  // last write instead of leaving the two clients diverged.
  placeCell: (row, col, state) => {
    const { session } = get()
    if (!session) return
    const key = `${row},${col}`
    const seq = ++placementSeq
    const pendingKeyStr = pendingKey(session.id, row, col)
    pendingPlacements.set(pendingKeyStr, { value: state, seq })
    set({ session: { ...session, boardState: { ...session.boardState, [key]: state } } })

    apiClient.post<CoopSession>(`/api/matches/${session.id}/place`, { row, col, state }).then(res => {
      if (seq <= (lastReconciledSeq.get(session.id) ?? 0)) {
        // A newer response already reconciled past this one, which means this
        // (older) placement's pending entry was dropped when that newer
        // snapshot didn't yet include its cell — the value can silently vanish
        // from the local board until the next full refetch. Pull the
        // authoritative board so it converges immediately.
        void resyncSession(session.id)
        return
      }
      lastReconciledSeq.set(session.id, seq)
      reconcilePlacements(session.id, res.boardState, seq)
    }).catch(() => {
      // The placement never reached the shared board — drop its pending guard
      // (so the peer's writes for that cell flow again) and pull the
      // authoritative board so the cell converges instead of sitting forever
      // at a local-only value.
      pendingPlacements.delete(pendingKeyStr)
      void resyncSession(session.id)
    })
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
    set({ session: null, error: null })
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

subscribeToAppEvent('match_update', (data) => {
  const { sessionId, status, players } = data as unknown as { sessionId: string; status: string; players: FriendProfile[] }
  useCoopStore.setState(state =>
    state.session?.id === sessionId
      ? { session: { ...state.session, status, players } }
      : {}
  )
})

subscribeToAppEvent('match_placement', (data) => {
  const { sessionId, row, col, state } = data as unknown as { sessionId: string; row: number; col: number; state: CellState }
  const { session } = useCoopStore.getState()
  if (!session || session.id !== sessionId) return
  const key = `${row},${col}`
  // A cell we've edited locally but haven't had confirmed yet stays at our
  // value until the server response settles it — applying the peer's write
  // here would just get overwritten by the reconcile anyway.
  if (pendingPlacements.has(pendingKey(sessionId, row, col))) return
  if (session.boardState[key] === state) return
  useCoopStore.setState({ session: { ...session, boardState: { ...session.boardState, [key]: state } } })
})
