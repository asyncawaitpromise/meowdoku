import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.ts'

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center">
    <span className="loading loading-spinner loading-lg"></span>
  </div>
)

// Every visitor gets a session (guest or real) automatically, so this only
// gates on that session having loaded — no redirect-to-signin anymore.
export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { isLoading, isInitialized } = useAuthStore()

  if (!isInitialized || isLoading) return <LoadingScreen />
  return <>{children}</>
}

// Redirects users with real credentials away from public-only pages (signin/signup).
// Guests still belong here — they have a session but no credentials yet.
export const PublicOnlyRoute = ({ children }: { children: ReactNode }) => {
  const { user, token, isLoading, isInitialized } = useAuthStore()
  const location = useLocation()
  const isAuthenticated = !!user && !!token && !user.is_anon

  if (!isInitialized || isLoading) return <LoadingScreen />
  if (isAuthenticated) {
    const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/dashboard'
    return <Navigate to={from} replace />
  }
  return <>{children}</>
}

// No auth requirement — renders children regardless of auth state.
export const OptionalRoute = ({ children }: { children: ReactNode }) => <>{children}</>

// Requires authentication AND admin status.
export const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { user, token, isLoading, isInitialized } = useAuthStore()
  const location = useLocation()
  const isAuthenticated = !!user && !!token

  if (!isInitialized || isLoading) return <LoadingScreen />
  if (!isAuthenticated) return <Navigate to="/signin" state={{ from: location }} replace />
  if (!user?.is_admin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
