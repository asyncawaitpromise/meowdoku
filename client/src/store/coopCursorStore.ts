import { create } from 'zustand'
import { subscribeToAppEvent } from '../lib/liveEvents.ts'

export interface PartnerCursor {
  x: number
  y: number
  updatedAt: number
}

interface CoopCursorState {
  sessionId: string | null
  partnerCursor: PartnerCursor | null
  clear: () => void
}

export const useCoopCursorStore = create<CoopCursorState>()((set) => ({
  sessionId: null,
  partnerCursor: null,
  clear: () => set({ sessionId: null, partnerCursor: null }),
}))

subscribeToAppEvent('coop_cursor', (data) => {
  const { sessionId, x, y } = data as unknown as { sessionId: string; x: number | null; y: number | null }
  const partnerCursor = x === null || y === null ? null : { x, y, updatedAt: Date.now() }
  useCoopCursorStore.setState({ sessionId, partnerCursor })
})
