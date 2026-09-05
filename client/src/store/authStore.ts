import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  email: string | null
  username: string | null
  name: string | null
  is_admin: number
  is_anon: number
  theme: string
  friend_code: string | null
}

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  isInitialized: boolean
  preferredTheme: string

  // Actions
  initialize: () => Promise<void>
  continueAsGuest: () => Promise<void>
  signIn: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
  signUp: (username: string, password: string, passwordConfirm: string, name?: string) => Promise<{ success: boolean; error?: string }>
  promote: (username: string, password: string, passwordConfirm: string, name?: string) => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<void>
  devLogin: () => Promise<{ success: boolean; error?: string }>
  setTokenFromCallback: (token: string) => Promise<void>
  updateProfile: (data: { name?: string; theme?: string }) => Promise<{ success: boolean; error?: string }>
  setPreferredTheme: (theme: string) => void
  // "Sign in on another device": mints a short-lived code on this (already
  // signed-in) device for another device to redeem into the same account.
  generateDeviceLink: () => Promise<{ success: boolean; code?: string; error?: string }>
  redeemDeviceLink: (code: string) => Promise<{ success: boolean; error?: string }>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      isInitialized: false,
      preferredTheme: 'meowdoku',

      initialize: async () => {
        const { token } = get()
        if (!token) {
          await get().continueAsGuest()
          set({ isInitialized: true })
          return
        }
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) {
            // Stale/expired/invalid token — drop it and bootstrap a fresh guest
            // session so the app never ends up signed-out-but-charging-ahead
            // (ProtectedRoute no longer redirects to /signin).
            set({ user: null, token: null })
            await get().continueAsGuest()
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

      continueAsGuest: async () => {
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/guest', { method: 'POST' })
          if (!res.ok) return
          const data = await res.json() as { token: string; user: User }
          set({ user: data.user, token: data.token })
        } catch {
          // Network error — stay signed out, retried on next initialize()
        } finally {
          set({ isLoading: false })
        }
      },

      signIn: async (username, password) => {
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
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

      signUp: async (username, password, passwordConfirm, name) => {
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, passwordConfirm, name }),
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

      promote: async (username, password, passwordConfirm, name) => {
        const { token } = get()
        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/promote', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ username, password, passwordConfirm, name }),
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

      signOut: async () => {
        set({ user: null, token: null })
        await get().continueAsGuest()
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
          set({ token, user: { id: payload.userId, email: payload.email, username: null, name: null, is_admin: 0, is_anon: 0, theme: 'meowdoku', friend_code: null } })
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

      setPreferredTheme: (theme) => {
        set({ preferredTheme: theme })
      },

      generateDeviceLink: async () => {
        const { token } = get()
        try {
          const res = await fetch('/api/auth/device-link', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
          const data = await res.json() as { code?: string; error?: string }
          if (!res.ok) return { success: false, error: data.error }
          return { success: true, code: data.code }
        } catch (err) {
          return { success: false, error: String(err) }
        }
      },

      redeemDeviceLink: async (code) => {
        set({ isLoading: true })
        try {
          const res = await fetch(`/api/auth/device-link/${encodeURIComponent(code)}/redeem`, { method: 'POST' })
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
    }),
    {
      name: 'auth',
      version: 1,
      migrate: (persisted, version) => {
        if (version >= 1) return persisted as AuthState
        const state = persisted as {
          user?: User | null
          token?: string | null
          preferredTheme?: string
        }
        // 'night' was the old programmatic default; the warm 'meowdoku' theme
        // replaced it. Normalize any leftover 'night' in local state so stale
        // storage can't leave the app stuck on the dark theme (the server is
        // the source of truth for deliberate picks — re-picking a dark theme in
        // Settings still wins after the next /me refresh).
        if (state.preferredTheme === 'night') state.preferredTheme = 'meowdoku'
        if (state.user?.theme === 'night') state.user.theme = 'meowdoku'
        return state as AuthState
      },
      partialize: (state) => ({ user: state.user, token: state.token, preferredTheme: state.preferredTheme }),
    }
  )
)
