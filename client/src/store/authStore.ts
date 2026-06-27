import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  email: string
  name: string | null
  is_admin: number
  theme: string
}

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  isInitialized: boolean
  preferredTheme: string

  // Actions
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  signUp: (email: string, password: string, passwordConfirm: string, name?: string) => Promise<{ success: boolean; error?: string }>
  signOut: () => void
  devLogin: () => Promise<{ success: boolean; error?: string }>
  setTokenFromCallback: (token: string) => Promise<void>
  updateProfile: (data: { name?: string; theme?: string }) => Promise<{ success: boolean; error?: string }>
  signInWithOAuth: (provider: 'google' | 'github' | 'discord') => void
  setPreferredTheme: (theme: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      isInitialized: false,
      preferredTheme: 'night',

      initialize: async () => {
        const { token } = get()
        if (!token) {
          set({ isInitialized: true })
          return
        }
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) {
            set({ user: null, token: null })
          } else {
            const data = await res.json() as { user: User }
            set({ user: data.user })
          }
        } catch {
          // Network error — keep stored token, don't invalidate
        } finally {
          set({ isLoading: false, isInitialized: true })
        }
      },

      signIn: async (email, password) => {
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })
          const data = await res.json() as { token?: string; user?: User; error?: string }
          if (!res.ok) return { success: false, error: data.error }
          set({ user: data.user!, token: data.token! })
          return { success: true }
        } catch (err) {
          return { success: false, error: String(err) }
        } finally {
          set({ isLoading: false })
        }
      },

      signUp: async (email, password, passwordConfirm, name) => {
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, passwordConfirm, name }),
          })
          const data = await res.json() as { token?: string; user?: User; error?: string }
          if (!res.ok) return { success: false, error: data.error }
          set({ user: data.user!, token: data.token! })
          return { success: true }
        } catch (err) {
          return { success: false, error: String(err) }
        } finally {
          set({ isLoading: false })
        }
      },

      signOut: () => {
        set({ user: null, token: null })
      },

      devLogin: async () => {
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/dev-login', { method: 'POST' })
          const data = await res.json() as { token?: string; user?: User; error?: string }
          if (!res.ok) return { success: false, error: data.error }
          set({ user: data.user!, token: data.token! })
          return { success: true }
        } catch (err) {
          return { success: false, error: String(err) }
        } finally {
          set({ isLoading: false })
        }
      },

      setTokenFromCallback: async (token) => {
        try {
          const payload = JSON.parse(atob(token.split('.')[1])) as { userId: string; email: string }
          // Store a minimal user immediately so auth state is truthy
          set({ token, user: { id: payload.userId, email: payload.email, name: null, is_admin: 0, theme: 'night' } })
          // Fetch the full user record in the background
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const data = await res.json() as { user: User }
            set({ user: data.user })
          }
        } catch {
          set({ user: null, token: null })
        }
      },

      updateProfile: async (data) => {
        const { token } = get()
        try {
          const res = await fetch('/api/auth/profile', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(data),
          })
          const json = await res.json() as { user?: User; error?: string }
          if (!res.ok) return { success: false, error: json.error }
          set({ user: json.user! })
          return { success: true }
        } catch (err) {
          return { success: false, error: String(err) }
        }
      },

      signInWithOAuth: (provider) => {
        window.location.href = `/api/auth/oauth/${provider}`
      },

      setPreferredTheme: (theme) => {
        set({ preferredTheme: theme })
      },
    }),
    {
      name: 'auth',
      partialize: (state) => ({ user: state.user, token: state.token, preferredTheme: state.preferredTheme }),
    }
  )
)
