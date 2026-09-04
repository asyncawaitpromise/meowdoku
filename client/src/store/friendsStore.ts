import { create } from 'zustand'
import { apiClient, ApiError } from '../services/apiClient.ts'
import { subscribeToAppEvent } from '../lib/liveEvents.ts'
import type { Difficulty } from './gameStore.ts'

export interface FriendProfile {
  id: string
  name: string | null
  is_anon: number
  friend_code: string
  theme: string
}

export interface FriendRequest {
  id: string
  requester: FriendProfile
}

export interface Friend extends FriendProfile {
  online: boolean
  progress: {
    completedLevels: number[]
    completedPuzzles: Record<Difficulty, number[]>
  }
}

interface FriendsState {
  friends: Friend[]
  requests: FriendRequest[]
  isLoading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  sendRequest: (friendCode: string) => Promise<{ success: boolean; error?: string }>
  acceptRequest: (id: string) => Promise<void>
  declineRequest: (id: string) => Promise<void>
  unfriend: (userId: string) => Promise<void>
}

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong')

export const useFriendsStore = create<FriendsState>()((set, get) => ({
  friends: [],
  requests: [],
  isLoading: false,
  error: null,

  fetchAll: async () => {
    set({ isLoading: true, error: null })
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        apiClient.get<{ friends: Friend[] }>('/api/friends'),
        apiClient.get<{ requests: FriendRequest[] }>('/api/friends/requests'),
      ])
      set({ friends: friendsRes.friends, requests: requestsRes.requests })
    } catch (err) {
      set({ error: errorMessage(err) })
    } finally {
      set({ isLoading: false })
    }
  },

  sendRequest: async (friendCode) => {
    try {
      await apiClient.post('/api/friends/requests', { friendCode })
      await get().fetchAll()
      return { success: true }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  },

  acceptRequest: async (id) => {
    try {
      await apiClient.post(`/api/friends/requests/${id}/accept`, {})
      await get().fetchAll()
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  declineRequest: async (id) => {
    set(state => ({ requests: state.requests.filter(r => r.id !== id) }))
    try {
      await apiClient.post(`/api/friends/requests/${id}/decline`, {})
    } catch (err) {
      set({ error: errorMessage(err) })
      await get().fetchAll()
    }
  },

  unfriend: async (userId) => {
    set(state => ({ friends: state.friends.filter(f => f.id !== userId) }))
    try {
      await apiClient.delete(`/api/friends/${userId}`)
    } catch (err) {
      set({ error: errorMessage(err) })
      await get().fetchAll()
    }
  },
}))

subscribeToAppEvent('friend_request', (data) => {
  const request = (data as unknown as { request: FriendRequest }).request
  useFriendsStore.setState(state => ({
    requests: [request, ...state.requests.filter(r => r.id !== request.id)],
  }))
})

subscribeToAppEvent('friend_request_accepted', () => {
  void useFriendsStore.getState().fetchAll()
})

subscribeToAppEvent('presence', (data) => {
  const { userId, online } = data as unknown as { userId: string; online: boolean }
  useFriendsStore.setState(state => ({
    friends: state.friends.map(f => (f.id === userId ? { ...f, online } : f)),
  }))
})
