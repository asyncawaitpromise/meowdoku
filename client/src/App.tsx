import { Component, useEffect, type ReactNode } from 'react'
import type { ErrorInfo } from 'react'
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore.ts'
import { useFriendsStore } from './store/friendsStore.ts'
import { useSharesStore } from './store/sharesStore.ts'
import { useMatchesStore } from './store/matchesStore.ts'
import { useCoopStore } from './store/coopStore.ts'
import { syncProgress } from './lib/progressSync.ts'
import { setLiveEventsToken, subscribeToReconnect } from './lib/liveEvents.ts'
import { ProtectedRoute, PublicOnlyRoute, OptionalRoute, AdminRoute } from './components/AuthWrapper.tsx'
import Home from './routes/Home.tsx'
import Game from './routes/Game.tsx'
import MatchGame from './routes/MatchGame.tsx'
import LevelSelect from './routes/LevelSelect.tsx'
import DifficultyLevelSelect from './routes/DifficultyLevelSelect.tsx'
import Dashboard from './routes/Dashboard.tsx'
import Friends from './routes/Friends.tsx'
import CoopGame from './routes/CoopGame.tsx'
import SignIn from './routes/SignIn.tsx'
import SignUp from './routes/SignUp.tsx'
import Settings from './routes/Settings.tsx'
import AuthCallback from './routes/AuthCallback.tsx'
import AnimTest from './routes/AnimTest.tsx'

// Lightweight dismissible banner for an incoming head-to-head challenge — this
// codebase has no toast system, so a fixed inline element is the simplest fit.
function MatchInviteBanner() {
  const navigate = useNavigate()
  const { invite, clearInvite, declineInvite, joinMatch } = useMatchesStore()

  if (!invite) return null

  const handleAccept = async () => {
    const session = await joinMatch(invite.sessionId)
    clearInvite()
    if (session) navigate(`/match/${session.id}`)
  }

  return (
    <div style={{
      position: 'fixed', top: 12, left: 12, right: 12, zIndex: 200,
      background: '#fffaf5', border: '1.5px solid #d4a830', borderRadius: 12,
      padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'system-ui, sans-serif',
    }}>
      <span style={{ fontSize: 20 }}>⚔️</span>
      <span style={{ flex: 1, fontSize: 13, color: '#5a2828', fontWeight: 600 }}>
        {(invite.from.name || 'A friend')} challenged you to {invite.difficulty}!
      </span>
      <button onClick={handleAccept} style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        Accept
      </button>
      <button onClick={() => declineInvite(invite.sessionId)} style={{ background: 'none', border: 'none', color: '#a07060', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>
        ×
      </button>
    </div>
  )
}

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
  const { user, token, initialize, preferredTheme, setPreferredTheme } = useAuthStore()

  // Validate stored token against the server on startup
  useEffect(() => {
    initialize()
  }, [initialize])

  // When a user with a saved theme signs in, adopt it as the preferred theme
  useEffect(() => {
    if (user?.theme) setPreferredTheme(user.theme)
  }, [user?.theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync local progress against the server once we know who's signed in
  useEffect(() => {
    if (user?.id) syncProgress(user.id)
  }, [user?.id])

  // Open (or reopen, on sign-out/promotion) the shared live-events connection
  useEffect(() => {
    setLiveEventsToken(token)
  }, [token])

  useEffect(() => {
    if (user?.id) void useFriendsStore.getState().fetchAll()
    if (user?.id) void useSharesStore.getState().fetchAll()
    if (user?.id) {
      void useMatchesStore.getState().fetchInvites()
      void useCoopStore.getState().fetchInvites()
    }
  }, [user?.id])

  // After any SSE reconnect the stream may have silently dropped presence /
  // share events, so re-pull the authoritative state (the plan's reconnect
  // rule, mirrored for friends & shared puzzles alongside multiplayer).
  useEffect(() => {
    const unsub = subscribeToReconnect(() => {
      if (useAuthStore.getState().user?.id) {
        void useFriendsStore.getState().fetchAll()
        void useSharesStore.getState().fetchAll()
        void useMatchesStore.getState().fetchInvites()
        void useCoopStore.getState().fetchInvites()
      }
    })
    return unsub
  }, [])

  const theme = user?.theme || preferredTheme

  return (
    <div className="phone-shell">
      <div data-theme={theme} className="phone-screen min-h-screen">
        <BrowserRouter>
          <MatchInviteBanner />
          <Routes>
            <Route path="/" element={<OptionalRoute><Home /></OptionalRoute>} />
            <Route path="/game" element={<OptionalRoute><Game /></OptionalRoute>} />
            <Route path="/game/:difficulty/:index" element={<OptionalRoute><Game /></OptionalRoute>} />
            <Route path="/game/:level" element={<OptionalRoute><Game /></OptionalRoute>} />
            <Route path="/shared/:code" element={<OptionalRoute><Game /></OptionalRoute>} />
            <Route path="/match/:sessionId" element={<ProtectedRoute><MatchGame /></ProtectedRoute>} />
            <Route path="/levels" element={<OptionalRoute><LevelSelect /></OptionalRoute>} />
            <Route path="/levels/:difficulty" element={<OptionalRoute><DifficultyLevelSelect /></OptionalRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
            <Route path="/coop/:sessionId" element={<ProtectedRoute><CoopGame /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/signin" element={<PublicOnlyRoute><SignIn /></PublicOnlyRoute>} />
            <Route path="/signup" element={<PublicOnlyRoute><SignUp /></PublicOnlyRoute>} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/animtest" element={<AnimTest />} />
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
