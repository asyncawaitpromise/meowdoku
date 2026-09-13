import { create } from 'zustand'
import { apiClient } from '../services/apiClient.ts'
import { subscribeToAppEvent, subscribeToReconnect, sendLiveMessage } from '../lib/liveEvents.ts'
import { applyEvent, initialOpponentStats, type OpponentStats, type MatchLogEvent } from './matchesStore.ts'
import type { CoopSession } from './coopStore.ts'
import type { FriendProfile } from './friendsStore.ts'
import type { Difficulty, CellState } from './gameStore.ts'

export interface SpectateGameInfo {
  mode: 'solo' | 'coop' | 'head_to_head'
  sessionId?: string
  difficulty?: Difficulty
  puzzleIndex?: number
  levelNum?: number
  puzzleSeed?: number
  isDifficultyMode?: boolean
}

interface SpectateState {
  hostId: string | null
  info: SpectateGameInfo | null
  status: 'idle' | 'connecting' | 'active' | 'error'
  error: string | null

  // 'solo' mirrors this sparse board (absent key = empty cell).
  soloBoard: Record<string, CellState>
  // 'coop' mirrors the same shape the real players see.
  coopSession: CoopSession | null
  // 'head_to_head' has no shared board — just both players' running stats.
  matchPlayers: FriendProfile[]
  matchStats: Record<string, OpponentStats>

  start: (hostId: string) => void
  stop: () => void
}

const errorForCode = (code: string) => {
  switch (code) {
    case 'not_in_game': return 'Your friend just left their game'
    case 'offline': return 'Your friend went offline'
    case 'not_friends': return "You're not friends with this player anymore"
    default: return 'Could not start spectating'
  }
}

async function loadMatchSnapshot(sessionId: string, mode: string) {
  if (mode === 'coop') {
    try {
      const session = await apiClient.get<CoopSession>(`/api/matches/${sessionId}`)
      // A stop()/host switch may have landed while this was in flight.
      if (useSpectateStore.getState().info?.sessionId === sessionId) {
        useSpectateStore.setState({ coopSession: session })
      }
    } catch {
      // Best-effort — the next relayed match_resync/match_placement retries implicitly.
    }
    return
  }

  try {
    const [session, log] = await Promise.all([
      apiClient.get<{ players: FriendProfile[] }>(`/api/matches/${sessionId}`),
      apiClient.get<{ events: MatchLogEvent[] }>(`/api/matches/${sessionId}/events`),
    ])
    if (useSpectateStore.getState().info?.sessionId !== sessionId) return
    const stats: Record<string, OpponentStats> = {}
    for (const player of session.players) {
      stats[player.id] = log.events
        .filter(e => e.fromUserId === player.id)
        .reduce((acc, e) => applyEvent(acc, e.type), initialOpponentStats())
    }
    useSpectateStore.setState({ matchPlayers: session.players, matchStats: stats })
  } catch {
    // Best-effort — a later match_event/match_update triggers a retry.
  }
}

export const useSpectateStore = create<SpectateState>()((set, get) => ({
  hostId: null,
  info: null,
  status: 'idle',
  error: null,
  soloBoard: {},
  coopSession: null,
  matchPlayers: [],
  matchStats: {},

  start: (hostId) => {
    set({
      hostId, status: 'connecting', error: null, info: null,
      soloBoard: {}, coopSession: null, matchPlayers: [], matchStats: {},
    })
    const sent = sendLiveMessage({ type: 'spectate_start', targetUserId: hostId })
    if (!sent) set({ status: 'error', error: 'Not connected — try again in a moment' })
  },

  stop: () => {
    if (get().hostId) sendLiveMessage({ type: 'spectate_stop' })
    set({ hostId: null, info: null, status: 'idle', soloBoard: {}, coopSession: null, matchPlayers: [], matchStats: {} })
  },
}))

subscribeToAppEvent('spectate_started', (data) => {
  const { hostId, info } = data as unknown as { hostId: string; info: SpectateGameInfo }
  if (useSpectateStore.getState().hostId !== hostId) return
  useSpectateStore.setState({ info, status: 'active' })
  if (info.sessionId) void loadMatchSnapshot(info.sessionId, info.mode)
})

subscribeToAppEvent('spectate_error', (data) => {
  const { targetUserId, error } = data as unknown as { targetUserId: string; error: string }
  if (useSpectateStore.getState().hostId !== targetUserId) return
  useSpectateStore.setState({ status: 'error', error: errorForCode(error) })
})

subscribeToAppEvent('spectate_ended', (data) => {
  const { hostId } = data as unknown as { hostId: string }
  if (useSpectateStore.getState().hostId !== hostId) return
  useSpectateStore.setState({ status: 'error', error: 'Your friend left the game' })
})

subscribeToAppEvent('spectate_event', (data) => {
  const { hostId, event } = data as unknown as { hostId: string; event: Record<string, unknown> }
  const state = useSpectateStore.getState()
  if (state.hostId !== hostId) return

  switch (event.type) {
    case 'solo_snapshot': {
      useSpectateStore.setState({ soloBoard: event.board as Record<string, CellState> })
      break
    }
    case 'match_placement': {
      const { row, col, state: cellState } = event as { row: number; col: number; state: CellState }
      useSpectateStore.setState(s => s.coopSession
        ? { coopSession: { ...s.coopSession, boardState: { ...s.coopSession.boardState, [`${row},${col}`]: cellState } } }
        : {})
      break
    }
    case 'match_resync': {
      const incoming = (event as { session: CoopSession }).session
      if (state.coopSession) useSpectateStore.setState({ coopSession: incoming })
      break
    }
    case 'match_update':
    case 'match_event': {
      // Read-only and low-frequency — simplest correct thing is to re-pull
      // the authoritative snapshot rather than hand-patch status/scores locally.
      if (state.info?.sessionId) void loadMatchSnapshot(state.info.sessionId, state.info.mode)
      break
    }
  }
})

// A dropped connection also drops the server's record of who's spectating
// whom (see routes/ws.mjs's close handler), so a reconnect has to re-run the
// whole handshake rather than just re-pulling a snapshot.
subscribeToReconnect(() => {
  const { hostId } = useSpectateStore.getState()
  if (hostId) useSpectateStore.getState().start(hostId)
})
