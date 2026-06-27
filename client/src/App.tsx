import { Component, useEffect, type ReactNode } from 'react'
import type { ErrorInfo } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './store/authStore.ts'
import { ProtectedRoute, PublicOnlyRoute, OptionalRoute, AdminRoute } from './components/AuthWrapper.tsx'
import Home from './routes/Home.tsx'
import Dashboard from './routes/Dashboard.tsx'
import SignIn from './routes/SignIn.tsx'
import SignUp from './routes/SignUp.tsx'
import Settings from './routes/Settings.tsx'
import AuthCallback from './routes/AuthCallback.tsx'

// Catches render errors anywhere in the tree and shows a fallback UI.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 text-center">
          <div>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="opacity-60 mb-4 max-w-sm">{(this.state.error as Error).message}</p>
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const ThemedApp = () => {
  const { user, initialize, preferredTheme, setPreferredTheme } = useAuthStore()

  // Validate stored token against the server on startup
  useEffect(() => {
    initialize()
  }, [initialize])

  // When a user with a saved theme signs in, adopt it as the preferred theme
  useEffect(() => {
    if (user?.theme) setPreferredTheme(user.theme)
  }, [user?.theme]) // eslint-disable-line react-hooks/exhaustive-deps

  const theme = user?.theme || preferredTheme

  return (
    <div data-theme={theme} className="min-h-screen">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<OptionalRoute><Home /></OptionalRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/signin" element={<PublicOnlyRoute><SignIn /></PublicOnlyRoute>} />
          <Route path="/signup" element={<PublicOnlyRoute><SignUp /></PublicOnlyRoute>} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          {/* Admin-only route example */}
          <Route path="/admin" element={<AdminRoute><Dashboard /></AdminRoute>} />
          <Route path="*" element={
            <div className="min-h-screen flex items-center justify-center text-center p-8">
              <div>
                <h1 className="text-4xl font-bold mb-2">404</h1>
                <p className="opacity-60">Page not found</p>
              </div>
            </div>
          } />
        </Routes>
      </BrowserRouter>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemedApp />
    </ErrorBoundary>
  )
}
