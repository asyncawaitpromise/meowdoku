import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.ts'
import { useCoopStore } from '../store/coopStore.ts'
import type { CellState } from '../store/gameStore.ts'
import type { GeneratedLevel } from '../lib/levelGen'
import { runLevelGeneration } from '../lib/levelGenCoordinator'
import { useGridSize } from '../hooks/useGridSize'
import { XMark } from '../components/XMark'
import { CatMark } from '../components/CatMark'
import { CatReveal } from '../components/CatReveal'

const GRID_PAD = 8
const GRID_GAP = 3

// The two participants must land on the identical region/color layout, so
// generation is keyed only off the session's own (difficulty, puzzleSeed) —
// a fixed puzzleIndex constant, not anything user- or client-specific.
const COOP_PUZZLE_INDEX = 1

export default function CoopGame() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { session, isLoading, error, loadSession, placeCell } = useCoopStore()

  useEffect(() => {
    if (sessionId) void loadSession(sessionId)
  }, [sessionId, loadSession])

  const [level, setLevel] = useState<GeneratedLevel | null>(null)
  useEffect(() => {
    if (!session) return
    setLevel(null)
    const cancel = runLevelGeneration(
      { type: 'generateLevelByDifficulty', difficulty: session.difficulty, puzzleIndex: COOP_PUZZLE_INDEX, globalSeed: session.puzzleSeed },
      () => {},
      (lvl) => setLevel(lvl),
    )
    return cancel
  }, [session?.difficulty, session?.puzzleSeed]) // eslint-disable-line react-hooks/exhaustive-deps

  const { wrapperRef, gridRef, gridSize } = useGridSize()

  const board = useMemo<CellState[][]>(() => {
    if (!level) return []
    const b = Array.from({ length: level.size }, () => Array<CellState>(level.size).fill('empty'))
    if (session) {
      for (const [key, state] of Object.entries(session.boardState)) {
        const [r, c] = key.split(',').map(Number)
        if (r < level.size && c < level.size) b[r][c] = state
      }
    }
    return b
  }, [level, session])

  const solvedRegions = useMemo(() => {
    if (!level) return new Set<number>()
    const solved = new Set<number>()
    level.solution.forEach((cell, regionId) => {
      if (board[cell.r]?.[cell.c] === 'cat') solved.add(regionId)
    })
    return solved
  }, [level, board])

  const isWon = !!level && solvedRegions.size === level.size

  const [errorCell, setErrorCell] = useState<{ r: number; c: number } | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current) }, [])

  const lastTap = useRef<{ r: number; c: number; time: number } | null>(null)

  // A wrong cat guess never touches the shared board — it's purely local,
  // ephemeral feedback (unlike single-player there's no lives system to
  // spend, and the wrong flag itself would otherwise need synchronizing).
  const attemptCat = useCallback((r: number, c: number) => {
    if (!level || isWon) return
    if (board[r][c] === 'cat') return
    const regionId = level.regions[r][c]
    const sol = level.solution[regionId]
    if (sol.r === r && sol.c === c) {
      placeCell(r, c, 'cat')
    } else {
      if (errorTimer.current) clearTimeout(errorTimer.current)
      setErrorCell({ r, c })
      errorTimer.current = setTimeout(() => setErrorCell(null), 900)
    }
  }, [level, isWon, board, placeCell])

  const getCellFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = gridRef.current
    if (!el || !level) return null
    const SIZE = level.size
    const rect = el.getBoundingClientRect()
    const relX = clientX - rect.left - GRID_PAD
    const relY = clientY - rect.top - GRID_PAD
    const inner = rect.width - GRID_PAD * 2
    const innerH = rect.height - GRID_PAD * 2
    if (relX < 0 || relY < 0 || relX > inner || relY > innerH) return null
    const cellW = (inner - GRID_GAP * (SIZE - 1)) / SIZE
    const cellH = (innerH - GRID_GAP * (SIZE - 1)) / SIZE
    const c = Math.floor(relX / (cellW + GRID_GAP))
    const r = Math.floor(relY / (cellH + GRID_GAP))
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null
    return { r, c }
  }, [level, gridRef])

  // No drag-to-paint here (unlike single-player's handlePointerMove) — every
  // placement is its own network call, so each tap is a deliberate, discrete
  // idempotent request rather than a fast local gesture.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isWon) return
    const cell = getCellFromPoint(e.clientX, e.clientY)
    if (!cell) return
    const { r, c } = cell
    const now = Date.now()
    const lt = lastTap.current

    if (lt && lt.r === r && lt.c === c && now - lt.time < 300) {
      lastTap.current = null
      attemptCat(r, c)
      return
    }
    lastTap.current = { r, c, time: now }

    const cur = board[r]?.[c]
    if (cur === 'empty') placeCell(r, c, 'marker')
    else if (cur === 'marker') placeCell(r, c, 'empty')
  }, [getCellFromPoint, attemptCat, placeCell, board, isWon])

  if (error) return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: '#f0e8e0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center',
    }}>
      <span style={{ fontSize: 48 }}>🙀</span>
      <p style={{ color: '#7a2828', fontWeight: 700, fontSize: 17, margin: 0 }}>{error}</p>
      <button onClick={() => navigate('/friends')} style={{ marginTop: 8, background: '#5a2828', color: 'white', border: 'none', borderRadius: 12, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        Back to friends
      </button>
    </div>
  )

  if (isLoading || !session || !level || board.length !== level.size) return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: '#f0e8e0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ width: 86, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.2s linear infinite' }}><CatMark /></div>
      <p style={{ color: '#7a4545', fontWeight: 600, fontSize: 16, margin: 0 }}>{!session ? 'Loading match…' : 'Generating puzzle…'}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  const SIZE = level.size
  const partner = session.players.find(p => p.id !== user?.id)
  const partnerName = partner ? (partner.name || (partner.is_anon ? 'Guest' : 'Player')) : null

  return (
    <div style={{
      position: 'fixed', inset: 0,
      backgroundColor: '#f0e8e0',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      padding: '0 12px',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', flexShrink: 0 }}>
        <button onClick={() => navigate('/friends')} style={btnStyle}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#5a2828', margin: 0 }}>
          Co-op · {session.difficulty.charAt(0).toUpperCase() + session.difficulty.slice(1)}
        </h1>
        <div style={{ width: 42 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: '#7a5040', fontWeight: 500 }}>
          {session.status === 'waiting'
            ? 'Waiting for your partner to join…'
            : `Playing with ${partnerName ?? 'your partner'}`}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 22 }}>🐱</span>
        <div style={{ width: 90, height: 8, background: '#e0d0c8', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${(solvedRegions.size / SIZE) * 100}%`, height: '100%', background: isWon ? '#3a8a50' : '#5a8a60', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontWeight: 700, color: '#3a6a40', fontSize: 14 }}>{solvedRegions.size}/{SIZE}</span>
      </div>

      <div ref={wrapperRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={gridRef}
          onPointerDown={handlePointerDown}
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
              const state = board[r][c]
              const isError = errorCell?.r === r && errorCell?.c === c

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
                  {!isError && state === 'marker' && <XMark color="#462323" opacity={0.6} />}
                  {state === 'cat' && <CatReveal variant="pop" tileColor={bg} />}
                </div>
              )
            })
          )}
        </div>
      </div>

      {isWon && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fffaf5', borderRadius: 24,
            padding: '36px 32px 28px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
            maxWidth: 300, width: '85%',
          }}>
            <span style={{ fontSize: 56 }}>🎉</span>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#3a6a40' }}>Solved together!</div>
            </div>
            <button
              onClick={() => navigate('/friends')}
              style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 14, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%' }}
            >
              Back to friends →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  width: 42, height: 42, borderRadius: '50%', background: 'white', border: 'none',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 18, color: '#7a4545', flexShrink: 0,
}
