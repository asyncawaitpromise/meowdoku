import { useEffect, useRef, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGameSession } from '../hooks/useGameSession'
import { useGridSize } from '../hooks/useGridSize'
import { useGameStore } from '../store/gameStore.ts'
import { useAuthStore } from '../store/authStore.ts'
import { useMatchesStore, type MatchSession } from '../store/matchesStore.ts'
import { XMark } from '../components/XMark'
import { CatMark } from '../components/CatMark'
import { CatReveal } from '../components/CatReveal'

const GRID_PAD = 8
const GRID_GAP = 3
const MAX_FISH = 3

// Head-to-head's own board screen. Deliberately duplicates Game.tsx's board
// JSX (grid/header/status-banner styling) rather than modifying that route:
// Game.tsx drives the single-player experience and this file trades some
// duplication for a guarantee that single-player behavior can't regress.
// The actual solving state/logic is NOT duplicated — this reuses
// useGameSession as-is (with the additive `skipProgressTracking` flag), so
// pointer handling, win detection, and the hint/animation systems stay
// single-sourced.
//
// Intentionally omitted compared to Game.tsx: restart (mid-match resets would
// need their own event type to explain to the opponent), puzzle sharing, and
// hints — out of scope for this slice.
export default function MatchGame() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { session, isLoading, error, loadMatch, clearMatch } = useMatchesStore()

  useEffect(() => {
    if (sessionId) void loadMatch(sessionId)
    return () => clearMatch()
  }, [sessionId, loadMatch, clearMatch])

  if (error) {
    return (
      <CenteredScreen>
        <span style={{ fontSize: 48 }}>🙀</span>
        <p style={{ color: '#7a2828', fontWeight: 700, fontSize: 17, margin: 0 }}>Couldn't load this match</p>
        <p style={{ color: '#a06060', fontSize: 13, margin: 0 }}>{error}</p>
        <BackButton onClick={() => navigate('/friends')} />
      </CenteredScreen>
    )
  }

  if (!session || session.id !== sessionId || isLoading) {
    return (
      <CenteredScreen>
        <div style={{ width: 86, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.2s linear infinite' }}><CatMark /></div>
        <p style={{ color: '#7a4545', fontWeight: 600, fontSize: 16, margin: 0 }}>Loading match…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </CenteredScreen>
    )
  }

  return <MatchBoard session={session} />
}

function MatchBoard({ session }: { session: MatchSession }) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { catAnimation } = useGameStore()
  const { clearSavedGame } = useGameStore()
  const { opponentStats, postEvent, finishMatch, leaveMatch } = useMatchesStore()
  const { wrapperRef, gridRef, gridSize } = useGridSize()

  const identity = {
    gameId: `match-${session.id}`,
    levelNum: 1,
    puzzleSeed: session.puzzleSeed,
    isDifficultyMode: true as const,
    difficulty: session.difficulty,
    puzzleIndex: 1,
    isSharedMode: false,
    codeParam: undefined,
    skipProgressTracking: true,
    skipPersistence: true,
  }

  // Match boards are never persisted, but a leftover from before that guard
  // existed (an abandoned match) would otherwise linger in saved games — sweep
  // this match's key on mount just in case.
  const gameId = `match-${session.id}`
  useEffect(() => {
    if (useGameStore.getState().savedGames[gameId]) clearSavedGame(gameId)
  }, [gameId, clearSavedGame])

  // Leaving is a server-side notion: if this screen unmounts before the match
  // concluded (win/finish), the opponent would be stranded on an active session
  // for up to 24h. Reads the latest status through a ref, so the win-modal
  // "Done" path (status already 'finished') doesn't also fire a leave.
  const sessionStatusRef = useRef(session.status)
  useEffect(() => {
    sessionStatusRef.current = session.status
  }, [session.status])
  useEffect(() => {
    const sid = session.id
    return () => {
      const status = sessionStatusRef.current
      if (status === 'waiting' || status === 'active') void leaveMatch(sid)
    }
  }, [session.id, leaveMatch])

  const {
    level, genStatus,
    board, solvedRegions, fishCount, errorCell, wrongCells, leavingMarkers,
    isWon, isGameOver,
    handlePointerDown, handlePointerMove, handlePointerUp,
  } = useGameSession(identity, gridRef)

  // Reports only the local player's own deltas — never touches how
  // fishCount/solvedRegions/wrongCells are computed, just observes them.
  const prevStatsRef = useRef<{ fish: number; cats: number; x: number } | null>(null)
  useEffect(() => {
    const next = { fish: fishCount, cats: solvedRegions.size, x: wrongCells.size }
    const prev = prevStatsRef.current
    prevStatsRef.current = next
    if (!prev) return // first run is the restored/initial baseline, not a new event
    if (next.fish < prev.fish) void postEvent(session.id, 'life_lost', { remaining: next.fish })
    if (next.cats > prev.cats) void postEvent(session.id, 'cat_found', { count: next.cats })
    if (next.x > prev.x) void postEvent(session.id, 'x_placed', { count: next.x })
  }, [fishCount, solvedRegions.size, wrongCells.size, session.id, postEvent])

  // Winning is the end of the match for both players — tell the server so the
  // opponent's HUD gets the 'finished' state instead of an open-ended session.
  const hasReportedFinishRef = useRef(false)
  useEffect(() => {
    if (isWon && !hasReportedFinishRef.current) {
      hasReportedFinishRef.current = true
      void finishMatch(session.id)
    }
  }, [isWon, session.id, finishMatch])

  const opponent = session.players.find(p => p.id !== user?.id)
  const opponentName = opponent?.name || (opponent?.is_anon ? 'Guest' : 'Opponent')
  const SIZE = level?.size ?? 10

  if (!level || board.length !== level.size) {
    return (
      <CenteredScreen>
        <div style={{ width: 86, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.2s linear infinite' }}><CatMark /></div>
        <p style={{ color: '#7a4545', fontWeight: 600, fontSize: 16, margin: 0 }}>Generating puzzle…</p>
        {genStatus.some(s => s) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
            {genStatus.map((s, i) => s && <p key={i} style={{ color: '#a06060', fontSize: 13, margin: 0 }}>{s}</p>)}
          </div>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </CenteredScreen>
    )
  }

  return (
    <div className="phone-fullscreen" style={{
      backgroundColor: '#f0e8e0',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      padding: '0 12px',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', flexShrink: 0 }}>
        <button onClick={() => navigate('/friends')} style={btnStyle}>←</button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#5a2828', margin: 0 }}>vs {opponentName}</h1>
        <div style={{ width: 42 }} />
      </div>

      {/* Opponent HUD */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderRadius: 10, padding: '6px 10px', marginBottom: 8, flexShrink: 0, border: '1px solid #e0d0c8' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#a07060', textTransform: 'uppercase', letterSpacing: 0.4 }}>{opponentName}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#3a6a40', fontWeight: 700 }}>🐱 {opponentStats.catsFound}/{SIZE}</span>
          <span style={{ fontSize: 12, color: '#7a2828', fontWeight: 700 }}>✕ {opponentStats.xPlaced}</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {Array.from({ length: MAX_FISH }, (_, i) => (
              <span key={i} style={{ fontSize: 14, opacity: i < opponentStats.fishCount ? 1 : 0.2 }}>🐟</span>
            ))}
          </div>
        </div>
      </div>

      {/* Rules */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {['1 Cat per color', '1 Cat per row & column', 'Cats cannot touch'].map(rule => (
          <div key={rule} style={{ background: 'white', borderRadius: 10, padding: '5px 10px', fontSize: 12, color: '#6a4040', fontWeight: 500, border: '1px solid #e0d0c8', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {rule}
          </div>
        ))}
      </div>

      {/* Your progress + fish */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22 }}>🐱</span>
          <div style={{ width: 90, height: 8, background: '#e0d0c8', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(solvedRegions.size / SIZE) * 100}%`, height: '100%', background: isWon ? '#3a8a50' : '#5a8a60', borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
          <span style={{ fontWeight: 700, color: '#3a6a40', fontSize: 14 }}>{solvedRegions.size}/{SIZE}</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {Array.from({ length: MAX_FISH }, (_, i) => (
            <span key={i} style={{ fontSize: 18, opacity: i < fishCount ? 1 : 0.2, transition: 'opacity 0.4s' }}>🐟</span>
          ))}
        </div>
      </div>

      {/* Status banners */}
      {isWon && (
        <div style={{ background: '#d4f0d8', border: '2px solid #3a8a50', borderRadius: 10, padding: '8px 16px', marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#2a5a30' }}>You solved it! 🎉</span>
          <button onClick={() => navigate('/friends')} style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 8, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Done</button>
        </div>
      )}
      {isGameOver && (
        <div style={{ background: '#f0d4d4', border: '2px solid #a05050', borderRadius: 10, padding: '8px 16px', marginBottom: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#7a2828' }}>No lives left — watch {opponentName} finish!</span>
        </div>
      )}
      {(session.status === 'finished' || session.status === 'declined') && !isWon && !isGameOver && (
        <div style={{ background: '#f0e4d0', border: '2px solid #c89650', borderRadius: 10, padding: '8px 16px', marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#7a5a28' }}>
            {session.status === 'declined' ? 'Your opponent declined the challenge' : 'The match has ended'}
          </span>
          <button onClick={() => navigate('/friends')} style={{ background: '#c89650', color: 'white', border: 'none', borderRadius: 8, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Done</button>
        </div>
      )}

      {/* Grid */}
      <div ref={wrapperRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={gridRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
            gap: GRID_GAP,
            background: 'white',
            padding: GRID_PAD,
            borderRadius: 16,
            boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
            touchAction: 'none',
            userSelect: 'none',
            width: gridSize || '100%',
            height: gridSize || undefined,
            boxSizing: 'border-box',
          }}
        >
          {Array.from({ length: SIZE }, (_, r) =>
            Array.from({ length: SIZE }, (_, c) => {
              const regionId = level.regions[r][c]
              const bg = level.colors[regionId]
              const key = `${r},${c}`
              const state = board[r][c]
              const isError = errorCell?.r === r && errorCell?.c === c
              const isWrong = wrongCells.has(key)
              const isLeaving = leavingMarkers.has(key)

              return (
                <div
                  key={`${r}-${c}`}
                  style={{
                    backgroundColor: bg,
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    aspectRatio: '1',
                    position: 'relative',
                    overflow: 'visible',
                  }}
                >
                  {isError && (
                    <>
                      <div style={{ position: 'absolute', inset: 0, borderRadius: 5, background: 'rgba(200,0,0,0.28)' }} />
                      <XMark color="#b00000" opacity={1} />
                    </>
                  )}
                  {!isError && state === 'marker' && isWrong && (
                    <>
                      <div style={{ position: 'absolute', inset: 0, borderRadius: 5, background: 'rgba(200,0,0,0.28)' }} />
                      <XMark color="#b00000" opacity={1} static />
                    </>
                  )}
                  {!isError && state === 'marker' && !isWrong && <XMark color="#462323" opacity={0.6} />}
                  {!isError && isLeaving && state === 'empty' && <XMark color="#462323" opacity={0.6} exiting />}
                  {state === 'cat' && <CatReveal variant={catAnimation} tileColor={bg} />}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div style={{ height: 16, flexShrink: 0 }} />
    </div>
  )
}

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <div className="phone-fullscreen" style={{
      backgroundColor: '#f0e8e0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ marginTop: 8, background: '#5a2828', color: 'white', border: 'none', borderRadius: 12, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
      Back to friends
    </button>
  )
}

const btnStyle: React.CSSProperties = {
  width: 42, height: 42, borderRadius: '50%', background: 'white', border: 'none',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 18, color: '#7a4545', flexShrink: 0,
}
