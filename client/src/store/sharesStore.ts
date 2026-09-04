import { create } from 'zustand'
import { apiClient, ApiError } from '../services/apiClient.ts'
import { subscribeToAppEvent } from '../lib/liveEvents.ts'
import type { FriendProfile } from './friendsStore.ts'

export interface PuzzleShare {
  id: string
  shareCode: string
  createdAt: string
  from: FriendProfile
}

interface SharesState {
  shares: PuzzleShare[]
  isLoading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  send: (toUserId: string, shareCode: string) => Promise<{ success: boolean; error?: string }>
  dismiss: (id: string) => Promise<void>
}

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong')

export const useSharesStore = create<SharesState>()((set, get) => ({
  shares: [],
  isLoading: false,
  error: null,

  fetchAll: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await apiClient.get<{ shares: PuzzleShare[] }>('/api/shares')
      set({ shares: res.shares })
    } catch (err) {
      set({ error: errorMessage(err) })
    } finally {
      set({ isLoading: false })
    }
  },

  send: async (toUserId, shareCode) => {
    try {
      await apiClient.post('/api/shares', { toUserId, shareCode })
      return { success: true }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  },

  dismiss: async (id) => {
    set(state => ({ shares: state.shares.filter(s => s.id !== id) }))
    try {
      await apiClient.delete(`/api/shares/${id}`)
    } catch (err) {
      set({ error: errorMessage(err) })
      await get().fetchAll()
    }
  },
}))

subscribeToAppEvent('puzzle_shared', (data) => {
  const share = (data as unknown as { share: PuzzleShare }).share
  useSharesStore.setState(state => ({
    shares: [share, ...state.shares.filter(s => s.id !== share.id)],
  }))
})
